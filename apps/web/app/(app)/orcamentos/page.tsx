'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { groupPairedItems } from '@nexoloja/core';
import {
  formatOrderNumber,
  formatQuoteNumber,
  QUOTE_STATUS_LABELS,
  type QuoteDetail,
  type QuoteEffectiveStatus,
  type QuoteRow,
  type QuotesPage,
} from '@nexoloja/shared';
import { apiDelete, apiGet, apiPatch } from '@/lib/api';
import { ensureImageLoaded } from '@/lib/print';
import { OfflineNotice } from '@/components/OfflineNotice';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PAGE_SIZE = 20;

/** Cor do selo por status EFETIVO (inclui o derivado "Expirado"). */
function statusBadgeCls(s: QuoteEffectiveStatus): string {
  switch (s) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700';
    case 'SENT':
      return 'bg-blue-100 text-blue-800';
    case 'ACCEPTED':
      return 'bg-green-100 text-green-700';
    case 'REJECTED':
      return 'bg-red-100 text-red-700';
    case 'EXPIRED':
      return 'bg-orange-100 text-orange-700';
    case 'CONVERTED':
      return 'bg-indigo-100 text-indigo-800';
  }
}

const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');

/** Monta a query de `GET /quotes` com cursor, código, cliente e status. */
function quotesQuery(cursor: string | null, code: string, q: string, status: string): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) p.set('cursor', cursor);
  if (code.trim()) p.set('number', code.trim());
  if (q.trim()) p.set('q', q.trim());
  if (status) p.set('status', status);
  return `/quotes?${p.toString()}`;
}

