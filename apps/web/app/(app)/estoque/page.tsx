'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createStockMovementSchema,
  inventoryAdjustmentSchema,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';

type Product = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stockQty: string;
  minStockQty: string;
};

type Supplier = { id: string; name: string };

type Movement = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  quantity: string;
  unitCost: string | null;
  reason: string | null;
  createdAt: string;
  registeredByName: string | null;
  product: { name: string; unit: string } | null;
  supplier: { name: string } | null;
};

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

const DATETIME = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const EMPTY_FILTERS = { productId: '', type: '', reason: '', dateFrom: '', dateTo: '' };

export default function EstoquePage() {
  const { me } = useMe();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filtros das movimentações. `productId` é resolvido no servidor (?productId=);
  // os demais são aplicados no cliente sobre a lista carregada.
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // Formulário de entrada de estoque (compra/recebimento).
  const [entry, setEntry] = useState({
    productId: '',
    quantity: '',
    unitCost: '',
    supplierId: '',
    reason: '',
  });
  const [savingEntry, setSavingEntry] = useState(false);

  // Formulário de ajuste de inventário (ADR-004).
  const [adjust, setAdjust] = useState({ productId: '', countedQty: '', reason: '' });
  const [savingAdjust, setSavingAdjust] = useState(false);

  async function loadCatalog() {
    try {
      const [p, s] = await Promise.all([
        apiGet<Product[]>('/products'),
        apiGet<Supplier[]>('/suppliers'),
      ]);
      setProducts(p);
      setSuppliers(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadMovements() {
    try {
      const q = filters.productId ? `?productId=${encodeURIComponent(filters.productId)}` : '';
      setMovements(await apiGet<Movement[]>(`/stock/movements${q}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  // Recarrega as movimentações quando o filtro de produto muda (resolvido no servidor).
  useEffect(() => {
    loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.productId]);

  const lowStock = useMemo(
    () =>
      products.filter(
        (p) => Number(p.minStockQty) > 0 && Number(p.stockQty) <= Number(p.minStockQty),
      ),
    [products],
  );

  // Filtros aplicados no cliente (tipo, motivo e período) sobre a lista já carregada.
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (filters.type && m.type !== filters.type) return false;
      if (filters.reason) {
        const hay = `${m.reason ?? ''} ${m.supplier?.name ?? ''}`.toLowerCase();
        if (!hay.includes(filters.reason.toLowerCase())) return false;
      }
      const day = (m.createdAt ?? '').slice(0, 10); // yyyy-mm-dd
      if (filters.dateFrom && day < filters.dateFrom) return false;
      if (filters.dateTo && day > filters.dateTo) return false;
      return true;
    });
  }, [movements, filters.type, filters.reason, filters.dateFrom, filters.dateTo]);

  const filtersActive =
    filters.productId || filters.type || filters.reason || filters.dateFrom || filters.dateTo;

  const adjustProduct = products.find((p) => p.id === adjust.productId);

  async function onEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = createStockMovementSchema.safeParse({
      productId: entry.productId,
      type: 'INCOME',
      quantity: Number(entry.quantity),
      unitCost: entry.unitCost ? Number(entry.unitCost) : undefined,
      supplierId: entry.supplierId || undefined,
      reason: entry.reason || undefined,
    });
    if (!parsed.success) {
      setError('Selecione o produto e informe uma quantidade maior que zero.');
      return;
    }

    setSavingEntry(true);
    try {
      await apiPost('/stock/movements', parsed.data);
      setEntry({ productId: '', quantity: '', unitCost: '', supplierId: '', reason: '' });
      setNotice('Entrada de estoque registrada.');
      await Promise.all([loadCatalog(), loadMovements()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingEntry(false);
    }
  }

  async function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = inventoryAdjustmentSchema.safeParse({
      productId: adjust.productId,
      countedQty: Number(adjust.countedQty),
      reason: adjust.reason,
    });
    if (!parsed.success) {
      setError('Para ajustar, selecione o produto, informe a contagem e o motivo.');
      return;
    }

    setSavingAdjust(true);
    try {
      await apiPost('/stock/adjust', parsed.data);
      setAdjust({ productId: '', countedQty: '', reason: '' });
      setNotice('Estoque ajustado (registrado na auditoria).');
      await Promise.all([loadCatalog(), loadMovements()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingAdjust(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Estoque</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-700">{notice}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Entrada de estoque — bloqueada em loja desativada (ADR-009); ajuste segue liberado. */}
        {me?.tenantActive === false ? (
          <StoreDisabledNotice message="A entrada de estoque está bloqueada. Fale com o suporte para reativar a loja." />
        ) : (
        <form onSubmit={onEntry} className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Entrada de estoque</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select
              value={entry.productId}
              onChange={(e) => setEntry({ ...entry, productId: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
            >
              <option value="">Selecione o produto…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({QTY(p.stockQty)} em estoque)
                </option>
              ))}
            </select>
            <input
              placeholder="Quantidade"
              type="number"
              step="any"
              min="0"
              value={entry.quantity}
              onChange={(e) => setEntry({ ...entry, quantity: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            <input
              placeholder="Custo unitário (opcional)"
              type="number"
              step="0.01"
              min="0"
              value={entry.unitCost}
              onChange={(e) => setEntry({ ...entry, unitCost: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            <select
              value={entry.supplierId}
              onChange={(e) => setEntry({ ...entry, supplierId: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
            >
              <option value="">Fornecedor (opcional)…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Motivo (ex: Compra NF 1234)"
              value={entry.reason}
              onChange={(e) => setEntry({ ...entry, reason: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 sm:col-span-2"
            />
          </div>
          <button
            type="submit"
            disabled={savingEntry}
            className="mt-3 w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {savingEntry ? 'Registrando…' : 'Registrar entrada'}
          </button>
        </form>
        )}

        {/* Ajuste de inventário */}
        <form onSubmit={onAdjust} className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">Ajuste de inventário</h2>
          <div className="grid grid-cols-1 gap-3">
            <select
              value={adjust.productId}
              onChange={(e) => setAdjust({ ...adjust, productId: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">Selecione o produto…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({QTY(p.stockQty)} em estoque)
                </option>
              ))}
            </select>
            <input
              placeholder="Contagem real"
              type="number"
              step="any"
              min="0"
              value={adjust.countedQty}
              onChange={(e) => setAdjust({ ...adjust, countedQty: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            {adjustProduct && adjust.countedQty !== '' && (
              <p className="text-sm text-gray-600">
                {QTY(adjustProduct.stockQty)} → <strong>{QTY(adjust.countedQty)}</strong>{' '}
                ({Number(adjust.countedQty) - Number(adjustProduct.stockQty) >= 0 ? '+' : ''}
                {QTY(Number(adjust.countedQty) - Number(adjustProduct.stockQty))})
              </p>
            )}
            <input
              placeholder="Motivo (obrigatório)"
              value={adjust.reason}
              onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={savingAdjust}
            className="mt-3 w-full rounded-lg border border-gray-900 py-2 font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
          >
            {savingAdjust ? 'Ajustando…' : 'Ajustar estoque'}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            O ajuste manual é registrado na auditoria (ADR-004).
          </p>
        </form>
      </div>

      {/* Estoque atual por produto */}
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-semibold">Estoque atual</h2>
          {lowStock.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              {lowStock.length} com estoque baixo
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Produto</th>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2 text-right">Em estoque</th>
              <th className="px-4 py-2 text-right">Mínimo</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const low =
                  Number(p.minStockQty) > 0 && Number(p.stockQty) <= Number(p.minStockQty);
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      {p.name}
                      {low && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          baixo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{p.sku}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${low ? 'text-amber-700' : ''}`}
                    >
                      {QTY(p.stockQty)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{QTY(p.minStockQty)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Histórico de movimentações */}
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-semibold">Movimentações recentes</h2>
          <span className="text-xs text-gray-400">
            {filteredMovements.length} de {movements.length}
          </span>
        </div>

        {/* Barra de filtros */}
        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-4 py-3">
          <label className="flex flex-col text-xs text-gray-500">
            Produto
            <select
              value={filters.productId}
              onChange={(e) => setFilters({ ...filters, productId: e.target.value })}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="">Todos</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-500">
            Tipo
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="">Todos</option>
              <option value="INCOME">Entrada</option>
              <option value="EXPENSE">Saída</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-500">
            Motivo
            <input
              value={filters.reason}
              onChange={(e) => setFilters({ ...filters, reason: e.target.value })}
              placeholder="Buscar…"
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-500">
            De
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-500">
            Até
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          {filtersActive && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Limpar
            </button>
          )}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Produto</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2 text-right">Qtd</th>
              <th className="px-4 py-2">Motivo</th>
              <th className="px-4 py-2">Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                  {movements.length === 0
                    ? 'Nenhuma movimentação ainda.'
                    : 'Nenhuma movimentação para os filtros selecionados.'}
                </td>
              </tr>
            ) : (
              filteredMovements.map((m) => (
                <tr key={m.id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-500">{DATETIME(m.createdAt)}</td>
                  <td className="px-4 py-2">{m.product?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        m.type === 'INCOME'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {m.type === 'INCOME' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{QTY(m.quantity)}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {m.reason ?? '—'}
                    {m.supplier?.name ? ` · ${m.supplier.name}` : ''}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{m.registeredByName ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
