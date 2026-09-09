'use client';

import { useEffect, useState } from 'react';
import type {
  DefectiveItem,
  DefectResolutionAction,
  ResolveDefectResult,
} from '@nexoloja/shared';
import { formatOrderNumber } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const QTY = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/**
 * Tela "Devolvidos com defeito" (ADR-033, Fatia 1). Fila dos itens que voltaram COM DEFEITO e não
 * entraram no estoque vendável — ficam aqui aguardando acerto com o fornecedor. Para cada um, o
 * operador resolve: REPOR (o fornecedor trocou → o substituto entra no estoque) ou BAIXA/perda.
 * Só leitura + duas ações; a marcação do defeito acontece na devolução (tela de Histórico).
 */
export default function DefectiveReturnsPage() {
  const online = useOnline();
  const [items, setItems] = useState<DefectiveItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // Confirmação inline por item: guarda a ação escolhida até o 2º clique (evita resolver por engano).
  const [pending, setPending] = useState<Record<string, DefectResolutionAction>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const data = await apiGet<DefectiveItem[]>('/returns/defective');
    setItems(data);
  }

  useEffect(() => {
    load()
      .then(() => setLoadFailed(false))
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      })
      .finally(() => setReady(true));
  }, []);

  // Auto-recuperação ao reconectar (ADR-005): se a carga falhou, re-tenta sozinha.
  useReloadOnReconnect(
    () =>
      load()
        .then(() => {
          setLoadFailed(false);
          setError(null);
        })
        .catch(() => {}),
    loadFailed,
  );

  async function resolver(item: DefectiveItem, action: DefectResolutionAction) {
    setBusyId(item.orderReturnItemId);
    setError(null);
    try {
      await apiPost<ResolveDefectResult>(
        `/returns/defective/${item.orderReturnItemId}/resolve`,
        { action },
      );
      setPending((prev) => {
        const next = { ...prev };
        delete next[item.orderReturnItemId];
        return next;
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) return <p className="text-gray-600">Carregando…</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Devolvidos com defeito
      </h1>
      <p className="mb-3 text-sm text-gray-500">
        Itens que voltaram com defeito e <strong>não</strong> entraram no estoque. Quando o
        fornecedor <strong>trocar</strong>, use <strong>Repor</strong> (o substituto volta ao
        estoque); se não der, use <strong>Baixa/perda</strong>.
      </p>

      {!online && <OfflineNotice />}
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Nenhum item com defeito aguardando acerto. 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const chosen = pending[it.orderReturnItemId];
            const busy = busyId === it.orderReturnItemId;
            return (
              <div
                key={it.orderReturnItemId}
                className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-800">{it.productName}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Venda {formatOrderNumber(it.orderNumber)} ·{' '}
                      {new Date(it.createdAt).toLocaleDateString('pt-BR')}
                      {it.supplierName ? ` · Fornecedor: ${it.supplierName}` : ''}
                    </p>
                    {it.reason && (
                      <p className="mt-1 text-xs italic text-gray-500">“{it.reason}”</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-amber-700">{QTY(it.baseQty)}</p>
                    <p className="text-xs text-gray-400 tabular-nums">{BRL(it.value)}</p>
                  </div>
                </div>

                {/* Ações: 1º clique escolhe, 2º confirma (inline). */}
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
                  {chosen ? (
                    <>
                      <span className="mr-auto text-sm text-gray-600">
                        {chosen === 'RESTOCK'
                          ? 'Repor no estoque? O substituto do fornecedor volta a ser vendável.'
                          : 'Dar baixa/perda? Não volta ao estoque.'}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setPending((prev) => {
                            const next = { ...prev };
                            delete next[it.orderReturnItemId];
                            return next;
                          })
                        }
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => resolver(it, chosen)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
                          chosen === 'RESTOCK'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-red-600 hover:bg-red-700'
                        }`}
                      >
                        {busy ? 'Salvando…' : 'Confirmar'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setPending((prev) => ({ ...prev, [it.orderReturnItemId]: 'RESTOCK' }))
                        }
                        className="rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Repor (fornecedor trocou)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPending((prev) => ({ ...prev, [it.orderReturnItemId]: 'WRITE_OFF' }))
                        }
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Baixa/perda
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
