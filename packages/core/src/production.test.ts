import { describe, expect, it } from 'vitest';
import {
  breakdownShrink,
  costPriceFromBaseCost,
  productionCost,
  productionShortages,
  scaleRecipe,
  splitBreakdownCost,
  suggestBreakdownCuts,
  summarizeProductionDay,
} from './index';

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

describe('summarizeProductionDay', () => {
  const products = [
    { productId: 'frango', name: 'Frango assado', stockQty: 3.6 },
    { productId: 'picanha', name: 'Picanha assada', stockQty: 0 },
    { productId: 'marmita', name: 'Marmita', stockQty: 0 },
  ];

  it('produziu 18 kg em 2 fornadas, vendeu 12,850 kg em 3 vendas, perdeu 1,550 kg ⇒ soma por produto', () => {
    const rows = summarizeProductionDay(products, {
      produced: [
        { productId: 'frango', quantity: 12 },
        { productId: 'frango', quantity: 6 },
      ],
      sold: [
        { productId: 'frango', quantity: 1.2 },
        { productId: 'frango', quantity: 10.45 },
        { productId: 'frango', quantity: 1.2 },
      ],
      lost: [{ productId: 'frango', quantity: 1.55 }],
    });
    expect(rows).toEqual([
      { productId: 'frango', name: 'Frango assado', stockQty: 3.6, produced: 18, sold: 12.85, lost: 1.55 },
    ]);
  });

  it('lista o pronto com saldo mesmo sem movimento no dia (sobra de ontem) e esconde o parado e zerado', () => {
    const rows = summarizeProductionDay(
      [
        { productId: 'frango', name: 'Frango assado', stockQty: 2.4 },
        { productId: 'marmita', name: 'Marmita', stockQty: 0 },
      ],
      { produced: [], sold: [], lost: [] },
    );
    expect(rows.map((r) => r.productId)).toEqual(['frango']);
  });

  it('vendeu sem produzir no dia (estoque de ontem) e ignora evento de produto sem ficha; ordena por nome', () => {
    const rows = summarizeProductionDay(products, {
      produced: [{ productId: 'picanha', quantity: 4.1 }],
      sold: [
        { productId: 'marmita', quantity: 2 },
        { productId: 'coca', quantity: 5 },
      ],
      lost: [],
    });
    expect(rows.map((r) => [r.name, r.produced, r.sold])).toEqual([
      ['Frango assado', 0, 0],
      ['Marmita', 0, 2],
      ['Picanha assada', 4.1, 0],
    ]);
  });
});

// =============================================================================
// Desmembramento — peça → cortes (ADR-043 Fatia 3)
// =============================================================================

describe('splitBreakdownCost', () => {
  const sum = (r: { totalCost: number }[]) => Number(r.reduce((a, x) => a + x.totalCost, 0).toFixed(2));

  it('quarto traseiro de R$ 300 rateado pelo valor de venda (picanha absorve mais custo/kg)', () => {
    // valores de venda: picanha 4 × 100 = 400; alcatra 6 × 50 = 300; aparas 2 × 15 = 30 ⇒ 730.
    const r = splitBreakdownCost(300, [
      { quantity: 4, salePrice: 100 },
      { quantity: 6, salePrice: 50 },
      { quantity: 2, salePrice: 15 },
    ]);
    expect(r).toEqual([
      { totalCost: 164.38, unitCost: 41.095 },
      { totalCost: 123.29, unitCost: 20.5483 },
      { totalCost: 12.33, unitCost: 6.165 },
    ]);
    expect(sum(r)).toBe(300);
    // Margem igual em todos os cortes (≈ 58,9%): é o efeito do rateio por valor.
    expect(1 - r[0]!.unitCost / 100).toBeCloseTo(1 - r[2]!.unitCost / 15, 2);
  });

  it('não perde centavo no arredondamento (3 cortes iguais de R$ 100)', () => {
    const r = splitBreakdownCost(100, [
      { quantity: 1, salePrice: 10 },
      { quantity: 1, salePrice: 10 },
      { quantity: 1, salePrice: 10 },
    ]);
    expect(r.map((x) => x.totalCost)).toEqual([33.34, 33.33, 33.33]);
    expect(sum(r)).toBe(100);
  });

  it('sem preço em nenhum corte ⇒ rateio por quantidade (mesmo custo/kg)', () => {
    const r = splitBreakdownCost(90, [
      { quantity: 2, salePrice: 0 },
      { quantity: 1, salePrice: 0 },
    ]);
    expect(r).toEqual([
      { totalCost: 60, unitCost: 30 },
      { totalCost: 30, unitCost: 30 },
    ]);
  });

  it('corte sem preço quando os outros têm ⇒ fica sem custo (rateio por valor)', () => {
    const r = splitBreakdownCost(50, [
      { quantity: 2, salePrice: 40 },
      { quantity: 1, salePrice: 0 },
    ]);
    expect(r).toEqual([
      { totalCost: 50, unitCost: 25 },
      { totalCost: 0, unitCost: 0 },
    ]);
  });

  it('peça sem custo ou cortes sem quantidade ⇒ tudo zero', () => {
    expect(splitBreakdownCost(0, [{ quantity: 1, salePrice: 10 }])).toEqual([{ totalCost: 0, unitCost: 0 }]);
    expect(splitBreakdownCost(10, [{ quantity: 0, salePrice: 10 }])).toEqual([{ totalCost: 0, unitCost: 0 }]);
  });
});

describe('breakdownShrink', () => {
  it('peça de 15 kg vira 12,5 kg de cortes ⇒ quebra de 2,5 kg (16,7%)', () => {
    expect(breakdownShrink(15, [4, 6, 2.5])).toEqual({ shrinkQty: 2.5, shrinkPct: 16.7 });
  });

  it('cortes somando mais que a peça ⇒ quebra negativa', () => {
    expect(breakdownShrink(10, [6, 4.5])).toEqual({ shrinkQty: -0.5, shrinkPct: -5 });
  });

  it('peça zero ⇒ percentual 0', () => {
    expect(breakdownShrink(0, [])).toEqual({ shrinkQty: 0, shrinkPct: 0 });
  });
});

describe('suggestBreakdownCuts', () => {
  const pic = { productId: 'pic', name: 'Picanha' };
  const alc = { productId: 'alc', name: 'Alcatra' };
  const apa = { productId: 'apa', name: 'Aparas' };
  const mam = { productId: 'mam', name: 'Maminha' };

  it('desmembramento parcial não encolhe a sugestão: une os anteriores, mais frequentes primeiro', () => {
    // mais recente primeiro: só picanha (peça com perda), depois os completos.
    const r = suggestBreakdownCuts([[pic], [pic, alc, apa], [pic, alc, apa, mam]]);
    expect(r.map((c) => [c.productId, c.times])).toEqual([
      ['pic', 3],
      ['alc', 2],
      ['apa', 2],
      ['mam', 1],
    ]);
  });

  it('empate por nome; corte repetido no mesmo desmembramento conta 1 vez', () => {
    const r = suggestBreakdownCuts([[pic, apa, pic]]);
    expect(r.map((c) => c.name)).toEqual(['Aparas', 'Picanha']);
    expect(r.every((c) => c.times === 1)).toBe(true);
  });

  it('sem histórico ⇒ nada a sugerir', () => {
    expect(suggestBreakdownCuts([])).toEqual([]);
  });
});
