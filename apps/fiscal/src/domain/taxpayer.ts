/**
 * Validação de CPF e CNPJ — funções puras `(entrada) => saída`, sem I/O.
 *
 * Por que validar aqui, antes de chamar o provedor: um documento inválido é a
 * causa mais comum de REJEIÇÃO da SEFAZ. Barrar no cliente evita consumir
 * numeração fiscal e queimar uma chamada paga ao provedor por um erro de digitação.
 */

/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * `true` se todos os dígitos são iguais ("111.111.111-11").
 * Esses valores passam no cálculo do dígito verificador mas são inválidos por
 * convenção — daí a checagem explícita.
 */
function allSameDigits(digits: string): boolean {
  return /^(\d)\1*$/.test(digits);
}

/**
 * Valida CPF pelo dígito verificador (módulo 11).
 * 1º DV: pesos 10..2 sobre os 9 primeiros; 2º DV: pesos 11..2 sobre os 10 primeiros.
 * Resto 10 (ou 11) ⇒ dígito 0.
 */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSameDigits(d)) return false;

  const digitAt = (i: number): number => Number(d[i]);

  for (const [length, expectedIndex] of [
    [9, 9],
    [10, 10],
  ] as const) {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += digitAt(i) * (length + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    const check = remainder === 10 || remainder === 11 ? 0 : remainder;
    if (check !== digitAt(expectedIndex)) return false;
  }
  return true;
}

/** Pesos do 1º e do 2º dígito verificador do CNPJ (tabela fixa da Receita). */
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/**
 * Valida CNPJ pelo dígito verificador (módulo 11).
 * Resto < 2 ⇒ dígito 0; senão, 11 − resto.
 */
export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSameDigits(d)) return false;

  const checkDigit = (weights: readonly number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(d[i]) * (weights[i] as number);
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return (
    checkDigit(CNPJ_WEIGHTS_1) === Number(d[12]) && checkDigit(CNPJ_WEIGHTS_2) === Number(d[13])
  );
}

/** Valida o documento conforme o tipo declarado (CPF ou CNPJ). */
export function isValidTaxpayerDocument(kind: 'CPF' | 'CNPJ', value: string): boolean {
  return kind === 'CPF' ? isValidCpf(value) : isValidCnpj(value);
}
