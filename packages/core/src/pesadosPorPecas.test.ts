import { describe, expect, it } from 'vitest';
import { approxPieces, pieceEntryLabel, sumPieceWeights, wholeOfWeighedSale } from './index';

// =============================================================================
// ESTOQUE DE PESADOS POR PEÇAS (ADR-040 §4) — entrada por peças, "≈ N peças", última peça
// =============================================================================

describe('sumPieceWeights (entrada por peças)', () => {
  it('soma as peças e calcula a média (3 casas)', () => {
    expect(sumPieceWeights([4.2, 3.9, 4.4])).toEqual({ pieces: 3, total: 12.5, average: 4.167 });
  });
  it('uma peça só', () => {
    expect(sumPieceWeights([1.25])).toEqual({ pieces: 1, total: 1.25, average: 1.25 });
  });
  it('sem ruído de ponto flutuante', () => {
    expect(sumPieceWeights([0.1, 0.2])?.total).toBe(0.3);
  });
  it('lista vazia ou peso inválido não vale', () => {
    expect(sumPieceWeights([])).toBeNull();
    expect(sumPieceWeights([1.2, 0])).toBeNull();
    expect(sumPieceWeights([1.2, -1])).toBeNull();
    expect(sumPieceWeights([Number.NaN])).toBeNull();
  });
});

describe('pieceEntryLabel (motivo da entrada)', () => {
  it('lista as peças quando cabe', () => {
    expect(pieceEntryLabel([4.2, 3.9, 4.4], 'kg')).toBe('3 peças: 4,200 + 3,900 + 4,400 kg');
    expect(pieceEntryLabel([1.25], 'kg')).toBe('1 peça: 1,250 kg');
  });
  it('resume quando não cabe', () => {
    const muitas = Array.from({ length: 12 }, () => 1.05);
    expect(pieceEntryLabel(muitas, 'kg')).toBe('12 peças · 12,600 kg (média 1,050 kg)');
  });
  it('lista inválida vira texto vazio', () => {
    expect(pieceEntryLabel([], 'kg')).toBe('');
  });
});

describe('approxPieces ("≈ N peças")', () => {
  it('saldo ÷ peso médio, arredondado', () => {
    expect(approxPieces(12.4, 1.2)).toBe(10);
    expect(approxPieces(1.1, 1.2)).toBe(1);
  });
  it('sem peso médio ou sem saldo não mostra', () => {
    expect(approxPieces(12, null)).toBeNull();
    expect(approxPieces(12, 0)).toBeNull();
    expect(approxPieces(0, 1.2)).toBeNull();
    expect(approxPieces(-1, 1.2)).toBeNull();
  });
});

describe('wholeOfWeighedSale (regra da última peça)', () => {
  it('cabe normalmente: baixa o peso médio', () => {
    expect(wholeOfWeighedSale(2, 1.2, 10)).toEqual({ fits: true, baseQty: 2.4 });
  });
  it('último frango mais leve que a média: libera e zera o estoque', () => {
    expect(wholeOfWeighedSale(1, 1.2, 1.1)).toEqual({ fits: true, baseQty: 1.1 });
  });
  it('duas últimas peças (2,3 kg, média 1,2): libera as 2', () => {
    expect(wholeOfWeighedSale(2, 1.2, 2.3)).toEqual({ fits: true, baseQty: 2.3 });
  });
  it('mais inteiros do que as peças que restam: trava', () => {
    expect(wholeOfWeighedSale(3, 1.2, 2.3).fits).toBe(false);
  });
  it('sem estoque: trava', () => {
    expect(wholeOfWeighedSale(1, 1.2, 0).fits).toBe(false);
  });
});
