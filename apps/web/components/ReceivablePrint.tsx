'use client';

import {
  formatCnpj,
  formatOrderNumber,
  formatPhoneBr,
  PAYMENT_METHOD_LABELS,
  RECEIVABLE_STATUS_LABELS,
  type PaymentMethod,
  type ReceivableDetail,
} from '@nexoloja/shared';
import type { Store } from '@/components/ReceiptPrint';

const BRL = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Documento imprimível do RESUMO DE UMA DÍVIDA (conta a receber — ADR-019/022). Espelha o
 * `ReceiptPrint`: fica oculto na tela e só aparece na impressão (regras `@media print` em
 * globals.css, reusa as classes `rc-*`), funcionando em 80mm e A4. Cabeçalho da loja + código da
 * venda de origem (V-000128) + situação (original/recebido/devolvido/saldo) + itens + recebimentos.
 * O nome do PDF (V-000128.pdf) é definido por quem chama `printArea` (ver lib/print.ts).
 */
export function ReceivablePrint({ store, detail }: { store: Store | null; detail: ReceivableDetail }) {
  const returned = Number(detail.returnedAmount ?? 0);
  const code = formatOrderNumber(detail.orderNumber);
  return (
    <div id="print-area" data-model="80mm">
      <header className="rc-head">
        {store?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logoUrl} alt="" className="rc-logo" />
        ) : null}
        <div className="rc-store">{store?.name ?? 'Loja'}</div>
        {store?.cnpj ? <div className="rc-sub">CNPJ: {formatCnpj(store.cnpj)}</div> : null}
        {store?.phone ? <div className="rc-sub">{formatPhoneBr(store.phone)}</div> : null}
      </header>

      <div className="rc-title">RESUMO DA DÍVIDA</div>
      {code ? <div className="rc-code">Venda {code}</div> : null}
      <div className="rc-date">
        {detail.customerName ?? 'Cliente'} ·{' '}
        {new Date(detail.orderCreatedAt ?? detail.createdAt).toLocaleString('pt-BR')}
      </div>

      {/* Situação da dívida. */}
      <div className="rc-pay">
        <div>
          <span>Original</span>
          <span>{BRL(detail.originalAmount)}</span>
        </div>
        <div>
          <span>Recebido</span>
          <span>{BRL(detail.settledAmount)}</span>
        </div>
        {returned > 0 ? (
          <div>
            <span>Devolvido</span>
            <span>{BRL(detail.returnedAmount)}</span>
          </div>
        ) : null}
        <div>
          <span>Situação</span>
          <span>{RECEIVABLE_STATUS_LABELS[detail.status]}</span>
        </div>
        {detail.dueDate ? (
          <div>
            <span>Vencimento</span>
            <span>{new Date(detail.dueDate).toLocaleDateString('pt-BR')}</span>
          </div>
        ) : null}
      </div>

      <div className="rc-total">
        <span>SALDO DEVEDOR</span>
        <span>{BRL(detail.balance)}</span>
      </div>

      {/* Itens da venda que originou a dívida. */}
      <table className="rc-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qtd</th>
            <th className="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it, idx) => (
            <tr key={idx}>
              <td>{it.productName}</td>
              <td className="right">{Number(it.quantity)}</td>
              <td className="right">{BRL(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Recebimentos (com data e forma). */}
      {detail.payments.length > 0 ? (
        <div className="rc-pay">
          <div>
            <span style={{ fontWeight: 700 }}>Recebimentos</span>
            <span />
          </div>
          {detail.payments.map((p) => (
            <div key={p.id}>
              <span>
                {new Date(p.paidAt).toLocaleDateString('pt-BR')} ·{' '}
                {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
              </span>
              <span>{BRL(p.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Devoluções desta venda (ADR-022, Fatia B) — evento próprio. */}
      {(detail.returns ?? []).length > 0 ? (
        <div className="rc-pay">
          <div>
            <span style={{ fontWeight: 700 }}>Devoluções</span>
            <span />
          </div>
          {(detail.returns ?? []).map((rt) => (
            <div key={rt.id}>
              <span>{new Date(rt.createdAt).toLocaleDateString('pt-BR')}</span>
              <span>− {BRL(rt.totalValue)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <footer className="rc-foot">
        Resumo de conta a receber — documento sem valor fiscal.
      </footer>
    </div>
  );
}
