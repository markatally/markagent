import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma';
import { SkillProtectionEnforcer } from './protection';
import { SkillSnapshotManager } from './snapshot';
import type { SkillFilter, SkillSnapshot, UnifiedSkill } from './types';

const ROOT_DIR = path.resolve(process.cwd(), 'apps', 'api', 'external-skills');

class ExternalSkillLoader {
  private snapshotManager: SkillSnapshotManager;
  private protectionEnforcer: SkillProtectionEnforcer;
  private sessionSnapshots = new Map<string, string>();

  constructor(
    snapshotManager = new SkillSnapshotManager(),
    protectionEnforcer = new SkillProtectionEnforcer()
  ) {
    this.snapshotManager = snapshotManager;
    this.protectionEnforcer = protectionEnforcer;
  }

  async getSkillSnapshot(sessionId: string): Promise<SkillSnapshot> {
    const existingSnapshotId = this.sessionSnapshots.get(sessionId);
    if (existingSnapshotId) {
      const existing = await this.snapshotManager.getSnapshot(existingSnapshotId);
      if (existing) return existing;
    }

    const snapshot = await this.snapshotManager.createSnapshot();
    this.sessionSnapshots.set(sessionId, snapshot.snapshotId);
    return snapshot;
  }

  async getSkill(canonicalId: string): Promise<UnifiedSkill | null> {
    const record = await prisma.externalSkill.findUnique({ where: { canonicalId } });
    if (!record) return null;
    const filePath = path.join(ROOT_DIR, record.filePath);
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as UnifiedSkill;
  }

  async listSkills(filter?: SkillFilter): Promise<UnifiedSkill[]> {
    const records = await prisma.externalSkill.findMany({
      orderBy: { canonicalId: 'asc' },
    });
    const skills: UnifiedSkill[] = [];

    for (const record of records) {
      const filePath = path.join(ROOT_DIR, record.filePath);
      const raw = await readFile(filePath, 'utf8');
      skills.push(JSON.parse(raw) as UnifiedSkill);
    }

    if (!filter) return skills;
    return skills.filter((skill) => {
      if (filter.category && skill.category !== filter.category) return false;
      if (filter.capabilityLevel && skill.capabilityLevel !== filter.capabilityLevel) return false;
      if (filter.executionScope && skill.executionScope !== filter.executionScope) return false;
      if (filter.status && skill.status !== filter.status) return false;
      return true;
    });
  }

  async getSkillsByCategory(category: string): Promise<UnifiedSkill[]> {
    return this.listSkills({ category });
  }

  async isProtected(canonicalId: string): Promise<boolean> {
    return this.protectionEnforcer.isProtected(canonicalId);
  }
}

let loaderInstance: ExternalSkillLoader | null = null;

export function getExternalSkillLoader(): ExternalSkillLoader {
  if (!loaderInstance) {
    loaderInstance = new ExternalSkillLoader();
  }
  return loaderInstance;
}

export { ExternalSkillLoader };
