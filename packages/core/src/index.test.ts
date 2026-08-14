import { describe, expect, it } from 'vitest';
import {
  applyStockMovement,
  calcAdjustedCashClosing,
  calcCashDivergence,
  calcExpectedCash,
  calcInventoryAdjustment,
  isLowStock,
  needsReplenishment,
  replenishmentShortfall,
  calcMarginPercent,
  markupPercent,
  salePriceFromMarkup,
  salePriceFromMargin,
  repriceHoldingMarkup,
  calcOrderTotal,
  calcSaleItemTotal,
  calcSaleTotals,
  calcSubtotal,
  reconcileStock,
  calcAverageTicket,
  withPaymentShare,
  netCashMovements,
  grossCashMovements,
  manualCashMovementType,
  reversalKindFor,
  receivableBalance,
  isValidReceipt,
  applyReceivablePayment,
  creditSaleBalances,
  maxStoreCreditForSale,
  customerAccountBalance,
  distributeAccountPayment,
  returnableBaseQty,
  isValidPartialReturn,
  applyItemReturn,
  splitReturnValue,
  applyReceivableReturn,
  sumCashCount,
  paymentStatus,
  BRL_COIN_VALUES,
  BRL_BILL_VALUES,
  classifyHttpOutcome,
  classifyNetworkError,
  shouldRetry,
  syncBackoffMs,
  haltsQueue,
  MAX_SYNC_ATTEMPTS,
  normalizeSearchText,
  productMatchesQuery,
  hasAltUnit,
  resolveSaleUnit,
  toBaseQuantity,
  effectiveBaseUnitPrice,
  splitPairPrice,
  splitPairLine,
  hasPair,
  pairAvailableQty,
  groupPairedItems,
  availableQty,
  remainingToDeliver,
  isValidDelivery,
  applyItemDelivery,
  orderFulfillmentStatus,
  reconcileReserved,
} from './index';

describe('calcSubtotal', () => {
  it('soma os totais das linhas', () => {
    expect(calcSubtotal([{ total: 10 }, { total: 5.5 }])).toBe(15.5);
  });

  it('retorna 0 para pedido vazio', () => {
    expect(calcSubtotal([])).toBe(0);
  });
});

describe('calcOrderTotal', () => {
  it('aplica desconto e frete sobre o subtotal', () => {
    expect(
      calcOrderTotal({ subtotal: 100, discountAmount: 10, freightAmount: 25 }),
    ).toBe(115);
  });

  it('usa 0 como padrão para desconto e frete', () => {
    expect(calcOrderTotal({ subtotal: 100 })).toBe(100);
  });
});

describe('calcMarginPercent', () => {
  it('calcula a margem sobre o preço de venda', () => {
    expect(calcMarginPercent(60, 100)).toBe(40);
  });

  it('retorna 0 quando o preço de venda é 0', () => {
    expect(calcMarginPercent(60, 0)).toBe(0);
  });

  it('aceita margem negativa (venda abaixo do custo)', () => {
    expect(calcMarginPercent(120, 100)).toBe(-20);
  });

  it('arredonda a 2 casas', () => {
    expect(calcMarginPercent(10, 30)).toBe(66.67);
  });
});

describe('esteira de precificação (markup × margem × preço)', () => {
  describe('markupPercent', () => {
    it('calcula o lucro sobre o custo', () => {
      // custo 60, venda 100 → 40 de lucro sobre 60 = 66,67%
      expect(markupPercent(60, 100)).toBe(66.67);
    });

    it('retorna 0 quando o custo é 0 (sem base para markup)', () => {
      expect(markupPercent(0, 100)).toBe(0);
    });

    it('aceita markup negativo (venda abaixo do custo)', () => {
      expect(markupPercent(100, 80)).toBe(-20);
    });
  });

  describe('salePriceFromMarkup', () => {
    it('aplica o markup sobre o custo', () => {
      expect(salePriceFromMarkup(60, 66.67)).toBe(100);
    });

    it('markup 0 devolve o próprio custo', () => {
      expect(salePriceFromMarkup(37, 0)).toBe(37);
    });

    it('arredonda o preço a 2 casas', () => {
      // 25 × 1,3243 = 33,1075 → 33,11
      expect(salePriceFromMarkup(25, 32.43)).toBe(33.11);
    });
  });

  describe('salePriceFromMargin', () => {
    it('resolve o preço para uma margem sobre a venda', () => {
      // margem 40% ⇒ 60 / 0,6 = 100
      expect(salePriceFromMargin(60, 40)).toBe(100);
    });

    it('margem 0 devolve o próprio custo', () => {
      expect(salePriceFromMargin(37, 0)).toBe(37);
    });

    it('margem >= 100 é impossível ⇒ 0 (a UI trava antes)', () => {
      expect(salePriceFromMargin(60, 100)).toBe(0);
      expect(salePriceFromMargin(60, 150)).toBe(0);
    });
  });

  describe('repriceHoldingMarkup', () => {
    it('escala o preço na proporção do custo (preserva markup/margem)', () => {
      // custo 60→66 (+10%), preço 100 → 110; markup segue 66,67%
      const p = repriceHoldingMarkup(60, 100, 66);
      expect(p).toBe(110);
      expect(markupPercent(66, p)).toBe(66.67);
    });

    it('mantém o preço quando o custo antigo era 0 (nada a preservar)', () => {
      expect(repriceHoldingMarkup(0, 50, 30)).toBe(50);
    });
  });

  describe('ida e volta (o que garante a esteira sem loop)', () => {
    it('preço → markup → preço é idempotente no centavo', () => {
      const cost = 25;
      const price = 37;
      const m = markupPercent(cost, price); // 48
      expect(salePriceFromMarkup(cost, m)).toBe(price);
    });

    it('preço → margem → preço é idempotente no centavo', () => {
      const cost = 25;
      const price = 37;
      const g = calcMarginPercent(cost, price); // 32,43
      expect(salePriceFromMargin(cost, g)).toBe(price);
    });
  });
});

describe('calcExpectedCash', () => {
  it('soma abertura + entradas em dinheiro', () => {
    expect(calcExpectedCash(100, [50, 25.5])).toBe(175.5);
  });

  it('retorna a abertura quando não há entradas', () => {
    expect(calcExpectedCash(100, [])).toBe(100);
  });
});

describe('calcCashDivergence', () => {
  it('zero quando o contado bate com o esperado', () => {
    expect(calcCashDivergence(175.5, 175.5)).toBe(0);
  });

  it('positivo quando sobra dinheiro', () => {
    expect(calcCashDivergence(175.5, 180)).toBe(4.5);
  });

  it('negativo quando falta dinheiro', () => {
    expect(calcCashDivergence(175.5, 170)).toBe(-5.5);
  });
});

describe('calcAdjustedCashClosing', () => {
  it('sem vendas tardias, o ajuste repete o fechamento original', () => {
    expect(calcAdjustedCashClosing(893.2, 893.2, 0)).toEqual({
      adjustedExpected: 893.2,
      adjustedDivergence: 0,
    });
  });

  it('soma a parcela em dinheiro da venda tardia ao esperado (caso 3.F.CS-4)', () => {
    // Caixa 8bda91ce: esperado R$893,20 + venda tardia CASH R$370 = R$1.263,20.
    expect(calcAdjustedCashClosing(893.2, 1263.2, 370)).toEqual({
      adjustedExpected: 1263.2,
      adjustedDivergence: 0,
    });
  });

  it('a divergência ajustada revela a falta quando o contado não cobre as vendas tardias', () => {
    expect(calcAdjustedCashClosing(893.2, 893.2, 370)).toEqual({
      adjustedExpected: 1263.2,
      adjustedDivergence: -370,
    });
  });

  it('arredonda a 2 casas', () => {
    expect(calcAdjustedCashClosing(100.1, 130.2, 30.05)).toEqual({
      adjustedExpected: 130.15,
      adjustedDivergence: 0.05,
    });
  });
});

