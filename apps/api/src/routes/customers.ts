import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { receivableBalance } from '@nexoloja/core';
import { createCustomerSchema, updateCustomerSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const customers = new Hono<Env>();

// Todas as rotas de clientes exigem autenticação (JWT do Supabase).
customers.use('*', requireAuth);

/** Página do cadastro: default 20, teto 50 (evita respostas gigantes conforme a base cresce). */
const CUSTOMERS_PAGE_DEFAULT = 20;
const CUSTOMERS_PAGE_MAX = 50;

/**
 * Cursor keyset (não OFFSET, que degrada com a base): a posição é o par `nome|id` da última
 * linha, ordenado por `name asc, id asc`. O nome é `encodeURIComponent`-ado porque pode conter
 * o separador `|`; o `id` (UUID) nunca contém. Opaco para o cliente.
 */
function encodeCursor(o: { name: string; id: string }): string {
  return `${encodeURIComponent(o.name)}|${o.id}`;
}
function decodeCursor(cursor: string): { name: string; id: string } | null {
  const sep = cursor.indexOf('|');
  if (sep < 0) return null;
  const id = cursor.slice(sep + 1);
  if (!id) return null;
  try {
    return { name: decodeURIComponent(cursor.slice(0, sep)), id };
  } catch {
    return null;
  }
}

/**
 * Lista clientes ativos (não deletados) do tenant — **busca no servidor + paginação keyset**.
 * Aceita `q` (nome/e-mail case-insensitive; CPF/CNPJ e telefone por dígitos), `limit` e `cursor`
 * (opaco) e responde `{ rows, nextCursor }` (`nextCursor: null` na última página). Substitui o
 * "lista tudo" anterior: a tela de Clientes procura em vez de rolar, então nunca baixa a base
 * inteira de uma vez.
 */
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

    const limitRaw = Number(c.req.query('limit'));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), CUSTOMERS_PAGE_MAX)
        : CUSTOMERS_PAGE_DEFAULT;

    const q = c.req.query('q')?.trim();
    const digits = q ? q.replace(/\D+/g, '') : '';
    const insensitive = Prisma.QueryMode.insensitive;
    const search = q
      ? {
          OR: [
            { name: { contains: q, mode: insensitive } },
            { email: { contains: q, mode: insensitive } },
            // CPF/CNPJ e telefone são guardados só com dígitos (forma canônica) — compara por dígitos.
            ...(digits ? [{ cpfCnpj: { contains: digits } }, { phone: { contains: digits } }] : []),
          ],
        }
      : {};

    const cursorParam = c.req.query('cursor');
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    // Keyset: só as linhas APÓS o cursor em (name asc, id asc).
    const keyset = cursor
      ? {
          OR: [
            { name: { gt: cursor.name } },
            { name: cursor.name, id: { gt: cursor.id } },
          ],
        }
      : {};

    // `take: limit + 1`: a linha extra só sinaliza se há próxima página.
    const list = await prisma.customer.findMany({
      where: { tenantId, deletedAt: null, ...search, ...keyset },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasMore = list.length > limit;
    const rows = hasMore ? list.slice(0, limit) : list;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows, nextCursor } });
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

/** Histórico do cliente (perfil): tudo que está vinculado a ele — suas **vendas** (mais recentes)
 * e suas **contas a receber** (ADR-019), com a ativa destacável. Alimenta a tela de perfil do
 * cliente aberta ao clicar no nome na tela de Clientes. Limita as vendas para não pesar. */
customers.get('/:id/history', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Cliente não encontrado.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const [orders, receivables] = await Promise.all([
      // Vendas do cliente (mais recentes; teto de 50 — é um resumo, não o Histórico completo).
      prisma.order.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          total: true,
          status: true,
          createdAt: true,
          receivable: { select: { id: true, status: true } },
        },
      }),
      // Contas a receber do cliente (todas as situações), da mais recente para a mais antiga.
      prisma.receivable.findMany({
        where: { tenantId, customerId: id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          originalAmount: true,
          settledAmount: true,
          status: true,
          dueDate: true,
          createdAt: true,
        },
      }),
    ]);

    return c.json({
      ok: true,
      data: {
        orders: orders.map((o) => ({
          id: o.id,
          total: o.total,
          status: o.status,
          createdAt: o.createdAt,
          receivableId: o.receivable?.id ?? null,
          receivableStatus: o.receivable?.status ?? null,
        })),
        receivables: receivables.map((r) => ({
          id: r.id,
          originalAmount: r.originalAmount,
          settledAmount: r.settledAmount,
          balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount)),
          status: r.status,
          dueDate: r.dueDate,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (err) {
    console.error('GET /customers/:id/history falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o histórico do cliente.' }, 500);
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
    // Autoria (ADR-010): na criação, criado = alterado (mesmo operador/nome-snapshot).
    const userId = c.get('userId');
    const userName = c.get('userName');
    const created = await prisma.customer.create({
      data: {
        ...parsed.data,
        tenantId,
        createdById: userId,
        createdByName: userName,
        updatedById: userId,
        updatedByName: userName,
      },
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
      // Autoria (ADR-010): registra quem alterou por último + snapshot do nome.
      data: { ...parsed.data, updatedById: c.get('userId'), updatedByName: c.get('userName') },
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
      // Autoria (ADR-010): quem excluiu + snapshot (o "quando" é o próprio deletedAt).
      data: { deletedAt: new Date(), deletedById: c.get('userId'), deletedByName: c.get('userName') },
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
