/**
 * Histórico de custo e preço do produto (2026-10-16). Cada vez que o CUSTO (`costPrice`) ou o PREÇO
 * DE VENDA (`salePrice`) de um produto muda, o servidor grava uma linha "de → para" com data/hora,
 * quem fez e POR ONDE (tela de Produtos, entrada de estoque, NF-e…). Guardado no `AuditEvent`
 * existente (auditoria seletiva — ARCHITECTURE §7), `entity = 'Product'`, `action =
 * PRICE_HISTORY_ACTION`: sem tabela nova nem migration. A tela lê por `GET /products/:id/price-history`.
 */

/** `AuditEvent.action` das linhas do histórico de custo/preço. */
export const PRICE_HISTORY_ACTION = 'PRICE_COST_CHANGE';

/** Por onde o custo/preço mudou. */
export const PRICE_CHANGE_SOURCES = [
  'PRODUCT_CREATE', // cadastro do produto (Produtos, cadastro em sequência, "Cadastrar agora" do caixa)
  'PRODUCT_EDIT', // edição na tela de Produtos
  'SPREADSHEET', // importação de planilha
  'STOCK_ENTRY', // entrada de estoque (tela Estoque) com custo novo
  'NFE_IMPORT', // importação de NF-e (cadastro novo ou custo/preço ao casar)
  'PRODUCTION', // produção (custo do produto pronto pela ficha técnica)
  'DISASSEMBLY', // desmembramento (custo dos cortes)
] as const;
export type PriceChangeSource = (typeof PRICE_CHANGE_SOURCES)[number];

/** Rótulo de "como foi feito", na linguagem de quem usa. */
export const PRICE_CHANGE_SOURCE_LABELS: Record<PriceChangeSource, string> = {
  PRODUCT_CREATE: 'Cadastro do produto',
  PRODUCT_EDIT: 'Tela de Produtos',
  SPREADSHEET: 'Importação de planilha',
  STOCK_ENTRY: 'Entrada de estoque',
  NFE_IMPORT: 'Importação de NF-e',
  PRODUCTION: 'Produção',
  DISASSEMBLY: 'Desmembramento',
};

/** Rótulo seguro para uma origem gravada (desconhecida ⇒ o próprio código). */
export function priceChangeSourceLabel(source: string): string {
  return (PRICE_CHANGE_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/**
 * Uma linha do histórico (`GET /products/:id/price-history`). Campo que NÃO mudou vem `null` nos dois
 * lados (ex.: só o custo mudou ⇒ `priceBefore`/`priceAfter` nulos). No cadastro, `*Before` é nulo e
 * `*After` é o valor inicial.
 */
export type PriceHistoryEntry = {
  id: string;
  at: string;
  byName: string | null;
  source: PriceChangeSource | string;
  costBefore: number | null;
  costAfter: number | null;
  priceBefore: number | null;
  priceAfter: number | null;
  /** Referência da origem, quando há (ex.: "NF 12345", "PR-0003"). */
  detail: string | null;
};
