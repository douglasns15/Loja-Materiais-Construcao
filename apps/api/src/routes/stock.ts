import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { applyStockMovement, calcInventoryAdjustment } from '@nexoloja/core';
import { createStockMovementSchema, inventoryAdjustmentSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const stock = new Hono<Env>();
stock.use('*', requireAuth);

/**
 * Bordas de período no fuso da loja (Brasil, UTC-3), mesmo critério dos Relatórios:
 * `from` começa às 00:00 e `to` termina às 23:59:59.999 daquele dia (não perde a noite).
 * Sem datas, retorna `undefined` (cobre todo o histórico). Mantido local para o endpoint
 * ficar autocontido (o helper dos Relatórios não é exportado).
 */
function buildDateFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = new Date(`${from}T00:00:00.000-03:00`);
  if (to) filter.lte = new Date(`${to}T23:59:59.999-03:00`);
  return from || to ? filter : undefined;
}

/**
 * Teto de segurança (não é paginação de verdade): a tela filtra no servidor por
 * produto/tipo/motivo/período, então o retorno já vem enxuto; 1000 cobre com folga um
 * período escolhido mesmo numa loja movimentada. Se um dia estourar, o caminho é keyset
 * (como no Histórico de Vendas). A tela ainda pagina o exibido com "Mostrar mais".
 */
const MOVEMENTS_CAP = 1000;

/**
 * Histórico de movimentações do tenant (entradas/saídas), mais recentes primeiro.
 * Filtros OPCIONAIS aplicados no SERVIDOR (assim a busca varre todo o histórico, não só a
 * página carregada): `?productId=`, `?type=INCOME|EXPENSE`, `?reason=` (casa o motivo OU o
 * nome do fornecedor, sem diferenciar maiúsc./minúsc.) e `?from=`/`?to=` (AAAA-MM-DD, fuso
 * da loja). Inclui nome do produto/fornecedor.
 */
stock.get('/movements', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const productId = c.req.query('productId');
  const typeParam = c.req.query('type');
  const type = typeParam === 'INCOME' || typeParam === 'EXPENSE' ? typeParam : undefined;
  const reason = c.req.query('reason')?.trim();
  const createdAt = buildDateFilter(c.req.query('from'), c.req.query('to'));

  try {
    const prisma = createPrismaClient(connectionString);
    const items = await prisma.stockMovement.findMany({
      where: {
        tenantId,
        ...(productId ? { productId } : {}),
        ...(type ? { type } : {}),
        // Motivo: busca o texto no motivo OU no nome do fornecedor (mesma cobertura do filtro
        // que antes rodava no cliente), agora no banco → acha em todo o histórico.
        ...(reason
          ? {
              OR: [
                { reason: { contains: reason, mode: 'insensitive' } },
                { supplier: { is: { name: { contains: reason, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MOVEMENTS_CAP,
      include: {
        product: { select: { name: true, unit: true } },
        supplier: { select: { name: true } },
      },
    });
    return c.json({ ok: true, data: items });
  } catch (err) {
    console.error('GET /stock/movements falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar movimentações.' }, 500);
  }
});

/**
 * Resumo consolidado de estoque por produto (EF-2): Σ entradas e Σ saídas de cada produto,
 * agregadas no servidor (Prisma `groupBy` + `_sum`, cost-zero — não trafega o histórico inteiro).
 * A tela cruza com `Product.stockQty`/`minStockQty` para a visão "saldo × mínimo × histórico" e
 * confere a consistência do cache (ADR-001): Σ INCOME − Σ EXPENSE deve bater com `stockQty`.
 */
stock.get('/summary', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const rows = await prisma.stockMovement.groupBy({
      by: ['productId', 'type'],
      where: { tenantId },
      _sum: { quantity: true },
    });
    // Reagrupa (produto, tipo) → { productId, income, expense }.
    const byProduct = new Map<string, { income: number; expense: number }>();
    for (const r of rows) {
      const cur = byProduct.get(r.productId) ?? { income: 0, expense: 0 };
      const qty = Number(r._sum.quantity ?? 0);
      if (r.type === 'INCOME') cur.income += qty;
      else cur.expense += qty;
      byProduct.set(r.productId, cur);
    }
    const data = [...byProduct.entries()].map(([productId, v]) => ({
      productId,
      income: Number(v.income.toFixed(4)),
      expense: Number(v.expense.toFixed(4)),
    }));
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /stock/summary falhou:', err);
    return c.json({ ok: false, error: 'Falha ao resumir o estoque.' }, 500);
  }
});

/**
 * Entrada/saída de estoque (compra, recebimento). Transação atômica (ADR-001):
 * grava StockMovement + atualiza `Product.stockQty`. Bloqueia saída que deixaria
 * o estoque negativo. Auditoria natural pelo próprio StockMovement (sem AuditEvent).
 * Bloqueado em loja inativa (ADR-009); o ajuste de inventário (`/adjust`) segue liberado
 * (correção de contagem, como cancelar/devolver).
 */
stock.post('/movements', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = createStockMovementSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da movimentação inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const mov = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const product = await prisma.product.findFirst({
      where: { id: mov.productId, tenantId, deletedAt: null },
      select: { id: true, name: true, stockQty: true },
    });
    if (!product) {
      return c.json({ ok: false, error: 'Produto inexistente.' }, 400);
    }

    const newQty = applyStockMovement(Number(product.stockQty), mov.type, mov.quantity);
    if (newQty < 0) {
      return c.json(
        {
          ok: false,
          error: `Saída maior que o estoque de "${product.name}" (disponível: ${Number(product.stockQty)}).`,
        },
        400,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: mov.productId,
          supplierId: mov.supplierId,
          type: mov.type,
          quantity: mov.quantity,
          unitCost: mov.unitCost,
          reason: mov.reason,
          syncStatus: 'SYNCED',
          // Autoria (ADR-010): quem registrou a entrada/saída (antes não era registrado).
          userId: c.get('userId'),
          registeredByName: c.get('userName'),
        },
      });
      await tx.product.update({
        where: { id: mov.productId },
        data: {
          stockQty: newQty,
          // Custo do cadastro em dia com a última compra ("último custo"): quando o operador
          // confirma na entrada, o cliente manda `newCostPrice` (por unidade de venda) e o custo
          // do produto é sobrescrito na MESMA transação. Só em entrada (INCOME); saída não mexe
          // no custo. Vazio ⇒ mantém o custo atual.
          ...(mov.type === 'INCOME' && mov.newCostPrice != null
            ? { costPrice: mov.newCostPrice }
            : {}),
        },
      });
      return movement;
    });

    return c.json({ ok: true, data: { ...result, stockQty: newQty } }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return c.json({ ok: false, error: 'Produto ou fornecedor inexistente.' }, 400);
    }
    console.error('POST /stock/movements falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a movimentação.' }, 500);
  }
});

