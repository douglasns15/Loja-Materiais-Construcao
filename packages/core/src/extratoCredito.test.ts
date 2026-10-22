import { describe, expect, it } from 'vitest';
import {
  allocateCreditWithdrawal,
  creditSourcesRemaining,
  creditStatement,
  suggestCreditWithdrawalMethod,
} from './index';

// Extrato do crédito do cliente (Contas a Receber → "Com crédito", 2026-10-22): resumo do topo
// (gerado × usado × estornado × saldo) + saldo corrente linha a linha, a partir do livro-razão.
describe('creditStatement (extrato do crédito a favor)', () => {
  it('sem lançamentos: tudo zero', () => {
    expect(creditStatement([])).toEqual({
      opening: 0,
      generated: 0,
      used: 0,
      withdrawn: 0,
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

// Retirada do crédito (2026-10-22): o valor volta ao cliente em dinheiro/PIX/cartão; sai das entradas
// mais antigas primeiro (FIFO), cada parte atribuída à venda de origem (Recebido abatido no dia dela).
describe('creditStatement com retirada', () => {
  it('retirada entra no resumo como "retirado", não como "usado"', () => {
    const s = creditStatement([
      { amount: 22, origin: 'RETURN' },
      { amount: -4.5, origin: 'SALE_USE' },
      { amount: -10, origin: 'WITHDRAWAL' },
    ]);
    expect(s.generated).toBe(22);
    expect(s.used).toBe(4.5);
    expect(s.withdrawn).toBe(10);
    expect(s.balance).toBe(7.5);
    expect(s.running).toEqual([22, 17.5, 7.5]);
  });
});

describe('creditSourcesRemaining (FIFO das entradas)', () => {
  const e = (id: string, amount: number, origin: string, relatedOrderId: string | null = null) => ({
    id,
    amount,
    origin,
    relatedOrderId,
  });

  it('o uso consome a entrada mais antiga primeiro', () => {
    expect(
      creditSourcesRemaining([
        e('c1', 20, 'RETURN', 'A'),
        e('c2', 30, 'RETURN', 'B'),
        e('u1', -25, 'SALE_USE', 'X'),
      ]),
    ).toEqual([{ creditId: 'c2', relatedOrderId: 'B', remaining: 25 }]);
  });

  it('estorno de compra devolve o consumo (a entrada volta a ter saldo)', () => {
    expect(
      creditSourcesRemaining([
        e('c1', 20, 'RETURN', 'A'),
        e('u1', -20, 'SALE_USE', 'X'),
        e('r1', 20, 'SALE_REVERSAL', 'X'),
      ]),
    ).toEqual([{ creditId: 'c1', relatedOrderId: 'A', remaining: 20 }]);
  });

  it('retiradas anteriores também consomem', () => {
    expect(
      creditSourcesRemaining([
        e('c1', 20, 'RETURN', 'A'),
        e('c2', 10, 'RETURN', 'B'),
        e('w1', -20, 'WITHDRAWAL', 'A'),
      ]),
    ).toEqual([{ creditId: 'c2', relatedOrderId: 'B', remaining: 10 }]);
  });

  it('tudo consumido: nada resta', () => {
    expect(creditSourcesRemaining([e('c1', 5, 'RETURN', 'A'), e('u1', -5, 'SALE_USE')])).toEqual([]);
  });
});

describe('allocateCreditWithdrawal (partes por venda de origem)', () => {
  it('cabe na entrada mais antiga: uma parte só', () => {
    expect(
      allocateCreditWithdrawal(
        [
          { creditId: 'c1', relatedOrderId: 'A', remaining: 17.5 },
          { creditId: 'c2', relatedOrderId: 'B', remaining: 10 },
        ],
        10,
      ),
    ).toEqual([{ relatedOrderId: 'A', amount: 10 }]);
  });

  it('passa da mais antiga: reparte em duas vendas', () => {
    expect(
      allocateCreditWithdrawal(
        [
          { creditId: 'c1', relatedOrderId: 'A', remaining: 17.5 },
          { creditId: 'c2', relatedOrderId: 'B', remaining: 10 },
        ],
        20,
      ),
    ).toEqual([
      { relatedOrderId: 'A', amount: 17.5 },
      { relatedOrderId: 'B', amount: 2.5 },
    ]);
  });

  it('duas entradas da mesma venda somam numa parte', () => {
    expect(
      allocateCreditWithdrawal(
        [
          { creditId: 'c1', relatedOrderId: 'A', remaining: 5 },
          { creditId: 'c2', relatedOrderId: 'A', remaining: 5 },
        ],
        8,
      ),
    ).toEqual([{ relatedOrderId: 'A', amount: 8 }]);
  });

  it('valor além do que as entradas explicam vira parte sem venda', () => {
    expect(allocateCreditWithdrawal([{ creditId: 'c1', relatedOrderId: 'A', remaining: 5 }], 7)).toEqual([
      { relatedOrderId: 'A', amount: 5 },
      { relatedOrderId: null, amount: 2 },
    ]);
  });

  it('centavos sem erro de ponto flutuante', () => {
    expect(
      allocateCreditWithdrawal(
        [
          { creditId: 'c1', relatedOrderId: 'A', remaining: 0.1 },
          { creditId: 'c2', relatedOrderId: 'B', remaining: 0.2 },
        ],
        0.3,
      ),
    ).toEqual([
      { relatedOrderId: 'A', amount: 0.1 },
      { relatedOrderId: 'B', amount: 0.2 },
    ]);
  });
});

describe('suggestCreditWithdrawalMethod (sugestão = forma da venda de origem)', () => {
  it('forma única', () => {
    expect(suggestCreditWithdrawalMethod([{ method: 'PIX', amount: 22 }])).toBe('PIX');
  });

  it('formas misturadas: a de maior valor', () => {
    expect(
      suggestCreditWithdrawalMethod([
        { method: 'CASH', amount: 10 },
        { method: 'CREDIT_CARD', amount: 30 },
      ]),
    ).toBe('CREDIT_CARD');
  });

  it('ignora crédito da loja e vale-troca', () => {
    expect(
      suggestCreditWithdrawalMethod([
        { method: 'STORE_CREDIT', amount: 50 },
        { method: 'DEBIT_CARD', amount: 5 },
      ]),
    ).toBe('DEBIT_CARD');
  });

  it('sem pagamento de balcão (ex.: a prazo) ou sem venda: Dinheiro', () => {
    expect(suggestCreditWithdrawalMethod([])).toBe('CASH');
    expect(suggestCreditWithdrawalMethod([{ method: 'EXCHANGE_CREDIT', amount: 9 }])).toBe('CASH');
  });
});
