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
 * Formata telefone BR: `(00) 0000-0000` (fixo, 10 díg.) ou `(00) 00000-0000`
 * (celular, 11 díg.). Fora desses tamanhos, volta apenas com os dígitos.
 */
export function formatPhoneBr(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

/** Prefixo do código humano da venda (ADR-023). O orçamento usará "O-" na Fatia 2. */
export const ORDER_CODE_PREFIX = 'V-';

/**
 * Formata o número sequencial da venda (ADR-023) como `V-000128`: prefixo + o inteiro preenchido
 * com zeros à esquerda até 6 dígitos. Números acima de 999999 só crescem (nunca trunca). É
 * APRESENTAÇÃO — o banco guarda o inteiro (`orders.orderNumber`). Entrada nula/≤0 (ex.: venda ainda
 * não sincronizada, sem número) volta string vazia, para o chamador decidir o rótulo "pendente".
 */
export function formatOrderNumber(n: number | null | undefined): string {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return `${ORDER_CODE_PREFIX}${String(Math.floor(num)).padStart(6, '0')}`;
}

/**
 * Interpreta a busca por código de venda (ADR-023): extrai os dígitos e devolve o inteiro, ou `null`
 * se não houver dígito válido. Aceita `V-000128`, `000128`, `128`, `v 128` — todos casam a venda 128
 * (zeros à esquerda são ignorados). Assim a busca por código vira comparação de inteiro indexada
 * (`where.orderNumber`), sem cast de UUID. Função PURA.
 */
export function parseOrderNumberQuery(query: string | null | undefined): number | null {
  const digits = onlyDigits(query);
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
