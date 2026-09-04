import { z } from 'zod';

/**
 * Schemas de validação de Produto, compartilhados entre apps/web e apps/api.
 * Mantido sem dependência de packages/db para não carregar o Prisma no bundle do cliente.
 */

/// Espelha o enum `UnitType` de packages/db/prisma/schema.prisma.
export const unitTypeSchema = z.enum([
  'UNIT',
  'METER',
  'SQUARE_METER',
  'CUBIC_METER',
  'KILOGRAM',
  'LITER',
  'THOUSAND',
  'BAG',
  'ROLL',
  'BARRA',
  'PACK',
]);
export type UnitType = z.infer<typeof unitTypeSchema>;

/// Rótulos PT-BR de cada `UnitType`, para o dropdown de unidade de venda no cadastro
/// (e reuso futuro no PDV/comprovante). A ordem espelha o enum do schema.
export const unitTypeLabels: Record<UnitType, string> = {
  UNIT: 'Unidade (un)',
  METER: 'Metro (m)',
  SQUARE_METER: 'Metro quadrado (m²)',
  CUBIC_METER: 'Metro cúbico (m³)',
  KILOGRAM: 'Quilograma (kg)',
  LITER: 'Litro (L)',
  THOUSAND: 'Milheiro (mil)',
  BAG: 'Saco (sc)',
  ROLL: 'Rolo',
  BARRA: 'Barra',
  PACK: 'Pacote',
};

/**
 * Vocabulário PT-BR de uma unidade FECHADA como principal (ADR-017/ADR-030), para os rótulos
 * das telas concordarem em gênero e na régua fina certa — sem espalhar `unit === 'ROLL'` por
 * toda parte. `barra`/`pacote` são femininos/masculinos e a subdivisão fina muda: barra/rolo
 * são cortados por **metro** (m), pacote é aberto em **unidade** avulsa (un).
 *
 * - `article`  → "da barra" | "do rolo" | "do pacote" (para "Preço {article}").
 * - `noun`     → "barra" | "rolo" | "pacote" (singular, minúsculo; some com "s" no plural).
 * - `wholeAdj` → "inteira" | "inteiro" (concordância de "{noun} {wholeAdj}").
 * - `fine*`    → a régua fina: "metro"/"metros"/"m" para barra/rolo; "unidade"/"unidades"/"un"
 *               para pacote. É o que o estoque conta e o corte avulso vende.
 *
 * Fallback (unidade não fechada): trata como pacote/unidade — nunca é usado nesse caminho, mas
 * mantém a função total.
 */
export function closedUnitTerms(unit: UnitType | string): {
  article: string;
  noun: string;
  wholeAdj: string;
  fineNoun: string;
  fineNounPlural: string;
  fineAbbrev: string;
} {
  if (unit === 'BARRA') {
    return { article: 'da barra', noun: 'barra', wholeAdj: 'inteira', fineNoun: 'metro', fineNounPlural: 'metros', fineAbbrev: 'm' };
  }
  if (unit === 'ROLL') {
    return { article: 'do rolo', noun: 'rolo', wholeAdj: 'inteiro', fineNoun: 'metro', fineNounPlural: 'metros', fineAbbrev: 'm' };
  }
  // PACK (e fallback): a régua fina é a unidade avulsa, contada em inteiros.
  return { article: 'do pacote', noun: 'pacote', wholeAdj: 'inteiro', fineNoun: 'unidade', fineNounPlural: 'unidades', fineAbbrev: 'un' };
}

