// SOMENTE-LEITURA: lista usuários de uma loja pelo slug.
// Uso: node packages/db/scripts/inspect-tenant-users.mjs <slug>
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const slug = process.argv[2];
const prisma = new PrismaClient();
try {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, users: { select: { email: true, role: true, isActive: true } } },
  });
  if (!tenant) {
    console.log(`Loja "${slug}" não encontrada.`);
  } else {
    console.log(`\n=== ${tenant.name} (${slug}) ===`);
    for (const u of tenant.users) console.log(`  ${u.role.padEnd(8)} ${u.email}  ativo=${u.isActive}`);
    console.log(`  OWNERs: ${tenant.users.filter((u) => u.role === 'OWNER').length}`);
  }
} finally {
  await prisma.$disconnect();
}
