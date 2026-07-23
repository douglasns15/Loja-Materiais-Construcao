import { describe, expect, it } from 'vitest';
import {
  METER_SALE_STEP,
  closedStockMeters,
  isClosedPrimary,
  isValidMeterStep,
  metersFromWhole,
  resolveClosedSale,
  sellsByMeter,
  splitWholeAndRemainder,
} from './index';

const barra6 = { unit: 'BARRA', conversionFactor: 6, salePrice: 48, altSalePrice: 9 };
const barraSemCorte = { unit: 'BARRA', conversionFactor: 6, salePrice: 48, altSalePrice: null };

// =============================================================================
// UNIDADE FECHADA COMO PRINCIPAL — Barra/Rolo + fracionada por metro (ADR-017)
// =============================================================================

describe('ADR-017 — barra/rolo como unidade fechada principal', () => {
  describe('isValidMeterStep (venda por metro em múltiplos de 0,5 m)', () => {
    it('aceita múltiplos de 0,5 m a partir de 0,5', () => {
      expect(isValidMeterStep(0.5)).toBe(true);
      expect(isValidMeterStep(1)).toBe(true);
      expect(isValidMeterStep(1.5)).toBe(true);
      expect(isValidMeterStep(2.5)).toBe(true);
      expect(isValidMeterStep(6)).toBe(true);
    });

    it('recusa abaixo do mínimo e valores quebrados', () => {
      expect(isValidMeterStep(0)).toBe(false);
      expect(isValidMeterStep(0.25)).toBe(false); // abaixo de 0,5
      expect(isValidMeterStep(0.7)).toBe(false); // não é múltiplo de 0,5
      expect(isValidMeterStep(1.3)).toBe(false);
      expect(isValidMeterStep(-1)).toBe(false);
      expect(isValidMeterStep(Number.NaN)).toBe(false);
    });

    it('o passo padrão exportado é 0,5 m', () => {
      expect(METER_SALE_STEP).toBe(0.5);
    });
  });

  describe('metersFromWhole (entrada de estoque lançada em barras → metros)', () => {
    it('+10 barras de 6 m = 60 m', () => {
      expect(metersFromWhole(10, 6)).toBe(60);
    });

    it('tamanho inválido devolve 0 (não corrompe o ledger)', () => {
      expect(metersFromWhole(10, 0)).toBe(0);
    });
  });

  describe('splitWholeAndRemainder (exibição "49 barras + 4 m")', () => {
    it('298 m com barra de 6 m → 49 barras + 4 m', () => {
      expect(splitWholeAndRemainder(298, 6)).toEqual({ whole: 49, remainderMeters: 4 });
    });

    it('múltiplo exato não cai por ruído de ponto flutuante (300 ÷ 6 = 50 + 0)', () => {
      expect(splitWholeAndRemainder(300, 6)).toEqual({ whole: 50, remainderMeters: 0 });
    });

    it('vale igual para rolo (750 m com rolo de 60 m → 12 rolos + 30 m)', () => {
      expect(splitWholeAndRemainder(750, 60)).toEqual({ whole: 12, remainderMeters: 30 });
    });

    it('sobra menor que uma unidade (4 m com barra de 6 m → 0 barra + 4 m)', () => {
      expect(splitWholeAndRemainder(4, 6)).toEqual({ whole: 0, remainderMeters: 4 });
    });

    it('sem tamanho definido, tudo vira sobra em metros', () => {
      expect(splitWholeAndRemainder(42, 0)).toEqual({ whole: 0, remainderMeters: 42 });
    });

    it('a venda de meio metro consome exatamente da sobra (6 m → 12 cortes de 0,5)', () => {
      // Prova a razão de manter o ledger em metros: 12 vendas de 0,5 m zeram a barra sem resíduo.
      let meters = metersFromWhole(1, 6); // 1 barra = 6 m
      for (let i = 0; i < 12; i++) meters = Number((meters - 0.5).toFixed(4));
      expect(meters).toBe(0);
      expect(splitWholeAndRemainder(meters, 6)).toEqual({ whole: 0, remainderMeters: 0 });
    });
  });

  describe('isClosedPrimary / sellsByMeter (detecção)', () => {
    it('barra/rolo com tamanho é unidade fechada principal', () => {
      expect(isClosedPrimary(barra6)).toBe(true);
      expect(isClosedPrimary({ unit: 'ROLL', conversionFactor: 100 })).toBe(true);
    });

    it('não pega produto comum nem EF-3 antigo (base fina + alt fechada)', () => {
      expect(isClosedPrimary({ unit: 'UNIT', conversionFactor: null })).toBe(false);
      expect(isClosedPrimary({ unit: 'METER', conversionFactor: 100 })).toBe(false); // EF-3 antigo
      expect(isClosedPrimary({ unit: 'BARRA', conversionFactor: 0 })).toBe(false); // sem tamanho
    });

    it('sellsByMeter só quando há preço por metro (opcional)', () => {
      expect(sellsByMeter(barra6)).toBe(true);
      expect(sellsByMeter(barraSemCorte)).toBe(false); // preço/metro vazio ⇒ só barra inteira
    });
  });

  describe('resolveClosedSale / closedStockMeters (preço + baixa em metros)', () => {
    it('barra inteira: preço da barra, baixa o tamanho em metros', () => {
      expect(resolveClosedSale(barra6, 'WHOLE')).toEqual({ unitPrice: 48, metersPerUnit: 6 });
      expect(closedStockMeters(barra6, 'WHOLE', 2)).toBe(12); // 2 barras = 12 m
    });

    it('por metro: preço por metro, baixa 1 m por metro vendido', () => {
      expect(resolveClosedSale(barra6, 'METER')).toEqual({ unitPrice: 9, metersPerUnit: 1 });
      expect(closedStockMeters(barra6, 'METER', 2.5)).toBe(2.5); // 2,5 m baixam 2,5 m
    });

    it('pedir METER sem preço por metro cai para barra inteira (fallback seguro)', () => {
      expect(resolveClosedSale(barraSemCorte, 'METER')).toEqual({ unitPrice: 48, metersPerUnit: 6 });
    });
  });
});
