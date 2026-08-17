import path from 'path';
import { pathToFileURL } from 'url';

import { DATA_DIR } from './config.js';
import { closeDb, getDb, initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import { beginSocialOAuth } from './modules/social/oauth.js';

type OAuthProvider = 'linkedin' | 'x';

interface OAuthCommand {
  groupId: string;
  provider: OAuthProvider;
}

const PROVIDERS = new Set<OAuthProvider>(['linkedin', 'x']);

export function parseOAuthCommand(argv: string[]): OAuthCommand {
  if (argv.length !== 4 || argv[0] !== '--group' || argv[2] !== '--provider') {
    throw new Error('Usage: pnpm social:oauth -- --group <id> --provider <linkedin|x>');
  }
  const [groupId, provider] = [argv[1], argv[3]];
  if (!groupId || !provider || !PROVIDERS.has(provider as OAuthProvider)) {
    throw new Error('Usage: pnpm social:oauth -- --group <id> --provider <linkedin|x>');
  }
  return { groupId, provider: provider as OAuthProvider };
}

export function runOAuthCommand(argv: string[]): void {
  const command = parseOAuthCommand(argv);
  initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(getDb());

  const groupExists = getDb().prepare('SELECT 1 FROM agent_groups WHERE id = ? LIMIT 1').get(command.groupId);
  if (!groupExists) throw new Error(`Agent group not found: ${command.groupId}`);

  process.stdout.write(`${beginSocialOAuth({ agentGroupId: command.groupId, provider: command.provider })}\n`);
  closeDb();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runOAuthCommand(process.argv.slice(2));
  } catch (error) {
    closeDb();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
