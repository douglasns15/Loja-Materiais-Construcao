'use client';

import { useState } from 'react';

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Texto digitado (com vírgula ou ponto, e eventuais símbolos) → string **canônica** com ponto
 * decimal (ex.: "12,90" ou "1.234,50" ou "12.9" → "12.9"/"1234.5"). Retorna '' quando vazio.
 *
 * Heurística de separador decimal: olha o **último** separador (vírgula ou ponto) e só o trata
 * como decimal quando tem **1 ou 2 dígitos depois** (padrão de centavos). Com 3+ dígitos ou
 * nenhum, todos os separadores são de milhar e o valor é inteiro — assim "1.000" vira 1000 (mil),
 * "12,90" vira 12.9 e "12.90" também. Não aceita negativo — os campos monetários são ≥ 0.
 */
export function parseMoneyInput(raw: string): string {
  const s = raw.replace(/[^\d.,]/g, '');
  if (!s) return '';
  const decPos = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const trailing = decPos === -1 ? '' : s.slice(decPos + 1); // só dígitos (decPos é o último sep)
  if (decPos === -1 || trailing.length === 0 || trailing.length > 2) {
    const digits = s.replace(/[.,]/g, '');
    return digits ? String(Number(digits)) : '';
  }
  const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
  const n = Number(`${intPart || '0'}.${trailing}`);
  return Number.isFinite(n) ? String(n) : '';
}

type Props = {
  /** Valor canônico com ponto decimal (ex.: "12.9"); '' quando vazio — igual ao antigo type="number". */
  value: string;
  /** Recebe o valor canônico já normalizado (ponto decimal, '' se vazio). */
  onChange: (canonical: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  'aria-label'?: string;
};

/**
 * Campo monetário. Enquanto o usuário digita, aceita número com vírgula OU ponto; ao **sair do
 * campo** (blur) mostra o valor formatado em BRL ("R$ 0,00"), deixando claro que é dinheiro
 * (pedido do Owner). Guarda no estado o valor **canônico** (ponto decimal), como os antigos
 * `type="number"` — então quem consome com `Number(value)` não muda em nada.
 */
export function MoneyInput({
  value,
  onChange,
  className,
  placeholder,
  disabled,
  id,
  title,
  'aria-label': ariaLabel,
}: Props) {
  // Enquanto focado, o input mostra exatamente o que a pessoa digita (`text`); ao desfocar,
  // volta a exibir o valor formatado derivado de `value`.
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');

  const hasNumber = value !== '' && Number.isFinite(Number(value));
  const display = focused ? text : hasNumber ? brl(Number(value)) : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      title={title}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      value={display}
      onFocus={() => {
        // Ao focar, mostra o número "limpo" para editar (vírgula como decimal, sem R$/milhar).
        setText(hasNumber ? String(Number(value)).replace('.', ',') : '');
        setFocused(true);
      }}
      onChange={(e) => {
        // Só dígitos e separadores aparecem enquanto digita (ignora letras/símbolos colados).
        const raw = e.target.value.replace(/[^\d.,]/g, '');
        setText(raw);
        onChange(parseMoneyInput(raw));
      }}
      onBlur={() => {
        setFocused(false);
        onChange(parseMoneyInput(text));
      }}
    />
  );
}
