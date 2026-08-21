import { chmod, mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import { validateSocialCredentialsKey } from './modules/social/credentials.js';

interface MasterKeyCommand {
  systemdUnit: string;
}

const USAGE = 'Usage: pnpm social:master-key -- --systemd-unit <user-service>.service';

export function parseMasterKeyCommand(argv: string[]): MasterKeyCommand {
  if (argv.length !== 2 || argv[0] !== '--systemd-unit') throw new Error(USAGE);
  const systemdUnit = argv[1];
  if (!/^[a-zA-Z0-9@_.-]+\.service$/.test(systemdUnit)) {
    throw new Error('--systemd-unit must be a user service name ending in .service');
  }
  return { systemdUnit };
}

async function promptForMasterKey(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('A local TTY is required to enter the social credential key securely');
  }

  process.stdout.write('SOCIAL_CREDENTIALS_KEY (input hidden): ');
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
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
          reject(new Error('Social credential key entry cancelled'));
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

export async function writeMasterKeyConfig(input: {
  homeDir: string;
  systemdUnit: string;
  value: string;
}): Promise<{ credentialsFile: string; dropInFile: string }> {
  validateSocialCredentialsKey(input.value);

  const configDir = path.join(input.homeDir, '.config', 'nanoclaw');
  const credentialsFile = path.join(configDir, 'social-credentials.env');
  const dropInDir = path.join(input.homeDir, '.config', 'systemd', 'user', `${input.systemdUnit}.d`);
  const dropInFile = path.join(dropInDir, '30-social-credentials.conf');

  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);
  await writeFile(credentialsFile, `SOCIAL_CREDENTIALS_KEY=${input.value}\n`, { flag: 'wx', mode: 0o600 });
  await chmod(credentialsFile, 0o600);
  await mkdir(dropInDir, { recursive: true, mode: 0o700 });
  await chmod(dropInDir, 0o700);
  await writeFile(dropInFile, `[Service]\nEnvironmentFile=${credentialsFile}\n`, { mode: 0o600 });
  await chmod(dropInFile, 0o600);

  return { credentialsFile, dropInFile };
}

export async function runMasterKeyCommand(argv: string[]): Promise<void> {
  const command = parseMasterKeyCommand(argv);
  const value = await promptForMasterKey();
  await writeMasterKeyConfig({ homeDir: homedir(), systemdUnit: command.systemdUnit, value });
  process.stdout.write(
    'Social credential key configured. Run systemctl --user daemon-reload and restart the service.\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMasterKeyCommand(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
