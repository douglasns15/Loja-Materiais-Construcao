'use client';

import { useEffect, useState } from 'react';
import { updateProductSchema, unitTypeLabels, type UnitType } from '@nexoloja/shared';
import { cardFeePercentFor, netMarginPercent, surchargePerBaseUnit } from '@nexoloja/core';
import { apiPatch } from '@/lib/api';

/**
 * Painel de **visualizar / editar** o cadastro de um produto (fatia EP).
 *
 * Abre a partir da linha da tela de Produtos. Nasce em modo leitura (o operador
 * quer conferir o que está cadastrado) e vira formulário no botão "Editar", no
 * mesmo padrão do card "Dados da loja" em Configurações: "Salvar" só habilita
 * quando há alteração real, e o PATCH leva **apenas os campos alterados**.
 *
 * **Estoque é somente leitura aqui de propósito (ADR-001):** o saldo é cache de
 * `StockMovement` e só muda por movimentação (tela de Estoque). Editar o cadastro
 * nunca mexe em `stockQty`.
 */

export type ProductFull = {
  id: string;
  sku: string;
  name: string;
  popularName: string | null;
  manufacturer: string | null;
  description: string | null;
  unit: UnitType;
  costPrice: string;
  salePrice: string;
  stockQty: string;
  minStockQty: string;
  weightKg: string | null;
  altUnit: UnitType | null;
  conversionFactor: string | null;
  altSalePrice: string | null;
  // Produto agregado — venda em par (ADR-015).
  pairedProductId: string | null;
  pairPrice: string | null;
  // Acréscimo por forma de pagamento (ADR-016) — R$ por unidade-base; null ⇒ preço único.
  surchargeDebit: string | null;
  surchargeCredit: string | null;
  marginPercent: number;
  createdByName: string | null;
  createdAt: string;
  updatedByName: string | null;
  updatedAt: string;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/**
 * Acréscimos do produto no formato do core (ADR-016) — a API devolve `Decimal` como string.
 */
const toSurcharge = (p: ProductFull) => ({
  surchargeDebit: p.surchargeDebit === null ? null : Number(p.surchargeDebit),
  surchargeCredit: p.surchargeCredit === null ? null : Number(p.surchargeCredit),
});

/** Taxas da maquininha da loja (ADR-016), como o painel as recebe da tela de Produtos. */
export type CardFees = {
  cardFeeDebitPercent?: number | null;
  cardFeeCreditPercent?: number | null;
};

/** Autoria (ADR-010): "<nome> · <data>", ou "—" quando não há registro (dados antigos). */
const byLine = (name: string | null, iso?: string) =>
  name ? `${name}${iso ? ` · ${new Date(iso).toLocaleDateString('pt-BR')}` : ''}` : '—';

/** Campos do formulário — tudo string, como o usuário digita. */
type FormState = {
  name: string;
  popularName: string;
  manufacturer: string;
  sku: string;
  description: string;
  unit: UnitType;
  costPrice: string;
  salePrice: string;
  minStockQty: string;
  weight: string;
  weightUnit: 'kg' | 'g';
  altUnit: UnitType | '';
  conversionFactor: string;
  altSalePrice: string;
  pairedProductId: string;
  pairPrice: string;
  surchargeDebit: string;
  surchargeCredit: string;
};

/**
 * Produto (como vem da API) → estado do formulário. O peso volta sempre em **kg**
 * (forma canônica do banco); o operador troca para gramas se preferir.
 */
function toForm(p: ProductFull): FormState {
  return {
    name: p.name,
    popularName: p.popularName ?? '',
    manufacturer: p.manufacturer ?? '',
    sku: p.sku,
    description: p.description ?? '',
    unit: p.unit,
    costPrice: String(Number(p.costPrice)),
    salePrice: String(Number(p.salePrice)),
    minStockQty: String(Number(p.minStockQty)),
    weight: p.weightKg === null ? '' : String(Number(p.weightKg)),
    weightUnit: 'kg',
    altUnit: p.altUnit ?? '',
    conversionFactor: p.conversionFactor === null ? '' : String(Number(p.conversionFactor)),
    altSalePrice: p.altSalePrice === null ? '' : String(Number(p.altSalePrice)),
    pairedProductId: p.pairedProductId ?? '',
    pairPrice: p.pairPrice === null ? '' : String(Number(p.pairPrice)),
    surchargeDebit: p.surchargeDebit === null ? '' : String(Number(p.surchargeDebit)),
    surchargeCredit: p.surchargeCredit === null ? '' : String(Number(p.surchargeCredit)),
  };
}

/** Texto digitado → valor a enviar: vazio vira `null` (limpa a coluna), ADR do update. */
const textOrNull = (v: string) => (v.trim() === '' ? null : v.trim());
/** Número digitado → valor a enviar: vazio/zero vira `null`; senão o número. */
const numOrNull = (v: string) => {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n;
};

/**
 * Monta o payload do PATCH com **só o que mudou** (compara com o produto original).
 * Assim uma edição de preço não reescreve descrição/fabricante à toa, e o
 * `updatedByName` (ADR-010) reflete uma alteração de verdade.
 */
function buildPatch(original: ProductFull, f: FormState): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const weightRaw = Number(f.weight);
  const weightKg =
    f.weight.trim() === '' || !Number.isFinite(weightRaw) || weightRaw <= 0
      ? null
      : f.weightUnit === 'g'
        ? weightRaw / 1000
        : weightRaw;

  const next = {
    name: f.name.trim(),
    sku: f.sku.trim(),
    popularName: textOrNull(f.popularName),
    manufacturer: textOrNull(f.manufacturer),
    description: textOrNull(f.description),
    unit: f.unit,
    costPrice: Number(f.costPrice),
    salePrice: Number(f.salePrice),
    minStockQty: Number(f.minStockQty || 0),
    weightKg,
    altUnit: f.altUnit === '' ? null : f.altUnit,
    conversionFactor: numOrNull(f.conversionFactor),
    altSalePrice: numOrNull(f.altSalePrice),
    // Par (ADR-015): limpar o produto agregado zera também o preço do par (e vice-versa),
    // senão sobraria metade da configuração no banco.
    pairedProductId: textOrNull(f.pairedProductId),
    pairPrice: f.pairedProductId.trim() === '' ? null : numOrNull(f.pairPrice),
    // ADR-016: limpar o campo remove o acréscimo (produto volta a ter preço único).
    surchargeDebit: numOrNull(f.surchargeDebit),
    surchargeCredit: numOrNull(f.surchargeCredit),
  };

  const current = {
    name: original.name,
    sku: original.sku,
    popularName: original.popularName,
    manufacturer: original.manufacturer,
    description: original.description,
    unit: original.unit,
    costPrice: Number(original.costPrice),
    salePrice: Number(original.salePrice),
    minStockQty: Number(original.minStockQty),
    weightKg: original.weightKg === null ? null : Number(original.weightKg),
    altUnit: original.altUnit,
    conversionFactor:
      original.conversionFactor === null ? null : Number(original.conversionFactor),
    altSalePrice: original.altSalePrice === null ? null : Number(original.altSalePrice),
    pairedProductId: original.pairedProductId,
    pairPrice: original.pairPrice === null ? null : Number(original.pairPrice),
    surchargeDebit:
      original.surchargeDebit === null ? null : Number(original.surchargeDebit),
    surchargeCredit:
      original.surchargeCredit === null ? null : Number(original.surchargeCredit),
  };

  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (next[key] !== current[key]) patch[key] = next[key];
  }
  return patch;
}

