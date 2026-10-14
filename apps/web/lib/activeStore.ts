import { clearCashDraft } from './cashDrafts';
import { clearCachedCart } from './cart';
import { clearCachedCashSession } from './cashSessionCache';
import { CATALOG_STORE, hasIndexedDb, openDb, reqAsPromise } from './db';
import { clearCachedMe, readCachedMe } from './meCache';
import { clearNfeDraft } from './nfeDraft';
import { countOutbox } from './outbox';
import { getActiveTenantId, setActiveTenantId } from './activeTenant';

export * from './activeTenant';

/**
 * Loja ativa da sessão — usuário multi-loja (ADR-014, Fatia 2).
 *
 * A pessoa entra com UM login e escolhe a loja; a escolha fica aqui (`localStorage`) e vai em TODA
 * chamada da API no header `x-active-tenant` (ver `authHeaders` em `api.ts`). A API confere contra os
 * vínculos da pessoa — este valor é só a ESCOLHA, nunca a autorização.
 *
 * Quem tem uma loja só nem vê o seletor: o valor é gravado sozinho no login/`/me`.
 */

/**
 * Apaga tudo que é POR LOJA neste aparelho, para a loja nova nunca mostrar dado da anterior: perfil
 * (`/me`, com papel e módulos), caixa aberto e rascunhos do caixa, espelho do carrinho, rascunho de NF-e
 * e o catálogo offline. A FILA de vendas offline NÃO é apagada — por isso a troca é bloqueada enquanto
 * ela tem pendências (`pendingOfflineSales`).
 */
export async function clearStoreCaches(): Promise<void> {
  const userId = readCachedMe()?.id;
  clearCachedMe();
  clearCachedCashSession();
  clearCashDraft('open');
  clearCashDraft('close');
  if (userId) {
    clearCachedCart(userId);
    clearNfeDraft(userId);
  }
  if (hasIndexedDb()) {
    try {
      const db = await openDb();
      await reqAsPromise(db.transaction(CATALOG_STORE, 'readwrite').objectStore(CATALOG_STORE).clear());
    } catch {
      // catálogo offline é cache: se não limpar agora, o próximo carregamento online o substitui.
    }
  }
}

/** Vendas offline ainda não enviadas (pendentes ou com erro de rede). Trocar de loja com elas é bloqueado. */
export async function pendingOfflineSales(): Promise<number> {
  if (!hasIndexedDb()) return 0;
  try {
    return (await countOutbox()).pending;
  } catch {
    return 0;
  }
}

/**
 * Troca a loja ativa: grava a escolha, limpa os caches da loja anterior e recarrega o app inteiro na
 * loja nova (recarregar zera todo estado em memória — carrinho, telas abertas, painéis flutuantes).
 * Mesma loja ⇒ só segue para o app.
 */
export async function switchStore(tenantId: string, to = '/'): Promise<void> {
  if (getActiveTenantId() !== tenantId) {
    await clearStoreCaches();
    setActiveTenantId(tenantId);
  }
  window.location.assign(to);
}
