import { z } from 'zod';

/**
 * Funcionários da loja (ADR-042) — cadastro simples, SEM login (o entregador normalmente não usa o
 * sistema). Hoje serve para indicar o ENTREGADOR de cada entrega (`Order.courierId`).
 * As demais funções (operador, açougueiro, limpeza…) são só cadastro — migration 0043.
 */

/** Função do funcionário — espelha o enum `EmployeeRole` do Prisma (extensível). */
export const employeeRoleSchema = z.enum([
  'COURIER',
  'OPERATOR',
  'CASHIER',
  'BUTCHER',
  'COOK',
  'GRILLER',
  'CLEANING',
  'SECURITY',
  'OTHER',
]);
export type EmployeeRole = z.infer<typeof employeeRoleSchema>;

/** Rótulos PT-BR das funções (tela Funcionários e seletor de entregador). A ordem é a do seletor. */
export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  COURIER: 'Entregador',
  OPERATOR: 'Operador',
  CASHIER: 'Caixa',
  BUTCHER: 'Açougueiro',
  COOK: 'Cozinheiro',
  GRILLER: 'Churrasqueiro',
  CLEANING: 'Limpeza',
  SECURITY: 'Segurança',
  OTHER: 'Outra função',
};

/** E-mail de contato (opcional; não é login). Vazio ⇒ ausente. */
const emailField = z.string().trim().max(160).email('E-mail inválido.');

/** Payload de criação. Nome obrigatório; telefone e e-mail opcionais; função padrão = entregador. */
export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome.').max(120),
  phone: z.string().trim().max(20).optional(),
  email: emailField.optional(),
  role: employeeRoleSchema.default('COURIER'),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

/** Edição parcial. `phone`/`email: null` limpa; `isActive` desativa/reativa (reversível). */
export const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  email: emailField.nullable().optional(),
  role: employeeRoleSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

/** Linha da lista de funcionários (`GET /employees`). */
export type EmployeeRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: EmployeeRole;
  isActive: boolean;
};
