# ADR-021 — Cesta persistente sincronizada (carrinho do PDV por usuário, entre dispositivos)

- **Status:** **Proposto** — aguardando aprovação do Owner (ADR + migration `0016_carts`) ANTES de
  codar (regras 1 e 4 do CLAUDE.md).
- **Data:** 2026-07-29
- **Contexto de fase:** Fase 3, melhoria de UX do PDV pedida pelo Owner (antes de ADR-020 —
  retirada/entrega futura).
- **Deciders:** Owner do produto.

> ⚠️ **Este ADR IMPLICA alteração de banco:** uma tabela nova `carts` (migration aditiva
> `0016_carts`). Nenhuma tabela existente é alterada. O motor de venda/estoque (`POST /orders`,
> ADR-001) **não muda** — a cesta é um **rascunho**; os preços são revalidados na venda.

---

## Contexto

Hoje o carrinho da **Nova Venda** (`/venda`) vive só em memória (`useState` no
`apps/web/app/(app)/venda/page.tsx`). Ao trocar de tela (consultar Estoque, Clientes, um preço em
Produtos…) ou recarregar a página, **o carrinho se perde** e o operador remonta tudo do zero. Numa
loja de material de construção — onde uma venda tem muitos itens e o balconista precisa sair para
conferir estoque/preço no meio do atendimento — isso é atrito real.

Pedido do Owner: um conceito de **"Cesta"** — o que for selecionado **fica lá até ser removido**,
com:
1. persistência do carrinho (não sumir ao navegar/fechar);
2. **alerta ao tentar fechar o sistema** com itens no carrinho;
3. um **ícone de carrinho no topo** (estilo e-commerce) indicando se está zerado ou não;
4. a cesta é **por usuário** (cada operador tem a sua);
5. um **botão "i"** por linha do carrinho, que abre as **informações daquele item**.

**Decisão de escopo do Owner:** a cesta deve **seguir o usuário entre dispositivos** — abrir no
balcão e continuar no tablet/celular do mesmo operador. Isso descarta a solução só-`localStorage`
(que é por aparelho) e exige **persistência no servidor** (Supabase).

---

## Decisão

**A cesta é persistida no servidor como um rascunho por usuário**, espelhada em `localStorage` para
resposta instantânea e resiliência offline.

### 1. Modelo de dados — uma linha por usuário, itens em **JSONB**

Tabela nova `carts`:

| coluna      | tipo            | observação                                             |
|-------------|-----------------|--------------------------------------------------------|
| `userId`    | `UUID` **PK**   | = `users.id`; **uma cesta por usuário**                |
| `tenantId`  | `UUID`          | isolamento/RLS; FK → `tenants` `ON DELETE CASCADE`     |
| `items`     | `JSONB`         | snapshot do `CartItem[]` do cliente                    |
| `updatedAt` | `TIMESTAMP(3)`  | relógio do **last-write-wins** e "editado por último"  |

FKs `ON DELETE CASCADE` para `users(id)` e `tenants(id)` (padrão da 0014). A PK em `userId` garante
a cardinalidade "uma cesta por usuário" sem índice extra.

**Por que JSONB e não uma tabela normalizada `cart_items`:**
- A cesta é um **rascunho de propriedade do cliente**, com estrutura rica e específica do front —
  par (ADR-015), acréscimo por forma de pagamento (ADR-016), unidade fechada/`conversionFactor`
  (ADR-017), preço-base × preço efetivo. Duplicar isso em colunas seria acoplar o banco a detalhes
  de UI que **não são a fonte de verdade** (os preços são recalculados/validados no `POST /orders`
  na hora de vender).
- **Cost-zero (free tier):** **1 linha por usuário** e **1 upsert por alteração** (com _debounce_),
  em vez de N linhas apagadas/reinseridas a cada clique. Muito menos escrita e menos linhas.
- JSONB **não é BLOB/Base64** (o que o CLAUDE.md proíbe) — é dado estruturado. Há precedente no
  schema: `TenantModule.config Json?`.

### 2. RLS — isolamento **por usuário** (dado pessoal)

`ENABLE ROW LEVEL SECURITY` + política de **SELECT** `userId = auth.uid()` — mais estrita que o
padrão "por tenant" das outras tabelas, porque a cesta é **pessoal**: um colega da mesma loja não
pode ler a cesta alheia nem por acesso direto via `supabase-js`. **Sem política de escrita:** toda
escrita passa pela API (papel `postgres`, que ignora RLS e isola por código), como nas demais
tabelas. A app nunca lê/escreve a cesta direto pelo `supabase-js` — vai sempre pela API; a policy é
defesa em profundidade.

### 3. API — `/cart` (padrão de `routes/me.ts`)

- **`GET /cart`** → `{ items, updatedAt }` do usuário autenticado; linha inexistente ⇒
  `{ items: [], updatedAt: null }`.
- **`POST /cart`** → **upsert** de `{ items }` (validado por `cartSnapshotSchema` no `shared`);
  grava `tenantId` do contexto e `updatedAt = now`. Retorna `{ updatedAt }`.
  Usa **POST** (não PUT) porque o CORS da API libera `GET/POST/PATCH/DELETE` — sem `PUT`.
