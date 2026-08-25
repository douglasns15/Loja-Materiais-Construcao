/**
 * PORTA de persistência do documento fiscal.
 *
 * Por que uma porta e não Prisma direto: a tabela definitiva exige **migration**
 * e, portanto, aprovação explícita do Owner (regra 1 do CLAUDE.md). Enquanto
 * essa decisão não é tomada, o serviço roda com `MemoryFiscalStore` e o encaixe
 * no banco vira só um novo adaptador — sem tocar no domínio nem nas rotas.
 *
 * A chave de idempotência é `(tenantId, orderId)`: uma venda tem no máximo um
 * documento fiscal vivo. É a mesma lição do ADR-025 §5.B (nunca dobrar efeito).
 */

import type { FiscalDocument } from '../domain/types';

export interface FiscalDocumentStore {
  /** Busca pelo par de idempotência. `null` se a venda ainda não tem nota. */
  findByOrder(tenantId: string, orderId: string): Promise<FiscalDocument | null>;
  /** Busca pelo id interno do documento. */
  findById(tenantId: string, id: string): Promise<FiscalDocument | null>;
  /** Grava (insere ou substitui) o documento. */
  save(document: FiscalDocument): Promise<void>;
}
