import { describe, expect, it } from 'vitest';
import {
  formatOrderNumber,
  formatQuoteNumber,
  parseOrderNumberQuery,
  parseQuoteNumberQuery,
} from './format';

// ADR-023 — código humano da venda (V-000128). Funções puras de apresentação/busca.
describe('formatOrderNumber', () => {
  it('preenche com zeros até 6 dígitos e prefixa V-', () => {
    expect(formatOrderNumber(1)).toBe('V-000001');
    expect(formatOrderNumber(128)).toBe('V-000128');
    expect(formatOrderNumber(999999)).toBe('V-999999');
  });

  it('acima de 999999 só cresce (nunca trunca)', () => {
    expect(formatOrderNumber(1000000)).toBe('V-1000000');
  });

  it('trunca fração para inteiro', () => {
    expect(formatOrderNumber(128.9)).toBe('V-000128');
  });

  it('nulo, zero ou negativo volta string vazia (sem número ⇒ "pendente")', () => {
    expect(formatOrderNumber(null)).toBe('');
    expect(formatOrderNumber(undefined)).toBe('');
    expect(formatOrderNumber(0)).toBe('');
    expect(formatOrderNumber(-5)).toBe('');
    expect(formatOrderNumber(Number.NaN)).toBe('');
  });
});

describe('parseOrderNumberQuery', () => {
  it('extrai o inteiro de qualquer forma do código', () => {
    expect(parseOrderNumberQuery('V-000128')).toBe(128);
    expect(parseOrderNumberQuery('000128')).toBe(128);
    expect(parseOrderNumberQuery('128')).toBe(128);
    expect(parseOrderNumberQuery('v 128')).toBe(128);
    expect(parseOrderNumberQuery('#128')).toBe(128);
  });

  it('ida e volta com formatOrderNumber', () => {
    expect(parseOrderNumberQuery(formatOrderNumber(4021))).toBe(4021);
  });

  it('sem dígito ou zero volta null (não existe venda 0)', () => {
    expect(parseOrderNumberQuery('')).toBeNull();
    expect(parseOrderNumberQuery('V-')).toBeNull();
    expect(parseOrderNumberQuery('abc')).toBeNull();
    expect(parseOrderNumberQuery(null)).toBeNull();
    expect(parseOrderNumberQuery('V-000000')).toBeNull();
  });
});

// ADR-024 — código humano do orçamento (O-000045). Mesmo motor, prefixo O-.
describe('formatQuoteNumber / parseQuoteNumberQuery', () => {
  it('formata com prefixo O- e 6 dígitos', () => {
    expect(formatQuoteNumber(45)).toBe('O-000045');
    expect(formatQuoteNumber(1)).toBe('O-000001');
    expect(formatQuoteNumber(0)).toBe('');
    expect(formatQuoteNumber(null)).toBe('');
  });

  it('interpreta a busca em qualquer forma e faz ida-e-volta', () => {
    expect(parseQuoteNumberQuery('O-000045')).toBe(45);
    expect(parseQuoteNumberQuery('000045')).toBe(45);
    expect(parseQuoteNumberQuery('45')).toBe(45);
    expect(parseQuoteNumberQuery(parseQuoteNumberQuery('O-000045') === 45 ? formatQuoteNumber(45) : '')).toBe(45);
    expect(parseQuoteNumberQuery('O-')).toBeNull();
    expect(parseQuoteNumberQuery('O-000000')).toBeNull();
  });
});
