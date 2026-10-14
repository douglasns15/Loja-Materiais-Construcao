// SOMENTE-LEITURA: inspeciona usuários por e-mail e o histórico vinculado.
// Uso: node packages/db/scripts/inspect-users.mjs <email> [email2...]
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error('Informe ao menos um e-mail.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  for (const email of emails) {
    const users = await prisma.user.findMany({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        // Lojas da pessoa (ADR-014): uma linha por vínculo.
        memberships: { select: { role: true, status: true, isActive: true, tenant: { select: { name: true, slug: true } } } },
      },
    });
    console.log(`\n=== ${email} ===`);
    if (users.length === 0) {
      console.log('  (não encontrado na tabela users)');
      continue;
    }
    for (const u of users) {
      const [orders, cashSessions, stockMovements, cashMovements, auditEvents] = await Promise.all([
        prisma.order.count({ where: { userId: u.id } }),
        prisma.cashSession.count({ where: { userId: u.id } }),
        prisma.stockMovement.count({ where: { userId: u.id } }),
        prisma.cashMovement.count({ where: { userId: u.id } }),
        prisma.auditEvent.count({ where: { userId: u.id } }),
      ]);
      console.log(`  id:        ${u.id}`);
      console.log(`  nome:      ${u.name}`);
      console.log(`  conta ativa: ${u.isActive}`);
      for (const m of u.memberships)
        console.log(`  loja:      ${m.tenant.name} (${m.tenant.slug}) — ${m.role} ${m.status}${m.isActive ? '' : ' (desativado)'}`);
      console.log(`  histórico: orders=${orders} cashSessions=${cashSessions} stockMovements=${stockMovements} cashMovements=${cashMovements} auditEvents=${auditEvents}`);
      const owned = u.memberships.filter((m) => m.role === 'OWNER').map((m) => m.tenant.name);
      console.log(`  DONO de: ${owned.length ? owned.join(', ') + ' (remoção travada por padrão)' : '—'}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
