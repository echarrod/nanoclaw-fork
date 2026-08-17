import path from 'path';
import { pathToFileURL } from 'url';

import { DATA_DIR } from './config.js';
import { closeDb, getDb, initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import { saveSocialCredential, type SocialCredentialProvider } from './modules/social/credentials.js';

interface CredentialCommand {
  groupId: string;
  provider: SocialCredentialProvider;
  credentialKind: string;
}

const PROVIDERS = new Set<SocialCredentialProvider>(['bluesky', 'linkedin', 'x']);

export function parseCredentialCommand(argv: string[]): CredentialCommand {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--group', '--provider', '--kind'].includes(flag) || !value || value.startsWith('--')) {
      throw new Error(
        'Usage: pnpm social:credential -- --group <id> --provider <bluesky|linkedin|x> --kind <credential-kind>',
      );
    }
    values.set(flag, value);
  }

  const groupId = values.get('--group');
  const provider = values.get('--provider');
  const credentialKind = values.get('--kind');
  if (!groupId || !provider || !credentialKind || !PROVIDERS.has(provider as SocialCredentialProvider)) {
    throw new Error(
      'Usage: pnpm social:credential -- --group <id> --provider <bluesky|linkedin|x> --kind <credential-kind>',
    );
  }
  if (!/^[a-z0-9-]{1,64}$/.test(credentialKind)) {
    throw new Error('--kind must use lowercase letters, numbers, and hyphens only');
  }
  return { groupId, provider: provider as SocialCredentialProvider, credentialKind };
}

/** Read a secret from a local TTY without echoing it or putting it in argv. */
async function promptForSecret(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('A local TTY is required to enter a social credential securely');
  }

  process.stdout.write('Credential (input hidden): ');
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Credential entry cancelled'));
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('data', onData);
  });
}

export async function runCredentialCommand(argv: string[]): Promise<void> {
  const command = parseCredentialCommand(argv);
  initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(getDb());

  const groupExists = getDb().prepare('SELECT 1 FROM agent_groups WHERE id = ? LIMIT 1').get(command.groupId);
  if (!groupExists) throw new Error(`Agent group not found: ${command.groupId}`);

  const value = await promptForSecret();
  saveSocialCredential({
    agentGroupId: command.groupId,
    provider: command.provider,
    credentialKind: command.credentialKind,
    value,
  });
  closeDb();
  process.stdout.write(`${command.provider} ${command.credentialKind} configured for the selected agent group.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCredentialCommand(process.argv.slice(2)).catch((error: unknown) => {
    closeDb();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
