# ADR-014 — Usuário multi-loja (membership + loja ativa da sessão)

- **Status:** **Proposto** — aguardando aprovação do Owner. **Nada será codado nem migrado até a aprovação.**
- **Data:** 2026-07-17
- **Contexto de fase:** Fase 3 (produção). Assenta sobre o RBAC da loja (ADR-008) e a plataforma/multi-loja
  do Super Usuário (ADR-009), **sem** se confundir com eles (ver "Não é isto" abaixo).
- **Deciders:** Owner do produto (pendente).

> ⚠️ **Este ADR implica alteração de banco** (tabela nova + mudança no hook de token + políticas RLS) e
> mexe na **fronteira de isolamento multi-tenant**. Por isso vem primeiro como decisão no papel (regra 4 do
> `CLAUDE.md`); as migrations só serão escritas/aplicadas após aprovação explícita (regra 1).

---

## Contexto

Hoje o vínculo é **1 usuário → 1 loja**, gravado direto na tabela `users`:

- `users.id` = id do Supabase Auth (**PK**), com **um** `tenantId` (NOT NULL) e **um** `role` na mesma linha.
- Como o `id` é a chave primária, **a mesma pessoa não pode ter duas linhas** → para operar duas lojas hoje
  seria preciso **dois logins/e-mails** distintos.
- O `POST /users/invite` (ADR-008, fatia 2) inclusive **recusa (409)** um e-mail que já pertence a outra loja —
  é o guard anti-"sequestro" atual, coerente com o modelo 1:1.

**Requisito:** uma pessoa (tipicamente o **dono de mais de uma loja** ou um **gerente compartilhado**) quer
**um único login** e, ao entrar, **escolher qual loja** acessar. Se tiver acesso a só uma loja, entra direto
(comportamento atual). Se tiver a duas ou mais, aparece um **seletor de loja** no login, e um **"trocar de
loja"** no topo do app sem precisar relogar.

### Não é isto (para não confundir com o que já existe)

- **Não é o Super Usuário (ADR-009).** O Super Usuário é identidade de **plataforma** (`platform_admins`,
  cross-tenant por rotas `/platform/*` e suporte read-only). Isto aqui é para **lojista/operador comum** com
  vínculo real a N lojas. Mecanismos separados.
- **Não é impersonation/suporte.** O usuário multi-loja **opera de verdade** cada loja a que pertence, com o
  papel que tem **naquela** loja.

---

## Como o modelo atual ajuda (o que reduz o risco)

Ponto crítico levantado na análise: **o `requireAuth` da API resolve o tenant lendo a tabela `users`**
(`prisma.user.findUnique(sub)`), **não** de um claim imutável do JWT. O claim `tenant_id` do token só é usado
pelo **RLS** do acesso **direto** via `supabase-js` (`current_tenant_id()`), que é defesa secundária — o tráfego
de dados do app passa pela **API** (`apiGet`/`apiPost`).

Consequência de projeto: o **caminho transacional (API) se adapta sem re-emitir token do Supabase**. Basta a API
validar "esse usuário é membro da loja X?" e escopar por X. O trabalho difícil concentra-se no **RLS** (seção
própria abaixo).

---

## Decisões de modelagem

### 1. Tabela de vínculo `TenantMembership` (o papel vive no vínculo)

```
model TenantMembership {            // "usuário é membro de uma loja, com um papel"
  id         Uuid   @id @default(uuid())
  userId     Uuid                    // = users.id = auth.users.id (a identidade única da pessoa)
  tenantId   Uuid                    // a loja
  role       UserRole                // papel NESTA loja (Dono na A, Caixa na B — decisão aprovada)
  status     MembershipStatus @default(ACTIVE)   // ACTIVE | PENDING (consentimento, ver anti-hijack)
  isActive   Boolean @default(true)  // desativar corta o acesso SÓ a esta loja
  invitedByName String? @db.VarChar(100)  // autoria da concessão (ADR-010)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([userId, tenantId])       // impossível duplicar vínculo
  @@index([tenantId])                // listar membros de uma loja
  @@map("tenant_memberships")
}
```

