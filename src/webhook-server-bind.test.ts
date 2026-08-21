/**
 * Guard for the bind target of src/webhook-server.ts.
 *
 * The default must stay `0.0.0.0` — deployments that already reach the webhook
 * server from another host or a container bridge break silently if it ever
 * flips to loopback. `WEBHOOK_HOST` is what a single-box deployment (tunnel or
 * reverse proxy on the same machine) sets to `127.0.0.1`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBindTarget } from './webhook-server.js';

vi.mock('./env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));

const { readEnvFile } = await import('./env.js');
const mockedReadEnvFile = vi.mocked(readEnvFile);

const saved = { host: process.env.WEBHOOK_HOST, port: process.env.WEBHOOK_PORT };

beforeEach(() => {
  delete process.env.WEBHOOK_HOST;
  delete process.env.WEBHOOK_PORT;
  mockedReadEnvFile.mockReturnValue({});
});

afterEach(() => {
  if (saved.host === undefined) delete process.env.WEBHOOK_HOST;
  else process.env.WEBHOOK_HOST = saved.host;
  if (saved.port === undefined) delete process.env.WEBHOOK_PORT;
  else process.env.WEBHOOK_PORT = saved.port;
});

describe('resolveBindTarget', () => {
  it('defaults to every interface on port 3000', () => {
    expect(resolveBindTarget()).toEqual({ host: '0.0.0.0', port: 3000 });
  });

  it('honours WEBHOOK_HOST from the process environment', () => {
    process.env.WEBHOOK_HOST = '127.0.0.1';
    expect(resolveBindTarget().host).toBe('127.0.0.1');
  });

  it('falls back to .env when the process environment is unset', () => {
    mockedReadEnvFile.mockReturnValue({ WEBHOOK_HOST: '127.0.0.1', WEBHOOK_PORT: '3100' });
    expect(resolveBindTarget()).toEqual({ host: '127.0.0.1', port: 3100 });
  });

  it('lets the process environment override .env', () => {
    mockedReadEnvFile.mockReturnValue({ WEBHOOK_HOST: '127.0.0.1', WEBHOOK_PORT: '3100' });
    process.env.WEBHOOK_HOST = '0.0.0.0';
    process.env.WEBHOOK_PORT = '4000';
    expect(resolveBindTarget()).toEqual({ host: '0.0.0.0', port: 4000 });
  });

  it('ignores an unparseable port rather than binding a random one', () => {
    process.env.WEBHOOK_PORT = 'not-a-port';
    expect(resolveBindTarget().port).toBe(3000);
  });
});
