import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  calcCashDivergence,
  calcExpectedCash,
  grossCashMovements,
  manualCashMovementType,
  netCashMovements,
  reversalKindFor,
} from '@nexoloja/core';
import {
  cashMovementSchema,
  closeCashSessionSchema,
  openCashSessionSchema,
  reverseCashMovementSchema,
} from '@nexoloja/shared';
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
 * Resumo das movimentações de caixa da sessão (ADR-006), numa leitura só:
 *  - `net`: saldo líquido (entradas − saídas) que entra no valor esperado;
 *  - `income`/`expense`: totais BRUTOS de entrada (suprimento) e saída (devolução,
 *    sangria, despesa), para exibir entradas e saídas separadas no caixa.
 */
async function cashMovementsSummary(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  sessionId: string,
): Promise<{ net: number; income: number; expense: number }> {
  const rows = await prisma.cashMovement.findMany({
    where: { tenantId, cashSessionId: sessionId },
    select: { type: true, amount: true },
  });
  const movements = rows.map((m) => ({ type: m.type, amount: Number(m.amount) }));
  return { net: netCashMovements(movements), ...grossCashMovements(movements) };
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
    const movements = await cashMovementsSummary(prisma, tenantId, session.id);
    const expectedAmount = calcExpectedCash(Number(session.openingAmount), [inflow, movements.net]);
    return c.json({
      ok: true,
      data: {
        ...session,
        cashInflow: inflow,
        // Bruto para a mini-DRE do caixa (entradas × saídas); `net` mantém a conta do esperado.
        cashMovementsIn: movements.income,
        cashMovementsOut: movements.expense,
        cashMovementsNet: movements.net,
        expectedAmount,
      },
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
    const movements = await cashMovementsSummary(prisma, tenantId, session.id);
    const expectedAmount = calcExpectedCash(Number(session.openingAmount), [inflow, movements.net]);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extrato das movimentações de caixa (ADR-006): suprimentos, sangrias, devoluções e despesas —
 * mais recentes primeiro, com valor, motivo, autor e hora. Detalha a linha agregada "saídas" da
 * mini-DRE (mostra o que é sangria, o que é devolução, etc.).
 *
 * Sem parâmetro → caixa ABERTO da loja (ADR-018), para a tela do Caixa. Com `?sessionId=` →
 * as movimentações daquele caixa (fechado), para auditar um fechamento em Relatórios — sempre
 * checando que a sessão é da própria loja (`tenantId`), sem vazar dados de outra. */
cashSessions.get('/movements', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const sessionIdParam = c.req.query('sessionId');
  // `sessionId` malformado não vira erro do Prisma (coluna UUID): trata como "não encontrado".
  if (sessionIdParam !== undefined && !UUID_RE.test(sessionIdParam)) {
    return c.json({ ok: true, data: [] });
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // Com `sessionId`: um caixa específico da loja. Sem: o caixa aberto da loja (ADR-018).
    const session = sessionIdParam
      ? await prisma.cashSession.findFirst({
          where: { id: sessionIdParam, tenantId },
          select: { id: true },
        })
      : await prisma.cashSession.findFirst({
          where: { tenantId, closedAt: null },
          select: { id: true },
        });
    if (!session) {
      // Sem caixa aberto (ou a sessão pedida não é da loja): extrato vazio, não é erro.
      return c.json({ ok: true, data: [] });
    }
    const rows = await prisma.cashMovement.findMany({
      where: { tenantId, cashSessionId: session.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        kind: true,
        amount: true,
        reason: true,
        relatedOrderId: true,
        registeredByName: true,
        createdAt: true,
      },
    });
    return c.json({ ok: true, data: rows });
  } catch (err) {
    console.error('GET /cash-sessions/movements falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar as movimentações.' }, 500);
  }
});

/** Lança uma Movimentação de Caixa manual — Suprimento (entrada) ou Sangria (saída) — no
 * caixa aberto DA LOJA (ADR-018). Reusa `CashMovement` (ADR-006): o mesmo mecanismo da
 * devolução, mas SEM `relatedOrderId` (não nasce de uma venda). O sinal contábil vem do
 * `manualCashMovementType` (core, fonte única). Bloqueado sem caixa aberto. */
cashSessions.post('/movement', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = cashMovementSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados da movimentação inválidos.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // ADR-018: caixa por loja — movimenta o caixa aberto da loja (independe de quem abriu).
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Não há caixa aberto.' }, 404);
    }

    const created = await prisma.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: session.id,
        userId,
        type: manualCashMovementType(parsed.data.kind), // Suprimento → INCOME, Sangria → EXPENSE
        kind: parsed.data.kind,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        syncStatus: 'SYNCED',
        registeredByName: c.get('userName'), // autoria (ADR-010)
      },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    console.error('POST /cash-sessions/movement falhou:', err);
    return c.json({ ok: false, error: 'Falha ao lançar a movimentação.' }, 500);
  }
});

