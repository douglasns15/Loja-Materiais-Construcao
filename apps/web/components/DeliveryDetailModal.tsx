'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatOrderNumber,
  formatDateBr,
  formatPhoneBr,
  DELIVERY_FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_TYPE_LABELS,
  unitTypeLabels,
  type DeliveryDetail,
  type EmployeeRow,
  type UnitType,
} from '@nexoloja/shared';
import { isValidDelivery } from '@nexoloja/core';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { printArea } from '@/lib/print';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';
import { OrderSummaryModal } from '@/components/OrderSummaryModal';
import {
  EMPTY_SCHEDULE,
  localDateTimeIso,
  ScheduleStep,
  todayLocal,
  type ScheduleValue,
} from '@/components/ScheduleStep';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR');
// Previsão de retirada é data-only (meia-noite UTC, ADR-020): formata em UTC (`formatDateBr`) para
// não voltar um dia no fuso do navegador — mesma correção do vencimento (dueDate).
const dateOnly = (iso: string) => formatDateBr(iso);

/**
 * Previsão do pedido. Agendamento com faixa (ADR-042, tem `scheduledUntil`) guarda o instante real →
 * dia e horas no fuso do aparelho ("01/10 · 13:30–14:00"). Sem faixa é a data pura de sempre
 * (meia-noite UTC → `formatDateBr`, sem deslocar o dia).
 */
