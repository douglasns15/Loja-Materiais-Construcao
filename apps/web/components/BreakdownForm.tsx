'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  createBreakdownSchema,
  formatProductionNumber,
  type BreakdownSuggestedCuts,
  type ProductionRow,
} from '@nexoloja/shared';
import { availableQty, breakdownShrink, costPerBaseUnit, splitBreakdownCost } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { ProductPicker } from '@/components/ProductPicker';
import { fmtQty, parseQty, unitShort } from '@/components/RecipeSection';

/**
 * Desmembramento (ADR-043 Fatia 3): escolhe a PEÇA (quarto traseiro, costela, frango para cortar),
 * informa quanto usou e pesa cada corte que saiu. Ao escolher a peça, a lista vem pré-montada com os
 * cortes que costumam sair dela (últimos desmembramentos, mais frequentes primeiro; pesos em branco)
 * — o operador remove (×), adiciona ou deixa em branco o que não saiu; só vão os cortes pesados. A tela mostra o rateio do custo pelo valor de
 * venda (decisão do Owner) e a QUEBRA (osso, sebo), que é informativa. Peça sem saldo bloqueia.
 */

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Produto do catálogo (`GET /products`) com o que o desmembramento precisa. */
type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
  popularName: string | null;
  manufacturer: string | null;
  unit: string;
  costPrice: string | number;
  salePrice: string | number;
  conversionFactor: string | number | null;
  stockQty: string | number;
  reservedQty?: string | number | null;
  trackStock?: boolean;
};

type CutDraft = { key: number; productId: string; qty: string };

const factorOf = (p: CatalogProduct) => (p.conversionFactor != null ? Number(p.conversionFactor) : null);
const baseCost = (p: CatalogProduct) =>
  costPerBaseUnit({ unit: p.unit, conversionFactor: factorOf(p), costPrice: Number(p.costPrice) });
/** Preço de venda por unidade-base (unidade fechada: preço da peça ÷ tamanho — mesma conta da API). */
const baseSale = (p: CatalogProduct) =>
  costPerBaseUnit({ unit: p.unit, conversionFactor: factorOf(p), costPrice: Number(p.salePrice) });
const availableOf = (p: CatalogProduct) => availableQty(Number(p.stockQty), Number(p.reservedQty ?? 0));