- **`DELETE /cart`** → limpa a cesta do usuário (usado ao concluir a venda e no "Limpar carrinho").

### 4. Front — servidor com espelho local (filosofia ADR-012)

- Um **`CartProvider` + `useCart()`** montado no shell (`(app)/layout.tsx`), como o
  `OutboxSyncProvider` — assim **o PDV e o ícone do topo leem o mesmo estado**.
- **Hidratação:** carrega o espelho `localStorage` (por usuário) na hora (sem flash) e, em seguida,
  `GET /cart` (a **rede vence**) reconciliando por `updatedAt` (**last-write-wins**).
- **Gravação:** cada mudança escreve o espelho na hora + **`POST /cart` com _debounce_ (~1 s)** —
  junta edições rápidas de quantidade num único write. _Flush_ best-effort em
  `pagehide`/`visibilitychange`.
- **Offline:** as mutações só tocam o espelho; ao voltar `online`, empurra a cesta local (LWW).
  `GET/POST /cart` são cross-origin e **não** são cacheados pelo Service Worker (como
  `/cash-sessions`), então **offline a cesta funciona pelo espelho local**; a **sincronização entre
  aparelhos ocorre online** — comportamento honesto e esperado.
- **Alerta ao fechar:** `beforeunload` quando a cesta tem itens (pedido 2).
- **Ícone no topo:** `CartChip` no `header` (ao lado do `QueueChip`), com _badge_ de contagem e link
  para `/venda`; zerado = ícone apagado (pedido 3).
- **Limpar ao vender:** ao concluir a venda (online) ou enfileirá-la (offline), a cesta é **zerada**
  (o comprovante usa um snapshot próprio) — evita um carrinho **já vendido** reaparecer.
- **Info por item:** botão "i" por linha abre um modal com as infos daquele item (pedido 5).

### Alternativas descartadas

- **Só `localStorage` (por aparelho):** era a solução mais barata e simples (sem migration/API/
  deploy), mas **não sincroniza entre dispositivos** — recusada pelo Owner, que quer a cesta
  seguindo o usuário em qualquer aparelho.
- **Tabela normalizada `cart_items` (uma linha por item):** mais "purista", mas gera muita escrita
  (apaga/reinsere a cada clique) e mais linhas no free tier, para guardar um **rascunho** cuja
  verdade é recalculada na venda. Over-engineering aqui.
- **Merge item-a-item entre dois aparelhos editando ao mesmo tempo:** adotamos **last-write-wins**
  por `updatedAt`. Para um rascunho de carrinho do mesmo usuário, o custo/benefício de um CRDT/merge
  não se justifica; o limite fica registrado abaixo.
- **RLS por tenant (como as outras tabelas):** insuficiente aqui — deixaria um colega ler a cesta de
  outro via acesso direto. Optamos por `userId = auth.uid()`.

---

## Consequências

- **Positivas:** o carrinho deixa de se perder ao navegar/recarregar; segue o usuário entre
  dispositivos; o operador vê no topo se há algo pendente; um "i" por linha explica o item.
  Cost-zero mantido (1 linha/usuário, upsert _debounced_). O motor de venda/estoque/caixa **não
  muda** (a cesta é rascunho; `POST /orders` revalida tudo). RLS mais estrita (pessoal).
- **Limitações:**
  - **Last-write-wins:** se o **mesmo** usuário editar a cesta em **dois aparelhos ao mesmo tempo**,
    o último `POST /cart` vence (o outro é sobrescrito). Aceitável para um rascunho.
  - **Sincronização entre aparelhos só online** (as rotas `/cart` não são cacheadas offline). Offline
    a cesta é local ao aparelho, e reconcilia ao reconectar.
  - **Preços do rascunho podem ficar velhos:** se um preço/estoque mudar entre montar a cesta e
    vender, a **verdade é o `POST /orders`** (revalida estoque e pagamento). A cesta só carrega o
    snapshot de UI. (Melhoria futura possível: revalidar preços ao hidratar.)
- **Segurança/privacidade:** a cesta é pessoal e isolada por `userId` (RLS `auth.uid()` + API por
  usuário). Mantida no logout (chave por usuário), então outro usuário no mesmo aparelho **não** vê
  a cesta alheia.

---

## Relação com outros ADRs

- **ADR-012 (cold-start offline-first / leitura):** a cesta segue a mesma filosofia — espelho local
  + a rede vence quando disponível; rótulo/limites honestos quando offline.
- **ADR-011 (fila offline):** independente da `outbox` de vendas; a cesta é rascunho (não é uma
  mutação de venda). Reusa o padrão de _provider_ no shell (`OutboxSyncProvider`).
- **ADR-015 / ADR-016 / ADR-017:** a estrutura rica do `CartItem` (par, acréscimo, unidade fechada)
  é o que motiva guardar a cesta como **snapshot JSONB** em vez de colunas normalizadas.
- **ADR-001 (consistência de estoque):** intocado — a cesta não movimenta estoque; a baixa acontece
  só na venda (`POST /orders`).
- **ADR-004 (auditoria/soft-delete):** a cesta é rascunho volátil, **fora** do escopo de auditoria;
  `DELETE /cart` é limpeza real (não soft-delete) — nada a auditar.
