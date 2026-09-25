import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import {
  calcAdjustedCashClosing,
  calcAverageTicket,
  calcCashDivergence,
  calcDaysToStockout,
  calcMonthRunRate,
  calcNetRevenue,
  calcProfit,
  calcTypicalVelocity,
  grossCashMovements,
  isClosedPrimary,
  netReceivedByMethod,
  previousPeriod,
  refundSlicesByMethod,
  withPaymentShare,
} from '@nexoloja/core';
import {
  EXCHANGE_CREDIT_METHOD,
  STORE_CREDIT_METHOD,
  formatDebtNumber,
  formatOrderNumber,
  paymentCompositionSchema,
  reportRangeSchema,
  type DailyRevenuePoint,
  topProductsSchema,
  topReportSchema,
  type CustomerProductRow,
  type PaymentComposition,
  type PaymentCompositionRow,
  type ProductCustomerRow,
  type ProjectionsReport,
  type SalesComparison,
  type StockoutRisk,
  type TopCustomerRow,
  type TopProductRow,
  type UnitType,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const reports = new Hono<Env>();
reports.use('*', requireAuth);

/**
 * Escapa os curingas do `ILIKE` (`%`, `_`, `\`) para o token virar substring literal (igual ao
 * `.includes()`), sem um `%` digitado virar "qualquer coisa". `\` é o escape padrão do Postgres.
 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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

type SalesRange = { gte?: Date; lte?: Date } | undefined;

type PrismaLike = ReturnType<typeof createPrismaClient>;

/**
 * ADR-037: vendas cujo dinheiro entra no "Recebido" — todas menos as CANCELADAS e as devolvidas por
 * inteiro pela rota ANTIGA `/return` (pré-ADR-033: estorno integral, sem `OrderReturn`). As demais
 * devolvidas (RETURNED pela devolução por item) contam o que foi pago e ABATEM o que voltou ao cliente
 * (`loadRefunds`) — assim a devolução total em crédito na loja mantém o dinheiro no Recebido
 * (o crédito, quando usado, não soma de novo), e a estornada zera como antes.
 */
const RECEIVED_ORDER_WHERE: Prisma.OrderWhereInput = {
  status: { not: 'CANCELLED' },
  NOT: { status: 'RETURNED', returns: { none: { intent: 'REFUND' } } },
};

/** Mesma regra do `RECEIVED_ORDER_WHERE`, em SQL cru (alias `o` = orders). */
const RECEIVED_ORDER_SQL = Prisma.sql`o."status" <> 'CANCELLED' AND NOT (
  o."status" = 'RETURNED'
  AND NOT EXISTS (SELECT 1 FROM "order_returns" r WHERE r."orderId" = o."id" AND r."intent" = 'REFUND')
)`;

/** Formas que NÃO são dinheiro que entrou (ADR-036, Decisão C): crédito da loja e vale-troca. */
const NON_MONEY_METHODS = [STORE_CREDIT_METHOD, EXCHANGE_CREDIT_METHOD];

/**
 * ADR-037: fração de uma linha vendida que FICOU com o cliente (1 − devolvido/vendido, em
 * unidade-base; `returnedBaseQty` soma devoluções e trocas). Multiplica total/quantidade para que
 * lucro, margem e rankings contem só a mercadoria que não voltou. Alias `oi` = order_items.
 */
const KEPT_FRACTION = Prisma.sql`COALESCE(1 - oi."returnedBaseQty" / NULLIF(COALESCE(oi."baseQuantity", oi."quantity"), 0), 1)`;
/** Receita da linha líquida do devolvido (ADR-037). */
const NET_ITEM_TOTAL = Prisma.sql`(oi."total" * ${KEPT_FRACTION})`;
/** Quantidade (unidade vendida) líquida do devolvido (ADR-037). */
const NET_ITEM_QTY = Prisma.sql`(oi."quantity" * ${KEPT_FRACTION})`;
/**
 * Quantidade em UNIDADE-BASE líquida do devolvido (a mesma do estoque, ADR-013 + ADR-037). Critério
 * dos "mais vendidos": não mistura embalagem e base do mesmo produto (ex.: 2 rolos + 30 m).
 */
const NET_ITEM_BASE_QTY = Prisma.sql`(COALESCE(oi."baseQuantity", oi."quantity") - oi."returnedBaseQty")`;
/**
 * Tamanho da unidade fechada (ADR-017/030) para o front rotular a quantidade-base ("2 barras + 3 m");
 * `null` se o produto não é fechado (a base já é a unidade do cadastro).
 */
function closedSizeOf(unit: UnitType | null, conversionFactor: number | null): number | null {
  if (!unit || conversionFactor == null) return null;
  return isClosedPrimary({ unit, conversionFactor }) ? Number(conversionFactor) : null;
}
/** Custo da linha líquido do devolvido: custo carimbado × base que ficou (ADR-027 + ADR-037). */
const NET_ITEM_COST = Prisma.sql`(oi."unitCost" * (COALESCE(oi."baseQuantity", oi."quantity") - oi."returnedBaseQty"))`;

/** Um estorno de devolução rateado por forma (ADR-037), com a venda de origem para o extrato. */
interface RefundSlice {
  method: string;
  amount: number;
  orderNumber: number;
  orderCreatedAt: Date;
  customerName: string | null;
}

/**
 * Carrega o dinheiro que VOLTOU ao cliente nas devoluções das vendas do período (ADR-037). Atribui
 * ao DIA DA VENDA (decisão do Owner, coerente com a devolução total da ADR-036) — o caixa, por sua
 * vez, registra a saída da gaveta no dia do estorno (CashMovement RETURN), sem mudança aqui.
 * Só devoluções REFUND: o excedente em dinheiro/estorno vira fatias por forma
 * (`refundSlicesByMethod`, core); o excedente em crédito e o abatimento de dívida são só informativos
 * (`toCredit`/`toDebt`) — não são dinheiro devolvido. Fatias em crédito/vale são descartadas (nunca
 * entraram no Recebido). Devoluções são raras — leitura enxuta com teto de segurança.
 */
async function loadRefunds(
  prisma: PrismaLike,
  tenantId: string,
  range: SalesRange,
  method?: string,
): Promise<{ slices: RefundSlice[]; toCredit: number; toDebt: number }> {
  const rows = await prisma.orderReturn.findMany({
    where: {
      tenantId,
      intent: 'REFUND',
      order: { ...RECEIVED_ORDER_WHERE, ...(range ? { createdAt: range } : {}) },
    },
    select: {
      excessAmount: true,
      abatedAmount: true,
      target: true,
      order: {
        select: {
          orderNumber: true,
          createdAt: true,
          customer: { select: { name: true } },
          payments: { select: { method: true, amount: true } },
        },
      },
    },
    take: 5000,
  });

  const slices: RefundSlice[] = [];
  let creditCents = 0;
  let debtCents = 0;
  for (const r of rows) {
    const excess = Number(r.excessAmount);
    debtCents += Math.round(Number(r.abatedAmount) * 100);
    if (!r.target || excess <= 0) continue;
    if (r.target === 'STORE_CREDIT') {
      creditCents += Math.round(excess * 100);
      continue;
    }
    const payments = r.order.payments.map((p) => ({ method: p.method, amount: Number(p.amount) }));
    for (const s of refundSlicesByMethod(r.target, excess, payments)) {
      if (NON_MONEY_METHODS.includes(s.method)) continue;
      if (method && s.method !== method) continue;
      slices.push({
        method: s.method,
        amount: s.amount,
        orderNumber: r.order.orderNumber,
        orderCreatedAt: r.order.createdAt,
        customerName: r.order.customer?.name ?? null,
      });
    }
  }
  return { slices, toCredit: creditCents / 100, toDebt: debtCents / 100 };
}

/**
 * Agrega os KPIs de vendas de UMA janela (cost-zero, no banco). Extraído para servir tanto a janela
 * atual quanto a ANTERIOR (Fatia 4, `?compare=1`), garantindo a MESMA regra (ADR-019/ADR-027) nas
 * duas — sem duplicar a lógica. Devolve o recebido (regime de caixa), nº de vendas, canceladas, a
 * quebra por forma e o lucro/margem do período (base de mercadoria vendida).
 * ADR-037: o recebido e a quebra por forma são LÍQUIDOS de estornos; o lucro, líquido do devolvido.
 */
async function computeSalesData(prisma: PrismaLike, tenantId: string, range: SalesRange) {
  // Regime de CAIXA (ADR-019): o "recebido no período" é o dinheiro que efetivamente entrou —
  // pagamentos à vista das vendas do período MAIS os recebimentos de fiado do período (por
  // `paidAt`), contando o fiado no dia em que é recebido, não no dia da venda.
  const paidAt = range; // mesmo intervalo {gte,lte}, aplicado ao campo `paidAt`
  // Base do LUCRO (Fatia 6, ADR-027): mercadoria VENDIDA no período (itens de vendas não canceladas,
  // pela data da venda) — base diferente do "Recebido". SQL cru por causa da expressão `unitCost × base`.
  // ADR-036: além de CANCELLED, exclui RETURNED (venda totalmente devolvida sai do faturamento).
  const goodsConditions: Prisma.Sql[] = [
    Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
    Prisma.sql`o."status" NOT IN ('CANCELLED', 'RETURNED')`,
  ];
  if (range?.gte) goodsConditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
  if (range?.lte) goodsConditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

  const [
    salesAgg,
    cancelledCount,
    grouped,
    creditReceipts,
    creditGenerated,
    goodsAgg,
    refunds,
    exchangeCount,
    returnedCount,
  ] = await Promise.all([
      prisma.order.aggregate({
        _count: { _all: true },
        // ADR-036: nº de vendas exclui canceladas E devolvidas por inteiro (fora do faturamento).
        where: { tenantId, status: { notIn: ['CANCELLED', 'RETURNED'] }, ...(range ? { createdAt: range } : {}) },
      }),
      prisma.order.count({
        where: { tenantId, status: 'CANCELLED', ...(range ? { createdAt: range } : {}) },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { _all: true },
        // ADR-036: "Recebido" conta só dinheiro REAL — exclui vendas canceladas/devolvidas e as
        // parcelas de crédito da loja / vale-troca (não são dinheiro que entrou).
        // ADR-037: as devolvidas pela devolução por item voltam a contar o pago — o que voltou ao
        // cliente é abatido logo abaixo (`loadRefunds`), na forma em que voltou.
        where: {
          tenantId,
          order: { ...RECEIVED_ORDER_WHERE, ...(range ? { createdAt: range } : {}) },
          method: { notIn: NON_MONEY_METHODS },
        },
      }),
      prisma.receivablePayment.groupBy({
        by: ['method'],
        _sum: { amount: true, surcharge: true },
        _count: { _all: true },
        where: { tenantId, ...(paidAt ? { paidAt } : {}) },
      }),
      // ADR-037: a prazo gerado LÍQUIDO do que a devolução abateu da dívida (`returnedAmount`).
      prisma.receivable.aggregate({
        _sum: { originalAmount: true, returnedAmount: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(range ? { createdAt: range } : {}) },
      }),
      // ADR-037: receita e custo LÍQUIDOS do que foi devolvido/trocado (só a mercadoria que ficou).
      prisma.$queryRaw<Array<{ goodsRevenue: number; coveredRevenue: number; coveredCost: number }>>(
        Prisma.sql`
          SELECT
            COALESCE(SUM(${NET_ITEM_TOTAL}), 0)::float8 AS "goodsRevenue",
            COALESCE(SUM(${NET_ITEM_TOTAL}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
            COALESCE(SUM(${NET_ITEM_COST}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost"
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
          WHERE ${Prisma.join(goodsConditions, ' AND ')}
        `,
      ),
      // Estornos (ADR-037, substitui o "Devoluções PARCIAIS" da ADR-035/036): o DINHEIRO que voltou
      // ao cliente nas devoluções das vendas do período, por forma — abatido do Recebido. Crédito na
      // loja e abatimento de dívida vêm à parte, só informativos.
      loadRefunds(prisma, tenantId, range),
      // ADR-036: nº de trocas no período (OrderReturn intent EXCHANGE).
      prisma.orderReturn.count({
        where: { tenantId, intent: 'EXCHANGE', ...(range ? { createdAt: range } : {}) },
      }),
      // ADR-036: nº de vendas totalmente devolvidas no período (status RETURNED).
      prisma.order.count({
        where: { tenantId, status: 'RETURNED', ...(range ? { createdAt: range } : {}) },
      }),
    ]);

  // Junta à vista + fiado por forma, para o "recebido" e a quebra baterem (Σ formas = recebido).
  const byMethod = new Map<string, { total: number; count: number }>();
  for (const g of grouped) {
    const cur = byMethod.get(g.method) ?? { total: 0, count: 0 };
    cur.total = Number((cur.total + Number(g._sum.amount ?? 0)).toFixed(2));
    cur.count += g._count._all;
    byMethod.set(g.method, cur);
  }
  // Recebimentos de fiado: valor + acréscimo de cartão (ADR-022, Fatia C.3) na mesma forma.
  for (const g of creditReceipts) {
    const cur = byMethod.get(g.method) ?? { total: 0, count: 0 };
    cur.total = Number((cur.total + Number(g._sum.amount ?? 0) + Number(g._sum.surcharge ?? 0)).toFixed(2));
    cur.count += g._count._all;
    byMethod.set(g.method, cur);
  }
  const received = [...byMethod.entries()].map(([method, v]) => ({ method, total: v.total, count: v.count }));
  const grossRevenue = Number(received.reduce((acc, m) => acc + m.total, 0).toFixed(2));
  // ADR-037: o "Recebido" é LÍQUIDO — cada forma perde o que voltou ao cliente nela (core, puro).
  // Σ formas = Recebido continua valendo (é o gate do drill-down e do gráfico diário).
  const byPaymentMethod = withPaymentShare(netReceivedByMethod(received, refunds.slices));
  const totalRevenue = Number(byPaymentMethod.reduce((acc, m) => acc + m.total, 0).toFixed(2));
  const salesCount = salesAgg._count._all;
  // Estornos (ADR-037): o dinheiro devolvido das vendas do período. Faturamento LÍQUIDO (ADR-035) =
  // entradas − estornos, que é o próprio Recebido (por construção, igual a `totalRevenue`).
  const returnsTotal = Number(refunds.slices.reduce((acc, s) => acc + s.amount, 0).toFixed(2));
  const netRevenue = calcNetRevenue(grossRevenue, returnsTotal);

  // Lucro bruto (Fatia 6) — função pura calcProfit: só vendas com custo entram, nunca custo zero.
  const goods = goodsAgg[0] ?? { goodsRevenue: 0, coveredRevenue: 0, coveredCost: 0 };
  const goodsRevenue = Number(goods.goodsRevenue.toFixed(2));
  const { grossProfit, marginPercent, costCoverage } = calcProfit({
    totalRevenue: goodsRevenue,
    coveredRevenue: goods.coveredRevenue,
    coveredCost: goods.coveredCost,
  });

  return {
    totalRevenue, // ADR-037: Recebido LÍQUIDO de estornos
    grossRevenue, // ADR-037: entradas antes dos estornos
    returnsTotal, // ADR-037: dinheiro devolvido (gaveta + estorno cartão/PIX) das vendas do período
    netRevenue, // ADR-035 (compat): = totalRevenue desde a ADR-037
    returnsToCredit: refunds.toCredit, // ADR-037: virou crédito na loja (não sai do Recebido)
    returnsToDebt: refunds.toDebt, // ADR-037: abateu dívida a prazo (nunca entrou como dinheiro)
    salesCount,
    averageTicket: calcAverageTicket(totalRevenue, salesCount),
    cancelledCount,
    exchangeCount, // ADR-036: nº de trocas no período
    returnedCount, // ADR-036: nº de vendas totalmente devolvidas no período
    creditSalesGenerated: Number(
      (Number(creditGenerated._sum.originalAmount ?? 0) - Number(creditGenerated._sum.returnedAmount ?? 0)).toFixed(2),
    ),
    byPaymentMethod,
    grossProfit,
    marginPercent,
    costCoverage,
    goodsRevenue,
  };
}

/**
 * Relatório de vendas por período. Agrega no banco (cost-zero): faturamento e nº de vendas CONFIRMED,
 * canceladas à parte, total por forma de pagamento e lucro/margem (Fatia 6). Com `?compare=1` (e
 * intervalo), inclui os KPIs da janela ANTERIOR equivalente para os selos ▲/▼ (Fatia 4). Vendas
 * CANCELLED ficam fora do faturamento (coerente com o caixa).
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
  const compare = c.req.query('compare') === '1';

  try {
    const prisma = getPrisma(c);

    // Janela atual + (quando `?compare=1` e há intervalo) a ANTERIOR equivalente, em paralelo. Sem
    // intervalo (todo o histórico) não há "período anterior" — `previous` fica null.
    const prevRange = compare && from && to ? previousPeriod(from, to) : null;
    const [current, prev] = await Promise.all([
      computeSalesData(prisma, tenantId, createdAt),
      prevRange
        ? computeSalesData(prisma, tenantId, buildDateFilter(prevRange.from, prevRange.to))
        : Promise.resolve(null),
    ]);

    const previous: SalesComparison | null =
      prevRange && prev
        ? {
            from: prevRange.from,
            to: prevRange.to,
            totalRevenue: prev.totalRevenue,
            returnsTotal: prev.returnsTotal,
            netRevenue: prev.netRevenue,
            salesCount: prev.salesCount,
            averageTicket: prev.averageTicket,
            cancelledCount: prev.cancelledCount,
            grossProfit: prev.grossProfit,
          }
        : null;

    return c.json({
      ok: true,
      data: { from: from ?? null, to: to ?? null, ...current, previous },
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
 * daquela forma, por `paidAt`, somando o acréscimo de cartão — ADR-022) + estornos de devolução
 * naquela forma (linhas negativas, ADR-037). Por construção, `Σ linhas = total daquela forma` no
 * `/sales` (o gate do drill-down).
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
    const prisma = getPrisma(c);
    // Teto de segurança (mesmo padrão do `/cash-sessions`): um período real por forma fica muito
    // abaixo disso; existe só para nunca devolver uma resposta gigante num "todo o histórico".
    const CAP = 5000;
    const [cashPayments, creditReceipts, refunds] = await Promise.all([
      // À vista: pagamentos daquela forma, de vendas não canceladas nem devolvidas por inteiro
      // (ADR-036), pela data da venda. Mantém Σ linhas = total da forma no /sales.
      // ADR-037: mesma regra de vendas do /sales (`RECEIVED_ORDER_WHERE`); os estornos entram abaixo.
      prisma.payment.findMany({
        where: {
          tenantId,
          method,
          order: { ...RECEIVED_ORDER_WHERE, ...(createdAt ? { createdAt } : {}) },
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
      // ADR-037: estornos de devolução NESTA forma (linhas negativas), pela data da venda.
      loadRefunds(prisma, tenantId, createdAt, method),
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
    // Estornos (ADR-037): o que voltou ao cliente nesta forma — valor negativo, na data da venda.
    for (const s of refunds.slices) {
      rows.push({
        tipo: 'estorno',
        ref: formatOrderNumber(s.orderNumber),
        descricao: s.customerName ?? 'Consumidor',
        valor: -s.amount,
        data: s.orderCreatedAt.toISOString(),
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
 * Ranking de PRODUTOS no período (Relatórios v2, Fatia 5). Agrega `order_items` de vendas não
 * canceladas (cost-zero, no banco): faturamento, quantidade, nº de vendas e — via custo carimbado
 * (ADR-027) — lucro/margem, sinalizando a cobertura (`costCoverage < 1` quando há venda sem custo).
 * Aceita busca `q` (sem acento) e ordena por `faturamento` (padrão), `lucro` ou `quantidade`
 * ("mais vendidos": quantidade em unidade-base do produto, devolvida junto com a unidade).
 */
reports.get('/top-products', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = topProductsSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    q: c.req.query('q'),
    orderBy: c.req.query('orderBy'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Parâmetros inválidos.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to, q, orderBy = 'faturamento', limit = 10 } = parsed.data;
  const range = buildDateFilter(from, to);

  try {
    const prisma = getPrisma(c);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" NOT IN ('CANCELLED', 'RETURNED')`, // ADR-036: devolvida por inteiro fora
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);
    // Busca sem acento (mesmo padrão do catálogo): dobra o acento dos dois lados via `unaccent`.
    for (const token of q ? q.split(/\s+/).filter(Boolean) : []) {
      const pat = `%${likeEscape(token)}%`;
      conditions.push(Prisma.sql`(
        extensions.unaccent(coalesce(p."name", oi."productName")) ILIKE extensions.unaccent(${pat})
        OR extensions.unaccent(coalesce(p."popularName", '')) ILIKE extensions.unaccent(${pat})
      )`);
    }
    // Ordena pelo alias já projetado (Postgres aceita ORDER BY em alias de saída).
    // Desempate por faturamento na ordem por quantidade (mesma quantidade ⇒ quem faturou mais antes).
    const orderExpr =
      orderBy === 'lucro'
        ? Prisma.sql`"grossProfit" DESC`
        : orderBy === 'quantidade'
          ? Prisma.sql`"baseQty" DESC, "revenue" DESC`
          : Prisma.sql`"revenue" DESC`;

    // Cost-zero: uma varredura agregada. O lucro/margem final sai da função pura `calcProfit` (core),
    // mas o ORDER BY por lucro precisa da conta no banco — daí a expressão de `grossProfit` no SQL.
    // ADR-037: receita/quantidade/custo LÍQUIDOS do devolvido/trocado; linha devolvida por inteiro não
    // conta como venda do produto, e produto devolvido por inteiro sai do ranking (HAVING).
    const rows = await prisma.$queryRaw<
      Array<{
        productId: string;
        productName: string | null;
        revenue: number;
        qty: number;
        baseQty: number;
        unit: UnitType | null;
        conversionFactor: number | null;
        salesCount: number;
        coveredRevenue: number;
        coveredCost: number;
      }>
    >(Prisma.sql`
      SELECT
        oi."productId" AS "productId",
        COALESCE(MAX(p."name"), MAX(oi."productName")) AS "productName",
        SUM(${NET_ITEM_TOTAL})::float8 AS "revenue",
        SUM(${NET_ITEM_QTY})::float8 AS "qty",
        SUM(${NET_ITEM_BASE_QTY})::float8 AS "baseQty",
        MAX(p."unit"::text) AS "unit",
        MAX(p."conversionFactor")::float8 AS "conversionFactor",
        COUNT(DISTINCT oi."orderId") FILTER (WHERE ${KEPT_FRACTION} > 0)::int AS "salesCount",
        COALESCE(SUM(${NET_ITEM_TOTAL}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
        COALESCE(SUM(${NET_ITEM_COST}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost",
        (
          COALESCE(SUM(${NET_ITEM_TOTAL}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
          - COALESCE(SUM(${NET_ITEM_COST}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
        )::float8 AS "grossProfit"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "products" p ON p."id" = oi."productId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY oi."productId"
      HAVING SUM(${NET_ITEM_QTY}) > 0
      ORDER BY ${orderExpr}
      LIMIT ${limit}
    `);

    const data: TopProductRow[] = rows.map((r) => {
      const { grossProfit, marginPercent, costCoverage } = calcProfit({
        totalRevenue: r.revenue,
        coveredRevenue: r.coveredRevenue,
        coveredCost: r.coveredCost,
      });
      return {
        productId: r.productId,
        productName: r.productName ?? 'Produto',
        revenue: Number(r.revenue.toFixed(2)),
        qty: Number(r.qty),
        baseQty: Number(r.baseQty.toFixed(4)),
        unit: r.unit,
        closedSize: closedSizeOf(r.unit, r.conversionFactor),
        salesCount: r.salesCount,
        grossProfit,
        marginPercent,
        costCoverage,
      };
    });

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/top-products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o ranking de produtos.' }, 500);
  }
});

