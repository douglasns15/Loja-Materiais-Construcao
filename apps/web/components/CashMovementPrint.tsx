'use client';

import { formatCnpj, formatPhoneBr, CASH_MOVEMENT_KIND_LABELS, type CashMovementKind } from '@nexoloja/shared';
import type { Store } from '@/components/ReceiptPrint';

/**
 * Comprovante imprimível de uma **movimentação de caixa** (suprimento/sangria/devolução/despesa —
 * ADR-006). Espelha o `ReceiptPrint` (oculto na tela, só imprime; classes `rc-*`, 80mm/A4). Serve
 * para justificar uma retirada/entrada de dinheiro no turno: natureza, valor, motivo, autor e hora.
 * Sem valor fiscal.
 */

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Dados de uma movimentação para o comprovante (montados pela tela do Caixa). */
export type CashMovementReceiptData = {
  kind: CashMovementKind;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  reason: string | null;
  at: string;
  byName: string | null;
  /** Abertura do caixa a que pertence (identifica o turno no papel). */
  sessionOpenedAt?: string | null;
};

export function CashMovementPrint({
  store,
  data,
}: {
  store: Store | null;
  data: CashMovementReceiptData;
}) {
  const isOut = data.type === 'EXPENSE';
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

      <div className="rc-title">COMPROVANTE DE {CASH_MOVEMENT_KIND_LABELS[data.kind].toUpperCase()}</div>
      <div className="rc-date">{dt(data.at)}</div>
      {data.sessionOpenedAt ? (
        <div className="rc-date">Caixa aberto em {dt(data.sessionOpenedAt)}</div>
      ) : null}

      {/* Valor da movimentação em destaque (sinal contábil: saída negativa). */}
      <div className="rc-total">
        <span>{isOut ? 'SAÍDA' : 'ENTRADA'}</span>
        <span>
          {isOut ? '− ' : '+ '}
          {BRL(data.amount)}
        </span>
      </div>

      <div className="rc-pay">
        <div>
          <span>Natureza</span>
          <span>{CASH_MOVEMENT_KIND_LABELS[data.kind]}</span>
        </div>
        {data.reason ? (
          <div>
            <span>Motivo</span>
            <span>{data.reason}</span>
          </div>
        ) : null}
        {data.byName ? (
          <div>
            <span>Responsável</span>
            <span>{data.byName}</span>
          </div>
        ) : null}
      </div>

      {/* Linha para assinatura de quem recebeu/retirou o dinheiro (uso operacional). */}
      <div className="rc-pickup">
        <div className="rc-pickup-row">
          <span className="rc-pickup-name">Assinatura</span>
          <span className="rc-pickup-qty">______________________</span>
        </div>
      </div>

      <footer className="rc-foot">Documento sem valor fiscal — controle interno de caixa.</footer>
    </div>
  );
}
