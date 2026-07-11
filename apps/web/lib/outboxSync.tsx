'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useOutboxSync } from './useOutboxSync';

/**
 * Provider da sincronização offline (ADR-011, refino "drenagem global"). Monta **uma única**
 * instância do `useOutboxSync` no shell do app (`(app)/layout.tsx`), de modo que a fila drena e os
 * contadores atualizam em **qualquer tela** — não só no PDV. Antes o worker só rodava montado em
 * `/venda`; se o operador estivesse em outra tela quando a rede voltasse, as vendas ficavam presas.
 *
 * Uma instância só evita listeners/drenos duplicados; o chip do topo e o PDV leem o mesmo estado.
 */
type OutboxSyncValue = ReturnType<typeof useOutboxSync>;

const OutboxSyncContext = createContext<OutboxSyncValue | null>(null);

export function OutboxSyncProvider({ children }: { children: ReactNode }) {
  const value = useOutboxSync();
  return <OutboxSyncContext.Provider value={value}>{children}</OutboxSyncContext.Provider>;
}

/** Lê o estado/ações da fila offline. Deve ser usado dentro do `OutboxSyncProvider` (shell do app). */
export function useOutboxSyncContext(): OutboxSyncValue {
  const ctx = useContext(OutboxSyncContext);
  if (!ctx) {
    throw new Error('useOutboxSyncContext deve ser usado dentro de <OutboxSyncProvider>');
  }
  return ctx;
}
