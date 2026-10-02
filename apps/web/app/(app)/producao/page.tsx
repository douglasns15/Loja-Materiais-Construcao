'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  createProductionSchema,
  formatProductionNumber,
  type ProductionRow,
  type RecipeRow,
} from '@nexoloja/shared';
import { productionCost, productionShortages, scaleRecipe } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { OfflineNotice } from '@/components/OfflineNotice';
import { fmtQty, parseQty, unitShort } from '@/components/RecipeSection';

/**
 * Produção (ADR-043): escolhe o produto pronto (os que têm ficha técnica), informa quanto produziu
 * (por peças, quando vende inteiro, ou por peso/quantidade) e confirma. A tela preenche os insumos
 * pela ficha; o operador corrige o que usou de fato. Insumo controlado sem saldo bloqueia (decisão do
 * Owner). À direita, as produções de hoje. Qualquer usuário registra; a ficha é do Admin.
 */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function ProducaoPage() {
  const { isAdmin } = useMe();
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [today, setToday] = useState<ProductionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [pieces, setPieces] = useState('');
  const [qty, setQty] = useState('');
  const [used, setUsed] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      apiGet<RecipeRow[]>('/productions/recipes'),
      apiGet<ProductionRow[]>('/productions'),
    ]);
    setRecipes(r);
    setToday(p);
  }, []);

  const reload = useCallback(() => {
    load()
      .then(() => {
        setLoadFailed(false);
        setError(null);
      })
      .catch((e) => {
        setError((e as Error).message);
        setLoadFailed(true);
      })
      .finally(() => setLoaded(true));
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);
  useReloadOnReconnect(reload, loadFailed);

  const recipe = recipes.find((r) => r.productId === selectedId) ?? null;
  const outQty = parseQty(qty);

  /** Preenche "usado de fato" pela ficha para a quantidade informada. */
  function fillFromRecipe(r: RecipeRow, q: number) {
    const need = scaleRecipe(r, q);
    const next: Record<string, string> = {};
    for (const it of r.items) {
      const n = need.find((x) => x.productId === it.productId)?.quantity ?? 0;
      next[it.productId] = q > 0 ? fmtQty(n, it.unit) : '';
    }
    setUsed(next);
  }

  function choose(r: RecipeRow) {
    setSelectedId(r.productId);
    setDone(null);
    setError(null);
    setNotes('');
    // Começa com uma "fornada" da ficha: 1 peça (vendido inteiro) ou o rendimento da ficha.
    if (r.pieceWeight) {
      setPieces('1');
      const q = r.pieceWeight;
      setQty(fmtQty(q, r.unit));
      fillFromRecipe(r, q);
    } else {
      setPieces('');
      setQty(fmtQty(r.yieldQty, r.unit));
      fillFromRecipe(r, r.yieldQty);
    }
  }

  function onPieces(v: string) {
    setPieces(v);
    if (!recipe?.pieceWeight) return;
    const n = parseQty(v);
    const q = n > 0 ? Number((n * recipe.pieceWeight).toFixed(3)) : 0;
    setQty(q > 0 ? fmtQty(q, recipe.unit) : '');
    fillFromRecipe(recipe, q);
  }

  function onQty(v: string) {
    setQty(v);
    if (!recipe) return;
    const q = parseQty(v);
    // Peso real corrigido à mão: recalcula os insumos pela ficha (o operador ainda pode ajustar).
    fillFromRecipe(recipe, q > 0 ? q : 0);
  }

  const lines = useMemo(
    () =>
      recipe
        ? recipe.items.map((it) => {
            const u = parseQty(used[it.productId] ?? '');
            return { ...it, used: u >= 0 ? u : NaN };
          })
        : [],
    [recipe, used],
  );
  const cost = productionCost(
    lines.filter((l) => l.used > 0).map((l) => ({ quantity: l.used, unitCost: l.unitCost })),
    outQty > 0 ? outQty : 0,
  );
  const shortages = productionShortages(
    lines.map((l) => ({
      productId: l.productId,
      quantity: l.used > 0 ? l.used : 0,
      tracked: l.trackStock,
      available: l.available ?? 0,
    })),
  );
  const shortOf = (id: string) => shortages.find((s) => s.productId === id);
  const firstShort = shortages[0] ? recipe?.items.find((i) => i.productId === shortages[0]!.productId) : null;
  const badLine = lines.some((l) => Number.isNaN(l.used));
  const canSubmit = !!recipe && outQty > 0 && !badLine && shortages.length === 0 && lines.some((l) => l.used > 0);

  async function register() {
    if (!recipe) return;
    setError(null);
    setDone(null);
    const parsed = createProductionSchema.safeParse({
      productId: recipe.productId,
      quantity: outQty,
      inputs: lines.map((l) => ({ productId: l.productId, quantity: l.used > 0 ? l.used : 0 })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira as quantidades.');
      return;
    }
    setBusy(true);
    try {
      const p = await apiPost<ProductionRow>('/productions', parsed.data);
      const out = p.outputs[0];
      setDone(
        `${formatProductionNumber(p.productionNumber)} registrada: entraram ${
          out ? `${fmtQty(out.quantity, out.unit)} ${unitShort(out.unit)} de ${out.name}` : 'os prontos'
        } e saíram os insumos do estoque.`,
      );
      setSelectedId('');
      setUsed({});
      setQty('');
      setPieces('');
      setNotes('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="text-gray-600">Carregando…</p>;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Produção
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        Registre o que foi produzido na loja: os insumos saem do estoque e o produto pronto entra, com o custo
        real calculado pela ficha técnica.
      </p>

      <OfflineNotice />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {done && (
        <p role="status" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {done}
        </p>
      )}

      <div className="grid gap-4 lg:[grid-template-columns:minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
          <div className="bg-indigo-600 px-5 py-3 text-white">
            <h2 className="text-base font-bold">Nova produção</h2>
            <p className="text-xs text-indigo-100">Escolha o produto pronto</p>
          </div>
          <div className="space-y-4 p-5">
            {recipes.length === 0 ? (
              <p className="text-sm text-gray-600">
                Nenhum produto tem ficha técnica ainda.{' '}
                {isAdmin ? (
                  <>
                    Abra o produto pronto em{' '}
                    <Link href="/products" className="font-medium text-indigo-700 hover:underline">
                      Produtos
                    </Link>{' '}
                    e use “Criar ficha técnica”.
                  </>
                ) : (
                  'Peça ao administrador para cadastrar a ficha técnica do produto.'
                )}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Produto pronto">
                {recipes.map((r) => (
                  <button
                    key={r.productId}
                    type="button"
                    onClick={() => choose(r)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedId === r.productId
                        ? 'border-indigo-600 bg-indigo-50 font-semibold text-indigo-800 ring-1 ring-indigo-600'
                        : 'border-gray-300 bg-white text-gray-800 hover:border-indigo-400'
                    }`}
                  >
                    {r.productName}
                    <span className="block text-xs font-normal text-gray-500 tabular-nums">
                      em estoque: {fmtQty(r.stockQty, r.unit)} {unitShort(r.unit)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {recipe && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  {recipe.pieceWeight && (
                    <label className="text-xs font-semibold text-gray-600">
                      Peças
                      <input
                        id="pr-pieces"
                        value={pieces}
                        onChange={(e) => onPieces(e.target.value)}
                        inputMode="numeric"
                        className="mt-1 block w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
                      />
                    </label>
                  )}
                  <label className="text-xs font-semibold text-gray-600">
                    {recipe.pieceWeight ? `Peso total (${unitShort(recipe.unit)})` : `Quantidade (${unitShort(recipe.unit)})`}
                    <input
                      id="pr-qty"
                      value={qty}
                      onChange={(e) => onQty(e.target.value)}
                      inputMode="decimal"
                      className="mt-1 block w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
                    />
                  </label>
                </div>
                {recipe.pieceWeight && (
                  <p className="text-xs text-gray-500">
                    Peso sugerido = peças × {fmtQty(recipe.pieceWeight, recipe.unit)} {unitShort(recipe.unit)} (peso médio
                    do cadastro). Se pesar a bandeja, corrija para o peso real.
                  </p>
                )}

                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2">Insumo</th>
                        <th className="px-3 py-2 text-right">Pela ficha</th>
                        <th className="px-3 py-2 text-right">Usado de fato</th>
                        <th className="px-3 py-2 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const need = scaleRecipe(recipe, outQty > 0 ? outQty : 0).find((x) => x.productId === l.productId);
                        const short = shortOf(l.productId);
                        return (
                          <tr key={l.productId} className="border-t border-gray-100">
                            <td className="px-3 py-2">{l.name}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                              {need ? `${fmtQty(need.quantity, l.unit)} ${unitShort(l.unit)}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="inline-flex items-center gap-1">
                                <input
                                  value={used[l.productId] ?? ''}
                                  onChange={(e) => setUsed((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                                  inputMode="decimal"
                                  aria-label={`${l.name}: usado de fato`}
                                  className={`w-24 rounded-lg border px-2 py-1 text-right tabular-nums ${
                                    Number.isNaN(l.used) ? 'border-red-400' : 'border-gray-300'
                                  }`}
                                />
                                <span className="w-6 text-left text-xs text-gray-500">{unitShort(l.unit)}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {l.trackStock ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                    short ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  tem {fmtQty(l.available ?? 0, l.unit)}
                                </span>
                              ) : (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                  sem controle
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <span>
                    Custo da produção: <strong className="tabular-nums">{BRL(cost.totalCost)}</strong>
                  </span>
                  <span>
                    Custo por {unitShort(recipe.unit)}:{' '}
                    <strong className="tabular-nums">{outQty > 0 ? BRL(cost.unitCost) : '—'}</strong>
                  </span>
                  {recipe.salePrice > 0 && outQty > 0 && (
                    <span>
                      Margem:{' '}
                      <strong className="tabular-nums">
                        {(((recipe.salePrice - cost.unitCost) / recipe.salePrice) * 100).toFixed(0)}%
                      </strong>
                    </span>
                  )}
                </div>

                {firstShort && shortages[0] && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Falta saldo de {firstShort.name} (tem {fmtQty(shortages[0].available, firstShort.unit)}, precisa{' '}
                    {fmtQty(shortages[0].needed, firstShort.unit)}). Dê entrada na tela{' '}
                    <Link href="/estoque" className="font-semibold underline">
                      Estoque
                    </Link>{' '}
                    antes de produzir.
                  </p>
                )}

                <input
                  id="pr-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={300}
                  placeholder="Observação (opcional) — ex.: 1 frango estava ruim"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={register}
                    disabled={busy || !canSubmit}
                    className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy ? 'Registrando…' : 'Registrar produção'}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-800">Produções de hoje</h2>
          {today.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma produção registrada hoje.</p>
          ) : (
            today.map((p) => {
              const out = p.outputs[0];
              return (
                <div key={p.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2 font-semibold text-gray-900">
                    <span className="truncate">
                      {formatProductionNumber(p.productionNumber)} · {out?.name ?? '—'}
                    </span>
                    {out && (
                      <span className="shrink-0 tabular-nums">
                        {fmtQty(out.quantity, out.unit)} {unitShort(out.unit)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {hm(p.createdAt)}
                    {p.registeredByName ? ` · ${p.registeredByName}` : ''} · custo {BRL(p.totalCost)}
                    {out?.unitCost != null ? ` (${BRL(out.unitCost)}/${unitShort(out.unit)})` : ''}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    usou{' '}
                    {p.inputs.map((i) => `${fmtQty(i.quantity, i.unit)} ${unitShort(i.unit)} ${i.name}`).join(', ')}
                  </div>
                  {p.notes && <div className="text-xs italic text-gray-500">{p.notes}</div>}
                </div>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
