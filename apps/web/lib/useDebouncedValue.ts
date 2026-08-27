'use client';

import { useEffect, useState } from 'react';

/**
 * Valor "atrasado": segue `value`, mas só depois de `delayMs` sem novas mudanças. Usado nos
 * Relatórios para que navegar RÁPIDO nas setas de período (‹ ›) não dispare uma rajada de requests
 * a cada clique — a UI do filtro atualiza na hora (usa o valor cru), mas as buscas de dados só
 * disparam UMA vez, quando o usuário para. Reduz a chance de saturar o pool frio do free tier
 * (cold start, ADR-005). Inicializa igual a `value` (o 1º carregamento não espera).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
