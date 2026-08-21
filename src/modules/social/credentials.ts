import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { getDb } from '../../db/connection.js';

export type SocialCredentialProvider = 'bluesky' | 'linkedin' | 'x';

interface EncryptedCredentialRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

export interface EncryptedSocialValue {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function validateSocialCredentialsKey(configured: string | undefined): Buffer {
  if (!configured)
    throw new Error('SOCIAL_CREDENTIALS_KEY is required before social credentials can be stored or read');
  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('SOCIAL_CREDENTIALS_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function credentialKey(): Buffer {
  return validateSocialCredentialsKey(process.env.SOCIAL_CREDENTIALS_KEY);
}

export function encryptSocialValue(value: string, context: string): EncryptedSocialValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  return {
    ciphertext: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]),
    iv,
    authTag: cipher.getAuthTag(),
  };
}

export function decryptSocialValue(value: EncryptedSocialValue, context: string): string {
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), value.iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
}

function decryptLegacySocialCredential(value: EncryptedSocialValue): string {
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), value.iv);
  decipher.setAuthTag(value.authTag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Store a credential for host-side use only. Values must never be returned by
 * CLI resources, included in logs, or mounted into an agent container.
 */
export function saveSocialCredential(input: {
  agentGroupId: string;
  provider: SocialCredentialProvider;
  credentialKind: string;
  value: string;
}): void {
  if (!input.value) throw new Error('Social credential value cannot be empty');
  const encrypted = encryptSocialValue(input.value, `${input.agentGroupId}:${input.provider}:${input.credentialKind}`);
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO social_credentials (
        agent_group_id, provider, credential_kind, ciphertext, iv, auth_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_group_id, provider, credential_kind) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.agentGroupId,
      input.provider,
      input.credentialKind,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      now,
      now,
    );
}

/** Returns the decrypted host-only credential, or undefined when not configured. */
export function loadSocialCredential(input: {
  agentGroupId: string;
  provider: SocialCredentialProvider;
  credentialKind: string;
}): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT ciphertext, iv, auth_tag
       FROM social_credentials
       WHERE agent_group_id = ? AND provider = ? AND credential_kind = ?`,
    )
    .get(input.agentGroupId, input.provider, input.credentialKind) as EncryptedCredentialRow | undefined;
  if (!row) return undefined;

  const encrypted = { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag };
  try {
    return decryptSocialValue(encrypted, `${input.agentGroupId}:${input.provider}:${input.credentialKind}`);
  } catch {
    // Credentials saved before context binding used GCM without AAD. Retain
    // read compatibility; each subsequent save upgrades that row automatically.
    return decryptLegacySocialCredential(encrypted);
  }
}

/** Safe for status surfaces - does not reveal the credential or metadata. */
export function hasSocialCredential(input: {
  agentGroupId: string;
  provider: SocialCredentialProvider;
  credentialKind: string;
}): boolean {
  return (
    getDb()
      .prepare(
        `SELECT 1 FROM social_credentials
         WHERE agent_group_id = ? AND provider = ? AND credential_kind = ? LIMIT 1`,
      )
      .get(input.agentGroupId, input.provider, input.credentialKind) !== undefined
  );
}
