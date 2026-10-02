'use client';

import { useEffect, useMemo, useState } from 'react';
import { recipeSchema, unitTypeLabels, type RecipeRow, type UnitType } from '@nexoloja/shared';
import { costPerBaseUnit } from '@nexoloja/core';
import { apiDelete, apiGet, apiPatch, apiPut } from '@/lib/api';
import { ProductPicker } from '@/components/ProductPicker';

/**
 * Ficha técnica do produto PRONTO (ADR-043), no detalhe do produto: "para produzir N, uso estes
 * insumos". Mostra custo por unidade e margem; o Admin cria/edita/exclui (a API também barra). Só
 * aparece com o módulo RECIPES (o ProductDetail decide). Quantidades em unidade-base.
 */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulo curto da unidade-base (kg, L, un…). */
export function unitShort(u: string): string {
  if (u === 'KILOGRAM') return 'kg';
  if (u === 'LITER') return 'L';
  if (u === 'UNIT') return 'un';
  return (unitTypeLabels[u as UnitType] ?? u).toLowerCase();
}

/** Quantidade com as casas que fazem sentido (kg/L: 3; demais: até 4, sem zeros inúteis). */
export function fmtQty(n: number, unit: string): string {
  const weighed = unit === 'KILOGRAM' || unit === 'LITER';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: weighed ? 3 : 0,
    maximumFractionDigits: weighed ? 3 : 4,
  });
}

/**
 * "1,2" / "1.2" / "1.234,5" → número (vazio/inválido ⇒ NaN). Com vírgula, o ponto é separador de
 * milhar; sem vírgula, o ponto é o decimal (quem digita "1.2" quer 1,2 — não 12).
 */
export function parseQty(s: string): number {
  const raw = s.trim();
  if (!raw) return NaN;
  const t = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  return Number(t);
}

/** Produto do catálogo como o editor precisa (seletor + custo + unidade). */
export type RecipeCatalogProduct = {
  id: string;
  name: string;
  sku: string;
  popularName: string | null;
  manufacturer: string | null;
  unit: string;
  costPrice: string;
  conversionFactor: string | null;
  stockQty: string;
  trackStock?: boolean;
};

type DraftItem = { productId: string; quantity: string };

