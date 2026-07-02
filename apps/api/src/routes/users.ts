import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  inviteUserSchema,
  isOwnerRole,
  storeRoleToUserRole,
  toStoreRole,
  updateUserSchema,
} from '@nexoloja/shared';
import { type Bindings, type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAdmin, requireAuth } from '../middleware/auth';

const users = new Hono<Env>();

// Gestão de usuários é sempre restrita a administradores (ADR-008).
users.use('*', requireAuth);
users.use('*', requireAdmin);

/**
 * Convida (ou reaproveita) o usuário no Supabase Auth via `inviteUserByEmail`
 * (`POST /auth/v1/invite`) usando a `service_role`. Envia o e-mail com o link de
 * convite e devolve o `id` (= `auth.users.id`). Se o e-mail já existir no Auth,
 * recupera o `id` pela API admin (mesma estratégia do `create-user.mjs`).
 */
async function inviteAuthUser(
  env: Bindings,
  email: string,
  redirectTo?: string,
  data?: Record<string, unknown>,
): Promise<string> {
  const supabaseUrl = env.SUPABASE_URL!;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    'Content-Type': 'application/json',
  };

  const inviteUrl = new URL(`${supabaseUrl}/auth/v1/invite`);
  if (redirectTo) inviteUrl.searchParams.set('redirect_to', redirectTo);
  const res = await fetch(inviteUrl, {
    method: 'POST',
    headers,
    // `data` vira user_metadata e fica disponível no template do e-mail como
    // `{{ .Data.store_name }}` — usado para personalizar o convite (ADR-008).
    body: JSON.stringify({ email, ...(data ? { data } : {}) }),
  });
  if (res.ok) {
    const created = (await res.json()) as { id: string };
    return created.id;
  }

  // Já registrado no Auth: recupera o id para vincular à loja.
  const errText = await res.text();
  if (res.status === 422 || /registered|exists/i.test(errText)) {
    const list = await fetch(`${supabaseUrl}/auth/v1/admin/users`, { headers });
    const { users: authUsers = [] } = (await list.json()) as {
      users?: Array<{ id: string; email?: string }>;
    };
    const found = authUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
  }
  throw new Error(`Supabase invite falhou (${res.status}): ${errText}`);
}

/** Lista os usuários da loja (com o papel derivado Admin/Usuário). */
users.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = createPrismaClient(connectionString);
    const items = await prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    return c.json({
      ok: true,
      data: items.map((u) => ({ ...u, storeRole: toStoreRole(u.role) })),
    });
  } catch (err) {
    console.error('GET /users falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar usuários.' }, 500);
  }
});

/**
 * Atualiza papel (Admin/Usuário) e/ou ativação de um usuário da loja.
 * Guardas: não altera o próprio usuário (evita se auto-rebaixar/desativar) e não mexe
 * no `OWNER` (dono, preservado — ADR-008). Registra `AuditEvent CHANGE_ROLE` (ADR-004).
 */
users.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const actorId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const targetId = c.req.param('id');
  if (targetId === actorId) {
    return c.json({ ok: false, error: 'Você não pode alterar o próprio acesso.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const target = await prisma.user.findFirst({
      where: { id: targetId, tenantId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target) {
      return c.json({ ok: false, error: 'Usuário não encontrado.' }, 404);
    }
    if (isOwnerRole(target.role)) {
      return c.json({ ok: false, error: 'O dono da loja não pode ser alterado aqui.' }, 400);
    }

    const { storeRole, isActive } = parsed.data;
    const nextRole = storeRole ? storeRoleToUserRole(storeRole) : target.role;
    const nextActive = isActive ?? target.isActive;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetId },
        data: { role: nextRole, isActive: nextActive },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId: actorId,
          entity: 'User',
          entityId: targetId,
          action: 'CHANGE_ROLE',
          meta: {
            roleBefore: target.role,
            roleAfter: nextRole,
            activeBefore: target.isActive,
            activeAfter: nextActive,
          },
        },
      });
    });

    const updated = await prisma.user.findFirst({
      where: { id: targetId, tenantId },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    return c.json({
      ok: true,
      data: updated ? { ...updated, storeRole: toStoreRole(updated.role) } : null,
    });
  } catch (err) {
    console.error('PATCH /users/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o usuário.' }, 500);
  }
});

/**
 * Convida um novo usuário por e-mail (ADR-008, fatia 2). Cria o usuário no Supabase Auth
 * (envia o e-mail de convite) e a linha em `users` com o papel escolhido, tudo no tenant do
 * Admin autenticado. Requer a `SUPABASE_SERVICE_ROLE_KEY` como secret do Worker. Registra
 * `AuditEvent CHANGE_ROLE` (atribuição de papel — evento crítico, ADR-004).
 */
users.post('/invite', async (c) => {
  const tenantId = getTenantId(c);
  const actorId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Segredo não provisionado: falha explícita (não um 500 genérico).
    return c.json(
      { ok: false, error: 'Convite indisponível: credencial de serviço não configurada.' },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const parsed = inviteUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  const { email, storeRole, name, redirectTo } = parsed.data;
  const role = storeRoleToUserRole(storeRole);

  try {
    const prisma = createPrismaClient(connectionString);

    // Já existe alguém com esse e-mail nesta loja? (idempotência amigável)
    const sameEmail = await prisma.user.findFirst({
      where: { tenantId, email },
      select: { id: true },
    });
    if (sameEmail) {
      return c.json({ ok: false, error: 'Já existe um usuário com esse e-mail nesta loja.' }, 409);
    }

    // Nome da loja para personalizar o e-mail (template usa `{{ .Data.store_name }}`).
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    // Cria/recupera no Auth e envia o e-mail de convite.
    const authUserId = await inviteAuthUser(c.env, email, redirectTo, {
      store_name: tenant?.name ?? 'sua loja',
    });

    // Multi-tenancy (ADR-005): um `auth.users` mapeia para uma única linha em `users`.
    // Se já estiver vinculado a OUTRA loja, não sequestrar para esta.
    const linked = await prisma.user.findUnique({
      where: { id: authUserId },
      select: { tenantId: true },
    });
    if (linked && linked.tenantId !== tenantId) {
      return c.json({ ok: false, error: 'Este e-mail já está vinculado a outra loja.' }, 409);
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { id: authUserId },
        update: { tenantId, role, email, isActive: true, ...(name ? { name } : {}) },
        create: {
          id: authUserId, // = auth.users.id (ADR-005)
          tenantId,
          name: name ?? email.split('@')[0] ?? email,
          email,
          role,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId: actorId,
          entity: 'User',
          entityId: authUserId,
          action: 'CHANGE_ROLE',
          meta: { invited: true, email, roleAfter: role },
        },
      });
      return user;
    });

    return c.json(
      {
        ok: true,
        data: {
          id: created.id,
          name: created.name,
          email: created.email,
          role: created.role,
          isActive: created.isActive,
          storeRole: toStoreRole(created.role),
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /users/invite falhou:', err);
    return c.json({ ok: false, error: 'Falha ao convidar o usuário.' }, 500);
  }
});

export default users;