export function BreakdownForm({ onDone }: { onDone: (row: ProductionRow, message: string) => Promise<void> }) {
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [pieceId, setPieceId] = useState('');
  const [pieceQty, setPieceQty] = useState('');
  const [cuts, setCuts] = useState<CutDraft[]>([]);
  /** Em quantos desmembramentos anteriores a sugestão de cortes se baseou (0 = sem sugestão). */
  const [basedOn, setBasedOn] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  // Trocar de peça rápido dispara uma busca de cortes por peça; só a mais recente vale.
  const lastSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    apiGet<CatalogProduct[]>('/products')
      .then((rows) => alive && setProducts(rows))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  // Só produto que controla estoque entra (a peça sai do estoque; o corte entra).
  const tracked = useMemo(() => (products ?? []).filter((p) => p.trackStock !== false), [products]);
  const byId = useMemo(() => new Map(tracked.map((p) => [p.id, p])), [tracked]);
  const piece = byId.get(pieceId) ?? null;
  const fmtStock = (p: CatalogProduct) => `${fmtQty(Number(p.stockQty), p.unit)} ${unitShort(p.unit)} em estoque`;

  const newCut = (productId = ''): CutDraft => ({ key: nextKey.current++, productId, qty: '' });

  async function choosePiece(id: string) {
    setPieceId(id);
    setPieceQty('');
    setError(null);
    setBasedOn(0);
    if (!id) {
      setCuts([]);
      return;
    }
    const seq = ++lastSeq.current;
    setCuts([newCut()]);
    try {
      const sug = await apiGet<BreakdownSuggestedCuts>(`/productions/breakdown/cuts/${id}`);
      if (seq !== lastSeq.current) return;
      const known = sug.cuts.filter((ct) => byId.has(ct.productId));
      if (known.length > 0) {
        setCuts(known.map((ct) => newCut(ct.productId)));
        setBasedOn(sug.basedOn);
      }
    } catch {
      // Sem pré-montagem não impede desmembrar: o operador adiciona os cortes à mão.
    }
  }

  const qtyIn = parseQty(pieceQty);
  // Cortes válidos para o cálculo: produto escolhido + peso > 0.
  const filled = cuts
    .map((ct) => ({ ...ct, product: byId.get(ct.productId) ?? null, q: parseQty(ct.qty) }))
    .filter((ct) => ct.product && ct.q > 0);
  const pieceCost = piece && qtyIn > 0 ? Number((qtyIn * baseCost(piece)).toFixed(2)) : 0;
  const shares = splitBreakdownCost(
    pieceCost,
    filled.map((ct) => ({ quantity: ct.q, salePrice: baseSale(ct.product!) })),
  );
  const shareOf = (key: number) => {
    const i = filled.findIndex((ct) => ct.key === key);
    return i >= 0 ? shares[i] : undefined;
  };
  const sameUnit = !!piece && filled.length > 0 && filled.every((ct) => ct.product!.unit === piece.unit);
  const shrink = sameUnit && qtyIn > 0 ? breakdownShrink(qtyIn, filled.map((ct) => ct.q)) : null;
  const cutsTotal = filled.reduce((a, ct) => a + ct.q, 0);

  const short = !!piece && qtyIn > 0 && qtyIn > availableOf(piece) + 1e-9;
  const badQty = cuts.some((ct) => ct.qty.trim() !== '' && !(parseQty(ct.qty) >= 0));
  const dupe = new Set(filled.map((ct) => ct.productId)).size !== filled.length;
  const overflow = !!shrink && shrink.shrinkQty < 0;
  const canSubmit = !!piece && qtyIn > 0 && filled.length > 0 && !short && !badQty && !dupe && !overflow;

  async function register() {
    if (!piece) return;
    setError(null);
    const parsed = createBreakdownSchema.safeParse({
      productId: piece.id,
      quantity: qtyIn,
      cuts: filled.map((ct) => ({ productId: ct.productId, quantity: ct.q })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os pesos.');
      return;
    }
    setBusy(true);
    try {
      const row = await apiPost<ProductionRow>('/productions/breakdown', parsed.data);
      const n = row.outputs.length;
      const message = `${formatProductionNumber(row.productionNumber)} registrada: saíram ${fmtQty(qtyIn, piece.unit)} ${unitShort(
        piece.unit,
      )} de ${piece.name} e entraram ${n} ${n === 1 ? 'corte' : 'cortes'} no estoque.`;
      setPieceId('');
      setPieceQty('');
      setCuts([]);
      setBasedOn(0);
      setNotes('');
      // O catálogo local tem saldo/custo antigos — recarrega para o próximo desmembramento.
      apiGet<CatalogProduct[]>('/products')
        .then(setProducts)
        .catch(() => {});
      await onDone(row, message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!products) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-gray-500">Carregando produtos…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-xs font-semibold text-gray-600">Peça</span>
        <ProductPicker
          products={tracked}
          value={pieceId}
          onChange={(id) => void choosePiece(id)}
          formatStock={fmtStock}
          placeholder="Buscar a peça (ex.: quarto traseiro)…"
        />
      </div>

      {piece && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-gray-600">
              Quanto usou ({unitShort(piece.unit)})
              <input
                id="bd-piece-qty"
                autoFocus
                value={pieceQty}
                onChange={(e) => setPieceQty(e.target.value)}
                inputMode="decimal"
                className={`mt-1 block w-28 rounded-lg border px-2 py-1.5 text-right text-sm tabular-nums ${
                  short ? 'border-red-400' : 'border-gray-300'
                }`}
              />
            </label>
            <span
              className={`mb-1.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                short ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              tem {fmtQty(availableOf(piece), piece.unit)} {unitShort(piece.unit)}
            </span>
          </div>
          {short && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Falta saldo de {piece.name} (tem {fmtQty(availableOf(piece), piece.unit)}, precisa {fmtQty(qtyIn, piece.unit)}).
              Dê entrada na tela{' '}
              <Link href="/estoque" className="font-semibold underline">
                Estoque
              </Link>{' '}
              antes de desmembrar.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-gray-600">Cortes que saíram</span>
              {/* De onde vem a sugestão, discreto no lugar da dica que já existia (pedido do Owner). */}
              <span className="text-right text-xs text-gray-500">
                {basedOn > 1
                  ? `Sugeridos pelos últimos ${basedOn} desmembramentos · em branco fica de fora`
                  : basedOn === 1
                    ? 'Sugeridos pelo último desmembramento · em branco fica de fora'
                    : 'Corte em branco fica de fora'}
              </span>
            </div>
            {cuts.map((ct) => {
              const p = byId.get(ct.productId);
              const share = shareOf(ct.key);
              const sale = p ? baseSale(p) : 0;
              const margin = share && share.unitCost > 0 && sale > 0 ? ((sale - share.unitCost) / sale) * 100 : null;
              const bad = ct.qty.trim() !== '' && !(parseQty(ct.qty) >= 0);
              return (
                <div key={ct.key} className="rounded-xl border border-gray-200 p-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <ProductPicker
                        products={tracked.filter(
                          (x) => x.id !== pieceId && (x.id === ct.productId || !cuts.some((o) => o.productId === x.id)),
                        )}
                        value={ct.productId}
                        onChange={(id) => setCuts((prev) => prev.map((o) => (o.key === ct.key ? { ...o, productId: id } : o)))}
                        formatStock={fmtStock}
                        placeholder="Buscar o corte…"
                      />
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <input
                        value={ct.qty}
                        onChange={(e) =>
                          setCuts((prev) => prev.map((o) => (o.key === ct.key ? { ...o, qty: e.target.value } : o)))
                        }
                        inputMode="decimal"
                        placeholder="peso"
                        aria-label={`${p?.name ?? 'Corte'}: quantidade`}
                        className={`w-24 rounded-lg border px-2 py-2 text-right text-sm tabular-nums ${
                          bad ? 'border-red-400' : 'border-gray-300'
                        }`}
                      />
                      <span className="w-6 text-left text-xs text-gray-500">{p ? unitShort(p.unit) : ''}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setCuts((prev) => prev.filter((o) => o.key !== ct.key))}
                      aria-label={`Remover ${p?.name ?? 'corte'}`}
                      className="mt-1 shrink-0 rounded-md px-2 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                  {p && share && (
                    <p className="mt-1 text-xs text-gray-500 tabular-nums">
                      custo {BRL(share.totalCost)} ({BRL(share.unitCost)}/{unitShort(p.unit)})
                      {margin != null ? ` · margem ${margin.toFixed(0)}%` : ''}
                      {sale <= 0 ? ' · sem preço de venda: não absorve custo' : ''}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setCuts((prev) => [...prev, newCut()])}
              className="rounded-lg border border-dashed border-indigo-300 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              + Adicionar corte
            </button>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span>
              Custo da peça: <strong className="tabular-nums">{BRL(pieceCost)}</strong>
            </span>
            {sameUnit && (
              <span>
                Cortes: <strong className="tabular-nums">{fmtQty(cutsTotal, piece.unit)} {unitShort(piece.unit)}</strong>
              </span>
            )}
            {shrink && !overflow && (
              <span>
                Quebra (osso, sebo):{' '}
                <strong className="tabular-nums">
                  {fmtQty(shrink.shrinkQty, piece.unit)} {unitShort(piece.unit)} ({shrink.shrinkPct.toLocaleString('pt-BR')}%)
                </strong>
              </span>
            )}
          </div>
          {overflow && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Os cortes somam {fmtQty(cutsTotal, piece.unit)} {unitShort(piece.unit)}, mais que a peça (
              {fmtQty(qtyIn, piece.unit)} {unitShort(piece.unit)}) — confira os pesos.
            </p>
          )}
          {dupe && <p className="text-sm text-red-600">O mesmo corte aparece duas vezes.</p>}

          <input
            id="bd-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={300}
            placeholder="Observação (opcional) — ex.: peça com muito sebo"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={register}
              disabled={busy || !canSubmit}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Registrando…' : 'Registrar desmembramento'}
            </button>
          </div>
        </>
      )}
      {!piece && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
