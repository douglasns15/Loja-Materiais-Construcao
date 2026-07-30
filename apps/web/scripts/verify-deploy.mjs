/**
 * Smoke pós-deploy do web — trava de regressão do incidente "abre SEM CSS após deploy" (2026-07-29).
 *
 * Causa raiz do incidente: o HTML dos documentos era servido com `s-maxage=31536000` (1 ano) e ficava
 * preso no cache de borda (POP) da Cloudflare; num deploy que troca o hash do CSS/JS, um POP com o HTML
 * antigo seguia apontando para assets que sumiram → 404 → página sem estilo. A correção (force-dynamic +
 * `no-store` nos documentos) impede isso. Este script GARANTE que a correção continua valendo em produção,
 * checando as DUAS invariantes de que o bug depende, e falha (exit 1) se qualquer uma regredir:
 *
 *   1) o HTML do documento volta com `Cache-Control: no-store` (e NUNCA `s-maxage`) → nenhum POP guarda
 *      HTML velho;
 *   2) TODO CSS `/_next/static/` referenciado no HTML fresco responde 200 → o HTML nunca aponta para um
 *      hash inexistente.
 *
 * Uso:
 *   node scripts/verify-deploy.mjs [url-base]
 *   DEPLOY_URL=https://... node scripts/verify-deploy.mjs
 *
 * Sem argumento, usa a URL de produção padrão. É rodado automaticamente após `npm run deploy`
 * (script `postdeploy`), então todo deploy é verificado sem depender de conferência manual.
 */

const BASE = (process.argv[2] || process.env.DEPLOY_URL || 'https://nexoloja-web.imortal.workers.dev')
  .replace(/\/$/, '');

// Rota pública que renderiza HTML completo (com os <link> de CSS). Login não exige sessão.
const DOC_PATH = '/login';

const problems = [];
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => {
  console.log(`  ❌ ${msg}`);
  problems.push(msg);
};

async function main() {
  console.log(`\nSmoke pós-deploy do web — ${BASE}${DOC_PATH}\n`);

  // (1) O documento HTML não pode ser cacheável em borda (senão volta o incidente).
  let res;
  try {
    res = await fetch(`${BASE}${DOC_PATH}`, { redirect: 'manual' });
  } catch (err) {
    bad(`falha ao buscar o documento: ${err.message}`);
    return finish();
  }
  if (res.status !== 200) {
    bad(`documento não retornou 200 (status ${res.status})`);
    return finish();
  }
  const cc = (res.headers.get('cache-control') || '').toLowerCase();
  if (cc.includes('no-store')) ok(`HTML com Cache-Control: ${cc || '(vazio)'}`);
  else bad(`HTML sem "no-store" (Cache-Control: "${cc || '(vazio)'}") — pode ser cacheado em borda`);
  if (cc.includes('s-maxage')) bad(`HTML com "s-maxage" — exatamente o que causou o incidente de 2026-07-29`);

  // (2) Todo CSS referenciado no HTML fresco tem de existir (200). Um 404 aqui = página sem estilo.
  const html = await res.text();
  const cssUrls = [...new Set([...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]))];
  if (cssUrls.length === 0) {
    bad('nenhum <link> de CSS "/_next/static/*.css" encontrado no HTML — verifique o build/HTML');
  }
  for (const path of cssUrls) {
    try {
      const r = await fetch(`${BASE}${path}`);
      if (r.status === 200) ok(`CSS 200: ${path}`);
      else bad(`CSS ${r.status} (esperado 200): ${path}`);
    } catch (err) {
      bad(`falha ao buscar CSS ${path}: ${err.message}`);
    }
  }

  finish();
}

function finish() {
  if (problems.length > 0) {
    console.log(`\n❌ Smoke FALHOU (${problems.length} problema(s)). O deploy pode servir páginas sem CSS.\n`);
    process.exit(1);
  }
  console.log('\n✅ Smoke OK — HTML não-cacheável e CSS referenciado disponível.\n');
}

main();
