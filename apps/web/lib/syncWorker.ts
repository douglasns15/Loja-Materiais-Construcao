import {
  classifyHttpOutcome,
  classifyNetworkError,
  shouldRetry,
  type SyncOutcome,
} from '@nexoloja/core';
import { apiPostForSync } from './api';
import {
  countPending,
  markError,
  markFailed,
  markSynced,
  peekPending,
  type OutboxRecord,
} from './outbox';

/**
 * Worker de sincronização da fila offline (ADR-011 §5–6, AI 6). Drena a store `outbox` em **FIFO**
 * quando há rede, enviando um envelope por vez para a API. **Para na 1ª falha** (não reordena/pula
 * — respeita dependências) e re-tenta só falhas transitórias. Toda a *decisão* (o que é sucesso,
 * o que re-tenta) vem das funções puras do `packages/core` (testadas com Vitest); aqui fica só o
 * I/O (fetch + IndexedDB).
 *
 * O I/O real de aplicar a venda é do servidor: o worker chama `POST /orders` idempotente por PK
 * (Fatia 4). 2xx = aplicado agora; 409 = já existia (dedup) — ambos contam como sincronizado.
 */

/** Trava de reentrância: um único dreno por vez (evita enviar o mesmo item em paralelo). */
let draining = false;

export interface DrainResult {
  /** Quantos itens sincronizaram nesta passada. */
  synced: number;
  /** `true` se parou por falha (rede/servidor/dura) antes de esvaziar a fila. */
  stopped: boolean;
}

function reason(outcome: SyncOutcome, detail: string): string {
  return `${outcome}: ${detail}`;
}

/** Tenta sincronizar UM item; devolve o desfecho do core a partir do status HTTP (ou rede). */
async function syncOne(rec: OutboxRecord): Promise<SyncOutcome> {
  try {
    const { status } = await apiPostForSync('/orders', rec.envelope.payload);
    return classifyHttpOutcome(status);
  } catch {
    // Sem resposta HTTP (offline/DNS/timeout) — sempre transitório.
    return classifyNetworkError();
  }
}

/**
 * Drena a fila. Retorna quantos sincronizaram e se parou no meio. Idempotente e seguro chamar de
 * vários gatilhos (a trava evita concorrência). Não faz nada se estiver offline.
 */
export async function drainOutbox(): Promise<DrainResult> {
  if (draining) return { synced: 0, stopped: false };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, stopped: true };
  }
  draining = true;
  let synced = 0;
  try {
    // FIFO: sempre o primeiro pendente/erro. `guard` limita o loop ao tamanho atual da fila para
    // nunca girar infinito (a cada volta ou removemos 1 do topo, ou paramos).
    let guard = (await countPending()) + 1;
    while (guard-- > 0) {
      const rec = await peekPending();
      if (!rec || rec.seq == null) break;

      const outcome = await syncOne(rec);
      if (outcome === 'SYNCED') {
        await markSynced(rec.seq);
        synced++;
        continue; // avança FIFO
      }

      // Falhou: decide entre re-tentar depois (transitório, dentro do limite) ou dar como dura.
      // `rec.attempts` é o que ESTE item já acumulou antes desta passada.
      if (shouldRetry(outcome, rec.attempts)) {
        await markError(rec.seq, reason(outcome, 'nova tentativa depois'));
      } else {
        await markFailed(rec.seq, reason(outcome, 'falha dura — requer atenção'));
      }
      return { synced, stopped: true }; // para na 1ª falha (ADR-011 §5)
    }
    return { synced, stopped: false };
  } finally {
    draining = false;
  }
}
