import { Hono } from 'hono';
import { Prisma } from '@nexoloja/db';
import {
  availableQty,
  breakdownShrink,
  costPerBaseUnit,
  costPriceFromBaseCost,
  productionCost,
  productionShortages,
  splitBreakdownCost,
  suggestBreakdownCuts,
  summarizeProductionDay,
  tracksStock,
} from '@nexoloja/core';
import {
  BREAKDOWN_SUGGESTION_WINDOW,
  PRODUCTION_LOSS_PREFIX,
  createBreakdownSchema,
  createProductionSchema,
  formatProductionNumber,
  productionLossReasonText,
  productionLossSchema,
  recipeSchema,
  type BreakdownSuggestedCuts,
  type ProductionDaySummary,
  type ProductionLossRow,
  type ProductionRow,
  type RecipeRow,
} from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAdmin, requireAuth } from '../middleware/auth';

/**
 * Produção com ficha técnica (ADR-043). Duas coisas moram aqui:
 *  - **Ficha técnica** (`/recipes/:productId`): "para produzir N do pronto, uso estes insumos".
 *    Leitura para todos (a cozinha produz por ela); escrita só Admin (decisão do Owner).
 *  - **Produção** (`/`): o evento P-0001 — numa transação (ADR-001), os insumos controlados saem do
 *    estoque (EXPENSE), o pronto entra (INCOME) e o custo do pronto vira o "último custo".
 *    Qualquer usuário registra (decisão do Owner); insumo controlado sem saldo BLOQUEIA.
 *  - **Perda e resumo do dia** (`/loss`, `/summary` — Fatia 2): o pronto que sobrou/queimou/caiu sai
 *    do estoque como `StockMovement` EXPENSE com motivo "Perda — …" (sem tabela nova), e o resumo
 *    mostra produzido × vendido × perda × em estoque por produto pronto.
 *  - **Desmembramento** (`/breakdown` — Fatia 3): 1 peça → N cortes, o mesmo evento P- com
 *    `kind = BREAKDOWN` (1 linha INPUT, N OUTPUT). O custo da peça é rateado entre os cortes pelo
 *    valor de venda (decisão do Owner) e cada corte recebe o último custo.
 */
const productions = new Hono<Env>();
productions.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Colunas do produto que a ficha/produção precisam (saldo, custo, unidade). */
const PRODUCT_COLS = {
  id: true,
  name: true,
  unit: true,
  conversionFactor: true,
  costPrice: true,
  salePrice: true,
  stockQty: true,
  reservedQty: true,
  trackStock: true,
  altUnit: true,
  deletedAt: true,
} as const;

type ProductCols = Prisma.ProductGetPayload<{ select: typeof PRODUCT_COLS }>;

const baseCostOf = (p: ProductCols) =>
  costPerBaseUnit({
    unit: p.unit,
    conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
    costPrice: Number(p.costPrice),
  });

const availableOf = (p: ProductCols) => availableQty(Number(p.stockQty), Number(p.reservedQty ?? 0));

/**
 * "Último custo" (ADR-043, decisão do Owner) do produto que ENTROU pela produção: `costPrice` do
 * cadastro a partir do custo por unidade-base, com o mesmo aviso da Entrada de estoque quando muda
 * ("custo ajustado, confira o preço"). Sem custo (insumos/peça com cadastro zerado), não sobrescreve.
 */
function lastCostData(p: ProductCols, baseUnitCost: number, hasCost: boolean) {
  if (!hasCost) return {};
  const costPrice = costPriceFromBaseCost(
    { unit: p.unit, conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null },
    baseUnitCost,
  );
  return { costPrice, ...(costPrice !== Number(p.costPrice) ? { priceReviewPendingAt: new Date() } : {}) };
}

/**
 * Produtos que o resumo do dia e a perda aceitam: os prontos com ficha técnica E tudo que já saiu de
 * uma produção (cortes do desmembramento — decisão do Owner, Fatia 3).
 */
