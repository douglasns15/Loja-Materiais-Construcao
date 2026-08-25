/**
 * Chave de acesso da NFC-e/NF-e — 44 dígitos.
 *
 * Layout oficial (soma 44):
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *
 * O serviço gera a chave localmente por dois motivos: (1) permitir **emissão em
 * contingência offline**, quando a SEFAZ está inacessível e a chave precisa
 * existir antes da transmissão; (2) conferir a chave devolvida pelo provedor —
 * se divergir, algo saiu errado e é melhor falhar alto.
 */

/** Modelo do documento na chave: 65 = NFC-e, 55 = NF-e. */
export const MODEL_NFCE = 65;

/** Forma de emissão (tpEmis): 1 = normal, 9 = contingência offline NFC-e. */
export const EMISSION_NORMAL = 1;
export const EMISSION_OFFLINE_CONTINGENCY = 9;

/** Preenche com zeros à esquerda até o tamanho pedido. */
function pad(value: number | string, size: number): string {
  return String(value).replace(/\D/g, '').padStart(size, '0').slice(-size);
}

/**
 * Dígito verificador da chave (módulo 11, pesos 2..9 cíclicos da DIREITA para a
 * esquerda sobre os 43 primeiros dígitos). Resto 0 ou 1 ⇒ DV = 0.
 */
export function accessKeyCheckDigit(first43: string): number {
  const digits = first43.replace(/\D/g, '');
  if (digits.length !== 43) {
    throw new Error(`Chave parcial deve ter 43 dígitos (recebido ${digits.length}).`);
  }
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
}

export interface AccessKeyParts {
  /** Código IBGE da UF do emitente (ex.: 35 = SP). */
  ufCode: number;
  /** Ano/mês da emissão. `year` com 4 dígitos; `month` 1–12. */
  year: number;
  month: number;
  /** CNPJ do emitente (só dígitos). */
  cnpj: string;
  /** Modelo: 65 (NFC-e) ou 55 (NF-e). */
  model: number;
  /** Série (1–999). */
  series: number;
  /** Número da nota (nNF). */
  number: number;
  /** Forma de emissão (tpEmis). */
  emissionType: number;
  /** Código numérico aleatório (cNF, 8 dígitos) — evita chave previsível. */
  numericCode: number;
}

/**
 * Monta a chave de acesso completa (44 dígitos), já com o DV calculado.
 * Puro e determinístico: com as mesmas partes, sempre a mesma chave — o que
 * torna a emissão **reproduzível** e testável.
 */
export function buildAccessKey(parts: AccessKeyParts): string {
  const first43 =
    pad(parts.ufCode, 2) +
    pad(parts.year % 100, 2) +
    pad(parts.month, 2) +
    pad(parts.cnpj, 14) +
    pad(parts.model, 2) +
    pad(parts.series, 3) +
    pad(parts.number, 9) +
    pad(parts.emissionType, 1) +
    pad(parts.numericCode, 8);

  return first43 + String(accessKeyCheckDigit(first43));
}

/** `true` se a chave tem 44 dígitos e o DV confere. */
export function isValidAccessKey(key: string): boolean {
  const digits = key.replace(/\D/g, '');
  if (digits.length !== 44) return false;
  const first43 = digits.slice(0, 43);
  return accessKeyCheckDigit(first43) === Number(digits[43]);
}

/** Decompõe uma chave válida nas suas partes (útil para conferência e exibição). */
export function parseAccessKey(key: string): AccessKeyParts | null {
  const d = key.replace(/\D/g, '');
  if (!isValidAccessKey(d)) return null;
  return {
    ufCode: Number(d.slice(0, 2)),
    // A chave carrega só 2 dígitos de ano; assumimos o século atual (2000+).
    year: 2000 + Number(d.slice(2, 4)),
    month: Number(d.slice(4, 6)),
    cnpj: d.slice(6, 20),
    model: Number(d.slice(20, 22)),
    series: Number(d.slice(22, 25)),
    number: Number(d.slice(25, 34)),
    emissionType: Number(d.slice(34, 35)),
    numericCode: Number(d.slice(35, 43)),
  };
}
