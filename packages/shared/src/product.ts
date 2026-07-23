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
};

/// Payload para criar um produto. `tenantId` NÃO entra aqui — vem do contexto
/// (header temporário na Fase 1; claim do JWT na Fase 2).
export const createProductSchema = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(150),
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
  });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