const PRODUCED_WHERE = {
  OR: [{ recipe: { isNot: null } }, { productionLines: { some: { direction: 'OUTPUT' } } }],
} satisfies Prisma.ProductWhereInput;

/** Peso médio da peça quando o produto por peso também vende inteiro (ADR-040 §4). */
const pieceWeightOf = (p: ProductCols) =>
  (p.unit === 'KILOGRAM' || p.unit === 'LITER') && p.altUnit === 'UNIT' && p.conversionFactor != null
    ? Number(p.conversionFactor)
    : null;

const RECIPE_INCLUDE = {
  product: { select: PRODUCT_COLS },
  // Insumos em ordem alfabética (o id é aleatório e embaralhava a ficha a cada carga).
  items: { include: { product: { select: PRODUCT_COLS } }, orderBy: { product: { name: 'asc' } } },
} as const;
type RecipeWithAll = Prisma.RecipeGetPayload<{ include: typeof RECIPE_INCLUDE }>;

function toRecipeRow(r: RecipeWithAll): RecipeRow {
  return {
    productId: r.productId,
    productName: r.product.name,
    unit: r.product.unit,
    pieceWeight: pieceWeightOf(r.product),
    trackStock: tracksStock(r.product),
    salePrice: Number(r.product.salePrice),
    stockQty: Number(r.product.stockQty),
    yieldQty: Number(r.yieldQty),
    notes: r.notes,
    items: r.items.map((it) => ({
      productId: it.productId,
      name: it.product.name,
      unit: it.product.unit,
      quantity: Number(it.quantity),
      unitCost: baseCostOf(it.product),
      trackStock: tracksStock(it.product),
      available: tracksStock(it.product) ? availableOf(it.product) : null,
    })),
    updatedByName: r.updatedByName,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Fichas da loja (produtos prontos não excluídos), em ordem de nome — o seletor da tela Produção. */
productions.get('/recipes', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.recipe.findMany({
      where: { tenantId, product: { deletedAt: null } },
      include: RECIPE_INCLUDE,
      orderBy: { product: { name: 'asc' } },
    });
    return c.json({ ok: true, data: rows.map(toRecipeRow) });
  } catch (err) {
    console.error('GET /productions/recipes falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as fichas técnicas.' }, 500);
  }
});

/** Ficha de um produto (`null` quando ainda não tem). */
productions.get('/recipes/:productId', async (c) => {
  const tenantId = getTenantId(c);
  const productId = c.req.param('productId');
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!UUID_RE.test(productId)) {
    return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
  }
  try {
    const prisma = getPrisma(c);
    const r = await prisma.recipe.findFirst({ where: { tenantId, productId }, include: RECIPE_INCLUDE });
    return c.json({ ok: true, data: r ? toRecipeRow(r) : null });
  } catch (err) {
    console.error('GET /productions/recipes/:productId falhou:', err);
    return c.json({ ok: false, error: 'Falha ao abrir a ficha técnica.' }, 500);
  }
});

/**
 * Cria ou substitui a ficha do produto pronto. O pronto precisa controlar estoque (é o ponto da
 * produção); insumos são produtos da loja, não excluídos, diferentes do próprio pronto. Admin.
 */
