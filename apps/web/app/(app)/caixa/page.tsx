'use client';

import { useEffect, useState } from 'react';
import {
  openCashSessionSchema,
  closeCashSessionSchema,
  type CashMovementInput,
  type CashMovementRow,
  type CashSessionReport,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { cacheCashSession, readCachedCashSession, type CachedCashSession } from '@/lib/cashSessionCache';
import { readCashDraft, saveCashDraft, clearCashDraft, hasCounterDraft } from '@/lib/cashDrafts';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';
import { OfflineSalesNotice } from '@/components/OfflineSalesNotice';
import { MoneyInput } from '@/components/MoneyInput';
import { CashCounter } from '@/components/CashCounter';
import { CashMovementModal } from '@/components/CashMovementModal';
import { CashMovementsList } from '@/components/CashMovementsList';
import { printArea } from '@/lib/print';
import { type Store } from '@/components/ReceiptPrint';
import { CashClosePrint, type CashCloseReceiptData } from '@/components/CashClosePrint';
import { CashMovementPrint, type CashMovementReceiptData } from '@/components/CashMovementPrint';

type CashSession = {
  id: string;
  openedAt: string;
  openingAmount: string;
  openedByName: string | null;
  cashInflow: number; // vendas em dinheiro (entrada)
  cashMovementsIn: number; // suprimentos (entrada), bruto ≥ 0
  cashMovementsOut: number; // devoluções/sangrias/despesas (saída), bruto ≥ 0
  cashMovementsNet: number; // entradas − saídas de caixa (mantido p/ compatibilidade)
  expectedAmount: number;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CaixaPage() {
  const { me, offlineSales } = useMe();
  const online = useOnline();
  const [session, setSession] = useState<CashSession | null>(null);
  // Caixa aberto recuperado do cache offline (ADR-012 CS-1) quando a API não respondeu (cold-start).
  const [cachedSession, setCachedSession] = useState<CachedCashSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Contador de cédulas/moedas aberto para qual campo (null = fechado).
  const [counter, setCounter] = useState<'open' | 'close' | null>(null);
  // Modal de Movimentação de Caixa (Suprimento/Sangria) aberto?
  const [moving, setMoving] = useState(false);
  // Selo "rascunho" nos botões do contador: indica que há uma contagem salva a recuperar
  // (pedido do Owner — não perder o que foi digitado ao sair da tela). Recalculado ao montar
  // e sempre que o contador fecha.
  const [draftHint, setDraftHint] = useState<{ open: boolean; close: boolean }>({
    open: false,
    close: false,
  });
  // Extrato das movimentações do caixa aberto + estado colapsável da seção.
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [movementsOpen, setMovementsOpen] = useState(false);
  // Lançamento em processo de estorno (desabilita o botão e mostra "Estornando…").
  const [reversingId, setReversingId] = useState<string | null>(null);
  // Fechamento cego (blind close, ajuste por loja): esconde o Esperado e a quebra de valores no
  // fechamento até o operador "revelar". `revealed` guarda que ele já revelou nesta sessão.
  const [blindClose, setBlindClose] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Identidade da loja (cabeçalho dos comprovantes) + comprovantes imprimíveis do Caixa.
  const [store, setStore] = useState<Store | null>(null);
  // `closeReceipt`: fechamento recém-feito (habilita o botão de imprimir na confirmação).
  // `closePrintData`: o que está montado no #print-area de fechamento (recém-feito OU reimpressão).
  const [closeReceipt, setCloseReceipt] = useState<CashCloseReceiptData | null>(null);
  const [closePrintData, setClosePrintData] = useState<CashCloseReceiptData | null>(null);
  const [movementReceipt, setMovementReceipt] = useState<CashMovementReceiptData | null>(null);
  // Qual comprovante está montado no #print-area (só um por vez — o id é único). null = nenhum.
  const [printKind, setPrintKind] = useState<'close' | 'movement' | null>(null);
  // Caixas fechados HOJE (histórico do dia na própria tela do Caixa) — reusa GET /reports/cash-sessions
  // com ?breakdown=1 para poder reimprimir o comprovante de fechamento completo.
  const [todaySessions, setTodaySessions] = useState<CashSessionReport[]>([]);

  async function load() {
    try {
      const current = await apiGet<CashSession | null>('/cash-sessions/current');
      setSession(current);
      // Rede venceu (ADR-012 (a)): sobrescreve/limpa o cache do caixa aberto.
      cacheCashSession(current);
      setCachedSession(null);
      setError(null);
      // Extrato das movimentações (só faz sentido com caixa aberto). Uma falha aqui não pode
      // derrubar a tela do caixa — por isso o try/catch próprio (degrada para lista vazia).
      if (current) {
        try {
          setMovements(await apiGet<CashMovementRow[]>('/cash-sessions/movements'));
        } catch {
          setMovements([]);
        }
      } else {
        setMovements([]);
      }
    } catch (e) {
      // Offline (cold-start): recupera o último caixa aberto conhecido para não oferecer "abrir
      // caixa" indevidamente (achado 3.E.2 / ADR-012 CS-1). Fechar caixa segue online-only.
      const cached = readCachedCashSession();
      setSession(null);
      setCachedSession(cached);
      if (!cached) setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    loadTodaySessions();
  }, []);

  // Hidrata os campos com o rascunho salvo (feito em effect, não no render, para não quebrar a
  // hidratação do SSR — o servidor não tem localStorage). Restaura valor de abertura, valor
  // contado, observações e o selo de contagem em rascunho.
  useEffect(() => {
    const open = readCashDraft('open');
    const close = readCashDraft('close');
    if (open.amount) setOpening(open.amount);
    if (close.amount) setClosing(close.amount);
    if (close.notes) setNotes(close.notes);
    refreshDraftHints();
  }, []);

  function refreshDraftHints() {
    setDraftHint({ open: hasCounterDraft('open'), close: hasCounterDraft('close') });
  }

  // Identidade da loja + ajuste de fechamento cego (um GET só). A loja alimenta o cabeçalho dos
  // comprovantes; `blindCashClose` liga o modo cego. Falha (offline/erro) degrada para o fechamento
  // normal (não-cego), que é o comportamento historicamente padrão. Só de leitura.
  useEffect(() => {
    apiGet<Store & { blindCashClose?: boolean }>('/tenant')
      .then((t) => {
        setStore(t);
        setBlindClose(!!t?.blindCashClose);
      })
      .catch(() => {});
  }, []);

  // Carrega os caixas fechados HOJE (fuso -03h, como o servidor). Falha (offline/erro) → lista vazia.
  async function loadTodaySessions() {
    try {
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const rows = await apiGet<CashSessionReport[]>(
        `/reports/cash-sessions?breakdown=1&from=${day}&to=${day}`,
      );
      setTodaySessions(rows);
    } catch {
      setTodaySessions([]);
    }
  }

  // Monta um comprovante no #print-area e abre o diálogo de impressão. Dois `requestAnimationFrame`
  // garantem que o React já pintou o #print-area escolhido antes de `window.print()` capturar a página.
  function doPrint(kind: 'close' | 'movement', fileName: string) {
    setPrintKind(kind);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void printArea({ model: '80mm', logoUrl: store?.logoUrl, fileName });
      }),
    );
  }

  // Imprime um comprovante de fechamento (recém-feito ou reimpressão de um caixa de hoje).
  function printClose(data: CashCloseReceiptData, fileName: string) {
    setClosePrintData(data);
    doPrint('close', fileName);
  }

  // Constrói os dados do comprovante a partir de um caixa fechado do relatório (?breakdown=1 traz a
  // quebra da mini-DRE). Sem a lista de movimentações item a item (o relatório não a traz).
  function receiptFromReport(s: CashSessionReport): CashCloseReceiptData {
    return {
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openedByName: s.openedByName,
      closedByName: s.closedByName,
      openingAmount: s.openingAmount,
      cashInflow: s.cashInflow ?? 0,
      movementsIn: s.cashMovementsIn ?? 0,
      movementsOut: s.cashMovementsOut ?? 0,
      expectedAmount: s.expectedAmount,
      countedAmount: s.closingAmount,
      divergence: s.divergence,
      notes: s.notes,
    };
  }

  // Reimprime uma movimentação do extrato (suprimento/sangria/etc.).
  function printMovement(row: CashMovementRow) {
    setMovementReceipt({
      kind: row.kind,
      type: row.type,
      amount: Number(row.amount),
      reason: row.reason,
      at: row.createdAt,
      byName: row.registeredByName,
      sessionOpenedAt: session?.openedAt ?? null,
    });
    doPrint('movement', `Movimentacao-${new Date(row.createdAt).toLocaleDateString('pt-BR')}`);
  }

  async function onOpen(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const parsed = openCashSessionSchema.safeParse({ openingAmount: Number(opening) });
    if (!parsed.success) {
      setError('Informe um valor de abertura válido.');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/cash-sessions/open', parsed.data);
      setOpening('');
      // Turno virou: descarta o rascunho de abertura (valor + contagem) e some com o selo.
      clearCashDraft('open');
      refreshDraftHints();
      // Novo turno: o comprovante do fechamento anterior deixa de fazer sentido na tela.
      setCloseReceipt(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClose(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const parsed = closeCashSessionSchema.safeParse({
      closingAmount: Number(closing),
      ...(notes ? { notes } : {}),
    });
    if (!parsed.success) {
      setError('Informe o valor contado no caixa.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ divergence: number; expectedAmount: number }>(
        '/cash-sessions/close',
        parsed.data,
      );
      // Monta o comprovante de fechamento ANTES de limpar os campos/sessão (habilita "Imprimir
      // comprovante" na tela de confirmação). `session` ainda tem a mini-DRE do turno que fechou.
      if (session) {
        setCloseReceipt({
          openedAt: session.openedAt,
          closedAt: new Date().toISOString(),
          openedByName: session.openedByName,
          closedByName: me?.name ?? null,
          openingAmount: Number(session.openingAmount),
          cashInflow: session.cashInflow,
          movementsIn: session.cashMovementsIn,
          movementsOut: session.cashMovementsOut,
          expectedAmount: res.expectedAmount,
          countedAmount: Number(closing),
          divergence: res.divergence,
          notes: notes || null,
          movements: movements.map((m) => ({
            kind: m.kind,
            type: m.type,
            amount: Number(m.amount),
            reason: m.reason,
            at: m.createdAt,
          })),
        });
      }
      setClosing('');
      setNotes('');
      // Turno encerrado: descarta o rascunho de fechamento (valor contado + observações + contagem).
      clearCashDraft('close');
      refreshDraftHints();
      // Próximo turno recomeça às cegas (se a loja usa fechamento cego).
      setRevealed(false);
      // O caixa que acabou de fechar entra no histórico "Caixas de hoje".
      loadTodaySessions();
      const d = res.divergence;
      setInfo(
        d === 0
          ? 'Caixa fechado: valor bateu certinho. ✅'
          : `Caixa fechado com divergência de ${BRL(d)} (${d > 0 ? 'sobra' : 'falta'}).`,
      );
      // O fechamento deu certo → o caixa está fechado. Reflete na hora, sem depender de um
      // novo GET /current (que poderia vir de cache ainda mostrando a sessão como aberta e
      // deixar o visual "aberto" apesar da mensagem de fechado). Limpa também o cache offline.
      setSession(null);
      setCachedSession(null);
      cacheCashSession(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Lança uma Movimentação de Caixa (Suprimento/Sangria) e recarrega o caixa para a
  // mini-DRE (+ Suprimentos / − saídas) e o Esperado refletirem na hora.
  async function onMovement(input: CashMovementInput) {
    await apiPost('/cash-sessions/movement', input);
    setInfo(
      input.kind === 'SUPPLY'
        ? `Suprimento de ${BRL(input.amount)} registrado. ✅`
        : `Sangria de ${BRL(input.amount)} registrada. ✅`,
    );
    await load();
  }

  // Estorna um lançamento manual (Suprimento/Sangria) feito por engano: cria um contra-lançamento
  // que zera o efeito no caixa. Recarrega para a mini-DRE e o Esperado refletirem na hora.
  async function onReverseMovement(row: CashMovementRow) {
    setError(null);
    setInfo(null);
    setReversingId(row.id);
    try {
      await apiPost(`/cash-sessions/movement/${row.id}/reverse`, {});
      setInfo('Lançamento estornado. O contra-lançamento aparece no extrato. ✅');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReversingId(null);
    }
  }

  // Conferência do fechamento (usada na faixa e na máscara da mini-DRE):
  // - `hideMoney`: modo cego ligado e ainda não revelado → esconde Esperado e a quebra de valores.
  // - `divergence`: contado − esperado (só faz sentido com valor digitado e caixa aberto).
  const hideMoney = blindClose && !revealed && !!session;
  const closingNum = Number(closing);
  const hasClosing = closing.trim() !== '' && Number.isFinite(closingNum);
  const divergence = session ? closingNum - session.expectedAmount : 0;
  // Formata dinheiro, mas mascara quando o modo cego ainda esconde os valores.
  const money = (v: string | number) => (hideMoney ? '•••••' : BRL(v));

  return (
    <div className="mx-auto max-w-xl">
      {/* Identidade das telas repaginadas (PDV Opção A): título em gradiente índigo + subtítulo. */}
      <h1 className="mb-1 w-fit bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-2xl font-bold text-transparent">
        Caixa
      </h1>
      <p className="mb-5 text-sm text-gray-500">
        O turno da gaveta — abra o troco, movimente durante o dia e feche com o valor certinho.
      </p>

      {/* Offline: o erro cru de rede ("Failed to fetch") vira ruído — o OfflineSalesNotice já
          explica. Só mostra o erro técnico quando online (falha real de ação). */}
      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

      {/* Comprovante do fechamento recém-feito (some ao abrir um novo caixa). */}
      {closeReceipt && (
        <button
          type="button"
          onClick={() => printClose(closeReceipt, 'Fechamento-de-caixa')}
          className="mb-4 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
        >
          🖨 Imprimir comprovante do fechamento
        </button>
      )}

      {!loaded ? (
        <p className="text-gray-600">Carregando…</p>
      ) : session ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Caixa aberto
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-gray-600">Aberto em</dt>
              <dd className="text-right">{new Date(session.openedAt).toLocaleString('pt-BR')}</dd>
              {session.openedByName && (
                <>
                  <dt className="text-gray-600">Aberto por</dt>
                  <dd className="text-right">{session.openedByName}</dd>
                </>
              )}

              {/* Mini-DRE do caixa: abertura, o que ENTROU e o que SAIU até o esperado. No modo
                  cego (`hideMoney`), os valores viram "•••••" até o operador revelar no fechamento. */}
              <dt className="text-gray-600">Valor de abertura</dt>
              <dd className="text-right">{money(session.openingAmount)}</dd>

              <dt className="text-gray-600">+ Vendas em dinheiro</dt>
              <dd className="text-right text-green-700">{money(session.cashInflow)}</dd>

              {session.cashMovementsIn > 0 && (
                <>
                  <dt className="text-gray-600">+ Suprimentos</dt>
                  <dd className="text-right text-green-700">{money(session.cashMovementsIn)}</dd>
                </>
              )}

              {session.cashMovementsOut > 0 && (
                <>
                  <dt className="text-gray-600">− Devoluções / saídas</dt>
                  <dd className="text-right text-red-600">
                    {hideMoney ? '•••••' : <>− {BRL(session.cashMovementsOut)}</>}
                  </dd>
                </>
              )}

              <dt className="mt-1 border-t border-gray-100 pt-2 font-medium">Esperado no caixa</dt>
              <dd className="mt-1 border-t border-gray-100 pt-2 text-right font-medium">
                {money(session.expectedAmount)}
              </dd>
            </dl>

            {hideMoney && (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                <span aria-hidden>🙈</span>
                Conferência às cegas — os valores aparecem ao revelar no fechamento.
              </p>
            )}

            <button
              type="button"
              onClick={() => setMoving(true)}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              💵 Movimentar caixa (suprimento / sangria)
            </button>
          </div>

          {/* Extrato: detalha o que compõe as linhas da mini-DRE (suprimentos, sangrias,
              devoluções, despesas) com valor, motivo, autor e hora. Colapsável para não
              poluir o cartão do caixa. No modo cego fica oculto até revelar (revelaria os valores). */}
          {!hideMoney && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <button
                type="button"
                onClick={() => setMovementsOpen((v) => !v)}
                className="flex w-full items-center justify-between"
                aria-expanded={movementsOpen}
              >
                <span className="font-medium">Movimentações do caixa</span>
                <span className="flex items-center gap-2 text-sm text-gray-600">
                  {movements.length > 0 && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 tabular-nums">
                      {movements.length}
                    </span>
                  )}
                  <span>{movementsOpen ? '▲' : '▼'}</span>
                </span>
              </button>

              {movementsOpen && (
                <div className="mt-4">
                  <CashMovementsList
                    movements={movements}
                    emptyLabel="Nenhuma movimentação neste caixa ainda."
                    onReverse={onReverseMovement}
                    reversingId={reversingId}
                    onPrint={printMovement}
                  />
                </div>
              )}
            </div>
          )}

          <form onSubmit={onClose} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Fechar caixa</h2>
              <button
                type="button"
                onClick={() => setCounter('close')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                🪙 Usar contador
                {draftHint.close && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                    rascunho
                  </span>
                )}
              </button>
            </div>
            <MoneyInput
              placeholder="Valor contado (R$)"
              value={closing}
              onChange={(v) => {
                setClosing(v);
                saveCashDraft('close', { amount: v });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <textarea
              placeholder="Observações (opcional)"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                saveCashDraft('close', { notes: e.target.value });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              rows={2}
            />

            {/* Conferência: no modo cego mostra o botão "Revelar"; caso contrário (ou após revelar)
                mostra a divergência AO VIVO — contado vs. esperado — atualizando a cada tecla/contagem. */}
            {hideMoney ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                👁️ Revelar conferência
              </button>
            ) : hasClosing ? (
              <div
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                  divergence === 0
                    ? 'bg-green-50 text-green-700'
                    : divergence > 0
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'
                }`}
              >
                <span className="font-medium">
                  {divergence === 0
                    ? '✅ Confere certinho'
                    : divergence > 0
                      ? 'Sobra na gaveta'
                      : 'Falta na gaveta'}
                </span>
                <span className="font-semibold tabular-nums">
                  {divergence === 0
                    ? BRL(0)
                    : `${divergence > 0 ? '+' : '−'} ${BRL(Math.abs(divergence))}`}
                </span>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Digite ou use o contador para conferir com o esperado.
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2 font-medium text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-60"
            >
              {busy ? 'Fechando…' : 'Fechar caixa'}
            </button>
          </form>
        </div>
      ) : cachedSession ? (
        // Cold-start offline (ADR-012 CS-1): sem rede, mostramos o caixa aberto conhecido (só a
        // identidade do turno; os valores financeiros vêm do servidor). Fechar caixa é online-only,
        // então aqui não há formulário — só o aviso de que a operação volta com a conexão.
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" /> Caixa aberto
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-gray-600">Aberto em</dt>
            <dd className="text-right">{new Date(cachedSession.openedAt).toLocaleString('pt-BR')}</dd>
            {cachedSession.openedByName && (
              <>
                <dt className="text-gray-600">Aberto por</dt>
                <dd className="text-right">{cachedSession.openedByName}</dd>
              </>
            )}
            <dt className="text-gray-600">Valor de abertura</dt>
            <dd className="text-right">{BRL(cachedSession.openingAmount)}</dd>
          </dl>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Sem conexão — dados de{' '}
            {new Date(cachedSession.cachedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
            Os valores do caixa e o fechamento voltam quando a internet retornar.
          </p>
        </div>
      ) : me?.tenantActive === false ? (
        // Loja desativada (ADR-009): abrir caixa bloqueado. Aviso já ao abrir a tela.
        <StoreDisabledNotice message="A abertura de caixa está bloqueada. Fale com o suporte para reativar a loja." />
      ) : (
        <>
          {/* Abrir caixa ainda é online-only nesta fatia (ADR-011): avisa e desabilita offline. */}
          <OfflineSalesNotice offlineSales={offlineSales} context="cash-open" />
          <form onSubmit={onOpen} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
              <span className="h-2 w-2 rounded-full bg-gray-400" /> Caixa fechado
            </div>
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Abrir caixa</h2>
              <button
                type="button"
                onClick={() => setCounter('open')}
                disabled={!online}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                🪙 Usar contador
                {draftHint.open && (
                  <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
                    rascunho
                  </span>
                )}
              </button>
            </div>
            <MoneyInput
              placeholder="Valor de abertura (R$)"
              value={opening}
              onChange={(v) => {
                setOpening(v);
                saveCashDraft('open', { amount: v });
              }}
              disabled={!online}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={busy || !online}
              className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 py-2 font-medium text-white shadow-sm hover:from-indigo-700 hover:to-indigo-600 disabled:opacity-60"
            >
              {busy ? 'Abrindo…' : !online ? 'Sem conexão para abrir o caixa' : 'Abrir caixa'}
            </button>
          </form>
        </>
      )}

      {/* Histórico do dia na própria tela do Caixa: os turnos JÁ FECHADOS hoje (o aberto agora está
          no card acima). Cada um pode reimprimir o comprovante de fechamento completo. */}
      {todaySessions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Caixas de hoje</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs tabular-nums text-gray-600">
              {todaySessions.length}
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {todaySessions.map((s) => {
              const d = s.divergence;
              const hhmm = (iso: string) =>
                new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {hhmm(s.openedAt)} → {hhmm(s.closedAt)}
                      {s.closedByName ? (
                        <span className="font-normal text-gray-500"> · {s.closedByName}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Abertura {BRL(s.openingAmount)} · Esperado {BRL(s.expectedAmount)} · Contado{' '}
                      {BRL(s.closingAmount)}
                    </p>
                    <span
                      className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        d === 0
                          ? 'bg-green-50 text-green-700'
                          : d > 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {d === 0
                        ? '✅ Conferiu'
                        : `${d > 0 ? 'Sobra' : 'Falta'} ${BRL(Math.abs(d))}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      printClose(receiptFromReport(s), `Fechamento-${hhmm(s.closedAt).replace(':', 'h')}`)
                    }
                    className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    title="Reimprimir o comprovante de fechamento"
                  >
                    🖨 Comprovante
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {counter && (
        <CashCounter
          title={counter === 'open' ? 'Contar abertura' : 'Contar a gaveta'}
          persistMode={counter}
          onConfirm={(total) => {
            // Leva o total para o campo e para o rascunho (assim o valor também sobrevive à navegação).
            const v = String(total);
            if (counter === 'open') {
              setOpening(v);
              saveCashDraft('open', { amount: v });
            } else {
              setClosing(v);
              saveCashDraft('close', { amount: v });
            }
          }}
          onClose={() => {
            setCounter(null);
            refreshDraftHints();
          }}
        />
      )}

      {moving && <CashMovementModal onSubmit={onMovement} onClose={() => setMoving(false)} />}

      {/* Comprovantes imprimíveis (ocultos na tela; só um #print-area montado por vez). */}
      {printKind === 'close' && closePrintData && <CashClosePrint store={store} data={closePrintData} />}
      {printKind === 'movement' && movementReceipt && (
        <CashMovementPrint store={store} data={movementReceipt} />
      )}
    </div>
  );
}
