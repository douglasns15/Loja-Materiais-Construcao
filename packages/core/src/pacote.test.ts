import { describe, expect, it } from 'vitest';
import {
  CLOSED_PRIMARY_UNITS,
  closedFineUnit,
  closedSaleStep,
  closedStockMeters,
  isClosedPrimary,
  isValidMeterStep,
  metersFromWhole,
  resolveClosedSale,
  sellsByMeter,
  splitWholeAndRemainder,
} from './index';

// =============================================================================
// PACOTE — unidade fechada aberta em unidade avulsa (ADR-030, generaliza o ADR-017)
// =============================================================================
// O "Kit de cola quente": 1 pacote fechado = 6 unidades; vende-se o pacote inteiro
// (padrão) OU a unidade avulsa (ex.: R$ 2,00 cada). A régua fina é a UNIDADE (passo
// 1 — não existe "meio tubo de cola"), diferente da barra/rolo (passo 0,5 m).

const kit6 = { unit: 'PACK', conversionFactor: 6, salePrice: 10, altSalePrice: 2 };
const kitSemAvulso = { unit: 'PACK', conversionFactor: 6, salePrice: 10, altSalePrice: null };

describe('ADR-030 — pacote como unidade fechada com corte por unidade avulsa', () => {
  describe('closedSaleStep / closedFineUnit (passo e régua fina por unidade)', () => {
    it('pacote abre em unidade inteira (passo 1) e barra/rolo por 0,5 m', () => {
      expect(closedSaleStep('PACK')).toBe(1);
      expect(closedSaleStep('BARRA')).toBe(0.5);
      expect(closedSaleStep('ROLL')).toBe(0.5);
    });

    it('a régua fina do pacote é a unidade; da barra/rolo é o metro', () => {
      expect(closedFineUnit('PACK')).toBe('UNIT');
      expect(closedFineUnit('BARRA')).toBe('METER');
      expect(closedFineUnit('ROLL')).toBe('METER');
    });

    it('o pacote entra na lista de unidades fechadas principais', () => {
      expect(CLOSED_PRIMARY_UNITS).toContain('PACK');
    });
  });

  describe('isValidMeterStep com passo 1 (venda avulsa inteira)', () => {
    it('aceita inteiros a partir de 1', () => {
      expect(isValidMeterStep(1, 1)).toBe(true);
      expect(isValidMeterStep(2, 1)).toBe(true);
      expect(isValidMeterStep(6, 1)).toBe(true);
    });

    it('recusa fração e abaixo do mínimo (não existe meia unidade)', () => {
      expect(isValidMeterStep(0, 1)).toBe(false);
      expect(isValidMeterStep(0.5, 1)).toBe(false);
      expect(isValidMeterStep(1.5, 1)).toBe(false);
    });
  });

  describe('isClosedPrimary / sellsByMeter (detecção do pacote)', () => {
    it('pacote com tamanho é unidade fechada principal', () => {
      expect(isClosedPrimary(kit6)).toBe(true);
      expect(isClosedPrimary({ unit: 'PACK', conversionFactor: 0 })).toBe(false); // sem tamanho
    });

    it('sellsByMeter (vende avulso) só quando há preço avulso', () => {
      expect(sellsByMeter(kit6)).toBe(true);
      expect(sellsByMeter(kitSemAvulso)).toBe(false); // preço avulso vazio ⇒ só pacote fechado
    });
  });

  describe('resolveClosedSale / closedStockMeters (preço + baixa em unidades)', () => {
    it('pacote inteiro: preço do pacote, baixa o tamanho em unidades', () => {
      expect(resolveClosedSale(kit6, 'WHOLE')).toEqual({ unitPrice: 10, metersPerUnit: 6 });
      expect(closedStockMeters(kit6, 'WHOLE', 2)).toBe(12); // 2 pacotes = 12 unidades
    });

    it('avulso: preço da unidade, baixa 1 unidade por avulso vendido', () => {
      expect(resolveClosedSale(kit6, 'METER')).toEqual({ unitPrice: 2, metersPerUnit: 1 });
      expect(closedStockMeters(kit6, 'METER', 3)).toBe(3); // 3 unidades baixam 3 unidades
    });

    it('pedir avulso sem preço avulso cai para pacote inteiro (fallback seguro)', () => {
      expect(resolveClosedSale(kitSemAvulso, 'METER')).toEqual({ unitPrice: 10, metersPerUnit: 6 });
    });
  });

  describe('exibição/entrada reusam as mesmas funções (régua fina = unidade)', () => {
    it('entrada em pacotes vira unidades (10 pacotes de 6 = 60 un)', () => {
      expect(metersFromWhole(10, 6)).toBe(60);
    });

    it('saldo mostra "pacotes + sobra" (20 un com pacote de 6 → 3 pacotes + 2 un)', () => {
      expect(splitWholeAndRemainder(20, 6)).toEqual({ whole: 3, remainderMeters: 2 });
    });

    it('abrir 1 pacote e vender as 6 unidades zera sem resíduo', () => {
      let units = metersFromWhole(1, 6); // 1 pacote = 6 un
      for (let i = 0; i < 6; i++) units = Number((units - 1).toFixed(4));
      expect(units).toBe(0);
      expect(splitWholeAndRemainder(units, 6)).toEqual({ whole: 0, remainderMeters: 0 });
    });
  });
});