describe('calcSaleItemTotal', () => {
  it('quantidade × preço − desconto', () => {
    expect(calcSaleItemTotal({ quantity: 3, unitPrice: 10, discount: 5 })).toBe(25);
  });

  it('sem desconto', () => {
    expect(calcSaleItemTotal({ quantity: 2.5, unitPrice: 4 })).toBe(10);
  });
});

describe('calcSaleTotals', () => {
  it('subtotal e total com desconto e frete', () => {
    const r = calcSaleTotals(
      [
        { quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 5 },
      ],
      { discountAmount: 3, freightAmount: 8 },
    );
    expect(r.subtotal).toBe(25);
    expect(r.total).toBe(30);
  });

  it('total = subtotal quando sem desconto/frete', () => {
    const r = calcSaleTotals([{ quantity: 4, unitPrice: 2.5 }]);
    expect(r.subtotal).toBe(10);
    expect(r.total).toBe(10);
  });
});

describe('applyStockMovement', () => {
  it('INCOME soma ao estoque atual', () => {
    expect(applyStockMovement(10, 'INCOME', 5)).toBe(15);
  });

  it('EXPENSE subtrai do estoque atual', () => {
    expect(applyStockMovement(10, 'EXPENSE', 4)).toBe(6);
  });

  it('mantém a precisão de 4 casas (unidades fracionadas)', () => {
    expect(applyStockMovement(2.5, 'INCOME', 0.125)).toBe(2.625);
  });
});

describe('reconcileStock', () => {
  it('saldo = Σ INCOME − Σ EXPENSE (ADR-001)', () => {
    expect(
      reconcileStock([
        { type: 'INCOME', quantity: 100 },
        { type: 'EXPENSE', quantity: 30 },
        { type: 'EXPENSE', quantity: 4 },
      ]),
    ).toBe(66);
  });

  it('retorna 0 quando não há movimentações', () => {
    expect(reconcileStock([])).toBe(0);
  });
});

describe('calcInventoryAdjustment', () => {
  it('contagem menor → EXPENSE da diferença', () => {
    expect(calcInventoryAdjustment(10, 7)).toEqual({ type: 'EXPENSE', quantity: 3 });
  });

  it('contagem maior → INCOME da diferença', () => {
    expect(calcInventoryAdjustment(10, 12)).toEqual({ type: 'INCOME', quantity: 2 });
  });

  it('contagem igual → quantidade 0 (nada a fazer)', () => {
    expect(calcInventoryAdjustment(10, 10)).toEqual({ type: 'INCOME', quantity: 0 });
  });
});

describe('isLowStock', () => {
  it('saldo abaixo do mínimo → baixo', () => {
    expect(isLowStock({ stockQty: 3, minStockQty: 10 })).toBe(true);
  });

  it('saldo igual ao mínimo → baixo (ponto de reposição)', () => {
    expect(isLowStock({ stockQty: 10, minStockQty: 10 })).toBe(true);
  });

  it('saldo acima do mínimo → ok', () => {
    expect(isLowStock({ stockQty: 11, minStockQty: 10 })).toBe(false);
  });

  it('sem mínimo definido (0) → nunca baixo, mesmo zerado', () => {
    expect(isLowStock({ stockQty: 0, minStockQty: 0 })).toBe(false);
  });

  it('zerado com mínimo definido → baixo', () => {
    expect(isLowStock({ stockQty: 0, minStockQty: 5 })).toBe(true);
  });
});

describe('needsReplenishment', () => {
  it('zerado SEM mínimo → precisa repor (ruptura, mesmo sem mínimo cadastrado)', () => {
    expect(needsReplenishment({ stockQty: 0, minStockQty: 0 })).toBe(true);
  });

  it('zerado COM mínimo → precisa repor', () => {
    expect(needsReplenishment({ stockQty: 0, minStockQty: 5 })).toBe(true);
  });

  it('baixo (abaixo do mínimo, mas positivo) → precisa repor', () => {
    expect(needsReplenishment({ stockQty: 3, minStockQty: 10 })).toBe(true);
  });

  it('saldo positivo sem mínimo → ok (não precisa repor)', () => {
    expect(needsReplenishment({ stockQty: 4, minStockQty: 0 })).toBe(false);
  });

  it('saldo acima do mínimo → ok', () => {
    expect(needsReplenishment({ stockQty: 11, minStockQty: 10 })).toBe(false);
  });

  it('saldo negativo → precisa repor (defensivo)', () => {
    expect(needsReplenishment({ stockQty: -2, minStockQty: 0 })).toBe(true);
  });
});

describe('replenishmentShortfall', () => {
  it('sugere a diferença até o mínimo', () => {
    expect(replenishmentShortfall({ stockQty: 3, minStockQty: 10 })).toBe(7);
  });

  it('zerado → repõe o mínimo inteiro', () => {
    expect(replenishmentShortfall({ stockQty: 0, minStockQty: 5 })).toBe(5);
  });

  it('não está baixo → 0 (nada a repor)', () => {
    expect(replenishmentShortfall({ stockQty: 11, minStockQty: 10 })).toBe(0);
  });

  it('sem mínimo (0) → 0', () => {
    expect(replenishmentShortfall({ stockQty: 0, minStockQty: 0 })).toBe(0);
  });

  it('mantém precisão fracionada (kg/m²)', () => {
    expect(replenishmentShortfall({ stockQty: 2.5, minStockQty: 10 })).toBe(7.5);
  });
});

describe('calcAverageTicket', () => {
  it('faturamento ÷ nº de vendas', () => {
    expect(calcAverageTicket(300, 4)).toBe(75);
  });

  it('arredonda a 2 casas', () => {
    expect(calcAverageTicket(100, 3)).toBe(33.33);
  });

  it('retorna 0 quando não há vendas (sem divisão por zero)', () => {
    expect(calcAverageTicket(0, 0)).toBe(0);
  });
});

describe('netCashMovements', () => {
  it('saldo líquido = Σ INCOME − Σ EXPENSE', () => {
    expect(
      netCashMovements([
        { type: 'INCOME', amount: 50 }, // suprimento
        { type: 'EXPENSE', amount: 30 }, // sangria
        { type: 'EXPENSE', amount: 74 }, // devolução
      ]),
    ).toBe(-54);
  });

  it('só devolução (saída) reduz o esperado', () => {
    expect(netCashMovements([{ type: 'EXPENSE', amount: 74 }])).toBe(-74);
  });

  it('sem movimentações → 0', () => {
    expect(netCashMovements([])).toBe(0);
  });

  it('combina com calcExpectedCash (abertura + vendas + movimentações)', () => {
    const net = netCashMovements([{ type: 'EXPENSE', amount: 74 }]);
    // abertura 100 + vendas 74 + devolução -74 = 100
    expect(calcExpectedCash(100, [74, net])).toBe(100);
  });
});

