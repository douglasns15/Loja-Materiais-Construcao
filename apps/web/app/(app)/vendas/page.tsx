'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatOrderNumber,
  paymentMethodLabel,
  cancelOrderSchema,
  returnOrderSchema,
  type PartialReturnResult,
} from '@nexoloja/shared';
import { groupPairedItems, calcVariation } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { printArea } from '@/lib/print';
import { PeriodFilter, defaultRange } from '@/components/PeriodFilter';
import { OfflineNotice } from '@/components/OfflineNotice';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';
import { ReturnItemsModal } from '@/components/ReturnItemsModal';
import { writeReorderPayload, type ReorderPayloadItem } from '@/lib/reorder';
import { shareReceiptImage, shareReceiptPdf } from '@/lib/receiptShare';

type OrderItem = {
  id: string;
  // "Vender de novo" (reorder): o produto e a unidade vendida vêm do GET /orders (`items:true`) e
  // levam a venda de volta ao PDV. O PDV repreça pelo catálogo atual (lib/reorder + core planReorder).
  productId: string;
  /** Unidade VENDIDA (base ou embalagem/metro) — o PDV usa para derivar o modo de venda. */
  unit: string;
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

/** Faixa de inteligência: KPIs do período (reusa `GET /reports/sales?compare=1`). `previous` = os
 *  mesmos KPIs da janela ANTERIOR equivalente, para as setas ▲/▼ (null = todo o histórico/sem base). */
type SalesReport = {
  totalRevenue: number;
  salesCount: number;
  averageTicket: number;
  byPaymentMethod: { method: string; total: number; count: number; share: number }[];
  previous: { totalRevenue: number; salesCount: number; averageTicket: number } | null;
};

export default function VendasPage() {
  const online = useOnline();
  const router = useRouter();
  // "Vender de novo" (reorder): modo de seleção múltipla. Ligado pelo botão do topo, mostra as
  // caixas nos cartões; combina com os filtros (o operador acha as vendas) e junta os itens de
  // uma ou VÁRIAS vendas num carrinho novo no PDV. `selectedIds` = vendas marcadas.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
  // Faixa de inteligência (KPIs do período). Só aparece na lista por período — durante uma busca
  // (que varre todo o histórico) fica oculta, pois os números seriam de um recorte diferente.
  const [report, setReport] = useState<SalesReport | null>(null);
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
  // Comprovante no WhatsApp: monta o cupom fora da tela (captureRef) para virar imagem/PDF e abrir o
  // compartilhamento. `kind` decide imagem (inline) ou PDF (anexo). `sharing` = venda+tipo em
  // "Gerando…". `shareErr` = falha amigável.
  const [shareJob, setShareJob] = useState<{ order: Order; key: number; kind: 'image' | 'pdf' } | null>(null);
  const [sharing, setSharing] = useState<{ id: string; kind: 'image' | 'pdf' } | null>(null);
  const [shareErr, setShareErr] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);
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

  /** Liga/desliga o modo "Vender de novo" (seleção múltipla). Ao desligar, zera a seleção; ao ligar,
   *  fecha qualquer painel de cancelamento/devolução aberto (os fluxos não se misturam). */
  function toggleReorderMode() {
    setSelectMode((on) => !on);
    setSelectedIds(new Set());
    setAction(null);
    setError(null);
  }

  /** Marca/desmarca uma venda na seleção do reorder. */
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Junta os itens de TODAS as vendas marcadas (na ordem da lista) e leva ao PDV, que repreça pelo
   *  preço atual e mostra a revisão (lib/reorder + core planReorder). Combinar vendas = somar itens. */
  function venderDeNovo() {
    const chosen = orders.filter((o) => selectedIds.has(o.id));
    const items: ReorderPayloadItem[] = [];
    for (const o of chosen) {
      for (const it of o.items) {
        items.push({
          productId: it.productId,
          productName: it.productName,
          unit: it.unit,
          quantity: it.quantity,
        });
      }
    }
    if (items.length === 0) return;
    writeReorderPayload({ sales: chosen.length, items });
    router.push('/venda');
  }

  // scope=all: histórico completo (inclui vendas de caixas já fechados), para
  // permitir a devolução de vendas fora do caixa aberto. Paginado por cursor: a 1ª
  // página substitui a lista; "Mostrar mais" anexa as seguintes.
  async function loadOrders(r: Range = range, s: Sort = sort, srch: Search | null = search) {
    const page = await apiGet<OrdersPage>(ordersQuery(null, r, s, srch));
    setOrders(page.rows);
    setNextCursor(page.nextCursor);
  }

  /** Carrega os KPIs do período para a Faixa de inteligência (`?compare=1` traz o período anterior).
   *  Best-effort e silencioso: se falhar, a faixa some (não polui o Histórico com erro). */
  async function loadReport(r: Range = range) {
    try {
      const p = new URLSearchParams({ compare: '1' });
      if (r.from) p.set('from', r.from);
      if (r.to) p.set('to', r.to);
      setReport(await apiGet<SalesReport>(`/reports/sales?${p.toString()}`));
    } catch {
      setReport(null);
    }
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
    // A faixa acompanha o período (só quando não há busca ativa, que varre todo o histórico).
    if (!search) void loadReport(r);
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
    // Busca oculta a faixa (recorte diferente do período); sem termo, volta a mostrá-la.
    if (next) setReport(null);
    else void loadReport(range);
  }
  /** Limpa a busca e volta à lista normal (com o período/ordenação em vigor). */
  function limparBusca() {
    setSearchInput('');
    setSearch(null);
    setError(null);
    loadOrders(range, sort, null).catch((err) => setError((err as Error).message));
    void loadReport(range);
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{ id: string } | null>('/cash-sessions/current');
        setOpenSessionId(session?.id ?? null);
        await loadOrders();
        void loadReport();
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

  /** Compartilha o comprovante (imagem ou PDF): monta o cupom fora da tela e o efeito abaixo captura. */
  function enviarComprovante(order: Order, kind: 'image' | 'pdf') {
    setShareErr(null);
    setSharing({ id: order.id, kind });
    setShareJob({ order, key: Date.now(), kind });
  }

  // Depois que o cupom de captura entra no DOM (shareJob), fotografa-o e abre o compartilhamento.
  // Web Share abre o menu do sistema: o operador escolhe o WhatsApp e envia — nada sai sozinho.
  useEffect(() => {
    if (!shareJob) return;
    let cancelled = false;
    (async () => {
      // Um respiro para o React pintar o nó de captura (fontes/imagens carregarem) antes da foto.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      // Fotografa o PRÓPRIO #print-area (largura 302px) — não o invólucro, que fica com altura zero
      // (só contém o filho posicionado fora da tela) e geraria um PNG/PDF vazio.
      const node = captureRef.current?.querySelector<HTMLElement>('#print-area') ?? null;
      if (!node || cancelled) return;
      const code = formatOrderNumber(shareJob.order.orderNumber);
      const share = shareJob.kind === 'pdf' ? shareReceiptPdf : shareReceiptImage;
      try {
        await share(node, {
          fileName: code || 'comprovante',
          title: `Comprovante ${code}`.trim(),
          text: `Comprovante ${code} — ${store?.name ?? 'nossa loja'} · ${BRL(shareJob.order.total)}`,
        });
      } catch (e) {
        // AbortError = o operador fechou o menu de compartilhamento (não é falha).
        if (!cancelled && (e as Error)?.name !== 'AbortError') {
          setShareErr(`Não consegui gerar o ${shareJob.kind === 'pdf' ? 'PDF' : 'comprovante'}. Tente novamente.`);
        }
      } finally {
        if (!cancelled) {
          setSharing(null);
          setShareJob(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareJob]);

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
        <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
          Histórico de Vendas
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
      <p className="mb-3 text-sm text-gray-500">
        Vendas mais recentes. Reimprima o comprovante, <strong>cancele</strong> vendas do caixa
        aberto (estorna estoque e caixa) ou <strong>devolva</strong> vendas de caixas já fechados
        (repõe o estoque e lança a saída no caixa de hoje).
      </p>

      {/* "Vender de novo" (reorder): liga a seleção múltipla. O operador combina os filtros para achar
          a venda, marca uma OU VÁRIAS e leva todos os itens de uma vez ao PDV (repreçado). */}
      <div className="mb-4">
        <button
          type="button"
          onClick={toggleReorderMode}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            selectMode
              ? 'border border-gray-300 text-gray-700 hover:bg-gray-100'
              : 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600'
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {selectMode ? 'Sair da seleção' : 'Vender de novo'}
        </button>
        {selectMode && (
          <span className="ml-3 text-xs text-gray-500">
            Marque uma ou mais vendas (use os filtros para achar) e toque em <strong>Adicionar ao PDV</strong>.
          </span>
        )}
      </div>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      {/* Filtro de período (‹ Hoje › + atalhos + De/Até) — componente compartilhado. Abre em Hoje;
          a navegação percorre os dias. Bordas no fuso da loja (UTC-3), igual ao relatório. */}
      <PeriodFilter value={range} onChange={onRangeChange} className="mb-4" />

      {/* Faixa de inteligência: o pulso do período em uma linha (faturamento com ▲/▼ vs. o período
          anterior, nº de vendas, ticket médio e a forma de pagamento predominante). Reusa os KPIs
          já agregados no banco por `GET /reports/sales` — o Histórico deixa de ser só um arquivo. */}
      {report && !search && report.salesCount > 0 && (() => {
        const rev = report.previous ? calcVariation(report.totalRevenue, report.previous.totalRevenue) : null;
        const top = report.byPaymentMethod[0];
        const arrow = rev?.direction === 'up' ? '▲' : rev?.direction === 'down' ? '▼' : '→';
        const revColor =
          rev?.direction === 'up' ? 'text-emerald-600' : rev?.direction === 'down' ? 'text-red-600' : 'text-gray-400';
        return (
          <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-md">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="border-gray-100 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Faturamento</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{BRL(report.totalRevenue)}</div>
                {rev && rev.percent !== null && (
                  <div className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${revColor}`}>
                    <span>{arrow} {Math.abs(rev.percent)}%</span>
                    <span className="font-normal text-gray-400">vs. anterior</span>
                  </div>
                )}
              </div>
              <div className="border-gray-100 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Vendas</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{report.salesCount}</div>
              </div>
              <div className="border-gray-100 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Ticket médio</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{BRL(report.averageTicket)}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Forma predominante</div>
                {top ? (
                  <div className="mt-0.5">
                    <span className="text-sm font-bold text-indigo-700">{methodLabel(top.method)}</span>
                    <span className="ml-1 text-xs font-medium tabular-nums text-gray-400">{Math.round(top.share)}%</span>
                  </div>
                ) : (
                  <div className="mt-0.5 text-sm text-gray-400">—</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Ordenação + busca por código */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-md">
        {/* Ordenação — aplicada no servidor (não só nas páginas carregadas). */}
        <label className="flex flex-col text-xs font-medium text-gray-500">
          Ordenar por
          <select
            value={sort}
            onChange={(e) => mudarOrdenacao(e.target.value as Sort)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:w-auto"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {/* Busca por código (V-000128), cliente (nome) ou valor (total exato). Procura todo o
            histórico, ignorando o período. O seletor (controle segmentado — identidade das telas
            repaginadas) troca o tipo; um campo só, adaptável. */}
        <form onSubmit={buscar} className="mt-3 border-t border-gray-100 pt-3">
          <div className="mb-2 inline-flex gap-0.5 rounded-xl bg-gray-100 p-1">
            {(Object.keys(SEARCH_LABELS) as SearchType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSearchType(t)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                  searchType === t ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-white/60'
                }`}
              >
                {SEARCH_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode={searchType === 'customer' ? 'text' : 'decimal'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={SEARCH_PLACEHOLDERS[searchType]}
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
        </form>
        {search && (
          <p className="mt-2 text-xs text-gray-500">
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
      {shareErr && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{shareErr}</p>}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-gray-500 shadow-md">
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
            const selected = selectedIds.has(o.id);
            // Venda do caixa aberto atual → cancelar; de caixa fechado → devolver.
            const isOpenSessionOrder = caixaOpen && o.cashSession?.id === openSessionId;
            const canAct = o.status === 'CONFIRMED' && caixaOpen;
            const time = new Date(o.createdAt).toLocaleString('pt-BR');
            const methods = [...new Set(o.payments.map((p) => methodLabel(p.method)))].join(', ');
            const editing = action?.id === o.id;
            return (
              <div
                key={o.id}
                onClick={selectMode ? () => toggleSelect(o.id) : undefined}
                className={`relative rounded-2xl border bg-white p-4 shadow-md transition ${
                  selectMode ? 'cursor-pointer pl-12' : 'hover:shadow-lg'
                } ${selected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200'} ${
                  inactive ? 'opacity-60' : ''
                }`}
              >
                {/* Caixa de seleção do reorder (só no modo "Vender de novo"): fica na canaleta à
                    esquerda (a `pl-12` abre o espaço), sem refluir o conteúdo do cartão. */}
                {selectMode && (
                  <span
                    className={`absolute left-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-2 ${
                      selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 bg-white'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                )}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-indigo-600">
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

                {/* No modo "Vender de novo" as ações do cartão (reimprimir/cancelar/devolver) somem —
                    o cartão inteiro vira alvo de seleção. */}
                {selectMode ? null : editing ? (
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
                    {/* Comprovante no WhatsApp (imagem inline): gera o cupom e abre o compartilhamento. */}
                    <button
                      onClick={() => enviarComprovante(o, 'image')}
                      disabled={sharing?.id === o.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.42 5.82c0 4.54-3.7 8.24-8.25 8.24a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24Zm4.71 10.29c-.26-.13-1.53-.75-1.76-.84-.24-.09-.41-.13-.59.13-.17.26-.67.84-.82 1.02-.15.17-.3.19-.56.06-.26-.13-1.09-.4-2.08-1.28-.77-.69-1.29-1.53-1.44-1.79-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.59-1.42-.81-1.94-.21-.51-.43-.44-.59-.45l-.5-.01c-.17 0-.45.06-.68.32-.24.26-.9.88-.9 2.15 0 1.27.92 2.49 1.05 2.66.13.17 1.8 2.75 4.36 3.86.61.26 1.08.42 1.45.54.61.19 1.17.17 1.61.1.49-.07 1.53-.62 1.74-1.23.21-.6.21-1.12.15-1.23-.06-.11-.24-.17-.5-.3Z" />
                      </svg>
                      {sharing?.id === o.id && sharing.kind === 'image' ? 'Gerando…' : 'WhatsApp'}
                    </button>
                    {/* Comprovante em PDF (anexo — melhor p/ imprimir/arquivar). */}
                    <button
                      onClick={() => enviarComprovante(o, 'pdf')}
                      disabled={sharing?.id === o.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </svg>
                      {sharing?.id === o.id && sharing.kind === 'pdf' ? 'Gerando…' : 'PDF'}
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

      {/* Cupom de CAPTURA para o WhatsApp: renderizado fora do viewport (captureMode) e fotografado
          pelo efeito de compartilhamento. Mesmo mapeamento da reimpressão (par vira uma linha). */}
      {shareJob && (
        <div ref={captureRef} className="rc-capture-host">
          <ReceiptPrint
            captureMode
            kind="sale"
            store={store}
            items={groupPairedItems(shareJob.order.items).map((line) => ({
              name: line.isPair ? `${line.label} (par)` : line.label,
              quantity: line.quantity,
              unitPrice: line.quantity > 0 ? line.total / line.quantity : line.total,
            }))}
            total={Number(shareJob.order.total)}
            discount={Number(shareJob.order.discountAmount)}
            date={new Date(shareJob.order.createdAt).toLocaleString('pt-BR')}
            orderNumber={shareJob.order.orderNumber}
            payments={shareJob.order.payments.map((p) => ({
              method: p.method,
              amount: Number(p.amount),
            }))}
            change={
              shareJob.order.changeAmount != null && Number(shareJob.order.changeAmount) > 0
                ? Number(shareJob.order.changeAmount)
                : undefined
            }
          />
        </div>
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

      {/* Barra de ação do reorder: fixa no rodapé enquanto o modo seleção está ligado. Mostra quantas
          vendas foram marcadas e leva os itens ao PDV. */}
      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-sm text-gray-600">
              {selectedIds.size === 0 ? (
                'Nenhuma venda marcada'
              ) : (
                <>
                  <strong className="text-indigo-700">{selectedIds.size}</strong> venda
                  {selectedIds.size > 1 ? 's' : ''} marcada{selectedIds.size > 1 ? 's' : ''}
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleReorderMode}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                onClick={venderDeNovo}
                disabled={selectedIds.size === 0}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Adicionar ao PDV
              </button>
            </div>
          </div>
        </div>
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
