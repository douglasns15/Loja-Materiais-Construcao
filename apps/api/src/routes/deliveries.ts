import { Hono } from 'hono';
import { type Prisma } from '@nexoloja/db';
import {
  isValidDelivery,
  orderFulfillmentStatus,
  planDispatch,
  remainingToDeliver,
  statusAfterRouteReturn,
} from '@nexoloja/core';
import {
  DELIVERY_LOG_REF,
  deliverOrderSchema,
  dispatchOrderSchema,
  formatWeight,
  parseDeliverySettings,
  returnFromRouteSchema,
  updateOrderNotesSchema,
  parseSeqNumberQuery,
} from '@nexoloja/shared';
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

/**
 * Reabre a conta de retiradas (ADR-028) quando um pedido dela volta a ter mercadoria a sair ("Voltou /
 * não entregue", ADR-042). Inverso de `closeDeliveryAccountIfFulfilled`; idempotente.
 */
async function reopenDeliveryAccount(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountId: string | null | undefined,
): Promise<void> {
  if (!accountId) return;
  await tx.deliveryAccount.updateMany({
    where: { id: accountId, tenantId, status: 'COMPLETED' },
    data: { status: 'OPEN', closedAt: null },
  });
}

/** Uma linha a sair numa retirada/saída para entrega (quantidade em unidade-base). */
type PlannedWithdrawal = { orderItemId: string; productId: string; qty: number };

/**
 * Baixa as linhas planejadas DENTRO da transação (ADR-001/ADR-020) — o miolo comum da retirada
 * (`/deliver`) e da saída para entrega (`/dispatch`). Por linha:
 *  - StockMovement EXPENSE + `stockQty`/`reservedQty` decrementados (a reserva vira baixa), exceto em
 *    produto sem controle de estoque (ADR-040 §2: não reservou na venda, não baixa aqui);
 *  - `OrderItem.deliveredBaseQty` incrementado (cache do retirado);
 *  - `OrderItemDelivery` (o log auditável), com `reference`/`deliveredAt` opcionais — a saída para
 *    entrega carimba os dois para a volta saber exatamente o que desfazer.
 */
async function withdrawLines(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    orderId: string;
    lines: PlannedWithdrawal[];
    untracked: Set<string>;
    userId: string | undefined;
    userName: string | undefined;
    notes: string | null;
    reference?: string;
    at?: Date;
  },
): Promise<void> {
  const { tenantId, orderId, lines, untracked, userId, userName, notes, reference, at } = args;
  for (const { orderItemId, productId, qty } of lines) {
    // ADR-001: a baixa REAL de estoque acontece agora (no evento de retirada).
    const movement = untracked.has(productId)
      ? null
      : await tx.stockMovement.create({
          data: {
            tenantId,
            productId,
            type: 'EXPENSE',
            quantity: qty,
            reason: `Retirada do pedido ${orderId}`,
            syncStatus: 'SYNCED',
            userId, // autoria (ADR-010)
            registeredByName: userName,
          },
        });
    if (movement) {
      await tx.product.update({
        where: { id: productId },
        // A reserva vira baixa: sai do estoque E deixa de estar reservada.
        data: { stockQty: { decrement: qty }, reservedQty: { decrement: qty } },
      });
    }
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { deliveredBaseQty: { increment: qty } },
    });
    // Log auditável da retirada (o "lastro" da tela).
    await tx.orderItemDelivery.create({
      data: {
        tenantId,
        orderId,
        orderItemId,
        quantity: qty,
        stockMovementId: movement?.id ?? null,
        notes,
        ...(reference ? { reference } : {}),
        ...(at ? { deliveredAt: at } : {}),
        deliveredById: userId, // autoria (ADR-010)
        deliveredByName: userName,
      },
    });
  }
}

/** Produtos SEM controle de estoque entre os informados (ADR-040 §2). */
async function untrackedOf(
  db: Pick<Prisma.TransactionClient, 'product'>,
  tenantId: string,
  productIds: string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await db.product.findMany({
    where: { tenantId, id: { in: productIds }, trackStock: false },
    select: { id: true },
  });
  return new Set(rows.map((p) => p.id));
}

