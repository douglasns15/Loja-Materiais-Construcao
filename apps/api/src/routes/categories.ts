import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { createCategorySchema, updateCategorySchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';

const categories = new Hono<Env>();

/** Lista categorias ativas (não deletadas) do tenant. */
categories.get('/', async (c) => {
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
    const items = await prisma.category.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return c.json({ ok: true, data: items });
  } catch (err) {
    console.error('GET /categories falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar categorias.' }, 500);
  }
});

/** Detalhe de uma categoria. */
categories.get('/:id', async (c) => {
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
    const item = await prisma.category.findFirst({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
    });
    if (!item) {
      return c.json({ ok: false, error: 'Categoria não encontrada.' }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    console.error('GET /categories/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a categoria.' }, 500);
  }
});

/** Cria uma categoria. */
categories.post('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // Garante que a categoria-pai (se houver) pertença ao mesmo tenant.
    if (parsed.data.parentId) {
      const parent = await prisma.category.findFirst({
        where: { id: parsed.data.parentId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) {
        return c.json({ ok: false, error: 'Categoria-pai inexistente.' }, 400);
      }
    }
    const created = await prisma.category.create({
      data: { ...parsed.data, tenantId },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe uma categoria com esse nome.' }, 409);
    }
    console.error('POST /categories falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar a categoria.' }, 500);
  }
});

/** Atualiza uma categoria (parcial). */
categories.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const id = c.req.param('id');
    if (parsed.data.parentId) {
      if (parsed.data.parentId === id) {
        return c.json({ ok: false, error: 'Uma categoria não pode ser pai de si mesma.' }, 400);
      }
      const parent = await prisma.category.findFirst({
        where: { id: parsed.data.parentId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) {
        return c.json({ ok: false, error: 'Categoria-pai inexistente.' }, 400);
      }
    }
    // updateMany garante o escopo do tenant (proteção antes do RLS da Fase 2).
    const result = await prisma.category.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: parsed.data,
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Categoria não encontrada.' }, 404);
    }
    const updated = await prisma.category.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe uma categoria com esse nome.' }, 409);
    }
    console.error('PATCH /categories/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar a categoria.' }, 500);
  }
});

/** Soft-delete (ADR-004): marca `deletedAt`. */
categories.delete('/:id', async (c) => {
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
    const result = await prisma.category.updateMany({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Categoria não encontrada.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /categories/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover a categoria.' }, 500);
  }
});

export default categories;
