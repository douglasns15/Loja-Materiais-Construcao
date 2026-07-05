'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PAYMENT_METHOD_LABELS, formatCnpj } from '@nexoloja/shared';
import { apiGetWithToken, apiPostWithToken } from '@/lib/api';
import { clearSupportSession, loadSupportSession } from '@/lib/support';

// --- Tipos das respostas (read-only) -----------------------------------------------------------

type Overview = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    cnpj: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
  };
  counts: { products: number; customers: number; users: number };
  openCash: { id: string; openedAt: string; openingAmount: number } | null;
  lowStock: { id: string; name: string; stockQty: number; minStockQty: number }[];
  recentOrders: { id: string; status: string; total: number; createdAt: string }[];
  recentAudit: { id: string; action: string; entity: string; createdAt: string }[];
};

type OrderItem = {
  id: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

type Order = {
  id: string;
  status: string;
  createdAt: string;
  subtotal: number;
  discountAmount: number;
  freightAmount: number;
  total: number;
  customerName: string | null;
  cashClosed: boolean | null;
  items: OrderItem[];
  payments: { id: string; method: string; amount: number }[];
};

type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  categoryName: string | null;
  costPrice: number;
  salePrice: number;
  marginPercent: number;
  stockQty: number;
  minStockQty: number;
  isActive: boolean;
  low: boolean;
};

type Movement = {
  id: string;
  type: string;
  quantity: number;
  unitCost: number | null;
  reason: string | null;
  createdAt: string;
  productName: string | null;
  unit: string | null;
  supplierName: string | null;
};

// --- Formatação --------------------------------------------------------------------------------

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DATETIME = (v: string) => new Date(v).toLocaleString('pt-BR');
const QTY = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  CONFIRMED: { label: 'Confirmada', cls: 'bg-green-100 text-green-800' },
  CANCELLED: { label: 'Cancelada', cls: 'bg-red-100 text-red-700' },
  RETURNED: { label: 'Devolvida', cls: 'bg-amber-100 text-amber-800' },
  DRAFT: { label: 'Rascunho', cls: 'bg-gray-200 text-gray-600' },
};

const method = (m: string) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m;

type Tab = 'resumo' | 'vendas' | 'produtos';

/**
 * Painel de SUPORTE (ADR-009, Fatia E — somente-leitura). O Super Usuário lê a loja-alvo com o
 * token de sessão de suporte (guardado no `sessionStorage`), sem virar usuário da loja. Herda o
 * guard de plataforma do layout `/plataforma`. Abas: Resumo, Vendas (com filtros/detalhes) e
 * Produtos & Estoque (com filtros/movimentações). Nenhuma ação de escrita é possível aqui.
 */
export default function SuportePage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const [token, setToken] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [tab, setTab] = useState<Tab>('resumo');

  useEffect(() => {
    const session = loadSupportSession(tenantId);
    if (!session) {
      setFatalError('Sessão de suporte não encontrada. Volte ao painel e entre novamente.');
      return;
    }
    setToken(session.token);
    setTenantName(session.tenantName);
    setExpiresAt(session.expiresAt);
  }, [tenantId]);

  async function endSession() {
    setEnding(true);
    try {
      if (token) await apiPostWithToken('/support/end', token);
    } catch {
      // Encerrar é best-effort (o token expira sozinho); segue limpando localmente.
    } finally {
      clearSupportSession(tenantId);
      router.push('/plataforma');
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'resumo', label: 'Resumo' },
    { id: 'vendas', label: 'Vendas' },
    { id: 'produtos', label: 'Produtos & Estoque' },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      {/* Banner: modo suporte, somente leitura */}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
              Modo suporte
            </span>
            <span className="text-sm font-medium text-amber-900">
              Somente leitura{tenantName ? ` · ${tenantName}` : ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-700">
            Você está visualizando os dados desta loja para suporte. Nenhuma alteração é possível
            nesta sessão.
            {expiresAt && ` A sessão expira às ${new Date(expiresAt).toLocaleTimeString('pt-BR')}.`}
          </p>
        </div>
        <button
          onClick={endSession}
          disabled={ending}
          className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {ending ? 'Encerrando…' : 'Encerrar sessão'}
        </button>
      </div>

      {fatalError && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          <p>{fatalError}</p>
          <button
            onClick={() => router.push('/plataforma')}
            className="mt-3 rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Voltar ao painel
          </button>
        </div>
      )}

      {token && !fatalError && (
        <>
          {/* Abas */}
          <div className="mb-5 flex gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                  tab === t.id
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'resumo' && <ResumoTab token={token} tenantId={tenantId} onExpired={setFatalError} />}
          {tab === 'vendas' && <VendasTab token={token} tenantId={tenantId} onExpired={setFatalError} />}
          {tab === 'produtos' && (
            <ProdutosTab token={token} tenantId={tenantId} onExpired={setFatalError} />
          )}
        </>
      )}
    </div>
  );
}

// --- Aba: Resumo -------------------------------------------------------------------------------

