import { z } from 'zod';

/**
 * Schemas de validação de Cliente, compartilhados entre apps/web e apps/api.
 * `tenantId` NÃO entra aqui — vem do contexto (header na Fase 1; JWT na Fase 2).
 */
export const createCustomerSchema = z.object({
  name: z.string().min(1).max(120),
  cpfCnpj: z.string().max(18).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(150).optional(),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/// Payload para atualizar — todos os campos opcionais.
export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
