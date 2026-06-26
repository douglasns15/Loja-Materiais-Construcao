import { z } from 'zod';

/**
 * Schemas de validação de Categoria, compartilhados entre apps/web e apps/api.
 * `parentId` opcional permite hierarquia simples (categoria/subcategoria).
 * `tenantId` vem do contexto (header na Fase 1; JWT na Fase 2).
 */
export const createCategorySchema = z.object({
  name: z.string().min(1).max(80),
  parentId: z.string().uuid().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/// Payload para atualizar — todos os campos opcionais.
export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
