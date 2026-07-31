'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FULFILLMENT_STATUS_LABELS,
  unitTypeLabels,
  type DeliveryDetail,
  type UnitType,
} from '@nexoloja/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const unitLabel = (u: string) => unitTypeLabels[u as UnitType] ?? u;

/** Formata uma quantidade em unidade-base sem casas inúteis (200 em vez de 200,0000). */
const qty = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
};

/**
 * Detalhe de um pedido de retirada/entrega futura (ADR-020) — o "lastro" pedido pelo Owner:
 * as infos do pedido, cada item com o que já saiu e o que falta, e o LOG de cada retirada
 * (quando, quanto, por quem). Permite registrar uma retirada por item ou "tudo o que falta".
 * Espelha o `ReceivableDetailModal` das Contas a Receber.
 */
export function DeliveryDetailModal({
  orderId,
  onClose,
  onDelivered,
}: {
  orderId: string;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // Rascunho da quantidade a retirar por item (default = o que falta), preenchido ao carregar.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  // Observação LIVRE do pedido (editável): rascunho + estado de salvamento.
  const [orderNote, setOrderNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<DeliveryDetail>(`/deliveries/${orderId}`);
      setDetail(data);
      // Pré-preenche cada linha pendente com o que falta (retirada total num toque).
      const d: Record<string, string> = {};
      for (const it of data.items) {
        if (it.remainingBaseQty > 0) d[it.id] = String(qty(it.remainingBaseQty));
      }
      setDraft(d);
      setOrderNote(data.notes ?? '');
      setNoteSaved(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function deliver(items: { orderItemId: string; quantity: number }[]) {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/deliveries/${orderId}/deliver`, {
        items,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setNotes('');
      await load();
      onDelivered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Salva a observação livre do pedido (Order.notes). */
  async function saveNote() {
    setSavingNote(true);
    setError(null);
    try {
      await apiPatch(`/deliveries/${orderId}`, { notes: orderNote.trim() ? orderNote.trim() : null });
      setNoteSaved(true);
      setDetail((prev) => (prev ? { ...prev, notes: orderNote.trim() ? orderNote.trim() : null } : prev));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  /** Retira uma linha (quantidade do rascunho). */
  function deliverOne(orderItemId: string) {
    const q = Number(draft[orderItemId]);
    if (!(q > 0)) {
      setError('Informe uma quantidade válida para retirar.');
      return;
    }
    void deliver([{ orderItemId, quantity: q }]);
  }

  /** Retira tudo o que falta de todas as linhas pendentes de uma vez. */
  function deliverAll() {
    if (!detail) return;
    const items = detail.items
      .filter((it) => it.remainingBaseQty > 0)
      .map((it) => ({ orderItemId: it.id, quantity: it.remainingBaseQty }));
    void deliver(items);
  }

  const anyPending = detail?.items.some((it) => it.remainingBaseQty > 0) ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
      >
        {!loaded ? (
          <p className="text-gray-600">Carregando…</p>
        ) : !detail ? (
          <div>
            <p className="text-sm text-red-600">{error ?? 'Pedido não encontrado.'}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">
                  {detail.customer?.name ?? 'Cliente não informado'}
                </h2>
                <p className="text-sm text-gray-600">
                  Venda em {dateTime(detail.createdAt)} · {BRL(detail.total)}
                </p>
                <p className="mt-0.5 text-sm">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      detail.fulfillmentStatus === 'COMPLETED'
                        ? 'bg-green-100 text-green-800'
                        : detail.fulfillmentStatus === 'PARTIAL'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    {FULFILLMENT_STATUS_LABELS[detail.fulfillmentStatus]}
                  </span>
                  {!detail.perItemSchedule && detail.scheduledPickupAt && (
                    <span className="ml-2 text-xs text-gray-600">
                      Previsão: {dateOnly(detail.scheduledPickupAt)}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-gray-400 hover:text-gray-700"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            {/* Observação livre do pedido (editável) — informações gerais p/ quem separa/entrega
                (ex.: "quem retira não é quem comprou"). Distinta da observação por retirada (log). */}
            <div className="mb-4">
              <label htmlFor="ordernote" className="mb-1 block text-sm font-semibold text-gray-700">
                Observações do pedido
              </label>
              <textarea
                id="ordernote"
                value={orderNote}
                onChange={(e) => {
                  setOrderNote(e.target.value);
                  setNoteSaved(false);
                }}
                rows={2}
                maxLength={500}
                placeholder="Ex.: quem vai retirar é o pedreiro João; ligar antes de separar…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-1 flex items-center justify-end gap-2">
                {noteSaved && <span className="text-xs text-green-700">Salvo ✓</span>}
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={savingNote || (orderNote.trim() === (detail.notes ?? '').trim())}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {savingNote ? 'Salvando…' : 'Salvar observação'}
                </button>
              </div>
            </div>

            {/* Itens: o que foi vendido, o que já saiu e o que falta; retirada por linha. */}
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-600">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Falta sair</th>
                    <th className="px-3 py-2 text-right">Retirar agora</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => {
                    const remaining = it.remainingBaseQty;
                    const done = remaining <= 0;
                    return (
                      <tr key={it.id} className="border-b border-gray-50 align-middle">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{it.productName}</div>
                          <div className="text-xs text-gray-500">
                            Vendido: {qty(it.quantity)} {unitLabel(it.unit)}
                            {detail.perItemSchedule && it.scheduledPickupAt
                              ? ` · previsão ${dateOnly(it.scheduledPickupAt)}`
                              : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {done ? (
                            <span className="text-xs font-medium text-green-700">retirado</span>
                          ) : (
                            qty(remaining)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {done ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max={remaining}
                                value={draft[it.id] ?? ''}
                                onChange={(e) =>
                                  setDraft((prev) => ({ ...prev, [it.id]: e.target.value }))
                                }
                                className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-right"
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => deliverOne(it.id)}
                                className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
                              >
                                Retirar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {anyPending && (
              <div className="mt-3 space-y-2">
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observação da retirada (opcional)…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={deliverAll}
                  className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {busy ? 'Registrando…' : 'Retirar tudo o que falta'}
                </button>
              </div>
            )}

            {/* Log de retiradas (o "lastro"): cada saída com data, quantidade e autor. */}
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Histórico de retiradas</h3>
              {detail.itemDeliveries.length === 0 ? (
                <p className="text-sm text-gray-500">Nada retirado ainda.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.itemDeliveries.map((log) => {
                    const item = detail.items.find((it) => it.id === log.orderItemId);
                    return (
                      <li
                        key={log.id}
                        className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-800">
                            {item?.productName ?? 'Item'} · {qty(log.quantity)}
                            {item ? ` ${unitLabel(item.unit)}` : ''}
                          </div>
                          <div className="text-xs text-gray-500">
                            {dateTime(log.deliveredAt)}
                            {log.deliveredByName ? ` · ${log.deliveredByName}` : ''}
                            {log.notes ? ` · ${log.notes}` : ''}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
