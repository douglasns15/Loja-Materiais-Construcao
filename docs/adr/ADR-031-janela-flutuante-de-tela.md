# ADR-031: Janela flutuante de tela (painel destacável e interativo, mesmo documento)

**Status:** **Aceito** — Fatia 1 implementada, **NO AR e E2E do Owner VALIDADO em produção** (2026-09-05, "tudo validado e funcionando perfeitamente"; web Version `f10125f8`). Sem migração, sem alteração de contrato de rota. Só `apps/web` (4 componentes novos + `layout.tsx`; as 5 telas não foram tocadas).
**Data:** 2026-09-05
**Deciders:** Owner do produto
**Relacionados:** [ADR-005](ADR-005-stack-e-arquitetura.md) (teto do free tier / cold-start-pool — a guarda de custo desta decisão), [ADR-011](ADR-011-fila-de-sincronizacao-offline.md) (outbox como **instância única** no shell — por que **não** abrir 2º documento), [ADR-012](ADR-012-cold-start-offline-first-leitura.md) (offline-first de leitura / CS-3 navegação por reload), [ADR-021](ADR-021-cesta-persistente-sincronizada.md) (cesta/estado por documento), [ARCHITECTURE §7](../ARCHITECTURE.md) (persistência e custo-zero)

## Contexto

O dono precisa **comparar dados** durante uma análise: pesquisar um produto na tela de Produtos e,
ao mesmo tempo, olhar Estoque, Relatórios ou o PDV — **sem perder** a pesquisa que já tinha feito e
**sem ter que voltar** à tela de origem para pesquisar de novo. Hoje a navegação é uma tela de cada
vez (`<main>` renderiza a rota atual); trocar de tela descarta o estado da anterior.

A demanda é uma **"janela flutuante"**: destacar uma tela num painel que fica por cima, permanece ao
navegar para outra tela e continua **interativo** (com busca/filtro próprios e independentes).

O termo "janela flutuante" cobre três coisas com custos muito diferentes, e a escolha errada
reintroduz problemas caros que o projeto já resolveu:

- **(A) Painel flutuante interno** — um card arrastável/redimensionável **no mesmo documento** (mesma
  aba/PWA), sobrepondo a tela atual.
- **(B) Janela do SO real** (`window.open`) — um **segundo documento** independente (outro monitor).
- **(C) Document Picture-in-Picture** — um flutuante mínimo do SO, para um **widget** pequeno.

Dois riscos de projeto tornam **B** perigoso neste código:

1. **Custo/concorrência (ADR-005).** Cada tela de dados busca da API ao montar. Uma segunda tela
   **ao vivo** duplica as requisições concorrentes — exatamente a **rajada** que estourava o pool
   frio do free tier e causou o "preso no cache offline ~3×/dia" (resolvido em 2026-09-04). A feature
   mal projetada **reabre** esse buraco.
2. **Outbox offline (ADR-011).** O `OutboxSyncProvider` é montado como **instância única** no shell
   (`(app)/layout.tsx`) de propósito — "evita listeners/drenos duplicados". Um segundo documento (B)
   monta um **segundo** dreno da fila offline → dois drenos concorrentes da mesma fila. A idempotência
   forte do `POST /orders` (migration 0029) deduplica no servidor, mas ainda **desperdiça CPU/conexões
   do Worker** e cria corrida; tornar B seguro exigiria **leader-election** (Web Locks / BroadcastChannel),
   um projeto à parte.

## Decisão

### 1. É **painel interno (A)**, no mesmo documento — não janela do SO

A janela flutuante é implementada como painel(éis) React arrastável/redimensionável renderizado(s) via
`createPortal` no `document.body` (mesma base de portal já usada em `useAnchoredDropdown`), **dentro da
mesma árvore React** do shell. Consequência decisiva: compartilha o mesmo `OutboxSyncProvider`, a mesma
`CartProvider`, o mesmo `me`/JWT e o mesmo Service Worker → **sem** duplo dreno de outbox, **sem**
sincronização entre janelas, **sem** dobrar conexões por multiplicação de documento.

**As opções B (`window.open`) e C (Document PiP) ficam FORA desta decisão** (ver Alternativas). Se um
dia houver demanda real por "segundo monitor físico", nasce um ADR próprio.

### 2. Instância **independente e interativa**, reusando o componente de página existente

O painel monta o **próprio componente de página** da tela destacada (ex.: `<ProductsPage/>`) uma
segunda vez. Isso é seguro porque as 5 telas-alvo são **auto-contidas**: verificado que **nenhuma** usa
`useRouter`/`useSearchParams`/URL nem IDs de DOM fixos para estado — o estado de busca/filtro é
`useState` **local à instância**. Logo, a busca própria e independente do flutuante (o pedido do Owner)
sai **sem refatoração de estado**: cada instância tem a sua.

