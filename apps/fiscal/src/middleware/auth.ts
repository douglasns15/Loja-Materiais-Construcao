/**
 * Autenticação serviço-a-serviço.
 *
 * Este Worker NÃO é chamado por navegador: só a API de negócio (`nexoloja-api`)
 * fala com ele. Por isso a proteção é um **segredo compartilhado** no header
 * `X-Fiscal-Token`, e não o JWT do Supabase — o usuário final não tem, nem deve
 * ter, credencial para emitir nota diretamente.
 *
 * Falha FECHADA: sem `FISCAL_SERVICE_TOKEN` configurado, tudo é recusado. Um
 * serviço que emite documento fiscal jamais deve ficar aberto por descuido de
 * configuração.
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';

/**
 * Comparação de tokens em tempo constante, para não vazar o segredo pelo tempo
 * de resposta. Compara todos os bytes mesmo quando já diverge.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const requireServiceToken = createMiddleware<Env>(async (c, next) => {
  const expected = c.env.FISCAL_SERVICE_TOKEN;
  if (!expected) {
    console.error('FISCAL_SERVICE_TOKEN não configurado — recusando por segurança.');
    return c.json({ ok: false, error: 'Serviço fiscal indisponível.' }, 503);
  }

  const provided = c.req.header('X-Fiscal-Token');
  if (!provided || !safeEqual(provided, expected)) {
    return c.json({ ok: false, error: 'Não autorizado.' }, 401);
  }

  await next();
});