- **`users` vira a linha de identidade** (name/email/phone, PK = auth id). O `tenantId`/`role` **migram** para
  `TenantMembership`. Tudo que referencia `users.id` (`orders.userId`, `cash_sessions.userId`,
  `stock_movements.userId`, autoria ADR-010) **continua válido** — a identidade é uma só.
- **Papel por loja:** decisão aprovada — o `role` fica no vínculo, então Dono na Loja A e Caixa na Loja B é
  natural. `isAdminRole` (shared) passa a ser avaliado **no contexto da loja ativa**.

### 2. Loja ativa da sessão (sem re-emitir token)

- O cliente guarda `activeTenantId` (localStorage) e o envia num header **`x-active-tenant`** nas chamadas da API.
- `requireAuth` valida que existe um **`TenantMembership` ACTIVE + isActive** para `(sub, x-active-tenant)`;
  usa esse `tenantId` e o `role` **daquela** membership. Sem header: se o usuário tem **uma** membership, usa
  ela (retrocompatível); se tem **várias**, responde **409 "selecione a loja"** (o front então mostra o seletor).
- **Não há re-mint de JWT do Supabase** — o token continua identificando só a pessoa (`sub`); a loja ativa é um
  parâmetro de requisição validado contra o banco. Simples e sem depender de recursos pagos do Auth.

### 3. Fluxo de login + troca de loja (a parte de UX que o Owner pediu)

- Após login, o front chama `GET /me` → devolve **a lista de memberships** (lojas + papel + status) do usuário.
- **1 loja** → seleciona automático e segue (idêntico ao de hoje).
- **2+ lojas** → mostra o **seletor** ("Selecione a loja") abaixo do login; a escolha vira `activeTenantId`.
- No shell `(app)`, um **indicador da loja atual** no topo com **"trocar de loja"** (reabre o seletor; troca
  sem relogar). Convenção: trocar de loja **limpa caches por-loja** (ver Consequências / offline).

### 4. Concessão de acesso — "ambos" com integridade (anti-sequestro de identidade)

Modelo aprovado: **Super Usuário concede (onboarding/painel) E Admin da loja convida um e-mail existente.** Como
removemos o guard atual ("1 tenant por identidade"), entra um novo conjunto de regras para não abrir brecha:

> **Princípio:** a **identidade** é global e única (`auth.users`); cada **membership** é **explícita,
> consentida, escopada e auditada**. O Admin concede *acesso à loja dele* — nunca ganha poder sobre a identidade
> da pessoa.

1. **Consentimento (opt-in).** Convidar um e-mail que **já existe** cria a membership como **`PENDING`**, não
   ativa. A pessoa vê "Você foi convidado para a Loja X — Aceitar/Recusar" no próximo login (e/ou por e-mail) e
   **só então** a loja aparece para ela e ela conta como membro. Typo/adição indevida ⇒ a pessoa simplesmente não
   aceita. (E-mail **novo** = convite normal de hoje: identidade nova criada no Auth, sem risco de sequestro; pode
   nascer `ACTIVE` porque a própria definição de senha é o consentimento.)
2. **Resposta genérica (anti-enumeração).** `POST /users/invite` responde **igual** ("convite enviado"), exista o
   e-mail ou não. O Admin nunca descobre se a pessoa já tinha conta nem em quais lojas está.
3. **Zero vazamento de identidade.** Enquanto `PENDING`, o Admin vê **só o e-mail** que digitou — nada de nome,
   telefone ou outras lojas. Autoria (ADR-010) congela o nome por ação, sem vazamento retroativo.
4. **Escopo estrito por loja.** O Admin da Loja B só concede/edita papéis **na Loja B** (nunca vê nem toca a
   membership da pessoa na Loja A). Desativar um vínculo corta o acesso **só àquela** loja.
