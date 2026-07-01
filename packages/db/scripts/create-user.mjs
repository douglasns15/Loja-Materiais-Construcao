// =============================================================================
// Cria/atualiza um usuário em uma loja (tenant) JÁ EXISTENTE, com papel definido.
// Complementa o bootstrap (que cria a loja + OWNER): aqui adicionamos usuários
// adicionais (ex.: CASHIER) para testar o RBAC (ADR-008) enquanto o convite por
// e-mail (fatia 2) não está pronto.
//
// Uso (a partir da RAIZ do repositório):
//   node packages/db/scripts/create-user.mjs [email] [senha] [role] [slugLoja]
//   role ∈ { OWNER, MANAGER, CASHIER, STOCK } (default CASHIER)
//
// Requer no .env (raiz): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
// =============================================================================
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// Carrega o .env da raiz (node não faz isso sozinho).
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('ERRO: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env da raiz.');
  process.exit(1);
}

const [, , email = 'caixa@lojademo.com', password = 'NexoLoja#2026', role = 'CASHIER', tenantSlug = 'loja-demo'] =
  process.argv;

const VALID_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'STOCK'];
if (!VALID_ROLES.includes(role)) {
  console.error(`ERRO: role inválido "${role}". Use um de: ${VALID_ROLES.join(', ')}.`);
  process.exit(1);
}

const adminHeaders = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

/** Cria o usuário no Supabase Auth (ou retorna o existente). Devolve o id (uuid). */
async function ensureAuthUser() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (res.ok) {
    const u = await res.json();
    console.log('Auth: usuário criado.');
    return u.id;
  }
  const errText = await res.text();
  if (res.status === 422 || /registered|exists/i.test(errText)) {
    const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { headers: adminHeaders });
    const { users = [] } = await list.json();
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      console.log('Auth: usuário já existia, reutilizando.');
      return found.id;
    }
  }
  throw new Error(`Falha ao criar usuário no Supabase Auth (${res.status}): ${errText}`);
}

async function main() {
  const userId = await ensureAuthUser();

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      throw new Error(`Loja com slug "${tenantSlug}" não encontrada (rode o bootstrap antes).`);
    }

    await prisma.user.upsert({
      where: { id: userId },
      update: { tenantId: tenant.id, role, email, isActive: true },
      create: {
        id: userId, // = auth.users.id (ADR-005)
        tenantId: tenant.id,
        name: email.split('@')[0],
        email,
        role,
      },
    });

    console.log('\n✅ Usuário pronto:');
    console.log('   email:', email);
    console.log('   role:', role);
    console.log('   userId (= auth.users.id):', userId);
    console.log('   tenantId:', tenant.id, `(${tenant.slug})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('ERRO ao criar usuário:', e.message);
  process.exit(1);
});