describe('grossCashMovements', () => {
  it('separa Σ INCOME (suprimentos) de Σ EXPENSE (devoluções/sangrias)', () => {
    expect(
      grossCashMovements([
        { type: 'INCOME', amount: 50 }, // suprimento
        { type: 'EXPENSE', amount: 30 }, // sangria
        { type: 'EXPENSE', amount: 74 }, // devolução
      ]),
    ).toEqual({ income: 50, expense: 104 });
  });

  it('sem movimentações → tudo zero', () => {
    expect(grossCashMovements([])).toEqual({ income: 0, expense: 0 });
  });

  it('income − expense reconstrói netCashMovements', () => {
    const ms = [
      { type: 'INCOME' as const, amount: 50 },
      { type: 'EXPENSE' as const, amount: 74 },
    ];
    const { income, expense } = grossCashMovements(ms);
    expect(Number((income - expense).toFixed(2))).toBe(netCashMovements(ms));
  });
});

describe('manualCashMovementType', () => {
  it('Suprimento entra (INCOME)', () => {
    expect(manualCashMovementType('SUPPLY')).toBe('INCOME');
  });

  it('Sangria sai (EXPENSE)', () => {
    expect(manualCashMovementType('WITHDRAWAL')).toBe('EXPENSE');
  });

  it('o sinal alimenta netCashMovements coerentemente (suprimento soma, sangria subtrai)', () => {
    const ms = [
      { type: manualCashMovementType('SUPPLY'), amount: 100 },
      { type: manualCashMovementType('WITHDRAWAL'), amount: 40 },
    ];
    expect(netCashMovements(ms)).toBe(60);
  });
});

describe('reversalKindFor', () => {
  it('estorno de Suprimento é uma Sangria (inverte o kind)', () => {
    expect(reversalKindFor('SUPPLY')).toBe('WITHDRAWAL');
  });

  it('estorno de Sangria é um Suprimento (inverte o kind)', () => {
    expect(reversalKindFor('WITHDRAWAL')).toBe('SUPPLY');
  });

  it('é uma involução: estornar o estorno volta ao kind original', () => {
    expect(reversalKindFor(reversalKindFor('SUPPLY'))).toBe('SUPPLY');
    expect(reversalKindFor(reversalKindFor('WITHDRAWAL'))).toBe('WITHDRAWAL');
  });

  it('o estorno tem o sinal contábil OPOSTO ao original (garante que zera o caixa)', () => {
    for (const kind of ['SUPPLY', 'WITHDRAWAL'] as const) {
      const original = manualCashMovementType(kind);
      const reversal = manualCashMovementType(reversalKindFor(kind));
      expect(reversal).not.toBe(original);
      // Original −X e estorno +X (ou vice-versa) → líquido zero no caixa.
      expect(netCashMovements([
        { type: original, amount: 100 },
        { type: reversal, amount: 100 },
      ])).toBe(0);
    }
  });
});

describe('receivableBalance / isValidReceipt / applyReceivablePayment (fiado — ADR-019)', () => {
  it('saldo devedor = original − recebido, nunca negativo', () => {
    expect(receivableBalance(100, 0)).toBe(100);
    expect(receivableBalance(100, 30)).toBe(70);
    expect(receivableBalance(100, 100)).toBe(0);
    expect(receivableBalance(100, 120)).toBe(0); // recebeu mais que devia (guarda) → 0
  });

  it('saldo devedor sem erro de float', () => {
    // 0,10 + 0,20 = 0,30 → deve dar 0, não 0,00000000004
    expect(receivableBalance(0.3, 0.1 + 0.2)).toBe(0);
  });

  it('recebimento válido: positivo e ≤ saldo', () => {
    expect(isValidReceipt(50, 100)).toBe(true);
    expect(isValidReceipt(100, 100)).toBe(true); // quitar exato
    expect(isValidReceipt(0, 100)).toBe(false); // zero não recebe
    expect(isValidReceipt(-10, 100)).toBe(false); // negativo não recebe
    expect(isValidReceipt(100.01, 100)).toBe(false); // acima do saldo
  });

  it('recebimento parcial mantém OPEN e acumula', () => {
    const r = applyReceivablePayment(100, 0, 40);
    expect(r.settledAmount).toBe(40);
    expect(r.status).toBe('OPEN');
    expect(r.fullyPaid).toBe(false);
  });

  it('recebimento que alcança o total quita (PAID)', () => {
    const r = applyReceivablePayment(100, 60, 40);
    expect(r.settledAmount).toBe(100);
    expect(r.status).toBe('PAID');
    expect(r.fullyPaid).toBe(true);
  });

  it('sequência parcial → parcial → quitação', () => {
    let settled = 0;
    ({ settledAmount: settled } = applyReceivablePayment(150, settled, 50)); // 50
    expect(receivableBalance(150, settled)).toBe(100);
    ({ settledAmount: settled } = applyReceivablePayment(150, settled, 50)); // 100
    expect(receivableBalance(150, settled)).toBe(50);
    const last = applyReceivablePayment(150, settled, 50); // 150
    expect(last.status).toBe('PAID');
    expect(receivableBalance(150, last.settledAmount)).toBe(0);
  });
});

describe('creditSaleBalances (venda a prazo — ADR-019)', () => {
  it('entrada + a prazo devem fechar o total', () => {
    expect(creditSaleBalances(100, 0, 100)).toBe(true); // fiado 100%
    expect(creditSaleBalances(100, 40, 60)).toBe(true); // entrada 40 + 60 a prazo
    expect(creditSaleBalances(100, 100, 0)).toBe(true); // à vista comum
  });

  it('recusa quando não fecha o total', () => {
    expect(creditSaleBalances(100, 40, 50)).toBe(false); // falta 10
    expect(creditSaleBalances(100, 40, 70)).toBe(false); // sobra 10
  });

  it('tolera 1 centavo de arredondamento', () => {
    expect(creditSaleBalances(100, 33.33, 66.67)).toBe(true);
  });
});

describe('maxStoreCreditForSale (usar crédito da loja — ADR-022, Fatia C)', () => {
  it('limita ao saldo de crédito quando ele é o menor', () => {
    expect(maxStoreCreditForSale(100, 0, 30)).toBe(30); // saldo 30 < total 100
  });

  it('limita ao que resta a pagar agora (total − a prazo) quando o crédito sobra', () => {
    expect(maxStoreCreditForSale(100, 0, 500)).toBe(100); // não passa do total
    expect(maxStoreCreditForSale(100, 40, 500)).toBe(60); // 40 a prazo ⇒ resta 60 a pagar
  });

  it('nunca negativo (a prazo ≥ total ⇒ 0)', () => {
    expect(maxStoreCreditForSale(100, 100, 50)).toBe(0);
    expect(maxStoreCreditForSale(100, 0, -5)).toBe(0);
  });

  it('sem erro de float (centavos)', () => {
    expect(maxStoreCreditForSale(0.3, 0.1, 1)).toBe(0.2);
  });
});

