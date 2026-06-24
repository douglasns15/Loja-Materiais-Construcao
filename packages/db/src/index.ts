import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Re-exporta tipos e enums gerados (UserRole, OrderStatus, etc.) para uso em apps/web e apps/api.
export * from '@prisma/client';

/**
 * Cria um PrismaClient usando o driver adapter `pg`.
 *
 * É a forma usada na API (Cloudflare Workers), onde o engine binário padrão do
 * Prisma não roda — a conexão chega pela edge via Hyperdrive/Supavisor (ADR-005).
 *
 * @param connectionString String de conexão Postgres (Hyperdrive ou DATABASE_URL).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let nodeClient: PrismaClient | undefined;

/**
 * Conveniência para ambientes Node de longa duração (scripts, seeds, testes).
 * Lazy — só instancia no primeiro uso para não inicializar o engine em bundles edge.
 * Usa a variável de ambiente DATABASE_URL.
 */
export function getPrismaClient(): PrismaClient {
  if (!nodeClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL não definida no ambiente.');
    }
    nodeClient = createPrismaClient(url);
  }
  return nodeClient;
}
