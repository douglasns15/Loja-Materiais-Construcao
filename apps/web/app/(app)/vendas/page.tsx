'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  formatOrderNumber,
  paymentMethodLabel,
  cancelOrderSchema,
  returnOrderSchema,
  type PartialReturnResult,
} from '@nexoloja/shared';
import { groupPairedItems } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { printArea } from '@/lib/print';
import { PeriodFilter, defaultRange } from '@/components/PeriodFilter';
import { OfflineNotice } from '@/components/OfflineNotice';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';
import { ReturnItemsModal } from '@/components/ReturnItemsModal';

type OrderItem = {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  total: string;
  /** Agrupamento do par (ADR-015): os dois itens viram uma linha só na exibição. */
  pairGroup: number | null;
  // Devolução por item (ADR-022): base e já-devolvido, para a tela calcular o devolvível.
  baseQuantity?: string | null;
  returnedBaseQty?: string;
};
type Payment = { id: string; method: string; amount: string };
type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'INVOICED' | 'CANCELLED' | 'RETURNED';
type Order = {
  id: string;
  orderNumber: number; // ADR-023: código sequencial da venda (V-000128)
  status: OrderStatus;
  subtotal: string;
  discountAmount: string;
  total: string;
  // Troco (migration 0024). `null` = venda antiga sem o dado; vendas novas gravam 0 quando não há troco.
  changeAmount?: string | null;
  createdAt: string;
  registeredByName: string | null;
  customerId?: string | null;
  // Nome do cliente da venda (quando há um vinculado — fiado/crédito da loja/entrega futura). Vendas
  // de balcão à vista não têm cliente ⇒ `customer` vem null. Usado para exibir e casar a busca.
  customer?: { name: string } | null;
  // ADR-020: retirada futura (a devolução por item — ADR-022 — só vale para IMMEDIATE).
  deliveryMode?: 'IMMEDIATE' | 'SCHEDULED';
  cashSession: { id: string; closedAt: string | null } | null;
  items: OrderItem[];
  payments: Payment[];
  // Venda a prazo (ADR-019): presente quando a venda gerou uma conta a receber.
  receivable?: {
    originalAmount: string;
    settledAmount: string;
    returnedAmount?: string;
    status: 'OPEN' | 'PAID' | 'CANCELLED';
  } | null;
};

/** Ação em curso no modal: cancelamento (caixa aberto) ou devolução (caixa fechado). */
type ActionMode = 'cancel' | 'return';

/** Página do Histórico (paginação keyset no servidor): linhas + cursor da próxima página. */
type OrdersPage = { rows: Order[]; nextCursor: string | null };
/** Período aplicado à lista (AAAA-MM-DD; vazio = sem borda). */
type Range = { from: string; to: string };
/**
 * Ordenação do Histórico (aplicada no SERVIDOR pelo keyset — não só nas páginas já
 * carregadas). Trocar recarrega da 1ª página.
 */
type Sort = 'recent' | 'oldest' | 'highest' | 'lowest';
const SORT_LABELS: Record<Sort, string> = {
  recent: 'Data (mais recentes)',
  oldest: 'Data (mais antigas)',
  highest: 'Maior venda',
  lowest: 'Menor venda',
};

/** Quantas vendas por página / clique em "Mostrar mais". */
const PAGE_SIZE = 20;

/** Tipo de busca do Histórico: por código (V-000128), por cliente (nome) ou por valor (total exato). */
type SearchType = 'code' | 'customer' | 'value';
const SEARCH_LABELS: Record<SearchType, string> = {
  code: 'Código',
  customer: 'Cliente',
  value: 'Valor',
};
const SEARCH_PLACEHOLDERS: Record<SearchType, string> = {
  code: 'Ex.: V-000128 ou 128',
  customer: 'Ex.: João Silva',
  value: 'Ex.: 150,00',
};
/** Busca aplicada (o que a lista está mostrando). `null` = sem busca (lista por período). */
type Search = { type: SearchType; term: string };

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Monta a query de `GET /orders?scope=all` com cursor, período, ordenação e busca.
 *  Toda busca (código/cliente/valor) procura em TODO o histórico — o período é ignorado pelo
 *  servidor. Código casa o inteiro `orderNumber` (0 ou 1 venda); cliente casa por nome
 *  (unaccent+tokenizado, só vendas com cliente vinculado); valor casa o total exato. */
