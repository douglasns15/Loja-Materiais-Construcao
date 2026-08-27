/**
 * Utilitário de CSV para exportação no CLIENTE (Relatórios v2, Fatia 10) — sem dependência.
 * Alvo: Excel em pt-BR, que usa **`;`** como separador de colunas (a vírgula é o decimal). Prefixa
 * BOM UTF-8 para os acentos saírem certos no Excel. Escapa valores com `;`, aspas ou quebra de linha.
 */

const SEP = ';';

/** Escapa um campo para CSV: envolve em aspas e dobra as aspas internas quando necessário. */
function escapeCell(value: string): string {
  if (value.includes(SEP) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Monta o corpo CSV a partir de uma matriz de linhas (cada linha = array de células string). */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(SEP)).join('\r\n');
}

/** Número em pt-BR (vírgula decimal) para célula CSV — ex.: 1234.5 → "1.234,50". */
export function csvNumber(v: number, decimals = 2): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Dispara o download de um CSV no navegador do usuário (ação local do próprio usuário — não é envio
 * a terceiros). BOM + charset utf-8 para o Excel abrir com acentos corretos.
 */
export function downloadCsv(filename: string, body: string): void {
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
