# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-07-17 — **"Última atividade da loja" no painel do Super Usuário — NO AR e
> VALIDADO.** Ideia do usuário ("mostrar se a loja está online?") virou um sinal **honesto**: não existe
> "online/offline por loja" (online/offline é do dispositivo/sessão, não do tenant; a API é única na edge), então
> mostramos **quando foi a última operação real** — responde de verdade "está sendo usada?". **Cost-zero, sem
> migration, sem tabela de log:** `GET /platform/tenants` deriva `lastActivityAt` do `MAX` de sinais que já
> existem (última venda + último movimento de estoque + abertura/fechamento de caixa, 3 `groupBy`). Web: coluna
> **"Última atividade"** no `/plataforma` — "• ativa agora" (verde, < 15 min) senão rótulo relativo PT-BR
> (`timeAgoPtBr`, puro) ou "— sem atividade". *(A "ideia 1", badge "Online" p/ o operador, foi descartada:
> `navigator.onLine` mente — só diz que há rede, não que a API responde.)* Gates: typecheck API+web, build web
> (17 rotas), core **82/82**. **No ar:** API `d3fc9568` + web `4feb010c`; commit `2f0f14b`. **E2E do usuário
> validado** (Loja Demo "ativa agora" após operação; outra loja "há 13 dias"). Ver "Plataforma — Última
> atividade da loja" no registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-16 — **EF-3 COMPLETO, NO AR e VALIDADO** (venda em unidade alternativa —
> rolo fechado × por metro, 2 preços). Fecha o **módulo de estoque fino** (EF-1→EF-2→EF-3). **ADR-013
> (Opção A):** segundo preço reusando `conversionFactor`; **2 migrations aditivas** — `0008`
> (`products.altUnit`/`altSalePrice`) e `0009` (`order_items.baseQuantity`). Core
> `hasAltUnit`/`resolveSaleUnit`/`toBaseQuantity`/`effectiveBaseUnitPrice` (**+14 → 82/82**). API
> `POST /orders`: baixa e `StockMovement` em **unidade-base** (`qtd × fator`), `OrderItem` grava
> `baseQuantity`; **cancelar/devolver estornam em base** (`baseQuantity ?? quantity`). Web: cadastro com
> bloco "unidade alternativa"; PDV com botões **base × embalagem** + trava de estoque em base (`saleMode`
> no payload online/offline); comprovante imprime a embalagem. **No ar:** API `4f19776c` + web `98453ac5`.
> **E2E validado** (fio metro R$2 / rolo 100 m R$150, estoque 500: venda rolo 2× baixou **200**, cancelamento
> estornou **200** — não 2 — saldo 495). **Pendência 1 (reconciliação de estoque do seed) FECHADA em
> 2026-07-16** — rotina `reconcile-stock.mjs` corrigiu 3 produtos (Tijolo 955→905, Cimento 220→190, e o
> soft-deleted Cimento CP-II 120→0); pós-apply 0 divergências (ver registro). **Próximo passo:** pendência 2
> (limpar dado de teste do EF-3) **ou** pendência 3 / itens finais da Fase 3 (pooler 6543, avaliar Supabase Pro).
>
> **Antes:** 2026-07-15 — **EF-2 COMPLETO e NO AR** (estoque fino online-first). Duas fatias: **(1)
> painel de reposição** (topo do Estoque — tudo no ponto de reposição, badge zerado/baixo + sugestão de compra)
> e **(2) visão consolidada por produto** (colunas Entradas/Saídas/Saldo-hist. na tabela "Estoque atual", com ⚠
> de divergência ADR-001 e clique no produto p/ filtrar o histórico). Novo endpoint agregado `GET /stock/summary`
> (`groupBy`, cost-zero). Core `isLowStock` + `replenishmentShortfall` (**68/68**). No ar: API `d1f6799a` + web
> `3523dd7c`; E2E validado (o ⚠ até pegou divergências reais no seed: Cimento 230≠200, Tijolo 955≠905). **Antes,
> no mesmo dia:** fix da **busca do PDV** (lista visível/clicável, web `c15b93a1`) + **EF-1 completo**.
> **Próximo passo:** **EF-3** (venda em unidade alternativa — rolo × metro, 2 preços) — **exige ADR próprio +
> aprovação da migration antes de codar** (regra 4 do CLAUDE.md). Alternativa: investigar/reconciliar as
> divergências de estoque do seed (rotina de reconciliação, ADR-001).
>
> **Antes:** 2026-07-15 — **EF-1 COMPLETO e NO AR** (cadastro de produto enriquecido fechado).
> Deployado o **resto do EF-1** (só UI, sem migration/API): **descrição/observação** (textarea ≤500), **peso**
> com toggle **kg/g** (canônico em kg) e **unidade de venda** (dropdown `UnitType` + `unitTypeLabels` PT-BR novo
> em `packages/shared`). Web Version `4baf2760-c0e2-442a-a5a7-c25d6f52e337`; **E2E do usuário validado** (Metro /
> 250 g→0,25 kg / descrição persistiram — conferido na API). Gates: typecheck web ✅, build web (18 rotas) ✅,
> core 58/58 ✅. **Próximo: EF-2** (estoque fino online-first). Detalhe abaixo (bloco "EF-1 FECHADO").
>
> **Antes:** 2026-07-14 — **EF-1 (parte do apelido) + busca + código de barras NO AR (API + web deployados e validados).**
> Entregue a fatia **"nome popular + busca + leitura de código de barras"** (parte do EF-1 planejado, com desvios anotados):
> - **Nome popular do produto** — coluna nova **`popularName`** (renomeamos o `nickname` do plano; `VarChar(150)`,
>   nullable, sem mudança de RLS) + índice `products_tenantId_popularName_idx`. **Migration `0007` aplicada** via
>   `wrangler`/`migrate deploy` (aprovada pelo usuário). Campo **genérico p/ qualquer ramo** (sistema é multiramos),
>   exemplo só ilustrativo ("Ferro 8" p/ "Vergalhão CA-50 8mm"). Exposto no cadastro e na listagem (linha secundária).
> - **Busca de produto** por **nome oficial + nome popular + SKU** (digitar qualquer um acha) nas telas **Produtos** e
>   **Venda**. Lógica pura `productMatchesQuery` + `normalizeSearchText` em `packages/core` (acento- e caixa-insensível,
>   substring; **+7 testes → 58/58**). Na venda, o `<select>` passa a listar só os matches.
> - **Código de barras (BÔNUS, fora do plano original):** o `sku` **é** o código de barras, então buscar por SKU já é
>   buscar por código. (a) **Leitor físico (HID)**: campo de busca com **Enter-quando-sobra-1** — na venda **auto-adiciona
>   ao carrinho**; em Produtos **acha+destaca** a linha ou, se o código for novo, **joga no SKU do cadastro e foca Nome**.
>   (b) **Câmera**: componente reutilizável `apps/web/components/BarcodeScanButton.tsx` (📷) — `BarcodeDetector` nativo
>   com fallback **`@zxing/library`** (dep nova, dynamic import só ao abrir); integrado na venda (📷 busca) e em Produtos
>   (📷 busca + 📷 campo SKU). `CachedProduct` (cache offline) ganhou `popularName`.
> - **API re-deployada** (`nexoloja-api`, Version `54acd8eb-4c89-4f58-a5a6-44aca930b7e6`): a API é um **Worker deployado**
>   e o `@nexoloja/shared`/Prisma antigos **descartavam** o `popularName` (Zod tira campo desconhecido; client antigo não
>   lê a coluna) — sem o redeploy o campo nem salvava nem retornava. **Validado E2E pós-deploy:** produto "Tubo PVC 100mm"
>   / popular "Cano 100" **persistiu** (DB confere) e a **busca por "cano" (só no nome popular) achou**.
> - **Web deployado** (`nexoloja-web`, Version `2bc2eab3-1aa4-4151-bd61-3e3a168300bd`) — smoke OK (login serve em
>   `nexoloja-web.imortal.workers.dev`). Fatia **100% no ar** (API + web). Login de produção fica p/ o usuário conferir.
> - **EF-1 FECHADO — NO AR e VALIDADO (2026-07-15):** os 3 campos que faltavam no cadastro de produto entraram,
>   **só UI, sem migration e sem deploy de API** (a API de 14/07 já aceita — `POST /products` repassa
>   `...parsed.data` ao Prisma): **descrição/observação** (textarea ≤500), **peso** com toggle **kg/g** (canônico
>   em kg — gramas ÷ 1000 no envio) e **unidade de venda** (dropdown do `UnitType` com rótulos PT-BR, novo
>   `unitTypeLabels` em `packages/shared`). Gates: typecheck web ✅, build web (18 rotas) ✅, core 58/58 ✅.
>   **Web deployado** (Version `4baf2760-c0e2-442a-a5a7-c25d6f52e337`). **E2E do usuário validado:** produto
>   "Cabo Flexível 2,5mm — TESTE EF1" com Metro/250 g/descrição → API confere `unit="METER"`, `weightKg="0.25"`
>   (250 g → 0,25 kg), descrição íntegra. Com o cadastro enriquecido pronto (apelido+busca+código de barras da
>   fatia anterior **+** descrição/peso/unidade), **EF-1 está completo.**
> - **PRÓXIMO PASSO (próxima sessão) — EF-2 (estoque fino online-first, sem migration):** dar superfície ao que já
>   existe no core — **alerta/painel de estoque baixo** (`stockQty <= minStockQty`, já testado) + **movimentações
>   detalhadas** / visão de reposição, usando `StockMovement` e `minStockQty`. **Não toca a fila offline.**
> - Gates: core **58/58**, typecheck web ✅, build API (dry-run) ✅. Dados de teste deixados no tenant do usuário (a pedido):
>   caixa aberto R$100 + produtos FE8-TESTE (sem popular) e PVC100-TESTE (popular "Cano 100").
>
> **Antes:** 2026-07-13 — **CS-5 fechada e validada; direção do próximo bloco travada.**
> **Decisão de produto:** estoque e caixa seguem **ONLINE-ONLY** — NÃO haverá mutação offline de estoque/
> caixa agora. O offline valeu para a **VENDA** (cliente no balcão, não pode esperar); já entrada/ajuste de
> estoque e abrir/fechar caixa são **retaguarda** (podem esperar a rede voltar), e o **"ajuste"** é
> justamente a classe **conflituosa** que exigiria a tela de **CONFLICT**. Fica adiado até haver demanda
> real — junto com os cadastros mutáveis e a tela de conflito (ordem já prevista na Fase 3). **Próximo
> trabalho = módulo ESTOQUE FINO + enriquecimento do cadastro de Produto**, em **3 fatias** (detalhe na
> Fase 3 → "Módulo de estoque fino + enriquecimento do cadastro"): **EF-1** cadastro enriquecido —
> **apelido** (busca por **nome E apelido**), **descrição/observação**, **peso** (kg/g), **unidade de
> venda** — só **1 migration aditiva** (coluna `nickname`); **EF-2** estoque fino online-first — alerta de
> **estoque baixo** + **movimentações detalhadas** (sem migration); **EF-3** **venda em unidade
> alternativa** (fio: **rolo fechado × por metro**, dois preços — toca PDV/estoque/comprovante → **ADR
> próprio antes de codar**). ⚠️ Muitos campos pedidos **JÁ EXISTEM no schema** (`description`, `weightKg`,
> `unit UnitType`) — só faltam na UI. **Nada codado ainda: só documentação/roadmap para começar em outra
> sessão.**
>
> **Antes:** 2026-07-13 (**Fase 3 — CS-5 (esperado ajustado + divergência recalculada no
> relatório) NO AR e conferida** + adendo "responsável do caixa" no relatório). CS-5 fecha a conferência
> da CS-4: `POST /orders` grava `cashAmount` no `meta` do `SALE_ON_CLOSED_CASH`; função pura
> `calcAdjustedCashClosing` no core (+4 testes, **51/51**); `GET /reports/cash-sessions` devolve
> `lateCashSalesTotal`/`adjustedExpected`/`adjustedDivergence` (só o DINHEIRO das vendas tardias; fallback
> ao `total` p/ marcas antigas); UI `/relatorios` mostra "ajust. R$…" sob Esperado/Divergência. **Adendo:**
> tooltip na célula "Fechado em" com abertura/fechamento + **quem abriu/fechou** (`openedByName`/
> `closedByName`, ADR-010), exibido num **popover** (hover no desktop + toque no celular/PWA). **Sem
> migration.** **NO AR:** API `3c926d4c` + web `ac7c5b14`. **PRÓXIMO
> PASSO** = direções abertas: (b) próximas naturezas de mutação offline (estoque/caixa) ou (c) outros
> itens da Fase 3. Ver 3.F.CS-5 no registro.
> **Antes:** ADR-012 (cold-start / offline-first de leitura) CONCLUÍDO ponta a ponta (CS-1…CS-4 NO AR e
> VALIDADAS pelo usuário). **CS-4 (semântica de caixa fechado no sync,
> decisão b) — validada:** a venda offline anexada a um caixa **fechado** grava `AuditEvent
> SALE_ON_CLOSED_CASH` (marca de reconciliação, não bloqueia; **sem migration**) e o relatório mostra o
> badge "N após fechamento". E2E de dois contextos OK; verificação de estoque da venda `#c0d0b8b9` (CASH
> R$370): Cimento **240 → 230**, débito atômico intacto (a marca não afeta estoque/validade). API
> `94f277ea` + web `ae5296b5`. **Antes: CS-3 (navegação offline entre telas) VALIDADA** — navegação por
> reload (`OfflineNav`) + Service Worker v3 (aquece o shell de todas as 9 telas do menu; cache `STATIC`
> sobrevive a deploys) + `lib/meCache.ts` (papel/nome offline); 3 achados dos E2E corrigidos
> (3.F.CS-3.1/.2/.3). Web Version `624912fe`.
> **Antes: CS-1 + CS-2
> NO AR e VALIDADAS** — o PDV segue **vendável offline após remontar/reabrir**). **ADR-012 escrito e
> ACEITO** (5 decisões a–e). **CS-1** (cache do caixa aberto em `localStorage`) + **CS-2** (cache do
> catálogo no IndexedDB — abridor compartilhado `lib/db.ts`, `DB_VERSION`→2 com store `catalog`;
> `outbox.ts` refatorado): online a rede vence/sobrescreve; offline, `/venda` e `/caixa` leem do cache
> (rótulo "dados de HH:MM"), com baixa otimista fazendo write-through no catálogo. **Sem migration.**
> E2E do usuário **7/7** (web `b55d670f`). **Refinos de UX offline (decisão c do ADR-012):** aviso de
> rede amigável (`components/OfflineNotice.tsx`) nas **6 telas online-only** (Produtos, Estoque,
> Clientes, Relatórios, Histórico, **Configurações**) no lugar do "Failed to fetch"/"Acesso restrito"
> crus (web `a4cebe57` + `c1679c08`) — **validado pelo usuário em todas as telas**. **Achado 3.F.CS-2.2
> (aberto):** navegar offline **entre telas** ainda quebra (chunk/RSC não cacheado → erro do roteador);
> mitigado com `app/global-error.tsx` (aviso recuperável, web `51faac08`), mas a correção real é a
> **fatia CS-3** (spike do SW: precache de rotas/RSC ou navegação-por-reload). **PRÓXIMO PASSO = CS-3.**
> Typecheck + build **18 rotas** + core 47/47 ✅ em todo o caminho. Ver 3.F.CS-1/CS-2/CS-2.1/CS-2.2 no
> registro. **Antes (2026-07-10): Fase 3 — Refinos da fila offline (3.E): CÓDIGO PRONTO** —
> drenagem global (worker no shell `(app)` + chip de status no topo, drena em qualquer tela), poda de
> `SYNCED` (`pruneSynced` no fim do dreno) e tela **`/pendencias`** (lista a fila incl. `FAILED`;
> **Tentar novamente**/**Descartar**); pub/sub na `outbox` sincroniza chip/PDV/tela. Só cliente, sem
> migration. Typecheck + build **18 rotas** + core 47/47 ✅; **no ar (web `3921af94` + `300254fc`) +
> smoke ✅; E2E validado pelo usuário (2026-07-11)** — chip global + drenagem + vendas registradas.
> **Achados** (3.E.1 tela branca ao navegar offline → mitigado com `(app)/error.tsx`; 3.E.2 PDV assume
> "caixa fechado" offline após remontar) são a **lacuna de offline-first de leitura** — a próxima
> fatia natural: **cold-start offline** (persistir `sessionId` + cachear catálogo/rotas). Ver 3.E no
> registro. **Antes: Fase 3 — Fila de sync offline, Fatias 3–6 (round-trip da
> venda offline) NO AR e VALIDADO em produção**: PDV enfileira offline → worker (`syncWorker.ts` +
> `useOutboxSync`) drena FIFO ao voltar a rede, para na 1ª falha, retry só transitório → servidor
> `POST /orders` **idempotente por PK** (dedup do reenvio; caixa do envelope; estoque insuficiente
> registra e deixa negativo p/ reconciliação, §6). Máquina de estados pura em `packages/core`
> (+12 testes → **47/47**) + indicador "X vendas pendentes" no PDV. **Sem migration** (AI 10:
> dedup usa a PK existente). **E2E validado**: offline→enfileira→online→sincroniza; venda com a
> mesma PK, estoque 258→256; **reenvio não duplica**. 2 achados corrigidos (3.D.1). API `897d5524`
> + web `c74bbc5f`. Ver 3.D no registro de testes. **Próximo:** refinos do offline (drenagem global,
> tela `FAILED`, caminho OFF) ou as próximas naturezas de mutação (estoque/caixa offline). **Antes:**
> Fatia 2 (envelope + store
> `outbox` + flag em `localStorage`) — código pronto (ver 3.C). **Antes:** Fatia 1 (flag `OFFLINE_SALES`
> + avisos) CONCLUÍDA e validada: interruptor por loja via `TenantModule` (sem migration, default
> OFF, plano pago), `GET /me` expõe o flag, toggle no painel `/plataforma` (`AuditEvent
> SET_TENANT_MODULE`), avisos offline no PDV/Caixa (abrir caixa segue online-only); API `0b8c0348`
> + web `c35f8592`, E2E do usuário OK. Ver 3.B
> no registro de testes. **Antes:** **Fatia 3.A: PWA instalável (manifest,
> ícones, service worker de app-shell só-GET-same-origin, prompt "Instalar", página `/offline`);
> só front, sem migration; typecheck + build (17 rotas) + smoke ✅; **no ar** (web Version
> `1f290a7d`) + **instalação validada pelo usuário nas 3 plataformas (Android/iPhone/PC) → 3.A
> concluída**. Antes:** **"Registrado por" (ADR-010) + estoque inicial no cadastro —
> no ar e validados pelo usuário**: (1) **atribuição de autoria** — cada registro guarda quem executou
> (id solto + **snapshot do nome**, congelado) e reusa o "quando"; migration **`0006`** aplicada
> (aditiva, nullable): `products`/`customers` (`createdBy/updatedBy/deletedBy`), `orders`/`cash_movements`
> (`registeredByName`), `stock_movements` (`userId` — antes inexistente — + `registeredByName`),
> `cash_sessions` (`openedByName`/`closedBy`). `requireAuth` expõe `userName`; write-path grava a
> autoria; UI mostra "Registrado por"/"Última alteração"/"Aberto por" em Vendas, Estoque, Produtos,
> Clientes, Caixa (+ painel de suporte). Nível "quem fez por último" (complementar ao ADR-004,
> cost-zero). API `a3503411` + web `93c9a95e`. (2) **Estoque inicial no cadastro** — campo opcional que,
> se > 0, cria o produto **e** gera a Entrada (`StockMovement` INCOME, "Estoque inicial (cadastro)")
> na mesma transação (ADR-001), com autoria; fecha a brecha do `stockQty` solto no schema. Sem
> migration. API `cad0fe6e` + web `ef59a575`. Typecheck API+web ✅; build ✅; core 35/35.
> **Antes:** (**Fase 2.5 — Fatia E (impersonation auditada) no ar, read-only**:
> Super Usuário entra na loja para **suporte somente-leitura** sem virar usuário dela. Token de
> suporte assinado e curto (`lib/supportToken.ts`, HS256 com secret `SUPPORT_TOKEN_SECRET`, TTL 30 min,
> escopo `{ platformAdminId, targetTenantId, exp }`) emitido por `POST /platform/tenants/:id/support`
> (+ `AuditEvent SUPPORT_SESSION_START`). Rotas **`/support/*`** fora de `/platform/*` (o Bearer é o
> token de suporte, não JWT do Supabase), com `requireSupportSession` que verifica o token **e**
> revalida `platform_admins.isActive`: `GET /support/:tenantId/overview` (dados da loja read-only) +
> `POST /support/end` (`SUPPORT_SESSION_END`). RLS de loja **intacto**. UI: botão **Entrar (suporte)**
> em `/plataforma` → `/plataforma/suporte/[tenantId]` (banner "somente leitura"). ADR-004 (2 novos
> `action`s, `meta.support=true`) + ADR-009 (Fatia E ✅ read-only) atualizados. **Sem migration.**
> Typecheck API+web ✅; build ✅; core 35/35. **No ar:** secret provisionado + API + web publicados +
> smoke em produção ✅ + **E2E do usuário validado (2026-07-05)**. Painel de suporte depois evoluiu para
> **navegável** (2.5.E.2): abas Resumo/Vendas/Produtos & Estoque com filtros e detalhes, também
> read-only e validado pelo usuário (API `1397654d` + web `d3f54d16`). Também marcados como validados pelo usuário
> os E2E que estavam pendentes (Fatia C criar loja, 2.5.Del excluir usuário, 2.5.Inact loja desativada).
> **Antes:** (**Fatias A–D concluídas**: exclusão de usuário
> da loja adicionada — `DELETE /users/:id` apaga a linha em `users` + revoga a identidade no
> Supabase Auth (`deleteAuthUser`, libera o e-mail) + `AuditEvent DELETE_USER`; bloqueia
> self/`OWNER` e usuários com histórico (→ 409 *Desativar*); botão **Excluir** em
> `/configuracoes`. **Fatia D (documental)**: `CREATE_TENANT`/`SET_TENANT_ACTIVE`/`DELETE_USER`
> formalizados na lista fechada do **ADR-004** e **ADR-009 fechado** (Fatias A–D). Sem migration.
> Typecheck API + web ✅; falta deploy do Worker + E2E do usuário. **Fatia E** (entrar no contexto
> da loja p/ suporte, impersonation auditada) fica como futura — direção no ADR-009. Antes:
> **Fatia C (painel `/plataforma`) no ar**: UI do
> Super Usuário (listar/criar/ativar lojas), `PATCH /platform/tenants/:id` + `SET_TENANT_ACTIVE`,
> login roteia por papel. API `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada no navegador
> (super usuário → painel, lista Loja Demo). Falta E2E de e-mail real (usuário) e a **Fatia D**
> (formalizar auditoria no ADR-004 + fechar ADR-009). Antes: **Fatia B (onboarding) no ar**: `POST
> /platform/tenants` cria loja + convida 1º Admin (`OWNER`); `createTenantSchema`+`slugify`,
> `inviteAuthUser` extraído p/ `lib/authAdmin.ts`, `AuditEvent CREATE_TENANT`; sem migration.
> API publicada (Version `ff3889d4`); E2E 12/12 (loja de teste criada e removida). Falta o E2E do
> e-mail real → cai na Fatia C. Antes: **Fatia A (ADR-009) no ar**: identidade
> de plataforma. Migration `0005_platform_admin` aplicada (tabela cross-tenant `platform_admins` +
> RLS + hook estendido p/ claim `is_platform_admin`), middleware `requirePlatformAuth`, rotas
> `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. API publicada (Version
> `7f7fcd7e`); E2E 10/10 (super usuário lista lojas cross-tenant; owner de loja barrado com 403;
> hook não quebrou a auth de loja). 1º super usuário: `super_owner@nexoloja.local`. Plano completo
> em `docs/plano-fase-2.5.md`. Próximo: **Fatia B (onboarding)**. Antes: **UI responsiva (2.S)** —
> correção de
> usabilidade no celular/tablet: `<meta viewport>` adicionado, menu lateral vira **gaveta**
> no celular (☰) e **recolhe** no desktop (persistido em `localStorage`), 7 tabelas passam a
> rolar (`overflow-x-auto`). Front puro, sem migration/API. Build + **deploy publicado**
> (Version `c13b1755`); falta só o E2E visual do usuário no celular. ⚠️ No Windows o
> `opennextjs-cloudflare deploy` quebrava (workerd `--debug-port`) — **corrigido em 2026-07-03**
> fixando `@cloudflare/workerd-windows-64@1.20260630.1` como optionalDependency do `apps/web`
> (casa com o workerd do wrangler 4); `npm run deploy` do web agora funciona direto. Ver
> "Infra.Deploy-Win" no registro de testes. Antes: **Web publicado no Cloudflare via OpenNext e validado** →
> `nexoloja-web.imortal.workers.dev` (convite E2E OK pela URL publicada); ver bloco abaixo.
> Antes: **Fase 2 CONCLUÍDA** — **Convite de usuário por e-mail —
> fatia 2 do ADR-008 (2.Q)**: `POST /users/invite` (Supabase `inviteUserByEmail` via
> `service_role` + linha em `users` + `AuditEvent CHANGE_ROLE`), botão **Convidar** em
> `/configuracoes` e página `/definir-senha`; binding `SUPABASE_SERVICE_ROLE_KEY` provisionado
> + Worker publicado + **E2E validado pelo usuário no navegador**. Antes: **Perfil "Meus
> dados" (2.P)**: menu de conta
> no rodapé (ícone + nome, popover com Meus dados/Sair); painel edita nome + **telefone**
> (`PATCH /me`) e troca **senha** via Supabase Auth com **reautenticação**. Migration
> `0004_user_phone` (coluna `phone` opcional em `users`) aplicada; Worker publicado (versão
> `685109c2`); E2E `PATCH /me` 6/6. Antes disso: **RBAC + gestão de usuários (ADR-008 fatia 1,
> 2.O)** — papéis Admin/Usuário derivados do `UserRole` sem migration, `requireAdmin`, `/me`,
> `/users`, gate de Configurações; E2E de RBAC 14/14. Falta a **fatia 2** do ADR-008 (convite
> por e-mail via `service_role`), que **fecha a Fase 2**, e a conferência visual no navegador)

> ✅ **Fase 2 fechada** — a fatia 2 do ADR-008 (convite de usuário por e-mail) foi validada
> ponta a ponta pelo usuário no navegador (convite → e-mail → `/definir-senha` → login). Com
> ela, gestão de usuários + RBAC concluídos. Logins de teste: Admin `owner@lojademo.com`,
> Usuário `caixa@lojademo.com`.
>
> ℹ️ **E-mail de convite — personalização adiada.** O convite já envia o nome da loja
> (`data.store_name`), pronto para uso, mas **editar o template de e-mail é bloqueado no free
> tier do Supabase** (exige Custom SMTP, Pro ou Send Email hook). Como isso se acopla ao
> **remetente próprio**, template + branding + campo de e-mail da loja ficaram todos como
> **melhorias futuras** (ver item da fatia 2). Hoje o convite funciona com o template padrão.
>
> ✅ **Web publicado no Cloudflare (OpenNext) — 2026-07-01 — validado:** `apps/web` roda na edge
> em **https://nexoloja-web.imortal.workers.dev** (Workers via `@opennextjs/cloudflare`; Pages
> descontinuado, ADR-005), sem domínio próprio por ora. As `NEXT_PUBLIC_*` são embutidas no
> build (não são secrets de runtime). CORS da API liberado para a nova origem + API republicada;
> Supabase *URL Configuration* atualizado (Site URL + Redirect `.../**` cobrindo `/definir-senha`,
> localhost mantido p/ dev). Smoke automatizado ✅ (login 200, env embutidas, preflight CORS 204)
> e **E2E de convite pela URL publicada validado pelo usuário no navegador** (convite → e-mail →
> `/definir-senha` → login). Ver 2.R no registro de testes.
>
> ▶️ **Próximo passo: deploy da API+web + E2E do usuário da CS-5.** A **Fatia CS-5 — "esperado ajustado" +
> divergência recalculada no relatório de fechamento** (melhoria da conferência da CS-4) está **CÓDIGO
> PRONTO (2026-07-13)**, sem migration: `POST /orders` grava `cashAmount` no `meta` do
> `SALE_ON_CLOSED_CASH`; função pura `calcAdjustedCashClosing` no core (+4 testes, **51/51**); `GET
> /reports/cash-sessions` devolve `lateCashSalesTotal`/`adjustedExpected`/`adjustedDivergence` (**só o
> DINHEIRO** das vendas tardias — cartão/PIX conciliam na maquininha; **fallback ao `total`** p/ marcas
> antigas sem `cashAmount`); UI `/relatorios` mostra "ajust. R$…" sob Esperado/Divergência. **NÃO
> reescreve o dado congelado** do fechamento (auditoria). api tsc + web typecheck/build (18 rotas) ✅.
> **Falta:** `npm run deploy` (API e web) + E2E do usuário (registrar venda offline num caixa que será
> fechado → sincronizar → conferir "esperado ajustado" e divergência recalculada em Relatórios). O
> **ADR-012 (CS-1…CS-4) segue CONCLUÍDO e VALIDADO**. **Depois da CS-5:** (b) próximas naturezas de
> mutação offline (estoque e caixa; depois cadastros mutáveis → tela de `CONFLICT`); (c) outros itens da
> Fase 3 (módulo de estoque fino, pooler, avaliar Supabase Pro).
>
> ⚠️ **Ao retomar o teste offline após qualquer deploy:** abra o app **online uma vez** e visite as
> telas que vai testar (o deploy troca o hash dos chunks; o SW só os cacheia ao visitá-las online) —
> senão a navegação offline bate em chunk não-cacheado. É exatamente o que o CS-3 vai resolver.
> **Antes:** Fatia 2 (envelope + `outbox` + flag em `localStorage`) — código pronto (2026-07-10, ver
> 3.C). **Antes:**
> **Fatia 1 (flag `OFFLINE_SALES` + avisos)
> CONCLUÍDA e validada (2026-07-09)**. Interruptor por loja via `TenantModule` (sem migration,
> default OFF, plano pago), `GET /me` expõe o flag, toggle no painel `/plataforma` (`AuditEvent
> SET_TENANT_MODULE`), e avisos offline no PDV/Caixa (`OfflineSalesNotice` + `useOnline`; abrir
> caixa segue online-only). No ar: API `0b8c0348` + web `c35f8592`; E2E do usuário validado. **A
> seguir (quebrado em sub-passos no item da Fase 3):** Fatia 2 = envelope de mutação + store
> `outbox` (IndexedDB) + persistir o flag em `localStorage`; depois worker de fila, `POST /orders`
> idempotente por PK, core+testes e UI de pendentes. Ver 3.B no registro de testes. **Antes:**
> **Fatia 3.A (PWA instalável) concluída (2026-07-06)**. O `apps/web` é **instalável** (manifest + ícones + service worker de
> app-shell + prompt "Instalar" + página `/offline`); o SW intercepta **só GET same-origin**
> (API/Supabase nunca são cacheados) e o registro é gated a produção. Sem migration, sem API;
> typecheck + build (17 rotas) + smoke no navegador ✅. **No ar (2026-07-06):** web publicado
> (Version `1f290a7d`) + smoke em produção ✅ + **instalação validada pelo usuário nas 3 plataformas
> (Android, iPhone, PC)** → **Fatia 3.A concluída**. (PWA atualiza sozinho a cada deploy — não
> precisa reinstalar; ver nota na Fase 3.) **Depois de 3.A:** a **fila de sincronização
> offline** (IndexedDB → Supabase) — parte difícil, que **exige um ADR próprio** (ex. ADR-011:
> idempotência, resolução de conflito, atomicidade do ADR-001/RLS) antes de codar. *Nada bloqueia:
> produção roda a Fase 2.5 completa.* Antes: **Fase 2.5 concluída (A–E) e no ar**; duas melhorias
> transversais **validadas pelo usuário (2026-07-05)**: **(1) "Registrado por" (ADR-010)** —
> autoria por snapshot; migration `0006` (API `a3503411` + web `93c9a95e`). **(2) Estoque inicial
> no cadastro** — Entrada atômica no cadastro (ADR-001); sem migration (API `cad0fe6e` + web `ef59a575`).
> - *Melhoria futura na Fatia E:* **escrita em modo suporte** (exceção auditada, `meta.support=true`)
>   — hoje o suporte é somente-leitura (direção no ADR-009).
> - *Melhoria futura na Fase 2:* devolução **parcial** (itens/quantidades com rateio).
> - *Fase própria (Plataforma, ver abaixo):* **multi-loja + Super Usuário + onboarding** (ADR-009).
> - *Fase futura dedicada:* **NFC-e fiscal** (SEFAZ + certificado).
> Estado atual: PDV completo (carrinho → revisão → confirmar → impressão, com layout
> 80mm/A4 validado no navegador), **cancelamento de venda** (estorno de estoque/caixa +
> auditoria, restrito ao caixa aberto), **gestão de estoque** (entrada/ajuste/histórico),
> caixa, auth+RLS e CRUDs de cadastro funcionando e publicados. App roda com
> `npm run dev` na **raiz** (sobe só o web via turbo filter; `dev:all`/`dev:api` exigem
> Postgres local p/ Hyperdrive). O front chama a API publicada em
> `nexoloja-api.imortal.workers.dev`.

---

## 🟢 Fase 0 — Fundação, Arquitetura e Banco de Dados — **Concluída**

- [x] Definição arquitetural: 5 ADRs + `docs/ARCHITECTURE.md`
- [x] Modelagem completa do `schema.prisma` (multi-tenant, produtos, estoque, vendas, caixa, entregas, auditoria)
- [x] Tabelas criadas fisicamente no Supabase (schema `public`)
- [x] Ambiente Prisma estabilizado na v6 (conexão via porta direta 5432)

---

## 🟡 Fase 1 — Monorepo e Backend — **Concluída**

- [x] Turborepo + npm workspaces na raiz (`package.json`, `turbo.json`, `tsconfig.base.json`)
- [x] `packages/db` — Prisma isolado (schema + client + migrations)
- [x] `packages/shared` — base de schemas Zod / tipos compartilhados
- [x] `packages/core` — lógica de negócio pura + testes Vitest
- [x] `apps/api` — Hono em Cloudflare Workers (scaffold)
- [x] `apps/web` — placeholder reservado p/ Fase 2
- [x] **Ajuste:** `directUrl` (5432) no datasource p/ migrations
- [x] **Ajuste:** baseline de migrations (`0_init` + `0001_drop_password_hash`)
- [x] **Ajuste:** auth alinhada ao Supabase Auth (remoção de `User.passwordHash`; `User.id` = `auth.users.id`)
- [x] Endpoint de validação `GET /db-check` lendo o banco (validado em `wrangler dev`)
- [x] CRUD de **Produtos** (`/products`) — validado ponta a ponta no Supabase
- [x] CRUD de **Clientes** (`/customers`) — validado ponta a ponta no Supabase
- [x] CRUD de **Categorias** (`/categories`, com hierarquia) e **Fornecedores** (`/suppliers`)
- [x] Deploy na edge (Cloudflare Workers + Hyperdrive) — `https://nexoloja-api.imortal.workers.dev`

> ℹ️ Tenant ainda vem do header temporário `x-tenant-id` — será substituído pelo
> claim do JWT (Supabase Auth + RLS) na Fase 2.

---

## 🔵 Fase 2 — Autenticação, Segurança (RLS) e MVP funcional — **Concluída (MVP)**

> Fechada pelo item que a define (gestão de usuários + RBAC, ADR-008), validado no navegador.
> Itens ainda desmarcados abaixo **não** travam o fechamento: **NFC-e** é fase futura dedicada;
> o **vínculo FK cross-schema** é endurecimento opcional (o `users.id = auth.users.id` já é
> garantido em código); **devolução parcial** e **melhorias de e-mail** são melhorias futuras.

- [x] **API protegida por JWT do Supabase** (middleware `requireAuth`) — aposenta o `x-tenant-id`
- [x] Bootstrap de loja + OWNER (`users.id` = `auth.users.id`)
- [x] Custom Access Token Hook (injeta `tenant_id`/`user_role` no JWT)
- [x] Ativar RLS nas tabelas + políticas de isolamento por `tenant_id`
- [x] UI (Next.js + Tailwind): scaffold + tela de **login** (Supabase Auth)
- [x] UI: **app shell** (menu lateral + proteção de login centralizada)
- [x] UI: tela de **produtos** (lista + cadastro via API, com CORS)
- [x] UI: tela de **clientes** (lista + cadastro)
- [x] UI + API: abertura/fechamento de **caixa** (com divergência e auditoria)
- [x] UI + API: **venda/PDV** — carrinho, pagamento (Dinheiro/Déb/Créd/PIX),
      Concluir e Orçamento; estoque atômico (ADR-001) e baixa no caixa
- [x] Impressão: comprovante de venda (não-fiscal) + orçamento — térmica 80mm e A4,
      com cabeçalho (nome + logo da loja) — *layout validado no navegador (2.H.4)*
- [x] UI + API: **gestão de estoque** — entrada (compra/recebimento, transação atômica
      ADR-001) e ajuste de inventário (com `AuditEvent ADJUST_STOCK`, ADR-004), histórico
      de movimentações e alerta de estoque baixo — *validado no navegador e via API (2.J)*
- [x] UI: **estoque mínimo por produto** — campo no cadastro + edição inline na tela de
      Produtos (`PATCH /products`); arma o alerta de “baixo” na tela de Estoque — *(2.J.2)*
- [x] UI + API: **cancelamento de venda** (ADR-004) — estorno de estoque (StockMovement
      reverso INCOME), reversão do pagamento no caixa (esperado ignora `CANCELLED`) e
      `AuditEvent CANCEL_ORDER`; restrito ao caixa aberto — *validado via API publicada
      (14/14) e UI no navegador (2.K)*
- [x] **Relatórios** de vendas e caixa — nova rota `/reports` (`GET /sales`,
      `GET /cash-sessions`) com agregação no servidor (Prisma `aggregate`/`groupBy`,
      cost-zero); vendas por período (faturamento, nº de vendas, ticket médio,
      canceladas à parte), totais por forma de pagamento (com participação %) e
      histórico de fechamentos de caixa com divergência; UI `/relatorios` com atalhos
      (Hoje/7d/30d) e período De–Até. Core: `calcAverageTicket` + `withPaymentShare`
      (testes Vitest). **Sem migration** — usa `Order`/`Payment`/`CashSession`. *(2.L)*
- [x] **Devolução de venda de caixa fechado** (ADR-006) — fluxo separado do cancelamento:
      repõe estoque (StockMovement INCOME reverso) e lança a **saída no caixa de hoje**
      (nova tabela `CashMovement`, `EXPENSE/RETURN`), sem tocar no caixa original já
      fechado; marca o pedido como `RETURNED` e registra `AuditEvent RETURN_ORDER`. O
      esperado do caixa passa a descontar saídas (`netCashMovements` no core). UI: botão
      **Devolver** no Histórico (vendas de caixas fechados) + linha de saídas no Caixa.
      Migration `0003_cash_movements_and_return` (tabela + enum + RLS). *(2.L2)*
  - [ ] **Devolução parcial** (itens/quantidades específicas com rateio de valor) — melhoria
        futura; hoje a devolução é sempre da venda inteira.
- [x] **Upload de logo da loja (Cloudflare R2)** — **concluído**. **R2 binding** no Worker
      (ADR-007, não presigned): `POST /tenant/logo` valida tipo/tamanho (`validateLogo` em
      `packages/shared`), grava no R2 (`env.MEDIA.put`) e salva só a `logoUrl` (nunca
      BLOB/Base64); `DELETE /tenant/logo` remove; leitura pública pelo próprio Worker em
      `GET /public/logo/:tenantId` (cache longo + cache-bust `?v=`). UI nova `/configuracoes`
      (upload + preview + validação). **Sem migration** — `logoUrl` já existia. Bucket
      `nexoloja-media` criado + Worker publicado + E2E validado no navegador. *(2.M)*
- [x] **Editar dados da loja (nome/CNPJ/telefone)** — API `PATCH /tenant` (Zod
      `updateTenantSchema`: nome obrigatório, CNPJ/telefone opcionais → `null` quando vazio;
      `P2002` do CNPJ único → 409) e o card "Dados da loja" em `/configuracoes` virou
      formulário (editar/salvar/descartar; "Salvar" habilita só com alteração real). **Sem
      migration** — campos já existiam no `Tenant`. Máscara de CNPJ/telefone: digita só
      números e formata ao sair do campo (`formatCnpj`/`formatPhoneBr` em `packages/shared`);
      banco guarda **só dígitos** (canônico → índice único de `cnpj` robusto). Typecheck da
      API + build do web ✅. **Worker publicado** (`wrangler deploy`) + **editar→salvar e
      máscara validados pelo usuário no navegador**. *(2.N)*
- [x] **Gestão de usuários da loja + RBAC (ADR-008)** — *fecha a Fase 2*. Papéis
      **Admin** (`OWNER`/`MANAGER`) e **Usuário** (`CASHIER`/`STOCK`) derivados do `UserRole`
      atual — **sem migration** (funções puras em `packages/shared/roles.ts`). Convenção de
      escrita: Admin→`MANAGER`, dono→`OWNER` (preservado), Usuário→`CASHIER`.
  - [x] **Fatia 1 (feita):** `requireAdmin` na API; `GET /me` (papel p/ o front); `/users`
        (listar + definir papel + ativar/desativar, com `AuditEvent CHANGE_ROLE`, ADR-004);
        `PATCH /tenant` e logo agora exigem Admin; front esconde **Configurações** do menu e
        bloqueia a tela para não-Admin + seção de **Usuários** em `/configuracoes`. Typecheck
        API + build web ✅; **Worker publicado** (versão `909427d2`) + smoke 401 OK. *(2.O)*
  - [x] **Fatia 2 (feita):** convite por e-mail (`inviteUserByEmail`). `inviteUserSchema`
        (shared), `POST /users/invite` (cria/recupera no Supabase Auth + linha em `users` com
        papel + `AuditEvent CHANGE_ROLE`), formulário **Convidar** em `/configuracoes` e página
        pública `/definir-senha`. Secret `SUPABASE_SERVICE_ROLE_KEY` provisionado + Worker
        publicado; **E2E no navegador validado pelo usuário** (convite → e-mail → definir senha
        → login). Ver 2.Q. O convite já envia o **nome da loja** (`data.store_name`), pronto
        para o template — mas hoje usa o **template padrão** do Supabase (ver melhoria abaixo).
    - [ ] *Melhorias futuras de e-mail (fora do ADR-008):* **(a)** **personalizar o template**
          do convite (PT-BR + `{{ .Data.store_name }}`) — **bloqueado no free tier** (exige
          Custom SMTP, Pro ou Send Email hook); **(b)** **remetente próprio (branded)** via
          **Custom SMTP** (Resend/SES) — exige **domínio** com SPF/DKIM; **(c)** campo `email`
          no cadastro da loja (migration em `Tenant`) para **Reply-To**/contato no e-mail e no
          comprovante. Padrão de SaaS: envio pela plataforma, com nome de exibição = loja e
          Reply-To = e-mail da loja. (a) e (b) andam juntos: editar o template requer o SMTP.
- [x] **Perfil do usuário ("Meus dados")** — menu de conta no rodapé do menu lateral (ícone +
      nome; abre popover com nome/e-mail/papel, **Meus dados** e **Sair**). Painel edita nome
      e **telefone** (via `PATCH /me`) e troca a **senha** pelo Supabase Auth no cliente **com
      reautenticação** (pede a senha atual). E-mail é somente leitura. **Migration
      `0004_user_phone`** (coluna `phone` opcional em `users`; sem alteração de RLS). API+build
      ✅; Worker publicado (versão `685109c2`); E2E do `PATCH /me` 6/6. *(2.P)*
- [ ] Vínculo formal `users.id` ↔ `auth.users.id` (FK cross-schema) — *endurecimento opcional;
      não bloqueia o MVP (o vínculo já é garantido em código)*
- [ ] **NFC-e fiscal** (SEFAZ + certificado) — *fase futura dedicada (não é Fase 2)*

> **Gestão de usuários fecha a Fase 2 (ADR-008):** foi deixada por último de propósito —
> só faz sentido depois do núcleo do MVP (login → cadastros → venda → caixa → estoque →
> relatórios), e não bloqueou nada até aqui porque o primeiro OWNER de cada loja nasce do
> script de **bootstrap** (invite-only). Agora entra como o item de fechamento, trazendo
> junto o **RBAC** (o `user_role` já vai no JWT, mas ainda não é verificado). O papel de
> **Super Usuário (fabricante)** NÃO entra aqui — é de plataforma (cross-tenant) e vive na
> fase abaixo (ADR-009).

> **Nota de infra:** o cache de leitura do Hyperdrive foi **desabilitado**
> (`--caching-disabled`) para evitar listas desatualizadas logo após uma escrita —
> essencial num ERP/POS. O pooling de conexão segue ativo.

---

## 🟠 Fase 2.5 — Plataforma: multi-loja, Super Usuário e onboarding — **Concluída (A–E, Fatia E read-only)**

> Capacidades de **plataforma** que **cruzam o limite do tenant** (a fronteira de segurança
> via RLS). Separadas da Fase 2 de propósito: não são necessárias para uma loja operar e
> mexem no modelo de isolamento — ver **ADR-009**. Assentam sobre o RBAC da Fase 2 (ADR-008).

> **Decisões travadas (2026-07-02, ver `docs/plano-fase-2.5.md`):** onboarding **provisionado
> pelo Super Usuário** (sem signup público); identidade = **tabela `platform_admins` + claim
> `is_platform_admin`**; acesso cross-tenant por **rotas `/platform/*` dedicadas** (RLS de loja
> intacto). Execução em fatias A–D.

- [x] **Fatia A — Super Usuário (identidade + acesso cross-tenant)** — papel de plataforma **fora**
      do `UserRole` por-tenant: tabela `platform_admins` (verdade) + claim `is_platform_admin`
      (atalho de UI, via hook estendido). Middleware `requirePlatformAuth` (autoriza pela tabela),
      rotas `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. Migration
      `0005_platform_admin` (aditiva) aplicada + Worker publicado + **E2E 10/10** (2.5.A). Falta a
      **auditoria de plataforma** (Fatia D).
- [x] **Fatia B — Onboarding de loja (API)** — `POST /platform/tenants` cria `Tenant` + convida o
      primeiro **Admin** (`OWNER`) reusando o convite por e-mail (`inviteAuthUser` extraído p/
      `lib/authAdmin.ts`). `createTenantSchema` + `slugify` (shared); unicidade `slug`/`cnpj` (409);
      transação com `AuditEvent CREATE_TENANT`. **Sem migration.** API publicada (Version `ff3889d4`)
      + **E2E 12/12** (2.5.B). Falta o E2E do **e-mail real** (fica na Fatia C, com o navegador).
- [x] **Fatia C — Painel de gestão de lojas** (UI `/plataforma`, exclusivo do Super Usuário) —
      área separada do shell `(app)` com guard próprio (`GET /platform/me`); lista lojas + form
      "Nova loja" (`POST /platform/tenants`) + ativar/inativar (`PATCH /platform/tenants/:id` +
      `AuditEvent SET_TENANT_ACTIVE`). Login roteia por papel (`tokenIsPlatformAdmin`): super
      usuário → `/plataforma`. API Version `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada
      no navegador (2.5.C). *Entrar no contexto de uma loja p/ suporte = futuro (fatia própria).*
      **E2E do usuário validado (2026-07-05):** criar loja com e-mail real → convite → 1º Admin
      define senha → entra; ativar/inativar por linha.
- [x] **Exclusão de usuário da loja (ADR-008)** — `DELETE /users/:id` (Admin): apaga a linha em
      `users` **+ revoga a identidade no Supabase Auth** (`deleteAuthUser`, libera o e-mail para
      novo convite) **+ `AuditEvent DELETE_USER`**. Bloqueia excluir a si mesmo/o `OWNER`; usuário
      **com histórico** (pedidos/caixa — FKs sem cascade) → **409** orientando a *Desativar*
      (preserva integridade + auditoria). Botão **Excluir** na seção Usuários de `/configuracoes`.
      **Sem migration.** Typecheck API + web ✅. Worker publicado (Version `9f86b36c`) + **E2E no
      navegador validado pelo usuário (2026-07-05)**: excluir sem histórico some da lista + libera o
      e-mail; com histórico → 409 *Desativar*; `DELETE_USER` gravado. Pré-requisito da Fatia D (liberar
      o e-mail de teste).
- [x] **Fatia D — Auditoria de plataforma** — eventos `CREATE_TENANT` e `SET_TENANT_ACTIVE`
      (e `DELETE_USER`, de loja) **formalizados na lista fechada do ADR-004** (`meta.platform = true`;
      `userId` = Super Usuário; `tenantId` = loja-alvo) e **ADR-009 fechado** (Fatias A–D). **Sem
      migration, sem deploy** (só documentação).
- [x] **Endurecimento — bloqueio de loja desativada (ADR-009)** — desativar a loja (`SET_TENANT_ACTIVE`)
      passou a ter efeito real: `requireAuth` carrega `Tenant.isActive` → `tenantActive` no contexto;
      `GET /me` devolve o flag; novo middleware `requireActiveTenant` barra `POST /orders` (nova venda)
      com **403** quando inativa. Front: **aviso vermelho no topo** de toda tela (`(app)/layout`) +
      tela de **Nova Venda bloqueada**. Consultas/fechar caixa/cancelar/devolver seguem liberados (a
      loja ainda "encerra" pendências). Bloqueio aplicado a **novas vendas** (`POST /orders`),
      **abertura de caixa** (`POST /cash-sessions/open`) e **entrada de estoque** (`POST
      /stock/movements`); fechar caixa, ajuste de inventário, cancelar/devolver e consultas seguem
      liberados (ações de encerramento/correção). O aviso do topo lista as três operações. **Sem
      migration.** API `daf90038` + web `533c1921`; typecheck API+web ✅. **E2E no navegador validado
      pelo usuário (2026-07-05)**: inativar no painel → aviso vermelho + 3 operações bloqueadas (403) →
      reativar → volta ao normal.
- [x] **Fatia E — Entrar no contexto da loja para suporte (impersonation auditada)** — **read-only
      (2026-07-05)**. Token de suporte assinado e curto (HS256, secret `SUPPORT_TOKEN_SECRET`, TTL
      30 min) de escopo `{ platformAdminId, targetTenantId, exp }` — **não** login do lojista;
      emitido por `POST /platform/tenants/:id/support`. Rotas **`/support/*`** (fora de `/platform/*`)
      com `requireSupportSession` (verifica o token + revalida `platform_admins.isActive`): `GET
      /support/:tenantId/overview` + `POST /support/end`; RLS de loja **intacto** (fronteira =
      checagem explícita). Auditoria `SUPPORT_SESSION_START/END` (`meta.support = true`) na lista do
      ADR-004. UI: botão **Entrar (suporte)** em `/plataforma` → `/plataforma/suporte/[tenantId]`
      (banner "somente leitura" + overview + encerrar). **Sem migration.** Typecheck API+web ✅;
      build ✅ (nova rota); core 35/35. **No ar:** secret `SUPPORT_TOKEN_SECRET` provisionado + API
      (Version `1e323a22`) + web (Version `c13a34de`) publicados + smoke em produção ✅ (rotas exigem
      auth; `Bearer` inválido → 401, não 503, confirmando o secret). **Painel de suporte navegável
      (2.5.E.2, read-only):** a tela virou **3 abas** — Resumo, **Vendas** (filtro período/status +
      "Ver" itens/pagamentos) e **Produtos & Estoque** (busca nome/SKU + "só estoque baixo" +
      movimentações por material). 3 rotas de leitura novas (`/support/:id/orders|products|
      stock-movements`), API Version `1397654d` + web `d3f54d16`. **E2E no navegador validado pelo
      usuário (2026-07-05)** — sessão de suporte, abas/filtros/detalhes e read-only conferidos.
      **Escrita em modo suporte** (exceção auditada) fica como fatia futura — ADR-009.

---

## 🟣 Fase 3 — Recursos Avançados e Produção — **Em andamento**

- [x] **Fatia 3.A — PWA instalável + cache de app-shell** — `apps/web` virou PWA instalável
      (adicionar à tela inicial no celular/desktop). `app/manifest.ts` (`/manifest.webmanifest`),
      ícones (192/512 + maskable + apple-touch, gerados via sharp: "N" verde sobre `#111827`),
      metadata PWA (theme-color/apple-web-app) no `layout`, **service worker** (`public/sw.js`)
      de casca — **só GET same-origin** (API/Supabase passam direto pela rede, nunca cacheados;
      navegações network-first), registro **gated a produção** (`RegisterSW`), botão **"Instalar
      app"** (`beforeinstallprompt`) e página **`/offline`**. **Sem migration, sem API.** Typecheck
      web ✅; build ✅ (17 rotas: `/manifest.webmanifest` + `/offline`); smoke no navegador (manifest/
      ícones/meta/sw.js/offline) ✅. **No ar:** `npm run deploy` (web Version `1f290a7d`) + smoke em
      produção ✅. **E2E de instalação validado pelo usuário (2026-07-06)** — instalou com sucesso nas
      **3 plataformas** (Android, iPhone e PC). *(3.A)* **Fatia 3.A concluída.**

  > **ℹ️ Atualização do PWA (não precisa reinstalar):** um PWA instalado é um atalho para o app no
  > ar, não um pacote congelado. Todo `npm run deploy` é pego no **próximo carregamento** com
  > internet, porque as navegações são *network-first* e os assets do Next têm nome com hash (build
  > novo = arquivo novo). O `sw.js` se atualiza sozinho (`skipWaiting` + `clients.claim`); às vezes
  > a versão nova só "assume" no **2º abrir** (a 1ª abertura baixa em segundo plano). **Única
  > exceção:** trocar **ícone/nome** (vêm do manifest) pode exigir remover e readicionar à tela
  > inicial — sobretudo no **iPhone**, que segura o ícone antigo. Mudanças de código/tela/API: só
  > reabrir o app.
- [x] **Fila de sincronização offline — só VENDA, atrás de flag por loja — CONCLUÍDA e validada
      (2026-07-10)**. **ADR-011 escrito e
      ACEITO (2026-07-06)**. Estratégia travada (Outbox no cliente; **idempotência pela PK UUID do
      cliente**, sem tabela nova no 1º corte; servidor reaplica a venda em transação única e debita
      estoque no sync, ADR-001; append-only=dedup; `tenantId` validado contra o JWT, RLS intacto).
      **Decisões de produto aprovadas:** (a) estoque — trava **na venda** (cache local, como online);
      no resíduo do sync, **registrar e deixar negativo** p/ reconciliação (não rejeitar venda
      física concluída); (b) **1ª fatia = venda**, depois estoque e caixa, cadastros mutáveis por
      último; (c) **feature flag `OFFLINE_SALES` por loja via `TenantModule`** (sem migration),
      **nasce DESLIGADO** (ausência da linha = OFF), ligável pelo Super Usuário no painel
      `/plataforma` — recurso de **plano pago**; com o flag OFF e sem energia/internet, o plano B é
      **nota manual**. Como a fatia é só venda (append-only), **não há tela de resolução de
      conflito** neste corte. **Implementada e validada em produção (Fatias 1–6):** flag na ponta →
      envelope + `outbox` → worker de fila → `POST /orders` idempotente por PK → core+testes (47/47) →
      indicador de pendentes. **Sem migration** (AI 10). E2E ON + OFF + idempotência conferidos. Ver
      3.B/3.C/3.D no registro de testes.
  - [x] **Fatia 1 — flag `OFFLINE_SALES` + avisos (AI 4) — CONCLUÍDA e validada (2026-07-09)**.
        Interruptor por loja reusando `TenantModule` (**sem migration**; ausência/inativa = OFF).
        `packages/shared/modules.ts` (`MODULE_OFFLINE_SALES` + `isOfflineSalesOn` + `setTenantModuleSchema`);
        `GET /me` devolve `offlineSales`; `PATCH /platform/tenants/:id/modules` (upsert + `AuditEvent
        SET_TENANT_MODULE`, formalizado no ADR-004); toggle "Offline (pago)" no painel `/plataforma`;
        aviso de conexão no PDV/Caixa (`OfflineSalesNotice` + hook `useOnline`, só offline —
        OFF=nota manual / ON=recurso habilitado). Escopo: **só ler o flag + aviso** (a `outbox` real
        é a Fatia 2). Refinos após o E2E: aviso também no **caixa fechado** + botão "Abrir caixa"
        desabilitado offline (abrir caixa é online-only nesta fatia); erro cru de rede
        ("Failed to fetch") escondido offline (3.B.1/3.B.2). **No ar + E2E validado pelo usuário:**
        API `0b8c0348` + web `c35f8592`. Ver 3.B no registro de testes.
  - [x] **Fatia 2 — envelope de mutação + store `outbox` no IndexedDB (AI 5) — CÓDIGO PRONTO
        (2026-07-10)**. Infra do cliente (sem migration, sem API). Formato do envelope
        (`kind`/`entityId` UUID/`schemaVersion`/`payload`/`createdAt`) + `mutationEnvelopeSchema` +
        builder puro `buildSaleMutation` em `packages/shared/src/outbox.ts` (contrato compartilhado,
        idempotência pela PK, ADR-011 §2). Store `outbox` no IndexedDB (`apps/web/lib/outbox.ts`):
        FIFO por `seq` autoincremental, índice único `entityId` (dedup de enfileiramento), índice
        `status`; `enqueue`/`list`/`peekPending`/`countPending`/`markSynced`/`markError`/`remove`.
        Flag `OFFLINE_SALES` persistido em `localStorage` (`offlineFlag.ts` + `useMe` expõe
        `offlineSales` efetivo com fallback no cold start offline; `/venda` e `/caixa` usam-no).
        **Infra dormente/aditiva** — o PDV **ainda não enfileira** (isso pareia com o worker, Fatia 3),
        então o caminho vivo da venda não muda. Typecheck shared/api/web + build (17 rotas) + core
        35/35 ✅. **Deploy opcional** (nada user-observable ainda). Ver 3.C no registro de testes.
  - [x] **Fatias 3–6 — round-trip da venda offline NO AR e VALIDADO (2026-07-10).**
        Ciclo completo: PDV enfileira offline → worker drena ao voltar a rede → servidor aplica
        idempotente por PK. **Sem migration** (AI 10 avaliado: dedup usa a PK existente; estoque
        negativo permitido pelo tipo). **E2E validado em produção** (loja-demo ON): offline→enfileira→
        online→sincroniza; venda `#981d99d6` com a mesma PK, autoria "owner", estoque 258→256;
        **reenvio não duplica** (dedup por PK, estoque segue 256). Dois achados corrigidos (3.D.1):
        indicador de pendentes atualiza após enfileirar; copy do aviso ON. API `897d5524` + web
        `c74bbc5f`; core 47/47. Ver 3.D no registro de testes. Detalhe por fatia:
    - [x] **Fatia 3 — worker de sincronização (AI 6)** — `apps/web/lib/syncWorker.ts` drena FIFO
          (gatilhos `online`/foreground/montagem/botão via `useOutboxSync`), **para na 1ª falha**,
          retry só transitório. PDV enfileira quando **offline + recurso ON** (UUID no cliente +
          baixa otimista no cache local + tela "Salva offline — pendente").
    - [x] **Fatia 4 — `POST /orders` idempotente por PK (AI 7)** — `id` presente ⇒ venda offline:
          dedup por `orders.id` (no-op devolve a persistida), caixa vem do envelope (validado
          tenant+user), **estoque insuficiente não bloqueia** (registra e deixa negativo p/
          reconciliação, §6). Online intacto (gera PK, mantém bloqueio de estoque). `tenantId`/autoria
          do JWT (§7). **Sem migration.**
    - [x] **Fatia 5 — máquina de estados em `packages/core` (AI 8)** — `classifyHttpOutcome`
          (409=dedup=SYNCED), `classifyNetworkError`, `shouldRetry`/`MAX_SYNC_ATTEMPTS`,
          `syncBackoffMs` (exp., teto 30s), `haltsQueue` — **+12 testes Vitest** (47/47).
    - [x] **Fatia 6 — indicador de pendentes (AI 9)** — "X vendas pendentes" + "Sincronizar agora"
          no PDV + rótulo por venda offline. *Tela de `CONFLICT` segue adiada (venda é append-only).*
  - [x] **Refinos da fila offline (3.E) — NO AR e VALIDADO (2026-07-11)**. Três pontas soltas da venda
        offline, **só cliente** (sem migration/API): **(1) drenagem global** — o worker saiu de dentro
        do `/venda` para o shell `(app)` via `OutboxSyncProvider` (instância única) + **chip de status
        no topo** (aparece só com fila não-vazia; vermelho=falha/índigo=pendente); drena em qualquer
        tela quando a rede volta. **(2) poda de `SYNCED`** — `pruneSynced()` no fim do dreno (fila não
        cresce sem limite). **(3) tela `/pendencias`** — lista a fila (inclui `FAILED`, que sumia do
        contador) com **Tentar novamente** (`requeue`) e **Descartar**. Pub/sub na `outbox`
        (`subscribeOutbox`) mantém chip/PDV/tela em sincronia. Typecheck + build (**18 rotas**) + core
        47/47 ✅. **No ar:** web `3921af94` (+ `300254fc` do `error.tsx`) + smoke ✅. **E2E validado
        pelo usuário (2026-07-11)** no PWA do macOS: chip global + drenagem + vendas registradas
        (`#2f0d11b0`/`#7bfa4d01`). **Achados do E2E:** (3.E.1) navegar **offline entre telas** dava tela
        branca (chunk não cacheado) → mitigado com `(app)/error.tsx` (mantém shell/chip + aviso);
        (3.E.2) offline após remontar, o PDV assume "caixa fechado" (não lê `sessionId`/catálogo sem
        rede) — ambos são a lacuna de offline-first de leitura (fatia própria), não do refino. Ver
        3.E/3.E.1/3.E.2 no registro.
  - [x] **Cold-start / offline-first de LEITURA — fatia própria — CONCLUÍDA e VALIDADA (CS-1…CS-5, ver
        cabeçalho).** **Problema original (achados 3.E.1/3.E.2):** offline, `GET /me`, `/cash-sessions/current`
        e `/products` falham (API cross-origin, nunca cacheada — ADR-011 §7). A venda offline de 3.D só
        funciona porque `sessionId` + produtos ficam **em memória** enquanto o operador **não sai do
        `/venda`**; ao **navegar/remontar/reabrir offline**, essa memória se perde → PDV assume "caixa
        fechado" e catálogo vazio; e navegar para rota sem chunk cacheado quebra (hoje mitigado por
        `(app)/error.tsx`). **Meta:** o PDV segue **vendável offline** após remontar/reabrir. **Tudo no
        cliente — sem migration, sem custo de free tier** (IndexedDB/localStorage/SW cache no aparelho).
    - [x] **Passo 0 — ADR-012 escrito e ACEITO (2026-07-11)** (regra 4 cumprida). 5 decisões (a)–(e)
          aprovadas pelo Owner (`docs/adr/ADR-012-cold-start-offline-first-leitura.md`; índice do
          README das ADRs atualizado). Decisões travadas:
          (a) **validade do cache** offline — confiar no último snapshot conhecido enquanto offline,
          sempre preferir a rede online, e **rotular "dados de HH:MM"** quando servir do cache;
          (b) **caixa fechado no servidor durante o offline** — a venda offline referencia um
          `cashSessionId` que pode ter sido fechado noutro dispositivo: **anexar mesmo assim** (a venda
          ocorreu fisicamente naquele turno; divergência aparece na reconciliação) **ou** rejeitar →
          `FAILED` (tela de pendências); (c) **quais rotas são "offline-capable"** (venda + caixa-leitura
          no mínimo; histórico/estoque a decidir) para escopar o precache do SW; (d) **estoque offline**
          = último cache + baixas otimistas locais, reconciliação no sync (já ADR-001/ADR-011 §6);
          (e) **abrir caixa NOVO segue online-only** (âncora financeira) — cold-start cobre "caixa **já
          aberto**", não abrir um do zero sem rede.
    - [x] **Fatia CS-1 — cache do caixa aberto — CÓDIGO PRONTO (2026-07-11)** (pequena). Nova lib
          `apps/web/lib/cashSessionCache.ts` persiste `{ id, openedAt, openingAmount, openedByName,
          cachedAt }` em `localStorage` a cada `GET /cash-sessions/current` com caixa; **limpa** quando
          vier `null` (fechado online). Online a **rede sempre vence** (sobrescreve/limpa, decisão (a));
          offline, `/venda` e `/caixa` leem o cache → PDV reconhece o caixa aberto e recupera o
          `sessionId` p/ enfileirar, com rótulo **"dados de HH:MM"**. `/caixa` offline mostra card
          enxuto (sem "Abrir caixa", online-only). **Sem migration/API.** Typecheck + build (18 rotas)
          ✅; core 47/47 (não tocado). **NO AR (web `b55d670f`) + E2E validado pelo usuário (7/7,
          2026-07-11).** Ver 3.F.CS-1 no registro.
    - [x] **Fatia CS-2 — cache do catálogo de produtos — CÓDIGO PRONTO (2026-07-11)** (média). Abridor
          compartilhado extraído p/ `apps/web/lib/db.ts` (dono da versão do IndexedDB `nexoloja` +
          cria os stores num só `onupgradeneeded`); **bump `DB_VERSION`→2** adiciona o store `catalog`
          (upgrade v1→v2 preserva a `outbox`; **sem migration de servidor**). Nova lib
          `apps/web/lib/catalog.ts` (`cacheProducts`/`readCachedProducts`): a cada `GET /products` OK a
          rede vence e **sobrescreve** o espelho; offline, `/venda` monta o carrinho do cache (estoque =
          último conhecido − baixas otimistas, que agora fazem **write-through** no cache). `outbox.ts`
          refatorado p/ usar o `db.ts` (mantém `hasOutbox` como alias). Typecheck + build (18 rotas) ✅;
          core 47/47 (não tocado). **NO AR (web `b55d670f`) + E2E validado pelo usuário (7/7,
          2026-07-11).** Com CS-1 + CS-2, o PDV fica **vendável offline após remontar/reabrir** (ficando
          no `/venda`). Ver 3.F.CS-2 no registro. **Refino 3.F.CS-2.1 (web `a4cebe57`):** aviso de rede
          amigável (`OfflineNotice`) nas 5 telas online-only (Produtos/Estoque/Clientes/Relatórios/
          Histórico) no lugar do "Failed to fetch" cru — decisão (c) do ADR-012.
    - [x] **Fatia CS-3 — navegação offline entre telas — VALIDADA pelo usuário (2026-07-11)** (spike
          concluído). **Achado do spike:** a client-nav do Next (`<Link>`) busca o **RSC** (`?_rsc=`) pela
          rede — o SW não intercepta e falha offline; a **navegação real** (full load) embute o RSC no
          HTML e o SW serve documento + chunks do cache. Correção = **navegação por reload** offline
          (fallback pré-aprovado). `apps/web/app/(app)/OfflineNav.tsx` (interceptor de clique em captura:
          offline → `location.assign`; online = no-op) + **Service Worker v3** que **aquece o shell de
          todas as 9 telas do menu** (`warmRoutes` busca o HTML e cacheia documento + chunks `/_next/static/`;
          cache `STATIC` não-versionado sobrevive a deploys). Cópia dos error boundaries ajustada (viram
          rede de segurança). Typecheck + build (**18 rotas**) + core 47/47 ✅. **Substitui o paliativo do
          `error.tsx` pelo caminho real. NO AR + E2E validado pelo usuário** (offline: navega por todas as
          telas sem tela branca/`/offline`/`global-error`; online-only mostram banner "Sem conexão" com
          menu; Venda/Caixa/Pendências operam do cache). **3 achados corrigidos durante os E2E:** (.1)
          `router.prefetch` não cacheava o JS + bump do SW apagava chunks → SW v3 (`warmRoutes` + cache
          `STATIC`); (.2) tela online-only caía no beco `/offline` → aquecer todas as telas do menu; (.3)
          item **Configurações** sumia offline (`/me` falha → `isAdmin` false) → `lib/meCache.ts` cacheia o
          `/me` p/ o shell offline. Web Version `624912fe`. Ver 3.F.CS-3 (+ .1/.2/.3) no registro.
    - [x] **Fatia CS-4 — semântica de caixa fechado no sync — NO AR e VALIDADA (2026-07-11/12)** (decisão
          (b), a única sub-fatia que toca o servidor, **sem migration** — `AuditEvent.action` é String
          livre). `POST /orders` idempotente: no ramo offline detecta caixa **fechado** (`session.closedAt`)
          e, além de anexar (já anexava), grava **`AuditEvent SALE_ON_CLOSED_CASH`** (marca de
          reconciliação, não bloqueia). `GET /reports/cash-sessions` agrega as marcas por sessão
          (`lateSalesCount`/`lateSalesTotal`); a UI `/relatorios` mostra badge "N após fechamento · R$…"
          na linha do caixa. `SALE_ON_CLOSED_CASH` formalizado no ADR-004. Shared/api/web typecheck +
          build (18 rotas) + core 47/47 ✅. **NO AR (API `94f277ea` + web `ae5296b5`).** **E2E validado**
          (dois contextos: PWA offline registra a venda; aba anônima fecha o caixa; PWA sincroniza → venda
          entra + badge no relatório). Verificação de estoque da venda `#c0d0b8b9` (CASH R$370): Cimento
          **240 → 230**, débito atômico (ADR-001) intacto — a marca **não** afeta estoque/validade da
          venda. Ver 3.F.CS-4 no registro. **Com a CS-4, o ADR-012 (cold-start / offline-first de leitura)
          está CONCLUÍDO ponta a ponta (CS-1…CS-4).**
    > **Ordem de valor:** CS-1 + CS-2 entregam o essencial (PDV vendável offline após remontar, sem
    > navegar). CS-3 adiciona a navegação offline entre telas. CS-4 endurece a borda do caixa fechado.
    - [x] **Fatia CS-5 — "esperado ajustado" e divergência recalculada no relatório de fechamento
          (melhoria da conferência da CS-4) — CÓDIGO PRONTO (2026-07-13)**. Fecha a conta que o dono fazia
          na cabeça (ver 3.F.CS-4: caixa `8bda91ce` esperado R$893,20 + venda tardia CASH R$370 = R$1.263,20).
          **Implementado, sem migration:** (1) `POST /orders` enriquece o `meta` do `SALE_ON_CLOSED_CASH`
          com **`cashAmount`** (parcela CASH da venda — evita join nos `payments`); (2) função pura
          **`calcAdjustedCashClosing`** em `packages/core` (`adjustedExpected = expected + lateCashSalesTotal`,
          `adjustedDivergence = closing − adjustedExpected`) **+4 testes Vitest (47→51)**; (3)
          `GET /reports/cash-sessions` acumula `lateCashSalesTotal` (**só o DINHEIRO** — cartão/PIX conciliam
          na maquininha; **fallback ao `total`** p/ marcas antigas sem `cashAmount`) e devolve
          `adjustedExpected`/`adjustedDivergence`; (4) `CashSessionReport` (`packages/shared`) estendido; (5)
          UI `/relatorios` mostra "ajust. R$…" sob Esperado e Divergência quando há venda tardia em dinheiro.
          **NÃO reescreve o dado congelado** do fechamento (auditoria) — só exibe o cálculo pronto; o caixa
          fechado segue imutável e a venda tardia legítima **não** se devolve (ADR-006). Core 51/51 + api
          tsc + web typecheck/build (18 rotas) ✅. **NO AR (API `dedff652` + web `8e398cfd`) + conferido no
          navegador** (linha "ajust." aparece usando o dado da CS-4, fallback ao `total`). **Adendo (mesmo
          dia): responsável do caixa no relatório** — `GET /reports/cash-sessions` mapeia
          `openedByName`/`closedByName` (ADR-010, sem migration) e a UI mostra um **popover na célula
          "Fechado em"** (`CashSessionSummary`) com abertura/fechamento + quem abriu/fechou — **hover no
          desktop + toque no celular/PWA**, `position: fixed` (não é cortado pelo overflow da tabela), fecha
          ao tocar fora/Esc/rolar; não duplica as colunas financeiras. No ar (API `3c926d4c` + web
          `ac7c5b14`). Ver 3.F.CS-5 no registro.
