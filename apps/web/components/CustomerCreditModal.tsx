'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatOrderNumber,
  PAYMENT_METHOD_LABELS,
  paymentMethodLabel,
  withdrawCreditSchema,
  type AccountReturnItem,
  type CreditStatementEntry,
  type CustomerCreditStatement,
  type PaymentMethod,
  type WithdrawCreditResult,
} from '@nexoloja/shared';
import { creditStatement } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { MoneyInput } from '@/components/MoneyInput';
import { useModalLayer } from '@/lib/keyboard';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Código da venda para a tela (ADR-023): `V-000128`; senão os 8 primeiros do UUID (legado). */
const saleCode = (orderNumber: number | null, orderId: string) =>
  formatOrderNumber(orderNumber) || `#${orderId.slice(0, 8)}`;

/** Forma no texto corrido ("em dinheiro", "em PIX"…), para o título da retirada. */
const methodPhrase = (m: string | null) =>
  m === 'CASH' ? 'em dinheiro' : m ? `em ${paymentMethodLabel(m)}` : '';

/** Título do lançamento, pelo que o originou (livro-razão `customer_credits` — ADR-022). */
function entryTitle(e: CreditStatementEntry): string {
  const amount = Number(e.amount);
  if (e.origin === 'RETURN') return e.source?.intent === 'EXCHANGE' ? 'Sobra de troca' : 'Crédito de devolução';
  if (e.origin === 'SALE_USE') {
    return e.relatedOrderId
      ? `Utilizado na compra: ${saleCode(e.relatedOrderNumber, e.relatedOrderId)}`
      : 'Utilizado na compra';
  }
  if (e.origin === 'SALE_REVERSAL') return 'Estorno de compra';
  if (e.origin === 'WITHDRAWAL') return `Crédito retirado ${methodPhrase(e.method)}`.trim();
  return amount < 0 ? 'Ajuste (saída)' : 'Ajuste (entrada)';
}

/** Complemento do título: a venda relacionada (a de origem na devolução/retirada; a compra no estorno). */
function entryContext(e: CreditStatementEntry): string {
  if (!e.relatedOrderId || e.origin === 'SALE_USE') return ''; // o uso já leva o código no título
  const code = saleCode(e.relatedOrderNumber, e.relatedOrderId);
  if (e.origin === 'RETURN' || e.origin === 'WITHDRAWAL') return `da venda ${code}`;
  if (e.origin === 'SALE_REVERSAL') return `${code} cancelada/devolvida`;
  return code;
}