describe('customerAccountBalance / distributeAccountPayment (conta do cliente — ADR-022)', () => {
  it('saldo da conta = soma dos saldos devedores em aberto', () => {
    expect(customerAccountBalance([{ id: 'a', balance: 100 }, { id: 'b', balance: 50 }])).toBe(150);
    expect(customerAccountBalance([])).toBe(0);
  });

  it('soma sem erro de ponto flutuante (centavos)', () => {
    expect(customerAccountBalance([{ id: 'a', balance: 0.1 }, { id: 'b', balance: 0.2 }])).toBe(0.3);
  });

  it('FIFO: abate a dívida mais antiga primeiro', () => {
    const recs = [{ id: 'velha', balance: 30 }, { id: 'nova', balance: 80 }];
    // Recebe 50 → quita a velha (30) e abate 20 da nova.
    expect(distributeAccountPayment(50, recs)).toEqual([
      { receivableId: 'velha', amount: 30 },
      { receivableId: 'nova', amount: 20 },
    ]);
  });

  it('recebimento menor que a 1ª dívida cai só nela', () => {
    const recs = [{ id: 'a', balance: 30 }, { id: 'b', balance: 80 }];
    expect(distributeAccountPayment(20, recs)).toEqual([{ receivableId: 'a', amount: 20 }]);
  });

  it('recebe a conta inteira quita todas', () => {
    const recs = [{ id: 'a', balance: 30 }, { id: 'b', balance: 80 }];
    expect(distributeAccountPayment(110, recs)).toEqual([
      { receivableId: 'a', amount: 30 },
      { receivableId: 'b', amount: 80 },
    ]);
  });

  it('pula dívidas com saldo zero e para quando o valor esgota', () => {
    const recs = [{ id: 'quitada', balance: 0 }, { id: 'a', balance: 40 }, { id: 'b', balance: 40 }];
    expect(distributeAccountPayment(40, recs)).toEqual([{ receivableId: 'a', amount: 40 }]);
  });

  it('distribui em centavos sem estourar (arredondamento)', () => {
    const recs = [{ id: 'a', balance: 33.33 }, { id: 'b', balance: 66.67 }];
    const alloc = distributeAccountPayment(100, recs);
    expect(alloc.reduce((s, a) => s + a.amount, 0)).toBe(100);
  });
});

describe('devolução/troca por item + crédito (ADR-022 Fatia B)', () => {
  it('returnableBaseQty: base − já devolvido, nunca negativo', () => {
    expect(returnableBaseQty(10, 0)).toBe(10);
    expect(returnableBaseQty(10, 4)).toBe(6);
    expect(returnableBaseQty(10, 10)).toBe(0);
    expect(returnableBaseQty(10, 12)).toBe(0);
  });

  it('isValidPartialReturn: positiva e ≤ devolvível', () => {
    expect(isValidPartialReturn(3, 6)).toBe(true);
    expect(isValidPartialReturn(6, 6)).toBe(true); // devolver o resto exato
    expect(isValidPartialReturn(0, 6)).toBe(false);
    expect(isValidPartialReturn(-1, 6)).toBe(false);
    expect(isValidPartialReturn(6.5, 6)).toBe(false); // além do devolvível
  });

  it('applyItemReturn: acumula e marca linha completa', () => {
    const a = applyItemReturn(10, 0, 4);
    expect(a).toEqual({ returnedBaseQty: 4, fullyReturned: false });
    const b = applyItemReturn(10, 4, 6);
    expect(b).toEqual({ returnedBaseQty: 10, fullyReturned: true });
  });

  it('splitReturnValue: abate a dívida primeiro, resto é excedente', () => {
    // Venda a prazo com R$ 40 de saldo devedor; devolve R$ 30 → abate 30, excedente 0.
    expect(splitReturnValue(30, 40)).toEqual({ abated: 30, excess: 0 });
    // Devolve R$ 50 numa dívida de 40 → abate 40, excedente 10 (crédito/dinheiro).
    expect(splitReturnValue(50, 40)).toEqual({ abated: 40, excess: 10 });
    // Venda à vista (saldo devedor 0) → tudo é excedente.
    expect(splitReturnValue(25, 0)).toEqual({ abated: 0, excess: 25 });
  });

  it('splitReturnValue: soma abatido + excedente = valor (centavos)', () => {
    const { abated, excess } = splitReturnValue(33.33, 20);
    expect(Number((abated + excess).toFixed(2))).toBe(33.33);
  });

  it('applyReceivableReturn: quita quando recebido + devolvido alcança o original', () => {
    // Dívida 100, recebido 0, devolvido 0; abate 100 por devolução → quitada.
    expect(applyReceivableReturn(100, 0, 0, 100)).toEqual({
      returnedAmount: 100,
      status: 'PAID',
      fullySettled: true,
    });
    // Dívida 100, recebido 30, devolvido 0; abate 40 → devolvido 40, ainda aberta (30+40<100).
    expect(applyReceivableReturn(100, 30, 0, 40)).toEqual({
      returnedAmount: 40,
      status: 'OPEN',
      fullySettled: false,
    });
    // Recebido 30 + devolvido 70 = 100 → quita.
    expect(applyReceivableReturn(100, 30, 0, 70)).toEqual({
      returnedAmount: 70,
      status: 'PAID',
      fullySettled: true,
    });
  });

  it('receivableBalance: devolvido abate junto com o recebido', () => {
    expect(receivableBalance(100, 0, 0)).toBe(100);
    expect(receivableBalance(100, 30, 40)).toBe(30); // 100 − 30 − 40
    expect(receivableBalance(100, 60, 60)).toBe(0); // não fica negativo
  });

  it('applyReceivablePayment: com devolvido, quita antes (recebido+devolvido≥original)', () => {
    // Dívida 100, já devolvido 70; recebe 30 → quita (30+70=100).
    const r = applyReceivablePayment(100, 0, 30, 70);
    expect(r.fullyPaid).toBe(true);
    expect(r.status).toBe('PAID');
  });
});

describe('sumCashCount', () => {
  it('soma moedas e cédulas: Σ (valor × quantidade)', () => {
    // 3×0,05 + 2×0,10 + 1×0,25 + 4×1,00 + 2×50 + 1×100 = 0,15+0,20+0,25+4+100+100
    expect(
      sumCashCount({ 0.05: 3, 0.1: 2, 0.25: 1, 1: 4, 50: 2, 100: 1 }),
    ).toBe(204.6);
  });

  it('soma em centavos — sem erro de ponto flutuante em 0,05 × 3', () => {
    expect(sumCashCount({ 0.05: 3 })).toBe(0.15);
    // 0.1 + 0.2 = 0.30000000000000004 em ponto flutuante ingênuo
    expect(sumCashCount({ 0.1: 1, 0.2: 1 })).toBe(0.3);
  });

  it('contagem vazia ou toda zerada → 0', () => {
    expect(sumCashCount({})).toBe(0);
    expect(sumCashCount({ 1: 0, 100: 0 })).toBe(0);
  });

  it('quantidade inválida (negativa, fracionária, não finita) conta como 0', () => {
    expect(sumCashCount({ 100: -3 })).toBe(0);
    expect(sumCashCount({ 100: NaN })).toBe(0);
    // fracionária é truncada (não existe meia peça): 2,5 → 2 cédulas de 10 = 20
    expect(sumCashCount({ 10: 2.5 })).toBe(20);
  });

  it('valores das denominações do Real batem com as constantes', () => {
    expect([...BRL_COIN_VALUES]).toEqual([0.05, 0.1, 0.25, 0.5, 1]);
    expect([...BRL_BILL_VALUES]).toEqual([2, 5, 10, 20, 50, 100, 200]);
    // gaveta cheia: 1 de cada denominação
    const oneOfEach = Object.fromEntries(
      [...BRL_COIN_VALUES, ...BRL_BILL_VALUES].map((v) => [v, 1]),
    );
    // 0,05+0,10+0,25+0,50+1 + 2+5+10+20+50+100+200 = 1,90 + 387 = 388,90
    expect(sumCashCount(oneOfEach)).toBe(388.9);
  });
});