/**
 * Ajuste manual de inventário (ADR-004): informa a contagem real; o sistema gera a
 * movimentação (entrada/saída) até o saldo bater. Transação atômica:
 * StockMovement + update `Product.stockQty` + AuditEvent `ADJUST_STOCK`.
 */
stock.post('/adjust', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = inventoryAdjustmentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados do ajuste inválidos (motivo é obrigatório).', issues: parsed.error.flatten() },
      400,
    );
  }
  const adj = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const product = await prisma.product.findFirst({
      where: { id: adj.productId, tenantId, deletedAt: null },
      select: { id: true, name: true, stockQty: true },
    });
    if (!product) {
      return c.json({ ok: false, error: 'Produto inexistente.' }, 400);
    }

    const previousQty = Number(product.stockQty);
    const { type, quantity } = calcInventoryAdjustment(previousQty, adj.countedQty);
    if (quantity === 0) {
      return c.json(
        { ok: false, error: 'A contagem informada já bate com o estoque atual.' },
        400,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: adj.productId,
          type,
          quantity,
          reason: `Ajuste de inventário: ${adj.reason}`,
          syncStatus: 'SYNCED',
          // Autoria (ADR-010): quem fez o ajuste (mesmo operador do AuditEvent abaixo).
          userId,
          registeredByName: c.get('userName'),
        },
      });
      const p = await tx.product.update({
        where: { id: adj.productId },
        data: { stockQty: adj.countedQty },
        select: { id: true, name: true, stockQty: true },
      });
      // Evento crítico (ADR-004): ajuste manual de estoque.
      await tx.auditEvent.create({
        data: {
          tenantId,
          userId,
          entity: 'Product',
          entityId: adj.productId,
          action: 'ADJUST_STOCK',
          meta: { previousQty, countedQty: adj.countedQty, type, quantity, reason: adj.reason },
        },
      });
      return p;
    });

    return c.json({ ok: true, data: { ...updated, previousQty, type, quantity } });
  } catch (err) {
    console.error('POST /stock/adjust falhou:', err);
    return c.json({ ok: false, error: 'Falha ao ajustar o estoque.' }, 500);
  }
});

export default stock;
