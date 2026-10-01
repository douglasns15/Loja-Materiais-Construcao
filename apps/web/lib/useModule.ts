'use client';

import { useEffect, useState } from 'react';
import { moduleEnabled, type TenantModuleKey } from '@nexoloja/shared';
import { ME_UPDATED_EVENT, readCachedMe } from './meCache';

/**
 * `true` se o módulo está ligado para a loja (ADR-039 F2) — o helper ÚNICO para esconder da tela o
 * que o ramo não usa (ex.: `useModule('CONSTRUCTION_UNITS')` esconde milheiro/saco/barra, par e peso).
 *
 * Não faz requisição: lê os módulos do cache do `/me` (que o shell já atualiza a cada carga) e
 * escuta `ME_UPDATED_EVENT` para refletir o `/me` recém-chegado. Lê no efeito (não no render) para
 * não divergir da hidratação. Sem cache/lista ⇒ regra de retrocompatibilidade do `moduleEnabled`
 * (obra ligada) — loja existente nunca perde recurso por engano.
 *
 * Gating é de APRESENTAÇÃO (ADR-039 §3): a API não recusa dado de módulo desligado.
 */
export function useModule(key: TenantModuleKey): boolean {
  const [modules, setModules] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    const read = () => setModules(readCachedMe()?.modules);
    read();
    window.addEventListener(ME_UPDATED_EVENT, read);
    return () => window.removeEventListener(ME_UPDATED_EVENT, read);
  }, []);

  return moduleEnabled(modules, key);
}