/**
 * "Quem mais compra" um produto (Fatia 5): top clientes por faturamento naquele produto no período.
 * Alimenta o pop-up de detalhe do produto. Venda sem cliente aparece como "Consumidor".
 */
reports.get('/product-customers/:productId', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const productId = c.req.param('productId');
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    return c.json({ ok: false, error: 'Produto inválido.' }, 400);
  }

  const parsed = reportRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Período inválido.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to } = parsed.data;
  const range = buildDateFilter(from, to);

  try {
    const prisma = getPrisma(c);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" NOT IN ('CANCELLED', 'RETURNED')`, // ADR-036: devolvida por inteiro fora
      Prisma.sql`oi."productId" = ${productId}::uuid`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

    // ADR-037: quantidade/receita LÍQUIDAS do devolvido/trocado.
    const rows = await prisma.$queryRaw<
      Array<{ customerId: string | null; customerName: string; qty: number; baseQty: number; revenue: number }>
    >(Prisma.sql`
      SELECT
        o."customerId" AS "customerId",
        COALESCE(MAX(c."name"), 'Consumidor') AS "customerName",
        SUM(${NET_ITEM_QTY})::float8 AS "qty",
        SUM(${NET_ITEM_BASE_QTY})::float8 AS "baseQty",
        SUM(${NET_ITEM_TOTAL})::float8 AS "revenue"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "customers" c ON c."id" = o."customerId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY o."customerId"
      HAVING SUM(${NET_ITEM_QTY}) > 0
      ORDER BY "revenue" DESC
      LIMIT 5
    `);

    const data: ProductCustomerRow[] = rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      qty: Number(r.qty),
      baseQty: Number(r.baseQty.toFixed(4)),
      revenue: Number(r.revenue.toFixed(2)),
    }));

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/product-customers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao detalhar o produto.' }, 500);
  }
});

