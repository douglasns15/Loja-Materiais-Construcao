/**
 * Retirada / entrega futura (ADR-020). Tipos compartilhados entre apps/web e apps/api para a tela
 * "Entregas". Eixo ortogonal ao fiado: aqui a mercadoria de um pedido SCHEDULED é RESERVADA na
 * venda e sai, parcial, nas retiradas. Os schemas de entrada (`deliverOrderSchema`, `deliveryMode`)
 * e os rótulos (`FULFILLMENT_STATUS_LABELS`) ficam em `./sale` junto do `createSaleSchema`.
 */

/** Situação de retirada de um pedido. Espelha o enum `FulfillmentStatus` do Prisma. */
export type FulfillmentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED';

/**
 * Uma linha da lista de entregas (`GET /deliveries`). `total` é Decimal serializado em string;
 * `itemsPending` resume quantas linhas ainda têm mercadoria a sair (progresso do pedido).
 */
export type DeliveryOrderRow = {
  id: string;
  total: string;
  fulfillmentStatus: FulfillmentStatus;
  scheduledPickupAt: string | null;
  perItemSchedule: boolean;
  createdAt: string;
  registeredByName: string | null;
  customerId: string | null;
  customerName: string | null;
  itemsCount: number;
  itemsPending: number;
};

/** Página de entregas (cursor keyset) — mesmo contrato das demais telas paginadas. */
export type DeliveriesPage = { rows: DeliveryOrderRow[]; nextCursor: string | null };

/**
 * Um item do pedido no detalhe de entrega. `baseQuantity` é a quantidade em unidade-base
 * (fonte do estoque/retirada); `deliveredBaseQty` é o que já saiu; `remainingBaseQty` vem
 * calculado do servidor (fonte única `remainingToDeliver` do core). `quantity`/`unit` são a
 * unidade VENDIDA (ex.: 2 rolos) para exibição amigável.
 */
export type DeliveryItem = {
  id: string;
  productName: string;
  unit: string;
  quantity: string;
  baseQuantity: string | null;
  deliveredBaseQty: string;
  remainingBaseQty: number;
  scheduledPickupAt: string | null;
  pairGroup: number | null;
};

/** Um evento de retirada parcial (o log): quanto saiu, quando e por quem. */
export type DeliveryLogRow = {
  id: string;
  orderItemId: string;
  quantity: string;
  deliveredAt: string;
  deliveredByName: string | null;
  notes: string | null;
};

/**
 * Detalhe de um pedido de retirada futura (`GET /deliveries/:id`): o pedido + os itens (com o
 * que falta sair) + o LOG de retiradas. Base do painel de detalhe da tela de Entregas.
 */
export type DeliveryDetail = {
  id: string;
  total: string;
  fulfillmentStatus: FulfillmentStatus;
  scheduledPickupAt: string | null;
  perItemSchedule: boolean;
  createdAt: string;
  registeredByName: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  items: DeliveryItem[];
  itemDeliveries: DeliveryLogRow[];
};
