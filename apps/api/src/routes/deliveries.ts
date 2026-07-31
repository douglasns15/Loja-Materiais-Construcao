import { Hono } from 'hono';
import { createPrismaClient } from '@nexoloja/db';
import {
  isValidDelivery,
  orderFulfillmentStatus,
  remainingToDeliver,
} from '@nexoloja/core';
import { deliverOrderSchema, updateOrderNotesSchema } from '@nexoloja/shared';
import { type Env, getConnectionString, getTenantId } from '../lib/request';
import { requireActiveTenant, requireAuth } from '../middleware/auth';

/**
 * Retirada / entrega futura (ADR-020). Tela "Entregas/Retiradas", espelhando Contas a Receber:
 * lista paginada com filtro (pendentes / finalizadas / todas), detalhe com o LOG de cada retirada
 * parcial, e o registro de uma nova retirada (baixa real de estoque no evento — ADR-001). Opera só
 * sobre pedidos SCHEDULED confirmados.
 */
const deliveries = new Hono<Env>();
deliveries.use('*', requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

type Cursor = { createdAt: string; id: string };

/** Cursor keyset opaco (base64 de `createdAt|id`), como as demais telas grandes. */
function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(raw: string): Cursor | null {
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Lista os pedidos com retirada futura (ADR-020), paginada por cursor keyset em `createdAt desc,
 * id desc`. Filtros de `status`: `pending` (default — a retirar + parcial, o foco operacional),
 * `completed` (finalizadas) ou `all`. Só pedidos SCHEDULED confirmados (cancelados/devolvidos saem
 * da lista — aparecem no Histórico). Cada linha traz o cliente e um resumo do que falta retirar.
 */
deliveries.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const statusParam = c.req.query('status');
  const PENDING_PARTIAL: ('PENDING' | 'PARTIAL')[] = ['PENDING', 'PARTIAL'];
  const statusWhere =
    statusParam === 'completed'
      ? { fulfillmentStatus: 'COMPLETED' as const }
      : statusParam === 'all'
        ? {}
        : { fulfillmentStatus: { in: PENDING_PARTIAL } };

  const limitRaw = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), PAGE_MAX) : PAGE_DEFAULT;
  const cursorParam = c.req.query('cursor');
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  const keyset = cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      }
    : {};

  try {
    const prisma = createPrismaClient(connectionString);
    const list = await prisma.order.findMany({
      where: {
        tenantId,
        deliveryMode: 'SCHEDULED',
        status: 'CONFIRMED',
        ...statusWhere,
        ...keyset,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        total: true,
        fulfillmentStatus: true,
        scheduledPickupAt: true,
        perItemSchedule: true,
        createdAt: true,
        registeredByName: true,
        customer: { select: { id: true, name: true } },
        items: {
          select: { quantity: true, baseQuantity: true, deliveredBaseQty: true },
        },
      },
    });
    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;
    const rows = page.map((o) => {
      // Resumo de progresso do pedido: quantas linhas ainda têm mercadoria a sair.
      const itemsPending = o.items.filter(
        (it) => remainingToDeliver(Number(it.baseQuantity ?? it.quantity), Number(it.deliveredBaseQty)) > 0,
      ).length;
      return {
        id: o.id,
        total: o.total,
        fulfillmentStatus: o.fulfillmentStatus,
        scheduledPickupAt: o.scheduledPickupAt,
        perItemSchedule: o.perItemSchedule,
        createdAt: o.createdAt,
        registeredByName: o.registeredByName,
        customerId: o.customer?.id ?? null,
        customerName: o.customer?.name ?? null,
        itemsCount: o.items.length,
        itemsPending,
      };
    });
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return c.json({ ok: true, data: { rows, nextCursor } });
  } catch (err) {
    console.error('GET /deliveries falhou:', err);
    return c.json({ ok: false, error: 'Falha ao listar as entregas.' }, 500);
  }
});

/**
 * Detalhe de um pedido de retirada futura + o LOG completo de retiradas (o "lastro"): cada linha
 * com o que foi vendido, o que já saiu e o que falta, e o histórico de cada retirada parcial
 * (quando, quanto, por quem). Base do painel de detalhe da tela de Entregas.
 */
deliveries.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  }

  try {
    const prisma = createPrismaClient(connectionString);
    const order = await prisma.order.findFirst({
      where: { id, tenantId, deliveryMode: 'SCHEDULED' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { orderBy: { productName: 'asc' } },
        itemDeliveries: { orderBy: { deliveredAt: 'desc' } },
      },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
    }

    // Enriquece cada item com o que ainda falta sair (fonte única do core).
    const items = order.items.map((it) => {
      const base = Number(it.baseQuantity ?? it.quantity);
      const delivered = Number(it.deliveredBaseQty);
      return {
        ...it,
        remainingBaseQty: remainingToDeliver(base, delivered),
      };
    });

    return c.json({ ok: true, data: { ...order, items } });
  } catch (err) {
    console.error('GET /deliveries/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao abrir o pedido.' }, 500);
  }
});

/**
 * Atualiza a observação LIVRE do pedido de retirada futura (ADR-020) — informação geral que quem
 * abrir a Entrega precisa ver (ex.: "quem retira não é quem comprou"). Grava em `Order.notes`.
 * `null`/vazio limpa. Só sobre pedidos SCHEDULED do tenant.
 */
