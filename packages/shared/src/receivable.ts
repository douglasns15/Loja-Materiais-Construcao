import { z } from 'zod';
import { paymentMethodSchema, type PaymentMethod } from './sale';
import type { ReturnTarget } from './return';

/**
 * Conta a receber / venda a prazo — o "fiado" (ADR-019). Tipos e schemas compartilhados entre
 * apps/web e apps/api. A dívida nasce na venda (parcela "A prazo" no PDV) e é abatida por
 * recebimentos (total ou parcial); receber em dinheiro gera um Suprimento no caixa.
 */

/** Situação de uma conta a receber. Espelha o enum `ReceivableStatus` do Prisma. */
export type ReceivableStatus = 'OPEN' | 'PAID' | 'CANCELLED';

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  OPEN: 'Em aberto',
  PAID: 'Quitada',
  CANCELLED: 'Cancelada',
};

/**
 * Payload para registrar um recebimento contra uma conta a receber (ADR-019). O valor é
 * validado no servidor contra o saldo devedor (`isValidReceipt` do core — positivo e ≤ saldo).
 * `method` reusa as formas de pagamento da venda; em dinheiro (`CASH`), o servidor lança um
 * Suprimento no caixa aberto (por isso o recebimento em dinheiro exige caixa aberto).
 */
export const receiveReceivableSchema = z.object({
  amount: z.number().positive(),
  method: paymentMethodSchema,
  reference: z.string().max(100).optional(),
});
export type ReceiveReceivableInput = z.infer<typeof receiveReceivableSchema>;

/** Atualização da observação de uma dívida (ADR-019). `null`/vazio limpa a observação. */
export const updateReceivableSchema = z.object({
  notes: z.string().max(500).nullable(),
});
export type UpdateReceivableInput = z.infer<typeof updateReceivableSchema>;

/** Um recebimento de uma conta a receber, como retornado pela API (`amount` serializado). */
export type ReceivablePaymentRow = {
  id: string;
  amount: string;
  method: PaymentMethod | string;
  paidAt: string;
  receivedByName: string | null;
  reference: string | null;
};

/**
 * Uma conta a receber, como retornada por `GET /receivables`. `originalAmount`/`settledAmount`
 * são Decimais serializados em string; `balance` (saldo devedor) vem calculado do servidor
 * (fonte única `receivableBalance` do core). `customerName` é o snapshot para a lista.
 */
export type ReceivableRow = {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string | null;
  originalAmount: string;
  settledAmount: string;
  balance: number;
  status: ReceivableStatus;
  dueDate: string | null;
  createdAt: string;
  createdByName: string | null;
};

/** Página de contas a receber (cursor keyset) — mesmo contrato das demais telas paginadas. */
export type ReceivablesPage = { rows: ReceivableRow[]; nextCursor: string | null };

/**
 * A CONTA de um cliente (ADR-022, Fatia A): a visão agregada das dívidas em aberto do cliente.
 * `totalBalance` é a soma dos saldos devedores (fonte única `customerAccountBalance` do core);
 * `openCount` é quantas dívidas a compõem; `nextDueDate` é o vencimento mais próximo (para
 * destacar vencidos). Retornada por `GET /receivables/accounts`.
 */
export type CustomerAccountRow = {
  customerId: string;
  customerName: string | null;
  totalBalance: number;
  openCount: number;
  oldestCreatedAt: string | null;
  nextDueDate: string | null;
};

/** Lista de contas por cliente — `GET /receivables/accounts` (conjunto pequeno, sem paginação). */
export type CustomerAccountsResponse = { rows: CustomerAccountRow[] };

/** Resultado de receber contra a conta inteira (FIFO) — `POST /receivables/accounts/:id/receive`. */
export type ReceiveAccountResult = {
  customerId: string;
  received: number;
  remainingBalance: number;
  fullyPaidCount: number;
  debtsTouched: number;
  accountCleared: boolean;
};

