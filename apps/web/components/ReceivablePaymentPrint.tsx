'use client';

import {
  formatCnpj,
  formatOrderNumber,
  formatPhoneBr,
  paymentMethodLabel,
  type ReceivableDetail,
  type ReceivablePaymentRow,
} from '@nexoloja/shared';
import type { Store } from '@/components/ReceiptPrint';

/**
 * **Recibo de UM recebimento de fiado** (uma parcela da conta a receber — ADR-019/022). Diferente do
 * `ReceivablePrint`, que imprime o RESUMO da dívida inteira: aqui o documento é o comprovante de um
 * pagamento específico (o "recibo" que o cliente leva ao pagar). Espelha os demais imprimíveis
 * (oculto na tela, só imprime; classes `rc-*`, 80mm/A4). Mostra a loja, o cliente, a venda de origem,
 * a forma/valor recebidos e o **saldo restante atual** da conta. Sem valor fiscal.
 */

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR');

export function ReceivablePaymentPrint({
  store,
  detail,
  payment,
}: {
  store: Store | null;
  detail: ReceivableDetail;
  payment: ReceivablePaymentRow;
}) {
  const amount = Number(payment.amount);
  const surcharge = Number(payment.surcharge ?? 0);
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

      <div className="rc-title">RECIBO DE PAGAMENTO</div>
      {code ? <div className="rc-code">{code}</div> : null}
      <div className="rc-date">{dt(payment.paidAt)}</div>

      <div className="rc-pay">
        <div>
          <span>Cliente</span>
          <span>{detail.customerName ?? '—'}</span>
        </div>
        <div>
          <span>Forma</span>
          <span>{paymentMethodLabel(payment.method)}</span>
        </div>
        {payment.receivedByName ? (
          <div>
            <span>Recebido por</span>
            <span>{payment.receivedByName}</span>
          </div>
        ) : null}
        {surcharge > 0 ? (
          <div>
            <span>Acréscimo de cartão</span>
            <span>{BRL(surcharge)}</span>
          </div>
        ) : null}
      </div>

      <div className="rc-total">
        <span>RECEBIDO</span>
        <span>{BRL(amount)}</span>
      </div>

      {/* Saldo devedor ATUAL da conta (após os recebimentos já lançados). */}
      <div className="rc-pay">
        <div>
          <span>Saldo restante (atual)</span>
          <span>{BRL(Number(detail.balance))}</span>
        </div>
      </div>

      <footer className="rc-foot">
        Documento sem valor fiscal — recibo de recebimento de conta a prazo.
      </footer>
    </div>
  );
}
