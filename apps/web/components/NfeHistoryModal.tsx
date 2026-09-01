'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

/**
 * Histórico de importações de NF-e (tela Estoque). Lista as importações mais recentes — uma por
 * CHAVE DE ACESSO (`GET /nfe/imports`) — com data, nota, fornecedor, nome do arquivo e nº de itens;
 * tem busca (nota/fornecedor/arquivo) e "carregar mais antigas" por cursor. Clicar numa linha expande
 * e carrega os itens daquele XML (`GET /nfe/imports/:accessKey`) com nome do produto e quantidade.
 *
 * Importações anteriores à captura do nome do arquivo (ou notas sem esse dado) aparecem marcadas como
 * "sem nome de arquivo" — o histórico continua completo, só sem o rótulo do arquivo.
 */

type ImportRow = {
  accessKey: string;
  importedAt: string;
  itemCount: number;
  notaNumber: string | null;
  fileName: string | null;
  supplierName: string | null;
};

type DetailItem = { nItem: number; productName: string; unit: string | null; quantity: string };
type Detail = {
  accessKey: string;
  notaNumber: string | null;
  fileName: string | null;
  supplierName: string | null;
  importedAt: string;
  items: DetailItem[];
};

const PAGE = 20;

/** Data/hora amigável (pt-BR) a partir do ISO devolvido pela API. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const qtyLabel = (v: string) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export function NfeHistoryModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Detalhe (itens) por chave de acesso — carregado sob demanda e cacheado; `expanded` = linha aberta.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail | 'loading' | 'error'>>({});

  // Carrega uma página. `before = null` recomeça a lista (nova busca); com cursor, anexa as antigas.
  // Só usa setters de estado (estáveis) e os argumentos → estável com deps vazias.
  const load = useCallback(async (q: string, before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (q.trim()) params.set('q', q.trim());
      if (before) params.set('before', before);
      const data = await apiGet<{ imports: ImportRow[]; nextCursor: string | null }>(
        `/nfe/imports?${params.toString()}`,
      );
      setRows((prev) => (before ? [...prev, ...data.imports] : data.imports));
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search, null), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  async function toggle(accessKey: string) {
    if (expanded === accessKey) {
      setExpanded(null);
      return;
    }
    setExpanded(accessKey);
    if (details[accessKey] && details[accessKey] !== 'error') return; // já carregado
    setDetails((d) => ({ ...d, [accessKey]: 'loading' }));
    try {
      const data = await apiGet<Detail>(`/nfe/imports/${accessKey}`);
      setDetails((d) => ({ ...d, [accessKey]: data }));
    } catch {
      setDetails((d) => ({ ...d, [accessKey]: 'error' }));
    }
  }

  const empty = !loading && rows.length === 0 && !error;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Histórico de importações de NF-e"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        {/* Cabeçalho na cor da marca (identidade da importação). */}
        <div className="flex items-start justify-between gap-3 bg-indigo-600 px-5 py-4 text-white">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path
                  d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Histórico de importações
            </h2>
            <p className="text-xs text-indigo-100">
              Notas de compra já importadas por XML. Clique numa linha para ver os itens.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-indigo-100 hover:bg-white/10 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Busca (fixa no topo do corpo). */}
        <div className="border-b border-gray-100 p-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nota, fornecedor ou arquivo…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            aria-label="Buscar importações"
          />
        </div>

        {/* Corpo rolável. */}
        <div className="overflow-y-auto p-4">
          {error && (
            <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}
          {empty && (
            <p className="rounded-lg bg-gray-50 p-6 text-center text-sm text-gray-500">
              {search.trim()
                ? 'Nenhuma importação encontrada para a busca.'
                : 'Nenhuma importação registrada ainda.'}
            </p>
          )}

          <ul className="space-y-2">
            {rows.map((r) => {
              const isOpen = expanded === r.accessKey;
              const detail = details[r.accessKey];
              return (
                <li key={r.accessKey} className="rounded-xl border border-gray-200">
                  <button
                    type="button"
                    onClick={() => toggle(r.accessKey)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                    aria-expanded={isOpen}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-gray-900">
                          {r.notaNumber ? `Nota ${r.notaNumber}` : 'Nota s/ número'}
                        </span>
                        <span className="text-xs text-gray-500">{formatDateTime(r.importedAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {r.supplierName ?? 'Fornecedor não informado'}
                        {' · '}
                        {r.fileName ? (
                          <span className="text-gray-600">{r.fileName}</span>
                        ) : (
                          <span className="italic text-gray-400">sem nome de arquivo</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-indigo-700">
                      {r.itemCount} {r.itemCount === 1 ? 'item' : 'itens'}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-3 py-2">
                      {detail === 'loading' || detail === undefined ? (
                        <p className="py-2 text-xs text-gray-500">Carregando itens…</p>
                      ) : detail === 'error' ? (
                        <p className="py-2 text-xs text-red-600">Falha ao carregar os itens.</p>
                      ) : (
                        <ul className="divide-y divide-gray-100">
                          {detail.items.map((it) => (
                            <li
                              key={it.nItem}
                              className="flex items-center justify-between gap-3 py-1.5 text-sm"
                            >
                              <span className="min-w-0 truncate text-gray-800">{it.productName}</span>
                              <span className="shrink-0 tabular-nums text-gray-500">
                                {qtyLabel(it.quantity)}
                                {it.unit ? ` ${it.unit.toLowerCase()}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {loading && <p className="py-3 text-center text-xs text-gray-500">Carregando…</p>}

          {nextCursor && !loading && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => load(search, nextCursor)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Carregar mais antigas
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
