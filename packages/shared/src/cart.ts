import { z } from 'zod';
import { unitTypeSchema } from './product';
import { saleUnitModeSchema } from './sale';

/**
 * Cesta persistente do PDV (ADR-021). Uma linha de carrinho **como o front a monta** — um
 * rascunho de UI, não a fonte de verdade da venda. Guardamos o snapshot inteiro (par ADR-015,
 * acréscimo ADR-016, unidade fechada ADR-017, `conversionFactor`) porque preço/estoque são
 * revalidados no `POST /orders` na hora de vender; aqui só sincronizamos o rascunho entre
 * dispositivos. Este schema é a **fonte única** do tipo (front) e da validação (API `POST /cart`).
 *
 * Os números são apenas **finitos** (não `NaN`/`Infinity`) e não-negativos onde faz sentido; os
 * tetos de string/quantidade existem para proteger o free tier de um payload absurdo.
 */
export const cartItemSchema = z.object({
  /** Chave única da linha no carrinho (`productId:saleMode` ou `productId:PAIR:partnerId`). */
  key: z.string().min(1).max(120),
  productId: z.string().uuid(),
  name: z.string().min(1).max(200),
  /** Preço BASE da unidade vendida (sem o acréscimo por forma de pagamento — ADR-016). */
  unitPrice: z.number().finite().nonnegative(),
  costPrice: z.number().finite().nonnegative(),
  quantity: z.number().finite().positive(),
  /** Estoque disponível em unidade-base, como veio do catálogo (só para a trava de estoque). */
  stockQty: z.number().finite(),
  saleMode: saleUnitModeSchema,
  unitType: unitTypeSchema,
  baseUnitType: unitTypeSchema,
  conversionFactor: z.number().finite().positive(),
  /** `true` na unidade fechada (barra/rolo) principal — ADR-017. */
  closed: z.boolean().optional(),
  /** Acréscimo por forma de pagamento, por unidade vendida (ADR-016). 0 quando não há. */
  surchargeDebit: z.number().finite().nonnegative(),
  surchargeCredit: z.number().finite().nonnegative(),
  /** Venda em par (ADR-015): presente ⇒ a linha é um par, expandido em dois itens no envio. */
  pair: z
    .object({
      partnerId: z.string().uuid(),
      partnerName: z.string().min(1).max(200),
      mainSalePrice: z.number().finite().nonnegative(),
      partnerSalePrice: z.number().finite().nonnegative(),
      partnerStockQty: z.number().finite(),
    })
    .optional(),
});

/** Uma linha do carrinho do PDV. Tipo inferido do schema — fonte única entre front e API. */
export type CartItem = z.infer<typeof cartItemSchema>;

/** Teto de linhas distintas na cesta (protege o free tier; muito acima de um carrinho real). */
export const CART_MAX_ITEMS = 200;

/** Payload da cesta persistida (corpo do `POST /cart`). */
export const cartSnapshotSchema = z.object({
  items: z.array(cartItemSchema).max(CART_MAX_ITEMS),
});
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;
