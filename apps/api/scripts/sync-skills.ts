#!/usr/bin/env bun
/**
 * External skill synchronization CLI
 * Usage:
 *  bun run scripts/sync-skills.ts --plan
 *  bun run scripts/sync-skills.ts --force
 *  bun run scripts/sync-skills.ts --status
 *  bun run scripts/sync-skills.ts --protect=skill-id --reason="custom"
 *  bun run scripts/sync-skills.ts --unprotect=skill-id
 */

import { prisma } from '../src/services/prisma';
import { planSync, runSync } from '../src/services/external-skills/sync';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));

const protectArg = args.find((arg) => arg.startsWith('--protect='));
const unprotectArg = args.find((arg) => arg.startsWith('--unprotect='));
const reasonArg = args.find((arg) => arg.startsWith('--reason='));

async function main() {
  if (flags.has('--status')) {
    const skills = await prisma.externalSkill.findMany({
      orderBy: { canonicalId: 'asc' },
    });
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (protectArg) {
    const id = protectArg.split('=')[1];
    const reason = reasonArg ? reasonArg.split('=')[1] : 'manual protection';
    await prisma.externalSkill.update({
      where: { canonicalId: id },
      data: { isProtected: true, protectionReason: reason },
    });
    console.log(`Protected ${id}`);
    return;
  }

  if (unprotectArg) {
    const id = unprotectArg.split('=')[1];
    await prisma.externalSkill.update({
      where: { canonicalId: id },
      data: { isProtected: false, protectionReason: null },
    });
    console.log(`Unprotected ${id}`);
    return;
  }

  if (flags.has('--plan')) {
    const plan = await planSync();
    console.log(
      JSON.stringify(
        {
          newSkills: plan.newSkills.map((skill) => skill.canonicalId),
          mergedCandidates: plan.mergedCandidates.map((candidate) => ({
            canonical: candidate.canonical.canonicalId,
            merged: candidate.merged.map((skill) => skill.canonicalId),
            similarityScore: candidate.similarityScore,
          })),
          protectedSkills: plan.protectedSkills.map((skill) => skill.canonicalId),
          extendedVariants: plan.extendedVariants,
        },
        null,
        2
      )
    );
    return;
  }

  if (!flags.has('--force')) {
    console.error('Sync requires a preview. Run with --plan first, then --force to apply.');
    process.exit(1);
  }

  await runSync();
  console.log('External skills synchronized.');
}

main()
  .catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
