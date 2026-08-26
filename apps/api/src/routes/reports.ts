import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  calcAdjustedCashClosing,
  calcAverageTicket,
  calcCashDivergence,
  withPaymentShare,
} from '@nexoloja/core';
import {
  formatDebtNumber,
  formatOrderNumber,
  paymentCompositionSchema,
  reportRangeSchema,
  type PaymentComposition,
  type PaymentCompositionRow,
} from '@nexoloja/shared';
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

    // Regime de CAIXA (ADR-019): o "recebido no período" é o dinheiro que efetivamente entrou —
    // pagamentos à vista das vendas do período MAIS os recebimentos de fiado do período (por
    // `paidAt`), contando o fiado no dia em que é recebido, não no dia da venda. A parte a prazo de
    // uma venda NÃO conta enquanto não é recebida (não vira `Payment`). Assim cada real é contado
    // uma vez só, no dia em que entra — coerente com o caixa.
    const paidAt = createdAt; // mesmo intervalo {gte,lte}, aplicado ao campo `paidAt`
    const [salesAgg, cancelledCount, grouped, creditReceipts, creditGenerated] = await Promise.all([
      // Nº de vendas confirmadas no período (por data da venda) — canceladas à parte.
      prisma.order.aggregate({
        _count: { _all: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
      }),
      // Canceladas contadas à parte (fora do recebido).
      prisma.order.count({
        where: { tenantId, status: 'CANCELLED', ...(createdAt ? { createdAt } : {}) },
      }),
      // Pagamentos à vista por forma (só de vendas não canceladas, pela data da venda).
      prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { _all: true },
        where: {
          tenantId,
          order: { status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
        },
      }),
      // Recebimentos de fiado por forma (pela data do recebimento — regime de caixa). `surcharge` é o
      // acréscimo de cartão cobrado ao receber (ADR-022, Fatia C.3) — soma na receita daquela forma.
      prisma.receivablePayment.groupBy({
        by: ['method'],
        _sum: { amount: true, surcharge: true },
        _count: { _all: true },
        where: { tenantId, ...(paidAt ? { paidAt } : {}) },
      }),
      // Informativo: vendas a prazo GERADAS no período (crédito concedido) — não entra no recebido.
      prisma.receivable.aggregate({
        _sum: { originalAmount: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
      }),
    ]);

    // Junta pagamentos à vista + recebimentos de fiado por forma de pagamento, para o "recebido"
    // e a quebra por forma baterem (Σ formas = recebido).
    const byMethod = new Map<string, { total: number; count: number }>();
    // Pagamentos à vista das vendas (não têm acréscimo separado — já embutido no preço, ADR-016).
    for (const g of grouped) {
      const cur = byMethod.get(g.method) ?? { total: 0, count: 0 };
      cur.total = Number((cur.total + Number(g._sum.amount ?? 0)).toFixed(2));
      cur.count += g._count._all;
      byMethod.set(g.method, cur);
    }
    // Recebimentos de fiado: valor + acréscimo de cartão (ADR-022, Fatia C.3) na mesma forma.
    for (const g of creditReceipts) {
      const cur = byMethod.get(g.method) ?? { total: 0, count: 0 };
      cur.total = Number(
        (cur.total + Number(g._sum.amount ?? 0) + Number(g._sum.surcharge ?? 0)).toFixed(2),
      );
      cur.count += g._count._all;
      byMethod.set(g.method, cur);
    }
    const byPaymentMethod = withPaymentShare(
      [...byMethod.entries()].map(([method, v]) => ({ method, total: v.total, count: v.count })),
    );
    const totalRevenue = Number(
      byPaymentMethod.reduce((acc, m) => acc + m.total, 0).toFixed(2),
    );
    const salesCount = salesAgg._count._all;

    return c.json({
      ok: true,
      data: {
        from: from ?? null,
        to: to ?? null,
        totalRevenue,
        salesCount,
        averageTicket: calcAverageTicket(totalRevenue, salesCount),
        cancelledCount,
        creditSalesGenerated: Number(creditGenerated._sum.originalAmount ?? 0),
        byPaymentMethod,
      },
    });
  } catch (err) {
    console.error('GET /reports/sales falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o relatório de vendas.' }, 500);
  }
});

