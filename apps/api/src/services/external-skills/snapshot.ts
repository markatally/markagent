import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma';
import type { ResolvedSkill, SkillFilter, SkillSnapshot, UnifiedSkill } from './types';

const ROOT_DIR = path.resolve(process.cwd(), 'apps', 'api', 'external-skills');

export class SkillSnapshotManager {
  private snapshots = new Map<string, SkillSnapshot>();

  async createSnapshot(): Promise<SkillSnapshot> {
    const snapshotId = crypto.randomUUID();
    const skills = await this.loadSkills(snapshotId);
    const snapshot: SkillSnapshot = {
      snapshotId,
      createdAt: new Date(),
      skills,
      getSkill: (canonicalId: string) => skills.get(canonicalId),
      listSkills: (filter?: SkillFilter) => filterSkills(skills, filter),
      isProtected: (canonicalId: string) => skills.get(canonicalId)?.isProtected ?? false,
    };
    this.snapshots.set(snapshotId, snapshot);
    return snapshot;
  }

  async getSnapshot(snapshotId: string): Promise<SkillSnapshot | null> {
    return this.snapshots.get(snapshotId) ?? null;
  }

  async resolveSkill(snapshotId: string, canonicalId: string): Promise<ResolvedSkill | null> {
    const snapshot = await this.getSnapshot(snapshotId);
    return snapshot?.getSkill(canonicalId) ?? null;
  }

  private async loadSkills(snapshotId: string): Promise<Map<string, ResolvedSkill>> {
    const records = await prisma.externalSkill.findMany({
      orderBy: { canonicalId: 'asc' },
    });
    const result = new Map<string, ResolvedSkill>();

    for (const record of records) {
      const filePath = path.join(ROOT_DIR, record.filePath);
      const raw = await readFile(filePath, 'utf8');
      const skill = JSON.parse(raw) as UnifiedSkill;
      result.set(record.canonicalId, {
        ...skill,
        resolvedAt: new Date(),
        snapshotId,
      });
    }

    return result;
  }
}

function filterSkills(
  skills: Map<string, ResolvedSkill>,
  filter?: SkillFilter
): ResolvedSkill[] {
  if (!filter) return Array.from(skills.values());

  return Array.from(skills.values()).filter((skill) => {
    if (filter.category && skill.category !== filter.category) return false;
    if (filter.capabilityLevel && skill.capabilityLevel !== filter.capabilityLevel) return false;
    if (filter.executionScope && skill.executionScope !== filter.executionScope) return false;
    if (filter.status && skill.status !== filter.status) return false;
    return true;
  });
}