describe('paymentStatus (pagamento dividido)', () => {
  it('uma forma que cobre o total: pago = total, nada falta, sem troco', () => {
    const s = paymentStatus(100, [{ method: 'PIX', amount: 100 }]);
    expect(s).toEqual({ paid: 100, remaining: 0, change: 0, sufficient: true });
  });

  it('soma várias formas até cobrir o total', () => {
    const s = paymentStatus(100, [
      { method: 'CREDIT_CARD', amount: 40 },
      { method: 'PIX', amount: 35 },
      { method: 'CASH', amount: 25 },
    ]);
    expect(s.paid).toBe(100);
    expect(s.remaining).toBe(0);
    expect(s.change).toBe(0);
    expect(s.sufficient).toBe(true);
  });

  it('pagamento parcial: falta o restante e ainda não é suficiente', () => {
    const s = paymentStatus(100, [{ method: 'DEBIT_CARD', amount: 60 }]);
    expect(s.paid).toBe(60);
    expect(s.remaining).toBe(40);
    expect(s.sufficient).toBe(false);
    expect(s.change).toBe(0);
  });

  it('troco só sai do DINHEIRO: R$50 crédito + R$60 dinheiro num total de R$100 → troco R$10', () => {
    const s = paymentStatus(100, [
      { method: 'CREDIT_CARD', amount: 50 },
      { method: 'CASH', amount: 60 },
    ]);
    expect(s.paid).toBe(110);
    expect(s.remaining).toBe(0);
    expect(s.change).toBe(10);
    expect(s.sufficient).toBe(true);
  });

  it('excesso sem dinheiro não vira troco (cartão/PIX não devolvem)', () => {
    const s = paymentStatus(100, [{ method: 'CREDIT_CARD', amount: 110 }]);
    expect(s.change).toBe(0);
    expect(s.sufficient).toBe(true);
  });

  it('troco nunca passa do dinheiro recebido', () => {
    // total 100: 90 crédito + 15 dinheiro ⇒ excedente 5, dinheiro 15 ⇒ troco 5 (não 15)
    const s = paymentStatus(100, [
      { method: 'CREDIT_CARD', amount: 90 },
      { method: 'CASH', amount: 15 },
    ]);
    expect(s.change).toBe(5);
  });

  it('conta em centavos — sem erro de ponto flutuante', () => {
    const s = paymentStatus(0.3, [
      { method: 'CASH', amount: 0.1 },
      { method: 'CASH', amount: 0.2 },
    ]);
    expect(s.paid).toBe(0.3);
    expect(s.remaining).toBe(0);
    expect(s.sufficient).toBe(true);
  });

  it('parcelas inválidas ou ≤ 0 contam como 0', () => {
    const s = paymentStatus(50, [
      { method: 'CASH', amount: 50 },
      { method: 'PIX', amount: -10 },
      { method: 'CASH', amount: Number.NaN },
    ]);
    expect(s.paid).toBe(50);
    expect(s.sufficient).toBe(true);
    expect(s.change).toBe(0);
  });

  it('sem parcelas: nada pago, falta o total inteiro', () => {
    const s = paymentStatus(80, []);
    expect(s).toEqual({ paid: 0, remaining: 80, change: 0, sufficient: false });
  });
});

describe('withPaymentShare', () => {
  it('calcula a participação % e ordena da maior para a menor', () => {
    const rows = [
      { method: 'CASH', total: 30, count: 2 },
      { method: 'PIX', total: 70, count: 1 },
    ];
    expect(withPaymentShare(rows)).toEqual([
      { method: 'PIX', total: 70, count: 1, share: 70 },
      { method: 'CASH', total: 30, count: 2, share: 30 },
    ]);
  });

  it('participação 0 quando não há total (evita divisão por zero)', () => {
    expect(withPaymentShare([{ method: 'CASH', total: 0, count: 0 }])).toEqual([
      { method: 'CASH', total: 0, count: 0, share: 0 },
    ]);
  });

  it('lista vazia → array vazio', () => {
    expect(withPaymentShare([])).toEqual([]);
  });
});

// --- Sincronização offline (Outbox) — ADR-011 ---

describe('classifyHttpOutcome', () => {
  it('2xx = aplicado agora (SYNCED)', () => {
    expect(classifyHttpOutcome(200)).toBe('SYNCED');
    expect(classifyHttpOutcome(201)).toBe('SYNCED');
  });

  it('409 = dedup idempotente, já existia (SYNCED, não erro)', () => {
    expect(classifyHttpOutcome(409)).toBe('SYNCED');
  });

  it('5xx = servidor transitório (RETRY)', () => {
    expect(classifyHttpOutcome(500)).toBe('RETRY');
    expect(classifyHttpOutcome(503)).toBe('RETRY');
  });

  it('4xx (exceto 409) = falha dura de cliente (FAILED)', () => {
    expect(classifyHttpOutcome(400)).toBe('FAILED');
    expect(classifyHttpOutcome(401)).toBe('FAILED');
    expect(classifyHttpOutcome(404)).toBe('FAILED');
  });
});

describe('classifyNetworkError', () => {
  it('falha de rede é sempre transitória (RETRY)', () => {
    expect(classifyNetworkError()).toBe('RETRY');
  });
});

describe('shouldRetry', () => {
  it('re-tenta RETRY enquanto não estourar o limite', () => {
    expect(shouldRetry('RETRY', 0)).toBe(true);
    expect(shouldRetry('RETRY', MAX_SYNC_ATTEMPTS - 1)).toBe(true);
  });

  it('para de re-tentar RETRY ao atingir o limite', () => {
    expect(shouldRetry('RETRY', MAX_SYNC_ATTEMPTS)).toBe(false);
  });

  it('nunca re-tenta SYNCED nem FAILED', () => {
    expect(shouldRetry('SYNCED', 0)).toBe(false);
    expect(shouldRetry('FAILED', 0)).toBe(false);
  });
});

describe('syncBackoffMs', () => {
  it('cresce exponencialmente a partir de 1s', () => {
    expect(syncBackoffMs(0)).toBe(1000);
    expect(syncBackoffMs(1)).toBe(2000);
    expect(syncBackoffMs(2)).toBe(4000);
    expect(syncBackoffMs(3)).toBe(8000);
  });

  it('satura no teto de 30s', () => {
    expect(syncBackoffMs(10)).toBe(30000);
  });

  it('trata tentativas negativas como 0', () => {
    expect(syncBackoffMs(-5)).toBe(1000);
  });
});

describe('haltsQueue', () => {
  it('só SYNCED deixa a fila avançar', () => {
    expect(haltsQueue('SYNCED')).toBe(false);
    expect(haltsQueue('RETRY')).toBe(true);
    expect(haltsQueue('FAILED')).toBe(true);
  });
});

// =============================================================================
// PRODUTO AGREGADO — venda em par (ADR-015)
// =============================================================================

