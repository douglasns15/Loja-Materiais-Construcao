import { describe, expect, it } from 'vitest';
import { createProductionSchema, recipeSchema } from './production';
import { formatProductionNumber } from './format';
import { setTenantModuleSchema } from './modules';

// =============================================================================
// Produção com ficha técnica (ADR-043)
// =============================================================================

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('recipeSchema', () => {
  it('aceita rendimento + insumos e arredonda à precisão do estoque', () => {
    const r = recipeSchema.parse({ yieldQty: 1.2, items: [{ productId: A, quantity: 0.020004 }] });
    expect(r.items[0]!.quantity).toBe(0.02);
  });
  it('recusa ficha vazia, rendimento zero e insumo repetido', () => {
    expect(recipeSchema.safeParse({ yieldQty: 1, items: [] }).success).toBe(false);
    expect(recipeSchema.safeParse({ yieldQty: 0, items: [{ productId: A, quantity: 1 }] }).success).toBe(false);
    expect(
      recipeSchema.safeParse({
        yieldQty: 1,
        items: [
          { productId: A, quantity: 1 },
          { productId: A, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('createProductionSchema', () => {
  it('aceita insumo com 0 (não usou) desde que algum tenha sido usado', () => {
    expect(
      createProductionSchema.safeParse({
        productId: A,
        quantity: 18,
        inputs: [
          { productId: B, quantity: 15 },
          { productId: A, quantity: 0 },
        ],
      }).success,
    ).toBe(true);
    expect(
      createProductionSchema.safeParse({ productId: A, quantity: 18, inputs: [{ productId: B, quantity: 0 }] }).success,
    ).toBe(false);
  });
  it('recusa produzir zero', () => {
    expect(createProductionSchema.safeParse({ productId: A, quantity: 0, inputs: [{ productId: B, quantity: 1 }] }).success).toBe(false);
  });
});

describe('código e módulo', () => {
  it('P-0008', () => {
    expect(formatProductionNumber(8)).toBe('P-0008');
  });
  it('o painel liga/desliga o módulo de produção', () => {
    expect(setTenantModuleSchema.safeParse({ moduleKey: 'RECIPES', isActive: true }).success).toBe(true);
  });
});
