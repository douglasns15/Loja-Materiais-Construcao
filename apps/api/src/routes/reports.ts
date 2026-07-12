import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcAverageTicket, calcCashDivergence, withPaymentShare } from '@nexoloja/core';
import { reportRangeSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const reports = new Hono<Env>();
reports.use('*', requireAuth);

/**
 * Converte o intervalo AAAA-MM-DD (opcional) em um filtro Prisma de data.
 * As bordas são aplicadas no fuso da loja (Brasil, UTC-3): `from` começa às
 * 00:00 e `to` termina às 23:59:59.999 daquele dia, para não perder vendas do
 * fim da noite. Sem `from`/`to`, retorna `undefined` (cobre todo o histórico).
 */
function buildDateFilter(
  from?: string,
  to?: string,
): { gte?: Date; lte?: Date } | undefined {
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(`${from}T00:00:00.000-03:00`);
  if (to) filter.lte = new Date(`${to}T23:59:59.999-03:00`);
  return filter.gte || filter.lte ? filter : undefined;
}

/**
 * Relatório de vendas por período. Agrega no banco (cost-zero): faturamento e
 * nº de vendas CONFIRMED, contagem de canceladas à parte e total por forma de
 * pagamento. Vendas CANCELLED ficam fora do faturamento (coerente com o caixa).
 */
reports.get('/sales', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = reportRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Período inválido.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to } = parsed.data;
  const createdAt = buildDateFilter(from, to);

  try {
    const prisma = createPrismaClient(connectionString);

    const [salesAgg, cancelledCount, grouped] = await Promise.all([
      // Faturamento e nº de vendas confirmadas (ignora canceladas).
      prisma.order.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
      }),
      // Canceladas contadas à parte (fora do faturamento).
      prisma.order.count({
        where: { tenantId, status: 'CANCELLED', ...(createdAt ? { createdAt } : {}) },
      }),
      // Total por forma de pagamento (só de vendas não canceladas).
      prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { _all: true },
        where: {
          tenantId,
          order: { status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
        },
      }),
    ]);

    const totalRevenue = Number(salesAgg._sum.total ?? 0);
    const salesCount = salesAgg._count._all;
    const byPaymentMethod = withPaymentShare(
      grouped.map((g) => ({
        method: g.method,
        total: Number(g._sum.amount ?? 0),
        count: g._count._all,
      })),
    );

    return c.json({
      ok: true,
      data: {
        from: from ?? null,
        to: to ?? null,
        totalRevenue,
        salesCount,
        averageTicket: calcAverageTicket(totalRevenue, salesCount),
        cancelledCount,
        byPaymentMethod,
      },
    });
  } catch (err) {
    console.error('GET /reports/sales falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o relatório de vendas.' }, 500);
  }
});

/**
 * Histórico de fechamentos de caixa no período (por data de fechamento, mais
 * recentes primeiro). Traz abertura, esperado, contado e a divergência.
 */
reports.get('/cash-sessions', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = reportRangeSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Período inválido.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to } = parsed.data;
  const closedAt = buildDateFilter(from, to);

  try {
    const prisma = createPrismaClient(connectionString);
    const sessions = await prisma.cashSession.findMany({
      where: { tenantId, closedAt: { not: null, ...(closedAt ?? {}) } },
      orderBy: { closedAt: 'desc' },
      take: 200,
    });

    // CS-4 (ADR-012 §b): vendas offline anexadas a um caixa JÁ FECHADO deixam uma marca de
    // reconciliação (AuditEvent SALE_ON_CLOSED_CASH). Agrega por sessão para o fechamento sinalizar
    // "N vendas lançadas após o fechamento" — a divergência que a decisão (b) manda surgir aqui.
    const sessionIds = new Set(sessions.map((s) => s.id));
    const reconBySession = new Map<string, { count: number; total: number }>();
    if (sessionIds.size > 0) {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId, action: 'SALE_ON_CLOSED_CASH' },
        select: { meta: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      for (const ev of events) {
        const m = ev.meta as { cashSessionId?: string; total?: number } | null;
        if (!m?.cashSessionId || !sessionIds.has(m.cashSessionId)) continue;
        const cur = reconBySession.get(m.cashSessionId) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total = Number((cur.total + Number(m.total ?? 0)).toFixed(2));
        reconBySession.set(m.cashSessionId, cur);
      }
    }

    const data = sessions.map((s) => {
      const expectedAmount = Number(s.expectedAmount ?? 0);
      const closingAmount = Number(s.closingAmount ?? 0);
      const recon = reconBySession.get(s.id) ?? { count: 0, total: 0 };
      return {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt!.toISOString(),
        openingAmount: Number(s.openingAmount),
        closingAmount,
        expectedAmount,
        divergence: calcCashDivergence(expectedAmount, closingAmount),
        notes: s.notes ?? null,
        // Vendas offline anexadas depois do fechamento (reconciliação, CS-4).
        lateSalesCount: recon.count,
        lateSalesTotal: recon.total,
      };
    });

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/cash-sessions falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o relatório de caixa.' }, 500);
  }
});

export default reports;
