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
 * `transactionOptions` afrouxa os prazos das transações INTERATIVAS (`$transaction(cb)`)
 * para o cenário de COLD START do free tier: na 1ª venda depois de ociosa, o pool
 * (Hyperdrive→Supavisor→Supabase) está frio e a transação do `/orders` — que faz várias
 * escritas em série (número do pedido, pedido, itens, pagamentos, movimentos de estoque,
 * razão) — passava dos 5 s do PADRÃO do Prisma. Ao estourar, o Prisma aborta a transação e
 * o resto do callback vê "Transaction not found", devolvendo 500 ao caixa. Subimos o
 * `timeout` (5 s → 20 s: tempo máximo da transação rodando) e o `maxWait` (2 s → 10 s: espera
 * para pegar conexão do pool). Vale para TODAS as transações (venda/cancelamento/devolução/
 * estoque). O `cpuTime` real é ~200 ms — a folga cobre a espera de I/O, não processamento.
 *
 * @param connectionString String de conexão Postgres (Hyperdrive ou DATABASE_URL).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
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
