'use client';

import { useMemo, useRef, useState } from 'react';
import {
  formatCnpj,
  onlyDigits,
  unitTypeLabels,
  type NFeDoc,
  type NFeItem,
  type UnitType,
} from '@nexoloja/shared';
import { normalizeSearchText } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { parseNfeXml } from '@/lib/nfe';
import { ProductPicker } from '@/components/ProductPicker';

/**
 * Importação de XML de NF-e — tela De-Para (ADR-025, Fatia 2). Lê o XML no navegador (`parseNfeXml`,
 * DOMParser), casa cada item da nota com um produto do cadastro (por EAN → sugestão por nome → busca
 * manual) ou cadastra na hora, e confirma tudo em `POST /nfe/entry` (Entrada de estoque por item,
 * ADR-001; alimenta o catálogo global; fornecedor casado por CNPJ no servidor).
 *
 * Idempotência POR ITEM: ao (re)abrir a nota, consulta `GET /nfe/imported?chNFe=` e **pré-marca só os
 * itens que ainda não deram entrada** — os já lançados aparecem com selo e desmarcados (dá pra
 * remarcar à força, se de fato recebeu de novo). Na 2.A o operador confirma quantidade/custo por
 * linha (sem conversão automática da unidade comercial).
 */

/** Campos do produto que o De-Para precisa (casar por EAN + busca do ProductPicker + rótulo). */
export type NfeProduct = {
  id: string;
  name: string;
  sku: string;
  popularName: string | null;
  manufacturer: string | null;
  ean: string | null;
  unit: string;
  stockQty: string;
};

type RowMode = 'existing' | 'new';

/** Uma linha do De-Para: o item da nota + a decisão do operador (casar/cadastrar) e os valores. */
type Row = {
  item: NFeItem;
  alreadyImported: boolean;
  importedAt: string | null;
  selected: boolean;
  mode: RowMode;
  productId: string; // quando mode = 'existing'
  // Cadastro novo (mode = 'new')
  npSku: string;
  npEan: string;
  npName: string;
  npManufacturer: string;
  npUnit: UnitType;
  npSalePrice: string;
  // Comuns
  quantity: string;
  cost: string; // "último custo" por unidade de venda (vazio = não atualiza custo)
  result?: { ok: boolean; error?: string };
};

type ImportedItem = { nItem: number; productId: string | null; importedAt: string };
type EntryResponse = {
  supplierId: string | null;
  imported: number;
  results: { nItem: number; ok: boolean; productId?: string; error?: string }[];
};

/**
 * Casa o item da nota com um produto do cadastro, para PRÉ-VINCULAR e pré-marcar a linha:
 *  1º por EAN (confiável — GTIN é chave universal do produto);
 *  2º por NOME idêntico (normalizado: sem acento/caixa/espaços nas pontas).
 *
 * Aqui é AUTO-vínculo (o operador confirma sem escolher), então o casamento por nome tem de ser
 * ESTRITO — igualdade exata, não a busca frouxa de balcão (`productMatchesQuery`). A busca frouxa
 * é tokenizada por substring e casaria "Chave 2 do Caso 6" com "Chave 2 do Caso 4" (o dígito "6"
 * cai dentro de um SKU numérico) → vínculo silencioso no produto ERRADO. Sem casamento confiável,
 * a linha nasce em "Cadastrar novo" e o operador ainda pode buscar/escolher à mão no ProductPicker
 * (aí a busca frouxa é ok — é humano decidindo).
 */
function matchProduct(item: NFeItem, products: NfeProduct[]): string {
  if (item.ean) {
    const byEan = products.find((p) => p.ean && onlyDigits(p.ean) === item.ean);
    if (byEan) return byEan.id;
  }
  if (item.name) {
    const target = normalizeSearchText(item.name);
    if (target) {
      const byName = products.find((p) => normalizeSearchText(p.name) === target);
      if (byName) return byName.id;
    }
  }
  return '';
}

