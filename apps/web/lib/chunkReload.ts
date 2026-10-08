/**
 * Auto-recuperação do "código da tela sumiu" depois de um deploy (ChunkLoadError).
 *
 * Cada deploy da web troca os arquivos `/_next/static/…` (nome com hash) e apaga os antigos. Uma aba
 * aberta ANTES do deploy ainda roda o build velho: ao trocar de tela pelo menu ela pede o pedaço de
 * código da rota no endereço antigo, recebe 404 e o React lança `ChunkLoadError` — caía em "Algo deu
 * errado ao abrir a tela", e "Tentar novamente" não resolve (o arquivo continua não existindo).
 * Também acontece nos segundos do próprio deploy (página de uma versão, chunk da outra). Recarregar
 * a página busca o HTML novo, que aponta para os arquivos novos.
 *
 * Regra: só ONLINE (offline a falha é "tela nunca cacheada" — ADR-011/012, tratada pelas telas de
 * erro) e no máximo 1 recarga a cada `RELOAD_WINDOW_MS` (marca em sessionStorage), para nunca entrar
 * em laço se o problema for outro. Sem sessionStorage (modo privado/bloqueado) não recarrega sozinho —
 * o operador ainda tem o botão da tela de erro.
 */

const RELOAD_KEY = 'nexoloja:chunk-reload-at';
/** Janela em que uma 2ª falha de chunk NÃO recarrega de novo (evita laço). */
export const RELOAD_WINDOW_MS = 30_000;

/** O erro é de pedaço de código que não carregou (webpack/Next ou import dinâmico do navegador)? */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  const msg = typeof message === 'string' ? message : '';
  return /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    msg,
  );
}

/** Pode recarregar agora? Puro: `lastAt` = última recarga automática (ms) ou null. */
export function canAutoReload(lastAt: number | null, now: number): boolean {
  // Relógio que andou para trás (marca "no futuro") não pode travar a recarga para sempre.
  return lastAt == null || now < lastAt || now - lastAt >= RELOAD_WINDOW_MS;
}

/**
 * Decide (sem efeito colateral) se esta falha deve recarregar a página sozinha: chunk que não
 * carregou + online + fora da janela anti-laço. Chamar no render inicial da tela de erro.
 */
export function shouldAutoReload(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    const lastAt = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
    return canAutoReload(lastAt, Date.now());
  } catch {
    return false;
  }
}

/** Marca a recarga (anti-laço) e recarrega. Só chamar depois de `shouldAutoReload` = true. */
export function reloadForNewVersion(): void {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // sem como marcar ⇒ não arrisca laço
  }
  window.location.reload();
}
