'use client';

import { useState } from 'react';
import { onlyDigits } from '@nexoloja/shared';

type Props = {
  /** Valor guardado (dígitos canônicos; aceita também um valor já mascarado vindo do banco). */
  value: string;
  /** Recebe SÓ os dígitos (forma canônica que o banco guarda). */
  onChange: (digits: string) => void;
  /** Máscara aplicada ao sair do campo (ex.: `formatCnpj`, `formatCpfCnpj`, `formatPhoneBr`). */
  format: (v: string | null | undefined) => string;
  /** Teto de dígitos (CPF 11, CNPJ 14, telefone 11). */
  maxDigits: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  inputMode?: 'numeric' | 'tel';
  'aria-label'?: string;
};

/**
 * Campo de documento/telefone com **máscara ao sair** (pedido do Owner). Segue o mesmo padrão do
 * `MoneyInput` (buffer de foco): enquanto está focado mostra os **dígitos crus** (edição sem brigar
 * com a máscara e sem pulo de cursor); ao desfocar, exibe o valor **formatado** por `format`. Guarda
 * no estado do pai apenas os **dígitos** (forma canônica do banco), então busca por dígitos e envio
 * ao servidor não mudam.
 */
export function MaskedInput({
  value,
  onChange,
  format,
  maxDigits,
  className,
  placeholder,
  disabled,
  id,
  inputMode = 'numeric',
  'aria-label': ariaLabel,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');

  const display = focused ? text : format(value);

  return (
    <input
      type="text"
      inputMode={inputMode}
      id={id}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      value={display}
      onFocus={() => {
        setText(onlyDigits(value));
        setFocused(true);
      }}
      onChange={(e) => {
        const d = onlyDigits(e.target.value).slice(0, maxDigits);
        setText(d);
        onChange(d);
      }}
      onBlur={() => setFocused(false)}
    />
  );
}
