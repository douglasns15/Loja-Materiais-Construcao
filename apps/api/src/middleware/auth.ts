import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createPrismaClient } from '@nexoloja/db';
import { isAdminRole } from '@nexoloja/shared';
import { type Env, getConnectionString } from '../lib/request';

// O conjunto de chaves públicas (JWKS) do Supabase é cacheado no isolate do Worker.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrl: string | undefined;

function getJwks(supabaseUrl: string) {
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

/**
 * Exige um access token válido do Supabase Auth no header `Authorization: Bearer <jwt>`.
 * Verifica a assinatura via JWKS (chaves públicas ES256) e resolve `tenantId`/`role`
 * a partir da tabela `users` (sub do JWT = auth.users.id = users.id).
 * Substitui a confiança no header `x-tenant-id` da Fase 1.
 */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return c.json({ ok: false, error: 'Token de autenticação ausente.' }, 401);
  }

  const supabaseUrl = c.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return c.json({ ok: false, error: 'SUPABASE_URL não configurada.' }, 500);
  }

  let sub: string;
  try {
    const { payload } = await jwtVerify(token, getJwks(supabaseUrl), {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('JWT sem sub');
    sub = payload.sub;
  } catch {
    return c.json({ ok: false, error: 'Token inválido ou expirado.' }, 401);
  }

  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: {
        tenantId: true,
        role: true,
        isActive: true,
        tenant: { select: { isActive: true } },
      },
    });
    if (!user || !user.isActive) {
      return c.json({ ok: false, error: 'Usuário sem acesso a este sistema.' }, 403);
    }
    c.set('tenantId', user.tenantId);
    c.set('userId', sub);
    c.set('role', user.role);
    // Loja inativada pelo Super Usuário (ADR-009): não barra o login (o usuário ainda vê
    // relatórios/fecha caixa), mas o front avisa e operações novas são bloqueadas via
    // `requireActiveTenant`. Não achar o tenant é tratado como inativo (conservador).
    c.set('tenantActive', user.tenant?.isActive ?? false);
  } catch (err) {
    console.error('requireAuth: falha ao resolver usuário:', err);
    return c.json({ ok: false, error: 'Falha na autenticação.' }, 500);
  }

  await next();
});

/**
 * Exige papel administrativo (Admin — `OWNER`/`MANAGER`, ver ADR-008). Deve rodar
 * DEPOIS de `requireAuth` (que popula `role`). Usado em ações de administração da loja:
 * gestão de usuários, dados/logo da loja, etc.
 */
export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  if (!isAdminRole(c.get('role'))) {
    return c.json({ ok: false, error: 'Ação restrita a administradores.' }, 403);
  }
  await next();
});

/**
 * Bloqueia operações quando a loja está **inativa** (`Tenant.isActive = false`, desativada pelo
 * Super Usuário — ADR-009). Deve rodar DEPOIS de `requireAuth` (que popula `tenantActive`). Não é
 * aplicado globalmente: o usuário de uma loja inativa ainda entra e consulta (relatórios, caixa),
 * mas ações que geram novo movimento (ex.: `POST /orders`) usam este guard. Retorna 403.
 */
export const requireActiveTenant = createMiddleware<Env>(async (c, next) => {
  if (c.get('tenantActive') === false) {
    return c.json(
      { ok: false, error: 'Loja desativada — operação indisponível. Fale com o suporte.' },
      403,
    );
  }
  await next();
});

/**
 * Exige um Super Usuário de PLATAFORMA (fabricante, ADR-009). É SEPARADO do
 * `requireAuth`: o super usuário não pertence a loja (não tem linha em `users`),
 * então a autorização é feita contra a tabela `platform_admins` (fonte de verdade),
 * não contra o claim do JWT (que é só atalho de UI). Protege as rotas `/platform/*`,
 * onde o acesso cross-tenant acontece de forma explícita e auditável.
 */
export const requirePlatformAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return c.json({ ok: false, error: 'Token de autenticação ausente.' }, 401);
  }

  const supabaseUrl = c.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return c.json({ ok: false, error: 'SUPABASE_URL não configurada.' }, 500);
  }

  let sub: string;
  try {
    const { payload } = await jwtVerify(token, getJwks(supabaseUrl), {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('JWT sem sub');
    sub = payload.sub;
  } catch {
    return c.json({ ok: false, error: 'Token inválido ou expirado.' }, 401);
  }

  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const admin = await prisma.platformAdmin.findUnique({
      where: { id: sub },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!admin || !admin.isActive) {
      return c.json({ ok: false, error: 'Acesso restrito à administração da plataforma.' }, 403);
    }
    c.set('platformAdminId', admin.id);
    c.set('platformAdminName', admin.name);
    c.set('platformAdminEmail', admin.email);
  } catch (err) {
    console.error('requirePlatformAuth: falha ao resolver super usuário:', err);
    return c.json({ ok: false, error: 'Falha na autenticação.' }, 500);
  }

  await next();
});
