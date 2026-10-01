import { describe, expect, it } from 'vitest';
import {
  activeModuleKeys,
  CONSTRUCTION_UNIT_TYPES,
  isOfflineSalesOn,
  moduleEnabled,
  setTenantModuleSchema,
  visibleUnitTypes,
} from './modules';
import { createTenantSchema } from './tenant';

// =============================================================================
// Módulos e ramo da loja (ADR-011 §9 + ADR-039)
// =============================================================================

describe('moduleEnabled (gate de UI — ADR-039 §3)', () => {
  it('lista do /me: ligado só se a chave está nela', () => {
    expect(moduleEnabled(['SCALE_LABEL'], 'SCALE_LABEL')).toBe(true);
    expect(moduleEnabled(['SCALE_LABEL'], 'CONSTRUCTION_UNITS')).toBe(false);
    expect(moduleEnabled([], 'CONSTRUCTION_UNITS')).toBe(false);
  });

  it('sem lista (API antiga / sem cache): obra LIGADA, o resto desligado', () => {
    expect(moduleEnabled(undefined, 'CONSTRUCTION_UNITS')).toBe(true);
    expect(moduleEnabled(null, 'CONSTRUCTION_UNITS')).toBe(true);
    expect(moduleEnabled(undefined, 'SCALE_LABEL')).toBe(false);
    expect(moduleEnabled(undefined, 'OFFLINE_SALES')).toBe(false);
  });
});

describe('visibleUnitTypes', () => {
  it('loja de construção vê todas as unidades', () => {
    expect(visibleUnitTypes(true)).toHaveLength(11);
  });

  it('sem o módulo de obra: só unidade, kg, litro e pacote (na ordem do enum)', () => {
    expect(visibleUnitTypes(false)).toEqual(['UNIT', 'KILOGRAM', 'LITER', 'PACK']);
  });

  it('preserva a unidade já gravada no produto mesmo com o módulo desligado', () => {
    expect(visibleUnitTypes(false, ['BARRA'])).toEqual(['UNIT', 'KILOGRAM', 'LITER', 'BARRA', 'PACK']);
    expect(visibleUnitTypes(false, ['', null, undefined])).toEqual(['UNIT', 'KILOGRAM', 'LITER', 'PACK']);
  });

  it('as unidades de obra são exatamente as 7 do ADR-039', () => {
    expect([...CONSTRUCTION_UNIT_TYPES].sort()).toEqual(
      ['BAG', 'BARRA', 'CUBIC_METER', 'METER', 'ROLL', 'SQUARE_METER', 'THOUSAND'],
    );
  });
});

describe('activeModuleKeys', () => {
  it('devolve só as chaves ativas', () => {
    expect(
      activeModuleKeys([
        { moduleKey: 'CONSTRUCTION_UNITS', isActive: true },
        { moduleKey: 'OFFLINE_SALES', isActive: false },
        { moduleKey: 'SCALE_LABEL', isActive: true },
      ]),
    ).toEqual(['CONSTRUCTION_UNITS', 'SCALE_LABEL']);
  });

  it('nulo/vazio = nenhum módulo', () => {
    expect(activeModuleKeys(null)).toEqual([]);
    expect(activeModuleKeys([])).toEqual([]);
  });

  it('offline continua avaliado pela sua própria chave', () => {
    expect(isOfflineSalesOn([{ moduleKey: 'CONSTRUCTION_UNITS', isActive: true }])).toBe(false);
  });
});

describe('setTenantModuleSchema', () => {
  it('aceita os módulos de ramo e o offline', () => {
    for (const moduleKey of ['OFFLINE_SALES', 'CONSTRUCTION_UNITS', 'SCALE_LABEL']) {
      expect(setTenantModuleSchema.safeParse({ moduleKey, isActive: true }).success).toBe(true);
    }
  });

  it('recusa chave desconhecida', () => {
    expect(setTenantModuleSchema.safeParse({ moduleKey: 'RECIPES', isActive: true }).success).toBe(false);
  });
});

describe('createTenantSchema — ramo (ADR-039)', () => {
  const base = { name: 'Mercadinho da Ana', adminEmail: 'ana@example.com' };

  it('sem ramo informado assume construção (compatível com o onboarding antigo)', () => {
    const r = createTenantSchema.parse(base);
    expect(r.segments).toEqual(['CONSTRUCTION']);
  });

  it('aceita multisseleção de ramos + categorias iniciais', () => {
    const r = createTenantSchema.parse({
      ...base,
      segments: ['GROCERY', 'ICE_CREAM', 'ROTISSERIE'],
      seedCategories: ['Mercearia', ' Picolés '],
    });
    expect(r.segments).toEqual(['GROCERY', 'ICE_CREAM', 'ROTISSERIE']);
    expect(r.seedCategories).toEqual(['Mercearia', 'Picolés']);
  });

  it('recusa lista de ramos vazia e ramo desconhecido', () => {
    expect(createTenantSchema.safeParse({ ...base, segments: [] }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, segments: ['PHARMACY'] }).success).toBe(false);
  });
});
