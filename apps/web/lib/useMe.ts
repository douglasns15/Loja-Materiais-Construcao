'use client';

import { useEffect, useState } from 'react';
import type { StoreRole } from '@nexoloja/shared';
import { apiGet } from './api';
import { cacheOfflineSales, readCachedOfflineSales } from './offlineFlag';
import { cacheMe, readCachedMe } from './meCache';

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
