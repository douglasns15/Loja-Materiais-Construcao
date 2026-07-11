# ADR-012 — Cold-start / offline-first de leitura (cache do caixa, catálogo e navegação)

- **Status:** **Aceito** (2026-07-11) — 5 decisões (a)–(e) aprovadas pelo Owner. Implementação em
  fatias **CS-1…CS-4** (cliente puro, **sem migration**); começa pela CS-1.
- **Data:** 2026-07-11
- **Contexto de fase:** Fase 3, logo após a venda offline (ADR-011, Fatias 1–6) e os refinos da fila
  (3.E) estarem **no ar e validados**. Esta é a **próxima fatia natural**.
- **Deciders:** Owner do produto (aprovado em 2026-07-11).

> ⚠️ **Regra 4 do `CLAUDE.md`:** consultar/decidir no ADR **antes** de mudança arquitetural. Este ADR
> **não implica migration** — tudo mora no cliente (IndexedDB / `localStorage` / cache do Service
> Worker no aparelho). Ainda assim, por mexer no caminho crítico do PDV offline, as decisões ficam
> **travadas no papel** antes de codar. Onde toca escrita/estoque, **reusa** o ADR-011 (não o
> reabre).

---

## Contexto

A venda offline (ADR-011) está no ar, mas os E2E do refino 3.E expuseram uma **lacuna de leitura**
(achados **3.E.1** e **3.E.2** no registro de testes):

- A API é **cross-origin e nunca é cacheada** (decisão deliberada do ADR-011 §7 e do Service Worker
  da Fatia 3.A: o SW intercepta **só GET same-origin**; API/Supabase passam direto pela rede). Logo,
  offline, `GET /me`, `GET /cash-sessions/current` e `GET /products` **falham**.
- A venda offline de 3.D só funciona porque `sessionId` do caixa **+** catálogo de produtos ficam
  **em memória** enquanto o operador **não sai da tela `/venda`**. Ao **navegar / remontar / reabrir
  o app offline**, essa memória se perde:
  - **3.E.2** — o PDV, sem conseguir ler `/cash-sessions/current`, assume **"caixa fechado"**; e sem
    `/products`, o **catálogo fica vazio** → não dá para vender.
  - **3.E.1** — navegar para uma rota cujo *chunk* JS não foi cacheado dá **tela branca** (hoje
    apenas **mitigado** por `(app)/error.tsx`, que preserva o shell/chip e mostra um aviso — um
    paliativo, não o caminho real).

**Meta:** o PDV continua **vendável offline** depois de remontar/reabrir — o operador recupera o
caixa aberto, o catálogo e (idealmente) a navegação entre telas sem rede.

**Restrições transversais** (herdadas): **cost-zero** (nada no servidor; sem migration; sem inflar
os free tiers — tudo no aparelho) e **segurança/RLS intactos** (o cache é um espelho **local** de
dados que o próprio usuário autenticado já leu; não cria caminho novo de acesso).

O que **precisa ser decidido** (e é o objeto deste ADR):

1. **Validade do cache** — por quanto tempo / sob que regra confiar num snapshot lido antes?
2. **Caixa fechado no servidor durante o offline** — a venda offline aponta um `cashSessionId` que
   pode ter sido fechado noutro dispositivo. No sync: anexar assim mesmo ou rejeitar?
3. **Quais rotas são "offline-capable"** — o que o SW precisa pré-cachear (escopo do trabalho).
4. **Estoque offline** — de onde vem o saldo exibido e como reconcilia.
5. **Abrir caixa NOVO offline** — permitido ou continua online-only?

---

## Decisão

### (a) Validade do cache — *stale-while-offline*, rede sempre vence quando online, e rótulo "dados de HH:MM"

O cache de leitura **não expira por tempo** enquanto offline: é melhor operar com o **último snapshot
conhecido** do que travar o caixa. A regra é:

- **Online → a rede sempre vence.** Toda resposta OK de `GET` **sobrescreve** o cache local
  (o snapshot é subproduto da leitura normal, não uma fonte concorrente). Nunca servimos do cache se
  a rede respondeu.
- **Offline → serve o último snapshot** e **rotula a origem**: a UI mostra **"dados de HH:MM"**
  (timestamp do snapshot) sempre que a tela estiver lendo do cache, para o operador saber que aquilo
  pode estar defasado (preço/estoque). Sem rótulo escondido: o operador **vê** que está offline.
- **Sem TTL rígido no MVP.** Um snapshot "velho" offline ainda é a melhor informação disponível; a
  correção real vem quando a rede volta (sobrescreve) e, para estoque, na reconciliação (ADR-001).

> **Recomendado.** Alternativa avaliada: TTL curto (ex.: expira em N horas → bloqueia venda offline).
> Rejeitada no MVP — transforma uma queda de rede prolongada em "caixa parado", o oposto do objetivo
> de um POS. O rótulo de horário já dá ao operador o critério humano para desconfiar.

