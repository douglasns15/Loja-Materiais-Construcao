'use client';

import { useEffect, useMemo, useState } from 'react';
import { unitTypeLabels, type UnitType } from '@nexoloja/shared';
import { isClosedPrimary, splitWholeAndRemainder } from '@nexoloja/core';
import { apiGet } from '@/lib/api';

/**
 * Painel de **detalhe de estoque** de um produto (melhoria da tela de Estoque).
 *
 * Abre ao clicar no produto na tabela "Estoque atual". Mostra, num lugar só e sem
 * rolar a página:
 *  - as **características** do item (unidade, custo/venda, mínimo, peso, fabricante…);
 *  - o **histórico de movimentações daquele produto**, com filtros próprios (tipo,
 *    motivo, período) e **as justificativas** digitadas em Entrada/Ajuste — que antes
 *    não apareciam em lugar nenhum.
 *
 * É **somente leitura** (ADR-001): o saldo só muda por movimentação, nos formulários
 * de Entrada/Ajuste da própria tela de Estoque. Busca as movimentações sob demanda
 * (`GET /stock/movements?productId=`), então a lista abre sempre completa e fresca.
 */

/** Produto como a tela de Estoque o recebe de `GET /products` (campos usados aqui). */
export type StockProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stockQty: string;
  minStockQty: string;
  conversionFactor: string | null;
  popularName: string | null;
  manufacturer: string | null;
  description: string | null;
  costPrice: string;
  salePrice: string;
  altSalePrice: string | null;
  weightKg: string | null;
  marginPercent: number;
};

type Movement = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  quantity: string;
  unitCost: string | null;
  reason: string | null;
  createdAt: string;
  registeredByName: string | null;
  supplier: { name: string } | null;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

const DATETIME = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const EMPTY_FILTERS = { type: '', reason: '', dateFrom: '', dateTo: '' };

/** Quantas movimentações mostrar antes do "Mostrar mais" (evita tela corrida gigante). */
const PAGE = 30;

/** Saldo legível (ADR-017): unidade fechada (barra/rolo) vira "X barras + Y m". */
function stockLabel(p: StockProduct): string {
  const qty = Number(p.stockQty);
  const closed = isClosedPrimary({
    unit: p.unit,
    conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
  });
  if (!closed) return `${QTY(qty)} ${unitTypeLabels[p.unit as UnitType]}`;
  const barLen = Number(p.conversionFactor);
  const { whole, remainderMeters } = splitWholeAndRemainder(qty, barLen);
  const unitName = unitTypeLabels[p.unit as UnitType].toLowerCase();
  return `${whole} ${unitName}${remainderMeters > 0 ? ` + ${QTY(remainderMeters)} m` : ''}`;
}

