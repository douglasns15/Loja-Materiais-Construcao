import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import { calcSaleItemTotal, calcSaleTotals } from '@nexoloja/core';
import { createSaleSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireAuth } from '../middleware/auth';

const orders = new Hono<Env>();
orders.use('*', requireAuth);

/**
 * Registra uma venda. Em uma única transação (ADR-001):
 *  - cria o Order (vinculado ao caixa aberto) + OrderItems (snapshot) + Payments;
 *  - para cada item: grava StockMovement (saída) e decrementa Product.stockQty.
 * Exige caixa aberto e bloqueia venda sem estoque.
 */
orders.post('/', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const parsed = createSaleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da venda inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const sale = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);

    // Caixa aberto é obrigatório para vender.
    const session = await prisma.cashSession.findFirst({
      where: { tenantId, userId, closedAt: null },
      select: { id: true },
    });
    if (!session) {
      return c.json({ ok: false, error: 'Abra o caixa antes de registrar uma venda.' }, 400);
    }

    // Carrega os produtos do tenant e valida existência + estoque.
    const ids = sale.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, tenantId, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const item of sale.items) {
      const p = byId.get(item.productId);
      if (!p) {
        return c.json({ ok: false, error: 'Produto inexistente na venda.' }, 400);
      }
      if (Number(p.stockQty) < item.quantity) {
        return c.json(
          {
            ok: false,
            error: `Estoque insuficiente para "${p.name}" (disponível: ${Number(p.stockQty)}).`,
          },
          400,
        );
      }
    }

    const { subtotal, total } = calcSaleTotals(sale.items, {
      discountAmount: sale.discountAmount,
      freightAmount: sale.freightAmount,
    });
    const paid = Number(sale.payments.reduce((acc, pmt) => acc + pmt.amount, 0).toFixed(2));
    if (paid + 1e-9 < total) {
      return c.json(
        { ok: false, error: `Pagamento insuficiente: total ${total.toFixed(2)}, pago ${paid.toFixed(2)}.` },
        400,
      );
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId,
          userId,
          customerId: sale.customerId,
          cashSessionId: session.id,
          status: 'CONFIRMED',
          subtotal,
          discountAmount: sale.discountAmount ?? 0,
          freightAmount: sale.freightAmount ?? 0,
          total,
          notes: sale.notes,
          syncStatus: 'SYNCED',
          items: {
            create: sale.items.map((item) => {
              const p = byId.get(item.productId)!;
              return {
                productId: item.productId,
                productName: p.name, // snapshot
                unit: p.unit, // snapshot
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount ?? 0,
                total: calcSaleItemTotal(item),
              };
            }),
          },
          payments: {
            create: sale.payments.map((pmt) => ({
              tenantId, // denormalizado (ADR-003)
              method: pmt.method,
              amount: pmt.amount,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      // ADR-001: cada item gera saída de estoque + decremento atômico do cache.
      for (const item of sale.items) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'EXPENSE',
            quantity: item.quantity,
            reason: `Venda ${created.id}`,
            syncStatus: 'SYNCED',
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: item.quantity } },
        });
      }

      return created;
    });

    return c.json({ ok: true, data: { ...order, change: Number((paid - total).toFixed(2)) } }, 201);
  } catch (err) {
    console.error('POST /orders falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a venda.' }, 500);
  }
});

export default orders;
