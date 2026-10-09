import { describe, expect, it } from 'vitest';
import {
  buildScaleBarcode,
  calcSaleItemTotal,
  DEFAULT_SCALE_LABEL_LAYOUT,
  normalizeScaleCode,
  parseScaleBarcode,
  SCALE_LABEL_FORMATS,
  scaleLabelLine,
  scaleLabelPattern,
  scaleLayoutFits,
  type ScaleLabelLayout,
} from './index';

// =============================================================================
// ETIQUETA DE BALANÇA (ADR-040 §3)
// =============================================================================

const P4: ScaleLabelLayout = { pluDigits: 4, valueDigits: 6, valueCheckDigit: false, value: 'PRICE' };
const P5: ScaleLabelLayout = { pluDigits: 5, valueDigits: 6, valueCheckDigit: false, value: 'PRICE' };
const W4: ScaleLabelLayout = { pluDigits: 4, valueDigits: 6, valueCheckDigit: false, value: 'WEIGHT' };
// Código de 6 + valor de 5 (exemplo de ajuda da Alterdata: "2 000001 00760 0").
const P6V5: ScaleLabelLayout = { pluDigits: 6, valueDigits: 5, valueCheckDigit: false, value: 'PRICE' };
// Código de 5 + valor de 5 + dígito verificador do valor.
const P5V5K: ScaleLabelLayout = { pluDigits: 5, valueDigits: 5, valueCheckDigit: true, value: 'PRICE' };

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

describe('formatos parametrizados', () => {
  it('código de 6 + valor de 5 (exemplo da Alterdata: 2 000001 00760 0)', () => {
    expect(parseScaleBarcode('2000001007600', P6V5)).toEqual({ plu: '1', priceCents: 760 });
  });

  it('dígito verificador do valor: pulado na leitura, o valor vem antes dele', () => {
    const code = buildScaleBarcode('00123', 2468, P5V5K);
    expect(code.slice(6, 11)).toBe('02468');
    expect(parseScaleBarcode(code, P5V5K)).toEqual({ plu: '123', priceCents: 2468 });
  });

  it('mesma etiqueta, formato errado ⇒ leitura diferente (por isso o "Testar etiqueta" no painel)', () => {
    const code = buildScaleBarcode('0123', 2468, P4); // 2 0123 0 002468 4
    expect(parseScaleBarcode(code, P6V5)).toEqual({ plu: '12300', priceCents: 2468 });
  });

  it('só oferece combinações que cabem em 13 dígitos, com o desenho de cada uma', () => {
    expect(scaleLayoutFits({ pluDigits: 6, valueDigits: 6, valueCheckDigit: false })).toBe(false);
    expect(scaleLayoutFits({ pluDigits: 5, valueDigits: 6, valueCheckDigit: true })).toBe(false);
    expect(SCALE_LABEL_FORMATS.map(scaleLabelPattern)).toEqual([
      '2 CCCC 0 VVVVVV D',
      '2 CCCC VVVVVV K D',
      '2 CCCC 00 VVVVV D',
      '2 CCCC 0 VVVVV K D',
      '2 CCCCC VVVVVV D',
      '2 CCCCC 0 VVVVV D',
      '2 CCCCC VVVVV K D',
      '2 CCCCCC VVVVV D',
    ]);
    expect(scaleLabelPattern(DEFAULT_SCALE_LABEL_LAYOUT)).toBe('2 CCCC 0 VVVVVV D');
  });

  it('formato que não cabe ⇒ não lê (null) e não monta', () => {
    const bad: ScaleLabelLayout = { pluDigits: 6, valueDigits: 6, valueCheckDigit: false, value: 'PRICE' };
    expect(parseScaleBarcode('2012300024684', bad)).toBeNull();
    expect(() => buildScaleBarcode('1', 1, bad)).toThrow();
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
