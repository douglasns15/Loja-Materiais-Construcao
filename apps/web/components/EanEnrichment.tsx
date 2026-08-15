'use client';

import { useEffect, useRef, useState } from 'react';
import { isValidGtin, onlyDigits, type EanLookupResult } from '@nexoloja/shared';
import { apiGet } from '@/lib/api';

/**
 * Busca inteligente de EAN (ADR-025) para a UI de Produtos — hook + card de enriquecimento.
 *
 * O hook `useEanLookup` observa o código digitado/escaneado, e SÓ quando ele é um GTIN válido
 * (dígito verificador ok) dispara `GET /catalog/ean/:ean` com debounce — evita bater no servidor a
 * cada tecla e não consulta código interno/industrial. A resolução é resiliente: erro de rede vira
 * "sem ficha" (nunca trava o cadastro). A foto é sempre HOTLINK (URL externa), nunca baixada.
 */

type LookupState = {
  loading: boolean;
  result: EanLookupResult | null;
  /** Código consultado (dígitos) a que o `result` se refere — evita aplicar dado de um EAN antigo. */
  ean: string | null;
};

const DEBOUNCE_MS = 500;

export function useEanLookup(rawEan: string): LookupState {
  const [state, setState] = useState<LookupState>({ loading: false, result: null, ean: null });
  // Sequência p/ descartar respostas fora de ordem (o operador troca o EAN antes da 1ª voltar).
  const seq = useRef(0);

  useEffect(() => {
    const digits = onlyDigits(rawEan);
    if (!isValidGtin(digits)) {
      setState({ loading: false, result: null, ean: null });
      return;
    }
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      apiGet<EanLookupResult>(`/catalog/ean/${digits}`)
        .then((result) => {
          if (mySeq === seq.current) setState({ loading: false, result, ean: digits });
        })
        .catch(() => {
          // Resiliência (regra do Owner): falha externa não trava — apenas "sem ficha".
          if (mySeq === seq.current) setState({ loading: false, result: null, ean: digits });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawEan]);

  return state;
}

/** Dados que o card devolve ao "Preencher" — o formulário decide o que sobrescrever. */
export type EnrichmentApply = {
  officialName: string | null;
  brand: string | null;
  imageUrl: string | null;
};

/**
 * Card de resultado da consulta de EAN: foto (hotlink), nome oficial, marca e NCM, com botão
 * "Preencher". Também avisa quando a PRÓPRIA loja já tem um produto com esse código (evita duplicar).
 */
export function EanEnrichmentCard({
  state,
  onApply,
  onOpenExisting,
}: {
  state: LookupState;
  /** Chamado ao clicar "Preencher" com os campos da ficha (o form decide o que aplicar). */
  onApply?: (data: EnrichmentApply) => void;
  /** Opcional: abrir o produto já cadastrado com esse EAN (quando `existingProductId`). */
  onOpenExisting?: (productId: string) => void;
}) {
  if (state.loading) {
    return (
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Consultando o código de barras…
      </p>
    );
  }
  const r = state.result;
  if (!r) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      {r.existingProductId && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>⚠️ Sua loja já tem um produto com este código de barras.</span>
          {onOpenExisting && (
            <button
              type="button"
              onClick={() => onOpenExisting(r.existingProductId!)}
              className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
            >
              Abrir
            </button>
          )}
        </div>
      )}

      {r.found && r.catalog ? (
        <div className="flex items-start gap-3">
          {r.catalog.imageUrl ? (
            // Hotlink: a foto vem do CDN da fonte (custo-zero). `onError` esconde link quebrado.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.catalog.imageUrl}
              alt={r.catalog.officialName ?? 'Foto do produto'}
              className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 bg-white object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">
              Ficha encontrada{r.source === 'cache' ? ' (catálogo)' : ' (consulta externa)'}
            </p>
            <p className="truncate text-sm font-medium text-gray-900">
              {r.catalog.officialName ?? <span className="text-gray-400">sem nome oficial</span>}
            </p>
            <p className="text-xs text-gray-600">
              {r.catalog.brand ? `Marca: ${r.catalog.brand}` : 'Marca: —'}
              {r.catalog.ncm ? ` · NCM: ${r.catalog.ncm}` : ''}
            </p>
            {onApply && (
              <button
                type="button"
                onClick={() =>
                  onApply({
                    officialName: r.catalog!.officialName ?? null,
                    brand: r.catalog!.brand ?? null,
                    imageUrl: r.catalog!.imageUrl ?? null,
                  })
                }
                className="mt-2 rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800"
              >
                Preencher com esta ficha
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Código válido, mas sem ficha técnica nas fontes gratuitas. Preencha os dados manualmente —
          eles passam a alimentar o catálogo.
        </p>
      )}
    </div>
  );
}
