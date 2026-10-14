import { describe, expect, it } from 'vitest';
import { membershipChangeBlocked, planMembershipInvite, resolveActiveStore } from './index';

// =============================================================================
// Usuário multi-loja — loja ativa da requisição (ADR-014, Fatia 2)
// =============================================================================

const A = { tenantId: 'ff92dd03-c769-4e77-92a5-a6d3f529a0a3', role: 'MANAGER' };
const B = { tenantId: '6bd701b8-f23d-4689-99aa-a94b92ac9829', role: 'OWNER' };

describe('resolveActiveStore', () => {
  it('uma loja só e sem header: entra direto (comportamento de hoje)', () => {
    expect(resolveActiveStore([B], undefined)).toEqual({ ok: true, membership: B });
    expect(resolveActiveStore([B], '  ')).toEqual({ ok: true, membership: B });
  });

  it('várias lojas: o header escolhe, inclusive com maiúsculas no UUID', () => {
    expect(resolveActiveStore([A, B], A.tenantId)).toEqual({ ok: true, membership: A });
    expect(resolveActiveStore([A, B], B.tenantId.toUpperCase())).toEqual({ ok: true, membership: B });
  });

  it('várias lojas sem header: pede o seletor', () => {
    expect(resolveActiveStore([A, B], null)).toEqual({ ok: false, reason: 'SELECT_STORE' });
  });

  it('loja da qual não é membro (ou revogada): recusa, nunca cai em outra loja', () => {
    const outra = 'd3e6f6d8-8888-4048-9690-aefa1506fb89';
    expect(resolveActiveStore([A, B], outra)).toEqual({ ok: false, reason: 'NOT_MEMBER' });
    expect(resolveActiveStore([B], outra)).toEqual({ ok: false, reason: 'NOT_MEMBER' });
    expect(resolveActiveStore([B], 'nao-e-uuid')).toEqual({ ok: false, reason: 'NOT_MEMBER' });
    expect(resolveActiveStore([B], `${B.tenantId}' or '1'='1`)).toEqual({ ok: false, reason: 'NOT_MEMBER' });
  });

  it('nenhum vínculo ativo: sem acesso', () => {
    expect(resolveActiveStore([], undefined)).toEqual({ ok: false, reason: 'NO_ACCESS' });
    expect(resolveActiveStore([], B.tenantId)).toEqual({ ok: false, reason: 'NOT_MEMBER' });
  });
});

describe('planMembershipInvite (anti-sequestro, ADR-014 §4)', () => {
  it('e-mail sem conta: convite normal (definir a senha é o aceite)', () => {
    expect(planMembershipInvite(false, null)).toBe('NEW_IDENTITY');
  });
  it('conta existente nunca ganha acesso sem aceite', () => {
    expect(planMembershipInvite(true, null)).toBe('CREATE_PENDING');
    expect(planMembershipInvite(true, { status: 'PENDING', isActive: true })).toBe('REFRESH_PENDING');
    expect(planMembershipInvite(true, { status: 'ACTIVE', isActive: false })).toBe('REINVITE');
  });
  it('já é membro ativo: nada a fazer', () => {
    expect(planMembershipInvite(true, { status: 'ACTIVE', isActive: true })).toBe('ALREADY_MEMBER');
  });
});

describe('membershipChangeBlocked', () => {
  it('não mexe no próprio vínculo nem no do dono', () => {
    expect(membershipChangeBlocked('a', 'a', 'CASHIER')).toBe('SELF');
    expect(membershipChangeBlocked('a', 'b', 'OWNER')).toBe('OWNER');
    expect(membershipChangeBlocked('a', 'b', 'MANAGER')).toBeNull();
  });
});
