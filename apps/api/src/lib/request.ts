import type { Context } from 'hono';

export type Bindings = {
  /** Conexão injetada pelo Cloudflare Hyperdrive (ADR-005). */
  HYPERDRIVE?: { connectionString: string };
  /** Fallback para desenvolvimento local (wrangler secret / .dev.vars). */
  DATABASE_URL?: string;
  /** URL do projeto Supabase (para verificar o JWT via JWKS). */
  SUPABASE_URL?: string;
  /**
   * Chave `service_role` do Supabase (secret do Worker) — usada só para operações
   * administrativas do Auth (convite de usuário por e-mail, ADR-008 fatia 2). NUNCA
   * expor ao cliente: ignora o RLS. Provisionar com `wrangler secret put`.
   */
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Bucket de mídia no Cloudflare R2 — logo da loja (ADR-007). */
  MEDIA?: R2Bucket;
};

/** Dados do usuário autenticado, populados pelo middleware `requireAuth`. */
export type Variables = {
  tenantId: string;
  userId: string;
  role: string;
};

export type Env = { Bindings: Bindings; Variables: Variables };

/** Resolve a string de conexão (Hyperdrive na edge; DATABASE_URL no dev local). */
export function getConnectionString(env: Bindings): string | null {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null;
}

/**
 * Tenant do usuário autenticado. Populado pelo middleware `requireAuth` a partir
 * do JWT verificado do Supabase Auth — não mais de um header confiável (Fase 2).
 */
export function getTenantId(c: Context<Env>): string | null {
  return c.get('tenantId') ?? null;
}
