'use client';

import { useMemo, useState } from 'react';
import {
  RETURN_TARGET_LABELS,
  createReturnSchema,
  type PartialReturnResult,
  type ReturnTarget,
} from '@nexoloja/shared';
import { receivableBalance, returnableBaseQty, splitReturnValue } from '@nexoloja/core';
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

/**
 * Devolução por item (ADR-022, Fatia B). O operador escolhe quanto devolver de cada linha (na
 * unidade vendida). A tela prevê ao vivo: valor devolvido, quanto ABATE a dívida da venda e o
 * TROCO (excedente). Se houver troco, o operador escolhe o destino — crédito na loja (só com
 * cliente) ou dinheiro no caixa. O servidor revalida tudo (autoritativo).
 */
export function ReturnItemsModal({
  orderId,
  items,
  receivable,
  hasCustomer,
  onClose,
  onDone,
}: {
  orderId: string;
  items: Item[];
  receivable: Receivable;
  hasCustomer: boolean;
  onClose: () => void;
  onDone: (result: PartialReturnResult) => void;
}) {
  // Quantidade a devolver por item (string do input, na unidade vendida).
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<ReturnTarget>(hasCustomer ? 'STORE_CREDIT' : 'CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Preview: valor total devolvido, abate da dívida e excedente (troco).
  const preview = useMemo(() => {
    let totalValue = 0;
    const chosen: { orderItemId: string; quantity: number }[] = [];
    for (const r of rows) {
      const q = Number(qty[r.it.id]);
      if (!Number.isFinite(q) || q <= 0) continue;
      const capped = Math.min(q, r.returnableSold);
      if (capped <= 0) continue;
      totalValue += Number(r.it.total) * (capped / (r.soldQty || 1));
      chosen.push({ orderItemId: r.it.id, quantity: capped });
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
    return { totalValue, abated, excess, chosen };
  }, [rows, qty, receivable]);

  async function confirmar() {
    setError(null);
    if (preview.chosen.length === 0) {
      setError('Escolha ao menos um item e a quantidade a devolver.');
      return;
    }
    const payload = {
      items: preview.chosen,
      reason: reason.trim(),
      // target só é usado pelo servidor quando há excedente; enviar sempre é inofensivo.
      target: preview.excess > 0 ? target : undefined,
    };
    const parsed = createReturnSchema.safeParse(payload);
    if (!parsed.success) {
      setError('Informe o motivo da devolução (mín. 1 caractere) e quantidades válidas.');
      return;
    }
    if (preview.excess > 0 && target === 'STORE_CREDIT' && !hasCustomer) {
      setError('Crédito exige um cliente na venda; escolha dinheiro.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<PartialReturnResult>(`/orders/${orderId}/return-items`, parsed.data);
      onDone(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
          <h2 className="text-lg font-bold">Devolver itens</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Itens: quantidade a devolver por linha. */}
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {rows.map((r) => {
            const disabled = r.returnableSold <= 0;
            return (
              <div key={r.it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
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
            );
          })}
        </div>

        {/* Preview do acerto. */}
        <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Valor devolvido</span>
            <span className="font-semibold tabular-nums">{BRL(preview.totalValue)}</span>
          </div>
          {preview.abated > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Abate da dívida</span>
              <span className="tabular-nums">−{BRL(preview.abated)}</span>
            </div>
          )}
          {preview.excess > 0 && (
            <div className="flex justify-between font-medium text-green-700">
              <span>Troco a favor do cliente</span>
              <span className="tabular-nums">{BRL(preview.excess)}</span>
            </div>
          )}
        </div>

        {/* Destino do troco (só quando há excedente). */}
        {preview.excess > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Destino do troco</p>
            <div className="grid grid-cols-2 gap-2">
              {(['STORE_CREDIT', 'CASH'] as ReturnTarget[]).map((t) => {
                const creditDisabled = t === 'STORE_CREDIT' && !hasCustomer;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={creditDisabled}
                    onClick={() => setTarget(t)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      target === t
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {RETURN_TARGET_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {target === 'CASH' && (
              <p className="mt-1 text-xs text-gray-500">Sai do caixa aberto (exige caixa aberto).</p>
            )}
            {target === 'STORE_CREDIT' && !hasCustomer && (
              <p className="mt-1 text-xs text-amber-700">Sem cliente na venda: só dá para devolver em dinheiro.</p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="return-reason" className="mb-1 block text-sm text-gray-600">
            Motivo da devolução
          </label>
          <textarea
            id="return-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ex.: item com defeito, cliente trocou…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">
          O estoque dos itens volta ao registrar. Não dá para desfazer.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 py-2 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={busy || preview.chosen.length === 0}
            className="rounded-lg bg-orange-600 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {busy ? 'Devolvendo…' : 'Confirmar devolução'}
          </button>
        </div>
      </div>
    </div>
  );
}
