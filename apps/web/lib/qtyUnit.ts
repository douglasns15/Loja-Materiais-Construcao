import type { UnitType } from '@nexoloja/shared';

/**
 * Rótulo curto da unidade para exibir junto de uma quantidade ("340 sacos", "800 m"). Siglas para as
 * unidades de medida; palavra (com plural) para as de contagem — "3 mil" leria como número, por isso
 * o milheiro vai por extenso.
 */
const UNIT_WORDS: Record<UnitType, [singular: string, plural: string]> = {
  UNIT: ['un', 'un'],
  METER: ['m', 'm'],
  SQUARE_METER: ['m²', 'm²'],
  CUBIC_METER: ['m³', 'm³'],
  KILOGRAM: ['kg', 'kg'],
  LITER: ['L', 'L'],
  THOUSAND: ['milheiro', 'milheiros'],
  BAG: ['saco', 'sacos'],
  ROLL: ['rolo', 'rolos'],
  BARRA: ['barra', 'barras'],
  PACK: ['pacote', 'pacotes'],
};

/** "340 sacos", "12,5 m", "1 rolo". Sem unidade conhecida, cai em "un". Plural a partir de 2 (pt-BR). */
export function formatQtyUnit(qty: number, unit: UnitType | null | undefined): string {
  const n = qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const [singular, plural] = (unit && UNIT_WORDS[unit]) || UNIT_WORDS.UNIT;
  return `${n} ${Math.abs(qty) >= 2 ? plural : singular}`;
}
