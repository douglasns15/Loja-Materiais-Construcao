/**
 * Utilitários de impressão do comprovante/orçamento.
 *
 * Por que existe `ensureImageLoaded`: o `#print-area` fica `display:none` na tela
 * (ver globals.css) e só aparece na impressão. Navegadores NÃO garantem o download
 * de um `<img>` dentro de subárvore oculta — muitas vezes nem iniciam até o elemento
 * ficar visível. Como `window.print()` captura o documento de forma síncrona, a logo
 * podia não ter baixado a tempo e "sumia" do papel. O sintoma aparecia sobretudo ao
 * TROCAR a logo: a URL nova carrega cache-bust (`?v=<ts>`) e nunca tinha sido buscada,
 * enquanto a anterior já estava no cache do navegador — por isso "a logo some ao trocar".
 *
 * A correção: pré-carregar a logo (mesma URL do `<img>` do comprovante, então cai no
 * cache) ANTES de abrir o diálogo, com teto de tempo para nunca travar a impressão caso
 * a rede falhe ou a imagem não carregue.
 */
export function ensureImageLoaded(url: string | null | undefined, timeoutMs = 2500): Promise<void> {
  if (!url) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const img = new Image();
    img.onload = finish;
    img.onerror = finish; // falhou: imprime mesmo assim (sem travar por causa da logo)
    img.src = url;
    // Se já estava no cache, `complete` pode ficar true sem disparar `onload`.
    if (img.complete) finish();
  });
}
