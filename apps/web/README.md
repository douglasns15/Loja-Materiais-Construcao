# @nexoloja/web

PWA em **Next.js 15 (App Router)** — o front do NexoLoja (login, PDV/venda, caixa,
estoque, relatórios, cadastros e configurações). Hospedado em **Cloudflare Workers
via OpenNext** (`@opennextjs/cloudflare`), pois o Cloudflare Pages para Next.js foi
descontinuado (ADR-005).

- **Produção:** https://nexoloja-web.imortal.workers.dev
- **API consumida:** https://nexoloja-api.imortal.workers.dev

## Variáveis de ambiente

Todas são `NEXT_PUBLIC_*` e são **embutidas no bundle durante o `next build`**
(a partir de `.env.local`) — **não** são vars/secrets de runtime do Worker. A anon
key é pública por design (o isolamento é garantido por RLS no Postgres).

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base da API Hono (`lib/api.ts`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Projeto Supabase (`lib/supabase.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima do Supabase Auth |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Dev local (`next dev`) em http://localhost:3000 |
| `npm run build` | Build do Next |
| `npm run preview` | Build OpenNext + roda o Worker localmente (`opennextjs-cloudflare preview`) |
| `npm run deploy` | Build OpenNext + publica no Cloudflare (`opennextjs-cloudflare deploy`) |
| `npm run cf-typegen` | Gera tipos do binding do Worker |

> Rodar da **raiz** do monorepo com `npm run dev` sobe só o web (turbo filter).
> A config de deploy fica em [`wrangler.jsonc`](./wrangler.jsonc) e
> [`open-next.config.ts`](./open-next.config.ts).

## Deploy

```bash
# de apps/web (wrangler autenticado na conta Cloudflare)
npm run deploy
```

Ao mudar a URL pública, atualizar no **Supabase → Authentication → URL Configuration**
o *Site URL* e as *Redirect URLs* (incluindo o wildcard `/**`, que cobre `/definir-senha`),
e garantir que a origem esteja liberada no **CORS da API** (`apps/api/src/index.ts`).
