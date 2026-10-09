'use client';

import { useState } from 'react';
import {
  DEFAULT_SCALE_LABEL_LAYOUT,
  SCALE_LABEL_FORMATS,
  parseScaleBarcode,
  scaleLabelPattern,
} from '@nexoloja/core';
import { SCALE_LABEL_VALUE_LABELS, type ScaleLabelLayoutInput } from '@nexoloja/shared';

/**
 * Formato da etiqueta de balança de uma loja (ADR-040 §3), no painel da plataforma.
 *
 * - **Formato:** só as combinações de dígitos que cabem no EAN-13 (`SCALE_LABEL_FORMATS`, core), com o
 *   desenho de cada uma (`2 CCCC 0 VVVVVV D`) — o implantador compara com a etiqueta impressa.
 * - **Valor:** preço total (recomendado) ou peso.
 * - **Testar etiqueta:** bipa/digita uma etiqueta real e mostra o que o PDV vai ler no formato atual —
 *   resolve a configuração no dia em que a balança chega, sem tentativa e erro no caixa.
 */
const formatKey = (f: Pick<ScaleLabelLayoutInput, 'pluDigits' | 'valueDigits' | 'valueCheckDigit'>) =>
  `${f.pluDigits}-${f.valueDigits}-${f.valueCheckDigit ? 'K' : 'N'}`;

const BRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ScaleLabelSettings({
  layout,
  busy,
  onChange,
}: {
  layout: ScaleLabelLayoutInput;
  busy: boolean;
  onChange: (next: ScaleLabelLayoutInput) => void;
}) {
  const [testCode, setTestCode] = useState('');
  const digits = testCode.replace(/\D/g, '');
  const parsed = digits.length === 13 ? parseScaleBarcode(digits, layout) : null;

  return (
    <div className="mt-1.5 space-y-1 text-xs text-gray-600">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Etiqueta:</span>
        <select
          value={formatKey(layout)}
          onChange={(e) => {
            const f = SCALE_LABEL_FORMATS.find((x) => formatKey(x) === e.target.value);
            if (f) onChange({ ...layout, ...f });
          }}
          disabled={busy}
          aria-label="Formato da etiqueta de balança"
          title="C = código do produto (PLU) · 0 = preenchimento · V = valor · K = dígito do valor · D = dígito final"
          className="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono"
        >
          {SCALE_LABEL_FORMATS.map((f) => (
            <option key={formatKey(f)} value={formatKey(f)}>
              {scaleLabelPattern(f)}
              {formatKey(f) === formatKey(DEFAULT_SCALE_LABEL_LAYOUT) ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
        <select
          value={layout.value}
          onChange={(e) => onChange({ ...layout, value: e.target.value as ScaleLabelLayoutInput['value'] })}
          disabled={busy}
          aria-label="Valor embutido na etiqueta"
          className="rounded border border-gray-300 bg-white px-1 py-0.5"
        >
          {(['PRICE', 'WEIGHT'] as const).map((v) => (
            <option key={v} value={v}>
              {SCALE_LABEL_VALUE_LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={testCode}
          onChange={(e) => setTestCode(e.target.value)}
          inputMode="numeric"
          placeholder="Testar etiqueta (bipe aqui)"
          aria-label="Testar etiqueta de balança"
          className="w-44 rounded border border-gray-300 px-1.5 py-0.5"
        />
        {digits.length > 0 &&
          (digits.length !== 13 ? (
            <span className="text-gray-400">{digits.length}/13 dígitos</span>
          ) : parsed ? (
            <span className="text-emerald-700">
              ✓ PLU {parsed.plu} ·{' '}
              {'priceCents' in parsed ? BRL(parsed.priceCents) : `${(parsed.grams / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg`}
            </span>
          ) : (
            <span className="text-red-600">✕ Não é etiqueta válida neste formato</span>
          ))}
      </div>
    </div>
  );
}
