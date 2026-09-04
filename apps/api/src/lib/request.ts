import type { Context } from 'hono';
import { createPrismaClient, type PrismaClient } from '@nexoloja/db';

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
  /**
   * Segredo (secret do Worker) que assina/verifica o token de SESSÃO DE SUPORTE (ADR-009,
   * Fatia E). Simétrico (HS256), nunca sai do Worker. Provisionar com `wrangler secret put
   * SUPPORT_TOKEN_SECRET`. Sem ele, iniciar suporte responde 503 (recurso indisponível).
   */
  SUPPORT_TOKEN_SECRET?: string;
  /** Bucket de mídia no Cloudflare R2 — logo da loja (ADR-007). */
  MEDIA?: R2Bucket;
  /**
   * Token do Bluesoft Cosmos (secret do Worker) para enriquecimento de EAN (ADR-025). OPCIONAL:
   * sem ele, a busca de EAN simplesmente pula o Cosmos e cai no cache global + Open Food Facts —
   * nunca gera custo nem erro. Provisionar com `wrangler secret put COSMOS_TOKEN` só se quiser
   * usar a base BR (free tier é rate-limited). O cache global absorve repetições e reduz chamadas.
   */
  COSMOS_TOKEN?: string;
};

/**
 * Dados do usuário autenticado, populados pelos middlewares de auth.
 * `tenantId`/`userId`/`role` vêm do `requireAuth` (usuário de loja).
 * Os campos `platformAdmin*` vêm do `requirePlatformAuth` (Super Usuário, ADR-009)
 * e só existem nas rotas `/platform/*` — usuário de loja não os popula, e vice-versa.
 */
export type Variables = {
  tenantId: string;
  userId: string;
  role: string;
  /** Nome do usuário autenticado (populado por `requireAuth`). Usado como snapshot na
   * atribuição de autoria ("Registrado por", ADR-010) ao criar/editar/movimentar registros. */
  userName: string;
  /** `Tenant.isActive` da loja do usuário (populado por `requireAuth`). Uma loja
   * inativada pelo Super Usuário (ADR-009) bloqueia operações novas (ex.: vendas). */
  tenantActive: boolean;
  platformAdminId: string;
  platformAdminName: string;
  platformAdminEmail: string;
  /** Escopo da SESSÃO DE SUPORTE (ADR-009, Fatia E), populado por `requireSupportSession` nas
   * rotas `/support/*`. `supportTenantId` é a loja-alvo que o token autoriza (read-only). */
  supportPlatformAdminId: string;
  supportTenantId: string;
  /**
   * Client Prisma com escopo da REQUISIÇÃO atual (ADR-005, "Conexão única por requisição").
   * Criado uma vez por request (no `requireAuth` ou sob demanda via `getPrisma`) e reusado pelos
   * handlers da MESMA request — 1 conexão por request em vez de 2. NUNCA reusar entre requests
   * (o Workers proíbe I/O cross-request; ver `createPrismaClient`).
   */
  prisma: PrismaClient;
};

export type Env = { Bindings: Bindings; Variables: Variables };

/** Resolve a string de conexão (Hyperdrive na edge; DATABASE_URL no dev local). */
export function getConnectionString(env: Bindings): string | null {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null;
}

/**
 * Client Prisma com escopo de REQUISIÇÃO (ADR-005, "Conexão única por requisição"). Cria o client
 * na 1ª chamada dentro da request e o guarda no contexto do Hono; chamadas seguintes NA MESMA
 * request (ex.: `requireAuth` e depois o handler) reusam a MESMA instância → 1 conexão por request
 * em vez de 2. Seguro porque o client nasce e morre dentro da request; NÃO cachear entre requests
 * (o Workers proíbe usar I/O de outra request — ver `createPrismaClient`). Lança se faltar a
 * connection string (o try/catch do chamador converte em erro amigável).
 */
export function getPrisma(c: Context<Env>): PrismaClient {
  const existing = c.get('prisma');
  if (existing) return existing;
  const connectionString = getConnectionString(c.env);
  if (!connectionString) {
    throw new Error('Sem conexão com o banco (HYPERDRIVE/DATABASE_URL ausente).');
  }
  const prisma = createPrismaClient(connectionString);
  c.set('prisma', prisma);
  return prisma;
}

/**
 * Tenant do usuário autenticado. Populado pelo middleware `requireAuth` a partir
 * do JWT verificado do Supabase Auth — não mais de um header confiável (Fase 2).
 */
export function getTenantId(c: Context<Env>): string | null {
  return c.get('tenantId') ?? null;
}
