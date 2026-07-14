import { describe, expect, it } from 'vitest';
import {
  applyStockMovement,
  calcAdjustedCashClosing,
  calcCashDivergence,
  calcExpectedCash,
  calcInventoryAdjustment,
  calcMarginPercent,
  calcOrderTotal,
  calcSaleItemTotal,
  calcSaleTotals,
  calcSubtotal,
  reconcileStock,
  calcAverageTicket,
  withPaymentShare,
  netCashMovements,
  classifyHttpOutcome,
  classifyNetworkError,
  shouldRetry,
  syncBackoffMs,
  haltsQueue,
  MAX_SYNC_ATTEMPTS,
  normalizeSearchText,
  productMatchesQuery,
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

describe('normalizeSearchText', () => {
  it('minúsculas, sem acento e sem espaços nas pontas', () => {
    expect(normalizeSearchText('  Címento Ç  ')).toBe('cimento c');
  });
});

describe('productMatchesQuery', () => {
  const p = { name: 'Vergalhão CA-50 8mm', popularName: 'Ferro 8', sku: 'FE8' };

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

  it('query vazia casa tudo (sem filtro)', () => {
    expect(productMatchesQuery(p, '')).toBe(true);
    expect(productMatchesQuery(p, '   ')).toBe(true);
  });

  it('não casa quando nada bate', () => {
    expect(productMatchesQuery(p, 'cimento')).toBe(false);
  });

  it('funciona com popularName ausente (null)', () => {
    const semPopular = { name: 'Cimento CP-II 50kg', popularName: null, sku: 'CIM50' };
    expect(productMatchesQuery(semPopular, 'cimento')).toBe(true);
    expect(productMatchesQuery(semPopular, 'ferro')).toBe(false);
  });
});
