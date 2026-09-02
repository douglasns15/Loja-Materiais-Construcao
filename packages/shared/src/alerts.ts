import { z } from 'zod';
import type { UserRole } from './roles';

/**
 * Central de pendências (ADR-029) — tipos e catálogo dos alertas do "sino".
 *
 * São alertas CALCULADOS sob demanda a partir de dados que já existem (nada é armazenado no banco;
 * o alerta some sozinho quando a inconsistência é corrigida). O servidor devolve só as contagens
 * (`GET /alerts`); a lista para download vem de uma rota separada e paginada (`GET /alerts/products`).
 *
 * Fatia 1: só `product-no-cost` é calculado; os demais membros do union já existem para as próximas
 * fatias entrarem como "mais um COUNT + uma linha", sem remexer no contrato.
 */

/** Cada tipo de pendência que o sino sabe exibir (ADR-029). */
export type AlertKind =
  | 'product-no-cost' // costPrice = 0 → fica fora do lucro/margem (ADR-027)
  | 'product-cost-ge-price' // costPrice >= salePrice (ambos > 0) → margem ≤ 0
  | 'product-no-price' // salePrice = 0 → vendável a R$ 0 por engano
  | 'product-no-ean' // ean IS NULL → atrapalha o leitor no PDV
  | 'product-no-category' // categoryId IS NULL → suja relatórios/busca
  | 'stock-negative' // stockQty < 0 → movimentação inconsistente (ADR-001)
  | 'stock-below-min' // minStockQty > 0 AND stockQty <= minStockQty → ruptura
  | 'cash-open-too-long' // CashSession OPEN há muito tempo → esqueceram de fechar
  | 'cash-divergence' // fechamento com diferença
  | 'debt-stale'; // dívida (ADR-026) aberta parada há muito tempo

/** Gravidade visual do alerta. `info` não "alarma" o badge (ver Fatia 5). */
export type AlertSeverity = 'info' | 'warn' | 'danger';

/** Metadado ESTÁTICO de um tipo de alerta (rótulo/descrição para a UI + política). */
export interface AlertMeta {
  kind: AlertKind;
  /** Rótulo curto ("Produtos sem custo"). */
  label: string;
  /** Frase de impacto — por que essa pendência importa. */
  description: string;
  /** Gravidade base do tipo (a Fatia 4 pode refinar por limiar, em `core`). */
  severity: AlertSeverity;
  /**
   * Papéis a quem o alerta interessa (ADR-029 §4). **Informativo nesta entrega**: o endpoint devolve
   * tudo para qualquer papel (nasce visível a todos). Quando a tela de permissões existir, o filtro
   * passa a usar isto — sem retrabalho de modelagem.
   */
  roles: UserRole[];
  /** Tem lista de itens para baixar em CSV (`GET /alerts/products?kind=...`)? */
  downloadable: boolean;
  /** Para onde levar ao clicar quando NÃO é download (ex.: a tela do Caixa). */
  actionHref?: string;
}

/** Uma pendência ativa no período (só volta quando `count > 0`), pronta para o painel do sino. */
export interface AlertSummary {
  kind: AlertKind;
  /** Quantos itens/ocorrências alimentam a pendência. */
  count: number;
  severity: AlertSeverity;
  roles: UserRole[];
  downloadable: boolean;
  /** Para onde levar ao clicar (quando não for download). Ex.: a tela do Caixa. */
  actionHref?: string;
}

// Grupos de papéis para o catálogo (informativo nesta entrega — ADR-029 §4).
const ADMIN: UserRole[] = ['OWNER', 'MANAGER'];
const STOCK_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'STOCK'];
const CASH_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'CASHIER'];

/**
 * Catálogo dos alertas — fonte única de rótulo/descrição/política, consumida pela API (para montar
 * o `AlertSummary`) e pelo web (para renderizar o painel). Todos os tipos já têm metadado; só os
 * implementados na fatia corrente é que voltam com `count`.
 */