productions.put('/recipes/:productId', requireAdmin, async (c) => {
  const tenantId = getTenantId(c);
  const productId = c.req.param('productId');
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!UUID_RE.test(productId)) {
    return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
  }
  const parsed = recipeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Ficha técnica inválida.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { yieldQty, notes, items } = parsed.data;
  if (items.some((i) => i.productId === productId)) {
    return c.json({ ok: false, error: 'O produto pronto não pode ser insumo da própria ficha.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const output = await prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { id: true, name: true, trackStock: true },
    });
    if (!output) {
      return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
    }
    if (!tracksStock(output)) {
      return c.json(
        { ok: false, error: `Ligue "Controlar estoque" em "${output.name}" para ele ter ficha técnica.` },
        400,
      );
    }
    const found = await prisma.product.count({
      where: { tenantId, deletedAt: null, id: { in: items.map((i) => i.productId) } },
    });
    if (found !== items.length) {
      return c.json({ ok: false, error: 'Um dos insumos não existe (ou foi excluído).' }, 400);
    }
    const author = { updatedById: c.get('userId'), updatedByName: c.get('userName') };
    await prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.upsert({
        where: { productId },
        create: {
          tenantId,
          productId,
          yieldQty,
          notes: notes || null,
          createdById: c.get('userId'),
          createdByName: c.get('userName'),
          ...author,
        },
        update: { yieldQty, notes: notes || null, ...author },
        select: { id: true },
      });
      // Insumos: substitui a lista inteira (a ficha é pequena — até 30 linhas).
      await tx.recipeItem.deleteMany({ where: { recipeId: recipe.id } });
      await tx.recipeItem.createMany({
        data: items.map((i) => ({ tenantId, recipeId: recipe.id, productId: i.productId, quantity: i.quantity })),
      });
    });
    const saved = await prisma.recipe.findFirst({ where: { tenantId, productId }, include: RECIPE_INCLUDE });
    return c.json({ ok: true, data: saved ? toRecipeRow(saved) : null });
  } catch (err) {
    console.error('PUT /productions/recipes/:productId falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar a ficha técnica.' }, 500);
  }
});

/** Exclui a ficha (configuração — apaga de vez; as produções registradas mantêm suas linhas). Admin. */
productions.delete('/recipes/:productId', requireAdmin, async (c) => {
  const tenantId = getTenantId(c);
  const productId = c.req.param('productId');
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const res = await prisma.recipe.deleteMany({ where: { tenantId, productId } });
    if (res.count === 0) {
      return c.json({ ok: false, error: 'Este produto não tem ficha técnica.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('DELETE /productions/recipes/:productId falhou:', err);
    return c.json({ ok: false, error: 'Falha ao excluir a ficha técnica.' }, 500);
  }
});

const PRODUCTION_INCLUDE = {
  lines: { include: { product: { select: { name: true, unit: true } } } },
} as const;
type ProductionWithLines = Prisma.ProductionGetPayload<{ include: typeof PRODUCTION_INCLUDE }>;

function toProductionRow(p: ProductionWithLines): ProductionRow {
  const line = (l: ProductionWithLines['lines'][number]) => ({
    productId: l.productId,
    name: l.product.name,
    unit: l.product.unit,
    quantity: Number(l.quantity),
    unitCost: l.unitCost != null ? Number(l.unitCost) : null,
  });
  return {
    id: p.id,
    productionNumber: p.productionNumber,
    kind: p.kind,
    createdAt: p.createdAt.toISOString(),
    registeredByName: p.registeredByName,
    totalCost: Number(p.totalCost),
    notes: p.notes,
    outputs: p.lines.filter((l) => l.direction === 'OUTPUT').map(line),
    inputs: p.lines.filter((l) => l.direction === 'INPUT').map(line),
  };
}

/** `?day=AAAA-MM-DD` (fuso da loja, -03:00) → limites do dia; ausente/inválido ⇒ hoje. */
function dayRange(dayParam: string | undefined): { day: string; gte: Date; lte: Date } {
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : today;
  return { day, gte: new Date(`${day}T00:00:00.000-03:00`), lte: new Date(`${day}T23:59:59.999-03:00`) };
}

/** Produções de um dia (`?day=AAAA-MM-DD`, fuso da loja; padrão = hoje), mais recentes primeiro. */
productions.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const { gte, lte } = dayRange(c.req.query('day'));
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.production.findMany({
      where: { tenantId, createdAt: { gte, lte } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: PRODUCTION_INCLUDE,
    });
    return c.json({ ok: true, data: rows.map(toProductionRow) });
  } catch (err) {
    console.error('GET /productions falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as produções.' }, 500);
  }
});

