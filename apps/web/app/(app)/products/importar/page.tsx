'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IMPORT_BATCH_SIZE,
  IMPORT_FIELD_LABELS,
  IMPORT_MAX_ROWS,
  findHeaderRow,
  matchImportColumns,
  normalizeImportRow,
  planProductImport,
  summarizeImportPlan,
  unitTypeLabels,
  type ColumnMatch,
  type ImportCell,
  type ImportLineResult,
  type ImportPlanItem,
  type ImportRow,
} from '@nexoloja/shared';
import { planOpeningCount } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useModule } from '@/lib/useModule';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import type { Category } from '@/lib/categories';
import {
  MODELO_PLANILHA_URL,
  downloadErrorCsv,
  readSpreadsheet,
  toImportProduct,
  type CatalogProductRow,
} from '@/lib/planilha';

/**
 * Importar planilha (ADR-041 §1–§6, Fatia 3) — carga do catálogo em lote, para a implantação e para
 * quem vem de outro sistema. Só admin (a rota também exige).
 *
 * 1. Baixar o modelo NexoLoja (ou usar a exportação do sistema anterior).
 * 2. Enviar `.xlsx`/`.csv` — lido AQUI no navegador; as colunas casam sozinhas por apelido.
 * 3. Pré-visualizar: ✅ Novo / 🔄 Atualiza / = Sem mudança / ⚠️ Erro (com o motivo), contra o cadastro
 *    atual — o MESMO planejador (`planProductImport`, shared) que a API roda de novo ao gravar.
 * 4. Importar em lotes de 100 (`POST /products/import`), com progresso; ao fim, baixar as linhas com
 *    erro num CSV para corrigir e reenviar. Reimportar o mesmo arquivo não duplica (casamento idempotente).
 *
 * De-Para editável e perfis lembrados ficam para a Fatia 4. Tela online-only (ADR-012 (c)).
 */

type Phase = 'pick' | 'preview' | 'importing' | 'done';
type Filter = 'all' | ImportPlanItem['kind'];

/** Linha da pré-visualização: o plano + as células originais (para o CSV de erros). */
type PreviewLine = ImportPlanItem & { cells: ImportCell[]; warnings?: string[]; typedName?: string };

const KIND_LABEL: Record<ImportPlanItem['kind'], string> = {
  create: 'Novo',
  update: 'Atualiza',
  unchanged: 'Sem mudança',
  error: 'Erro',
};
const KIND_STYLE: Record<ImportPlanItem['kind'], string> = {
  create: 'bg-emerald-50 text-emerald-700',
  update: 'bg-indigo-50 text-indigo-700',
  unchanged: 'bg-gray-100 text-gray-600',
  error: 'bg-red-50 text-red-700',
};

/** Quantas linhas a tabela mostra por filtro (o resumo e o CSV contam todas). */
const SHOWN = 300;

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const QTY = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function rowName(l: PreviewLine): string {
  if (l.kind === 'update' || l.kind === 'unchanged') return l.product.name;
  if (l.kind === 'create') return l.row.name ?? '';
  return l.typedName ?? '';
}

function rowCode(l: PreviewLine): string {
  if (l.kind === 'create') return l.row.ean ?? l.sku;
  if (l.kind === 'update' || l.kind === 'unchanged') return l.product.ean || l.product.sku;
  return '';
}

/** Detalhe da linha: o que acontece com ela, em português. */
function rowDetail(l: PreviewLine): string {
  switch (l.kind) {
    case 'error':
      return l.message;
    case 'create': {
      const parts = [unitTypeLabels[l.unit], BRL(l.row.salePrice ?? 0)];
      if (l.initialStock > 0) parts.push(`estoque ${QTY(l.initialStock)}`);
      if (!l.trackStock) parts.push('sem controle de estoque');
      if (l.row.category) parts.push(l.row.category.join(' > '));
      return parts.join(' · ');
    }
    case 'update':
      return l.changes.map((c) => `${IMPORT_FIELD_LABELS[c.field]}: ${c.from} → ${c.to}`).join(' · ');
    default:
      return 'Igual ao cadastro';
  }
}

