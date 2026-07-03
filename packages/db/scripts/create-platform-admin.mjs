// =============================================================================
// Provisão do Super Usuário (fabricante) — identidade de PLATAFORMA (ADR-009).
// Cria/recupera a conta no Supabase Auth (via service_role) e grava a linha em
// `platform_admins`. É o equivalente ao bootstrap, mas para a plataforma: como
// conceder super usuário é um evento sensível e sem loja, fica como operação de
// servidor auditável (não há tela para isso). Rodar com cautela.
//
// Uso (a partir da RAIZ do repositório):
//   node packages/db/scripts/create-platform-admin.mjs [email] [senha] [nome]
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

const [, , email, password, name] = process.argv;
if (!email || !password) {
  console.error('Uso: node packages/db/scripts/create-platform-admin.mjs [email] [senha] [nome]');
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
    const admin = await prisma.platformAdmin.upsert({
      where: { id: userId },
      update: { email, name: name ?? email.split('@')[0], isActive: true },
      create: {
        id: userId, // = auth.users.id (ADR-005)
        email,
        name: name ?? email.split('@')[0],
      },
    });

    console.log('\n✅ Super Usuário provisionado:');
    console.log('   email:', admin.email);
    console.log('   id (= auth.users.id):', admin.id);
    console.log('\nFaça login e acesse /plataforma. O claim `is_platform_admin` entra no');
    console.log('próximo token emitido (após o hook 0005 estar ativo no Supabase).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('ERRO ao provisionar super usuário:', e.message);
  process.exit(1);
});
