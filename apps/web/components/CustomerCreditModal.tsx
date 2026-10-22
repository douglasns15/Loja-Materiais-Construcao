'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatOrderNumber,
  type AccountReturnItem,
  type CreditStatementEntry,
  type CustomerCreditStatement,
} from '@nexoloja/shared';
import { creditStatement } from '@nexoloja/core';
import { apiGet } from '@/lib/api';
import { useModalLayer } from '@/lib/keyboard';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Código da venda para a tela (ADR-023): `V-000128`; senão os 8 primeiros do UUID (legado). */
const saleCode = (orderNumber: number | null, orderId: string) =>
  formatOrderNumber(orderNumber) || `#${orderId.slice(0, 8)}`;

/** Título do lançamento, pelo que o originou (livro-razão `customer_credits` — ADR-022). */
function entryTitle(e: CreditStatementEntry): string {
  const amount = Number(e.amount);
  if (e.origin === 'RETURN') return e.source?.intent === 'EXCHANGE' ? 'Sobra de troca' : 'Crédito de devolução';
  if (e.origin === 'SALE_USE') return 'Usado numa compra';
  if (e.origin === 'SALE_REVERSAL') return 'Estorno de compra';
  return amount < 0 ? 'Ajuste (saída)' : 'Ajuste (entrada)';
}

/** Complemento do título: a venda relacionada (a de origem na devolução; a compra no uso/estorno). */
function entryContext(e: CreditStatementEntry): string {
  if (!e.relatedOrderId) return '';
  const code = saleCode(e.relatedOrderNumber, e.relatedOrderId);
  if (e.origin === 'RETURN') return `da venda ${code}`;
  if (e.origin === 'SALE_REVERSAL') return `${code} cancelada/devolvida`;
  return code;
}

