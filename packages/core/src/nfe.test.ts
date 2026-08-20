import { describe, expect, it } from 'vitest';
import { nfeConvertedQuantity, nfeConvertedUnitCost, suggestNfeFactor } from './index';

// =============================================================================
// Conversão de unidade comercial na importação de NF-e (ADR-025 §5.B, Fatia 2.B)
// =============================================================================

describe('suggestNfeFactor — fator de embalagem sugerido pela nota', () => {
  it('usa qTrib÷qCom quando dá um inteiro limpo (2 CX → 24 UN ⇒ 12)', () => {
    expect(suggestNfeFactor(2, 24)).toBe(12);
  });

  it('unidades iguais (qTrib = qCom) ⇒ fator 1 (sem conversão)', () => {
    expect(suggestNfeFactor(10, 10)).toBe(1);
  });

  it('tolera ruído decimal e arredonda ao inteiro próximo (11,995 ⇒ 12)', () => {
    expect(suggestNfeFactor(2, 23.99)).toBe(12);
  });

  it('fator não-inteiro fora da tolerância ⇒ 1 (operador ajusta à mão)', () => {
    expect(suggestNfeFactor(2, 24.5)).toBe(1); // 12,25
    expect(suggestNfeFactor(3, 10)).toBe(1); // 3,333…
  });

  it('tributável menor que a comercial (fator < 1) ⇒ 1', () => {
    expect(suggestNfeFactor(10, 5)).toBe(1);
  });

  it('quantidades ausentes/zeradas/negativas ⇒ 1 (nunca NaN/Infinity)', () => {
    expect(suggestNfeFactor(0, 24)).toBe(1);
    expect(suggestNfeFactor(2, 0)).toBe(1);
    expect(suggestNfeFactor(-2, 24)).toBe(1);
  });

  it('fatores grandes também passam (1 fardo → 1000 un)', () => {
    expect(suggestNfeFactor(1, 1000)).toBe(1000);
  });
});

describe('nfeConvertedQuantity — quantidade que entra no estoque', () => {
  it('multiplica pela embalagem (2 CX × 12 = 24 UN)', () => {
    expect(nfeConvertedQuantity(2, 12)).toBe(24);
  });

  it('fator 1 é identidade', () => {
    expect(nfeConvertedQuantity(7, 1)).toBe(7);
  });

  it('fator inválido (≤ 0) é tratado como 1 (não zera nem inverte o estoque)', () => {
    expect(nfeConvertedQuantity(7, 0)).toBe(7);
    expect(nfeConvertedQuantity(7, -3)).toBe(7);
  });

  it('arredonda a 4 casas', () => {
    expect(nfeConvertedQuantity(1.5, 3)).toBe(4.5);
  });
});

describe('nfeConvertedUnitCost — custo por unidade de venda', () => {
  it('divide pelo fator (R$ 60,00/CX ÷ 12 = R$ 5,00/UN)', () => {
    expect(nfeConvertedUnitCost(60, 12)).toBe(5);
  });

  it('fator 1 é identidade', () => {
    expect(nfeConvertedUnitCost(5.94, 1)).toBe(5.94);
  });

  it('fator inválido (≤ 0) é tratado como 1', () => {
    expect(nfeConvertedUnitCost(60, 0)).toBe(60);
  });

  it('arredonda a 4 casas (10 ÷ 3 = 3,3333)', () => {
    expect(nfeConvertedUnitCost(10, 3)).toBe(3.3333);
  });

  it('ida-e-volta: custo×fator reconstrói o total comercial no centavo', () => {
    const factor = 12;
    const vUnCom = 60;
    const perUnit = nfeConvertedUnitCost(vUnCom, factor); // 5
    expect(Number((perUnit * factor).toFixed(2))).toBe(vUnCom);
  });
});
