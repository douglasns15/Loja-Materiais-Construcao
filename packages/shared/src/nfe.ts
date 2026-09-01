import { z } from 'zod';
import { onlyDigits } from './format';
import { normalizeGtin, normalizeNcm } from './catalog';
import { unitTypeSchema } from './product';

/**
 * Importação de XML de NF-e (ADR-025, Fatia 2) — helpers PUROS de parsing/normalização + schemas
 * do payload de entrada. Sem I/O e sem DOM: a leitura do XML em si (via `DOMParser`) vive no
 * navegador (`apps/web/lib/nfe.ts`), que extrai os campos crus e chama estes construtores. Assim a
 * lógica arriscada (decimais de quantidade/custo, chave da nota, EAN "SEM GTIN") roda igual no
 * cliente e é 100% testável em Vitest, no mesmo espírito de `format.ts`/`catalog.ts`.
 *
 * A NF-e traz quantidade/custo na unidade COMERCIAL do fornecedor (`uCom`, ex.: "CX" de 12) — na
 * Fatia 2.A o operador confirma/ajusta por linha (sem conversão automática; ver ADR-025 §5). O que
 * for confirmado gera Entrada de estoque (INCOME, ADR-001) e alimenta o catálogo global.
 */

/** Cabeçalho da nota — fornecedor (emitente), número e chave de acesso (idempotência por item). */
export type NFeHeader = {
  /** Chave de acesso de 44 dígitos (`chNFe`), ou null se ausente/malformada. */
  accessKey: string | null;
  /** Número da nota (`ide/nNF`). */
  number: string | null;
  /** Razão social do emitente (`emit/xNome`). */
  supplierName: string | null;
  /** CNPJ do emitente, só dígitos (14) ou null. */
  supplierCnpj: string | null;
};

/** Um item da nota (`det/prod`), já normalizado. `ean` é o GTIN válido (null p/ "SEM GTIN"). */
export type NFeItem = {
  /** Número do item dentro da nota (`det@nItem`) — chave de idempotência junto com a `accessKey`. */
  nItem: number;
  /** Código do produto no fornecedor (`cProd`). */
  supplierCode: string | null;
  /** GTIN normalizado (`cEAN`) — null quando "SEM GTIN"/inválido (não vira chave de catálogo). */
  ean: string | null;
  /** O `cEAN` cru como veio (para exibir/guardar mesmo quando não é GTIN válido). */
  rawEan: string | null;
  /** Descrição do produto na nota (`xProd`). */
  name: string;
  /** NCM normalizado a 8 dígitos, ou null. */
  ncm: string | null;
  /** Unidade comercial do fornecedor (`uCom`, ex.: "UN", "CX"). Só rótulo — não converte nada. */
  unit: string | null;
  /** Quantidade comercial (`qCom`). */
  quantity: number;
  /** Custo unitário comercial (`vUnCom`). */
  unitCost: number;
  /**
   * Unidade TRIBUTÁVEL (`uTrib`) — costuma ser a unidade de venda (ex.: "UN"). Usada, junto com a
   * quantidade tributável, para SUGERIR o fator de embalagem no De-Para (ADR-025 §5.B, Fatia 2.B).
   */
  unitTrib: string | null;
  /** Quantidade tributável (`qTrib`) — base da sugestão de fator (`qTrib ÷ qCom`). */
  quantityTrib: number;
  /** Custo unitário tributável (`vUnTrib`) — referência; a conversão oficial usa `vUnCom ÷ fator`. */
  unitCostTrib: number;
  /** Valor total do item (`vProd`). */
  total: number;
};

/** Nota inteira parseada: cabeçalho + itens. */
export type NFeDoc = {
  header: NFeHeader;
  items: NFeItem[];
};

