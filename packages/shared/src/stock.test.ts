import { describe, expect, it } from 'vitest';
import { createStockMovementSchema } from './stock';

const base = { productId: '6f1c0e8a-3b2d-4c5e-9f10-1a2b3c4d5e6f', quantity: 10 };

describe('createStockMovementSchema — reajuste de custo/preço na entrada', () => {
  it('entrada simples (sem custo nem preço) segue válida e assume INCOME', () => {
    const r = createStockMovementSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.type).toBe('INCOME');
    expect(r.success && r.data.newSalePrice).toBeUndefined();
  });

  it('aceita novo custo e novo preço de venda juntos', () => {
    const r = createStockMovementSchema.safeParse({ ...base, newCostPrice: 12.5, newSalePrice: 19.9 });
    expect(r.success).toBe(true);
    expect(r.success && r.data.newSalePrice).toBe(19.9);
  });

  it('aceita só o preço de venda (custo fica intocado)', () => {
    const r = createStockMovementSchema.safeParse({ ...base, newSalePrice: 7 });
    expect(r.success).toBe(true);
    expect(r.success && r.data.newCostPrice).toBeUndefined();
  });

  it('recusa preço de venda zero ou negativo (vazio = não muda, não "zera o preço")', () => {
    expect(createStockMovementSchema.safeParse({ ...base, newSalePrice: 0 }).success).toBe(false);
    expect(createStockMovementSchema.safeParse({ ...base, newSalePrice: -1 }).success).toBe(false);
  });
});