5. **Guards preservados (ADR-008).** Não rebaixar/remover o `OWNER` de uma loja; não alterar a própria membership
   de forma a se auto-bloquear; `@@unique([userId, tenantId])` barra duplicidade no banco.
6. **Tudo auditado (ADR-004).** Conceder/aceitar/recusar/revogar vínculo → `AuditEvent` com ator (Admin **ou**
   Super Usuário) e alvo. O Super Usuário concede direto (identidade de plataforma, confiável), mas grava na mesma
   tabela e trilha.

### 5. Exclusão de usuário / saída de loja (histórico ancora em identidade+loja, nunca na membership)

Com o multi-loja, **"excluir usuário" deixa de ser uma operação só** e se separa em duas, bem diferentes de risco:

> **Regra de design (a que garante o requisito):** o histórico de ações — `orders.userId`,
> `cash_sessions.userId`, `stock_movements.userId`, autoria ADR-010 — ancora em **`(userId da identidade +
> tenantId da loja)`**, **nunca** em `TenantMembership.id`. A membership é só a **chave de acesso**, desacoplada
> da autoria. Logo, mexer no vínculo **não** toca registro histórico nenhum.

**(a) Sair de UMA loja — revogar a membership** *(o caso comum do dia a dia)*
- Mexe **só** na linha `TenantMembership(userId, tenantId)`. A identidade e o histórico ficam intactos; a pessoa
  mantém as **outras** lojas e o login.
- **Os registros dela naquela loja permanecem** (apontam para a identidade, que continua existindo, + o snapshot
  de nome congelado da ADR-010). Relatórios/comprovantes seguem mostrando "Registrado por [nome]" para sempre.
- **Seguro e trivial** — como nenhum histórico referencia `membership.id`, pode ser `DELETE` real da linha.
  **Preferência:** `isActive=false` (soft) + `AuditEvent REVOKE_MEMBERSHIP`, para deixar rastro de "foi membro,
  saiu em X". Não trava por histórico (é o ponto: histórico não está no vínculo).
- **Guard (ADR-008 no contexto da loja):** não remover a membership do **`OWNER`** — toda loja precisa manter um
  dono. `requireAdmin` passa a valer sobre o papel **da loja ativa**.

**(b) Excluir a IDENTIDADE inteira — a pessoa / conta do Auth** *(raro; libera o e-mail)*
- Mantém **a mesma trava de hoje** (2.5.Del): se a identidade tem histórico em **qualquer** loja (FKs sem
  cascade), o hard-delete é **bloqueado → desativa** (`users.isActive=false`), preservando integridade + registros.
  Só se apaga a identidade + revoga o Auth quando ela **não tem histórico em loja nenhuma** (e, por consistência,
  sem memberships ativas).
- Diferença vs. hoje: a checagem de histórico deixa de ser "nesta loja" e passa a ser **cross-loja** (a identidade
  é global). O `DELETE /users/:id` de loja passa a significar **(a)** (revogar membership); a exclusão da
  identidade é uma ação mais forte, restrita (Super Usuário ou dono da própria conta).

**Resumo:**

| Operação | Dificuldade | Histórico |
|---|---|---|
| Sair de uma loja (revogar membership) | Simples (1 linha) | Preservado (ancora em identidade+loja) |
| Excluir identidade inteira | Igual a hoje (trava por histórico → desativar) | Preservado (identidade desativada, não some) |

Novos `AuditEvent`: `REVOKE_MEMBERSHIP` (além de `GRANT_MEMBERSHIP`/`ACCEPT_MEMBERSHIP` da seção 4), formalizados
na lista fechada do ADR-004 quando a Fatia 4 for implementada.

---

## A decisão difícil: RLS com N lojas

O `current_tenant_id()` hoje lê **um** `tenant_id` do JWT (injetado pelo hook a partir de `users.tenantId`). Com N
lojas isso não fecha. Opções:

