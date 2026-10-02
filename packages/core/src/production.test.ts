import { describe, expect, it } from 'vitest';
import { costPriceFromBaseCost, productionCost, productionShortages, scaleRecipe } from './index';

// =============================================================================
// Produção com ficha técnica (ADR-043)
// =============================================================================

// Frango assado: 1,200 kg rende de 1 frango cru (un) + 0,020 kg de tempero.
const FRANGO = {
  yieldQty: 1.2,
  items: [
    { productId: 'cru', quantity: 1 },
    { productId: 'tempero', quantity: 0.02 },
  ],
};

describe('scaleRecipe', () => {
  it('15 frangos assados (18 kg) = 15 crus + 0,300 kg de tempero', () => {
    expect(scaleRecipe(FRANGO, 18)).toEqual([
      { productId: 'cru', quantity: 15 },
      { productId: 'tempero', quantity: 0.3 },
    ]);
  });

  it('rendimento com quebra de cocção: 4,100 kg de picanha assada (65%) pede 6,3077 kg crua', () => {
    expect(scaleRecipe({ yieldQty: 0.65, items: [{ productId: 'picanha', quantity: 1 }] }, 4.1)).toEqual([
      { productId: 'picanha', quantity: 6.3077 },
    ]);
  });

  it('linha zerada sai; ficha ou quantidade inválida ⇒ nada', () => {
    expect(scaleRecipe({ yieldQty: 1, items: [{ productId: 'a', quantity: 0 }] }, 3)).toEqual([]);
    expect(scaleRecipe({ yieldQty: 0, items: FRANGO.items }, 3)).toEqual([]);
    expect(scaleRecipe(FRANGO, 0)).toEqual([]);
  });
});

describe('productionCost', () => {
  it('15 frangos a R$ 16,20 + 0,300 kg de tempero a R$ 25/kg, rendendo 18 kg', () => {
    expect(
      productionCost(
        [
          { quantity: 15, unitCost: 16.2 },
          { quantity: 0.3, unitCost: 25 },
        ],
        18,
      ),
    ).toEqual({ totalCost: 250.5, unitCost: 13.9167 });
  });

  it('sem quantidade produzida, custo unitário 0', () => {
    expect(productionCost([{ quantity: 1, unitCost: 10 }], 0)).toEqual({ totalCost: 10, unitCost: 0 });
  });
});

describe('productionShortages', () => {
  it('bloqueia insumo controlado sem saldo; ignora o sem controle', () => {
    expect(
      productionShortages([
        { productId: 'cru', quantity: 15, tracked: true, available: 3 },
        { productId: 'tempero', quantity: 0.3, tracked: false, available: 0 },
      ]),
    ).toEqual([{ productId: 'cru', needed: 15, available: 3 }]);
  });

  it('soma o mesmo insumo em duas linhas', () => {
    expect(
      productionShortages([
        { productId: 'arroz', quantity: 0.6, tracked: true, available: 1 },
        { productId: 'arroz', quantity: 0.6, tracked: true, available: 1 },
      ]),
    ).toEqual([{ productId: 'arroz', needed: 1.2, available: 1 }]);
  });

  it('saldo exato passa', () => {
    expect(productionShortages([{ productId: 'cru', quantity: 15, tracked: true, available: 15 }])).toEqual([]);
  });
});

describe('costPriceFromBaseCost', () => {
  it('produto por kg/un guarda o custo por unidade-base', () => {
    expect(costPriceFromBaseCost({ unit: 'KILOGRAM' }, 13.9167)).toBe(13.9167);
  });
  it('pacote fechado de 6 guarda o custo do pacote inteiro', () => {
    expect(costPriceFromBaseCost({ unit: 'PACK', conversionFactor: 6 }, 2)).toBe(12);
  });
});