export function ProductDetail({
  product,
  allProducts,
  cardFees,
  onClose,
  onSaved,
}: {
  product: ProductFull;
  /** Catálogo completo — alimenta o seletor do produto agregado e a leitura do par (ADR-015). */
  allProducts: ProductFull[];
  /** Taxas da maquininha da loja (ADR-016) — só para exibir a margem real; nunca mudam preço. */
  cardFees?: CardFees | null;
  onClose: () => void;
  /** Chamado após um PATCH bem-sucedido, para a lista recarregar. */
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trocar de produto (clicar outra linha com o painel aberto) recomeça em leitura.
  useEffect(() => {
    setForm(toForm(product));
    setEditing(false);
    setError(null);
  }, [product]);

  // Esc fecha o painel (atalho de teclado no desktop, CLAUDE.md → menos cliques).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = editing ? buildPatch(product, form) : {};
  const changed = Object.keys(patch).length > 0;

  // Par (ADR-015). O par vale dos DOIS lados: ou este produto aponta para o agregado,
  // ou outro produto aponta para este. Na leitura mostramos qualquer um dos dois casos.
  const pairedHere = product.pairedProductId
    ? allProducts.find((p) => p.id === product.pairedProductId)
    : undefined;
  const pairedFromOther = allProducts.find((p) => p.pairedProductId === product.id);
  const pairPartner = pairedHere ?? pairedFromOther;
  const pairPriceShown = pairedHere ? product.pairPrice : (pairedFromOther?.pairPrice ?? null);
  // Cadastrar o par pelo outro lado criaria dois preços para o mesmo par (a API recusa),
  // então aqui o campo fica bloqueado, explicando onde editar.
  const pairLockedByOther = !pairedHere && !!pairedFromOther;

  async function onSave() {
    setError(null);
    if (!form.name.trim() || !form.sku.trim()) {
      setError('Nome e SKU são obrigatórios.');
      return;
    }
    // Par (ADR-015): agregado sem preço salvaria um par que o PDV nunca ofereceria.
    if (form.pairedProductId && !(Number(form.pairPrice) > 0)) {
      setError('Informe o preço do par (ou remova o produto agregado).');
      return;
    }
    const parsed = updateProductSchema.safeParse(patch);
    if (!parsed.success) {
      setError('Confira os campos: há valor inválido no formulário.');
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/products/${product.id}`, parsed.data);
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2';
  const labelCls = 'text-xs font-medium text-gray-500';

  /** Linha de leitura: rótulo + valor (ou "—" quando vazio). */
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
        aria-label={`Cadastro de ${product.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
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

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {!editing ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Row label="Nome" value={product.name} />
              <Row label="Nome popular" value={product.popularName} />
              <Row label="Fabricante" value={product.manufacturer} />
              <Row label="SKU / código de barras" value={product.sku} />
              <Row label="Unidade de venda" value={unitTypeLabels[product.unit]} />
              <Row
                label="Peso"
                value={product.weightKg === null ? null : `${QTY(product.weightKg)} kg`}
              />
              <Row label="Custo" value={BRL(product.costPrice)} />
              <Row label="Venda" value={BRL(product.salePrice)} />
              <Row label="Margem" value={`${product.marginPercent}%`} />
              {/*
                Preço e margem por forma de pagamento (ADR-016). Só aparece quando há algo a
                dizer: acréscimo cadastrado no produto OU taxa da maquininha cadastrada na loja.
                A margem aqui é a REAL — já descontada a taxa —, que é o número que decide se o
                acréscimo está no tamanho certo.
              */}
              {(['DEBIT_CARD', 'CREDIT_CARD'] as const).map((m) => {
                const extra = surchargePerBaseUnit(toSurcharge(product), m);
                const fee = cardFeePercentFor(cardFees ?? {}, m);
                if (extra === 0 && fee === 0) return null;
                const preco = Number(product.salePrice) + extra;
                const margem = netMarginPercent(Number(product.costPrice), preco, fee);
                return (
                  <Row
                    key={m}
                    label={m === 'DEBIT_CARD' ? 'No débito' : 'No crédito'}
                    value={
                      <>
                        {BRL(preco)}
                        {extra > 0 && (
                          <span className="text-gray-400"> (+{BRL(extra)})</span>
                        )}
                        <span
                          className={`block text-xs ${margem < 0 ? 'text-red-600' : 'text-gray-400'}`}
                        >
                          margem real {margem}%
                          {fee > 0 && ` · taxa ${fee}%`}
                        </span>
                      </>
                    }
                  />
                );
              })}
              <Row
                label="Estoque atual"
                value={`${QTY(product.stockQty)} ${unitTypeLabels[product.unit]}`}
              />
              <Row label="Estoque mínimo" value={QTY(product.minStockQty)} />
              <Row
                label="Embalagem fechada"
                value={
                  product.altUnit && product.altSalePrice && product.conversionFactor
                    ? `${unitTypeLabels[product.altUnit]} · ${QTY(product.conversionFactor)} por embalagem · ${BRL(product.altSalePrice)}`
                    : null
                }
              />
              {/* Par (ADR-015) — mostrado dos dois lados, e a economia calculada. */}
              <Row
                label="Vendido em par com"
                value={
                  pairPartner && pairPriceShown ? (
                    <>
                      {pairPartner.name} — par por{' '}
                      <span className="font-medium">{BRL(pairPriceShown)}</span>
                      <span className="block text-xs text-gray-400">
                        avulsos: {BRL(Number(product.salePrice) + Number(pairPartner.salePrice))}
                        {pairLockedByOther && ' · cadastrado no outro produto'}
                      </span>
                    </>
                  ) : null
                }
              />
              <div className="col-span-2 sm:col-span-3">
                <dt className={labelCls}>Descrição / observação</dt>
                <dd className="whitespace-pre-wrap text-sm text-gray-900">
                  {product.description || <span className="text-gray-400">—</span>}
                </dd>
              </div>
            </dl>

            {/* Autoria (ADR-010) — quem cadastrou e quem alterou por último. */}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <div>Cadastrado por {byLine(product.createdByName, product.createdAt)}</div>
              <div>Última alteração {byLine(product.updatedByName, product.updatedAt)}</div>
            </div>

            <p className="mt-3 text-xs text-gray-400">
              O estoque não se edita pelo cadastro — o saldo só muda por movimentação, na tela
              de Estoque (ADR-001).
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Editar
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-6"
          >
            <label className="sm:col-span-3">
              <span className={labelCls}>Nome</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-3">
              <span className={labelCls}>Nome popular</span>
              <input
                value={form.popularName}
                onChange={(e) => setForm({ ...form, popularName: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-3">
              <span className={labelCls}>Fabricante</span>
              <input
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                maxLength={120}
                placeholder="Ex.: Votorantim, Tigre"
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-3">
              <span className={labelCls}>SKU / código de barras</span>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-2">
              <span className={labelCls}>Custo</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-2">
              <span className={labelCls}>Venda</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-2">
              <span className={labelCls}>Estoque mínimo</span>
              <input
                type="number"
                step="1"
                min="0"
                value={form.minStockQty}
                onChange={(e) => setForm({ ...form, minStockQty: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-3">
              <span className={labelCls}>Unidade de venda</span>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value as UnitType })}
                className={`${inputCls} bg-white`}
              >
                {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                  <option key={u} value={u}>
                    {unitTypeLabels[u]}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-3">
              <span className={labelCls}>Peso (vazio = sem peso)</span>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })}
                  className={inputCls}
                />
                <select
                  value={form.weightUnit}
                  onChange={(e) =>
                    setForm({ ...form, weightUnit: e.target.value as 'kg' | 'g' })
                  }
                  className="rounded-lg border border-gray-300 bg-white px-2 py-2"
                  aria-label="Unidade do peso"
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              </div>
            </div>
            <label className="sm:col-span-6">
              <span className={labelCls}>Descrição / observação</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={500}
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </label>

            {/* Venda em unidade alternativa (EF-3, ADR-013). Limpar a unidade desfaz a embalagem. */}
            <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
              <legend className="px-1 text-xs font-medium text-gray-500">
                Venda em unidade alternativa (opcional)
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select
                  value={form.altUnit}
                  onChange={(e) =>
                    setForm({ ...form, altUnit: e.target.value as UnitType | '' })
                  }
                  className={`${inputCls} bg-white`}
                  aria-label="Unidade da embalagem alternativa"
                >
                  <option value="">— sem embalagem alternativa —</option>
                  {(Object.keys(unitTypeLabels) as UnitType[]).map((u) => (
                    <option key={u} value={u}>
                      {unitTypeLabels[u]}
                    </option>
                  ))}
                </select>
                <input
                  placeholder={`Tamanho (${unitTypeLabels[form.unit]} por embalagem)`}
                  type="number"
                  step="any"
                  min="0"
                  value={form.conversionFactor}
                  onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
                  className={inputCls}
                />
                <input
                  placeholder="Preço da embalagem fechada"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.altSalePrice}
                  onChange={(e) => setForm({ ...form, altSalePrice: e.target.value })}
                  className={inputCls}
                />
              </div>
            </fieldset>

            {/* Produto agregado — venda em par (ADR-015). */}
            <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
              <legend className="px-1 text-xs font-medium text-gray-500">
                Vendido em par (opcional) — ex.: parafuso + bucha
              </legend>
              {pairLockedByOther ? (
                <p className="text-sm text-gray-500">
                  Este par está cadastrado em <strong>{pairedFromOther?.name}</strong> e já vale
                  para os dois lados. Para alterar o preço do par, edite aquele produto.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <select
                      value={form.pairedProductId}
                      onChange={(e) =>
                        setForm({ ...form, pairedProductId: e.target.value })
                      }
                      className={`${inputCls} bg-white`}
                      aria-label="Produto agregado"
                    >
                      <option value="">— sem produto agregado —</option>
                      {allProducts
                        .filter((p) => p.id !== product.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({BRL(p.salePrice)})
                          </option>
                        ))}
                    </select>
                    <input
                      placeholder="Preço do par (os dois juntos)"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.pairPrice}
                      onChange={(e) => setForm({ ...form, pairPrice: e.target.value })}
                      disabled={form.pairedProductId === ''}
                      className={`${inputCls} disabled:bg-gray-50`}
                    />
                  </div>
                  {/* Mostra o que o cliente economiza — confere o preço na hora de cadastrar. */}
                  {form.pairedProductId && Number(form.pairPrice) > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      Avulsos:{' '}
                      {BRL(
                        Number(form.salePrice || 0) +
                          Number(
                            allProducts.find((p) => p.id === form.pairedProductId)?.salePrice ?? 0,
                          ),
                      )}{' '}
                      · no par: {BRL(Number(form.pairPrice))}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">
                    O preço é o total dos dois juntos. Vale para os dois lados — não precisa
                    cadastrar de novo no outro produto.
                  </p>
                </>
              )}
            </fieldset>

            {/* Acréscimo por forma de pagamento (ADR-016) — opt-in por produto. */}
            <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
              <legend className="px-1 text-xs font-medium text-gray-500">
                Acréscimo por forma de pagamento — quanto o preço SOBE no cartão
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  placeholder="Acréscimo no débito (R$)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.surchargeDebit}
                  onChange={(e) => setForm({ ...form, surchargeDebit: e.target.value })}
                  className={inputCls}
                  aria-label="Acréscimo no débito"
                />
                <input
                  placeholder="Acréscimo no crédito (R$)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.surchargeCredit}
                  onChange={(e) => setForm({ ...form, surchargeCredit: e.target.value })}
                  className={inputCls}
                  aria-label="Acréscimo no crédito"
                />
              </div>
              {/* Prévia do preço resultante — evita a confusão "digitei o preço final?". */}
              {Number(form.salePrice) > 0 &&
              (Number(form.surchargeDebit) > 0 || Number(form.surchargeCredit) > 0) ? (
                <p className="mt-2 text-xs text-gray-500">
                  À vista {BRL(form.salePrice)} · no débito{' '}
                  <strong>
                    {BRL(Number(form.salePrice) + (Number(form.surchargeDebit) || 0))}
                  </strong>{' '}
                  · no crédito{' '}
                  <strong>
                    {BRL(Number(form.salePrice) + (Number(form.surchargeCredit) || 0))}
                  </strong>
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-400">
                  Vazio = mesmo preço em qualquer forma de pagamento. Dinheiro e PIX nunca têm
                  acréscimo.
                </p>
              )}
            </fieldset>

            <div className="flex justify-end gap-2 sm:col-span-6">
              <button
                type="button"
                onClick={() => {
                  setForm(toForm(product));
                  setEditing(false);
                  setError(null);
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Descartar
              </button>
              <button
                type="submit"
                disabled={!changed || saving}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
              >
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