describe('ADR-015 — venda em par', () => {
  // O caso do Owner: parafuso R$0,60 + bucha R$0,20 (soma R$0,80), par por R$0,70.
  const parafuso = { salePrice: 0.6, stockQty: 100 };
  const bucha = { salePrice: 0.2, stockQty: 40 };

  describe('splitPairPrice', () => {
    it('rateia proporcionalmente ao preço avulso', () => {
      expect(splitPairPrice(parafuso, bucha, 0.7)).toEqual({
        mainUnitPrice: 0.525, // 0,60/0,80 × 0,70
        pairedUnitPrice: 0.175, // 0,20/0,80 × 0,70
      });
    });

    it('a soma das partes é EXATAMENTE o preço do par', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairPrice(parafuso, bucha, 0.7);
      expect(mainUnitPrice + pairedUnitPrice).toBe(0.7);
    });

    it('fecha exato mesmo quando a proporção é dízima (resíduo no item mais caro)', () => {
      // 2,00 + 1,00 = 3,00; par por 2,50 ⇒ 1,6667 e 0,8333 (soma 2,5 exata).
      const a = { salePrice: 2, stockQty: 10 };
      const b = { salePrice: 1, stockQty: 10 };
      const { mainUnitPrice, pairedUnitPrice } = splitPairPrice(a, b, 2.5);
      expect(mainUnitPrice + pairedUnitPrice).toBe(2.5);
      expect(pairedUnitPrice).toBe(0.8333); // o mais barato é o arredondado
    });

    it('funciona com o par cadastrado no lado mais barato', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairPrice(bucha, parafuso, 0.7);
      expect(mainUnitPrice).toBe(0.175);
      expect(pairedUnitPrice).toBe(0.525);
      expect(mainUnitPrice + pairedUnitPrice).toBe(0.7);
    });

    it('divide meio a meio quando ambos os avulsos são 0 (não divide por zero)', () => {
      const zero = { salePrice: 0, stockQty: 5 };
      expect(splitPairPrice(zero, zero, 1)).toEqual({
        mainUnitPrice: 0.5,
        pairedUnitPrice: 0.5,
      });
    });

    it('par mais caro que a soma dos avulsos ainda fecha exato', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairPrice(parafuso, bucha, 1.0);
      expect(mainUnitPrice + pairedUnitPrice).toBe(1.0);
    });
  });

  describe('splitPairLine (rateio da LINHA — regressão do E2E 2026-07-20)', () => {
    // O servidor calcula o total de cada linha como round(qty × unitPrice, 2). O rateio por
    // unidade fazia os dois arredondamentos subirem juntos: 5×0,5250 = 2,625 → 2,63 e
    // 5×0,1750 = 0,875 → 0,88, dando R$3,51 num carrinho que exibia R$3,50.
    const lineTotal = (unitPrice: number, qty: number) => calcSaleItemTotal({ quantity: qty, unitPrice });

    it('5 pares de R$0,70 somam exatamente R$3,50 (o bug relatado)', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairLine(parafuso, bucha, 0.7, 5);
      expect(lineTotal(mainUnitPrice, 5) + lineTotal(pairedUnitPrice, 5)).toBe(3.5);
    });

    it('1 par continua batendo (não regride o caso simples)', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairLine(parafuso, bucha, 0.7, 1);
      expect(lineTotal(mainUnitPrice, 1) + lineTotal(pairedUnitPrice, 1)).toBe(0.7);
    });

    const precos: [number, number, number][] = [
      [0.6, 0.2, 0.7], // parafuso + bucha
      [2, 1, 2.5], // proporção que gera dízima no rateio
      [1, 1, 1.99], // ímpar dividido em dois
      [33.33, 11.11, 40], // valores quebrados
      [0.01, 0.02, 0.03], // centavos
      [0, 0, 1], // ambos sem preço avulso (rateio meio a meio)
    ];
    /** Diferença (em R$) entre o total cobrado pelo servidor e `pairPrice × qty`. */
    const desvio = (a: number, b: number, pair: number, qty: number) => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairLine(
        { salePrice: a, stockQty: 999 },
        { salePrice: b, stockQty: 999 },
        pair,
        qty,
      );
      const cobrado = lineTotal(mainUnitPrice, qty) + lineTotal(pairedUnitPrice, qty);
      const d = Number((cobrado - pair * qty).toFixed(2));
      return d === 0 ? 0 : d; // normaliza o -0 do JS (mesmo valor, outra representação)
    };

    it('fecha EXATO em toda quantidade de balcão (1 a 100 pares)', () => {
      for (const [a, b, pair] of precos) {
        for (let qty = 1; qty <= 100; qty++) {
          expect(desvio(a, b, pair, qty), `par ${pair} × ${qty} (avulsos ${a}/${b})`).toBe(0);
        }
      }
    });

    /**
     * Acima disso, o preço unitário de 4 casas (`Decimal(12,4)`) pode não ter combinação exata —
     * cada passo de 0,0001 já move o total em mais de um centavo. O contrato é que o desvio
     * **nunca passa de 1 centavo por linha** (e o PDV cobra exatamente o que exibe, porque usa
     * estes mesmos valores para somar o carrinho).
     */
    it('em quantidades altas o desvio nunca passa de 1 centavo', () => {
      for (const [a, b, pair] of precos) {
        for (let qty = 101; qty <= 600; qty++) {
          expect(Math.abs(desvio(a, b, pair, qty)), `par ${pair} × ${qty}`).toBeLessThanOrEqual(
            0.01,
          );
        }
      }
    });

    it('mantém a proporção do rateio (o lado caro leva a maior fatia)', () => {
      const { mainUnitPrice, pairedUnitPrice } = splitPairLine(parafuso, bucha, 0.7, 4);
      expect(mainUnitPrice).toBeGreaterThan(pairedUnitPrice);
    });
  });

  describe('hasPair', () => {
    it('true com produto agregado + preço do par', () => {
      expect(hasPair({ pairedProductId: 'uuid-bucha', pairPrice: 0.7 })).toBe(true);
    });

    it('false sem produto agregado', () => {
      expect(hasPair({ pairPrice: 0.7 })).toBe(false);
      expect(hasPair({ pairedProductId: null, pairPrice: 0.7 })).toBe(false);
    });

    it('false sem preço do par (ou zerado)', () => {
      expect(hasPair({ pairedProductId: 'uuid-bucha' })).toBe(false);
      expect(hasPair({ pairedProductId: 'uuid-bucha', pairPrice: 0 })).toBe(false);
      expect(hasPair({ pairedProductId: 'uuid-bucha', pairPrice: null })).toBe(false);
    });
  });

  describe('groupPairedItems', () => {
    it('une os dois itens do par numa linha só, somando os totais', () => {
      const lines = groupPairedItems([
        { productName: 'Parafuso nº10', quantity: 1, total: 0.53, pairGroup: 1 },
        { productName: 'Bucha nº10', quantity: 1, total: 0.17, pairGroup: 1 },
      ]);
      expect(lines).toEqual([
        { label: 'Parafuso nº10 + Bucha nº10', quantity: 1, total: 0.7, isPair: true },
      ]);
    });

    it('mantém itens avulsos como estão, na ordem original', () => {
      const lines = groupPairedItems([
        { productName: 'Cimento', quantity: 2, total: 74 },
        { productName: 'Tijolo', quantity: 3, total: 3.6, pairGroup: null },
      ]);
      expect(lines).toHaveLength(2);
      expect(lines[0].label).toBe('Cimento');
      expect(lines.every((l) => !l.isPair)).toBe(true);
    });

    it('separa vários pares na mesma venda e preserva o avulso', () => {
      const lines = groupPairedItems([
        { productName: 'Parafuso', quantity: 2, total: 1.05, pairGroup: 1 },
        { productName: 'Bucha', quantity: 2, total: 0.35, pairGroup: 1 },
        { productName: 'Cimento', quantity: 1, total: 37 },
        { productName: 'Prego', quantity: 1, total: 0.4, pairGroup: 2 },
        { productName: 'Martelo', quantity: 1, total: 20, pairGroup: 2 },
      ]);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toEqual({
        label: 'Parafuso + Bucha',
        quantity: 2,
        total: 1.4,
        isPair: true,
      });
      expect(lines[1].label).toBe('Cimento');
      expect(lines[2].isPair).toBe(true);
    });

    it('a soma das linhas exibidas é igual à soma dos itens (nada some)', () => {
      const items = [
        { productName: 'Parafuso', quantity: 1, total: 0.53, pairGroup: 1 },
        { productName: 'Bucha', quantity: 1, total: 0.17, pairGroup: 1 },
        { productName: 'Cimento', quantity: 1, total: 37 },
      ];
      const soma = (ns: number[]) => Number(ns.reduce((a, b) => a + b, 0).toFixed(2));
      expect(soma(groupPairedItems(items).map((l) => l.total))).toBe(
        soma(items.map((i) => i.total)),
      );
    });

    it('grupo órfão (só um item) vira item avulso — nunca esconde nada', () => {
      const lines = groupPairedItems([
        { productName: 'Parafuso', quantity: 1, total: 0.53, pairGroup: 1 },
      ]);
      expect(lines).toEqual([
        { label: 'Parafuso', quantity: 1, total: 0.53, isPair: false },
      ]);
    });

    it('aceita quantidade/total como string (Decimal serializado pela API)', () => {
      const lines = groupPairedItems([
        { productName: 'Parafuso', quantity: '2', total: '1.05', pairGroup: 1 },
        { productName: 'Bucha', quantity: '2', total: '0.35', pairGroup: 1 },
      ]);
      expect(lines[0]).toEqual({
        label: 'Parafuso + Bucha',
        quantity: 2,
        total: 1.4,
        isPair: true,
      });
    });

    it('pedido antigo (sem pairGroup em lugar nenhum) passa intacto', () => {
      const items = [
        { productName: 'Cimento', quantity: 2, total: 74 },
        { productName: 'Tijolo', quantity: 3, total: 3.6 },
      ];
      expect(groupPairedItems(items)).toHaveLength(2);
    });
  });

  describe('pairAvailableQty', () => {
    it('o par é limitado pelo lado com menos estoque', () => {
      expect(pairAvailableQty(parafuso, bucha)).toBe(40); // 100 parafusos, 40 buchas
    });

    it('sem estoque de um lado, nenhum par é vendável', () => {
      expect(pairAvailableQty(parafuso, { salePrice: 0.2, stockQty: 0 })).toBe(0);
    });

    it('nunca devolve negativo (estoque negativo de reconciliação, ADR-011 §6)', () => {
      expect(pairAvailableQty(parafuso, { salePrice: 0.2, stockQty: -5 })).toBe(0);
    });
  });
});

