import { describe, expect, it } from 'vitest';
import {
  calcSaleItemTotal,
  isValidQuantity,
  quantityRuleFor,
  roundQuantity,
  stepQuantity,
} from './index';

// =============================================================================
// Regra de quantidade por unidade — venda fracionada por kg/L (ADR-040 §1)
// =============================================================================

describe('quantityRuleFor', () => {
  it('kg e litro: passo 0,1 nos botões, 3 casas, mínimo 1 g/1 mL', () => {
    for (const unit of ['KILOGRAM', 'LITER']) {
      expect(quantityRuleFor(unit)).toEqual({ step: 0.1, decimals: 3, min: 0.001, strictStep: false });
    }
  });

  it('corte de barra/rolo (ADR-017): múltiplos de 0,5 m', () => {
    expect(quantityRuleFor('METER', { closedCut: true })).toEqual({
      step: 0.5,
      decimals: 1,
      min: 0.5,
      strictStep: true,
    });
  });

  it('pacote aberto (ADR-030): unidade inteira', () => {
    expect(quantityRuleFor('UNIT', { closedCut: true })).toEqual({ step: 1, decimals: 0, min: 1, strictStep: true });
  });

  it('demais unidades: passo 1 e sem travar decimais digitados (até o ledger, 4 casas)', () => {
    for (const unit of ['UNIT', 'METER', 'SQUARE_METER', 'BAG', 'ROLL', 'BARRA', 'PACK', 'THOUSAND']) {
      const r = quantityRuleFor(unit);
      expect(r.step).toBe(1);
      expect(r.decimals).toBe(4);
      expect(r.strictStep).toBe(false);
    }
  });
});

describe('isValidQuantity', () => {
  const kg = quantityRuleFor('KILOGRAM');

  it('kg aceita até 3 casas', () => {
    expect(isValidQuantity(0.412, kg)).toBe(true);
    expect(isValidQuantity(1.2, kg)).toBe(true);
    expect(isValidQuantity(0.001, kg)).toBe(true);
    expect(isValidQuantity(3, kg)).toBe(true);
  });

  it('kg rejeita 4ª casa, zero, negativo e não-número', () => {
    expect(isValidQuantity(0.4125, kg)).toBe(false);
    expect(isValidQuantity(0, kg)).toBe(false);
    expect(isValidQuantity(0.0004, kg)).toBe(false);
    expect(isValidQuantity(-1, kg)).toBe(false);
    expect(isValidQuantity(Number.NaN, kg)).toBe(false);
    expect(isValidQuantity(Number.POSITIVE_INFINITY, kg)).toBe(false);
  });

  it('tolera ruído de ponto flutuante (0,1 + 0,2)', () => {
    expect(isValidQuantity(0.1 + 0.2, kg)).toBe(true);
  });

  it('corte por metro segue exigindo múltiplos de 0,5 m', () => {
    const m = quantityRuleFor('METER', { closedCut: true });
    expect(isValidQuantity(1.5, m)).toBe(true);
    expect(isValidQuantity(0.5, m)).toBe(true);
    expect(isValidQuantity(0.7, m)).toBe(false);
    expect(isValidQuantity(0.25, m)).toBe(false);
  });

  it('pacote aberto exige inteiro', () => {
    const un = quantityRuleFor('UNIT', { closedCut: true });
    expect(isValidQuantity(2, un)).toBe(true);
    expect(isValidQuantity(1.5, un)).toBe(false);
  });

  it('unidade comum não trava decimal digitado', () => {
    expect(isValidQuantity(2.5, quantityRuleFor('SQUARE_METER'))).toBe(true);
    expect(isValidQuantity(3, quantityRuleFor('UNIT'))).toBe(true);
  });
});

describe('roundQuantity', () => {
  it('kg arredonda a 3 casas', () => {
    const kg = quantityRuleFor('KILOGRAM');
    expect(roundQuantity(0.4125, kg)).toBe(0.413);
    expect(roundQuantity(0.1 + 0.2, kg)).toBe(0.3);
  });
});

describe('stepQuantity', () => {
  const kg = quantityRuleFor('KILOGRAM');

  it('kg anda de 0,1 em 0,1 sem ruído', () => {
    expect(stepQuantity(0.412, 1, kg)).toBe(0.512);
    expect(stepQuantity(0.2, 1, kg)).toBe(0.3);
    expect(stepQuantity(1, -1, kg)).toBe(0.9);
  });

  it('pode chegar a ≤ 0 (o carrinho remove a linha)', () => {
    expect(stepQuantity(0.05, -1, kg)).toBeLessThanOrEqual(0);
  });

  it('metro de barra anda de 0,5; unidade comum de 1', () => {
    expect(stepQuantity(1.5, 1, quantityRuleFor('METER', { closedCut: true }))).toBe(2);
    expect(stepQuantity(3, -1, quantityRuleFor('UNIT'))).toBe(2);
  });
});

describe('total da linha vendida por peso', () => {
  it('0,412 kg a R$ 59,90/kg = R$ 24,68 (arredondado ao centavo)', () => {
    expect(calcSaleItemTotal({ quantity: 0.412, unitPrice: 59.9 })).toBe(24.68);
  });

  it('1,2 kg a R$ 45,90/kg = R$ 55,08', () => {
    expect(calcSaleItemTotal({ quantity: 1.2, unitPrice: 45.9 })).toBe(55.08);
  });
});