/**
 * Registra uma produção (ADR-043 §2). Os insumos aceitos são os da ficha do pronto (o operador
 * corrige só as quantidades usadas). Numa transação (ADR-001): contador P-, EXPENSE + `stockQty`
 * dos insumos controlados, INCOME + `stockQty` do pronto, custo do pronto = último custo (com o
 * aviso de revisão de preço quando muda) e o registro da produção com as linhas.
 */
productions.post('/', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const parsed = createProductionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados da produção inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const body = parsed.data;
  try {
    const prisma = getPrisma(c);
    const recipe = await prisma.recipe.findFirst({
      where: { tenantId, productId: body.productId },
      include: RECIPE_INCLUDE,
    });
    if (!recipe || recipe.product.deletedAt) {
      return c.json({ ok: false, error: 'Este produto não tem ficha técnica.' }, 400);
    }
    const output = recipe.product;
    if (!tracksStock(output)) {
      return c.json({ ok: false, error: `Ligue "Controlar estoque" em "${output.name}" antes de produzir.` }, 400);
    }
    const byId = new Map(recipe.items.map((it) => [it.productId, it.product]));
    if (body.inputs.some((i) => !byId.has(i.productId))) {
      return c.json({ ok: false, error: 'Um dos insumos não faz parte da ficha técnica.' }, 400);
    }
    const used = body.inputs
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const p = byId.get(i.productId)!;
        return { product: p, quantity: i.quantity, unitCost: baseCostOf(p), tracked: tracksStock(p) };
      });
    if (used.some((u) => u.product.deletedAt)) {
      return c.json({ ok: false, error: 'Um dos insumos foi excluído. Atualize a ficha técnica.' }, 400);
    }

    // Decisão do Owner: insumo controlado sem saldo bloqueia a produção (como a venda).
    const short = productionShortages(
      used.map((u) => ({
        productId: u.product.id,
        quantity: u.quantity,
        tracked: u.tracked,
        available: u.tracked ? availableOf(u.product) : 0,
      })),
    );
    if (short.length > 0) {
      const s = short[0]!;
      const name = byId.get(s.productId)?.name ?? 'insumo';
      const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
      return c.json(
        {
          ok: false,
          error: `Falta saldo de "${name}" (tem ${fmt(s.available)}, precisa ${fmt(s.needed)}). Dê entrada antes de produzir.`,
        },
        400,
      );
    }

    const cost = productionCost(used, body.quantity);
    // Último custo (decisão do Owner). Sem custo nos insumos (cadastro zerado), não sobrescreve.
    const outputCost = lastCostData(output, cost.unitCost, cost.totalCost > 0);
    const userId = c.get('userId');
    const userName = c.get('userName');

    const created = await prisma.$transaction(async (tx) => {
      const { lastProductionNumber } = await tx.tenant.update({
        where: { id: tenantId },
        data: { lastProductionNumber: { increment: 1 } },
        select: { lastProductionNumber: true },
      });
      const code = formatProductionNumber(lastProductionNumber);
      const lines: Prisma.ProductionLineCreateManyProductionInput[] = [];

      for (const u of used) {
        const mov = u.tracked
          ? await tx.stockMovement.create({
              data: {
                tenantId,
                productId: u.product.id,
                type: 'EXPENSE',
                quantity: u.quantity,
                unitCost: u.unitCost,
                reason: `Produção ${code} — ${output.name}`.slice(0, 150),
                syncStatus: 'SYNCED',
                userId,
                registeredByName: userName,
              },
            })
          : null;
        if (mov) {
          await tx.product.update({ where: { id: u.product.id }, data: { stockQty: { decrement: u.quantity } } });
        }
        lines.push({
          tenantId,
          productId: u.product.id,
          direction: 'INPUT',
          quantity: u.quantity,
          unitCost: u.unitCost,
          stockMovementId: mov?.id ?? null,
        });
      }

      const outMov = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: output.id,
          type: 'INCOME',
          quantity: body.quantity,
          unitCost: cost.unitCost,
          reason: `Produção ${code}`,
          syncStatus: 'SYNCED',
          userId,
          registeredByName: userName,
        },
      });
      await tx.product.update({
        where: { id: output.id },
        // Último custo + o mesmo aviso da Entrada de estoque: o custo mudou, o preço não — "confira o preço".
        data: { stockQty: { increment: body.quantity }, ...outputCost },
      });
      lines.push({
        tenantId,
        productId: output.id,
        direction: 'OUTPUT',
        quantity: body.quantity,
        unitCost: cost.unitCost,
        stockMovementId: outMov.id,
      });

      return tx.production.create({
        data: {
          tenantId,
          productionNumber: lastProductionNumber,
          kind: 'RECIPE',
          totalCost: cost.totalCost,
          notes: body.notes || null,
          userId,
          registeredByName: userName,
          lines: { createMany: { data: lines } },
        },
        include: PRODUCTION_INCLUDE,
      });
    });
    return c.json({ ok: true, data: toProductionRow(created) }, 201);
  } catch (err) {
    console.error('POST /productions falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a produção.' }, 500);
  }
});

