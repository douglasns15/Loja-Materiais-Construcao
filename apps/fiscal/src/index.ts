/**
 * NexoLoja — serviço de emissão fiscal (NFC-e).
 *
 * Worker separado da API de negócio: isola o certificado digital e as
 * credenciais do provedor, tem deploy próprio e não conflita com o
 * desenvolvimento em paralelo do restante do produto.
 *
 * Estado atual (primeira fatia): domínio + porta do provedor + adaptador fake.
 * Ainda **não** há adaptador real nem persistência em banco — ver README.md.
 */

import { Hono } from 'hono';
import type { Env } from './env';
import { readEnvironment } from './env';
import { requireServiceToken } from './middleware/auth';
import nfce from './routes/nfce';

const app = new Hono<Env>();

/** Sonda de saúde — pública, sem segredo, para smoke test pós-deploy. */
app.get('/health', (c) => {
  const provider = c.env.FISCAL_PROVIDER ?? 'fake';
  const environment = readEnvironment(c.env);
  return c.json({
    ok: true,
    service: 'nexoloja-fiscal',
    provider,
    environment,
    // Sinaliza alto e claro que nada aqui tem valor fiscal ainda.
    fiscalValue: provider === 'fake' || environment === 'homologacao' ? false : true,
  });
});

/**
 * Trava de segurança: o adaptador "fake" NUNCA pode servir produção.
 * É uma simulação — deixá-lo responder em `producao` significaria entregar ao
 * lojista uma nota que não existe para a SEFAZ.
 *
 * Escopo em `/nfce/*` (e não `*`) de propósito: o `/health` precisa continuar
 * respondendo mesmo com configuração inválida, senão fica impossível diagnosticar.
 */
app.use('/nfce/*', async (c, next) => {
  const provider = c.env.FISCAL_PROVIDER ?? 'fake';
  if (provider === 'fake' && readEnvironment(c.env) === 'producao') {
    console.error('Configuração inválida: adaptador "fake" com FISCAL_ENVIRONMENT=producao.');
    return c.json(
      { ok: false, error: 'Configuração fiscal inválida — serviço bloqueado por segurança.' },
      503,
    );
  }
  await next();
});

// Emissão exige o token de serviço (a API de negócio é o único cliente).
app.use('/nfce/*', requireServiceToken);
app.route('/nfce', nfce);

app.notFound((c) => c.json({ ok: false, error: 'Rota não encontrada.' }, 404));

app.onError((error, c) => {
  console.error('Erro não tratado no serviço fiscal:', error);
  return c.json({ ok: false, error: 'Erro interno no serviço fiscal.' }, 500);
});

export default app;
