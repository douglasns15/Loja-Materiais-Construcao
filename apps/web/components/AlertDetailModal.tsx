'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ALERT_META,
  type AlertDetailRow,
  type AlertProductRow,
  type AlertProductsPage,
  type AlertSummary,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Pop-up "Ver" de um alerta da central de pendências (ADR-029). Mostra os DADOS por trás do número
 * sem sair da tela — complementando o CSV (produtos) e o "Abrir" (bloco C):
 *  - alertas de produto (cadastro/estoque): tabela paginada (mesma fonte do CSV, `GET /alerts/products`);
 *  - alertas de caixa/dívida: lista já formatada de datas/valores (`GET /alerts/detail`).
 * `onDownload` reaproveita a geração de CSV que vive no sino (uma fonte só).
 */
export function AlertDetailModal({
  alert,
  onClose,
  onDownload,
  downloading,
}: {
  alert: AlertSummary;
  onClose: () => void;
  onDownload?: (a: AlertSummary) => void;
  downloading?: boolean;
}) {
  const meta = ALERT_META[alert.kind];

  // Produtos (paginado por keyset) OU detalhe do bloco C (lista curta).
  const [products, setProducts] = useState<AlertProductRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [details, setDetails] = useState<AlertDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fecha no Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadProductPage = useCallback(
    async (after: string | null) => {
      const qs = new URLSearchParams({ kind: alert.kind });
      if (after) qs.set('cursor', after);
      const page = await apiGet<AlertProductsPage>(`/alerts/products?${qs.toString()}`);
      setProducts((prev) => (after ? [...prev, ...page.rows] : page.rows));
      setCursor(page.nextCursor);
    },
    [alert.kind],
  );

  // Carga inicial conforme o tipo de alerta.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (alert.downloadable) {
          await loadProductPage(null);
        } else {
          const rows = await apiGet<AlertDetailRow[]>(`/alerts/detail?kind=${alert.kind}`);
          if (!cancelled) setDetails(rows);
        }
      } catch {
        if (!cancelled) setError('Não foi possível carregar os dados. Tente novamente.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [alert.downloadable, alert.kind, loadProductPage]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      await loadProductPage(cursor);
    } catch {
      setError('Falha ao carregar mais itens.');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadProductPage]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-lg"
        role="dialog"
        aria-label={meta.label}
      >
        {/* Cabeçalho índigo, no padrão da repaginação. */}
        <div className="flex items-start justify-between bg-indigo-600 px-4 py-3 text-white">
          <div>
            <h2 className="text-sm font-semibold">{meta.label}</h2>
            <p className="text-[11px] text-indigo-100">
              {alert.count} {alert.count === 1 ? 'item' : 'itens'} · {meta.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-indigo-100 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">Carregando…</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          ) : alert.downloadable ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-indigo-50 text-xs font-semibold text-indigo-700">
                    <th className="px-2 py-1.5">Produto</th>
                    <th className="px-2 py-1.5">Código</th>
                    <th className="px-2 py-1.5">Cód. barras</th>
                    <th className="px-2 py-1.5 text-right">Preço</th>
                    <th className="px-2 py-1.5 text-right">Custo</th>
                    <th className="px-2 py-1.5 text-right">Estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-gray-800">{p.name}</td>
                      <td className="px-2 py-1.5 text-gray-500">{p.sku}</td>
                      <td className="px-2 py-1.5 text-gray-500">{p.ean ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{BRL(p.salePrice)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{BRL(p.costPrice)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                        {p.stockQty.toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cursor && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {loadingMore ? 'Carregando…' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </div>
          ) : details.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nada a exibir.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {details.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-gray-800">{d.title}</span>
                  {d.subtitle && (
                    <span className="shrink-0 text-xs font-semibold text-gray-600">{d.subtitle}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rodapé: ação principal do alerta (CSV para produtos; Abrir a tela para o bloco C). */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
          {alert.downloadable
            ? onDownload && (
                <button
                  type="button"
                  onClick={() => onDownload(alert)}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                >
                  {downloading ? 'Baixando…' : 'Baixar lista (CSV)'}
                </button>
              )
            : alert.actionHref && (
                <Link
                  href={alert.actionHref}
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  Abrir tela
                </Link>
              )}
        </div>
      </div>
    </div>
  );
}
