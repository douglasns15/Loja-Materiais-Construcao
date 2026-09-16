/**
 * Carry da TROCA (ADR-033, Fatia 3 revisada) do Histórico para o PDV. Espelha o `lib/reorder.ts`,
 * mas agora carrega apenas a INTENÇÃO da devolução — NADA é gravado no servidor ao clicar "Ir para a
 * troca". A tela de Vendas guarda os itens escolhidos + o valor do vale (calculado localmente) no
 * sessionStorage e navega para `/venda`; o PDV lê UMA vez, mostra o banner, abate o vale do "a pagar"
 * e, ao CONCLUIR a venda, envia `exchangeReturn` (fromOrderId + itens + motivo). O servidor executa a
 * devolução e a nova venda na MESMA transação. Se o operador cancelar a troca ou atualizar a página,
 * nada foi gravado — o estoque fica intacto (era o bug: a devolução era gravada adiantada).
 * sessionStorage (não local): é um repasse de navegação, não deve sobreviver a fechar a aba nem
 * vazar entre dispositivos.
 */
const KEY = 'nexoloja:exchange';

/** Um item escolhido para a troca — na unidade VENDIDA (o servidor converte p/ base e revalida). */
export type ExchangeItem = {
  orderItemId: string;
  quantity: number;
  condition?: 'GOOD' | 'DEFECTIVE';
};

export type ExchangePayload = {
  fromOrderId: string; // venda de origem — o servidor devolve estes itens ao concluir a troca
  fromOrderNumber: number; // V-000XXX da venda de origem (p/ o banner)
  credit: number; // valor do vale (em R$) calculado no Histórico p/ o banner + trava total ≥ vale
  reason: string; // motivo da devolução (obrigatório)
  items: ExchangeItem[]; // itens/condições a devolver, enviados ao concluir a venda
};

export function writeExchangePayload(payload: ExchangePayload): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage indisponível (aba privada/limitada): a troca simplesmente não acontece.
  }
}

/** Lê e REMOVE o vale pendente (consumo único, como o reorder). */
export function takeExchangePayload(): ExchangePayload | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const p = JSON.parse(raw) as ExchangePayload;
    if (
      !p ||
      typeof p.fromOrderId !== 'string' ||
      typeof p.credit !== 'number' ||
      !Array.isArray(p.items) ||
      p.items.length === 0
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}
