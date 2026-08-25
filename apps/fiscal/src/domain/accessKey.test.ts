import { describe, expect, it } from 'vitest';
import {
  accessKeyCheckDigit,
  buildAccessKey,
  EMISSION_NORMAL,
  isValidAccessKey,
  MODEL_NFCE,
  parseAccessKey,
  type AccessKeyParts,
} from './accessKey';

const PARTS: AccessKeyParts = {
  ufCode: 35, // SP
  year: 2026,
  month: 8,
  cnpj: '11222333000181',
  model: MODEL_NFCE,
  series: 1,
  number: 128,
  emissionType: EMISSION_NORMAL,
  numericCode: 12345678,
};

describe('accessKeyCheckDigit', () => {
  it('calcula o DV pelo módulo 11 (pesos 2..9 da direita p/ esquerda)', () => {
    const first43 = buildAccessKey(PARTS).slice(0, 43);
    const dv = accessKeyCheckDigit(first43);
    expect(dv).toBeGreaterThanOrEqual(0);
    expect(dv).toBeLessThanOrEqual(9);
    // O DV calculado é o mesmo que a chave carrega.
    expect(String(dv)).toBe(buildAccessKey(PARTS).slice(43));
  });

  it('recusa entrada que não tenha 43 dígitos', () => {
    expect(() => accessKeyCheckDigit('123')).toThrow();
  });
});

describe('buildAccessKey', () => {
  it('gera 44 dígitos', () => {
    expect(buildAccessKey(PARTS)).toHaveLength(44);
  });

  it('é determinística — mesmas partes, mesma chave', () => {
    expect(buildAccessKey(PARTS)).toBe(buildAccessKey(PARTS));
  });

  it('posiciona cada campo no layout oficial', () => {
    const key = buildAccessKey(PARTS);
    expect(key.slice(0, 2)).toBe('35'); // cUF
    expect(key.slice(2, 6)).toBe('2608'); // AAMM
    expect(key.slice(6, 20)).toBe('11222333000181'); // CNPJ
    expect(key.slice(20, 22)).toBe('65'); // modelo NFC-e
    expect(key.slice(22, 25)).toBe('001'); // série
    expect(key.slice(25, 34)).toBe('000000128'); // nNF
    expect(key.slice(34, 35)).toBe('1'); // tpEmis
    expect(key.slice(35, 43)).toBe('12345678'); // cNF
  });

  it('muda a chave quando o número da nota muda', () => {
    const other = buildAccessKey({ ...PARTS, number: 129 });
    expect(other).not.toBe(buildAccessKey(PARTS));
  });
});

describe('isValidAccessKey', () => {
  it('aceita chave gerada por buildAccessKey', () => {
    expect(isValidAccessKey(buildAccessKey(PARTS))).toBe(true);
  });

  it('rejeita DV adulterado', () => {
    const key = buildAccessKey(PARTS);
    const wrongDv = (Number(key[43]) + 1) % 10;
    expect(isValidAccessKey(key.slice(0, 43) + wrongDv)).toBe(false);
  });

  it('rejeita tamanho diferente de 44', () => {
    expect(isValidAccessKey('123')).toBe(false);
  });
});

describe('parseAccessKey', () => {
  it('faz o caminho de volta (round-trip)', () => {
    const parsed = parseAccessKey(buildAccessKey(PARTS));
    expect(parsed).toEqual(PARTS);
  });

  it('devolve null para chave inválida', () => {
    expect(parseAccessKey('000')).toBeNull();
  });
});