### Opção RLS-A — Re-emitir/escopar o token por loja selecionada (rejeitada)
Fazer o JWT carregar a loja **escolhida** (re-mint a cada troca, ou GUC por conexão via `set_config`). **Contras:**
o Supabase Auth não oferece re-mint com claim arbitrário de forma limpa no free tier; `set_config` por request no
caminho `supabase-js` é frágil. Complexidade alta para o ganho.

### Opção RLS-B — Claim de **lista** de memberships + isolamento na API (recomendada)
- O hook passa a injetar **`tenant_ids`** (array das memberships **ACTIVE + isActive** do usuário) no JWT, no
  lugar do `tenant_id` único.
- `current_tenant_id()` vira **`current_tenant_ids() → uuid[]`** (faz o parse do array do claim); as políticas
  trocam `"tenantId" = current_tenant_id()` por **`"tenantId" = ANY(current_tenant_ids())`**.
- **A API continua sendo o ponto de imposição** da **loja ativa única** (valida `x-active-tenant` contra a
  membership e escopa as queries). O RLS passa a permitir, no caminho **direto** `supabase-js`, ler linhas de
  **qualquer loja da qual a pessoa é membro** — o que **não enfraquece** a fronteira: não-membros continuam sem
  acesso, e o usuário legitimamente pertence a todas aquelas lojas. O "estreitamento" para a loja ativa é
  responsabilidade da API (onde o app efetivamente lê/escreve).
- **Racional:** preserva a garantia de segurança que importa (isolamento entre quem-é e quem-não-é membro), evita
  dependência de recurso pago, e mantém o hook como "atalho", não como fonte de verdade (padrão já adotado no
  ADR-009 para `is_platform_admin`).

> **Nota de segurança a registrar:** o RLS deixa de ser "uma loja por sessão" e passa a ser "as lojas do
> usuário". A imposição de **loja ativa** vive na API. Isso é aceitável **porque** o app roteia dados pela API;
> se algum dia um caminho `supabase-js` direto precisar de escopo de loja-ativa no próprio banco, aí sim se
> reavalia a Opção RLS-A (ou um GUC de sessão).

---

## Impacto no banco (a aprovar)

Migrations **aditivas** e faseadas (padrão do projeto: `migrate diff` + `migrate deploy`, free tier):

1. **`TenantMembership` (tabela nova) + enum `MembershipStatus` + RLS própria** (isolamento por `tenantId`, padrão
   ADR-003) + **backfill**: uma linha `ACTIVE` por usuário atual, copiando `users.tenantId`/`role`. Aditiva; nada
   quebra (dual-source temporário — ver fatias).
2. **Hook `custom_access_token_hook` + políticas RLS**: passar de `tenant_id` (single) para `tenant_ids` (array) e
   trocar as ~13 políticas `= current_tenant_id()` por `= ANY(current_tenant_ids())`. **Mudança sensível de
   segurança** — testar isolamento antes/depois (regressão de RLS, como na 2.B+C).
3. **Cleanup (fatia final, separada):** tornar `users.tenantId`/`role` nullable e, quando todo o read-path estiver
   na membership, **remover** essas colunas. Só depois de tudo migrado e validado.

**Nenhuma será escrita como migration até a aprovação.**

---

## Consequências

- **Ripples de código:** `requireAuth` (resolve loja ativa por header+membership), `requireAdmin` (papel da loja
  ativa), `GET /me` (lista de memberships), `/users` (gestão vira **por loja** — membros da loja ativa),
  `POST /users/invite` (consentimento + resposta genérica), onboarding/`/platform` (Super Usuário concede
  membership), e o **login + shell** (seletor e troca de loja).
- **Offline (ADR-011/012):** os caches por-loja (catálogo, caixa aberto, outbox) **passam a ser chaveados por
  `activeTenantId`** para não misturar dados entre lojas. **Trocar de loja limpa/segrega o cache.** É a principal
  interação com o offline — precisa entrar no desenho das fatias que tocam cache.
