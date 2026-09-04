'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatOrderNumber,
  formatDeliveryNumber,
  formatDateBr,
  isDatePast,
  FULFILLMENT_STATUS_LABELS,
  type DeliveriesPage,
  type DeliveryCard,
  type DeliveryAccountSummary,
  type DeliveryDetail,
  type DeliveryOrderRow,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { printArea } from '@/lib/print';
import { OfflineNotice } from '@/components/OfflineNotice';
import { DeliveryDetailModal } from '@/components/DeliveryDetailModal';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

/** Comprovante CONSOLIDADO de uma conta (ADR-028): dados já montados para o ReceiptPrint. */
type AccountPrintJob = {
  key: number;
  code: string; // E-0001
  customerName: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
  discount: number;
  pickupPaid: boolean;
  pickupLines: { name: string; delivered: number; remaining: number }[];
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type StatusFilter = 'pending' | 'completed' | 'all';

/** Uma previsão está atrasada quando já passou e ainda há item a retirar. A previsão é uma data-only
 *  guardada em meia-noite UTC (ADR-020); comparar no fuso do navegador voltava um dia (a de HOJE
 *  aparecia "atrasada"). `isDatePast` compara só o DIA, em UTC — mesma correção do vencimento (dueDate). */
function isLate(scheduledPickupAt: string | null, itemsPending: number): boolean {
  if (!scheduledPickupAt || itemsPending === 0) return false;
  return isDatePast(scheduledPickupAt);
}

/** Selo de progresso da venda (A retirar / Parcial / Finalizada). */
function fulfillmentBadge(status: DeliveryOrderRow['fulfillmentStatus']) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'COMPLETED'
          ? 'bg-green-100 text-green-800'
          : status === 'PARTIAL'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-indigo-100 text-indigo-800'
      }`}
    >
      {FULFILLMENT_STATUS_LABELS[status]}
    </span>
  );
}

/** Célula "Previsão" de uma venda: data (em UTC, `formatDateBr`), "por item" ou "—". */
function PickupHint({ order }: { order: DeliveryOrderRow }) {
  const late = isLate(order.scheduledPickupAt, order.itemsPending);
  if (order.perItemSchedule) return <span className="text-xs text-gray-500">previsão por item</span>;
  if (!order.scheduledPickupAt) return <span className="text-gray-400">—</span>;
  return (
    <span className={late ? 'font-medium text-red-600' : 'text-gray-600'}>
      {formatDateBr(order.scheduledPickupAt)}
      {late ? ' · atrasada' : ''}
    </span>
  );
}

/** Uma linha do extrato: a venda (V-000XXX) dentro de uma conta, clicável para abrir o detalhe. */
function SaleRow({ order, onOpen }: { order: DeliveryOrderRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-600">
            {formatOrderNumber(order.orderNumber)}
          </span>
          {fulfillmentBadge(order.fulfillmentStatus)}
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {new Date(order.createdAt).toLocaleDateString('pt-BR')} · <PickupHint order={order} />
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tabular-nums text-gray-900">{BRL(order.total)}</div>
        <div className="text-xs tabular-nums text-gray-500">
          {order.itemsPending} / {order.itemsCount} a retirar
        </div>
      </div>
    </button>
  );
}

/** Card de uma CONTA de retiradas (E-0001): cabeçalho com cliente + agregado e o extrato das vendas. */
function AccountCard({
  account,
  expanded,
  onToggle,
  onOpenOrder,
  onPrint,
  printing,
}: {
  account: DeliveryAccountSummary;
  expanded: boolean;
  onToggle: () => void;
  onOpenOrder: (orderId: string) => void;
  onPrint: () => void;
  printing: boolean;
}) {
  const late = isLate(account.nextPickupAt, account.itemsPending);
  const done = account.itemsPending === 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
      {/* Cabeçalho da conta: clique expande/recolhe o extrato. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gradient-to-r from-indigo-700 to-indigo-500 px-2.5 py-0.5 text-xs font-extrabold tracking-wide text-white">
              {formatDeliveryNumber(account.accountNumber)}
            </span>
            <span className="font-semibold text-indigo-700">{account.customerName}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>
              {account.ordersCount} venda{account.ordersCount > 1 ? 's' : ''}
            </span>
            {done ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">Finalizada</span>
            ) : (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  late ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {account.itemsPending} {account.itemsPending === 1 ? 'item' : 'itens'} a retirar
              </span>
            )}
            {!done && account.nextPickupAt && (
              <span className={late ? 'font-medium text-red-600' : ''}>
                previsão {formatDateBr(account.nextPickupAt)}
                {late ? ' · atrasada' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums">{BRL(account.total)}</div>
          </div>
          <svg
            className={`h-5 w-5 text-gray-400 transition ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Extrato: as vendas da conta. Clicar numa venda abre o detalhe (dar baixa / log). */}
      {expanded && (
        <div className="space-y-1 border-t border-gray-100 bg-gray-50/50 p-2">
          {account.orders.map((o) => (
            <div key={o.id} className="rounded-lg bg-white">
              <SaleRow order={o} onOpen={() => onOpenOrder(o.id)} />
            </div>
          ))}
          {/* Comprovante ÚNICO da conta (ADR-028): junta os itens de TODAS as vendas num só cupom.
              Só faz sentido quando há mais de uma retirada (senão a nota da própria venda basta). */}
          {account.ordersCount > 1 && (
            <div className="px-1 pt-1">
              <button
                type="button"
                onClick={onPrint}
                disabled={printing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9V2h12v7" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <path d="M6 14h12v8H6z" />
                </svg>
                {printing ? 'Gerando…' : 'Comprovante da conta (todas as retiradas)'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Card de uma venda AVULSA (SCHEDULED sem cliente): não entra em conta; abre o detalhe direto. */
function OrderCard({ order, onOpen }: { order: DeliveryOrderRow; onOpen: () => void }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-md">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-600">
              {formatOrderNumber(order.orderNumber)}
            </span>
            <span className="font-medium text-gray-600">Cliente não informado</span>
            {fulfillmentBadge(order.fulfillmentStatus)}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">
            {new Date(order.createdAt).toLocaleDateString('pt-BR')} · <PickupHint order={order} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-bold tabular-nums">{BRL(order.total)}</div>
          <div className="text-xs tabular-nums text-gray-500">
            {order.itemsPending} / {order.itemsCount} a retirar
          </div>
        </div>
      </button>
    </div>
  );
}

/**
 * Entregas / Retiradas (ADR-020 + ADR-028). As vendas com retirada/entrega posterior de um mesmo
 * cliente são AGRUPADAS numa conta (`E-0001`) — o card mostra o extrato das vendas; retirar tudo
 * finaliza a conta e uma nova venda pra retirar reabre outra. Vendas SCHEDULED sem cliente ficam
 * como card avulso. Filtro de situação (a retirar / finalizadas / todas), paginação por cursor.
 * Clicar numa venda abre o detalhe com o LOG completo e permite dar baixa. Online-only.
 */
export default function EntregasPage() {
  const [cards, setCards] = useState<DeliveryCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Falha na CARGA da lista (≠ erro de ação/impressão): liga a auto-recuperação (ADR-005).
  const [loadFailed, setLoadFailed] = useState(false);

  const [status, setStatus] = useState<StatusFilter>('pending');
  // Busca por código (conta E-000X ou venda V-000XXX) ou por nome do cliente. `searchInput` = o que
  // está no campo; `search` = a busca APLICADA (o que a lista mostra). Busca varre todas as situações.
  const [searchType, setSearchType] = useState<'code' | 'customer'>('code');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<{ type: 'code' | 'customer'; term: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Contas recolhidas (por id). Default: expandidas — o operador vê o extrato de cara.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Comprovante consolidado da conta (ADR-028): cabeçalho da loja + modelo de papel + job de impressão.
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');
  const [printJob, setPrintJob] = useState<AccountPrintJob | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Cabeçalho da loja para o comprovante (uma vez).
  useEffect(() => {
    apiGet<Store>('/tenant').then(setStore).catch(() => {});
  }, []);

  /** Monta e imprime o comprovante ÚNICO da conta: busca o detalhe de cada venda (itens completos),
   *  junta tudo num só cupom (código E-000X, faixa "FALTA RETIRAR", progresso por item). */
  async function imprimirConta(account: DeliveryAccountSummary) {
    setPrintingId(account.id);
    setError(null);
    try {
      const details = await Promise.all(
        account.orders.map((o) => apiGet<DeliveryDetail>(`/deliveries/${o.id}`)),
      );
      const items: AccountPrintJob['items'] = [];
      const pickupLines: AccountPrintJob['pickupLines'] = [];
      let itemsSubtotal = 0;
      let outstanding = 0;
      for (const d of details) {
        outstanding += d.outstandingBalance;
        for (const it of d.items) {
          const q = Number(it.quantity);
          const up = Number(it.unitPrice);
          items.push({ name: it.productName, quantity: q, unitPrice: up });
          itemsSubtotal += q * up;
          pickupLines.push({
            name: it.productName,
            delivered: Number(it.deliveredBaseQty),
            remaining: it.remainingBaseQty,
          });
        }
      }
      const total = Number(account.total);
      // Desconto agregado = subtotal dos itens − total da conta (mantém subtotal − desconto = total).
      const discount = Math.max(0, Number((itemsSubtotal - total).toFixed(2)));
      setPrintJob({
        key: Date.now(),
        code: formatDeliveryNumber(account.accountNumber),
        customerName: account.customerName,
        items,
        total,
        discount,
        pickupPaid: outstanding <= 0,
        pickupLines,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrintingId(null);
    }
  }

  // Depois que o cupom consolidado entra no DOM (#print-area), dispara o diálogo de impressão.
  useEffect(() => {
    if (!printJob) return;
    printArea({ model: printModel, logoUrl: store?.logoUrl, fileName: printJob.code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  function toggleAccount(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Aplica a busca (recarrega via effect, pois `query` depende de `search`). Campo vazio limpa. */
  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const term = searchInput.trim();
    setSearch(term ? { type: searchType, term } : null);
    setCollapsed(new Set()); // expande tudo para os resultados aparecerem
  }
  function limparBusca() {
    setSearchInput('');
    setSearch(null);
  }

  const query = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams({ status });
      if (search) p.set(search.type === 'code' ? 'code' : 'customer', search.term);
      if (cursor) p.set('cursor', cursor);
      return `/deliveries?${p.toString()}`;
    },
    [status, search],
  );

  const load = useCallback(async () => {
    try {
      const page = await apiGet<DeliveriesPage>(query(null));
      setCards(page.cards);
      setNextCursor(page.nextCursor);
      setError(null);
      setLoadFailed(false);
    } catch (e) {
      setError((e as Error).message);
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [query]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
    }
    load();
  }, [load]);

  // Auto-recuperação (ADR-005): se a carga da lista falhar por um soluço transitório, re-tenta sozinha.
  useReloadOnReconnect(load, loadFailed);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<DeliveriesPage>(query(nextCursor));
      setCards((prev) => [...prev, ...page.cards]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
          Entregas / Retiradas
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Modelo de impressão:</span>
          <select
            value={printModel}
            onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <option value="80mm">Térmica 80mm</option>
            <option value="A4">A4</option>
          </select>
        </div>
      </div>
      <p className="mb-5 text-sm text-gray-500">
        Vendas com retirada ou entrega posterior, <strong>agrupadas por cliente</strong> — acompanhe o
        que já saiu, o que falta e dê baixa.
      </p>

      <OfflineNotice />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Filtro de situação (controle segmentado — identidade das telas repaginadas). */}
      <div className="mb-4 inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
        {(['pending', 'completed', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
              status === s ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
            }`}
          >
            {s === 'pending' ? 'A retirar' : s === 'completed' ? 'Finalizadas' : 'Todas'}
          </button>
        ))}
      </div>

      {/* Busca por código (conta E-0001 ou venda V-000XXX) ou por nome do cliente. Varre todas as
          situações (ignora a aba), como no Histórico. */}
      <form onSubmit={buscar} className="mb-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-md">
        <div className="mb-2 inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
          {(['code', 'customer'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSearchType(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                searchType === t ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
              }`}
            >
              {t === 'code' ? 'Código' : 'Cliente'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchType === 'code' ? 'Ex.: E-0001, V-000128 ou 128' : 'Ex.: João Silva'}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Buscar
          </button>
          {search && (
            <button
              type="button"
              onClick={limparBusca}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Limpar busca
            </button>
          )}
        </div>
        {search && (
          <p className="mt-2 text-xs text-gray-500">
            {search.type === 'code' ? (
              <>Buscando pelo código <strong>{search.term}</strong> (em todas as situações).</>
            ) : (
              <>Buscando pelo cliente <strong>{search.term}</strong> (contas de retirada, em todas as situações).</>
            )}
          </p>
        )}
      </form>

      {!loaded ? (
        <p className="text-gray-600">Carregando…</p>
      ) : cards.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">
          {search
            ? 'Nenhuma retirada encontrada para a busca.'
            : status === 'pending'
              ? 'Nenhuma retirada pendente. As vendas com retirada/entrega posterior aparecem aqui.'
              : 'Nenhum pedido nesta situação.'}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {cards.map((card) =>
              card.kind === 'account' ? (
                <AccountCard
                  key={`a-${card.account.id}`}
                  account={card.account}
                  expanded={!collapsed.has(card.account.id)}
                  onToggle={() => toggleAccount(card.account.id)}
                  onOpenOrder={setDetailId}
                  onPrint={() => imprimirConta(card.account)}
                  printing={printingId === card.account.id}
                />
              ) : (
                <OrderCard
                  key={`o-${card.order.id}`}
                  order={card.order}
                  onOpen={() => setDetailId(card.order.id)}
                />
              ),
            )}
          </div>

          {nextCursor && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? 'Carregando…' : 'Mostrar mais'}
              </button>
            </div>
          )}
        </>
      )}

      {detailId && (
        <DeliveryDetailModal orderId={detailId} onClose={() => setDetailId(null)} onDelivered={load} />
      )}

      {/* Comprovante CONSOLIDADO da conta (ADR-028): oculto na tela, aparece só na impressão. Junta os
          itens de todas as vendas da conta num só cupom, com o código E-000X e a faixa de retirada. */}
      {printJob && (
        <ReceiptPrint
          kind="sale"
          store={store}
          codeLabel={printJob.code}
          customerName={printJob.customerName}
          items={printJob.items}
          total={printJob.total}
          discount={printJob.discount}
          date={new Date().toLocaleString('pt-BR')}
          pickupNotice
          pickupPaid={printJob.pickupPaid}
          pickupLines={printJob.pickupLines}
        />
      )}
    </div>
  );
}
