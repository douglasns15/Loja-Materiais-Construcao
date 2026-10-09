import { describe, expect, it } from 'vitest';
import { createProductSchema, updateProductSchema } from './product';

// Código na balança (PLU, ADR-040 §3): gravado sem zeros à esquerda para casar com qualquer layout.
describe('scaleCode (PLU)', () => {
  const base = { sku: 'SORV-1', name: 'Sorvete por kg', costPrice: 0, salePrice: 59.9 };

  it('normaliza zeros à esquerda e aceita até 6 dígitos', () => {
    expect(createProductSchema.parse({ ...base, scaleCode: '0123' }).scaleCode).toBe('123');
    expect(createProductSchema.parse({ ...base, scaleCode: ' 123456 ' }).scaleCode).toBe('123456');
  });

  it('recusa zero, letras e mais de 6 dígitos', () => {
    for (const scaleCode of ['0000', 'A12', '1234567', '']) {
      expect(createProductSchema.safeParse({ ...base, scaleCode }).success).toBe(false);
    }
  });

  it('no update, null libera o PLU', () => {
    expect(updateProductSchema.parse({ scaleCode: null }).scaleCode).toBeNull();
  });
});
