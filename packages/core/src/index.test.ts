import { describe, expect, it } from 'vitest';
import { calcMarginPercent, calcOrderTotal, calcSubtotal } from './index';

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
