/**
 * Lógica de negócio PURA (sem I/O) — funções `(entrada) => saída` testáveis com Vitest.
 * Reusada no cliente (apps/web) e no servidor (apps/api), conforme CLAUDE.md.
 *
 * Esta é a semente da Fase 1: cálculos de caixa, estoque e frete entram aqui.
 */

export interface OrderItemLike {
  /** Total já calculado da linha (quantidade × preço − desconto). */
  total: number;
}

/** Soma os totais das linhas para obter o subtotal de um pedido. */
export function calcSubtotal(items: OrderItemLike[]): number {
  return items.reduce((acc, item) => acc + item.total, 0);
}

/**
 * Total de um pedido a partir do subtotal, desconto e frete.
 * Mantém a regra simples e pura para ser reaproveitada no PDV e na API.
 */
export function calcOrderTotal(params: {
  subtotal: number;
  discountAmount?: number;
  freightAmount?: number;
}): number {
  const { subtotal, discountAmount = 0, freightAmount = 0 } = params;
  return subtotal - discountAmount + freightAmount;
}

/**
 * Margem de lucro percentual sobre o preço de venda (markup sobre venda).
 * Ex: custo 60, venda 100 → 40%. Retorna 0 se o preço de venda for <= 0.
 * Arredondada a 2 casas para exibição.
 */
export function calcMarginPercent(costPrice: number, salePrice: number): number {
  if (salePrice <= 0) return 0;
  return Number((((salePrice - costPrice) / salePrice) * 100).toFixed(2));
}

// -----------------------------------------------------------------------------
// ESTEIRA DE PRECIFICAÇÃO — markup × margem × preço (padrão de mercado: Bling,
// Conta Azul, Omie). A VERDADE do produto são só Custo e Preço; markup e margem
// são SEMPRE derivados — nunca viram estado próprio, o que elimina o loop de
// re-render (A→B→A). O preço é a única grandeza monetária, logo é o que se
// arredonda a 2 casas; markup e margem exibidos, por derivarem do preço já
// arredondado, refletem os centavos reais sem "ajuste reverso" manual.
// -----------------------------------------------------------------------------

/**
 * Markup % = lucro sobre o **custo** (distinto da margem, que é sobre a venda).
 * Ex.: custo 60, venda 100 → 66,67%. Custo ≤ 0 ⇒ 0 (não há base para markup).
 * Arredondado a 2 casas para exibição.
 */
export function markupPercent(costPrice: number, salePrice: number): number {
  if (costPrice <= 0) return 0;
  return Number((((salePrice - costPrice) / costPrice) * 100).toFixed(2));
}

/**
 * Preço de venda a partir do markup: `Custo × (1 + M/100)`. Sempre 2 casas — o
 * centavo é a verdade, e markup/margem re-derivam desse preço arredondado.
 */
export function salePriceFromMarkup(costPrice: number, markup: number): number {
  return Number((costPrice * (1 + markup / 100)).toFixed(2));
}

/**
 * Preço de venda a partir da margem sobre a venda: `Custo / (1 − G/100)`.
 * Margem ≥ 100 é impossível (o denominador zera/inverte e o preço explodiria) ⇒
 * devolve 0; a UI deve travar a entrada em < 100 antes de chamar. Sempre 2 casas.
 */
export function salePriceFromMargin(costPrice: number, margin: number): number {
  if (margin >= 100) return 0;
  return Number((costPrice / (1 - margin / 100)).toFixed(2));
}

/**
 * Regra "mudou o Custo → preserva o markup/margem, recalcula o Preço": preservar
 * o markup ao trocar o custo equivale a **escalar o preço na mesma proporção do
 * custo** (`(P−C)/C` constante ⇔ `P'/C' = P/C`). Custo antigo ≤ 0 ⇒ não há markup
 * a preservar, então mantém o preço (o markup passa a ser derivado do novo custo).
 */
export function repriceHoldingMarkup(
  oldCost: number,
  oldPrice: number,
  newCost: number,
): number {
  if (oldCost <= 0) return oldPrice;
  return Number((oldPrice * (newCost / oldCost)).toFixed(2));
}

// =============================================================================
// CAIXA (Cash Session)
// =============================================================================

/**
 * Valor esperado no caixa = abertura + entradas em dinheiro durante a sessão.
 * Usado no fechamento para comparar com o valor contado pelo operador.
 */
export function calcExpectedCash(openingAmount: number, cashInflows: number[]): number {
  const total = cashInflows.reduce((acc, v) => acc + v, openingAmount);
  return Number(total.toFixed(2));
}

/**
 * Divergência de fechamento = valor contado − valor esperado.
 * Positivo = sobra; negativo = falta; 0 = bateu. Arredondada a 2 casas.
 */
export function calcCashDivergence(expectedAmount: number, closingAmount: number): number {
  return Number((closingAmount - expectedAmount).toFixed(2));
}

/**
 * Fechamento ajustado por vendas offline tardias (CS-5, ADR-012 §b).
 *
 * Uma venda offline pode ser anexada a um caixa JÁ FECHADO no sync (CS-4). O dado
 * congelado do fechamento (`expected`/`divergence`) permanece **imutável** para a
 * auditoria; esta função só recalcula, para exibição no relatório, quanto o esperado
 * "deveria" ter sido incluindo a **parcela em dinheiro** dessas vendas tardias.
 *
 * Só o dinheiro entra no ajuste — cartão/PIX não passam pela gaveta (conciliam na
 * maquininha), exatamente como no cálculo do esperado (`calcExpectedCash`).
 *
 * @param expectedAmount  esperado congelado no fechamento
 * @param closingAmount   contado no fechamento
 * @param lateCashSalesTotal  Σ da parcela CASH das vendas anexadas após o fechamento
 */
export function calcAdjustedCashClosing(
  expectedAmount: number,
  closingAmount: number,
  lateCashSalesTotal: number,
): { adjustedExpected: number; adjustedDivergence: number } {
  const adjustedExpected = Number((expectedAmount + lateCashSalesTotal).toFixed(2));
  return {
    adjustedExpected,
    adjustedDivergence: calcCashDivergence(adjustedExpected, closingAmount),
  };
}

/** Movimentação de caixa que não é venda (devolução, sangria, suprimento, despesa). */
export interface CashMovementLike {
  type: StockMovementType; // reaproveita 'INCOME' | 'EXPENSE'
  amount: number;
}

/**
 * Saldo líquido das movimentações de caixa: Σ INCOME − Σ EXPENSE.
 * Entra no valor esperado do caixa junto com a abertura e as vendas em dinheiro,
 * permitindo que uma devolução (EXPENSE) reduza o esperado do caixa de hoje.
 * Arredondado a 2 casas.
 */
export function netCashMovements(movements: CashMovementLike[]): number {
  const total = movements.reduce(
    (acc, m) => acc + (m.type === 'INCOME' ? m.amount : -m.amount),
    0,
  );
  return Number(total.toFixed(2));
}

/**
 * Totais **brutos** das movimentações de caixa, cada um ≥ 0: `income` = Σ INCOME
 * (suprimentos) e `expense` = Σ EXPENSE (devoluções, sangrias, despesas).
 *
 * Complementa `netCashMovements` (= income − expense) para exibir **entradas e
 * saídas separadas** no cartão do caixa (a "mini-DRE"), em vez de só o líquido —
 * assim o operador enxerga o que entrou e o que saiu, não apenas o saldo.
 */
export function grossCashMovements(
  movements: CashMovementLike[],
): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const m of movements) {
    if (m.type === 'INCOME') income += m.amount;
    else expense += m.amount;
  }
  return { income: Number(income.toFixed(2)), expense: Number(expense.toFixed(2)) };
}

/**
 * Movimentações de caixa que o operador lança **manualmente** (Movimentação de Caixa):
 *  - `SUPPLY` (Suprimento): dinheiro que ENTRA fora de venda — reforço de troco, aporte,
 *    pagamento atrasado recebido em espécie.
 *  - `WITHDRAWAL` (Sangria): dinheiro que SAI do caixa — retirada, despesa paga pela gaveta.
 *
 * Não inclui `RETURN` (devolução) nem o recebimento de conta a receber: esses nascem de
 * fluxos próprios (devolução de venda / venda a prazo), não do lançamento manual.
 */
export type ManualCashMovementKind = 'SUPPLY' | 'WITHDRAWAL';

/**
 * Direção contábil de uma movimentação manual: Suprimento entra (`INCOME`), Sangria sai
 * (`EXPENSE`). Fonte ÚNICA do sinal do lançamento para a API e a UI nunca divergirem —
 * quem grava o `CashMovement` e quem exibe a prévia usam a mesma regra.
 */
export function manualCashMovementType(kind: ManualCashMovementKind): 'INCOME' | 'EXPENSE' {
  return kind === 'SUPPLY' ? 'INCOME' : 'EXPENSE';
}

/**
 * Natureza do **estorno** de um lançamento manual: para corrigir um lançamento feito por
 * engano, gera-se um **contra-lançamento** de sinal oposto (Sangria lançada errada → estorno
 * como Suprimento; Suprimento → estorno como Sangria). Não se apaga a linha — o par
 * original + estorno preserva o rastro (mesma filosofia da devolução vs. apagar a venda).
 *
 * O estorno reusa `SUPPLY`/`WITHDRAWAL` (sem `kind` novo, sem migration): como o `type` é
 * sempre derivado do `kind` por `manualCashMovementType`, inverter o `kind` garante que o
 * estorno tenha o sinal oposto e **zere o efeito no caixa** (original −X, estorno +X → 0).
 * Fonte ÚNICA dessa regra para API (grava) e UI (rotula "Estorno de …") não divergirem.
 */
