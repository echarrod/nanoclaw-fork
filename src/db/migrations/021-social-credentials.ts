import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/**
 * Encrypted credentials used by host-side social integrations. Ciphertext is
 * deliberately kept separate from source posts and agent-visible state.
 */
export const migration021: Migration = {
  version: 21,
  name: 'social-credentials',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_credentials (
        agent_group_id  TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL,
        credential_kind TEXT NOT NULL,
        ciphertext      BLOB NOT NULL,
        iv              BLOB NOT NULL,
        auth_tag        BLOB NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (agent_group_id, provider, credential_kind)
      );
    `);
  },
};