/** Monta a linha da perda para a tela (motivo sem o prefixo "Perda — "). */
function toLossRow(m: {
  id: string;
  productId: string;
  quantity: Prisma.Decimal;
  reason: string | null;
  unitCost: Prisma.Decimal | null;
  createdAt: Date;
  registeredByName: string | null;
  product: { name: string; unit: string };
}): ProductionLossRow {
  return {
    id: m.id,
    productId: m.productId,
    name: m.product.name,
    unit: m.product.unit,
    quantity: Number(m.quantity),
    reason: (m.reason ?? '').slice(PRODUCTION_LOSS_PREFIX.length),
    unitCost: m.unitCost != null ? Number(m.unitCost) : null,
    createdAt: m.createdAt.toISOString(),
    registeredByName: m.registeredByName,
  };
}

/**
 * Resumo do dia (ADR-043 §3): por produto pronto (com ficha ou que já saiu de uma produção — cortes
 * do desmembramento, Fatia 3), produzido × vendido × perda × em
 * estoque, e a lista das perdas do dia. Vendido = vendas não canceladas/devolvidas do dia, em
 * unidade-base e LÍQUIDO do devolvido (mesma regra dos Relatórios, ADR-036/037).
 */
productions.get('/summary', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const { day, gte, lte } = dayRange(c.req.query('day'));
  try {
    const prisma = getPrisma(c);
    const products = await prisma.product.findMany({
      where: { tenantId, deletedAt: null, ...PRODUCED_WHERE },
      select: PRODUCT_COLS,
    });
    const ids = products.map((p) => p.id);

    const [produced, sold, lossMovs] = await Promise.all([
      prisma.productionLine.findMany({
        where: { tenantId, direction: 'OUTPUT', production: { createdAt: { gte, lte } } },
        select: { productId: true, quantity: true },
      }),
      ids.length === 0
        ? Promise.resolve([] as { productId: string; qty: number }[])
        : prisma.$queryRaw<{ productId: string; qty: number }[]>(Prisma.sql`
            SELECT oi."productId", SUM(COALESCE(oi."baseQuantity", oi."quantity") - oi."returnedBaseQty")::float8 AS qty
            FROM "order_items" oi
            JOIN "orders" o ON o."id" = oi."orderId"
            WHERE o."tenantId" = ${tenantId}::uuid
              AND o."status" NOT IN ('CANCELLED', 'RETURNED')
              AND o."createdAt" >= ${gte} AND o."createdAt" <= ${lte}
              AND oi."productId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
            GROUP BY oi."productId"
          `),
      prisma.stockMovement.findMany({
        where: {
          tenantId,
          type: 'EXPENSE',
          reason: { startsWith: PRODUCTION_LOSS_PREFIX },
          createdAt: { gte, lte },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { product: { select: { name: true, unit: true } } },
      }),
    ]);

    const rows = summarizeProductionDay(
      products.map((p) => ({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        pieceWeight: pieceWeightOf(p),
        stockQty: Number(p.stockQty),
      })),
      {
        produced: produced.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        sold: sold.map((s) => ({ productId: s.productId, quantity: Number(s.qty) })),
        lost: lossMovs.map((m) => ({ productId: m.productId, quantity: Number(m.quantity) })),
      },
    );
    const data: ProductionDaySummary = { day, products: rows, losses: lossMovs.map(toLossRow) };
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /productions/summary falhou:', err);
    return c.json({ ok: false, error: 'Falha ao montar o resumo do dia.' }, 500);
  }
});

