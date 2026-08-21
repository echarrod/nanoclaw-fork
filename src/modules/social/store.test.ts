import { afterEach, describe, expect, it } from 'vitest';

import { closeDb, getDb, initTestDb } from '../../db/connection.js';
import { runMigrations } from '../../db/migrations/index.js';
import {
  beginPublication,
  completePublication,
  saveDraft,
  saveSourcePost,
  scheduleDraft,
  sourceRevision,
} from './store.js';
import type { SourcePost } from './types.js';

const source: SourcePost = {
  source: 'linkedin',
  externalId: 'urn:li:share:1',
  author: 'urn:li:person:ed',
  publishedAt: '2026-08-16T10:00:00.000Z',
  text: 'A source post',
  assets: [],
};
const GROUP_ID = 'personal-social';

afterEach(() => closeDb());

describe('social publication audit store', () => {
  it('records a source, a reviewable draft, and its idempotent publication result', () => {
    const db = initTestDb();
    runMigrations(db);
    const revision = saveSourcePost(GROUP_ID, source);
    expect(revision).toBe(sourceRevision(source));

    const draft = saveDraft(GROUP_ID, {
      sourceExternalId: source.externalId,
      platform: 'x',
      text: 'A platform-native update',
      hashtags: [],
      assets: [],
      state: 'awaiting_review',
      sourceRevision: revision,
    });
    expect(() => beginPublication(GROUP_ID, draft.id, 'x')).toThrow('Only a scheduled draft can be published');
    scheduleDraft(GROUP_ID, draft.id, '2026-08-17T10:00:00.000Z');
    const idempotencyKey = beginPublication(GROUP_ID, draft.id, 'x');
    completePublication(GROUP_ID, draft.id, { platform: 'x', externalId: '123', url: 'https://x.com/ed/status/123' });

    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDb().prepare('SELECT state FROM social_drafts WHERE id = ?').get(draft.id)).toEqual({
      state: 'published',
    });
    expect(
      getDb().prepare('SELECT state, external_id FROM social_publications WHERE draft_id = ?').get(draft.id),
    ).toEqual({ state: 'published', external_id: '123' });
  });

  it('does not let another agent group schedule a personal draft', () => {
    const db = initTestDb();
    runMigrations(db);
    const revision = saveSourcePost(GROUP_ID, source);
    const draft = saveDraft(GROUP_ID, {
      sourceExternalId: source.externalId,
      platform: 'bluesky',
      text: 'A platform-native update',
      hashtags: [],
      assets: [],
      state: 'awaiting_review',
      sourceRevision: revision,
    });

    expect(() => scheduleDraft('company-social', draft.id, '2026-08-17T10:00:00.000Z')).toThrow(
      'Only an awaiting-review draft can be scheduled',
    );
  });
});
