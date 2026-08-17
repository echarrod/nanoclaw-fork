import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseMasterKeyCommand, writeMasterKeyConfig } from './social-master-key-cli.js';

describe('social master key CLI', () => {
  it('accepts a specific user service name', () => {
    expect(parseMasterKeyCommand(['--systemd-unit', 'nanoclaw-v2-123.service'])).toEqual({
      systemdUnit: 'nanoclaw-v2-123.service',
    });
  });

  it('rejects unsafe unit names', () => {
    expect(() => parseMasterKeyCommand(['--systemd-unit', '../unsafe'])).toThrow('user service name');
  });

  it('writes a private EnvironmentFile and systemd drop-in', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'nanoclaw-social-key-'));
    const key = Buffer.alloc(32, 3).toString('base64');
    const files = await writeMasterKeyConfig({
      homeDir,
      systemdUnit: 'nanoclaw-v2-123.service',
      value: key,
    });

    await expect(readFile(files.credentialsFile, 'utf8')).resolves.toBe(`SOCIAL_CREDENTIALS_KEY=${key}\n`);
    await expect(readFile(files.dropInFile, 'utf8')).resolves.toBe(
      `[Service]\nEnvironmentFile=${files.credentialsFile}\n`,
    );
    await expect(
      writeMasterKeyConfig({ homeDir, systemdUnit: 'nanoclaw-v2-123.service', value: key }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
