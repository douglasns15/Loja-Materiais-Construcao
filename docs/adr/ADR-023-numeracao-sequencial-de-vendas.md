# ADR-023 — Numeração sequencial de vendas por loja (código `V-000128`)

- **Status:** **Aceito — migration aprovada pelo Owner e aplicada; NO AR; aguardando E2E do Owner.**
  Migration `0021` aplicada no Supabase (sem drift). Core 231/231 + shared 7/7; typecheck api/web ✅;
  build web ✅; dry-run api ✅. Deploy: API `c2336501` + web `de6715b8` (smokes ✅). Fatia 1 de 2 — a
  Fatia 2 (orçamentos salvos `O-000045`) reusará o motor de numeração por loja.
- **Data:** 2026-08-07
- **Contexto de fase:** Fase 3. Resolve o **refino pendente do ADR-022** ("busca por código") + pedido do
  Owner de um identificador humano nas vendas e nas notas.
- **Deciders:** Owner do produto.

> ⚠️ **Este ADR IMPLICA alteração de banco** (1 coluna nova em `orders`, 1 coluna nova em `tenants`, um
> índice único e um backfill dos pedidos existentes). Detalhe e impacto na seção **Migration** — só aplicar
> após aprovação explícita.

---

## Contexto

Hoje o `Order` é identificado só pelo `id` **UUID** (`@default(uuid())`). Onde uma venda precisa ser
mostrada a uma pessoa (dívidas em Contas a Receber, extrato do cliente, perfil), a UI exibe um "código"
improvisado: `#${orderId.slice(0, 8)}` — os 8 primeiros dígitos hexadecimais do UUID
(`CustomerAccountModal.tsx:56`, `CustomerProfile.tsx:215`, `contas-a-receber/page.tsx:739`).

Esse código tem três problemas:

1. **Não é localizável.** É aleatório (`#a3f9c1d2`), não memorável, e ninguém "acha uma venda" por ele.
2. **Não aparece na nota** nem no orçamento impresso — então nem serve para casar um papel com o sistema.
3. **Não é pesquisável sem custo.** Buscar por ele exigiria **cast do UUID para texto** no Postgres (ou
   query raw) — foi exatamente o obstáculo anotado como "refino pendente" ao fim do ADR-022.

O Owner pediu um **ID identificador de verdade nas vendas** (e, por consequência, nas notas), para
localizar com facilidade quando necessário — como fazem os POS/ERP de referência.

---

## Decisão

**Toda venda ganha um número sequencial por loja**, atribuído **no servidor**, exibido no formato
**`V-000128`** (escolha do Owner: prefixo `V-` + preenchimento com zeros).

### 1. Modelo de dados

- `Order.orderNumber INT` — o número inteiro sequencial **dentro da loja** (1, 2, 3, …). Fonte de verdade.
  `@@unique([tenantId, orderNumber])` garante que não se repete na mesma loja (o índice também serve à
  busca por número).
- `Tenant.lastOrderNumber INT NOT NULL DEFAULT 0` — o **contador** da loja (o último número emitido).

O `id` UUID **continua sendo a PK** e a chave de todas as FKs/idempotência offline. O `orderNumber` é
**identidade de apresentação/busca**, não substitui a PK.

### 2. Atribuição atômica (à prova de corrida)

O número é alocado **dentro da transação de venda** que já existe (`orders.ts` `POST /orders`), como
primeira escrita, via incremento atômico do contador da loja:

```ts
const { lastOrderNumber } = await tx.tenant.update({
  where: { id: tenantId },
  data: { lastOrderNumber: { increment: 1 } },
  select: { lastOrderNumber: true },
});
// `lastOrderNumber` já é o número desta venda (UPDATE ... RETURNING sob lock da linha).
```

- O `UPDATE ... RETURNING` do Postgres é atômico sob o **lock da linha do tenant**: duas vendas
  simultâneas da mesma loja serializam nesse ponto e recebem números distintos — **sem colisão**.
