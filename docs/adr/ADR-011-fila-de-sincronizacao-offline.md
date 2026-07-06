# ADR-011 — Fila de sincronização offline (IndexedDB → Supabase)

- **Status:** Aceito (2026-07-06) — estratégia travada; implementação nas fatias da Fase 3
- **Data:** 2026-07-06
- **Contexto de fase:** Fase 3, logo após a Fatia 3.A (PWA instalável concluída e no ar)
- **Deciders:** Owner do produto (aprovado em 2026-07-06)

> ⚠️ **Regra 1 do `CLAUDE.md`:** este ADR **implica alteração de banco** (novos campos/tabela
> de idempotência) e **ainda não deve virar migration**. Ele existe para **decidir no papel**
> antes de qualquer código. As colunas `syncStatus` e os `id` UUID gerados no cliente **já
> existem** no schema (foram desenhados na Fase 0 para este momento); o que falta decidir é o
> **protocolo** de sincronização.

---

## Contexto

O MVP é **online-first** (ADR-005): toda escrita hoje vai direto à API na edge. A Fase 3 promete
o **offline-first completo**: registrar **venda, movimento de estoque e movimento de caixa sem
internet** e sincronizar quando a conexão voltar. Isso é o coração operacional de um POS — um
caixa não pode parar porque a internet caiu.

O schema **já foi desenhado para isto** na Fase 0:

- `enum SyncStatus { PENDING, SYNCED, CONFLICT }` já existe.
- `Order.id`, `StockMovement.id`, `CashMovement.id`, etc. são **UUID gerados no cliente**
  (`@default(uuid())`), não `serial` do banco — de propósito, para o cliente poder criar a
  identidade **antes** de falar com o servidor.
- `Order.syncStatus` já nasce `PENDING`; os demais nascem `SYNCED` (escrita online).
- A **[ADR-001](./ADR-001-consistencia-de-estoque.md) item 4** já prometeu: *"vendas `PENDING` só
  debitam o estoque ao serem confirmadas no servidor, dentro da mesma transação atômica"*.

O que **não** está decidido — e é o que dói — é o **protocolo** de sincronização:

1. **Idempotência:** a rede pode cair **depois** de o servidor efetivar a venda mas **antes** de
   o cliente receber o ACK. O cliente reenvia. Como garantir que a venda **não seja aplicada duas
   vezes** (estoque debitado 2×, caixa somado 2×)?
2. **Atomicidade (ADR-001):** uma venda é `Order` + `OrderItem[]` + `Payment[]` + `StockMovement[]`
   + update de `stockQty` + efeito no caixa. Tudo isso precisa ser reaplicado no servidor **numa
   transação só**, ou nada.
3. **Ordenação/dependências:** uma venda offline referencia um **caixa** que também pode ter sido
   aberto offline. Em que ordem sincronizar?
4. **Conflito:** dois dispositivos editam o mesmo produto offline; ou uma venda offline não "cabe"
   no estoque do servidor porque outro caixa já vendeu. Quem ganha?
5. **RLS/segurança:** a mutação viaja com um `tenantId` gerado no cliente — o servidor não pode
   confiar cegamente nele.

Restrições transversais: **cost-zero** (Supabase free — nada de log infinito, coerente com a
[ADR-004](./ADR-004-soft-delete-e-auditoria.md)) e **RLS intacto** (isolamento no Postgres, não só
na aplicação).

---

## Decisão

### 1. Padrão *Outbox* (fila de mutações no cliente), não replicação de tabelas

O cliente **não** espelha tabelas do Postgres no IndexedDB para depois "mesclar". Em vez disso,
cada ação de escrita offline vira um **envelope de mutação** (a *intenção*: "registrar esta venda")
numa store `outbox` do IndexedDB, processada em **FIFO por dispositivo**. Um worker de
sincronização drena a fila quando há rede, enviando um envelope por vez para a API.

Por que outbox e não replicação bidirecional: as operações de POS são majoritariamente
**append-only** (uma venda nova, um movimento novo). Não precisamos de um CRDT nem de mesclar
linhas — precisamos **reproduzir intenções na ordem certa, sem duplicar**. Outbox é o padrão mais
simples que resolve isso e é o que a arquitetura já pressupõe.

