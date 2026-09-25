import { z } from 'zod';
import type { UnitType } from './product';

/**
 * Schemas e tipos dos relatórios de vendas e caixa (Fase 2).
 * O intervalo é opcional: sem `from`/`to`, o relatório cobre todo o histórico.
 * Datas no formato YYYY-MM-DD (o servidor aplica as bordas do dia no fuso da loja).
 */

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.');

export const reportRangeSchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});
export type ReportRange = z.infer<typeof reportRangeSchema>;

/** Quebra de faturamento por forma de pagamento. */
export interface PaymentMethodReport {
  method: string;
  total: number;
  count: number;
  /** Participação no total recebido, em % (2 casas). */
  share: number;
}

/** Resumo de vendas do período (canceladas fora dos totais, contadas à parte). */
export interface SalesReport {
  from: string | null;
  to: string | null;
  /**
   * **Recebido no período** — regime de caixa (ADR-019): dinheiro que efetivamente entrou =
   * pagamentos à vista das vendas do período + recebimentos de fiado do período (pela data do
   * recebimento). A parte a prazo de uma venda só conta quando é recebida.
   * ADR-037: é LÍQUIDO de estornos — `grossRevenue − returnsTotal` (o dinheiro que voltou ao cliente
   * nas devoluções das vendas do período sai daqui, na forma em que voltou).
   */
  totalRevenue: number;
  /** Entradas antes dos estornos (ADR-037): pagamentos das vendas do período + recebimentos de fiado. */
  grossRevenue: number;
  /**
   * **Estornos** (ADR-037): dinheiro que VOLTOU ao cliente nas devoluções das vendas do período
   * (dinheiro da gaveta + estorno no cartão/PIX), atribuído ao dia da venda (como a devolução total,
   * ADR-036). Crédito na loja e abatimento de dívida NÃO entram (não são dinheiro devolvido — ver
   * `returnsToCredit`/`returnsToDebt`). Trocas não entram (o valor vira vale).
   */
  returnsTotal: number;
  /** Mantido por compatibilidade (ADR-035): desde a ADR-037 é igual a `totalRevenue`. */
  netRevenue: number;
  /** Devoluções das vendas do período que viraram CRÉDITO na loja (informativo; não sai do Recebido). */
  returnsToCredit: number;
  /** Devoluções das vendas do período que ABATERAM dívida a prazo (informativo; nunca entrou como dinheiro). */
  returnsToDebt: number;
  /** Nº de vendas CONFIRMED no período (pela data da venda). */
  salesCount: number;
  /** Recebido (líquido de estornos, ADR-037) ÷ nº de vendas (0 se não houver vendas). */
  averageTicket: number;
  /** Nº de vendas canceladas no período (fora do recebido). */
  cancelledCount: number;
  /** Nº de trocas no período (ADR-036): `OrderReturn` com intent EXCHANGE. */
  exchangeCount: number;
  /** Nº de vendas totalmente devolvidas no período (ADR-036): status `RETURNED` (fora do faturamento). */
  returnedCount: number;
  /**
   * Informativo (ADR-019): total de vendas **a prazo geradas** no período (crédito concedido no
   * fiado). NÃO entra no recebido — é o que ficou a receber; conta como recebido conforme entra.
   * ADR-037: líquido do que foi devolvido (abatido da dívida).
   */
  creditSalesGenerated: number;
  /**
   * Total por forma de pagamento (à vista + recebimentos de fiado − estornos naquela forma, ADR-037).
   * Σ formas = recebido. Uma forma pode ficar negativa (ex.: cartão estornado em dinheiro).
   */
  byPaymentMethod: PaymentMethodReport[];
  /**
   * Lucro bruto ESTIMADO do período (Fatia 6, ADR-027): base de **mercadoria vendida** — receita
   * dos itens de vendas não canceladas do período − custo carimbado. Base DIFERENTE do "Recebido"
   * (que é regime de caixa): aqui é o resultado das vendas feitas no período, não o dinheiro que
   * entrou. Só as vendas COM custo entram (ver `costCoverage`), nunca como custo zero.
   */
  grossProfit: number;
  /** Margem % do lucro bruto sobre a receita coberta (0 se não há vendas com custo). */
  marginPercent: number;
  /** Fração da receita de mercadoria do período que tem custo carimbado (0..1). `< 1` ⇒ lucro parcial. */
  costCoverage: number;
  /**
   * Receita de mercadoria vendida no período (Σ itens, não canceladas) — a base do lucro/margem.
   * ADR-037: líquida dos itens devolvidos/trocados (valor e custo do que voltou saem da conta).
   */
  goodsRevenue: number;
  /**
   * KPIs do período ANTERIOR equivalente (Fatia 4), para os selos ▲/▼ nos cards. Só vem quando o
   * cliente pede `?compare=1` e há intervalo; `null` caso contrário (ex.: todo o histórico).
   */
  previous?: SalesComparison | null;
}

