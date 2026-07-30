'use client';

import { useEffect, useState } from 'react';
import {
  openCashSessionSchema,
  closeCashSessionSchema,
  type CashMovementInput,
  type CashMovementRow,
} from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { cacheCashSession, readCachedCashSession, type CachedCashSession } from '@/lib/cashSessionCache';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';
import { OfflineSalesNotice } from '@/components/OfflineSalesNotice';
import { MoneyInput } from '@/components/MoneyInput';
import { CashCounter } from '@/components/CashCounter';
import { CashMovementModal } from '@/components/CashMovementModal';
import { CashMovementsList } from '@/components/CashMovementsList';

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
  // Extrato das movimentações do caixa aberto + estado colapsável da seção.
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [movementsOpen, setMovementsOpen] = useState(false);
  // Lançamento em processo de estorno (desabilita o botão e mostra "Estornando…").
  const [reversingId, setReversingId] = useState<string | null>(null);

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
  }, []);

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
      setClosing('');
      setNotes('');
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

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold">Caixa</h1>

      {/* Offline: o erro cru de rede ("Failed to fetch") vira ruído — o OfflineSalesNotice já
          explica. Só mostra o erro técnico quando online (falha real de ação). */}
      {error && online && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {info && <p className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm">{info}</p>}

      {!loaded ? (
        <p className="text-gray-600">Carregando…</p>
      ) : session ? (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
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

              {/* Mini-DRE do caixa: abertura, o que ENTROU e o que SAIU até o esperado. */}
              <dt className="text-gray-600">Valor de abertura</dt>
              <dd className="text-right">{BRL(session.openingAmount)}</dd>

              <dt className="text-gray-600">+ Vendas em dinheiro</dt>
              <dd className="text-right text-green-700">{BRL(session.cashInflow)}</dd>

              {session.cashMovementsIn > 0 && (
                <>
                  <dt className="text-gray-600">+ Suprimentos</dt>
                  <dd className="text-right text-green-700">{BRL(session.cashMovementsIn)}</dd>
                </>
              )}

              {session.cashMovementsOut > 0 && (
                <>
                  <dt className="text-gray-600">− Devoluções / saídas</dt>
                  <dd className="text-right text-red-600">− {BRL(session.cashMovementsOut)}</dd>
                </>
              )}

              <dt className="mt-1 border-t border-gray-100 pt-2 font-medium">Esperado no caixa</dt>
              <dd className="mt-1 border-t border-gray-100 pt-2 text-right font-medium">
                {BRL(session.expectedAmount)}
              </dd>
            </dl>

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
              poluir o cartão do caixa. */}
          <div className="rounded-2xl bg-white p-5 shadow-sm">
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
                />
              </div>
            )}
          </div>

          <form onSubmit={onClose} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Fechar caixa</h2>
              <button
                type="button"
                onClick={() => setCounter('close')}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                🪙 Usar contador
              </button>
            </div>
            <MoneyInput
              placeholder="Valor contado (R$)"
              value={closing}
              onChange={setClosing}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <textarea
              placeholder="Observações (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              rows={2}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {busy ? 'Fechando…' : 'Fechar caixa'}
            </button>
          </form>
        </div>
      ) : cachedSession ? (
        // Cold-start offline (ADR-012 CS-1): sem rede, mostramos o caixa aberto conhecido (só a
        // identidade do turno; os valores financeiros vêm do servidor). Fechar caixa é online-only,
        // então aqui não há formulário — só o aviso de que a operação volta com a conexão.
        <div className="rounded-2xl bg-white p-5 shadow-sm">
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
          <form onSubmit={onOpen} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
              <span className="h-2 w-2 rounded-full bg-gray-400" /> Caixa fechado
            </div>
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Abrir caixa</h2>
              <button
                type="button"
                onClick={() => setCounter('open')}
                disabled={!online}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                🪙 Usar contador
              </button>
            </div>
            <MoneyInput
              placeholder="Valor de abertura (R$)"
              value={opening}
              onChange={setOpening}
              disabled={!online}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={busy || !online}
              className="w-full rounded-lg bg-gray-900 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {busy ? 'Abrindo…' : !online ? 'Sem conexão para abrir o caixa' : 'Abrir caixa'}
            </button>
          </form>
        </>
      )}

      {counter && (
        <CashCounter
          title={counter === 'open' ? 'Contar abertura' : 'Contar a gaveta'}
          onConfirm={(total) => {
            if (counter === 'open') setOpening(String(total));
            else setClosing(String(total));
          }}
          onClose={() => setCounter(null)}
        />
      )}

      {moving && <CashMovementModal onSubmit={onMovement} onClose={() => setMoving(false)} />}
    </div>
  );
}