function ordersQuery(cursor: string | null, r: Range, sort: Sort, search: Search | null): string {
  const p = new URLSearchParams({ scope: 'all', limit: String(PAGE_SIZE) });
  if (cursor) p.set('cursor', cursor);
  const term = search?.term.trim() ?? '';
  if (search && term) {
    p.set(search.type === 'code' ? 'number' : search.type, term);
  } else {
    if (r.from) p.set('from', r.from);
    if (r.to) p.set('to', r.to);
  }
  if (sort !== 'recent') p.set('sort', sort); // `recent` é o default do servidor.
  return `/orders?${p.toString()}`;
}

/** Rótulo da forma de pagamento — inclui "Crédito da loja" (ADR-022, Fatia C), fora do enum. */
function methodLabel(m: string): string {
  return paymentMethodLabel(m);
}

export default function VendasPage() {
  const online = useOnline();
  const [ready, setReady] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Período aplicado à lista. Abre em "Hoje" (default das telas com filtro por data); a navegação
  // ‹ › do PeriodFilter percorre os dias e recarrega ao vivo.
  const [range, setRange] = useState<Range>(() => defaultRange());
  // Ordenação aplicada no servidor (default = mais recentes primeiro).
  const [sort, setSort] = useState<Sort>('recent');
  // Busca do Histórico (código/cliente/valor). `searchType` = o tipo escolhido no seletor;
  // `searchInput` = o que está no campo; `search` = a busca APLICADA (o que a lista mostra) ou
  // null. Busca no servidor, em todo o histórico (ignora o período).
  const [searchType, setSearchType] = useState<SearchType>('code');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<Search | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Modal de ação: qual venda e se é cancelamento ou devolução.
  const [action, setAction] = useState<{ id: string; mode: ActionMode } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Devolução POR ITEM (ADR-022): a venda cujo modal está aberto + mensagem de sucesso.
  const [returnOrder, setReturnOrder] = useState<Order | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');
  // Job de reimpressão: novo objeto a cada clique força o efeito a disparar de novo.
  const [printJob, setPrintJob] = useState<{ order: Order; key: number } | null>(null);
  // "Voltar ao topo": o scroll é do <main> do shell (overflow-y-auto), não da window.
  const rootRef = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);

  // Observa a rolagem do container de scroll (o <main> ancestral) e mostra o botão de
  // voltar ao topo depois de descer um pouco. O histórico pode ficar longo com "Mostrar mais".
  useEffect(() => {
    const scroller = rootRef.current?.closest('main');
    if (!scroller) return;
    const onScroll = () => setShowTop(scroller.scrollTop > 400);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [ready]);

  function voltarAoTopo() {
    rootRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // scope=all: histórico completo (inclui vendas de caixas já fechados), para
  // permitir a devolução de vendas fora do caixa aberto. Paginado por cursor: a 1ª
  // página substitui a lista; "Mostrar mais" anexa as seguintes.
  async function loadOrders(r: Range = range, s: Sort = sort, srch: Search | null = search) {
    const page = await apiGet<OrdersPage>(ordersQuery(null, r, s, srch));
    setOrders(page.rows);
    setNextCursor(page.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await apiGet<OrdersPage>(ordersQuery(nextCursor, range, sort, search));
      setOrders((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Troca a ordenação e recarrega da 1ª página (o cursor keyset é atrelado ao `sort`, então
   * a lista precisa reiniciar). Mantém o período em vigor.
   */
  function mudarOrdenacao(s: Sort) {
    if (s === sort) return;
    setSort(s);
    setError(null);
    loadOrders(range, s).catch((e) => setError((e as Error).message));
  }

  /** Troca o período (PeriodFilter) e recarrega a lista do início, mantendo ordenação e busca. */
  function onRangeChange(r: Range) {
    setRange(r);
    setError(null);
    loadOrders(r).catch((e) => setError((e as Error).message));
  }

  /** Aplica a busca (código/cliente/valor): recarrega do início varrendo todo o histórico (ignora o
   *  período). Campo vazio limpa a busca e volta à lista por período. */
  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const term = searchInput.trim();
    const next: Search | null = term ? { type: searchType, term } : null;
    setSearch(next);
    setError(null);
    loadOrders(range, sort, next).catch((err) => setError((err as Error).message));
  }
  /** Limpa a busca e volta à lista normal (com o período/ordenação em vigor). */
  function limparBusca() {
    setSearchInput('');
    setSearch(null);
    setError(null);
    loadOrders(range, sort, null).catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{ id: string } | null>('/cash-sessions/current');
        setOpenSessionId(session?.id ?? null);
        await loadOrders();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  /** Abre o diálogo de impressão. O PDF sai nomeado pelo código da venda (V-000128) em vez do
   *  genérico "NexoLoja.pdf". Ver lib/print.ts. */
  async function imprimir() {
    const fileName = printJob ? formatOrderNumber(printJob.order.orderNumber) : null;
    await printArea({ model: printModel, logoUrl: store?.logoUrl, fileName });
  }

  /** Reimprime o comprovante de uma venda já registrada. */
  function reimprimir(order: Order) {
    setPrintJob({ order, key: Date.now() });
  }

  // Após o ReceiptPrint do job entrar no DOM, dispara o diálogo de impressão.
  useEffect(() => {
    if (printJob) imprimir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  function abrirAcao(id: string, mode: ActionMode) {
    setError(null);
    setReason('');
    setAction({ id, mode });
  }

  function fecharAcao() {
    setAction(null);
    setReason('');
    setError(null);
  }

  async function confirmarAcao() {
    if (!action) return;
    const schema = action.mode === 'cancel' ? cancelOrderSchema : returnOrderSchema;
    const parsed = schema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setError(
        action.mode === 'cancel'
          ? 'Informe o motivo do cancelamento (mín. 3 caracteres).'
          : 'Informe o motivo da devolução (mín. 3 caracteres).',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = action.mode === 'cancel' ? 'cancel' : 'return';
      await apiPost(`/orders/${action.id}/${path}`, parsed.data);
      fecharAcao();
      await loadOrders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="text-gray-600">Carregando…</p>;

  const caixaOpen = !!openSessionId;

  return (
    <div ref={rootRef} className="mx-auto max-w-3xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Histórico de Vendas</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Modelo de impressão:</span>
          <select
            value={printModel}
            onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="80mm">Térmica 80mm</option>
            <option value="A4">A4</option>
          </select>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Vendas mais recentes. Reimprima o comprovante, <strong>cancele</strong> vendas do caixa
        aberto (estorna estoque e caixa) ou <strong>devolva</strong> vendas de caixas já fechados
        (repõe o estoque e lança a saída no caixa de hoje).
      </p>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      {/* Filtro de período (‹ Hoje › + atalhos + De/Até) — componente compartilhado. Abre em Hoje;
          a navegação percorre os dias. Bordas no fuso da loja (UTC-3), igual ao relatório. */}
      <PeriodFilter value={range} onChange={onRangeChange} className="mb-4" />

      {/* Ordenação + busca por código */}
      <div className="mb-4 rounded-2xl bg-white p-3 shadow-sm">
        {/* Ordenação — aplicada no servidor (não só nas páginas carregadas). */}
        <label className="flex flex-col text-xs text-gray-600">
          Ordenar por
          <select
            value={sort}
            onChange={(e) => mudarOrdenacao(e.target.value as Sort)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm sm:w-auto"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {/* Busca por código (V-000128), cliente (nome) ou valor (total exato). Procura todo o
            histórico, ignorando o período. O seletor troca o tipo; um campo só, adaptável. */}
        <form onSubmit={buscar} className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
          <label className="flex flex-col text-xs text-gray-600">
            Buscar por
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value as SearchType)}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              {(Object.keys(SEARCH_LABELS) as SearchType[]).map((t) => (
                <option key={t} value={t}>
                  {SEARCH_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col text-xs text-gray-600">
            <span className="invisible">.</span>
            <input
              type="text"
              inputMode={searchType === 'customer' ? 'text' : 'decimal'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={SEARCH_PLACEHOLDERS[searchType]}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
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
        </form>
        {search && (
          <p className="mt-2 text-xs text-gray-600">
            {search.type === 'code' && (
              <>Buscando pela venda <strong>{search.term}</strong> (em todo o histórico).</>
            )}
            {search.type === 'customer' && (
              <>
                Buscando vendas do cliente <strong>{search.term}</strong> — só vendas com cliente
                vinculado (a prazo, crédito da loja ou entrega futura).
              </>
            )}
            {search.type === 'value' && (
              <>Buscando vendas com total <strong>{search.term}</strong> (valor exato).</>
            )}
          </p>
        )}
      </div>

      {!caixaOpen && online && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Caixa fechado — você pode consultar e reimprimir. Para cancelar ou devolver,{' '}
          <Link href="/caixa" className="font-medium underline">
            abra o caixa
          </Link>
          .
        </div>
      )}

      {/* Erro cru da lista só quando online (offline = "Failed to fetch"; o aviso acima já cobre). */}
      {error && online && !action && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-gray-500 shadow-sm">
            {search
              ? 'Nenhuma venda encontrada para a busca.'
              : range.from || range.to
                ? 'Nenhuma venda no período selecionado.'
                : 'Nenhuma venda registrada ainda.'}
          </div>
        ) : (
          orders.map((o) => {
            const cancelled = o.status === 'CANCELLED';
            const returned = o.status === 'RETURNED';
            const inactive = cancelled || returned;
            // Venda do caixa aberto atual → cancelar; de caixa fechado → devolver.
            const isOpenSessionOrder = caixaOpen && o.cashSession?.id === openSessionId;
            const canAct = o.status === 'CONFIRMED' && caixaOpen;
            const time = new Date(o.createdAt).toLocaleString('pt-BR');
            const methods = [...new Set(o.payments.map((p) => methodLabel(p.method)))].join(', ');
            const editing = action?.id === o.id;
            return (
              <div
                key={o.id}
                className={`rounded-2xl bg-white p-4 shadow-sm ${inactive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">
                        {formatOrderNumber(o.orderNumber) || `#${o.id.slice(0, 8)}`}
                      </span>
                      {cancelled ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Cancelada
                        </span>
                      ) : returned ? (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Devolvida
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Confirmada
                        </span>
                      )}
                      {/* Venda a prazo (ADR-019): badge amarelo adicional (a venda pode estar
                          Confirmada E ser a prazo). "quitada" quando a conta já foi paga. */}
                      {o.receivable && !cancelled && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          A prazo{o.receivable.status === 'PAID' ? ' · quitada' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600">{time}</div>
                    {/* Cliente da venda (quando vinculado — fiado/crédito/entrega futura). Balcão
                        à vista não tem cliente ⇒ nada aqui. */}
                    {o.customer?.name && (
                      <div className="text-xs font-medium text-gray-700">
                        Cliente: {o.customer.name}
                      </div>
                    )}
                    {o.registeredByName && (
                      <div className="text-xs text-gray-500">Registrado por {o.registeredByName}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${inactive ? 'line-through' : ''}`}>
                      {BRL(o.total)}
                    </div>
                    {methods && <div className="text-xs text-gray-600">{methods}</div>}
                  </div>
                </div>

                <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100 pt-2 text-sm">
                  {/* Par (ADR-015): os dois itens aparecem como uma linha só, igual ao comprovante. */}
                  {groupPairedItems(o.items).map((line, idx) => (
                    <li key={idx} className="flex justify-between py-1 text-gray-600">
                      <span>
                        {line.quantity}
                        {line.isPair ? ` par${line.quantity > 1 ? 'es' : ''} ` : '× '}
                        {line.label}
                      </span>
                      <span>{BRL(line.total)}</span>
                    </li>
                  ))}
                </ul>

                {/* Pagamento: formas com valores + "Dinheiro recebido"/"Troco" (migration 0024). O troco
                    é informativo (não entra no caixa; ADR-016). `changeAmount` null = venda antiga sem o
                    dado ⇒ sem as linhas de recebido/troco. */}
                {o.payments.length > 0 &&
                  (() => {
                    const troco = o.changeAmount == null ? null : Number(o.changeAmount);
                    const cashApplied = o.payments
                      .filter((p) => p.method === 'CASH')
                      .reduce((acc, p) => acc + Number(p.amount), 0);
                    const showChange = troco != null && troco > 0;
                    return (
                      <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-sm">
                        {o.payments.map((p) => (
                          <div key={p.id} className="flex justify-between text-gray-600">
                            <span>{methodLabel(p.method)}</span>
                            <span>{BRL(p.amount)}</span>
                          </div>
                        ))}
                        {showChange && (
                          <>
                            <div className="flex justify-between text-gray-600">
                              <span>Dinheiro recebido</span>
                              <span>{BRL(cashApplied + troco)}</span>
                            </div>
                            <div className="flex justify-between font-medium text-red-600">
                              <span>Troco</span>
                              <span>{BRL(troco)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                {editing ? (
                  <div
                    className={`mt-3 space-y-2 rounded-lg p-3 ring-1 ${
                      action?.mode === 'cancel'
                        ? 'bg-red-50 ring-red-200'
                        : 'bg-orange-50 ring-orange-200'
                    }`}
                  >
                    <label
                      className={`block text-sm font-medium ${
                        action?.mode === 'cancel' ? 'text-red-800' : 'text-orange-800'
                      }`}
                    >
                      {action?.mode === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da devolução'}
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="Ex.: cliente desistiu, item com defeito…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <p className="text-xs text-gray-600">
                      {action?.mode === 'cancel'
                        ? 'O estoque dos itens volta e o valor é estornado deste caixa. Não dá para desfazer.'
                        : 'O estoque dos itens volta e a saída do valor é lançada no caixa de hoje. Não dá para desfazer.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={fecharAcao}
                        disabled={busy}
                        className="rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={confirmarAcao}
                        disabled={busy}
                        className={`rounded-lg py-2 text-sm font-medium text-white disabled:opacity-60 ${
                          action?.mode === 'cancel'
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-orange-600 hover:bg-orange-700'
                        }`}
                      >
                        {busy
                          ? 'Processando…'
                          : action?.mode === 'cancel'
                            ? 'Confirmar cancelamento'
                            : 'Confirmar devolução'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
                    <button
                      onClick={() => reimprimir(o)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Reimprimir nota
                    </button>
                    {/* Devolução POR ITEM (ADR-022): vendas confirmadas de entrega imediata. */}
                    {o.status === 'CONFIRMED' && o.deliveryMode !== 'SCHEDULED' && (
                      <button
                        onClick={() => {
                          setInfo(null);
                          setReturnOrder(o);
                        }}
                        className="rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
                      >
                        Devolver itens
                      </button>
                    )}
                    {canAct &&
                      (isOpenSessionOrder ? (
                        <button
                          onClick={() => abrirAcao(o.id, 'cancel')}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                        >
                          Cancelar venda
                        </button>
                      ) : (
                        <button
                          onClick={() => abrirAcao(o.id, 'return')}
                          className="rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
                        >
                          Devolver
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Paginação keyset: só aparece quando o servidor sinaliza mais páginas. */}
      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            {loadingMore ? 'Carregando…' : 'Mostrar mais'}
          </button>
        </div>
      )}

      {/* Documento de reimpressão: oculto na tela, aparece só na impressão. */}
      {printJob && (
        <ReceiptPrint
          kind="sale"
          store={store}
          // ADR-015: reimprime igual ao original — o par vira UMA linha ("Parafuso + Bucha
          // (par)") com o preço do par. `unitPrice` é derivado do total ÷ qtd para a coluna
          // "Unit." bater com a linha unificada.
          items={groupPairedItems(printJob.order.items).map((line) => ({
            name: line.isPair ? `${line.label} (par)` : line.label,
            quantity: line.quantity,
            unitPrice: line.quantity > 0 ? line.total / line.quantity : line.total,
          }))}
          total={Number(printJob.order.total)}
          discount={Number(printJob.order.discountAmount)}
          date={new Date(printJob.order.createdAt).toLocaleString('pt-BR')}
          orderNumber={printJob.order.orderNumber} // ADR-023: reimpressão traz o código V-000128
          // Pagamento dividido: reimprime TODAS as formas da venda (não só a primeira).
          payments={printJob.order.payments.map((p) => ({
            method: p.method, // string livre — inclui "STORE_CREDIT" (ADR-022, Fatia C)
            amount: Number(p.amount),
          }))}
          // Troco (migration 0024): reimprime a linha "Troco" quando registrado (>0). Vendas antigas
          // (changeAmount null) ou sem troco não imprimem a linha — igual ao comprovante original.
          change={
            printJob.order.changeAmount != null && Number(printJob.order.changeAmount) > 0
              ? Number(printJob.order.changeAmount)
              : undefined
          }
        />
      )}

      {/* Devolução por item (ADR-022): modal com seleção de itens/quantidades + destino do troco. */}
      {returnOrder && (
        <ReturnItemsModal
          orderId={returnOrder.id}
          items={returnOrder.items}
          receivable={returnOrder.receivable ?? null}
          hasCustomer={!!returnOrder.customerId}
          onClose={() => setReturnOrder(null)}
          onDone={(res: PartialReturnResult) => {
            const parts = [`Devolução registrada (${BRL(res.totalValue)}).`];
            if (res.abatedAmount > 0) parts.push(`Abateu ${BRL(res.abatedAmount)} da dívida.`);
            if (res.excessAmount > 0)
              parts.push(
                res.target === 'CASH'
                  ? `Troco ${BRL(res.excessAmount)} devolvido em dinheiro.`
                  : `Troco ${BRL(res.excessAmount)} virou crédito na loja.`,
              );
            setInfo(parts.join(' '));
            setReturnOrder(null);
            loadOrders().catch((e) => setError((e as Error).message));
          }}
        />
      )}

      {/* Voltar ao topo: flutua sobre a lista (fixo na viewport) depois de rolar um pouco. */}
      {showTop && (
        <button
          onClick={voltarAoTopo}
          aria-label="Voltar ao topo"
          title="Voltar ao topo"
          className="fixed bottom-6 right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition hover:bg-gray-800"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
