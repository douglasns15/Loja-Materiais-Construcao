// Cria uma loja nova e MOVE um usuário existente para ela (não-destrutivo).
// O histórico do usuário na loja antiga permanece (ancora em userId + tenantId da venda).
// Uso: node packages/db/scripts/move-user-to-new-tenant.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const EMAIL = 'douglasns.work@gmail.com';
const NEW_NAME = 'Maria ConstruLar';
const NEW_SLUG = 'maria-constrular';
const NEW_ROLE = 'OWNER'; // dono da loja nova

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, name: true, role: true, tenantId: true, tenant: { select: { name: true } } },
  });
  if (!user) throw new Error(`Usuário ${EMAIL} não encontrado.`);

  const slugTaken = await prisma.tenant.findUnique({ where: { slug: NEW_SLUG }, select: { id: true } });
  if (slugTaken) throw new Error(`Já existe loja com slug "${NEW_SLUG}".`);

  console.log(`Antes:  ${EMAIL} = ${user.role} em "${user.tenant?.name}" [${user.tenantId}]`);

  const { tenant, updated } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: NEW_NAME, slug: NEW_SLUG } });
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { tenantId: tenant.id, role: NEW_ROLE },
      select: { id: true, role: true, tenantId: true },
    });
    return { tenant, updated };
  });

  console.log(`Loja criada: "${tenant.name}" (${tenant.slug}) [${tenant.id}] ativa=${tenant.isActive}`);
  console.log(`Depois: ${EMAIL} = ${updated.role} em "${tenant.name}" [${updated.tenantId}]`);
  console.log('OK — histórico do usuário na loja antiga permanece atribuído (ADR-010).');
} finally {
  await prisma.$disconnect();
}
