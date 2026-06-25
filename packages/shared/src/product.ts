import { z } from 'zod';

/**
 * Schemas de validação de Produto, compartilhados entre apps/web e apps/api.
 * Mantido sem dependência de packages/db para não carregar o Prisma no bundle do cliente.
 */

/// Espelha o enum `UnitType` de packages/db/prisma/schema.prisma.
export const unitTypeSchema = z.enum([
  'UNIT',
  'METER',
  'SQUARE_METER',
  'CUBIC_METER',
  'KILOGRAM',
  'LITER',
  'THOUSAND',
  'BAG',
  'ROLL',
]);
export type UnitType = z.infer<typeof unitTypeSchema>;

/// Payload para criar um produto. `tenantId` NÃO entra aqui — vem do contexto
/// (header temporário na Fase 1; claim do JWT na Fase 2).
export const createProductSchema = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  unit: unitTypeSchema.default('UNIT'),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  stockQty: z.number().optional(),
  minStockQty: z.number().nonnegative().optional(),
  weightKg: z.number().positive().optional(),
  conversionFactor: z.number().positive().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/// Payload para atualizar — todos os campos opcionais.
export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
