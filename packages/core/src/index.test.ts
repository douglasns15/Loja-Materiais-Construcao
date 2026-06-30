import { describe, expect, it } from 'vitest';
import {
  applyStockMovement,
  calcCashDivergence,
  calcExpectedCash,
  calcInventoryAdjustment,
  calcMarginPercent,
  calcOrderTotal,
  calcSaleItemTotal,
  calcSaleTotals,
  calcSubtotal,
  reconcileStock,
} from './index';

describe('calcSubtotal', () => {
  it('soma os totais das linhas', () => {
    expect(calcSubtotal([{ total: 10 }, { total: 5.5 }])).toBe(15.5);
  });

  it('retorna 0 para pedido vazio', () => {
    expect(calcSubtotal([])).toBe(0);
  });
});

describe('calcOrderTotal', () => {
  it('aplica desconto e frete sobre o subtotal', () => {
    expect(
      calcOrderTotal({ subtotal: 100, discountAmount: 10, freightAmount: 25 }),
    ).toBe(115);
  });

  it('usa 0 como padrão para desconto e frete', () => {
    expect(calcOrderTotal({ subtotal: 100 })).toBe(100);
  });
});

describe('calcMarginPercent', () => {
  it('calcula a margem sobre o preço de venda', () => {
    expect(calcMarginPercent(60, 100)).toBe(40);
  });

  it('retorna 0 quando o preço de venda é 0', () => {
    expect(calcMarginPercent(60, 0)).toBe(0);
  });

  it('aceita margem negativa (venda abaixo do custo)', () => {
    expect(calcMarginPercent(120, 100)).toBe(-20);
  });

  it('arredonda a 2 casas', () => {
    expect(calcMarginPercent(10, 30)).toBe(66.67);
  });
});

describe('calcExpectedCash', () => {
  it('soma abertura + entradas em dinheiro', () => {
    expect(calcExpectedCash(100, [50, 25.5])).toBe(175.5);
  });

  it('retorna a abertura quando não há entradas', () => {
    expect(calcExpectedCash(100, [])).toBe(100);
  });
});

describe('calcCashDivergence', () => {
  it('zero quando o contado bate com o esperado', () => {
    expect(calcCashDivergence(175.5, 175.5)).toBe(0);
  });

  it('positivo quando sobra dinheiro', () => {
    expect(calcCashDivergence(175.5, 180)).toBe(4.5);
  });

  it('negativo quando falta dinheiro', () => {
    expect(calcCashDivergence(175.5, 170)).toBe(-5.5);
  });
});

describe('calcSaleItemTotal', () => {
  it('quantidade × preço − desconto', () => {
    expect(calcSaleItemTotal({ quantity: 3, unitPrice: 10, discount: 5 })).toBe(25);
  });

  it('sem desconto', () => {
    expect(calcSaleItemTotal({ quantity: 2.5, unitPrice: 4 })).toBe(10);
  });
});

describe('calcSaleTotals', () => {
  it('subtotal e total com desconto e frete', () => {
    const r = calcSaleTotals(
      [
        { quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 5 },
      ],
      { discountAmount: 3, freightAmount: 8 },
    );
    expect(r.subtotal).toBe(25);
    expect(r.total).toBe(30);
  });

  it('total = subtotal quando sem desconto/frete', () => {
    const r = calcSaleTotals([{ quantity: 4, unitPrice: 2.5 }]);
    expect(r.subtotal).toBe(10);
    expect(r.total).toBe(10);
  });
});

describe('applyStockMovement', () => {
  it('INCOME soma ao estoque atual', () => {
    expect(applyStockMovement(10, 'INCOME', 5)).toBe(15);
  });

  it('EXPENSE subtrai do estoque atual', () => {
    expect(applyStockMovement(10, 'EXPENSE', 4)).toBe(6);
  });

  it('mantém a precisão de 4 casas (unidades fracionadas)', () => {
    expect(applyStockMovement(2.5, 'INCOME', 0.125)).toBe(2.625);
  });
});

describe('reconcileStock', () => {
  it('saldo = Σ INCOME − Σ EXPENSE (ADR-001)', () => {
    expect(
      reconcileStock([
        { type: 'INCOME', quantity: 100 },
        { type: 'EXPENSE', quantity: 30 },
        { type: 'EXPENSE', quantity: 4 },
      ]),
    ).toBe(66);
  });

  it('retorna 0 quando não há movimentações', () => {
    expect(reconcileStock([])).toBe(0);
  });
});

describe('calcInventoryAdjustment', () => {
  it('contagem menor → EXPENSE da diferença', () => {
    expect(calcInventoryAdjustment(10, 7)).toEqual({ type: 'EXPENSE', quantity: 3 });
  });

  it('contagem maior → INCOME da diferença', () => {
    expect(calcInventoryAdjustment(10, 12)).toEqual({ type: 'INCOME', quantity: 2 });
  });

  it('contagem igual → quantidade 0 (nada a fazer)', () => {
    expect(calcInventoryAdjustment(10, 10)).toEqual({ type: 'INCOME', quantity: 0 });
  });
});
