import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Re-exporta tipos e enums gerados (UserRole, OrderStatus, etc.) para uso em apps/web e apps/api.
export * from '@prisma/client';

/**
 * Cria um PrismaClient usando o driver adapter `pg`. **UMA instância por chamada** — de propósito.
 *
 * ⚠️ NÃO cachear/reusar este client (nem o `pg.Pool` interno) ENTRE requests do Worker. Foi tentado
 * (ADR-005, "parte B": um `Map` por connection string, vivo pelo isolate) para cortar o churn de
 * conexões da rajada de concorrência — e **quebrou em produção**: o Cloudflare Workers proíbe usar
 * um objeto de I/O (o socket do pool, aberto no contexto de UMA request) em OUTRA request → 500
 * "Cannot perform I/O on behalf of a different request". Sintoma medido: ~50% das requisições
 * falhando (1 falha / 1 ok, alternado), MUITO pior que o soluço intermitente que se queria resolver.
 * Revertido para criação por chamada (estado conhecido-bom). O churn segue mitigado pela camada de
 * cima (keep-alive + retry do `apiGet`) e pela auto-recuperação da tela; a redução real do churn
 * (uma instância por REQUEST, compartilhada entre `requireAuth` e o handler) exige injeção via
 * contexto do Hono (`c.set('prisma')`), que é seguro por ser DENTRO da mesma request — fica para
 * uma fatia futura. É a API (Cloudflare Workers) onde o engine binário padrão do Prisma não roda —
 * a conexão chega pela edge via Hyperdrive/Supavisor.
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
