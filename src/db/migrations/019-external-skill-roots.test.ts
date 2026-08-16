import { describe, expect, it } from 'vitest';

import { closeDb, initTestDb } from '../connection.js';
import { runMigrations } from './index.js';

describe('migration 019 - external skill roots', () => {
  it('adds an empty external skill roots configuration to container configs', () => {
    const db = initTestDb();
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info('container_configs')").all() as Array<{
      name: string;
      dflt_value: string;
    }>;
    const column = columns.find((entry) => entry.name === 'external_skill_roots');
    expect(column?.dflt_value).toBe("'[]'");
    closeDb();
  });
});
