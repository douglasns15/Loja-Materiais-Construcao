'use client';

import { useMemo, useState } from 'react';
import {
  RETURN_ITEM_CONDITION_LABELS,
  RETURN_TARGET_LABELS,
  cancelOrderSchema,
  createReturnSchema,
  formatOrderNumber,
  type PartialReturnResult,
  type ReturnItemCondition,
  type ReturnTarget,
} from '@nexoloja/shared';
import {
  cancelCashRefund,
  cashOutForReturn,
  cashPaidOf,
  receivableBalance,
  returnableBaseQty,
  splitReturnValue,
} from '@nexoloja/core';
import { apiPost } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Item = {
  id: string;
  productName: string;
  quantity: string; // unidade vendida (ex.: 2 rolos)
  total: string;
  baseQuantity?: string | null; // unidade-base (ex.: 200 m); ausente ⇒ = quantity
  returnedBaseQty?: string; // já devolvido (base)
};
type Receivable = {
  originalAmount: string;
  settledAmount: string;
  returnedAmount?: string;
  status: 'OPEN' | 'PAID' | 'CANCELLED';
} | null;
type PaymentLike = { method: string; amount: number };

/**
 * Modal UNIFICADO de devolução/estorno (ADR-022 + ADR-033). Substitui os botões separados de
 * "Devolver itens", "Cancelar venda" e "Devolver" para vendas de entrega imediata. O operador
 * escolhe itens/quantidades, a CONDIÇÃO de cada um (Revenda × Defeito — ADR-033) e a FORMA do
 * estorno do dinheiro. Roteamento no envio:
 *  - devolução TOTAL, na MESMA sessão de caixa e SEM devolução anterior ⇒ `POST /orders/:id/cancel`
 *    (a venda sai do faturamento — comportamento do cancelamento);
 *  - caso contrário ⇒ `POST /orders/:id/return-items` (devolução parcial/estorno; a venda continua
 *    no histórico, com o estoque/caixa acertados por item).
 * O servidor revalida tudo (autoritativo).
 */
