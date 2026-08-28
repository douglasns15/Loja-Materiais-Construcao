import { describe, it, expect } from 'vitest';
import { planReorder, type ReorderSourceItem, type ReorderProductInfo } from './index';

/** Catálogo de teste: id → {nome vivo, estoque livre em unidade-base}. */
function catalog(entries: Record<string, ReorderProductInfo>): Map<string, ReorderProductInfo> {
  return new Map(Object.entries(entries));
}

function item(
  productId: string,
  quantity: number,
  opts: Partial<Omit<ReorderSourceItem, 'productId' | 'quantity'>> = {},
): ReorderSourceItem {
  return {
    productId,
    productName: opts.productName ?? productId,
    saleMode: opts.saleMode ?? 'BASE',
    quantity,
    factorToBase: opts.factorToBase ?? 1,
  };
}

describe('planReorder — combinar e mesclar vendas', () => {
  it('produto único, estoque de sobra: entra inteiro, sem mesclagem', () => {
    const plan = planReorder([item('cimento', 5)], catalog({ cimento: { name: 'Cimento CP-II', baseStock: 100 } }));
    expect(plan.lineCount).toBe(1);
    expect(plan.lines[0]).toMatchObject({ productId: 'cimento', quantity: 5, sources: 1, status: 'ok' });
    // O nome vem do catálogo ATUAL, não do snapshot.
    expect(plan.lines[0]!.name).toBe('Cimento CP-II');
    expect(plan.mergedCount).toBe(0);
    expect(plan.clampedCount).toBe(0);
  });

  it('mesmo produto/modo em vendas diferentes: soma as quantidades numa linha só (mesclada)', () => {
    const plan = planReorder(
      [item('cimento', 10), item('areia', 2), item('cimento', 5)],
      catalog({ cimento: { name: 'Cimento', baseStock: 100 }, areia: { name: 'Areia', baseStock: 100 } }),
    );
    const cimento = plan.lines.find((l) => l.productId === 'cimento')!;
    expect(cimento.quantity).toBe(15);
    expect(cimento.sources).toBe(2); // duas origens mescladas
    expect(plan.mergedCount).toBe(1);
    expect(plan.lineCount).toBe(2);
  });

  it('mesmo produto em modos diferentes (base e embalagem): duas linhas separadas', () => {
    const plan = planReorder(
      [item('perfil', 3, { saleMode: 'BASE', factorToBase: 1 }), item('perfil', 1, { saleMode: 'ALT', factorToBase: 6 })],
      catalog({ perfil: { name: 'Perfil', baseStock: 100 } }),
    );
    expect(plan.lineCount).toBe(2);
    expect(plan.mergedCount).toBe(0); // modos diferentes NÃO mesclam
  });

  it('produto que sumiu do catálogo (arquivado/apagado): fica de fora, listado uma vez', () => {
    const plan = planReorder(
      [item('fantasma', 4, { productName: 'Tinta Antiga' }), item('fantasma', 1, { productName: 'Tinta Antiga' })],
      catalog({}),
    );
    expect(plan.lineCount).toBe(0);
    expect(plan.missing).toEqual([{ productId: 'fantasma', name: 'Tinta Antiga' }]);
  });

  it('estoque insuficiente: a linha entra APARADA (clamped) até o que cabe', () => {
    const plan = planReorder([item('cimento', 30)], catalog({ cimento: { name: 'Cimento', baseStock: 12 } }));
    expect(plan.lines[0]).toMatchObject({ requestedQuantity: 30, quantity: 12, status: 'clamped' });
    expect(plan.clampedCount).toBe(1);
  });

  it('estoque zero: produto pedido mas nada cabe → outOfStock, não vira linha', () => {
    const plan = planReorder([item('cimento', 5)], catalog({ cimento: { name: 'Cimento', baseStock: 0 } }));
    expect(plan.lineCount).toBe(0);
    expect(plan.outOfStock).toEqual([{ productId: 'cimento', name: 'Cimento' }]);
  });

  it('rateio de estoque entre modos do mesmo produto respeita a ordem e o estoque compartilhado', () => {
    // Estoque-base = 10. 1ª linha: 1 rolo × fator 6 = 6 base (cabe). 2ª linha: 8 m base — sobram só 4.
    const plan = planReorder(
      [item('cabo', 1, { saleMode: 'ALT', factorToBase: 6 }), item('cabo', 8, { saleMode: 'BASE', factorToBase: 1 })],
      catalog({ cabo: { name: 'Cabo', baseStock: 10 } }),
    );
    const rolo = plan.lines.find((l) => l.saleMode === 'ALT')!;
    const metro = plan.lines.find((l) => l.saleMode === 'BASE')!;
    expect(rolo).toMatchObject({ quantity: 1, status: 'ok' });
    expect(metro).toMatchObject({ quantity: 4, status: 'clamped' }); // 10 − 6 = 4 base restante
  });

  it('quantidade fracionada (metro) mescla e soma corretamente', () => {
    const plan = planReorder(
      [item('cano', 2.5, { factorToBase: 1 }), item('cano', 1.5, { factorToBase: 1 })],
      catalog({ cano: { name: 'Cano PVC', baseStock: 50 } }),
    );
    expect(plan.lines[0]!.quantity).toBe(4);
    expect(plan.lines[0]!.sources).toBe(2);
  });

  it('sem origens: plano vazio', () => {
    const plan = planReorder([], catalog({}));
    expect(plan).toMatchObject({ lineCount: 0, mergedCount: 0, clampedCount: 0, missing: [], outOfStock: [] });
  });
});
