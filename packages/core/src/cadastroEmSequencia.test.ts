import { describe, expect, it } from 'vitest';
import { planOpeningCount } from './index';

// =============================================================================
// CADASTRO EM SEQUÊNCIA — contagem de abertura (ADR-041 §A)
// =============================================================================
// Código já cadastrado ⇒ o implantador só informa a quantidade da prateleira. Vira ajuste de
// inventário (ADR-004) pela diferença para o saldo atual; sem movimento quando já confere.

describe('planOpeningCount', () => {
  it('contagem maior que o saldo ⇒ ajuste de ENTRADA pela diferença', () => {
    expect(planOpeningCount({ stockQty: 0 }, 12)).toEqual({ kind: 'adjust', type: 'INCOME', quantity: 12 });
    expect(planOpeningCount({ stockQty: 5, trackStock: true }, 8)).toEqual({
      kind: 'adjust',
      type: 'INCOME',
      quantity: 3,
    });
  });

  it('contagem menor que o saldo ⇒ ajuste de SAÍDA pela diferença', () => {
    expect(planOpeningCount({ stockQty: 10 }, 7)).toEqual({ kind: 'adjust', type: 'EXPENSE', quantity: 3 });
  });

  it('peso com 3 casas: diferença sem ruído de ponto flutuante', () => {
    expect(planOpeningCount({ stockQty: 1.2 }, 2.35)).toEqual({ kind: 'adjust', type: 'INCOME', quantity: 1.15 });
  });

  it('contagem igual ao saldo ⇒ nada a lançar', () => {
    expect(planOpeningCount({ stockQty: 4 }, 4)).toEqual({ kind: 'same' });
    expect(planOpeningCount({ stockQty: 0 }, 0)).toEqual({ kind: 'same' });
  });

  it('produto sem controle de estoque ⇒ não conta (independe da quantidade)', () => {
    expect(planOpeningCount({ stockQty: 0, trackStock: false }, 10)).toEqual({ kind: 'untracked' });
  });
});