- [x] **Módulo de ESTOQUE FINO + enriquecimento do cadastro de Produto — CONCLUÍDO (EF-1 → EF-2 → EF-3,
      todos no ar e validados; ver cabeçalho).** Decisão travada: **estoque/caixa seguem
      ONLINE-ONLY** (mutação offline adiada — ver a nota da decisão no topo do arquivo). Boa parte dos
      campos pedidos **já existe no schema** e não precisa de migration; falta só a UI + validação. Mapa
      do que **já existe** vs. **novo** (conferido em `packages/db/prisma/schema.prisma`, `model Product`):
      - `description VarChar(500)` → **já existe** (observação/descrição) — só falta na tela.
      - `weightKg Decimal(8,3)` → **já existe** (peso; 3 casas cobrem gramas). "kg/g" é **toggle de UI**,
        guardando canônico em **kg** (mesmo padrão de CNPJ/telefone: banco canônico, UI formata).
      - `unit UnitType` → **já existe** (UNIT / METER / SQUARE_METER / CUBIC_METER / KILOGRAM / LITER /
        THOUSAND / BAG / ROLL) — só falta expor o seletor no cadastro.
      - **apelido** → **NÃO existe** → coluna nova (a única migration da EF-1).
      - **segundo preço** (rolo fechado) → **NÃO existe** (`conversionFactor` existe, mas sem preço próprio) → EF-3.
  - [x] **EF-1 — Cadastro de produto enriquecido** *(rápida; 1 migration aditiva)* — **COMPLETO e NO AR (2026-07-15).**
    - [x] **Apelido/nome popular + BUSCA** — FEITO. Renomeamos `nickname`→**`popularName`** (`VarChar(150)`,
          nullable, sem RLS); **migration `0007` aplicada**; índice `products_tenantId_popularName_idx`. Busca por
          **nome + nome popular + SKU** nas telas Produtos e Venda (`productMatchesQuery` no core, +7 testes). **Bônus:**
          leitura de **código de barras** (o `sku` é o código) — Enter-scan (leitor físico) + `BarcodeScanButton` (câmera,
          `BarcodeDetector` + `@zxing`). **API + web deployados e validados (no ar).**
    - [x] **Descrição/observação** (`description`, já no banco) — textarea (até 500) no cadastro. **NO AR (2026-07-15).**
    - [x] **Peso** com toggle **kg/g** (canônico em kg — `weightKg` já no banco) — input + seletor kg/g;
          gramas ÷ 1000 no envio (mesmo padrão CNPJ/telefone: UI formata, banco canônico). **NO AR.**
    - [x] **Unidade de venda** (dropdown do `UnitType`, já no banco) — `<select>` com rótulos PT-BR
          (`unitTypeLabels` novo em `packages/shared`, reutilizável no PDV/comprovante). **NO AR.**
    - Sem nova migration (campos já existem) e **sem deploy de API** (a API de 14/07 já aceita os 3 campos —
      `POST /products` repassa `...parsed.data` ao Prisma). **Não toca PDV/estoque transacional.** Gates:
      typecheck web ✅, build web (18 rotas) ✅, core 58/58 ✅. **Web deployado** (Version `4baf2760-…`) +
      **E2E do usuário validado** (Metro/250 g→0,25 kg/descrição persistiram — ver registro). **EF-1 fechado.**
  - [x] **EF-2 — Estoque fino (online-first)** *(sem migration)* — **COMPLETO e NO AR (2026-07-15).** Deu
        superfície ao que já existia no core, usando `StockMovement`/`minStockQty`. Online-first — **não toca a
        fila offline**.
    - [x] **Fatia 1 — Painel de reposição** — Card no topo da tela de Estoque que junta num lugar só tudo que
          está no ponto de reposição (saldo ≤ mínimo, mínimo > 0), com **badge zerado/baixo**, **sugestão de
          compra** (quanto falta p/ o mínimo) e ordenação (zerados primeiro, maior falta no topo). Funções puras
          novas no core **`isLowStock`** + **`replenishmentShortfall`** (+10 testes → **68/68**), reusadas também
          no badge e na tabela (removida a duplicação da regra inline). Só front (web `42314d77`). **E2E
          validado** (Cimento baixo +70; Mouse zerado +5; dados de teste revertidos após a demo).
    - [x] **Fatia 2 — Visão consolidada por produto (saldo × mínimo × histórico)** — a tabela "Estoque atual"
          ganhou colunas **Entradas** (Σ INCOME), **Saídas** (Σ EXPENSE) e **Saldo (hist.)** = Σ entradas − Σ
          saídas, com **aviso ⚠ quando diverge** do `stockQty` (consistência do cache, ADR-001). Clicar no
          produto **filtra as movimentações** daquele item (liga saldo ↔ histórico). Novo endpoint agregado
          **`GET /stock/summary`** (Prisma `groupBy`+`_sum`, cost-zero — não trafega o histórico inteiro). Sem
          migration; **deploy de API** (Version `d1f6799a`) + web (`3523dd7c`). **E2E validado** — Argamassa
          confere (55−6=49); o ⚠ **capturou divergências reais no seed** (Cimento 230≠200, Tijolo 955≠905) e o
          clique no produto filtrou o histórico. *(ver EF-2 fatia 2 no registro)*
  - [x] **EF-3 — Venda em unidade alternativa** *(complexa; ADR próprio)* — **COMPLETO, NO AR e VALIDADO
        (2026-07-16).** Vender o mesmo produto **por metro** OU como **rolo fechado**, com **preços
        diferentes** (o rolo sai mais barato por metro). **ADR-013 (Opção A, aprovada):** segundo preço
        reusando `conversionFactor`; **2 migrations aditivas** — `0008` (`products.altUnit`/`altSalePrice`)
        e `0009` (`order_items.baseQuantity`, snapshot p/ o estorno em unidade-base ser robusto a mudança
        de fator). **Core:** `hasAltUnit`/`resolveSaleUnit`/`toBaseQuantity`/`effectiveBaseUnitPrice`
        (**+14 → 82/82**). **API `POST /orders`:** baixa e `StockMovement` em unidade-base (`qtd × fator`),
        `OrderItem` grava `baseQuantity` + unidade vendida; **cancelar/devolver** estornam em base
        (`baseQuantity ?? quantity`, cobre pedidos antigos). **Web:** cadastro ganhou o bloco "unidade
        alternativa"; PDV mostra botões **base × embalagem**, carrinho com a base equivalente e trava de
        estoque em base (`saleMode` no payload online+offline); **comprovante** imprime a embalagem
        ("Fio — Rolo (100 m)"). Cache do catálogo estendido. **No ar:** API `4f19776c` + web `98453ac5`.
        **E2E validado:** fio metro R$2 / rolo 100 m R$150 (estoque 500) → venda metro Saída 5; venda rolo
        (2×) Saída **200**; cancelamento Entrada **200** (não 2!); saldo 495. Casos extras (margem efetiva,
        dois modos no mesmo carrinho, produto comum inalterado) OK.
