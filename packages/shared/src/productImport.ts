import { z } from 'zod';
import { gtinKey, isValidGtin, normalizeNcm } from './catalog';
import { onlyDigits, parseMoneyQuery } from './format';
import { CONSTRUCTION_UNIT_TYPES } from './modules';
import { unitTypeLabels, unitTypeSchema, type UnitType } from './product';

/**
 * Importação de catálogo por planilha (ADR-041 §1–§6, Fatia 3) — funções PURAS, sem I/O, reusadas
 * no navegador (pré-visualização) e na API (`POST /products/import`, fonte de verdade).
 *
 * Fluxo: o navegador lê o arquivo (`.xlsx` via `read-excel-file`, `.csv` via `parseCsv`) → acha o
 * cabeçalho (`findHeaderRow`) e casa as colunas por apelido (`matchImportColumns`) → normaliza cada
 * linha (`normalizeImportRow`) → planeja contra o cadastro (`planProductImport`: ✅ novo / 🔄 atualiza /
 * = sem mudança / ⚠️ erro) → manda as linhas novas/atualizadas em lotes. A API revalida com Zod
 * (`productImportBatchSchema`) e roda o MESMO `planProductImport` contra o banco, dentro da transação.
 *
 * Regras fixas (ADR-041 §3): casa por código de barras (`gtinKey`) → código interno → (sem nenhum
 * código) nome exato; célula vazia NUNCA apaga dado; a mesma planilha importada 2× dá o mesmo resultado.
 */

// ---------------------------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------------------------

/** Campos que a planilha pode trazer, na ORDEM das colunas do modelo NexoLoja. */
export const IMPORT_FIELDS = [
  'name',
  'salePrice',
  'unit',
  'ean',
  'sku',
  'popularName',
  'manufacturer',
  'description',
  'category',
  'costPrice',
  'stockQty',
  'minStockQty',
  'trackStock',
  'scaleCode',
  'ncm',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Título de cada coluna no modelo NexoLoja (e rótulo na tela de importação). */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Nome',
  salePrice: 'Preço de venda',
  unit: 'Unidade',
  ean: 'Código de barras',
  sku: 'Código interno',
  popularName: 'Nome popular',
  manufacturer: 'Marca',
  description: 'Descrição',
  category: 'Categoria',
  costPrice: 'Custo',
  stockQty: 'Estoque atual',
  minStockQty: 'Estoque mínimo',
  trackStock: 'Controla estoque (S/N)',
  scaleCode: 'Código na balança',
  ncm: 'NCM',
};

/** Colunas sem as quais não dá para importar (produto novo exige nome e preço — ADR-041 §2). */
export const IMPORT_REQUIRED_FIELDS: readonly ImportField[] = ['name', 'salePrice'];