/** "Dinheiro R$ 10,00 + PIX R$ 12,00" — como a venda de origem foi paga. */
function paymentsText(payments: { method: string; amount: string }[]): string {
  return payments.map((p) => `${paymentMethodLabel(p.method)} ${BRL(p.amount)}`).join(' + ');
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
 * extrato da dívida: resumo no topo (saldo, quanto entrou, quanto foi usado, retirado, estornos) e,
 * embaixo, as movimentações em ordem (mais antiga primeiro), com o saldo do crédito depois de cada uma.
 * Cada entrada mostra de onde veio (a devolução/troca, os itens que voltaram e como a venda de origem
 * foi paga) e cada uso, em que compra. "Usar na venda" leva ao PDV com o cliente identificado;
 * "Retirar crédito" devolve o valor ao cliente (qualquer forma; a da venda de origem vem sugerida).
 * `onChanged` avisa a tela pai depois de uma retirada (o saldo do cartão muda).
 */
export function CustomerCreditModal({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  // Esc fecha nesta janela (pilha de camadas — lib/keyboard.tsx).
  const layerRef = useModalLayer(onClose);
  const [data, setData] = useState<CustomerCreditStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ---- Painel de RETIRADA do crédito ----
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Esc fecha / F8 confirma o painel de retirada (camada acima do extrato).
  const withdrawLayerRef = useModalLayer(() => setWithdrawOpen(false), withdrawOpen);
  const [wAmount, setWAmount] = useState('');
  const [wMethod, setWMethod] = useState<PaymentMethod>('CASH');
  const [wReason, setWReason] = useState('');
  const [wError, setWError] = useState<string | null>(null);
  const [wBusy, setWBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<CustomerCreditStatement>(`/receivables/accounts/${customerId}/credits`);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [customerId]);

  useEffect(() => {
    setData(null);
    setInfo(null);
    load();
  }, [load]);

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
  // Uma retirada pode virar várias linhas (uma por venda de origem); conta as retiradas, não as linhas.
  const withdrawCount = new Set(
    data?.entries.filter((e) => e.origin === 'WITHDRAWAL').map((e) => `${e.createdAt}|${e.reason}`) ?? [],
  ).size;
  // Saldo disponível p/ retirar: o cache do cliente (a trava do servidor usa o mesmo).
  const available = data?.creditBalance ?? 0;

  function openWithdraw() {
    if (!data) return;
    setWAmount(String(available));
    setWMethod(data.suggestedWithdrawalMethod);
    setWReason('');
    setWError(null);
    setInfo(null);
    setWithdrawOpen(true);
  }

  async function onWithdraw(ev: React.FormEvent) {
    ev.preventDefault();
    setWError(null);
    const parsed = withdrawCreditSchema.safeParse({
      amount: Number(wAmount),
      method: wMethod,
      reason: wReason,
    });
    if (!parsed.success) {
      const reasonIssue = parsed.error.issues.some((i) => i.path[0] === 'reason');
      setWError(reasonIssue ? 'Informe o motivo da retirada.' : 'Informe um valor válido.');
      return;
    }
    if (parsed.data.amount > available + 0.005) {
      setWError(`O valor não pode passar do crédito (${BRL(available)}).`);
      return;
    }
    setWBusy(true);
    try {
      const res = await apiPost<WithdrawCreditResult>(
        `/receivables/accounts/${customerId}/credits/withdraw`,
        parsed.data,
      );
      setInfo(
        `Crédito retirado: ${BRL(res.withdrawn)} ${methodPhrase(res.method)}.${
          res.cashOut > 0 ? ' Saiu do caixa como devolução.' : ' Faça o PIX/estorno na maquininha.'
        } Saldo: ${BRL(res.creditBalance)}.`,
      );
      setWithdrawOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setWError((e as Error).message);
    } finally {
      setWBusy(false);
    }
  }

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

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

            {/* Resumo: saldo do crédito + quanto entrou × usado × retirado (× estornos). */}
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-600">Saldo do crédito</p>
                  <p className="text-3xl font-bold tabular-nums text-green-700">{BRL(stmt.balance)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {stmt.balance > 0
                      ? 'Disponível para usar em compras ("Usar crédito da loja" no PDV).'
                      : 'Todo o crédito já foi usado ou retirado.'}
                  </p>
                </div>
                {available > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openWithdraw}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Retirar crédito
                    </button>
                    <Link
                      href={{
                        pathname: '/venda',
                        query: { customerId: data.customerId, customerName: data.customerName ?? '' },
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                    >
                      Usar na venda
                    </Link>
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                {stmt.withdrawn > 0 && (
                  <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-gray-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Retirado</p>
                    <p className="font-bold tabular-nums text-amber-700">−{BRL(stmt.withdrawn)}</p>
                    <p className="text-[11px] text-gray-500">
                      {withdrawCount} {withdrawCount === 1 ? 'retirada' : 'retiradas'}
                    </p>
                  </div>
                )}
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
                            {/* Como a venda de origem foi paga — base da sugestão ao retirar o crédito. */}
                            {e.origin === 'RETURN' && e.relatedOrderPayments.length > 0 && (
                              <p className="mt-0.5 text-xs text-gray-500">
                                Venda paga em: {paymentsText(e.relatedOrderPayments)}
                              </p>
                            )}
                            {e.origin === 'WITHDRAWAL' && e.reason && (
                              <p className="mt-0.5 text-xs text-gray-500">Motivo: {e.reason}</p>
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
                                e.origin === 'WITHDRAWAL'
                                  ? 'text-amber-700'
                                  : amount < 0
                                    ? 'text-indigo-600'
                                    : 'text-green-700'
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
                “Usar crédito da loja” (com o cliente identificado). Se a compra que usou o crédito for
                cancelada, o valor volta. “Retirar crédito” devolve o valor ao cliente.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Painel de RETIRADA do crédito (por cima do extrato). */}
      {withdrawOpen && data && (
        <div
          ref={withdrawLayerRef}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setWithdrawOpen(false);
          }}
        >
          <form
            onSubmit={onWithdraw}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-lg"
          >
            <div>
              <h2 className="text-lg font-bold">Retirar crédito de {data.customerName ?? 'cliente'}</h2>
              <p className="text-sm text-gray-600">
                Crédito disponível: <strong>{BRL(available)}</strong>
              </p>
            </div>

            <div>
              <label htmlFor="wd-valor" className="mb-1 block text-sm text-gray-600">
                Valor a devolver
              </label>
              <MoneyInput
                id="wd-valor"
                value={wAmount}
                onChange={setWAmount}
                placeholder="0,00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                onClick={() => setWAmount(String(available))}
                className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
              >
                Retirar tudo ({BRL(available)})
              </button>
            </div>

            <div>
              <label htmlFor="wd-forma" className="mb-1 block text-sm text-gray-600">
                Devolver em
              </label>
              <select
                id="wd-forma"
                value={wMethod}
                onChange={(e) => setWMethod(e.target.value as PaymentMethod)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                    {m === data.suggestedWithdrawalMethod ? ' (forma da venda de origem)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {wMethod === 'CASH'
                  ? 'Sai da gaveta do caixa aberto (aparece no Caixa como devolução).'
                  : 'Não mexe no caixa: faça o PIX ou o estorno na maquininha.'}
              </p>
            </div>

            <div>
              <label htmlFor="wd-motivo" className="mb-1 block text-sm text-gray-600">
                Motivo
              </label>
              <textarea
                id="wd-motivo"
                value={wReason}
                onChange={(e) => setWReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ex.: cliente não vai mais comprar, pediu o dinheiro de volta"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {wError && <p className="text-sm text-red-600">{wError}</p>}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWithdrawOpen(false)}
                className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                data-confirm
                disabled={wBusy}
                className="rounded-lg bg-amber-600 py-2 font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
              >
                {wBusy ? 'Retirando…' : 'Retirar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