- [ ] Otimização do pooler (6543) para limites do free tier
- [ ] Avaliar upgrade Supabase Pro p/ produção

---

## 📌 Notas / decisões em aberto

### ▶️ Pendências para a próxima sessão (deixadas após o EF-3, 2026-07-16)

> Nenhuma bloqueia produção. **Não há deploy pendente** — API `4f19776c` + web `98453ac5` estão no ar e
> commitados (`4802a63` código + `c794811` docs). Ordem sugerida:

1. [x] **Reconciliar as divergências de estoque do seed (rotina do ADR-001).** ✅ **FEITO (2026-07-16).**
       Nova rotina geral `packages/db/scripts/reconcile-stock.mjs` (dry-run por padrão; `--apply` corrige;
       `--tenant <slug>` opcional) recalcula `stockQty = Σ INCOME − Σ EXPENSE` e alinha o cache. No dry-run,
       além de **Tijolo 955→905** e **Cimento 220→190** (o Cimento havia andado desde o snapshot — era 230→200;
       mais uma saída de 10 no meio), apareceu um **3º caso**: soft-deleted **Cimento CP-II (CIM-50) 120→0**
       (estoque-fantasma, zero movimentos). Aprovado e aplicado nos 3; verificação pós-apply = **0
       divergências**. Só corrigiu dado (UPDATE em `products.stockQty`), sem migration/deploy. Ver
       "Reconciliação de estoque do seed" no registro de testes.
