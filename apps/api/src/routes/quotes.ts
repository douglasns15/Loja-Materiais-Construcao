import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcSaleItemTotal, calcSaleTotals } from '@nexoloja/core';
import {
  createQuoteSchema,
  parseQuoteNumberQuery,
  updateQuoteSchema,
  type QuoteEffectiveStatus,
  type QuoteStatus,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const quotes = new Hono<Env>();
quotes.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

/** Cursor keyset opaco (base64 de `createdAt|id`), como no Histórico/Contas a Receber. */
function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(raw: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Converte AAAA-MM-DD (opcional) em filtro de data nas bordas do fuso da loja (UTC-3), mesmo critério
 * do Histórico de Vendas.
 */
function buildDateFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) filter.gte = new Date(`${from}T00:00:00.000-03:00`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) filter.lte = new Date(`${to}T23:59:59.999-03:00`);
  return filter.gte || filter.lte ? filter : undefined;
}

/** Status EFETIVO (ADR-024): "Expirado" é DERIVADO de `validUntil` (não é gravado). Um orçamento
 *  aberto (DRAFT/SENT/ACCEPTED) com validade vencida aparece como EXPIRED. */
function effectiveStatus(status: QuoteStatus, validUntil: Date | null): QuoteEffectiveStatus {
  const open = status === 'DRAFT' || status === 'SENT' || status === 'ACCEPTED';
  if (open && validUntil && validUntil.getTime() < Date.now()) return 'EXPIRED';
  return status;
}

/** Monta o filtro de `status` para a busca, alinhado ao status EFETIVO (o que a tela mostra):
 *  - `EXPIRED`: abertos (DRAFT/SENT/ACCEPTED) com validade vencida.
 *  - aberto (DRAFT/SENT/ACCEPTED): o status gravado E ainda NÃO vencido.
 *  - `REJECTED`/`CONVERTED`: só o status gravado. */
function statusWhere(status: string | undefined): object {
  const now = new Date();
  const openNotExpired = { OR: [{ validUntil: null }, { validUntil: { gte: now } }] };
  switch (status) {
    case 'EXPIRED':
      return { status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] as QuoteStatus[] }, validUntil: { lt: now } };
    case 'DRAFT':
    case 'SENT':
    case 'ACCEPTED':
      return { status: status as QuoteStatus, ...openNotExpired };
    case 'REJECTED':
    case 'CONVERTED':
      return { status: status as QuoteStatus };
    default:
      return {};
  }
}

/**
 * Lista os orçamentos (`GET /quotes`) — paginado por cursor keyset (createdAt desc, id desc). Filtros:
 * `q` (nome do cliente), `status` (inclui o derivado EXPIRED), `from`/`to` (fuso da loja) e `number`
 * (busca por código O-000045). Responde `{ rows, nextCursor }`. Só não-excluídos.
 */
quotes.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const q = (c.req.query('q') ?? '').trim();
  const qWhere = q ? { customer: { name: { contains: q, mode: 'insensitive' as const } } } : {};
  const stWhere = statusWhere(c.req.query('status'));
  const dateFilter = buildDateFilter(c.req.query('from'), c.req.query('to'));
  const quoteNumber = parseQuoteNumberQuery(c.req.query('number'));

  const limitRaw = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), PAGE_MAX) : PAGE_DEFAULT;
  const cursorParam = c.req.query('cursor');
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  const keyset = cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      }
    : {};

  try {
    const prisma = createPrismaClient(connectionString);
    const list = await prisma.quote.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...qWhere,
        ...stWhere,
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        ...(quoteNumber ? { quoteNumber } : {}),
        ...keyset,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        quoteNumber: true,
        customerId: true,
        status: true,
        total: true,
        validUntil: true,
        createdAt: true,
        createdByName: true,
        convertedOrderId: true,
        customer: { select: { name: true } },
        convertedOrder: { select: { orderNumber: true } },
      },
    });
    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const rows = page.map((row) => ({
      id: row.id,
      quoteNumber: row.quoteNumber,
      customerId: row.customerId,
      customerName: row.customer?.name ?? null,
      status: row.status,
      effectiveStatus: effectiveStatus(row.status, row.validUntil),
      total: row.total,
      validUntil: row.validUntil,
      createdAt: row.createdAt,
      createdByName: row.createdByName,
      convertedOrderId: row.convertedOrderId,
      convertedOrderNumber: row.convertedOrder?.orderNumber ?? null,
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows, nextCursor } });
  } catch (err) {
    console.error('GET /quotes falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar os orçamentos.' }, 500);
  }
});