/** KPIs do período anterior equivalente (Fatia 4) — subconjunto comparável do `SalesReport`. */
export interface SalesComparison {
  /** Intervalo anterior calculado (`previousPeriod`), para exibir "semana anterior: …" etc. */
  from: string;
  to: string;
  totalRevenue: number;
  returnsTotal: number; // ADR-035
  netRevenue: number; // ADR-035
  salesCount: number;
  averageTicket: number;
  cancelledCount: number;
  grossProfit: number;
}

/** Uma sessão de caixa fechada, com a divergência calculada. */
export interface CashSessionReport {
  id: string;
  openedAt: string;
  closedAt: string;
  /** Nome de quem abriu o caixa (snapshot, ADR-010); `null` se não registrado. */
  openedByName: string | null;
  /** Nome de quem fechou o caixa (snapshot, ADR-010); `null` se não registrado. */
  closedByName: string | null;
  openingAmount: number;
  closingAmount: number;
  expectedAmount: number;
  /** Contado − esperado: positivo = sobra, negativo = falta. */
  divergence: number;
  notes: string | null;
  /** Vendas offline anexadas a este caixa DEPOIS do fechamento (CS-4, ADR-012 §b) —
   * marca de reconciliação. `0` quando não houve. */
  lateSalesCount: number;
  /** Soma (total) das vendas anexadas após o fechamento (reconciliação, CS-4). */
  lateSalesTotal: number;
  /** Parcela em DINHEIRO das vendas tardias — só o que tocaria a gaveta (CS-5). */
  lateCashSalesTotal: number;
  /** Esperado recalculado = `expectedAmount` + `lateCashSalesTotal` (CS-5).
   * NÃO reescreve o dado congelado do fechamento; é só a conta pronta para conferência. */
  adjustedExpected: number;
  /** Divergência recalculada = `closingAmount` − `adjustedExpected` (CS-5). */
  adjustedDivergence: number;
  /** Quebra da mini-DRE — presente SÓ quando a chamada pede `?breakdown=1` (a tela do Caixa, para
   * reimprimir o comprovante de fechamento completo). Ausente no fluxo normal do Relatórios. */
  cashInflow?: number;
  cashMovementsIn?: number;
  cashMovementsOut?: number;
}

/**
 * Drill-down por forma de pagamento (Relatórios v2, Fatia 3). Além do intervalo, exige a `method`
 * (a forma clicada). O servidor devolve a COMPOSIÇÃO daquele valor — as vendas à vista e os
 * recebimentos de dívida que somam o "Recebido" da forma no período (Σ linhas = total da forma).
 */
export const paymentCompositionSchema = reportRangeSchema.extend({
  method: z.string().min(1).max(30),
});
export type PaymentCompositionQuery = z.infer<typeof paymentCompositionSchema>;

/**
 * Uma linha da composição do recebido de uma forma: uma venda à vista, um recebimento de dívida OU
 * um estorno de devolução (ADR-037, valor NEGATIVO).
 */
export interface PaymentCompositionRow {
  /**
   * `venda` = pagamento à vista de uma venda; `divida` = recebimento de uma dívida (fiado);
   * `estorno` = dinheiro devolvido ao cliente nesta forma numa devolução (ADR-037, `valor` < 0).
   */
  tipo: 'venda' | 'divida' | 'estorno';
  /** Identificador humano da origem: nº do pedido (`#000123`) ou código da dívida (`D-0001`). */
  ref: string;
  /** Cliente (ou "Consumidor" quando a venda à vista não tem cliente). */
  descricao: string;
  /**
   * Valor que entrou nesta linha. À vista = `Payment.amount`; dívida = `amount + surcharge` (ADR-022);
   * estorno = −(fatia devolvida nesta forma) (ADR-037).
   */
  valor: number;
  /**
   * Data do evento (ISO): venda = data da venda; dívida = data do recebimento (`paidAt`, regime de
   * caixa); estorno = data da VENDA devolvida (o estorno abate o dia da venda, ADR-037).
   */
  data: string;
}

