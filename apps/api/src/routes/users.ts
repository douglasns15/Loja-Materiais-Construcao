import { Hono } from 'hono';

import { membershipChangeBlocked, planMembershipInvite } from '@nexoloja/core';
import {
  inviteUserSchema,
  storeRoleToUserRole,
  toStoreRole,
  updateUserSchema,
  type StoreMember,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { deleteAuthUser, inviteAuthUser } from '../lib/authAdmin';
import { requireAdmin, requireAuth } from '../middleware/auth';

const users = new Hono<Env>();

// Gestão de usuários é sempre restrita a administradores (ADR-008).
users.use('*', requireAuth);
users.use('*', requireAdmin);

/**
 * Multi-loja (ADR-014, Fatia 4): a gestão é POR LOJA — opera sobre o VÍNCULO (`tenant_memberships`) da pessoa com a
 * loja ativa, nunca sobre a identidade (`users`), que pode ter acesso a outras lojas. Papel e ativação valem só para
 * esta loja; "remover" tira só desta loja. Não grava mais `users.role/isActive` (o vínculo é a fonte do acesso; o
 * espelho `users → vínculo de casa` da 0046 continua para os outros caminhos até a Fatia 5).
 */

/** Mensagem de bloqueio do `membershipChangeBlocked` (core). */
const BLOCKED_MSG = {
  SELF: 'Você não pode alterar o próprio acesso.',
  OWNER: 'O dono da loja não pode ser alterado aqui.',
} as const;

/** Vínculo → linha da tela. Convite pendente mostra só o e-mail (anti-vazamento, ADR-014 §4). */
function toMember(m: {
  userId: string;
  role: string;
  status: 'ACTIVE' | 'PENDING';
  isActive: boolean;
  user: { name: string; email: string };
}): StoreMember {
  return {
    id: m.userId,
    name: m.status === 'PENDING' ? null : m.user.name,
    email: m.user.email,
    role: m.role,
    storeRole: toStoreRole(m.role),
    isActive: m.isActive,
    status: m.status,
  };
}

const MEMBER_SELECT = {
  userId: true,
  role: true,
  status: true,
  isActive: true,
  user: { select: { name: true, email: true } },
} as const;

/** Membros da loja ativa (inclui convites pendentes), com o papel derivado Admin/Usuário. */
users.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.tenantMembership.findMany({ where: { tenantId }, select: MEMBER_SELECT });
    const members = rows.map(toMember);
    // Ativos primeiro, depois desativados, por fim convites pendentes; nome/e-mail em ordem alfabética.
    const rank = (m: StoreMember) => (m.status === 'PENDING' ? 2 : m.isActive ? 0 : 1);
    members.sort((a, b) => rank(a) - rank(b) || (a.name ?? a.email).localeCompare(b.name ?? b.email, 'pt-BR'));
    return c.json({ ok: true, data: members });
  } catch (err) {
    console.error('GET /users falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar usuários.' }, 500);
  }
});

/**
 * Atualiza papel (Admin/Usuário) e/ou ativação do vínculo de alguém COM ESTA LOJA. Desativar corta o acesso só a
 * esta loja (as outras seguem). Guardas: não altera o próprio vínculo e não mexe no `OWNER` (ADR-008).
 * Registra `AuditEvent CHANGE_ROLE` (ADR-004).
 */
users.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const actorId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const targetId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = getPrisma(c);
    const target = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: targetId, tenantId } },
      select: { role: true, isActive: true, status: true },
    });
    if (!target) {
      return c.json({ ok: false, error: 'Usuário não encontrado.' }, 404);
    }
    const blocked = membershipChangeBlocked(actorId, targetId, target.role);
    if (blocked) return c.json({ ok: false, error: BLOCKED_MSG[blocked] }, 400);

    const { storeRole, isActive } = parsed.data;
    const nextRole = storeRole ? storeRoleToUserRole(storeRole) : target.role;
    const nextActive = isActive ?? target.isActive;

    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.tenantMembership.update({
        where: { userId_tenantId: { userId: targetId, tenantId } },
        data: { role: nextRole, isActive: nextActive },
        select: MEMBER_SELECT,
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
      return m;
    });
    return c.json({ ok: true, data: toMember(updated) });
  } catch (err) {
    console.error('PATCH /users/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o usuário.' }, 500);
  }
});

/**
 * REMOVE a pessoa DESTA loja (ADR-014 §5a) — apaga o vínculo (ou cancela o convite pendente). O histórico dela aqui
 * (vendas, caixa, estoque, autoria) fica intacto: ele ancora na identidade + loja, nunca no vínculo. Se a pessoa
 * ficar SEM nenhuma loja e SEM histórico em loja nenhuma, a identidade também é apagada e o e-mail liberado no
 * Auth (o "Excluir" de antes). Guardas: não remove a si mesmo nem o `OWNER`. `AuditEvent REVOKE_MEMBERSHIP`.
 */
