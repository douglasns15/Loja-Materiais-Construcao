/**
 * Formatação de documentos/telefone (BR) — funções PURAS reusadas no cliente
 * (máscara ao sair do campo) e onde os dados são exibidos (tela, comprovante).
 * O banco guarda SÓ os dígitos (forma canônica): a formatação é de apresentação.
 */

/** Mantém apenas os dígitos de uma string (base das máscaras de CNPJ/telefone). */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Formata um CNPJ (14 dígitos) como `00.000.000/0000-00`.
 * Entrada parcial ou com tamanho diferente de 14 volta apenas com os dígitos —
 * assim campos incompletos não travam a digitação.
 */
export function formatCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Formata um CPF (11 dígitos) como `000.000.000-00`.
 * Entrada parcial ou com tamanho diferente de 11 volta apenas com os dígitos —
 * assim campos incompletos não travam a digitação.
 */
export function formatCpf(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Formata um documento que pode ser CPF **ou** CNPJ (campo `cpfCnpj` do cliente): decide pela
 * quantidade de dígitos — até 11 usa a máscara de CPF, acima usa a de CNPJ. Tamanhos incompletos
 * caem no ramo correspondente (que volta só os dígitos), então não travam a digitação.
 */
export function formatCpfCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 14);
  return d.length > 11 ? formatCnpj(d) : formatCpf(d);
}

/**
 * Formata telefone BR: `(00) 0000-0000` (fixo, 10 díg.) ou `(00) 00000-0000`
 * (celular, 11 díg.). Fora desses tamanhos, volta apenas com os dígitos.
 */
export function formatPhoneBr(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

/** Prefixo do código humano da venda (ADR-023) e do orçamento (ADR-024). O prefixo separa as duas
 *  sequências sequenciais por loja (venda `V-000128`, orçamento `O-000045`). */
export const ORDER_CODE_PREFIX = 'V-';
export const QUOTE_CODE_PREFIX = 'O-';

/** Formata um número sequencial como `<prefixo>000128`: prefixo + inteiro com zeros à esquerda até 6
 *  dígitos (acima de 999999 só cresce, nunca trunca). Nula/≤0 volta string vazia. Base de
 *  `formatOrderNumber` (ADR-023) e `formatQuoteNumber` (ADR-024). */
function formatSeqCode(prefix: string, n: number | null | undefined): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return `${prefix}${String(Math.floor(num)).padStart(6, '0')}`;
}

/** Extrai os dígitos de uma busca por código e devolve o inteiro, ou `null` se não houver dígito
 *  válido (ou for 0). Prefixo-agnóstico: aceita `V-000128`/`O-000045`/`128`/`v 128`. Base das buscas
 *  por código (comparação de inteiro indexada, sem cast de UUID). Função PURA. */
export function parseSeqNumberQuery(query: string | null | undefined): number | null {
  const digits = onlyDigits(query);
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Formata o número sequencial da venda (ADR-023) como `V-000128`. É APRESENTAÇÃO — o banco guarda o
 * inteiro (`orders.orderNumber`). Entrada nula/≤0 (ex.: venda offline ainda não sincronizada) volta
 * string vazia, para o chamador decidir o rótulo "pendente".
 */
export function formatOrderNumber(n: number | null | undefined): string {
  return formatSeqCode(ORDER_CODE_PREFIX, n);
}

/** Busca por código de venda (ADR-023): `V-000128`/`000128`/`128` → 128. Alias de `parseSeqNumberQuery`. */
export function parseOrderNumberQuery(query: string | null | undefined): number | null {
  return parseSeqNumberQuery(query);
}

/**
 * Formata o número sequencial do orçamento (ADR-024) como `O-000045`. É APRESENTAÇÃO — o banco guarda
 * o inteiro (`quotes.quoteNumber`).
 */
export function formatQuoteNumber(n: number | null | undefined): string {
  return formatSeqCode(QUOTE_CODE_PREFIX, n);
}

/** Busca por código de orçamento (ADR-024): `O-000045`/`000045`/`45` → 45. Alias de `parseSeqNumberQuery`. */
export function parseQuoteNumberQuery(query: string | null | undefined): number | null {
  return parseSeqNumberQuery(query);
}

/**
 * Gera um identificador amigável (slug) a partir de um texto: remove acentos, baixa
 * a caixa e troca tudo que não é alfanumérico por hífen. Usado no onboarding para
 * derivar o `Tenant.slug` do nome da loja quando não informado (ADR-009). Função PURA.
 * Ex.: "Loja do Zé & Cia" → "loja-do-ze-cia". Limitado a 60 chars (limite do schema).
 */
export function slugify(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (diacriticos combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // remove hífens das pontas
    .slice(0, 60);
}
