import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { getDb } from '../../db/connection.js';

export type SocialCredentialProvider = 'bluesky' | 'linkedin' | 'x';

interface EncryptedCredentialRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

function credentialKey(): Buffer {
  const configured = process.env.SOCIAL_CREDENTIALS_KEY;
  if (!configured) {
    throw new Error('SOCIAL_CREDENTIALS_KEY is required before social credentials can be stored or read');
  }

  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('SOCIAL_CREDENTIALS_KEY must be a base64-encoded 32-byte key');
  }
  return key;
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
  const key = credentialKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(input.value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
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
    .run(input.agentGroupId, input.provider, input.credentialKind, ciphertext, iv, authTag, now, now);
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

  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), row.iv);
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
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