describe('normalizeSearchText', () => {
  it('minúsculas, sem acento e sem espaços nas pontas', () => {
    expect(normalizeSearchText('  Címento Ç  ')).toBe('cimento c');
  });
});

describe('productMatchesQuery', () => {
  const p = {
    name: 'Vergalhão CA-50 8mm',
    popularName: 'Ferro 8',
    manufacturer: 'Gerdau',
    sku: 'FE8',
  };

  it('casa pelo nome oficial (acento/caixa-insensível)', () => {
    expect(productMatchesQuery(p, 'vergalhao')).toBe(true);
    expect(productMatchesQuery(p, 'CA-50')).toBe(true);
  });

  it('casa pelo nome popular', () => {
    expect(productMatchesQuery(p, 'ferro')).toBe(true);
    expect(productMatchesQuery(p, 'Ferro 8')).toBe(true);
  });

  it('casa pelo SKU', () => {
    expect(productMatchesQuery(p, 'fe8')).toBe(true);
  });

  it('casa pelo fabricante (busca por marca acha os produtos dela)', () => {
    expect(productMatchesQuery(p, 'gerdau')).toBe(true);
    expect(productMatchesQuery(p, 'GERD')).toBe(true);
  });

  it('query vazia casa tudo (sem filtro)', () => {
    expect(productMatchesQuery(p, '')).toBe(true);
    expect(productMatchesQuery(p, '   ')).toBe(true);
  });

  it('não casa quando nada bate', () => {
    expect(productMatchesQuery(p, 'cimento')).toBe(false);
  });

  it('funciona com popularName/manufacturer ausentes (null)', () => {
    const semPopular = {
      name: 'Cimento CP-II 50kg',
      popularName: null,
      manufacturer: null,
      sku: 'CIM50',
    };
    expect(productMatchesQuery(semPopular, 'cimento')).toBe(true);
    expect(productMatchesQuery(semPopular, 'ferro')).toBe(false);
  });

  describe('busca tokenizada (AND, ordem-livre)', () => {
    const luva = {
      name: 'Luva ESG 40mm',
      popularName: null,
      manufacturer: 'Tigre',
      sku: 'LV40',
    };

    it('casa quando os tokens estão separados no nome ("Luva 40" → "Luva ESG 40mm")', () => {
      expect(productMatchesQuery(luva, 'Luva 40')).toBe(true);
    });

    it('a ordem dos tokens não importa', () => {
      expect(productMatchesQuery(luva, '40 luva')).toBe(true);
    });

    it('exige TODOS os tokens (AND): se um não bate, não casa', () => {
      expect(productMatchesQuery(luva, 'Luva 50')).toBe(false);
      expect(productMatchesQuery(luva, 'Luva cimento')).toBe(false);
    });

    it('tokens podem cair em campos diferentes (marca + nome)', () => {
      expect(productMatchesQuery(luva, 'tigre luva')).toBe(true);
    });

    it('acento-fold vale por token ("vergalhao 8" acha "Vergalhão CA-50 8mm")', () => {
      expect(productMatchesQuery(p, 'vergalhao 8')).toBe(true);
    });

    it('um token não vaza de um campo para o outro (separação por espaço)', () => {
      // "40mmtigre" não existe: "40mm" termina o nome e "Tigre" começa a marca.
      expect(productMatchesQuery(luva, '40mmtigre')).toBe(false);
    });
  });

  it('funciona com os campos opcionais omitidos (produto antigo)', () => {
    const minimo = { name: 'Areia média', sku: 'AR-M' };
    expect(productMatchesQuery(minimo, 'areia')).toBe(true);
    expect(productMatchesQuery(minimo, 'gerdau')).toBe(false);
  });
});

// =============================================================================
// VENDA EM UNIDADE ALTERNATIVA (ADR-013 — EF-3)
// =============================================================================

