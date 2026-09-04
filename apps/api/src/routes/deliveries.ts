import { Hono } from 'hono';
import { type Prisma } from '@nexoloja/db';
import {
  isValidDelivery,
  orderFulfillmentStatus,
  remainingToDeliver,
} from '@nexoloja/core';
import { deliverOrderSchema, updateOrderNotesSchema, parseSeqNumberQuery } from '@nexoloja/shared';
import { type Env, getConnectionString, getPrisma, getTenantId } from '../lib/request';
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

/**
 * Fecha a CONTA DE RETIRADAS (ADR-028) quando não resta nenhuma venda a retirar — todas as suas
 * vendas CONFIRMED estão COMPLETED. A conta vira `COMPLETED` + `closedAt` (arquiva na aba
 * "Finalizadas"). Idempotente e à prova de corrida: o `updateMany` condicional (`status: 'OPEN'`) só
 * age uma vez. Chamado DENTRO da transação que finalizou a última retirada. `accountId` nulo (venda
 * SCHEDULED sem cliente, ou pré-ADR-028 sem backfill) é no-op. Espelha `closeDebtIfSettled` do fiado.
 */
async function closeDeliveryAccountIfFulfilled(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountId: string | null | undefined,
): Promise<void> {
  if (!accountId) return;
  // Vendas da conta ainda com mercadoria a sair (CONFIRMED e não COMPLETED). Canceladas/devolvidas
  // (status != CONFIRMED) não contam — não travam o fechamento da conta.
  const pendingLeft = await tx.order.count({
    where: {
      tenantId,
      deliveryAccountId: accountId,
      status: 'CONFIRMED',
      // Null-safe: um pedido SCHEDULED sem status ainda conta como "a retirar" (não fecha à toa).
      OR: [{ fulfillmentStatus: null }, { fulfillmentStatus: { in: ['PENDING', 'PARTIAL'] } }],
    },
  });
  if (pendingLeft === 0) {
    await tx.deliveryAccount.updateMany({
      where: { id: accountId, tenantId, status: 'OPEN' },
      data: { status: 'COMPLETED', closedAt: new Date() },
    });
  }
}

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
 * Lista as retiradas futuras (ADR-020) AGRUPADAS por cliente (ADR-028): cada card é uma CONTA de
 * retiradas (`E-0001`, com o extrato das vendas do cliente) ou uma venda AVULSA (SCHEDULED sem
 * cliente, que não entra em conta). Paginada por cursor keyset num tempo comum (`openedAt` da conta /
 * `createdAt` da venda avulsa), mesclando os dois fluxos. Filtros de `status`: `pending` (default —
 * contas abertas + avulsas a retirar), `completed` (finalizadas) ou `all`. Só vendas SCHEDULED
 * confirmadas (canceladas/devolvidas saem — aparecem no Histórico).
 */
// Colunas selecionadas de uma venda para montar a linha do extrato (`DeliveryOrderRow`).
const ORDER_ROW_SELECT = {
  id: true,
  orderNumber: true,
  total: true,
  fulfillmentStatus: true,
  scheduledPickupAt: true,
  perItemSchedule: true,
  createdAt: true,
  registeredByName: true,
  customer: { select: { id: true, name: true } },
  items: { select: { quantity: true, baseQuantity: true, deliveredBaseQty: true } },
} as const;

type OrderRowRaw = {
  id: string;
  orderNumber: number;
  total: Prisma.Decimal;
  fulfillmentStatus: 'PENDING' | 'PARTIAL' | 'COMPLETED' | null;
  scheduledPickupAt: Date | null;
  perItemSchedule: boolean;
  createdAt: Date;
  registeredByName: string | null;
  customer: { id: string; name: string } | null;
  items: { quantity: Prisma.Decimal; baseQuantity: Prisma.Decimal | null; deliveredBaseQty: Prisma.Decimal }[];
};

/** Quantas linhas de uma venda ainda têm mercadoria a sair (progresso). */
function itemsPendingOf(o: OrderRowRaw): number {
  return o.items.filter(
    (it) => remainingToDeliver(Number(it.baseQuantity ?? it.quantity), Number(it.deliveredBaseQty)) > 0,
  ).length;
}

