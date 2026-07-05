import { Hono } from 'hono';
import { createPrismaClient, Prisma } from '@nexoloja/db';
import { applyStockMovement, calcInventoryAdjustment } from '@nexoloja/core';
import { createStockMovementSchema, inventoryAdjustmentSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

const stock = new Hono<Env>();
stock.use('*', requireAuth);

/**
 * Histórico de movimentações do tenant (entradas/saídas), mais recentes primeiro.
 * Filtro opcional por produto via `?productId=`. Inclui nome do produto/fornecedor.
 */
stock.get('/movements', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const productId = c.req.query('productId');

  try {
    const prisma = createPrismaClient(connectionString);
    const items = await prisma.stockMovement.findMany({
      where: { tenantId, ...(productId ? { productId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
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
        data: { stockQty: newQty },
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