/** Meia-noite UTC do dia — como a previsão "só dia" (e a data por item) é gravada (ADR-020). */
const dayAsDateOnly = (day: string) => new Date(`${day}T00:00:00.000Z`);

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
  // Agenda de entregas (ADR-042).
  fulfillmentType: true,
  scheduledUntil: true,
  deliveryAddress: true,
  courier: { select: { name: true } },
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
  fulfillmentType: 'PICKUP' | 'DELIVERY' | null;
  scheduledUntil: Date | null;
  deliveryAddress: string | null;
  courier: { name: string } | null;
};

/** QUANTIDADE (unidade-base) ainda a sair de uma venda: soma o que falta de cada linha. É o número
 *  que o operador enxerga como "a retirar" — 3 sacos vendidos com 1 já retirado ⇒ 2 (não "1 linha").
 *  Espelha o "Falta sair" do detalhe. Arredonda a 4 casas (precisão do estoque). */
function itemsPendingOf(o: OrderRowRaw): number {
  const sum = o.items.reduce(
    (acc, it) => acc + remainingToDeliver(Number(it.baseQuantity ?? it.quantity), Number(it.deliveredBaseQty)),
    0,
  );
  return Number(sum.toFixed(4));
}

/** QUANTIDADE total (unidade-base) vendida de uma venda — o denominador do "X / Y a retirar". */
function itemsCountOf(o: OrderRowRaw): number {
  const sum = o.items.reduce((acc, it) => acc + Number(it.baseQuantity ?? it.quantity), 0);
  return Number(sum.toFixed(4));
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
    itemsCount: itemsCountOf(o),
    itemsPending: itemsPendingOf(o),
    fulfillmentType: o.fulfillmentType,
    scheduledUntil: o.scheduledUntil,
    deliveryAddress: o.deliveryAddress,
    courierName: o.courier?.name ?? null,
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
      const itemsPending = Number(orders.reduce((acc, o) => acc + o.itemsPending, 0).toFixed(4));
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
/**
 * Agenda do dia (ADR-042): pedidos SCHEDULED confirmados marcados para `?day=AAAA-MM-DD` (fuso da
 * loja, UTC−3), em ordem de horário. Dois tipos de previsão convivem:
 *  - **com faixa** (`scheduledUntil` preenchido): o início é um instante real ⇒ entra se cair no dia local;
 *  - **só dia** (agendamento antigo/sem faixa): gravado como meia-noite UTC do dia ⇒ `timed = false`,
 *    vai para a lista "Sem horário" da tela.
 *  - **Data por item** (revisão 2026-10-02): o pedido aparece em CADA dia que tiver item marcado, com
 *    só os itens daquele dia (`perItem`, `otherDaysItems`) — também "Sem horário".
 * ⚠️ Registrada ANTES de `/:id` para o Hono não tratar "agenda" como id.
 */
deliveries.get('/agenda', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const day = c.req.query('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return c.json({ ok: false, error: 'Informe o dia (AAAA-MM-DD).' }, 400);
  }
  const dayStartLocal = new Date(`${day}T00:00:00.000-03:00`);
  const dayEndLocal = new Date(`${day}T23:59:59.999-03:00`);
  const dateOnly = new Date(`${day}T00:00:00.000Z`);
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.order.findMany({
      where: {
        tenantId,
        deliveryMode: 'SCHEDULED',
        status: 'CONFIRMED',
        OR: [
          {
            perItemSchedule: false,
            scheduledUntil: { not: null },
            scheduledPickupAt: { gte: dayStartLocal, lte: dayEndLocal },
          },
          { perItemSchedule: false, scheduledUntil: null, scheduledPickupAt: dateOnly },
          // "Data por item": entra no dia em que ao menos um item está marcado (data pura, sem horário).
          { perItemSchedule: true, items: { some: { scheduledPickupAt: dateOnly } } },
        ],
      },
      orderBy: [{ scheduledPickupAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        orderNumber: true,
        fulfillmentType: true,
        fulfillmentStatus: true,
        scheduledPickupAt: true,
        scheduledUntil: true,
        deliveryAddress: true,
        dispatchedAt: true,
        total: true,
        notes: true,
        perItemSchedule: true,
        customer: { select: { name: true, phone: true } },
        courier: { select: { name: true } },
        items: {
          select: {
            productName: true,
            unit: true,
            quantity: true,
            baseQuantity: true,
            deliveredBaseQty: true,
            scheduledPickupAt: true,
          },
        },
      },
    });
    const data = rows.map((o) => {
      // "Data por item": a linha do dia mostra só os itens marcados para ele; o detalhe tem o resto.
      const dayItems = o.perItemSchedule
        ? o.items.filter((it) => it.scheduledPickupAt?.getTime() === dateOnly.getTime())
        : o.items;
      const summary = dayItems
        .map((it) => {
          const q = Number(it.quantity);
          const qty =
            it.unit === 'KILOGRAM' || it.unit === 'LITER'
              ? `${formatWeight(q)} ${it.unit === 'LITER' ? 'L' : 'kg'}`
              : `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×`;
          return `${qty} ${it.productName}`;
        })
        .join(', ');
      const pending = dayItems.reduce(
        (acc, it) => acc + remainingToDeliver(Number(it.baseQuantity ?? it.quantity), Number(it.deliveredBaseQty)),
        0,
      );
      // Situação da LINHA: em "Data por item" é a dos itens do dia (o pedido pode seguir aberto).
      const rowStatus = o.perItemSchedule
        ? pending <= 0
          ? ('COMPLETED' as const)
          : dayItems.some((it) => Number(it.deliveredBaseQty) > 0)
            ? ('PARTIAL' as const)
            : ('PENDING' as const)
        : (o.fulfillmentStatus ?? 'PENDING');
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        fulfillmentType: o.fulfillmentType ?? 'PICKUP',
        fulfillmentStatus: rowStatus,
        start: o.perItemSchedule ? dateOnly : o.scheduledPickupAt,
        end: o.perItemSchedule ? null : o.scheduledUntil,
        timed: !o.perItemSchedule && o.scheduledUntil != null,
        perItem: o.perItemSchedule,
        otherDaysItems: o.items.length - dayItems.length,
        customerName: o.customer?.name ?? null,
        customerPhone: o.customer?.phone ?? null,
        deliveryAddress: o.deliveryAddress,
        courierName: o.courier?.name ?? null,
        dispatchedAt: o.dispatchedAt,
        itemsSummary: summary.length > 140 ? `${summary.slice(0, 137)}…` : summary,
        itemsPending: Number(pending.toFixed(4)),
        total: o.total,
        notes: o.notes,
      };
    });
    return c.json({ ok: true, data });
  } catch (err) {
    console.error('GET /deliveries/agenda falhou:', err);
    return c.json({ ok: false, error: 'Falha ao carregar a agenda do dia.' }, 500);
  }
});

