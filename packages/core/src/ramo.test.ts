import { describe, expect, it } from 'vitest';
import { SEGMENT_PRESETS, modulesForSegments, suggestedCategoriesForSegments } from './index';

// =============================================================================
// Ramo da loja → módulos e categorias sugeridas (ADR-039)
// =============================================================================

describe('modulesForSegments', () => {
  it('construção liga as unidades de obra (backfill das lojas atuais)', () => {
    expect(modulesForSegments(['CONSTRUCTION'])).toEqual(['CONSTRUCTION_UNITS']);
  });

  it('mercadinho + sorveteria + rotisseria: união sem repetição (balança + produção da rotisseria)', () => {
    expect(modulesForSegments(['GROCERY', 'ICE_CREAM', 'ROTISSERIE'])).toEqual(['SCALE_LABEL', 'RECIPES']);
  });

  it('só a rotisseria liga a produção com ficha técnica (ADR-043)', () => {
    expect(modulesForSegments(['GROCERY', 'ICE_CREAM'])).not.toContain('RECIPES');
    expect(modulesForSegments(['ROTISSERIE'])).toContain('RECIPES');
  });

  it('ramos misturados ligam os módulos de todos', () => {
    expect(modulesForSegments(['CONSTRUCTION', 'GROCERY'])).toEqual(['CONSTRUCTION_UNITS', 'SCALE_LABEL']);
  });

  it('varejo geral e lista vazia não ligam nada', () => {
    expect(modulesForSegments(['GENERAL_RETAIL'])).toEqual([]);
    expect(modulesForSegments([])).toEqual([]);
  });

  it('ramo desconhecido é ignorado', () => {
    expect(modulesForSegments(['PHARMACY', 'GROCERY'])).toEqual(['SCALE_LABEL']);
  });

  it('nenhum ramo liga venda offline (é plano pago, não ramo)', () => {
    const all = modulesForSegments(Object.keys(SEGMENT_PRESETS));
    expect(all).not.toContain('OFFLINE_SALES');
  });
});

describe('suggestedCategoriesForSegments', () => {
  it('um ramo devolve as categorias do preset', () => {
    expect(suggestedCategoriesForSegments(['ICE_CREAM'])).toEqual([
      'Sorvete por kg',
      'Picolés',
      'Açaí',
      'Coberturas e adicionais',
    ]);
  });

  it('vários ramos: união na ordem dos ramos, sem repetir', () => {
    const cats = suggestedCategoriesForSegments(['GROCERY', 'ROTISSERIE', 'GROCERY']);
    expect(cats[0]).toBe('Mercearia');
    expect(cats).toContain('Assados');
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('varejo geral não sugere categoria', () => {
    expect(suggestedCategoriesForSegments(['GENERAL_RETAIL'])).toEqual([]);
  });
});
