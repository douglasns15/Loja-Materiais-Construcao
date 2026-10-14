import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { resolveActiveStore } from '@nexoloja/core';

import { isAdminRole } from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma } from '../lib/request';
import { verifySupportToken } from '../lib/supportToken';
import { TOKEN_UNAVAILABLE, verifySupabaseToken } from '../lib/supabaseToken';
import { withDbRetry } from '../lib/dbRetry';

/** Header com a loja ativa da sessão (ADR-014 §2) — o cliente envia; a API confere contra os vínculos. */
export const ACTIVE_TENANT_HEADER = 'x-active-tenant';

/** Vínculo utilizável como o `requireAuth`/`requireIdentity` carregam (ACTIVE + isActive). */
export type LoadedMembership = { tenantId: string; role: string; tenant: { name: string; isActive: boolean } };

type Identity = { sub: string; name: string; memberships: LoadedMembership[] };

/**
 * Parte comum dos dois middlewares de usuário de loja: confere o token do Supabase e carrega a
 * identidade (`users`) com os vínculos utilizáveis (ADR-014) — UMA consulta, a mesma de antes do
 * multi-loja (o vínculo vem junto). Devolve a resposta de erro pronta quando não dá para seguir.
 */
async function loadIdentity(c: Context<Env>): Promise<Identity | Response> {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return c.json({ ok: false, error: 'Token de autenticação ausente.' }, 401);
  }

  const supabaseUrl = c.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return c.json({ ok: false, error: 'SUPABASE_URL não configurada.' }, 500);
  }

  const check = await verifySupabaseToken(token, supabaseUrl, c.env.SUPABASE_JWKS);
  if (!check.ok) {
    return check.transient
      ? c.json({ ok: false, error: TOKEN_UNAVAILABLE }, 503)
      : c.json({ ok: false, error: 'Token inválido ou expirado.' }, 401);
  }
  const sub = check.sub;

  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    // Retry curto: o cold start do free tier faz esta leitura estourar na 1ª chamada depois de
    // ociosa e devolver 500 ("Falha na autenticação." abaixo). Re-tentar a leitura é seguro.
    const user = await withDbRetry('requireAuth.user', () =>
      prisma.user.findUnique({
        where: { id: sub },
        select: {
          name: true,
          isActive: true,
          // Lojas a que a pessoa tem acesso (ADR-014): só vínculos aceitos e ativos.
          memberships: {
            where: { status: 'ACTIVE', isActive: true },
            select: { tenantId: true, role: true, tenant: { select: { name: true, isActive: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    );
    if (!user || !user.isActive) {
      return c.json({ ok: false, error: 'Usuário sem acesso a este sistema.' }, 403);
    }
    return { sub, name: user.name, memberships: user.memberships };
  } catch (err) {
    console.error('requireAuth: falha ao resolver usuário:', err);
    return c.json({ ok: false, error: 'Falha na autenticação.' }, 500);
  }
}

/**
 * Exige um access token válido do Supabase Auth no header `Authorization: Bearer <jwt>`.
 * Verifica a assinatura via JWKS (chaves públicas ES256) e resolve `tenantId`/`role`
 * a partir da tabela `users` (sub do JWT = auth.users.id = users.id).
 * Substitui a confiança no header `x-tenant-id` da Fase 1.
 *
 * Multi-loja (ADR-014, Fatia 2): a loja e o PAPEL vêm do vínculo (`tenant_memberships`) da **loja
 * ativa**, informada no header `x-active-tenant` e conferida contra os vínculos (`resolveActiveStore`,
 * core). Sem o header e com uma loja só, entra nela (o app antigo segue funcionando). Respostas:
 * 409 `SELECT_STORE` (tem várias e não escolheu) e 403 `STORE_FORBIDDEN` (pediu loja que não é sua) —
 * o `code` deixa a web voltar ao seletor de loja.
 */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const identity = await loadIdentity(c);
  if (identity instanceof Response) return identity;

  const resolved = resolveActiveStore(identity.memberships, c.req.header(ACTIVE_TENANT_HEADER));
  if (!resolved.ok) {
    if (resolved.reason === 'SELECT_STORE') {
      return c.json({ ok: false, code: 'SELECT_STORE', error: 'Selecione a loja para continuar.' }, 409);
    }
    if (resolved.reason === 'NOT_MEMBER') {
      return c.json({ ok: false, code: 'STORE_FORBIDDEN', error: 'Você não tem acesso a esta loja.' }, 403);
    }
    return c.json({ ok: false, error: 'Usuário sem acesso a este sistema.' }, 403);
  }
  const m = resolved.membership;
  c.set('tenantId', m.tenantId);
  c.set('userId', identity.sub);
  c.set('role', m.role);
  // Nome do operador para a atribuição de autoria (ADR-010): gravado como snapshot em
  // vendas/estoque/caixa/cadastros ("Registrado por …"). Congela o nome no momento da ação.
  c.set('userName', identity.name);
  // Loja inativada pelo Super Usuário (ADR-009): não barra o login (o usuário ainda vê
  // relatórios/fecha caixa), mas o front avisa e operações novas são bloqueadas via
  // `requireActiveTenant`. Não achar o tenant é tratado como inativo (conservador).
  c.set('tenantActive', m.tenant?.isActive ?? false);
  c.set('memberships', identity.memberships);

  await next();
});

/**
 * Só a IDENTIDADE (token válido + usuário ativo), SEM escolher loja — para a tela de seleção de loja
 * (`GET /me/stores`), que precisa listar as lojas justamente quando o `requireAuth` responderia
 * 409 "selecione a loja". Popula `userId`, `userName` e `memberships`; NÃO popula `tenantId`/`role`
 * (rota que use isto não pode tocar dado de loja).
 */
export const requireIdentity = createMiddleware<Env>(async (c, next) => {
  const identity = await loadIdentity(c);
  if (identity instanceof Response) return identity;
  c.set('userId', identity.sub);
  c.set('userName', identity.name);
  c.set('memberships', identity.memberships);
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

  const check = await verifySupabaseToken(token, supabaseUrl, c.env.SUPABASE_JWKS);
  if (!check.ok) {
    return check.transient
      ? c.json({ ok: false, error: TOKEN_UNAVAILABLE }, 503)
      : c.json({ ok: false, error: 'Token inválido ou expirado.' }, 401);
  }
  const sub = check.sub;

  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = getPrisma(c);
    const admin = await withDbRetry('requirePlatformAuth.admin', () =>
      prisma.platformAdmin.findUnique({
        where: { id: sub },
        select: { id: true, name: true, email: true, isActive: true },
      }),
    );
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

/**
 * Exige uma SESSÃO DE SUPORTE válida (ADR-009, Fatia E). Protege as rotas `/support/*` —
 * mantidas FORA de `/platform/*` de propósito, para não passar pelo `requirePlatformAuth`
 * (que verificaria o header como um JWT do Supabase). Aqui o `Authorization: Bearer` carrega
 * o **token de suporte** (assinado pela API, ver `lib/supportToken.ts`). Além de checar a
 * assinatura/validade, revalida `platform_admins.isActive` (desativar o super usuário corta a
 * sessão imediatamente, independente do TTL). Popula o escopo `supportPlatformAdminId`/
 * `supportTenantId` no contexto. É a fronteira explícita — o RLS de loja NÃO é relaxado.
 */
export const requireSupportSession = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return c.json({ ok: false, error: 'Sessão de suporte ausente.' }, 401);
  }

  const secret = c.env.SUPPORT_TOKEN_SECRET;
  if (!secret) {
    return c.json({ ok: false, error: 'Suporte indisponível: segredo não configurado.' }, 503);
  }

  let scope: { platformAdminId: string; targetTenantId: string };
  try {
    scope = await verifySupportToken(secret, token);
  } catch {
    return c.json({ ok: false, error: 'Sessão de suporte inválida ou expirada.' }, 401);
  }

  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    // Revalida o super usuário na fonte de verdade (a tabela, não o token): se foi desativado,
    // a sessão de suporte deixa de valer na hora — mesmo antes de o token expirar.
    const prisma = getPrisma(c);
    const admin = await withDbRetry('requireSupportSession.admin', () =>
      prisma.platformAdmin.findUnique({
        where: { id: scope.platformAdminId },
        select: { isActive: true },
      }),
    );
    if (!admin || !admin.isActive) {
      return c.json({ ok: false, error: 'Acesso de suporte revogado.' }, 403);
    }
  } catch (err) {
    console.error('requireSupportSession: falha ao revalidar super usuário:', err);
    return c.json({ ok: false, error: 'Falha na autenticação de suporte.' }, 500);
  }

  c.set('supportPlatformAdminId', scope.platformAdminId);
  c.set('supportTenantId', scope.targetTenantId);
  await next();
});
