import { createHash, randomBytes } from 'crypto';

import type http from 'http';

import { SOCIAL_LINKEDIN_CLIENT_ID, SOCIAL_PUBLIC_BASE_URL, SOCIAL_X_CLIENT_ID } from '../../config.js';
import { getDb } from '../../db/connection.js';
import { log } from '../../log.js';
import { registerWebhookHandler } from '../../webhook-server.js';
import {
  decryptSocialValue,
  encryptSocialValue,
  loadSocialCredential,
  saveSocialCredential,
  type SocialCredentialProvider,
} from './credentials.js';

type OAuthProvider = Extract<SocialCredentialProvider, 'linkedin' | 'x'>;

interface OAuthStateRow {
  agent_group_id: string;
  verifier: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

interface OAuthConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  usesPkce: boolean;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function configFor(provider: OAuthProvider): OAuthConfig | undefined {
  if (provider === 'x' && SOCIAL_X_CLIENT_ID && SOCIAL_PUBLIC_BASE_URL) {
    return {
      clientId: SOCIAL_X_CLIENT_ID,
      authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
      tokenEndpoint: 'https://api.x.com/2/oauth2/token',
      scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      usesPkce: true,
    };
  }
  if (provider === 'linkedin' && SOCIAL_LINKEDIN_CLIENT_ID && SOCIAL_PUBLIC_BASE_URL) {
    return {
      clientId: SOCIAL_LINKEDIN_CLIENT_ID,
      authorizationEndpoint: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenEndpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
      scopes: ['r_member_social'],
      usesPkce: false,
    };
  }
  return undefined;
}

function callbackUrl(provider: OAuthProvider): string {
  if (!SOCIAL_PUBLIC_BASE_URL) throw new Error('SOCIAL_PUBLIC_BASE_URL is required for social OAuth');
  return new URL(`/webhook/social-oauth-${provider}`, SOCIAL_PUBLIC_BASE_URL).toString();
}

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Starts a one-time OAuth flow and returns the provider consent URL. */
export function beginSocialOAuth(input: { agentGroupId: string; provider: OAuthProvider }): string {
  const config = configFor(input.provider);
  if (!config) throw new Error(`OAuth is not configured for ${input.provider}`);
  if (
    input.provider === 'linkedin' &&
    !loadSocialCredential({
      agentGroupId: input.agentGroupId,
      provider: 'linkedin',
      credentialKind: 'client-secret',
    })
  ) {
    throw new Error('LinkedIn client-secret must be configured before OAuth can start');
  }

  const state = randomUrlSafe(32);
  const verifier = randomUrlSafe(48);
  const encrypted = encryptSocialValue(verifier, `oauth:${input.agentGroupId}:${input.provider}:${state}`);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO social_oauth_states (state, agent_group_id, provider, verifier, iv, auth_tag, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(state, input.agentGroupId, input.provider, encrypted.ciphertext, encrypted.iv, encrypted.authTag, expiresAt);

  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(input.provider));
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  if (config.usesPkce) {
    url.searchParams.set('code_challenge', codeChallenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

function takeOAuthState(
  provider: OAuthProvider,
  state: string,
): { agentGroupId: string; verifier: string } | undefined {
  const db = getDb();
  const row = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT agent_group_id, verifier, iv, auth_tag
         FROM social_oauth_states
         WHERE state = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(state, provider, new Date().toISOString()) as OAuthStateRow | undefined;
    if (!candidate) return undefined;
    const claimed = db
      .prepare('UPDATE social_oauth_states SET consumed_at = ? WHERE state = ? AND consumed_at IS NULL')
      .run(new Date().toISOString(), state);
    return claimed.changes === 1 ? candidate : undefined;
  })();
  if (!row) return undefined;
  return {
    agentGroupId: row.agent_group_id,
    verifier: decryptSocialValue(
      { ciphertext: row.verifier, iv: row.iv, authTag: row.auth_tag },
      `oauth:${row.agent_group_id}:${provider}:${state}`,
    ),
  };
}

async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
  agentGroupId: string,
): Promise<void> {
  const config = configFor(provider);
  if (!config) throw new Error(`OAuth is not configured for ${provider}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(provider),
    client_id: config.clientId,
  });
  if (config.usesPkce) body.set('code_verifier', verifier);
  if (provider === 'linkedin') {
    body.set(
      'client_secret',
      loadSocialCredential({ agentGroupId, provider: 'linkedin', credentialKind: 'client-secret' }) ?? '',
    );
  }
  const xClientSecret =
    provider === 'x'
      ? loadSocialCredential({ agentGroupId, provider: 'x', credentialKind: 'client-secret' })
      : undefined;
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(xClientSecret
        ? { authorization: `Basic ${Buffer.from(`${config.clientId}:${xClientSecret}`).toString('base64')}` }
        : {}),
    },
    body,
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed with status ${response.status}`);
  const token = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (!token.access_token) throw new Error('OAuth token exchange did not return an access token');
  saveSocialCredential({ agentGroupId, provider, credentialKind: 'access-token', value: token.access_token });
  if (token.refresh_token) {
    saveSocialCredential({ agentGroupId, provider, credentialKind: 'refresh-token', value: token.refresh_token });
  }
}

function writeHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><title>Ed Social</title><p>${body}</p>`);
}

function oauthCallback(provider: OAuthProvider) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !code) {
      writeHtml(res, 400, 'Authorization was cancelled or the callback was incomplete. You can close this page.');
      return;
    }
    const pending = takeOAuthState(provider, state);
    if (!pending) {
      writeHtml(res, 400, 'This authorization link has expired or was already used. Start again from Nanoclaw.');
      return;
    }
    try {
      await exchangeCode(provider, code, pending.verifier, pending.agentGroupId);
      writeHtml(res, 200, 'Account connected. You can close this page and return to Nanoclaw.');
    } catch (error) {
      log.warn('Social OAuth callback failed', { provider, agentGroupId: pending.agentGroupId, error });
      writeHtml(res, 502, 'The provider did not accept this authorization. Start the connection again from Nanoclaw.');
    }
  };
}

/** Registers callbacks only when their public configuration is complete. */
export function registerSocialOAuthCallbacks(): void {
  for (const provider of ['x', 'linkedin'] as const) {
    if (configFor(provider)) registerWebhookHandler(`social-oauth-${provider}`, oauthCallback(provider));
  }
}
