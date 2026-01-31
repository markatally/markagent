import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const files = await prisma.file.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
  console.log('Files in database:');
  console.log(JSON.stringify(files, null, 2));

  const sessions = await prisma.session.findMany({ take: 3 });
  console.log('\nSessions in database:');
  console.log(JSON.stringify(sessions.map(s => ({ id: s.id, userId: s.userId })), null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
