'use client';

import { type ReactNode, useEffect, useState } from 'react';
import type { TopProductRow } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { formatQtyUnit } from '@/lib/qtyUnit';
import { ProductDetailModal } from './ProductDetailModal';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type OrderBy = 'faturamento' | 'lucro' | 'quantidade';

/**
 * Card colapsável "Produtos" (Relatórios v2, Fatia 5): ranking do período com busca (sem acento, no
 * servidor) e ordenação por faturamento ou lucro. Clicar numa linha (ou num resultado da busca) abre
 * o pop-up de detalhe. Lucro/margem vêm do custo carimbado (ADR-027) — cobertura parcial é sinalizada
 * no detalhe. Gerencia o próprio estado (custo-zero: só lê agregados prontos do servidor).
 *
 * `mode="quantidade"` vira o card "Mais vendidos": ordem FIXA por quantidade em unidade-base do
 * produto (sem o seletor Faturamento/Lucro) e a linha destaca "340 sacos · 52 vendas".
 */
export function TopProductsCard({
  from,
  to,
  initial,
  initialLoading = false,
  mode = 'valor',
  title,
}: {
  from: string | null;
  to: string | null;
  /** Ranking padrão (já buscado pela página, na ordem padrão do `mode`) — evita um request duplicado. */
  initial: TopProductRow[];
  /** `true` enquanto a página ainda busca o `initial` (evita o flash de "nenhuma venda"). */
  initialLoading?: boolean;
  /** `valor` (padrão): Faturamento/Lucro. `quantidade`: "mais vendidos" por quantidade. */
  mode?: 'valor' | 'quantidade';
  /** Título no lugar de "Produtos" (ex.: o seletor do card compartilhado com os clientes). */
  title?: ReactNode;
}) {
  const byQty = mode === 'quantidade';
  const defaultOrder: OrderBy = byQty ? 'quantidade' : 'faturamento';
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [orderBy, setOrderBy] = useState<OrderBy>(defaultOrder);
  const [rows, setRows] = useState<TopProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TopProductRow | null>(null);

  // Debounce da busca (não dispara request a cada tecla).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Visão PADRÃO (sem busca, ordem padrão do modo) = usa o `initial` da página (0 requests). Só busca
  // no servidor quando o usuário digita ou muda a ordenação — reduz a concorrência no carregamento.
  const isDefault = debouncedQ === '' && orderBy === defaultOrder;
  const displayRows = isDefault ? initial : rows;
  const isLoading = isDefault ? initialLoading : loading;

  useEffect(() => {
    if (!open || isDefault) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const qs = new URLSearchParams({ orderBy, limit: '10' });
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        if (debouncedQ) qs.set('q', debouncedQ);
        const d = await apiGet<TopProductRow[]>(`/reports/top-products?${qs.toString()}`);
        if (!cancelled) setRows(d);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, from, to, debouncedQ, orderBy, isDefault]);

  const chevron = <span className="text-gray-400">{open ? '▾' : '▸'}</span>;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {title ? (
        // Título customizado (pode ser interativo, ex.: um seletor) — o recolher fica só na setinha,
        // para não aninhar controle dentro de botão.
        <div className="flex w-full items-center justify-between gap-2 px-4 py-3">
          {title}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Recolher' : 'Expandir'}
            className="rounded px-1"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <h2 className="font-semibold">Produtos</h2>
          {chevron}
        </button>
      )}

      {open && (
        <div className="border-t border-gray-100 p-4">
          {/* Busca + ordenação (a ordenação não se aplica aos "mais vendidos", que é por quantidade). */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto…"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
            {!byQty && (
              <div className="inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
                {(['faturamento', 'lucro'] as OrderBy[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrderBy(o)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      orderBy === o ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
                    }`}
                  >
                    {o === 'faturamento' ? 'Faturamento' : 'Lucro'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isLoading ? (
            <p className="py-4 text-center text-sm text-gray-500">Carregando…</p>
          ) : displayRows.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
              {debouncedQ ? 'Nenhum produto encontrado.' : 'Nenhuma venda no período.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {displayRows.map((r, idx) => (
                <li key={r.productId}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-xs font-bold text-indigo-600">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                      {r.productName}
                    </span>
                    {byQty ? (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-gray-800">
                          {formatQtyUnit(r.baseQty, r.unit, r.closedSize)}
                        </span>
                        <span className="block text-xs tabular-nums text-gray-500">
                          {r.salesCount} {r.salesCount === 1 ? 'venda' : 'vendas'} · {BRL(r.revenue)}
                        </span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-gray-800">
                          {BRL(r.revenue)}
                        </span>
                        <span className="block text-xs tabular-nums text-emerald-700">
                          lucro {BRL(r.grossProfit)}
                          {r.costCoverage < 0.999 && (
                            <span className="text-amber-600" title="Parte do faturamento sem custo registrado">
                              {' '}
                              ·parcial
                            </span>
                          )}
                        </span>
                      </span>
                    )}
                    <span className="shrink-0 text-gray-400" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <ProductDetailModal product={selected} from={from} to={to} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