/**
 * Drill-down por forma de pagamento (Relatórios v2, Fatia 3): a COMPOSIÇÃO do "Recebido" de UMA
 * forma no período. Reaproveita a MESMA regra de caixa (ADR-019) do `/sales`: linhas de venda à
 * vista (`Payment` daquela forma, por data da venda) + recebimentos de dívida (`ReceivablePayment`
 * daquela forma, por `paidAt`, somando o acréscimo de cartão — ADR-022). Por construção,
 * `Σ linhas = total daquela forma` no `/sales` (o gate do drill-down).
 */
reports.get('/payment-composition', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = paymentCompositionSchema.safeParse({
    method: c.req.query('method'),
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Parâmetros inválidos.', issues: parsed.error.flatten() }, 400);
  }
  const { method, from, to } = parsed.data;
  const createdAt = buildDateFilter(from, to); // filtro pela data da VENDA (à vista)
  const paidAt = createdAt; // mesmo intervalo, aplicado ao RECEBIMENTO da dívida (regime de caixa)

  try {
    const prisma = createPrismaClient(connectionString);
    // Teto de segurança (mesmo padrão do `/cash-sessions`): um período real por forma fica muito
    // abaixo disso; existe só para nunca devolver uma resposta gigante num "todo o histórico".
    const CAP = 5000;
    const [cashPayments, creditReceipts] = await Promise.all([
      // À vista: pagamentos daquela forma, de vendas não canceladas, pela data da venda.
      prisma.payment.findMany({
        where: {
          tenantId,
          method,
          order: { status: { not: 'CANCELLED' }, ...(createdAt ? { createdAt } : {}) },
        },
        select: {
          amount: true,
          order: {
            select: { orderNumber: true, createdAt: true, customer: { select: { name: true } } },
          },
        },
        orderBy: { order: { createdAt: 'desc' } },
        take: CAP,
      }),
      // Dívida: recebimentos daquela forma, pela data do recebimento (`paidAt`).
      prisma.receivablePayment.findMany({
        where: { tenantId, method, ...(paidAt ? { paidAt } : {}) },
        select: {
          amount: true,
          surcharge: true,
          paidAt: true,
          receivable: {
            select: {
              debt: { select: { debtNumber: true } },
              order: { select: { orderNumber: true } },
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { paidAt: 'desc' },
        take: CAP,
      }),
    ]);

    const rows: PaymentCompositionRow[] = [];
    for (const p of cashPayments) {
      rows.push({
        tipo: 'venda',
        ref: formatOrderNumber(p.order.orderNumber),
        descricao: p.order.customer?.name ?? 'Consumidor',
        valor: Number(p.amount),
        data: p.order.createdAt.toISOString(),
      });
    }
    for (const r of creditReceipts) {
      // Prefere o código da dívida (D-0001); vendas a prazo pré-ADR-026 sem dívida usam o nº do pedido.
      const ref = r.receivable.debt
        ? formatDebtNumber(r.receivable.debt.debtNumber)
        : formatOrderNumber(r.receivable.order.orderNumber);
      rows.push({
        tipo: 'divida',
        ref,
        descricao: r.receivable.customer.name,
        // Valor que entrou = quitação + acréscimo de cartão (ADR-022, Fatia C.3), como no `/sales`.
        valor: Number((Number(r.amount) + Number(r.surcharge)).toFixed(2)),
        data: r.paidAt.toISOString(),
      });
    }
    // Extrato: mais recente primeiro (por data do evento).
    rows.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

    const total = Number(rows.reduce((acc, r) => acc + r.valor, 0).toFixed(2));

    return c.json({
      ok: true,
      data: { method, from: from ?? null, to: to ?? null, total, rows } satisfies PaymentComposition,
    });
  } catch (err) {
    console.error('GET /reports/payment-composition falhou:', err);
    return c.json({ ok: false, error: 'Falha ao detalhar a forma de pagamento.' }, 500);
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
    // Teto de segurança (não paginação): a tela sempre manda período (default 30 dias) e o caixa
    // cresce ~1 fechamento/dia, então 2000 cobre ~5 anos de um período escolhido — folgado. Fica só
    // para evitar uma resposta gigante num "tudo o histórico" extremo, sem truncar o uso real.
    const sessions = await prisma.cashSession.findMany({
      where: { tenantId, closedAt: { not: null, ...(closedAt ?? {}) } },
      orderBy: { closedAt: 'desc' },
      take: 2000,
    });

    // CS-4 (ADR-012 §b): vendas offline anexadas a um caixa JÁ FECHADO deixam uma marca de
    // reconciliação (AuditEvent SALE_ON_CLOSED_CASH). Agrega por sessão para o fechamento sinalizar
    // "N vendas lançadas após o fechamento" — a divergência que a decisão (b) manda surgir aqui.
    const sessionIds = new Set(sessions.map((s) => s.id));
    // CS-5: além do total, acumula a parcela em DINHEIRO (`cashTotal`) das vendas tardias —
    // é o que recalcula o "esperado ajustado" (cartão/PIX não tocam a gaveta).
    const reconBySession = new Map<string, { count: number; total: number; cashTotal: number }>();
    if (sessionIds.size > 0) {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId, action: 'SALE_ON_CLOSED_CASH' },
        select: { meta: true },
        orderBy: { createdAt: 'desc' },
        // Teto de segurança amplo: só existe marca aqui quando uma venda OFFLINE cai num caixa já
        // fechado (raro). 5000 cobre qualquer loja real sem truncar a reconciliação.
        take: 5000,
      });
      for (const ev of events) {
        const m = ev.meta as {
          cashSessionId?: string;
          total?: number;
          cashAmount?: number;
        } | null;
        if (!m?.cashSessionId || !sessionIds.has(m.cashSessionId)) continue;
        const cur = reconBySession.get(m.cashSessionId) ?? { count: 0, total: 0, cashTotal: 0 };
        const total = Number(m.total ?? 0);
        // Compat: marcas gravadas antes da CS-5 não têm `cashAmount`. Caem no `total` (correto
        // para venda 100% em dinheiro, que é o caso da CS-4; mistas ficam levemente super estimadas).
        const cashAmount = m.cashAmount === undefined ? total : Number(m.cashAmount);
        cur.count += 1;
        cur.total = Number((cur.total + total).toFixed(2));
        cur.cashTotal = Number((cur.cashTotal + cashAmount).toFixed(2));
        reconBySession.set(m.cashSessionId, cur);
      }
    }

    const data = sessions.map((s) => {
      const expectedAmount = Number(s.expectedAmount ?? 0);
      const closingAmount = Number(s.closingAmount ?? 0);
      const recon = reconBySession.get(s.id) ?? { count: 0, total: 0, cashTotal: 0 };
      // CS-5: esperado/divergência recalculados incluindo o dinheiro das vendas tardias.
      // NÃO reescreve o dado congelado do fechamento (auditoria) — só a conta pronta p/ conferência.
      const { adjustedExpected, adjustedDivergence } = calcAdjustedCashClosing(
        expectedAmount,
        closingAmount,
        recon.cashTotal,
      );
      return {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt!.toISOString(),
        // Responsáveis do turno (ADR-010, snapshot do nome) — exibidos no tooltip do relatório.
        openedByName: s.openedByName ?? null,
        closedByName: s.closedByName ?? null,
        openingAmount: Number(s.openingAmount),
        closingAmount,
        expectedAmount,
        divergence: calcCashDivergence(expectedAmount, closingAmount),
        notes: s.notes ?? null,
        // Vendas offline anexadas depois do fechamento (reconciliação, CS-4).
        lateSalesCount: recon.count,
        lateSalesTotal: recon.total,
        // Esperado ajustado + divergência recalculada (CS-5).
        lateCashSalesTotal: recon.cashTotal,
        adjustedExpected,
        adjustedDivergence,
      };
    });

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/cash-sessions falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o relatório de caixa.' }, 500);
  }
});

export default reports;
