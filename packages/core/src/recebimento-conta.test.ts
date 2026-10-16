import { describe, expect, it } from 'vitest';
import {
  cashReceiptChange,
  receiptCardSurcharge,
  receivableSurchargeRate,
  type ReceiptSurchargeReceivable,
} from './index';

// =============================================================================
// Recebimento da conta (Contas a Receber) igual ao PDV — acréscimo de cartão e troco (2026-10-16)
// =============================================================================

describe('receivableSurchargeRate — acréscimo por R$ 1 da venda', () => {
  it('cimento a R$37 com +R$1,50 no crédito: 2 sacos = R$3 de acréscimo sobre R$74', () => {
    const rate = receivableSurchargeRate([{ total: 74, baseQuantity: 2, surchargePerBase: 1.5 }]);
    expect(rate * 74).toBeCloseTo(3, 10);
  });

  it('mistura item com e sem acréscimo: a taxa é a média ponderada pelo valor', () => {
    const rate = receivableSurchargeRate([
      { total: 74, baseQuantity: 2, surchargePerBase: 1.5 }, // +3
      { total: 26, baseQuantity: 1, surchargePerBase: 0 }, // sem acréscimo
    ]);
    expect(rate * 100).toBeCloseTo(3, 10);
  });

  it('unidade fechada: o acréscimo é por unidade-base (rolo de 100 m a R$0,02/m sobe R$2)', () => {
    const rate = receivableSurchargeRate([{ total: 150, baseQuantity: 100, surchargePerBase: 0.02 }]);
    expect(rate * 150).toBeCloseTo(2, 10);
  });

  it('devolução tira a parte devolvida do acréscimo e do valor', () => {
    // 4 sacos (R$148, +R$6). Voltaram 2: fica R$74 com +R$3.
    const rate = receivableSurchargeRate([
      { total: 148, baseQuantity: 4, returnedBaseQty: 2, surchargePerBase: 1.5 },
    ]);
    expect(rate * 74).toBeCloseTo(3, 10);
  });

  it('sem acréscimo, item todo devolvido ou quantidade zero ⇒ 0', () => {
    expect(receivableSurchargeRate([{ total: 50, baseQuantity: 1, surchargePerBase: 0 }])).toBe(0);
    expect(
      receivableSurchargeRate([{ total: 50, baseQuantity: 2, returnedBaseQty: 2, surchargePerBase: 1 }]),
    ).toBe(0);
    expect(receivableSurchargeRate([{ total: 50, baseQuantity: 0, surchargePerBase: 1 }])).toBe(0);
    expect(receivableSurchargeRate([])).toBe(0);
  });

  it('aceita números vindos como string do JSON (Decimal do Prisma)', () => {
    const rate = receivableSurchargeRate([
      { total: '74' as unknown as number, baseQuantity: '2' as unknown as number, surchargePerBase: 1.5 },
    ]);
    expect(rate * 74).toBeCloseTo(3, 10);
  });
});

describe('receiptCardSurcharge — acréscimo do recebimento pelo FIFO do servidor', () => {
  // Venda A (mais antiga): R$74 de cimento, +R$3 no crédito. Venda B: R$100 de areia, sem acréscimo.
  const vendas: ReceiptSurchargeReceivable[] = [
    { id: 'A', balance: 74, items: [{ total: 74, baseQuantity: 2, surchargePerBase: 1.5 }] },
    { id: 'B', balance: 100, items: [{ total: 100, baseQuantity: 1, surchargePerBase: 0 }] },
  ];

  it('quitar tudo ⇒ o acréscimo cheio (R$3)', () => {
    expect(receiptCardSurcharge(174, vendas)).toBe(3);
  });

  it('parcial cobre só parte da venda mais antiga ⇒ proporcional (R$37 → R$1,50)', () => {
    expect(receiptCardSurcharge(37, vendas)).toBe(1.5);
  });

  it('o que passa da venda mais antiga cai na seguinte (sem acréscimo) ⇒ só o da A', () => {
    expect(receiptCardSurcharge(120, vendas)).toBe(3);
  });

  it('parte da venda já paga à vista: o acréscimo segue o que falta (saldo R$37 ⇒ R$1,50)', () => {
    const r: ReceiptSurchargeReceivable[] = [
      { id: 'A', balance: 37, items: [{ total: 74, baseQuantity: 2, surchargePerBase: 1.5 }] },
    ];
    expect(receiptCardSurcharge(37, r)).toBe(1.5);
  });

  it('arredonda ao centavo', () => {
    // R$10 sobre venda de R$30 com +R$1 ⇒ 0,3333… ⇒ R$0,33
    const r: ReceiptSurchargeReceivable[] = [
      { id: 'X', balance: 30, items: [{ total: 30, baseQuantity: 1, surchargePerBase: 1 }] },
    ];
    expect(receiptCardSurcharge(10, r)).toBe(0.33);
  });

  it('valor zero/negativo ou sem vendas ⇒ 0', () => {
    expect(receiptCardSurcharge(0, vendas)).toBe(0);
    expect(receiptCardSurcharge(-5, vendas)).toBe(0);
    expect(receiptCardSurcharge(50, [])).toBe(0);
  });
});

describe('cashReceiptChange — troco no recebimento em dinheiro', () => {
  it('entregou mais ⇒ troco', () => {
    expect(cashReceiptChange(87.5, 100)).toEqual({ change: 12.5, short: 0 });
  });

  it('valor exato ⇒ sem troco', () => {
    expect(cashReceiptChange(50, 50)).toEqual({ change: 0, short: 0 });
  });

  it('entregou menos ⇒ falta', () => {
    expect(cashReceiptChange(50, 40)).toEqual({ change: 0, short: 10 });
  });

  it('campo vazio/0 ⇒ assume valor exato', () => {
    expect(cashReceiptChange(50, null)).toEqual({ change: 0, short: 0 });
    expect(cashReceiptChange(50, 0)).toEqual({ change: 0, short: 0 });
  });

  it('sem erro de ponto flutuante (0,1 + 0,2)', () => {
    expect(cashReceiptChange(0.3, 0.5)).toEqual({ change: 0.2, short: 0 });
  });
});
