#!/usr/bin/env bun
/**
 * Script to delete a user by email
 * Usage: bun run scripts/reset-user.ts <email>
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetUser(email: string) {
  try {
    console.log(`Deleting user with email: ${email}`);
    
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log('User not found');
      return;
    }

    console.log('User found:', {
      id: user.id,
      email: user.email,
      hasPasswordHash: !!user.passwordHash,
      passwordHashType: typeof user.passwordHash,
    });

    // Delete sessions first
    const sessions = await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(`Deleted ${sessions.count} sessions`);

    // Delete other related data
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.feedback.deleteMany({ where: { userId: user.id } });
    await prisma.oAuthAccount.deleteMany({ where: { userId: user.id } });

    // Delete the user
    await prisma.user.delete({
      where: { email },
    });

    console.log('✓ User deleted successfully. You can now register again.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];

if (!email) {
  console.error('Usage: bun run scripts/reset-user.ts <email>');
  process.exit(1);
}

resetUser(email);