/**
 * Composição do recebido de UMA forma no período (Fatia 3). `total` deve bater com o total daquela
 * forma em `GET /reports/sales` (mesma regra de caixa, ADR-019): é o gate do drill-down.
 */
export interface PaymentComposition {
  method: string;
  from: string | null;
  to: string | null;
  /** Σ dos `valor` das linhas — bate com o total da forma em `/reports/sales`. */
  total: number;
  rows: PaymentCompositionRow[];
}

/**
 * Consulta dos rankings de produtos/clientes (Relatórios v2, Fatia 5). Além do intervalo, aceita
 * busca `q` (sem acento, no servidor) e o critério de ordenação. `limit` limita o tamanho da lista.
 */
export const topReportSchema = reportRangeSchema.extend({
  q: z.string().trim().max(80).optional(),
  /** `faturamento` (padrão) ou `lucro` (usa o custo carimbado — ADR-027). */
  orderBy: z.enum(['faturamento', 'lucro']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type TopReportQuery = z.infer<typeof topReportSchema>;

/**
 * Consulta do ranking de PRODUTOS: igual à dos rankings, mais o critério `quantidade` ("mais
 * vendidos"), que ordena pela quantidade em UNIDADE-BASE do produto (`baseQty`). Só faz sentido para
 * produto — clientes seguem com `topReportSchema`.
 */
export const topProductsSchema = topReportSchema.extend({
  orderBy: z.enum(['faturamento', 'lucro', 'quantidade']).optional(),
});
export type TopProductsQuery = z.infer<typeof topProductsSchema>;

/**
 * Linha do ranking de PRODUTOS no período (Fatia 5). Lucro/margem só das vendas com custo carimbado
 * (ADR-027); `costCoverage < 1` sinaliza que parte do faturamento não tem custo (venda antiga).
 */
export interface TopProductRow {
  productId: string;
  productName: string;
  /**
   * Faturamento do produto (Σ dos totais das linhas), inclui vendas sem custo. ADR-037: líquido do
   * que foi devolvido/trocado (vale para todos os rankings e detalhes de produto/cliente).
   */
  revenue: number;
  /** Quantidade vendida (na unidade do produto), líquida das devoluções/trocas (ADR-037). */
  qty: number;
  /**
   * Quantidade vendida em UNIDADE-BASE do produto (`baseQuantity ?? quantity`, a mesma do estoque),
   * líquida do devolvido/trocado (ADR-037). Diferente de `qty`, não mistura unidades quando o produto
   * é vendido ora na embalagem, ora na base (ex.: rolo × metro) — é o critério dos "mais vendidos".
   */
  baseQty: number;
  /**
   * Unidade do cadastro; `null` se o produto não existe mais. ATENÇÃO — unidade fechada (barra/rolo/
   * pacote, ADR-017/030): `baseQty` está na régua FINA (metro / unidade avulsa), não em barras; use
   * `closedSize` para mostrar "2 barras + 3 m".
   */
  unit: UnitType | null;
  /** Tamanho da unidade fechada na régua fina (ex.: barra de 6 m ⇒ 6); `null` se não é fechada. */
  closedSize: number | null;
  /** Nº de vendas que incluíram o produto (base do ticket). */
  salesCount: number;
  /** Lucro bruto (só linhas com custo). Ver `costCoverage`. */
  grossProfit: number;
  /** Margem % sobre a receita coberta. */
  marginPercent: number;
  /** Fração do faturamento com custo (0..1). `< 1` ⇒ lucro/margem parciais. */
  costCoverage: number;
}

/** "Quem mais compra" um produto (Fatia 5): top clientes por faturamento naquele produto. */
export interface ProductCustomerRow {
  /** `null` quando a venda foi sem cliente (consumidor). */
  customerId: string | null;
  customerName: string;
  qty: number;
  /** Quantidade em unidade-base do produto, líquida (ADR-037) — rotular com `unit`/`closedSize` do produto. */
  baseQty: number;
  revenue: number;
}

/**
 * Linha do ranking de CLIENTES no período (Fatia 5). Lucro/margem só das vendas com custo carimbado
 * (ADR-027). `currentDebt` é a dívida atual (saldo em aberto) — independe do período do relatório.
 */
export interface TopCustomerRow {
  customerId: string;
  customerName: string;
  /** Total comprado no período (Σ dos totais das linhas), inclui vendas sem custo. */
  revenue: number;
  /** Nº de compras (vendas) no período — base do ticket. */
  salesCount: number;
  /** Lucro bruto gerado (só linhas com custo). Ver `costCoverage`. */
  grossProfit: number;
  /** Margem % sobre a receita coberta. */
  marginPercent: number;
  /** Fração do faturamento com custo (0..1). */
  costCoverage: number;
  /** Dívida atual do cliente (saldo em aberto AGORA, não do período). 0 se não deve. */
  currentDebt: number;
}

/** "O que costuma comprar" um cliente (Fatia 5): top produtos por faturamento daquele cliente. */
export interface CustomerProductRow {
  productId: string;
  productName: string;
  qty: number;
  /** Quantidade em unidade-base, líquida (ADR-037). Ver `TopProductRow.baseQty`. */
  baseQty: number;
  /** Unidade do cadastro. Ver `TopProductRow.unit`. */
  unit: UnitType | null;
  /** Tamanho da unidade fechada. Ver `TopProductRow.closedSize`. */
  closedSize: number | null;
  revenue: number;
}

/** Um ponto do gráfico temporal (Fatia 7): o recebido de um dia, com a quebra por forma (empilhado). */
export interface DailyRevenuePoint {
  /** Dia no formato AAAA-MM-DD (fuso da loja). */
  day: string;
  /** Recebido no dia (regime de caixa, ADR-019) — Σ dos dias = "Recebido no período". */
  total: number;
  /** Quebra do dia por forma de pagamento (`{ PIX: 120, CASH: 30 }`) — Σ das formas = `total`. */
  byMethod: Record<string, number>;
}

/** Projeção de faturamento do mês "no ritmo atual" (Fatia 8) — direcional, não promessa. */
export interface MonthRevenueProjection {
  /** Recebido do mês corrente até hoje (regime de caixa, ADR-019). */
  realized: number;
  /** Dias decorridos do mês (dia do mês de hoje, fuso da loja). */
  daysElapsed: number;
  /** Total de dias do mês corrente. */
  daysInMonth: number;
  /** Média diária realizada. */
  dailyAverage: number;
  /** Projeção do mês inteiro no ritmo atual (`dailyAverage × daysInMonth`). */
  projected: number;
}

/** A receber nos próximos N dias (Fatia 8): dívidas em aberto com vencimento na janela. */
export interface UpcomingReceivables {
  /** Soma dos saldos em aberto que vencem na janela. */
  total: number;
  /** Nº de dívidas que vencem na janela. */
  count: number;
  /** Tamanho da janela em dias (30). */
  days: number;
}

/** Item em risco de ruptura de estoque (Fatia 8): esgota em poucos dias no ritmo de saída atual. */
export interface StockoutRisk {
  productId: string;
  productName: string;
  /** Estoque atual (unidade-base). */
  stockQty: number;
  /** Velocidade TÍPICA de saída por dia (unidade-base): mediana dos dias com venda × frequência. */
  dailyVelocity: number;
  /** Dias até esgotar no ritmo atual (`stockQty / dailyVelocity`, 1 casa). */
  daysToStockout: number;
}

/** Relatório de projeções (Fatia 8): as 3 projeções da seção "Projeções — no ritmo atual". */
export interface ProjectionsReport {
  monthRevenue: MonthRevenueProjection;
  upcomingReceivables: UpcomingReceivables;
  /** Itens mais próximos de romper (ordenados por menor prazo). Vazio = nada em risco. */
  stockoutRisks: StockoutRisk[];
  /** Janela (dias) usada para medir a velocidade de saída do estoque. */
  velocityWindowDays: number;
}
