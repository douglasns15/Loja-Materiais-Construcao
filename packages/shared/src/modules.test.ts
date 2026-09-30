import { describe, expect, it } from 'vitest';
import { activeModuleKeys, isOfflineSalesOn, setTenantModuleSchema } from './modules';
import { createTenantSchema } from './tenant';

// =============================================================================
// Módulos e ramo da loja (ADR-011 §9 + ADR-039)
// =============================================================================

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