### (b) Caixa fechado no servidor durante o offline — **anexar mesmo assim, marcado para reconciliação** (reusa ADR-011 §6)

A venda **ocorreu fisicamente** naquele turno (dinheiro na gaveta, produto entregue). Se, ao
sincronizar, o `cashSessionId` referenciado já foi **fechado** noutro dispositivo, o `POST /orders`
idempotente **anexa a venda assim mesmo** ao caixa (já fechado) e **marca para reconciliação** — a
divergência aparece no relatório de fechamento, exatamente como o **estoque negativo** do ADR-011 §6.

Racional: é o **mesmo princípio** já aceito no ADR-011 — *não rejeitar um evento físico já
concluído*. Rejeitar (→ `FAILED`, tela `/pendencias`) deixaria a venda **sem registro**, quebrando
fechamento de caixa e auditoria — pior que uma divergência sinalizada.

> **Recomendado: anexar + marca de reconciliação.** Alternativa: **rejeitar → `FAILED`** e exigir
> reprocesso manual (a fila e a tela `/pendencias` de 3.E já suportariam). Fica como *fallback* se a
> anexação a caixa fechado provar-se confusa no relatório — mas o default espelha o ADR-011 §6.
> *(Esta é a única decisão que toca o servidor: um ramo no `POST /orders`. Continua **sem
> migration** — nenhuma coluna nova; a marca de reconciliação reusa a auditoria/relatório
> existentes.)*

### (c) Rotas "offline-capable" — **venda + leitura de caixa no MVP**; histórico/estoque/relatórios ficam online-only por ora

O SW pré-cacheia (após a 1ª visita online) **apenas** as rotas do fluxo de balcão que precisam rodar
sem rede:

| Rota | Offline-capable? | Por quê |
|---|---|---|
| `/venda` (PDV) | **Sim** | Coração do offline — enfileira venda (ADR-011). |
| `/caixa` (leitura do caixa aberto) | **Sim** | O PDV precisa saber que há caixa aberto + o `sessionId`. |
| `/pendencias` | **Sim** | Ver/reprocessar a fila offline (já existe, 3.E). |
| `/offline` (fallback) | **Sim** | Já cacheada (Fatia 3.A). |
| Histórico de vendas, Estoque, Relatórios, Configurações, `/plataforma`, cadastros | **Não (MVP)** | Consultas/gestão; offline mostram o aviso de rede, não a tela vazia. |

Escopo enxuto = precache pequeno (cost-zero, cabe no aparelho) e superfície de bug menor. Ampliar é
uma fatia futura, não um bloqueio.

> **Recomendado.** Alternativa: tornar tudo offline-capable — rejeitada por inflar o precache e a
> complexidade do SW sem valor de balcão proporcional.

### (d) Estoque offline — **último cache + baixas otimistas locais**, reconciliação no sync (já ADR-001 / ADR-011 §6)

O saldo exibido offline é **o último `stockQty` conhecido** (do snapshot de `/products`) **menos** as
baixas otimistas das vendas que já foram enfileiradas **neste dispositivo** desde então. A trava de
"não vender de prateleira vazia" continua **na venda, contra esse cache local** (ADR-011 §6) — nada
muda no protocolo de sync; a novidade aqui é **só persistir** o catálogo para o cálculo sobreviver ao
remontar. O resíduo (soma de dois dispositivos passa do saldo) segue tratado pela reconciliação da
ADR-001. **Nada novo a decidir** além de confirmar que o cache persistido alimenta a mesma regra.

> **Recomendado (confirmação, não nova política).** Sem alternativa relevante — é a extensão natural
> do ADR-011 §6 para "após remontar".

### (e) Abrir caixa **NOVO** offline — **continua online-only** (âncora financeira)

Cold-start cobre **"caixa já aberto"** (recuperar o `sessionId` de um turno que começou online), e
**não** abrir um caixa do zero sem rede. A **abertura de caixa** é a âncora financeira do turno
(valor inicial, autoria, `openedAt`) e permanece **online-only**, como já é hoje (ADR-011 Fatia 1 /
2.5 endurecimento). Sem rede e sem caixa aberto cacheado, o PDV orienta o operador a abrir o caixa
quando a rede voltar (ou nota manual, plano B do ADR-011 §9).

> **Recomendado.** Alternativa (abrir caixa offline e sincronizar depois) fica para uma fatia futura
> se surgir demanda real — hoje adiciona um evento append-only sensível (dois caixas "abertos" no
> mesmo turno em dispositivos diferentes) sem ganho de balcão comprovado.

---

## Mapa de implementação (para depois da aprovação — não codar antes)

Corresponde às sub-fatias **CS-1…CS-4** já esboçadas no ROADMAP. **Tudo no cliente, sem migration.**

