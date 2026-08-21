import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/** Durable personal social source, draft, and publication audit state. */
export const migration020: Migration = {
  version: 20,
  name: 'social-publishing',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_source_posts (
        source              TEXT NOT NULL,
        external_id         TEXT NOT NULL,
        author              TEXT NOT NULL,
        published_at        TEXT NOT NULL,
        updated_at          TEXT,
        source_url          TEXT,
        content_json        TEXT NOT NULL,
        revision            TEXT NOT NULL,
        imported_at         TEXT NOT NULL,
        PRIMARY KEY (source, external_id)
      );

      CREATE TABLE IF NOT EXISTS social_drafts (
        id                  TEXT PRIMARY KEY,
        source              TEXT NOT NULL,
        source_external_id  TEXT NOT NULL,
        platform            TEXT NOT NULL,
        content_json        TEXT NOT NULL,
        source_revision     TEXT NOT NULL,
        state               TEXT NOT NULL,
        scheduled_for       TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE (source, source_external_id, platform),
        FOREIGN KEY (source, source_external_id) REFERENCES social_source_posts(source, external_id)
      );

      CREATE TABLE IF NOT EXISTS social_publications (
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
    `);
  },
};
