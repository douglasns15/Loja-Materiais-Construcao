'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Botão + modal de leitura de código de barras pela CÂMERA (celular/tablet). Reutilizável em
 * qualquer tela: emite o código lido por `onScan` e cada tela decide o que fazer com ele (jogar na
 * busca, preencher o SKU do cadastro, etc.). Complementa o leitor físico (HID), que já funciona
 * pelos campos de busca com Enter — este cobre quem não tem leitor, só a câmera do aparelho.
 *
 * Dois back-ends, na ordem de preferência (diretriz do CLAUDE.md):
 *  1. `BarcodeDetector` nativo (Chrome/Android) — rápido, sem dependência.
 *  2. Fallback `@zxing/library`, importado **sob demanda** (dynamic import) só ao abrir a câmera,
 *     para não pesar o bundle inicial (Safari/iOS ainda não têm `BarcodeDetector`).
 *
 * Câmera exige contexto seguro (HTTPS em produção; `localhost` no dev). Trata permissão negada,
 * ausência de câmera e libera o stream ao fechar/desmontar.
 */

/** Tipo mínimo do `BarcodeDetector` nativo (ainda fora do lib.dom padrão do TS). */
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => NativeBarcodeDetector;

/** Formatos comuns no varejo (EAN/UPC) + industriais (Code 128/39, ITF). */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

type Props = {
  /** Chamado com o código lido. A tela decide o destino (busca, SKU do cadastro, etc.). */
  onScan: (code: string) => void;
  /** Texto/acessibilidade do botão. Padrão: "Escanear". */
  label?: string;
  className?: string;
};

export function BarcodeScanButton({ onScan, label = 'Escanear', className }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Funções de limpeza do back-end ativo (parar tracks da câmera, cancelar loop, reset do zxing).
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
    setError(null);
  }, [stop]);

  /** Emite o código e fecha (uma leitura por abertura — evita adicionar o mesmo item em loop). */
  const handleResult = useCallback(
    (code: string) => {
      onScan(code);
      close();
    },
    [onScan, close],
  );

  // Liga a câmera quando o modal abre; desliga ao fechar/desmontar.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function start() {
      const video = videoRef.current;
      if (!video) return;

      let stream: MediaStream;
      try {
        // `environment` = câmera traseira no celular (a que aponta para o produto).
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch {
        if (!cancelled) setError('Não foi possível acessar a câmera. Verifique a permissão.');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const stopStream = () => stream.getTracks().forEach((t) => t.stop());

      // Back-end 1: BarcodeDetector nativo.
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;
      if (Detector) {
        const detector = new Detector({ formats: FORMATS });
        let raf = 0;
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            const first = codes[0]?.rawValue;
            if (first) {
              handleResult(first);
              return;
            }
          } catch {
            // Frame sem leitura / detector ocupado — segue tentando no próximo frame.
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        cleanupRef.current = () => {
          cancelAnimationFrame(raf);
          stopStream();
        };
        return;
      }

      // Back-end 2: fallback @zxing (carregado sob demanda).
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/library');
        if (cancelled) {
          stopStream();
          return;
        }
        const reader = new BrowserMultiFormatReader();
        reader.decodeFromStream(stream, video, (result) => {
          if (result) handleResult(result.getText());
        });
        cleanupRef.current = () => {
          reader.reset();
          stopStream();
        };
      } catch {
        stopStream();
        if (!cancelled) setError('Leitor de câmera indisponível neste dispositivo.');
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, handleResult, stop]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'rounded-lg border border-gray-300 px-3 py-2 font-medium hover:bg-gray-100'
        }
        aria-label={label}
        title={label}
      >
        📷
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Escanear código de barras"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Escanear código</h2>
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Fechar
              </button>
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
            ) : (
              <div className="overflow-hidden rounded-lg bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} className="h-auto w-full" muted playsInline />
              </div>
            )}
            <p className="mt-3 text-center text-xs text-gray-500">
              Aponte a câmera para o código de barras do produto.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