/** String não-vazia após trim, ou null. */
function orNull(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

/**
 * Converte um decimal da NF-e em número. O padrão da NF-e é ponto decimal SEM separador de milhar
 * (ex.: "1234.5600"); por segurança toleramos vírgula decimal ("1234,56"). Valor ausente/inválido/
 * negativo vira 0 — nunca `NaN` (que envenenaria cálculos de estoque/custo).
 */
export function parseNfeDecimal(raw: string | null | undefined): number {
  const s = (raw ?? '').trim();
  if (!s) return 0;
  const normalized = s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Extrai a chave de acesso de 44 dígitos do atributo `Id` da NF-e (ex.: "NFe3520...123") ou do
 * campo `chNFe`. Devolve os 44 dígitos, ou null se não houver exatamente 44 (não dá pra idempotência).
 */
export function nfeAccessKeyFromId(raw: string | null | undefined): string | null {
  const digits = onlyDigits(raw);
  return digits.length === 44 ? digits : null;
}

/**
 * Normaliza o `cEAN`/`cEANTrib` da NF-e para uso como chave do catálogo: só um GTIN estruturalmente
 * válido passa; "SEM GTIN", vazio ou código não-GTIN viram null (reusa a regra do catálogo global).
 */
export function normalizeNfeEan(raw: string | null | undefined): string | null {
  return normalizeGtin(raw ?? '');
}

/** Campos crus de um item, como o `DOMParser` os extrai do XML (strings). */
export type RawNfeItem = {
  nItem: string | number | null | undefined; // atributo det@nItem
  supplierCode?: string | null; // cProd
  ean?: string | null; // cEAN
  name?: string | null; // xProd
  ncm?: string | null; // NCM
  unit?: string | null; // uCom
  quantity?: string | null; // qCom
  unitCost?: string | null; // vUnCom
  unitTrib?: string | null; // uTrib
  quantityTrib?: string | null; // qTrib
  unitCostTrib?: string | null; // vUnTrib
  total?: string | null; // vProd
};

/** Constrói um `NFeItem` normalizado a partir dos campos crus do XML. Puro. */
export function buildNfeItem(raw: RawNfeItem): NFeItem {
  return {
    nItem: Math.trunc(Number(raw.nItem)) || 0,
    supplierCode: orNull(raw.supplierCode),
    ean: normalizeNfeEan(raw.ean),
    rawEan: orNull(raw.ean),
    name: (raw.name ?? '').trim(),
    ncm: normalizeNcm(raw.ncm),
    unit: orNull(raw.unit),
    quantity: parseNfeDecimal(raw.quantity),
    unitCost: parseNfeDecimal(raw.unitCost),
    unitTrib: orNull(raw.unitTrib),
    quantityTrib: parseNfeDecimal(raw.quantityTrib),
    unitCostTrib: parseNfeDecimal(raw.unitCostTrib),
    total: parseNfeDecimal(raw.total),
  };
}

/** Campos crus do cabeçalho, como o `DOMParser` os extrai. */
export type RawNfeHeader = {
  accessKey?: string | null; // Id do infNFe ou chNFe
  number?: string | null; // ide/nNF
  supplierName?: string | null; // emit/xNome
  supplierCnpj?: string | null; // emit/CNPJ
};

/** Constrói o `NFeHeader` normalizado a partir dos campos crus. Puro. */
export function buildNfeHeader(raw: RawNfeHeader): NFeHeader {
  const cnpj = onlyDigits(raw.supplierCnpj);
  return {
    accessKey: nfeAccessKeyFromId(raw.accessKey),
    number: orNull(raw.number),
    supplierName: orNull(raw.supplierName),
    supplierCnpj: cnpj.length === 14 ? cnpj : null,
  };
}

/**
 * Chave natural de idempotência de um item da nota: `<chNFe>:<nItem>`. Só existe quando há chave de
 * acesso (sem ela não há como reconhecer a MESMA nota reimportada). Usada para pré-marcar no De-Para
 * só os itens que ainda NÃO deram entrada (o servidor grava um `AuditEvent NFE_ITEM_IMPORTED`).
 */
export function nfeItemKey(accessKey: string | null, nItem: number): string | null {
  if (!accessKey || !Number.isInteger(nItem) || nItem <= 0) return null;
  return `${accessKey}:${nItem}`;
}

// ---------------------------------------------------------------------------
// Payload da confirmação do De-Para (`POST /nfe/entry`) e da checagem de reimport.
// ---------------------------------------------------------------------------

/**
 * Produto NOVO cadastrado na hora a partir de um item da nota (quando o operador não casou com um
 * produto existente). O custo vem do item (`newCostPrice`); o `salePrice` é definido pelo operador
 * no De-Para (a nota não traz preço de venda).
 */
export const nfeNewProductSchema = z.object({
  sku: z.string().min(1).max(60),
  ean: z.string().max(14).optional(),
  name: z.string().min(1).max(150),
  manufacturer: z.string().max(120).optional(),
  unit: unitTypeSchema.default('UNIT'),
  salePrice: z.number().nonnegative(),
});
export type NfeNewProductInput = z.infer<typeof nfeNewProductSchema>;

/**
 * Uma linha confirmada do De-Para. Ou casa um produto existente (`productId`) OU cria um novo
 * (`newProduct`). `quantity`/`newCostPrice` já vêm na UNIDADE DE VENDA (o operador confirmou/ajustou
 * — não há conversão automática na 2.A). Os campos de ficha alimentam o catálogo global.
 */
export const nfeEntryItemSchema = z
  .object({
    nItem: z.number().int().positive(),
    productId: z.string().uuid().optional(),
    newProduct: nfeNewProductSchema.optional(),
    quantity: z.number().positive(),
    /** Novo custo do cadastro por unidade de venda ("último custo", ADR-025/estoque). */
    newCostPrice: z.number().positive().optional(),
    /**
     * Novo PREÇO DE VENDA do cadastro (por unidade de venda). Só faz sentido casando um produto
     * existente — permite reajustar o preço em função do custo que chegou na nota. Ausente = mantém
     * o preço atual. Quando informado, o servidor considera a margem "revisada" e limpa o aviso de
     * revisão de preço (`priceReviewPendingAt`) em vez de acendê-lo pela mudança de custo.
     */
    newSalePrice: z.number().nonnegative().optional(),
    /**
     * Nova UNIDADE de venda do produto casado (ex.: trocar PC → UN na importação). Só ao casar um
     * existente; ausente = mantém a unidade atual do cadastro. Muda `Product.unit`.
     */
    newUnit: unitTypeSchema.optional(),
    /**
     * Fator de embalagem a LEMBRAR no produto (`Product.nfePackFactor`): quantas unidades de venda
     * vêm numa unidade comercial (ex.: 50). Enviado quando > 1; nas próximas notas o De-Para
     * pré-sugere. Vale para produto novo e casado. Ausente/1 ⇒ não altera o fator lembrado.
     */
    packFactor: z.number().int().positive().optional(),
    // Ficha p/ o catálogo global (upsert por EAN). Só grava com EAN GTIN válido no servidor.
    ean: z.string().max(14).optional(),
    officialName: z.string().max(200).optional(),
    ncm: z.string().max(8).optional(),
  })
  .refine((i) => Boolean(i.productId) !== Boolean(i.newProduct), {
    message: 'Informe productId (existente) OU newProduct (novo), nunca ambos.',
  });
export type NfeEntryItemInput = z.infer<typeof nfeEntryItemSchema>;

/**
 * Payload de confirmação da importação. Processado ITEM A ITEM em transação atômica (ADR-001).
 * `createSupplier` pede para criar o fornecedor pela nota (casado por CNPJ); `supplierId` usa um
 * já existente. `accessKey` habilita a idempotência por item.
 */
export const nfeEntrySchema = z
  .object({
    accessKey: z
      .string()
      .regex(/^\d{44}$/)
      .nullable()
      .optional(),
    notaNumber: z.string().max(20).optional(),
    /** Nome do arquivo XML importado — guardado no histórico de importações (tela Estoque). */
    fileName: z.string().max(200).optional(),
    supplierId: z.string().uuid().optional(),
    createSupplier: z
      .object({ name: z.string().min(1).max(120), cnpj: z.string().max(18).optional() })
      .optional(),
    items: z.array(nfeEntryItemSchema).min(1),
  })
  .refine((e) => !(e.supplierId && e.createSupplier), {
    message: 'Use supplierId OU createSupplier, não os dois.',
  });
export type NfeEntryInput = z.infer<typeof nfeEntrySchema>;

/** Resposta de `GET /nfe/imported?chNFe=` — os `nItem` da nota que já deram entrada (pré-marcação). */
export const nfeImportedResultSchema = z.object({
  accessKey: z.string(),
  importedItems: z.array(
    z.object({
      nItem: z.number().int(),
      productId: z.string().uuid().nullable(),
      importedAt: z.string(),
    }),
  ),
});
export type NfeImportedResult = z.infer<typeof nfeImportedResultSchema>;
