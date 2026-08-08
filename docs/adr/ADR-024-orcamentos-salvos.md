# ADR-024 — Orçamentos salvos (documento `O-000045`, ciclo de vida, validade e conversão em venda)

- **Status:** **Aceito — Sub-fatia 2.A NO AR e VALIDADA pelo Owner (E2E 4/4, 2026-08-07).** Migration
  `0022` aplicada (sem drift). **2.A (motor + CRUD + tela + salvar + status/validade + reimprimir):** core
  231/231 + shared 9/9; typecheck api/web ✅; build web ✅; dry-run api ✅. Deploy: API `83c465f2` + web
  `0e0465dd` (smokes ✅). **Pendências:** (1) **refino de UX do PDV** (ver abaixo) — mover "Válido até" +
  "Salvar orçamento" para a tela de prévia do botão "Orçamento"; (2) **Sub-fatia 2.B** — editar rascunho
  no PDV + converter em venda (`quoteId` no `POST /orders`).
- **Data:** 2026-08-07

> **Refino de UX do PDV (planejado, pós-2.A — observação do Owner no E2E de 2026-08-07):** na 2.A o PDV
> ganhou DOIS controles de orçamento lado a lado — o botão **"Orçamento"** (gera a prévia efêmera) e, num
> bloco à parte, **"Válido até" + "Salvar orçamento"**. Ficou redundante e polui a tela do carrinho.
> **Decisão de produto:** **"Orçamento" passa a ser o botão único** (gerar orçamento → tela de prévia); a
> **validade + "Salvar orçamento"** migram para **a tela de prévia** (junto do "Imprimir" que já existe),
> onde o operador decide: só imprimir (efêmero) OU salvar (com a validade ali; a tela então mostra o
> `O-000045`). Remove o bloco do carrinho. **Só UI, sem migration/API.** Fazer antes ou junto da 2.B.
- **Contexto de fase:** Fase 3. **Fatia 2 de 2** do par iniciado no ADR-023 (numeração de vendas). Reusa o
  motor de numeração sequencial por loja para dar ao orçamento um código próprio `O-000045`.
- **Deciders:** Owner do produto (decisões de escopo capturadas em sessão, ver abaixo).

> ⚠️ **Este ADR IMPLICA alteração de banco** (1 enum, 2 tabelas novas, 1 coluna contadora em `tenants`,
> FKs/índices e RLS). Detalhe e impacto na seção **Migration** — só aplicar após aprovação explícita.

---

## Contexto

Hoje o **orçamento** do PDV é uma **cotação efêmera**: calcula, imprime e some — não é salvo, não tem
número, não há onde consultá-lo depois (teste 2.H: "cotação, não é venda; sem persistir"). O ADR-023 deu
às **vendas** um código humano (`V-000128`) e fechou "buscar por código", mas explicitamente **deixou o
orçamento de fora** — porque "localizar um orçamento" exige transformá-lo em **documento guardado**.

O Owner quer poder **localizar orçamentos** (a folha que entregou/mandou ao cliente), com um identificador
próprio, no mesmo padrão de Histórico de Vendas / Contas a Receber. Discussão de produto com o Owner
levantou a **ótica de validade**: *"um orçamento só vale se foi encaminhado ao cliente; se você só gera e
não imprime/manda pra ninguém, não faz sentido guardar"*. Isso casa com o custo-zero do projeto — **não
poluir o banco com toda cotação efêmera**.

**Decisões de produto do Owner (capturadas antes de codar):**
1. Formato do código: **`O-000045`** (prefixo `O-`, coerente com o `V-` das vendas — o prefixo separa as
   duas sequências).
2. **Salvar orçamentos** como entidade guardada (não só imprimir).
3. **Ciclo de vida completo:** Rascunho → Enviado → Aceito → Recusado → Expirado → Convertido.
4. **Validade** ("válido por X dias").
5. **Converter orçamento em venda** incluído nesta fatia.

---

## Decisão

### 1. Gatilho de persistência — salvar por AÇÃO EXPLÍCITA (não auto-salvar)

O botão **"Orçamento"** de hoje **continua** sendo uma **cotação instantânea, zero-persistência** (calcular
rápido e descartar — não polui o banco). Adiciona-se uma **ação explícita "Salvar orçamento"** no PDV: só
o que o operador decide guardar/encaminhar vira o documento `O-000045`, gravado e localizável. Isso honra a
ótica do Owner (só o "orçamento de verdade" fica) **e** o custo-zero. (Quando existir envio por
WhatsApp/e-mail — features futuras —, "enviar" vira mais um gatilho natural de salvar.)

### 2. Numeração — reusa o motor do ADR-023

Código sequencial **por loja** `O-000045`, alocado **no servidor** com o mesmo mecanismo atômico do
ADR-023: `tenants.lastQuoteNumber` incrementado com `UPDATE ... RETURNING` sob lock da linha do tenant,
dentro da transação que salva o orçamento. Sequência **separada** da de vendas (o `O-`/`V-` distingue).
`formatQuoteNumber`/`parseQuoteNumberQuery` em `packages/shared/format.ts` (irmãos dos do ADR-023).

