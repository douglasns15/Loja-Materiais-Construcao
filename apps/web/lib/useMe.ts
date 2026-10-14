'use client';

import { useEffect, useState } from 'react';
import type { ScaleLabelLayoutInput, StoreRole } from '@nexoloja/shared';
import { apiGet } from './api';
import { cacheOfflineSales, readCachedOfflineSales } from './offlineFlag';
import { cacheMe, readCachedMe } from './meCache';
import { getActiveTenantId, setActiveTenantId } from './activeTenant';

export type Me = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  storeRole: StoreRole;
  /** `false` quando a loja foi desativada pelo Super Usuário (ADR-009). Opcional para
   * tolerar respostas antigas da API (ausente = tratado como ativa). */
  tenantActive?: boolean;
  /** `true` quando o módulo `OFFLINE_SALES` está ligado para a loja (ADR-011 §9). O PDV usa
   * para decidir enfileirar venda offline (ON) ou orientar nota manual (OFF). Opcional para
   * tolerar respostas antigas da API (ausente = OFF). */
  offlineSales?: boolean;
  /** Chaves dos módulos ATIVOS da loja (ADR-039: `CONSTRUCTION_UNITS`, `SCALE_LABEL`, …), para a
   * web esconder o que o ramo não usa. Vai junto no cache do `/me` (offline). Opcional para tolerar
   * respostas antigas da API. */
  modules?: string[];
  /** Layout da etiqueta de balança (ADR-040 §3) quando o módulo `SCALE_LABEL` está ligado; `null`
   * desligado. Vai no cache do `/me` — o PDV lê etiqueta também offline. Opcional (API antiga). */
  scaleLabel?: ScaleLabelLayoutInput | null;
  /** Loja ativa desta resposta e o nome dela (ADR-014). Opcionais: API antiga não manda. */
  activeTenantId?: string;
  tenantName?: string | null;
  /** Lojas a que a pessoa tem acesso — com 2+, o shell mostra a loja atual e "Trocar de loja". */
  stores?: { tenantId: string; name: string; role: string; storeRole: StoreRole; tenantActive: boolean }[];
};

/**
 * Carrega o perfil do usuário autenticado (`GET /me`) para o RBAC do front —
 * esconder telas/ações conforme o papel. `loading` cobre o estado inicial.
 * A segurança de verdade é na API (o front só melhora a UX).
 */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const data = await apiGet<Me>('/me');
      setMe(data);
      // Persiste o perfil p/ o cold start / navegação offline (CS-3): a navegação por reload remonta o
      // shell e o `/me` falha sem rede — o cache preserva papel (isAdmin)/nome. Também persiste o flag
      // OFFLINE_SALES (ADR-011 §9) para o fallback do PDV.
      cacheMe(data);
      // Loja ativa (ADR-014): quem tem uma loja só (ou veio de uma versão antiga do app) passa a mandar
      // o `x-active-tenant` a partir daqui — a escolha fica explícita em toda chamada.
      if (data.activeTenantId && !getActiveTenantId()) setActiveTenantId(data.activeTenantId);
      cacheOfflineSales(data.offlineSales === true);
    } catch {
      // Offline: usa o último `/me` bom (papel/nome preservados, decisão (a) do ADR-012). Online, uma
      // falha é auth de verdade (ex.: 403 de usuário desativado) → sem shell (não cai no cache).
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      setMe(offline ? readCachedMe() : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Flag efetivo p/ a UI: o valor do `/me` quando disponível; senão, o cache do último `/me` OK
  // (cold start offline). Nunca liga o recurso "por engano" — sem cache, cai em OFF.
  const offlineSales = me ? me.offlineSales === true : readCachedOfflineSales();

  return { me, setMe, loading, refresh, isAdmin: me?.storeRole === 'ADMIN', offlineSales };
}
