'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PAYMENT_METHOD_LABELS,
  cancelOrderSchema,
  returnOrderSchema,
  type PaymentMethod,
} from '@nexoloja/shared';
import { groupPairedItems } from '@nexoloja/core';
import { apiGet, apiPost } from '@/lib/api';
import { useOnline } from '@/lib/useOnline';
import { OfflineNotice } from '@/components/OfflineNotice';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

type OrderItem = {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  total: string;
  /** Agrupamento do par (ADR-015): os dois itens viram uma linha só na exibição. */
  pairGroup: number | null;
};
type Payment = { id: string; method: string; amount: string };
type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'INVOICED' | 'CANCELLED' | 'RETURNED';
type Order = {
  id: string;
  status: OrderStatus;
  subtotal: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  registeredByName: string | null;
  cashSession: { id: string; closedAt: string | null } | null;
  items: OrderItem[];
  payments: Payment[];
};

/** Ação em curso no modal: cancelamento (caixa aberto) ou devolução (caixa fechado). */
type ActionMode = 'cancel' | 'return';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulo da forma de pagamento (cai no código bruto se vier algo fora do enum). */
function methodLabel(m: string): string {
  return PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
}

export default function VendasPage() {
  const online = useOnline();
  const [ready, setReady] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Modal de ação: qual venda e se é cancelamento ou devolução.
  const [action, setAction] = useState<{ id: string; mode: ActionMode } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');
  // Job de reimpressão: novo objeto a cada clique força o efeito a disparar de novo.
  const [printJob, setPrintJob] = useState<{ order: Order; key: number } | null>(null);

  async function loadOrders() {
    // scope=all: histórico completo (inclui vendas de caixas já fechados), para
    // permitir a devolução de vendas fora do caixa aberto.
    setOrders(await apiGet<Order[]>('/orders?scope=all'));
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{ id: string } | null>('/cash-sessions/current');
        setOpenSessionId(session?.id ?? null);
        await loadOrders();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  /** Define o modelo (80mm/A4), injeta a regra @page e abre o diálogo de impressão. */
  function imprimir() {
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
    window.print();
  }

  /** Reimprime o comprovante de uma venda já registrada. */
  function reimprimir(order: Order) {
    setPrintJob({ order, key: Date.now() });
  }

  // Após o ReceiptPrint do job entrar no DOM, dispara o diálogo de impressão.
  useEffect(() => {
    if (printJob) imprimir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  function abrirAcao(id: string, mode: ActionMode) {
    setError(null);
    setReason('');
    setAction({ id, mode });
  }

  function fecharAcao() {
    setAction(null);
    setReason('');
    setError(null);
  }

  async function confirmarAcao() {
    if (!action) return;
    const schema = action.mode === 'cancel' ? cancelOrderSchema : returnOrderSchema;
    const parsed = schema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setError(
        action.mode === 'cancel'
          ? 'Informe o motivo do cancelamento (mín. 3 caracteres).'
          : 'Informe o motivo da devolução (mín. 3 caracteres).',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = action.mode === 'cancel' ? 'cancel' : 'return';
      await apiPost(`/orders/${action.id}/${path}`, parsed.data);
      fecharAcao();
      await loadOrders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="text-gray-500">Carregando…</p>;

  const caixaOpen = !!openSessionId;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Histórico de Vendas</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Modelo de impressão:</span>
          <select
            value={printModel}
            onChange={(e) => setPrintModel(e.target.value as '80mm' | 'A4')}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="80mm">Térmica 80mm</option>
            <option value="A4">A4</option>
          </select>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Vendas mais recentes. Reimprima o comprovante, <strong>cancele</strong> vendas do caixa
        aberto (estorna estoque e caixa) ou <strong>devolva</strong> vendas de caixas já fechados
        (repõe o estoque e lança a saída no caixa de hoje).
      </p>

      {/* Tela online-only (ADR-012 (c)): offline mostra o aviso de rede, não o erro cru. */}
      <OfflineNotice />

      {!caixaOpen && online && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Caixa fechado — você pode consultar e reimprimir. Para cancelar ou devolver,{' '}
          <Link href="/caixa" className="font-medium underline">
            abra o caixa
          </Link>
          .
        </div>
      )}

      {/* Erro cru da lista só quando online (offline = "Failed to fetch"; o aviso acima já cobre). */}
      {error && online && !action && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-gray-400 shadow-sm">
            Nenhuma venda registrada ainda.
          </div>
        ) : (
          orders.map((o) => {
            const cancelled = o.status === 'CANCELLED';
            const returned = o.status === 'RETURNED';
            const inactive = cancelled || returned;
            // Venda do caixa aberto atual → cancelar; de caixa fechado → devolver.
            const isOpenSessionOrder = caixaOpen && o.cashSession?.id === openSessionId;
            const canAct = o.status === 'CONFIRMED' && caixaOpen;
            const time = new Date(o.createdAt).toLocaleString('pt-BR');
            const methods = [...new Set(o.payments.map((p) => methodLabel(p.method)))].join(', ');
            const editing = action?.id === o.id;
            return (
              <div
                key={o.id}
                className={`rounded-2xl bg-white p-4 shadow-sm ${inactive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">#{o.id.slice(0, 8)}</span>
                      {cancelled ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Cancelada
                        </span>
                      ) : returned ? (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          Devolvida
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Confirmada
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">{time}</div>
                    {o.registeredByName && (
                      <div className="text-xs text-gray-400">Registrado por {o.registeredByName}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${inactive ? 'line-through' : ''}`}>
                      {BRL(o.total)}
                    </div>
                    {methods && <div className="text-xs text-gray-500">{methods}</div>}
                  </div>
                </div>

                <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100 pt-2 text-sm">
                  {/* Par (ADR-015): os dois itens aparecem como uma linha só, igual ao comprovante. */}
                  {groupPairedItems(o.items).map((line, idx) => (
                    <li key={idx} className="flex justify-between py-1 text-gray-600">
                      <span>
                        {line.quantity}
                        {line.isPair ? ` par${line.quantity > 1 ? 'es' : ''} ` : '× '}
                        {line.label}
                      </span>
                      <span>{BRL(line.total)}</span>
                    </li>
                  ))}
                </ul>

                {editing ? (
                  <div
                    className={`mt-3 space-y-2 rounded-lg p-3 ring-1 ${
                      action?.mode === 'cancel'
                        ? 'bg-red-50 ring-red-200'
                        : 'bg-orange-50 ring-orange-200'
                    }`}
                  >
                    <label
                      className={`block text-sm font-medium ${
                        action?.mode === 'cancel' ? 'text-red-800' : 'text-orange-800'
                      }`}
                    >
                      {action?.mode === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da devolução'}
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="Ex.: cliente desistiu, item com defeito…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <p className="text-xs text-gray-500">
                      {action?.mode === 'cancel'
                        ? 'O estoque dos itens volta e o valor é estornado deste caixa. Não dá para desfazer.'
                        : 'O estoque dos itens volta e a saída do valor é lançada no caixa de hoje. Não dá para desfazer.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={fecharAcao}
                        disabled={busy}
                        className="rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={confirmarAcao}
                        disabled={busy}
                        className={`rounded-lg py-2 text-sm font-medium text-white disabled:opacity-60 ${
                          action?.mode === 'cancel'
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-orange-600 hover:bg-orange-700'
                        }`}
                      >
                        {busy
                          ? 'Processando…'
                          : action?.mode === 'cancel'
                            ? 'Confirmar cancelamento'
                            : 'Confirmar devolução'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-3">
                    <button
                      onClick={() => reimprimir(o)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Reimprimir nota
                    </button>
                    {canAct &&
                      (isOpenSessionOrder ? (
                        <button
                          onClick={() => abrirAcao(o.id, 'cancel')}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                        >
                          Cancelar venda
                        </button>
                      ) : (
                        <button
                          onClick={() => abrirAcao(o.id, 'return')}
                          className="rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50"
                        >
                          Devolver
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Documento de reimpressão: oculto na tela, aparece só na impressão. */}
      {printJob && (
        <ReceiptPrint
          kind="sale"
          store={store}
          // ADR-015: reimprime igual ao original — o par vira UMA linha ("Parafuso + Bucha
          // (par)") com o preço do par. `unitPrice` é derivado do total ÷ qtd para a coluna
          // "Unit." bater com a linha unificada.
          items={groupPairedItems(printJob.order.items).map((line) => ({
            name: line.isPair ? `${line.label} (par)` : line.label,
            quantity: line.quantity,
            unitPrice: line.quantity > 0 ? line.total / line.quantity : line.total,
          }))}
          total={Number(printJob.order.total)}
          discount={Number(printJob.order.discountAmount)}
          date={new Date(printJob.order.createdAt).toLocaleString('pt-BR')}
          method={printJob.order.payments[0]?.method as PaymentMethod | undefined}
        />
      )}
    </div>
  );
}