export function StockDetail({
  product,
  summary,
  onClose,
}: {
  product: StockProduct;
  /** Totais consolidados (Σ entradas / Σ saídas) já carregados pela tela (EF-2). */
  summary: { income: number; expense: number };
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [limit, setLimit] = useState(PAGE);

  // Carrega o histórico do produto ao abrir (e ao trocar de produto com o painel aberto).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setFilters(EMPTY_FILTERS);
    setLimit(PAGE);
    apiGet<Movement[]>(`/stock/movements?productId=${encodeURIComponent(product.id)}`)
      .then((rows) => {
        if (alive) setMovements(rows);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [product.id]);

  // Esc fecha o painel (atalho de teclado no desktop — CLAUDE.md → menos cliques).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Filtros aplicados no cliente sobre o histórico já carregado (tipo, motivo, período).
  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (filters.type && m.type !== filters.type) return false;
      if (filters.reason) {
        const hay = `${m.reason ?? ''} ${m.supplier?.name ?? ''}`.toLowerCase();
        if (!hay.includes(filters.reason.toLowerCase())) return false;
      }
      const day = (m.createdAt ?? '').slice(0, 10);
      if (filters.dateFrom && day < filters.dateFrom) return false;
      if (filters.dateTo && day > filters.dateTo) return false;
      return true;
    });
  }, [movements, filters]);

  const filtersActive =
    filters.type || filters.reason || filters.dateFrom || filters.dateTo;

  const reconciled = Number((summary.income - summary.expense).toFixed(4));
  const diverges = reconciled !== Number(product.stockQty);
  const closed = isClosedPrimary({
    unit: product.unit,
    conversionFactor: product.conversionFactor != null ? Number(product.conversionFactor) : null,
  });

  const labelCls = 'text-xs font-medium text-gray-500';
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <dt className={labelCls}>{label}</dt>
      <dd className="text-sm text-gray-900">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Estoque de ${product.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        {/* Cabeçalho */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{product.name}</h2>
            <p className="truncate text-xs text-gray-500">
              {product.sku}
              {product.manufacturer ? ` · ${product.manufacturer}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Características do item (leitura) */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Row label="Nome popular" value={product.popularName} />
          <Row label="Unidade de venda" value={unitTypeLabels[product.unit as UnitType]} />
          <Row
            label="Peso"
            value={product.weightKg === null ? null : `${QTY(product.weightKg)} kg`}
          />
          <Row label={closed ? 'Custo da barra' : 'Custo'} value={BRL(product.costPrice)} />
          <Row label={closed ? 'Preço da barra' : 'Venda'} value={BRL(product.salePrice)} />
          <Row label="Margem" value={`${product.marginPercent}%`} />
          {closed && (
            <Row
              label="Venda por metro"
              value={product.altSalePrice ? `${BRL(product.altSalePrice)}/m` : null}
            />
          )}
          <Row
            label="Estoque atual"
            value={<span className="font-medium">{stockLabel(product)}</span>}
          />
          <Row label="Estoque mínimo" value={QTY(product.minStockQty)} />
          <Row label="Entradas (Σ)" value={<span className="text-green-700">{QTY(summary.income)}</span>} />
          <Row label="Saídas (Σ)" value={<span className="text-red-700">{QTY(summary.expense)}</span>} />
          <Row
            label="Saldo (hist.)"
            value={
              <span className={diverges ? 'text-amber-700' : ''} title={
                diverges
                  ? `Σ entradas − Σ saídas = ${QTY(reconciled)}, diferente do saldo atual.`
                  : 'Confere com o histórico (ADR-001).'
              }>
                {QTY(reconciled)}
                {diverges && ' ⚠'}
              </span>
            }
          />
          {product.description && (
            <div className="col-span-2 sm:col-span-3">
              <dt className={labelCls}>Descrição / observação</dt>
              <dd className="whitespace-pre-wrap text-sm text-gray-900">{product.description}</dd>
            </div>
          )}
        </dl>

        {/* Histórico de movimentações do produto */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Movimentações</h3>
            <span className="text-xs text-gray-400">
              {filtered.length} de {movements.length}
            </span>
          </div>

          {/* Filtros do histórico */}
          <div className="mb-3 flex flex-wrap items-end gap-2">
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

          {loading ? (
            <p className="py-6 text-center text-sm text-gray-400">Carregando movimentações…</p>
          ) : error ? (
            <p className="py-6 text-center text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              {movements.length === 0
                ? 'Nenhuma movimentação para este produto.'
                : 'Nenhuma movimentação para os filtros selecionados.'}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-right">Qtd</th>
                      <th className="px-3 py-2 text-right">Custo un.</th>
                      <th className="px-3 py-2">Motivo</th>
                      <th className="px-3 py-2">Registrado por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, limit).map((m) => (
                      <tr key={m.id} className="border-t border-gray-100">
                        <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                          {DATETIME(m.createdAt)}
                        </td>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2 text-right">{QTY(m.quantity)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {m.unitCost ? BRL(m.unitCost) : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {m.reason ?? '—'}
                          {m.supplier?.name ? ` · ${m.supplier.name}` : ''}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{m.registeredByName ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > limit && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE)}
                    className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Mostrar mais ({filtered.length - limit})
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
