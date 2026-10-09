'use client';

import { useEffect, useRef, useState } from 'react';
import {
  isValidGtin,
  onlyDigits,
  unitTypeLabels,
  visibleUnitTypes,
  type EanLookupResult,
  type UnitType,
} from '@nexoloja/shared';
import { CLOSED_PRIMARY_UNITS } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useModule } from '@/lib/useModule';
import { MoneyInput } from '@/components/MoneyInput';

/**
 * "Cadastrar agora" do PDV (ADR-041 §B) — a cauda longa do catálogo se resolve sozinha no caixa.
 *
 * Fila no caixa: modal MÍNIMO. O nome vem do catálogo global (ADR-025) quando o código é um GTIN; o
 * operador digita **só o preço** (unidade opcional) e aperta Enter. O produto nasce:
 * - `pendingReview: true` — entra no alerta "Cadastrados no caixa para revisar" do admin;
 * - `trackStock: false` — a venda não trava por falta de saldo e nada de estoque é inventado
 *   (ADR-040 §2); o admin liga o controle e dá a entrada na conferência;
 * - custo 0 e SKU = o código lido (mesmo padrão da NF-e e do cadastro em sequência).
 *
 * Qualquer papel com acesso ao PDV pode cadastrar (decisão do Owner, 2026-09-30). Online-only.
 */

/** Produto como o `POST /products` devolve (o PDV converte no seu próprio tipo). */
export type CreatedProduct = Record<string, unknown> & { id: string; name: string };

/** Teto de sanidade: código de barras bipado no campo de preço vira "7891000100103". */
const LOOKS_LIKE_BARCODE = 1_000_000;

export function CashierQuickAddModal({
  code,
  onCreated,
  onClose,
}: {
  /** Código lido/digitado que não existe na loja. */
  code: string;
  onCreated: (product: CreatedProduct) => void;
  onClose: () => void;
}) {
  const construction = useModule('CONSTRUCTION_UNITS');
  const digits = onlyDigits(code);
  const gtin = isValidGtin(digits);
  // GTIN é guardado só com os dígitos (o leitor pode mandar espaço/hífen); código interno, como veio.
  const sku = (gtin ? digits : code.trim()).slice(0, 60);

  const [looking, setLooking] = useState(gtin);
  const [lookup, setLookup] = useState<EanLookupResult | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [priceKey, setPriceKey] = useState(0);
  const [unit, setUnit] = useState<UnitType>('UNIT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const focusPrice = () =>
    setTimeout(() => (document.getElementById('cqa-price') as HTMLInputElement | null)?.focus(), 0);

  // Ficha do catálogo global (só GTIN). Falha de rede/fonte ⇒ o operador digita o nome.
  useEffect(() => {
    if (!gtin) return;
    let cancelled = false;
    apiGet<EanLookupResult>(`/catalog/ean/${digits}`)
      .then((r) => {
        if (cancelled) return;
        setLookup(r);
        setName(r.catalog?.officialName?.trim() ?? '');
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLooking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gtin, digits]);

  // Terminada a consulta (campos habilitados): nome veio da ficha ⇒ foco no preço; senão no nome.
  useEffect(() => {
    if (looking) return;
    if (name.trim()) focusPrice();
    else nameRef.current?.focus();
    // Só na transição da consulta — não a cada letra do nome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looking]);

  // Esc fecha (volta para a venda sem cadastrar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Já existe na loja, mas não está no catálogo do caixa (inativo ou criado agora por outra pessoa).
  const alreadyExists = !!lookup?.existingProductId;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || looking || alreadyExists) return;
    if (!name.trim()) {
      setError('Informe o nome do produto.');
      nameRef.current?.focus();
      return;
    }
    if (price === '' || !(Number(price) > 0)) {
      setError('Informe o preço de venda.');
      focusPrice();
      return;
    }
    if (Number(price) >= LOOKS_LIKE_BARCODE) {
      setError('Preço alto demais — parece um código de barras bipado no campo de preço.');
      setPrice('');
      setPriceKey((k) => k + 1);
      focusPrice();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await apiPost<CreatedProduct>('/products', {
        sku,
        ean: gtin ? digits : undefined,
        name: name.trim().slice(0, 150),
        manufacturer: lookup?.catalog?.brand?.trim() ? lookup.catalog.brand.trim().slice(0, 120) : undefined,
        imageUrl: lookup?.catalog?.imageUrl ?? undefined,
        unit,
        costPrice: 0,
        salePrice: Number(price),
        trackStock: false,
        pendingReview: true,
      });
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const unitOptions = visibleUnitTypes(construction, [unit]).filter(
    (u) => !(CLOSED_PRIMARY_UNITS as readonly string[]).includes(u),
  );
  const photo = lookup?.catalog?.imageUrl ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between bg-indigo-600 px-4 py-3 text-white">
          <span className="font-semibold">Cadastrar agora</span>
          <button type="button" onClick={onClose} className="text-indigo-100 hover:text-white" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            {photo ? (
              // Hotlink da ficha (ADR-025): nunca baixada; link quebrado some.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 bg-white object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <p className="text-sm text-gray-600">
              Código <strong className="text-gray-900">{sku}</strong> não está cadastrado.
              {looking
                ? ' Consultando a ficha…'
                : lookup?.found
                  ? ' Ficha encontrada — confira o nome e digite o preço.'
                  : ' Digite o nome e o preço.'}
            </p>
          </div>

          {alreadyExists ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Este código já está cadastrado na loja, mas não aparece no caixa (o produto pode estar
              inativo). Peça ao administrador para conferir em Produtos.
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-600">Nome</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={150}
                  disabled={looking}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">Preço de venda</span>
                  <MoneyInput
                    key={priceKey}
                    id="cqa-price"
                    value={price}
                    onChange={setPrice}
                    disabled={looking}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-600">Unidade</span>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as UnitType)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
                  >
                    {unitOptions.map((u) => (
                      <option key={u} value={u}>
                        {unitTypeLabels[u]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-gray-500">
                O item entra no carrinho e a venda segue. Custo, categoria e estoque ficam para o
                administrador conferir (aparece no sino de pendências).
              </p>
            </>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Voltar
          </button>
          {!alreadyExists && (
            <button
              type="submit"
              disabled={saving || looking}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Cadastrando…' : 'Cadastrar e vender (Enter)'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