/**
 * Registra a PERDA de um produto pronto (ADR-043 §3): sobra do dia, queimou, caiu… Numa transação
 * (ADR-001): `StockMovement` EXPENSE (motivo "Perda — …", custo atual congelado) + `stockQty`
 * decrementado. Só produto com ficha técnica ou que já saiu de uma produção (corte do desmembramento);
 * não passa do disponível. Qualquer usuário (loja ativa).
 */
productions.post('/loss', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const parsed = productionLossSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados da perda inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const body = parsed.data;
  try {
    const prisma = getPrisma(c);
    const p = await prisma.product.findFirst({
      where: { id: body.productId, tenantId, deletedAt: null, ...PRODUCED_WHERE },
      select: PRODUCT_COLS,
    });
    if (!p) {
      return c.json({ ok: false, error: 'A perda aqui é só de produto produzido na loja (ficha técnica ou corte).' }, 400);
    }
    if (!tracksStock(p)) {
      return c.json({ ok: false, error: `"${p.name}" não controla estoque.` }, 400);
    }
    const short = productionShortages([
      { productId: p.id, quantity: body.quantity, tracked: true, available: availableOf(p) },
    ]);
    if (short.length > 0) {
      const weighed = p.unit === 'KILOGRAM' || p.unit === 'LITER';
      const fmt = (n: number) =>
        n.toLocaleString('pt-BR', { minimumFractionDigits: weighed ? 3 : 0, maximumFractionDigits: weighed ? 3 : 4 });
      const unit = p.unit === 'KILOGRAM' ? ' kg' : p.unit === 'LITER' ? ' L' : '';
      return c.json(
        { ok: false, error: `Só há ${fmt(short[0]!.available)}${unit} de "${p.name}" em estoque — confira a quantidade.` },
        400,
      );
    }
    const userId = c.get('userId');
    const userName = c.get('userName');
    const mov = await prisma.$transaction(async (tx) => {
      const m = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: p.id,
          type: 'EXPENSE',
          quantity: body.quantity,
          unitCost: baseCostOf(p),
          reason: productionLossReasonText(body.reason, body.note),
          syncStatus: 'SYNCED',
          userId,
          registeredByName: userName,
        },
      });
      await tx.product.update({ where: { id: p.id }, data: { stockQty: { decrement: body.quantity } } });
      return m;
    });
    return c.json({ ok: true, data: toLossRow({ ...mov, product: { name: p.name, unit: p.unit } }) }, 201);
  } catch (err) {
    console.error('POST /productions/loss falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a perda.' }, 500);
  }
});

/**
 * Cortes SUGERIDOS para desmembrar a peça (Fatia 3): os que saíram nos últimos
 * `BREAKDOWN_SUGGESTION_WINDOW` desmembramentos dela, mais frequentes primeiro (core
 * `suggestBreakdownCuts`) — um desmembramento parcial não encolhe a lista. A tela pré-monta com eles
 * (pesos em branco; o operador remove/adiciona). Sem histórico ⇒ vazio. Cortes excluídos ficam de
 * fora. Qualquer usuário.
 */