/**
 * Lotação das faixas de um dia (ADR-042): os INÍCIOS (ISO) dos pedidos com faixa de horário marcados
 * para `?day=` — o PDV conta por faixa (no fuso do aparelho) e marca as lotadas quando a loja tem
 * `maxPerSlot`. ⚠️ Antes de `/:id`.
 */
deliveries.get('/slots', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const day = c.req.query('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return c.json({ ok: false, error: 'Informe o dia (AAAA-MM-DD).' }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const rows = await prisma.order.findMany({
      where: {
        tenantId,
        deliveryMode: 'SCHEDULED',
        status: 'CONFIRMED',
        scheduledUntil: { not: null },
        scheduledPickupAt: {
          gte: new Date(`${day}T00:00:00.000-03:00`),
          lte: new Date(`${day}T23:59:59.999-03:00`),
        },
      },
      select: { scheduledPickupAt: true },
    });
    return c.json({ ok: true, data: { starts: rows.map((r) => r.scheduledPickupAt) } });
  } catch (err) {
    console.error('GET /deliveries/slots falhou:', err);
    return c.json({ ok: false, error: 'Falha ao consultar as faixas do dia.' }, 500);
  }
});

/**
 * "Saiu para entrega" (ADR-042, revisão 2026-10-02) e/ou troca do entregador (funcionário ATIVO da
 * loja; `null` tira). Só pedidos SCHEDULED confirmados do tipo DELIVERY.
 * A saída CONCLUI a entrega: numa transação só, dá baixa de tudo o que falta (StockMovement + cache,
 * ADR-001 — mesmo miolo da retirada), carimba `dispatchedAt` e recalcula o status. A loja não tem
 * confirmação do entregador em tempo real; se a entrega não acontecer, `POST /:id/return-from-route`
 * desfaz exatamente esta saída (as linhas do log levam `reference = SAIU_ENTREGA` e o mesmo instante).
 * Pedido com "Data por item": `day` limita a saída aos itens daquele dia.
 */
