import { describe, expect, it } from 'vitest';
import {
  isWeighedUnit,
  resolveSaleUnit,
  sellableQty,
  sellsWholeOfWeighed,
  toBaseQuantity,
  tracksStock,
  wholeOfWeighedEligible,
} from './index';

// =============================================================================
// PRODUTO SEM CONTROLE DE ESTOQUE — `trackStock` (ADR-040 §2)
// =============================================================================
// Frango assado, marmita, sorvete: produção do dia. Não trava a venda e não movimenta estoque.

describe('tracksStock', () => {
  it('controla por padrão (campo ausente/nulo = default do schema)', () => {
    expect(tracksStock({})).toBe(true);
    expect(tracksStock({ trackStock: null })).toBe(true);
    expect(tracksStock({ trackStock: undefined })).toBe(true);
    expect(tracksStock({ trackStock: true })).toBe(true);
  });

  it('só `false` desliga o controle', () => {
    expect(tracksStock({ trackStock: false })).toBe(false);
  });
});

describe('sellableQty', () => {
  it('produto controlado: disponível = estoque − reservado (ADR-020)', () => {
    expect(sellableQty({ stockQty: 10, reservedQty: 3 })).toBe(7);
    expect(sellableQty({ trackStock: true, stockQty: 2.5, reservedQty: 0 })).toBe(2.5);
  });

  it('produto controlado sem reserva informada', () => {
    expect(sellableQty({ stockQty: 4 })).toBe(4);
    expect(sellableQty({ stockQty: 4, reservedQty: null })).toBe(4);
  });

  it('produto controlado nunca fica negativo', () => {
    expect(sellableQty({ stockQty: -2, reservedQty: 0 })).toBe(0);
    expect(sellableQty({ stockQty: 1, reservedQty: 5 })).toBe(0);
  });

  it('produto SEM controle nunca trava, mesmo com saldo zero ou negativo', () => {
    expect(sellableQty({ trackStock: false, stockQty: 0 })).toBe(Infinity);
    expect(sellableQty({ trackStock: false, stockQty: -7, reservedQty: 3 })).toBe(Infinity);
    expect(1.234 <= sellableQty({ trackStock: false, stockQty: 0 })).toBe(true);
  });
});

// =============================================================================
// "VENDIDO INTEIRO TAMBÉM" — produto por peso com preço do inteiro (ADR-040 + ADR-013)
// =============================================================================
// Frango assado: R$ 39,90/kg (pesado na hora) OU inteiro a R$ 45,00 (peso médio 1,2 kg).

const frango = {
  unit: 'KILOGRAM',
  salePrice: 39.9,
  altUnit: 'UNIT',
  altSalePrice: 45,
  conversionFactor: 1.2,
};

describe('isWeighedUnit', () => {
  it('kg e litro são vendidos por peso/volume', () => {
    expect(isWeighedUnit('KILOGRAM')).toBe(true);
    expect(isWeighedUnit('LITER')).toBe(true);
  });
  it('demais unidades não', () => {
    expect(isWeighedUnit('UNIT')).toBe(false);
    expect(isWeighedUnit('PACK')).toBe(false);
    expect(isWeighedUnit('METER')).toBe(false);
  });
});

describe('wholeOfWeighedEligible', () => {
  it('kg/L sem embalagem ou com embalagem UNIT mostram o bloco "vendido inteiro"', () => {
    expect(wholeOfWeighedEligible('KILOGRAM', '')).toBe(true);
    expect(wholeOfWeighedEligible('KILOGRAM', null)).toBe(true);
    expect(wholeOfWeighedEligible('LITER', 'UNIT')).toBe(true);
  });
  it('kg com outra embalagem gravada (dado legado) segue no cadastro genérico', () => {
    expect(wholeOfWeighedEligible('KILOGRAM', 'PACK')).toBe(false);
  });
  it('unidade que não é peso nunca é elegível', () => {
    expect(wholeOfWeighedEligible('UNIT', '')).toBe(false);
    expect(wholeOfWeighedEligible('ROLL', 'UNIT')).toBe(false);
  });
});

describe('sellsWholeOfWeighed', () => {
  it('configurado com preço do inteiro e peso médio', () => {
    expect(sellsWholeOfWeighed(frango)).toBe(true);
  });
  it('sem preço do inteiro ou sem peso médio não oferece a opção', () => {
    expect(sellsWholeOfWeighed({ ...frango, altSalePrice: null })).toBe(false);
    expect(sellsWholeOfWeighed({ ...frango, conversionFactor: null })).toBe(false);
    expect(sellsWholeOfWeighed({ ...frango, altUnit: null })).toBe(false);
  });
  it('embalagem que não é UNIT não é "inteiro"', () => {
    expect(sellsWholeOfWeighed({ ...frango, altUnit: 'PACK' })).toBe(false);
  });
});

describe('venda do frango pelo motor da unidade alternativa (ADR-013)', () => {
  it('por kg: preço do quilo, baixa o peso digitado', () => {
    expect(resolveSaleUnit(frango, 'BASE')).toEqual({ unitPrice: 39.9, factorToBase: 1 });
    expect(toBaseQuantity(frango, 'BASE', 0.412)).toBe(0.412);
  });
  it('inteiro: preço fixo do inteiro, baixa o peso médio por unidade', () => {
    expect(resolveSaleUnit(frango, 'ALT')).toEqual({ unitPrice: 45, factorToBase: 1.2 });
    expect(toBaseQuantity(frango, 'ALT', 2)).toBe(2.4);
  });
});