### 3. Modelo de dados — 2 tabelas (snapshot), SEM efeito de estoque

Um orçamento é uma **proposta**: **não reserva nem baixa estoque** (diferente do `Order`; o motor ADR-001
não é tocado). Espelha o `Order`/`OrderItem` no que é snapshot de apresentação:

- **`quotes`** (cabeçalho): `quoteNumber` (único por loja), `customerId?` (opcional — cliente de balcão),
  `status` (enum), `subtotal`/`discountAmount`/`total`, `validUntil?` (validade), `notes?`,
  `convertedOrderId?` (link p/ a venda gerada), autoria (ADR-010), `deletedAt?` (soft-delete de rascunho
  criado por engano — ADR-004), timestamps.
- **`quote_items`** (linhas, snapshot): `productId?` (referência p/ converter; snapshot cobre produto
  apagado), `productName`/`unit` (snapshot p/ impressão histórica), `saleMode` (BASE/ALT — p/ reconstruir a
  linha ao converter, EF-3/ADR-013), `quantity`, `unitPrice`, `discount`, `total`, `pairGroup?` (ADR-015).

### 4. Ciclo de vida (status)

Enum **`QuoteStatus`: `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `CONVERTED`** (5 valores **persistidos**).

- **`EXPIRED` é DERIVADO, não armazenado** — evita depender de um agendador (não há cron no custo-zero). Um
  orçamento "aberto" (`DRAFT`/`SENT`/`ACCEPTED`) com `validUntil < agora` é **exibido como "Expirado"** na
  tela e filtrável na busca (`status effective`). Nada precisa "virar" a coluna à meia-noite.
- **Transições** (via `PATCH /quotes/:id`, dropdown do operador): `DRAFT → SENT → ACCEPTED|REJECTED`;
  qualquer aberto → `CONVERTED` (pela venda); `REJECTED`/`CONVERTED` são terminais. Enquanto não houver
  envio por WhatsApp/e-mail, **"Enviado" é marcado manualmente** (o operador imprimiu/entregou).
- **Imutabilidade de conteúdo:** editável **só enquanto `DRAFT`** (reabrir no PDV — ver §6); a partir de
  `SENT` o conteúdo trava (o cliente já viu aquela proposta; para mudar, **duplica** num novo orçamento).

### 5. Tela "Orçamentos" (nova, no menu)

Item **"Orçamentos"** no menu lateral. Lista **paginada (keyset)** + busca por **código** (`O-000045`),
**cliente**, **período** e **status** (incluindo "Expirado" derivado) — mesmo padrão de Histórico de Vendas
/ Contas a Receber. Detalhe do orçamento (itens + validade + status + autoria), **reimprimir** e as ações
de status. É **onde se busca o orçamento** — o paralelo do Histórico (venda) e do Contas a Receber (dívida).

### 6. Converter em venda — reusa o PDV (motor único de venda)

**"Gerar venda"** a partir de um orçamento **abre o PDV pré-preenchido** com os itens (`?quoteId=`),
**prática já adotada no ADR-022** ("+ Adicionar itens" abre o PDV com o cliente). O operador confirma a
venda normalmente; o `POST /orders` recebe `quoteId` e, **na mesma transação da venda**, marca o orçamento
`CONVERTED` + grava `convertedOrderId` (guarda: orçamento não pode já estar convertido). **Por que reusar o
PDV, e não converter no servidor a partir do snapshot:** o motor de venda (estoque ADR-001, split-payment,
fiado, crédito, retirada futura) fica **único** — zero duplicação de regra; e o operador pode **ajustar**
antes de fechar (o orçamento é proposta; a venda final pode diferir). **Editar um rascunho** usa a mesma
mecânica: reabrir no PDV carrega os itens no carrinho; "Salvar orçamento" atualiza o mesmo `O-…` enquanto
`DRAFT`.

### Alternativas descartadas

- **Auto-salvar toda cotação:** polui o banco com orçamentos que ninguém encaminhou (contra o custo-zero e
  a ótica do Owner). Descartado — persistência é ação explícita.
- **Converter no servidor a partir do snapshot** (endpoint que cria o Order direto do `quotes`): duplicaria
  o motor de venda (estoque/pagamento/fiado) e impediria o ajuste antes de fechar. Descartado a favor do
  PDV pré-preenchido.
- **`EXPIRED` como coluna virada por cron:** exige agendador (não há no free tier). Descartado — expiração
  é derivada de `validUntil`.
- **Reservar estoque no orçamento:** orçamento é proposta, não compromisso; reservar competiria com vendas
  reais. Descartado — sem efeito de estoque (a reserva de verdade é o ADR-020, na venda).

---

## Consequências

- **Positivas:** orçamento vira documento localizável (`O-000045`), com ciclo de vida e validade; a
  conversão reusa o PDV (motor único, zero duplicação); o custo-zero é preservado (só salva o que é
  encaminhado; sem cron). Fecha o par ADR-023/ADR-024 (vendas + orçamentos com código humano).
- **Limitações / assumido:** "Enviado/Aceito/Recusado" são **manuais** até existir envio por
  WhatsApp/e-mail (features futuras — o desenho deixa o gancho). Orçamento é **online-only** (não entra na
  fila offline nesta fatia — é retaguarda, não o balcão). `EXPIRED` derivado (não é coluna).
- **Migração de dados:** **nenhuma** — não há orçamentos hoje; as tabelas nascem vazias e o contador em 0.

---

## Migration `0022_quotes` — pendente de aprovação

**100% aditiva** (enum + 2 tabelas novas + 1 coluna contadora + RLS); **sem backfill**; **RLS por tenant**
nas 2 tabelas novas (mesmo padrão da 0019). Esboço:

```sql
-- Enum do ciclo de vida (EXPIRED é derivado de validUntil — não entra no enum).
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED');

