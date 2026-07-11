'use client';

import Link from 'next/link';
import { useOutboxSyncContext } from '@/lib/outboxSync';

/**
 * Chip de status da fila offline no topo do app (ADR-011, refino "drenagem global"). Aparece só
 * quando há algo na fila e leva à tela de pendências. Prioriza a cor mais urgente: **vermelho**
 * quando há item com falha (exige atenção), **índigo** quando só há pendente (sincroniza sozinho).
 */
export function QueueChip() {
  const { pending, failed } = useOutboxSyncContext();
  if (pending === 0 && failed === 0) return null;

  const parts: string[] = [];
  if (pending > 0) parts.push(`${pending} pendente${pending === 1 ? '' : 's'}`);
  if (failed > 0) parts.push(`${failed} com falha`);

  const urgent = failed > 0;
  const classes = urgent
    ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
    : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100';

  return (
    <Link
      href="/pendencias"
      className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${classes}`}
      title="Ver vendas na fila de sincronização"
    >
      <span
        className={`h-2 w-2 rounded-full ${urgent ? 'bg-red-500' : 'bg-indigo-500'} ${urgent ? '' : 'animate-pulse'}`}
        aria-hidden="true"
      />
      {parts.join(' · ')}
    </Link>
  );
}
