import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, initTestDb } from '../connection.js';
import { migrations, runMigrations } from './index.js';
import { migration023 } from './023-social-group-isolation.js';

afterEach(() => closeDb());

describe('social group isolation migration', () => {
  it('retains pre-existing social records under the legacy scope', () => {
    const db = initTestDb();
    runMigrations(
      db,
      migrations.filter((migration) => migration.name !== migration023.name),
    );
    db.prepare(
      `INSERT INTO social_source_posts (
        source, external_id, author, published_at, content_json, revision, imported_at
      ) VALUES ('linkedin', 'source-1', 'author-1', '2026-08-17T00:00:00.000Z', '{}', 'revision-1', '2026-08-17T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO social_drafts (
        id, source, source_external_id, platform, content_json, source_revision, state, created_at, updated_at
      ) VALUES ('draft-1', 'linkedin', 'source-1', 'x', '{}', 'revision-1', 'published', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO social_publications (draft_id, platform, idempotency_key, state)
       VALUES ('draft-1', 'x', 'publication-1', 'published')`,
    ).run();

    runMigrations(db, [migration023]);

    expect(db.prepare('SELECT agent_group_id FROM social_source_posts').get()).toEqual({ agent_group_id: 'legacy' });
    expect(db.prepare('SELECT agent_group_id FROM social_drafts').get()).toEqual({ agent_group_id: 'legacy' });
    expect(db.prepare('SELECT draft_id FROM social_publications').get()).toEqual({ draft_id: 'draft-1' });
  });
});
