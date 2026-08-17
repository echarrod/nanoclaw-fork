import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/** Scope social source and draft records to one NanoClaw agent group. */
export const migration023: Migration = {
  version: 23,
  name: 'social-group-isolation',
  disableForeignKeys: true,
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE social_source_posts_next (
        agent_group_id      TEXT NOT NULL,
        source              TEXT NOT NULL,
        external_id         TEXT NOT NULL,
        author              TEXT NOT NULL,
        published_at        TEXT NOT NULL,
        updated_at          TEXT,
        source_url          TEXT,
        content_json        TEXT NOT NULL,
        revision            TEXT NOT NULL,
        imported_at         TEXT NOT NULL,
        PRIMARY KEY (agent_group_id, source, external_id)
      );
      INSERT INTO social_source_posts_next
      SELECT 'legacy', source, external_id, author, published_at, updated_at, source_url, content_json, revision, imported_at
      FROM social_source_posts;

      CREATE TABLE social_drafts_next (
        id                  TEXT PRIMARY KEY,
        agent_group_id      TEXT NOT NULL,
        source              TEXT NOT NULL,
        source_external_id  TEXT NOT NULL,
        platform            TEXT NOT NULL,
        content_json        TEXT NOT NULL,
        source_revision     TEXT NOT NULL,
        state               TEXT NOT NULL,
        scheduled_for       TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE (agent_group_id, source, source_external_id, platform),
        FOREIGN KEY (agent_group_id, source, source_external_id)
          REFERENCES social_source_posts_next(agent_group_id, source, external_id)
      );
      INSERT INTO social_drafts_next
      SELECT id, 'legacy', source, source_external_id, platform, content_json, source_revision, state, scheduled_for, created_at, updated_at
      FROM social_drafts;

      CREATE TABLE social_publications_backup AS
      SELECT draft_id, platform, idempotency_key, state, external_id, url, attempted_at, error
      FROM social_publications;

      DROP TABLE social_publications;
      DROP TABLE social_drafts;
      DROP TABLE social_source_posts;
      ALTER TABLE social_source_posts_next RENAME TO social_source_posts;
      ALTER TABLE social_drafts_next RENAME TO social_drafts;

      CREATE TABLE social_publications (
        draft_id            TEXT NOT NULL REFERENCES social_drafts(id) ON DELETE CASCADE,
        platform            TEXT NOT NULL,
        idempotency_key     TEXT NOT NULL UNIQUE,
        state               TEXT NOT NULL,
        external_id         TEXT,
        url                 TEXT,
        attempted_at        TEXT,
        error               TEXT,
        PRIMARY KEY (draft_id, platform)
      );
      INSERT INTO social_publications
      SELECT draft_id, platform, idempotency_key, state, external_id, url, attempted_at, error
      FROM social_publications_backup;
      DROP TABLE social_publications_backup;
    `);
  },
};
