import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import {
  calcAdjustedCashClosing,
  calcAverageTicket,
  calcCashDivergence,
  calcDaysToStockout,
  calcMonthRunRate,
  calcProfit,
  previousPeriod,
  withPaymentShare,
} from '@nexoloja/core';
import {
  formatDebtNumber,
  formatOrderNumber,
  paymentCompositionSchema,
  reportRangeSchema,
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
} from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
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

/**
 * Agrega os KPIs de vendas de UMA janela (cost-zero, no banco). Extraído para servir tanto a janela
 * atual quanto a ANTERIOR (Fatia 4, `?compare=1`), garantindo a MESMA regra (ADR-019/ADR-027) nas
 * duas — sem duplicar a lógica. Devolve o recebido (regime de caixa), nº de vendas, canceladas, a
 * quebra por forma e o lucro/margem do período (base de mercadoria vendida).
 */
async function computeSalesData(
  prisma: ReturnType<typeof createPrismaClient>,
  tenantId: string,
  range: SalesRange,
) {
  // Regime de CAIXA (ADR-019): o "recebido no período" é o dinheiro que efetivamente entrou —
  // pagamentos à vista das vendas do período MAIS os recebimentos de fiado do período (por
  // `paidAt`), contando o fiado no dia em que é recebido, não no dia da venda.
  const paidAt = range; // mesmo intervalo {gte,lte}, aplicado ao campo `paidAt`
  // Base do LUCRO (Fatia 6, ADR-027): mercadoria VENDIDA no período (itens de vendas não canceladas,
  // pela data da venda) — base diferente do "Recebido". SQL cru por causa da expressão `unitCost × base`.
  const goodsConditions: Prisma.Sql[] = [
    Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
    Prisma.sql`o."status" <> 'CANCELLED'`,
  ];
  if (range?.gte) goodsConditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
  if (range?.lte) goodsConditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

  const [salesAgg, cancelledCount, grouped, creditReceipts, creditGenerated, goodsAgg] =
    await Promise.all([
      prisma.order.aggregate({
        _count: { _all: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(range ? { createdAt: range } : {}) },
      }),
      prisma.order.count({
        where: { tenantId, status: 'CANCELLED', ...(range ? { createdAt: range } : {}) },
      }),
      prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        _count: { _all: true },
        where: { tenantId, order: { status: { not: 'CANCELLED' }, ...(range ? { createdAt: range } : {}) } },
      }),
      prisma.receivablePayment.groupBy({
        by: ['method'],
        _sum: { amount: true, surcharge: true },
        _count: { _all: true },
        where: { tenantId, ...(paidAt ? { paidAt } : {}) },
      }),
      prisma.receivable.aggregate({
        _sum: { originalAmount: true },
        where: { tenantId, status: { not: 'CANCELLED' }, ...(range ? { createdAt: range } : {}) },
      }),
      prisma.$queryRaw<Array<{ goodsRevenue: number; coveredRevenue: number; coveredCost: number }>>(
        Prisma.sql`
          SELECT
            COALESCE(SUM(oi."total"), 0)::float8 AS "goodsRevenue",
            COALESCE(SUM(oi."total") FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
            COALESCE(SUM(oi."unitCost" * COALESCE(oi."baseQuantity", oi."quantity")) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost"
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
          WHERE ${Prisma.join(goodsConditions, ' AND ')}
        `,
      ),
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
  const byPaymentMethod = withPaymentShare(
    [...byMethod.entries()].map(([method, v]) => ({ method, total: v.total, count: v.count })),
  );
  const totalRevenue = Number(byPaymentMethod.reduce((acc, m) => acc + m.total, 0).toFixed(2));
  const salesCount = salesAgg._count._all;

  // Lucro bruto (Fatia 6) — função pura calcProfit: só vendas com custo entram, nunca custo zero.
  const goods = goodsAgg[0] ?? { goodsRevenue: 0, coveredRevenue: 0, coveredCost: 0 };
  const goodsRevenue = Number(goods.goodsRevenue.toFixed(2));
  const { grossProfit, marginPercent, costCoverage } = calcProfit({
    totalRevenue: goodsRevenue,
    coveredRevenue: goods.coveredRevenue,
    coveredCost: goods.coveredCost,
  });

  return {
    totalRevenue,
    salesCount,
    averageTicket: calcAverageTicket(totalRevenue, salesCount),
    cancelledCount,
    creditSalesGenerated: Number(creditGenerated._sum.originalAmount ?? 0),
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
    const prisma = createPrismaClient(connectionString);

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
 * Ranking de PRODUTOS no período (Relatórios v2, Fatia 5). Agrega `order_items` de vendas não
 * canceladas (cost-zero, no banco): faturamento, quantidade, nº de vendas e — via custo carimbado
 * (ADR-027) — lucro/margem, sinalizando a cobertura (`costCoverage < 1` quando há venda sem custo).
 * Aceita busca `q` (sem acento) e ordena por `faturamento` (padrão) ou `lucro`.
 */
reports.get('/top-products', async (c) => {
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
    const prisma = createPrismaClient(connectionString);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" <> 'CANCELLED'`,
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
    const orderExpr =
      orderBy === 'lucro' ? Prisma.sql`"grossProfit" DESC` : Prisma.sql`"revenue" DESC`;

    // Cost-zero: uma varredura agregada. O lucro/margem final sai da função pura `calcProfit` (core),
    // mas o ORDER BY por lucro precisa da conta no banco — daí a expressão de `grossProfit` no SQL.
    const rows = await prisma.$queryRaw<
      Array<{
        productId: string;
        productName: string | null;
        revenue: number;
        qty: number;
        salesCount: number;
        coveredRevenue: number;
        coveredCost: number;
      }>
    >(Prisma.sql`
      SELECT
        oi."productId" AS "productId",
        COALESCE(MAX(p."name"), MAX(oi."productName")) AS "productName",
        SUM(oi."total")::float8 AS "revenue",
        SUM(oi."quantity")::float8 AS "qty",
        COUNT(DISTINCT oi."orderId")::int AS "salesCount",
        COALESCE(SUM(oi."total") FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
        COALESCE(SUM(oi."unitCost" * COALESCE(oi."baseQuantity", oi."quantity")) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost",
        (
          COALESCE(SUM(oi."total") FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
          - COALESCE(SUM(oi."unitCost" * COALESCE(oi."baseQuantity", oi."quantity")) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
        )::float8 AS "grossProfit"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "products" p ON p."id" = oi."productId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY oi."productId"
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
    const prisma = createPrismaClient(connectionString);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" <> 'CANCELLED'`,
      Prisma.sql`oi."productId" = ${productId}::uuid`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

    const rows = await prisma.$queryRaw<
      Array<{ customerId: string | null; customerName: string; qty: number; revenue: number }>
    >(Prisma.sql`
      SELECT
        o."customerId" AS "customerId",
        COALESCE(MAX(c."name"), 'Consumidor') AS "customerName",
        SUM(oi."quantity")::float8 AS "qty",
        SUM(oi."total")::float8 AS "revenue"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "customers" c ON c."id" = o."customerId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY o."customerId"
      ORDER BY "revenue" DESC
      LIMIT 5
    `);

    const data: ProductCustomerRow[] = rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      qty: Number(r.qty),
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
    const prisma = createPrismaClient(connectionString);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" <> 'CANCELLED'`,
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
        SUM(oi."total")::float8 AS "revenue",
        COUNT(DISTINCT oi."orderId")::int AS "salesCount",
        COALESCE(SUM(oi."total") FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredRevenue",
        COALESCE(SUM(oi."unitCost" * COALESCE(oi."baseQuantity", oi."quantity")) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)::float8 AS "coveredCost",
        (
          COALESCE(SUM(oi."total") FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
          - COALESCE(SUM(oi."unitCost" * COALESCE(oi."baseQuantity", oi."quantity")) FILTER (WHERE oi."unitCost" IS NOT NULL), 0)
        )::float8 AS "grossProfit"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      JOIN "customers" c ON c."id" = o."customerId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY o."customerId"
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
    const prisma = createPrismaClient(connectionString);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`o."status" <> 'CANCELLED'`,
      Prisma.sql`o."customerId" = ${customerId}::uuid`,
    ];
    if (range?.gte) conditions.push(Prisma.sql`o."createdAt" >= ${range.gte}`);
    if (range?.lte) conditions.push(Prisma.sql`o."createdAt" <= ${range.lte}`);

    const rows = await prisma.$queryRaw<
      Array<{ productId: string; productName: string | null; qty: number; revenue: number }>
    >(Prisma.sql`
      SELECT
        oi."productId" AS "productId",
        COALESCE(MAX(p."name"), MAX(oi."productName")) AS "productName",
        SUM(oi."quantity")::float8 AS "qty",
        SUM(oi."total")::float8 AS "revenue"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      LEFT JOIN "products" p ON p."id" = oi."productId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY oi."productId"
      ORDER BY "revenue" DESC
      LIMIT 5
    `);

    const data: CustomerProductRow[] = rows.map((r) => ({
      productId: r.productId,
      productName: r.productName ?? 'Produto',
      qty: Number(r.qty),
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
    const prisma = createPrismaClient(connectionString);
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
      // 3. Velocidade de saída (EXPENSE) por produto nos últimos 30 dias + estoque atual.
      prisma.$queryRaw<
        Array<{ productId: string; productName: string; stockQty: number; consumed: number }>
      >(Prisma.sql`
        SELECT
          p."id" AS "productId",
          p."name" AS "productName",
          p."stockQty"::float8 AS "stockQty",
          COALESCE(SUM(sm."quantity"), 0)::float8 AS "consumed"
        FROM "products" p
        JOIN "stock_movements" sm
          ON sm."productId" = p."id" AND sm."type" = 'EXPENSE' AND sm."createdAt" >= ${velocitySince}
        WHERE p."tenantId" = ${tenantId}::uuid AND p."deletedAt" IS NULL AND p."isActive" = true
        GROUP BY p."id", p."name", p."stockQty"
      `),
    ]);

    const monthRunRate = calcMonthRunRate(monthData.totalRevenue, dayOfMonth, daysInMonth);

    const up = upcomingAgg[0] ?? { total: 0, count: 0n };

    // Ruptura: dias-para-esgotar por item (função pura). "VAI faltar" = ainda tem estoque (> 0) e
    // rompe em ≤ 14 dias no ritmo atual — itens já zerados ("já faltou") são outra tela (reposição do
    // Estoque), não entram aqui. Ordenado do mais urgente; teto de 5 (é um alerta, não a lista toda).
    const RUPTURE_LIMIT_DAYS = 14;
    const stockoutRisks: StockoutRisk[] = stockRows
      .filter((r) => r.stockQty > 0)
      .map((r) => {
        const dailyVelocity = Number((r.consumed / velocityWindowDays).toFixed(4));
        const days = calcDaysToStockout(r.stockQty, dailyVelocity);
        return { r, dailyVelocity, days };
      })
      .filter((x): x is { r: (typeof stockRows)[number]; dailyVelocity: number; days: number } =>
        x.days !== null && x.days <= RUPTURE_LIMIT_DAYS,
      )
      .sort((a, b) => a.days - b.days)
      .slice(0, 5)
      .map(({ r, dailyVelocity, days }) => ({
        productId: r.productId,
        productName: r.productName,
        stockQty: r.stockQty,
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
