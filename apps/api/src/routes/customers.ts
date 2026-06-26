import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { createCustomerSchema, updateCustomerSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';

const customers = new Hono<Env>();

/** Lista clientes ativos (não deletados) do tenant. */
customers.get('/', async (c) => {
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
    const items = await prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 100,
    });
    return c.json({ ok: true, data: items });
  } catch (err) {
    console.error('GET /customers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar clientes.' }, 500);
  }
});

/** Detalhe de um cliente. */
customers.get('/:id', async (c) => {
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
    const item = await prisma.customer.findFirst({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
    });
    if (!item) {
      return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
    }
    return c.json({ ok: true, data: item });
  } catch (err) {
    console.error('GET /customers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o cliente.' }, 500);
  }
});

/** Cria um cliente. */
customers.post('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const created = await prisma.customer.create({
      data: { ...parsed.data, tenantId },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ ok: false, error: 'Já existe um cliente com esse CPF/CNPJ.' }, 409);
      }
      if (err.code === 'P2003') {
        return c.json({ ok: false, error: 'Tenant inexistente.' }, 400);
      }
    }
    console.error('POST /customers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao criar o cliente.' }, 500);
  }
});

/** Atualiza um cliente (parcial). */
customers.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) {
    return c.json({ ok: false, error: 'Header x-tenant-id ausente ou inválido.' }, 400);
  }
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    return c.json({ ok: false, error: 'Sem conexão com o banco.' }, 500);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateCustomerSchema.safeParse(body);
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
    const result = await prisma.customer.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: parsed.data,
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
    }
    const updated = await prisma.customer.findFirst({ where: { id, tenantId } });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ ok: false, error: 'Já existe um cliente com esse CPF/CNPJ.' }, 409);
    }
    console.error('PATCH /customers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o cliente.' }, 500);
  }
});

/** Soft-delete (ADR-004): marca `deletedAt`. */
customers.delete('/:id', async (c) => {
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
    const result = await prisma.customer.updateMany({
      where: { id: c.req.param('id'), tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) {
      return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /customers/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao remover o cliente.' }, 500);
  }
});

export default customers;