| Fatia | Decisões que aplica | Tamanho | Resumo |
|---|---|---|---|
| **CS-1 — cache do caixa aberto** | (a)(e) | Pequena | Persistir `{ id, openedAt, openingAmount, openedByName }` em `localStorage` a cada `GET /cash-sessions/current` **com** caixa; **limpar** quando vier `null` (fechado online) ou ao fechar. `/venda` e `/caixa` leem esse cache offline → recuperam o `sessionId` para enfileirar. |
| **CS-2 — cache do catálogo** | (a)(d) | Média | Novo store `catalog` no IndexedDB (`nexoloja` DB → bump `DB_VERSION` → 2 + `onupgradeneeded`; **sem migration de servidor**). Persistir a lista (id/nome/sku/preços/`stockQty`/`minStockQty`) a cada `GET /products` OK; offline, `/venda` monta o carrinho a partir do cache. Com CS-1+CS-2, **operar offline após remontar já funciona** (ficando no `/venda`). |
| **CS-3 — navegação offline entre telas** | (c) | **Incerta — exige *spike*** | Estender o SW para servir as rotas offline-capable (documento + chunks + payload RSC do Next App Router). Validar no spike o custo do RSC (`?_rsc=`); se inviabilizar client-nav offline, aceitar **navegação por reload**. *Substitui o paliativo do `error.tsx` pelo caminho real (3.E.1).* |
| **CS-4 — semântica de caixa fechado no sync** | (b) | Pequena-média | No `POST /orders` idempotente, tratar `cashSessionId` de sessão **fechada** conforme (b): anexar com marca de reconciliação. **Sem migration.** |

> **Ordem de valor:** **CS-1 + CS-2** entregam o essencial (PDV vendável offline após remontar, sem
> navegar). **CS-3** adiciona a navegação offline entre telas (a mais arriscada). **CS-4** endurece a
> borda do caixa fechado. Roteiro de testes previsto em **3.F** no registro.

---

## Consequências

- **Fica mais fácil:** o caixa segue vendendo offline **depois de remontar/reabrir** (não só enquanto
  a tela `/venda` fica montada); o operador **enxerga** quando lê do cache ("dados de HH:MM"); o
  paliativo `error.tsx` dá lugar (em CS-3) ao caminho real de navegação offline.
- **Fica mais difícil:** o cliente ganha um **espelho de leitura** (caixa + catálogo) a manter
  coerente (sobrescrever online, limpar ao fechar caixa); o SW passa a lidar com **navegação/RSC**
  offline (a parte incerta, isolada em CS-3 com spike).
- **Impacto no banco:** **nenhum.** Sem migration; sem tabela nova no servidor. O `DB_VERSION` do
  IndexedDB **do cliente** sobe para 2 (CS-2) — é do aparelho, não do Postgres.
- **Servidor:** só a decisão (b) adiciona **um ramo** no `POST /orders` (caixa fechado → anexar +
  marca de reconciliação), **sem migration** — reusa auditoria/relatório existentes.
- **Segurança/RLS:** intactos. O cache é um espelho **local** de dados que o usuário autenticado já
  leu; não há novo caminho de acesso nem dado cross-tenant (um dispositivo = uma loja logada).
- **Revisar no futuro:** ampliar rotas offline-capable (histórico/estoque) e reavaliar **(e)** (abrir
  caixa offline) se houver demanda; caso o RSC inviabilize a client-nav offline no CS-3, assumir de
  vez a navegação por reload.

---

## Action Items

> **Decisões (a)–(e) aprovadas pelo Owner em 2026-07-11.** Implementação em fatias CS-1…CS-4.

1. [x] **(a) aprovada:** validade do cache — *stale-while-offline*, rede vence online, rótulo "dados
       de HH:MM".
2. [x] **(b) aprovada:** caixa fechado no sync — **anexar + marca de reconciliação** (reusa ADR-011
       §6).
3. [x] **(c) aprovada:** rotas offline-capable — venda + leitura de caixa (+ `/pendencias`,
       `/offline`) no MVP; demais online-only.
4. [x] **(d) aprovada:** estoque offline — último cache + baixas otimistas locais (confirmação do
       ADR-011 §6).
5. [x] **(e) aprovada:** abrir caixa novo offline — **online-only** (cold-start cobre "caixa já
       aberto").
6. [ ] **CS-1 — cache do caixa aberto** (em andamento). Depois CS-2 (catálogo), CS-3 (navegação
       offline, com spike), CS-4 (borda do caixa fechado no sync).

---

## Relacionadas

- **[ADR-011](./ADR-011-fila-de-sincronizacao-offline.md)** — Fila de sync offline (escrita). Este
  ADR é o **par de leitura**: (b) e (d) reusam §6 (estoque/venda física não se rejeita) e §7 (RLS/JWT
  no sync); o cache **não** cria caminho de escrita novo.
- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — `stockQty` é cache de leitura; a
  reconciliação absorve divergências que o cold-start possa expor.
- **[ADR-005](./ADR-005-stack-e-arquitetura.md)** — MVP online-first com cache de leitura; esta fatia
  materializa o "cache de leitura" para o cenário offline.
- **Fatia 3.A (PWA)** — o Service Worker (só GET same-origin, network-first) é a base que o CS-3
  estende para navegação offline.
