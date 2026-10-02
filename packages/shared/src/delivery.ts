import { z } from 'zod';

/**
 * Retirada / entrega futura (ADR-020). Tipos compartilhados entre apps/web e apps/api para a tela
 * "Entregas". Eixo ortogonal ao fiado: aqui a mercadoria de um pedido SCHEDULED é RESERVADA na
 * venda e sai, parcial, nas retiradas. Os schemas de entrada (`deliverOrderSchema`, `deliveryMode`)
 * e os rótulos (`FULFILLMENT_STATUS_LABELS`) ficam em `./sale` junto do `createSaleSchema`.
 */

/** Retirada na loja × entrega pela loja (ADR-042). Espelha o enum `FulfillmentType` do Prisma. */
export const fulfillmentTypeSchema = z.enum(['PICKUP', 'DELIVERY']);
export type FulfillmentType = z.infer<typeof fulfillmentTypeSchema>;

export const FULFILLMENT_TYPE_LABELS: Record<FulfillmentType, string> = {
  PICKUP: 'Retirada',
  DELIVERY: 'Entrega',
};

/** "HH:MM" 00:00–23:59. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.');

/** Um intervalo de atendimento num dia ("08:00"–"12:00"). `end` > `start`. */
export const deliveryHoursRangeSchema = z
  .object({ start: hhmm, end: hhmm })
  .refine((r) => r.end > r.start, { message: 'O fim precisa ser depois do início.' });

/**
 * Período de entregas da loja (ADR-042) — `Tenant.deliverySettings`. `hours` por dia da semana
 * ("0" = domingo … "6" = sábado); dia ausente/vazio = sem entregas/retiradas naquele dia. `hours`
 * vazio (nenhum dia configurado) = sem restrição de horário. `maxPerSlot` nulo = sem limite.
 */
export const deliverySettingsSchema = z.object({
  slotMinutes: z.number().int().min(10).max(240).default(30),
  maxPerSlot: z.number().int().min(1).max(999).nullable().default(null),
  hours: z.record(z.enum(['0', '1', '2', '3', '4', '5', '6']), z.array(deliveryHoursRangeSchema).max(4)).default({}),
});
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;

/** Padrão quando a loja não configurou (coluna nula): faixa de 30 min, sem limite, sem restrição. */
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { slotMinutes: 30, maxPerSlot: null, hours: {} };

/** "AAAA-MM-DD". */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dia no formato AAAA-MM-DD.');

/**
 * "Saiu para entrega" e entregador de um pedido de ENTREGA (`POST /deliveries/:id/dispatch`, ADR-042).
 * `dispatched: true` registra a saída: dá baixa de TUDO o que falta (estoque) e conclui o pedido — a
 * loja não tem confirmação do entregador em tempo real (ADR-042 §Revisão 2026-10-02). Em pedido com
 * "Data por item", `day` limita a saída aos itens daquele dia. Não há "desfazer": se a entrega não
 * acontecer, usa-se `POST /deliveries/:id/return-from-route`. `courierId` (opcional) troca o
 * entregador; `null` tira. Ao menos um dos dois campos.
 */
export const dispatchOrderSchema = z
  .object({
    dispatched: z.literal(true).optional(),
    day: isoDay.optional(),
    courierId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.dispatched !== undefined || v.courierId !== undefined, {
    message: 'Informe a saída ou o entregador.',
  });
export type DispatchOrderInput = z.infer<typeof dispatchOrderSchema>;

/**
 * "Voltou / não entregue" (`POST /deliveries/:id/return-from-route`, ADR-042 §Revisão 2026-10-02):
 * desfaz a ÚLTIMA saída para entrega — a mercadoria volta ao estoque como RESERVADA e o pedido volta a
 * "Agendado" na nova data. `start`/`end` (ISO) = nova faixa de horário (opcional; sem faixa = só o
 * dia). Em pedido com "Data por item" vale só o `date` para os itens que voltaram.
 * (Cancelar em vez de reagendar = o cancelamento de sempre no Histórico, que já devolve ao estoque.)
 */
export const returnFromRouteSchema = z
  .object({
    date: isoDay,
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
    notes: z.string().trim().max(200).optional(),
  })
  .refine((v) => (v.start == null) === (v.end == null), { message: 'Informe o início e o fim da faixa.' })
  .refine((v) => !v.start || !v.end || new Date(v.end).getTime() > new Date(v.start).getTime(), {
    message: 'O fim da faixa precisa ser depois do início.',
  });
export type ReturnFromRouteInput = z.infer<typeof returnFromRouteSchema>;

/** Marcas do log de retiradas (`OrderItemDelivery.reference`) usadas pela entrega (ADR-042). */
export const DELIVERY_LOG_REF = {
  /** Saída registrada pelo "Saiu para entrega". */
  DISPATCH: 'SAIU_ENTREGA',
  /** Linha NEGATIVA: a mercadoria voltou ("Voltou / não entregue"). */
  RETURNED: 'VOLTOU_ENTREGA',
} as const;

/** Lê o JSON gravado tolerando nulo/legado: o que não validar cai no padrão. */
export function parseDeliverySettings(raw: unknown): DeliverySettings {
  const r = deliverySettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_DELIVERY_SETTINGS;
}

/** Situação de retirada de um pedido. Espelha o enum `FulfillmentStatus` do Prisma. */
export type FulfillmentStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED';

/**
 * Uma linha da lista de entregas (`GET /deliveries`). `total` é Decimal serializado em string;
 * `itemsPending`/`itemsCount` são QUANTIDADES em unidade-base (o que falta sair / o total vendido),
 * não contagem de linhas — 3 sacos com 1 já retirado ⇒ `itemsPending` 2 (espelha o "Falta sair").
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
  /** Agenda de entregas (ADR-042). `null` em pedidos sem o dado. */
  fulfillmentType?: FulfillmentType | null;
  scheduledUntil?: string | null;
  deliveryAddress?: string | null;
  courierName?: string | null;
};

/**
 * Um pedido na Agenda do dia (`GET /deliveries/agenda?day=`, ADR-042). `start`/`end` são instantes
 * ISO; `timed = false` quando o pedido só tem DIA (agendamento antigo/sem faixa) — vai para a lista
 * "Sem horário", fora da linha do tempo. `itemsSummary` = "2× Frango assado, 1× Maionese…".
 */
export type DeliveryAgendaRow = {
  id: string;
  orderNumber: number;
  fulfillmentType: FulfillmentType;
  fulfillmentStatus: FulfillmentStatus;
  start: string;
  end: string | null;
  timed: boolean;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  courierName: string | null;
  dispatchedAt: string | null;
  itemsSummary: string;
  itemsPending: number;
  total: string;
  notes: string | null;
  /** Pedido com "Data por item": a linha mostra SÓ os itens deste dia (sem horário). */
  perItem: boolean;
  /** "Data por item": quantos itens do pedido estão marcados para OUTROS dias. */
  otherDaysItems: number;
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
  /** Σ da QUANTIDADE (unidade-base) ainda a sair, somando as vendas da conta. */
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
  /** `DELIVERY_LOG_REF` quando a linha veio da entrega (saída / volta). `quantity` < 0 na volta. */
  reference?: string | null;
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
  /** Agenda de entregas (ADR-042). */
  fulfillmentType?: FulfillmentType | null;
  scheduledUntil?: string | null;
  deliveryAddress?: string | null;
  dispatchedAt?: string | null;
  courier?: { id: string; name: string; phone: string | null } | null;
  items: DeliveryItem[];
  itemDeliveries: DeliveryLogRow[];
};
