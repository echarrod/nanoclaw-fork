import { describe, expect, it } from 'vitest';

import { parseCredentialCommand } from './social-credential-cli.js';

describe('social credential CLI', () => {
  it('accepts a non-secret credential destination', () => {
    expect(parseCredentialCommand(['--group', 'group-1', '--provider', 'bluesky', '--kind', 'app-password'])).toEqual({
      groupId: 'group-1',
      provider: 'bluesky',
      credentialKind: 'app-password',
    });
  });

  it('rejects incomplete commands and unsafe credential kinds', () => {
    expect(() => parseCredentialCommand(['--provider', 'bluesky'])).toThrow('Usage:');
    expect(() =>
      parseCredentialCommand(['--group', 'group-1', '--provider', 'bluesky', '--kind', 'app password']),
    ).toThrow('lowercase letters');
  });
});
