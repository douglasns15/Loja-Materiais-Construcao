import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  applyReceivablePayment,
  isValidReceipt,
  manualCashMovementType,
  receivableBalance,
} from '@nexoloja/core';
import { receiveReceivableSchema, updateReceivableSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const receivables = new Hono<Env>();
receivables.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

type Cursor = { createdAt: string; id: string };

/** Cursor keyset opaco (base64 de `createdAt|id`), como no Histórico de Vendas. */
function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(raw: string): Cursor | null {
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Lista as contas a receber (venda a prazo — ADR-019), **paginada por cursor keyset** (como as
 * demais telas grandes) em `createdAt desc, id desc`. Filtros: `status` = `open` (default) /
 * `paid` (quitadas) / `all` (abertas + quitadas); `q` busca por nome do cliente; `limit`/`cursor`.
 * Responde `{ rows, nextCursor }`. Cada linha traz o **saldo devedor** (fonte única do core) e o
 * nome do cliente. */
receivables.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const statusParam = c.req.query('status');
  const OPEN_PAID: ('OPEN' | 'PAID')[] = ['OPEN', 'PAID'];
  const statusWhere =
    statusParam === 'paid'
      ? { status: 'PAID' as const }
      : statusParam === 'all'
        ? { status: { in: OPEN_PAID } }
        : { status: 'OPEN' as const };

  const q = (c.req.query('q') ?? '').trim();
  const qWhere = q ? { customer: { name: { contains: q, mode: 'insensitive' as const } } } : {};

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
    const list = await prisma.receivable.findMany({
      where: { tenantId, ...statusWhere, ...qWhere, ...keyset },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        orderId: true,
        customerId: true,
        originalAmount: true,
        settledAmount: true,
        status: true,
        dueDate: true,
        createdAt: true,
        createdByName: true,
        customer: { select: { name: true } },
      },
    });
    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const rows = page.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      customerId: r.customerId,
      customerName: r.customer?.name ?? null,
      originalAmount: r.originalAmount,
      settledAmount: r.settledAmount,
      balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount)),
      status: r.status,
      dueDate: r.dueDate,
      createdAt: r.createdAt,
      createdByName: r.createdByName,
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows, nextCursor } });
  } catch (err) {
    console.error('GET /receivables falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar as contas a receber.' }, 500);
  }
});

/** Detalhe de uma conta a receber + o histórico de recebimentos (para o painel "Receber"). */
receivables.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const r = await prisma.receivable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        orderId: true,
        customerId: true,
        originalAmount: true,
        settledAmount: true,
        status: true,
        dueDate: true,
        notes: true,
        createdAt: true,
        createdByName: true,
        customer: { select: { name: true } },
        // Itens da venda de origem (a "dívida" detalhada) + o total da venda.
        order: {
          select: {
            total: true,
            createdAt: true,
            items: {
              select: {
                productName: true,
                unit: true,
                quantity: true,
                unitPrice: true,
                total: true,
                pairGroup: true,
              },
            },
            payments: { select: { method: true, amount: true } },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
          select: {
            id: true,
            amount: true,
            method: true,
            paidAt: true,
            receivedByName: true,
            reference: true,
          },
        },
      },
    });
    if (!r) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    return c.json({
      ok: true,
      data: {
        id: r.id,
        orderId: r.orderId,
        customerId: r.customerId,
        customerName: r.customer?.name ?? null,
        originalAmount: r.originalAmount,
        settledAmount: r.settledAmount,
        balance: receivableBalance(Number(r.originalAmount), Number(r.settledAmount)),
        status: r.status,
        dueDate: r.dueDate,
        notes: r.notes,
        createdAt: r.createdAt,
        createdByName: r.createdByName,
        orderTotal: r.order?.total ?? null,
        orderCreatedAt: r.order?.createdAt ?? null,
        items: r.order?.items ?? [],
        orderPayments: r.order?.payments ?? [],
        payments: r.payments,
      },
    });
  } catch (err) {
    console.error('GET /receivables/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a conta.' }, 500);
  }
});

/** Atualiza a observação livre de uma dívida (ADR-019). Qualquer operador (é anotação de balcão). */
receivables.patch('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }
  const parsed = updateReceivableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados inválidos.' }, 400);
  }
  const notes = parsed.data.notes?.trim() ? parsed.data.notes.trim() : null;

  try {
    const prisma = createPrismaClient(connectionString);
    // Garante que a conta é da loja antes de atualizar (RLS reforçado no código).
    const found = await prisma.receivable.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    await prisma.receivable.update({ where: { id }, data: { notes } });
    return c.json({ ok: true, data: { id, notes } });
  } catch (err) {
    console.error('PATCH /receivables/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar a observação.' }, 500);
  }
});

