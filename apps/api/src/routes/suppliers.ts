import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { createSupplierSchema, updateSupplierSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const suppliers = new Hono<Env>();

// Todas as rotas de fornecedores exigem autenticação (JWT do Supabase).
suppliers.use('*', requireAuth);

/** Lista fornecedores ativos (não deletados) do tenant. */
suppliers.get('/', async (c) => {
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
    const items = await prisma.supplier.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return c.json({ ok: true, data: items });
  } catch (err) {
    console.error('GET /suppliers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar fornecedores.' }, 500);
  }
});

/** Detalhe de um fornecedor. */
suppliers.get('/:id', async (c) => {
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
    const item = await prisma.supplier.findFirst({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
    });
    if (!item) {
      return c.json({ ok: false, error: 'Fornecedor não encontrado.' }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    console.error('GET /suppliers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o fornecedor.' }, 500);
  }
});

/** Cria um fornecedor. */
suppliers.post('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const created = await prisma.supplier.create({
      data: { ...parsed.data, tenantId },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ ok: false, error: 'Já existe um fornecedor com esse CNPJ.' }, 409);
      }
      if (err.code === 'P2003') {
        return c.json({ ok: false, error: 'Tenant inexistente.' }, 400);
      }
    }
    console.error('POST /suppliers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar o fornecedor.' }, 500);
  }
});

/** Atualiza um fornecedor (parcial). */
suppliers.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateSupplierSchema.safeParse(body);
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
    const result = await prisma.supplier.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: parsed.data,
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Fornecedor não encontrado.' }, 404);
    }
    const updated = await prisma.supplier.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe um fornecedor com esse CNPJ.' }, 409);
    }
    console.error('PATCH /suppliers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o fornecedor.' }, 500);
  }
});

/** Soft-delete (ADR-004): marca `deletedAt`. */
suppliers.delete('/:id', async (c) => {
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
    const result = await prisma.supplier.updateMany({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Fornecedor não encontrado.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /suppliers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover o fornecedor.' }, 500);
  }
});

export default suppliers;