Telas-alvo da Fatia 1 (todas de **leitura/consulta**): **Histórico de Vendas**, **Contas a Receber**,
**Produtos**, **Estoque**, **Relatórios**.

### 3. Escopo v1 = **consulta/busca**, não mutação nem impressão pelo flutuante

Modais de detalhe e a área de impressão (`#print-area`, "um por tela") usam `position:fixed`/portal no
`body` → abertos **de dentro** do flutuante, cobririam a tela inteira, quebrando o modelo mental de
"janela". Por isso, na v1 o flutuante serve para **navegar, pesquisar e consultar**; **criar/editar/
excluir e imprimir seguem pela tela cheia**. (Ver e comparar dados é o objetivo; mutação pelo flutuante
é um épico posterior, se houver demanda.)

### 4. Guarda de custo explícita (respeita ADR-005) — sem laço de re-fetch

- **Nenhum polling / re-fetch automático** no painel. Há carga de dados **só** em duas situações, ambas
  **ação do usuário**: ao **abrir** o painel (clicar "Destacar") e ao **pesquisar/filtrar** dentro dele
  — o mesmo custo de navegar até a tela uma vez. Nada dispara em segundo plano.
- **Teto de painéis simultâneos** (proposto: **2**) para limitar a concorrência de cargas iniciais.
- Herda o padrão do **Relatórios v2** (busca compartilhada / "uma vez", debounce de filtro) — o painel
  **não** pode furar isso abrindo rajada.

### 5. **Desktop-only**; geometria em `localStorage`

Janela flutuante não tem valor no PWA mobile (Android/iOS). O botão "Destacar" e os painéis **só
aparecem no desktop** (padrão do menu retrátil, que já é desktop-only); no mobile a feature degrada
para nada. Posição, tamanho e estado (minimizado) de cada painel são lembrados por tela em
`localStorage` (como as demais preferências de UI).

### 6. Custo-zero de infra, sem dependência nova (regra 4)

Um `FloatingPanelProvider` único no shell mantém a lista de painéis abertos; o arrastar/redimensionar é
escrito à mão (sem lib — regra 4). **Não toca API, banco, migração, `core` nem `shared`.** É
apresentação pura no `apps/web` → **custo-zero** (ARCHITECTURE §7).

## Alternativas consideradas

- **(B) Janela do SO real (`window.open`).** Rejeitada na v1: monta um 2º documento → **duplo dreno de
  outbox** (ADR-011), estado **não** compartilhado (exigiria `BroadcastChannel` para cesta/loja/logout)
  e **dobra as conexões** concorrentes (ADR-005). Só seria segura com leader-election — projeto próprio,
  desproporcional ao ganho de "análise".
- **(C) Document Picture-in-Picture.** Adiada: compartilha o JS da aba (resolve o outbox), mas só existe
  em Chromium desktop e serve a um **widget pequeno** (um indicador), não a uma tela inteira com busca.
  Candidata futura para "destacar um número" (ex.: total do caixa), não para esta demanda.
- **Painel como "foto" estática (snapshot read-only).** Era a proposta inicial de custo mínimo, mas
  **rejeitada pelo Owner**: ele quer **pesquisar dentro** do flutuante (ex.: outro produto) sem voltar à
  tela de origem. A instância interativa (§2) atende sem custo de polling (§4).
- **Extrair um "corpo de tela" reutilizável separado do componente de página.** Desnecessário: as
  páginas já são auto-contidas e instância-seguras (§2); reusá-las direto evita duplicar lógica.

## Consequências

- ✅ Análise comparativa (pesquisar numa tela enquanto se olha outra) **sem perder a busca** e sem
  voltar à tela de origem — a dor do Owner — **sem migração** e **sem tocar backend** (custo-zero).
- ✅ A busca própria/independente do flutuante sai **barata**, porque os componentes de página já são
  auto-contidos (estado `useState` local, sem acoplamento a URL/router/DOM-id).
- ✅ Seguro por construção contra o pior risco: sendo **mesmo documento**, não há duplo outbox nem
  multiplicação de documento; a guarda de custo (§4) mantém a concorrência dentro do teto do free tier.
- ⚠️ Preferências **cosméticas** com chave `localStorage` fixa (ex.: seção aberta/fechada do Estoque)
  são **compartilhadas** entre a tela cheia e o flutuante da mesma tela. Aceitável na v1 (é a mesma
  tela); se incomodar, namespear a chave por instância depois.
- ⚠️ Modais e impressão abertos **de dentro** do flutuante cobrem a tela toda (portal no `body`) → v1 é
  consulta; **edição/impressão pelo flutuante ficam fora** (§3).
- ⚠️ Cada painel aberto = **uma** carga inicial da tela (ação do usuário). O teto de painéis (§4) e a
  ausência de polling mantêm o custo previsível — guarda alinhada à ADR-005.
- ⚠️ **Desktop-only**: sem valor no PWA mobile (esperado; degrada para nada).
