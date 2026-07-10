import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  MODULE_OFFLINE_SALES,
  createTenantSchema,
  setTenantActiveSchema,
  setTenantModuleSchema,
  slugify,
} from '@nexoloja/shared';
import { type Env, getConnectionString } from '../lib/request';
import { inviteAuthUser } from '../lib/authAdmin';
import { signSupportToken } from '../lib/supportToken';
import { requirePlatformAuth } from '../middleware/auth';

// Rotas de PLATAFORMA (Super Usuário / fabricante, ADR-009). Cruzam o limite do
// tenant de forma explícita e auditável — a API roda como dona do banco e isola
// por código; o RLS das tabelas de loja NÃO é relaxado. Todas exigem um super
// usuário ativo (`platform_admins`) via `requirePlatformAuth`.
const platform = new Hono<Env>();

platform.use('*', requirePlatformAuth);

/** Identidade do super usuário autenticado (o front usa para liberar o painel). */
platform.get('/me', (c) =>
  c.json({
    ok: true,
    data: {
      isPlatformAdmin: true,
      id: c.get('platformAdminId'),
      name: c.get('platformAdminName'),
      email: c.get('platformAdminEmail'),
    },
  }),
);

/**
 * Lista TODAS as lojas (cross-tenant). É a prova do acesso de plataforma controlado:
 * chega aqui só quem passou pelo `requirePlatformAuth`. Traz o nº de usuários por loja
 * para o painel de gestão (Fatia C).
 */
platform.get('/tenants', async (c) => {
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }
  try {
    const prisma = createPrismaClient(connectionString);
    const tenants = await prisma.tenant.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        cnpj: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
        // Estado do módulo de vendas offline (ADR-011) por loja, para o toggle do painel.
        modules: {
          where: { moduleKey: MODULE_OFFLINE_SALES },
          select: { isActive: true },
        },
      },
    });
    return c.json({
      ok: true,
      data: tenants.map(({ _count, modules, ...t }) => ({
        ...t,
        userCount: _count.users,
        offlineSales: modules.some((m) => m.isActive === true),
      })),
    });
  } catch (err) {
    console.error('GET /platform/tenants falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as lojas.' }, 500);
  }
});

/**
 * Onboarding: cria uma loja (`Tenant`) e convida o primeiro Admin (`OWNER`) por e-mail
 * (ADR-009, Fatia B). Substitui o script de bootstrap por uma operação de produto. O `slug`
 * é derivado do nome quando não informado. Unicidade de `slug`/`cnpj` → 409. O admin é
 * criado/recuperado no Supabase Auth (convite por e-mail via `service_role`) e vinculado à
 * nova loja como `OWNER`. Registra `AuditEvent CREATE_TENANT` (auditoria de plataforma).
 */
platform.post('/tenants', async (c) => {
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json(
      { ok: false, error: 'Onboarding indisponível: credencial de serviço não configurada.' },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() }, 400);
  }

  const { name, cnpj, phone, adminEmail, adminName, redirectTo } = parsed.data;
  const slug = parsed.data.slug ?? slugify(name);
  if (!slug) {
    return c.json(
      { ok: false, error: 'Não foi possível gerar um identificador (slug) para a loja.' },
      400,
    );
  }

  const actorId = c.get('platformAdminId');
  try {
    const prisma = createPrismaClient(connectionString);

    // Checagem amigável ANTES do convite externo (evita criar conta no Auth à toa).
    if (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
      return c.json({ ok: false, error: `Já existe uma loja com o identificador "${slug}".` }, 409);
    }
    if (cnpj && (await prisma.tenant.findFirst({ where: { cnpj }, select: { id: true } }))) {
      return c.json({ ok: false, error: 'Já existe uma loja com esse CNPJ.' }, 409);
    }

    // Cria/recupera o admin no Auth e dispara o e-mail de convite.
    const adminId = await inviteAuthUser(c.env, adminEmail, redirectTo, { store_name: name });

    // Um `auth.users` mapeia para uma única linha em `users` (ADR-005): se o e-mail já
    // pertence a alguma loja, não sequestrar para a nova.
    const linked = await prisma.user.findUnique({
      where: { id: adminId },
      select: { tenantId: true },
    });
    if (linked) {
      return c.json({ ok: false, error: 'Este e-mail de admin já está vinculado a uma loja.' }, 409);
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, slug, cnpj: cnpj ?? null, phone: phone ?? null },
      });
      const admin = await tx.user.create({
        data: {
          id: adminId, // = auth.users.id (ADR-005)
          tenantId: tenant.id,
          name: adminName ?? adminEmail.split('@')[0] ?? adminEmail,
          email: adminEmail,
          role: 'OWNER', // primeiro Admin da loja nova é o dono
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: tenant.id,
          userId: actorId, // id do Super Usuário (fora de `users`; ref. solta, sem FK)
          entity: 'Tenant',
          entityId: tenant.id,
          action: 'CREATE_TENANT',
          meta: { platform: true, slug, adminEmail, adminRole: 'OWNER' },
        },
      });
      return { tenant, admin };
    });

    return c.json(
      {
        ok: true,
        data: {
          id: result.tenant.id,
          name: result.tenant.name,
          slug: result.tenant.slug,
          cnpj: result.tenant.cnpj,
          isActive: result.tenant.isActive,
          admin: { id: result.admin.id, email: result.admin.email, role: result.admin.role },
        },
      },
      201,
    );
  } catch (err) {
    // Corrida de unicidade (slug/cnpj) que passou pela checagem prévia → 409.
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Loja com identificador ou CNPJ já existente.' }, 409);
    }
    console.error('POST /platform/tenants falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar a loja.' }, 500);
  }
});

