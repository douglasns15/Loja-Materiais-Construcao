'use client';

import { useEffect, useState } from 'react';
import { cashMovementSchema, type CashMovementInput } from '@nexoloja/shared';
import { MoneyInput } from '@/components/MoneyInput';

/**
 * **Movimentação de Caixa** (Suprimento / Sangria) — entrada/saída manual de dinheiro.
 *
 * Modal para o operador lançar dinheiro que entra ou sai do caixa **fora de uma venda**:
 *  - **Suprimento** (entrada): reforço de troco, aporte, pagamento atrasado em espécie.
 *  - **Sangria** (saída): retirada de dinheiro, despesa paga pela gaveta.
 *
 * O motivo é obrigatório (rastreabilidade). Ao confirmar, chama `onSubmit` — o pai grava
 * via `POST /cash-sessions/movement` e recarrega o caixa para a mini-DRE refletir na hora.
 */

const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Kind = CashMovementInput['kind'];

export function CashMovementModal({
  onSubmit,
  onClose,
}: {
  /** Grava a movimentação (pode lançar erro, exibido no próprio modal). */
  onSubmit: (input: CashMovementInput) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>('SUPPLY');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc fecha (atalho de teclado no desktop — CLAUDE.md → menos cliques).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isSupply = kind === 'SUPPLY';

  async function confirm() {
    setError(null);
    const parsed = cashMovementSchema.safeParse({
      kind,
      amount: Number(amount),
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setError(
        Number(amount) > 0 ? 'Informe o motivo da movimentação.' : 'Informe um valor maior que zero.',
      );
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Movimentação de caixa"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">Movimentação de caixa</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Seletor Suprimento (entrada) × Sangria (saída) */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setKind('SUPPLY')}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              isSupply
                ? 'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            ↑ Suprimento <span className="block text-xs font-normal">entrada</span>
          </button>
          <button
            type="button"
            onClick={() => setKind('WITHDRAWAL')}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${
              !isSupply
                ? 'border-red-500 bg-red-50 text-red-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            ↓ Sangria <span className="block text-xs font-normal">saída</span>
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Valor</label>
            <MoneyInput
              placeholder="R$ 0,00"
              value={amount}
              onChange={setAmount}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Motivo</label>
            <textarea
              placeholder={
                isSupply ? 'Ex.: reforço de troco, pagamento atrasado…' : 'Ex.: retirada, pagamento de despesa…'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              rows={2}
              maxLength={300}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className={`mt-4 w-full rounded-lg py-2 font-medium text-white disabled:opacity-60 ${
            isSupply ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {busy
            ? 'Lançando…'
            : isSupply
              ? `Registrar entrada${Number(amount) > 0 ? ` de ${BRL(Number(amount))}` : ''}`
              : `Registrar saída${Number(amount) > 0 ? ` de ${BRL(Number(amount))}` : ''}`}
        </button>
      </div>
    </div>
  );
}
