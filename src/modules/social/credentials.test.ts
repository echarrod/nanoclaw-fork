import { createCipheriv, randomBytes } from 'crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, initTestDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/index.js';
import { hasSocialCredential, loadSocialCredential, saveSocialCredential } from './credentials.js';

const GROUP_ID = 'social-test-group';

function configureTestKey(): void {
  process.env.SOCIAL_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
}

function createGroup(): void {
  getDb()
    .prepare("INSERT INTO agent_groups (id, name, folder, created_at) VALUES (?, 'Social test', 'social-test', ?)")
    .run(GROUP_ID, new Date().toISOString());
}

afterEach(() => {
  delete process.env.SOCIAL_CREDENTIALS_KEY;
  closeDb();
});

describe('social credential store', () => {
  it('encrypts credentials at rest and only decrypts through the host store', () => {
    configureTestKey();
    const db = initTestDb();
    runMigrations(db);
    createGroup();

    saveSocialCredential({
      agentGroupId: GROUP_ID,
      provider: 'bluesky',
      credentialKind: 'app-password',
      value: 'abcd-efgh-ijkl-mnop',
    });

    expect(hasSocialCredential({ agentGroupId: GROUP_ID, provider: 'bluesky', credentialKind: 'app-password' })).toBe(
      true,
    );
    expect(loadSocialCredential({ agentGroupId: GROUP_ID, provider: 'bluesky', credentialKind: 'app-password' })).toBe(
      'abcd-efgh-ijkl-mnop',
    );
    const stored = db.prepare('SELECT ciphertext FROM social_credentials WHERE agent_group_id = ?').get(GROUP_ID) as {
      ciphertext: Buffer;
    };
    expect(stored.ciphertext.toString('utf8')).not.toContain('abcd-efgh-ijkl-mnop');
  });

  it('fails closed when the encryption key is absent', () => {
    const db = initTestDb();
    runMigrations(db);
    createGroup();

    expect(() =>
      saveSocialCredential({
        agentGroupId: GROUP_ID,
        provider: 'bluesky',
        credentialKind: 'app-password',
        value: 'value',
      }),
    ).toThrow('SOCIAL_CREDENTIALS_KEY is required');
  });

  it('reads credentials saved before context binding was introduced', () => {
    configureTestKey();
    const db = initTestDb();
    runMigrations(db);
    createGroup();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.SOCIAL_CREDENTIALS_KEY!, 'base64'), iv);
    const ciphertext = Buffer.concat([cipher.update('old-app-password', 'utf8'), cipher.final()]);
    db.prepare(
      `INSERT INTO social_credentials (
        agent_group_id, provider, credential_kind, ciphertext, iv, auth_tag, created_at, updated_at
      ) VALUES (?, 'bluesky', 'app-password', ?, ?, ?, ?, ?)`,
    ).run(GROUP_ID, ciphertext, iv, cipher.getAuthTag(), new Date().toISOString(), new Date().toISOString());

    expect(loadSocialCredential({ agentGroupId: GROUP_ID, provider: 'bluesky', credentialKind: 'app-password' })).toBe(
      'old-app-password',
    );
  });
});
