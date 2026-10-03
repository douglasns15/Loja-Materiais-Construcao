import type { NFeDoc } from '@nexoloja/shared';

/**
 * Rascunho da importação de NF-e (tela De-Para do Estoque), persistido em `localStorage`.
 *
 * Pedido do Owner (mesmo comportamento do contador do Caixa — `cashDrafts.ts`): se o operador lê o
 * XML, começa a conferir/editar os itens (casar produto, fator, custo, preço…) e precisa sair do
 * pop-up, não pode perder o trabalho — ao reabrir "Importar NF-e", a prévia volta como estava. O
 * rascunho só some quando:
 *
 * - **Confirmar entrada** lança todos os itens marcados sem erro (com erro, fica para corrigir);
 * - **Limpar dados** na prévia (descarte de propósito, com confirmação).
 *
 * Guardamos a nota JÁ LIDA (`NFeDoc`, sem o XML cru) + as linhas editadas — puro cache de UX no
 * aparelho (sem servidor, sem custo de free tier — CLAUDE.md §6). A verdade continua no servidor:
 * a idempotência por item (`GET /nfe/imported` + constraint) é reconsultada ao restaurar, então um
 * rascunho velho nunca lança em dobro.
 *
 * A chave inclui o `userId` (como a cesta do PDV, `cart.ts`): o rascunho é pessoal — outro usuário
 * no mesmo aparelho nunca vê (nem lança) a prévia alheia.
 */

/** Conteúdo do rascunho. `R` = a linha do De-Para (tipo interno do `NfeImportModal`). */
export type NfeDraft<R> = {
  doc: NFeDoc;
  rows: R[];
  fileName: string | null;
  /** Quando foi salvo pela última vez (epoch ms) — exibido ao restaurar. */
  savedAt: number;
};

const KEY = (userId: string) => `nexoloja.nfeDraft.${userId}`;

/** Lê o rascunho do usuário (null se não houver, se estiver corrompido ou sem `localStorage`). */
export function readNfeDraft<R>(userId: string): NfeDraft<R> | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NfeDraft<R>;
    return parsed && parsed.doc && Array.isArray(parsed.rows) ? parsed : null;
  } catch {
    // localStorage indisponível (modo privado/SSR) ou JSON corrompido — segue sem rascunho.
    return null;
  }
}

/** Grava (substitui) o rascunho do usuário. */
export function saveNfeDraft<R>(userId: string, draft: Omit<NfeDraft<R>, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Sem localStorage/cota cheia — o rascunho simplesmente não persiste (comportamento antigo).
  }
}

/** Há rascunho salvo? Alimenta o selo "rascunho" no botão "Importar NF-e". */
export function hasNfeDraft(userId: string): boolean {
  return readNfeDraft(userId) != null;
}

/** Apaga o rascunho (importação concluída sem erro, ou "Limpar dados"). */
export function clearNfeDraft(userId: string): void {
  try {
    localStorage.removeItem(KEY(userId));
  } catch {
    // Sem localStorage — nada a limpar.
  }
}