/**
 * Ranking de CLIENTES no período (Relatórios v2, Fatia 5). Agrega compras (vendas não canceladas com
 * cliente identificado): total comprado, nº de compras e lucro/margem (custo carimbado, ADR-027). A
 * **dívida atual** (saldo em aberto AGORA, independente do período) vem numa 2ª consulta enxuta só
 * para os clientes do ranking. Aceita busca `q` (sem acento) e ordena por `faturamento`/`lucro`.
 */
reports.get('/top-customers', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = topReportSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    q: c.req.query('q'),
    orderBy: c.req.query('orderBy'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Parâmetros inválidos.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to, q, orderBy = 'faturamento', limit = 10 } = parsed.data;
  const range = buildDateFilter(from, to);

  try {
    const prisma = getPrisma(c);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" NOT IN ('CANCELLED', 'RETURNED')`, // ADR-036: devolvida por inteiro fora
      // Só clientes identificados (venda de balcão sem cadastro não entra no ranking de clientes).
      Prisma.sql`o."customerId" IS NOT NULL`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);
    for (const token of q ? q.split(/\s+/).filter(Boolean) : []) {
      const pat = `%${likeEscape(token)}%`;
      conditions.push(Prisma.sql`extensions.unaccent(c."name") ILIKE extensions.unaccent(${pat})`);
    }
    const orderExpr =
      orderBy === 'lucro' ? Prisma.sql`"grossProfit" DESC` : Prisma.sql`"revenue" DESC`;

    const rows = await prisma.$queryRaw<
      Array<{
        customerId: string;
        customerName: string;
        revenue: number;
        salesCount: number;
        coveredRevenue: number;
        coveredCost: number;
      }>
    >(Prisma.sql`
      SELECT
        o."customerId" AS "customerId",
        MAX(c."name") AS "customerName",
        SUM(${NET_ITEM_TOTAL})::float8 AS "revenue",
        COUNT(DISTINCT oi."orderId") FILTER (WHERE ${KEPT_FRACTION} > 0)::int AS "salesCount",
        COALESCE(SUM(${NET_ITEM_TOTAL}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
        COALESCE(SUM(${NET_ITEM_COST}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost",
        (
          COALESCE(SUM(${NET_ITEM_TOTAL}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
          - COALESCE(SUM(${NET_ITEM_COST}) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
        )::float8 AS "grossProfit"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      JOIN "customers" c ON c."id" = o."customerId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY o."customerId"
      HAVING SUM(${NET_ITEM_QTY}) > 0
      ORDER BY ${orderExpr}
      LIMIT ${limit}
    `);

    // Dívida atual (saldo em aberto AGORA) só dos clientes do ranking — 2ª consulta enxuta.
    const ids = rows.map((r) => r.customerId);
    const debtByCustomer = new Map<string, number>();
    if (ids.length > 0) {
      const debts = await prisma.$queryRaw<Array<{ customerId: string; debt: number }>>(Prisma.sql`
        SELECT rc."customerId" AS "customerId",
          COALESCE(SUM(rc."originalAmount" - rc."settledAmount" - rc."returnedAmount"), 0)::float8 AS "debt"
        FROM "receivables" rc
        WHERE rc."tenantId" = ${tenantId}::uuid
          AND rc."status" = 'OPEN'
          AND rc."customerId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        GROUP BY rc."customerId"
      `);
      for (const d of debts) debtByCustomer.set(d.customerId, Number(d.debt.toFixed(2)));
    }

    const data: TopCustomerRow[] = rows.map((r) => {
      const { grossProfit, marginPercent, costCoverage } = calcProfit({
        totalRevenue: r.revenue,
        coveredRevenue: r.coveredRevenue,
        coveredCost: r.coveredCost,
      });
      return {
        customerId: r.customerId,
        customerName: r.customerName ?? 'Cliente',
        revenue: Number(r.revenue.toFixed(2)),
        salesCount: r.salesCount,
        grossProfit,
        marginPercent,
        costCoverage,
        currentDebt: debtByCustomer.get(r.customerId) ?? 0,
      };
    });

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/top-customers falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o ranking de clientes.' }, 500);
  }
});