### 2. Idempotência pela **PK UUID do cliente** (sem tabela nova no MVP da fila)

A chave de idempotência é o **próprio `id` UUID gerado no cliente**. O servidor aplica cada
mutação de criação de forma idempotente: se a linha-raiz (ex.: `orders.id`) **já existe**, o
reenvio é **no-op** e devolve o resultado já persistido (o mesmo `syncStatus: SYNCED`), em vez de
criar de novo. Concretamente, dentro da transação: *"a venda `id` já existe? Então já sincronizou —
retorna sucesso e não toca em estoque/caixa."*

Isto **evita uma tabela de livro-razão dedicada** no primeiro corte (bom para cost-zero): a
unicidade da PK **é** o registro de idempotência. Um ledger dedicado (`SyncMutation`) só passa a
ser necessário se aparecer uma mutação que **não** cria uma única linha PK-única (ver *Opções* e
*Revisar no futuro*).

### 3. Atomicidade preservada — o servidor reaplica cada mutação numa transação única (ADR-001)

Cada envelope é aplicado no servidor dentro de **uma transação Prisma**. Para a venda: inserir
`Order` + `OrderItem[]` + `Payment[]`, gerar os `StockMovement` de saída **e** debitar
`Product.stockQty`, e lançar o efeito no caixa — **tudo junto ou nada** (exatamente a disciplina da
ADR-001). O **débito de estoque acontece no servidor, no momento do sync** (ADR-001 item 4), não no
cliente. Ao efetivar, `syncStatus` vai de `PENDING` → `SYNCED`.

### 4. Duas naturezas de operação: *append-only* (dedup) vs. *mutável* (last-write-wins)

| Natureza | Operações | Estratégia de sync |
|---|---|---|
| **Append-only (eventos)** | nova venda, cancelamento/devolução, movimento de estoque, abrir/fechar caixa, movimento de caixa | **Só dedup por idempotência.** Não há conflito real — dois caixas podem vender ao mesmo tempo; ambas as vendas valem. |
| **Mutável (cadastro)** | editar `Product`/`Customer` (preço, nome, mínimo…) | **Last-write-wins com guarda de `updatedAt`.** Se o servidor tem `updatedAt` **mais novo** que a base do cliente, marca `CONFLICT` e mantém o do servidor (o usuário revê). Reusa o `updatedAt` que já existe. |

A esmagadora maioria do fluxo offline de um POS é append-only — o caso mutável é a exceção e
recebe o tratamento mais conservador (não sobrescrever silenciosamente algo mais novo).

### 5. Ordenação e dependências — FIFO por dispositivo, forward-reference via UUID

A fila é **FIFO por dispositivo**. Como os `id` são **UUID gerados no cliente**, uma venda pode
referenciar o `cashSessionId` de um caixa **também criado offline** sem esperar o servidor: o id já
existe localmente; basta a fila enviar **a abertura do caixa antes** da venda (garantido pelo FIFO).
A fila **para na primeira falha "dura"** (erro não-transitório) em vez de reordenar/pular
silenciosamente — evita aplicar uma venda cujo caixa ainda não sincronizou.

### 6. Estoque no offline — trava na **venda**, não no sync

O estoque é limitado pela **prateleira física**: ninguém vende de prateleira vazia, porque o caixa
**vê** que acabou. Portanto a prevenção de "venda sem estoque" é **na hora da venda, offline,
contra o cache local** — a mesma regra que já vale online (a API bloqueia venda sem estoque, teste
2.H). O caixa não consegue concluir a venda se o cache local aponta saldo insuficiente. **Esta é a
trava principal.**

Resta um caso **residual e raro**: dois dispositivos offline vendem ao mesmo tempo e, ao
sincronizar, a soma passa do saldo do servidor. Numa loja física de estoque único isso quase não
ocorre (a prateleira compartilhada já limita a soma das vendas reais). Quando **mesmo assim** o
saldo do servidor fica **negativo** no sync, isso **não** significa "venda do nada" — significa que
o número cadastrado **já estava desatualizado/errado** em relação ao físico.