export function reversalKindFor(kind: ManualCashMovementKind): ManualCashMovementKind {
  return kind === 'SUPPLY' ? 'WITHDRAWAL' : 'SUPPLY';
}

// ---------------------------------------------------------------------------
// Venda a prazo / Contas a Receber — o "fiado" (ADR-019)
// ---------------------------------------------------------------------------

/** Converte um valor em reais para centavos inteiros — evita erro de ponto flutuante ao
 * comparar dinheiro (ex.: `0.1 + 0.2 !== 0.3`). Uso interno das funções de fiado. */
function toCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Saldo devedor de uma conta a receber (ADR-019): quanto **ainda falta receber** de uma venda
 * a prazo = `originalAmount − settledAmount`, nunca negativo (recebeu tudo ⇒ 0). Fonte única
 * para API e UI mostrarem o mesmo "falta R$…".
 */
export function receivableBalance(
  originalAmount: number,
  settledAmount: number,
  returnedAmount = 0,
): number {
  // ADR-022: a devolução de itens (`returnedAmount`) abate a dívida junto com o recebido, então
  // o saldo devedor é `original − recebido − devolvido`. `returnedAmount` default 0 preserva os
  // chamadores antigos (só recebimento) — pré-Fatia B toda dívida tem devolvido 0.
  return Number(Math.max(0, originalAmount - settledAmount - returnedAmount).toFixed(2));
}

/**
 * Um recebimento (total ou parcial) é válido se for **positivo** e **não exceder o saldo
 * devedor** — ninguém recebe mais do que o cliente deve. Comparação em centavos para não
 * tropeçar em arredondamento. Espelhada no servidor e na UI.
 */
export function isValidReceipt(amount: number, balance: number): boolean {
  const cents = toCents(amount);
  return cents > 0 && cents <= toCents(balance);
}

/**
 * Aplica um recebimento a uma conta a receber e devolve o novo total recebido e a situação
 * resultante: quita (`PAID`) quando o recebido alcança o valor original, senão segue `OPEN`.
 * Não valida o valor (ver `isValidReceipt`) — assume um recebimento já aceito. Fonte única da
 * transição de status para o servidor não divergir do que a tela mostra.
 */
export function applyReceivablePayment(
  originalAmount: number,
  settledAmount: number,
  amount: number,
  returnedAmount = 0,
): { settledAmount: number; status: 'OPEN' | 'PAID'; fullyPaid: boolean } {
  const newSettled = Number((settledAmount + amount).toFixed(2));
  // Quita quando recebido + devolvido (ADR-022) alcança o original; `returnedAmount` default 0
  // mantém o comportamento antigo (só recebimento). ≥ tolera arredondamento.
  const fullyPaid = toCents(newSettled + returnedAmount) >= toCents(originalAmount);
  return { settledAmount: newSettled, status: fullyPaid ? 'PAID' : 'OPEN', fullyPaid };
}

/**
 * Numa venda a prazo, o que foi **pago agora** (entrada) mais o valor deixado **a prazo** deve
 * fechar exatamente o total da venda (ADR-019) — sem sobra nem falta. Tolera 1 centavo de
 * arredondamento. `creditAmount = total` é o fiado 100%; `= 0` é a venda à vista comum.
 */
export function creditSaleBalances(total: number, paidNow: number, creditAmount: number): boolean {
  return Math.abs(toCents(paidNow) + toCents(creditAmount) - toCents(total)) <= 1;
}

/**
 * Máximo de "Crédito da loja" (ADR-022, Fatia C) aplicável a uma venda: não passa do saldo de
 * crédito do cliente nem do que resta a pagar AGORA (`total − a prazo`). Nunca negativo. Fonte única
 * usada pelo PDV (para travar o campo) e pelo servidor (para validar). Em centavos, sem erro de float.
 */
export function maxStoreCreditForSale(
  total: number,
  creditAmount: number,
  creditBalance: number,
): number {
  const payNowC = Math.max(0, toCents(total) - toCents(Math.max(0, creditAmount)));
  const balanceC = Math.max(0, toCents(Math.max(0, creditBalance)));
  return Math.max(0, Math.min(balanceC, payNowC)) / 100;
}

// ---------------------------------------------------------------------------
// Conta do cliente — fiado acumulado (ADR-022, Fatia A)
// ---------------------------------------------------------------------------

/** Uma dívida em aberto do cliente para fins de conta (ADR-022): id + saldo devedor já calculado. */
export interface AccountReceivable {
  id: string;
  balance: number;
}

/**
 * Saldo da CONTA do cliente (ADR-022): a soma dos saldos devedores das dívidas em aberto.
 * A "conta" é implícita — não há entidade nova; é a visão agregada das contas a receber do
 * cliente. Soma em centavos para não acumular erro de ponto flutuante. (O crédito a favor do
 * cliente — saldo negativo — entra na Fatia B; aqui a conta é só o que ele deve.)
 */
export function customerAccountBalance(receivables: AccountReceivable[]): number {
  const cents = receivables.reduce((acc, r) => acc + toCents(r.balance), 0);
  return Number((cents / 100).toFixed(2));
}

/**
 * Distribui um recebimento **contra a conta inteira** do cliente (ADR-022): abate as dívidas em
 * aberto **do mais antigo para o mais novo** (FIFO). Recebe as dívidas **já ordenadas** (mais
 * antiga primeiro) e devolve quanto cai em cada uma, até esgotar o valor. Cada alocação nunca
 * passa do saldo daquela dívida; a soma das alocações nunca passa do `amount`. Aritmética em
 * centavos (sem erro de ponto flutuante). Não valida o teto total (ver `isValidReceipt` contra
 * `customerAccountBalance`) — assume um valor já aceito. Fonte única para o servidor aplicar e a
 * UI prever o mesmo rateio.
 */
export function distributeAccountPayment(
  amount: number,
  receivables: AccountReceivable[],
): { receivableId: string; amount: number }[] {
  let remaining = toCents(amount);
  const allocations: { receivableId: string; amount: number }[] = [];
  for (const r of receivables) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, toCents(r.balance));
    if (take <= 0) continue; // dívida já quitada (saldo 0) — pula
    allocations.push({ receivableId: r.id, amount: Number((take / 100).toFixed(2)) });
    remaining -= take;
  }
  return allocations;
}

// ---------------------------------------------------------------------------
// Dívida do cliente como entidade — conta-corrente "D-0001" (ADR-026)
// ---------------------------------------------------------------------------

/**
 * Saldo devedor de uma DÍVIDA do cliente (ADR-026): a soma dos saldos devedores das vendas a prazo
 * (`receivables`) que a compõem. Reúso do `customerAccountBalance` — a dívida é o mesmo agregado da
 * "conta implícita" da ADR-022, agora com identidade. Recebe os saldos já calculados (via
 * `receivableBalance`) e soma em centavos (sem erro de ponto flutuante). Fonte única para o servidor
 * e a UI mostrarem o mesmo saldo.
 */
export function debtBalance(receivables: AccountReceivable[]): number {
  return customerAccountBalance(receivables);
}

/**
 * Estado da dívida (ADR-026) derivado do saldo: `PAID` quando zera (quitada — arquiva na aba
 * "Quitadas"), senão `OPEN`. Comparação em centavos para tolerar arredondamento. Fonte única da
 * transição, para o servidor não divergir do que a tela mostra ao receber/devolver.
 */
export function debtStatusAfter(balance: number): 'OPEN' | 'PAID' {
  return toCents(balance) <= 0 ? 'PAID' : 'OPEN';
}

// ---------------------------------------------------------------------------
// Devolução/troca por item + crédito do cliente (ADR-022, Fatia B/C)
// ---------------------------------------------------------------------------

/**
 * Quanto (em unidade-base) de uma linha ainda PODE ser devolvido (ADR-022): `baseQuantity −
 * returnedBaseQty`, nunca negativo. Trava contra devolver a mesma peça duas vezes. Espelha o
 * `remainingToDeliver` (ADR-020). Fonte única do "devolvível" por item.
 */
export function returnableBaseQty(baseQuantity: number, returnedBaseQty: number): number {
  return Number(Math.max(0, baseQuantity - returnedBaseQty).toFixed(4));
}

/**
 * Uma devolução (parcial ou total) de uma linha é válida se for **positiva** e **não exceder o
 * que ainda é devolvível**. Comparação em unidades × 10^4 p/ não tropeçar em arredondamento.
 * Espelha `isValidDelivery`. Reusada no servidor e na UI.
 */
export function isValidPartialReturn(qty: number, returnable: number): boolean {
  const units = toQtyUnits(qty);
  return units > 0 && units <= toQtyUnits(returnable);
}

/**
 * Aplica uma devolução a uma linha e devolve o novo total devolvido e se a linha ficou
 * **completa** (`≥` tolera arredondamento). Não valida (ver `isValidPartialReturn`) — assume uma
 * devolução já aceita. Espelha `applyItemDelivery`; fonte única da transição por linha.
 */
export function applyItemReturn(
  baseQuantity: number,
  returnedBaseQty: number,
  qty: number,
): { returnedBaseQty: number; fullyReturned: boolean } {
  const newReturned = Number((returnedBaseQty + qty).toFixed(4));
  const fullyReturned = toQtyUnits(newReturned) >= toQtyUnits(baseQuantity);
  return { returnedBaseQty: newReturned, fullyReturned };
}

/**
 * Reparte o valor devolvido `V` (ADR-022): primeiro **abate a dívida** daquela venda (até o saldo
 * devedor), e o que **sobra** é o EXCEDENTE (vira crédito na loja OU dinheiro, escolha do
 * operador). Numa venda à vista o saldo devedor é 0 ⇒ `V` inteiro é excedente. Aritmética em
 * centavos. `debtBalance` deve ser o saldo devedor já calculado (`receivableBalance`).
 */
