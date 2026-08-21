import { describe, expect, it } from 'vitest';

import { parseOAuthCommand } from './social-oauth-cli.js';

describe('social OAuth CLI', () => {
  it('accepts a non-secret OAuth destination', () => {
    expect(parseOAuthCommand(['--group', 'group-1', '--provider', 'x'])).toEqual({
      groupId: 'group-1',
      provider: 'x',
    });
  });

  it('rejects incomplete commands and unsupported providers', () => {
    expect(() => parseOAuthCommand(['--provider', 'x'])).toThrow('Usage:');
    expect(() => parseOAuthCommand(['--group', 'group-1', '--provider', 'bluesky'])).toThrow('Usage:');
  });
});