Como tratar esse resíduo? A venda foi concluída **fisicamente no balcão** (dinheiro no caixa,
produto entregue). Duas saídas:

- **(Recomendado) Registrar a venda e deixar o saldo ficar negativo**, marcando para a rotina de
  **reconciliação** da ADR-001 (o negativo é um *aviso de "confira o físico"*, não um bug).
  Rejeitar no sync uma venda que já aconteceu deixaria a venda **sem registro** e quebraria o
  **fechamento de caixa e a auditoria** — pior que um saldo temporariamente negativo.
- **(Alternativa) Mover a venda para `CONFLICT`** e exigir resolução manual antes de efetivar
  (bloqueia o registro automático, mas exige um passo humano para cada resíduo).

> **Decidido (2026-07-06):** **prevenir na venda** (contra o cache local) e, no resíduo do sync,
> **registrar e deixar negativo** para a reconciliação — em vez de rejeitar uma venda física já
> concluída. O negativo é raro e sinaliza cadastro desatualizado.

### 7. RLS e segurança — o servidor nunca confia no `tenantId` do envelope

Toda mutação é aplicada sob o `requireAuth` normal: o servidor **ignora/valida** o `tenantId` do
envelope contra o `tenant_id` do **JWT** (rejeita divergência → 403). O `userId`/autoria
([ADR-010](./ADR-010-atribuicao-de-autoria.md)) também vem do token, não do cliente. RLS de loja
**intacto** — a fila não abre nenhuma porta cross-tenant.

### 8. Cost-zero — sem log infinito

Nada de tabela de "eventos de sync" crescendo sem limite. A idempotência mora na PK (grátis). Se
um ledger dedicado for necessário no futuro (item 2), ele terá **expurgo por janela** (ex.: 90
dias), coerente com a auditoria seletiva da ADR-004.

---

## Opções Consideradas

### Opção A — Outbox + idempotência por PK do cliente + last-write-wins nos cadastros — **escolhida**

| Dimensão | Avaliação |
|---|---|
| Complexidade | Média — worker de fila + aplicação idempotente no servidor |
| Custo (banco) | Baixo — sem tabela nova no MVP; idempotência é a PK |
| Aderência ao schema atual | Alta — usa `SyncStatus` e os UUID client-side já existentes |
| Risco de duplicação | Baixo — dedup pela PK cobre o reenvio pós-crash |

**Prós:** simples, cost-zero, casa com ADR-001/010 e com o schema já desenhado; append-only não
precisa de merge.
**Contras:** last-write-wins pode descartar uma edição de cadastro concorrente (mitigado por
`CONFLICT` + revisão); exige disciplina transacional no servidor.

### Opção B — Ledger de mutações dedicado (`SyncMutation`) desde já

| Dimensão | Avaliação |
|---|---|
| Complexidade | Alta — tabela + expurgo + escrita extra por mutação |
| Custo (banco) | Médio — uma linha por mutação (contra o cost-zero) |
| Ganho | Guarda o **resultado** para replay e cobre mutações sem PK-única |

**Prós:** idempotência uniforme mesmo para operações compostas; guarda payload/resultado.
**Contras:** peso e custo prematuros — a PK já resolve 100% do fluxo append-only atual. Fica como
**evolução** se surgir uma mutação que a PK não cubra.

### Opção C — Sincronização bidirecional de tabelas / CRDT (ex.: RxDB, ElectricSQL, PowerSync)

| Dimensão | Avaliação |
|---|---|
| Complexidade | Muito alta — motor de replicação + resolução de conflito genérica |
| Custo | Alto — infra e/ou serviço pago; foge do cost-zero |
| Familiaridade | Baixa |

**Prós:** offline "grátis" no nível da lib; merge automático.
**Contras:** overkill para operações majoritariamente append-only; acopla o projeto a uma
plataforma; conflita com o RLS/Prisma/Workers já montados. Reavaliar só se o produto virar
colaborativo em tempo real.

---

## Análise de Trade-offs

