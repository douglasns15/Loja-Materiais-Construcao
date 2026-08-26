import { createPrismaClient } from '@nexoloja/db';
import { type Bindings, getConnectionString } from './request';
import { withDbRetry } from './dbRetry';

/**
 * Keep-alive do pool de conexão (ADR-005). Mantém uma conexão de origem do Hyperdrive QUENTE para
 * que a PRIMEIRA operação real depois de um período ocioso não pague o cold start (Worker →
 * Hyperdrive → Supavisor → Supabase frios) e volte como 5xx — que hoje aparece como "Falha na
 * autenticação." ao confirmar venda ou como o fallback falso "recuperado do cache offline" no PDV.
 * Ver [[resiliencia-rede-failed-to-fetch]]: o retro (retry) é a rede de proteção; este keep-alive
 * ataca a CAUSA — reduz a frequência do cold start passando a absorvê-lo aqui, de fininho.
 *
 * Roda no handler `scheduled` do Worker (cron a cada 5 min). Invocação SEPARADA do `fetch`: NUNCA
 * concorre com nem bloqueia requisições reais (Workers escala horizontalmente; o `SELECT 1` pega
 * uma conexão do pool por poucos ms e devolve). NUNCA lança para fora — uma falha aqui é só
 * registrada e a próxima execução tenta de novo; nada disso pode derrubar o atendimento.
 */
export async function runKeepAlive(env: Bindings): Promise<void> {
  const connectionString = getConnectionString(env);
  if (!connectionString) {
    console.warn('keep-alive: sem connection string (HYPERDRIVE/DATABASE_URL) — pulando.');
    return;
  }
  try {
    const prisma = createPrismaClient(connectionString);
    // `SELECT 1` é o toque mais leve possível que ainda força o Hyperdrive a exercitar/renovar uma
    // conexão de origem. Reusa o `withDbRetry` para que um soluço na hora do keep-alive não conte
    // como "pool frio" indevidamente. Sucesso é SILENCIOSO (288 execuções/dia — não poluir os logs).
    await withDbRetry('keepAlive', () => prisma.$queryRaw`SELECT 1`);
  } catch (err) {
    console.warn(
      'keep-alive: falhou (o pool seguirá frio até a próxima execução) —',
      err instanceof Error ? err.message : err,
    );
  }
}
