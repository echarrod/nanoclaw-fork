import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ContainerConfig } from './container-config.js';
import { externalSkillMounts, resolveSelectedSkills } from './external-skills.js';

const testRoot = '/tmp/nanoclaw-external-skills-test';
const projectRoot = path.join(testRoot, 'nanoclaw');
const externalRoot = path.join(testRoot, 'ed-skills');

function config(overrides: Partial<ContainerConfig> = {}): ContainerConfig {
  return {
    mcpServers: {},
    packages: { apt: [], npm: [] },
    additionalMounts: [],
    skills: ['x-publishing'],
    externalSkillRoots: [
      {
        name: 'ed-skills',
        hostPath: externalRoot,
        revision: revision(),
        skills: ['x-publishing'],
      },
    ],
    ...overrides,
  };
}

function revision(): string {
  return execFileSync('git', ['-C', externalRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

beforeEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectRoot, 'container', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(externalRoot, 'x-publishing'), { recursive: true });
  fs.writeFileSync(
    path.join(externalRoot, 'x-publishing', 'SKILL.md'),
    '---\nname: x-publishing\ndescription: test\n---\n',
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: externalRoot });
  execFileSync('git', ['add', '.'], { cwd: externalRoot });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'test'], {
    cwd: externalRoot,
  });
});

afterEach(() => fs.rmSync(testRoot, { recursive: true, force: true }));

describe('external skill roots', () => {
  it('exposes only selected skills from a pinned root', () => {
    const skills = resolveSelectedSkills(config(), projectRoot);
    expect(skills).toEqual([
      {
        name: 'x-publishing',
        hostPath: fs.realpathSync(path.join(externalRoot, 'x-publishing')),
        containerPath: '/app/external-skills/ed-skills/x-publishing',
      },
    ]);
    expect(externalSkillMounts(config())).toEqual([
      { hostPath: fs.realpathSync(externalRoot), containerPath: '/app/external-skills/ed-skills', readonly: true },
    ]);
  });

  it('rejects a checkout that moved after it was pinned', () => {
    const stale = config();
    fs.writeFileSync(path.join(externalRoot, 'changed.txt'), 'changed');
    execFileSync('git', ['add', '.'], { cwd: externalRoot });
    execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'changed'], {
      cwd: externalRoot,
    });

    expect(() => resolveSelectedSkills(stale, projectRoot)).toThrow(/not pinned revision/);
  });

  it('rejects uncommitted edits to a pinned checkout', () => {
    fs.writeFileSync(path.join(externalRoot, 'x-publishing', 'SKILL.md'), 'changed');

    expect(() => resolveSelectedSkills(config(), projectRoot)).toThrow(/uncommitted changes/);
  });

  it('rejects an external source that shadows a bundled skill', () => {
    fs.mkdirSync(path.join(projectRoot, 'container', 'skills', 'x-publishing'));
    fs.writeFileSync(
      path.join(projectRoot, 'container', 'skills', 'x-publishing', 'SKILL.md'),
      '---\nname: x-publishing\ndescription: test\n---\n',
    );

    expect(() => resolveSelectedSkills(config({ skills: 'all' }), projectRoot)).toThrow(
      /may not shadow bundled skills/,
    );
  });
});
