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
import { requireAuth } from '../middleware/auth';

const me = new Hono<Env>();
me.use('*', requireAuth);

const SELECT = { id: true, name: true, email: true, phone: true, role: true } as const;

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
    return c.json({
      ok: true,
      data: {
        ...user,
        storeRole: toStoreRole(user.role),
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
    await prisma.user.update({ where: { id: userId }, data: parsed.data });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
    return c.json({ ok: true, data: user ? { ...user, storeRole: toStoreRole(user.role) } : null });
  } catch (err) {
    console.error('PATCH /me falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar o perfil.' }, 500);
  }
});

export default me;
