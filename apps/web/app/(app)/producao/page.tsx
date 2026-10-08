'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PRODUCTION_LOSS_REASONS,
  createProductionSchema,
  formatProductionNumber,
  productionLossReasonLabels,
  productionLossSchema,
  type ProductionDaySummary,
  type ProductionLossReason,
  type ProductionLossRow,
  type ProductionRow,
  type ProductionSummaryRow,
  type RecipeRow,
} from '@nexoloja/shared';
import { productionCost, productionShortages, scaleRecipe } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useReloadOnReconnect } from '@/lib/useReloadOnReconnect';
import { OfflineNotice } from '@/components/OfflineNotice';
import { BreakdownForm } from '@/components/BreakdownForm';
import { fmtQty, parseQty, unitShort } from '@/components/RecipeSection';

/**
 * Produção (ADR-043): escolhe o produto pronto (os que têm ficha técnica), informa quanto produziu
 * (por peças, quando vende inteiro, ou por peso/quantidade) e confirma. A tela preenche os insumos
 * pela ficha; o operador corrige o que usou de fato. Insumo controlado sem saldo bloqueia (decisão do
 * Owner). À direita, as produções de hoje. Qualquer usuário registra; a ficha é do Admin.
 *
 * Fatia 2 (ADR-043 §3): "Resumo do dia" — produzido × vendido × perda × em estoque por produto
 * pronto — com "Registrar perda" (sobra do dia, queimou, caiu) e a lista das perdas. O seletor de
 * dia abre o histórico (produções P-, resumo e perdas de dias anteriores); registrar é sempre hoje.
 *
 * Fatia 3: aba "Desmembrar" (peça → cortes, `BreakdownForm`) ao lado de "Pela ficha" — o mesmo
 * evento P-, que aparece na lista do dia como "Desmembrou …"; os cortes entram no resumo e na perda.
 */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** Hoje no fuso da loja (-03:00), igual à API. */
const todayStr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
/** "2026-10-07" → "07/10". */
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** "≈ N peças" para o pronto vendido inteiro (ADR-040 §4). */
const piecesHint = (qty: number, pieceWeight: number | null) => {
  if (!pieceWeight || !(qty > 0)) return null;
  const n = Math.round(qty / pieceWeight);
  return n > 0 ? `≈ ${n} ${n === 1 ? 'peça' : 'peças'}` : null;
};

