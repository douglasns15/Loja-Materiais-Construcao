import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Re-exporta tipos e enums gerados (UserRole, OrderStatus, etc.) para uso em apps/web e apps/api.
export * from '@prisma/client';

/**
 * Cache de `PrismaClient` por CONNECTION STRING, vivo pelo tempo do isolate (ADR-005 — rajada de
 * concorrência). Antes, `createPrismaClient` era chamado a cada camada: uma vez no `requireAuth`
 * (leitura do usuário) e DE NOVO dentro de cada handler — e cada chamada instanciava um `pg.Pool`
 * novo. Abrir o PDV dispara ~5-6 requests em paralelo (`/me`, `/alerts`, `/tenant`,
 * `/cash-sessions/current`, `/products`, carrinho); com 2 clients por request, isso abria ~10-12
 * conexões de uma vez. O keep-alive mantém só UMA conexão quente, então a rajada abria conexões
 * FRIAS que estouravam a janela de retry → 500 no `/cash-sessions/current` → o falso "caixa
 * recuperado do cache offline" (ver [[pdv-caixa-auto-recuperacao-offline]]). Cachear o client:
 *   - (A) uma única instância por request — auth e handler compartilham (a connection string é a
 *     mesma), cortando as conexões por request de 2 → 1;
 *   - (B) reuso ENTRE requests do mesmo isolate — quase zera o churn de abrir pools.
 * Seguro neste código: NINGUÉM chama `$disconnect()`/`pool.end()` por request (os pools de hoje já
 * vivem até o isolate morrer — só que sem reuso, vazando); o `pg.Pool` cacheado se auto-cura de
 * conexões mortas e o `withDbRetry` cobre o soluço transitório. O cache é lazy (criado DENTRO da
 * request, nunca no escopo de módulo) — o padrão aceito no Workers. A `connectionString` do
 * Hyperdrive é estável por isolate, então serve de chave.
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
const clientCache = new Map<string, PrismaClient>();

export function createPrismaClient(connectionString: string): PrismaClient {
  const cached = clientCache.get(connectionString);
  if (cached) return cached;
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
  clientCache.set(connectionString, client);
  return client;
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