/** Lista de itens sob o lançamento (o que voltou na devolução, ou o que foi comprado). */
function ItemList({ items, tone }: { items: AccountReturnItem[]; tone: 'amber' | 'gray' }) {
  if (items.length === 0) return null;
  const box = tone === 'amber' ? 'divide-amber-100 bg-amber-50/60' : 'divide-gray-100 bg-gray-50/60';
  const text = tone === 'amber' ? 'text-amber-800' : 'text-gray-700';
  return (
    <ul className={`mt-2 divide-y rounded-lg ${box}`}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
          <span className={`min-w-0 truncate ${text}`}>
            {Number(it.quantity)}× {it.productName}
          </span>
          <span className="shrink-0 tabular-nums text-gray-600">{BRL(it.total)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Extrato do CRÉDITO a favor do cliente (Contas a Receber → "Com crédito", 2026-10-22), no molde do
 * extrato da dívida: resumo no topo (saldo, quanto entrou, quanto foi usado, estornos) e, embaixo,
 * as movimentações em ordem (mais antiga primeiro), com o saldo do crédito depois de cada uma. Cada
 * entrada mostra de onde veio (a devolução/troca e os itens que voltaram) e cada uso, em que compra
 * (os itens comprados). Só leitura; "Usar na venda" leva ao PDV com o cliente já identificado.
 */
export function CustomerCreditModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  // Esc fecha nesta janela (pilha de camadas — lib/keyboard.tsx).
  const layerRef = useModalLayer(onClose);
  const [data, setData] = useState<CustomerCreditStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    apiGet<CustomerCreditStatement>(`/receivables/accounts/${customerId}/credits`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Resumo + saldo corrente (core — mesma conta, em centavos).
  const stmt = useMemo(
    () =>
      data
        ? creditStatement(
            data.entries.map((e) => ({ amount: Number(e.amount), origin: e.origin })),
            data.openingBalance,
          )
        : null,
    [data],
  );

  const generatedCount = data?.entries.filter((e) => e.origin === 'RETURN').length ?? 0;
  const usedCount = data?.entries.filter((e) => e.origin === 'SALE_USE').length ?? 0;

  return (
    <div
      ref={layerRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        {!data || !stmt ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="w-fit rounded-full bg-gradient-to-r from-emerald-700 to-emerald-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
                  Extrato do crédito
                </span>
                <h2 className="text-xl font-bold">{data.customerName ?? 'Cliente'}</h2>
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

            {/* Resumo: saldo do crédito + quanto entrou × quanto foi usado (× estornos). */}
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-600">Saldo do crédito</p>
                  <p className="text-3xl font-bold tabular-nums text-green-700">{BRL(stmt.balance)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {stmt.balance > 0
                      ? 'Disponível para usar em compras ("Usar crédito da loja" no PDV).'
                      : 'Todo o crédito já foi usado.'}
                  </p>
                </div>
                {stmt.balance > 0 && (
                  <Link
                    href={{
                      pathname: '/venda',
                      query: { customerId: data.customerId, customerName: data.customerName ?? '' },
                    }}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    Usar na venda
                  </Link>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-gray-200">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Entrou</p>
                  <p className="font-bold tabular-nums text-green-700">+{BRL(stmt.generated)}</p>
                  <p className="text-[11px] text-gray-500">
                    {generatedCount} {generatedCount === 1 ? 'devolução/troca' : 'devoluções/trocas'}
                  </p>
                </div>
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-gray-200">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Usado</p>
                  <p className="font-bold tabular-nums text-indigo-600">−{BRL(stmt.netUsed)}</p>
                  <p className="text-[11px] text-gray-500">
                    {usedCount} {usedCount === 1 ? 'compra' : 'compras'}
                  </p>
                </div>
                {stmt.reversed > 0 && (
                  <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-gray-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Estornado
                    </p>
                    <p className="font-bold tabular-nums text-gray-700">{BRL(stmt.reversed)}</p>
                    <p className="text-[11px] text-gray-500">voltou de compra cancelada</p>
                  </div>
                )}
              </div>
            </div>

            {/* Extrato: cada entrada/saída do crédito, em ordem, com o saldo depois dela. */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Movimentações</h3>
              {data.entries.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhuma movimentação de crédito.</p>
              ) : (
                <ul className="space-y-2">
                  {data.truncated && (
                    <li className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <span>Saldo anterior (movimentações mais antigas)</span>
                      <span className="tabular-nums">{BRL(stmt.opening)}</span>
                    </li>
                  )}
                  {data.entries.map((e, idx) => {
                    const amount = Number(e.amount);
                    const ctx = entryContext(e);
                    return (
                      <li key={e.id} className="rounded-lg border border-gray-100 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {entryTitle(e)}
                              <span className="ml-1 font-normal text-gray-500">
                                {ctx ? `· ${ctx}` : ''}
                                {e.createdByName ? ` · ${e.createdByName}` : ''}
                              </span>
                            </p>
                            <p className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString('pt-BR')}</p>
                            {e.source && (
                              <p className="mt-0.5 text-xs text-gray-500">
                                Motivo: {e.source.reason} · {e.source.intent === 'EXCHANGE' ? 'vale' : 'devolvido'}{' '}
                                {BRL(e.source.totalValue)}
                              </p>
                            )}
                            {e.origin === 'SALE_USE' && e.relatedOrderTotal != null && (
                              <p className="mt-0.5 text-xs text-gray-500">
                                Compra de {BRL(e.relatedOrderTotal)} · {BRL(Math.abs(amount))} pago com crédito
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p
                              className={`font-semibold tabular-nums ${
                                amount < 0 ? 'text-indigo-600' : 'text-green-700'
                              }`}
                            >
                              {amount < 0 ? '−' : '+'}
                              {BRL(Math.abs(amount))}
                            </p>
                            <p className="text-xs tabular-nums text-gray-500">saldo {BRL(stmt.running[idx] ?? 0)}</p>
                          </div>
                        </div>
                        {/* O que voltou na devolução/troca que gerou o crédito, ou o que foi comprado. */}
                        <ItemList items={e.source?.items ?? []} tone="amber" />
                        <ItemList items={e.orderItems} tone="gray" />
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-xs text-gray-500">
                O crédito nasce de uma devolução ou da sobra de uma troca e é usado no PDV, em
                “Usar crédito da loja” (com o cliente identificado). Se a compra que usou o crédito for cancelada, o valor volta.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