export function splitReturnValue(
  value: number,
  debtBalance: number,
): { abated: number; excess: number } {
  const abatedCents = Math.min(toCents(value), Math.max(0, toCents(debtBalance)));
  const abated = Number((abatedCents / 100).toFixed(2));
  const excess = Number((value - abated).toFixed(2));
  return { abated, excess };
}

/**
 * Aplica um abatimento por DEVOLUÇÃO a uma conta a receber (ADR-022) e devolve o novo total
 * devolvido e a situação: quita (`PAID`) quando **recebido + devolvido** alcança o valor original
 * (dívida sem saldo — por dinheiro e/ou devolução), senão segue `OPEN`. Não valida — assume um
 * abatimento já calculado por `splitReturnValue`. Espelha `applyReceivablePayment`.
 */
export function applyReceivableReturn(
  originalAmount: number,
  settledAmount: number,
  returnedAmount: number,
  abated: number,
): { returnedAmount: number; status: 'OPEN' | 'PAID'; fullySettled: boolean } {
  const newReturned = Number((returnedAmount + abated).toFixed(2));
  const fullySettled = toCents(settledAmount + newReturned) >= toCents(originalAmount);
  return { returnedAmount: newReturned, status: fullySettled ? 'PAID' : 'OPEN', fullySettled };
}

/** Valores (em reais) das moedas do Real em circulação, para o contador de gaveta. */
export const BRL_COIN_VALUES = [0.05, 0.1, 0.25, 0.5, 1] as const;
/** Valores (em reais) das cédulas do Real em circulação, para o contador de gaveta. */
export const BRL_BILL_VALUES = [2, 5, 10, 20, 50, 100, 200] as const;

/**
 * Soma o total de uma contagem física da gaveta (contador de cédulas e moedas):
 * Σ (valor da peça × quantidade). `counts` mapeia o valor da peça em reais
 * (ex.: `0.5`, `100`) para a quantidade contada.
 *
 * Só peças inteiras contam: quantidade ausente, negativa, fracionária ou não
 * finita vira 0 (não existe meia moeda). A soma é feita em **centavos** para
 * evitar o erro clássico de ponto flutuante (ex.: `0,05 × 3 = 0,15000000002`).
 * Retorna reais com 2 casas.
 */
export function sumCashCount(counts: Record<number, number>): number {
  let cents = 0;
  for (const [value, qty] of Object.entries(counts)) {
    const denom = Number(value);
    if (!Number.isFinite(denom) || denom <= 0) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const n = Math.floor(qty);
    cents += Math.round(denom * 100) * n;
  }
  return Number((cents / 100).toFixed(2));
}

/** Uma parcela de pagamento de uma venda: a forma e o valor recebido nela. */
export interface SalePaymentLike {
  method: PaymentMethodCode;
  amount: number;
}

/** Situação do recebimento: quanto foi pago, quanto falta, troco e se já cobre o total. */
export interface PaymentStatus {
  /** Σ das parcelas (só valores positivos contam). */
  paid: number;
  /** Quanto ainda falta receber (0 quando o pago já cobre o total). */
  remaining: number;
  /** Troco a devolver — só sai do dinheiro (ver regra abaixo). */
  change: number;
  /** `true` quando o pago cobre o total (habilita concluir a venda). */
  sufficient: boolean;
}

/**
 * Situação do recebimento de uma venda paga em UMA OU MAIS formas (pagamento
 * dividido — ver ADR-016 sobre a forma principal que precifica o carrinho). A API
 * (`POST /orders`) já valida `pago ≥ total`; esta função é a mesma conta na tela e
 * no comprovante, para o front nunca discordar do servidor.
 *
 * Regra do TROCO: só o DINHEIRO devolve troco (cartão/PIX não dão troco) e o troco
 * nunca passa do dinheiro efetivamente recebido — é o excedente do pago sobre o
 * total, limitado à soma das parcelas em dinheiro. Ex.: total R$100, R$50 no crédito
 * + R$60 em dinheiro ⇒ pago R$110, troco R$10 (sai da gaveta). Contas em CENTAVOS
 * para evitar o erro de ponto flutuante; parcelas inválidas ou ≤ 0 contam 0.
 */
export function paymentStatus(total: number, payments: SalePaymentLike[]): PaymentStatus {
  const totalCents = Math.max(0, Math.round((Number.isFinite(total) ? total : 0) * 100));
  let paidCents = 0;
  let cashCents = 0;
  for (const p of payments) {
    if (!Number.isFinite(p.amount) || p.amount <= 0) continue;
    const cents = Math.round(p.amount * 100);
    paidCents += cents;
    if (p.method === 'CASH') cashCents += cents;
  }
  const overpayCents = Math.max(0, paidCents - totalCents);
  const changeCents = Math.min(overpayCents, cashCents);
  const remainingCents = Math.max(0, totalCents - paidCents);
  return {
    paid: Number((paidCents / 100).toFixed(2)),
    remaining: Number((remainingCents / 100).toFixed(2)),
    change: Number((changeCents / 100).toFixed(2)),
    sufficient: paidCents >= totalCents,
  };
}

// =============================================================================
// VENDA (Sale / PDV)
// =============================================================================

export interface SaleItemInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
}

/** Total de uma linha da venda: quantidade × preço unitário − desconto da linha. */
export function calcSaleItemTotal(item: SaleItemInput): number {
  return Number((item.quantity * item.unitPrice - (item.discount ?? 0)).toFixed(2));
}

/**
 * Subtotal (soma das linhas) e total (subtotal − desconto + frete) de uma venda.
 * Reaproveita `calcOrderTotal`. Tudo arredondado a 2 casas.
 */
export function calcSaleTotals(
  items: SaleItemInput[],
  opts: { discountAmount?: number; freightAmount?: number } = {},
): { subtotal: number; total: number } {
  const subtotal = Number(
    items.reduce((acc, item) => acc + calcSaleItemTotal(item), 0).toFixed(2),
  );
  const total = Number(
    calcOrderTotal({
      subtotal,
      discountAmount: opts.discountAmount,
      freightAmount: opts.freightAmount,
    }).toFixed(2),
  );
  return { subtotal, total };
}

// =============================================================================
// VENDA EM UNIDADE ALTERNATIVA (ADR-013 — EF-3)
// =============================================================================
//
// Um produto pode ser vendido na sua unidade-base (ex.: metro) OU numa embalagem
// fechada (ex.: rolo de 100 m) com PREÇO PRÓPRIO — o fechado costuma sair mais barato
// por unidade-base, então NÃO é `salePrice × conversionFactor`. O estoque é único e
// físico: vender a embalagem debita `quantity × conversionFactor` da unidade-base
// (ADR-001). Estas funções puras traduzem "modo escolhido no PDV" em preço e baixa.

/** Modo de venda escolhido no PDV: unidade-base (metro) ou embalagem alternativa (rolo). */
export type SaleUnitMode = 'BASE' | 'ALT';

/**
 * Configuração de preço/embalagem de um produto (subconjunto de `Product`, ADR-013).
 * `altUnit`/`altSalePrice`/`conversionFactor` são opcionais: preenchidos juntos habilitam
 * a venda na embalagem fechada; vazios ⇒ produto de uma unidade só.
 */
export interface AltUnitConfig {
  /** Preço de venda da unidade-base (ex.: preço por metro). */
  salePrice: number;
  /** Unidade da embalagem alternativa (ex.: 'ROLL'). `null`/ausente = sem alternativa. */
  altUnit?: string | null;
  /** Preço próprio de 1 embalagem alternativa (ex.: preço do rolo fechado). */
  altSalePrice?: number | null;
  /** Tamanho da embalagem em unidade-base (ex.: 100 metros por rolo). */
  conversionFactor?: number | null;
}

/**
 * `true` quando o produto TEM embalagem alternativa vendável: precisa de `altUnit`,
 * `altSalePrice > 0` e `conversionFactor > 0` (os três juntos). É o gate que o PDV usa
 * para decidir se oferece o seletor "base × embalagem".
 */
export function hasAltUnit(p: AltUnitConfig): boolean {
  return (
    !!p.altUnit &&
    p.altSalePrice != null &&
    p.altSalePrice > 0 &&
    p.conversionFactor != null &&
    p.conversionFactor > 0
  );
}

/** Preço unitário e fator de conversão para a unidade-base, resolvidos para um modo. */
export interface ResolvedSaleUnit {
  /** Preço a cobrar por 1 unidade do modo escolhido. */
  unitPrice: number;
  /** Quantas unidades-base equivalem a 1 do modo (BASE = 1; ALT = `conversionFactor`). */
  factorToBase: number;
}

/**
 * Resolve preço e fator para o modo escolhido. BASE ⇒ `{ salePrice, 1 }`; ALT (quando
 * disponível) ⇒ `{ altSalePrice, conversionFactor }`. **Guarda de segurança:** se ALT for
 * pedido mas o produto não tem embalagem válida, cai para BASE — nunca cobra preço indefinido.
 */
export function resolveSaleUnit(p: AltUnitConfig, mode: SaleUnitMode): ResolvedSaleUnit {
  if (mode === 'ALT' && hasAltUnit(p)) {
    return { unitPrice: p.altSalePrice as number, factorToBase: p.conversionFactor as number };
  }
  return { unitPrice: p.salePrice, factorToBase: 1 };
}

/**
 * Quantidade em unidade-base a debitar do estoque (ADR-001) para `quantity` unidades
 * vendidas no modo escolhido. BASE ⇒ `quantity`; ALT ⇒ `quantity × conversionFactor`.
 * Arredondado a 4 casas (precisão de `Product.stockQty`). Usado tanto na trava de estoque
 * do PDV quanto no `StockMovement` de saída.
 */
