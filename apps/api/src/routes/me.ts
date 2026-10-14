import { Hono } from 'hono';

import {
  activeModuleKeys,
  isOfflineSalesOn,
  MODULE_SCALE_LABEL,
  parseScaleLabelLayout,
  toStoreRole,
  updateMeSchema,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireAuth, requireIdentity } from '../middleware/auth';

const me = new Hono<Env>();

/** Loja da lista do seletor (ADR-014): id, nome, papel NELA e se está ativa (ADR-009). */
function toStoreList(memberships: Env['Variables']['memberships']) {
  return memberships.map((m) => ({
    tenantId: m.tenantId,
    name: m.tenant.name,
    role: m.role,
    storeRole: toStoreRole(m.role),
    tenantActive: m.tenant.isActive,
  }));
}

/**
 * Lojas a que a pessoa tem acesso (ADR-014, Fatia 2) — para o SELETOR de loja no login e o "trocar de
 * loja" no topo. Só exige a identidade (`requireIdentity`): é chamada justamente quando ainda não há
 * loja ativa escolhida (o `requireAuth` responderia 409). Não toca dado de loja.
 */
me.get('/stores', requireIdentity, (c) => c.json({ ok: true, data: toStoreList(c.get('memberships')) }));

/**
 * Convites PENDENTES da pessoa (ADR-014 §4, Fatia 4) — "Você foi convidado para a Loja X". Mostra a loja, o papel
 * oferecido e quem convidou (snapshot). Só identidade: aparece no seletor, antes de escolher a loja.
 */
me.get('/invites', requireIdentity, async (c) => {
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.tenantMembership.findMany({
      where: { userId: c.get('userId'), status: 'PENDING', isActive: true },
      select: { tenantId: true, role: true, invitedByName: true, createdAt: true, tenant: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return c.json({
      ok: true,
      data: rows.map((r) => ({
        tenantId: r.tenantId,
        name: r.tenant.name,
        role: r.role,
        storeRole: toStoreRole(r.role),
        invitedByName: r.invitedByName,
        invitedAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('GET /me/invites falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar os convites.' }, 500);
  }
});

/**
 * Responde a um convite: `accept` ⇒ vínculo ACTIVE (a loja entra na lista); `decline` ⇒ vínculo apagado (nada muda
 * para a pessoa). Só o PRÓPRIO convidado responde, e só convite pendente. `AuditEvent ACCEPT_/DECLINE_MEMBERSHIP` na
 * trilha da loja que convidou (ADR-004).
 */
me.post('/invites/:tenantId/:answer', requireIdentity, async (c) => {
  const answer = c.req.param('answer');
  if (answer !== 'accept' && answer !== 'decline') {
    return c.json({ ok: false, error: 'Resposta inválida.' }, 400);
  }
  const userId = c.get('userId');
  const tenantId = c.req.param('tenantId');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return c.json({ ok: false, error: 'Convite não encontrado.' }, 404);
  try {
    const prisma = getPrisma(c);
    const invite = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId, status: 'PENDING', isActive: true },
      select: { id: true, role: true },
    });
    if (!invite) return c.json({ ok: false, error: 'Convite não encontrado.' }, 404);
    await prisma.$transaction(async (tx) => {
      if (answer === 'accept') {
        await tx.tenantMembership.update({ where: { id: invite.id }, data: { status: 'ACTIVE' } });
      } else {
        await tx.tenantMembership.delete({ where: { id: invite.id } });
      }
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId,
          entity: 'User',
          entityId: userId,
          action: answer === 'accept' ? 'ACCEPT_MEMBERSHIP' : 'DECLINE_MEMBERSHIP',
          meta: { role: invite.role },
        },
      });
    });
    return c.json({ ok: true, data: { tenantId, accepted: answer === 'accept' } });
  } catch (err) {
    console.error('POST /me/invites falhou:', err);
    return c.json({ ok: false, error: 'Falha ao responder o convite.' }, 500);
  }
});

/**
 * A própria pessoa SAI de uma loja (ADR-014 §5a). Só com 2+ lojas (sair da única deixaria a conta sem acesso — isso
 * é com o administrador) e nunca como DONO (toda loja mantém um dono). O histórico dela na loja fica intacto.
 */
