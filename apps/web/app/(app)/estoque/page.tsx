'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createStockMovementSchema,
  inventoryAdjustmentSchema,
  unitTypeLabels,
  type UnitType,
} from '@nexoloja/shared';
import {
  isClosedPrimary,
  isLowStock,
  replenishmentShortfall,
  splitWholeAndRemainder,
} from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { useMe } from '@/lib/useMe';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';

type Product = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stockQty: string;
  minStockQty: string;
  // ADR-017: tamanho da barra/rolo em metros (unidade fechada). Nulo ⇒ produto comum.
  conversionFactor: string | null;
};

/**
 * Saldo legível (ADR-017). Para unidade fechada (barra/rolo), o `stockQty` é em metros: mostra
 * "X barras + Y m". Para os demais, o número na unidade de venda, como sempre.
 */
function fmtStock(p: { unit: string; stockQty: string; conversionFactor: string | null }): string {
  const qty = Number(p.stockQty);
  if (isClosedPrimary({ unit: p.unit, conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null })) {
    const barLen = Number(p.conversionFactor);
    const { whole, remainderMeters } = splitWholeAndRemainder(qty, barLen);
    const unitName = unitTypeLabels[p.unit as UnitType].toLowerCase();
    return `${whole} ${unitName}${remainderMeters > 0 ? ` + ${QTY(remainderMeters)} m` : ''}`;
  }
  return QTY(qty);
}

type Supplier = { id: string; name: string };

