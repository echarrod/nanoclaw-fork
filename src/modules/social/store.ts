import { createHash, randomUUID } from 'crypto';

import { getDb } from '../../db/connection.js';
import type { DraftState, PlatformDraft, PublicationResult, SourcePost } from './types.js';

export function sourceRevision(source: SourcePost): string {
  return createHash('sha256')
    .update(JSON.stringify({ text: source.text, assets: source.assets, updatedAt: source.updatedAt ?? null }))
    .digest('hex');
}

/** Upsert source material and return its content revision. */
export function saveSourcePost(agentGroupId: string, source: SourcePost): string {
  const revision = sourceRevision(source);
  getDb()
    .prepare(
      `INSERT INTO social_source_posts (
        agent_group_id, source, external_id, author, published_at, updated_at, source_url, content_json, revision, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_group_id, source, external_id) DO UPDATE SET
        author = excluded.author,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at,
        source_url = excluded.source_url,
        content_json = excluded.content_json,
        revision = excluded.revision,
        imported_at = excluded.imported_at`,
    )
    .run(
      agentGroupId,
      source.source,
      source.externalId,
      source.author,
      source.publishedAt,
      source.updatedAt ?? null,
      source.sourceUrl ?? null,
      JSON.stringify(source),
      revision,
      new Date().toISOString(),
    );
  return revision;
}

/** Replace only unpublished drafts when their selected source changes. */
export function saveDraft(agentGroupId: string, draft: Omit<PlatformDraft, 'id'> & { id?: string }): PlatformDraft {
  const existing = getDb()
    .prepare(
      'SELECT id, state FROM social_drafts WHERE agent_group_id = ? AND source = ? AND source_external_id = ? AND platform = ?',
    )
    .get(agentGroupId, 'linkedin', draft.sourceExternalId, draft.platform) as
    | { id: string; state: DraftState }
    | undefined;
  const id = existing?.id ?? draft.id ?? randomUUID();
  if (existing && !['awaiting_review', 'scheduled'].includes(existing.state)) {
    throw new Error(`Cannot replace a ${existing.state} draft`);
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO social_drafts (
        id, agent_group_id, source, source_external_id, platform, content_json, source_revision, state, scheduled_for, created_at, updated_at
      ) VALUES (?, ?, 'linkedin', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_group_id, source, source_external_id, platform) DO UPDATE SET
        content_json = excluded.content_json,
        source_revision = excluded.source_revision,
        state = excluded.state,
        scheduled_for = excluded.scheduled_for,
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      agentGroupId,
      draft.sourceExternalId,
      draft.platform,
      JSON.stringify({ ...draft, id }),
      draft.sourceRevision,
      draft.state,
      draft.scheduledFor ?? null,
      now,
      now,
    );
  return { ...draft, id };
}

export function scheduleDraft(agentGroupId: string, id: string, scheduledFor: string): void {
  const result = getDb()
    .prepare(
      "UPDATE social_drafts SET state = 'scheduled', scheduled_for = ?, updated_at = ? WHERE id = ? AND agent_group_id = ? AND state = 'awaiting_review'",
    )
    .run(scheduledFor, new Date().toISOString(), id, agentGroupId);
  if (result.changes !== 1) throw new Error('Only an awaiting-review draft can be scheduled');
}

export function beginPublication(agentGroupId: string, id: string, platform: PlatformDraft['platform']): string {
  const idempotencyKey = randomUUID();
  const db = getDb();
  db.transaction(() => {
    const draft = db
      .prepare('SELECT platform, state FROM social_drafts WHERE id = ? AND agent_group_id = ?')
      .get(id, agentGroupId) as { platform: PlatformDraft['platform']; state: DraftState } | undefined;
    if (!draft) throw new Error('Draft not found');
    if (draft.platform !== platform) throw new Error('Publication platform does not match the draft');
    if (draft.state !== 'scheduled') throw new Error('Only a scheduled draft can be published');

    const publication = db
      .prepare(
        `INSERT INTO social_publications (draft_id, platform, idempotency_key, state, attempted_at)
         VALUES (?, ?, ?, 'publishing', ?)
         ON CONFLICT(draft_id, platform) DO NOTHING`,
      )
      .run(id, platform, idempotencyKey, new Date().toISOString());
    if (publication.changes !== 1) throw new Error('A publication already exists for this draft and platform');
    const transition = db
      .prepare(
        "UPDATE social_drafts SET state = 'publishing', updated_at = ? WHERE id = ? AND agent_group_id = ? AND state = 'scheduled'",
      )
      .run(new Date().toISOString(), id, agentGroupId);
    if (transition.changes !== 1) throw new Error('Draft state changed while publication was starting');
  })();
  return idempotencyKey;
}

export function completePublication(agentGroupId: string, id: string, result: PublicationResult): void {
  const db = getDb();
  db.transaction(() => {
    const publication = db
      .prepare(
        `UPDATE social_publications SET state = 'published', external_id = ?, url = ?, error = NULL
         WHERE draft_id = ? AND platform = ? AND state = 'publishing'
           AND EXISTS (SELECT 1 FROM social_drafts WHERE id = social_publications.draft_id AND agent_group_id = ?)`,
      )
      .run(result.externalId, result.url ?? null, id, result.platform, agentGroupId);
    if (publication.changes !== 1) throw new Error('No in-progress publication exists for this result');
    const draft = db
      .prepare(
        "UPDATE social_drafts SET state = 'published', updated_at = ? WHERE id = ? AND agent_group_id = ? AND state = 'publishing'",
      )
      .run(new Date().toISOString(), id, agentGroupId);
    if (draft.changes !== 1) throw new Error('Draft state changed while publication was completing');
  })();
}

export function failPublication(
  agentGroupId: string,
  id: string,
  platform: PlatformDraft['platform'],
  error: string,
): void {
  const db = getDb();
  db.transaction(() => {
    const publication = db
      .prepare(
        `UPDATE social_publications SET state = 'failed', error = ?
         WHERE draft_id = ? AND platform = ? AND state = 'publishing'
           AND EXISTS (SELECT 1 FROM social_drafts WHERE id = social_publications.draft_id AND agent_group_id = ?)`,
      )
      .run(error, id, platform, agentGroupId);
    if (publication.changes !== 1) throw new Error('No in-progress publication exists to fail');
    const draft = db
      .prepare(
        "UPDATE social_drafts SET state = 'failed', updated_at = ? WHERE id = ? AND agent_group_id = ? AND state = 'publishing'",
      )
      .run(new Date().toISOString(), id, agentGroupId);
    if (draft.changes !== 1) throw new Error('Draft state changed while publication was failing');
  })();
}
