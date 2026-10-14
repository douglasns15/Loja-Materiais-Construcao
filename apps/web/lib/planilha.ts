import { csvCell, parseCsv, type ImportCell, type ImportExistingProduct } from '@nexoloja/shared';

/**
 * Leitura de planilha NO NAVEGADOR (ADR-041 §5 — o parse não roda no Worker). `.xlsx` usa a
 * `read-excel-file` (dependência aprovada na ADR-041), carregada sob demanda só nesta tela; `.csv`
 * usa o parser próprio do shared, tentando UTF-8 e caindo para Latin-1 (o "Salvar como CSV" do
 * Excel em português grava em Windows-1252).
 */

/** Caminho do modelo NexoLoja servido pela web (gerado por `scripts/gerar-modelo-planilha.mjs`). */
export const MODELO_PLANILHA_URL = '/modelos/modelo-produtos-nexoloja.xlsx';

/** Teto do arquivo: 10 MB cobre com folga milhares de linhas sem travar o navegador. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function readSpreadsheet(file: File): Promise<ImportCell[][]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Arquivo maior que 10 MB. Divida a planilha em partes.');
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const buf = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1252').decode(buf);
    }
    return parseCsv(text);
  }
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    try {
      const data = await readSheet(file);
      return data.map((r) => r.map((c) => (c ?? null) as ImportCell));
    } catch {
      throw new Error('Não consegui ler este .xlsx. Abra no Excel, salve de novo como .xlsx e tente outra vez.');
    }
  }
  if (name.endsWith('.xls') || name.endsWith('.ods')) {
    throw new Error('Formato antigo. Abra o arquivo no Excel (ou LibreOffice) e salve como .xlsx ou .csv.');
  }
  throw new Error('Envie um arquivo .xlsx ou .csv.');
}

/** Produto como vem do `GET /products` (numéricos como texto), no formato do planejador. */
export type CatalogProductRow = Omit<
  ImportExistingProduct,
  'salePrice' | 'costPrice' | 'stockQty' | 'minStockQty'
> & {
  salePrice: string | number;
  costPrice: string | number;
  stockQty: string | number;
  minStockQty: string | number;
};

export function toImportProduct(p: CatalogProductRow): ImportExistingProduct {
  return {
    ...p,
    salePrice: Number(p.salePrice),
    costPrice: Number(p.costPrice),
    stockQty: Number(p.stockQty),
    minStockQty: Number(p.minStockQty),
  };
}

/** Célula original de volta para texto do CSV (número decimal com vírgula, para o Excel em pt-BR). */
function cellForCsv(v: ImportCell): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('pt-BR');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'S' : 'N';
  return v;
}

/**
 * Arquivo "linhas com erro": o cabeçalho original + a coluna "Erro", com `;` e BOM (o Excel em
 * português abre direto, com acento). O lojista corrige ali mesmo e reenvia só este arquivo.
 */
export function downloadErrorCsv(
  fileName: string,
  header: readonly ImportCell[],
  lines: readonly { cells: readonly ImportCell[]; message: string }[],
): void {
  const rows = [
    [...header.map(cellForCsv), 'Erro'],
    ...lines.map((l) => [...header.map((_, i) => cellForCsv(l.cells[i] ?? null)), l.message]),
  ];
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName.replace(/\.(xlsx|csv|txt)$/i, '')}-erros.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