/** Totais consolidados por produto (EF-2): Σ entradas / Σ saídas, vindos de `GET /stock/summary`. */
type StockSummaryRow = { productId: string; income: number; expense: number };

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
  const online = useOnline();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  // Resumo consolidado por produto (Σ entradas/saídas) para a visão "saldo × mínimo × histórico".
  const [summary, setSummary] = useState<Record<string, { income: number; expense: number }>>({});
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
      const [p, s, sum] = await Promise.all([
        apiGet<Product[]>('/products'),
        apiGet<Supplier[]>('/suppliers'),
        apiGet<StockSummaryRow[]>('/stock/summary'),
      ]);
      setProducts(p);
      setSuppliers(s);
      setSummary(
        Object.fromEntries(sum.map((r) => [r.productId, { income: r.income, expense: r.expense }])),
      );
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

  // Painel de reposição (EF-2): produtos no ponto de reposição (saldo ≤ mínimo, com mínimo
  // definido — regra pura `isLowStock` do core), já com a sugestão de quanto comprar
  // (`replenishmentShortfall`). Ordena zerados primeiro, depois a maior falta no topo.
  const replenish = useMemo(
    () =>
      products
        .map((p) => {
          const level = { stockQty: Number(p.stockQty), minStockQty: Number(p.minStockQty) };
          return {
            p,
            out: level.stockQty <= 0,
            shortfall: replenishmentShortfall(level),
            low: isLowStock(level),
          };
        })
        .filter((r) => r.low)
        .sort((a, b) => Number(b.out) - Number(a.out) || b.shortfall - a.shortfall),
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

  // ADR-017: produto de entrada é de unidade fechada? Então a quantidade digitada é em BARRAS.
  const entryProduct = products.find((p) => p.id === entry.productId);
  const entryClosed =
    !!entryProduct &&
    isClosedPrimary({
      unit: entryProduct.unit,
      conversionFactor: entryProduct.conversionFactor != null ? Number(entryProduct.conversionFactor) : null,
    });

  async function onEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // ADR-017: para unidade fechada a entrada é em BARRAS → converte para metros (ledger em
    // metros); o custo, se informado, é por barra → por metro.
    const barLen = entryClosed ? Number(entryProduct!.conversionFactor) : 1;
    const qtyMeters = entryClosed ? Number(entry.quantity) * barLen : Number(entry.quantity);
    const unitCostMeters = entry.unitCost
      ? entryClosed && barLen > 0
        ? Number(entry.unitCost) / barLen
        : Number(entry.unitCost)
      : undefined;

    const parsed = createStockMovementSchema.safeParse({
      productId: entry.productId,
      type: 'INCOME',
      quantity: qtyMeters,
      unitCost: unitCostMeters,
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

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />
      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-700">{notice}</p>}

      {/* Painel de reposição (EF-2): tudo que está no ponto de reposição num lugar só, com a
          sugestão de compra (quanto falta para voltar ao mínimo). Só aparece quando há itens. */}
      {replenish.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="font-semibold text-amber-900">Reposição de estoque</h2>
            <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-900">
              {replenish.length} {replenish.length === 1 ? 'item para repor' : 'itens para repor'}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-amber-100/70 text-left text-amber-900">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2 text-right">Em estoque</th>
                <th className="px-4 py-2 text-right">Mínimo</th>
                <th className="px-4 py-2 text-right">Comprar</th>
              </tr>
            </thead>
            <tbody>
              {replenish.map(({ p, out, shortfall }) => (
                <tr key={p.id} className="border-t border-amber-100">
                  <td className="px-4 py-2">
                    {p.name}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs font-medium ${
                        out ? 'bg-red-100 text-red-800' : 'bg-amber-200 text-amber-900'
                      }`}
                    >
                      {out ? 'zerado' : 'baixo'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-amber-800/70">{p.sku}</td>
                  <td
                    className={`px-4 py-2 text-right font-medium ${out ? 'text-red-700' : 'text-amber-800'}`}
                  >
                    {fmtStock(p)}
                  </td>
                  <td className="px-4 py-2 text-right text-amber-800/70">{QTY(p.minStockQty)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-amber-900">
                    +{QTY(shortfall)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-amber-800/80">
            “Comprar” é o quanto falta para o saldo voltar ao mínimo. Defina o mínimo de cada produto
            na tela de Produtos.
          </p>
        </div>
      )}

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
                  {p.name} ({fmtStock(p)} em estoque)
                </option>
              ))}
            </select>
            <input
              placeholder={entryClosed ? 'Quantidade (barras)' : 'Quantidade'}
              type="number"
              step={entryClosed ? '1' : 'any'}
              min="0"
              value={entry.quantity}
              onChange={(e) => setEntry({ ...entry, quantity: e.target.value })}
              title={entryClosed ? 'Quantas barras/rolos inteiros entram (convertido para metros pelo tamanho).' : undefined}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
            <input
              placeholder={entryClosed ? 'Custo por barra (opcional)' : 'Custo unitário (opcional)'}
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
                  {p.name} ({fmtStock(p)} em estoque)
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
          {replenish.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              {replenish.length} com estoque baixo
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
              <th className="px-4 py-2 text-right">Entradas</th>
              <th className="px-4 py-2 text-right">Saídas</th>
              <th className="px-4 py-2 text-right">Saldo (hist.)</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto cadastrado.
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const low = isLowStock({
                  stockQty: Number(p.stockQty),
                  minStockQty: Number(p.minStockQty),
                });
                const s = summary[p.id] ?? { income: 0, expense: 0 };
                // Saldo reconstruído do histórico (ADR-001): Σ entradas − Σ saídas. Deve bater
                // com o cache `stockQty`; quando diverge, sinalizamos (não é erro — dado antigo
                // sem movimento de origem também diverge).
                const reconciled = Number((s.income - s.expense).toFixed(4));
                const diverges = reconciled !== Number(p.stockQty);
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setFilters({ ...EMPTY_FILTERS, productId: p.id })}
                        title="Ver as movimentações deste produto"
                        className="text-left font-medium text-gray-900 hover:text-gray-600 hover:underline"
                      >
                        {p.name}
                      </button>
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
                      {fmtStock(p)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{QTY(p.minStockQty)}</td>
                    <td className="px-4 py-2 text-right text-green-700">{QTY(s.income)}</td>
                    <td className="px-4 py-2 text-right text-red-700">{QTY(s.expense)}</td>
                    <td
                      className={`px-4 py-2 text-right ${diverges ? 'text-amber-700' : 'text-gray-500'}`}
                      title={
                        diverges
                          ? `Saldo pelo histórico (Σ entradas − Σ saídas) = ${QTY(reconciled)}, diferente do saldo atual ${fmtStock(p)}.`
                          : 'Saldo confere com o histórico (ADR-001).'
                      }
                    >
                      {QTY(reconciled)}
                      {diverges && ' ⚠'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-gray-400">
          Entradas/Saídas são os totais do histórico; “Saldo (hist.)” é Σ entradas − Σ saídas (deve
          bater com o saldo atual — ADR-001). Clique no produto para ver suas movimentações abaixo.
        </p>
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
