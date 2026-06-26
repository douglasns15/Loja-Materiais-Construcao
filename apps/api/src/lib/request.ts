import type { Context } from 'hono';
import { tenantIdSchema } from '@nexoloja/shared';

export type Bindings = {
  /** Conexão injetada pelo Cloudflare Hyperdrive (ADR-005). */
  HYPERDRIVE?: { connectionString: string };
  /** Fallback para desenvolvimento local (wrangler secret / .dev.vars). */
  DATABASE_URL?: string;
};

export type Env = { Bindings: Bindings };

/** Resolve a string de conexão (Hyperdrive na edge; DATABASE_URL no dev local). */
export function getConnectionString(env: Bindings): string | null {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null;
}

/**
 * TEMPORÁRIO (Fase 1): o tenant vem do header `x-tenant-id`.
 * Na Fase 2 será substituído pelo claim `tenant_id` do JWT do Supabase Auth + RLS.
 */
export function getTenantId(c: Context<Env>): string | null {
  const parsed = tenantIdSchema.safeParse(c.req.header('x-tenant-id'));
  return parsed.success ? parsed.data : null;
}
