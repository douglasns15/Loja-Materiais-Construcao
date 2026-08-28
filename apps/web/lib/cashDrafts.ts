/**
 * Rascunho da contagem e dos valores digitados no Caixa, persistido em `localStorage`.
 *
 * Pedido do Owner: se o operador começa a **contar a gaveta** (contador de cédulas/moedas) ou a
 * **digitar** o valor de abertura/fechamento e precisa sair para outra tela, não pode perder o que
 * já lançou — ao voltar, o rascunho reaparece. O rascunho só some quando o turno "vira" ou o
 * operador zera de propósito:
 *
 * - **Limpar** no contador → zera a contagem daquele modo.
 * - **Abrir caixa** (sucesso) → limpa o rascunho de abertura (`open`).
 * - **Fechar caixa** (sucesso) → limpa o rascunho de fechamento (`close`).
 *
 * Puro cache de UX no aparelho (sem servidor, sem custo de free tier — CLAUDE.md §6). A verdade
 * continua sendo o valor **confirmado** que vai para a API de abertura/fechamento; aqui guardamos
 * apenas o trabalho em andamento para não frustrar o operador.
 */

/** Modo do rascunho: contagem/valor de **abertura** (`open`) ou de **fechamento** (`close`). */
export type CashMode = 'open' | 'close';

/** Conteúdo de um rascunho: valor digitado, observações (só fechamento) e contagem por denominação. */
export type CashDraft = {
  /** Valor canônico digitado no campo (abertura ou fechamento). */
  amount?: string;
  /** Observações do fechamento (não usado na abertura). */
  notes?: string;
  /** Quantidade por denominação no contador de gaveta (chave = valor em reais, como string). */
  counts?: Record<number, string>;
};

const KEY = (mode: CashMode) => `nexoloja.cashDraft.${mode}`;

/** Lê o rascunho do modo (objeto vazio se não houver, se estiver corrompido ou sem `localStorage`). */
export function readCashDraft(mode: CashMode): CashDraft {
  try {
    const raw = localStorage.getItem(KEY(mode));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CashDraft;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // localStorage indisponível (modo privado/SSR) — segue sem rascunho.
    return {};
  }
}

/** Mescla um pedaço no rascunho do modo (merge raso: mantém os campos não informados). */
export function saveCashDraft(mode: CashMode, patch: CashDraft): void {
  try {
    const next = { ...readCashDraft(mode), ...patch };
    localStorage.setItem(KEY(mode), JSON.stringify(next));
  } catch {
    // Sem localStorage — o rascunho simplesmente não persiste (degrada para o comportamento antigo).
  }
}

/** Há contagem salva (alguma denominação com quantidade > 0) no rascunho do modo? Alimenta o selo "rascunho". */
export function hasCounterDraft(mode: CashMode): boolean {
  const counts = readCashDraft(mode).counts;
  return !!counts && Object.values(counts).some((qty) => Number(qty || 0) > 0);
}

/** Apaga o rascunho do modo (ao abrir/fechar o caixa, ou ao "Limpar" o contador). */
export function clearCashDraft(mode: CashMode): void {
  try {
    localStorage.removeItem(KEY(mode));
  } catch {
    // Sem localStorage — nada a limpar.
  }
}