me.post('/stores/:tenantId/leave', requireIdentity, async (c) => {
  const userId = c.get('userId');
  const tenantId = c.req.param('tenantId');
  const stores = c.get('memberships');
  const target = stores.find((m) => m.tenantId === tenantId);
  if (!target) return c.json({ ok: false, error: 'Você não tem acesso a esta loja.' }, 404);
  if (target.role === 'OWNER') {
    return c.json({ ok: false, error: 'O dono não pode sair da própria loja.' }, 400);
  }
  if (stores.length < 2) {
    return c.json({ ok: false, error: 'Esta é a sua única loja. Para sair, fale com o administrador.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    await prisma.$transaction(async (tx) => {
      await tx.tenantMembership.delete({ where: { userId_tenantId: { userId, tenantId } } });
      await tx.auditEvent.create({
        data: { tenantId, userId, entity: 'User', entityId: userId, action: 'REVOKE_MEMBERSHIP', meta: { self: true, roleBefore: target.role } },
      });
    });
    return c.json({ ok: true, data: { tenantId, left: true } });
  } catch (err) {
    console.error('POST /me/stores/:tenantId/leave falhou:', err);
    return c.json({ ok: false, error: 'Falha ao sair da loja.' }, 500);
  }
});

// Demais rotas de `/me`: perfil na LOJA ATIVA.
me.use('/', requireAuth);

// Identidade da pessoa; o papel vem do vínculo da loja ativa (ADR-014), nunca de `users`.
const SELECT = { id: true, name: true, email: true, phone: true } as const;

/** Perfil do usuário autenticado — usado pelo front para RBAC e tela "Meus dados". */
me.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
    if (!user) {
      return c.json({ ok: false, error: 'Usuário não encontrado.' }, 404);
    }
    // `offlineSales` (ADR-011 §9): o PDV usa para decidir se enfileira venda offline (ON) ou
    // orienta nota manual (OFF). Gate = existência ATIVA da linha `OFFLINE_SALES` em
    // `TenantModule` (ausência/inativa = OFF). `modules` (ADR-039): chaves de TODOS os módulos
    // ativos, para a web esconder o que o ramo não usa. Uma query só (poucas linhas por loja).
    const modules = await prisma.tenantModule.findMany({
      where: { tenantId, isActive: true },
      select: { moduleKey: true, isActive: true, config: true },
    });
    // Etiqueta de balança (ADR-040 §3): layout da loja p/ o PDV ler a etiqueta (também offline, pelo
    // cache do `/me`). `null` = módulo desligado.
    const scaleModule = modules.find((m) => m.moduleKey === MODULE_SCALE_LABEL);
    // `tenantActive` (ADR-009): o front usa para avisar no topo e bloquear vendas novas quando
    // a loja está desativada. Vem do `requireAuth` (sem query extra).
    // Multi-loja (ADR-014): o papel é o do vínculo da LOJA ATIVA (Dono numa, Caixa noutra), não o
    // `users.role`; `stores` = todas as lojas da pessoa (o shell mostra "trocar de loja" com 2+).
    const role = c.get('role');
    const stores = toStoreList(c.get('memberships'));
    return c.json({
      ok: true,
      data: {
        ...user,
        role,
        storeRole: toStoreRole(role),
        activeTenantId: tenantId,
        tenantName: stores.find((s) => s.tenantId === tenantId)?.name ?? null,
        stores,
        // Convites aguardando resposta (ADR-014 Fatia 4) — o topo do app avisa e leva ao seletor.
        pendingInvites: await prisma.tenantMembership.count({
          where: { userId, status: 'PENDING', isActive: true },
        }),
        tenantActive: c.get('tenantActive'),
        offlineSales: isOfflineSalesOn(modules),
        modules: activeModuleKeys(modules),
        scaleLabel: scaleModule ? parseScaleLabelLayout(scaleModule.config) : null,
      },
    });
  } catch (err) {
    console.error('GET /me falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar o perfil.' }, 500);
  }
});

/** Edita o próprio perfil (nome/telefone). A senha é trocada no cliente via Supabase Auth. */
me.patch('/', async (c) => {
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!userId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateMeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = getPrisma(c);
    await prisma.user.update({ where: { id: userId }, data: parsed.data, select: { id: true } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
    // Papel da LOJA ATIVA (ADR-014), como no `GET /me`.
    const role = c.get('role');
    return c.json({ ok: true, data: user ? { ...user, role, storeRole: toStoreRole(role) } : null });
  } catch (err) {
    console.error('PATCH /me falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar o perfil.' }, 500);
  }
});

export default me;