/**
 * "O que costuma comprar" um cliente (Fatia 5): top produtos por faturamento daquele cliente no
 * período. Alimenta o pop-up de detalhe do cliente.
 */
reports.get('/customer-products/:customerId', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const customerId = c.req.param('customerId');
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return c.json({ ok: false, error: 'Cliente inválido.' }, 400);
  }

  const parsed = reportRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Período inválido.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to } = parsed.data;
  const range = buildDateFilter(from, to);

  try {
    const prisma = getPrisma(c);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" NOT IN ('CANCELLED', 'RETURNED')`, // ADR-036: devolvida por inteiro fora
      Prisma.sql`o."customerId" = ${customerId}::uuid`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

    const rows = await prisma.$queryRaw<
      Array<{
        productId: string;
        productName: string | null;
        qty: number;
        baseQty: number;
        unit: UnitType | null;
        conversionFactor: number | null;
        revenue: number;
      }>
    >(Prisma.sql`
      SELECT
        oi."productId" AS "productId",
        COALESCE(MAX(p."name"), MAX(oi."productName")) AS "productName",
        SUM(${NET_ITEM_QTY})::float8 AS "qty",
        SUM(${NET_ITEM_BASE_QTY})::float8 AS "baseQty",
        MAX(p."unit"::text) AS "unit",
        MAX(p."conversionFactor")::float8 AS "conversionFactor",
        SUM(${NET_ITEM_TOTAL})::float8 AS "revenue"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "products" p ON p."id" = oi."productId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY oi."productId"
      HAVING SUM(${NET_ITEM_QTY}) > 0 -- ADR-037: líquido do devolvido/trocado
      ORDER BY "revenue" DESC
      LIMIT 5
    `);

    const data: CustomerProductRow[] = rows.map((r) => ({
      productId: r.productId,
      productName: r.productName ?? 'Produto',
      qty: Number(r.qty),
      baseQty: Number(r.baseQty.toFixed(4)),
      unit: r.unit,
      closedSize: closedSizeOf(r.unit, r.conversionFactor),
      revenue: Number(r.revenue.toFixed(2)),
    }));

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/customer-products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao detalhar o cliente.' }, 500);
  }
});

