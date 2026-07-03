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