export function RecipeSection({
  product,
  allProducts,
  isAdmin,
  onProductChanged,
}: {
  product: { id: string; name: string; unit: string; salePrice: string; trackStock?: boolean };
  allProducts: RecipeCatalogProduct[];
  isAdmin: boolean;
  /** Após ligar "Controlar estoque" daqui (o pronto precisa controlar), a tela recarrega o produto. */
  onProductChanged: () => Promise<void> | void;
}) {
  const [recipe, setRecipe] = useState<RecipeRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [yieldQty, setYieldQty] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet<RecipeRow | null>(`/productions/recipes/${product.id}`)
      .then((r) => alive && setRecipe(r))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [product.id]);

  const byId = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);
  // Insumo não pode ser o próprio pronto.
  const candidates = useMemo(() => allProducts.filter((p) => p.id !== product.id), [allProducts, product.id]);
  const unitOut = unitShort(product.unit);
  const tracked = product.trackStock !== false;

  function startEdit() {
    setError(null);
    setConfirmDelete(false);
    if (recipe) {
      setYieldQty(fmtQty(recipe.yieldQty, product.unit));
      setNotes(recipe.notes ?? '');
      setItems(recipe.items.map((it) => ({ productId: it.productId, quantity: fmtQty(it.quantity, it.unit) })));
    } else {
      setYieldQty(product.unit === 'KILOGRAM' || product.unit === 'LITER' ? '1,000' : '1');
      setNotes('');
      setItems([{ productId: '', quantity: '' }]);
    }
    setEditing(true);
  }

  // Custo previsto da ficha em edição (custo do cadastro de cada insumo, por unidade-base).
  const draftCost = useMemo(() => {
    let total = 0;
    for (const it of items) {
      const p = byId.get(it.productId);
      const q = parseQty(it.quantity);
      if (!p || !(q > 0)) continue;
      total +=
        q *
        costPerBaseUnit({
          unit: p.unit,
          conversionFactor: p.conversionFactor != null ? Number(p.conversionFactor) : null,
          costPrice: Number(p.costPrice),
        });
    }
    const y = parseQty(yieldQty);
    return y > 0 ? total / y : 0;
  }, [items, yieldQty, byId]);

  async function enableStock() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/products/${product.id}`, { trackStock: true });
      await onProductChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    const parsed = recipeSchema.safeParse({
      yieldQty: parseQty(yieldQty),
      notes: notes.trim() || null,
      items: items
        .filter((it) => it.productId || it.quantity.trim())
        .map((it) => ({ productId: it.productId, quantity: parseQty(it.quantity) })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === 'items' && issue.path.length > 1
          ? 'Escolha o insumo e informe a quantidade em cada linha.'
          : issue?.path[0] === 'yieldQty'
            ? 'Informe quanto a ficha rende.'
            : (issue?.message ?? 'Confira a ficha.'),
      );
      return;
    }
    setBusy(true);
    try {
      setRecipe(await apiPut<RecipeRow>(`/productions/recipes/${product.id}`, parsed.data));
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/productions/recipes/${product.id}`);
      setRecipe(null);
      setConfirmDelete(false);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const sale = Number(product.salePrice);
  const viewCost = recipe
    ? recipe.items.reduce((acc, it) => acc + it.quantity * it.unitCost, 0) / (recipe.yieldQty || 1)
    : 0;
  const margin = sale > 0 ? ((sale - viewCost) / sale) * 100 : null;

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-indigo-900">Ficha técnica</span>
        {isAdmin && !editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              {recipe ? 'Editar ficha' : 'Criar ficha técnica'}
            </button>
            {recipe &&
              (confirmDelete ? (
                <>
                  <span className="text-xs text-red-700">Excluir a ficha?</span>
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    Excluir
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700"
                  >
                    Manter
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Excluir
                </button>
              ))}
          </div>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      {!editing ? (
        recipe ? (
          <div className="space-y-2 text-sm">
            <p className="text-gray-700">
              Para produzir <strong className="tabular-nums">{fmtQty(recipe.yieldQty, product.unit)} {unitOut}</strong> de{' '}
              {product.name}, uso:
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-1.5">Insumo</th>
                    <th className="px-3 py-1.5 text-right">Quantidade</th>
                    <th className="px-3 py-1.5 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {recipe.items.map((it) => (
                    <tr key={it.productId} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">
                        {it.name}
                        {!it.trackStock && <span className="ml-1 text-xs text-amber-700">(sem controle · só custo)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtQty(it.quantity, it.unit)} {unitShort(it.unit)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{BRL(it.quantity * it.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-white px-3 py-2 text-sm">
              <span>
                Custo por {unitOut}: <strong className="tabular-nums">{BRL(viewCost)}</strong>
              </span>
              <span>
                Preço de venda: <strong className="tabular-nums">{BRL(sale)}</strong>
              </span>
              {margin != null && (
                <span>
                  Margem: <strong className={`tabular-nums ${margin < 0 ? 'text-red-600' : ''}`}>{margin.toFixed(0)}%</strong>
                </span>
              )}
            </div>
            {recipe.notes && <p className="whitespace-pre-wrap text-xs text-gray-600">{recipe.notes}</p>}
            <p className="text-xs text-gray-500">Para produzir, use a tela Produção (menu Estoque › Produção).</p>
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            Sem ficha técnica. Crie uma se este produto é feito na loja a partir de outros (ex.: frango assado a
            partir do frango cru).
          </p>
        )
      ) : (
        <div className="space-y-3 text-sm">
          {!tracked && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>Para ter ficha técnica, o produto pronto precisa controlar estoque.</span>
              <button
                type="button"
                onClick={enableStock}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                Ligar controle de estoque
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span>Para produzir</span>
            <input
              id="rc-yield"
              value={yieldQty}
              onChange={(e) => setYieldQty(e.target.value)}
              inputMode="decimal"
              className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-right tabular-nums"
              aria-label="Quanto a ficha rende"
            />
            <span>
              {unitOut} de {product.name}, uso:
            </span>
          </div>
          {(product.unit === 'KILOGRAM' || product.unit === 'LITER') && (
            <p className="text-xs text-gray-500">
              O rendimento já inclui a perda no preparo: 1 kg de carne crua que vira 650 g assada rende 0,650.
            </p>
          )}
          <div className="space-y-2">
            {items.map((it, idx) => {
              const p = byId.get(it.productId);
              return (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
                  <div className="min-w-[14rem] flex-1">
                    <ProductPicker
                      products={candidates}
                      value={it.productId}
                      onChange={(id) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, productId: id } : x)))}
                      formatStock={(c) => `${fmtQty(Number(c.stockQty), c.unit)} ${unitShort(c.unit)} em estoque`}
                      placeholder="Buscar insumo…"
                    />
                  </div>
                  <input
                    value={it.quantity}
                    onChange={(e) =>
                      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                    }
                    inputMode="decimal"
                    placeholder="Qtd."
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right tabular-nums"
                    aria-label="Quantidade do insumo"
                  />
                  <span className="w-8 text-xs text-gray-500">{p ? unitShort(p.unit) : ''}</span>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="px-1 text-gray-400 hover:text-red-600"
                    aria-label="Remover insumo"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, { productId: '', quantity: '' }])}
              className="text-xs font-semibold text-indigo-700 hover:underline"
            >
              + Adicionar insumo
            </button>
          </div>
          <textarea
            id="rc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Modo de preparo ou observação (opcional)"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-700">
              Custo previsto por {unitOut}: <strong className="tabular-nums">{BRL(draftCost)}</strong>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !tracked}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? 'Salvando…' : 'Salvar ficha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
