import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { ContainerConfig, ExternalSkillRootConfig } from './container-config.js';

export interface ResolvedSkill {
  name: string;
  hostPath: string;
  containerPath: string;
}

const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const revisionPattern = /^[0-9a-f]{7,64}$/;

/**
 * Resolve the explicit skill selection to read-only host/container locations.
 * External roots are intentionally opt-in and pinned: a live agent must never
 * silently receive whatever happens to be at an arbitrary checkout's HEAD.
 */
export function resolveSelectedSkills(config: ContainerConfig, projectRoot = process.cwd()): ResolvedSkill[] {
  const bundledRoot = path.join(projectRoot, 'container', 'skills');
  const bundled = listSkillDirectories(bundledRoot).map((name) => ({
    name,
    hostPath: path.join(bundledRoot, name),
    containerPath: `/app/skills/${name}`,
  }));

  const external = (config.externalSkillRoots ?? []).flatMap((root) => resolveExternalRoot(root));
  const byName = new Map<string, ResolvedSkill>();
  for (const skill of [...bundled, ...external]) {
    if (byName.has(skill.name)) {
      throw new Error(`Duplicate skill name ${skill.name}; external skills may not shadow bundled skills`);
    }
    byName.set(skill.name, skill);
  }

  if (config.skills === 'all') return [...byName.values()];

  return config.skills.map((name) => {
    const skill = byName.get(name);
    if (!skill) throw new Error(`Selected skill ${name} is not available from a configured skill source`);
    return skill;
  });
}

/** Return mounts for each verified external root, once per root. */
export function externalSkillMounts(
  config: ContainerConfig,
): Array<{ hostPath: string; containerPath: string; readonly: true }> {
  return (config.externalSkillRoots ?? []).map((root) => {
    const rootPath = verifyExternalRoot(root);
    return { hostPath: rootPath, containerPath: `/app/external-skills/${root.name}`, readonly: true };
  });
}

function resolveExternalRoot(root: ExternalSkillRootConfig): ResolvedSkill[] {
  const rootPath = verifyExternalRoot(root);
  return root.skills.map((name) => {
    if (!skillNamePattern.test(name)) throw new Error(`Invalid external skill name ${name}`);
    const skillPath = path.join(rootPath, name);
    const realSkillPath = realDirectory(skillPath, `External skill ${name}`);
    if (!isWithin(rootPath, realSkillPath)) {
      throw new Error(`External skill ${name} resolves outside its configured root`);
    }
    if (!fs.existsSync(path.join(realSkillPath, 'SKILL.md'))) {
      throw new Error(`External skill ${name} is missing SKILL.md`);
    }
    return {
      name,
      hostPath: realSkillPath,
      containerPath: `/app/external-skills/${root.name}/${name}`,
    };
  });
}

function verifyExternalRoot(root: ExternalSkillRootConfig): string {
  if (!skillNamePattern.test(root.name)) throw new Error(`Invalid external skill root name ${root.name}`);
  if (!path.isAbsolute(root.hostPath))
    throw new Error(`External skill root ${root.name} must use an absolute host path`);
  if (!revisionPattern.test(root.revision))
    throw new Error(`External skill root ${root.name} must pin a Git commit SHA`);

  const rootPath = realDirectory(root.hostPath, `External skill root ${root.name}`);
  const actualRevision = execFileSync('git', ['-C', rootPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actualRevision !== root.revision && !actualRevision.startsWith(root.revision)) {
    throw new Error(`External skill root ${root.name} is at ${actualRevision}, not pinned revision ${root.revision}`);
  }
  const worktreeStatus = execFileSync('git', ['-C', rootPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (worktreeStatus) {
    throw new Error(`External skill root ${root.name} has uncommitted changes and cannot be used as a pinned source`);
  }
  return rootPath;
}

function listSkillDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => {
    try {
      return fs.statSync(path.join(root, name)).isDirectory() && fs.existsSync(path.join(root, name, 'SKILL.md'));
    } catch {
      return false;
    }
  });
}

function realDirectory(value: string, label: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync(value);
  } catch (error) {
    throw new Error(`${label} does not exist: ${(error as Error).message}`, { cause: error });
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${label} is not a directory`);
  return resolved;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
