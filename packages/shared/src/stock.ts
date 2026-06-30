import { z } from 'zod';

/**
 * Schemas de movimentação de estoque, compartilhados entre apps/web e apps/api.
 * Sem dependência de packages/db para não carregar o Prisma no bundle do cliente.
 */

/// Espelha o enum `TransactionType` de packages/db/prisma/schema.prisma.
export const stockMovementTypeSchema = z.enum(['INCOME', 'EXPENSE']);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;

/// Entrada de estoque (compra/recebimento). `tenantId` vem do contexto (JWT).
/// É a movimentação "natural" de estoque — auditada pelo próprio StockMovement (ADR-001),
/// sem AuditEvent dedicado.
export const createStockMovementSchema = z.object({
  productId: z.string().uuid(),
  type: stockMovementTypeSchema.default('INCOME'),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  supplierId: z.string().uuid().optional(),
  reason: z.string().max(150).optional(),
});
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

/// Ajuste manual de inventário: informa a contagem real e o sistema calcula o
/// movimento (entrada/saída) até chegar nela. Evento crítico (ADR-004) — exige
/// motivo e gera AuditEvent `ADJUST_STOCK`.
export const inventoryAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  countedQty: z.number().nonnegative(),
  reason: z.string().min(1).max(150),
});
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>;