export function toBaseQuantity(p: AltUnitConfig, mode: SaleUnitMode, quantity: number): number {
  const { factorToBase } = resolveSaleUnit(p, mode);
  return Number((quantity * factorToBase).toFixed(4));
}

/**
 * Preço efetivo por unidade-base no modo escolhido — BASE ⇒ `salePrice`; ALT ⇒
 * `altSalePrice / conversionFactor`. Serve para MOSTRAR a economia ("R$ x,xx/m no rolo")
 * e para comparar com o `costPrice` (que é por unidade-base) ao calcular margem. Retorna 0
 * se o fator for inválido (evita divisão por zero). Arredondado a 4 casas.
 */
export function effectiveBaseUnitPrice(p: AltUnitConfig, mode: SaleUnitMode): number {
  const { unitPrice, factorToBase } = resolveSaleUnit(p, mode);
  if (factorToBase <= 0) return 0;
  return Number((unitPrice / factorToBase).toFixed(4));
}

// -----------------------------------------------------------------------------
// UNIDADE FECHADA COMO PRINCIPAL — Barra/Rolo + venda fracionada por metro (ADR-017)
// -----------------------------------------------------------------------------
// A unidade fechada (barra/rolo) é a de primeira classe na UI, mas o LEDGER de
// estoque continua em unidade fina (metro) por precisão — 0,5 m é exato em metros,
// mas seria dízima em "barras". Estas funções puras fazem a régua fina ↔ fechado
// e a validação do passo de meio metro. O ledger (ADR-001) não muda.

/** Passo mínimo/incremento da venda fracionada por metro (ADR-017): meio metro. */
export const METER_SALE_STEP = 0.5;

/**
 * `true` se `meters` é uma venda fracionada válida: **múltiplo de 0,5 m** e **≥ 0,5 m**
 * (ADR-017 — evita saldos muito quebrados). Tolerância a ruído de ponto flutuante.
 */
