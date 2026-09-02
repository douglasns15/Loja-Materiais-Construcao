'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ALERT_META,
  type AlertProductsPage,
  type AlertSeverity,
  type AlertSummary,
} from '@nexoloja/shared';
import { apiGet } from '@/lib/api';
import { downloadCsv, csvNumber, toCsv } from '@/lib/csv';

/**
 * Sino da **Central de pendências** (ADR-029), ao lado da cesta no topo. Alertas CALCULADOS sob
 * demanda: ao montar (e ao a janela voltar ao foco) puxa `GET /alerts` e mostra a soma no badge;
 * clicando, abre um painel com cada pendência e o botão de baixar a lista (CSV montado no cliente).
 * Nasce visível a todos os papéis (o filtro por papel virá com a tela de permissões — ADR-029 §4).
 *
 * Fatia 1: só o alerta "produtos sem custo" volta com contagem/lista; o painel já é genérico para os
 * próximos entrarem sem mudança de layout.
 */

/** Só `warn`/`danger` "alarmam" o badge; `info` aparece no painel mas não incha o número. */
const alarms = (a: AlertSummary) => a.severity !== 'info';

const SEVERITY_DOT: Record<AlertSeverity, string> = {
  danger: 'bg-red-500',
  warn: 'bg-amber-500',
  info: 'bg-sky-500',
};

/** "Silenciar por 7 dias" é preferência LOCAL do usuário (ADR-029 §5) — nada vai ao banco. */
const SNOOZE_KEY = 'nexoloja:alerts-snooze';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/** Lê o mapa `{kind: silenciado-até-ms}` do localStorage, já descartando os expirados. Tolerante a falhas. */
function loadSnoozed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    const clean: Record<string, number> = {};
    for (const [k, until] of Object.entries(parsed)) {
      if (typeof until === 'number' && until > now) clean[k] = until;
    }
    return clean;
  } catch {
    return {};
  }
}

export function AlertsChip() {
  const [items, setItems] = useState<AlertSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<AlertSummary[]>('/alerts');
      setItems(data);
    } catch {
      // Offline / cold start: mantém o estado atual sem "piscar" erro no sino (é secundário na tela).
    }
  }, []);

  // Puxa ao montar e sempre que a janela volta ao foco (o dado pode ter mudado noutra aba/dispositivo).
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // Lê os silenciados só no cliente (após montar) — evita divergência de hidratação com o SSR.
  useEffect(() => {
    setSnoozed(loadSnoozed());
  }, []);

  // Fecha o painel ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Grava o novo mapa de silenciados (estado + localStorage). */
  const persistSnoozed = useCallback((next: Record<string, number>) => {
    setSnoozed(next);
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
      // Storage indisponível (aba privada/bloqueado): silencia só nesta sessão, sem quebrar.
    }
  }, []);

  // Silencia um alerta por 7 dias; parte do que está no storage (mescla mudanças de outra aba).
  const snooze = useCallback(
    (kind: string) => persistSnoozed({ ...loadSnoozed(), [kind]: Date.now() + SNOOZE_MS }),
    [persistSnoozed],
  );
  const unsnoozeAll = useCallback(() => persistSnoozed({}), [persistSnoozed]);

  const now = Date.now();
  const isSnoozed = (kind: string) => (snoozed[kind] ?? 0) > now;
  const visibleItems = items.filter((a) => !isSnoozed(a.kind));
  const snoozedCount = items.length - visibleItems.length;

  // O badge (e a "cara" acesa do sino) ignora os silenciados — silenciar tira o número também.
  const badge = visibleItems.filter(alarms).reduce((acc, a) => acc + a.count, 0);
  const has = badge > 0;

  /** Baixa a lista completa de uma pendência (pagina o keyset até o fim) e gera o CSV no navegador. */
  const handleDownload = useCallback(async (a: AlertSummary) => {
    setDownloading(a.kind);
    try {
      const header = ['Produto', 'Código', 'Código de barras', 'Preço de venda', 'Custo', 'Estoque'];
      const body: string[][] = [header];
      let cursor: string | null = null;
      // Segurança: teto de páginas para nunca laçar infinito num cursor mal-comportado.
      for (let guard = 0; guard < 200; guard++) {
        const qs = new URLSearchParams({ kind: a.kind });
        if (cursor) qs.set('cursor', cursor);
        const page: AlertProductsPage = await apiGet<AlertProductsPage>(`/alerts/products?${qs.toString()}`);
        for (const r of page.rows) {
          body.push([
            r.name,
            r.sku,
            r.ean ?? '',
            csvNumber(r.salePrice),
            csvNumber(r.costPrice),
            csvNumber(r.stockQty),
          ]);
        }
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      downloadCsv(`${a.kind}_${new Date().toISOString().slice(0, 10)}`, toCsv(body));
    } catch {
      // Silencioso: se falhar (offline), o operador tenta de novo; não travamos o painel.
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative inline-flex items-center rounded-full border p-2 transition ${
          has
            ? 'border-gray-300 bg-white text-gray-800 hover:bg-gray-100'
            : 'border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-600'
        }`}
        title={has ? `${badge} ${badge === 1 ? 'pendência' : 'pendências'}` : 'Sem pendências'}
        aria-label={has ? `${badge} pendências` : 'Sem pendências'}
        aria-expanded={open}
      >
        {/* Ícone de sino */}
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {has && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed left-2 right-2 top-14 z-[65] mx-auto max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl sm:left-auto sm:right-3 sm:w-96"
          role="dialog"
          aria-label="Central de pendências"
        >
          <div className="bg-indigo-600 px-4 py-3 text-white">
            <p className="text-sm font-semibold">Pendências</p>
            <p className="text-[11px] text-indigo-100">
              Avisos de cadastro que valem a pena corrigir.
            </p>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">Tudo em ordem ✓</p>
            ) : visibleItems.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">Tudo silenciado por ora.</p>
            ) : (
              <ul className="space-y-1">
                {visibleItems.map((a) => {
                  const meta = ALERT_META[a.kind];
                  return (
                    <li key={a.kind} className="rounded-xl p-3 hover:bg-gray-50">
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800">{meta.label}</p>
                            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">
                              {a.count}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
                          <div className="mt-2 flex items-center gap-3">
                            {a.downloadable ? (
                              <button
                                type="button"
                                onClick={() => handleDownload(a)}
                                disabled={downloading === a.kind}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
                              >
                                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                {downloading === a.kind ? 'Baixando…' : 'Baixar lista (CSV)'}
                              </button>
                            ) : (
                              a.actionHref && (
                                <Link
                                  href={a.actionHref}
                                  onClick={() => setOpen(false)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                                >
                                  Abrir
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                    <polyline points="12 5 19 12 12 19" />
                                  </svg>
                                </Link>
                              )
                            )}
                            {/* Silenciar por 7 dias (preferência local) — some do sino até o prazo vencer. */}
                            <button
                              type="button"
                              onClick={() => snooze(a.kind)}
                              className="ml-auto shrink-0 text-[11px] text-gray-400 transition hover:text-gray-600"
                              title="Não mostrar este aviso por 7 dias"
                            >
                              Silenciar 7 dias
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Rodapé: quantos estão silenciados agora + reexibir todos (ADR-029 §5). */}
          {snoozedCount > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
              <span>
                {snoozedCount} silenciada{snoozedCount > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={unsnoozeAll}
                className="font-semibold text-indigo-600 transition hover:text-indigo-800"
              >
                Reexibir
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
