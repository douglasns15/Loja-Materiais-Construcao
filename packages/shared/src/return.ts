import { z } from 'zod';

/**
 * Devolução/troca por item + crédito do cliente (ADR-022, Fatia B). Tipos e schemas compartilhados
 * entre apps/web e apps/api. A devolução estorna estoque, abate a dívida da venda e, se sobrar
 * valor, o excedente vira crédito na loja OU dinheiro no caixa (escolha do operador).
 */

/** Destino do dinheiro do cliente numa devolução. Espelha o enum `ReturnTarget` do Prisma. */
export type ReturnTarget = 'STORE_CREDIT' | 'CASH' | 'SAME_AS_PAYMENT';

export const RETURN_TARGET_LABELS: Record<ReturnTarget, string> = {
  STORE_CREDIT: 'Crédito na loja',
  CASH: 'Dinheiro do caixa',
  SAME_AS_PAYMENT: 'Estorno (mesma forma)',
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
        // Condição do item (ADR-033). Ausente ⇒ GOOD (revenda, volta ao estoque). DEFECTIVE não
        // volta: vira defeituoso rastreado. O valor/abatimento independe da condição — o cliente
        // devolveu e recebe de volta em qualquer caso; muda só o DESTINO da mercadoria.
        condition: z.enum(['GOOD', 'DEFECTIVE']).optional(),
      }),
    )
    .min(1),
  reason: z.string().min(1).max(500),
  // Destino do excedente (ADR-022 + ADR-033): crédito na loja, dinheiro do caixa, ou estorno na
  // mesma forma do pagamento (só a parcela em dinheiro sai do caixa). Exigido só quando há excedente.
  target: z.enum(['STORE_CREDIT', 'CASH', 'SAME_AS_PAYMENT']).optional(),
  // Intenção (ADR-033, Fatia 3): REFUND (padrão) = devolução/estorno normal; EXCHANGE = troca — o
  // valor devolvido NÃO vira dinheiro/crédito/abatimento agora: vira um VALE consumido por uma nova
  // venda no PDV. `target` é ignorado quando EXCHANGE.
  intent: z.enum(['REFUND', 'EXCHANGE']).optional(),
  // Cliente escolhido NO ATO da devolução (ADR-035, pick-no-retorno). Usado só quando o destino é
  // "Crédito na loja" (STORE_CREDIT) e a venda ainda NÃO tem cliente: o servidor valida que é
  // cliente do tenant, ANEXA à venda (`Order.customerId`) e credita o `creditBalance`. Se a venda já
  // tem cliente, este campo é ignorado (o cliente do pedido manda).
  customerId: z.string().uuid().optional(),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

/** Intenção de uma devolução — espelha o enum `ReturnIntent` do Prisma (ADR-033). */
export type ReturnIntent = 'REFUND' | 'EXCHANGE';

/** Condição de um item devolvido — espelha o enum `ReturnItemCondition` do Prisma/core (ADR-033). */
export type ReturnItemCondition = 'GOOD' | 'DEFECTIVE';

export const RETURN_ITEM_CONDITION_LABELS: Record<ReturnItemCondition, string> = {
  GOOD: 'Revenda',
  DEFECTIVE: 'Defeito',
};

/** Desfecho de um item defeituoso — espelha o enum `DefectResolution` do Prisma (ADR-033). */
export type DefectResolutionStatus = 'PENDING' | 'RESTOCKED' | 'WRITTEN_OFF';

/** Ação de resolução escolhida pelo operador na lista de defeituosos (ADR-033). */
export type DefectResolutionAction = 'RESTOCK' | 'WRITE_OFF';

/**
 * Payload para resolver um item devolvido com defeito (`POST /returns/defective/:id/resolve`).
 * `RESTOCK` = fornecedor trocou (o substituto entra no estoque vendável); `WRITE_OFF` = baixa/perda.
 * `note` é uma observação opcional do acerto (ex.: nº da troca com o fornecedor).
 */
export const resolveDefectSchema = z.object({
  action: z.enum(['RESTOCK', 'WRITE_OFF']),
  note: z.string().max(300).optional(),
});
export type ResolveDefectInput = z.infer<typeof resolveDefectSchema>;

/** Uma linha da lista "Devolvidos com defeito" (`GET /returns/defective`). */
export type DefectiveItem = {
  orderReturnItemId: string;
  productId: string | null;
  productName: string; // snapshot do item devolvido
  baseQty: number; // quanto (unidade-base) está parado como defeito
  value: number; // valor daquele item na devolução (referência p/ acerto)
  reason: string; // motivo da devolução (cabeçalho)
  orderId: string;
  orderNumber: number; // V-000XXX da venda de origem
  supplierName: string | null; // fornecedor atual do produto (p/ a troca), quando houver
  createdAt: string; // ISO — quando o item foi devolvido com defeito
};

/** Resultado da resolução de um defeito (`POST /returns/defective/:id/resolve`). */
export type ResolveDefectResult = {
  orderReturnItemId: string;
  defectStatus: DefectResolutionStatus;
  restocked: boolean; // true quando o substituto voltou ao estoque vendável
  productStockQty: number | null; // novo estoque vendável do produto (quando reposto)
};

/** Resultado de uma devolução por item (`POST /orders/:id/return-items`). */
export type PartialReturnResult = {
  returnId: string;
  totalValue: number; // valor total devolvido
  abatedAmount: number; // quanto abateu da dívida da venda
  excessAmount: number; // excedente (virou crédito ou dinheiro)
  target: ReturnTarget | null; // destino do excedente (null quando não houve excedente)
  receivableBalance: number | null; // saldo da dívida após abater (null se a venda não era a prazo)
  creditBalance: number; // saldo de crédito do cliente após (quando o excedente virou crédito)
  intent?: ReturnIntent; // ADR-033: REFUND (padrão) ou EXCHANGE
  exchangeCredit?: number; // ADR-033: valor do vale-troca (quando intent = EXCHANGE)
};