/** Monta a linha inicial a partir do item, já com o casamento e a pré-marcação de idempotência. */
function toRow(item: NFeItem, products: NfeProduct[], imported: Map<number, string>): Row {
  const productId = matchProduct(item, products);
  const importedAt = imported.get(item.nItem) ?? null;
  return {
    item,
    alreadyImported: importedAt != null,
    importedAt,
    selected: importedAt == null, // já lançado ⇒ desmarcado por padrão
    mode: productId ? 'existing' : 'new',
    productId,
    npSku: item.supplierCode ?? item.rawEan ?? '',
    npEan: item.ean ?? '',
    npName: item.name,
    npManufacturer: '',
    npUnit: 'UNIT',
    npSalePrice: '',
    quantity: String(item.quantity),
    cost: item.unitCost > 0 ? String(item.unitCost) : '',
  };
}

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function NfeImportModal({
  products,
  onClose,
  onImported,
}: {
  products: NfeProduct[];
  onClose: () => void;
  /** Chamado após a importação para a tela recarregar catálogo/movimentações. */
  onImported: () => Promise<void> | void;
}) {
  const [doc, setDoc] = useState<NFeDoc | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const inputCls = 'w-full rounded-lg border border-gray-300 px-2 py-1 text-sm';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setLoading(true);
    try {
      const xml = await file.text();
      const parsed = parseNfeXml(xml);
      if (parsed.items.length === 0) {
        setError('Nota lida, mas sem itens reconhecidos.');
        setDoc(null);
        setRows([]);
        return;
      }
      // Idempotência por item: quais itens desta nota já deram entrada?
      const imported = new Map<number, string>();
      if (parsed.header.accessKey) {
        try {
          const r = await apiGet<{ accessKey: string; importedItems: ImportedItem[] }>(
            `/nfe/imported?chNFe=${parsed.header.accessKey}`,
          );
          for (const it of r.importedItems) imported.set(it.nItem, it.importedAt);
        } catch {
          // Falha na checagem não trava a importação — apenas não pré-desmarca nada.
        }
      }
      setDoc(parsed);
      setRows(parsed.items.map((it) => toRow(it, products, imported)));
    } catch (err) {
      setError((err as Error).message);
      setDoc(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const patch = (idx: number, next: Partial<Row>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...next } : r)));

  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);

  async function onConfirm() {
    if (!doc) return;
    setError(null);
    const chosen = rows.filter((r) => r.selected);
    if (chosen.length === 0) {
      setError('Marque ao menos um item para lançar.');
      return;
    }
    // Validação por linha (antes de bater no servidor).
    for (const r of chosen) {
      if (!(Number(r.quantity) > 0)) {
        setError(`Informe a quantidade do item "${r.item.name}".`);
        return;
      }
      if (r.mode === 'existing' && !r.productId) {
        setError(`Escolha o produto para o item "${r.item.name}" (ou cadastre um novo).`);
        return;
      }
      if (r.mode === 'new' && (!r.npSku.trim() || !r.npName.trim())) {
        setError(`Preencha SKU e nome do novo produto para "${r.item.name}".`);
        return;
      }
    }

    const items = chosen.map((r) => {
      const base = {
        nItem: r.item.nItem,
        quantity: Number(r.quantity),
        ...(Number(r.cost) > 0 ? { newCostPrice: Number(r.cost) } : {}),
        ...(r.item.ean ? { ean: r.item.ean } : {}),
        ...(r.item.name ? { officialName: r.item.name } : {}),
        ...(r.item.ncm ? { ncm: r.item.ncm } : {}),
      };
      if (r.mode === 'existing') return { ...base, productId: r.productId };
      return {
        ...base,
        newProduct: {
          sku: r.npSku.trim(),
          ...(r.npEan.trim() ? { ean: onlyDigits(r.npEan) } : {}),
          name: r.npName.trim(),
          ...(r.npManufacturer.trim() ? { manufacturer: r.npManufacturer.trim() } : {}),
          unit: r.npUnit,
          salePrice: Number(r.npSalePrice || 0),
        },
      };
    });

    const payload = {
      ...(doc.header.accessKey ? { accessKey: doc.header.accessKey } : {}),
      ...(doc.header.number ? { notaNumber: doc.header.number } : {}),
      ...(doc.header.supplierName
        ? {
            createSupplier: {
              name: doc.header.supplierName,
              ...(doc.header.supplierCnpj ? { cnpj: doc.header.supplierCnpj } : {}),
            },
          }
        : {}),
      items,
    };

    setSaving(true);
    try {
      const resp = await apiPost<EntryResponse>('/nfe/entry', payload);
      const byItem = new Map(resp.results.map((x) => [x.nItem, x]));
      setRows((rs) =>
        rs.map((r) => {
          const res = byItem.get(r.item.nItem);
          if (!res || !r.selected) return r;
          return res.ok
            ? { ...r, result: { ok: true }, selected: false, alreadyImported: true }
            : { ...r, result: { ok: false, error: res.error } };
        }),
      );
      const failed = resp.results.filter((x) => !x.ok).length;
      setSummary(
        `${resp.imported} ${resp.imported === 1 ? 'item lançado' : 'itens lançados'}` +
          (failed > 0 ? ` · ${failed} com erro (veja abaixo)` : '') +
          '.',
      );
      await onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Importar NF-e"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Importar NF-e (XML)</h2>
            <p className="text-xs text-gray-600">
              Leia o XML da nota de compra e dê entrada no estoque casando cada item com o cadastro.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {summary && (
          <p className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{summary}</p>
        )}

        {!doc ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              onChange={onFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? 'Lendo…' : 'Escolher XML da NF-e'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              O arquivo é lido no seu aparelho — nada é enviado até você confirmar os itens.
            </p>
          </div>
        ) : (
          <>
            {/* Cabeçalho da nota. */}
            <div className="mb-3 rounded-xl bg-gray-50 p-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-gray-500">Fornecedor:</span>{' '}
                  <span className="font-medium">{doc.header.supplierName ?? '—'}</span>
                  {doc.header.supplierCnpj && (
                    <span className="text-gray-500"> · {formatCnpj(doc.header.supplierCnpj)}</span>
                  )}
                </span>
                <span>
                  <span className="text-gray-500">Nota:</span>{' '}
                  <span className="font-medium">{doc.header.number ?? '—'}</span>
                </span>
              </div>
              {doc.header.supplierName && (
                <p className="mt-1 text-xs text-gray-500">
                  O fornecedor será vinculado à entrada (criado se ainda não existir, casando por
                  CNPJ).
                </p>
              )}
              {!doc.header.accessKey && (
                <p className="mt-1 text-xs text-amber-700">
                  ⚠️ Nota sem chave de acesso — não dá para reconhecer reimportação desta nota.
                </p>
              )}
            </div>

            {/* Linhas do De-Para. */}
            <div className="space-y-3">
              {rows.map((r, idx) => (
                <div
                  key={r.item.nItem}
                  className={`rounded-xl border p-3 ${
                    r.result?.ok
                      ? 'border-green-200 bg-green-50/40'
                      : r.result && !r.result.ok
                        ? 'border-red-200 bg-red-50/40'
                        : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      onChange={() => patch(idx, { selected: !r.selected })}
                      className="mt-1 shrink-0"
                      aria-label={`Selecionar item ${r.item.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      {/* Item da nota. */}
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-gray-900">{r.item.name}</span>
                        {r.alreadyImported && !r.result && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                            já lançado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {r.item.ean ? `EAN ${r.item.ean}` : 'sem EAN'}
                        {r.item.unit ? ` · ${r.item.quantity} ${r.item.unit}` : ''}
                        {r.item.unitCost > 0 ? ` · ${BRL(r.item.unitCost)}/un` : ''}
                        {r.item.ncm ? ` · NCM ${r.item.ncm}` : ''}
                      </p>

                      {/* Destino: casar existente × cadastrar novo. */}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs">
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={r.mode === 'existing'}
                            onChange={() => patch(idx, { mode: 'existing' })}
                          />
                          Casar com produto
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="radio"
                            checked={r.mode === 'new'}
                            onChange={() => patch(idx, { mode: 'new' })}
                          />
                          Cadastrar novo
                        </label>
                      </div>

                      {r.mode === 'existing' ? (
                        <div className="mt-2">
                          <ProductPicker
                            products={products}
                            value={r.productId}
                            onChange={(id) => patch(idx, { productId: id })}
                            formatStock={(p) => `${Number(p.stockQty)} em estoque`}
                            placeholder="Buscar produto ou SKU…"
                          />
                        </div>
                      ) : (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <input
                            value={r.npSku}
                            onChange={(e) => patch(idx, { npSku: e.target.value })}
                            placeholder="SKU (código interno)"
                            className={inputCls}
                          />
                          <input
                            value={r.npName}
                            onChange={(e) => patch(idx, { npName: e.target.value })}
                            placeholder="Nome"
                            className={`${inputCls} col-span-2`}
                          />
                          <select
                            value={r.npUnit}
                            onChange={(e) => patch(idx, { npUnit: e.target.value as UnitType })}
                            className={`${inputCls} bg-white`}
                            aria-label="Unidade de venda"
                          >
                            {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                              <option key={u} value={u}>
                                {unitTypeLabels[u]}
                              </option>
                            ))}
                          </select>
                          <input
                            value={r.npManufacturer}
                            onChange={(e) => patch(idx, { npManufacturer: e.target.value })}
                            placeholder="Fabricante (opcional)"
                            className={`${inputCls} col-span-2`}
                          />
                          <input
                            value={r.npSalePrice}
                            onChange={(e) => patch(idx, { npSalePrice: e.target.value })}
                            inputMode="decimal"
                            placeholder="Preço de venda"
                            className={inputCls}
                            aria-label="Preço de venda do novo produto"
                          />
                        </div>
                      )}

                      {/* Quantidade e custo confirmados (na unidade de venda). */}
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
                        <label className="text-xs text-gray-600">
                          Quantidade
                          <input
                            value={r.quantity}
                            onChange={(e) => patch(idx, { quantity: e.target.value })}
                            inputMode="decimal"
                            className={inputCls}
                          />
                        </label>
                        <label className="text-xs text-gray-600">
                          Custo (un) — vazio: não muda
                          <input
                            value={r.cost}
                            onChange={(e) => patch(idx, { cost: e.target.value })}
                            inputMode="decimal"
                            className={inputCls}
                          />
                        </label>
                      </div>

                      {r.result && !r.result.ok && (
                        <p className="mt-1 text-xs text-red-700">{r.result.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDoc(null);
                  setRows([]);
                  setError(null);
                  setSummary(null);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Trocar arquivo
              </button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{selectedCount} marcado(s)</span>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={saving || selectedCount === 0}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Lançando…' : 'Confirmar entrada'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