/**
 * Normaliza um título de coluna para comparação: minúsculo, sem acento, só letras/dígitos separados
 * por um espaço. "Preço de Venda (R$)" → "preco de venda r".
 */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Apelidos conhecidos de cada coluna (já normalizados). Cresce com o uso (ADR-041 — "fica mais
 * difícil: manter a lista de apelidos"). O título do próprio modelo entra automaticamente.
 * "descricao" é da coluna Descrição; se a planilha NÃO tiver coluna de nome, ela vira o nome (muito
 * sistema exporta o nome do produto como "Descrição") — ver `matchImportColumns`.
 */
const IMPORT_ALIASES: Record<ImportField, readonly string[]> = {
  name: ['nome', 'produto', 'nome do produto', 'nome produto', 'descricao do produto', 'descricao produto', 'mercadoria', 'item'],
  salePrice: ['preco', 'preco venda', 'preco de venda r', 'valor venda', 'valor de venda', 'vlr venda', 'vl venda', 'preco varejo', 'preco unitario', 'pv', 'venda', 'valor'],
  unit: ['unidade', 'un', 'und', 'unid', 'unidade de venda', 'unidade de medida', 'medida'],
  ean: ['codigo de barras', 'cod barras', 'cod de barras', 'codigo barras', 'ean', 'ean13', 'gtin', 'codigo ean', 'barras'],
  sku: ['codigo interno', 'cod interno', 'codigo', 'cod', 'sku', 'referencia', 'ref', 'cod produto', 'codigo do produto'],
  popularName: ['nome popular', 'apelido', 'nome curto'],
  manufacturer: ['marca', 'fabricante'],
  description: ['descricao', 'observacao', 'observacoes', 'obs', 'detalhes'],
  category: ['categoria', 'grupo', 'departamento', 'secao', 'familia'],
  costPrice: ['custo', 'preco de custo', 'preco custo', 'valor custo', 'vlr custo', 'custo unitario'],
  stockQty: ['estoque atual', 'estoque', 'quantidade', 'qtd', 'qtde', 'quant', 'saldo', 'estoque inicial'],
  minStockQty: ['estoque minimo', 'minimo', 'est minimo', 'qtd minima', 'quantidade minima'],
  trackStock: ['controla estoque s n', 'controla estoque', 'controlar estoque'],
  scaleCode: ['codigo na balanca', 'codigo balanca', 'cod balanca', 'plu'],
  ncm: ['ncm', 'classificacao fiscal'],
};

const ALIAS_TO_FIELD: Map<string, ImportField> = (() => {
  const m = new Map<string, ImportField>();
  for (const f of IMPORT_FIELDS) {
    m.set(normalizeHeader(IMPORT_FIELD_LABELS[f]), f);
    for (const a of IMPORT_ALIASES[f]) m.set(a, f);
  }
  return m;
})();

/** Campo de uma coluna pelo título (ou `null` se o título não é conhecido). */
export function fieldForHeader(raw: unknown): ImportField | null {
  const key = normalizeHeader(raw);
  return key ? (ALIAS_TO_FIELD.get(key) ?? null) : null;
}

export interface ColumnMatch {
  /** Campo de cada coluna do arquivo, na mesma posição (`null` = coluna ignorada). */
  mapping: (ImportField | null)[];
  /** Campos reconhecidos (sem repetição, na ordem do modelo). */
  recognized: ImportField[];
  /** Títulos das colunas que não casaram com nada (serão ignoradas). */
  ignored: string[];
  /** Colunas obrigatórias que faltam — sem elas a importação não começa. */
  missingRequired: ImportField[];
}

/**
 * Casa o cabeçalho do arquivo com os campos por apelido. A 1ª coluna de cada campo vence; uma
 * segunda coluna com o mesmo significado é ignorada (evita duas fontes para o mesmo dado). Sem
 * coluna de nome e com uma de "Descrição", a descrição vira o nome.
 */
export function matchImportColumns(headers: readonly unknown[]): ColumnMatch {
  const mapping: (ImportField | null)[] = [];
  const used = new Set<ImportField>();
  const ignored: string[] = [];
  headers.forEach((h) => {
    const f = fieldForHeader(h);
    if (f && !used.has(f)) {
      used.add(f);
      mapping.push(f);
    } else {
      mapping.push(null);
      const title = String(h ?? '').trim();
      if (title) ignored.push(title);
    }
  });
  if (!used.has('name') && used.has('description')) {
    const i = mapping.indexOf('description');
    mapping[i] = 'name';
    used.delete('description');
    used.add('name');
  }
  const recognized = IMPORT_FIELDS.filter((f) => used.has(f));
  const missingRequired = IMPORT_REQUIRED_FIELDS.filter((f) => !used.has(f));
  return { mapping, recognized, ignored, missingRequired };
}

/**
 * Acha a linha de cabeçalho: a 1ª, entre as primeiras 10, que tem pelo menos 2 títulos conhecidos
 * (exportação de sistema às vezes vem com título/data antes). Devolve o índice ou -1.
 */
export function findHeaderRow(rows: readonly (readonly unknown[])[]): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const known = new Set(rows[i]!.map(fieldForHeader).filter(Boolean));
    if (known.size >= 2) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

/**
 * Lê um CSV (já decodificado em texto) para linhas de células. Detecta o separador pela 1ª linha
 * (`;` — padrão do Excel em português —, `,` ou tabulação), respeita aspas (com `""` como aspa
 * literal e quebra de linha dentro de aspas), ignora o BOM e aceita `\r\n`/`\n`.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => {
    let n = 0;
    let quoted = false;
    for (const c of firstLine) {
      if (c === '"') quoted = !quoted;
      else if (c === ch && !quoted) n++;
    }
    return n;
  };
  const candidates: [string, number][] = [
    [';', count(';')],
    [',', count(',')],
    ['\t', count('\t')],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const sep = candidates[0]![1] > 0 ? candidates[0]![0] : ';';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Escapa uma célula para CSV com `;` (o arquivo "linhas com erro" que o lojista abre no Excel). */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------------------------------

/** Valor de célula como vem do leitor: texto do CSV ou número/texto/booleano/data do `.xlsx`. */
export type ImportCell = string | number | boolean | Date | null | undefined;

/** Texto de uma célula (sem espaços nas pontas). Data e vazio viram ''. */
export function cellText(v: ImportCell): string {
  if (v == null || v instanceof Date) return '';
  if (typeof v === 'boolean') return v ? 'S' : 'N';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return v.trim();
}

/** Arredonda à precisão de 4 casas do banco (`Decimal(12,4)`). */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Teto de sanidade: código de barras colado na coluna de preço/estoque vira "7891000100103" — melhor
 * recusar do que gravar um valor absurdo (mesma trava do cadastro em sequência).
 */
export const IMPORT_MAX_VALUE = 1_000_000;

type Parsed<T> = { value: T } | { error: string } | null;

/**
 * Dinheiro: "R$ 1.234,56", "1234,56", "1234.56" (texto) ou o número da célula. Vazio ⇒ `null`
 * (não mexe). Número da célula guarda até 4 casas (custo); texto segue a regra BR do `parseMoneyQuery`.
 */
export function parseImportMoney(v: ImportCell): Parsed<number> {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return { error: 'valor negativo ou inválido' };
    if (v >= IMPORT_MAX_VALUE) return { error: 'valor alto demais (código no lugar do preço?)' };
    return { value: round4(v) };
  }
  const s = cellText(v);
  if (!s) return null;
  if (/-/.test(s)) return { error: 'valor negativo' };
  if (!/^(r\$)?[\s\d.,]+$/i.test(s)) return { error: `"${s}" não é um valor` };
  const n = parseMoneyQuery(s);
  if (n == null) return { error: `"${s}" não é um valor` };
  if (n >= IMPORT_MAX_VALUE) return { error: 'valor alto demais (código no lugar do preço?)' };
  return { value: n };
}