-- Contador de orçamentos por loja (espelha tenants.lastOrderNumber do ADR-023).
ALTER TABLE "tenants" ADD COLUMN "lastQuoteNumber" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "quotes" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "quoteNumber" INTEGER NOT NULL,
  "customerId" UUID,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "notes" VARCHAR(500),
  "convertedOrderId" UUID,
  "createdById" UUID,
  "createdByName" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quote_items" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "quoteId" UUID NOT NULL,
  "productId" UUID,
  "productName" VARCHAR(160) NOT NULL,
  "unit" "UnitType" NOT NULL,
  "saleMode" VARCHAR(4),
  "quantity" DECIMAL(12,4) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "pairGroup" INTEGER,
  CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotes_tenantId_quoteNumber_key" ON "quotes"("tenantId","quoteNumber");
CREATE INDEX "quotes_tenantId_createdAt_idx" ON "quotes"("tenantId","createdAt");
CREATE INDEX "quotes_tenantId_status_idx" ON "quotes"("tenantId","status");
CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

-- FKs (tenant cascade; customer/order SET NULL; itens cascade no quote).
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedOrderId_fkey"
  FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — só SELECT por tenant (toda escrita via API, papel postgres). Padrão 0002/0019.
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_select_tenant" ON public.quotes
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_items_select_tenant" ON public.quote_items
  FOR SELECT TO authenticated USING ("tenantId" = public.current_tenant_id());
```

Adição em `createSaleSchema` (shared): campo **opcional `quoteId`** — quando presente, o `POST /orders`
marca o orçamento `CONVERTED`. **Sem coluna nova em `orders`** (o elo mora em `quotes.convertedOrderId`).

**Impacto / risco:** tabelas nascem **vazias** (sem backfill, sem janela quebrada como a do ADR-023 — nada
existente depende delas); RLS igual ao padrão; reversível (drop das 2 tabelas + coluna + enum). Sem efeito
de estoque/caixa. ⚠️ **Deploy de API obrigatório** (rotas novas + `quoteId` no `POST /orders`) + web.

**Fluxo de aplicação:** `prisma migrate diff`/`deploy` da raiz com `--schema=...` (evitar `migrate dev`),
como no ADR-023.

---

## Implementação em sub-fatias

- **2.A — Motor + CRUD:** migration `0022`; entidade + `formatQuoteNumber`/`parseQuoteNumberQuery` (+testes
  shared); `quotes.ts` (`POST /quotes` salvar, `GET /quotes` lista/busca, `GET /quotes/:id`, `PATCH
  /quotes/:id` status/validade/notes, soft-delete de rascunho); PDV ganha "Salvar orçamento"; tela
  **/orcamentos** (lista/busca/detalhe/reimprimir + status derivado Expirado); `ReceiptPrint` do orçamento
  ganha o `O-000045` + validade.
- **2.B — Editar rascunho + Converter em venda:** reabrir `DRAFT` no PDV (`?quoteId=` carrega o carrinho;
  "Salvar" atualiza o mesmo enquanto DRAFT); "Gerar venda" pré-preenche o PDV; `POST /orders` aceita
  `quoteId` e marca `CONVERTED` + `convertedOrderId` na transação da venda.

---

## Relação com outros ADRs

- **ADR-023 (numeração de vendas):** reusa o motor de sequência por loja (contador em `tenants`, alocação
  atômica) e os helpers de formatação/busca. Por isso a Fatia 1 veio primeiro.
- **ADR-001 (estoque):** **não tocado** — orçamento não reserva nem baixa estoque; a baixa real só ocorre
  na venda (na conversão, via PDV/`POST /orders` de sempre).
- **ADR-015 (par) / ADR-013/017 (unidade alternativa):** `quote_items` guarda `pairGroup` e `saleMode` para
  reconstruir a linha no PDV ao converter/editar.
- **ADR-022 ("+ Adicionar itens" abre o PDV):** mesma tática de pré-preencher o PDV, agora para converter
  orçamento.
- **ADR-004 (soft-delete/auditoria):** `quotes.deletedAt` para descartar rascunho criado por engano.