users.delete('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const actorId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const targetId = c.req.param('id');
  try {
    const prisma = getPrisma(c);
    const target = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: targetId, tenantId } },
      select: { role: true, status: true, user: { select: { email: true, name: true } } },
    });
    if (!target) {
      return c.json({ ok: false, error: 'Usuário não encontrado.' }, 404);
    }
    const blocked = membershipChangeBlocked(actorId, targetId, target.role);
    if (blocked) {
      return c.json(
        { ok: false, error: blocked === 'SELF' ? 'Você não pode remover o próprio acesso.' : 'O dono da loja não pode ser removido.' },
        400,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.tenantMembership.delete({ where: { userId_tenantId: { userId: targetId, tenantId } } });
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId: actorId,
          entity: 'User',
          entityId: targetId,
          action: 'REVOKE_MEMBERSHIP',
          meta: { email: target.user.email, roleBefore: target.role, pendingInvite: target.status === 'PENDING' },
        },
      });
    });

    // Sem nenhuma loja e sem histórico em loja nenhuma ⇒ apaga a identidade e libera o e-mail (best-effort). Com
    // histórico (FKs sem cascade em vendas/caixa) a identidade fica — sem vínculo, ela não acessa nada.
    let identityDeleted = false;
    try {
      const [memberships, orders, cashSessions, isPlatformAdmin] = await Promise.all([
        prisma.tenantMembership.count({ where: { userId: targetId } }),
        prisma.order.count({ where: { userId: targetId } }),
        prisma.cashSession.count({ where: { userId: targetId } }),
        prisma.platformAdmin.findUnique({ where: { id: targetId }, select: { id: true } }),
      ]);
      if (memberships === 0 && orders === 0 && cashSessions === 0 && !isPlatformAdmin) {
        await prisma.user.delete({ where: { id: targetId } });
        identityDeleted = true;
        await deleteAuthUser(c.env, targetId);
      }
    } catch (cleanupErr) {
      console.error('DELETE /users/:id: limpeza da identidade falhou (vínculo já removido):', cleanupErr);
    }

    return c.json({ ok: true, data: { id: targetId, removed: true, identityDeleted } });
  } catch (err) {
    console.error('DELETE /users/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover o usuário.' }, 500);
  }
});

/**
 * Convida alguém para ESTA loja (ADR-008 fatia 2 + ADR-014 §4). Regra anti-sequestro (`planMembershipInvite`, core):
 * - e-mail SEM conta ⇒ convite do Supabase Auth (e-mail com link de definir senha) + identidade com esta loja de
 *   casa; definir a senha é o consentimento (vínculo ACTIVE, pelo espelho da 0046);
 * - conta EXISTENTE ⇒ vínculo **PENDING**: a pessoa vê "Aceitar/Recusar" ao entrar; só então acessa a loja.
 * Resposta SEMPRE igual ("convite enviado"), exista a conta ou não — o admin não descobre quem já tem conta nem em
 * quais lojas está. Requer `SUPABASE_SERVICE_ROLE_KEY` (para o caso de e-mail novo).
 */
users.post('/invite', async (c) => {
  const tenantId = getTenantId(c);
  const actorId = c.get('userId');
  const actorName = c.get('userName');
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
  const sent = () => c.json({ ok: true, data: { email, invited: true } }, 201);

  try {
    const prisma = getPrisma(c);
    const identity = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    const membership = identity
      ? await prisma.tenantMembership.findUnique({
          where: { userId_tenantId: { userId: identity.id, tenantId } },
          select: { status: true, isActive: true },
        })
      : null;
    const plan = planMembershipInvite(Boolean(identity), membership);

    if (plan === 'ALREADY_MEMBER') return sent();

    if (plan !== 'NEW_IDENTITY') {
      // Conta existente: convite PENDENTE (cria, renova papel ou reabre um vínculo revogado).
      await prisma.$transaction(async (tx) => {
        await tx.tenantMembership.upsert({
          where: { userId_tenantId: { userId: identity!.id, tenantId } },
          create: { userId: identity!.id, tenantId, role, status: 'PENDING', isActive: true, invitedByName: actorName },
          update: { role, status: 'PENDING', isActive: true, invitedByName: actorName },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            userId: actorId,
            entity: 'User',
            entityId: identity!.id,
            action: 'GRANT_MEMBERSHIP',
            meta: { email, roleAfter: role, pending: true, plan },
          },
        });
      });
      return sent();
    }

    // E-mail novo: convite do Auth + identidade com esta loja de casa (vínculo ACTIVE pelo gatilho da 0046).
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const authUserId = await inviteAuthUser(c.env, email, redirectTo, {
      store_name: tenant?.name ?? 'sua loja',
    });
    // O Auth pode já conhecer o e-mail sem haver linha em `users` com ele (e-mail trocado, conta antiga): se a
    // identidade existir pelo id, vira convite PENDENTE como qualquer conta existente.
    const linked = await prisma.user.findUnique({ where: { id: authUserId }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      if (linked) {
        await tx.tenantMembership.upsert({
          where: { userId_tenantId: { userId: authUserId, tenantId } },
          create: { userId: authUserId, tenantId, role, status: 'PENDING', isActive: true, invitedByName: actorName },
          update: { role, status: 'PENDING', isActive: true, invitedByName: actorName },
        });
      } else {
        await tx.user.create({
          data: {
            id: authUserId, // = auth.users.id (ADR-005)
            tenantId,
            name: name ?? email.split('@')[0] ?? email,
            email,
            role,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId: actorId,
          entity: 'User',
          entityId: authUserId,
          action: linked ? 'GRANT_MEMBERSHIP' : 'CHANGE_ROLE',
          meta: { invited: true, email, roleAfter: role, pending: Boolean(linked) },
        },
      });
    });
    return sent();
  } catch (err) {
    console.error('POST /users/invite falhou:', err);
    return c.json({ ok: false, error: 'Falha ao convidar o usuário.' }, 500);
  }
});

export default users;
