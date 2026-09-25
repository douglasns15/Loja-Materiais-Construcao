import { splitWholeAndRemainder } from '@nexoloja/core';
import { closedUnitTerms, type UnitType } from '@nexoloja/shared';

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

const NUM = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const word = (unit: UnitType, qty: number) => UNIT_WORDS[unit][Math.abs(qty) >= 2 ? 1 : 0];

/**
 * "340 sacos", "12,5 m", "1 rolo". Sem unidade conhecida, cai em "un". Plural a partir de 2 (pt-BR).
 *
 * Unidade FECHADA (barra/rolo/pacote — ADR-017/030, `closedSize` > 0): a quantidade-base está na
 * régua fina (metro / unidade avulsa), então vira "2 barras", "1 barra + 3 m" ou "4,5 m" — o mesmo
 * formato do saldo na tela de Estoque. Sem isso, 12 m de tubo apareciam como "12 barras".
 */
export function formatQtyUnit(
  qty: number,
  unit: UnitType | null | undefined,
  closedSize?: number | null,
): string {
  if (unit && closedSize && closedSize > 0) {
    const { whole, remainderMeters } = splitWholeAndRemainder(qty, closedSize);
    const fine = `${NUM(remainderMeters)} ${closedUnitTerms(unit).fineAbbrev}`;
    if (whole === 0) return fine;
    const head = `${NUM(whole)} ${word(unit, whole)}`;
    return remainderMeters > 0 ? `${head} + ${fine}` : head;
  }
  return `${NUM(qty)} ${word(unit ?? 'UNIT', qty)}`;
}