export default function ProducaoPage() {
  const { isAdmin } = useMe();
  const [day, setDay] = useState(todayStr);
  const isToday = day === todayStr();
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [today, setToday] = useState<ProductionRow[]>([]);
  const [summary, setSummary] = useState<ProductionDaySummary | null>(null);
  const [lossFor, setLossFor] = useState<ProductionSummaryRow | null>(null);
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
  const [mode, setMode] = useState<'recipe' | 'breakdown'>('recipe');

  // Trocar o dia pelas setas do campo de data dispara uma busca por dia; as respostas podem chegar
  // fora de ordem. Só a busca mais recente vale (senão "Resumo de 02/10" mostrava os dados do dia 03).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const [r, p, s] = await Promise.all([
      apiGet<RecipeRow[]>('/productions/recipes'),
      apiGet<ProductionRow[]>(`/productions?day=${day}`),
      apiGet<ProductionDaySummary>(`/productions/summary?day=${day}`),
    ]);
    if (seq !== loadSeq.current) return;
    setRecipes(r);
    setToday(p);
    setSummary(s);
  }, [day]);

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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
            Produção
          </h1>
          <p className="text-sm text-gray-500">
            Registre o que foi produzido na loja: os insumos saem do estoque e o produto pronto entra, com o custo
            real calculado pela ficha técnica.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-semibold text-gray-600">
            Dia
            <input
              id="pr-day"
              type="date"
              value={day}
              max={todayStr()}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDay(todayStr())}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      <OfflineNotice />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {done && (
        <p role="status" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {done}
        </p>
      )}

      <div className="grid gap-4 lg:[grid-template-columns:minmax(0,1fr)_340px]">
        {!isToday ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-md">
            Você está vendo o dia <strong>{ddmm(day)}</strong>. Produção e perda são registradas sempre no dia de
            hoje —{' '}
            <button type="button" onClick={() => setDay(todayStr())} className="font-semibold text-indigo-700 hover:underline">
              voltar para hoje
            </button>
            .
          </section>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-600 px-5 py-3 text-white">
              <div>
                <h2 className="text-base font-bold">Nova produção</h2>
                <p className="text-xs text-indigo-100">
                  {mode === 'recipe' ? 'Escolha o produto pronto' : 'Escolha a peça e pese os cortes'}
                </p>
              </div>
              <div className="flex rounded-lg bg-indigo-700/60 p-0.5 text-sm" role="group" aria-label="Tipo de produção">
                {(
                  [
                    ['recipe', 'Pela ficha'],
                    ['breakdown', 'Desmembrar'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m);
                      setDone(null);
                      setError(null);
                    }}
                    aria-pressed={mode === m}
                    className={`rounded-md px-3 py-1 font-semibold ${
                      mode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-100 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {mode === 'breakdown' ? (
              <div className="p-5">
                <BreakdownForm
                  onDone={async (_row, message) => {
                    setDone(message);
                    setError(null);
                    await load().catch((e) => setError((e as Error).message));
                  }}
                />
              </div>
            ) : (
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
            )}
          </section>
        )}

        <aside className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm order-last lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 className="text-sm font-bold text-gray-800">{isToday ? 'Produções de hoje' : `Produções de ${ddmm(day)}`}</h2>
          {today.length === 0 ? (
            <p className="text-sm text-gray-500">{isToday ? 'Nenhuma produção registrada hoje.' : 'Nenhuma produção neste dia.'}</p>
          ) : (
            today.map((p) => {
              if (p.kind === 'BREAKDOWN') return <BreakdownCard key={p.id} p={p} />;
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

          {summary && summary.losses.length > 0 && (
            <>
              <h2 className="pt-2 text-sm font-bold text-gray-800">Perdas</h2>
              {summary.losses.map((l) => (
                <div key={l.id} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2 font-semibold text-gray-900">
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0 tabular-nums text-red-700">
                      −{fmtQty(l.quantity, l.unit)} {unitShort(l.unit)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {hm(l.createdAt)}
                    {l.registeredByName ? ` · ${l.registeredByName}` : ''} · {l.reason}
                    {l.unitCost != null && l.unitCost > 0 ? ` · ${BRL(l.unitCost * l.quantity)}` : ''}
                  </div>
                </div>
              ))}
            </>
          )}
        </aside>

        <SummaryCard
          summary={summary}
          isToday={isToday}
          day={day}
          onLoss={(row) => {
            setDone(null);
            setError(null);
            setLossFor(row);
          }}
        />
      </div>

      {lossFor && (
        <LossModal
          row={lossFor}
          onClose={() => setLossFor(null)}
          onSaved={async (l) => {
            setLossFor(null);
            setDone(`Perda registrada: ${fmtQty(l.quantity, l.unit)} ${unitShort(l.unit)} de ${l.name} (${l.reason}).`);
            await load().catch((e) => setError((e as Error).message));
          }}
        />
      )}
    </div>
  );
}

/** Desmembramento na lista do dia (Fatia 3): a peça que saiu, os cortes que entraram e a quebra. */
function BreakdownCard({ p }: { p: ProductionRow }) {
  const piece = p.inputs[0];
  const sameUnit = !!piece && p.outputs.every((o) => o.unit === piece.unit);
  const cutsTotal = p.outputs.reduce((a, o) => a + o.quantity, 0);
  const shrink = piece && sameUnit ? piece.quantity - cutsTotal : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
      <div className="flex justify-between gap-2 font-semibold text-gray-900">
        <span className="truncate">
          {formatProductionNumber(p.productionNumber)} · Desmembrou {piece?.name ?? '—'}
        </span>
        {piece && (
          <span className="shrink-0 tabular-nums">
            {fmtQty(piece.quantity, piece.unit)} {unitShort(piece.unit)}
          </span>
        )}
      </div>
      <div className="text-xs text-gray-500">
        {hm(p.createdAt)}
        {p.registeredByName ? ` · ${p.registeredByName}` : ''} · custo {BRL(p.totalCost)}
        {shrink != null && shrink > 0 && piece ? ` · quebra ${fmtQty(shrink, piece.unit)} ${unitShort(piece.unit)}` : ''}
      </div>
      <div className="text-xs text-gray-500">
        gerou{' '}
        {p.outputs
          .map(
            (o) =>
              `${fmtQty(o.quantity, o.unit)} ${unitShort(o.unit)} ${o.name}${
                o.unitCost != null && o.unitCost > 0 ? ` (${BRL(o.unitCost)}/${unitShort(o.unit)})` : ''
              }`,
          )
          .join(', ')}
      </div>
      {p.notes && <div className="text-xs italic text-gray-500">{p.notes}</div>}
    </div>
  );
}

/** Resumo do dia: produzido × vendido × perda × em estoque por produto pronto (ADR-043 §3). */
function SummaryCard({
  summary,
  isToday,
  day,
  onLoss,
}: {
  summary: ProductionDaySummary | null;
  isToday: boolean;
  day: string;
  onLoss: (row: ProductionSummaryRow) => void;
}) {
  const rows = summary?.products ?? [];
  const lossCost = (summary?.losses ?? []).reduce((acc, l) => acc + (l.unitCost ?? 0) * l.quantity, 0);
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">{isToday ? 'Resumo do dia' : `Resumo de ${ddmm(day)}`}</h2>
          <p className="text-xs text-gray-500">Produzido × vendido × perda — e o que ainda está no estoque agora.</p>
        </div>
        {lossCost > 0 && (
          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 tabular-nums">
            Perdas no custo: {BRL(lossCost)}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-gray-500">Nada produzido, vendido ou em estoque entre os produtos feitos na loja.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th className="px-4 py-2">Produto</th>
                <th className="px-3 py-2 text-right">Produzido</th>
                <th className="px-3 py-2 text-right">Vendido</th>
                <th className="px-3 py-2 text-right">Perda</th>
                <th className="px-3 py-2 text-right">Em estoque agora</th>
                {isToday && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cell = (n: number) => (n > 0 ? `${fmtQty(n, r.unit)} ${unitShort(r.unit)}` : '—');
                const hint = piecesHint(r.stockQty, r.pieceWeight);
                return (
                  <tr key={r.productId} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">{cell(r.produced)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">{cell(r.sold)}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.lost > 0 ? 'text-red-700' : 'text-gray-700'}`}>
                      {cell(r.lost)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                      {fmtQty(r.stockQty, r.unit)} {unitShort(r.unit)}
                      {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
                    </td>
                    {isToday && (
                      <td className="px-3 py-2 text-right">
                        {r.stockQty > 0 && (
                          <button
                            type="button"
                            onClick={() => onLoss(r)}
                            className="whitespace-nowrap rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Registrar perda
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Registrar perda do pronto (sobra do dia, queimou, caiu…): sai do estoque com o motivo. */
function LossModal({
  row,
  onClose,
  onSaved,
}: {
  row: ProductionSummaryRow;
  onClose: () => void;
  onSaved: (loss: ProductionLossRow) => Promise<void>;
}) {
  const [pieces, setPieces] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<ProductionLossReason>('LEFTOVER');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc fecha (atalho de teclado no desktop — CLAUDE.md → menos cliques).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function onPieces(v: string) {
    setPieces(v);
    if (!row.pieceWeight) return;
    const n = parseQty(v);
    setQty(n > 0 ? fmtQty(Number((n * row.pieceWeight).toFixed(3)), row.unit) : '');
  }

  async function confirm() {
    setError(null);
    const q = parseQty(qty);
    const parsed = productionLossSchema.safeParse({
      productId: row.productId,
      quantity: q,
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(q > 0 ? (parsed.error.issues[0]?.message ?? 'Confira os dados.') : 'Informe a quantidade perdida.');
      return;
    }
    if (q > row.stockQty) {
      setError(`Só há ${fmtQty(row.stockQty, row.unit)} ${unitShort(row.unit)} em estoque.`);
      return;
    }
    setBusy(true);
    try {
      const l = await apiPost<ProductionLossRow>('/productions/loss', parsed.data);
      await onSaved(l);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Registrar perda"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 className="text-lg font-bold text-gray-900">Registrar perda</h2>
        <p className="mb-4 text-sm text-gray-500">
          {row.name} — em estoque: {fmtQty(row.stockQty, row.unit)} {unitShort(row.unit)}
          {piecesHint(row.stockQty, row.pieceWeight) ? ` (${piecesHint(row.stockQty, row.pieceWeight)})` : ''}
        </p>

        <div className="flex flex-wrap items-end gap-3">
          {row.pieceWeight && (
            <label className="text-xs font-semibold text-gray-600">
              Peças
              <input
                autoFocus
                value={pieces}
                onChange={(e) => onPieces(e.target.value)}
                inputMode="numeric"
                className="mt-1 block w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
              />
            </label>
          )}
          <label className="text-xs font-semibold text-gray-600">
            {row.pieceWeight ? `Peso (${unitShort(row.unit)})` : `Quantidade (${unitShort(row.unit)})`}
            <input
              autoFocus={!row.pieceWeight}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
              inputMode="decimal"
              className="mt-1 block w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums"
            />
          </label>
        </div>
        {row.pieceWeight && (
          <p className="mt-1 text-xs text-gray-500">Peso sugerido pelo peso médio; se pesar, corrija para o peso real.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Motivo da perda">
          {PRODUCTION_LOSS_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-full border px-3 py-1 text-sm ${
                reason === r
                  ? 'border-red-600 bg-red-50 font-semibold text-red-800 ring-1 ring-red-600'
                  : 'border-gray-300 text-gray-700 hover:border-red-300'
              }`}
            >
              {productionLossReasonLabels[r]}
            </button>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
          maxLength={100}
          placeholder={reason === 'OTHER' ? 'Descreva o motivo (obrigatório)' : 'Detalhe (opcional)'}
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Registrando…' : 'Registrar perda'}
          </button>
        </div>
      </div>
    </div>
  );
}