/**
 * Quantidade (estoque): número da célula ou texto "12", "1,5", "1.000" (milhar BR), "0,850". Vazio
 * ⇒ `null`. Arredonda a 4 casas (precisão do estoque).
 */
export function parseImportQty(v: ImportCell): Parsed<number> {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else {
    const s = cellText(v).replace(/\s/g, '');
    if (!s) return null;
    if (!/^-?[\d.,]+$/.test(s)) return { error: `"${s}" não é uma quantidade` };
    let norm: string;
    if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, '');
    else norm = s;
    n = Number(norm);
  }
  if (!Number.isFinite(n)) return { error: 'quantidade inválida' };
  if (n < 0) return { error: 'quantidade negativa' };
  if (n >= IMPORT_MAX_VALUE) return { error: 'quantidade alta demais (código no lugar do estoque?)' };
  return { value: round4(n) };
}

/** S/N: "S", "Sim", "X", "1", "true" ⇒ `true`; "N", "Não", "0", "false" ⇒ `false`; vazio ⇒ `null`. */
export function parseYesNo(v: ImportCell): Parsed<boolean> {
  if (typeof v === 'boolean') return { value: v };
  const s = normalizeHeader(cellText(v));
  if (!s) return null;
  if (['s', 'sim', 'x', '1', 'true', 'y', 'yes'].includes(s)) return { value: true };
  if (['n', 'nao', '0', 'false', 'no'].includes(s)) return { value: false };
  return { error: `"${cellText(v)}" — use S ou N` };
}

/** Apelidos de unidade (normalizados) → `UnitType`. */
const UNIT_ALIASES: Record<string, UnitType> = {
  un: 'UNIT', und: 'UNIT', unid: 'UNIT', unidade: 'UNIT', unidades: 'UNIT', u: 'UNIT', pc: 'UNIT', pca: 'UNIT', peca: 'UNIT', unit: 'UNIT',
  kg: 'KILOGRAM', kgs: 'KILOGRAM', quilo: 'KILOGRAM', quilos: 'KILOGRAM', kilo: 'KILOGRAM', quilograma: 'KILOGRAM', kilograma: 'KILOGRAM', kilogram: 'KILOGRAM',
  l: 'LITER', lt: 'LITER', lts: 'LITER', litro: 'LITER', litros: 'LITER', liter: 'LITER',
  m: 'METER', mt: 'METER', metro: 'METER', metros: 'METER', meter: 'METER',
  m2: 'SQUARE_METER', 'metro quadrado': 'SQUARE_METER', square_meter: 'SQUARE_METER', 'square meter': 'SQUARE_METER',
  m3: 'CUBIC_METER', 'metro cubico': 'CUBIC_METER', 'cubic meter': 'CUBIC_METER',
  mil: 'THOUSAND', milheiro: 'THOUSAND', thousand: 'THOUSAND',
  sc: 'BAG', saco: 'BAG', bag: 'BAG',
  rl: 'ROLL', rolo: 'ROLL', roll: 'ROLL',
  br: 'BARRA', barra: 'BARRA',
  pct: 'PACK', pacote: 'PACK', fardo: 'PACK', pack: 'PACK',
};

/** Unidade por apelido ("Quilo", "KG", "Litro", "UN"…). Vazio ⇒ `null` (padrão do cadastro). */
export function parseImportUnit(v: ImportCell): Parsed<UnitType> {
  const raw = cellText(v);
  if (!raw) return null;
  const key = normalizeHeader(raw.replace(/²/g, '2').replace(/³/g, '3'));
  const unit = UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/ /g, '_')];
  return unit ? { value: unit } : { error: `unidade "${raw}" desconhecida (use UN, KG, L, PCT…)` };
}