/** Mapeia uma venda para a linha do extrato (`DeliveryOrderRow`) — mesma forma de antes. */
function toOrderRow(o: OrderRowRaw) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    total: o.total,
    fulfillmentStatus: o.fulfillmentStatus,
    scheduledPickupAt: o.scheduledPickupAt,
    perItemSchedule: o.perItemSchedule,
    createdAt: o.createdAt,
    registeredByName: o.registeredByName,
    customerId: o.customer?.id ?? null,
    customerName: o.customer?.name ?? null,
    itemsCount: o.items.length,
    itemsPending: itemsPendingOf(o),
  };
}

deliveries.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const connectionString = getConnectionString(c.env);
  if (!tenantId || !connectionString) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }

  const statusParam = c.req.query('status');
  const PENDING_PARTIAL: ('PENDING' | 'PARTIAL')[] = ['PENDING', 'PARTIAL'];
  // Filtro por aba, aplicado às CONTAS (por status da conta) e às vendas AVULSAS (por fulfillment).
  const accountStatusWhere =
    statusParam === 'completed'
      ? { status: 'COMPLETED' as const }
      : statusParam === 'all'
        ? {}
        : { status: 'OPEN' as const };
  const orphanStatusWhere =
    statusParam === 'completed'
      ? { fulfillmentStatus: 'COMPLETED' as const }
      : statusParam === 'all'
        ? {}
        : { fulfillmentStatus: { in: PENDING_PARTIAL } };

  // Busca (opcional): por CÓDIGO (conta `E-000X` ou venda `V-000XXX`) ou por CLIENTE (nome). Qualquer
  // busca ativa VARRE TODAS as situações (ignora a aba), como no Histórico. `code` casa a conta pelo
  // `accountNumber` OU uma venda dela pelo `orderNumber`; para as avulsas, casa o `orderNumber`. `q`
  // (cliente) filtra a conta pelo nome do cliente; avulsas não têm cliente ⇒ ficam de fora da busca por nome.
  const codeQuery = parseSeqNumberQuery(c.req.query('code'));
  const customerQuery = (c.req.query('customer') ?? '').trim();
  const hasSearch = codeQuery != null || customerQuery.length > 0;
  const accountSearchWhere = codeQuery != null
    ? { OR: [{ accountNumber: codeQuery }, { orders: { some: { orderNumber: codeQuery } } }] }
    : customerQuery
      ? { customer: { name: { contains: customerQuery, mode: 'insensitive' as const } } }
      : {};
  // Avulsas (sem cliente): entram na busca por código; numa busca por cliente, nunca casam.
  const orphanSearchWhere = codeQuery != null ? { orderNumber: codeQuery } : {};
  const skipOrphans = customerQuery.length > 0; // busca por cliente não retorna avulsas
  // Com busca ativa, ignora o filtro de aba (varre todas as situações).
  const effAccountStatusWhere = hasSearch ? {} : accountStatusWhere;
  const effOrphanStatusWhere = hasSearch ? {} : orphanStatusWhere;

  const limitRaw = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), PAGE_MAX) : PAGE_DEFAULT;
  const cursorParam = c.req.query('cursor');
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  // Keyset num tempo comum: `(tempo, id) < (cursor)`. Aplicado a `openedAt` (conta) e `createdAt` (venda).
  const keysetOn = (field: 'openedAt' | 'createdAt') =>
    cursor
      ? {
          OR: [
            { [field]: { lt: new Date(cursor.createdAt) } },
            { [field]: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }
      : {};

  try {
    const prisma = getPrisma(c);
    // Dois fluxos, cada um paginado (take limit+1): contas do cliente e vendas avulsas (sem conta).
    const [accounts, orphans] = await Promise.all([
      prisma.deliveryAccount.findMany({
        where: {
          tenantId,
          ...effAccountStatusWhere,
          ...accountSearchWhere,
          // Só contas com ao menos uma venda ativa (evita card vazio de conta toda cancelada).
          orders: { some: { status: 'CONFIRMED' } },
          ...keysetOn('openedAt'),
        },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          accountNumber: true,
          status: true,
          openedAt: true,
          closedAt: true,
          customer: { select: { id: true, name: true } },
          // Extrato: as vendas ativas da conta, mais recente primeiro.
          orders: {
            where: { status: 'CONFIRMED' },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: ORDER_ROW_SELECT,
          },
        },
      }),
      skipOrphans
        ? Promise.resolve([])
        : prisma.order.findMany({
            where: {
              tenantId,
              deliveryMode: 'SCHEDULED',
              status: 'CONFIRMED',
              deliveryAccountId: null, // avulsas (SCHEDULED sem cliente)
              ...effOrphanStatusWhere,
              ...orphanSearchWhere,
              ...keysetOn('createdAt'),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            select: ORDER_ROW_SELECT,
          }),
    ]);

    // Cada fluxo vira um card com uma chave de ordenação comum (tempo desc, id desc).
    type CardEnvelope = { time: Date; id: string; card: unknown };
    const cards: CardEnvelope[] = [];
    for (const a of accounts) {
      const orders = a.orders.map(toOrderRow);
      const total = orders.reduce((acc, o) => acc + Number(o.total), 0);
      const itemsPending = orders.reduce((acc, o) => acc + o.itemsPending, 0);
      // Previsão mais próxima entre as vendas ainda com item a retirar (base do "atrasada").
      const nextPickupAt =
        orders
          .filter((o) => o.itemsPending > 0 && o.scheduledPickupAt)
          .map((o) => o.scheduledPickupAt as Date)
          .sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
      cards.push({
        time: a.openedAt,
        id: a.id,
        card: {
          kind: 'account',
          account: {
            id: a.id,
            accountNumber: a.accountNumber,
            status: a.status,
            customerId: a.customer.id,
            customerName: a.customer.name,
            openedAt: a.openedAt,
            closedAt: a.closedAt,
            ordersCount: orders.length,
            total: total.toFixed(2),
            itemsPending,
            nextPickupAt,
            orders,
          },
        },
      });
    }
    for (const o of orphans) {
      cards.push({ time: o.createdAt, id: o.id, card: { kind: 'order', order: toOrderRow(o) } });
    }

    // Mescla os dois fluxos (tempo desc, id desc), corta em `limit` e deriva o cursor da última.
    cards.sort((a, b) => (b.time.getTime() - a.time.getTime()) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const hasMore = cards.length > limit;
    const pageCards = hasMore ? cards.slice(0, limit) : cards;
    const last = pageCards[pageCards.length - 1];
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.time, id: last.id }) : null;
    return c.json({ ok: true, data: { cards: pageCards.map((e) => e.card), nextCursor } });
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
    const prisma = getPrisma(c);
    const order = await prisma.order.findFirst({
      where: { id, tenantId, deliveryMode: 'SCHEDULED' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { orderBy: { productName: 'asc' } },
        itemDeliveries: { orderBy: { deliveredAt: 'desc' } },
        // Saldo a prazo (ADR-019) — 0 quando a venda foi 100% paga. O comprovante de retirada usa
        // isto para decidir entre "PAGO — FALTA RETIRAR" e só "FALTA RETIRAR". O saldo é DERIVADO
        // (não há coluna `balance`): originalAmount − settledAmount − returnedAmount.
        receivable: { select: { originalAmount: true, settledAmount: true, returnedAmount: true } },
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

    // Não vaza o objeto `receivable` cru; expõe só o saldo em aberto como `outstandingBalance`.
    // Saldo devedor derivado (ADR-019): original − recebido − devolvido, nunca negativo.
    const { receivable, ...orderRest } = order;
    const outstandingBalance = receivable
      ? Math.max(
          0,
          Number(
            (
              Number(receivable.originalAmount) -
              Number(receivable.settledAmount) -
              Number(receivable.returnedAmount)
            ).toFixed(2),
          ),
        )
      : 0;

    return c.json({ ok: true, data: { ...orderRest, items, outstandingBalance } });
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
    const prisma = getPrisma(c);
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
    const prisma = getPrisma(c);
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
      // Conta de retiradas (ADR-028): se esta foi a última venda a retirar do cliente, fecha a conta.
      if (nextStatus === 'COMPLETED') {
        await closeDeliveryAccountIfFulfilled(tx, tenantId, order.deliveryAccountId);
      }
      return updated;
    });

    return c.json({ ok: true, data: result });
  } catch (err) {
    console.error('POST /deliveries/:id/deliver falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a retirada.' }, 500);
  }
});

export default deliveries;
