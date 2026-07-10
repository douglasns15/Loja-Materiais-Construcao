'use client';

import { useEffect, useState } from 'react';
import { openCashSessionSchema, closeCashSessionSchema } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useOnline } from '@/lib/useOnline';
import { StoreDisabledNotice } from '@/components/StoreDisabledNotice';
import { OfflineSalesNotice } from '@/components/OfflineSalesNotice';

type CashSession = {
  id: string;
  openedAt: string;
  openingAmount: string;
  openedByName: string | null;
  cashInflow: number;
  cashMovementsNet: number; // entradas − saídas de caixa (devolução, sangria, suprimento)
  expectedAmount: number;
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CaixaPage() {
  const { me, offlineSales } = useMe();
  const online = useOnline();
  const [session, setSession] = useState<CashSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setSession(await apiGet<CashSession | null>('/cash-sessions/current'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
        <p className="text-gray-500">Carregando…</p>
      ) : session ? (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Caixa aberto
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-gray-500">Aberto em</dt>
              <dd className="text-right">{new Date(session.openedAt).toLocaleString('pt-BR')}</dd>
              {session.openedByName && (
                <>
                  <dt className="text-gray-500">Aberto por</dt>
                  <dd className="text-right">{session.openedByName}</dd>
                </>
              )}
              <dt className="text-gray-500">Valor de abertura</dt>
              <dd className="text-right">{BRL(session.openingAmount)}</dd>
              <dt className="text-gray-500">Entradas em dinheiro</dt>
              <dd className="text-right">{BRL(session.cashInflow)}</dd>
              {session.cashMovementsNet !== 0 && (
                <>
                  <dt className="text-gray-500">Devoluções / saídas</dt>
                  <dd className="text-right text-red-600">{BRL(session.cashMovementsNet)}</dd>
                </>
              )}
              <dt className="font-medium">Esperado no caixa</dt>
              <dd className="text-right font-medium">{BRL(session.expectedAmount)}</dd>
            </dl>
          </div>

          <form onSubmit={onClose} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-medium">Fechar caixa</h2>
            <input
              placeholder="Valor contado (R$)"
              type="number"
              step="0.01"
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
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
            <h2 className="font-medium">Abrir caixa</h2>
            <input
              placeholder="Valor de abertura (R$)"
              type="number"
              step="0.01"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
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
    </div>
  );
}
