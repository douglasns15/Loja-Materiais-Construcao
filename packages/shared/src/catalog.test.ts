import { describe, expect, it } from 'vitest';
import { gtinKey, isValidGtin, normalizeGtin, normalizeNcm } from './catalog';

// Dígito verificador GS1 (mod-10). Amostras com check digit conferido à mão para EAN-8, UPC-A,
// EAN-13 e GTIN-14 — cobre os quatro comprimentos aceitos.
describe('isValidGtin', () => {
  it('aceita EAN-8/UPC-12/EAN-13/GTIN-14 com dígito verificador correto', () => {
    expect(isValidGtin('12345670')).toBe(true); // EAN-8
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A (12)
    expect(isValidGtin('7891000100103')).toBe(true); // EAN-13
    expect(isValidGtin('17891000100100')).toBe(true); // GTIN-14
  });

  it('rejeita dígito verificador errado', () => {
    expect(isValidGtin('7891000100104')).toBe(false); // último dígito trocado
    expect(isValidGtin('12345671')).toBe(false);
  });

  it('rejeita comprimento inválido (não é 8/12/13/14)', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('1234567890')).toBe(false); // 10 dígitos
    expect(isValidGtin('')).toBe(false);
  });

  it('ignora espaços/hífen do leitor antes de validar', () => {
    expect(isValidGtin('789 1000 100103')).toBe(true);
    expect(isValidGtin('7891000-100103')).toBe(true);
  });
});

describe('normalizeGtin', () => {
  it('devolve só os dígitos quando o GTIN é válido', () => {
    expect(normalizeGtin('789 1000 100103')).toBe('7891000100103');
  });
  it('devolve null quando não é um GTIN válido (não dispara consulta externa)', () => {
    expect(normalizeGtin('CODIGO-INTERNO-123')).toBeNull();
    expect(normalizeGtin('7891000100104')).toBeNull(); // check digit errado
  });
});

describe('gtinKey', () => {
  it('padroniza o MESMO item a uma única chave GTIN-14 (unifica larguras)', () => {
    // EAN-13 e a forma de caixa GTIN-14 do MESMO código → mesma chave (o bug do "Suporte").
    expect(gtinKey('7896202400440')).toBe('07896202400440'); // EAN-13
    expect(gtinKey('07896202400440')).toBe('07896202400440'); // GTIN-14 (indicador 0)
    expect(gtinKey('7896202400440')).toBe(gtinKey('07896202400440'));
  });

  it('completa até 14 sem NUNCA remover zeros à esquerda (EAN-8/UPC-12/EAN-13)', () => {
    expect(gtinKey('12345670')).toBe('00000012345670'); // EAN-8
    expect(gtinKey('036000291452')).toBe('00036000291452'); // UPC-A (12)
    expect(gtinKey('0036000291452')).toBe('00036000291452'); // mesmo UPC-A como EAN-13 (0 real)
    expect(gtinKey('036000291452')).toBe(gtinKey('0036000291452'));
    expect(gtinKey('7891000100103')).toBe('07891000100103'); // EAN-13
    expect(gtinKey('17891000100100')).toBe('17891000100100'); // GTIN-14 já tem 14
  });

  it('devolve null quando não é um GTIN válido', () => {
    expect(gtinKey('CANT-1122')).toBeNull(); // SKU interno, não é código de barras
    expect(gtinKey('7891000100104')).toBeNull(); // check digit errado
    expect(gtinKey('')).toBeNull();
  });
});

describe('normalizeNcm', () => {
  it('extrai 8 dígitos mesmo com pontos da NF-e', () => {
    expect(normalizeNcm('2523.29.10')).toBe('25232910');
    expect(normalizeNcm('25232910')).toBe('25232910');
  });
  it('devolve null quando não sobram exatamente 8 dígitos', () => {
    expect(normalizeNcm('2523')).toBeNull();
    expect(normalizeNcm(null)).toBeNull();
    expect(normalizeNcm(undefined)).toBeNull();
    expect(normalizeNcm('')).toBeNull();
  });
});
