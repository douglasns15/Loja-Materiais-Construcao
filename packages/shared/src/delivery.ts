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
  /** Código sequencial da venda (ADR-023) — exibido como "V-000128"; identifica o registro. */
  orderNumber: number;
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

/** Situação de uma conta de retiradas (ADR-028). Espelha o enum `DeliveryAccountStatus` do Prisma. */
export type DeliveryAccountStatus = 'OPEN' | 'COMPLETED';

/**
 * Conta de retiradas de um cliente (ADR-028) — o CARD agrupado da tela de Entregas, exibido como
 * "E-0001" (`formatDeliveryNumber`). Reúne as vendas SCHEDULED do cliente (o extrato em `orders`) e
 * traz os agregados para o resumo do card. Espelha a dívida (`D-0001`) no eixo da entrega.
 */
export type DeliveryAccountSummary = {
  id: string;
  /** Código sequencial por loja (ADR-028) — "E-0001". */
  accountNumber: number;
  status: DeliveryAccountStatus;
  customerId: string;
  customerName: string;
  openedAt: string;
  closedAt: string | null;
  /** Quantas vendas a conta agrega. */
  ordersCount: number;
  /** Σ do total das vendas da conta (Decimal serializado em string). */
  total: string;
  /** Σ das linhas ainda com mercadoria a sair, somando as vendas. */
  itemsPending: number;
  /** Previsão mais PRÓXIMA entre as vendas com item pendente (base do "atrasada"); null se nenhuma tem data. */
  nextPickupAt: string | null;
  /** O extrato: as vendas da conta, mais recente primeiro. */
  orders: DeliveryOrderRow[];
};

/**
 * Um card da tela de Entregas: uma CONTA (agrupa as vendas SCHEDULED de um cliente) ou uma venda
 * AVULSA (SCHEDULED sem cliente — balcão "pego depois", que não entra em conta). ADR-028.
 */
export type DeliveryCard =
  | { kind: 'account'; account: DeliveryAccountSummary }
  | { kind: 'order'; order: DeliveryOrderRow };

/** Página de entregas (cursor keyset) — cards agrupados por conta + vendas avulsas (ADR-028). */
export type DeliveriesPage = { cards: DeliveryCard[]; nextCursor: string | null };

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
  /** Preço e total da linha (Decimal em string) — usados no comprovante de retirada reimpresso. */
  unitPrice: string;
  total: string;
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
  /** Código sequencial da venda (ADR-023) — impresso como "V-000128" no comprovante de retirada. */
  orderNumber: number;
  total: string;
  /** Desconto do pedido (Decimal em string) — imprime a linha "Subtotal/Desconto" no comprovante. */
  discountAmount: string;
  /** Saldo a prazo em aberto (0 quando 100% pago). Decide se a faixa mostra "PAGO — FALTA RETIRAR"
   *  (pago) ou só "FALTA RETIRAR" (venda a prazo com saldo). Vem do `Receivable` vinculado. */
  outstandingBalance: number;
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