/// Payload para criar um produto. `tenantId` NÃO entra aqui — vem do contexto
/// (header temporário na Fase 1; claim do JWT na Fase 2).
export const createProductSchema = z.object({
  sku: z.string().min(1).max(60),
  /// Código de barras GTIN-8/12/13/14 (EAN/UPC), opcional e DISTINTO do `sku` (código interno).
  /// Guardado como dígitos crus (até 14). É a chave de enriquecimento pelo catálogo global
  /// (ADR-025) e alimenta a busca por scanner junto com o `sku`. Validação de dígito verificador
  /// fica em `catalog.ts` (`isValidGtin`) e é aplicada só para decidir consulta externa/cache —
  /// o armazenamento é tolerante (um código industrial sem GTIN válido ainda pode ser guardado).
  ean: z.string().max(14).optional(),
  name: z.string().min(1).max(150),
  /// Foto do produto — URL EXTERNA pública (hotlink do CDN da fonte de EAN, ADR-025) ou do R2.
  /// Nunca binário no banco (CLAUDE.md §6). Preenchida pelo enriquecimento por EAN; opcional.
  imageUrl: z.string().url().max(500).optional(),
  /// Nome popular/regional do produto — usado na busca do PDV além do nome oficial.
  /// Opcional e genérico p/ qualquer ramo (ex.: "Ferro 8", "Dipirona").
  popularName: z.string().max(150).optional(),
  /// Fabricante/marca do produto (ex.: "Votorantim", "Tigre"). Opcional e genérico
  /// p/ qualquer ramo; também entra na busca, junto com nome, nome popular e SKU.
  manufacturer: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  unit: unitTypeSchema.default('UNIT'),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  minStockQty: z.number().nonnegative().optional(),
  weightKg: z.number().positive().optional(),
  /**
   * Venda em unidade alternativa (ADR-013 — EF-3). `conversionFactor` é o TAMANHO da
   * embalagem fechada em unidade-base (ex.: 100 metros por rolo); `altUnit` é a unidade
   * da embalagem (ex.: 'ROLL') e `altSalePrice` o seu PREÇO PRÓPRIO (o fechado sai mais
   * barato por unidade-base, então NÃO é `salePrice × conversionFactor`). Os três juntos
   * habilitam o modo "rolo × metro" no PDV; qualquer um ausente ⇒ produto de uma unidade só.
   */
  conversionFactor: z.number().positive().optional(),
  altUnit: unitTypeSchema.optional(),
  altSalePrice: z.number().positive().optional(),
  /**
   * Produto agregado — venda em par (ADR-015). `pairedProductId` é o outro produto do par
   * (ex.: a bucha nº10 cadastrada no parafuso nº10) e `pairPrice` é o preço **TOTAL do par**
   * (não por item). Os dois juntos habilitam a escolha "avulso × par" no PDV; qualquer um
   * ausente ⇒ produto sem par. Cadastra-se de **um lado só** — o outro lado enxerga o mesmo
   * par por consulta reversa, então os preços nunca divergem.
   */
  pairedProductId: z.string().uuid().optional(),
  pairPrice: z.number().positive().optional(),
  /**
   * Acréscimo por forma de pagamento (ADR-016). Valor em R$ por **unidade-base** que é somado
   * ao preço quando a venda é no débito/crédito — é quanto o preço SOBE, não um custo nem o
   * preço final. **Opt-in por produto:** ausente ⇒ o produto não muda de preço naquela forma
   * de pagamento (nunca é derivado da taxa da maquininha da loja, que só informa margem).
   */
  surchargeDebit: z.number().positive().optional(),
  surchargeCredit: z.number().positive().optional(),
  /**
   * Estoque inicial (opcional). Quando > 0, o cadastro NÃO grava o saldo direto no produto:
   * a API cria o produto e gera a **Entrada** (`StockMovement` INCOME) na MESMA transação
   * (ADR-001 — `stockQty` é cache; a movimentação é a fonte de verdade), já com a autoria
   * (ADR-010). É exclusivo da criação — não existe no update (ver `updateProductSchema`).
   */
  initialStock: z.number().nonnegative().optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Payload para atualizar — todos os campos opcionais. `initialStock` é só de criação
 * (mudar estoque é sempre via movimentação, nunca por edição do cadastro — ADR-001).
 *
 * Os campos opcionais aceitam `null` além de ausente: **ausente = não mexe**, `null` =
 * **limpar a coluna**. Sem isso não haveria como apagar um fabricante/descrição já
 * gravado, nem desfazer a embalagem alternativa (EF-3) de um produto.
 */
export const updateProductSchema = createProductSchema
  .omit({ initialStock: true })
  .partial()
  .extend({
    // `null` limpa o código de barras gravado (volta a casar só pelo sku).
    ean: z.string().max(14).nullable().optional(),
    // `null` remove a foto do produto.
    imageUrl: z.string().url().max(500).nullable().optional(),
    popularName: z.string().max(150).nullable().optional(),
    manufacturer: z.string().max(120).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    weightKg: z.number().positive().nullable().optional(),
    conversionFactor: z.number().positive().nullable().optional(),
    altUnit: unitTypeSchema.nullable().optional(),
    altSalePrice: z.number().positive().nullable().optional(),
    // ADR-015: `null` desfaz o par (deixa de oferecer "avulso × par" no PDV).
    pairedProductId: z.string().uuid().nullable().optional(),
    pairPrice: z.number().positive().nullable().optional(),
    // ADR-016: `null` remove o acréscimo (o produto volta a ter preço único).
    surchargeDebit: z.number().positive().nullable().optional(),
    surchargeCredit: z.number().positive().nullable().optional(),
    // Desativar/Reativar: `false` tira o produto de circulação (some do PDV/Estoque, mas o
    // cadastro e o histórico ficam); `true` reativa. Distinto do soft-delete (`deletedAt`),
    // que é definitivo. Só existe no update — o produto sempre nasce ativo.
    isActive: z.boolean().optional(),
    // Item 5 da esteira de precificação: `true` reconhece o aviso "custo ajustado por Entrada de
    // estoque, confira o preço" e limpa `priceReviewPendingAt`. NÃO é coluna — é um SINAL que o
    // servidor traduz em `priceReviewPendingAt: null` (ver PATCH /products/:id). Assim uma edição
    // de estoque mínimo (que manda só `minStockQty`) nunca dispensa o aviso sem querer.
    dismissPriceReview: z.boolean().optional(),
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