export default function ImportarPlanilhaPage() {
  const online = useOnline();
  const { isAdmin, loading: meLoading } = useMe();
  const constructionOn = useModule('CONSTRUCTION_UNITS');
  const scaleOn = useModule('SCALE_LABEL');

  const [catalog, setCatalog] = useState<CatalogProductRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [header, setHeader] = useState<ImportCell[]>([]);
  const [columns, setColumns] = useState<ColumnMatch | null>(null);
  const [dataRows, setDataRows] = useState<{ line: number; cells: ImportCell[] }[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragOver, setDragOver] = useState(false);

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Map<number, ImportLineResult>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadCatalog() {
    setLoadError(null);
    try {
      const [products, cats] = await Promise.all([
        apiGet<CatalogProductRow[]>('/products?includeInactive=true'),
        apiGet<Category[]>('/categories'),
      ]);
      setCatalog(products);
      setCategories(cats);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  // Sair da tela no meio da importação interromperia os lotes que faltam.
  useEffect(() => {
    if (phase !== 'importing') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  /** Plano da pré-visualização: erros de formato + o planejador contra o cadastro carregado. */
  const live = useMemo<PreviewLine[]>(() => {
    if (!columns || !catalog) return [];
    const formatErrors: PreviewLine[] = [];
    const valid: ImportRow[] = [];
    const cellsByLine = new Map<number, ImportCell[]>();
    // Nome como digitado na planilha — para a linha com erro não aparecer como "—".
    const nameCol = columns.mapping.indexOf('name');
    const typed = (cells: ImportCell[]) => (nameCol >= 0 ? String(cells[nameCol] ?? '').trim() || undefined : undefined);
    for (const { line, cells } of dataRows) {
      const n = normalizeImportRow(cells, columns.mapping, line);
      if (!n) continue;
      cellsByLine.set(line, cells);
      if (n.row) valid.push(n.row);
      else formatErrors.push({ kind: 'error', line, message: n.errors.join(' · '), cells, typedName: typed(cells) });
    }
    const plan = planProductImport(valid, catalog.map(toImportProduct), {
      categories,
      planStock: planOpeningCount,
      constructionOn,
      scaleOn,
    });
    return [...formatErrors, ...plan.map((p) => {
      const cells = cellsByLine.get(p.line) ?? [];
      return { ...p, cells, typedName: typed(cells) };
    })].sort(
      (a, b) => a.line - b.line,
    );
  }, [columns, catalog, categories, dataRows, constructionOn, scaleOn]);
  // Ao importar, o plano é CONGELADO: o catálogo recarregado no fim faria os recém-criados virarem
  // "sem mudança" na tabela de resultado.
  const [frozen, setFrozen] = useState<PreviewLine[] | null>(null);
  const preview = frozen ?? live;

  const summary = summarizeImportPlan(preview);
  const toSend = preview.filter((l) => l.kind === 'create' || l.kind === 'update');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const rows = await readSpreadsheet(file);
      const h = findHeaderRow(rows);
      if (h < 0) {
        throw new Error(
          'Não encontrei o cabeçalho (a linha com os títulos "Nome", "Preço de venda"…). Use o modelo NexoLoja ou confira a 1ª linha.',
        );
      }
      const match = matchImportColumns(rows[h]!);
      const body = rows
        .slice(h + 1)
        .map((cells, i) => ({ line: h + i + 2, cells }))
        .filter(({ cells }) => cells.some((c) => c != null && String(c).trim() !== ''));
      if (body.length === 0) throw new Error('A planilha não tem nenhuma linha de produto abaixo do cabeçalho.');
      if (body.length > IMPORT_MAX_ROWS) {
        throw new Error(`A planilha tem ${body.length} linhas — o limite é ${IMPORT_MAX_ROWS} por arquivo. Divida em partes.`);
      }
      setFileName(file.name);
      setHeader(rows[h]!);
      setColumns(match);
      setDataRows(body);
      setResults(new Map());
      setFilter('all');
      setPhase('preview');
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function sendBatch(importId: string, rows: ImportRow[]) {
    return apiPost<{ results: ImportLineResult[] }>('/products/import', { importId, fileName, rows });
  }

  async function onImport() {
    if (toSend.length === 0) return;
    setPhase('importing');
    setFrozen(preview);
    const importId = crypto.randomUUID();
    const out = new Map<number, ImportLineResult>();
    // Linhas que nem vão para a API (erro de formato/plano ou sem mudança) já entram no resultado.
    for (const l of preview) {
      if (l.kind === 'error') out.set(l.line, { line: l.line, status: 'error', message: l.message });
      if (l.kind === 'unchanged') out.set(l.line, { line: l.line, status: 'unchanged' });
    }
    const batches: ImportRow[][] = [];
    for (let i = 0; i < toSend.length; i += IMPORT_BATCH_SIZE) {
      batches.push(toSend.slice(i, i + IMPORT_BATCH_SIZE).map((l) => (l as { row: ImportRow }).row));
    }
    setProgress({ done: 0, total: toSend.length });
    let done = 0;
    for (const rows of batches) {
      let res: { results: ImportLineResult[] } | null = null;
      let lastError = '';
      // O lote é idempotente no servidor: re-tentar uma vez depois de uma falha é seguro.
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await sendBatch(importId, rows);
        } catch (e) {
          lastError = (e as Error).message;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (res) {
        for (const r of res.results) out.set(r.line, r);
      } else {
        for (const r of rows) out.set(r.line, { line: r.line, status: 'error', message: `Não gravado: ${lastError}` });
      }
      done += rows.length;
      setProgress({ done, total: toSend.length });
      setResults(new Map(out));
    }
    setResults(out);
    setPhase('done');
    void loadCatalog();
  }

  function reset() {
    setPhase('pick');
    setFrozen(null);
    setColumns(null);
    setDataRows([]);
    setHeader([]);
    setFileName('');
    setResults(new Map());
  }

  function onDownloadErrors() {
    const cellsByLine = new Map(dataRows.map((r) => [r.line, r.cells]));
    const lines =
      phase === 'done'
        ? [...results.values()]
            .filter((r) => r.status === 'error')
            .sort((a, b) => a.line - b.line)
            .map((r) => ({ cells: cellsByLine.get(r.line) ?? [], message: `Linha ${r.line}: ${r.message ?? 'erro'}` }))
        : preview
            .filter((l) => l.kind === 'error')
            .map((l) => ({ cells: l.cells, message: `Linha ${l.line}: ${(l as { message: string }).message}` }));
    downloadErrorCsv(fileName || 'planilha', header, lines);
  }

  const resultCounts = useMemo(() => {
    const c = { created: 0, updated: 0, unchanged: 0, error: 0 };
    for (const r of results.values()) c[r.status === 'error' ? 'error' : r.status]++;
    return c;
  }, [results]);

  const shown = (filter === 'all' ? preview : preview.filter((l) => l.kind === filter)).slice(0, SHOWN);
  const filteredTotal = filter === 'all' ? preview.length : summary[filter];
  const ready = online && catalog !== null;

  if (!meLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link href="/products" className="text-sm text-indigo-600 hover:underline">
          ← Produtos
        </Link>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          A importação de planilha é feita pelo administrador da loja.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/products" className="text-sm text-indigo-600 hover:underline">
          ← Produtos
        </Link>
        <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
          Importar planilha
        </h1>
        <p className="text-sm text-gray-500">
          Cadastre ou atualize muitos produtos de uma vez. Reimportar a mesma planilha não duplica, e célula
          vazia não apaga o que já está no cadastro.
        </p>
      </div>

      <OfflineNotice />

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>Não foi possível carregar os produtos da loja: {loadError}</span>
          <button
            type="button"
            onClick={() => void loadCatalog()}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {phase === 'pick' && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
            <div className="bg-indigo-600 px-4 py-3 font-semibold text-white">1. Modelo NexoLoja</div>
            <div className="space-y-3 p-4 text-sm text-gray-700">
              <p>
                Planilha pronta com as colunas certas e uma aba de instruções. Dá para mandar ao lojista
                preencher em casa (WhatsApp ou e-mail) antes da implantação.
              </p>
              <p className="text-gray-500">
                Obrigatórias: <strong>Nome</strong> e <strong>Preço de venda</strong>. As demais são opcionais.
                Exportação de outro sistema também serve: as colunas são reconhecidas pelo título.
              </p>
              <a
                href={MODELO_PLANILHA_URL}
                download
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 font-medium text-indigo-700 hover:bg-indigo-100"
              >
                ⤓ Baixar modelo (.xlsx)
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
            <div className="bg-indigo-600 px-4 py-3 font-semibold text-white">2. Enviar a planilha</div>
            <div className="p-4">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (ready && !reading) void onFile(e.dataTransfer.files[0]);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm ${
                  dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:bg-gray-50'
                } ${!ready || reading ? 'pointer-events-none opacity-60' : ''}`}
              >
                <span className="text-base font-medium text-gray-800">
                  {reading ? 'Lendo a planilha…' : catalog === null && !loadError ? 'Carregando produtos da loja…' : 'Escolher arquivo ou arrastar aqui'}
                </span>
                <span className="text-gray-500">.xlsx ou .csv · até {IMPORT_MAX_ROWS.toLocaleString('pt-BR')} produtos</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="hidden"
                  disabled={!ready || reading}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
              </label>
              {fileError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fileError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {phase !== 'pick' && columns && (
        <>
          <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                <strong>{fileName}</strong> · {dataRows.length.toLocaleString('pt-BR')} linhas
              </p>
              {phase === 'preview' && (
                <button type="button" onClick={reset} className="text-sm text-indigo-600 hover:underline">
                  Trocar arquivo
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Colunas reconhecidas:{' '}
              {columns.recognized.map((f) => IMPORT_FIELD_LABELS[f]).join(', ') || 'nenhuma'}
              {columns.ignored.length > 0 && <> · ignoradas: {columns.ignored.join(', ')}</>}
            </p>
            {columns.missingRequired.length > 0 && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Falta a coluna {columns.missingRequired.map((f) => `"${IMPORT_FIELD_LABELS[f]}"`).join(' e ')}. Renomeie o
                título na planilha (ou use o modelo) e envie de novo.
              </p>
            )}
          </div>

          {phase === 'preview' && columns.missingRequired.length === 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
              <p className="text-sm text-gray-800">
                <strong className="text-emerald-700">{summary.create} novos</strong> ·{' '}
                <strong className="text-indigo-700">{summary.update} atualizações</strong> · {summary.unchanged} sem mudança ·{' '}
                <strong className="text-red-700">{summary.error} com erro</strong>
                {summary.error > 0 && <span className="text-gray-500"> (as linhas com erro são puladas)</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {summary.error > 0 && (
                  <button
                    type="button"
                    onClick={onDownloadErrors}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Baixar linhas com erro
                  </button>
                )}
                <button
                  type="button"
                  disabled={!online || toSend.length === 0}
                  onClick={() => void onImport()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {toSend.length === 0 ? 'Nada para importar' : `Importar ${toSend.length} produtos`}
                </button>
              </div>
            </div>
          )}

          {phase === 'importing' && (
            <div className="mb-4 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-medium text-gray-800">
                Importando… {progress.done} de {progress.total} (não feche esta tela)
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-base font-semibold text-emerald-800">Importação concluída</p>
              <p className="mt-1 text-sm text-gray-800">
                {resultCounts.created} cadastrados · {resultCounts.updated} atualizados · {resultCounts.unchanged} sem
                mudança · <span className={resultCounts.error ? 'font-semibold text-red-700' : ''}>{resultCounts.error} com erro</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {resultCounts.error > 0 && (
                  <button
                    type="button"
                    onClick={onDownloadErrors}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Baixar linhas com erro (CSV)
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  Importar outra planilha
                </button>
                <Link
                  href="/products"
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Ver produtos
                </Link>
              </div>
            </div>
          )}

          {columns.missingRequired.length === 0 && (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
              <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
                {(['all', 'create', 'update', 'unchanged', 'error'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      filter === f ? 'bg-indigo-600 font-medium text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {f === 'all' ? `Todas (${preview.length})` : `${KIND_LABEL[f]} (${summary[f]})`}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">Situação</th>
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">O que acontece</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map((l) => {
                      const result = results.get(l.line);
                      const failed = result?.status === 'error' && l.kind !== 'error';
                      return (
                        <tr key={l.line} className="align-top">
                          <td className="whitespace-nowrap px-3 py-2 text-gray-500">{l.line}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[failed ? 'error' : l.kind]}`}>
                              {failed ? 'Erro' : KIND_LABEL[l.kind]}
                            </span>
                            {result && !failed && result.status !== 'error' && phase !== 'preview' && (
                              <span className="ml-1 text-xs text-emerald-600">✓</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{rowName(l) || <span className="text-gray-400">—</span>}</p>
                            {rowCode(l) && <p className="text-xs text-gray-500">{rowCode(l)}</p>}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <p className={l.kind === 'error' || failed ? 'text-red-700' : ''}>
                              {failed ? result!.message : rowDetail(l)}
                            </p>
                            {l.kind !== 'error' &&
                              l.warnings.map((w) => (
                                <p key={w} className="text-xs text-amber-700">
                                  ⚠ {w}
                                </p>
                              ))}
                          </td>
                        </tr>
                      );
                    })}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                          Nenhuma linha neste filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredTotal > SHOWN && (
                <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  Mostrando {SHOWN} de {filteredTotal.toLocaleString('pt-BR')} linhas. O resumo e a importação valem para
                  todas.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
