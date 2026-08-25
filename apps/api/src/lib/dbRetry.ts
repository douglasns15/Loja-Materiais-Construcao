/**
 * Retry curto para consultas de LEITURA ao Postgres que tropeçam no COLD START do free tier.
 *
 * A stack de dados (Worker → Hyperdrive → Supavisor → Supabase) esfria entre requisições: a 1ª
 * consulta depois de ociosa pode falhar ao estabelecer/reusar a conexão (reset, timeout, "Can't
 * reach database") e a seguinte, com a conexão quente, já funciona. Sem esse retry, esse soluço
 * vira um 500 na cara do operador — no `requireAuth` ele aparece como "Falha na autenticação."
 * (a query do usuário lançou, NÃO o token), e no PDV vira o fallback "recuperado do cache offline".
 *
 * Só envolver operações IDEMPOTENTES (SELECTs / `findUnique`): re-executar uma leitura é seguro.
 * NÃO usar em escritas nem em `$transaction` (o afrouxamento de prazo dessas fica no
 * `transactionOptions` do `createPrismaClient`). Um erro determinístico (bug de query) simplesmente
 * falha as poucas tentativas e propaga como antes — o retry só mascara a intermitência de conexão.
 */

const DB_RETRIES = 2; // tentativas totais = 1 + DB_RETRIES
const DB_BACKOFF_MS = [150, 500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Executa `fn` (uma leitura ao banco) com re-tentativas curtas em caso de exceção. Devolve o
 * resultado no primeiro sucesso; se todas falharem, relança o ÚLTIMO erro para o chamador tratar
 * como faria hoje (log + resposta amigável). O `label` só enriquece o `console.warn` de diagnóstico.
 */
export async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= DB_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === DB_RETRIES) break;
      console.warn(
        `db ${label}: falha transitória, re-tentando (${attempt + 1}/${DB_RETRIES})`,
        err instanceof Error ? err.message : err,
      );
      await sleep(DB_BACKOFF_MS[attempt] ?? 500);
    }
  }
  throw lastErr;
}
