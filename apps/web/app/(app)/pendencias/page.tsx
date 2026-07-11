'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@nexoloja/shared';
import {
  hasOutbox,
  listOutbox,
  removeMutation,
  requeue,
  subscribeOutbox,
  type OutboxRecord,
  type OutboxStatus,
} from '@/lib/outbox';
import { useOutboxSyncContext } from '@/lib/outboxSync';
import { useOnline } from '@/lib/useOnline';

/**
 * Tela de pendências da fila offline (ADR-011, refino "tela de FAILED"). Mostra as vendas que ainda
 * não sincronizaram — inclusive as com **falha dura** (`FAILED`), que somem do contador de
 * pendentes e precisavam de um lugar visível. Ações por item: **Tentar novamente** (recoloca na
 * fila e dispara o dreno) e **Descartar** (remove do dispositivo). Read-model puro: a verdade
 * segue na `outbox`; esta tela só a apresenta e oferece as ações de operação.
 */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_META: Record<OutboxStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendente', className: 'bg-indigo-100 text-indigo-700' },
  ERROR: { label: 'Repetindo', className: 'bg-amber-100 text-amber-700' },
  SYNCED: { label: 'Sincronizada', className: 'bg-green-100 text-green-700' },
  FAILED: { label: 'Falha', className: 'bg-red-100 text-red-700' },
  CONFLICT: { label: 'Conflito', className: 'bg-red-100 text-red-700' },
};

/** Total e nº de itens de uma venda enfileirada (a partir do payload do envelope). */
function saleSummary(rec: OutboxRecord): { total: number; itemCount: number; method?: PaymentMethod } {
  const { payload } = rec.envelope;
  const total = payload.payments.reduce((acc, p) => acc + p.amount, 0);
  const itemCount = payload.items.reduce((acc, i) => acc + i.quantity, 0);
  return { total, itemCount, method: payload.payments[0]?.method };
}

export default function PendenciasPage() {
  const online = useOnline();
  const { syncing, syncNow } = useOutboxSyncContext();
  const [items, setItems] = useState<OutboxRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [actingSeq, setActingSeq] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!hasOutbox()) {
      setReady(true);
      return;
    }
    try {
      setItems(await listOutbox());
    } catch {
      // IndexedDB indisponível — lista vazia.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Reflete enfileirar/sincronizar/podar/descartar (aqui ou em outra aba/tela) em tempo real.
    const unsubscribe = subscribeOutbox(() => void reload());
    return unsubscribe;
  }, [reload]);

  async function onRetry(seq: number) {
    setActingSeq(seq);
    try {
      await requeue(seq);
      await syncNow();
    } finally {
      setActingSeq(null);
    }
  }

  async function onDiscard(seq: number) {
    if (!window.confirm('Descartar esta venda da fila? Ela não será registrada no servidor.')) return;
    setActingSeq(seq);
    try {
      await removeMutation(seq);
    } finally {
      setActingSeq(null);
    }
  }

  if (!ready) return <p className="text-gray-500">Carregando…</p>;

  // Ordena por seq (FIFO). SYNCED (raro — podado após o dreno) fica por último, informativo.
  const rows = [...items].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const hasRetryable = rows.some((r) => r.status === 'PENDING' || r.status === 'ERROR');

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Pendências de sincronização</h1>
        {hasRetryable && online && (
          <button
            onClick={() => void syncNow()}
            disabled={syncing}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Vendas salvas neste aparelho que ainda não chegaram ao servidor. As <strong>pendentes</strong>{' '}
        sincronizam sozinhas quando a conexão volta; as <strong>com falha</strong> precisam de atenção.
      </p>

      {!online && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          Sem conexão — a sincronização recomeça automaticamente quando a internet voltar.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">
          <p className="mb-3">Nenhuma venda na fila. Tudo sincronizado. ✅</p>
          <Link href="/venda" className="text-sm font-medium text-indigo-600 hover:underline">
            Ir para Nova Venda
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((rec) => {
            const { total, itemCount, method } = saleSummary(rec);
            const meta = STATUS_META[rec.status];
            const acting = actingSeq === rec.seq;
            const canRetry = rec.status !== 'SYNCED' && rec.status !== 'PENDING';
            const canDiscard = rec.status !== 'SYNCED';
            return (
              <li key={rec.seq} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                    <span className="font-mono text-xs text-gray-400">
                      #{rec.envelope.entityId.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-sm font-semibold">{BRL(total)}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>
                    {itemCount} {itemCount === 1 ? 'item' : 'itens'}
                  </span>
                  {method && <span>{PAYMENT_METHOD_LABELS[method]}</span>}
                  <span>{new Date(rec.enqueuedAt).toLocaleString('pt-BR')}</span>
                  {rec.attempts > 0 && (
                    <span>
                      {rec.attempts} {rec.attempts === 1 ? 'tentativa' : 'tentativas'}
                    </span>
                  )}
                </div>

                {rec.lastError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                    {rec.lastError}
                  </p>
                )}

                {(canRetry || canDiscard) && (
                  <div className="mt-3 flex gap-2">
                    {canRetry && (
                      <button
                        onClick={() => void onRetry(rec.seq!)}
                        disabled={acting || !online}
                        title={!online ? 'Sem conexão' : undefined}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {acting ? 'Enviando…' : 'Tentar novamente'}
                      </button>
                    )}
                    {canDiscard && (
                      <button
                        onClick={() => void onDiscard(rec.seq!)}
                        disabled={acting}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Descartar
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
