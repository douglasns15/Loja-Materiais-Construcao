import { describe, expect, it } from 'vitest';
import {
  buildScaleBarcode,
  calcSaleItemTotal,
  DEFAULT_SCALE_LABEL_LAYOUT,
  normalizeScaleCode,
  parseScaleBarcode,
  scaleLabelLine,
  type ScaleLabelLayout,
} from './index';

// =============================================================================
// ETIQUETA DE BALANÇA (ADR-040 §3)
// =============================================================================

const P4: ScaleLabelLayout = { pluDigits: 4, value: 'PRICE' };
const P5: ScaleLabelLayout = { pluDigits: 5, value: 'PRICE' };
const W4: ScaleLabelLayout = { pluDigits: 4, value: 'WEIGHT' };

describe('parseScaleBarcode', () => {
  it('lê o exemplo do ADR: PLU 0123, R$ 24,68 (layout padrão: 4 dígitos + preço)', () => {
    expect(DEFAULT_SCALE_LABEL_LAYOUT).toEqual(P4);
    expect(parseScaleBarcode('2012300024684', P4)).toEqual({ plu: '123', priceCents: 2468 });
  });

  it('PLU de 5 dígitos (sem o dígito de preenchimento)', () => {
    const code = buildScaleBarcode('01234', 2468, P5);
    expect(code).toHaveLength(13);
    expect(parseScaleBarcode(code, P5)).toEqual({ plu: '1234', priceCents: 2468 });
  });

  it('layout de peso: o valor são gramas', () => {
    expect(parseScaleBarcode(buildScaleBarcode(123, 412, W4), W4)).toEqual({ plu: '123', grams: 412 });
  });

  it('ignora espaços/hífen do leitor', () => {
    expect(parseScaleBarcode('2 0123 0 002468 4', P4)).toEqual({ plu: '123', priceCents: 2468 });
  });

  it('não é etiqueta ⇒ null (o PDV segue a busca normal)', () => {
    expect(parseScaleBarcode('2012300024683', P4)).toBeNull(); // dígito verificador errado
    expect(parseScaleBarcode('7891000100103', P4)).toBeNull(); // EAN de fabricante (não começa com 2)
    expect(parseScaleBarcode('201230002468', P4)).toBeNull(); // 12 dígitos
    expect(parseScaleBarcode(buildScaleBarcode(0, 2468, P4), P4)).toBeNull(); // PLU zero
    expect(parseScaleBarcode(buildScaleBarcode(123, 0, P4), P4)).toBeNull(); // valor zero
    expect(parseScaleBarcode('ABC', P4)).toBeNull();
  });
});

describe('buildScaleBarcode', () => {
  it('é o inverso do parse e recusa PLU/valor maiores que o layout', () => {
    expect(buildScaleBarcode('0123', 2468, P4)).toBe('2012300024684');
    expect(() => buildScaleBarcode('12345', 1, P4)).toThrow();
    expect(() => buildScaleBarcode('1', 1_000_000, P4)).toThrow();
  });
});

describe('normalizeScaleCode', () => {
  it('compara PLU sem zeros à esquerda', () => {
    expect(normalizeScaleCode('0123')).toBe('123');
    expect(normalizeScaleCode(' 45 ')).toBe('45');
    expect(normalizeScaleCode('0000')).toBeNull();
    expect(normalizeScaleCode('')).toBeNull();
    expect(normalizeScaleCode(null)).toBeNull();
  });
});

describe('scaleLabelLine', () => {
  it('PRICE: o total impresso manda; quantidade a 3 casas só para o estoque', () => {
    const line = scaleLabelLine({ plu: '123', priceCents: 2468 }, 59.9)!;
    expect(line.quantity).toBe(0.412);
    expect(line.total).toBe(24.68);
    expect(calcSaleItemTotal({ quantity: line.quantity, unitPrice: line.unitPrice })).toBe(24.68);
  });

  it('PRICE: fecha no centavo impresso para qualquer valor (varredura)', () => {
    for (const price of [4.99, 12.9, 39.9, 59.9, 89.9, 149.9]) {
      for (let cents = 1; cents <= 30000; cents += 37) {
        const line = scaleLabelLine({ plu: '1', priceCents: cents }, price)!;
        expect(line.quantity).toBeGreaterThanOrEqual(0.001);
        expect(calcSaleItemTotal({ quantity: line.quantity, unitPrice: line.unitPrice })).toBe(cents / 100);
      }
    }
  });

  it('WEIGHT: quantidade = gramas ÷ 1000, preço do cadastro', () => {
    expect(scaleLabelLine({ plu: '123', grams: 412 }, 59.9)).toEqual({ quantity: 0.412, unitPrice: 59.9, total: 24.68 });
  });

  it('preço do cadastro zerado ⇒ null (não há como converter)', () => {
    expect(scaleLabelLine({ plu: '123', priceCents: 2468 }, 0)).toBeNull();
  });
});