deliveries.post('/:id/dispatch', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  }
  const parsed = dispatchOrderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'Informe a saída ou o entregador.', issues: parsed.error.flatten() }, 400);
  }
  try {
    const prisma = getPrisma(c);
    const order = await prisma.order.findFirst({
      where: { id, tenantId, deliveryMode: 'SCHEDULED' },
      select: {
        status: true,
        fulfillmentType: true,
        perItemSchedule: true,
        deliveryAccountId: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            baseQuantity: true,
            deliveredBaseQty: true,
            scheduledPickupAt: true,
          },
        },
      },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
    }
    if (order.status !== 'CONFIRMED' || order.fulfillmentType !== 'DELIVERY') {
      return c.json({ ok: false, error: 'Só pedidos de entrega confirmados podem sair para entrega.' }, 400);
    }
    const { dispatched, day, courierId } = parsed.data;
    if (courierId) {
      const courier = await prisma.employee.findFirst({
        where: { id: courierId, tenantId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!courier) {
        return c.json({ ok: false, error: 'Entregador não encontrado (ou inativo).' }, 400);
      }
    }
    const courierData = courierId !== undefined ? { courierId } : {};
    const RESULT_SELECT = {
      id: true,
      dispatchedAt: true,
      fulfillmentStatus: true,
      courier: { select: { id: true, name: true, phone: true } },
    } as const;

    // Só troca de entregador: nada sai do estoque.
    if (!dispatched) {
      const updated = await prisma.order.update({ where: { id }, data: courierData, select: RESULT_SELECT });
      return c.json({ ok: true, data: updated });
    }

    // O que sai agora (core `planDispatch`): tudo o que falta — ou, em "Data por item" com `day`, só
    // os itens daquele dia.
    const plan = planDispatch(
      order.items.map((it) => ({
        id: it.id,
        baseQuantity: Number(it.baseQuantity ?? it.quantity),
        deliveredBaseQty: Number(it.deliveredBaseQty),
        dayMs: it.scheduledPickupAt?.getTime() ?? null,
      })),
      { perItemSchedule: order.perItemSchedule, dayMs: day ? dayAsDateOnly(day).getTime() : null },
    );
    if (plan.lines.length === 0) {
      return c.json({ ok: false, error: 'Não há mercadoria pendente para sair nesta entrega.' }, 400);
    }
    const productOf = new Map(order.items.map((it) => [it.id, it.productId]));
    const lines = plan.lines.map((l) => ({ orderItemId: l.id, productId: productOf.get(l.id)!, qty: l.qty }));
    const nextStatus = plan.nextStatus;
    const untracked = await untrackedOf(prisma, tenantId, lines.map((l) => l.productId));
    // Mesmo instante na saída e no log: é a chave que o "Voltou / não entregue" usa para desfazer.
    const at = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await withdrawLines(tx, {
        tenantId,
        orderId: id,
        lines,
        untracked,
        userId: c.get('userId'),
        userName: c.get('userName'),
        notes: 'Saiu para entrega',
        reference: DELIVERY_LOG_REF.DISPATCH,
        at,
      });
      const u = await tx.order.update({
        where: { id },
        data: { dispatchedAt: at, fulfillmentStatus: nextStatus, ...courierData },
        select: RESULT_SELECT,
      });
      if (nextStatus === 'COMPLETED') {
        await closeDeliveryAccountIfFulfilled(tx, tenantId, order.deliveryAccountId);
      }
      return u;
    });
    return c.json({ ok: true, data: updated });
  } catch (err) {
    console.error('POST /deliveries/:id/dispatch falhou:', err);
    return c.json({ ok: false, error: 'Falha ao registrar a saída para entrega.' }, 500);
  }
});