/** Estorna um lançamento manual (Suprimento/Sangria) feito por engano — NÃO apaga a linha:
 * cria um **contra-lançamento** de sinal oposto (`reversalKindFor`) que zera o efeito no caixa,
 * preservando o rastro (erro + correção), como a devolução faz com a venda. O elo com o
 * lançamento revertido é gravado em `relatedOrderId` (referência solta, ADR-006) — daí as guardas
 * conseguem impedir estorno em dobro e estorno de estorno SEM migration. Só no caixa ABERTO da
 * loja (ADR-018): mexer em caixa fechado corromperia um fechamento já conciliado (ADR-004). */
cashSessions.post('/movement/:id/reverse', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const movementId = c.req.param('id');
  if (!UUID_RE.test(movementId)) {
    return c.json({ ok: false, error: 'Lançamento não encontrado.' }, 404);
  }

  const parsed = reverseCashMovementSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Dados do estorno inválidos.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    // ADR-018: só se pode estornar no caixa ABERTO da loja (caixa fechado é imutável).
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Não há caixa aberto.' }, 404);
    }

    // O lançamento precisa existir E pertencer ao caixa aberto desta loja.
    const original = await prisma.cashMovement.findFirst({
      where: { id: movementId, tenantId, cashSessionId: session.id },
      select: { id: true, kind: true, amount: true, reason: true, relatedOrderId: true },
    });
    if (!original) {
      return c.json({ ok: false, error: 'Lançamento não encontrado no caixa aberto.' }, 404);
    }

    // Só lançamento manual é estornável aqui: devolução tem fluxo próprio; despesa de venda idem.
    if (original.kind !== 'SUPPLY' && original.kind !== 'WITHDRAWAL') {
      return c.json({ ok: false, error: 'Este lançamento não pode ser estornado.' }, 400);
    }
    // Não estornar um estorno (um estorno manual já carrega `relatedOrderId`).
    if (original.relatedOrderId) {
      return c.json({ ok: false, error: 'Um estorno não pode ser estornado.' }, 400);
    }
    // Não estornar em dobro: se já existe um estorno apontando para ele, recusa.
    const already = await prisma.cashMovement.findFirst({
      where: { tenantId, cashSessionId: session.id, relatedOrderId: original.id },
      select: { id: true },
    });
    if (already) {
      return c.json({ ok: false, error: 'Este lançamento já foi estornado.' }, 409);
    }

    const reversalKind = reversalKindFor(original.kind); // inverte SUPPLY↔WITHDRAWAL
    const created = await prisma.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: session.id,
        userId,
        type: manualCashMovementType(reversalKind), // sinal oposto → zera o efeito no caixa
        kind: reversalKind,
        amount: original.amount, // mesmo valor
        reason: parsed.data.reason ?? `Estorno: ${original.reason ?? 'lançamento manual'}`,
        relatedOrderId: original.id, // elo com o lançamento revertido (referência solta)
        syncStatus: 'SYNCED',
        registeredByName: c.get('userName'), // autoria (ADR-010)
      },
    });
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    console.error('POST /cash-sessions/movement/:id/reverse falhou:', err);
    return c.json({ ok: false, error: 'Falha ao estornar a movimentação.' }, 500);
  }
});

export default cashSessions;
