import { z } from 'zod';

/**
 * Schemas de validação de Fornecedor, compartilhados entre apps/web e apps/api.
 * `tenantId` vem do contexto (header na Fase 1; JWT na Fase 2).
 */
export const createSupplierSchema = z.object({
  name: z.string().min(1).max(120),
  cnpj: z.string().max(18).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().max(300).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/// Payload para atualizar — todos os campos opcionais.
export const updateSupplierSchema = createSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