/**
 * Projeções "no ritmo atual" (Relatórios v2, Fatia 8) — DIRECIONAIS, não promessas. Três olhares
 * para frente, independentes do filtro de período da tela:
 *  1. **Faturamento do mês** por run-rate (média diária do recebido do mês × dias do mês).
 *  2. **A receber (próx. 30 dias)** — saldo em aberto das dívidas que vencem na janela (ADR-026).
 *  3. **Vai faltar estoque** — itens cuja velocidade de saída (StockMovement EXPENSE, 30 dias)
 *     esgota o `stockQty` em poucos dias.
 * Cálculos direcionais vivem em `core` (funções puras testadas); aqui só agregamos no banco.
 */
reports.get('/projections', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  try {
    const prisma = getPrisma(c);
    const DAY = 86_400_000;
    const now = new Date();
    // "Hoje" no fuso da loja (Brasil, UTC-3): desloca o relógio para ler ano/mês/dia locais.
    const br = new Date(now.getTime() - 3 * 3_600_000);
    const y = br.getUTCFullYear();
    const mIdx = br.getUTCMonth();
    const dayOfMonth = br.getUTCDate();
    const daysInMonth = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
    const monthStart = new Date(`${y}-${String(mIdx + 1).padStart(2, '0')}-01T00:00:00.000-03:00`);
    // Janela de vencimento (próx. 30 dias) — `dueDate` é data-only (meia-noite UTC, ADR-026).
    const dueFrom = new Date(Date.UTC(y, mIdx, dayOfMonth, 0, 0, 0, 0));
    const dueTo = new Date(Date.UTC(y, mIdx, dayOfMonth + 30, 23, 59, 59, 999));
    // Janela de velocidade de estoque: últimos 30 dias.
    const velocityWindowDays = 30;
    const velocitySince = new Date(now.getTime() - velocityWindowDays * DAY);

    const [monthData, upcomingAgg, stockRows] = await Promise.all([
      // 1. Recebido do mês até agora (mesma regra de caixa do /sales — reusa o helper).
      computeSalesData(prisma, tenantId, { gte: monthStart, lte: now }),
      // 2. A receber próx. 30 dias: saldo em aberto das dívidas OPEN que vencem na janela.
      prisma.$queryRaw<Array<{ total: number; count: bigint }>>(Prisma.sql`
        SELECT
          COALESCE(SUM(r."originalAmount" - r."settledAmount" - r."returnedAmount"), 0)::float8 AS "total",
          COUNT(DISTINCT d."id") AS "count"
        FROM "debts" d
        JOIN "receivables" r ON r."debtId" = d."id"
        WHERE d."tenantId" = ${tenantId}::uuid
          AND d."status" = 'OPEN'
          AND r."status" = 'OPEN'
          AND d."dueDate" >= ${dueFrom}
          AND d."dueDate" <= ${dueTo}
      `),
      // 3. Saída (EXPENSE) por produto E POR DIA nos últimos 30 dias + estoque atual. Agrupar por dia
      //    (fuso da loja, −3h) permite tirar a MEDIANA do consumo diário — robusta a uma venda-
      //    bombástica única, que distorceria a média. Uma linha por (produto, dia com saída).
      prisma.$queryRaw<
        Array<{ productId: string; productName: string; stockQty: number; dayQty: number }>
      >(Prisma.sql`
        SELECT
          p."id" AS "productId",
          p."name" AS "productName",
          p."stockQty"::float8 AS "stockQty",
          SUM(sm."quantity")::float8 AS "dayQty"
        FROM "products" p
        JOIN "stock_movements" sm
          ON sm."productId" = p."id" AND sm."type" = 'EXPENSE' AND sm."createdAt" >= ${velocitySince}
        WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY p."id", p."name", p."stockQty", (sm."createdAt" - interval '3 hours')::date
      `),
    ]);

    const monthRunRate = calcMonthRunRate(monthData.totalRevenue, dayOfMonth, daysInMonth);

    const up = upcomingAgg[0] ?? { total: 0, count: 0n };

    // Agrupa as saídas por produto. `daily` = quantidades dos DIAS COM VENDA (uma por dia da janela).
    const byProduct = new Map<string, { name: string; stockQty: number; daily: number[] }>();
    for (const r of stockRows) {
      const cur = byProduct.get(r.productId) ?? { name: r.productName, stockQty: r.stockQty, daily: [] };
      cur.daily.push(r.dayQty);
      byProduct.set(r.productId, cur);
    }

    // Ruptura: dias-para-esgotar por item (funções puras). Velocidade típica = MEDIANA dos dias com
    // venda × frequência (robusta ao pico, mas ainda pega quem vende REGULARMENTE, não só quase-todo-
    // dia — ver `calcTypicalVelocity`). "VAI faltar" = ainda tem estoque (> 0) e rompe em ≤ 14 dias;
    // já zerados ("já faltou") são a tela de reposição. Ordenado do mais urgente; teto de 5.
    const RUPTURE_LIMIT_DAYS = 14;
    const stockoutRisks: StockoutRisk[] = [...byProduct.entries()]
      .filter(([, v]) => v.stockQty > 0)
      .map(([productId, v]) => {
        const dailyVelocity = calcTypicalVelocity(v.daily, velocityWindowDays);
        const days = calcDaysToStockout(v.stockQty, dailyVelocity);
        return { productId, v, dailyVelocity, days };
      })
      .filter(
        (
          x,
        ): x is {
          productId: string;
          v: { name: string; stockQty: number; daily: number[] };
          dailyVelocity: number;
          days: number;
        } => x.days !== null && x.days <= RUPTURE_LIMIT_DAYS,
      )
      .sort((a, b) => a.days - b.days)
      .slice(0, 5)
      .map(({ productId, v, dailyVelocity, days }) => ({
        productId,
        productName: v.name,
        stockQty: v.stockQty,
        dailyVelocity,
        daysToStockout: days,
      }));

    const data: ProjectionsReport = {
      monthRevenue: {
        realized: monthData.totalRevenue,
        daysElapsed: dayOfMonth,
        daysInMonth,
        dailyAverage: monthRunRate.dailyAverage,
        projected: monthRunRate.projected,
      },
      upcomingReceivables: {
        total: Number(up.total.toFixed(2)),
        count: Number(up.count),
        days: 30,
      },
      stockoutRisks,
      velocityWindowDays,
    };

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/projections falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar as projeções.' }, 500);
  }
});

