'use client';

import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@nexoloja/shared';

export type Store = {
  name: string;
  logoUrl: string | null;
  cnpj: string | null;
  phone: string | null;
};

export type ReceiptItem = { name: string; quantity: number; unitPrice: number };

type Props = {
  kind: 'sale' | 'quote';
  store: Store | null;
  items: ReceiptItem[];
  total: number;
  date: string;
  method?: PaymentMethod;
  change?: number;
};

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Documento imprimível (comprovante de venda OU orçamento). Fica oculto na tela
 * e só aparece na impressão (ver regras @media print em globals.css). O modelo
 * (80mm / A4) é controlado pelo atributo data-model, definido antes de imprimir.
 */
export function ReceiptPrint({ kind, store, items, total, date, method, change }: Props) {
  const isQuote = kind === 'quote';
  return (
    <div id="print-area" data-model="80mm">
      <header className="rc-head">
        {store?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logoUrl} alt="" className="rc-logo" />
        ) : null}
        <div className="rc-store">{store?.name ?? 'Loja'}</div>
        {store?.cnpj ? <div className="rc-sub">CNPJ: {store.cnpj}</div> : null}
        {store?.phone ? <div className="rc-sub">{store.phone}</div> : null}
      </header>

      <div className={`rc-title ${isQuote ? 'quote' : ''}`}>
        {isQuote ? 'ORÇAMENTO' : 'COMPROVANTE DE VENDA'}
      </div>
      <div className="rc-date">{date}</div>

      <table className="rc-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="right">Qtd</th>
            <th className="right">Unit.</th>
            <th className="right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={idx}>
              <td>{i.name}</td>
              <td className="right">{i.quantity}</td>
              <td className="right">{BRL(i.unitPrice)}</td>
              <td className="right">{BRL(i.unitPrice * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rc-total">
        <span>TOTAL</span>
        <span>{BRL(total)}</span>
      </div>

      {!isQuote && method ? (
        <div className="rc-pay">
          <div>
            <span>Pagamento</span>
            <span>{PAYMENT_METHOD_LABELS[method]}</span>
          </div>
          {change && change > 0 ? (
            <div>
              <span>Troco</span>
              <span>{BRL(change)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="rc-foot">
        {isQuote
          ? 'Este documento é um ORÇAMENTO — não é documento fiscal. Valores sujeitos a alteração.'
          : 'Documento sem valor fiscal.'}
      </footer>
    </div>
  );
}
