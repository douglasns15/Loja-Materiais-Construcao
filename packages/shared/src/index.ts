import { z } from 'zod';

/**
 * Schemas Zod e tipos compartilhados entre apps/web e apps/api.
 * Ponto de partida da Fase 1 — expandir conforme os endpoints forem criados.
 */

export const tenantIdSchema = z.string().uuid();
export type TenantId = z.infer<typeof tenantIdSchema>;

export * from './product';
export * from './customer';
export * from './category';
export * from './supplier';
export * from './cashSession';
export * from './sale';
export * from './stock';
export * from './report';
export * from './tenant';
export * from './format';
export * from './roles';
