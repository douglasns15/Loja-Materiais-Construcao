'use client';

import { useEffect, useState } from 'react';
import { formatOrderNumber, paymentMethodLabel } from '@nexoloja/shared';
import { groupPairedItems } from '@nexoloja/core';
import { apiGet } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Subconjunto do Order do Histórico de Vendas necessário para o resumo. Vem de
// `GET /orders?scope=all&number=<código>` (mesma forma que a lista do Histórico).
type OrderItem = {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  total: string;
  pairGroup: number | null;
};
type Payment = { id: string; method: string; amount: string };
type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'INVOICED' | 'CANCELLED' | 'RETURNED';
type Order = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  discountAmount: string;
  total: string;
  changeAmount?: string | null;
  createdAt: string;
  registeredByName: string | null;
  customer?: { name: string } | null;
  items: OrderItem[];
  payments: Payment[];
  receivable?: { status: 'OPEN' | 'PAID' | 'CANCELLED' } | null;
};
type OrdersPage = { rows: Order[]; nextCursor: string | null };

/**
 * Resumo de UMA venda em pop-up, com as MESMAS informações do cartão do Histórico de Vendas
 * (código, status, data, cliente, quem registrou, itens agrupados por par — ADR-015 —, formas de
 * pagamento e troco). Aberto ao clicar no código da venda na "Composição do recebido" (Relatórios).
 * Busca a venda por CÓDIGO reusando `GET /orders?scope=all&number=` — sem rota nova.
 */
export function OrderSummaryModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ scope: 'all', number: code, limit: '1' });
        const page = await apiGet<OrdersPage>(`/orders?${qs.toString()}`);
        if (cancelled) return;
        const found = page.rows[0];
        if (!found) setError('Venda não encontrada.');
        else setOrder(found);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Fecha no Esc (o clique fora já fecha pelo overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cancelled = order?.status === 'CANCELLED';
  const returned = order?.status === 'RETURNED';
  const inactive = cancelled || returned;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="my-8 w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-extrabold">Resumo da venda</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {!order ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            {/* Cabeçalho — mesma composição do cartão do Histórico. */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-indigo-600">
                    {formatOrderNumber(order.orderNumber) || `#${order.id.slice(0, 8)}`}
                  </span>
                  {cancelled ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Cancelada
                    </span>
                  ) : returned ? (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                      Devolvida
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Confirmada
                    </span>
                  )}
                  {order.receivable && !cancelled && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      A prazo{order.receivable.status === 'PAID' ? ' · quitada' : ''}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-gray-600">
                  {new Date(order.createdAt).toLocaleString('pt-BR')}
                </div>
                {order.customer?.name && (
                  <div className="text-xs font-medium text-gray-700">Cliente: {order.customer.name}</div>
                )}
                {order.registeredByName && (
                  <div className="text-xs text-gray-500">Registrado por {order.registeredByName}</div>
                )}
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold ${inactive ? 'line-through' : ''}`}>
                  {BRL(order.total)}
                </div>
              </div>
            </div>

            {/* Itens — par (ADR-015) vira uma linha só, igual ao Histórico e ao comprovante. */}
            <ul className="divide-y divide-gray-100 border-t border-gray-100 pt-2 text-sm">
              {groupPairedItems(order.items).map((line, idx) => (
                <li key={idx} className="flex justify-between py-1 text-gray-600">
                  <span>
                    {line.quantity}
                    {line.isPair ? ` par${line.quantity > 1 ? 'es' : ''} ` : '× '}
                    {line.label}
                  </span>
                  <span>{BRL(line.total)}</span>
                </li>
              ))}
            </ul>

            {/* Pagamento: formas + "Dinheiro recebido"/"Troco" (migration 0024), igual ao Histórico. */}
            {order.payments.length > 0 &&
              (() => {
                const troco = order.changeAmount == null ? null : Number(order.changeAmount);
                const cashApplied = order.payments
                  .filter((p) => p.method === 'CASH')
                  .reduce((acc, p) => acc + Number(p.amount), 0);
                const showChange = troco != null && troco > 0;
                return (
                  <div className="space-y-0.5 border-t border-gray-100 pt-2 text-sm">
                    {order.payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-gray-600">
                        <span>{paymentMethodLabel(p.method)}</span>
                        <span>{BRL(p.amount)}</span>
                      </div>
                    ))}
                    {showChange && (
                      <>
                        <div className="flex justify-between text-gray-600">
                          <span>Dinheiro recebido</span>
                          <span>{BRL(cashApplied + troco)}</span>
                        </div>
                        <div className="flex justify-between font-medium text-red-600">
                          <span>Troco</span>
                          <span>{BRL(troco)}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
}