- **Autoria (ADR-010):** inalterada — `userId` é único; o snapshot de nome continua congelando por ação.
- **Núcleo puro (`packages/core`):** entra função pura de resolução de papel-na-loja / seleção de membership,
  testável com Vitest (regra 2) — sem I/O.
- **Retrocompatibilidade:** usuário de **uma** loja não percebe mudança (sem header → única membership; sem
  seletor). O seletor e a troca só aparecem para quem tem 2+.

---

## Fatiamento proposto (evita big-bang)

1. **Fatia 1 — Modelo de dados (migration 1 + backfill).** Cria `TenantMembership`, popula 1 linha por usuário,
   mantém `users.tenantId`/`role` como espelho (dual-source). **Sem mudança de comportamento** — infra dormente.
2. **Fatia 2 — Read-path da loja ativa + login/seletor + switcher.** API resolve loja ativa por `x-active-tenant`
   validado na membership; `GET /me` devolve as lojas; UI de seleção/troca. Single-store intacto. **Sem RLS ainda**
   (a API já isola). Cache offline chaveado por loja.
3. **Fatia 3 — RLS multi-loja (migration 2, Opção RLS-B).** Hook `tenant_ids` + políticas `= ANY(...)`. Testes de
   regressão de isolamento (membro vê suas lojas; não-membro é barrado; `anon` vazio).
4. **Fatia 4 — Concessão/remoção de acesso "ambos" + consentimento.** Super Usuário concede; Admin convida
   existente com fluxo `PENDING → ACEITAR`, resposta genérica, anti-vazamento, auditoria. Inclui **revogar
   membership (sair de uma loja)** e a nova semântica de exclusão da seção 5 (identidade vs. vínculo).
5. **Fatia 5 — Cleanup (migration 3).** Remover `users.tenantId`/`role` quando todo o read-path estiver na
   membership. Só após validação ponta a ponta.

Cada fatia com seus gates (core/tsc/build) e — nas que tocam banco — aprovação da migration antes de codar.

---

## Action Items (após aprovação)

1. [ ] **Owner aprova o modelo** (tabela `TenantMembership`, papel por loja, Opção **RLS-B**, concessão "ambos"
       com consentimento) e o **fatiamento**.
2. [ ] **Fatia 1** — migration `TenantMembership` + `MembershipStatus` + RLS + backfill (aprovar migration).
3. [ ] **Fatia 2** — read-path loja ativa (`x-active-tenant`), `GET /me` com memberships, login/seletor + switcher,
       cache offline por loja. Gates + deploy + E2E.
4. [ ] **Fatia 3** — hook `tenant_ids` + políticas RLS `= ANY(...)` (aprovar migration) + regressão de isolamento.
5. [ ] **Fatia 4** — concessão "ambos" + consentimento `PENDING`/anti-hijack + auditoria. Gates + deploy + E2E.
6. [ ] **Fatia 5** — cleanup de `users.tenantId`/`role` (aprovar migration).
7. [ ] Atualizar `ROADMAP.md`, registro de testes e o índice das ADRs a cada fatia.

---

## Relacionadas

- **[ADR-008](./ADR-008-papeis-e-rbac.md)** — papéis/RBAC da loja: o `role` deixa de viver em `users` e passa ao
  vínculo; `isAdminRole` é avaliado na loja ativa.
- **[ADR-009](./ADR-009-multi-loja-e-super-admin.md)** — plataforma/Super Usuário (cross-tenant): mecanismo
  **distinto**; aqui o acesso multi-loja é de **usuário comum**, mas o Super Usuário pode **conceder** memberships.
- **[ADR-010](./ADR-010-atribuicao-de-autoria.md)** — autoria por `userId` único: inalterada.
- **[ADR-011](./ADR-011-fila-de-sincronizacao-offline.md)** / **[ADR-012](./ADR-012-cold-start-offline-first-leitura.md)**
  — caches e outbox passam a ser **por loja ativa** (chave `activeTenantId`).
- **RLS/hook** — precedente em `0002_rls_and_auth_hook` (o hook e as ~13 políticas que este ADR altera).
