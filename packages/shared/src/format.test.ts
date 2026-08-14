import { describe, expect, it } from 'vitest';
import {
  formatCnpj,
  formatCpf,
  formatCpfCnpj,
  formatOrderNumber,
  formatPhoneBr,
  formatQuoteNumber,
  parseOrderNumberQuery,
  parseQuoteNumberQuery,
} from './format';

// Máscaras de documento/telefone (apresentação; o banco guarda só dígitos).
describe('formatCpf', () => {
  it('mascara 11 dígitos como 000.000.000-00', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09');
    expect(formatCpf('123.456.789-09')).toBe('123.456.789-09'); // reformatar é idempotente
  });
  it('tamanho ≠ 11 volta só os dígitos (não trava digitação parcial)', () => {
    expect(formatCpf('123456')).toBe('123456');
    expect(formatCpf('')).toBe('');
    expect(formatCpf(null)).toBe('');
  });
});

describe('formatCpfCnpj', () => {
  it('até 11 dígitos usa máscara de CPF; acima, de CNPJ', () => {
    expect(formatCpfCnpj('12345678909')).toBe('123.456.789-09');
    expect(formatCpfCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('tamanhos incompletos voltam só os dígitos', () => {
    expect(formatCpfCnpj('112223330001')).toBe('112223330001'); // 12 díg. (CNPJ incompleto)
    expect(formatCpfCnpj('')).toBe('');
  });
});

describe('formatCnpj / formatPhoneBr (regressão)', () => {
  it('CNPJ 14 díg. e telefones fixo/celular', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatPhoneBr('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhoneBr('11987654321')).toBe('(11) 98765-4321');
  });
});

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
