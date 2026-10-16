'use client';

import { useEffect, useState } from 'react';
import { priceChangeSourceLabel, type PriceHistoryEntry } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Quantas linhas aparecem antes do "Ver tudo". */
const PREVIEW = 8;

/** Variação em % do "de → para" (só quando havia valor antes e ele não era zero). */
function pct(before: number | null, after: number | null): string | null {
  if (before == null || after == null || before === 0) return null;
  const v = ((after - before) / before) * 100;
  const s = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return v > 0 ? `+${s}%` : `${s}%`;
}

/** Uma linha "Custo: R$ 25,00 → R$ 27,50 (+10,0%)" — ou "Custo inicial: R$ 25,00" no cadastro. */
function ChangeLine({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  if (after == null) return null;
  if (before == null) {
    return (
      <p className="text-sm text-gray-800">
        <span className="text-gray-500">{label} inicial:</span> <strong className="tabular-nums">{BRL(after)}</strong>
      </p>
    );
  }
  const up = after > before;
  const variation = pct(before, after);
  return (
    <p className="text-sm text-gray-800">
      <span className="text-gray-500">{label}:</span>{' '}
      <span className="tabular-nums text-gray-500 line-through decoration-gray-300">{BRL(before)}</span>
      {' → '}
      <strong className="tabular-nums">{BRL(after)}</strong>
      {variation && (
        <span className={`ml-1.5 text-xs font-semibold ${up ? 'text-red-600' : 'text-emerald-600'}`}>{variation}</span>
      )}
    </p>
  );
}

/**
 * Histórico de custo e preço do produto (2026-10-16): cada alteração de CUSTO ou PREÇO DE VENDA, com
 * o "de → para", data/hora, quem fez e por onde (tela de Produtos, entrada de estoque, NF-e, planilha,
 * produção…). Lê `GET /products/:id/price-history` (mais recente primeiro). `reloadKey` muda depois de
 * salvar o produto ⇒ recarrega. O histórico começa a contar a partir desta versão (alterações antigas
 * não foram registradas).
 */
export function PriceHistorySection({ productId, reloadKey }: { productId: string; reloadKey?: string }) {
  const [rows, setRows] = useState<PriceHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiGet<PriceHistoryEntry[]>(`/products/${productId}/price-history`);
        if (!cancelled) {
          setRows(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadKey]);

  const visible = rows ? (showAll ? rows : rows.slice(0, PREVIEW)) : [];

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-900">Histórico de custo e preço</h3>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : rows == null ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nenhuma alteração de custo ou preço registrada ainda. A partir de agora, toda mudança aparece aqui.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {visible.map((r) => (
              <li key={r.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <span className="text-xs font-medium text-gray-600">
                    {new Date(r.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    {r.byName ? ` · ${r.byName}` : ''}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                    {priceChangeSourceLabel(r.source)}
                    {r.detail ? ` · ${r.detail}` : ''}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  <ChangeLine label="Custo" before={r.costBefore} after={r.costAfter} />
                  <ChangeLine label="Preço" before={r.priceBefore} after={r.priceAfter} />
                </div>
              </li>
            ))}
          </ul>
          {rows.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
            >
              {showAll ? 'Ver menos' : `Ver tudo (${rows.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