2. [x] **Limpar o dado de teste do EF-3.** ✅ **DECIDIDO (2026-07-16): manter.** O produto **"Cabo Flexível
       2,5mm — TESTE 2 EF1"** (estoque 495) + vendas de teste (`f3939b7d` metro, `52408f3e` rolo cancelada)
       ficam **de propósito** no tenant — é a **loja Demo**, servem para futuros testes/demos do rolo. Sem ação.
3. [~] **Itens finais da Fase 3 — LEVANTADOS e DOCUMENTADOS (2026-07-16), execução adiada p/ go-live.**
       Plano completo em **`docs/plano-producao.md`**. Achados:
       - **Pooler:** a premissa "otimizar p/ 6543" estava **invertida** — a Cloudflare recomenda a conexão de
         **sessão (5432)**, não a de transação (6543), pois o Hyperdrive já é um pooler. **O projeto já está
         em sessão/5432** (`aws-1-...pooler.supabase.com`, `origin_connection_limit=20`). Único ajuste real:
         baixar o `origin_connection_limit` **se** aparecer "too many connections". Comentário do
         `wrangler.toml` (que dizia usar `DIRECT_URL`) corrigido.
       - **Supabase Pro:** banco em **12 MB de 500 MB** (o teto está a ~160 mil vendas → anos). Gatilho real
         **não é tamanho**, e sim confiabilidade ao entrar a 1ª loja real: backups diários, sem auto-pause,
         e-mail com marca. Script de medição: `packages/db/scripts/db-size.mjs`.

- **Prisma 6 (não 7):** mantido de propósito por estabilidade de conexão. Não subir sem revalidar a conexão pela edge.
- **Atualizar o wrangler da API (3.114 → 4.x) — ✅ concluído (2026-07-03):** as **duas apps** agora usam **wrangler `4.107.0`** e um **único `workerd 1.20260701.1`** na raiz (meta + binário), **sem binários aninhados** (os `optionalDependencies` de workerd que existiam no web foram removidos — deixaram de ser necessários). A config `wrangler.toml` da API não precisou de mudança (chaves padrão). Validado com `deploy --dry-run` (bindings Hyperdrive/R2/`SUPABASE_URL` ok; secret `SUPABASE_SERVICE_ROLE_KEY` persiste no Worker) + smoke (`/health`, `/db-check` → tenants:2, `/me` 401). Ver "Infra.WranglerV4" no registro de testes.
- **Migrations no Supabase:** usar `migrate diff` + `migrate deploy` (o `migrate dev` tropeça no *shadow database* do free tier).
- **Auth:** credenciais são do Supabase Auth; a tabela `users` não guarda senha.