- Fica **dentro da transação**: se a venda falhar (rollback), o número volta atrás (sem furo). Furos
  eventuais (ex.: crash entre alocar e comitar) são aceitáveis num contador de documentos.
- **Custo-zero:** 1 `UPDATE` numa linha que a loja já tem. Nenhuma tabela de sequência nova.

### 3. Formato e busca (funções puras em `packages/shared`)

- `formatOrderNumber(n)` → `V-000128` (`V-` + `padStart(6, '0')`; números > 999999 só crescem, sem
  truncar). Reusada na tela e no comprovante — **exibição**, o banco guarda o inteiro.
- `parseOrderNumberQuery(q)` → extrai os dígitos e devolve o inteiro (ou `null`). Aceita `V-000128`,
  `000128`, `128` — todos casam a venda 128. Alimenta a **busca por código** no Histórico
  (`GET /orders?scope=all&number=128` → `where.orderNumber`), agora uma comparação de inteiro
  **indexada** (adeus cast de UUID).

### 4. Superfícies (onde o número aparece)

- **Nota/comprovante** (`ReceiptPrint`): cabeçalho passa a mostrar `Venda V-000128`.
- **Histórico de Vendas** (`/vendas`): número por linha + **campo de busca por código**.
- **Contas a Receber** (Por venda e extrato Por cliente) e **perfil do cliente**: os três `#slice(0,8)`
  são **substituídos** por `V-000128` (payloads dessas rotas passam a incluir `orderNumber`).
- **Movimentações de estoque:** as `reason` internas ("Venda `<uuid>`", "Cancelamento da venda `<uuid>`",
  …) passam a usar `V-000128` — a tela de Estoque fica legível.

### 5. Offline (ADR-011/012)

O número é **autoridade do servidor** — não pode ser gerado no cliente sem risco de colisão entre
aparelhos. Consequência:

- **Venda online:** recebe o número na hora; a nota já sai com `V-000128`.
- **Venda offline:** criada com UUID no cliente e impressa **sem** o número (a nota offline mostra o
  código como *pendente de sincronização*); ao sincronizar, o servidor atribui o `orderNumber` e a
  **reimpressão pelo Histórico** já traz o código. A idempotência (dedup por PK) devolve a venda já
  numerada — **nunca aloca dois números** para a mesma venda.

### Alternativas descartadas

- **Manter o `slice(0,8)` do UUID e só habilitar a busca com cast/query raw:** resolveria a busca, mas
  **não** o pedido do Owner (código memorável na nota). O código continuaria aleatório. Descartado.
- **Número global da plataforma (sequência única entre todas as lojas):** vazaria volume entre tenants
  ("a loja A viu que emitiu a venda #4021") e quebra o isolamento multi-tenant. O sequencial **por loja**
  é o padrão de mercado. Descartado.
- **Tabela de sequência dedicada (`order_number_sequences`):** isola o contador da linha de `tenants`
  (evita que uma venda trave um `PATCH /tenant` de configurações). É mais limpo sob alta concorrência,
  mas exige tabela + política RLS novas. **Over-engineering** para o alvo (uma loja, um caixa físico,
  vendas em ritmo humano) — o lock da linha do tenant é curto e a contenção é irrelevante nessa escala.
  Fica como evolução futura se algum dia houver concorrência real; a troca é local (só o ponto de
  alocação).
- **Numerar o orçamento agora:** o orçamento hoje **não é persistido** ("cotação, não é venda"). Dar-lhe
  um número estável e localizável exige transformá-lo em entidade guardada — é a **Fatia 2** (ADR
  próprio). Nesta fatia o orçamento segue sem número.

---

## Consequências

