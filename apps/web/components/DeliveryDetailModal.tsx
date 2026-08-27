'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatOrderNumber,
  FULFILLMENT_STATUS_LABELS,
  unitTypeLabels,
  type DeliveryDetail,
  type UnitType,
} from '@nexoloja/shared';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { printArea } from '@/lib/print';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

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
  // Comprovante de retirada (ADR-020): cabeçalho da loja (buscado aqui p/ o modal ser autossuficiente)
  // + modelo de papel. Espelha o `ReceivableDetailModal`.
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');

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

  // Cabeçalho da loja para o comprovante de retirada (uma vez ao abrir).
  useEffect(() => {
    apiGet<Store>('/tenant').then(setStore).catch(() => {});
  }, []);

  /** Imprime o COMPROVANTE DE RETIRADA (ADR-020): cupom da venda + faixa "FALTA RETIRAR", para o
   *  cliente trazer na retirada. O PDF sai nomeado pelo código da venda (V-000128.pdf). */
  async function imprimir() {
    if (!detail) return;
    await printArea({
      model: printModel,
      logoUrl: store?.logoUrl,
      fileName: formatOrderNumber(detail.orderNumber),
    });
  }

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
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-lg"
      >
        {!loaded ? (
          <p className="p-5 text-gray-600">Carregando…</p>
        ) : !detail ? (
          <div className="p-5">
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
            {/* Cabeçalho do painel na cor da marca (identidade do PDV / telas repaginadas). */}
            <div className="flex items-start justify-between gap-2 bg-indigo-600 px-5 py-4 text-white">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">
                    {detail.customer?.name ?? 'Cliente não informado'}
                  </h2>
                  {/* Código da venda (ADR-023): identifica qual venda gerou esta retirada. */}
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold tabular-nums">
                    {formatOrderNumber(detail.orderNumber)}
                  </span>
                </div>
                <p className="text-sm text-indigo-100">
                  Venda em {dateTime(detail.createdAt)} · {BRL(detail.total)}
                </p>
                <p className="mt-1 text-sm">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      detail.fulfillmentStatus === 'COMPLETED'
                        ? 'bg-green-100 text-green-800'
                        : detail.fulfillmentStatus === 'PARTIAL'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-white/20 text-white'
                    }`}
                  >
                    {FULFILLMENT_STATUS_LABELS[detail.fulfillmentStatus]}
                  </span>
                  {!detail.perItemSchedule && detail.scheduledPickupAt && (
                    <span className="ml-2 text-xs text-indigo-100">
                      Previsão: {dateOnly(detail.scheduledPickupAt)}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-indigo-100 hover:bg-white/10 hover:text-white"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            {/* Corpo rolável (o cabeçalho índigo fica fixo no topo do painel). */}
            <div className="overflow-y-auto p-5">
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            {/* Comprovante de retirada (ADR-020): reimpressão do cupom com a faixa "FALTA RETIRAR"
                para o cliente trazer na retirada da mercadoria. */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-sm text-gray-600">Comprovante de retirada:</span>
              <select
                value={printModel}
                onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="80mm">Térmica 80mm</option>
                <option value="A4">A4</option>
              </select>
              <button
                type="button"
                onClick={imprimir}
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
              >
                Imprimir comprovante
              </button>
            </div>

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
                                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
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
                  className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
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

            {/* Documento imprimível (oculto na tela) — cupom da venda + faixa "FALTA RETIRAR".
                Mostra as quantidades VENDIDAS (cupom igual ao da venda); a faixa cobre o "falta
                retirar". "Pago" só quando não há saldo a prazo em aberto (`outstandingBalance`).
                `pickupLines` (progresso por item, unidade-base) faz o comprovante mostrar o bloco
                "Situação da retirada" após retiradas parciais — o cupom deixa de mostrar só a
                quantidade cheia e passa a discriminar o que já saiu e o que falta. */}
            <ReceiptPrint
              kind="sale"
              store={store}
              items={detail.items.map((it) => ({
                name: it.productName,
                quantity: Number(it.quantity),
                unitPrice: Number(it.unitPrice),
              }))}
              total={Number(detail.total)}
              discount={Number(detail.discountAmount)}
              date={dateTime(detail.createdAt)}
              customerName={detail.customer?.name ?? null}
              orderNumber={detail.orderNumber}
              pickupNotice
              pickupPaid={detail.outstandingBalance <= 0}
              pickupLines={detail.items.map((it) => ({
                name: it.productName,
                delivered: Number(it.deliveredBaseQty),
                remaining: it.remainingBaseQty,
              }))}
            />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
