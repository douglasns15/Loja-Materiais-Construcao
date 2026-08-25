import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, isValidTaxpayerDocument, onlyDigits } from './taxpayer';

describe('onlyDigits', () => {
  it('remove máscara', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725');
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
  });
});

describe('isValidCpf', () => {
  it('aceita CPF válido, com e sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
  });

  it('rejeita todos os dígitos iguais', () => {
    // Passa na conta do DV, mas é inválido por convenção — daí a checagem extra.
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('00000000000')).toBe(false);
  });

  it('rejeita tamanho errado', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247251')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });
});

describe('isValidCnpj', () => {
  it('aceita CNPJ válido, com e sem máscara', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('rejeita dígito verificador errado', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
  });

  it('rejeita todos os dígitos iguais e tamanho errado', () => {
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('1122233300018')).toBe(false);
  });
});

describe('isValidTaxpayerDocument', () => {
  it('roteia pelo tipo declarado', () => {
    expect(isValidTaxpayerDocument('CPF', '52998224725')).toBe(true);
    expect(isValidTaxpayerDocument('CNPJ', '11222333000181')).toBe(true);
    // CPF válido não é CNPJ válido — o tipo importa.
    expect(isValidTaxpayerDocument('CNPJ', '52998224725')).toBe(false);
  });
});