- **Positivas:** venda com identidade humana, memorável, na tela e na nota; busca por código vira
  comparação de inteiro indexada (fecha o refino do ADR-022); o mesmo motor de sequência por loja será
  **reusado pela Fatia 2** (orçamentos `O-000045`), por isso esta fatia vem primeiro. Custo-zero.
- **Limitações:** a nota **offline** sai sem o número até sincronizar (assumido; a reimpressão resolve).
  Contador na linha de `tenants` serializa vendas simultâneas da mesma loja (aceitável na escala-alvo;
  ver alternativa da tabela dedicada).
- **Migração de dados:** os pedidos existentes precisam receber `orderNumber` retroativo — atribuído por
  ordem de `createdAt` (empate por `id`) **dentro de cada loja**, e o contador de cada loja acertado para
  o maior número emitido. Detalhe abaixo.

---

## Migration (`0021_order_sequential_number`) — pendente de aprovação

**100% aditiva** ao schema; **backfill** determinístico; **RLS intacta** (as políticas por linha da 0002
já cobrem colunas novas; nenhuma tabela nova). Passos, em uma migration só:

```sql
-- 1) Coluna do número na venda (nullable no primeiro momento, para o backfill).
ALTER TABLE "orders" ADD COLUMN "orderNumber" INTEGER;

-- 2) Backfill: numera 1..N por loja, na ordem cronológica (empate estável por id).
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "tenantId" ORDER BY "createdAt" ASC, "id" ASC
  ) AS rn
  FROM "orders"
)
UPDATE "orders" o
SET "orderNumber" = n.rn
FROM numbered n
WHERE o.id = n.id;

-- 3) Trava definitiva: NOT NULL + único por loja (também indexa a busca por número).
ALTER TABLE "orders" ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key"
  ON "orders" ("tenantId", "orderNumber");

-- 4) Contador por loja (último número emitido).
ALTER TABLE "tenants" ADD COLUMN "lastOrderNumber" INTEGER NOT NULL DEFAULT 0;

-- 5) Acerta o contador de cada loja para o maior número já emitido (0 se não há vendas).
UPDATE "tenants" t
SET "lastOrderNumber" = COALESCE(
  (SELECT MAX(o."orderNumber") FROM "orders" o WHERE o."tenantId" = t.id), 0
);
```

**Impacto / risco:**

- **Nenhuma linha é destruída ou alterada em significado** — só se preenche uma coluna nova.
- O backfill é **O(nº de pedidos)** com window function — trivial no volume atual (loja-demo).
- A janela entre os passos 1–3 (coluna nullable) é dentro da própria transação da migration; ao final,
  toda venda tem número único por loja.
- **Sem drift** esperado após `prisma generate` (schema reflete exatamente estas duas colunas + índice).
- **Reversão:** dropar o índice e as duas colunas (nenhum dado de negócio se perde — o número é
  derivável de novo pelo mesmo backfill).

**Fluxo de aplicação** (memória do projeto): gerar/rodar via `prisma migrate diff` + `prisma migrate
deploy` da raiz com `--schema=packages/db/prisma/schema.prisma` (evitar `migrate dev` — shadow DB do free
tier). ⚠️ **Deploy de API obrigatório** (a alocação do número vive no `POST /orders`) + web.

---

## Relação com outros ADRs

- **ADR-001 (consistência de estoque):** a alocação do número entra na **mesma transação** da venda, ao
  lado do `StockMovement`/`stockQty` — não abre transação nova nem enfraquece a atomicidade.
- **ADR-011/012 (offline):** o número é atribuído no sync (servidor); a idempotência por PK garante um
  número por venda. A nota offline sai sem número até sincronizar.
- **ADR-022 (conta do cliente):** fecha o "refino pendente" (busca por código) e substitui o
  `#slice(0,8)` nas telas de dívida/extrato/perfil.
- **Fatia 2 (orçamentos salvos, futura):** reusa o mesmo mecanismo de sequência por loja para o código
  `O-000045`; por isso esta fatia é a base.
