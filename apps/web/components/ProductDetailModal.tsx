'use client';

import { useEffect, useState } from 'react';
import type { ProductCustomerRow, TopProductRow } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Pop-up ENXUTO de detalhe de um produto (Relatórios v2, Fatia 5). Recebe a linha do ranking (já
 * traz faturamento/lucro/margem/qtd/vendas) e busca só o "quem mais compra"
 * (`GET /reports/product-customers/:id`). Lucro/margem vêm do custo carimbado (ADR-027): quando a
 * cobertura é parcial (`costCoverage < 1`), a margem é sinalizada como parcial.
 */
export function ProductDetailModal({
  product,
  from,
  to,
  onClose,
}: {
  product: TopProductRow;
  from: string | null;
  to: string | null;
  onClose: () => void;
}) {
  const [buyers, setBuyers] = useState<ProductCustomerRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const q = qs.toString() ? `?${qs.toString()}` : '';
        const d = await apiGet<ProductCustomerRow[]>(`/reports/product-customers/${product.productId}${q}`);
        if (!cancelled) setBuyers(d);
      } catch {
        if (!cancelled) setBuyers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.productId, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ticket = product.salesCount > 0 ? product.revenue / product.salesCount : 0;
  const partial = product.costCoverage < 0.999; // parte do faturamento sem custo carimbado

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="w-fit rounded-full bg-gradient-to-r from-indigo-700 to-indigo-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
              Produto
            </span>
            <h2 className="text-xl font-extrabold">{product.productName}</h2>
            <span className="text-xs text-gray-500">
              {QTY(product.qty)} vendidos · {product.salesCount}{' '}
              {product.salesCount === 1 ? 'venda' : 'vendas'} no período
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Tiles do produto. Lucro/margem só das vendas com custo (ADR-027). */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-gray-100 sm:grid-cols-4">
          {[
            { k: 'Faturamento', v: BRL(product.revenue) },
            { k: 'Lucro', v: BRL(product.grossProfit), accent: true },
            { k: 'Margem', v: `${product.marginPercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, accent: true },
            { k: 'Ticket médio', v: BRL(ticket) },
          ].map((c) => (
            <div key={c.k} className={`p-3 ${c.accent ? 'bg-emerald-50' : 'bg-white'}`}>
              <p className={`text-[11px] font-bold uppercase tracking-wide ${c.accent ? 'text-emerald-700' : 'text-gray-500'}`}>
                {c.k}
              </p>
              <p className={`tabular-nums ${c.accent ? 'text-base font-extrabold text-emerald-700' : 'text-base font-bold text-gray-800'}`}>
                {c.v}
              </p>
            </div>
          ))}
        </div>

        {/* Sinaliza cobertura parcial de custo (venda antiga sem unitCost — ADR-027). */}
        {partial && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Lucro e margem consideram só as vendas com <strong>custo registrado</strong> (
            {(product.costCoverage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do
            faturamento). Vendas anteriores ao registro de custo ficam de fora — a margem cresce
            conforme novas vendas entram.
          </p>
        )}

        {/* Quem mais compra. */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Quem mais compra</h3>
          {buyers === null ? (
            <p className="text-sm text-gray-500">Carregando…</p>
          ) : buyers.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
              Sem clientes identificados no período.
            </p>
          ) : (
            <ul className="space-y-2">
              {buyers.map((b, idx) => (
                <li
                  key={b.customerId ?? `anon-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-gray-700">{b.customerName}</span>
                  <span className="shrink-0 text-sm text-gray-500">
                    {QTY(b.qty)} un · <span className="font-medium text-gray-700">{BRL(b.revenue)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
