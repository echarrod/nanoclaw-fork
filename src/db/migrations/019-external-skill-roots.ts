import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

/** Stores pinned, read-only external skill roots per agent group. */
export const migration019: Migration = {
  version: 19,
  name: 'external-skill-roots',
  up(db: Database.Database) {
    const columns = db.prepare("PRAGMA table_info('container_configs')").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'external_skill_roots')) {
      db.prepare("ALTER TABLE container_configs ADD COLUMN external_skill_roots TEXT NOT NULL DEFAULT '[]'").run();
    }
  },
};
