import { afterEach, describe, expect, it, vi } from 'vitest';

const GROUP_ID = 'oauth-test-group';

afterEach(async () => {
  const { closeDb } = await import('../../db/connection.js');
  closeDb();
  delete process.env.SOCIAL_CREDENTIALS_KEY;
  delete process.env.SOCIAL_PUBLIC_BASE_URL;
  delete process.env.SOCIAL_X_CLIENT_ID;
  delete process.env.SOCIAL_LINKEDIN_CLIENT_ID;
  vi.resetModules();
});

describe('social OAuth', () => {
  it('creates an encrypted, PKCE-protected X authorisation request', async () => {
    process.env.SOCIAL_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString('base64');
    process.env.SOCIAL_PUBLIC_BASE_URL = 'https://nanoclaw.example.test';
    process.env.SOCIAL_X_CLIENT_ID = 'x-client-id';
    vi.resetModules();

    const [{ getDb, initTestDb }, { runMigrations }, { beginSocialOAuth }] = await Promise.all([
      import('../../db/connection.js'),
      import('../../db/migrations/index.js'),
      import('./oauth.js'),
    ]);
    const db = initTestDb();
    runMigrations(db);
    db.prepare("INSERT INTO agent_groups (id, name, folder, created_at) VALUES (?, 'OAuth test', 'oauth-test', ?)").run(
      GROUP_ID,
      new Date().toISOString(),
    );

    const authorisationUrl = new URL(beginSocialOAuth({ agentGroupId: GROUP_ID, provider: 'x' }));
    expect(authorisationUrl.origin).toBe('https://x.com');
    expect(authorisationUrl.searchParams.get('redirect_uri')).toBe(
      'https://nanoclaw.example.test/webhook/social-oauth-x',
    );
    expect(authorisationUrl.searchParams.get('scope')).toContain('offline.access');
    expect(authorisationUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const state = authorisationUrl.searchParams.get('state');
    const stored = getDb().prepare('SELECT verifier FROM social_oauth_states WHERE state = ?').get(state) as {
      verifier: Buffer;
    };
    expect(stored.verifier.toString('utf8')).not.toContain(authorisationUrl.searchParams.get('code_challenge') ?? '');
  });
});