export function ReturnItemsModal({
  orderId,
  orderNumber,
  items,
  receivable,
  hasCustomer,
  payments,
  orderTotal,
  isOpenSessionOrder,
  onClose,
  onDone,
  onExchange,
}: {
  orderId: string;
  orderNumber: number;
  items: Item[];
  receivable: Receivable;
  hasCustomer: boolean;
  payments: PaymentLike[];
  orderTotal: number;
  isOpenSessionOrder: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onExchange: (ctx: { returnId: string; credit: number; fromOrderNumber: number }) => void;
}) {
  // Intenção (ADR-033, Fatia 3): devolução/estorno × troca por outro item (gera um vale p/ o PDV).
  const [intent, setIntent] = useState<'REFUND' | 'EXCHANGE'>('REFUND');
  // Quantidade a devolver por item (string do input, na unidade vendida).
  const [qty, setQty] = useState<Record<string, string>>({});
  // Condição por item (ADR-033): 'GOOD' (revenda, volta ao estoque) × 'DEFECTIVE' (defeito, não volta).
  const [condition, setCondition] = useState<Record<string, ReturnItemCondition>>({});
  const [reason, setReason] = useState('');
  // Forma do estorno / destino do dinheiro (ADR-033). Estorno = mesma forma do pagamento.
  const [refundForm, setRefundForm] = useState<ReturnTarget>(
    hasCustomer ? 'STORE_CREDIT' : 'SAME_AS_PAYMENT',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A venda já teve alguma devolução? (bloqueia o caminho de CANCELAMENTO, que repõe o total e
  // duplicaria o estorno; nesse caso a devolução do restante segue por `return-items`.)
  const noPriorReturns = useMemo(
    () => items.every((it) => Number(it.returnedBaseQty ?? 0) === 0),
    [items],
  );
  const cashPaid = useMemo(() => cashPaidOf(payments), [payments]);
  const wasPaid = useMemo(() => payments.reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0) > 0, [payments]);

  // Devolvível por item (na unidade vendida) + fator base/vendida.
  const rows = useMemo(
    () =>
      items.map((it) => {
        const soldQty = Number(it.quantity) || 0;
        const baseQty = Number(it.baseQuantity ?? it.quantity) || 0;
        const basePerSold = soldQty > 0 ? baseQty / soldQty : 1;
        const returnedBase = Number(it.returnedBaseQty ?? 0);
        const returnableBase = returnableBaseQty(baseQty, returnedBase);
        const returnableSold = basePerSold > 0 ? returnableBase / basePerSold : 0;
        return { it, soldQty, basePerSold, returnableSold };
      }),
    [items],
  );

  // Preview: valor total devolvido, abate da dívida, excedente (troco) e se é devolução TOTAL.
  const preview = useMemo(() => {
    let totalValue = 0;
    const chosen: { orderItemId: string; quantity: number; condition: ReturnItemCondition }[] = [];
    let fullRows = 0;
    let eligibleRows = 0;
    for (const r of rows) {
      if (r.returnableSold > 0) eligibleRows += 1;
      const q = Number(qty[r.it.id]);
      if (!Number.isFinite(q) || q <= 0) continue;
      const capped = Math.min(q, r.returnableSold);
      if (capped <= 0) continue;
      totalValue += Number(r.it.total) * (capped / (r.soldQty || 1));
      chosen.push({ orderItemId: r.it.id, quantity: capped, condition: condition[r.it.id] ?? 'GOOD' });
      // "cheio" = devolvendo tudo o que resta daquela linha (tolerância de arredondamento).
      if (Math.abs(capped - r.returnableSold) < 1e-6) fullRows += 1;
    }
    totalValue = Number(totalValue.toFixed(2));
    const debtBalance =
      receivable && receivable.status === 'OPEN'
        ? receivableBalance(
            Number(receivable.originalAmount),
            Number(receivable.settledAmount),
            Number(receivable.returnedAmount ?? 0),
          )
        : 0;
    const { abated, excess } = splitReturnValue(totalValue, debtBalance);
    const defectiveCount = chosen.filter((c) => c.condition === 'DEFECTIVE').length;
    // Devolução TOTAL: todas as linhas elegíveis escolhidas por inteiro.
    const isFullReturn = eligibleRows > 0 && fullRows === eligibleRows && chosen.length === eligibleRows;
    return { totalValue, abated, excess, chosen, defectiveCount, isFullReturn };
  }, [rows, qty, condition, receivable]);

  // Cancelamento (sai do faturamento) só faz sentido para a venda inteira, na mesma sessão de caixa,
  // sem devolução anterior e em DEVOLUÇÃO (não em troca); senão é uma devolução por item.
  const useCancelPath =
    intent === 'REFUND' && isOpenSessionOrder && noPriorReturns && preview.isFullReturn;

  // Opções da forma do estorno conforme o caminho.
  const refundOptions: ReturnTarget[] = useCancelPath
    ? ['SAME_AS_PAYMENT', 'CASH'] // cancelamento não vira crédito
    : ['STORE_CREDIT', 'SAME_AS_PAYMENT', 'CASH'];
  const effectiveRefund: ReturnTarget = refundOptions.includes(refundForm)
    ? refundForm
    : 'SAME_AS_PAYMENT';

  // Mostrar a forma do estorno? Na troca não (o valor vira vale); no cancelamento, quando houve
  // pagamento; na devolução, quando há troco.
  const showRefund = intent === 'EXCHANGE' ? false : useCancelPath ? wasPaid : preview.excess > 0;

  // Quanto SAI do caixa com a escolha atual (para o operador ver o impacto — pedido do Owner).
  const cashOut = useMemo(() => {
    if (useCancelPath) {
      return cancelCashRefund(effectiveRefund === 'CASH' ? 'CASH' : 'SAME_AS_PAYMENT', orderTotal, cashPaid);
    }
    return cashOutForReturn(effectiveRefund, preview.excess, payments);
  }, [useCancelPath, effectiveRefund, orderTotal, cashPaid, preview.excess, payments]);

  async function confirmar() {
    setError(null);
    if (preview.chosen.length === 0) {
      setError('Escolha ao menos um item e a quantidade a devolver.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Informe o motivo (mín. 3 caracteres).');
      return;
    }
    setBusy(true);
    try {
      if (intent === 'EXCHANGE') {
        // Troca: registra a devolução como vale e leva o valor ao PDV (o onExchange navega).
        const payload = { items: preview.chosen, reason: reason.trim(), intent: 'EXCHANGE' as const };
        const parsed = createReturnSchema.safeParse(payload);
        if (!parsed.success) {
          setError('Informe o motivo (mín. 3) e quantidades válidas.');
          setBusy(false);
          return;
        }
        const res = await apiPost<PartialReturnResult>(`/orders/${orderId}/return-items`, parsed.data);
        onExchange({
          returnId: res.returnId,
          credit: res.exchangeCredit ?? res.totalValue,
          fromOrderNumber: orderNumber,
        });
        return;
      }

      if (useCancelPath) {
        // Cancelamento da venda inteira: condição por item + forma do estorno.
        const payload = {
          reason: reason.trim(),
          refundMethod: (effectiveRefund === 'CASH' ? 'CASH' : 'SAME_AS_PAYMENT') as
            | 'CASH'
            | 'SAME_AS_PAYMENT',
          items: preview.chosen.map((c) => ({ orderItemId: c.orderItemId, condition: c.condition })),
        };
        const parsed = cancelOrderSchema.safeParse(payload);
        if (!parsed.success) {
          setError('Dados do cancelamento inválidos.');
          setBusy(false);
          return;
        }
        await apiPost(`/orders/${orderId}/cancel`, parsed.data);
        const parts = [`Venda ${formatOrderNumber(orderNumber)} cancelada.`];
        if (cashOut > 0) parts.push(`Saída de ${BRL(cashOut)} do caixa.`);
        if (preview.defectiveCount > 0)
          parts.push(`${preview.defectiveCount} item(ns) com defeito na fila de defeituosos.`);
        onDone(parts.join(' '));
        return;
      }

      // Devolução por item / estorno.
      if (preview.excess > 0 && effectiveRefund === 'STORE_CREDIT' && !hasCustomer) {
        setError('Crédito exige um cliente na venda; escolha dinheiro ou estorno.');
        setBusy(false);
        return;
      }
      const payload = {
        items: preview.chosen,
        reason: reason.trim(),
        // target só é usado pelo servidor quando há excedente; enviar sempre é inofensivo.
        target: preview.excess > 0 ? effectiveRefund : undefined,
      };
      const parsed = createReturnSchema.safeParse(payload);
      if (!parsed.success) {
        setError('Informe o motivo (mín. 3) e quantidades válidas.');
        setBusy(false);
        return;
      }
      const res = await apiPost<PartialReturnResult>(`/orders/${orderId}/return-items`, parsed.data);
      const parts = [`Devolução registrada (${BRL(res.totalValue)}).`];
      if (res.abatedAmount > 0) parts.push(`Abateu ${BRL(res.abatedAmount)} da dívida.`);
      if (res.excessAmount > 0) {
        if (res.target === 'STORE_CREDIT') parts.push(`Troco ${BRL(res.excessAmount)} virou crédito na loja.`);
        else if (res.target === 'CASH') parts.push(`Troco ${BRL(res.excessAmount)} devolvido em dinheiro.`);
        else parts.push(`Troco ${BRL(res.excessAmount)} estornado na forma do pagamento.`);
      }
      if (preview.defectiveCount > 0)
        parts.push(`${preview.defectiveCount} item(ns) com defeito na fila de defeituosos.`);
      onDone(parts.join(' '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Preenche todas as linhas com o que ainda é devolvível (atalho de "devolver tudo").
  function preencherTudo() {
    const next: Record<string, string> = {};
    for (const r of rows) if (r.returnableSold > 0) next[r.it.id] = String(r.returnableSold);
    setQty(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Devolver / Estornar</h2>
            <p className="text-xs text-gray-500">Venda {formatOrderNumber(orderNumber)}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Intenção: devolução/estorno × troca por outro item. */}
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">O que o cliente quer?</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['REFUND', 'Devolver / desistir'],
                ['EXCHANGE', 'Trocar por outro item'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setIntent(key)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  intent === key
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {intent === 'EXCHANGE' && (
            <p className="mt-1 text-xs text-gray-500">
              O valor devolvido vira um vale e abre o PDV para você montar a nova compra.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Itens a devolver</p>
          <button
            type="button"
            onClick={preencherTudo}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            Devolver tudo
          </button>
        </div>

        {/* Itens: quantidade a devolver por linha + condição (Revenda × Defeito). */}
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {rows.map((r) => {
            const disabled = r.returnableSold <= 0;
            const q = Number(qty[r.it.id]);
            const hasQty = Number.isFinite(q) && q > 0;
            const cond = condition[r.it.id] ?? 'GOOD';
            return (
              <div key={r.it.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.it.productName}</p>
                    <p className="text-xs text-gray-500">
                      {disabled
                        ? 'Tudo já devolvido'
                        : `Devolvível: ${r.returnableSold.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={r.returnableSold}
                    step="any"
                    disabled={disabled}
                    value={qty[r.it.id] ?? ''}
                    onChange={(e) => setQty((prev) => ({ ...prev, [r.it.id]: e.target.value }))}
                    placeholder="0"
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>

                {hasQty && (
                  <div className="mt-2 flex items-center gap-2">
                    {(['GOOD', 'DEFECTIVE'] as ReturnItemCondition[]).map((cKey) => (
                      <button
                        key={cKey}
                        type="button"
                        onClick={() => setCondition((prev) => ({ ...prev, [r.it.id]: cKey }))}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          cond === cKey
                            ? cKey === 'DEFECTIVE'
                              ? 'border-amber-500 bg-amber-500 text-white'
                              : 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {RETURN_ITEM_CONDITION_LABELS[cKey]}
                      </button>
                    ))}
                    {cond === 'DEFECTIVE' && <span className="text-xs text-amber-700">não volta ao estoque</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Preview do acerto. */}
        <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">
              {intent === 'EXCHANGE' ? 'Valor do vale' : useCancelPath ? 'Valor da venda' : 'Valor devolvido'}
            </span>
            <span className="font-semibold tabular-nums">
              {BRL(useCancelPath ? orderTotal : preview.totalValue)}
            </span>
          </div>
          {!useCancelPath && preview.abated > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Abate da dívida</span>
              <span className="tabular-nums">−{BRL(preview.abated)}</span>
            </div>
          )}
          {!useCancelPath && preview.excess > 0 && (
            <div className="flex justify-between font-medium text-green-700">
              <span>Troco a favor do cliente</span>
              <span className="tabular-nums">{BRL(preview.excess)}</span>
            </div>
          )}
          {showRefund && cashOut > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Sai do caixa</span>
              <span className="tabular-nums">−{BRL(cashOut)}</span>
            </div>
          )}
        </div>

        {/* Forma do estorno / destino do dinheiro. */}
        {showRefund && (
          <div>
            <p className="mb-1 text-sm font-medium">
              {useCancelPath ? 'Como o dinheiro voltou?' : 'Destino do troco'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {refundOptions.map((t) => {
                const creditDisabled = t === 'STORE_CREDIT' && !hasCustomer;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={creditDisabled}
                    onClick={() => setRefundForm(t)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                      effectiveRefund === t
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {RETURN_TARGET_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {effectiveRefund === 'SAME_AS_PAYMENT' && (
              <p className="mt-1 text-xs text-gray-500">
                Volta pela forma do pagamento; só a parte em dinheiro sai do caixa (cartão/PIX é estorno).
              </p>
            )}
            {effectiveRefund === 'CASH' && (
              <p className="mt-1 text-xs text-gray-500">Sai do caixa aberto (exige caixa aberto).</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="return-reason" className="mb-1 block text-sm text-gray-600">
            Motivo
          </label>
          <textarea
            id="return-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ex.: item com defeito, cliente desistiu, troca…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">
          {intent === 'EXCHANGE'
            ? 'O item volta ao estoque (ou vira defeito) e o valor abre como vale no PDV. '
            : useCancelPath
              ? 'A venda inteira sai do faturamento. '
              : ''}
          {preview.defectiveCount > 0
            ? 'Itens de Revenda voltam ao estoque; os de Defeito ficam na lista de defeituosos. Não dá para desfazer.'
            : 'O estoque dos itens de revenda volta ao registrar. Não dá para desfazer.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={busy || preview.chosen.length === 0}
            className="rounded-lg bg-orange-600 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {busy
              ? 'Registrando…'
              : intent === 'EXCHANGE'
                ? 'Ir para a troca'
                : useCancelPath
                  ? 'Cancelar venda'
                  : 'Confirmar devolução'}
          </button>
        </div>
      </div>
    </div>
  );
}