/** Registra um recebimento (total ou parcial) de uma conta a receber (ADR-019). Em transação:
 * grava o `ReceivablePayment`, abate o saldo (`applyReceivablePayment` do core → OPEN/PAID) e, se
 * for em DINHEIRO, lança um `CashMovement SUPPLY` no caixa aberto (reúso da CX.Movimentacao) — por
 * isso o recebimento em dinheiro EXIGE caixa aberto. O `paidAt` (agora) é o dia do recebimento, que
 * o relatório usa para contar o fiado como recebido NAQUELE dia (regime de caixa). */
receivables.post('/:id/receive', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
  }

  const parsed = receiveReceivableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados do recebimento inválidos.' }, 400);
  }
  const { amount, method, reference } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const receivable = await prisma.receivable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        orderId: true,
        originalAmount: true,
        settledAmount: true,
        status: true,
        customer: { select: { name: true } },
      },
    });
    if (!receivable) {
      return c.json({ ok: false, error: 'Conta não encontrada.' }, 404);
    }
    if (receivable.status !== 'OPEN') {
      return c.json({ ok: false, error: 'Esta conta não está em aberto.' }, 409);
    }

    const original = Number(receivable.originalAmount);
    const settled = Number(receivable.settledAmount);
    const balance = receivableBalance(original, settled);
    if (!isValidReceipt(amount, balance)) {
      return c.json(
        { ok: false, error: `Valor inválido: o saldo devedor é ${balance.toFixed(2)}.` },
        400,
      );
    }

    // Recebimento em dinheiro precisa de caixa aberto (é onde o dinheiro entra — ADR-018).
    let openSessionId: string | null = null;
    if (method === 'CASH') {
      const session = await prisma.cashSession.findFirst({
        where: { tenantId, closedAt: null },
        select: { id: true },
      });
      if (!session) {
        return c.json(
          { ok: false, error: 'Abra o caixa para receber em dinheiro.' },
          404,
        );
      }
      openSessionId = session.id;
    }

    const next = applyReceivablePayment(original, settled, amount);

    const result = await prisma.$transaction(async (tx) => {
      // Em dinheiro: entra no caixa de HOJE como Suprimento (reúso da CX.Movimentacao). Cartão/PIX
      // não tocam a gaveta — só o registro do recebimento (e o relatório em regime de caixa).
      let cashMovementId: string | null = null;
      if (method === 'CASH' && openSessionId) {
        const movement = await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: openSessionId,
            userId,
            type: manualCashMovementType('SUPPLY'), // INCOME
            kind: 'SUPPLY',
            amount,
            reason: `Recebimento a prazo — ${receivable.customer?.name ?? 'cliente'}`,
            // NÃO setar `relatedOrderId` aqui: esse campo, num lançamento manual (SUPPLY/WITHDRAWAL),
            // é o marcador de ESTORNO (isReversalRow) — usá-lo faria o recebimento aparecer como
            // "Estorno de Sangria" no extrato. O elo com a venda existe pelo outro lado
            // (ReceivablePayment.cashMovementId → receivable → order). É um Suprimento comum.
            syncStatus: 'SYNCED',
            registeredByName: c.get('userName'), // autoria (ADR-010)
          },
        });
        cashMovementId = movement.id;
      }

      const payment = await tx.receivablePayment.create({
        data: {
          tenantId,
          receivableId: receivable.id,
          amount,
          method,
          reference: reference ?? null,
          cashSessionId: openSessionId,
          cashMovementId,
          receivedById: userId, // autoria (ADR-010)
          receivedByName: c.get('userName'),
        },
      });

      const updated = await tx.receivable.update({
        where: { id: receivable.id },
        data: { settledAmount: next.settledAmount, status: next.status },
        select: { id: true, originalAmount: true, settledAmount: true, status: true },
      });

      return { payment, updated };
    });

    return c.json(
      {
        ok: true,
        data: {
          ...result.updated,
          balance: receivableBalance(
            Number(result.updated.originalAmount),
            Number(result.updated.settledAmount),
          ),
          fullyPaid: next.fullyPaid,
          paymentId: result.payment.id,
        },
      },
      201,
    );
  } catch (err) {
    console.error('POST /receivables/:id/receive falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar o recebimento.' }, 500);
  }
});

export default receivables;
