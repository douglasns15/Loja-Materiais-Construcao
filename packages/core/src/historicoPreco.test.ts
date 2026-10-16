import { describe, expect, it } from 'vitest';
import { diffPriceCost } from './index';

// Histórico de custo e preço do produto (2026-10-16): quando grava linha e o que vai nela.
describe('diffPriceCost — o "de → para" do custo/preço', () => {
  it('só o custo mudou ⇒ linha só com o custo', () => {
    expect(diffPriceCost({ costPrice: 25, salePrice: 37 }, { costPrice: 27.5 })).toEqual({
      costBefore: 25,
      costAfter: 27.5,
      priceBefore: null,
      priceAfter: null,
    });
  });

  it('só o preço mudou ⇒ linha só com o preço', () => {
    expect(diffPriceCost({ costPrice: 25, salePrice: 37 }, { costPrice: 25, salePrice: 39.9 })).toEqual({
      costBefore: null,
      costAfter: null,
      priceBefore: 37,
      priceAfter: 39.9,
    });
  });

  it('os dois mudaram ⇒ linha com os dois', () => {
    expect(diffPriceCost({ costPrice: 25, salePrice: 37 }, { costPrice: 26, salePrice: 38 })).toEqual({
      costBefore: 25,
      costAfter: 26,
      priceBefore: 37,
      priceAfter: 38,
    });
  });

  it('nada mudou (mesmo valor, inclusive como string do Decimal) ⇒ null', () => {
    expect(diffPriceCost({ costPrice: '25.0000', salePrice: '37.0000' }, { costPrice: 25, salePrice: 37 })).toBeNull();
  });

  it('campo ausente/nulo no "depois" = não mexeu', () => {
    expect(diffPriceCost({ costPrice: 25, salePrice: 37 }, {})).toBeNull();
    expect(diffPriceCost({ costPrice: 25, salePrice: 37 }, { costPrice: null, salePrice: undefined })).toBeNull();
  });

  it('compara na precisão do banco (4 casas)', () => {
    expect(diffPriceCost({ costPrice: 1.23456, salePrice: 2 }, { costPrice: 1.23459 })).toBeNull();
    expect(diffPriceCost({ costPrice: 1.2345, salePrice: 2 }, { costPrice: 1.2346 })?.costAfter).toBe(1.2346);
  });

  it('cadastro (antes = null) ⇒ os dois valores iniciais, com "de" vazio', () => {
    expect(diffPriceCost(null, { costPrice: 0, salePrice: 12.5 })).toEqual({
      costBefore: null,
      costAfter: 0,
      priceBefore: null,
      priceAfter: 12.5,
    });
  });

  it('custo que era zero e passou a ter valor conta como mudança', () => {
    expect(diffPriceCost({ costPrice: 0, salePrice: 10 }, { costPrice: 6 })?.costBefore).toBe(0);
  });
});