deliveries.patch('/:id', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const orderId = c.req.param('id');
  if (!UUID_RE.test(orderId)) {
    return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  }
  const parsed = updateOrderNotesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Observação inválida.', issues: parsed.error.flatten() }, 400);
  }
  const notes = parsed.data.notes?.trim() ? parsed.data.notes.trim() : null;

  try {
    const prisma = createPrismaClient(connectionString);
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, deliveryMode: 'SCHEDULED' },
      select: { id: true },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { notes },
      select: { id: true, notes: true },
    });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    console.error('PATCH /deliveries/:id falhou:', err);
    return c.json({ ok: false, error: 'Falha ao salvar a observação.' }, 500);
  }
});

/**
 * Registra uma RETIRADA parcial (ADR-020). Para cada linha informada (quantidade em unidade-base),
 * numa única transação (ADR-001):
 *  - grava StockMovement EXPENSE (a baixa REAL de estoque acontece aqui, no evento de retirada);
 *  - decrementa `Product.stockQty` e `Product.reservedQty` (a reserva vira baixa);
 *  - incrementa `OrderItem.deliveredBaseQty` (cache do retirado);
 *  - grava `OrderItemDelivery` (o log auditável: quanto, quando, por quem).
 * Ao fim, recalcula `Order.fulfillmentStatus` (PENDING/PARTIAL/COMPLETED) a partir das linhas.
 * Cada quantidade é validada contra o que ainda falta daquela linha (`isValidDelivery`).
 */
deliveries.post('/:id/deliver', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.get('userId');
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const orderId = c.req.param('id');
  if (!UUID_RE.test(orderId)) {
    return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  }

  const parsed = deliverOrderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Dados da retirada inválidos.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { items: reqItems, notes } = parsed.data;

  try {
    const prisma = createPrismaClient(connectionString);
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, deliveryMode: 'SCHEDULED' },
      include: { items: true },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Pedido de retirada não encontrado.' }, 404);
    }
    if (order.status !== 'CONFIRMED') {
      return c.json(
        { ok: false, error: 'Só é possível registrar retirada de pedidos confirmados.' },
        400,
      );
    }

    const itemById = new Map(order.items.map((it) => [it.id, it]));
    // Valida cada linha ANTES de tocar no banco: existe no pedido e cabe no que falta sair.
    const planned: { item: (typeof order.items)[number]; qty: number; remaining: number }[] = [];
    for (const req of reqItems) {
      const it = itemById.get(req.orderItemId);
      if (!it) {
        return c.json({ ok: false, error: 'Item não pertence a este pedido.' }, 400);
      }
      const remaining = remainingToDeliver(Number(it.baseQuantity ?? it.quantity), Number(it.deliveredBaseQty));
      if (!isValidDelivery(req.quantity, remaining)) {
        return c.json(
          {
            ok: false,
            error: `Quantidade inválida para "${it.productName}" (falta ${remaining}).`,
          },
          400,
        );
      }
      planned.push({ item: it, qty: req.quantity, remaining });
    }

    // Novo total retirado por item (p/ recomputar o status do pedido depois da transação).
    const newDelivered = new Map<string, number>();
    for (const it of order.items) newDelivered.set(it.id, Number(it.deliveredBaseQty));
    for (const p of planned) {
      newDelivered.set(p.item.id, Number((newDelivered.get(p.item.id)! + p.qty).toFixed(4)));
    }
    const nextStatus = orderFulfillmentStatus(
      order.items.map((it) => ({
        baseQuantity: Number(it.baseQuantity ?? it.quantity),
        deliveredBaseQty: newDelivered.get(it.id)!,
      })),
    );

    const result = await prisma.$transaction(async (tx) => {
      for (const { item, qty } of planned) {
        // ADR-001: a baixa REAL de estoque acontece agora (no evento de retirada).
        const movement = await tx.stockMovement.create({
          data: {
            tenantId,
            productId: item.productId,
            type: 'EXPENSE',
            quantity: qty,
            reason: `Retirada do pedido ${order.id}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010)
            registeredByName: c.get('userName'),
          },
        });
        await tx.product.update({
          where: { id: item.productId },
          // A reserva vira baixa: sai do estoque E deixa de estar reservada.
          data: { stockQty: { decrement: qty }, reservedQty: { decrement: qty } },
        });
        await tx.orderItem.update({
          where: { id: item.id },
          data: { deliveredBaseQty: { increment: qty } },
        });
        // Log auditável da retirada (o "lastro" da tela).
        await tx.orderItemDelivery.create({
          data: {
            tenantId,
            orderId: order.id,
            orderItemId: item.id,
            quantity: qty,
            stockMovementId: movement.id,
            notes: notes ?? null,
            deliveredById: userId, // autoria (ADR-010)
            deliveredByName: c.get('userName'),
          },
        });
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { fulfillmentStatus: nextStatus },
        include: { items: true, itemDeliveries: { orderBy: { deliveredAt: 'desc' } } },
      });
      return updated;
    });

    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('POST /deliveries/:id/deliver falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a retirada.' }, 500);
  }
});

export default deliveries;
