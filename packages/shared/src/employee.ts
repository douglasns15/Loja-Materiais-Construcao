import { z } from 'zod';

/**
 * Funcionários da loja (ADR-042) — cadastro simples, SEM login (o entregador normalmente não usa o
 * sistema). Hoje serve para indicar o ENTREGADOR de cada entrega (`Order.courierId`).
 */

/** Função do funcionário — espelha o enum `EmployeeRole` do Prisma (extensível). */
export const employeeRoleSchema = z.enum(['COURIER', 'OTHER']);
export type EmployeeRole = z.infer<typeof employeeRoleSchema>;

/** Rótulos PT-BR das funções (tela Funcionários e seletor de entregador). */
export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  COURIER: 'Entregador',
  OTHER: 'Outra função',
};

/** Payload de criação. Nome obrigatório; telefone opcional; função padrão = entregador. */
export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  phone: z.string().trim().max(20).optional(),
  role: employeeRoleSchema.default('COURIER'),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Edição parcial. `phone: null` limpa; `isActive` desativa/reativa (reversível). */
export const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  role: employeeRoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** Linha da lista de funcionários (`GET /employees`). */
export type EmployeeRow = {
  id: string;
  name: string;
  phone: string | null;
  role: EmployeeRole;
  isActive: boolean;
};