/**
 * Ativa/inativa uma loja (`Tenant.isActive`) pelo painel de plataforma (ADR-009). Registra
 * `AuditEvent SET_TENANT_ACTIVE` (evento de plataforma; a loja-alvo dá o `tenantId`, o ator é
 * o Super Usuário). Não apaga dados — uma loja inativa fica marcada e, a partir daí, os usuários
 * dela ainda entram (consultam/fecham caixa) mas veem um aviso no topo e ficam **bloqueados de
 * registrar novas vendas** (`requireActiveTenant` no `POST /orders`; ver `middleware/auth.ts`).
 */
platform.patch('/tenants/:id', async (c) => {
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = setTenantActiveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() }, 400);
  }

  const actorId = c.get('platformAdminId');
  try {
    const prisma = createPrismaClient(connectionString);
    const target = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!target) {
      return c.json({ ok: false, error: 'Loja não encontrada.' }, 404);
    }

    const { isActive } = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.update({ where: { id }, data: { isActive } });
      await tx.auditEvent.create({
        data: {
          tenantId: id,
          userId: actorId,
          entity: 'Tenant',
          entityId: id,
          action: 'SET_TENANT_ACTIVE',
          meta: { platform: true, before: target.isActive, after: isActive },
        },
      });
      return t;
    });

    return c.json({ ok: true, data: { id: updated.id, isActive: updated.isActive } });
  } catch (err) {
    console.error('PATCH /platform/tenants/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar a loja.' }, 500);
  }
});

/**
 * Liga/desliga um MÓDULO da loja pelo painel de plataforma (ADR-011 §9). Por ora só
 * `OFFLINE_SALES` (fila de sincronização offline de vendas — recurso de plano pago). Faz upsert
 * na tabela `TenantModule` que já existe (sem migration): a chave é `[tenantId, moduleKey]` e o
 * liga/desliga é `isActive`. Regra do gate: ausência da linha OU `isActive=false` = OFF (o
 * `PATCH` cria a linha na 1ª ativação). Registra `AuditEvent SET_TENANT_MODULE` (evento de
 * plataforma; loja-alvo dá o `tenantId`, o ator é o Super Usuário), espelhando `SET_TENANT_ACTIVE`.
 */
platform.patch('/tenants/:id/modules', async (c) => {
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = setTenantModuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() }, 400);
  }

  const actorId = c.get('platformAdminId');
  const { moduleKey, isActive } = parsed.data;
  try {
    const prisma = createPrismaClient(connectionString);
    const target = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      return c.json({ ok: false, error: 'Loja não encontrada.' }, 404);
    }

    const before = await prisma.tenantModule.findUnique({
      where: { tenantId_moduleKey: { tenantId: id, moduleKey } },
      select: { isActive: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.tenantModule.upsert({
        where: { tenantId_moduleKey: { tenantId: id, moduleKey } },
        create: { tenantId: id, moduleKey, isActive },
        update: { isActive },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: id,
          userId: actorId,
          entity: 'TenantModule',
          entityId: id,
          action: 'SET_TENANT_MODULE',
          meta: { platform: true, moduleKey, before: before?.isActive ?? false, after: isActive },
        },
      });
    });

    return c.json({ ok: true, data: { id, moduleKey, isActive } });
  } catch (err) {
    console.error('PATCH /platform/tenants/:id/modules falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o módulo da loja.' }, 500);
  }
});

/**
 * Inicia uma SESSÃO DE SUPORTE sobre uma loja (ADR-009, Fatia E — impersonation auditada,
 * **somente-leitura** nesta fatia). O Super Usuário não vira usuário da loja: a API emite um
 * token curto e assinado (ver `lib/supportToken.ts`) com escopo `{ platformAdminId,
 * targetTenantId, exp }`, que autoriza as rotas `/support/*` (não as rotas de loja). Registra
 * `AuditEvent SUPPORT_SESSION_START` (`meta.support = true`; `tenantId` = loja-alvo; `userId` =
 * Super Usuário). O front guarda o token e o usa para ler o overview da loja.
 */
platform.post('/tenants/:id/support', async (c) => {
  const secret = c.env.SUPPORT_TOKEN_SECRET;
  if (!secret) {
    return c.json({ ok: false, error: 'Suporte indisponível: segredo não configurado.' }, 503);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const id = c.req.param('id');
  const platformAdminId = c.get('platformAdminId');
  try {
    const prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    if (!tenant) {
      return c.json({ ok: false, error: 'Loja não encontrada.' }, 404);
    }

    const { token, expiresAt } = await signSupportToken(secret, {
      platformAdminId,
      targetTenantId: tenant.id,
    });

    await prisma.auditEvent.create({
      data: {
        tenantId: tenant.id,
        userId: platformAdminId,
        entity: 'Tenant',
        entityId: tenant.id,
        action: 'SUPPORT_SESSION_START',
        meta: { platform: true, support: true, mode: 'read-only', expiresAt },
      },
    });

    return c.json({ ok: true, data: { token, expiresAt, tenant } });
  } catch (err) {
    console.error('POST /platform/tenants/:id/support falhou:', err);
    return c.json({ ok: false, error: 'Falha ao iniciar a sessão de suporte.' }, 500);
  }
});

export default platform;