/** Caminho de categoria: "Sorvetes" ou "Sorvetes > Premium" (no máximo 2 níveis). */
export function parseCategoryPath(v: ImportCell): Parsed<string[]> {
  const raw = cellText(v);
  if (!raw) return null;
  const parts = raw
    .split('>')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length > 2) return { error: 'categoria com mais de 2 níveis (use "Categoria > Subcategoria")' };
  if (parts.some((p) => p.length > 80)) return { error: 'nome de categoria com mais de 80 caracteres' };
  return { value: parts };
}

// ---------------------------------------------------------------------------------------------
// Linha normalizada (o que trafega para a API)
// ---------------------------------------------------------------------------------------------

/**
 * Linha já interpretada. Campo AUSENTE = célula vazia = **não mexe** no cadastro (ADR-041 §3).
 * `line` é o número da linha na planilha (para o operador achar o erro).
 */
export const importRowSchema = z.object({
  line: z.number().int().positive(),
  name: z.string().trim().min(1).max(150).optional(),
  salePrice: z.number().nonnegative().lt(IMPORT_MAX_VALUE).optional(),
  unit: unitTypeSchema.optional(),
  ean: z.string().regex(/^\d{8,14}$/).optional(),
  sku: z.string().trim().min(1).max(60).optional(),
  popularName: z.string().trim().min(1).max(150).optional(),
  manufacturer: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  category: z.array(z.string().trim().min(1).max(80)).min(1).max(2).optional(),
  costPrice: z.number().nonnegative().lt(IMPORT_MAX_VALUE).optional(),
  stockQty: z.number().nonnegative().lt(IMPORT_MAX_VALUE).optional(),
  minStockQty: z.number().nonnegative().lt(IMPORT_MAX_VALUE).optional(),
  trackStock: z.boolean().optional(),
  scaleCode: z.string().regex(/^[1-9]\d{0,5}$/).optional(),
  ncm: z.string().regex(/^\d{8}$/).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/** Máximo de linhas por lote enviado à API (ADR-041 §5: lotes de ~100). */
export const IMPORT_BATCH_SIZE = 100;
/** Máximo de linhas de produto por arquivo (acima disso, dividir a planilha). */
export const IMPORT_MAX_ROWS = 5000;

/** Corpo do `POST /products/import`: um lote de linhas de uma importação (`importId`). */
export const productImportBatchSchema = z.object({
  /** Gerado no navegador no início da importação; junta os lotes num único `AuditEvent`. */
  importId: z.string().uuid(),
  fileName: z.string().trim().max(200).optional(),
  rows: z.array(importRowSchema).min(1).max(IMPORT_BATCH_SIZE),
});
export type ProductImportBatch = z.infer<typeof productImportBatchSchema>;

/** Resultado de cada linha devolvido pela API. */
export type ImportLineResult = {
  line: number;
  status: 'created' | 'updated' | 'unchanged' | 'error';
  message?: string;
};

export interface NormalizedImportRow {
  line: number;
  /** Linha pronta para planejar; ausente quando há erro de formato. */
  row: ImportRow | null;
  errors: string[];
}

const TEXT_LIMITS: Partial<Record<ImportField, number>> = {
  name: 150,
  sku: 60,
  popularName: 150,
  manufacturer: 120,
  description: 500,
};

/**
 * Interpreta as células de uma linha conforme o `mapping`. Linha totalmente vazia ⇒ `null` (pulada).
 * Erros de FORMATO ficam aqui (preço "abc", EAN com dígito errado, NCM curto); regras que dependem
 * do cadastro (nome obrigatório no produto novo, código repetido) ficam no `planProductImport`.
 */
export function normalizeImportRow(
  cells: readonly ImportCell[],
  mapping: readonly (ImportField | null)[],
  line: number,
): NormalizedImportRow | null {
  if (cells.every((c) => cellText(c) === '')) return null;
  const row: ImportRow = { line };
  const errors: string[] = [];
  const label = (f: ImportField) => IMPORT_FIELD_LABELS[f];

  mapping.forEach((field, i) => {
    if (!field) return;
    const v = cells[i];
    const take = <T>(p: Parsed<T>, set: (x: T) => void) => {
      if (!p) return;
      if ('error' in p) errors.push(`${label(field)}: ${p.error}`);
      else set(p.value);
    };
    switch (field) {
      case 'salePrice':
      case 'costPrice':
        take(parseImportMoney(v), (x) => (row[field] = x));
        return;
      case 'stockQty':
      case 'minStockQty':
        take(parseImportQty(v), (x) => (row[field] = x));
        return;
      case 'trackStock':
        take(parseYesNo(v), (x) => (row.trackStock = x));
        return;
      case 'unit':
        take(parseImportUnit(v), (x) => (row.unit = x));
        return;
      case 'category':
        take(parseCategoryPath(v), (x) => (row.category = x));
        return;
      case 'ean': {
        const raw = cellText(v);
        if (!raw) return;
        const digits = onlyDigits(raw);
        if (!isValidGtin(digits)) {
          errors.push(
            `${label(field)}: "${raw}" não é um código de barras válido — se for código da loja, use a coluna Código interno`,
          );
        } else {
          row.ean = digits;
        }
        return;
      }
      case 'ncm': {
        const raw = cellText(v);
        if (!raw) return;
        const ncm = normalizeNcm(raw);
        if (!ncm) errors.push(`${label(field)}: "${raw}" — o NCM tem 8 dígitos`);
        else row.ncm = ncm;
        return;
      }
      case 'scaleCode': {
        const raw = cellText(v);
        if (!raw) return;
        const digits = raw.replace(/^0+/, '');
        if (!/^\d{1,6}$/.test(raw) || !digits) {
          errors.push(`${label(field)}: "${raw}" — use de 1 a 6 dígitos (não zero)`);
        } else {
          row.scaleCode = digits;
        }
        return;
      }
      default: {
        // Campos de texto livre: nome, código interno, nome popular, marca, descrição.
        const s = cellText(v).replace(/\s+/g, ' ');
        if (!s) return;
        const max = TEXT_LIMITS[field] ?? 150;
        if (s.length > max) errors.push(`${label(field)}: mais de ${max} caracteres`);
        else row[field] = s;
      }
    }
  });

  return { line, row: errors.length ? null : row, errors };
}

// ---------------------------------------------------------------------------------------------
// Planejamento contra o cadastro (o "motor único de casamento" do ADR-041)
// ---------------------------------------------------------------------------------------------

/** Produto da loja como o planejador precisa (números já como `number`). */
export interface ImportExistingProduct {
  id: string;
  sku: string;
  ean: string | null;
  name: string;
  unit: string;
  popularName: string | null;
  manufacturer: string | null;
  description: string | null;
  categoryId: string | null;
  salePrice: number;
  costPrice: number;
  stockQty: number;
  minStockQty: number;
  trackStock: boolean | null;
  scaleCode: string | null;
  ncm: string | null;
}

/** Categoria da loja (`GET /categories`). */
export interface ImportCategory {
  id: string;
  name: string;
  parentId: string | null;
}

/** Decisão de estoque de um produto existente — o `planOpeningCount` do core (ADR-001), injetado. */
export type ImportStockPlan =
  | { kind: 'untracked' }
  | { kind: 'same' }
  | { kind: 'adjust'; type: 'INCOME' | 'EXPENSE'; quantity: number };

export interface ImportPlanOptions {
  categories: readonly ImportCategory[];
  /** Regra de estoque do core (`planOpeningCount`) — o shared não depende do core. */
  planStock: (product: { stockQty: number; trackStock?: boolean | null }, countedQty: number) => ImportStockPlan;
  /**
   * TODOS os SKUs já usados na loja, inclusive de produtos EXCLUÍDOS (o índice único do banco os
   * inclui). A API passa a lista completa; o navegador, a que tem (só os não excluídos).
   */
  takenSkus?: ReadonlySet<string>;
  /** Módulo de obra ligado? Sem ele, milheiro/saco/metro… ficam fora (gating de tela, ADR-039 §3). */
  constructionOn?: boolean;
  /** Módulo de balança ligado? Sem ele, o "Código na balança" é ignorado com aviso. */
  scaleOn?: boolean;
}

/** Uma alteração mostrada na pré-visualização ("Preço de venda: 7,50 → 8,00"). */
export interface ImportChange {
  field: ImportField;
  from: string;
  to: string;
}

/** Campos que um "Atualiza" grava (só o que mudou). */
export interface ImportPatch {
  name?: string;
  sku?: string;
  ean?: string;
  popularName?: string;
  manufacturer?: string;
  description?: string;
  salePrice?: number;
  costPrice?: number;
  minStockQty?: number;
  scaleCode?: string;
  ncm?: string;
  /** Caminho da categoria nova (a API resolve/cria o id). */
  category?: string[];
}

export type ImportPlanItem =
  | { kind: 'error'; line: number; message: string }
  | {
      kind: 'create';
      line: number;
      /** Linha limpa (o que vai para a API — sem campos ignorados pelo ramo). */
      row: ImportRow;
      sku: string;
      unit: UnitType;
      trackStock: boolean;
      /** Estoque inicial a lançar (Entrada "Carga inicial (planilha)"); 0 = nenhum. */
      initialStock: number;
      warnings: string[];
    }
  | {
      kind: 'update';
      line: number;
      row: ImportRow;
      product: ImportExistingProduct;
      patch: ImportPatch;
      changes: ImportChange[];
      stock: ImportStockPlan & { countedQty?: number };
      warnings: string[];
    }
  | { kind: 'unchanged'; line: number; row: ImportRow; product: ImportExistingProduct; warnings: string[] };

/** Unidades fechadas: exigem o tamanho da embalagem, que a planilha não traz (ADR-017/030). */
const CLOSED_UNITS: readonly string[] = ['BARRA', 'ROLL', 'PACK'];

/** Nome para comparação (sem acento/caixa/espaço extra). */
export function importNameKey(name: string): string {
  return normalizeHeader(name);
}

/** Acha o id da categoria pelo caminho (sem acento/caixa); `null` = ainda não existe (será criada). */
export function resolveCategoryPath(path: readonly string[], categories: readonly ImportCategory[]): string | null {
  let parentId: string | null = null;
  for (const part of path) {
    const key = importNameKey(part);
    const found = categories.find((c) => c.parentId === parentId && importNameKey(c.name) === key);
    if (!found) return null;
    parentId = found.id;
  }
  return parentId;
}

/** Caminho legível da categoria de um produto ("Sorvetes > Premium"), para o "de → para". */
function categoryPathLabel(id: string | null, categories: readonly ImportCategory[]): string {
  const parts: string[] = [];
  let cur = id ? categories.find((c) => c.id === id) : undefined;
  let guard = 0;
  while (cur && guard++ < 10) {
    parts.unshift(cur.name);
    cur = cur.parentId ? categories.find((c) => c.id === cur!.parentId) : undefined;
  }
  return parts.join(' > ');
}

const BRL = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const QTY = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const sameNumber = (a: number, b: number) => Math.abs(a - b) < 0.00005;

/** SKU gerado para produto sem código: o nome em maiúsculas, sem acento ("SORVETE-CHOCOLATE-2L"). */
export function skuFromName(name: string): string {
  const base = normalizeHeader(name).replace(/ /g, '-').toUpperCase().slice(0, 54);
  return base || 'PRODUTO';
}

/**
 * Planeja a importação: para cada linha, ✅ cria / 🔄 atualiza (só o que mudou) / = sem mudança /
 * ⚠️ erro (com o motivo). PURA — roda no navegador (pré-visualização) e na API (dentro da transação,
 * contra o banco). Regras:
 *
 * - **Casamento** (ADR-041 §3, mesma ordem da NF-e): código de barras por `gtinKey` (contra `ean` ou
 *   `sku` legado) → código interno exato → sem nenhum código, **nome exato** (sem acento/caixa) quando
 *   só UM produto tem aquele nome — é o que torna idempotente a linha "sorvete de chocolate" sem código.
 * - **Repetição no arquivo**: o mesmo código (ou nome, sem código) em duas linhas ⇒ a 2ª vira erro.
 * - **Produto novo** exige nome e preço; unidade padrão UN; barra/rolo/pacote ficam de fora (precisam
 *   do tamanho da embalagem); SKU = código interno → código de barras → gerado do nome.
 * - **Produto existente**: célula vazia não apaga; unidade e "controla estoque" NÃO mudam pela planilha
 *   (mudariam o significado do saldo e do histórico) — viram aviso.
 * - **Estoque**: novo ⇒ Entrada pelo valor; existente ⇒ `planStock` (contagem de abertura pela diferença).
 */
export function planProductImport(
  rows: readonly ImportRow[],
  products: readonly ImportExistingProduct[],
  opts: ImportPlanOptions,
): ImportPlanItem[] {
  const constructionOn = opts.constructionOn ?? true;
  const scaleOn = opts.scaleOn ?? true;

  // Índices do cadastro.
  const byGtin = new Map<string, ImportExistingProduct>();
  const bySku = new Map<string, ImportExistingProduct>();
  // `ean` gravado que não é GTIN válido (código industrial legado): casa por igualdade exata.
  const byRawEan = new Map<string, ImportExistingProduct>();
  const byName = new Map<string, ImportExistingProduct[]>();
  const byScale = new Map<string, ImportExistingProduct>();
  for (const p of products) {
    for (const code of [p.ean, p.sku]) {
      const k = code ? gtinKey(code) : null;
      if (k && !byGtin.has(k)) byGtin.set(k, p);
    }
    bySku.set(p.sku.trim(), p);
    if (p.ean && !byRawEan.has(p.ean.trim())) byRawEan.set(p.ean.trim(), p);
    const nk = importNameKey(p.name);
    byName.set(nk, [...(byName.get(nk) ?? []), p]);
    if (p.scaleCode) byScale.set(p.scaleCode, p);
  }
  const takenSkus = new Set<string>(opts.takenSkus ?? []);
  for (const p of products) takenSkus.add(p.sku.trim());

  // O que as linhas anteriores do arquivo já usaram (repetição dentro da planilha).
  const seenGtin = new Map<string, number>();
  const seenSku = new Map<string, number>();
  const seenName = new Map<string, number>();
  const seenProduct = new Map<string, number>();
  const seenScale = new Map<string, number>();
  const newSkus = new Set<string>();

  return rows.map((input): ImportPlanItem => {
    const line = input.line;
    const err = (message: string): ImportPlanItem => ({ kind: 'error', line, message });
    const warnings: string[] = [];
    const row: ImportRow = { ...input };

    // Gating de módulo (só apresentação — a API passa tudo ligado).
    if (row.scaleCode && !scaleOn) {
      warnings.push('Código na balança ignorado (a loja não usa etiqueta de balança).');
      delete row.scaleCode;
    }

    // --- Repetição dentro do arquivo ---
    const gk = row.ean ? gtinKey(row.ean) : null;
    if (gk && seenGtin.has(gk)) return err(`Código de barras repetido na linha ${seenGtin.get(gk)}.`);
    if (row.sku && seenSku.has(row.sku)) return err(`Código interno repetido na linha ${seenSku.get(row.sku)}.`);
    const nameOnly = !row.ean && !row.sku;
    const nk = row.name ? importNameKey(row.name) : '';
    if (nameOnly && nk && seenName.has(nk)) {
      return err(`Mesmo nome da linha ${seenName.get(nk)} e sem código — informe o código de barras ou o interno.`);
    }
    if (row.scaleCode && seenScale.has(row.scaleCode)) {
      return err(`Código na balança repetido na linha ${seenScale.get(row.scaleCode)}.`);
    }

    // --- Casamento ---
    let product: ImportExistingProduct | null = null;
    if (gk) product = byGtin.get(gk) ?? null;
    if (!product && row.ean) product = bySku.get(row.ean) ?? null;
    if (!product && row.sku) {
      const sk = gtinKey(row.sku);
      product = (sk ? byGtin.get(sk) : null) ?? bySku.get(row.sku) ?? byRawEan.get(row.sku) ?? null;
    }
    let matchedByName = false;
    if (!product && nameOnly && nk) {
      const same = byName.get(nk) ?? [];
      if (same.length > 1) {
        return err(`Há ${same.length} produtos com esse nome no cadastro — informe o código para saber qual atualizar.`);
      }
      product = same[0] ?? null;
      matchedByName = product != null;
    }
    if (product && seenProduct.has(product.id)) {
      return err(`Este produto já foi atualizado pela linha ${seenProduct.get(product.id)}.`);
    }
    // Código interno que já é de OUTRO produto (o casamento pelo código de barras achou um, o código
    // interno aponta para outro): não dá para saber qual é o certo.
    if (row.sku && (product ? row.sku !== product.sku : false)) {
      const owner = bySku.get(row.sku);
      if ((owner && owner.id !== product!.id) || (!owner && takenSkus.has(row.sku))) {
        return err(`O código interno "${row.sku}" já é de outro produto.`);
      }
      if (newSkus.has(row.sku)) return err(`O código interno "${row.sku}" já vai para um produto novo de outra linha.`);
    }
    if (row.scaleCode) {
      const owner = byScale.get(row.scaleCode);
      if (owner && owner.id !== product?.id) {
        return err(`O código na balança ${row.scaleCode} já é do produto "${owner.name}".`);
      }
    }

    const remember = (pid: string | null) => {
      if (gk) seenGtin.set(gk, line);
      if (row.sku) seenSku.set(row.sku, line);
      if (nameOnly && nk) seenName.set(nk, line);
      if (row.scaleCode) seenScale.set(row.scaleCode, line);
      if (pid) seenProduct.set(pid, line);
    };

    // --- Produto NOVO ---
    if (!product) {
      if (!row.name) return err('Produto novo sem Nome.');
      if (row.salePrice == null) return err('Produto novo sem Preço de venda.');
      const unit: UnitType = row.unit ?? 'UNIT';
      if (CLOSED_UNITS.includes(unit)) {
        return err(
          `Unidade "${unitTypeLabels[unit]}" precisa do tamanho da embalagem — cadastre este produto pela tela de Produtos.`,
        );
      }
      if (!constructionOn && CONSTRUCTION_UNIT_TYPES.includes(unit)) {
        return err(`Unidade "${unitTypeLabels[unit]}" não está disponível para o ramo da loja.`);
      }
      let sku = row.sku ?? row.ean ?? '';
      if (sku) {
        if (newSkus.has(sku)) return err(`O código "${sku}" já vai para um produto novo de outra linha.`);
        if (takenSkus.has(sku)) {
          return err(`O código "${sku}" já é usado por um produto excluído — informe outro código interno.`);
        }
      } else {
        const base = skuFromName(row.name);
        sku = base;
        for (let n = 2; takenSkus.has(sku) || newSkus.has(sku); n++) sku = `${base}-${n}`;
      }
      const trackStock = row.trackStock ?? true;
      let initialStock = 0;
      if (row.stockQty != null && row.stockQty > 0) {
        if (trackStock) initialStock = row.stockQty;
        else warnings.push('Estoque atual ignorado: produto sem controle de estoque.');
      }
      newSkus.add(sku);
      remember(null);
      return { kind: 'create', line, row, sku, unit, trackStock, initialStock, warnings };
    }

    // --- Produto EXISTENTE ---
    remember(product.id);
    const patch: ImportPatch = {};
    const changes: ImportChange[] = [];
    const text = (field: 'name' | 'popularName' | 'manufacturer' | 'description') => {
      const v = row[field];
      if (v != null && v !== (product![field] ?? '').trim()) {
        patch[field] = v;
        changes.push({ field, from: product![field] ?? '—', to: v });
      }
    };
    const money = (field: 'salePrice' | 'costPrice') => {
      const v = row[field];
      if (v != null && !sameNumber(v, product![field])) {
        patch[field] = v;
        changes.push({ field, from: BRL(product![field]), to: BRL(v) });
      }
    };
    // Casou PELO nome ⇒ o nome é a chave, não um dado novo: não "renomeia" por caixa/acento.
    if (!matchedByName) text('name');
    money('salePrice');
    money('costPrice');
    if (row.sku && row.sku !== product.sku) {
      patch.sku = row.sku;
      newSkus.add(row.sku);
      changes.push({ field: 'sku', from: product.sku, to: row.sku });
    }
    if (row.ean && gtinKey(row.ean) !== gtinKey(product.ean ?? '')) {
      patch.ean = row.ean;
      changes.push({ field: 'ean', from: product.ean ?? '—', to: row.ean });
    }
    text('popularName');
    text('manufacturer');
    text('description');
    if (row.category) {
      const id = resolveCategoryPath(row.category, opts.categories);
      if (id !== product.categoryId || id == null) {
        patch.category = row.category;
        changes.push({
          field: 'category',
          from: categoryPathLabel(product.categoryId, opts.categories) || '—',
          to: row.category.join(' > ') + (id == null ? ' (nova)' : ''),
        });
      }
    }
    if (row.minStockQty != null && !sameNumber(row.minStockQty, product.minStockQty)) {
      patch.minStockQty = row.minStockQty;
      changes.push({ field: 'minStockQty', from: QTY(product.minStockQty), to: QTY(row.minStockQty) });
    }
    if (row.scaleCode && row.scaleCode !== product.scaleCode) {
      patch.scaleCode = row.scaleCode;
      changes.push({ field: 'scaleCode', from: product.scaleCode ?? '—', to: row.scaleCode });
    }
    if (row.ncm && row.ncm !== product.ncm) {
      patch.ncm = row.ncm;
      changes.push({ field: 'ncm', from: product.ncm ?? '—', to: row.ncm });
    }
    if (row.unit && row.unit !== product.unit) {
      const cur = unitTypeLabels[product.unit as UnitType] ?? product.unit;
      warnings.push(`Unidade diferente do cadastro — mantida (${cur}). Para trocar, edite o produto.`);
    }
    if (row.trackStock != null && row.trackStock !== (product.trackStock !== false)) {
      warnings.push('"Controla estoque" não muda pela planilha — edite o produto para trocar.');
    }

    let stock: ImportStockPlan & { countedQty?: number } = { kind: 'same' };
    if (row.stockQty != null) {
      const s = opts.planStock(product, row.stockQty);
      if (s.kind === 'untracked') warnings.push('Estoque atual ignorado: produto sem controle de estoque.');
      else if (s.kind === 'adjust') {
        stock = { ...s, countedQty: row.stockQty };
        changes.push({ field: 'stockQty', from: QTY(product.stockQty), to: QTY(row.stockQty) });
      }
    }

    if (changes.length === 0) return { kind: 'unchanged', line, row, product, warnings };
    return { kind: 'update', line, row, product, patch, changes, stock, warnings };
  });
}

/** Contagem por tipo — o resumo do topo da pré-visualização ("812 novos, 40 atualizações…"). */
export function summarizeImportPlan(items: readonly { kind: ImportPlanItem['kind'] }[]): Record<ImportPlanItem['kind'], number> {
  const out = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const i of items) out[i.kind]++;
  return out;
}
