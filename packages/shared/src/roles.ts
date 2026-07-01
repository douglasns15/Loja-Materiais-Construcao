import { z } from 'zod';
import { onlyDigits } from './format';

/**
 * Papéis de usuário e mapeamento para o conceito exposto no produto — ADR-008.
 * Funções PURAS reusadas na API (enforcement do RBAC) e no front (UX).
 *
 * O banco usa `UserRole { OWNER, MANAGER, CASHIER, STOCK }` (sem migration). O produto
 * expõe só dois conceitos: **Admin** e **Usuário**. Convenção de escrita (ADR-008):
 * Admin → `MANAGER` · dono → `OWNER` (preservado) · Usuário → `CASHIER`.
 */

/** Papéis físicos gravados em `User.role` (enum do Prisma). */
export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'STOCK';

/** Conceito de papel exposto na interface. */
export type StoreRole = 'ADMIN' | 'USER';

export const STORE_ROLE_LABELS: Record<StoreRole, string> = {
  ADMIN: 'Admin',
  USER: 'Usuário',
};

/** `OWNER` e `MANAGER` têm acesso administrativo; os demais são operação. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER';
}

/** Deriva o conceito Admin/Usuário a partir do `UserRole` físico. */
export function toStoreRole(role: string | null | undefined): StoreRole {
  return isAdminRole(role) ? 'ADMIN' : 'USER';
}

/**
 * `UserRole` a gravar ao definir o papel pela tela (o dono `OWNER` é preservado à parte,
 * nunca gerado aqui): Admin → `MANAGER`, Usuário → `CASHIER`.
 */
export function storeRoleToUserRole(store: StoreRole): UserRole {
  return store === 'ADMIN' ? 'MANAGER' : 'CASHIER';
}

/** É o papel do dono da loja (criado no bootstrap; imutável pela tela de usuários). */
export function isOwnerRole(role: string | null | undefined): boolean {
  return role === 'OWNER';
}

/**
 * Payload do próprio perfil (`PATCH /me`): nome obrigatório e telefone opcional.
 * Telefone guardado como só dígitos (canônico; formata na exibição — ver `formatPhoneBr`).
 */
export const updateMeSchema = z.object({
  name: z.string().trim().min(1, 'O nome é obrigatório.').max(100),
  phone: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length <= 11, { message: 'Telefone inválido.' }),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Payload para atualizar um usuário pela tela de gestão (papel e/ou ativação). */
export const updateUserSchema = z
  .object({
    storeRole: z.enum(['ADMIN', 'USER']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.storeRole !== undefined || v.isActive !== undefined, {
    message: 'Nada para atualizar.',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