describe('EF-3 — venda em unidade alternativa', () => {
  // Fio: base = metro a R$ 2,00; rolo fechado de 100 m a R$ 150,00 (sai R$ 1,50/m).
  const fio = { salePrice: 2, altUnit: 'ROLL', altSalePrice: 150, conversionFactor: 100 };
  // Cimento: produto de uma unidade só (sem embalagem alternativa).
  const cimento = { salePrice: 32, altUnit: null, altSalePrice: null, conversionFactor: null };

  describe('hasAltUnit', () => {
    it('true quando altUnit + altSalePrice > 0 + conversionFactor > 0', () => {
      expect(hasAltUnit(fio)).toBe(true);
    });

    it('false sem altUnit', () => {
      expect(hasAltUnit(cimento)).toBe(false);
      expect(hasAltUnit({ salePrice: 2, altSalePrice: 150, conversionFactor: 100 })).toBe(false);
    });

    it('false quando altSalePrice é 0/null (preço não cadastrado)', () => {
      expect(hasAltUnit({ ...fio, altSalePrice: 0 })).toBe(false);
      expect(hasAltUnit({ ...fio, altSalePrice: null })).toBe(false);
    });

    it('false quando conversionFactor é 0/null (tamanho não cadastrado)', () => {
      expect(hasAltUnit({ ...fio, conversionFactor: 0 })).toBe(false);
      expect(hasAltUnit({ ...fio, conversionFactor: null })).toBe(false);
    });
  });

  describe('resolveSaleUnit', () => {
    it('BASE devolve o preço-base e fator 1', () => {
      expect(resolveSaleUnit(fio, 'BASE')).toEqual({ unitPrice: 2, factorToBase: 1 });
    });

    it('ALT devolve o preço da embalagem e o fator de conversão', () => {
      expect(resolveSaleUnit(fio, 'ALT')).toEqual({ unitPrice: 150, factorToBase: 100 });
    });

    it('ALT pedido em produto sem embalagem cai para BASE (nunca preço indefinido)', () => {
      expect(resolveSaleUnit(cimento, 'ALT')).toEqual({ unitPrice: 32, factorToBase: 1 });
    });
  });

  describe('toBaseQuantity', () => {
    it('BASE debita a própria quantidade', () => {
      expect(toBaseQuantity(fio, 'BASE', 5)).toBe(5);
    });

    it('ALT debita quantidade × conversionFactor (2 rolos = 200 m)', () => {
      expect(toBaseQuantity(fio, 'ALT', 2)).toBe(200);
    });

    it('lida com quantidade fracionada (2,5 m)', () => {
      expect(toBaseQuantity(fio, 'BASE', 2.5)).toBe(2.5);
    });

    it('ALT em produto sem embalagem debita 1:1 (cai para BASE)', () => {
      expect(toBaseQuantity(cimento, 'ALT', 3)).toBe(3);
    });
  });

  describe('effectiveBaseUnitPrice', () => {
    it('BASE = salePrice (R$ 2,00/m)', () => {
      expect(effectiveBaseUnitPrice(fio, 'BASE')).toBe(2);
    });

    it('ALT = altSalePrice / conversionFactor — o rolo sai mais barato por metro', () => {
      expect(effectiveBaseUnitPrice(fio, 'ALT')).toBe(1.5); // 150 / 100
      expect(effectiveBaseUnitPrice(fio, 'ALT')).toBeLessThan(
        effectiveBaseUnitPrice(fio, 'BASE'),
      );
    });

    it('arredonda a 4 casas (100 / 3)', () => {
      expect(effectiveBaseUnitPrice({ salePrice: 1, altUnit: 'ROLL', altSalePrice: 100, conversionFactor: 3 }, 'ALT')).toBe(33.3333);
    });
  });
});

describe('ADR-020 — retirada / entrega futura', () => {
  describe('availableQty', () => {
    it('disponível = estoque − reservado', () => {
      expect(availableQty(100, 30)).toBe(70);
    });

    it('sem reserva ⇒ disponível = estoque', () => {
      expect(availableQty(50, 0)).toBe(50);
    });

    it('nunca negativo (reservado > estoque, borda de reconciliação)', () => {
      expect(availableQty(10, 25)).toBe(0);
    });

    it('preserva fracionado a 4 casas (metros)', () => {
      expect(availableQty(12.5, 2.5)).toBe(10);
    });
  });

  describe('remainingToDeliver', () => {
    it('falta = base − entregue', () => {
      expect(remainingToDeliver(200, 50)).toBe(150);
    });

    it('tudo retirado ⇒ 0', () => {
      expect(remainingToDeliver(200, 200)).toBe(0);
    });

    it('nunca negativo (defensivo)', () => {
      expect(remainingToDeliver(200, 250)).toBe(0);
    });
  });

  describe('isValidDelivery', () => {
    it('retirada positiva dentro do que falta é válida', () => {
      expect(isValidDelivery(50, 150)).toBe(true);
    });

    it('retirada exata do que falta é válida', () => {
      expect(isValidDelivery(150, 150)).toBe(true);
    });

    it('acima do que falta é inválida', () => {
      expect(isValidDelivery(151, 150)).toBe(false);
    });

    it('zero ou negativa é inválida', () => {
      expect(isValidDelivery(0, 150)).toBe(false);
      expect(isValidDelivery(-5, 150)).toBe(false);
    });

    it('tolera arredondamento em fracionados (0,5 m)', () => {
      expect(isValidDelivery(0.5, 0.5)).toBe(true);
    });
  });

  describe('applyItemDelivery', () => {
    it('retirada parcial mantém a linha incompleta', () => {
      const r = applyItemDelivery(200, 0, 50);
      expect(r.deliveredBaseQty).toBe(50);
      expect(r.fullyDelivered).toBe(false);
    });

    it('somatório das parciais completa a linha', () => {
      const r1 = applyItemDelivery(200, 0, 120);
      const r2 = applyItemDelivery(200, r1.deliveredBaseQty, 80);
      expect(r2.deliveredBaseQty).toBe(200);
      expect(r2.fullyDelivered).toBe(true);
    });

    it('≥ tolera arredondamento ao completar', () => {
      const r = applyItemDelivery(0.3, 0.1, 0.2); // 0.1 + 0.2 = 0.30000000000000004
      expect(r.deliveredBaseQty).toBe(0.3);
      expect(r.fullyDelivered).toBe(true);
    });
  });

  describe('orderFulfillmentStatus', () => {
    it('nada retirado ⇒ PENDING', () => {
      expect(
        orderFulfillmentStatus([
          { baseQuantity: 200, deliveredBaseQty: 0 },
          { baseQuantity: 10, deliveredBaseQty: 0 },
        ]),
      ).toBe('PENDING');
    });

    it('parte retirada (uma linha) ⇒ PARTIAL', () => {
      expect(
        orderFulfillmentStatus([
          { baseQuantity: 200, deliveredBaseQty: 200 },
          { baseQuantity: 10, deliveredBaseQty: 0 },
        ]),
      ).toBe('PARTIAL');
    });

    it('linha parcialmente retirada ⇒ PARTIAL', () => {
      expect(
        orderFulfillmentStatus([{ baseQuantity: 200, deliveredBaseQty: 50 }]),
      ).toBe('PARTIAL');
    });

    it('tudo retirado ⇒ COMPLETED', () => {
      expect(
        orderFulfillmentStatus([
          { baseQuantity: 200, deliveredBaseQty: 200 },
          { baseQuantity: 10, deliveredBaseQty: 10 },
        ]),
      ).toBe('COMPLETED');
    });

    it('pedido sem linhas (defensivo) ⇒ COMPLETED', () => {
      expect(orderFulfillmentStatus([])).toBe('COMPLETED');
    });
  });

  describe('reconcileReserved', () => {
    it('soma o que falta sair de todas as linhas pendentes do produto', () => {
      expect(
        reconcileReserved([
          { baseQuantity: 200, deliveredBaseQty: 50 }, // falta 150
          { baseQuantity: 30, deliveredBaseQty: 0 }, //  falta 30
          { baseQuantity: 10, deliveredBaseQty: 10 }, // falta 0
        ]),
      ).toBe(180);
    });

    it('nenhuma linha pendente ⇒ 0', () => {
      expect(reconcileReserved([])).toBe(0);
    });

    it('coerência com availableQty: estoque − reservado reconciliado', () => {
      const reserved = reconcileReserved([{ baseQuantity: 40, deliveredBaseQty: 10 }]); // 30
      expect(availableQty(100, reserved)).toBe(70);
    });
  });
});
