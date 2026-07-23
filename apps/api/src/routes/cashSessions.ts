import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcCashDivergence, calcExpectedCash, netCashMovements } from '@nexoloja/core';
import { closeCashSessionSchema, openCashSessionSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const cashSessions = new Hono<Env>();
cashSessions.use('*', requireAuth);

/**
 * Soma das entradas em dinheiro (pagamentos CASH) dos pedidos da sessão.
 * Ignora vendas CANCELLED: ao cancelar, o dinheiro volta e o esperado recalcula
 * sozinho (os Payments seguem gravados para auditoria).
 */
async function cashInflow(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const agg = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: {
      tenantId,
      method: 'CASH',
      order: { cashSessionId: sessionId, status: { not: 'CANCELLED' } },
    },
  });
  return Number(agg._sum.amount ?? 0);
}

/**
 * Saldo líquido das movimentações de caixa da sessão (ADR-006): entradas
 * (suprimento) menos saídas (devolução, sangria, despesa). Reduz/aumenta o
 * valor esperado do caixa junto com a abertura e as vendas em dinheiro.
 */
async function cashMovementsNet(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const movements = await prisma.cashMovement.findMany({
    where: { tenantId, cashSessionId: sessionId },
    select: { type: true, amount: true },
  });
  return netCashMovements(movements.map((m) => ({ type: m.type, amount: Number(m.amount) })));
}

/** Sessão de caixa aberta DA LOJA + valor esperado até agora (ADR-018: caixa compartilhado por tenant,
 * não por operador — qualquer operador enxerga o mesmo caixa aberto). */
cashSessions.get('/current', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // ADR-018: caixa por loja — sem filtro por `userId`.
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });
    if (!session) {
      return c.json({ ok: true, data: null });
    }
    const inflow = await cashInflow(prisma, tenantId, session.id);
    const movementsNet = await cashMovementsNet(prisma, tenantId, session.id);
    const expectedAmount = calcExpectedCash(Number(session.openingAmount), [inflow, movementsNet]);
    return c.json({
      ok: true,
      data: { ...session, cashInflow: inflow, cashMovementsNet: movementsNet, expectedAmount },
    });
  } catch (err) {
    console.error('GET /cash-sessions/current falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar o caixa.' }, 500);
  }
});

/** Abre uma sessão de caixa (ADR-018: uma por LOJA por vez — quem abre, abre para todos os operadores).
 * Bloqueado em loja inativa (ADR-009); fechar o caixa segue liberado (ação de encerramento). */
cashSessions.post('/open', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = openCashSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Valor de abertura inválido.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // ADR-018: caixa por loja — bloqueia se a LOJA já tem um caixa aberto (qualquer operador).
    const existing = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
      select: { id: true },
    });
    if (existing) {
      return c.json({ ok: false, error: 'A loja já tem um caixa aberto.' }, 409);
    }
    const created = await prisma.cashSession.create({
      // Autoria (ADR-010): `userId` (com FK) é quem abriu; `openedByName` é o snapshot do nome.
      data: {
        tenantId,
        userId,
        openingAmount: parsed.data.openingAmount,
        openedByName: c.get('userName'),
      },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    console.error('POST /cash-sessions/open falhou:', err);
    return c.json({ ok: false, error: 'Falha ao abrir o caixa.' }, 500);
  }
});

/** Fecha o caixa aberto da loja; calcula o esperado e registra divergência (ADR-004).
 * ADR-018: qualquer operador pode fechar o caixa compartilhado. */
cashSessions.post('/close', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = closeCashSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados de fechamento inválidos.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // ADR-018: caixa por loja — fecha o caixa aberto da loja (independe de quem abriu).
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Não há caixa aberto.' }, 404);
    }

    const inflow = await cashInflow(prisma, tenantId, session.id);
    const movementsNet = await cashMovementsNet(prisma, tenantId, session.id);
    const expectedAmount = calcExpectedCash(Number(session.openingAmount), [inflow, movementsNet]);
    const divergence = calcCashDivergence(expectedAmount, parsed.data.closingAmount);

    const closed = await prisma.$transaction(async (tx) => {
      const updated = await tx.cashSession.update({
        where: { id: session.id },
        data: {
          closedAt: new Date(),
          closingAmount: parsed.data.closingAmount,
          expectedAmount,
          notes: parsed.data.notes,
          // Autoria (ADR-010): quem fechou o caixa (pode ser outro operador que o abriu).
          closedById: userId,
          closedByName: c.get('userName'),
        },
      });
      // Auditoria seletiva: só registra fechamento COM divergência (ADR-004).
      if (divergence !== 0) {
        await tx.auditEvent.create({
          data: {
            tenantId,
            userId,
            entity: 'CashSession',
            entityId: session.id,
            action: 'CLOSE_CASH_WITH_DIVERGENCE',
            meta: { expectedAmount, closingAmount: parsed.data.closingAmount, divergence },
          },
        });
      }
      return updated;
    });

    return c.json({ ok: true, data: { ...closed, expectedAmount, divergence } });
  } catch (err) {
    console.error('POST /cash-sessions/close falhou:', err);
    return c.json({ ok: false, error: 'Falha ao fechar o caixa.' }, 500);
  }
});

export default cashSessions;
