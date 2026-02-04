import { execSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma';
import { deduplicateSkills } from './deduplicator';
import { normalizeSkillDescriptor } from './normalizer';
import { SkillProtectionEnforcer } from './protection';
import type { SkillSourceInfo, UnifiedSkill } from './types';

const REPOS = [
  {
    name: 'anthropics',
    url: 'https://github.com/anthropics/skills.git',
  },
  {
    name: 'agentskills',
    url: 'https://github.com/agentskills/agentskills',
  },
  {
    name: 'openai',
    url: 'https://github.com/openai/skills',
  },
  {
    name: 'marketingskills',
    url: 'https://github.com/coreyhaines31/marketingskills',
  },
];

const ROOT_DIR = path.resolve(process.cwd(), 'apps', 'api', 'external-skills');
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const SOURCES_DIR = path.join(ROOT_DIR, 'sources');
const CANONICAL_DIR = path.join(ROOT_DIR, 'canonical');
const MAPPINGS_FILE = path.join(ROOT_DIR, 'mappings', 'source_to_canonical.json');

export interface SyncPlan {
  newSkills: UnifiedSkill[];
  mergedCandidates: Array<{
    canonical: UnifiedSkill;
    merged: UnifiedSkill[];
    similarityScore: number;
  }>;
  protectedSkills: UnifiedSkill[];
  extendedVariants: Array<{ baseId: string; extendedId: string }>;
}

export async function planSync(): Promise<SyncPlan> {
  const skills = await collectSkills();
  const { canonicalSkills, candidates } = deduplicateSkills(skills);
  const protection = new SkillProtectionEnforcer();

  const protectedSkills: UnifiedSkill[] = [];
  const extendedVariants: Array<{ baseId: string; extendedId: string }> = [];

  for (const skill of canonicalSkills) {
    if (await protection.isProtected(skill.canonicalId, skill.name)) {
      protectedSkills.push(skill);
      extendedVariants.push({
        baseId: skill.canonicalId,
        extendedId: protection.createExtendedVariant(skill.canonicalId, skill),
      });
    }
  }

  return {
    newSkills: canonicalSkills,
    mergedCandidates: candidates,
    protectedSkills,
    extendedVariants,
  };
}

export async function runSync(): Promise<void> {
  const skills = await collectSkills();
  const { canonicalSkills, candidates } = deduplicateSkills(skills);
  const protection = new SkillProtectionEnforcer();
  const mappings: Record<string, string> = {};

  await mkdir(SOURCES_DIR, { recursive: true });
  await mkdir(CANONICAL_DIR, { recursive: true });
  await mkdir(path.dirname(MAPPINGS_FILE), { recursive: true });

  for (const skill of skills) {
    await writeSourceSkill(skill);
  }

  for (const skill of canonicalSkills) {
    const isProtected = await protection.isProtected(skill.canonicalId, skill.name);
    const protectionReason = await protection.getProtectionReason(skill.canonicalId, skill.name);
    const canonicalId = isProtected
      ? protection.createExtendedVariant(skill.canonicalId, skill)
      : skill.canonicalId;
    if (isProtected) {
      skill.isProtected = true;
      skill.protectionReason = protectionReason;
    }

    const canonicalSkill = { ...skill, canonicalId };
    await writeCanonicalSkill(canonicalSkill);

    if (skill.source) {
      const sourceKey = `${skill.source.repoUrl}:${skill.source.repoPath}`;
      mappings[sourceKey] = canonicalId;
    }

    await prisma.externalSkill.upsert({
      where: { canonicalId },
      update: {
        name: canonicalSkill.name,
        description: canonicalSkill.description,
        version: canonicalSkill.version,
        runtimeVersion: canonicalSkill.runtimeVersion ?? canonicalSkill.version,
        category: canonicalSkill.category,
        inputSchema: canonicalSkill.inputSchema ?? undefined,
        outputSchema: canonicalSkill.outputSchema ?? undefined,
        invocationPattern: canonicalSkill.invocationPattern,
        dependencies: canonicalSkill.dependencies,
        filePath: path.relative(ROOT_DIR, canonicalPath(canonicalSkill.canonicalId)),
        capabilityLevel: canonicalSkill.capabilityLevel,
        executionScope: canonicalSkill.executionScope,
        isProtected: canonicalSkill.isProtected,
        protectionReason: canonicalSkill.protectionReason,
        mergedFrom: candidates
          .filter((candidate) => candidate.canonical.canonicalId === skill.canonicalId)
          .flatMap((candidate) => candidate.merged.map((merged) => merged.canonicalId)),
      },
      create: {
        canonicalId,
        name: canonicalSkill.name,
        description: canonicalSkill.description,
        version: canonicalSkill.version,
        runtimeVersion: canonicalSkill.runtimeVersion ?? canonicalSkill.version,
        category: canonicalSkill.category,
        inputSchema: canonicalSkill.inputSchema ?? undefined,
        outputSchema: canonicalSkill.outputSchema ?? undefined,
        invocationPattern: canonicalSkill.invocationPattern,
        dependencies: canonicalSkill.dependencies,
        filePath: path.relative(ROOT_DIR, canonicalPath(canonicalSkill.canonicalId)),
        capabilityLevel: canonicalSkill.capabilityLevel,
        executionScope: canonicalSkill.executionScope,
        isProtected: canonicalSkill.isProtected,
        protectionReason: canonicalSkill.protectionReason,
        mergedFrom: candidates
          .filter((candidate) => candidate.canonical.canonicalId === skill.canonicalId)
          .flatMap((candidate) => candidate.merged.map((merged) => merged.canonicalId)),
      },
    });
  }

  await writeFile(MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
}

async function collectSkills(): Promise<UnifiedSkill[]> {
  const collected: UnifiedSkill[] = [];

  for (const repo of REPOS) {
    const repoDir = await fetchRepo(repo.name, repo.url);
    const files = await findSkillFiles(repoDir);
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8');
      const source: SkillSourceInfo = {
        repoUrl: repo.url,
        repoPath: path.relative(repoDir, filePath),
        syncedAt: new Date(),
      };
      const skill = normalizeSkillDescriptor({
        filePath,
        content,
        source,
      });
      collected.push(skill);
    }
  }

  return collected;
}

async function fetchRepo(name: string, url: string): Promise<string> {
  const targetDir = path.join(CACHE_DIR, name);
  await mkdir(CACHE_DIR, { recursive: true });
  try {
    execSync(`git -C "${targetDir}" pull --ff-only`, { stdio: 'ignore' });
  } catch {
    execSync(`git clone "${url}" "${targetDir}"`, { stdio: 'ignore' });
  }
  return targetDir;
}

async function findSkillFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(fullPath)));
    } else if (entry.isFile() && isSkillFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isSkillFile(fileName: string): boolean {
  return (
    fileName.endsWith('.md') ||
    fileName.endsWith('.json') ||
    fileName.endsWith('.ts') ||
    fileName.endsWith('.js')
  );
}

async function writeSourceSkill(skill: UnifiedSkill): Promise<void> {
  const sourceDir = path.join(SOURCES_DIR, repoDirName(skill.source.repoUrl));
  await mkdir(sourceDir, { recursive: true });
  const target = path.join(sourceDir, `${skill.canonicalId}.json`);
  await writeFile(target, JSON.stringify(skill, null, 2));
}

async function writeCanonicalSkill(skill: UnifiedSkill): Promise<void> {
  const dir = path.join(CANONICAL_DIR, skill.canonicalId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, 'skill.json');
  await writeFile(target, JSON.stringify(skill, null, 2));
}

function canonicalPath(canonicalId: string): string {
  return path.join(CANONICAL_DIR, canonicalId, 'skill.json');
}

function repoDirName(repoUrl: string): string {
  return path.basename(repoUrl).replace(/\.git$/, '');
}
