import { Hono } from 'hono';
import { type Prisma } from '@nexoloja/db';
import {
  availableQty,
  costPerBaseUnit,
  costPriceFromBaseCost,
  productionCost,
  productionShortages,
  tracksStock,
} from '@nexoloja/core';
import {
  createProductionSchema,
  formatProductionNumber,
  recipeSchema,
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

/** Peso médio da peça quando o produto por peso também vende inteiro (ADR-040 §4). */
const pieceWeightOf = (p: ProductCols) =>
  (p.unit === 'KILOGRAM' || p.unit === 'LITER') && p.altUnit === 'UNIT' && p.conversionFactor != null
    ? Number(p.conversionFactor)
    : null;

const RECIPE_INCLUDE = {
  product: { select: PRODUCT_COLS },
  items: { include: { product: { select: PRODUCT_COLS } }, orderBy: { id: 'asc' } },
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
    createdAt: p.createdAt.toISOString(),
    registeredByName: p.registeredByName,
    totalCost: Number(p.totalCost),
    notes: p.notes,
    outputs: p.lines.filter((l) => l.direction === 'OUTPUT').map(line),
    inputs: p.lines.filter((l) => l.direction === 'INPUT').map(line),
  };
}

/** Produções de um dia (`?day=AAAA-MM-DD`, fuso da loja; padrão = hoje), mais recentes primeiro. */
productions.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const dayParam = c.req.query('day');
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : today;
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.production.findMany({
      where: {
        tenantId,
        createdAt: { gte: new Date(`${day}T00:00:00.000-03:00`), lte: new Date(`${day}T23:59:59.999-03:00`) },
      },
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
    const newCostPrice = costPriceFromBaseCost(
      { unit: output.unit, conversionFactor: output.conversionFactor != null ? Number(output.conversionFactor) : null },
      cost.unitCost,
    );
    // Último custo (decisão do Owner). Sem custo nos insumos (cadastro zerado), não sobrescreve.
    const updateCost = cost.totalCost > 0;
    const costChanges = updateCost && newCostPrice !== Number(output.costPrice);
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
        data: {
          stockQty: { increment: body.quantity },
          ...(updateCost ? { costPrice: newCostPrice } : {}),
          // Mesmo aviso da Entrada de estoque: o custo mudou, o preço não — "confira o preço".
          ...(costChanges ? { priceReviewPendingAt: new Date() } : {}),
        },
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

export default productions;