export const ALERT_META: Record<AlertKind, AlertMeta> = {
  'product-no-cost': {
    kind: 'product-no-cost',
    label: 'Produtos sem custo',
    description: 'Sem custo cadastrado, essas vendas ficam de fora do lucro e da margem dos relatórios.',
    severity: 'warn',
    roles: ADMIN,
    downloadable: true,
  },
  'product-cost-ge-price': {
    kind: 'product-cost-ge-price',
    label: 'Custo maior ou igual ao preço',
    description: 'Margem zero ou negativa — quase sempre erro de digitação no cadastro.',
    severity: 'danger',
    roles: ADMIN,
    downloadable: true,
  },
  'product-no-price': {
    kind: 'product-no-price',
    label: 'Produtos sem preço de venda',
    description: 'Preço zerado: o produto pode ser vendido a R$ 0 por engano.',
    severity: 'danger',
    roles: ADMIN,
    downloadable: true,
  },
  'product-no-ean': {
    kind: 'product-no-ean',
    label: 'Produtos sem código de barras',
    description: 'Sem EAN, a leitura por scanner no PDV não encontra o produto.',
    severity: 'info',
    roles: ADMIN,
    downloadable: true,
  },
  'product-no-category': {
    kind: 'product-no-category',
    label: 'Produtos sem categoria',
    description: 'Sem categoria, o produto suja os relatórios e a busca.',
    severity: 'info',
    roles: ADMIN,
    downloadable: true,
  },
  'stock-negative': {
    kind: 'stock-negative',
    label: 'Estoque negativo',
    description: 'Saldo abaixo de zero indica movimentação inconsistente.',
    severity: 'danger',
    roles: STOCK_ROLES,
    downloadable: true,
  },
  'stock-below-min': {
    kind: 'stock-below-min',
    label: 'Estoque abaixo do mínimo',
    description: 'Itens no mínimo ou em ruptura — hora de repor.',
    severity: 'warn',
    roles: STOCK_ROLES,
    downloadable: true,
  },
  'cash-open-too-long': {
    kind: 'cash-open-too-long',
    label: 'Caixa aberto há muito tempo',
    description: 'Um caixa aberto há horas costuma ser fechamento esquecido.',
    severity: 'warn',
    roles: CASH_ROLES,
    downloadable: false,
    actionHref: '/caixa',
  },
  'cash-divergence': {
    kind: 'cash-divergence',
    label: 'Divergência de caixa',
    description: 'Fechamento com diferença entre o contado e o esperado.',
    severity: 'warn',
    roles: CASH_ROLES,
    downloadable: false,
    actionHref: '/relatorios',
  },
  'debt-stale': {
    kind: 'debt-stale',
    label: 'Dívidas paradas',
    description: 'Contas a receber vencidas ou sem recebimento há muito tempo.',
    severity: 'warn',
    roles: ADMIN,
    downloadable: false,
    actionHref: '/contas-a-receber',
  },
};

/** Query da lista para download (`GET /alerts/products`). Fatias 2+3: bloco A (cadastro) + B (estoque). */
export const alertProductsQuerySchema = z.object({
  kind: z.enum([
    'product-no-cost',
    'product-cost-ge-price',
    'product-no-price',
    'product-no-ean',
    'product-no-category',
    'stock-negative',
    'stock-below-min',
  ]),
  /** Keyset de paginação (último `id` da página anterior). Ausente = primeira página. */
  cursor: z.string().uuid().optional(),
});
export type AlertProductsQuery = z.infer<typeof alertProductsQuerySchema>;

/** Uma linha de produto na lista de uma pendência (serve a todos os alertas de produto/estoque). */
export interface AlertProductRow {
  id: string;
  name: string;
  /** Código interno da loja (SKU). */
  sku: string;
  /** Código de barras (EAN), quando houver. */
  ean: string | null;
  salePrice: number;
  costPrice: number;
  stockQty: number;
}

/** Página da lista de produtos de uma pendência (keyset). `nextCursor` null ⇒ acabou. */
export interface AlertProductsPage {
  rows: AlertProductRow[];
  nextCursor: string | null;
}
