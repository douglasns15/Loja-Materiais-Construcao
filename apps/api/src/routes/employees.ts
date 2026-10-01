import { Hono } from 'hono';
import { createEmployeeSchema, updateEmployeeSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireAdmin, requireAuth } from '../middleware/auth';

/**
 * Funcionários da loja (ADR-042) — cadastro simples, sem login (entregadores). Leitura para qualquer
 * usuário autenticado (o PDV lista os entregadores ao agendar a entrega); escrita só Admin (ADR-008).
 */
const employees = new Hono<Env>();
employees.use('*', requireAuth);

const SELECT = { id: true, name: true, phone: true, role: true, isActive: true } as const;

/** Lista os funcionários (não excluídos). `?activeOnly=true` traz só os ativos (seletor do PDV). */
employees.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const activeOnly = c.req.query('activeOnly') === 'true';
    const items = await prisma.employee.findMany({
      where: { tenantId, deletedAt: null, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: SELECT,
    });
    return c.json({ ok: true, data: items });
  } catch (err) {
    console.error('GET /employees falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar os funcionários.' }, 500);
  }
});

/** Cadastra um funcionário. Admin. */
employees.post('/', requireAdmin, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const parsed = createEmployeeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Informe o nome do funcionário.', issues: parsed.error.flatten() }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const created = await prisma.employee.create({
      data: {
        tenantId,
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        role: parsed.data.role,
        // Autoria (ADR-010): na criação, criado = alterado.
        createdById: c.get('userId'),
        createdByName: c.get('userName'),
        updatedById: c.get('userId'),
        updatedByName: c.get('userName'),
      },
      select: SELECT,
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    console.error('POST /employees falhou:', err);
    return c.json({ ok: false, error: 'Falha ao cadastrar o funcionário.' }, 500);
  }
});

/** Edita (parcial) — nome, telefone, função, ativo. Admin. */
employees.patch('/:id', requireAdmin, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const parsed = updateEmployeeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const id = c.req.param('id');
    const { phone, ...rest } = parsed.data;
    const result = await prisma.employee.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: {
        ...rest,
        ...(phone !== undefined ? { phone: phone || null } : {}),
        updatedById: c.get('userId'),
        updatedByName: c.get('userName'),
      },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Funcionário não encontrado.' }, 404);
    }
    const updated = await prisma.employee.findFirst({ where: { id, tenantId }, select: SELECT });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    console.error('PATCH /employees/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar o funcionário.' }, 500);
  }
});

/**
 * Exclui (soft-delete, ADR-004). As entregas que já apontam para ele mantêm o vínculo para o
 * histórico (a FK só zera num delete físico); ele some da lista e do seletor do PDV. Admin.
 */
employees.delete('/:id', requireAdmin, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const result = await prisma.employee.updateMany({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false, updatedById: c.get('userId'), updatedByName: c.get('userName') },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Funcionário não encontrado.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /employees/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao excluir o funcionário.' }, 500);
  }
});

export default employees;
