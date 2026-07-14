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
  /// Nome popular/regional do produto — usado na busca do PDV além do nome oficial.
  /// Opcional e genérico p/ qualquer ramo (ex.: "Ferro 8", "Dipirona").
  popularName: z.string().max(150).optional(),
  description: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  unit: unitTypeSchema.default('UNIT'),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  minStockQty: z.number().nonnegative().optional(),
  weightKg: z.number().positive().optional(),
  conversionFactor: z.number().positive().optional(),
  /**
   * Estoque inicial (opcional). Quando > 0, o cadastro NÃO grava o saldo direto no produto:
   * a API cria o produto e gera a **Entrada** (`StockMovement` INCOME) na MESMA transação
   * (ADR-001 — `stockQty` é cache; a movimentação é a fonte de verdade), já com a autoria
   * (ADR-010). É exclusivo da criação — não existe no update (ver `updateProductSchema`).
   */
  initialStock: z.number().nonnegative().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/// Payload para atualizar — todos os campos opcionais. `initialStock` é só de criação
/// (mudar estoque é sempre via movimentação, nunca por edição do cadastro — ADR-001).
export const updateProductSchema = createProductSchema.omit({ initialStock: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
