'use client';

import { useState } from 'react';
import {
  calcMarginPercent,
  markupPercent,
  repriceHoldingMarkup,
  salePriceFromMarkup,
  salePriceFromMargin,
} from '@nexoloja/core';
import { MoneyInput } from '@/components/MoneyInput';
import { PercentInput } from '@/components/PercentInput';

/**
 * Normaliza um preço canônico para **2 casas** (a única precisão do dinheiro). O `salePrice`
 * pode chegar do banco com 4 casas (`Decimal(12,4)`) — ex.: "33.1075" — e, ao focar o campo,
 * o `MoneyInput` mostraria a precisão cheia ("33,1075"). Aqui garantimos que o Preço de Venda
 * nunca carregue mais de 2 casas, em qualquer caminho (carga, digitação direta ou cálculo).
 */
function money2(v: string): string {
  if (v.trim() === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : v;
}

/**
 * Ícone de info clicável ao lado do rótulo: abre uma frase curta explicando o campo (pedido
 * do Owner). Clique alterna; sai do foco fecha — funciona no toque (mobile) sem depender de hover.
 */
function InfoHint({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        aria-label={label}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] font-semibold leading-none text-gray-500 hover:bg-gray-200 hover:text-gray-700"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-10 w-52 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-normal leading-snug text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * **Esteira de precificação** sincronizada (padrão Bling / Conta Azul / Omie):
 * Custo · Markup (s/ custo) · Preço de venda · Margem (s/ venda), interligados
 * em tempo real.
 *
 * **Sem loop de re-render:** a VERDADE são só `costPrice` e `salePrice` (que o
 * formulário-pai já guarda). Markup e Margem são SEMPRE derivados — nunca viram
 * estado — então não existe o ciclo A→B→A. Editar markup/margem apenas recalcula
 * o preço; editar o custo preserva o markup (reprecifica o preço, regra #1).
 *
 * **Arredondamento reverso automático (regra #2 do pedido):** o preço é a única
 * grandeza monetária, arredondada a 2 casas no core; markup e margem exibidos,
 * por derivarem desse preço já arredondado, refletem os centavos reais sozinhos.
 *
 * Componente **controlado**: recebe os dois valores e devolve os dois juntos em
 * `onChange` (a reprecificação por custo muda ambos de forma atômica).
 */
export function PricingEsteira({
  costPrice,
  salePrice,
  onChange,
  costLabel = 'Custo',
  priceLabel = 'Preço de venda',
  disabled,
}: {
  costPrice: string;
  salePrice: string;
  onChange: (next: { costPrice: string; salePrice: string }) => void;
  costLabel?: string;
  priceLabel?: string;
  disabled?: boolean;
}) {
  const cost = Number(costPrice) || 0;
  const price = Number(salePrice) || 0;

  // Aviso transitório quando a margem digitada é >= 100% (impossível). É só UI:
  // não alimenta custo/preço, então não há como fechar um ciclo.
  const [marginTooHigh, setMarginTooHigh] = useState(false);

  // DERIVADOS (nunca viram estado). Vazio enquanto não há base — o campo fica em branco.
  const markupShown = cost > 0 ? String(markupPercent(cost, price)) : '';
  const marginShown = price > 0 ? String(calcMarginPercent(cost, price)) : '';

  // Editar Custo → preserva o markup e recalcula o preço (regra #1). Só reprecifica
  // quando havia markup a preservar (custo e preço anteriores válidos) e o novo custo
  // é positivo — senão, ao limpar o campo, o preço não é zerado.
  function onCostChange(v: string) {
    const newCost = Number(v) || 0;
    const reprice = cost > 0 && price > 0 && newCost > 0;
    onChange({
      costPrice: v,
      salePrice: reprice ? String(repriceHoldingMarkup(cost, price, newCost)) : salePrice,
    });
  }

  // Editar Preço → fixa o preço (normalizado a 2 casas); markup e margem re-derivam (regra #4).
  function onPriceChange(v: string) {
    onChange({ costPrice, salePrice: money2(v) });
  }

  // Editar Markup → recalcula o preço (regra #2). Precisa de custo > 0 como base.
  function onMarkupChange(v: string) {
    setMarginTooHigh(false);
    const m = Number(v);
    if (v === '' || !Number.isFinite(m) || cost <= 0) return;
    onChange({ costPrice, salePrice: String(salePriceFromMarkup(cost, m)) });
  }

  // Editar Margem → recalcula o preço (regra #3). Margem >= 100 é impossível: avisa
  // e não reprecifica (o campo volta ao valor derivado ao sair do foco).
  function onMarginChange(v: string) {
    const g = Number(v);
    if (v === '' || !Number.isFinite(g)) {
      setMarginTooHigh(false);
      return;
    }
    if (g >= 100 || cost <= 0) {
      setMarginTooHigh(g >= 100);
      return;
    }
    setMarginTooHigh(false);
    onChange({ costPrice, salePrice: String(salePriceFromMargin(cost, g)) });
  }

  // Semáforo da margem (padrão de mercado): prejuízo / no custo / magra / saudável.
  const m = marginShown === '' ? null : Number(marginShown);
  const profitPerUnit = price - cost;

  const fieldCls = 'w-full rounded-lg border border-gray-300 px-3 py-2';
  const labelCls = 'text-xs font-medium text-gray-600';

  return (
    <fieldset className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <legend className="px-1 text-xs font-medium text-gray-600">
        Precificação — os quatro campos se ajustam entre si
      </legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{costLabel}</span>
          <MoneyInput
            value={costPrice}
            onChange={onCostChange}
            disabled={disabled}
            className={fieldCls}
            aria-label={costLabel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`${labelCls} flex items-center gap-1`}>
            Markup s/ custo (%)
            <InfoHint
              label="O que é Markup?"
              text="Quanto você soma SOBRE O CUSTO para chegar ao preço. Ex.: custo R$ 60 + markup 66,67% = venda R$ 100."
            />
          </span>
          <PercentInput
            value={markupShown}
            onChange={onMarkupChange}
            disabled={disabled || cost <= 0}
            title="Quanto o preço sobe sobre o CUSTO. Ex.: custo 60, markup 66,67% → preço 100."
            className={`${fieldCls} disabled:bg-gray-100`}
            aria-label="Markup sobre o custo"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>{priceLabel}</span>
          <MoneyInput
            value={money2(salePrice)}
            onChange={onPriceChange}
            disabled={disabled}
            className={fieldCls}
            aria-label={priceLabel}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`${labelCls} flex items-center gap-1`}>
            Margem s/ venda (%)
            <InfoHint
              label="O que é Margem?"
              text="Quanto sobra SOBRE A VENDA depois do custo. Ex.: vendendo a R$ 100 um item que custou R$ 60, a margem é 40%."
            />
          </span>
          <PercentInput
            value={marginShown}
            onChange={onMarginChange}
            disabled={disabled || cost <= 0}
            title="Quanto sobra sobre a VENDA. Ex.: custo 60, preço 100 → margem 40%."
            className={`${fieldCls} disabled:bg-gray-100`}
            aria-label="Margem sobre a venda"
          />
        </label>
      </div>

      {/* Feedback: margem impossível (>=100) tem prioridade sobre o semáforo. */}
      {marginTooHigh ? (
        <p className="mt-2 text-xs font-medium text-red-600">
          ⚠️ Margem sobre a venda não pode chegar a 100% — o preço seria infinito. Use o
          Markup (que não tem esse teto) para margens muito altas.
        </p>
      ) : m === null ? (
        <p className="mt-2 text-xs text-gray-500">
          Informe o custo e o preço — o markup e a margem aparecem automaticamente.
        </p>
      ) : m < 0 ? (
        <p className="mt-2 text-xs font-medium text-red-600">
          ⚠️ Prejuízo: preço abaixo do custo (−
          {Math.abs(profitPerUnit).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })}{' '}
          por unidade).
        </p>
      ) : m === 0 ? (
        <p className="mt-2 text-xs font-medium text-amber-600">
          Venda no custo — sem lucro nesta unidade.
        </p>
      ) : m < 10 ? (
        <p className="mt-2 text-xs text-amber-600">
          Margem magra ({marginShown}%) —{' '}
          {profitPerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por
          unidade.
        </p>
      ) : (
        <p className="mt-2 text-xs text-emerald-700">
          Lucro de{' '}
          {profitPerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por
          unidade.
        </p>
      )}
    </fieldset>
  );
}