/**
 * "Voltou / não entregue" (ADR-042, revisão 2026-10-02): o entregador voltou com a mercadoria e o
 * pedido será REAGENDADO. Desfaz a ÚLTIMA saída (linhas do log com `reference = SAIU_ENTREGA` e
 * `deliveredAt = dispatchedAt`), numa transação (ADR-001):
 *  - por linha: StockMovement INCOME + `stockQty` e `reservedQty` incrementados (volta ao estoque
 *    como RESERVADA para este pedido; produto sem controle de estoque não mexe em nada), cache
 *    `deliveredBaseQty` decrementado e uma linha NEGATIVA no log (`reference = VOLTOU_ENTREGA`);
 *  - nova previsão: faixa (`start`/`end`) ou só o dia; em "Data por item", a data dos itens que voltaram;
 *  - `dispatchedAt` limpo, status recalculado e a conta de retiradas reaberta se tinha fechado.
 * Respeita o limite de pedidos por faixa (como a venda). Cancelar em vez de reagendar = cancelamento
 * de sempre (`POST /orders/:id/cancel`), que já devolve ao estoque o que tinha saído.
 */
deliveries.post('/:id/return-from-route', requireActiveTenant, async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId || !getConnectionString(c.env)) {
    return c.json({ ok: false, error: 'Contexto inválido.' }, 400);
  }
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
  }
  const parsed = returnFromRouteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Informe a nova data.', issues: parsed.error.flatten() },
      400,
    );
  }
  const { date, start, end, notes } = parsed.data;
  try {
    const prisma = getPrisma(c);
    const order = await prisma.order.findFirst({
      where: { id, tenantId, deliveryMode: 'SCHEDULED' },
      select: {
        status: true,
        fulfillmentType: true,
        perItemSchedule: true,
        dispatchedAt: true,
        deliveryAccountId: true,
        items: { select: { id: true, productId: true, quantity: true, baseQuantity: true, deliveredBaseQty: true } },
      },
    });
    if (!order) {
      return c.json({ ok: false, error: 'Pedido não encontrado.' }, 404);
    }
    if (order.status !== 'CONFIRMED' || order.fulfillmentType !== 'DELIVERY') {
      return c.json({ ok: false, error: 'Só pedidos de entrega confirmados podem ser reagendados.' }, 400);
    }
    if (!order.dispatchedAt) {
      return c.json({ ok: false, error: 'Este pedido não saiu para entrega.' }, 400);
    }

    // Limite por faixa (Período de entregas), sem contar o próprio pedido.
    if (start && !order.perItemSchedule) {
      const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { deliverySettings: true } });
      const max = parseDeliverySettings(t?.deliverySettings).maxPerSlot;
      if (max) {
        const taken = await prisma.order.count({
          where: {
            tenantId,
            id: { not: id },
            deliveryMode: 'SCHEDULED',
            status: 'CONFIRMED',
            scheduledUntil: { not: null },
            scheduledPickupAt: new Date(start),
          },
        });
        if (taken >= max) {
          return c.json(
            { ok: false, error: `Esta faixa de horário já está lotada (${max} pedidos). Escolha outra faixa.` },
            409,
          );
        }
      }
    }

    // Exatamente o que a última saída baixou.
    const sent = await prisma.orderItemDelivery.findMany({
      where: { tenantId, orderId: id, reference: DELIVERY_LOG_REF.DISPATCH, deliveredAt: order.dispatchedAt },
      select: { orderItemId: true, quantity: true, stockMovementId: true },
    });
    const itemById = new Map(order.items.map((it) => [it.id, it]));
    const nextStatus = statusAfterRouteReturn(
      order.items.map((it) => ({
        id: it.id,
        baseQuantity: Number(it.baseQuantity ?? it.quantity),
        deliveredBaseQty: Number(it.deliveredBaseQty),
      })),
      sent.map((s) => ({ id: s.orderItemId, qty: Number(s.quantity) })),
    );
    const userId = c.get('userId');
    const userName = c.get('userName');
    const logNote = notes ? `Voltou da entrega · ${notes}` : 'Voltou da entrega';

    await prisma.$transaction(async (tx) => {
      for (const s of sent) {
        const item = itemById.get(s.orderItemId);
        if (!item) continue;
        const qty = Number(s.quantity);
        // Só reverte estoque do que de fato baixou (a saída de produto sem controle não gerou movimento).
        const movement = s.stockMovementId
          ? await tx.stockMovement.create({
              data: {
                tenantId,
                productId: item.productId,
                type: 'INCOME',
                quantity: qty,
                reason: `Voltou da entrega do pedido ${id}`,
                syncStatus: 'SYNCED',
                userId, // autoria (ADR-010)
                registeredByName: userName,
              },
            })
          : null;
        if (movement) {
          await tx.product.update({
            where: { id: item.productId },
            // Volta ao estoque E volta a ficar reservada para este pedido (ADR-020).
            data: { stockQty: { increment: qty }, reservedQty: { increment: qty } },
          });
        }
        await tx.orderItem.update({ where: { id: item.id }, data: { deliveredBaseQty: { decrement: qty } } });
        await tx.orderItemDelivery.create({
          data: {
            tenantId,
            orderId: id,
            orderItemId: item.id,
            quantity: -qty, // linha negativa: a mercadoria voltou
            stockMovementId: movement?.id ?? null,
            reference: DELIVERY_LOG_REF.RETURNED,
            notes: logNote,
            deliveredById: userId,
            deliveredByName: userName,
          },
        });
      }
      // Nova previsão. "Data por item": a data dos itens que voltaram; senão, a do pedido.
      if (order.perItemSchedule) {
        const ids = [...new Set(sent.map((s) => s.orderItemId))];
        if (ids.length) {
          await tx.orderItem.updateMany({ where: { id: { in: ids } }, data: { scheduledPickupAt: dayAsDateOnly(date) } });
        }
      }
      await tx.order.update({
        where: { id },
        data: {
          dispatchedAt: null,
          fulfillmentStatus: nextStatus,
          ...(order.perItemSchedule
            ? {}
            : start && end
              ? { scheduledPickupAt: new Date(start), scheduledUntil: new Date(end) }
              : { scheduledPickupAt: dayAsDateOnly(date), scheduledUntil: null }),
        },
      });
      if (nextStatus !== 'COMPLETED') {
        await reopenDeliveryAccount(tx, tenantId, order.deliveryAccountId);
      }
    });
    return c.json({ ok: true, data: { id, fulfillmentStatus: nextStatus } });
  } catch (err) {
    console.error('POST /deliveries/:id/return-from-route falhou:', err);
    return c.json({ ok: false, error: 'Falha ao reagendar a entrega.' }, 500);
  }
});

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
        // Entregador (ADR-042) — `fulfillmentType`/`scheduledUntil`/`deliveryAddress`/`dispatchedAt`
        // já vêm como colunas do pedido.
        courier: { select: { id: true, name: true, phone: true } },
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

    // ADR-040 §2: produto SEM controle de estoque não reservou na venda e não baixa na retirada —
    // a retirada só registra o que foi levado (log + `deliveredBaseQty`).
    const untracked = await untrackedOf(prisma, tenantId, planned.map((p) => p.item.productId));

    const result = await prisma.$transaction(async (tx) => {
      await withdrawLines(tx, {
        tenantId,
        orderId: order.id,
        lines: planned.map((p) => ({ orderItemId: p.item.id, productId: p.item.productId, qty: p.qty })),
        untracked,
        userId,
        userName: c.get('userName'),
        notes: notes ?? null,
      });

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
