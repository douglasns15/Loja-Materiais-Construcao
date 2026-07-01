import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  isOwnerRole,
  storeRoleToUserRole,
  toStoreRole,
  updateUserSchema,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAdmin, requireAuth } from '../middleware/auth';

const users = new Hono<Env>();

// Gestão de usuários é sempre restrita a administradores (ADR-008).
users.use('*', requireAuth);
users.use('*', requireAdmin);

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

export default users;
