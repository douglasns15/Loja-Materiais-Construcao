import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import {
  ALERT_META,
  alertDetailQuerySchema,
  alertProductsQuerySchema,
  formatDateBr,
  formatDebtNumber,
  type AlertDetailRow,
  type AlertKind,
  type AlertProductRow,
  type AlertProductsPage,
  type AlertSeverity,
  type AlertSummary,
} from '@nexoloja/shared';
import {
  CASH_DIVERGENCE_WINDOW_DAYS,
  DEBT_STALE_ALERT_DAYS,
  isCashOpenTooLong,
  isDebtStale,
} from '@nexoloja/core';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

/**
 * Central de pendências — o "sino" de alertas (ADR-029). Alertas CALCULADOS sob demanda: cada
 * endpoint agrega no Postgres o que já existe (custo-zero: nada é gravado; o alerta some sozinho
 * quando o dado é corrigido). Nasce VISÍVEL a todos os papéis (o `roles` do catálogo é informativo
 * nesta entrega; o filtro por papel entra com a tela de permissões — ADR-029 §4).
 *
 * Blocos: A (cadastro) e B (estoque) saem de uma varredura de `products` (`COUNT FILTER`); C
 * (operacional/financeiro) são consultas leves de caixa/dívida decididas por funções puras do core.
 */
const alerts = new Hono<Env>();
alerts.use('*', requireAuth);

/** Tamanho da página da lista de download — mantém cada requisição pequena (guarda de CPU do Worker). */
const PAGE_SIZE = 500;

/**
 * Alertas sobre a tabela `products` (bloco A — cadastro; bloco B — estoque), na ordem do painel.
 * Todos saem da MESMA varredura, cada um como um `COUNT FILTER` (Fatias 2+3). Só ler `stockQty`
 * (o cache placar, ADR-001) — o alerta é sobre o estado atual EXIBIDO em todo o app.
 */
const PRODUCT_ALERT_KINDS: AlertKind[] = [
  'product-no-cost',
  'product-cost-ge-price',
  'product-no-price',
  'product-no-ean',
  'product-no-category',
  'stock-negative',
  'stock-below-min',
];

/**
 * Predicado SQL de um alerta de PRODUTO (sobre a tabela `products`). Fonte única do "o que conta como
 * pendência", reusada pela contagem (`COUNT FILTER`) e pela lista de download. A base comum (tenant,
 * ativo, não excluído) é aplicada por quem chama. Lança para tipos fora do bloco de produto.
 */
function productAlertPredicate(kind: AlertKind): Prisma.Sql {
  switch (kind) {
    case 'product-no-cost':
      // Custo zerado ⇒ fica fora do lucro/margem (ADR-027). `costPrice` é obrigatório, nunca nulo.
      return Prisma.sql`"costPrice" = 0`;
    case 'product-cost-ge-price':
      // Margem ≤ 0 com AMBOS preenchidos (preço 0 é a pendência "sem preço", não esta — sem sobreposição).
      return Prisma.sql`"costPrice" > 0 AND "salePrice" > 0 AND "costPrice" >= "salePrice"`;
    case 'product-no-price':
      return Prisma.sql`"salePrice" = 0`;
    case 'product-no-ean':
      // Sem código de barras (nulo ou vazio) ⇒ leitura por scanner não acha.
      return Prisma.sql`("ean" IS NULL OR "ean" = '')`;
    case 'product-no-category':
      return Prisma.sql`"categoryId" IS NULL`;
    case 'stock-negative':
      // Saldo abaixo de zero ⇒ movimentação inconsistente (danger). É a fonte de verdade EXIBIDA.
      return Prisma.sql`"stockQty" < 0`;
    case 'stock-below-min':
      // Ruptura/repor: no mínimo ou abaixo, com mínimo definido. Exclui negativos (que já são o
      // alerta `stock-negative`, de gravidade maior) — sem contar o mesmo produto em dois lugares.
      return Prisma.sql`"minStockQty" > 0 AND "stockQty" >= 0 AND "stockQty" <= "minStockQty"`;
    default:
      throw new Error(`Alerta de produto não implementado: ${kind}`);
  }
}

