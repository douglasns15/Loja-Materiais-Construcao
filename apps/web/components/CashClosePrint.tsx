'use client';

import { formatCnpj, formatPhoneBr, CASH_MOVEMENT_KIND_LABELS, type CashMovementKind } from '@nexoloja/shared';
import type { Store } from '@/components/ReceiptPrint';

/**
 * Comprovante imprimível do **fechamento de caixa** (resumo do turno). Espelha o `ReceiptPrint`:
 * fica oculto na tela e só aparece na impressão (regras `@media print` em globals.css, reusa as
 * classes `rc-*`), servindo em 80mm e A4. Cabeçalho da loja + operador/horários + a mini-DRE do
 * caixa (abertura, vendas em dinheiro, suprimentos, saídas, esperado), o valor CONTADO e a
 * DIVERGÊNCIA. Opcionalmente itemiza as movimentações do turno. Sem valor fiscal.
 */

const BRL = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/** Uma movimentação do turno, para a itemização opcional. */
export type CashCloseMovement = {
  kind: CashMovementKind;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  reason: string | null;
  at: string;
};

/** Dados do fechamento montados pela tela do Caixa no momento do fechamento. */
export type CashCloseReceiptData = {
  openedAt: string;
  closedAt: string;
  openedByName: string | null;
  closedByName: string | null;
  openingAmount: number;
  cashInflow: number;
  movementsIn: number;
  movementsOut: number;
  expectedAmount: number;
  countedAmount: number;
  /** contado − esperado (>0 sobra, <0 falta, 0 confere). */
  divergence: number;
  notes?: string | null;
  /** Movimentações do turno (suprimentos/sangrias/etc.) para itemizar; opcional. */
  movements?: CashCloseMovement[];
};

export function CashClosePrint({ store, data }: { store: Store | null; data: CashCloseReceiptData }) {
  const diff = data.divergence;
  const items = data.movements ?? [];
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

      <div className="rc-title">FECHAMENTO DE CAIXA</div>
      <div className="rc-date">Fechado em {dt(data.closedAt)}</div>
      <div className="rc-date">Aberto em {dt(data.openedAt)}</div>

      {/* Operador(es) do turno — quem abriu e quem fechou. */}
      <div className="rc-pay">
        {data.openedByName ? (
          <div>
            <span>Aberto por</span>
            <span>{data.openedByName}</span>
          </div>
        ) : null}
        {data.closedByName ? (
          <div>
            <span>Fechado por</span>
            <span>{data.closedByName}</span>
          </div>
        ) : null}
      </div>

      {/* Mini-DRE do caixa: abertura + o que entrou − o que saiu = esperado. */}
      <div className="rc-pay">
        <div>
          <span>Valor de abertura</span>
          <span>{BRL(data.openingAmount)}</span>
        </div>
        <div>
          <span>+ Vendas em dinheiro</span>
          <span>{BRL(data.cashInflow)}</span>
        </div>
        {data.movementsIn > 0 ? (
          <div>
            <span>+ Suprimentos</span>
            <span>{BRL(data.movementsIn)}</span>
          </div>
        ) : null}
        {data.movementsOut > 0 ? (
          <div>
            <span>− Devoluções / saídas</span>
            <span>− {BRL(data.movementsOut)}</span>
          </div>
        ) : null}
      </div>

      <div className="rc-total">
        <span>ESPERADO</span>
        <span>{BRL(data.expectedAmount)}</span>
      </div>
      <div className="rc-total">
        <span>CONTADO</span>
        <span>{BRL(data.countedAmount)}</span>
      </div>

      {/* Divergência do fechamento: confere / sobra / falta. */}
      <div className="rc-total">
        <span>{diff === 0 ? 'CONFERE' : diff > 0 ? 'SOBRA' : 'FALTA'}</span>
        <span>{diff === 0 ? BRL(0) : `${diff > 0 ? '+' : '−'} ${BRL(Math.abs(diff))}`}</span>
      </div>

      {/* Itemização opcional das movimentações do turno (reusa o bloco de "situação"). */}
      {items.length > 0 ? (
        <div className="rc-pickup">
          <div className="rc-pickup-head">MOVIMENTAÇÕES DO TURNO</div>
          {items.map((m, idx) => (
            <div className="rc-pickup-row" key={idx}>
              <span className="rc-pickup-name">
                {CASH_MOVEMENT_KIND_LABELS[m.kind]}
                {m.reason ? ` — ${m.reason}` : ''}
              </span>
              <span className="rc-pickup-qty">
                {m.type === 'EXPENSE' ? '− ' : '+ '}
                {BRL(m.amount)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {data.notes ? (
        <div className="rc-pay">
          <div>
            <span>Observações</span>
            <span>{data.notes}</span>
          </div>
        </div>
      ) : null}

      <footer className="rc-foot">Documento sem valor fiscal — conferência interna de caixa.</footer>
    </div>
  );
}
