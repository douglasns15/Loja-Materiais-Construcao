import { Hono } from 'hono';
import { Prisma } from '@nexoloja/db';
import { receivableBalance } from '@nexoloja/core';
import { createCustomerSchema, updateCustomerSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Escapa os curingas do `LIKE`/`ILIKE` (`%`, `_`, `\`) para que o termo seja tratado como
 * texto literal (substring). Usa `\` como escape (o default do Postgres).
 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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
    const prisma = getPrisma(c);

    const limitRaw = Number(c.req.query('limit'));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), CUSTOMERS_PAGE_MAX)
        : CUSTOMERS_PAGE_DEFAULT;

    const q = c.req.query('q')?.trim();
    const digits = q ? q.replace(/\D+/g, '') : '';
    const cursorParam = c.req.query('cursor');
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;

    // Busca por NOME/E-MAIL tokenizada (AND, ordem-livre) e ACENTO-insensível (`extensions.unaccent`,
    // dobra acento nos dois lados) — "joão silva" acha "Maria João da Silva". CPF/CNPJ e telefone são
    // guardados só com dígitos (forma canônica), então casam por dígitos contínuos (não tokeniza). A
    // pessoa procura OU por texto OU por número. Montado com `Prisma.sql` (parametrizado ⇒ à prova de
    // injeção); keyset e ordenação (name asc, id asc) preservados.
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const conditions: Prisma.Sql[] = [
      Prisma.sql`c."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`c."deletedAt" IS NULL`,
    ];
    if (tokens.length > 0) {
      // Texto: TODOS os tokens em nome OU e-mail (unaccent). Dígitos: CPF/CNPJ OU telefone.
      const textMatch = Prisma.join(
        tokens.map((token) => {
          const pat = `%${likeEscape(token)}%`;
          return Prisma.sql`(
            extensions.unaccent(c."name") ILIKE extensions.unaccent(${pat})
            OR extensions.unaccent(coalesce(c."email", '')) ILIKE extensions.unaccent(${pat})
          )`;
        }),
        ' AND ',
      );
      const digitPat = `%${likeEscape(digits)}%`;
      const digitMatch = digits
        ? Prisma.sql`(c."cpfCnpj" LIKE ${digitPat} OR c."phone" LIKE ${digitPat})`
        : Prisma.sql`false`;
      conditions.push(Prisma.sql`((${textMatch}) OR ${digitMatch})`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(c."name" > ${cursor.name} OR (c."name" = ${cursor.name} AND c."id" > ${cursor.id}::uuid))`,
      );
    }

    // `LIMIT limit + 1`: a linha extra só sinaliza se há próxima página.
    const list = await prisma.$queryRaw<Array<Record<string, unknown> & { id: string; name: string }>>(
      Prisma.sql`
        SELECT * FROM "customers" c
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY c."name" ASC, c."id" ASC
        LIMIT ${limit + 1}
      `,
    );

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
    const prisma = getPrisma(c);
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
    const prisma = getPrisma(c);
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
          orderId: true,
          originalAmount: true,
          settledAmount: true,
          returnedAmount: true,
          status: true,
          dueDate: true,
          createdAt: true,
          order: { select: { orderNumber: true } }, // ADR-023: código humano da venda (V-000128)
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
          orderId: r.orderId,
          orderNumber: r.order?.orderNumber ?? null, // ADR-023
          originalAmount: r.originalAmount,
          settledAmount: r.settledAmount,
          balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount), Number(r.returnedAmount)),
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
    const prisma = getPrisma(c);
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
    const prisma = getPrisma(c);
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
    const prisma = getPrisma(c);
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