function ResumoTab({
  token,
  tenantId,
  onExpired,
}: {
  token: string;
  tenantId: string;
  onExpired: (msg: string) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setData(await apiGetWithToken<Overview>(`/support/${tenantId}/overview`, token));
        setError(null);
      } catch (e) {
        handleSectionError(e, setError, onExpired);
      } finally {
        setLoading(false);
      }
    })();
  }, [token, tenantId, onExpired]);

  if (loading) return <p className="text-gray-500">Carregando…</p>;
  if (error) return <SectionError message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="mb-5 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{data.tenant.name}</h1>
            <p className="text-xs text-gray-400">{data.tenant.slug}</p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              data.tenant.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
            }`}
          >
            {data.tenant.isActive ? 'Ativa' : 'Inativa'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-600 sm:grid-cols-4">
          <div>
            <span className="text-gray-400">CNPJ:</span>{' '}
            {data.tenant.cnpj ? formatCnpj(data.tenant.cnpj) : '—'}
          </div>
          <div>
            <span className="text-gray-400">Telefone:</span> {data.tenant.phone || '—'}
          </div>
          <div>
            <span className="text-gray-400">Criada:</span>{' '}
            {new Date(data.tenant.createdAt).toLocaleDateString('pt-BR')}
          </div>
          <div>
            <span className="text-gray-400">Caixa:</span>{' '}
            {data.openCash ? (
              <span className="text-green-700">Aberto ({BRL(data.openCash.openingAmount)})</span>
            ) : (
              'Fechado'
            )}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        {[
          { label: 'Produtos', value: data.counts.products },
          { label: 'Clientes', value: data.counts.customers },
          { label: 'Usuários', value: data.counts.users },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-bold">{k.value}</div>
            <div className="text-xs text-gray-500">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">
            Estoque baixo{' '}
            <span className="text-xs font-normal text-gray-400">({data.lowStock.length})</span>
          </h2>
          {data.lowStock.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum item abaixo do mínimo.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {data.lowStock.map((p) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <span>{p.name}</span>
                  <span className="text-red-600">
                    {QTY(p.stockQty)} / {QTY(p.minStockQty)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Últimas vendas</h2>
          {data.recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma venda registrada.</p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {data.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-1.5">
                  <span className="text-gray-500">{DATETIME(o.createdAt)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {ORDER_STATUS[o.status]?.label ?? o.status}
                    </span>
                    <span className="font-medium">{BRL(o.total)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Eventos de auditoria recentes</h2>
        {data.recentAudit.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum evento registrado.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.recentAudit.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-1.5">
                <span className="font-mono text-xs text-gray-700">
                  {a.action} <span className="text-gray-400">· {a.entity}</span>
                </span>
                <span className="text-gray-500">{DATETIME(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// --- Aba: Vendas -------------------------------------------------------------------------------

function VendasTab({
  token,
  tenantId,
  onExpired,
}: {
  token: string;
  tenantId: string;
  onExpired: (msg: string) => void;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (status) qs.set('status', status);
    const suffix = qs.toString() ? `?${qs}` : '';
    try {
      setOrders(await apiGetWithToken<Order[]>(`/support/${tenantId}/orders${suffix}`, token));
      setError(null);
    } catch (e) {
      handleSectionError(e, setError, onExpired);
    } finally {
      setLoading(false);
    }
  }, [token, tenantId, from, to, status, onExpired]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantId]);

  function clearFilters() {
    setFrom('');
    setTo('');
    setStatus('');
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          De
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="CONFIRMED">Confirmada</option>
            <option value="CANCELLED">Cancelada</option>
            <option value="RETURNED">Devolvida</option>
            <option value="DRAFT">Rascunho</option>
          </select>
        </label>
        <button
          onClick={load}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filtrar
        </button>
        <button
          onClick={() => {
            clearFilters();
            setTimeout(load, 0);
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          Limpar
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Carregando…</p>
      ) : error ? (
        <SectionError message={error} />
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma venda no filtro selecionado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-500">{DATETIME(o.createdAt)}</td>
                    <td className="px-3 py-2">{o.customerName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          ORDER_STATUS[o.status]?.cls ?? 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {ORDER_STATUS[o.status]?.label ?? o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{BRL(o.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                      >
                        {expanded === o.id ? 'Ocultar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="mb-2 text-xs text-gray-500">
                          Venda #{o.id.slice(0, 8)}
                          {o.cashClosed !== null &&
                            ` · caixa ${o.cashClosed ? 'fechado' : 'aberto'}`}
                        </div>
                        <table className="w-full text-xs">
                          <thead className="text-left text-gray-500">
                            <tr>
                              <th className="py-1">Produto</th>
                              <th className="py-1 text-right">Qtd</th>
                              <th className="py-1 text-right">Unit.</th>
                              <th className="py-1 text-right">Desc.</th>
                              <th className="py-1 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.items.map((it) => (
                              <tr key={it.id} className="border-t border-gray-200">
                                <td className="py-1">{it.productName}</td>
                                <td className="py-1 text-right">{QTY(it.quantity)}</td>
                                <td className="py-1 text-right">{BRL(it.unitPrice)}</td>
                                <td className="py-1 text-right">{BRL(it.discount)}</td>
                                <td className="py-1 text-right">{BRL(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-2 flex flex-wrap justify-end gap-4 text-xs text-gray-600">
                          <span>Subtotal: {BRL(o.subtotal)}</span>
                          <span>Desconto: {BRL(o.discountAmount)}</span>
                          {o.freightAmount > 0 && <span>Frete: {BRL(o.freightAmount)}</span>}
                          <span className="font-medium text-gray-900">Total: {BRL(o.total)}</span>
                        </div>
                        <div className="mt-2 text-xs text-gray-600">
                          Pagamento:{' '}
                          {o.payments.length === 0
                            ? '—'
                            : o.payments.map((p) => `${method(p.method)} ${BRL(p.amount)}`).join(' · ')}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Aba: Produtos & Estoque -------------------------------------------------------------------

function ProdutosTab({
  token,
  tenantId,
  onExpired,
}: {
  token: string;
  tenantId: string;
  onExpired: (msg: string) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movLoading, setMovLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (lowOnly) qs.set('lowStock', '1');
    const suffix = qs.toString() ? `?${qs}` : '';
    try {
      setProducts(await apiGetWithToken<Product[]>(`/support/${tenantId}/products${suffix}`, token));
      setError(null);
    } catch (e) {
      handleSectionError(e, setError, onExpired);
    } finally {
      setLoading(false);
    }
  }, [token, tenantId, q, lowOnly, onExpired]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantId]);

  async function toggleMovements(p: Product) {
    if (openId === p.id) {
      setOpenId(null);
      return;
    }
    setOpenId(p.id);
    setMovLoading(true);
    setMovements([]);
    try {
      setMovements(
        await apiGetWithToken<Movement[]>(
          `/support/${tenantId}/stock-movements?productId=${p.id}`,
          token,
        ),
      );
    } catch (e) {
      handleSectionError(e, () => {}, onExpired);
    } finally {
      setMovLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          placeholder="Buscar por nome ou SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Só estoque baixo
        </label>
        <button
          onClick={load}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filtrar
        </button>
        <button
          onClick={() => {
            setQ('');
            setLowOnly(false);
            setTimeout(load, 0);
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          Limpar
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Carregando…</p>
      ) : error ? (
        <SectionError message={error} />
      ) : products.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum produto no filtro selecionado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 text-right">Estoque</th>
                <th className="px-3 py-2 text-right">Custo</th>
                <th className="px-3 py-2 text-right">Venda</th>
                <th className="px-3 py-2 text-right">Margem</th>
                <th className="px-3 py-2 text-right">Movim.</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.sku} · {p.unit}
                        {!p.isActive && ' · inativo'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{p.categoryName ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={p.low ? 'font-medium text-red-600' : ''}>
                        {QTY(p.stockQty)}
                      </span>
                      <span className="text-xs text-gray-400"> / {QTY(p.minStockQty)}</span>
                      {p.low && (
                        <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                          baixo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{BRL(p.costPrice)}</td>
                    <td className="px-3 py-2 text-right">{BRL(p.salePrice)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {p.marginPercent.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => toggleMovements(p)}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                      >
                        {openId === p.id ? 'Ocultar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                  {openId === p.id && (
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="mb-2 text-xs font-medium text-gray-600">
                          Movimentações de estoque — {p.name}
                        </div>
                        {movLoading ? (
                          <p className="text-xs text-gray-400">Carregando…</p>
                        ) : movements.length === 0 ? (
                          <p className="text-xs text-gray-400">Nenhuma movimentação.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-left text-gray-500">
                              <tr>
                                <th className="py-1">Data</th>
                                <th className="py-1">Tipo</th>
                                <th className="py-1 text-right">Qtd</th>
                                <th className="py-1">Motivo</th>
                                <th className="py-1">Fornecedor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {movements.map((m) => (
                                <tr key={m.id} className="border-t border-gray-200">
                                  <td className="py-1 text-gray-500">{DATETIME(m.createdAt)}</td>
                                  <td className="py-1">
                                    <span
                                      className={
                                        m.type === 'INCOME' ? 'text-green-700' : 'text-red-600'
                                      }
                                    >
                                      {m.type === 'INCOME' ? 'Entrada' : 'Saída'}
                                    </span>
                                  </td>
                                  <td className="py-1 text-right">{QTY(m.quantity)}</td>
                                  <td className="py-1 text-gray-500">{m.reason ?? '—'}</td>
                                  <td className="py-1 text-gray-500">{m.supplierName ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Auxiliares de erro ------------------------------------------------------------------------

/**
 * Trata erro de uma seção: se o token de suporte expirou/foi revogado (401/403), promove para
 * erro fatal (a sessão inteira caiu). Caso contrário, mostra o erro só na seção.
 */
function handleSectionError(
  e: unknown,
  setLocal: (msg: string) => void,
  onExpired: (msg: string) => void,
) {
  const msg = (e as Error).message || 'Falha ao carregar.';
  if (/sessão de suporte|revogado|expirada|401|403/i.test(msg)) {
    onExpired('Sessão de suporte expirada ou revogada. Volte ao painel e entre novamente.');
  } else {
    setLocal(msg);
  }
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">{message}</div>
  );
}
