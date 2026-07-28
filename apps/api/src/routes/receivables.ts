import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  applyReceivablePayment,
  isValidReceipt,
  manualCashMovementType,
  receivableBalance,
} from '@nexoloja/core';
import { receiveReceivableSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const receivables = new Hono<Env>();
receivables.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lista as contas a receber (venda a prazo / fiado — ADR-019). Sem parâmetro → só as EM ABERTO
 * (o caso de uso: quem ainda deve). `?status=all` traz também quitadas/canceladas. Cada linha já
 * traz o **saldo devedor** calculado (fonte única `receivableBalance` do core) e o nome do cliente
 * (snapshot p/ a lista), ordenadas por vencimento (nulos por último) e depois pela mais antiga. */
receivables.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const statusParam = c.req.query('status');
  const onlyOpen = statusParam !== 'all';

  try {
    const prisma = createPrismaClient(connectionString);
    const rows = await prisma.receivable.findMany({
      where: { tenantId, ...(onlyOpen ? { status: 'OPEN' } : {}) },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
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
    const data = rows.map((r) => ({
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
    return c.json({ ok: true, data });
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
        createdAt: true,
        createdByName: true,
        customer: { select: { name: true } },
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
        createdAt: r.createdAt,
        createdByName: r.createdByName,
        payments: r.payments,
      },
    });
  } catch (err) {
    console.error('GET /receivables/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar a conta.' }, 500);
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
            reason: `Recebimento de fiado — ${receivable.customer?.name ?? 'cliente'}`,
            relatedOrderId: receivable.orderId, // elo com a venda de origem (referência solta)
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
