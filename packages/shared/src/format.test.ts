import { describe, expect, it } from 'vitest';
import {
  formatCnpj,
  formatCpf,
  formatCpfCnpj,
  formatDebtNumber,
  formatOrderNumber,
  formatPhoneBr,
  formatQuoteNumber,
  parseDebtNumberQuery,
  parseMoneyQuery,
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

// ADR-026 — código humano da dívida do cliente (D-0001). Mesmo motor, prefixo D-, 4 dígitos.
describe('formatDebtNumber / parseDebtNumberQuery', () => {
  it('formata com prefixo D- e 4 dígitos', () => {
    expect(formatDebtNumber(1)).toBe('D-0001');
    expect(formatDebtNumber(14)).toBe('D-0014');
    expect(formatDebtNumber(9999)).toBe('D-9999');
    expect(formatDebtNumber(0)).toBe('');
    expect(formatDebtNumber(null)).toBe('');
  });

  it('acima de 9999 só cresce (nunca trunca)', () => {
    expect(formatDebtNumber(10000)).toBe('D-10000');
  });

  it('interpreta a busca em qualquer forma e faz ida-e-volta', () => {
    expect(parseDebtNumberQuery('D-0001')).toBe(1);
    expect(parseDebtNumberQuery('0014')).toBe(14);
    expect(parseDebtNumberQuery('14')).toBe(14);
    expect(parseDebtNumberQuery(formatDebtNumber(14))).toBe(14);
    expect(parseDebtNumberQuery('D-')).toBeNull();
    expect(parseDebtNumberQuery('D-0000')).toBeNull();
  });
});

// Busca por VALOR no Histórico de Vendas (match exato, tolerante ao formato). Função pura.
describe('parseMoneyQuery', () => {
  it('inteiro simples', () => {
    expect(parseMoneyQuery('150')).toBe(150);
    expect(parseMoneyQuery('0')).toBe(0);
  });

  it('decimal com vírgula (padrão BR)', () => {
    expect(parseMoneyQuery('150,00')).toBe(150);
    expect(parseMoneyQuery('150,5')).toBe(150.5);
    expect(parseMoneyQuery('1234,56')).toBe(1234.56);
  });

  it('milhar + decimal no padrão BR (1.234,56) e no americano (1,234.56)', () => {
    expect(parseMoneyQuery('1.234,56')).toBe(1234.56);
    expect(parseMoneyQuery('1.234.567,89')).toBe(1234567.89);
    expect(parseMoneyQuery('1,234.56')).toBe(1234.56);
  });

  it('só ponto: 3 dígitos depois é milhar; 1–2 dígitos é decimal', () => {
    expect(parseMoneyQuery('1.234')).toBe(1234); // milhar
    expect(parseMoneyQuery('1.234.567')).toBe(1234567); // milhares
    expect(parseMoneyQuery('150.00')).toBe(150); // decimal
    expect(parseMoneyQuery('1.5')).toBe(1.5); // decimal
  });

  it('ignora R$, espaços e outros ruídos', () => {
    expect(parseMoneyQuery('R$ 150,00')).toBe(150);
    expect(parseMoneyQuery('  1.234,56  ')).toBe(1234.56);
  });

  it('sem dígito volta null', () => {
    expect(parseMoneyQuery('')).toBeNull();
    expect(parseMoneyQuery('R$')).toBeNull();
    expect(parseMoneyQuery('abc')).toBeNull();
    expect(parseMoneyQuery(null)).toBeNull();
    expect(parseMoneyQuery(undefined)).toBeNull();
  });
});
