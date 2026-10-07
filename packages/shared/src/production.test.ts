import { describe, expect, it } from 'vitest';
import { createProductionSchema, productionLossReasonText, productionLossSchema, recipeSchema } from './production';
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

describe('productionLossSchema', () => {
  it('aceita sobra do dia sem descrição e exige descrição em "Outro"', () => {
    expect(productionLossSchema.safeParse({ productId: A, quantity: 2.4, reason: 'LEFTOVER' }).success).toBe(true);
    expect(productionLossSchema.safeParse({ productId: A, quantity: 2.4, reason: 'OTHER' }).success).toBe(false);
    expect(productionLossSchema.safeParse({ productId: A, quantity: 2.4, reason: 'OTHER', note: 'vencido' }).success).toBe(
      true,
    );
    expect(productionLossSchema.safeParse({ productId: A, quantity: 0, reason: 'BURNED' }).success).toBe(false);
  });

  it('monta o motivo do movimento com o prefixo da perda', () => {
    expect(productionLossReasonText('LEFTOVER')).toBe('Perda — Sobra do dia');
    expect(productionLossReasonText('BURNED', '2 do fundo')).toBe('Perda — Queimou: 2 do fundo');
    expect(productionLossReasonText('OTHER', 'vencido')).toBe('Perda — vencido');
  });
});
