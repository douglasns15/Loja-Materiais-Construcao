'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatDebtNumber,
  formatOrderNumber,
  PAYMENT_METHOD_LABELS,
  RETURN_TARGET_LABELS,
  type CustomerAccountDetail,
  type CustomerAccountRow,
  type PaymentMethod,
  type ReturnTarget,
} from '@nexoloja/shared';
import { apiGet, apiPatch } from '@/lib/api';
import { printArea } from '@/lib/print';
import { CustomerAccountPrint } from '@/components/ReceivablePrint';
import type { Store } from '@/components/ReceiptPrint';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Um evento do extrato da conta: uma venda a prazo (entra saldo), um recebimento (abate) ou uma
 * devolução (abate o que voltou; excedente vira crédito/dinheiro — evento próprio, ADR-022). */
type TimelineEvent =
  | {
      kind: 'sale';
      at: string;
      amount: number; // valor a prazo daquela venda (+ no saldo)
      orderId: string; // fallback p/ o código curto (vendas antes do backfill)
      orderNumber: number | null; // código sequencial da venda (ADR-023) → V-000128
      paid: boolean; // dívida já quitada → selo "Quitada"
      items: { productName: string; quantity: string; total: string }[];
    }
  | {
      kind: 'payment';
      at: string;
      amount: number; // valor recebido (− no saldo)
      method: string;
      by: string | null;
    }
  | {
      kind: 'return';
      at: string;
      amount: number; // quanto abateu da dívida (− no saldo corrente da conta)
      excess: number; // excedente que virou crédito/dinheiro (fora do saldo devedor)
      target: ReturnTarget | null;
      reason: string;
      by: string | null;
      items: { productName: string; quantity: string; total: string }[];
    }
  | {
      kind: 'credit';
      at: string;
      amount: number; // ASSINADO: − usado numa venda, + estornado (não mexe no saldo DEVEDOR)
      origin: string; // SALE_USE | SALE_REVERSAL | MANUAL
      relatedOrderId: string | null;
      relatedOrderNumber: number | null; // código sequencial da venda relacionada (ADR-023)
      by: string | null;
    };

/** Código da venda para a tela (ADR-023): o sequencial `V-000128` quando existe; senão, os 8
 * primeiros do UUID (fallback p/ vendas anteriores ao backfill — não deve ocorrer na prática). */
const saleCode = (orderNumber: number | null, orderId: string) =>
  formatOrderNumber(orderNumber) || `#${orderId.slice(0, 8)}`;

/**
 * Extrato consolidado da CONTA de um cliente (ADR-022, Fatia A.2). Junta todas as vendas a prazo
 * do cliente (em aberto + quitadas) num **log cronológico único**: cada venda entra com seus itens
 * e valor a prazo; cada recebimento abate. Mostra o saldo corrente linha a linha (do mais antigo ao
 * mais novo, novas atividades aparecem embaixo). "Receber" abate a conta inteira (FIFO); "+
 * Adicionar itens" leva ao PDV já com o cliente selecionado (a saída de mercadoria roda no PDV —
 * motor único). `reloadSignal` força refetch após um recebimento feito pela tela pai.
 */
