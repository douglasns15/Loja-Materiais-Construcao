import { z } from 'zod';

/**
 * Módulos ativáveis por loja (`TenantModule`) — ADR-011.
 *
 * O primeiro flag é `OFFLINE_SALES`: habilita a fila de sincronização offline de vendas
 * (Outbox → sync). Reusa a tabela `TenantModule` que já existe (sem migration): a chave é
 * `moduleKey` e o liga/desliga é `isActive`.
 *
 * Regra do gate (ADR-011 §9): **ausência da linha OU `isActive = false` = OFF**. O default é
 * desligado de graça — uma loja só tem offline se o Super Usuário criar/ligar a linha. Offline
 * nasce como recurso de **plano pago** (fronteira comercial + botão de pânico para rollout).
 */

/** Chave do módulo de vendas offline (ADR-011). */
export const MODULE_OFFLINE_SALES = 'OFFLINE_SALES' as const;

/** Formato mínimo de um módulo de loja para avaliar o gate (subconjunto de `TenantModule`). */
export type TenantModuleFlag = { moduleKey: string; isActive: boolean };

/**
 * Avalia se a venda offline está LIGADA para a loja. Função pura `(entrada) => saída` — sem I/O.
 * ON somente quando existe a linha `OFFLINE_SALES` **e** ela está `isActive`. Ausência = OFF.
 */
export function isOfflineSalesOn(modules: readonly TenantModuleFlag[] | null | undefined): boolean {
  if (!modules) return false;
  return modules.some((m) => m.moduleKey === MODULE_OFFLINE_SALES && m.isActive === true);
}

/**
 * Payload para ligar/desligar um módulo de loja pelo painel de plataforma
 * (`PATCH /platform/tenants/:id/modules`). Por ora só `OFFLINE_SALES` é ativável; o enum
 * mantém a porta aberta para outros módulos sem afrouxar a validação.
 */
export const setTenantModuleSchema = z.object({
  moduleKey: z.enum([MODULE_OFFLINE_SALES]),
  isActive: z.boolean(),
});
export type SetTenantModuleInput = z.infer<typeof setTenantModuleSchema>;
