'use client';

import { useEffect, useState } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  type PaymentMethod,
  type ReceivableDetail,
  type ReceivableRow,
} from '@nexoloja/shared';
import { apiGet, apiPatch } from '@/lib/api';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Detalhe de uma conta a receber (ADR-019): itens da venda, histórico de recebimentos (com data e
 * hora) e uma **observação livre da dívida** (editável). Reusado na tela de Contas a Receber e no
 * perfil do cliente. Quando `onReceive` é passado (só onde faz sentido receber), mostra o botão
 * "Receber". `reloadSignal` força um refetch (ex.: após um recebimento feito pela tela pai).
 */
export function ReceivableDetailModal({
  receivableId,
  onClose,
  onReceive,
  reloadSignal = 0,
}: {
  receivableId: string;
  onClose: () => void;
  onReceive?: (r: ReceivableRow) => void;
  reloadSignal?: number;
}) {
  const [detail, setDetail] = useState<ReceivableDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Observação da dívida (edição inline).
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await apiGet<ReceivableDetail>(`/receivables/${receivableId}`);
        if (cancelled) return;
        setDetail(d);
        setNotes(d.notes ?? '');
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [receivableId, reloadSignal]);

  async function saveNotes() {
    if (!detail) return;
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      await apiPatch(`/receivables/${detail.id}`, { notes: notes.trim() ? notes.trim() : null });
      setDetail({ ...detail, notes: notes.trim() ? notes.trim() : null });
      setNotesSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }

  const notesChanged = detail !== null && notes.trim() !== (detail.notes ?? '').trim();

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-lg"
      >
        {loading || !detail ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{detail.customerName ?? 'Cliente'}</h2>
                <p className="text-xs text-gray-600">
                  Venda de{' '}
                  {new Date(detail.orderCreatedAt ?? detail.createdAt).toLocaleString('pt-BR')}
                  {detail.createdByName ? ` · ${detail.createdByName}` : ''}
                </p>
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

            {/* Situação da dívida. */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-xs text-gray-600">Original</p>
                <p className="font-semibold tabular-nums">{BRL(detail.originalAmount)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-xs text-gray-600">Recebido</p>
                <p className="font-semibold tabular-nums text-green-700">{BRL(detail.settledAmount)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-xs text-gray-600">Saldo</p>
                <p className="font-semibold tabular-nums">{BRL(detail.balance)}</p>
              </div>
            </div>
            <p className="text-sm">
              Situação:{' '}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  detail.status === 'PAID'
                    ? 'bg-green-100 text-green-700'
                    : detail.status === 'CANCELLED'
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-amber-100 text-amber-700'
                }`}
              >
                {RECEIVABLE_STATUS_LABELS[detail.status]}
              </span>
              {detail.dueDate && (
                <span className="ml-2 text-gray-600">
                  Vence em {new Date(detail.dueDate).toLocaleDateString('pt-BR')}
                </span>
              )}
            </p>

            {/* Itens da venda. */}
            <div>
              <h3 className="mb-1 text-sm font-semibold">Itens da venda</h3>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {detail.items.map((it, idx) => (
                  <li key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {Number(it.quantity)}× {it.productName}
                    </span>
                    <span className="shrink-0 tabular-nums">{BRL(it.total)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-gray-500">
                A mercadoria foi entregue na venda (a venda a prazo adia o pagamento, não a entrega).
              </p>
            </div>

            {/* Recebimentos (com data e hora). */}
            <div>
              <h3 className="mb-1 text-sm font-semibold">Recebimentos</h3>
              {detail.payments.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhum recebimento ainda.</p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        <span className="text-gray-700">
                          {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {new Date(p.paidAt).toLocaleString('pt-BR')}
                          {p.receivedByName ? ` · ${p.receivedByName}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-green-700">
                        {BRL(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Observação da dívida. */}
            <div>
              <h3 className="mb-1 text-sm font-semibold">Observações</h3>
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesSaved(false);
                }}
                rows={2}
                maxLength={500}
                placeholder="Ex.: prometeu pagar dia 10, ligar para cobrar…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveNotes}
                  disabled={!notesChanged || savingNotes}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {savingNotes ? 'Salvando…' : 'Salvar observação'}
                </button>
                {notesSaved && !notesChanged && <span className="text-xs text-green-700">Salvo ✓</span>}
              </div>
            </div>

            {onReceive && detail.status === 'OPEN' && (
              <button
                type="button"
                onClick={() =>
                  onReceive({
                    id: detail.id,
                    orderId: detail.orderId,
                    customerId: detail.customerId,
                    customerName: detail.customerName,
                    originalAmount: detail.originalAmount,
                    settledAmount: detail.settledAmount,
                    balance: detail.balance,
                    status: detail.status,
                    dueDate: detail.dueDate,
                    createdAt: detail.createdAt,
                    createdByName: detail.createdByName,
                  })
                }
                className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800"
              >
                Receber
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