productions.get('/breakdown/cuts/:productId', async (c) => {
  const tenantId = getTenantId(c);
  const productId = c.req.param('productId');
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  if (!UUID_RE.test(productId)) {
    return c.json({ ok: false, error: 'Produto não encontrado.' }, 404);
  }
  try {
    const prisma = getPrisma(c);
    const recent = await prisma.production.findMany({
      where: { tenantId, kind: 'BREAKDOWN', lines: { some: { direction: 'INPUT', productId } } },
      orderBy: { createdAt: 'desc' },
      take: BREAKDOWN_SUGGESTION_WINDOW,
      select: {
        lines: {
          where: { direction: 'OUTPUT', product: { deletedAt: null } },
          select: { productId: true, product: { select: { name: true, unit: true } } },
        },
      },
    });
    const data: BreakdownSuggestedCuts = {
      basedOn: recent.length,
      cuts: suggestBreakdownCuts(
        recent.map((p) => p.lines.map((l) => ({ productId: l.productId, name: l.product.name, unit: l.product.unit }))),
      ),
    };
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /productions/breakdown/cuts/:productId falhou:', err);
    return c.json({ ok: false, error: 'Falha ao buscar os cortes sugeridos.' }, 500);
  }
});

/**
 * Desmembra uma PEÇA em cortes (ADR-043 Fatia 3): peça controlada com saldo (sem saldo BLOQUEIA,
 * como a produção), cortes controlados, distintos e diferentes da peça. Se peça e cortes estão na
 * mesma unidade, a soma dos cortes não passa da peça (a diferença é a quebra — osso, sebo —
 * informativa). Custo da peça (quantidade × custo por unidade-base) rateado pelo VALOR DE VENDA
 * dos cortes (core `splitBreakdownCost`). Numa transação (ADR-001): contador P-, EXPENSE + `stockQty`
 * da peça, INCOME + `stockQty` + último custo de cada corte, e a produção `kind = BREAKDOWN` com as
 * linhas. Qualquer usuário (loja ativa).
 */