O eixo central é **garantir "exatamente uma vez" sem infraestrutura pesada**. Como o schema já dá
UUID ao cliente, a PK **é** a chave de idempotência natural — a Opção A extrai isso de graça e
evita o custo por-linha da Opção B, que só se paga quando (e se) existir uma mutação sem PK-única.
A Opção C resolve um problema mais geral (dados mutáveis colaborativos) que **não é o do POS**, ao
preço de acoplar a stack a uma plataforma de replicação — prematuro e contra o cost-zero. O ponto
genuinamente de produto — **venda que não cabe no estoque ao sincronizar** — não é técnico e sim de
negócio (§6): a recomendação de *aceitar e deixar negativo* trata a venda como o evento físico que
ela é, delegando a correção à reconciliação que a ADR-001 já exige.

---

## Consequências

- **Fica mais fácil:** operar o caixa sem internet; reenvio seguro (dedup pela PK); manter ADR-001
  (o servidor é o único a debitar estoque, na transação do sync); RLS intacto.
- **Fica mais difícil:** o servidor precisa aplicar **toda** criação de forma idempotente (checar a
  PK antes de efeitos colaterais); o cliente precisa de um worker de fila robusto (retry com
  backoff, parar na 1ª falha dura, estados na UI: pendente/sincronizado/conflito).
- **Novos requisitos de UI:** indicador de "X operações pendentes de sincronização", estado por
  venda (`PENDING`/`SYNCED`/`CONFLICT`) e uma tela mínima para resolver `CONFLICT` de cadastro.
- **Impacto no banco (a aprovar como migration separada):** provavelmente **nenhuma tabela nova** no
  primeiro corte. Pode ser necessária **1 constraint/índice** de reforço de idempotência e,
  eventualmente, o ledger `SyncMutation` (Opção B) — **tudo isso vira ADR/migration própria só após
  sua aprovação** (regra 1).
- **Revisar no futuro:** se surgir mutação composta sem PK-única, promover para o ledger dedicado;
  se o produto ganhar edição colaborativa em tempo real, reavaliar a Opção C.

---

## Action Items

> Decisões de estratégia **aprovadas em 2026-07-06** (itens 1–2). Itens 3+ são de implementação e
> começam nas fatias da Fase 3.

1. [x] **§6 decidido:** prevenir na venda (cache local); no resíduo do sync, **registrar e deixar
       negativo** para a reconciliação da ADR-001 (não rejeitar venda física concluída).
2. [x] **Escopo da fatia offline decidido:** 1ª fatia **venda**, depois **estoque** e **caixa**;
       cadastros mutáveis (`Product`/`Customer`) por último.
3. [ ] Especificar o **formato do envelope de mutação** (tipo, `id` da entidade, payload, versão de
       schema) e a store `outbox` no IndexedDB.
4. [ ] Definir o **worker de sincronização** (gatilhos: `online`, foreground, botão manual; retry
       com backoff; parar na 1ª falha dura).
5. [ ] Tornar o endpoint de venda **idempotente por PK** (checar `orders.id` dentro da transação
       antes dos efeitos colaterais) — e replicar o padrão para estoque/caixa.
6. [ ] Funções puras em `packages/core` para a máquina de estados da fila (testes Vitest, como pede
       o `CLAUDE.md`).
7. [ ] UI: indicador de pendências + estados por registro + tela mínima de resolução de `CONFLICT`.
8. [ ] Só então: avaliar se alguma **migration** (constraint/índice ou ledger) é necessária →
       **explicar impacto e pedir aprovação** (regra 1).

---

## Relacionadas

- **[ADR-001](./ADR-001-consistencia-de-estoque.md)** — Consistência de estoque: o servidor debita
  o estoque na transação do sync; reconciliação absorve o saldo negativo do §6.
- **[ADR-003](./ADR-003-payment-tenantid-syncstatus.md)** — `syncStatus` no modelo de pagamento
  (sincroniza atomicamente com o `Order` pai).
- **[ADR-004](./ADR-004-soft-delete-e-auditoria.md)** — Cost-zero / sem log infinito (baliza o §8).
- **[ADR-005](./ADR-005-stack-e-arquitetura.md)** — MVP online-first; offline-first completo é
  justamente esta fatia da Fase 3.
- **[ADR-010](./ADR-010-atribuicao-de-autoria.md)** — Autoria vem do JWT no momento do sync, não do
  envelope do cliente.
