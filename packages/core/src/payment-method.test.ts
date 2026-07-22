import { describe, expect, it } from 'vitest';
import {
  calcMarginPercent,
  cardFeePercentFor,
  netMarginPercent,
  pairPriceForPaymentMethod,
  priceForPaymentMethod,
  resolveSurcharge,
  splitPairLine,
  surchargePerBaseUnit,
} from './index';

// =============================================================================
// PREÇO E MARGEM POR FORMA DE PAGAMENTO (ADR-016 — fatia FP)
// =============================================================================

describe('ADR-016 — preço e margem por forma de pagamento', () => {
  // Cimento: custo R$25, à vista R$37, sobe R$1,50 no crédito e R$0,60 no débito.
  const cimento = {
    salePrice: 37,
    altUnit: null,
    altSalePrice: null,
    conversionFactor: null,
    surchargeDebit: 0.6,
    surchargeCredit: 1.5,
  };
  // Tijolo: nenhum acréscimo cadastrado — o caso mais comum do catálogo.
  const tijolo = {
    salePrice: 1.2,
    altUnit: null,
    altSalePrice: null,
    conversionFactor: null,
    surchargeDebit: null,
    surchargeCredit: null,
  };
  // Fio: base = metro R$2; rolo de 100 m R$150. Acréscimo cadastrado POR METRO.
  const fio = {
    salePrice: 2,
    altUnit: 'ROLL',
    altSalePrice: 150,
    conversionFactor: 100,
    surchargeDebit: null,
    surchargeCredit: 0.02,
  };

  describe('surchargePerBaseUnit', () => {
    it('dinheiro e PIX nunca acrescem', () => {
      expect(surchargePerBaseUnit(cimento, 'CASH')).toBe(0);
      expect(surchargePerBaseUnit(cimento, 'PIX')).toBe(0);
    });

    it('débito e crédito pegam cada um o seu campo', () => {
      expect(surchargePerBaseUnit(cimento, 'DEBIT_CARD')).toBe(0.6);
      expect(surchargePerBaseUnit(cimento, 'CREDIT_CARD')).toBe(1.5);
    });

    it('produto sem acréscimo não acresce em nenhuma forma (opt-in do Owner)', () => {
      expect(surchargePerBaseUnit(tijolo, 'DEBIT_CARD')).toBe(0);
      expect(surchargePerBaseUnit(tijolo, 'CREDIT_CARD')).toBe(0);
    });

    it('um lado preenchido não vaza para o outro', () => {
      // O fio tem acréscimo só no crédito.
      expect(surchargePerBaseUnit(fio, 'DEBIT_CARD')).toBe(0);
      expect(surchargePerBaseUnit(fio, 'CREDIT_CARD')).toBe(0.02);
    });

    it('valor negativo ou zero é ignorado (o campo é acréscimo, não desconto)', () => {
      expect(surchargePerBaseUnit({ surchargeCredit: -5 }, 'CREDIT_CARD')).toBe(0);
      expect(surchargePerBaseUnit({ surchargeCredit: 0 }, 'CREDIT_CARD')).toBe(0);
    });

    it('funciona com os campos omitidos (produto cadastrado antes do ADR-016)', () => {
      expect(surchargePerBaseUnit({}, 'CREDIT_CARD')).toBe(0);
    });
  });

  describe('resolveSurcharge — composição com a embalagem fechada (EF-3)', () => {
    it('na unidade-base aplica o acréscimo tal como cadastrado', () => {
      expect(resolveSurcharge(fio, 'CREDIT_CARD', 'BASE')).toBe(0.02);
    });

    it('na embalagem fechada é proporcional ao tamanho (rolo de 100 m sobe R$ 2,00)', () => {
      expect(resolveSurcharge(fio, 'CREDIT_CARD', 'ALT')).toBe(2);
    });

    it('produto sem embalagem ignora o modo ALT (cai para BASE, sem inflar)', () => {
      expect(resolveSurcharge(cimento, 'CREDIT_CARD', 'ALT')).toBe(1.5);
    });

    it('sem acréscimo cadastrado, nem a embalagem cria acréscimo do nada', () => {
      expect(resolveSurcharge(fio, 'DEBIT_CARD', 'ALT')).toBe(0);
    });
  });

  describe('priceForPaymentMethod', () => {
    it('dinheiro cobra o preço de tabela', () => {
      expect(priceForPaymentMethod(cimento, 'CASH', 'BASE')).toBe(37);
    });

    it('crédito soma o acréscimo (o caso do Owner: R$ 37 → R$ 38,50)', () => {
      expect(priceForPaymentMethod(cimento, 'CREDIT_CARD', 'BASE')).toBe(38.5);
    });

    it('débito soma o seu próprio acréscimo', () => {
      expect(priceForPaymentMethod(cimento, 'DEBIT_CARD', 'BASE')).toBe(37.6);
    });

    it('produto sem acréscimo cobra igual em todas as formas', () => {
      const precos = (['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD'] as const).map((m) =>
        priceForPaymentMethod(tijolo, m, 'BASE'),
      );
      expect(precos).toEqual([1.2, 1.2, 1.2, 1.2]);
    });

    it('embalagem no crédito: rolo R$ 150 → R$ 152 (100 m × R$ 0,02)', () => {
      expect(priceForPaymentMethod(fio, 'CREDIT_CARD', 'ALT')).toBe(152);
      expect(priceForPaymentMethod(fio, 'CREDIT_CARD', 'BASE')).toBe(2.02);
    });
  });

  describe('pairPriceForPaymentMethod — composição com o par (ADR-015)', () => {
    // Parafuso R$0,60 (+R$0,03 no crédito) + bucha R$0,20 (+R$0,02); par sai R$0,70.
    const parafuso = { surchargeDebit: null, surchargeCredit: 0.03 };
    const bucha = { surchargeDebit: null, surchargeCredit: 0.02 };

    it('o par soma o acréscimo dos DOIS lados (cada par consome 1 de cada)', () => {
      expect(pairPriceForPaymentMethod(parafuso, bucha, 0.7, 'CREDIT_CARD')).toBe(0.75);
    });

    it('em dinheiro o par mantém o preço promocional', () => {
      expect(pairPriceForPaymentMethod(parafuso, bucha, 0.7, 'CASH')).toBe(0.7);
    });

    it('só um lado com acréscimo já sobe o par', () => {
      expect(pairPriceForPaymentMethod(parafuso, {}, 0.7, 'CREDIT_CARD')).toBe(0.73);
    });

    it('acréscimo aplicado ANTES do rateio: os dois itens somam exato o total da linha', () => {
      // Propriedade que o bug PA.1 ensinou a proteger — agora com acréscimo no meio.
      const precoPar = pairPriceForPaymentMethod(parafuso, bucha, 0.7, 'CREDIT_CARD'); // 0,75
      for (let qty = 1; qty <= 100; qty++) {
        const split = splitPairLine(
          { salePrice: 0.6, stockQty: 999 },
          { salePrice: 0.2, stockQty: 999 },
          precoPar,
          qty,
        );
        const totalMain = Number((split.mainUnitPrice * qty).toFixed(2));
        const totalPaired = Number((split.pairedUnitPrice * qty).toFixed(2));
        expect(Number((totalMain + totalPaired).toFixed(2))).toBe(
          Number((precoPar * qty).toFixed(2)),
        );
      }
    });
  });

  describe('cardFeePercentFor', () => {
    const loja = { cardFeeDebitPercent: 1.5, cardFeeCreditPercent: 3.5 };

    it('pega a taxa da modalidade', () => {
      expect(cardFeePercentFor(loja, 'DEBIT_CARD')).toBe(1.5);
      expect(cardFeePercentFor(loja, 'CREDIT_CARD')).toBe(3.5);
    });

    it('dinheiro e PIX não têm taxa', () => {
      expect(cardFeePercentFor(loja, 'CASH')).toBe(0);
      expect(cardFeePercentFor(loja, 'PIX')).toBe(0);
    });

    it('loja sem taxa cadastrada devolve 0 (margem se comporta como antes)', () => {
      expect(cardFeePercentFor({}, 'CREDIT_CARD')).toBe(0);
      expect(cardFeePercentFor({ cardFeeCreditPercent: null }, 'CREDIT_CARD')).toBe(0);
    });

    it('aceita a taxa como string (Decimal do Prisma → JSON) sem quebrar', () => {
      // Regressão: a taxa vem do `GET /tenant` como string ("3.50"); antes o `.toFixed`
      // estourava e derrubava o painel de produto. Agora coage p/ number.
      const lojaStr = { cardFeeDebitPercent: '1.5', cardFeeCreditPercent: '3.5' } as unknown as {
        cardFeeDebitPercent: number;
        cardFeeCreditPercent: number;
      };
      expect(cardFeePercentFor(lojaStr, 'DEBIT_CARD')).toBe(1.5);
      expect(cardFeePercentFor(lojaStr, 'CREDIT_CARD')).toBe(3.5);
    });
  });

  describe('surchargePerBaseUnit — coerção defensiva', () => {
    it('aceita o acréscimo como string (Decimal do Prisma → JSON) sem quebrar', () => {
      const p = { surchargeDebit: '1.50', surchargeCredit: '2.00' } as unknown as {
        surchargeDebit: number;
        surchargeCredit: number;
      };
      expect(surchargePerBaseUnit(p, 'DEBIT_CARD')).toBe(1.5);
      expect(surchargePerBaseUnit(p, 'CREDIT_CARD')).toBe(2);
    });
  });

  describe('netMarginPercent', () => {
    it('sem taxa é idêntica à margem de sempre (compatível com o que já se exibe)', () => {
      expect(netMarginPercent(25, 37, 0)).toBe(calcMarginPercent(25, 37));
    });

    it('a taxa come margem: cimento no crédito a 3,5%', () => {
      // Cobra 38,50; a maquininha leva 1,3475; sobram 37,1525 − 25 de custo = 12,1525.
      expect(netMarginPercent(25, 38.5, 3.5)).toBe(31.56);
    });

    it('o acréscimo de R$1,50 recupera o LUCRO EM REAIS perdido para a taxa', () => {
      // À vista sobram R$12,00. No crédito cobrando R$38,50: 38,50 − 1,3475 (taxa) − 25 = 12,1525.
      // O ponto de equilíbrio do lucro em reais é R$1,34 de acréscimo (0,965 × P = 37).
      const lucroAVista = 37 - 25;
      const lucroNoCredito = 38.5 - 38.5 * 0.035 - 25;
      expect(lucroNoCredito).toBeGreaterThan(lucroAVista);
    });

    it('mas a margem PERCENTUAL ainda cai — o denominador cresceu junto', () => {
      // 32,43% à vista × 31,56% no crédito. Não é bug: repor a margem % exigiria acréscimo de
      // ~R$2,02 (25 ÷ (0,965 − 0,3243)), não R$1,50. É exatamente o que este número serve para
      // mostrar ao Owner na hora de escolher o acréscimo.
      expect(netMarginPercent(25, 38.5, 3.5)).toBeLessThan(netMarginPercent(25, 37, 0));
      expect(netMarginPercent(25, 39.03, 3.5)).toBeGreaterThan(netMarginPercent(25, 37, 0));
    });

    it('sem acréscimo, o crédito rende MENOS que o dinheiro (o alerta que a taxa dá)', () => {
      expect(netMarginPercent(25, 37, 3.5)).toBeLessThan(netMarginPercent(25, 37, 0));
    });

    it('pode ser negativa — é aí que ela avisa que a venda dá prejuízo', () => {
      expect(netMarginPercent(36, 37, 3.5)).toBeLessThan(0);
    });

    it('preço zero ou negativo devolve 0 (sem divisão por zero)', () => {
      expect(netMarginPercent(25, 0, 3.5)).toBe(0);
      expect(netMarginPercent(25, -1, 3.5)).toBe(0);
    });
  });
});
