import { describe, expect, it } from 'vitest';
import { creditStatement } from './index';

// Extrato do crédito do cliente (Contas a Receber → "Com crédito", 2026-10-22): resumo do topo
// (gerado × usado × estornado × saldo) + saldo corrente linha a linha, a partir do livro-razão.
describe('creditStatement (extrato do crédito a favor)', () => {
  it('sem lançamentos: tudo zero', () => {
    expect(creditStatement([])).toEqual({
      opening: 0,
      generated: 0,
      used: 0,
      reversed: 0,
      netUsed: 0,
      balance: 0,
      running: [],
    });
  });

  it('gerou na devolução, usou parte numa compra: sobra o resto', () => {
    const s = creditStatement([
      { amount: 100, origin: 'RETURN' },
      { amount: -30, origin: 'SALE_USE' },
    ]);
    expect(s.generated).toBe(100);
    expect(s.used).toBe(30);
    expect(s.netUsed).toBe(30);
    expect(s.balance).toBe(70);
    expect(s.running).toEqual([100, 70]);
  });

  it('venda que usou crédito foi cancelada: o estorno volta ao saldo e abate o uso líquido', () => {
    const s = creditStatement([
      { amount: 50, origin: 'RETURN' },
      { amount: -50, origin: 'SALE_USE' },
      { amount: 50, origin: 'SALE_REVERSAL' },
    ]);
    expect(s.generated).toBe(50); // o estorno NÃO conta como crédito novo
    expect(s.used).toBe(50);
    expect(s.reversed).toBe(50);
    expect(s.netUsed).toBe(0);
    expect(s.balance).toBe(50);
    expect(s.running).toEqual([50, 0, 50]);
  });

  it('vários créditos (devolução + sobra de troca) e vários usos', () => {
    const s = creditStatement([
      { amount: 40, origin: 'RETURN' },
      { amount: 25.5, origin: 'RETURN' },
      { amount: -10, origin: 'SALE_USE' },
      { amount: -20.25, origin: 'SALE_USE' },
    ]);
    expect(s.generated).toBe(65.5);
    expect(s.used).toBe(30.25);
    expect(s.balance).toBe(35.25);
    expect(s.running).toEqual([40, 65.5, 55.5, 35.25]);
  });

  it('ajuste manual: positivo conta como gerado, negativo como usado', () => {
    const s = creditStatement([
      { amount: 10, origin: 'MANUAL' },
      { amount: -4, origin: 'MANUAL' },
    ]);
    expect(s.generated).toBe(10);
    expect(s.used).toBe(4);
    expect(s.balance).toBe(6);
  });

  it('extrato truncado: parte do saldo anterior', () => {
    const s = creditStatement([{ amount: -5, origin: 'SALE_USE' }], 20);
    expect(s.opening).toBe(20);
    expect(s.balance).toBe(15);
    expect(s.running).toEqual([15]);
  });

  it('aritmética em centavos (sem erro de ponto flutuante)', () => {
    const s = creditStatement([
      { amount: 0.1, origin: 'RETURN' },
      { amount: 0.2, origin: 'RETURN' },
      { amount: -0.3, origin: 'SALE_USE' },
    ]);
    expect(s.generated).toBe(0.3);
    expect(s.balance).toBe(0);
    expect(s.running).toEqual([0.1, 0.3, 0]);
  });

  it('valores inválidos contam como 0', () => {
    const s = creditStatement([{ amount: Number.NaN, origin: 'RETURN' }], Number.NaN);
    expect(s.balance).toBe(0);
    expect(s.running).toEqual([0]);
  });
});