/**
 * Recebido por DIA no período (Relatórios v2, Fatia 7) — alimenta o gráfico de barras (SVG à mão).
 * Mesma regra de caixa do `/sales` (ADR-019): à vista pela data da venda + fiado pela data do
 * recebimento (`paidAt`), somados por dia no fuso da loja (−3h). Por construção, `Σ dias = Recebido
 * do período` (o gate). Preenche os dias sem movimento com 0 (barras uniformes) quando há intervalo.
 */
reports.get('/daily', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = reportRangeSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Período inválido.', issues: parsed.error.flatten() }, 400);
  }
  const { from, to } = parsed.data;
  const createdAt = buildDateFilter(from, to);
  const paidAt = createdAt;

  try {
    const prisma = getPrisma(c);
    // ADR-037: mesma regra do /sales — vendas de `RECEIVED_ORDER_SQL`, só formas de dinheiro real
    // (crédito da loja/vale fora, ADR-036 C — antes o gráfico os somava e não batia com o card) e os
    // estornos abatidos no dia da venda (abaixo). Mantém Σ dias = Recebido do período.
    const cashConditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      RECEIVED_ORDER_SQL,
      Prisma.sql`pay."method" NOT IN (${Prisma.join(NON_MONEY_METHODS)})`,
    ];
    if (createdAt?.gte) cashConditions.push(Prisma.sql`o."createdAt" >= ${createdAt.gte}`);
    if (createdAt?.lte) cashConditions.push(Prisma.sql`o."createdAt" <= ${createdAt.lte}`);
    const creditConditions: Prisma.Sql[] = [Prisma.sql`rp."tenantId" = ${tenantId}::uuid`];
    if (paidAt?.gte) creditConditions.push(Prisma.sql`rp."paidAt" >= ${paidAt.gte}`);
    if (paidAt?.lte) creditConditions.push(Prisma.sql`rp."paidAt" <= ${paidAt.lte}`);

    const [cashByDay, creditByDay, refunds] = await Promise.all([
      // À vista por dia E forma (pela data da venda, fuso da loja).
      prisma.$queryRaw<Array<{ day: string; method: string; total: number }>>(Prisma.sql`
        SELECT to_char((o."createdAt" - interval '3 hours')::date, 'YYYY-MM-DD') AS "day",
               pay."method" AS "method",
               SUM(pay."amount")::float8 AS "total"
        FROM "payments" pay
        JOIN "orders" o ON o."id" = pay."orderId"
        WHERE ${Prisma.join(cashConditions, ' AND ')}
        GROUP BY 1, 2
      `),
      // Fiado por dia E forma (pela data do recebimento) — valor + acréscimo de cartão (ADR-022).
      prisma.$queryRaw<Array<{ day: string; method: string; total: number }>>(Prisma.sql`
        SELECT to_char((rp."paidAt" - interval '3 hours')::date, 'YYYY-MM-DD') AS "day",
               rp."method" AS "method",
               SUM(rp."amount" + rp."surcharge")::float8 AS "total"
        FROM "receivable_payments" rp
        WHERE ${Prisma.join(creditConditions, ' AND ')}
        GROUP BY 1, 2
      `),
      // ADR-037: estornos das vendas do período (dinheiro que voltou), por forma.
      loadRefunds(prisma, tenantId, createdAt),
    ]);

    // Estornos por (dia DA VENDA no fuso da loja, forma), com sinal negativo.
    const refundRows = refunds.slices.map((s) => ({
      day: new Date(s.orderCreatedAt.getTime() - 3 * 3_600_000).toISOString().slice(0, 10),
      method: s.method,
      total: -s.amount,
    }));

    // Soma as fontes por (dia, forma). Forma que zerou no dia (tudo estornado) sai da quebra.
    const byDay = new Map<string, Map<string, number>>();
    for (const r of [...cashByDay, ...creditByDay, ...refundRows]) {
      const methods = byDay.get(r.day) ?? new Map<string, number>();
      const v = Number(((methods.get(r.method) ?? 0) + Number(r.total)).toFixed(2));
      if (v === 0) methods.delete(r.method);
      else methods.set(r.method, v);
      byDay.set(r.day, methods);
    }

    const toPoint = (day: string): DailyRevenuePoint => {
      const methods = byDay.get(day);
      const byMethod: Record<string, number> = {};
      let total = 0;
      if (methods) {
        for (const [m, v] of methods) {
          byMethod[m] = v;
          total += v;
        }
      }
      return { day, total: Number(total.toFixed(2)), byMethod };
    };

    let points: DailyRevenuePoint[];
    if (from && to) {
      // Preenche todos os dias do intervalo (inclusive), com 0 onde não houve recebimento.
      const DAY = 86_400_000;
      const ymd = (d: string) => {
        const [yy, mm, dd] = d.split('-');
        return Date.UTC(Number(yy), Number(mm) - 1, Number(dd));
      };
      points = [];
      for (let ms = ymd(from); ms <= ymd(to); ms += DAY) {
        points.push(toPoint(new Date(ms).toISOString().slice(0, 10)));
      }
    } else {
      // Sem intervalo (todo o histórico): só os dias com movimento, em ordem.
      points = [...byDay.keys()].sort().map(toPoint);
    }

    return c.json({ ok: true, data: points });
  } catch (err) {
    console.error('GET /reports/daily falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o gráfico diário.' }, 500);
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
    const prisma = getPrisma(c);
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

    // Quebra da mini-DRE por sessão (vendas em dinheiro / suprimentos / saídas) — SÓ quando pedida
    // (`?breakdown=1`), para não onerar o Relatórios (que lista até 2000 sessões). A tela do Caixa a
    // pede só para "hoje" (poucas sessões) e a usa para REIMPRIMIR o comprovante de fechamento
    // completo. Duas leituras agregadas (não por-sessão) mantêm o custo baixo mesmo com o flag.
    const wantBreakdown = ['1', 'true'].includes((c.req.query('breakdown') ?? '').toLowerCase());
    const inflowBySession = new Map<string, number>();
    const movBySession = new Map<string, { income: number; expense: number }>();
    if (wantBreakdown && sessionIds.size > 0) {
      const ids = [...sessionIds];
      // Vendas em dinheiro (pagamentos CASH de pedidos não cancelados) agrupadas por sessão.
      const cashPays = await prisma.payment.findMany({
        where: {
          tenantId,
          method: 'CASH',
          order: { cashSessionId: { in: ids }, status: { not: 'CANCELLED' } },
        },
        select: { amount: true, order: { select: { cashSessionId: true } } },
      });
      for (const p of cashPays) {
        const sid = p.order?.cashSessionId;
        if (!sid) continue;
        inflowBySession.set(sid, (inflowBySession.get(sid) ?? 0) + Number(p.amount));
      }
      // Movimentações de caixa (suprimento/sangria/devolução/despesa) agrupadas por sessão.
      const movs = await prisma.cashMovement.findMany({
        where: { tenantId, cashSessionId: { in: ids } },
        select: { cashSessionId: true, type: true, amount: true },
      });
      const rowsBySession = new Map<string, { type: 'INCOME' | 'EXPENSE'; amount: number }[]>();
      for (const m of movs) {
        const arr = rowsBySession.get(m.cashSessionId) ?? [];
        arr.push({ type: m.type as 'INCOME' | 'EXPENSE', amount: Number(m.amount) });
        rowsBySession.set(m.cashSessionId, arr);
      }
      for (const [sid, rows] of rowsBySession) movBySession.set(sid, grossCashMovements(rows));
    }
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
        // Quebra da mini-DRE (só com `?breakdown=1`): alimenta a REIMPRESSÃO do comprovante de
        // fechamento completo. Ausente (undefined) no fluxo normal do Relatórios.
        ...(wantBreakdown
          ? {
              cashInflow: inflowBySession.get(s.id) ?? 0,
              cashMovementsIn: movBySession.get(s.id)?.income ?? 0,
              cashMovementsOut: movBySession.get(s.id)?.expense ?? 0,
            }
          : {}),
      };
    });

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /reports/cash-sessions falhou:', err);
    return c.json({ ok: false, error: 'Falha ao gerar o relatório de caixa.' }, 500);
  }
});

export default reports;