/** Uma venda a prazo que compõe a conta do cliente (ADR-022, Fatia A.2): a dívida daquela venda,
 * seus itens e os recebimentos que a abateram. Base do extrato/timeline da conta. */
export type AccountReceivableDetail = {
  id: string;
  orderId: string;
  originalAmount: string;
  settledAmount: string;
  balance: number;
  status: ReceivableStatus;
  dueDate: string | null;
  createdAt: string;
  orderTotal: string | null;
  items: ReceivableItem[];
  payments: ReceivablePaymentRow[];
};

/** Um item que voltou numa devolução (ADR-022, Fatia B), como aparece no extrato da conta:
 * `quantity` já vem na UNIDADE VENDIDA (o servidor reconverte da unidade-base do estoque). */
export type AccountReturnItem = {
  productName: string;
  quantity: string;
  total: string; // valor devolvido daquele item
};

/**
 * Uma DEVOLUÇÃO no extrato da conta (ADR-022, Fatia B) — um evento próprio (append-only), não uma
 * mutação da venda original. `abatedAmount` é o quanto abateu da DÍVIDA (o efeito no saldo corrente
 * da conta); `excessAmount` é o excedente que virou crédito/dinheiro (`target`), fora do saldo
 * devedor. `items` lista o que voltou. Retornado por `GET /receivables/accounts/:customerId`.
 */
export type AccountReturnEvent = {
  id: string;
  createdAt: string;
  totalValue: string;
  abatedAmount: string;
  excessAmount: string;
  target: ReturnTarget | null;
  reason: string;
  createdByName: string | null;
  items: AccountReturnItem[];
};

/** Um item CONSOLIDADO da situação atual da conta (ADR-022) — a soma, por produto, do que ainda
 * está EM ABERTO, líquido de devoluções (`quantity` já na unidade vendida; `total` = valor líquido). */
export type AccountOpenItem = {
  productName: string;
  unit: string;
  quantity: string;
  total: string;
};

/** Detalhe da CONTA de um cliente — `GET /receivables/accounts/:customerId`. Reúne as vendas a
 * prazo (em aberto + quitadas) com itens e recebimentos; a UI monta o log cronológico. */
export type CustomerAccountDetail = {
  customerId: string;
  customerName: string | null;
  /** Observação da DÍVIDA/conta (ADR-022) — uma só nota por cliente, compartilhada por todas as
   * vendas dele. Separada da nota do cadastro/perfil (`Customer.notes`). */
  debtNotes: string | null;
  /** Crédito a favor do cliente (ADR-022 Fatia B) — sobra de devolução guardada como crédito. */
  creditBalance: number;
  totalBalance: number;
  openCount: number;
  receivables: AccountReceivableDetail[];
  /** Devoluções do cliente (ADR-022, Fatia B) — eventos próprios que a UI intercala na timeline. */
  returns: AccountReturnEvent[];
  /** Resumo consolidado da situação atual (ADR-022): itens ainda em aberto (vendido − devolvido),
   * somados por produto. Só dívidas OPEN entram; item totalmente devolvido some. */
  openItems: AccountOpenItem[];
};

/** Um item da venda que originou a dívida (para o detalhe da conta a receber). */
export type ReceivableItem = {
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
  pairGroup: number | null;
};

/** Detalhe de uma conta a receber (`GET /receivables/:id`): a conta + os itens da venda de
 * origem + o histórico de recebimentos (com data/hora). Base da tela de detalhe do cliente. */
export type ReceivableDetail = ReceivableRow & {
  notes: string | null;
  /** Observação da DÍVIDA/conta do cliente (ADR-022) — uma só nota por cliente, compartilhada por
   * todas as vendas dele; é a que as telas editam. Separada da nota do cadastro (`Customer.notes`). */
  debtNotes: string | null;
  orderTotal: string | null;
  orderCreatedAt: string | null;
  items: ReceivableItem[];
  orderPayments: { method: string; amount: string }[];
  payments: ReceivablePaymentRow[];
};
