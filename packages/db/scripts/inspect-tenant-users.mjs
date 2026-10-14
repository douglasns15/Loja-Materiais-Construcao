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
    // Membros = vínculos com a loja (ADR-014), não `users`.
    select: {
      id: true,
      name: true,
      memberships: { select: { role: true, status: true, isActive: true, user: { select: { email: true } } } },
    },
  });
  if (!tenant) {
    console.log(`Loja "${slug}" não encontrada.`);
  } else {
    console.log(`\n=== ${tenant.name} (${slug}) ===`);
    for (const m of tenant.memberships)
      console.log(`  ${m.role.padEnd(8)} ${m.user.email}  ativo=${m.isActive}  ${m.status === 'PENDING' ? '(convite pendente)' : ''}`);
    console.log(`  OWNERs: ${tenant.memberships.filter((m) => m.role === 'OWNER').length}`);
  }
} finally {
  await prisma.$disconnect();
}