/**
 * Contagens de todas as pendências ativas (só as `count > 0`). Fatia 1: uma varredura de `products`
 * com um `COUNT FILTER` (o esqueleto para o bloco A somar mais filtros na MESMA varredura).
 */
alerts.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);

    // Uma única varredura agregada de produtos (cost-zero, sem `findMany` — guarda de CPU do Worker):
    // um `COUNT FILTER` por alerta do bloco, com aliases posicionais `c0..cN` (a ordem = PRODUCT_ALERT_KINDS).
    const countCols = PRODUCT_ALERT_KINDS.map(
      (kind, i) =>
        Prisma.sql`COUNT(*) FILTER (WHERE ${productAlertPredicate(kind)})::int AS ${Prisma.raw(`"c${i}"`)}`,
    );
    const [productCounts] = await prisma.$queryRaw<Array<Record<string, number>>>(
      Prisma.sql`
        SELECT ${Prisma.join(countCols, ', ')}
        FROM "products"
        WHERE "tenantId" = ${tenantId}::uuid AND "isActive" = true AND "deletedAt" IS NULL
      `,
    );

    const data: AlertSummary[] = [];
    const push = (kind: AlertKind, count: number) => {
      if (count <= 0) return;
      const meta = ALERT_META[kind];
      data.push({
        kind,
        count,
        severity: meta.severity,
        roles: meta.roles,
        downloadable: meta.downloadable,
        actionHref: meta.actionHref,
      });
    };

    PRODUCT_ALERT_KINDS.forEach((kind, i) => push(kind, productCounts?.[`c${i}`] ?? 0));

    // Bloco C (operacional/financeiro) — consultas leves, decididas por funções PURAS do core (o
    // volume é pequeno: 1 caixa aberto por loja; 1 dívida aberta por cliente).
    const now = new Date();
    const divergenceCutoff = new Date(now.getTime() - CASH_DIVERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [openSessions, divergenceCount, openDebts] = await Promise.all([
      // Caixas ainda abertos (ADR-018: no máximo um por loja, mas não assumimos): só a abertura.
      prisma.$queryRaw<Array<{ openedAt: Date }>>(
        Prisma.sql`
          SELECT "openedAt" FROM "cash_sessions"
          WHERE "tenantId" = ${tenantId}::uuid AND "closedAt" IS NULL
        `,
      ),
      // Fechamentos recentes com diferença entre o contado e o esperado (nudge; o valor exato fica
      // em Relatórios, com o ajuste de vendas tardias CS-5).
      prisma.$queryRaw<Array<{ cnt: number }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS "cnt" FROM "cash_sessions"
          WHERE "tenantId" = ${tenantId}::uuid
            AND "closedAt" IS NOT NULL AND "closedAt" >= ${divergenceCutoff}
            AND "closingAmount" IS NOT NULL AND "expectedAmount" IS NOT NULL
            AND "closingAmount" <> "expectedAmount"
        `,
      ),
      // Dívidas abertas (ADR-026) com o último recebimento (via receivables → payments). A regra de
      // "parada" (vencida OU inativa) é aplicada no core, por linha.
      prisma.$queryRaw<Array<{ dueDate: Date | null; openedAt: Date; lastPaymentAt: Date | null }>>(
        Prisma.sql`
          SELECT d."dueDate" AS "dueDate", d."openedAt" AS "openedAt",
            (SELECT MAX(rp."paidAt")
               FROM "receivable_payments" rp
               JOIN "receivables" r ON r."id" = rp."receivableId"
              WHERE r."debtId" = d."id") AS "lastPaymentAt"
          FROM "debts" d
          WHERE d."tenantId" = ${tenantId}::uuid AND d."status" = 'OPEN'
        `,
      ),
    ]);

    const cashOpenCount = openSessions.filter((s) => isCashOpenTooLong(s.openedAt, now)).length;
    const debtStaleCount = openDebts.filter((d) =>
      isDebtStale({ dueDate: d.dueDate, openedAt: d.openedAt, lastPaymentAt: d.lastPaymentAt }, now),
    ).length;

    push('cash-open-too-long', cashOpenCount);
    push('cash-divergence', divergenceCount[0]?.cnt ?? 0);
    push('debt-stale', debtStaleCount);

    // Ordena por gravidade (danger → warn → info), maior contagem primeiro dentro da gravidade.
    const rank: Record<AlertSeverity, number> = { danger: 0, warn: 1, info: 2 };
    data.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count);

    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /alerts falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar os alertas.' }, 500);
  }
});

/**
 * Lista paginada (keyset por `id`) dos produtos de UMA pendência, para o download em CSV (montado no
 * cliente — custo-zero). `$queryRaw` com casts para `float8` para não instanciar `Decimal.js` por
 * linha (o `findMany` já estourou o teto de CPU do Worker no catálogo). Fatia 1: só `product-no-cost`.
 */
alerts.get('/products', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = alertProductsQuerySchema.safeParse({
    kind: c.req.query('kind'),
    cursor: c.req.query('cursor'),
  });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Parâmetros inválidos.', issues: parsed.error.flatten() }, 400);
  }
  const { kind, cursor } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"tenantId" = ${tenantId}::uuid`,
      Prisma.sql`"isActive" = true`,
      Prisma.sql`"deletedAt" IS NULL`,
      productAlertPredicate(kind),
    ];
    // Keyset: pega só o que vem DEPOIS do último id da página anterior (ordem estável por id).
    if (cursor) conditions.push(Prisma.sql`"id" > ${cursor}::uuid`);

    const rows = await prisma.$queryRaw<AlertProductRow[]>(
      Prisma.sql`
        SELECT
          "id"::text AS "id",
          "name",
          "sku",
          "ean",
          "salePrice"::float8 AS "salePrice",
          "costPrice"::float8 AS "costPrice",
          "stockQty"::float8 AS "stockQty"
        FROM "products"
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY "id" ASC
        LIMIT ${PAGE_SIZE + 1}
      `,
    );

    // Pediu PAGE_SIZE+1 para saber se há próxima página sem um COUNT extra.
    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    const body: AlertProductsPage = { rows: page, nextCursor };
    return c.json({ ok: true, data: body });
  } catch (err) {
    console.error('GET /alerts/products falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar a lista do alerta.' }, 500);
  }
});

