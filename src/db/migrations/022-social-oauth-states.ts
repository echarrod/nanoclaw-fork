import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/** One-time, encrypted PKCE state for host-side social OAuth callbacks. */
export const migration022: Migration = {
  version: 22,
  name: 'social-oauth-states',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_oauth_states (
        state           TEXT PRIMARY KEY,
        agent_group_id  TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL,
        verifier        BLOB NOT NULL,
        iv              BLOB NOT NULL,
        auth_tag        BLOB NOT NULL,
        expires_at      TEXT NOT NULL,
        consumed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_social_oauth_states_expiry ON social_oauth_states(expires_at);
    `);
  },
};
