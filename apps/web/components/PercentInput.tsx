'use client';

import { useState } from 'react';

/**
 * Campo de **percentual** (markup / margem) da esteira de precificação.
 *
 * Mesmo truque de foco do `MoneyInput`: enquanto focado, mostra exatamente o que a pessoa
 * digita (buffer de texto — não "pula" ao digitar centavos, regra de UX #3); ao sair (blur)
 * exibe o valor derivado formatado com "%". Guarda no estado o valor **canônico** (ponto
 * decimal, '' quando vazio), então quem consome com `Number(value)` não muda em nada.
 *
 * Diferente do MoneyInput, aqui `value` é sempre **derivado** de Custo/Preço pelo pai — este
 * campo nunca é fonte de verdade, só um atalho para recalcular o preço. Por isso não há
 * `useEffect` de sincronização (a causa clássica do loop A→B→A).
 */
export function PercentInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  title,
  'aria-label': ariaLabel,
}: {
  /** Valor canônico com ponto decimal (ex.: "32.43"); '' quando vazio. */
  value: string;
  /** Recebe o valor canônico já normalizado (ponto decimal, '' se vazio). */
  onChange: (canonical: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');

  const hasNumber = value !== '' && Number.isFinite(Number(value));
  const display = focused
    ? text
    : hasNumber
      ? `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
      : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      title={title}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      value={display}
      onFocus={() => {
        // Ao focar, mostra o número "limpo" para editar (vírgula como decimal, sem "%").
        setText(hasNumber ? String(Number(value)).replace('.', ',') : '');
        setFocused(true);
      }}
      onChange={(e) => {
        // Só dígitos, vírgula, ponto e sinal de menos (markup/margem podem ser negativos).
        const raw = e.target.value.replace(/[^\d.,-]/g, '');
        setText(raw);
        const n = Number(raw.replace(',', '.'));
        onChange(raw.trim() !== '' && Number.isFinite(n) ? String(n) : '');
      }}
      onBlur={() => setFocused(false)}
    />
  );
}