function scheduleLabel(start: string, until?: string | null): string {
  if (!until) return dateOnly(start);
  const s = new Date(start);
  const e = new Date(until);
  const hm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${s.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${hm(s)}–${hm(e)}`;
}

const unitLabel = (u: string) => unitTypeLabels[u as UnitType] ?? u;

/** Formata uma quantidade em unidade-base sem casas inúteis (200 em vez de 200,0000). */
const qty = (v: string | number) => {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
};

/**
 * O log grava em UNIDADE-BASE (1,2 kg), mas o item mostra a unidade VENDIDA (1 Unidade do "vendido
 * inteiro", ADR-040 §4; 2 rolos = 200 m, ADR-013). Converte para a unidade vendida pela proporção da
 * linha — sem isso o histórico dizia "1.2 Unidade (un)".
 */
function soldQtyOf(item: { quantity: string; baseQuantity: string | null } | undefined, baseQty: number): number {
  if (!item?.baseQuantity) return baseQty;
  const base = Number(item.baseQuantity);
  const sold = Number(item.quantity);
  return base > 0 && sold > 0 ? Number(((baseQty * sold) / base).toFixed(4)) : baseQty;
}

/** Compara duas quantidades na precisão do estoque (4 casas), sem ruído de ponto flutuante. */
const sameQty = (a: number, b: number) => Math.round(a * 10000) === Math.round(b * 10000);

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
  // Resumo da venda: aberto ao clicar no código da venda no cabeçalho (mesmas infos do Histórico).
  const [showSaleSummary, setShowSaleSummary] = useState(false);

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

  // Entrega pela loja (ADR-042): entregadores ativos (para trocar/escolher) e "Saiu para entrega".
  const [couriers, setCouriers] = useState<EmployeeRow[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const isDelivery = detail?.fulfillmentType === 'DELIVERY';
  useEffect(() => {
    if (!isDelivery) return;
    apiGet<EmployeeRow[]>('/employees?activeOnly=true')
      .then((rows) => setCouriers(rows.filter((r) => r.role === 'COURIER')))
      .catch(() => {});
  }, [isDelivery]);

  /** "Saiu para entrega" (baixa o estoque e conclui — ADR-042 rev. 2026-10-02) e/ou troca o entregador.
   *  Em "Data por item", `day` limita a saída aos itens daquele dia. */
  async function dispatch(body: { dispatched?: true; day?: string; courierId?: string | null }) {
    setDispatching(true);
    setError(null);
    try {
      await apiPost(`/deliveries/${orderId}/dispatch`, body);
      await load();
      onDelivered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDispatching(false);
    }
  }

  // "Voltou / não entregue": painel com Reagendar (mercadoria volta reservada, nova data/faixa) ou
  // Cancelar a venda (cancelamento de sempre no Histórico — devolve ao estoque o que tinha saído).
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [resched, setResched] = useState<ScheduleValue>(EMPTY_SCHEDULE);
  const [returnNote, setReturnNote] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);

  async function confirmReturn() {
    if (!detail) return;
    if (!resched.date) {
      setError('Escolha o novo dia da entrega.');
      return;
    }
    setReturnBusy(true);
    setError(null);
    try {
      const withSlot = !detail.perItemSchedule && resched.start && resched.end;
      await apiPost(`/deliveries/${orderId}/return-from-route`, {
        date: resched.date,
        ...(withSlot
          ? {
              start: localDateTimeIso(resched.date, resched.start),
              end: localDateTimeIso(resched.date, resched.end),
            }
          : {}),
        ...(returnNote.trim() ? { notes: returnNote.trim() } : {}),
      });
      setReturning(false);
      setResched(EMPTY_SCHEDULE);
      setReturnNote('');
      await load();
      onDelivered();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReturnBusy(false);
    }
  }

  /** Leva ao Histórico já com a venda buscada, onde fica o cancelamento (motivo, estorno, defeito). */
  function goCancel() {
    if (!detail) return;
    onClose();
    router.push(`/vendas?codigo=${encodeURIComponent(formatOrderNumber(detail.orderNumber))}`);
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

  /** Retira DE UMA VEZ as quantidades informadas em cada linha pendente (campo > 0). Permite a
   *  retirada parcial de vários itens num só clique (item A 2 + item B 1). Linhas com campo vazio/0
   *  ficam de fora (dá pra retirar só algumas). Valida cada quantidade contra o que falta pela fonte
   *  única do core (`isValidDelivery`). Como o campo já vem pré-preenchido com o que falta, sem
   *  nenhuma edição isto retira 100% — é o antigo "Retirar tudo o que falta". */
  function deliverDraft() {
    if (!detail) return;
    const items: { orderItemId: string; quantity: number }[] = [];
    for (const it of detail.items) {
      if (it.remainingBaseQty <= 0) continue;
      const q = Number(draft[it.id]);
      if (!(q > 0)) continue; // linha não marcada para esta retirada
      if (!isValidDelivery(q, it.remainingBaseQty)) {
        setError(`Quantidade inválida para "${it.productName}" (falta ${qty(it.remainingBaseQty)}).`);
        return;
      }
      items.push({ orderItemId: it.id, quantity: q });
    }
    if (items.length === 0) {
      setError('Informe a quantidade a retirar em ao menos um item.');
      return;
    }
    void deliver(items);
  }

  const pendingItems = detail?.items.filter((it) => it.remainingBaseQty > 0) ?? [];
  const anyPending = pendingItems.length > 0;
  // Há ao menos um item com quantidade informada (campo > 0) — habilita a retirada em lote.
  const anyDraft = pendingItems.some((it) => Number(draft[it.id]) > 0);
  // Sem edição para baixo, o lote equivale ao antigo "tudo o que falta" (rótulo adaptativo do botão).
  const isFullWithdrawal = pendingItems.every((it) => sameQty(Number(draft[it.id]), it.remainingBaseQty));
  // Entrega: um "Saiu p/ entrega" por dia com mercadoria pendente em "Data por item" ('' = sem data /
  // pedido com data única — sai tudo o que falta).
  const dayOf = (it: { scheduledPickupAt?: string | null }) =>
    detail?.perItemSchedule ? (it.scheduledPickupAt?.slice(0, 10) ?? '') : '';
  const pendingDays = Array.from(new Set(pendingItems.map(dayOf))).sort();
  // "Data por item": itens ordenados e agrupados por data no quadro (discriminação pedida pelo Owner).
  const shownItems = detail
    ? detail.perItemSchedule
      ? [...detail.items].sort((a, b) => (a.scheduledPickupAt ?? '9').localeCompare(b.scheduledPickupAt ?? '9'))
      : detail.items
    : [];

  return (
    <>
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
                  {/* Código da venda (ADR-023): identifica qual venda gerou esta retirada. Clicável —
                      abre o resumo da venda (mesmas infos do Histórico), por cima deste painel. */}
                  <button
                    type="button"
                    onClick={() => setShowSaleSummary(true)}
                    className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold tabular-nums underline decoration-white/50 underline-offset-2 hover:bg-white/30"
                    title="Ver resumo da venda"
                  >
                    {formatOrderNumber(detail.orderNumber)}
                  </button>
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
                    {(detail.fulfillmentType === 'DELIVERY'
                      ? DELIVERY_FULFILLMENT_STATUS_LABELS
                      : FULFILLMENT_STATUS_LABELS)[detail.fulfillmentStatus]}
                  </span>
                  {!detail.perItemSchedule && detail.scheduledPickupAt && (
                    <span className="ml-2 text-xs text-indigo-100">
                      {detail.fulfillmentType ? FULFILLMENT_TYPE_LABELS[detail.fulfillmentType] : 'Previsão'}:{' '}
                      {scheduleLabel(detail.scheduledPickupAt, detail.scheduledUntil)}
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

            {/* Entrega pela loja (ADR-042): endereço (snapshot da venda), telefone do cliente e entregador. */}
            {detail.fulfillmentType === 'DELIVERY' && (
              <div className="mb-4 grid gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-indigo-900">Entrega</span>
                  {detail.dispatchedAt ? (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
                      Saiu às{' '}
                      {new Date(detail.dispatchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {detail.fulfillmentStatus === 'COMPLETED' ? ' · concluída' : ''}
                    </span>
                  ) : null}
                </div>
                <span className="text-gray-700">{detail.deliveryAddress ?? '—'}</span>
                {detail.customer?.phone && (
                  <span className="text-gray-600">Telefone: {formatPhoneBr(detail.customer.phone)}</span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="dd-courier" className="text-gray-600">
                    Entregador:
                  </label>
                  <select
                    id="dd-courier"
                    value={detail.courier?.id ?? ''}
                    onChange={(e) => dispatch({ courierId: e.target.value || null })}
                    disabled={dispatching}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="">— a definir —</option>
                    {/* Mantém visível o entregador atual mesmo se foi desativado depois. */}
                    {detail.courier && !couriers.some((c) => c.id === detail.courier!.id) && (
                      <option value={detail.courier.id}>{detail.courier.name}</option>
                    )}
                    {couriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {pendingDays.map((d) => (
                    <button
                      key={d || 'all'}
                      type="button"
                      onClick={() => dispatch(d ? { dispatched: true, day: d } : { dispatched: true })}
                      disabled={dispatching || returnBusy}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {dispatching
                        ? 'Registrando…'
                        : d
                          ? `Saiu para entrega — itens de ${dateOnly(`${d}T00:00:00.000Z`)}`
                          : 'Saiu para entrega'}
                    </button>
                  ))}
                  {detail.dispatchedAt && !returning && (
                    <button
                      type="button"
                      onClick={() => {
                        setReturning(true);
                        setResched({ ...EMPTY_SCHEDULE, date: todayLocal() });
                      }}
                      disabled={dispatching}
                      className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                    >
                      Voltou / não entregue
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  “Saiu para entrega” dá baixa no estoque e conclui a entrega. Se o entregador voltar com a
                  mercadoria, use “Voltou / não entregue” para reagendar ou cancelar.
                </p>

                {/* Voltou / não entregue: reagendar (mercadoria volta reservada) ou cancelar a venda. */}
                {returning && (
                  <div className="mt-1 space-y-3 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-amber-900">A entrega não aconteceu</p>
                      <button
                        type="button"
                        onClick={() => setReturning(false)}
                        className="text-xs text-gray-500 hover:text-gray-800"
                      >
                        Fechar
                      </button>
                    </div>
                    <p className="text-xs text-amber-900">
                      <strong>Reagendar:</strong> a mercadoria volta ao estoque reservada para este pedido e ele
                      volta para a agenda na nova data.
                    </p>
                    {detail.perItemSchedule ? (
                      <label className="block text-xs font-medium text-gray-600">
                        Nova data dos itens que voltaram
                        <input
                          id="dd-resched-date"
                          type="date"
                          value={resched.date}
                          min={todayLocal()}
                          onChange={(e) => setResched({ ...resched, date: e.target.value })}
                          className="mt-1 block w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    ) : (
                      <ScheduleStep
                        type="DELIVERY"
                        value={resched}
                        onChange={setResched}
                        customerId=""
                        customerName=""
                        perItemSchedule={false}
                        slotOnly
                      />
                    )}
                    <input
                      value={returnNote}
                      onChange={(e) => setReturnNote(e.target.value)}
                      maxLength={200}
                      placeholder="Motivo (opcional) — ex.: cliente não estava em casa"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={goCancel}
                        className="text-xs font-medium text-red-700 hover:underline"
                      >
                        Cancelar a venda (abre no Histórico)
                      </button>
                      <button
                        type="button"
                        onClick={confirmReturn}
                        disabled={returnBusy || !resched.date}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {returnBusy ? 'Reagendando…' : 'Reagendar entrega'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
                    {/* Entrega: a saída é pelo "Saiu para entrega" (acima), não item a item. */}
                    {!isDelivery && <th className="px-3 py-2 text-right">Retirar agora</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownItems.map((it, idx) => {
                    const remaining = it.remainingBaseQty;
                    const done = remaining <= 0;
                    const groupDay = dayOf(it);
                    const newGroup = detail.perItemSchedule && (idx === 0 || dayOf(shownItems[idx - 1]!) !== groupDay);
                    return (
                      <Fragment key={it.id}>
                      {newGroup && (
                        <tr className="bg-indigo-50/60">
                          <td colSpan={isDelivery ? 2 : 3} className="px-3 py-1.5 text-xs font-semibold text-indigo-800">
                            {groupDay
                              ? `${isDelivery ? 'Entrega' : 'Retirada'} em ${dateOnly(`${groupDay}T00:00:00.000Z`)}`
                              : 'Sem data definida'}
                          </td>
                        </tr>
                      )}
                      <tr className="border-b border-gray-50 align-middle">
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{it.productName}</div>
                          <div className="text-xs text-gray-500">
                            Vendido: {qty(it.quantity)} {unitLabel(it.unit)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {done ? (
                            <span className="text-xs font-medium text-green-700">{isDelivery ? 'saiu' : 'retirado'}</span>
                          ) : (
                            qty(remaining)
                          )}
                        </td>
                        {!isDelivery && (
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
                        )}
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {anyPending && !isDelivery && (
              <div className="mt-3 space-y-2">
                {/* Dica: quando há mais de um item pendente, o operador pode ajustar a quantidade de
                    cada linha acima e retirar TODOS de uma vez neste botão (não precisa item a item). */}
                {pendingItems.length > 1 && (
                  <p className="text-xs text-gray-500">
                    Ajuste a quantidade de cada item acima e retire todos de uma vez — ou use o
                    <span className="font-medium text-emerald-700"> Retirar</span> ao lado para um item só.
                  </p>
                )}
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observação da retirada (opcional)…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !anyDraft}
                  onClick={deliverDraft}
                  className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy
                    ? 'Registrando…'
                    : isFullWithdrawal
                      ? 'Retirar tudo o que falta'
                      : 'Retirar itens informados'}
                </button>
              </div>
            )}

            {/* Log de retiradas (o "lastro"): cada saída com data, quantidade e autor. */}
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {isDelivery ? 'Histórico de saídas' : 'Histórico de retiradas'}
              </h3>
              {detail.itemDeliveries.length === 0 ? (
                <p className="text-sm text-gray-500">{isDelivery ? 'Nada saiu ainda.' : 'Nada retirado ainda.'}</p>
              ) : (
                <ul className="space-y-1">
                  {detail.itemDeliveries.map((log) => {
                    const item = detail.items.find((it) => it.id === log.orderItemId);
                    // Linha negativa = a mercadoria voltou ("Voltou / não entregue").
                    const back = Number(log.quantity) < 0;
                    return (
                      <li
                        key={log.id}
                        className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                          back ? 'bg-amber-50' : 'bg-gray-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`truncate font-medium ${back ? 'text-amber-900' : 'text-gray-800'}`}>
                            {back ? '↩ ' : ''}
                            {item?.productName ?? 'Item'} · {qty(soldQtyOf(item, Math.abs(Number(log.quantity))))}
                            {item ? ` ${unitLabel(item.unit)}` : ''}
                            {back ? ' voltou ao estoque' : ''}
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

    {/* Resumo da venda por cima do painel de entrega — abre ao clicar no código da venda. */}
    {showSaleSummary && detail && (
      <OrderSummaryModal
        code={formatOrderNumber(detail.orderNumber)}
        onClose={() => setShowSaleSummary(false)}
      />
    )}
    </>
  );
}
