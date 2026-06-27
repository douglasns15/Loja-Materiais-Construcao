import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { calcMarginPercent } from '@nexoloja/core';
import { createProductSchema, updateProductSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/** Acrescenta a margem calculada (regra pura de packages/core) ao produto. */
function withMargin<T extends { costPrice: unknown; salePrice: unknown }>(p: T) {
  return {
    ...p,
    marginPercent: calcMarginPercent(Number(p.costPrice), Number(p.salePrice)),
  };
}

const products = new Hono<Env>();

// Todas as rotas de produtos exigem autenticação (JWT do Supabase).
products.use('*', requireAuth);

/** Lista produtos ativos (não deletados) do tenant. */
products.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const items = await prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return c.json({ ok: true, data: items.map(withMargin) });
  } catch (err) {
    console.error('GET /products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar produtos.' }, 500);
  }
});

/** Detalhe de um produto. */
products.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const item = await prisma.product.findFirst({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
    });
    if (!item) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    return c.json({ ok: true, data: withMargin(item) });
  } catch (err) {
    console.error('GET /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o produto.' }, 500);
  }
});

/** Cria um produto. */
products.post('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const created = await prisma.product.create({
      data: { ...parsed.data, tenantId },
    });
    return c.json({ ok: true, data: withMargin(created) }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ ok: false, error: 'Já existe um produto com esse SKU.' }, 409);
      }
      if (err.code === 'P2003') {
        return c.json({ ok: false, error: 'Tenant ou categoria inexistente.' }, 400);
      }
    }
    console.error('POST /products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar o produto.' }, 500);
  }
});

/** Atualiza um produto (parcial). */
products.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const id = c.req.param('id');
    // updateMany garante o escopo do tenant (proteção antes do RLS da Fase 2).
    const result = await prisma.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: parsed.data,
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    const updated = await prisma.product.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated ? withMargin(updated) : null });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe um produto com esse SKU.' }, 409);
    }
    console.error('PATCH /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o produto.' }, 500);
  }
});

/** Soft-delete (ADR-004): marca `deletedAt`. */
products.delete('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const result = await prisma.product.updateMany({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /products/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover o produto.' }, 500);
  }
});

export default products;
