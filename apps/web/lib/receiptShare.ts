// `html-to-image` (~15 KB) e `jspdf` (~130 KB gzip) são CARREGADOS SOB DEMANDA (dynamic import
// dentro das funções) — só baixam quando o operador clica em compartilhar. Assim ficam FORA do
// bundle inicial do Histórico/Orçamentos (custo-zero: a maioria das visitas nem gera comprovante).

/** Subconjunto das opções do html-to-image que usamos (o tipo `Options` não é reexportado). */
type ShotOptions = {
  pixelRatio: number;
  backgroundColor: string;
  cacheBust: boolean;
  skipFonts: boolean;
  width: number;
  height: number | undefined;
  filter?: (n: HTMLElement) => boolean;
};

/**
 * Compartilhamento do comprovante/orçamento — como IMAGEM (PNG) ou PDF. Ambos partem da MESMA foto
 * do cupom (html-to-image); o PDF é essa imagem numa página do tamanho dela (1 página limpa). O
 * envio usa o Web Share: o operador escolhe o WhatsApp (ou outro app) e envia ele mesmo — nada sai
 * sozinho. Onde o Web Share de ARQUIVOS não existe (desktop antigo), abre o arquivo numa aba.
 *
 * Imagem × PDF: a imagem aparece INLINE no WhatsApp (o cliente vê na hora); o PDF vira anexo de
 * documento (mais formal, melhor p/ imprimir/arquivar — típico de orçamento).
 */
type ShareOpts = { fileName: string; text: string; title: string };

/** Envia o comprovante como IMAGEM (PNG). */
export async function shareReceiptImage(node: HTMLElement, opts: ShareOpts): Promise<void> {
  const { blob } = await captureReceiptPng(node);
  await shareFile(new File([blob], `${opts.fileName}.png`, { type: 'image/png' }), opts);
}

/** Envia o comprovante como PDF (a mesma imagem numa página do tamanho do cupom). */
export async function shareReceiptPdf(node: HTMLElement, opts: ShareOpts): Promise<void> {
  const { dataUrl, width, height } = await captureReceiptPng(node);
  const { jsPDF } = await import('jspdf');
  // Página no tamanho exato da imagem (em px), retrato/paisagem conforme a proporção — sem margens
  // enormes de A4 num cupom estreito. jsPDF aceita px como unidade.
  const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'px', format: [width, height] });
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
  const blob = pdf.output('blob');
  await shareFile(new File([blob], `${opts.fileName}.pdf`, { type: 'application/pdf' }), opts);
}

/** Web Share do arquivo (o operador finaliza no app escolhido); fallback abre numa aba nova. */
async function shareFile(file: File, opts: ShareOpts): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file], title: opts.title, text: opts.text });
    return;
  }
  const url = URL.createObjectURL(file);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Fotografa o cupom como PNG e devolve o dataURL, o blob e as dimensões (para o PDF dimensionar a
 *  página). Retenta sem imagens quando o logo remoto (CORS) derruba a 1ª tentativa. */
async function captureReceiptPng(
  node: HTMLElement,
): Promise<{ dataUrl: string; blob: Blob; width: number; height: number }> {
  // Espera o LOGO (e qualquer imagem) carregar ANTES de medir/fotografar. Sem isso a altura sai
  // curta (logo com altura 0) e o html-to-image corta o rodapé — e o cupom fica "deitado".
  await waitImages(node);
  // Mede a caixa real já com o logo dentro (getBoundingClientRect é fracionário e exato).
  const rect = node.getBoundingClientRect();
  const base: ShotOptions = {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
    // Não busca Google Fonts (cross-origin) — o cupom usa fontes do sistema; evita travar/estourar.
    skipFonts: true,
    // Dimensões explícitas (medidas após o logo) ajudam o Safari a não cortar/renderizar em branco.
    width: Math.ceil(rect.width) || 302,
    height: Math.ceil(rect.height) || undefined,
  };
  let dataUrl: string;
  try {
    dataUrl = await renderStable(node, base);
  } catch {
    dataUrl = await renderStable(node, { ...base, filter: (n: HTMLElement) => n.tagName !== 'IMG' });
  }
  const { width, height } = await imageDims(dataUrl);
  return { dataUrl, blob: dataUrlToBlob(dataUrl), width, height };
}

/**
 * Safari/iOS renderiza a 1ª (às vezes a 2ª) captura do html-to-image em BRANCO/PRETO porque a
 * imagem do SVG clonado ainda não decodificou quando o canvas é lido. Repetir "esquenta" o cache
 * do navegador e a ÚLTIMA passada sai correta — solução consagrada para o bug no WebKit.
 */
async function renderStable(node: HTMLElement, options: ShotOptions): Promise<string> {
  const { toPng } = await import('html-to-image');
  let dataUrl = '';
  for (let i = 0; i < 3; i++) {
    dataUrl = await toPng(node, options);
  }
  return dataUrl;
}

/** Aguarda todas as imagens do nó (o logo) terminarem de carregar, com teto de 2,5s para nunca
 *  travar (rede lenta/offline: segue sem o logo em vez de pendurar o compartilhamento). */
function waitImages(node: HTMLElement): Promise<void> {
  const imgs = Array.from(node.querySelectorAll('img'));
  return Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 2500);
          }),
    ),
  ).then(() => undefined);
}

/** Dimensões (px) reais do PNG gerado — o PDF usa isto para montar a página no tamanho certo. */
function imageDims(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Converte o dataURL do html-to-image num Blob (para o File do Web Share). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head?.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64 ?? '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
