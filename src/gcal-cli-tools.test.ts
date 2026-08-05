import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard for the Google Calendar MCP CLI dependency integration point.
// @cocal/google-calendar-mcp is installed from the container cli-tools.json
// manifest, not imported or typed from this tree, so the build leg can't catch
// its removal. This test goes red if the entry is dropped, unpinned, or the
// manifest is no longer wired into the Dockerfile build.
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'container', 'cli-tools.json'), 'utf8')) as Array<{
  name: string;
  version: string;
}>;
const dockerfile = readFileSync(join(here, '..', 'container', 'Dockerfile'), 'utf8');

describe('Google Calendar MCP CLI is wired into the container image', () => {
  it('pins @cocal/google-calendar-mcp in cli-tools.json', () => {
    const entry = manifest.find((t) => t.name === '@cocal/google-calendar-mcp');
    expect(entry, '@cocal/google-calendar-mcp must be listed in cli-tools.json').toBeDefined();
    expect(entry!.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    expect(entry!.version).toBe('2.6.1');
  });

  it('wires the manifest into the Dockerfile build', () => {
    expect(dockerfile).toMatch(/COPY cli-tools\.json install-cli-tools\.sh/);
    expect(dockerfile).toMatch(/install-cli-tools\.sh \/tmp\/cli-tools\.json/);
  });
});
