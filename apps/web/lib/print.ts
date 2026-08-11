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

/**
 * Nome de arquivo seguro para o PDF. Ao "Salvar como PDF", o navegador usa `document.title` como
 * nome sugerido — então trocamos o título pelo código do documento antes de imprimir. Aqui só
 * limpamos os caracteres que o sistema de arquivos rejeita; string vazia vira `null` (o chamador
 * mantém o título padrão da aba).
 */
export function safeFileName(name: string | null | undefined): string | null {
  const clean = (name ?? '')
    .replace(/[\\/:*?"<>|]+/g, '') // proibidos em nome de arquivo (Windows/macOS/Linux)
    .replace(/\s+/g, ' ')
    .trim();
  return clean || null;
}

/**
 * Fluxo único de impressão do `#print-area` (comprovante, orçamento ou resumo de dívida). Centraliza
 * o que as telas repetiam: define o modelo (80mm/A4) + injeta a regra `@page`, pré-carrega a logo
 * (ver `ensureImageLoaded`) e abre o diálogo. Novidade: quando `fileName` é dado, troca o
 * `document.title` ANTES de imprimir e restaura DEPOIS (via `afterprint`, com teto de segurança) —
 * assim o PDF sai como "V-000128.pdf"/"O-000045.pdf" em vez do genérico "NexoLoja.pdf".
 */
export async function printArea(opts: {
  model: '80mm' | 'A4';
  logoUrl?: string | null;
  fileName?: string | null;
}): Promise<void> {
  const area = document.getElementById('print-area');
  if (area) area.setAttribute('data-model', opts.model);
  let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  style.textContent =
    opts.model === '80mm'
      ? '@media print { @page { size: 80mm auto; margin: 4mm; } }'
      : '@media print { @page { size: A4; margin: 14mm; } }';
  // Garante a logo baixada antes de imprimir (some do papel se trocada agora). Ver acima.
  await ensureImageLoaded(opts.logoUrl);

  const clean = safeFileName(opts.fileName);
  if (!clean) {
    window.print();
    return;
  }
  const previousTitle = document.title;
  document.title = clean;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  // Rede de segurança: alguns navegadores não disparam `afterprint` de forma confiável.
  setTimeout(restore, 60000);
  window.print();
}
