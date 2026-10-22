import { describe, expect, it } from 'vitest';
import { cashOutForReturn, refundSlicesByMethod, splitExchangeCredit } from './index';

// Troca por item mais barato (ADR-033, adendo 2026-10-22): o vale paga a compra nova e a SOBRA volta
// ao cliente por um destino — dinheiro, estorno na forma original ou crédito na loja.
describe('splitExchangeCredit (sobra do vale-troca)', () => {
  it('compra mais barata que o vale: usa o total e sobra a diferença', () => {
    expect(splitExchangeCredit(100, 60)).toEqual({ used: 60, leftover: 40 });
  });

  it('compra igual ao vale: sem sobra', () => {
    expect(splitExchangeCredit(100, 100)).toEqual({ used: 100, leftover: 0 });
  });

  it('compra mais cara que o vale: usa o vale inteiro, sem sobra (cliente paga a diferença)', () => {
    expect(splitExchangeCredit(100, 150)).toEqual({ used: 100, leftover: 0 });
  });

  it('aritmética em centavos (sem erro de ponto flutuante)', () => {
    expect(splitExchangeCredit(0.3, 0.1)).toEqual({ used: 0.1, leftover: 0.2 });
    expect(splitExchangeCredit(89.9, 59.97)).toEqual({ used: 59.97, leftover: 29.93 });
  });

  it('valores inválidos ou negativos contam como 0', () => {
    expect(splitExchangeCredit(NaN, 50)).toEqual({ used: 0, leftover: 0 });
    expect(splitExchangeCredit(-10, 50)).toEqual({ used: 0, leftover: 0 });
    expect(splitExchangeCredit(50, -1)).toEqual({ used: 0, leftover: 50 });
  });
});

describe('sobra do vale: caixa e Recebido por destino', () => {
  // Venda de origem: R$ 100 pagos metade em dinheiro, metade no cartão. Troca por R$ 60 ⇒ sobra 40.
  const pays = [
    { method: 'CASH', amount: 50 },
    { method: 'CREDIT_CARD', amount: 50 },
  ];
  const { leftover } = splitExchangeCredit(100, 60);

  it('dinheiro: a sobra inteira sai da gaveta e abate o Recebido em dinheiro', () => {
    expect(cashOutForReturn('CASH', leftover, pays)).toBe(40);
    expect(refundSlicesByMethod('CASH', leftover, pays)).toEqual([{ method: 'CASH', amount: 40 }]);
  });

  it('estorno na forma original: só a fatia em dinheiro sai da gaveta; o resto é estorno no cartão', () => {
    expect(cashOutForReturn('SAME_AS_PAYMENT', leftover, pays)).toBe(20);
    expect(refundSlicesByMethod('SAME_AS_PAYMENT', leftover, pays)).toEqual([
      { method: 'CASH', amount: 20 },
      { method: 'CREDIT_CARD', amount: 20 },
    ]);
  });

  it('crédito na loja: não toca o caixa nem o Recebido', () => {
    expect(cashOutForReturn('STORE_CREDIT', leftover, pays)).toBe(0);
    expect(refundSlicesByMethod('STORE_CREDIT', leftover, pays)).toEqual([]);
  });
});