productions.post('/breakdown', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const parsed = createBreakdownSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados do desmembramento inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const body = parsed.data;
  if (body.cuts.some((ct) => ct.productId === body.productId)) {
    return c.json({ ok: false, error: 'A peça não pode ser corte dela mesma.' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const ids = [body.productId, ...body.cuts.map((ct) => ct.productId)];
    const found = await prisma.product.findMany({
      where: { tenantId, deletedAt: null, id: { in: ids } },
      select: PRODUCT_COLS,
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    const piece = byId.get(body.productId);
    if (!piece) {
      return c.json({ ok: false, error: 'Peça não encontrada.' }, 404);
    }
    if (body.cuts.some((ct) => !byId.has(ct.productId))) {
      return c.json({ ok: false, error: 'Um dos cortes não existe (ou foi excluído).' }, 400);
    }
    const untracked = [piece, ...body.cuts.map((ct) => byId.get(ct.productId)!)].find((p) => !tracksStock(p));
    if (untracked) {
      return c.json({ ok: false, error: `Ligue "Controlar estoque" em "${untracked.name}" para desmembrar.` }, 400);
    }

    const weighed = piece.unit === 'KILOGRAM' || piece.unit === 'LITER';
    const fmt = (n: number) =>
      n.toLocaleString('pt-BR', { minimumFractionDigits: weighed ? 3 : 0, maximumFractionDigits: weighed ? 3 : 4 });
    const unitTxt = piece.unit === 'KILOGRAM' ? ' kg' : piece.unit === 'LITER' ? ' L' : '';
    const short = productionShortages([
      { productId: piece.id, quantity: body.quantity, tracked: true, available: availableOf(piece) },
    ]);
    if (short.length > 0) {
      return c.json(
        {
          ok: false,
          error: `Falta saldo de "${piece.name}" (tem ${fmt(short[0]!.available)}${unitTxt}, precisa ${fmt(short[0]!.needed)}${unitTxt}). Dê entrada antes de desmembrar.`,
        },
        400,
      );
    }
    const sameUnit = body.cuts.every((ct) => byId.get(ct.productId)!.unit === piece.unit);
    if (sameUnit && breakdownShrink(body.quantity, body.cuts.map((ct) => ct.quantity)).shrinkQty < 0) {
      return c.json(
        { ok: false, error: `Os cortes somam mais que a peça (${fmt(body.quantity)}${unitTxt}) — confira os pesos.` },
        400,
      );
    }

    const pieceUnitCost = baseCostOf(piece);
    const pieceCost = Number((body.quantity * pieceUnitCost).toFixed(2));
    const shares = splitBreakdownCost(
      pieceCost,
      body.cuts.map((ct) => {
        const p = byId.get(ct.productId)!;
        // Preço de venda por unidade-base (unidade fechada: preço da peça ÷ tamanho — mesma conta do custo).
        const salePrice = costPerBaseUnit({
          unit: p.unit,
          conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
          costPrice: Number(p.salePrice),
        });
        return { quantity: ct.quantity, salePrice };
      }),
    );
    const userId = c.get('userId');
    const userName = c.get('userName');

    const created = await prisma.$transaction(async (tx) => {
      const { lastProductionNumber } = await tx.tenant.update({
        where: { id: tenantId },
        data: { lastProductionNumber: { increment: 1 } },
        select: { lastProductionNumber: true },
      });
      const code = formatProductionNumber(lastProductionNumber);
      const lines: Prisma.ProductionLineCreateManyProductionInput[] = [];

      const inMov = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: piece.id,
          type: 'EXPENSE',
          quantity: body.quantity,
          unitCost: pieceUnitCost,
          reason: `Desmembramento ${code}`,
          syncStatus: 'SYNCED',
          userId,
          registeredByName: userName,
        },
      });
      await tx.product.update({ where: { id: piece.id }, data: { stockQty: { decrement: body.quantity } } });
      lines.push({
        tenantId,
        productId: piece.id,
        direction: 'INPUT',
        quantity: body.quantity,
        unitCost: pieceUnitCost,
        stockMovementId: inMov.id,
      });

      for (const [i, ct] of body.cuts.entries()) {
        const p = byId.get(ct.productId)!;
        const share = shares[i]!;
        const mov = await tx.stockMovement.create({
          data: {
            tenantId,
            productId: p.id,
            type: 'INCOME',
            quantity: ct.quantity,
            unitCost: share.unitCost,
            reason: `Desmembramento ${code} — ${piece.name}`.slice(0, 150),
            syncStatus: 'SYNCED',
            userId,
            registeredByName: userName,
          },
        });
        await tx.product.update({
          where: { id: p.id },
          data: { stockQty: { increment: ct.quantity }, ...lastCostData(p, share.unitCost, share.totalCost > 0) },
        });
        lines.push({
          tenantId,
          productId: p.id,
          direction: 'OUTPUT',
          quantity: ct.quantity,
          unitCost: share.unitCost,
          stockMovementId: mov.id,
        });
      }

      return tx.production.create({
        data: {
          tenantId,
          productionNumber: lastProductionNumber,
          kind: 'BREAKDOWN',
          totalCost: pieceCost,
          notes: body.notes || null,
          userId,
          registeredByName: userName,
          lines: { createMany: { data: lines } },
        },
        include: PRODUCTION_INCLUDE,
      });
    });
    return c.json({ ok: true, data: toProductionRow(created) }, 201);
  } catch (err) {
    console.error('POST /productions/breakdown falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar o desmembramento.' }, 500);
  }
});

export default productions;
