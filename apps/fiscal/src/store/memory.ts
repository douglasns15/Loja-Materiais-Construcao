/**
 * Implementação em MEMÓRIA da porta de persistência.
 *
 * Serve para desenvolvimento e teste. Num Worker, cada isolate tem sua própria
 * memória e ela é descartada — ou seja, **não há durabilidade**. É intencional:
 * a durabilidade entra no encaixe final, com a tabela aprovada pelo Owner.
 */

import type { FiscalDocument } from '../domain/types';
import type { FiscalDocumentStore } from './store';

export class MemoryFiscalStore implements FiscalDocumentStore {
  /** Chave: `${tenantId}:${orderId}` → documento. */
  private readonly byOrder = new Map<string, FiscalDocument>();
  /** Chave: `${tenantId}:${id}` → documento. */
  private readonly byId = new Map<string, FiscalDocument>();

  private static orderKey(tenantId: string, orderId: string): string {
    return `${tenantId}:${orderId}`;
  }

  private static idKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  async findByOrder(tenantId: string, orderId: string): Promise<FiscalDocument | null> {
    return this.byOrder.get(MemoryFiscalStore.orderKey(tenantId, orderId)) ?? null;
  }

  async findById(tenantId: string, id: string): Promise<FiscalDocument | null> {
    return this.byId.get(MemoryFiscalStore.idKey(tenantId, id)) ?? null;
  }

  async save(document: FiscalDocument): Promise<void> {
    this.byOrder.set(MemoryFiscalStore.orderKey(document.tenantId, document.orderId), document);
    this.byId.set(MemoryFiscalStore.idKey(document.tenantId, document.id), document);
  }
}
