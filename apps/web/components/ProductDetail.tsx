'use client';

import { useEffect, useState } from 'react';
import {
  isValidGtin,
  onlyDigits,
  updateProductSchema,
  unitTypeLabels,
  type EanLookupResult,
  type UnitType,
} from '@nexoloja/shared';
import {
  cardFeePercentFor,
  isClosedPrimary,
  netMarginPercent,
  splitWholeAndRemainder,
  surchargePerBaseUnit,
} from '@nexoloja/core';
import { apiDelete, apiGet, apiPatch } from '@/lib/api';
import { MoneyInput } from '@/components/MoneyInput';
import { PricingEsteira } from '@/components/PricingEsteira';

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
  // Código de barras (EAN/GTIN) — distinto do sku interno (ADR-025). null ⇒ sem código.
  ean: string | null;
  // Foto do produto — URL externa (hotlink) ou do R2. null ⇒ sem foto.
  imageUrl: string | null;
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
  // Desativar/Reativar: `false` = fora de circulação (some do PDV/Estoque), reversível.
  isActive: boolean;
  // Item 5 da esteira: instante em que uma Entrada de estoque ajustou o custo; null ⇒ nada pendente.
  priceReviewPendingAt: string | null;
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
  ean: string;
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
    ean: p.ean ?? '',
    description: p.description ?? '',
    unit: p.unit,
    costPrice: String(Number(p.costPrice)),
    // Preço de venda sempre a 2 casas: dados legados podem vir com 4 (Decimal(12,4)) e apareceriam
    // no campo ao focar. A esteira já arredonda os cálculos; aqui cobrimos a carga.
    salePrice: String(Number(Number(p.salePrice).toFixed(2))),
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
    // Código de barras guardado como dígitos; vazio limpa (null).
    ean: onlyDigits(f.ean) || null,
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
    ean: original.ean,
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
  // Passo de confirmação da exclusão (ação destrutiva → deliberada, sem window.confirm).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Trava dupla-clique em desativar/reativar (PATCH isActive).
  const [togglingActive, setTogglingActive] = useState(false);
  // Item 5 da esteira: aviso "custo ajustado por Entrada de estoque, confira o preço".
  const priceReviewPending = product.priceReviewPendingAt != null;
  const [dismissingReview, setDismissingReview] = useState(false);
  // "Sincronizar dados pelo EAN" (ADR-025): preenche marca/foto vazias pela ficha do catálogo.
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Trocar de produto (clicar outra linha com o painel aberto) recomeça em leitura.
  useEffect(() => {
    setForm(toForm(product));
    setEditing(false);
    setError(null);
    setConfirmingDelete(false);
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

  // ADR-017: unidade fechada (barra/rolo) como principal. O estoque é em metros; aqui é exibido
  // como barras + sobra, e a apresentação (custo/preço = da barra; venda por metro opcional) inverte.
  const closed = isClosedPrimary({
    unit: product.unit,
    conversionFactor: product.conversionFactor != null ? Number(product.conversionFactor) : null,
  });
  // Artigo correto p/ os rótulos de custo/preço da unidade fechada (evita "Preço da Rolo"),
  // baseado na unidade que está sendo editada (form), não só na original.
  const unitArticle = form.unit === 'ROLL' ? 'do rolo' : 'da barra';
  const barLen = product.conversionFactor != null ? Number(product.conversionFactor) : 0;
  const stockLabel = (() => {
    if (!closed) return `${QTY(product.stockQty)} ${unitTypeLabels[product.unit]}`;
    const { whole, remainderMeters } = splitWholeAndRemainder(Number(product.stockQty), barLen);
    return `${whole} ${unitTypeLabels[product.unit].toLowerCase()}${remainderMeters > 0 ? ` + ${QTY(remainderMeters)} m` : ''}`;
  })();

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
      // Salvar o cadastro reconhece o aviso de revisão de preço (o operador esteve na esteira e
      // conferiu o preço). `dismissPriceReview` não é coluna — o servidor limpa a marca.
      await apiPatch(`/products/${product.id}`, {
        ...parsed.data,
        ...(priceReviewPending ? { dismissPriceReview: true } : {}),
      });
      await onSaved();
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Soft-delete (ADR-004) — definitivo. Fecha o painel e recarrega a lista. */
  async function onDelete() {
    setError(null);
    setSaving(true);
    try {
      await apiDelete(`/products/${product.id}`);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  /** Desativar/Reativar — reversível (PATCH isActive). Mantém o painel aberto para ver o novo estado. */
  async function onToggleActive() {
    setError(null);
    setTogglingActive(true);
    try {
      await apiPatch(`/products/${product.id}`, { isActive: !product.isActive });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingActive(false);
    }
  }

  /** Item 5: reconhece o aviso de revisão de preço sem abrir a edição (botão "Marcar como conferido"). */
  async function onDismissReview() {
    setError(null);
    setDismissingReview(true);
    try {
      await apiPatch(`/products/${product.id}`, { dismissPriceReview: true });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDismissingReview(false);
    }
  }

  /**
   * "Sincronizar dados pelo EAN" (pedido 3 do Owner): busca a ficha do catálogo global (que também
   * consulta a fonte externa no cache-miss) e preenche APENAS os campos VAZIOS do produto — marca e
   * foto. Nunca sobrescreve o que o operador já cadastrou. O NCM é fiscal e vive no catálogo global
   * (não é coluna do produto), então fica conhecido lá, mas não altera este cadastro.
   */
  async function onSyncEan() {
    setError(null);
    setSyncMsg(null);
    const digits = onlyDigits(product.ean ?? '');
    if (!isValidGtin(digits)) {
      setError('Cadastre um código de barras (EAN) válido para sincronizar.');
      return;
    }
    setSyncing(true);
    try {
      const r = await apiGet<EanLookupResult>(`/catalog/ean/${digits}`);
      if (!r.found || !r.catalog) {
        setSyncMsg('Sem ficha técnica nas fontes gratuitas para este código.');
        return;
      }
      const patch: Record<string, unknown> = {};
      if (!product.manufacturer && r.catalog.brand) patch.manufacturer = r.catalog.brand;
      if (!product.imageUrl && r.catalog.imageUrl) patch.imageUrl = r.catalog.imageUrl;
      if (Object.keys(patch).length === 0) {
        setSyncMsg('Nada a preencher — marca e foto já estão no cadastro.');
        return;
      }
      await apiPatch(`/products/${product.id}`, patch);
      await onSaved();
      const filled = Object.keys(patch).map((k) => (k === 'manufacturer' ? 'marca' : 'foto'));
      setSyncMsg(`Preenchido pela ficha: ${filled.join(' e ')}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2';
  const labelCls = 'text-xs font-medium text-gray-600';

  /** Linha de leitura: rótulo + valor (ou "—" quando vazio). */
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <dt className={labelCls}>{label}</dt>
      <dd className="text-sm text-gray-900">{value || <span className="text-gray-500">—</span>}</dd>
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
          <div className="flex min-w-0 items-start gap-3">
            {/* Foto do produto (hotlink; ADR-025). onError esconde link externo quebrado. */}
            {product.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={`Foto de ${product.name}`}
                className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 bg-white object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold">{product.name}</h2>
              {!product.isActive && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Inativo
                </span>
              )}
            </div>
            <p className="truncate text-xs text-gray-600">
              {product.sku}
              {product.manufacturer ? ` · ${product.manufacturer}` : ''}
            </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
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
              <Row label="SKU (código interno)" value={product.sku} />
              <Row label="Código de barras (EAN)" value={product.ean} />
              <Row label="Unidade de venda" value={unitTypeLabels[product.unit]} />
              <Row
                label="Peso"
                value={product.weightKg === null ? null : `${QTY(product.weightKg)} kg`}
              />
              <Row label={closed ? 'Custo da barra' : 'Custo'} value={BRL(product.costPrice)} />
              <Row label={closed ? 'Preço da barra' : 'Venda'} value={BRL(product.salePrice)} />
              <Row label="Margem" value={`${product.marginPercent}%`} />
              {closed && (
                <Row
                  label="Tamanho da barra"
                  value={barLen > 0 ? `${QTY(barLen)} m` : null}
                />
              )}
              {closed && (
                <Row
                  label="Venda por metro"
                  value={product.altSalePrice ? `${BRL(product.altSalePrice)}/m` : null}
                />
              )}
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
                          <span className="text-gray-500"> (+{BRL(extra)})</span>
                        )}
                        <span
                          className={`block text-xs ${margem < 0 ? 'text-red-600' : 'text-gray-500'}`}
                        >
                          margem real {margem}%
                          {fee > 0 && ` · taxa ${fee}%`}
                        </span>
                      </>
                    }
                  />
                );
              })}
              <Row label="Estoque atual" value={stockLabel} />
              <Row label="Estoque mínimo" value={QTY(product.minStockQty)} />
              {!closed && (
                <Row
                  label="Embalagem fechada"
                  value={
                    product.altUnit && product.altSalePrice && product.conversionFactor
                      ? `${unitTypeLabels[product.altUnit]} · ${QTY(product.conversionFactor)} por embalagem · ${BRL(product.altSalePrice)}`
                      : null
                  }
                />
              )}
              {/* Par (ADR-015) — mostrado dos dois lados, e a economia calculada. */}
              <Row
                label="Vendido em par com"
                value={
                  pairPartner && pairPriceShown ? (
                    <>
                      {pairPartner.name} — par por{' '}
                      <span className="font-medium">{BRL(pairPriceShown)}</span>
                      <span className="block text-xs text-gray-500">
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
                  {product.description || <span className="text-gray-500">—</span>}
                </dd>
              </div>
            </dl>

            {/* Autoria (ADR-010) — quem cadastrou e quem alterou por último. */}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-3 text-xs text-gray-600">
              <div>Cadastrado por {byLine(product.createdByName, product.createdAt)}</div>
              <div>Última alteração {byLine(product.updatedByName, product.updatedAt)}</div>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              O estoque não se edita pelo cadastro — o saldo só muda por movimentação, na tela
              de Estoque (ADR-001).
            </p>

            {/* Enriquecimento por EAN (ADR-025) — preenche marca/foto vazias pela ficha do catálogo
                global (que consulta a fonte externa no cache-miss). Nunca sobrescreve o já digitado. */}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={onSyncEan}
                disabled={syncing || !product.ean}
                className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                title={
                  product.ean
                    ? 'Busca marca e foto pelo código de barras e preenche o que estiver vazio no cadastro.'
                    : 'Cadastre um código de barras (EAN) neste produto para usar.'
                }
              >
                {syncing ? 'Sincronizando…' : '🔄 Sincronizar dados pelo EAN'}
              </button>
              {syncMsg && <span className="text-xs text-gray-600">{syncMsg}</span>}
              {!product.ean && (
                <span className="text-xs text-gray-500">Cadastre um EAN (em Editar) para habilitar.</span>
              )}
            </div>

            {/* Item 5 da esteira: aviso discreto de que o custo foi ajustado por uma Entrada de
                estoque e a margem mudou — pedindo para conferir o Preço de Venda. Persiste até o
                operador reconhecer (aqui ou ao salvar uma edição). */}
            {priceReviewPending && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-800">
                  ⚠️ O <strong>custo</strong> deste produto foi ajustado por uma Entrada de estoque
                  {product.priceReviewPendingAt
                    ? ` em ${new Date(product.priceReviewPendingAt).toLocaleDateString('pt-BR')}`
                    : ''}
                  . A margem mudou — <strong>confira o Preço de Venda</strong>.
                </p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Revisar preço
                  </button>
                  <button
                    type="button"
                    onClick={onDismissReview}
                    disabled={dismissingReview}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                  >
                    {dismissingReview ? '…' : 'Marcar como conferido'}
                  </button>
                </div>
              </div>
            )}

            {confirmingDelete ? (
              // Confirmação da exclusão (definitiva). Avisa quando desfaz um par (ADR-015).
              <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">
                  Excluir “{product.name}” definitivamente?
                </p>
                <p className="mt-1 text-xs text-red-700">
                  O produto sai do catálogo e do PDV e <strong>não poderá ser reativado</strong> (o
                  histórico de vendas e estoque é preservado). Para tirar só temporariamente, use
                  <strong> Desativar</strong>.
                </p>
                {pairPartner && (
                  <p className="mt-2 text-xs text-red-700">
                    ⚠️ Este produto forma <strong>par</strong> com “{pairPartner.name}”. Ao excluir,
                    o par deixa de ser oferecido no PDV.
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={saving}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={saving}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {saving ? 'Excluindo…' : 'Excluir definitivamente'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                {/* Ações do ciclo de vida do produto (reversível × definitiva). */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onToggleActive}
                    disabled={togglingActive}
                    className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    title={
                      product.isActive
                        ? 'Tira o produto de circulação (some do PDV/Estoque). Pode reativar depois.'
                        : 'Volta o produto para o catálogo e o PDV.'
                    }
                  >
                    {togglingActive ? '…' : product.isActive ? 'Desativar' : 'Reativar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    title="Exclui o produto definitivamente (não reativa)."
                  >
                    Excluir
                  </button>
                </div>
                <div className="flex gap-2">
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
              </div>
            )}
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
              <span className={labelCls}>SKU (código interno)</span>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-3">
              <span className={labelCls}>Código de barras (EAN)</span>
              <input
                value={form.ean}
                onChange={(e) => setForm({ ...form, ean: e.target.value })}
                inputMode="numeric"
                placeholder="EAN/GTIN do fabricante"
                className={inputCls}
              />
            </label>
            {/* Esteira de precificação sincronizada (Custo · Markup · Preço · Margem).
                A verdade continua sendo costPrice/salePrice; markup e margem são derivados. */}
            <div className="sm:col-span-6">
              <PricingEsteira
                costPrice={form.costPrice}
                salePrice={form.salePrice}
                onChange={(next) => setForm((f) => ({ ...f, ...next }))}
                costLabel={closed ? `Custo ${unitArticle}` : 'Custo'}
                priceLabel={closed ? `Preço ${unitArticle}` : 'Venda'}
              />
            </div>
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

            {/* ADR-017: unidade fechada (barra/rolo) — tamanho + preço por metro (opcional). */}
            {closed ? (
              <fieldset className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3 sm:col-span-6">
                <legend className="px-1 text-xs font-medium text-indigo-700">
                  {unitTypeLabels[form.unit]} — tamanho e venda por metro
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    placeholder={`Tamanho: 1 ${unitTypeLabels[form.unit]} = ? metros`}
                    type="number"
                    step="any"
                    min="0"
                    value={form.conversionFactor}
                    onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
                    className={inputCls}
                  />
                  <MoneyInput
                    placeholder="Preço por metro (opcional)"
                    value={form.altSalePrice}
                    onChange={(v) => setForm({ ...form, altSalePrice: v })}
                    className={inputCls}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  Custo e preço acima são da <strong>{unitTypeLabels[form.unit]} inteira</strong>. O
                  estoque é contado em metros. Preço por metro vazio ⇒ só vende inteiro.
                </p>
              </fieldset>
            ) : (
              <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
                <legend className="px-1 text-xs font-medium text-gray-600">
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
                  <MoneyInput
                    placeholder="Preço da embalagem fechada"
                    value={form.altSalePrice}
                    onChange={(v) => setForm({ ...form, altSalePrice: v })}
                    className={inputCls}
                  />
                </div>
              </fieldset>
            )}

            {/* Produto agregado — venda em par (ADR-015). */}
            <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
              <legend className="px-1 text-xs font-medium text-gray-600">
                Vendido em par (opcional) — ex.: parafuso + bucha
              </legend>
              {pairLockedByOther ? (
                <p className="text-sm text-gray-600">
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
                        .filter((p) => p.id !== product.id && p.isActive)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({BRL(p.salePrice)})
                          </option>
                        ))}
                    </select>
                    <MoneyInput
                      placeholder="Preço do par (os dois juntos)"
                      value={form.pairPrice}
                      onChange={(v) => setForm({ ...form, pairPrice: v })}
                      disabled={form.pairedProductId === ''}
                      className={`${inputCls} disabled:bg-gray-50`}
                    />
                  </div>
                  {/* Mostra o que o cliente economiza — confere o preço na hora de cadastrar. */}
                  {form.pairedProductId && Number(form.pairPrice) > 0 && (
                    <p className="mt-2 text-xs text-gray-600">
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
                  <p className="mt-2 text-xs text-gray-500">
                    O preço é o total dos dois juntos. Vale para os dois lados — não precisa
                    cadastrar de novo no outro produto.
                  </p>
                </>
              )}
            </fieldset>

            {/* Acréscimo por forma de pagamento (ADR-016) — opt-in por produto. */}
            <fieldset className="rounded-xl border border-dashed border-gray-300 p-3 sm:col-span-6">
              <legend className="px-1 text-xs font-medium text-gray-600">
                Acréscimo por forma de pagamento — quanto o preço SOBE no cartão
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MoneyInput
                  placeholder="Acréscimo no débito (R$)"
                  value={form.surchargeDebit}
                  onChange={(v) => setForm({ ...form, surchargeDebit: v })}
                  className={inputCls}
                  aria-label="Acréscimo no débito"
                />
                <MoneyInput
                  placeholder="Acréscimo no crédito (R$)"
                  value={form.surchargeCredit}
                  onChange={(v) => setForm({ ...form, surchargeCredit: v })}
                  className={inputCls}
                  aria-label="Acréscimo no crédito"
                />
              </div>
              {/* Prévia do preço resultante — evita a confusão "digitei o preço final?". */}
              {Number(form.salePrice) > 0 &&
              (Number(form.surchargeDebit) > 0 || Number(form.surchargeCredit) > 0) ? (
                <p className="mt-2 text-xs text-gray-600">
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
                <p className="mt-2 text-xs text-gray-500">
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
