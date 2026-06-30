'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PAYMENT_METHOD_LABELS, cancelOrderSchema, type PaymentMethod } from '@nexoloja/shared';
import { apiGet, apiPost } from '@/lib/api';
import { ReceiptPrint, type Store } from '@/components/ReceiptPrint';

type OrderItem = { id: string; productName: string; quantity: string; unitPrice: string; total: string };
type Payment = { id: string; method: string; amount: string };
type Order = {
  id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'INVOICED' | 'CANCELLED';
  subtotal: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  items: OrderItem[];
  payments: Payment[];
};

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulo da forma de pagamento (cai no código bruto se vier algo fora do enum). */
function methodLabel(m: string): string {
  return PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
}

export default function VendasPage() {
  const [ready, setReady] = useState(false);
  const [caixaOpen, setCaixaOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [printModel, setPrintModel] = useState<'80mm' | 'A4'>('80mm');
  // Job de reimpressão: novo objeto a cada clique força o efeito a disparar de novo.
  const [printJob, setPrintJob] = useState<{ order: Order; key: number } | null>(null);

  async function loadOrders() {
    setOrders(await apiGet<Order[]>('/orders'));
  }

  useEffect(() => {
    (async () => {
      try {
        apiGet<Store>('/tenant').then(setStore).catch(() => {});
        const session = await apiGet<{ id: string } | null>('/cash-sessions/current');
        setCaixaOpen(!!session);
        if (session) await loadOrders();
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

  function abrirCancelamento(id: string) {
    setError(null);
    setReason('');
    setCancelId(id);
  }

  function fecharCancelamento() {
    setCancelId(null);
    setReason('');
    setError(null);
  }

  async function confirmarCancelamento() {
    if (!cancelId) return;
    const parsed = cancelOrderSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setError('Informe o motivo do cancelamento (mín. 3 caracteres).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/orders/${cancelId}/cancel`, parsed.data);
      fecharCancelamento();
      await loadOrders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="text-gray-500">Carregando…</p>;

  if (!caixaOpen) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Histórico de Vendas</h1>
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="mb-3 text-gray-600">
            As vendas listadas aqui são as do caixa aberto. Abra o caixa para ver, reimprimir e cancelar vendas.
          </p>
          <Link
            href="/caixa"
            className="inline-block rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800"
          >
            Ir para o Caixa
          </Link>
        </div>
      </div>
    );
  }

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
      <p className="mb-6 text-sm text-gray-500">
        Vendas do caixa aberto. Reimprima o comprovante ou cancele (estorna o estoque e devolve o valor ao caixa).
      </p>

      {error && !cancelId && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-gray-400 shadow-sm">
            Nenhuma venda neste caixa ainda.
          </div>
        ) : (
          orders.map((o) => {
            const cancelled = o.status === 'CANCELLED';
            const time = new Date(o.createdAt).toLocaleString('pt-BR');
            const methods = [...new Set(o.payments.map((p) => methodLabel(p.method)))].join(', ');
            return (
              <div
                key={o.id}
                className={`rounded-2xl bg-white p-4 shadow-sm ${cancelled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">
                        #{o.id.slice(0, 8)}
                      </span>
                      {cancelled ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Cancelada
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Confirmada
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">{time}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${cancelled ? 'line-through' : ''}`}>
                      {BRL(o.total)}
                    </div>
                    {methods && <div className="text-xs text-gray-500">{methods}</div>}
                  </div>
                </div>

                <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100 pt-2 text-sm">
                  {o.items.map((it) => (
                    <li key={it.id} className="flex justify-between py-1 text-gray-600">
                      <span>
                        {Number(it.quantity)}× {it.productName}
                      </span>
                      <span>{BRL(it.total)}</span>
                    </li>
                  ))}
                </ul>

                {!cancelled && (
                  <>
                    {cancelId === o.id ? (
                      <div className="mt-3 space-y-2 rounded-lg bg-red-50 p-3 ring-1 ring-red-200">
                        <label className="block text-sm font-medium text-red-800">
                          Motivo do cancelamento
                        </label>
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={2}
                          placeholder="Ex.: cliente desistiu, item errado…"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <p className="text-xs text-gray-500">
                          O estoque dos itens volta e o valor é estornado do caixa. Não dá para desfazer.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={fecharCancelamento}
                            disabled={busy}
                            className="rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                          >
                            Voltar
                          </button>
                          <button
                            onClick={confirmarCancelamento}
                            disabled={busy}
                            className="rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            {busy ? 'Cancelando…' : 'Confirmar cancelamento'}
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
                        <button
                          onClick={() => abrirCancelamento(o.id)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                        >
                          Cancelar venda
                        </button>
                      </div>
                    )}
                  </>
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
          items={printJob.order.items.map((i) => ({
            name: i.productName,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
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