export function CustomerAccountModal({
  customerId,
  onClose,
  onReceive,
  reloadSignal = 0,
}: {
  customerId: string;
  onClose: () => void;
  onReceive?: (a: CustomerAccountRow) => void;
  reloadSignal?: number;
}) {
  const [detail, setDetail] = useState<CustomerAccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Impressão do resumo da conta: identidade da loja (cabeçalho) + modelo do papel.
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');

  // Observação do CLIENTE (uma só, compartilhada por todas as vendas — ADR-022). Edição inline.
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await apiGet<CustomerAccountDetail>(`/receivables/accounts/${customerId}`);
        if (cancelled) return;
        setDetail(d);
        setNotes(d.debtNotes ?? '');
        setNotesSaved(false);
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
  }, [customerId, reloadSignal]);

  // Identidade da loja para o cabeçalho da impressão (uma vez).
  useEffect(() => {
    apiGet<Store>('/tenant').then(setStore).catch(() => {});
  }, []);

  /** Abre o diálogo de impressão do resumo da conta. O PDF é nomeado pelo cliente ("Conta …"). */
  async function imprimir() {
    if (!detail) return;
    await printArea({
      model: printModel,
      logoUrl: store?.logoUrl,
      fileName: `Conta ${detail.customerName ?? 'cliente'}`,
    });
  }

  async function saveNotes() {
    if (!detail) return;
    const clean = notes.trim() ? notes.trim() : '';
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      // Nota da DÍVIDA (separada do cadastro) — PATCH /customers/:id { debtNotes }; vale p/ todas
      // as vendas do cliente (ADR-022).
      await apiPatch(`/customers/${detail.customerId}`, { debtNotes: clean });
      setDetail({ ...detail, debtNotes: clean || null });
      setNotesSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }

  const notesChanged = detail !== null && notes.trim() !== (detail.debtNotes ?? '').trim();

  // Monta o log: 1 evento por venda + 1 por recebimento, ordenados no tempo, com saldo corrente.
  const timeline = useMemo(() => {
    if (!detail) return [] as (TimelineEvent & { running: number })[];
    const events: TimelineEvent[] = [];
    for (const r of detail.receivables) {
      events.push({
        kind: 'sale',
        at: r.createdAt,
        amount: Number(r.originalAmount),
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        paid: r.status === 'PAID',
        items: r.items.map((it) => ({
          productName: it.productName,
          quantity: it.quantity,
          total: it.total,
        })),
      });
      for (const p of r.payments) {
        events.push({
          kind: 'payment',
          at: p.paidAt,
          amount: Number(p.amount),
          method: p.method,
          by: p.receivedByName,
        });
      }
    }
    // Devoluções: um evento por devolução (append-only — não muta a venda). Abate o saldo pelo que
    // foi devolvido da DÍVIDA (`abatedAmount`); o excedente (crédito/dinheiro) fica fora do saldo.
    for (const rt of detail.returns ?? []) {
      events.push({
        kind: 'return',
        at: rt.createdAt,
        amount: Number(rt.abatedAmount),
        excess: Number(rt.excessAmount),
        target: rt.target,
        reason: rt.reason,
        by: rt.createdByName,
        items: rt.items.map((it) => ({
          productName: it.productName,
          quantity: it.quantity,
          total: it.total,
        })),
      });
    }
    // Crédito da loja (ADR-022, Fatia C): TODO o livro-razão entra na timeline — gerado (na
    // devolução), usado (numa venda) e estornado. É o "crédito que sobrou" que segue visível mesmo
    // depois de a dívida ser quitada. Não mexe no saldo DEVEDOR (é um saldo à parte, no topo).
    for (const cr of detail.credits ?? []) {
      events.push({
        kind: 'credit',
        at: cr.createdAt,
        amount: Number(cr.amount), // assinado (− usado, + estornado)
        origin: cr.origin,
        relatedOrderId: cr.relatedOrderId,
        relatedOrderNumber: cr.relatedOrderNumber,
        by: cr.createdByName,
      });
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    // Saldo corrente em centavos (venda +, recebimento e devolução −; crédito não mexe no devedor).
    let cents = 0;
    return events.map((e) => {
      const sign = e.kind === 'sale' ? 1 : e.kind === 'credit' ? 0 : -1;
      cents += Math.round(e.amount * 100) * sign;
      return { ...e, running: cents / 100 };
    });
  }, [detail]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        {loading || !detail ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                {detail.debtNumber != null && (
                  <span className="inline-flex w-fit items-center gap-2">
                    <span className="rounded-full bg-gradient-to-r from-indigo-700 to-indigo-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
                      {formatDebtNumber(detail.debtNumber)}
                    </span>
                    <span className="text-xs text-gray-500">
                      Em aberto
                      {detail.debtOpenedAt
                        ? ` · desde ${new Date(detail.debtOpenedAt).toLocaleDateString('pt-BR')}`
                        : ''}
                    </span>
                  </span>
                )}
                <h2 className="text-xl font-bold">{detail.customerName ?? 'Cliente'}</h2>
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

            {/* Resumo: saldo da conta + nº de dívidas em aberto. */}
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-gray-50 p-4">
              <div>
                <p className="text-xs text-gray-600">Saldo da conta</p>
                <p className="text-3xl font-bold tabular-nums">{BRL(detail.totalBalance)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {detail.openCount === 0
                    ? 'Sem dívidas em aberto'
                    : `${detail.openCount} ${detail.openCount === 1 ? 'dívida em aberto' : 'dívidas em aberto'}`}
                </p>
                {detail.creditBalance > 0 && (
                  <p className="mt-1 text-sm font-medium text-green-700">
                    Crédito a favor: {BRL(detail.creditBalance)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Link
                  href={{
                    pathname: '/venda',
                    query: { customerId: detail.customerId, customerName: detail.customerName ?? '' },
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  + Adicionar itens
                </Link>
                {onReceive && detail.totalBalance > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onReceive({
                        customerId: detail.customerId,
                        customerName: detail.customerName,
                        totalBalance: detail.totalBalance,
                        openCount: detail.openCount,
                        oldestCreatedAt: null,
                        nextDueDate: null,
                        creditBalance: detail.creditBalance,
                      })
                    }
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                  >
                    Receber
                  </button>
                )}
              </div>
            </div>

            {/* Impressão do resumo da conta — PDF nomeado pelo cliente ("Conta ….pdf"). */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Imprimir:</span>
              <select
                value={printModel}
                onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="80mm">80mm</option>
                <option value="A4">A4</option>
              </select>
              <button
                type="button"
                onClick={imprimir}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Imprimir resumo
              </button>
            </div>

            {/* Observação do cliente: uma só nota, compartilhada por todas as vendas dele. */}
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
                <span className="text-xs text-gray-500">Vale para todas as vendas deste cliente.</span>
              </div>
            </div>

            {/* Resumo consolidado (situação atual): itens ainda em aberto, líquidos de devolução,
                somados por produto. Fica ACIMA do extrato — que segue mostrando tudo em ordem. */}
            {(detail.openItems ?? []).length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Itens em aberto (consolidado)</h3>
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {(detail.openItems ?? []).map((it, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-gray-700">
                        {Number(it.quantity)}× {it.productName}
                      </span>
                      <span className="shrink-0 tabular-nums text-gray-600">{BRL(it.total)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-gray-500">
                  Soma o que ainda está em aberto, já descontadas as devoluções.
                </p>
              </div>
            )}

            {/* Extrato/timeline: vendas (com itens) e recebimentos, em ordem, com saldo corrente. */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Atividades</h3>
              {timeline.length === 0 ? (
                <p className="text-sm text-gray-600">Nenhuma atividade nesta conta.</p>
              ) : (
                <ul className="space-y-2">
                  {timeline.map((e, idx) => (
                    <li key={idx} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {e.kind === 'sale' ? (
                              <>
                                Venda a prazo
                                <span className="ml-1 font-normal text-gray-500">
                                  · {e.items.length} {e.items.length === 1 ? 'item' : 'itens'} ·{' '}
                                  {saleCode(e.orderNumber, e.orderId)}
                                </span>
                                {e.paid && (
                                  <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                    Quitada
                                  </span>
                                )}
                              </>
                            ) : e.kind === 'return' ? (
                              <>
                                Devolução
                                <span className="ml-1 font-normal text-gray-500">
                                  · {e.items.length} {e.items.length === 1 ? 'item' : 'itens'}
                                  {e.by ? ` · ${e.by}` : ''}
                                </span>
                              </>
                            ) : e.kind === 'credit' ? (
                              <>
                                {e.origin === 'SALE_USE'
                                  ? 'Crédito usado'
                                  : e.origin === 'RETURN'
                                    ? 'Crédito gerado'
                                    : e.origin === 'SALE_REVERSAL'
                                      ? 'Crédito estornado'
                                      : e.amount < 0
                                        ? 'Crédito usado'
                                        : 'Crédito a favor'}
                                <span className="ml-1 font-normal text-gray-500">
                                  {e.relatedOrderId
                                    ? ` · ${saleCode(e.relatedOrderNumber, e.relatedOrderId)}`
                                    : ''}
                                  {e.by ? ` · ${e.by}` : ''}
                                </span>
                              </>
                            ) : (
                              <>
                                Recebimento
                                <span className="ml-1 font-normal text-gray-500">
                                  · {PAYMENT_METHOD_LABELS[e.method as PaymentMethod] ?? e.method}
                                  {e.by ? ` · ${e.by}` : ''}
                                </span>
                              </>
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(e.at).toLocaleString('pt-BR')}
                          </p>
                          {e.kind === 'return' && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              Motivo: {e.reason}
                              {/* Crédito gerado vira evento próprio "Crédito gerado"; aqui só o troco
                                  em dinheiro (que não entra no livro-razão do crédito). */}
                              {e.excess > 0 && e.target === 'CASH'
                                ? ` · excedente ${BRL(e.excess)} → ${RETURN_TARGET_LABELS.CASH}`
                                : ''}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={`font-semibold tabular-nums ${
                              e.kind === 'sale'
                                ? 'text-gray-800'
                                : e.kind === 'return'
                                  ? 'text-amber-700'
                                  : e.kind === 'credit'
                                    ? 'text-indigo-600'
                                    : 'text-green-700'
                            }`}
                          >
                            {e.kind === 'sale' ? '+' : e.kind === 'credit' ? (e.amount < 0 ? '−' : '+') : '−'}
                            {BRL(Math.abs(e.amount))}
                          </p>
                          {/* Crédito não mexe no saldo DEVEDOR (é um saldo à parte, no topo). */}
                          {e.kind === 'credit' ? (
                            <p className="text-xs text-indigo-500">crédito</p>
                          ) : (
                            <p className="text-xs text-gray-500 tabular-nums">saldo {BRL(e.running)}</p>
                          )}
                        </div>
                      </div>

                      {/* Itens da venda (aparecem sob o evento — "todos os itens" da conta). */}
                      {e.kind === 'sale' && e.items.length > 0 && (
                        <ul className="mt-2 divide-y divide-gray-50 rounded-lg bg-gray-50/60">
                          {e.items.map((it, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between px-3 py-1.5 text-sm"
                            >
                              <span className="min-w-0 truncate text-gray-700">
                                {Number(it.quantity)}× {it.productName}
                              </span>
                              <span className="shrink-0 tabular-nums text-gray-600">
                                {BRL(it.total)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Itens que voltaram na devolução (evento próprio — não muta a venda). */}
                      {e.kind === 'return' && e.items.length > 0 && (
                        <ul className="mt-2 divide-y divide-amber-100 rounded-lg bg-amber-50/60">
                          {e.items.map((it, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between px-3 py-1.5 text-sm"
                            >
                              <span className="min-w-0 truncate text-amber-800">
                                {Number(it.quantity)}× {it.productName}
                              </span>
                              <span className="shrink-0 tabular-nums text-amber-700">
                                −{BRL(it.total)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-gray-500">
                A mercadoria sai na venda (o fiado adia o pagamento, não a entrega). Para levar mais
                itens, use “+ Adicionar itens”.
              </p>
            </div>

            {/* Documento imprimível da conta (oculto na tela; só aparece na impressão). */}
            <CustomerAccountPrint store={store} detail={detail} />
          </>
        )}
      </div>
    </div>
  );
}