export function isValidMeterStep(meters: number, step: number = METER_SALE_STEP): boolean {
  if (!(step > 0) || !Number.isFinite(meters) || meters < step) return false;
  const ratio = meters / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** Total de metros que N unidades fechadas representam (entrada de estoque em barras). */
export function metersFromWhole(wholeUnits: number, unitLengthMeters: number): number {
  if (!(unitLengthMeters > 0)) return 0;
  return Number((wholeUnits * unitLengthMeters).toFixed(4));
}

/**
 * Decompõe um saldo em metros em **unidades fechadas inteiras + sobra em metros**, para
 * exibição (ADR-017): ex.: 298 m com barra de 6 m → `{ whole: 49, remainderMeters: 4 }`
 * ("49 barras + 4 m", não "49,67 barras"). Vale igual para rolo. `unitLength <= 0` ⇒ tudo
 * como sobra (produto sem tamanho definido). O ratio é arredondado antes do piso para não
 * deixar um múltiplo exato (300 ÷ 6) cair para 49 por ruído de ponto flutuante.
 */
export function splitWholeAndRemainder(
  meters: number,
  unitLengthMeters: number,
): { whole: number; remainderMeters: number } {
  if (!(unitLengthMeters > 0)) {
    return { whole: 0, remainderMeters: Number(meters.toFixed(4)) };
  }
  const whole = Math.floor(Number((meters / unitLengthMeters).toFixed(6)));
  const remainderMeters = Number((meters - whole * unitLengthMeters).toFixed(4));
  return { whole, remainderMeters };
}

/**
 * Unidades fechadas que podem ser a PRINCIPAL com corte por metro (ADR-017). A barra/rolo é
 * o `unit` do produto; o estoque fica na unidade fina (metro), desacoplado. Distingue-se do
 * EF-3 antigo (base fina + `altUnit` fechada), que NÃO entra por aqui.
 */
export const CLOSED_PRIMARY_UNITS = ['BARRA', 'ROLL'] as const;

/** Config de um produto de unidade fechada (ADR-017). Preços já como número (Decimal→number). */
export interface ClosedPrimaryConfig {
  unit: string;
  /** Tamanho da barra/rolo em metros (unidade fina por unidade fechada). */
  conversionFactor?: number | null;
  /** Preço da barra/rolo fechada (sempre presente). */
  salePrice: number;
  /** Preço por metro — OPCIONAL. Nulo ⇒ o produto só vende a unidade fechada inteira. */
  altSalePrice?: number | null;
}

/**
 * `true` se o produto é **unidade fechada como principal** (ADR-017): `unit` é fechada (barra/rolo)
 * e tem `conversionFactor` (tamanho) > 0. Só esses têm o estoque lido/gravado em metros com a
 * barra baixando `qtd × tamanho`.
 */
export function isClosedPrimary(p: { unit: string; conversionFactor?: number | null }): boolean {
  return (
    (CLOSED_PRIMARY_UNITS as readonly string[]).includes(p.unit) &&
    p.conversionFactor != null &&
    Number(p.conversionFactor) > 0
  );
}

/** `true` se, além de fechado, o produto pode ser vendido por metro (tem preço/metro). */
export function sellsByMeter(p: {
  unit: string;
  conversionFactor?: number | null;
  altSalePrice?: number | null;
}): boolean {
  return isClosedPrimary(p) && p.altSalePrice != null && Number(p.altSalePrice) > 0;
}

/** Modo de venda de um produto de unidade fechada (ADR-017). */
export type ClosedSaleMode = 'WHOLE' | 'METER';

export interface ClosedSaleResolved {
  /** Preço por unidade vendida (1 barra OU 1 metro). */
  unitPrice: number;
  /** Metros que 1 unidade vendida baixa do estoque (barra ⇒ tamanho; metro ⇒ 1). */
  metersPerUnit: number;
}

/**
 * Resolve preço e o débito de estoque (em metros) para o modo escolhido de um produto de
 * unidade fechada (ADR-017). `WHOLE` (padrão) ⇒ preço da barra e baixa `tamanho` metros; `METER`
 * (só se `sellsByMeter`) ⇒ preço por metro e baixa 1 metro. **Guarda:** se pedirem `METER` sem
 * preço/metro, cai para `WHOLE` (nunca cobra preço indefinido) — espelha o fallback do EF-3.
 */
export function resolveClosedSale(p: ClosedPrimaryConfig, mode: ClosedSaleMode): ClosedSaleResolved {
  const length = Number(p.conversionFactor ?? 0);
  if (mode === 'METER' && sellsByMeter(p)) {
    return { unitPrice: Number(p.altSalePrice), metersPerUnit: 1 };
  }
  return { unitPrice: p.salePrice, metersPerUnit: length > 0 ? length : 1 };
}

/**
 * Metros a baixar do estoque (ledger, ADR-001) para `qty` unidades vendidas no modo escolhido —
 * é o que a trava de estoque e o `StockMovement` usam para um produto de unidade fechada.
 */
export function closedStockMeters(
  p: ClosedPrimaryConfig,
  mode: ClosedSaleMode,
  qty: number,
): number {
  const { metersPerUnit } = resolveClosedSale(p, mode);
  return Number((qty * metersPerUnit).toFixed(4));
}

// =============================================================================
// PRODUTO AGREGADO — venda em par (ADR-015)
// =============================================================================
// Dois produtos independentes (parafuso R$0,60 + bucha R$0,20) que, vendidos
// juntos, saem por um preço próprio do par (R$0,70). A venda do par grava DOIS
// `OrderItem` com o preço RATEADO — é o que mantém estoque, cancelamento e
// devolução funcionando sem alteração (todos percorrem os itens, e o par são
// dois itens de verdade). Estas funções puras fazem o rateio e a trava de estoque.

/** Um lado do par: preço avulso e saldo em estoque. */
export interface PairSide {
  salePrice: number;
  stockQty: number;
}

/** O valor a cobrar de cada lado do par, já rateado. */
export interface PairSplit {
  /** Preço unitário do produto principal (o que tem o par cadastrado). */
  mainUnitPrice: number;
  /** Preço unitário do produto agregado. */
  pairedUnitPrice: number;
}

/**
 * Rateia o **preço total do par** entre os dois produtos, proporcionalmente ao preço
 * avulso de cada um. Ex.: parafuso R$0,60 + bucha R$0,20 (soma R$0,80) num par de
 * R$0,70 ⇒ parafuso R$0,5250 e bucha R$0,1750.
 *
 * O **resíduo do arredondamento vai para o item mais caro**, então
 * `mainUnitPrice + pairedUnitPrice` é **sempre exatamente** `pairPrice` — o total da
 * venda nunca fica um centavo fora por causa do rateio.
 *
 * Casos de borda: se a soma dos avulsos for 0 (produtos de preço zero), divide o par
 * meio a meio — nunca divide por zero. Precisão de 4 casas, igual a `unitPrice` no schema.
 */
export function splitPairPrice(main: PairSide, paired: PairSide, pairPrice: number): PairSplit {
  const sum = main.salePrice + paired.salePrice;
  // Sem referência de proporção (ambos zerados): meio a meio.
  const mainShare = sum > 0 ? main.salePrice / sum : 0.5;

  // Arredonda o lado MAIS BARATO e deixa o resto para o mais caro: o erro relativo do
  // arredondamento fica no valor que melhor o absorve, e a soma fecha exata.
  const mainIsCheaper = main.salePrice <= paired.salePrice;
  if (mainIsCheaper) {
    const mainUnitPrice = Number((pairPrice * mainShare).toFixed(4));
    return { mainUnitPrice, pairedUnitPrice: Number((pairPrice - mainUnitPrice).toFixed(4)) };
  }
  const pairedUnitPrice = Number((pairPrice * (1 - mainShare)).toFixed(4));
  return { mainUnitPrice: Number((pairPrice - pairedUnitPrice).toFixed(4)), pairedUnitPrice };
}

/**
 * Rateio do par **para uma linha de venda com quantidade N** — é este o que o PDV deve usar
 * ao montar o pedido.
 *
 * `splitPairPrice` acerta o preço de **1** par, mas o servidor calcula o total de cada linha
 * como `round(quantity × unitPrice, 2)` (`calcSaleItemTotal`), e os dois arredondamentos podem
 * subir juntos: 5 pares de R$0,70 dariam 5×0,5250 = 2,625 → **2,63** e 5×0,1750 = 0,875 →
 * **0,88**, somando **R$3,51** em vez de R$3,50 (bug encontrado no E2E de 2026-07-20).
 *
 * Aqui o rateio é feito sobre o **total da linha**: arredonda-se o lado principal a 2 casas e o
 * outro recebe a diferença, de modo que os dois totais somem exatamente `pairPrice × quantity`.
 * O resíduo do arredondamento do preço unitário a 4 casas (limite do schema) é reconferido
 * refazendo a conta do servidor e jogado no lado mais caro, que o absorve melhor.
 *
 * **Limite conhecido (aceito):** o preço unitário tem 4 casas (`Decimal(12,4)`), então em
 * quantidades altas cada passo de 0,0001 move o total da linha em mais de um centavo e pode não
 * existir combinação que feche exato — ex.: 105 pares de R$0,70 fecham em R$73,51, um centavo
 * acima. A diferença é **sempre ≤ R$0,01 por linha**, e o PDV calcula o total do carrinho com
 * ESTES mesmos valores (via `cartToSaleItems`), então o que o operador vê é o que o servidor
 * cobra — nunca há "pagamento insuficiente". Fechar sempre exato exigiria usar o `discount` da
 * linha como resíduo, poluindo o significado de desconto nos relatórios; não compensa.
 */
export function splitPairLine(
  main: PairSide,
  paired: PairSide,
  pairPrice: number,
  quantity: number,
): PairSplit {
  const qty = quantity > 0 ? quantity : 1;
  const round2 = (n: number) => Number(n.toFixed(2));
  const round4 = (n: number) => Number(n.toFixed(4));

  const pairTotal = round2(pairPrice * qty);
  const sum = main.salePrice + paired.salePrice;
  const share = sum > 0 ? main.salePrice / sum : 0.5;

  const mainTotal = round2(pairTotal * share);
  const pairedTotal = round2(pairTotal - mainTotal);
  let mainUnitPrice = round4(mainTotal / qty);
  let pairedUnitPrice = round4(pairedTotal / qty);

  // Refaz a conta do servidor: se o arredondamento a 4 casas do unitário mudou o total da
  // linha (acontece quando total ÷ qty é dízima), a diferença vai para o lado mais caro.
  const effMain = round2(mainUnitPrice * qty);
  const effPaired = round2(pairedUnitPrice * qty);
  const diff = round2(pairTotal - (effMain + effPaired));
  if (diff !== 0) {
    if (main.salePrice >= paired.salePrice) {
      mainUnitPrice = round4((effMain + diff) / qty);
    } else {
      pairedUnitPrice = round4((effPaired + diff) / qty);
    }
  }
  return { mainUnitPrice, pairedUnitPrice };
}

/** Configuração do par num produto (subconjunto de `Product`, ADR-015). */
export interface PairConfig {
  /** Id do produto agregado. `null`/ausente = produto sem par. */
  pairedProductId?: string | null;
  /** Preço TOTAL do par (não por item). */
  pairPrice?: number | null;
}

/**
 * `true` quando o produto TEM par vendável: precisa de `pairedProductId` e `pairPrice > 0`
 * (os dois juntos). É o gate que o PDV usa para decidir se oferece "avulso × par".
 * Não verifica estoque nem se o agregado existe — isso é `pairAvailableQty`/quem chama.
 */
export function hasPair(p: PairConfig): boolean {
  return !!p.pairedProductId && p.pairPrice != null && p.pairPrice > 0;
}

/**
 * Quantos **pares** podem ser vendidos com o estoque atual: o par consome 1 de cada lado,
 * então é o **menor** dos dois saldos (nunca negativo). É a trava do PDV — vender o par
 * exige estoque dos dois produtos, senão a venda deixaria um lado negativo.
 */
export function pairAvailableQty(main: PairSide, paired: PairSide): number {
  return Math.max(0, Math.min(main.stockQty, paired.stockQty));
}

/** Item de pedido como vem do banco, no mínimo necessário para exibir (ADR-015). */
export interface PairableItem {
  productName: string;
  quantity: number | string;
  total: number | string;
  /** Agrupamento do par; itens com o mesmo valor não-nulo foram vendidos juntos. */
  pairGroup?: number | null;
}

/** Linha pronta para exibir/imprimir: um item avulso, ou um par já unificado. */
export interface DisplayLine {
  /** "Parafuso nº10" ou "Parafuso nº10 + Bucha nº10". */
  label: string;
  quantity: number;
  /** Soma dos totais das linhas agrupadas (o valor cobrado pelo par). */
  total: number;
  /** `true` quando a linha representa um par (dois produtos). */
  isPair: boolean;
}

/**
 * Agrupa os itens de um pedido para **exibição**, unindo os que foram vendidos como par
 * numa **linha só** — "Parafuso nº10 + Bucha nº10 · R$ 0,70" (decisão do Owner no ADR-015:
 * mostrar duas linhas com preço rateado convida questionamento no balcão, já que comprado
 * separado o valor muda).
 *
 * Itens sem `pairGroup` saem como estão, **na ordem original**. Um `pairGroup` órfão (só um
 * item, o que não deveria acontecer) é tratado como item avulso — nunca esconde nada.
 * Não altera o pedido: é só a camada de apresentação; o banco segue com dois itens.
 */
export function groupPairedItems(items: PairableItem[]): DisplayLine[] {
  const lines: DisplayLine[] = [];
  // Posição da linha de cada grupo já iniciado, para juntar o segundo item no mesmo lugar.
  const groupLineIndex = new Map<number, number>();

  for (const item of items) {
    const qty = Number(item.quantity);
    const total = Number(item.total);
    const group = item.pairGroup;

    if (group == null) {
      lines.push({ label: item.productName, quantity: qty, total, isPair: false });
      continue;
    }
    const at = groupLineIndex.get(group);
    const line = at === undefined ? undefined : lines[at];
    if (at === undefined || !line) {
      groupLineIndex.set(group, lines.length);
      lines.push({ label: item.productName, quantity: qty, total, isPair: false });
    } else {
      lines[at] = {
        label: `${line.label} + ${item.productName}`,
        quantity: line.quantity,
        total: Number((line.total + total).toFixed(2)),
        isPair: true,
      };
    }
  }
  return lines;
}

// =============================================================================
// BUSCA DE PRODUTO (Product search) — cadastro e PDV
// =============================================================================

/** Campos pelos quais um produto é localizável na busca (cadastro e PDV). */
export interface ProductSearchFields {
  name: string;
  popularName?: string | null;
  manufacturer?: string | null;
  sku: string;
  /// Código de barras GTIN (ADR-025), opcional. Entra na busca para que ler/digitar o EAN
  /// encontre o produto — o `sku` costuma ser o código interno, não o de barras.
  ean?: string | null;
}

/**
 * Normaliza texto para busca: minúsculas, sem acentos e sem espaços nas pontas.
 * Assim "Cimento", "cimento" e "címento" casam igual — essencial em português.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD') // separa letra + acento (ex.: "á" → "a" + combinante)
    .replace(/\p{Diacritic}/gu, '') // remove os diacríticos combinantes
    .toLowerCase()
    .trim();
}

/**
 * `true` se o produto casa com a busca por **nome oficial, nome popular, fabricante,
 * SKU OU código de barras (EAN)** (digitar qualquer um encontra o produto). Acento- e
 * caixa-insensível.
 *
 * **Busca tokenizada (AND, ordem-livre)** — como os buscadores de mercado: a query é quebrada
 * em palavras e o produto casa quando **CADA** palavra aparece (como substring) em algum dos
 * campos. Assim "Luva 40" acha "Luva ESG 40mm" e "40 luva" também — a ordem não importa, e as
 * palavras podem cair em campos diferentes (ex.: marca + nome). Query vazia casa tudo (sem
 * filtro). Função pura reusada no cadastro (apps/web) e no PDV.
 */
export function productMatchesQuery(product: ProductSearchFields, query: string): boolean {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // sem termo digitado → não filtra nada
  // Concatena os campos num "palheiro" único (separados por espaço, pra uma palavra nunca
  // vazar de um campo pro outro) e exige que TODOS os tokens estejam presentes.
  const haystack = normalizeSearchText(
    [
      product.name,
      product.popularName ?? '',
      product.manufacturer ?? '',
      product.sku,
      product.ean ?? '',
    ].join(' '),
  );
  return tokens.every((token) => haystack.includes(token));
}

// =============================================================================
// ESTOQUE (Stock) — ADR-001
// =============================================================================

/** Tipo de movimentação de estoque. Espelha o enum `TransactionType` do schema. */
export type StockMovementType = 'INCOME' | 'EXPENSE';

export interface StockMovementLike {
  type: StockMovementType;
  quantity: number;
}

/**
 * Aplica uma movimentação sobre o estoque atual: INCOME soma, EXPENSE subtrai.
 * Retorna o novo saldo arredondado a 4 casas (mesma precisão de `Product.stockQty`).
 */
export function applyStockMovement(
  currentQty: number,
  type: StockMovementType,
  quantity: number,
): number {
  const delta = type === 'INCOME' ? quantity : -quantity;
  return Number((currentQty + delta).toFixed(4));
}

/**
 * Reconciliação de estoque (ADR-001): saldo = Σ INCOME − Σ EXPENSE.
 * Fonte de verdade auditável para corrigir divergências no cache `Product.stockQty`.
 */
export function reconcileStock(movements: StockMovementLike[]): number {
  const total = movements.reduce(
    (acc, m) => acc + (m.type === 'INCOME' ? m.quantity : -m.quantity),
    0,
  );
  return Number(total.toFixed(4));
}

/**
 * Traduz uma contagem de inventário no movimento necessário para chegar nela.
 * Ex: estoque atual 10, contado 7 → EXPENSE de 3; contado 12 → INCOME de 2.
 * `quantity` 0 indica que a contagem já bate (nenhum movimento necessário).
 */
export function calcInventoryAdjustment(
  currentQty: number,
  countedQty: number,
): { type: StockMovementType; quantity: number } {
  const delta = Number((countedQty - currentQty).toFixed(4));
  return {
    type: delta >= 0 ? 'INCOME' : 'EXPENSE',
    quantity: Math.abs(delta),
  };
}

/** Saldo e mínimo de um produto — base do painel de reposição (EF-2). */
export interface StockLevelFields {
  stockQty: number;
  minStockQty: number;
}

/**
 * `true` quando o produto tem **mínimo definido** (`minStockQty > 0`) e o saldo está
 * **igual ou abaixo** dele — a regra canônica de "estoque baixo" (ADR-001, ponto de reposição).
 * Produtos sem mínimo (0) NÃO disparam alerta: o lojista opta por rastrear definindo o mínimo.
 * Função pura reusada na tela de Estoque (badge, painel de reposição) e no PDV.
 */
export function isLowStock(item: StockLevelFields): boolean {
  return item.minStockQty > 0 && item.stockQty <= item.minStockQty;
}

/**
 * `true` quando o produto precisa de atenção de reposição: está **zerado** (saldo ≤ 0,
 * MESMO sem mínimo definido) **ou** está **baixo** pela regra do mínimo (`isLowStock`).
 * Um item zerado é ruptura de venda por si só — não dá para vender — então entra no alerta
 * independentemente de o lojista ter cadastrado o mínimo (Opção 1: "zerado sempre é crítico").
 * `isLowStock` continua sendo a regra estrita do ponto de reposição (reusada no PDV); esta é
 * a regra das superfícies de alerta da tela de Estoque (painel de reposição + filtro "Só baixo").
 */
export function needsReplenishment(item: StockLevelFields): boolean {
  return item.stockQty <= 0 || isLowStock(item);
}

/**
 * Quanto comprar para o saldo voltar ao mínimo (`minStockQty − stockQty`, nunca negativo).
 * Retorna 0 quando o item não está baixo (nada a repor). Arredondado a 4 casas (precisão de
 * `Product.stockQty`, cobre kg/m² fracionados). Sugestão de compra do painel de reposição.
 */
export function replenishmentShortfall(item: StockLevelFields): number {
  if (!isLowStock(item)) return 0;
  return Number((item.minStockQty - item.stockQty).toFixed(4));
}

// =============================================================================
// RETIRADA / ENTREGA FUTURA (ADR-020) — reserva agora, baixa parcial na retirada
// =============================================================================
//
// Eixo ortogonal ao fiado (ADR-019, que adia o PAGAMENTO): aqui adiamos a SAÍDA da
// mercadoria. Na venda SCHEDULED a quantidade fica RESERVADA (sem baixa); a baixa real
// de estoque (ADR-001) dispara na RETIRADA, que é PARCIAL (item a item). Tudo em
// UNIDADE-BASE (a mesma de `stockQty`/`baseQuantity`). O paralelo com o fiado é direto:
// `remainingToDeliver` ≡ `receivableBalance`, `isValidDelivery` ≡ `isValidReceipt`,
// `applyItemDelivery` ≡ `applyReceivablePayment`.

/** Converte uma quantidade em "unidades de 4 casas" inteiras — evita erro de ponto
 * flutuante ao comparar quantidades (mesma ideia do `toCents`, na precisão do estoque). */
function toQtyUnits(value: number): number {
  return Math.round(value * 10000);
}

/**
 * Disponível para venda (ADR-020): `stockQty − reservedQty`, nunca negativo. O PDV trava
 * por aqui — mercadoria reservada (vendida num pedido SCHEDULED e ainda não retirada) não
 * pode ser vendida de novo. Em unidade-base (mesma de `stockQty`).
 */
export function availableQty(stockQty: number, reservedQty: number): number {
  return Number(Math.max(0, stockQty - reservedQty).toFixed(4));
}

/**
 * Quanto (em unidade-base) ainda falta sair de UMA linha de pedido SCHEDULED:
 * `baseQuantity − deliveredBaseQty`, nunca negativo (tudo retirado ⇒ 0). Espelha o
 * `receivableBalance` do fiado. Fonte única do "falta X" por item.
 */
export function remainingToDeliver(baseQuantity: number, deliveredBaseQty: number): number {
  return Number(Math.max(0, baseQuantity - deliveredBaseQty).toFixed(4));
}

/**
 * Uma retirada (parcial ou total) de uma linha é válida se for **positiva** e **não
 * exceder o que falta** entregar. Comparação em unidades × 10^4 p/ não tropeçar em
 * arredondamento. Espelha `isValidReceipt`. Reusada no servidor e na UI.
 */
export function isValidDelivery(qty: number, remaining: number): boolean {
  const units = toQtyUnits(qty);
  return units > 0 && units <= toQtyUnits(remaining);
}

/**
 * Aplica uma retirada a uma linha e devolve o novo total retirado e se a linha ficou
 * **completa** (`≥` tolera arredondamento). Não valida (ver `isValidDelivery`) — assume uma
 * retirada já aceita. Espelha `applyReceivablePayment`; fonte única da transição por linha.
 */
export function applyItemDelivery(
  baseQuantity: number,
  deliveredBaseQty: number,
  qty: number,
): { deliveredBaseQty: number; fullyDelivered: boolean } {
  const newDelivered = Number((deliveredBaseQty + qty).toFixed(4));
  const fullyDelivered = toQtyUnits(newDelivered) >= toQtyUnits(baseQuantity);
  return { deliveredBaseQty: newDelivered, fullyDelivered };
}

/** Uma linha de pedido para fins de retirada (ADR-020), em unidade-base. */
export interface DeliverableLine {
  baseQuantity: number;
  deliveredBaseQty: number;
}

/**
 * Deriva a situação de retirada de um pedido SCHEDULED a partir das suas linhas (ADR-020):
 * `COMPLETED` quando **toda** a mercadoria já saiu, `PENDING` quando **nada** saiu, e
 * `PARTIAL` no meio. Cache derivado (ADR-001) — a API grava `Order.fulfillmentStatus`, mas
 * a verdade são as linhas. Pedido sem linhas (defensivo) ⇒ `COMPLETED` (nada a entregar).
 */
export function orderFulfillmentStatus(
  lines: DeliverableLine[],
): 'PENDING' | 'PARTIAL' | 'COMPLETED' {
  let anyDelivered = false;
  let anyRemaining = false;
  for (const l of lines) {
    if (toQtyUnits(l.deliveredBaseQty) > 0) anyDelivered = true;
    if (toQtyUnits(remainingToDeliver(l.baseQuantity, l.deliveredBaseQty)) > 0) anyRemaining = true;
  }
  if (!anyRemaining) return 'COMPLETED';
  return anyDelivered ? 'PARTIAL' : 'PENDING';
}

/**
 * Reconciliação do reservado de um produto (ADR-020), no espírito do `reconcileStock`: soma
 * o que **ainda falta sair** de todas as linhas de pedidos SCHEDULED não cancelados daquele
 * produto. Fonte de verdade p/ corrigir o cache `Product.reservedQty` (que o PDV usa no
 * disponível). Passe apenas linhas de pedidos com mercadoria pendente.
 */
export function reconcileReserved(lines: DeliverableLine[]): number {
  const total = lines.reduce(
    (acc, l) => acc + remainingToDeliver(l.baseQuantity, l.deliveredBaseQty),
    0,
  );
  return Number(total.toFixed(4));
}

// =============================================================================
// RELATÓRIOS (Reports) — vendas por período e formas de pagamento
// =============================================================================

/**
 * Ticket médio = faturamento ÷ nº de vendas. Retorna 0 quando não há vendas
 * (evita divisão por zero). Arredondado a 2 casas para exibição.
 */
export function calcAverageTicket(totalRevenue: number, salesCount: number): number {
  if (salesCount <= 0) return 0;
  return Number((totalRevenue / salesCount).toFixed(2));
}

/** Total agregado por forma de pagamento (entrada crua vinda do groupBy). */
export interface PaymentMethodTotal {
  method: string;
  total: number;
  count: number;
}

/** Forma de pagamento com sua participação percentual no total recebido. */
export interface PaymentMethodShare extends PaymentMethodTotal {
  /** Participação no total recebido, em % (2 casas). 0 quando o total é 0. */
  share: number;
}

/**
 * Enriquece a quebra por forma de pagamento com a participação percentual de
 * cada uma no total recebido e ordena da maior para a menor. Função pura: a
 * soma por método já vem agregada do banco (cost-zero); aqui só derivamos o %.
 */
export function withPaymentShare(rows: PaymentMethodTotal[]): PaymentMethodShare[] {
  const grandTotal = rows.reduce((acc, r) => acc + r.total, 0);
  return rows
    .map((r) => ({
      ...r,
      share: grandTotal > 0 ? Number(((r.total / grandTotal) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Agregados brutos de um recorte (produto, cliente, período), já somados no banco. */
export interface ProfitInput {
  /** Faturamento total do recorte (Σ dos totais das linhas) — inclui vendas sem custo. */
  totalRevenue: number;
  /** Faturamento SÓ das linhas com custo carimbado (`unitCost != null`) — base honesta da margem. */
  coveredRevenue: number;
  /** Custo total das linhas cobertas: Σ (`unitCost` × quantidade-base). */
  coveredCost: number;
}

/** Lucro bruto e margem de um recorte, com a cobertura de custo (ADR-027, Fatia 2). */
export interface ProfitResult {
  /** Lucro bruto = `coveredRevenue − coveredCost`. Só sobre as linhas COM custo (nunca infla). */
  grossProfit: number;
  /** Margem % sobre a receita coberta (`grossProfit / coveredRevenue × 100`). 0 se não há receita coberta. */
  marginPercent: number;
  /** Fração do faturamento com custo (`coveredRevenue / totalRevenue`), 0..1. `< 1` ⇒ margem parcial. */
  costCoverage: number;
}

/**
 * Lucro bruto e margem de um recorte (produto, cliente, período) a partir dos agregados do banco.
 * ADR-027: só as vendas COM custo carimbado entram no lucro/margem — vendas antigas sem custo NÃO
 * são contadas como custo zero (que inflaria o lucro); ficam sinalizadas por `costCoverage < 1`.
 * Função pura (Regra 2), testada com Vitest. O caller agrega no banco (cost-zero) e só deriva aqui.
 */
export function calcProfit({ totalRevenue, coveredRevenue, coveredCost }: ProfitInput): ProfitResult {
  const grossProfit = Number((coveredRevenue - coveredCost).toFixed(2));
  const marginPercent =
    coveredRevenue > 0 ? Number(((grossProfit / coveredRevenue) * 100).toFixed(2)) : 0;
  const costCoverage =
    totalRevenue > 0 ? Number((coveredRevenue / totalRevenue).toFixed(4)) : 0;
  return { grossProfit, marginPercent, costCoverage };
}

/**
 * Janela ANTERIOR equivalente a `[from, to]` (Relatórios v2, Fatia 4). Devolve o intervalo do mesmo
 * tamanho imediatamente antes de `from`: "Hoje" (1 dia) → ontem; "7 dias" → os 7 dias anteriores;
 * "30 dias" → os 30 anteriores. Datas `AAAA-MM-DD`; conta em UTC (dia cheio, sem fuso) para não
 * escorregar um dia. Função pura, testada (Regra 2).
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const DAY = 86_400_000;
  // Meia-noite UTC do dia (dia cheio, sem fuso). Entrada validada como AAAA-MM-DD pelo schema.
  const ymdToUtc = (d: string): number => {
    const [y, m, day] = d.split('-');
    return Date.UTC(Number(y), Number(m) - 1, Number(day));
  };
  const fromMs = ymdToUtc(from);
  const toMs = ymdToUtc(to);
  const dayCount = Math.round((toMs - fromMs) / DAY) + 1; // inclusivo
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: fmt(fromMs - dayCount * DAY), to: fmt(fromMs - DAY) };
}

/** Variação de um KPI entre o período atual e o anterior (Fatia 4). */
export interface Variation {
  /** Diferença absoluta `atual − anterior` (2 casas). */
  delta: number;
  /** Variação percentual sobre |anterior|; `null` quando o anterior é 0 (não há base — exibir "—"). */
  percent: number | null;
  /** Direção da variação, para a seta ▲/▼/●. */
  direction: 'up' | 'down' | 'flat';
}

/**
 * Compara um KPI com o período anterior (Fatia 4). O percentual usa `|anterior|` como base para o
 * sinal seguir o `delta` (mesmo com base negativa, ex.: lucro). Anterior 0 ⇒ `percent = null` (evita
 * ÷0; a UI mostra "—"). Função pura, testada (Regra 2).
 */
export function calcVariation(current: number, previous: number): Variation {
  const delta = Number((current - previous).toFixed(2));
  const percent = previous !== 0 ? Number(((delta / Math.abs(previous)) * 100).toFixed(1)) : null;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  return { delta, percent, direction };
}

/** Projeção de faturamento do mês "no ritmo atual" (Fatia 8) — run-rate. */
export interface MonthRunRate {
  /** Média diária realizada = `realized / daysElapsed` (0 se nenhum dia decorreu). */
  dailyAverage: number;
  /** Projeção do mês inteiro no ritmo atual = `dailyAverage × daysInMonth` (2 casas). */
  projected: number;
}

/**
 * Projeção de faturamento do mês por run-rate (Fatia 8): média diária do realizado × dias do mês.
 * É DIRECIONAL ("no ritmo atual"), não promessa. `daysElapsed ≤ 0` ⇒ tudo 0 (sem base). Função pura,
 * testada (Regra 2). O caller agrega o realizado no banco e passa os dias.
 */
export function calcMonthRunRate(
  realized: number,
  daysElapsed: number,
  daysInMonth: number,
): MonthRunRate {
  if (daysElapsed <= 0) return { dailyAverage: 0, projected: 0 };
  const dailyAverage = Number((realized / daysElapsed).toFixed(2));
  const projected = Number((dailyAverage * daysInMonth).toFixed(2));
  return { dailyAverage, projected };
}

/**
 * Dias até o estoque ESGOTAR no ritmo de saída atual (Fatia 8): `stockQty / velocidadeDiária`.
 * `velocidade ≤ 0` (não vende) ⇒ `null` (não rompe). `stockQty ≤ 0` (já zerado/negativo) ⇒ 0.
 * Direcional ("no ritmo atual"). Função pura, testada (Regra 2). Arredonda a 1 casa.
 */
export function calcDaysToStockout(stockQty: number, dailyVelocity: number): number | null {
  if (dailyVelocity <= 0) return null;
  if (stockQty <= 0) return 0;
  return Number((stockQty / dailyVelocity).toFixed(1));
}

/**
 * Mediana de uma lista de números (Fatia 8). Robusta a outliers — ao contrário da média, uma única
 * venda-bombástica não a distorce. Lista vazia ⇒ 0; par ⇒ média dos dois centrais. Função pura,
 * testada (Regra 2). Usada na velocidade de saída do estoque (mediana do consumo diário).
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const a = sorted[mid] ?? 0;
  if (sorted.length % 2 !== 0) return a;
  const b = sorted[mid - 1] ?? 0;
  return (a + b) / 2;
}

// =============================================================================
// SINCRONIZAÇÃO OFFLINE (Outbox) — ADR-011
// =============================================================================
//
// Máquina de estados PURA da fila de sync (funções `(entrada) => saída`, sem I/O). O worker no
// cliente (apps/web) faz o I/O (IndexedDB + fetch) e delega TODA a decisão a estas funções, que
// são testadas com Vitest (CLAUDE.md). Regras (ADR-011 §5–6): drenar em FIFO, **parar na 1ª falha
// dura** (não reordenar/pular) e re-tentar só falhas transitórias com backoff.

/**
 * Desfecho de uma tentativa de sincronizar um item da fila:
 * - `SYNCED`: aplicado no servidor (ou já estava — dedup idempotente). Remover da fila.
 * - `RETRY`: falha transitória (rede/servidor 5xx). Manter na fila e re-tentar depois.
 * - `FAILED`: falha dura (4xx — payload inválido, dependência ausente). Parar a fila; exige atenção.
 */
export type SyncOutcome = 'SYNCED' | 'RETRY' | 'FAILED';

/** Máximo de tentativas antes de um item transitório virar falha dura (evita loop infinito). */
export const MAX_SYNC_ATTEMPTS = 5;

/**
 * Classifica o resultado HTTP de um envio da fila. Idempotência (ADR-011 §2): **409 = já aplicado**
 * (a PK já existia) → tratamos como `SYNCED`, não como erro. 2xx = aplicado agora. 5xx = servidor
 * transitório → `RETRY`. Demais 4xx = erro de cliente (payload/dependência) → `FAILED` (falha dura).
 */
export function classifyHttpOutcome(status: number): SyncOutcome {
  if (status === 409) return 'SYNCED'; // dedup: a venda já existe no servidor
  if (status >= 200 && status < 300) return 'SYNCED';
  if (status >= 500) return 'RETRY';
  return 'FAILED';
}

/**
 * Desfecho quando o próprio `fetch` falhou (sem resposta HTTP): offline/DNS/timeout. É sempre
 * transitório — a rede volta — então `RETRY` (a fila drena de novo no próximo gatilho `online`).
 */
export function classifyNetworkError(): SyncOutcome {
  return 'RETRY';
}

/**
 * Dado o desfecho e quantas tentativas o item JÁ acumulou (antes desta), decide se ainda vale
 * re-tentar. Só `RETRY` re-tenta, e só enquanto não estourar `MAX_SYNC_ATTEMPTS` — depois disso
 * o item transitório é promovido a falha dura (para não travar a fila para sempre).
 */
export function shouldRetry(outcome: SyncOutcome, attempts: number): boolean {
  return outcome === 'RETRY' && attempts < MAX_SYNC_ATTEMPTS;
}

/**
 * Backoff exponencial (ms) para a próxima tentativa a partir do nº de tentativas já feitas:
 * 1s, 2s, 4s, 8s… com teto de 30s. Puro e determinístico (sem jitter) para ser testável; o
 * jitter, se necessário, fica no worker.
 */
export function syncBackoffMs(attempts: number): number {
  const base = 1000 * 2 ** Math.max(0, attempts);
  return Math.min(base, 30000);
}

/**
 * `true` quando a fila deve **parar** de drenar após este desfecho — ou seja, tudo que não foi
 * `SYNCED`. Falha dura (`FAILED`) e transitória (`RETRY`) ambas param o avanço FIFO (ADR-011 §5:
 * não pular itens); a diferença é que `RETRY` volta a tentar no próximo gatilho e `FAILED` não.
 */
export function haltsQueue(outcome: SyncOutcome): boolean {
  return outcome !== 'SYNCED';
}

// =============================================================================
// PREÇO E MARGEM POR FORMA DE PAGAMENTO (ADR-016)
// =============================================================================
// Dois mecanismos INDEPENDENTES, propositalmente não acoplados:
//
//  1. ACRÉSCIMO por produto (`surchargeDebit`/`surchargeCredit`) — opt-in, em R$ por
//     unidade-base. É o único que MUDA O PREÇO cobrado do cliente. Vazio ⇒ preço normal.
//  2. TAXA da maquininha por loja (`cardFee*Percent`) — em %, usada só para exibir a
//     MARGEM REAL. Nunca altera preço.
//
// Decisão do Owner: o preço do cartão NÃO é derivado da taxa. Só sobe o preço de quem ele
// marcar no cadastro. Ver docs/adr/ADR-016-preco-e-margem-por-forma-de-pagamento.md.

/** Formas de pagamento que o PDV oferece (espelha `paymentMethodSchema` de shared). */
export type PaymentMethodCode = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'PIX';

/** Acréscimos cadastrados num produto. Nulos ⇒ o produto não acresce nada. */
export interface SurchargeConfig {
  surchargeDebit?: number | null;
  surchargeCredit?: number | null;
}

/** Taxas da maquininha cadastradas na loja. Nulas ⇒ margem exibida sem desconto de taxa. */
export interface CardFeeConfig {
  cardFeeDebitPercent?: number | null;
  cardFeeCreditPercent?: number | null;
}

/**
 * Acréscimo em R$ por **unidade-base** para a forma de pagamento escolhida.
 * `CASH` e `PIX` nunca acrescem (retornam 0), e valores negativos são ignorados — o campo é
 * "quanto o preço SOBE"; desconto por forma de pagamento é outra coisa e não está no escopo.
 */
export function surchargePerBaseUnit(p: SurchargeConfig, method: PaymentMethodCode): number {
  const raw =
    method === 'DEBIT_CARD'
      ? p.surchargeDebit
      : method === 'CREDIT_CARD'
        ? p.surchargeCredit
        : null;
  // Coerção defensiva: os valores vêm do Prisma como `Decimal` e chegam ao cliente como
  // **string** (JSON). Sem `Number(...)`, `raw.toFixed` estouraria ("... is not a function").
  const n = raw == null ? 0 : Number(raw);
  if (!(n > 0)) return 0;
  return Number(n.toFixed(4));
}

/**
 * Acréscimo em R$ por **unidade vendida**, já composto com a embalagem fechada (EF-3, ADR-013).
 *
 * O acréscimo é cadastrado na unidade-base; vendendo a embalagem ele é aplicado
 * **proporcionalmente** (`× conversionFactor`), porque a taxa do cartão que ele repassa incide
 * sobre o valor da venda: um rolo de 100 m com R$0,02/m sobe R$2,00, não R$0,02. Um acréscimo
 * fixo por linha faria o rolo de R$150 subir o mesmo que 1 metro de R$2.
 */
export function resolveSurcharge(
  p: AltUnitConfig & SurchargeConfig,
  method: PaymentMethodCode,
  mode: SaleUnitMode,
): number {
  const perBase = surchargePerBaseUnit(p, method);
  if (perBase === 0) return 0;
  const { factorToBase } = resolveSaleUnit(p, mode);
  return Number((perBase * factorToBase).toFixed(4));
}

/**
 * Preço a cobrar por 1 unidade vendida na forma de pagamento escolhida = preço do modo
 * (`resolveSaleUnit`) + acréscimo do modo. **É esta função que o PDV e o carrinho usam** — o
 * `unitPrice` enviado no pedido já sai daqui, embutido (ADR-016: sem linha de acréscimo à parte,
 * o que mantém estoque/cancelamento/devolução/caixa intocados).
 */
export function priceForPaymentMethod(
  p: AltUnitConfig & SurchargeConfig,
  method: PaymentMethodCode,
  mode: SaleUnitMode,
): number {
  const { unitPrice } = resolveSaleUnit(p, mode);
  return Number((unitPrice + resolveSurcharge(p, method, mode)).toFixed(4));
}

/**
 * Preço TOTAL do par (ADR-015) na forma de pagamento escolhida: `pairPrice` + o acréscimo dos
 * **dois** lados (cada par consome 1 de cada produto, então os dois acréscimos incidem).
 *
 * Deve ser aplicado **antes** do rateio do `splitPairLine` — assim a soma dos dois `OrderItem`
 * continua fechando exata no centavo, que é a propriedade que o bug PA.1 ensinou a proteger.
 * O par é sempre na unidade-base, então não há fator de embalagem aqui.
 */
export function pairPriceForPaymentMethod(
  main: SurchargeConfig,
  paired: SurchargeConfig,
  pairPrice: number,
  method: PaymentMethodCode,
): number {
  const extra = surchargePerBaseUnit(main, method) + surchargePerBaseUnit(paired, method);
  return Number((pairPrice + extra).toFixed(4));
}

/** Taxa da maquininha (%) da forma de pagamento. `CASH`/`PIX` ⇒ 0; não cadastrada ⇒ 0. */
export function cardFeePercentFor(t: CardFeeConfig, method: PaymentMethodCode): number {
  const raw =
    method === 'DEBIT_CARD'
      ? t.cardFeeDebitPercent
      : method === 'CREDIT_CARD'
        ? t.cardFeeCreditPercent
        : null;
  // Coerção defensiva: a taxa vem do Prisma como `Decimal` e chega ao cliente como **string**
  // (JSON). Sem `Number(...)`, `raw.toFixed` estouraria ("... is not a function") — foi o que
  // derrubava o painel de produto quando a loja tinha taxa da maquininha cadastrada.
  const n = raw == null ? 0 : Number(raw);
  if (!(n > 0)) return 0;
  return Number(n.toFixed(2));
}

/**
 * Margem **real** em % — o que sobra depois de a maquininha cobrar a dela.
 *
 * `(preço − taxa − custo) ÷ preço`, com a taxa incidindo sobre o preço efetivamente cobrado
 * (que já inclui o acréscimo, se houver). Com `feePercent = 0` é idêntica a `calcMarginPercent`,
 * então a exibição de sempre continua valendo para dinheiro/PIX e para lojas sem taxa cadastrada.
 * Pode ser **negativa** — e é justamente aí que ela ganha o seu sustento: avisar que a venda no
 * crédito dá prejuízo. Retorna 0 se o preço for <= 0. Arredondada a 2 casas.
 */
export function netMarginPercent(
  costPrice: number,
  unitPrice: number,
  feePercent: number,
): number {
  if (unitPrice <= 0) return 0;
  const fee = (unitPrice * feePercent) / 100;
  return Number((((unitPrice - fee - costPrice) / unitPrice) * 100).toFixed(2));
}

// =============================================================================
// Conversão de unidade comercial na importação de NF-e (ADR-025 §5.B, Fatia 2.B)
// -----------------------------------------------------------------------------
// A nota traz quantidade/custo na unidade COMERCIAL do fornecedor (`qCom`/`vUnCom`, ex.: 2 CX a
// R$ 60/CX), mas a loja vende em outra unidade (ex.: UN). O FATOR de embalagem (quantas unidades de
// venda cabem numa unidade comercial) converte os dois: quantidade multiplica, custo unitário divide.
// Funções puras — reusadas na sugestão automática (a nota também traz a unidade tributável) e no
// cálculo ao vivo do De-Para. NÃO persistem o fator (decisão do Owner: vale só para esta importação).
// =============================================================================

/**
 * Sugere o fator de embalagem pela própria nota: `qTrib ÷ qCom`. Em muitas NF-e a quantidade
 * TRIBUTÁVEL já está na unidade de venda (2 CX comercial → 24 UN tributável ⇒ fator 12). Só devolve
 * um fator "limpo" — inteiro dentro de tolerância e ≥ 1; qualquer coisa fora disso (nota não ajuda,
 * unidades iguais, quantidade zerada) devolve **1** (sem conversão), e o operador ajusta à mão.
 */
export function suggestNfeFactor(qCom: number, qTrib: number): number {
  if (!(qCom > 0) || !(qTrib > 0)) return 1;
  const factor = qTrib / qCom;
  if (factor < 1) return 1; // tributável menor que a comercial → não é embalagem múltipla
  const rounded = Math.round(factor);
  return Math.abs(factor - rounded) <= 0.01 ? rounded : 1;
}

/**
 * Quantidade que ENTRA no estoque, na unidade de venda: `qCom × fator` (ex.: 2 CX × 12 = 24 UN).
 * Fator inválido (≤ 0) é tratado como 1 (sem conversão). Arredonda a 4 casas, como o resto do estoque.
 */
export function nfeConvertedQuantity(qCom: number, factor: number): number {
  const f = factor > 0 ? factor : 1;
  return Number((qCom * f).toFixed(4));
}

/**
 * Custo por unidade de VENDA: `vUnCom ÷ fator` (ex.: R$ 60,00/CX ÷ 12 = R$ 5,00/UN). Vira o "último
 * custo" do cadastro. Fator inválido (≤ 0) é tratado como 1. Arredonda a 4 casas (precisão de custo).
 */
export function nfeConvertedUnitCost(vUnCom: number, factor: number): number {
  const f = factor > 0 ? factor : 1;
  return Number((vUnCom / f).toFixed(4));
}
