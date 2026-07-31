import { z } from 'zod';

/**
 * Devolução/troca por item + crédito do cliente (ADR-022, Fatia B). Tipos e schemas compartilhados
 * entre apps/web e apps/api. A devolução estorna estoque, abate a dívida da venda e, se sobrar
 * valor, o excedente vira crédito na loja OU dinheiro no caixa (escolha do operador).
 */

/** Destino do excedente de uma devolução. Espelha o enum `ReturnTarget` do Prisma. */
export type ReturnTarget = 'STORE_CREDIT' | 'CASH';

export const RETURN_TARGET_LABELS: Record<ReturnTarget, string> = {
  STORE_CREDIT: 'Crédito na loja',
  CASH: 'Devolução em dinheiro',
};

/**
 * Payload para devolver itens de uma venda (ADR-022). `items` traz o `orderItemId` e a quantidade
 * devolvida **na unidade vendida** (o que a tela mostra — ex.: 1 rolo); o servidor converte para
 * unidade-base (estoque) e valida contra o que ainda é devolvível. `target` só importa quando há
 * EXCEDENTE (valor além do saldo devedor da venda) — o servidor exige a escolha nesse caso.
 */
export const createReturnSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
  reason: z.string().min(1).max(500),
  target: z.enum(['STORE_CREDIT', 'CASH']).optional(),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

/** Resultado de uma devolução por item (`POST /orders/:id/return-items`). */
export type PartialReturnResult = {
  returnId: string;
  totalValue: number; // valor total devolvido
  abatedAmount: number; // quanto abateu da dívida da venda
  excessAmount: number; // excedente (virou crédito ou dinheiro)
  target: ReturnTarget | null; // destino do excedente (null quando não houve excedente)
  receivableBalance: number | null; // saldo da dívida após abater (null se a venda não era a prazo)
  creditBalance: number; // saldo de crédito do cliente após (quando o excedente virou crédito)
};
