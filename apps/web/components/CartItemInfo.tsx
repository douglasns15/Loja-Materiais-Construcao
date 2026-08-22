'use client';

import { useEffect } from 'react';
import {
  PAYMENT_METHOD_LABELS,
  unitTypeLabels,
  type CartItem,
  type PaymentMethod,
  type UnitType,
} from '@nexoloja/shared';
import { cardFeePercentFor, netMarginPercent } from '@nexoloja/core';

/**
 * Modal de **informações do item** da cesta (ADR-021, pedido do Owner: um "i" por linha do
 * carrinho). Cruza a linha (`CartItem`) com o produto do catálogo para mostrar, num lugar só:
 * identificação (apelido/fabricante/SKU), modo de venda e unidade, preço/quantidade/total da linha,
 * **custo e margem real** (líquida da taxa da maquininha da forma principal — ADR-016), estoque, o
 * acréscimo por forma de pagamento e a composição do par (ADR-015). Somente leitura.
 */

/** Campos do produto do catálogo que o modal exibe (subconjunto do `Product` do PDV). */
export type InfoProduct = {
  popularName: string | null;
  manufacturer: string | null;
  sku: string;
  /** Descrição/observação livre do cadastro (OBS). Exibida quando preenchida. */
  description: string | null;
  stockQty: string;
  unit: UnitType;
};

type Fees = { cardFeeDebitPercent: number | null; cardFeeCreditPercent: number | null } | null;

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const QTY = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

/** "Metro (m)" → "Metro"; "Rolo" → "Rolo". */
const unitShort = (u: UnitType) => unitTypeLabels[u].replace(/\s*\(.*\)$/, '');

/** Linha rótulo/valor do corpo do modal. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}

export function CartItemInfo({
  item,
  product,
  primaryMethod,
  cardFees,
  onClose,
}: {
  item: CartItem;
  product?: InfoProduct;
  primaryMethod: PaymentMethod;
  cardFees: Fees;
  onClose: () => void;
}) {
  // Fecha no Esc (padrão dos modais do app).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Margem REAL: líquida da taxa da maquininha da forma PRINCIPAL (ADR-016). Mesma lógica do
  // tooltip do PDV — no par/unidade fechada o custo já é por unidade vendida; na embalagem o
  // preço efetivo por unidade-base é preço ÷ fator, comparável ao custo.
  const fee = cardFeePercentFor(cardFees ?? {}, primaryMethod);
  const feeNote = fee > 0 ? ` (líq. da taxa de ${fee}%)` : '';
  const margin =
    item.pair || item.closed
      ? netMarginPercent(item.costPrice, item.unitPrice, fee)
      : netMarginPercent(
          item.costPrice,
          item.conversionFactor > 0 ? item.unitPrice / item.conversionFactor : item.unitPrice,
          fee,
        );

  const lineTotal = item.unitPrice * item.quantity;
  const isAlt = item.saleMode === 'ALT' && !item.pair;
  const surcharge =
    primaryMethod === 'DEBIT_CARD'
      ? item.surchargeDebit
      : primaryMethod === 'CREDIT_CARD'
        ? item.surchargeCredit
        : 0;

  const modo = item.pair
    ? 'Par (baixa 1 de cada produto)'
    : item.closed
      ? isAlt
        ? `Por metro (unidade fechada: ${unitShort(item.baseUnitType)})`
        : `Unidade fechada (${unitShort(item.unitType)})`
      : isAlt
        ? `Embalagem fechada (${unitShort(item.unitType)})`
        : 'Avulso';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Informações de ${item.name}`}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">{item.name}</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {/* Identificação (do catálogo) — só as linhas que existem. */}
        {product && (product.popularName || product.manufacturer || product.sku) && (
          <div className="divide-y divide-gray-100 border-b border-gray-100 pb-1">
            {product.popularName && <Row label="Nome popular">{product.popularName}</Row>}
            {product.manufacturer && <Row label="Fabricante">{product.manufacturer}</Row>}
            {product.sku && <Row label="SKU / código">{product.sku}</Row>}
          </div>
        )}

        {/* Observação (OBS) do cadastro — texto livre, pode ser longo; ocupa a largura toda e
            quebra linha (não cabe numa Row alinhada à direita). Só aparece quando preenchida. */}
        {product?.description && (
          <div className="border-b border-gray-100 py-2">
            <span className="text-sm text-gray-600">Observação</span>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium text-gray-900">
              {product.description}
            </p>
          </div>
        )}

        {/* Venda desta linha. */}
        <div className="divide-y divide-gray-100 border-b border-gray-100 py-1">
          <Row label="Modo de venda">{modo}</Row>
          <Row label="Preço unitário">{BRL(item.unitPrice)}</Row>
          <Row label="Quantidade">
            {QTY(item.quantity)}
            {item.pair
              ? ` par${item.quantity > 1 ? 'es' : ''}`
              : isAlt
                ? ` ${unitShort(item.unitType)}`
                : ''}
          </Row>
          {isAlt && (
            <Row label="Equivale a">
              ≈ {QTY(item.quantity * item.conversionFactor)} {unitShort(item.baseUnitType)}
            </Row>
          )}
          <Row label="Total da linha">{BRL(lineTotal)}</Row>
        </div>

        {/* Custo, margem e estoque. */}
        <div className="divide-y divide-gray-100 border-b border-gray-100 py-1">
          <Row label="Custo unitário">{BRL(item.costPrice)}</Row>
          <Row label={`Margem${feeNote}`}>{margin}%</Row>
          {product && (
            <Row label="Estoque disponível">
              {QTY(Number(product.stockQty))} {unitShort(product.unit)}
            </Row>
          )}
        </div>

        {/* Acréscimo por forma de pagamento (ADR-016), quando houver. */}
        {(item.surchargeDebit > 0 || item.surchargeCredit > 0) && (
          <div className="divide-y divide-gray-100 border-b border-gray-100 py-1">
            {item.surchargeDebit > 0 && (
              <Row label="Acréscimo no débito">+{BRL(item.surchargeDebit)}/un</Row>
            )}
            {item.surchargeCredit > 0 && (
              <Row label="Acréscimo no crédito">+{BRL(item.surchargeCredit)}/un</Row>
            )}
            {surcharge > 0 && (
              <p className="pt-1 text-xs text-amber-700">
                Preço já inclui +{BRL(surcharge)}/un no {PAYMENT_METHOD_LABELS[primaryMethod]}.
              </p>
            )}
          </div>
        )}

        {/* Par (ADR-015). */}
        {item.pair && (
          <div className="py-1">
            <Row label="Par com">{item.pair.partnerName}</Row>
            <p className="text-xs text-emerald-600">Vende os dois juntos; baixa 1 de cada produto.</p>
          </div>
        )}
      </div>
    </div>
  );
}