// Formatação pt-BR no servidor (o detalhe do bloco C já sai pronto para exibir). O Worker roda em UTC;
// aplicamos o fuso do Brasil (UTC-3, sem horário de verão desde 2019) subtraindo 3h antes de formatar
// timestamps — datas-só (vencimento) usam `formatDateBr`, que é UTC-safe.
const BR_OFFSET_MS = 3 * 60 * 60 * 1000;
function brDate(d: Date): string {
  const t = new Date(d.getTime() - BR_OFFSET_MS);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${t.getUTCFullYear()}`;
}
function brDateTime(d: Date): string {
  const t = new Date(d.getTime() - BR_OFFSET_MS);
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mi = String(t.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}
const brl = (n: number): string =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Detalhe (lista enxuta, já formatada) de UM alerta do bloco C, para o pop-up "Ver" — quando não dá
 * para levar à tela com o filtro pronto, o operador ao menos vê as datas/valores (ex.: as datas das
 * divergências de caixa). Volumes pequenos (1 caixa aberto por loja; dívidas abertas), sem paginação.
 */
alerts.get('/detail', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = alertDetailQuerySchema.safeParse({ kind: c.req.query('kind') });
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Parâmetros inválidos.', issues: parsed.error.flatten() }, 400);
  }
  const { kind } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const now = new Date();
    let rows: AlertDetailRow[] = [];

    if (kind === 'cash-open-too-long') {
      const sessions = await prisma.$queryRaw<Array<{ id: string; openedAt: Date }>>(
        Prisma.sql`
          SELECT "id"::text AS "id", "openedAt" FROM "cash_sessions"
          WHERE "tenantId" = ${tenantId}::uuid AND "closedAt" IS NULL
          ORDER BY "openedAt" ASC
        `,
      );
      rows = sessions
        .filter((s) => isCashOpenTooLong(s.openedAt, now))
        .map((s) => {
          const hours = Math.floor((now.getTime() - s.openedAt.getTime()) / (60 * 60 * 1000));
          return {
            id: s.id,
            title: `Aberto desde ${brDateTime(s.openedAt)}`,
            subtitle: `${hours}h em aberto`,
          };
        });
    } else if (kind === 'cash-divergence') {
      const cutoff = new Date(now.getTime() - CASH_DIVERGENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const sessions = await prisma.$queryRaw<Array<{ id: string; closedAt: Date; diff: number }>>(
        Prisma.sql`
          SELECT "id"::text AS "id", "closedAt",
            ("closingAmount" - "expectedAmount")::float8 AS "diff"
          FROM "cash_sessions"
          WHERE "tenantId" = ${tenantId}::uuid
            AND "closedAt" IS NOT NULL AND "closedAt" >= ${cutoff}
            AND "closingAmount" IS NOT NULL AND "expectedAmount" IS NOT NULL
            AND "closingAmount" <> "expectedAmount"
          ORDER BY "closedAt" DESC
        `,
      );
      rows = sessions.map((s) => ({
        id: s.id,
        title: `Fechado em ${brDate(s.closedAt)}`,
        subtitle: `${s.diff < 0 ? 'Falta' : 'Sobra'} ${brl(Math.abs(s.diff))}`,
      }));
    } else {
      // debt-stale: dívidas abertas (ADR-026) filtradas pela regra pura do core, com nome/nº/atividade.
      const debts = await prisma.$queryRaw<
        Array<{
          id: string;
          debtNumber: number;
          customerName: string | null;
          dueDate: Date | null;
          openedAt: Date;
          lastPaymentAt: Date | null;
        }>
      >(
        Prisma.sql`
          SELECT d."id"::text AS "id", d."debtNumber" AS "debtNumber", c."name" AS "customerName",
            d."dueDate" AS "dueDate", d."openedAt" AS "openedAt",
            (SELECT MAX(rp."paidAt")
               FROM "receivable_payments" rp
               JOIN "receivables" r ON r."id" = rp."receivableId"
              WHERE r."debtId" = d."id") AS "lastPaymentAt"
          FROM "debts" d
          JOIN "customers" c ON c."id" = d."customerId"
          WHERE d."tenantId" = ${tenantId}::uuid AND d."status" = 'OPEN'
        `,
      );
      const cutoffMs = now.getTime() - DEBT_STALE_ALERT_DAYS * 24 * 60 * 60 * 1000;
      rows = debts
        .filter((d) =>
          isDebtStale({ dueDate: d.dueDate, openedAt: d.openedAt, lastPaymentAt: d.lastPaymentAt }, now),
        )
        .map((d) => {
          const overdue = d.dueDate != null && d.dueDate.getTime() < cutoffMs;
          const lastActivity = (d.lastPaymentAt ?? d.openedAt).getTime();
          const days = Math.floor((now.getTime() - lastActivity) / (24 * 60 * 60 * 1000));
          // `dueDate` é data-só (meia-noite UTC); `formatDateBr` espera string e formata em UTC.
          const subtitle =
            overdue && d.dueDate
              ? `Vencida em ${formatDateBr(d.dueDate.toISOString())}`
              : `Sem recebimento há ${days} dias`;
          return {
            id: d.id,
            title: `${formatDebtNumber(d.debtNumber)} — ${d.customerName ?? 'Cliente'}`,
            subtitle,
          };
        });
    }

    return c.json({ ok: true, data: rows });
  } catch (err) {
    console.error('GET /alerts/detail falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar o detalhe do alerta.' }, 500);
  }
});

export default alerts;
