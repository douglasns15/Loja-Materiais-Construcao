'use client';

import { useEffect, useState } from 'react';
import type { CustomerProductRow, TopCustomerRow } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Pop-up ENXUTO de detalhe de um cliente (Relatórios v2, Fatia 5). Recebe a linha do ranking (total
 * comprado/lucro/margem/nº compras/dívida atual) e busca só "o que costuma comprar"
 * (`GET /reports/customer-products/:id`). Lucro/margem do custo carimbado (ADR-027); dívida atual é
 * o saldo em aberto AGORA (independe do período).
 */
export function CustomerDetailModal({
  customer,
  from,
  to,
  onClose,
}: {
  customer: TopCustomerRow;
  from: string | null;
  to: string | null;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<CustomerProductRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const q = qs.toString() ? `?${qs.toString()}` : '';
        const d = await apiGet<CustomerProductRow[]>(`/reports/customer-products/${customer.customerId}${q}`);
        if (!cancelled) setProducts(d);
      } catch {
        if (!cancelled) setProducts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer.customerId, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ticket = customer.salesCount > 0 ? customer.revenue / customer.salesCount : 0;
  const partial = customer.costCoverage < 0.999;

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
              Cliente
            </span>
            <h2 className="text-xl font-extrabold">{customer.customerName}</h2>
            <span className="text-xs text-gray-500">
              {customer.salesCount} {customer.salesCount === 1 ? 'compra' : 'compras'} no período
              {customer.currentDebt > 0 && (
                <span className="text-amber-700"> · deve {BRL(customer.currentDebt)} agora</span>
              )}
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

        {/* Tiles do cliente. Lucro/margem só das vendas com custo (ADR-027); dívida = saldo atual. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-gray-100 sm:grid-cols-4">
          {[
            { k: 'Total comprado', v: BRL(customer.revenue) },
            { k: 'Lucro gerado', v: BRL(customer.grossProfit), accent: true },
            { k: 'Ticket médio', v: BRL(ticket) },
            {
              k: 'Dívida atual',
              v: BRL(customer.currentDebt),
              debt: customer.currentDebt > 0,
            },
          ].map((c) => (
            <div
              key={c.k}
              className={`p-3 ${c.accent ? 'bg-emerald-50' : c.debt ? 'bg-amber-50' : 'bg-white'}`}
            >
              <p
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  c.accent ? 'text-emerald-700' : c.debt ? 'text-amber-700' : 'text-gray-500'
                }`}
              >
                {c.k}
              </p>
              <p
                className={`tabular-nums ${
                  c.accent
                    ? 'text-base font-extrabold text-emerald-700'
                    : c.debt
                      ? 'text-base font-extrabold text-amber-700'
                      : 'text-base font-bold text-gray-800'
                }`}
              >
                {c.v}
              </p>
            </div>
          ))}
        </div>

        {partial && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            Lucro e margem consideram só as compras com <strong>custo registrado</strong> (
            {(customer.costCoverage * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do
            total). Compras anteriores ao registro de custo ficam de fora.
          </p>
        )}

        {/* O que costuma comprar. */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">O que costuma comprar</h3>
          {products === null ? (
            <p className="text-sm text-gray-500">Carregando…</p>
          ) : products.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">
              Sem compras no período.
            </p>
          ) : (
            <ul className="space-y-2">
              {products.map((pr) => (
                <li
                  key={pr.productId}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-gray-700">{pr.productName}</span>
                  <span className="shrink-0 text-sm text-gray-500">
                    {QTY(pr.qty)} un · <span className="font-medium text-gray-700">{BRL(pr.revenue)}</span>
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