/** Detalhe de um orçamento (`GET /quotes/:id`) — cabeçalho + itens (snapshot). */
quotes.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const row = await prisma.quote.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        quoteNumber: true,
        customerId: true,
        status: true,
        subtotal: true,
        discountAmount: true,
        total: true,
        validUntil: true,
        notes: true,
        createdAt: true,
        createdByName: true,
        convertedOrderId: true,
        customer: { select: { name: true } },
        convertedOrder: { select: { orderNumber: true } },
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            unit: true,
            saleMode: true,
            quantity: true,
            unitPrice: true,
            discount: true,
            total: true,
            pairGroup: true,
          },
        },
      },
    });
    if (!row) {
      return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
    }
    return c.json({
      ok: true,
      data: {
        id: row.id,
        quoteNumber: row.quoteNumber,
        customerId: row.customerId,
        customerName: row.customer?.name ?? null,
        status: row.status,
        effectiveStatus: effectiveStatus(row.status, row.validUntil),
        subtotal: row.subtotal,
        discountAmount: row.discountAmount,
        total: row.total,
        validUntil: row.validUntil,
        notes: row.notes,
        createdAt: row.createdAt,
        createdByName: row.createdByName,
        convertedOrderId: row.convertedOrderId,
        convertedOrderNumber: row.convertedOrder?.orderNumber ?? null,
        items: row.items,
      },
    });
  } catch (err) {
    console.error('GET /quotes/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o orçamento.' }, 500);
  }
});

/**
 * Salva um orçamento (`POST /quotes`). Nasce DRAFT. Aloca o número sequencial da loja de forma ATÔMICA
 * (mesmo motor do ADR-023: `UPDATE tenants SET lastQuoteNumber+1 RETURNING` sob lock da linha, dentro da
 * transação). SEM efeito de estoque (proposta). Totais recalculados no servidor (fonte única do core).
 * `requireActiveTenant` barra loja inativa (ADR-009).
 */
quotes.post('/', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = createQuoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados do orçamento inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const quote = parsed.data;

  // Totais recalculados no servidor (mesma função da venda — coerência tela/servidor).
  const { subtotal, total } = calcSaleTotals(quote.items, { discountAmount: quote.discountAmount });
  if (total < 0) {
    return c.json({ ok: false, error: 'O desconto não pode ser maior que o subtotal.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // Cliente informado precisa ser da loja (quando presente).
    if (quote.customerId) {
      const cust = await prisma.customer.findFirst({
        where: { id: quote.customerId, tenantId },
        select: { id: true },
      });
      if (!cust) {
        return c.json({ ok: false, error: 'Cliente não encontrado.' }, 400);
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      // ADR-024/023: aloca o número do orçamento de forma atômica (lock da linha do tenant).
      const { lastQuoteNumber } = await tx.tenant.update({
        where: { id: tenantId },
        data: { lastQuoteNumber: { increment: 1 } },
        select: { lastQuoteNumber: true },
      });

      return tx.quote.create({
        data: {
          tenantId,
          quoteNumber: lastQuoteNumber,
          customerId: quote.customerId ?? null,
          status: 'DRAFT',
          subtotal,
          discountAmount: quote.discountAmount ?? 0,
          total,
          validUntil: quote.validUntil ? new Date(`${quote.validUntil}T23:59:59.999-03:00`) : null,
          notes: quote.notes ?? null,
          createdById: userId,
          createdByName: c.get('userName'),
          items: {
            create: quote.items.map((it) => ({
              tenantId, // denormalizado (ADR-003)
              productId: it.productId ?? null,
              productName: it.productName,
              unit: it.unit,
              saleMode: it.saleMode ?? null,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discount: it.discount ?? 0,
              total: calcSaleItemTotal(it), // fonte única do core (arredonda por linha)
              pairGroup: it.pairGroup ?? null,
            })),
          },
        },
        select: { id: true, quoteNumber: true },
      });
    });

    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    console.error('POST /quotes falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar o orçamento.' }, 500);
  }
});

/**
 * Atualiza um orçamento (`PATCH /quotes/:id`) — status (Enviado/Aceito/Recusado/volta a Rascunho),
 * validade e observação. `CONVERTED` não é setável aqui (só a venda o define). Orçamento já convertido
 * é imutável.
 */
quotes.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
  }
  const parsed = updateQuoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const patch = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const existing = await prisma.quote.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) {
      return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
    }
    if (existing.status === 'CONVERTED') {
      return c.json({ ok: false, error: 'Orçamento já convertido em venda; não pode ser alterado.' }, 409);
    }

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.validUntil !== undefined
          ? { validUntil: patch.validUntil ? new Date(`${patch.validUntil}T23:59:59.999-03:00`) : null }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      },
      select: { id: true, status: true, validUntil: true, notes: true },
    });
    return c.json({
      ok: true,
      data: {
        id: updated.id,
        status: updated.status,
        effectiveStatus: effectiveStatus(updated.status, updated.validUntil),
        validUntil: updated.validUntil,
        notes: updated.notes,
      },
    });
  } catch (err) {
    console.error('PATCH /quotes/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao atualizar o orçamento.' }, 500);
  }
});

/**
 * Exclui (soft-delete) um orçamento (`DELETE /quotes/:id`) — para descartar um rascunho criado por
 * engano (ADR-004). Orçamento já convertido em venda é preservado (não se apaga o histórico).
 */
quotes.delete('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const existing = await prisma.quote.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) {
      return c.json({ ok: false, error: 'Orçamento não encontrado.' }, 404);
    }
    if (existing.status === 'CONVERTED') {
      return c.json({ ok: false, error: 'Orçamento já convertido em venda; não pode ser excluído.' }, 409);
    }
    await prisma.quote.update({ where: { id }, data: { deletedAt: new Date() } });
    return c.json({ ok: true, data: { id } });
  } catch (err) {
    console.error('DELETE /quotes/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao excluir o orçamento.' }, 500);
  }
});

export default quotes;