export default function OrcamentosPage() {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros aplicados (o que a lista está mostrando).
  const [codeInput, setCodeInput] = useState('');
  const [codeSearch, setCodeSearch] = useState('');
  const [qInput, setQInput] = useState('');
  const [qSearch, setQSearch] = useState('');
  const [status, setStatus] = useState('');

  // Detalhe + impressão.
  const [store, setStore] = useState<Store | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');

  async function load(code = codeSearch, q = qSearch, st = status) {
    setLoading(true);
    setError(null);
    try {
      const page = await apiGet<QuotesPage>(quotesQuery(null, code, q, st));
      setRows(page.rows);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<QuotesPage>(quotesQuery(nextCursor, codeSearch, qSearch, status));
      setRows((prev) => [...prev, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    apiGet<Store>('/tenant').then(setStore).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setCodeSearch(codeInput);
    setQSearch(qInput);
    load(codeInput, qInput, status);
  }
  function trocarStatus(st: string) {
    setStatus(st);
    load(codeSearch, qSearch, st);
  }
  function limpar() {
    setCodeInput('');
    setCodeSearch('');
    setQInput('');
    setQSearch('');
    setStatus('');
    load('', '', '');
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-2xl font-bold">Orçamentos</h1>
      <p className="mb-4 text-sm text-gray-600">
        Orçamentos salvos, com código <strong>O-000045</strong>. Busque por código ou cliente, filtre
        por status, reimprima e acompanhe o ciclo de vida. Para criar, use{' '}
        <Link href="/venda" className="font-medium text-blue-700 hover:underline">
          Nova Venda → Salvar orçamento
        </Link>
        .
      </p>

      <OfflineNotice />

      {/* Filtros */}
      <form onSubmit={buscar} className="mb-4 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-600">
            Buscar por código
            <input
              type="text"
              inputMode="numeric"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Ex.: O-000045 ou 45"
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            Cliente
            <input
              type="text"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Nome do cliente"
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Buscar
          </button>
          {(codeSearch || qSearch || status) && (
            <button
              type="button"
              onClick={limpar}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Limpar
            </button>
          )}
          <label className="flex flex-col text-xs text-gray-600 sm:ml-auto">
            Status
            <select
              value={status}
              onChange={(e) => trocarStatus(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">Todos</option>
              <option value="DRAFT">Rascunho</option>
              <option value="SENT">Enviado</option>
              <option value="ACCEPTED">Aceito</option>
              <option value="EXPIRED">Expirado</option>
              <option value="REJECTED">Recusado</option>
              <option value="CONVERTED">Convertido</option>
            </select>
          </label>
        </div>
      </form>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-gray-600">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-gray-600 shadow-sm">
          Nenhum orçamento encontrado.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setDetailId(r.id)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left shadow-sm hover:bg-gray-50"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium text-gray-800">
                    {formatQuoteNumber(r.quoteNumber)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeCls(r.effectiveStatus)}`}
                  >
                    {QUOTE_STATUS_LABELS[r.effectiveStatus]}
                  </span>
                  {r.convertedOrderNumber ? (
                    <span className="text-xs text-gray-500">
                      → {formatOrderNumber(r.convertedOrderNumber)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-sm text-gray-600">
                  {r.customerName ?? 'Sem cliente'} · {dt(r.createdAt)}
                  {r.validUntil ? ` · válido até ${dt(r.validUntil)}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-lg font-bold tabular-nums">{BRL(r.total)}</div>
            </button>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
          >
            {loadingMore ? 'Carregando…' : 'Mostrar mais'}
          </button>
        </div>
      )}

      {detailId && (
        <QuoteDetailModal
          id={detailId}
          store={store}
          printModel={printModel}
          setPrintModel={setPrintModel}
          onClose={() => setDetailId(null)}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}

/** Detalhe de um orçamento: itens, ciclo de vida (status/validade/observação), reimpressão e exclusão. */
function QuoteDetailModal({
  id,
  store,
  printModel,
  setPrintModel,
  onClose,
  onChanged,
}: {
  id: string;
  store: Store | null;
  printModel: '80mm' | 'A4';
  setPrintModel: (m: '80mm' | 'A4') => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  // Nome livre de balcão (ADR-024, 2.B) — editável só quando NÃO há cliente cadastrado vinculado
  // (aí o nome do cadastro é a identidade). `detail.customerName` já resolve o de exibição.
  const [custName, setCustName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function reload() {
    try {
      const d = await apiGet<QuoteDetail>(`/quotes/${id}`);
      setDetail(d);
      setValidUntil(d.validUntil ? d.validUntil.slice(0, 10) : '');
      setNotes(d.notes ?? '');
      setCustName(d.customerId ? '' : (d.customerName ?? ''));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const converted = detail?.status === 'CONVERTED';

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/quotes/${id}`, body);
      await reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/quotes/${id}`);
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Injeta a regra @page do modelo e abre o diálogo de impressão (mesmo padrão do PDV/Histórico). */
  async function imprimir() {
    const area = document.getElementById('print-area');
    if (area) area.setAttribute('data-model', printModel);
    let style = document.getElementById('print-page-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'print-page-style';
      document.head.appendChild(style);
    }
    style.textContent =
      printModel === '80mm'
        ? '@media print { @page { size: 80mm auto; margin: 4mm; } }'
        : '@media print { @page { size: A4; margin: 14mm; } }';
    // Garante a logo baixada antes de imprimir (some do papel se trocada agora). Ver lib/print.ts.
    await ensureImageLoaded(store?.logoUrl);
    window.print();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-lg"
      >
        {!detail ? (
          <p className="text-gray-600">{error ?? 'Carregando…'}</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-mono text-xl font-bold">{formatQuoteNumber(detail.quoteNumber)}</h2>
                <p className="text-xs text-gray-600">
                  {detail.customerName ?? 'Sem cliente'} · {dt(detail.createdAt)}
                  {detail.createdByName ? ` · ${detail.createdByName}` : ''}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeCls(detail.effectiveStatus)}`}
              >
                {QUOTE_STATUS_LABELS[detail.effectiveStatus]}
              </span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Itens (snapshot) — pares (2.B) voltam a UMA linha "A + B (par)" via groupPairedItems. */}
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
              {groupPairedItems(detail.items).map((line, idx) => (
                <li key={idx} className="flex justify-between gap-2 px-3 py-2 text-gray-700">
                  <span className="min-w-0 truncate">
                    {line.quantity}× {line.isPair ? `${line.label} (par)` : line.label}
                  </span>
                  <span className="shrink-0 tabular-nums">{BRL(line.total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-gray-200 pt-2 text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="tabular-nums">{BRL(detail.subtotal)}</span>
            </div>
            {Number(detail.discountAmount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Desconto</span>
                <span className="tabular-nums">− {BRL(detail.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{BRL(detail.total)}</span>
            </div>

            {converted ? (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 ring-1 ring-indigo-200">
                Convertido na venda{' '}
                <strong>
                  {detail.convertedOrderNumber ? formatOrderNumber(detail.convertedOrderNumber) : ''}
                </strong>
                . Orçamento imutável.
              </div>
            ) : (
              <>
                {/* Ações (ADR-024, 2.B): gerar venda (converte ao concluir no PDV) e, se rascunho,
                    editar os itens reabrindo no PDV (salva por cima do mesmo O-…). */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => router.push(`/venda?quoteId=${detail.id}`)}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                  >
                    Gerar venda
                  </button>
                  {detail.status === 'DRAFT' && (
                    <button
                      onClick={() => router.push(`/venda?quoteId=${detail.id}&edit=1`)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Editar no PDV
                    </button>
                  )}
                </div>

                {/* Ciclo de vida: status + validade + nome + observação */}
                <div className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
                  <label className="flex flex-col text-xs text-gray-600">
                    Status
                    <select
                      value={detail.status}
                      disabled={busy}
                      onChange={(e) => patch({ status: e.target.value })}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="DRAFT">Rascunho</option>
                      <option value="SENT">Enviado</option>
                      <option value="ACCEPTED">Aceito</option>
                      <option value="REJECTED">Recusado</option>
                    </select>
                  </label>
                  <label className="flex flex-col text-xs text-gray-600">
                    Válido até
                    <input
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  {/* Nome livre (2.B): só quando não há cliente cadastrado vinculado. */}
                  {!detail.customerId && (
                    <label className="flex flex-col text-xs text-gray-600 sm:col-span-2">
                      Nome (de quem é o orçamento)
                      <input
                        type="text"
                        value={custName}
                        onChange={(e) => setCustName(e.target.value)}
                        maxLength={120}
                        placeholder="Opcional"
                        className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                  )}
                  <label className="flex flex-col text-xs text-gray-600 sm:col-span-2">
                    Observação
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      maxLength={500}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <button
                      onClick={() =>
                        patch({
                          validUntil: validUntil || null,
                          notes: notes.trim() || null,
                          ...(detail.customerId ? {} : { customerName: custName.trim() || null }),
                        })
                      }
                      disabled={busy}
                      className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      Salvar alterações
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Impressão */}
            <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
              <span className="text-sm text-gray-600">Imprimir:</span>
              <select
                value={printModel}
                onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="80mm">Térmica 80mm</option>
                <option value="A4">A4</option>
              </select>
              <button
                onClick={imprimir}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-100"
              >
                Imprimir
              </button>
              <div className="ml-auto flex items-center gap-2">
                {!converted &&
                  (confirmDelete ? (
                    <>
                      <span className="text-xs text-gray-600">Excluir?</span>
                      <button
                        onClick={excluir}
                        disabled={busy}
                        className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Sim
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Não
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Excluir
                    </button>
                  ))}
                <button
                  onClick={onClose}
                  className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Documento de impressão (oculto na tela; aparece só na impressão). */}
            <ReceiptPrint
              kind="quote"
              store={store}
              // Pares (2.B) impressos como UMA linha "A + B (par)" com o preço do par; o unitário
              // sai do total ÷ qtd (mesmo critério do Histórico de Vendas).
              items={groupPairedItems(detail.items).map((line) => ({
                name: line.isPair ? `${line.label} (par)` : line.label,
                quantity: line.quantity,
                unitPrice: line.quantity > 0 ? Number((line.total / line.quantity).toFixed(2)) : line.total,
              }))}
              total={Number(detail.total)}
              discount={Number(detail.discountAmount)}
              date={new Date(detail.createdAt).toLocaleString('pt-BR')}
              quoteNumber={detail.quoteNumber}
              validUntil={detail.validUntil ? dt(detail.validUntil) : null}
            />
          </>
        )}
      </div>
    </div>
  );
}
