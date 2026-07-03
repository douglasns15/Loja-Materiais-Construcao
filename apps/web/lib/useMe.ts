'use client';

import { useEffect, useState } from 'react';
import type { StoreRole } from '@nexoloja/shared';
import { apiGet } from './api';

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
      setMe(await apiGet<Me>('/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { me, setMe, loading, refresh, isAdmin: me?.storeRole === 'ADMIN' };
}
