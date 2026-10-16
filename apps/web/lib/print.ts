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
 * iPhone/iPad rodando o app INSTALADO na tela de início (modo standalone do PWA). Nesse modo o iOS
 * IGNORA `window.print()` — o botão "não faz nada" (confirmado pelo Owner em 2026-10-16; no Safari e
 * no Android a impressão abre normal). iPadOS se apresenta como "MacIntel" — o toque o denuncia.
 */
export function isIosStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios =
    /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (!ios) return false;
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Impressão no iPhone/iPad com o app instalado (ver `isIosStandalone`): em vez do `window.print()`
 * (ignorado ali), fotografa o comprovante num PDF e abre a folha de COMPARTILHAR do iOS — que tem
 * "Imprimir" (AirPrint), "Salvar em Arquivos", WhatsApp etc. Reusa o mesmo motor do comprovante no
 * WhatsApp (`shareReceiptPdf`, já validado no iPhone). Fotografa um CLONE do `#print-area` num
 * invólucro fora da tela (`.rc-capture-host` + `.rc-capture`, globals.css), na largura do modelo
 * (80mm ou A4), e o remove depois — o original continua oculto e intocado.
 */
async function printViaIosShare(area: HTMLElement, fileName: string): Promise<void> {
  const host = document.createElement('div');
  host.className = 'rc-capture-host';
  const clone = area.cloneNode(true) as HTMLElement;
  clone.classList.add('rc-capture');
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const { shareReceiptPdf } = await import('./receiptShare');
    await shareReceiptPdf(clone, { fileName, title: fileName });
  } catch (e) {
    // Operador fechou a folha de compartilhar: não é erro.
    if ((e as Error)?.name === 'AbortError') return;
    console.error('[print] falha ao gerar o PDF para imprimir no iOS', e);
    window.alert('Não foi possível abrir a impressão. Toque em Imprimir de novo.');
  } finally {
    host.remove();
  }
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
  // iPhone/iPad com o app instalado: o iOS ignora `window.print()` → PDF + folha de compartilhar.
  if (area && isIosStandalone()) {
    await printViaIosShare(area, clean ?? 'comprovante');
    return;
  }
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
