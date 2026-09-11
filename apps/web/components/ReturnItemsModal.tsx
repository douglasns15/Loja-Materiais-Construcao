'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { apiGet, apiPost } from '@/lib/api';
import { CustomerQuickAddModal } from '@/components/CustomerQuickAddModal';

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

// Intenção do operador (ADR-035): declarada no topo, em vez de inferida pela completude. Cada
// caminho decide o endpoint e as opções — e deixa o fluxo fiscal-ready para a NF-e (REFUND = nota de
// devolução, CANCEL = nota de cancelamento).
type Intent = 'REFUND' | 'EXCHANGE' | 'CANCEL';

/**
 * Modal UNIFICADO de devolução/estorno/cancelamento/troca (ADR-022 + ADR-033 + ADR-035). Um único
 * botão "Cancelar / Devolver" abre este motor, que pergunta a INTENÇÃO (3 caminhos):
 *  - REFUND — "Cliente devolveu / desistiu": devolução por item (parcial OU total). O excedente vira
 *    crédito na loja, dinheiro do caixa, ou estorno na mesma forma. A venda continua no histórico
 *    (`CONFIRMED`); o servidor acerta estoque/caixa por item ⇒ `POST /orders/:id/return-items`.
 *    Crédito sem cliente na venda: escolhe/cadastra o cliente NO ATO (pick-no-retorno, ADR-035) — o
 *    servidor anexa à venda e credita.
 *  - EXCHANGE — "Trocar por outro item" (ADR-033 F3): o valor devolvido vira um vale consumido no PDV.
 *  - CANCEL — "Venda feita errada": desfaz a venda inteira (sai do faturamento) ⇒ `POST /orders/:id/cancel`.
 *    Só quando dá para desfazer limpo (mesma sessão de caixa, sem devolução anterior). Sem crédito.
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
  const [intent, setIntent] = useState<Intent>('REFUND');
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

  // Pick-no-retorno (ADR-035): cliente escolhido/cadastrado no ato, para o crédito, quando a venda
  // não tem cliente. Estado local do modal (busca própria no servidor + cadastro rápido reusado).
  const [pickCustomerId, setPickCustomerId] = useState('');
  const [pickCustomerName, setPickCustomerName] = useState('');
  const [pickQuery, setPickQuery] = useState('');
  const [pickOptions, setPickOptions] = useState<{ id: string; name: string }[]>([]);
  const [pickModalName, setPickModalName] = useState<string | null>(null);

  const isCancel = intent === 'CANCEL';

  // A venda já teve alguma devolução? (bloqueia o CANCELAMENTO, que desfaz o total e duplicaria o
  // estorno; nesse caso o restante segue por `return-items`.)
  const noPriorReturns = useMemo(
    () => items.every((it) => Number(it.returnedBaseQty ?? 0) === 0),
    [items],
  );
  // Cancelar (desfazer) só é possível na mesma sessão de caixa e sem devolução anterior.
  const canCancel = isOpenSessionOrder && noPriorReturns;
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

  // Preview: itens escolhidos, valor devolvido, abate da dívida e excedente (troco). No CANCEL o
  // conjunto é a venda inteira (todos os itens devolvíveis), independente dos campos de quantidade.
  const preview = useMemo(() => {
    let totalValue = 0;
    const chosen: { orderItemId: string; quantity: number; condition: ReturnItemCondition }[] = [];
    let fullRows = 0;
    let eligibleRows = 0;
    for (const r of rows) {
      if (r.returnableSold > 0) eligibleRows += 1;
      let capped: number;
      if (isCancel) {
        capped = r.returnableSold; // desfaz tudo
      } else {
        const q = Number(qty[r.it.id]);
        if (!Number.isFinite(q) || q <= 0) continue;
        capped = Math.min(q, r.returnableSold);
      }
      if (capped <= 0) continue;
      totalValue += Number(r.it.total) * (capped / (r.soldQty || 1));
      chosen.push({ orderItemId: r.it.id, quantity: capped, condition: condition[r.it.id] ?? 'GOOD' });
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
    const isFullReturn = eligibleRows > 0 && fullRows === eligibleRows && chosen.length === eligibleRows;
    return { totalValue, abated, excess, chosen, defectiveCount, isFullReturn };
  }, [isCancel, rows, qty, condition, receivable]);

  // Opções da forma do estorno conforme o caminho. Cancelamento não vira crédito (ADR-035).
  const refundOptions: ReturnTarget[] = isCancel
    ? ['SAME_AS_PAYMENT', 'CASH']
    : ['STORE_CREDIT', 'SAME_AS_PAYMENT', 'CASH'];
  const effectiveRefund: ReturnTarget = refundOptions.includes(refundForm)
    ? refundForm
    : 'SAME_AS_PAYMENT';

  // Mostrar a forma do estorno? Na troca não (o valor vira vale); no cancelamento quando houve
  // pagamento; na devolução quando há troco.
  const showRefund = intent === 'EXCHANGE' ? false : isCancel ? wasPaid : preview.excess > 0;

  // Crédito escolhido sem cliente na venda ⇒ pick-no-retorno (escolher/cadastrar o cliente aqui).
  const needsPick = intent === 'REFUND' && showRefund && effectiveRefund === 'STORE_CREDIT' && !hasCustomer;

  // Quanto SAI do caixa com a escolha atual (para o operador ver o impacto — pedido do Owner).
  const cashOut = useMemo(() => {
    if (isCancel) {
      return cancelCashRefund(effectiveRefund === 'CASH' ? 'CASH' : 'SAME_AS_PAYMENT', orderTotal, cashPaid);
    }
    return cashOutForReturn(effectiveRefund, preview.excess, payments);
  }, [isCancel, effectiveRefund, orderTotal, cashPaid, preview.excess, payments]);

  // Busca de cliente para o crédito (pick-no-retorno) — debounce, mesma rota do PDV (`/customers?q=`).
  useEffect(() => {
    if (!needsPick) return;
    const q = pickQuery.trim();
    if (q.length < 2) {
      setPickOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const page = await apiGet<{ rows: { id: string; name: string }[] }>(
          `/customers?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled) setPickOptions(page.rows.map((r) => ({ id: r.id, name: r.name })));
      } catch {
        if (!cancelled) setPickOptions([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [needsPick, pickQuery]);

  function clearPick() {
    setPickCustomerId('');
    setPickCustomerName('');
    setPickQuery('');
    setPickOptions([]);
  }

  async function confirmar() {
    setError(null);
    if (preview.chosen.length === 0) {
      setError(isCancel ? 'Nada a cancelar nesta venda.' : 'Escolha ao menos um item e a quantidade a devolver.');
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

      if (isCancel) {
        // Cancelamento da venda inteira: condição por item + forma do estorno (sem crédito).
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

      // Devolução por item / estorno (REFUND). Crédito exige cliente — na venda OU escolhido no ato.
      if (needsPick && preview.excess > 0 && !pickCustomerId) {
        setError('Selecione ou cadastre um cliente para o crédito na loja.');
        setBusy(false);
        return;
      }
      const payload = {
        items: preview.chosen,
        reason: reason.trim(),
        // target só é usado pelo servidor quando há excedente; enviar sempre é inofensivo.
        target: preview.excess > 0 ? effectiveRefund : undefined,
        // ADR-035: cliente do crédito escolhido no ato (só quando a venda não tem cliente).
        ...(needsPick && pickCustomerId ? { customerId: pickCustomerId } : {}),
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
    <>
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
            <h2 className="text-lg font-bold">Cancelar / Devolver</h2>
            <p className="text-xs text-gray-500">Venda {formatOrderNumber(orderNumber)}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Passo de intenção (ADR-035): o operador declara o que aconteceu. Cancelar aparece só
            quando dá para desfazer limpo (mesma sessão, sem devolução anterior). */}
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">O que aconteceu?</p>
          <div className="grid grid-cols-1 gap-2">
            {(
              [
                ['REFUND', 'Cliente devolveu / desistiu', 'Devolve itens (parcial ou total) — dinheiro, estorno ou crédito na loja.'],
                ['EXCHANGE', 'Trocar por outro item', 'O valor vira um vale e abre o PDV para a nova compra.'],
                ...(canCancel
                  ? ([['CANCEL', 'Venda feita errada — cancelar', 'Desfaz a venda inteira (sai do faturamento). Sem crédito.']] as const)
                  : []),
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setIntent(key);
                  if (key !== 'REFUND') clearPick();
                }}
                className={`rounded-lg border px-3 py-2 text-left ${
                  intent === key
                    ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="block text-sm font-medium text-gray-900">{label}</span>
                <span className="block text-xs text-gray-500">{hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            {isCancel ? 'Itens da venda (defeito?)' : 'Itens a devolver'}
          </p>
          {!isCancel && (
            <button
              type="button"
              onClick={preencherTudo}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Devolver tudo
            </button>
          )}
        </div>

        {/* Itens: no REFUND/EXCHANGE, quantidade por linha + condição (aparece ao ter quantidade);
            no CANCEL, a venda inteira é desfeita — mostra só a condição (Revenda × Defeito) por item. */}
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {rows.map((r) => {
            const disabled = r.returnableSold <= 0;
            const q = Number(qty[r.it.id]);
            const hasQty = Number.isFinite(q) && q > 0;
            const showCondition = isCancel ? !disabled : hasQty;
            const cond = condition[r.it.id] ?? 'GOOD';
            return (
              <div key={r.it.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.it.productName}</p>
                    <p className="text-xs text-gray-500">
                      {disabled
                        ? 'Tudo já devolvido'
                        : isCancel
                          ? `Quantidade: ${r.returnableSold.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`
                          : `Devolvível: ${r.returnableSold.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`}
                    </p>
                  </div>
                  {!isCancel && (
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
                  )}
                </div>

                {showCondition && (
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
              {intent === 'EXCHANGE' ? 'Valor do vale' : isCancel ? 'Valor da venda' : 'Valor devolvido'}
            </span>
            <span className="font-semibold tabular-nums">
              {BRL(isCancel ? orderTotal : preview.totalValue)}
            </span>
          </div>
          {!isCancel && preview.abated > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Abate da dívida</span>
              <span className="tabular-nums">−{BRL(preview.abated)}</span>
            </div>
          )}
          {!isCancel && preview.excess > 0 && (
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
              {isCancel ? 'Como o dinheiro voltou?' : 'Destino do troco'}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {refundOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRefundForm(t)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                    effectiveRefund === t
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {RETURN_TARGET_LABELS[t]}
                </button>
              ))}
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

        {/* Pick-no-retorno (ADR-035): crédito na loja numa venda sem cliente — escolhe/cadastra aqui.
            O servidor anexa o cliente à venda e credita. */}
        {needsPick && (
          <div className="space-y-2 rounded-xl border border-green-200 bg-green-50/60 p-3">
            <p className="text-sm font-semibold text-green-900">Cliente do crédito</p>
            {pickCustomerId ? (
              <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-green-200">
                <span className="min-w-0 truncate">
                  Crédito para: <strong>{pickCustomerName}</strong>
                </span>
                <button type="button" onClick={clearPick} className="shrink-0 text-blue-600 hover:underline">
                  trocar
                </button>
              </div>
            ) : (
              <div>
                <input
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder="Buscar cliente por nome…"
                  className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm"
                />
                {pickOptions.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white text-sm shadow-sm">
                    {pickOptions.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPickCustomerId(o.id);
                            setPickCustomerName(o.name);
                            setPickQuery('');
                            setPickOptions([]);
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                        >
                          {o.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {pickQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => setPickModalName(pickQuery.trim())}
                    className="mt-1 block w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-left text-sm font-medium text-blue-600 hover:bg-blue-50"
                  >
                    + Cadastrar “{pickQuery.trim()}”
                  </button>
                )}
                <p className="mt-1 text-xs text-green-800">
                  O cliente escolhido recebe o crédito e passa a ficar vinculado a esta venda.
                </p>
              </div>
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
            placeholder="Ex.: item com defeito, cliente desistiu, venda lançada errada…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">
          {intent === 'EXCHANGE'
            ? 'O item volta ao estoque (ou vira defeito) e o valor abre como vale no PDV. '
            : isCancel
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
                : isCancel
                  ? 'Cancelar venda'
                  : 'Confirmar devolução'}
          </button>
        </div>
      </div>
    </div>

      {/* Cadastro rápido de cliente (pick-no-retorno): cria e já seleciona para o crédito. Fica
          FORA do backdrop do modal de devolução para os cliques não fecharem o modal de trás. */}
      {pickModalName !== null && (
        <CustomerQuickAddModal
          initialName={pickModalName}
          onClose={() => setPickModalName(null)}
          onCreated={(c) => {
            setPickCustomerId(c.id);
            setPickCustomerName(c.name);
            setPickQuery('');
            setPickOptions([]);
            setPickModalName(null);
          }}
        />
      )}
    </>
  );
}
