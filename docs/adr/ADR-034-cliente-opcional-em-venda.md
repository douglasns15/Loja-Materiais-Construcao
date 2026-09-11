# ADR-034: Cliente opcional em qualquer venda (identidade ortogonal ao pagamento)

**Status:** Aceito — **NO AR + E2E do Owner VALIDADO** (2026-09-10; web `ed5e4349`). Sem migration. Push do Owner pendente.
**Data:** 2026-09-10
**Deciders:** Owner do produto
**Relacionados:** [ADR-033](ADR-033-devolucao-unificada-defeito-estorno-troca.md) (devolução unificada — **origem deste ADR**: o achado #1 do E2E), [ADR-022](ADR-022-conta-do-cliente-fiado-acumulado.md) (crédito da loja / `creditBalance` — o destino que hoje não habilita), [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (fiado — hoje o único caminho que anexa cliente), [ADR-028](ADR-028-conta-de-retiradas-do-cliente.md) (retirada com cliente — o outro caminho que anexa), [ADR-026](ADR-026-divida-do-cliente-como-entidade.md) (dívida do cliente), [ADR-025](ADR-025-catalogo-global-ean.md) (CPF/NF-e futura), [ADR-010](ADR-010-atribuicao-de-autoria.md) (autoria)

## Contexto

No E2E completo da ADR-033 (devolução unificada), o **achado #1 (não-bloqueante)** — registrado em [`docs/testes/registro-de-testes.md`](../testes/registro-de-testes.md) §"ADR-033 — E2E completo (QA)" e no topo do [`docs/ROADMAP.md`](../ROADMAP.md) — expôs uma lacuna: o destino **"Crédito na loja"** numa devolução é **praticamente inalcançável para uma venda paga de balcão**.

O motivo não é do modelo de devolução, e sim de **como a venda foi registrada**. Uma devolução só credita a loja (`Customer.creditBalance`, ADR-022) quando a venda tem um **cliente anexado**. Mas hoje, no PDV, o cliente só é anexado dentro de dois sub-fluxos:

- **Venda a prazo / fiado** (ADR-019) — o cliente é obrigatório;
- **Retirada futura `SCHEDULED`** com cliente (ADR-028) — opcional.

Não existe forma de anexar um cliente a uma **venda paga imediata** (à vista/cartão/PIX). Consequências práticas:

1. Tentar anexar cliente via "Usar crédito da loja" com **R$ 0 de crédito não persiste** o cliente (o caminho exige `creditApplied > 0`).
2. Toda venda que carrega cliente acaba virando **fiado**, cujo retorno correto é **"Abate da dívida"** (ADR-026) — e não gera crédito. Logo o balcão nunca chega em "Crédito na loja".
3. Perde-se, de quebra, **histórico de compras, garantia/troca por defeito (ADR-033), entrega (ADR-028) e CPF na nota** para clientes recorrentes — algo comum no vertical de material de construção.

### O acoplamento é acidental (fatos do código verificados)

A investigação confirma que **schema e API já tratam o cliente como opcional e ortogonal ao pagamento**. O que falta é a UI **enviar** o `customerId` numa venda paga. Fatos verificados nesta branch:

- **Schema (Prisma):** `Order.customerId` já é **`String?` (nullable)** — [`packages/db/prisma/schema.prisma:586`](../../packages/db/prisma/schema.prisma) (relação opcional em `schema.prisma:618`). O modelo já permite venda com ou sem cliente, independente da forma de pagamento.
- **Schema de entrada (Zod):** `createSaleSchema` **já expõe um `customerId?` de topo** — [`packages/shared/src/sale.ts:104`](../../packages/shared/src/sale.ts) (`customerId: z.string().uuid().optional()`), **independente** dos campos de fiado (`creditAmount`), crédito da loja (`creditApplied`) e troca (`exchangeReturnId`). **Nenhuma mudança de contrato Zod é necessária** (ver §"Verificação leve", abaixo).
- **API `POST /orders`:** persiste `customerId: sale.customerId` direto na criação do pedido — [`apps/api/src/routes/orders.ts:632`](../../apps/api/src/routes/orders.ts). O `customerId` **só é exigido** quando `creditApplied > 0` (`orders.ts:478`) ou `credit > 0`/fiado (`orders.ts:537`); numa venda paga comum ele é **aceito sem qualquer condição extra**.
- **Handler de retorno/crédito:** lê `const customerId = order.customerId` (`orders.ts:1483`), recusa `STORE_CREDIT` sem cliente (`orders.ts:1489`) e credita a loja no destino `STORE_CREDIT` **só se `customerId` existir** (`orders.ts:1604`). Ou seja: assim que a venda paga passar a carregar cliente, o destino "Crédito na loja" **habilita naturalmente**, sem tocar nesse handler.
- **A UI é o único ponto acoplado:** [`apps/web/app/(app)/venda/page.tsx`](../../apps/web/app/(app)/venda/page.tsx) só inclui `customerId` no payload em três ramos condicionais — fiado (linha ~1627), crédito da loja usado (~1630) e `SCHEDULED` com cliente (~1633). Uma **venda paga imediata nunca envia `customerId`, mesmo com um cliente selecionado na tela**.

> **Conclusão do diagnóstico:** isto é **remover um acoplamento acidental de UI**, não criar um conceito novo. O cliente já é, no modelo, uma dimensão ortogonal à forma de pagamento.

## Decisão

**Tornar a identificação do cliente opcional em QUALQUER venda do PDV — inclusive vendas pagas (à vista/cartão/PIX) — sem adicionar nenhum clique ao caminho da venda anônima.** O cliente passa a ser um dado ortogonal ao pagamento: pode estar presente numa venda à vista, ausente num fiado (não — fiado segue exigindo cliente), presente numa entrega, etc. Cada regra que **exige** cliente (fiado, crédito da loja) permanece exatamente como está.

Concretamente, a única mudança de comportamento é na UI: **quando um cliente estiver selecionado, o PDV envia `customerId` no `POST /orders`, independentemente da forma de pagamento** — não mais só nos ramos de fiado/crédito/retirada.

### 1. Modelo / Schema — sem migration

`Order.customerId` já é `String?` nullable (`schema.prisma:586`) e a coluna existe em produção. **Esta é a forma correta e definitiva:** cliente é opcional e ortogonal ao pagamento. **Nenhuma migration Prisma é necessária** (regra 1 do `CLAUDE.md` não é acionada).

### 2. Contrato de API — sem mudança de contrato

O `POST /orders` (`createSaleSchema`) **já aceita** `customerId` de topo e a API **já o persiste** e o valida corretamente:

- venda paga comum: `customerId` aceito e gravado, sem exigência adicional;
- fiado / crédito da loja: `customerId` continua **obrigatório** (guardas em `orders.ts:478` e `orders.ts:537` — inalteradas).

Como o **contrato de `POST /orders` não muda** (o campo já é público e documentado), **não há atualização de `docs/DOCUMENTACAO-TECNICA.md` §8.2 devida por este ADR**. Só haveria doc a atualizar se, na implementação, o contrato mudasse — o que não é o caso.

### 3. UX no PDV — afford discreto e fora do caminho

Princípio inegociável: **a venda anônima à vista (o caso comum, ~90%) não pode ganhar um clique.** O identificador de cliente é um **afford opcional e discreto**, fora do fluxo rápido "escanear → cobrar → concluir":

- Um controle **"Identificar cliente (opcional)"** discreto no cabeçalho/rodapé do carrinho (mesmo componente de busca de cliente já usado nos blocos de fiado/crédito), **colapsado por padrão**. Fechado, ele não intercepta foco nem exige interação; o operador que não liga simplesmente cobra e conclui.
- Quando expandido e um cliente é escolhido, o nome fica visível (chip removível) e passa a ser enviado em **qualquer** finalização.
- **Minimização de dados / privacidade:** por ser sempre opcional e nunca obrigatório fora de fiado/crédito, não se coleta identidade de quem não quer se identificar — alinhado ao princípio "menos cliques" e a boas práticas de dados.
- Reúso: os estados `customerId`/`customerName`/busca já existem em `venda/page.tsx` (linhas ~474–486); a mudança de UI é **expor** o seletor fora dos sub-blocos e **incluir `customerId` no payload** sempre que preenchido, não criar componente novo.

### 4. Impacto no retorno / crédito

Com `customerId` setável numa venda paga, o destino **"Crédito na loja"** no modal de devolução (ADR-033/ADR-022) **habilita naturalmente** — o handler de retorno já credita a loja quando `order.customerId` existe (`orders.ts:1604`), sem alteração. **Resolve o achado #1 do E2E da ADR-033 na raiz**, e para todas as vendas futuras que identifiquem o cliente.

### 5. Ganhos além do crédito

Identidade opcional na venda destrava, com o mesmo dado:

- **Histórico de compras** por cliente;
- **Garantia / troca por defeito** (ADR-033) rastreável ao cliente;
- **Entrega / retirada futura** (ADR-028) — inclusive unificando com o caminho que hoje já anexa cliente só no `SCHEDULED`;
- **CPF na nota** (base para emissão fiscal futura — ADR-025 e a trilha de NF-e).

Relevante no vertical **material de construção**, onde o cliente recorrente (obra, pedreiro, construtora) é a norma.

## Alternativas consideradas

1. **Attach opcional na venda (RECOMENDADA — esta decisão).** Expor o seletor de cliente em qualquer venda e enviar `customerId` sempre que preenchido. **Prós:** modelo/API já prontos (sem migration, sem mudança de contrato); **subsume** o caso do retorno e destrava histórico/garantia/entrega/CPF de uma vez; conserta o achado na origem. **Contras:** exige disciplina de UX para não poluir o caminho anônimo (endereçado na §3).

2. **Pick-no-retorno (COMPLEMENTO).** Permitir identificar/selecionar o cliente **no próprio modal de devolução**, ao escolher "Crédito na loja" numa venda sem cliente. **Prós:** resolve o crédito mesmo para vendas antigas/anônimas já registradas. **Contras:** resolve **só** o crédito — não traz histórico, garantia, entrega nem CPF; e cria uma segunda porta de "anexar cliente" com sua própria lógica. Bom como **complemento**, ruim como conserto principal.

3. **Não fazer nada.** Manter cliente amarrado a fiado/crédito/retirada. **Rejeitada:** deixa o destino "Crédito na loja" morto no balcão e perpetua a coleta de identidade só via fiado (que empurra vendas para dívida quando o cliente só queria ser identificado).

**Recomendação de arquitetura:** adotar a **Alternativa 1** como conserto principal (modelo pronto, subsume o retorno e entrega os demais ganhos), com a **Alternativa 2** como **complemento opcional** — útil só para creditar vendas anônimas já existentes. Se a v1 focar no attach-na-venda, o pick-no-retorno pode ficar para uma fatia posterior ou nem ser necessário.

## Guardas / regras (invariantes)

- Cliente é **sempre opcional**; nunca obrigatório fora de fiado (ADR-019) e crédito da loja (ADR-022) — essas exigências ficam **intactas**.
- **Zero clique adicional** no caminho da venda anônima à vista.
- **Minimização de dados:** não coletar identidade de quem não quer identificar.
- **Custo-zero:** nenhum BLOB/Base64 (regra 6 — não se aplica aqui, mas o padrão se mantém: só `customerId` FK, já existente).
- **Doc de endpoints:** atualizar `docs/DOCUMENTACAO-TECNICA.md` §8.2 **apenas se e quando** o contrato de `POST /orders` mudar na implementação (regra 7) — este ADR não prevê mudança de contrato.

## Escopo v1

- **Incluído:** expor o seletor "Identificar cliente (opcional)" em qualquer venda no PDV (colapsado por padrão) e enviar `customerId` no `POST /orders` sempre que preenchido, em todas as formas de pagamento. Sem migration, sem mudança de contrato de API.
- **Fora (candidatos a fatias futuras):** o **pick-no-retorno** (Alternativa 2) para creditar vendas anônimas já registradas; qualquer superfície de histórico de compras por cliente; consumo do CPF na emissão fiscal (trilha NF-e).

## Consequências

- **Conserto na raiz, sem migração nem mudança de contrato:** a mudança vive só na UI do PDV; schema (`Order.customerId?`), Zod (`createSaleSchema.customerId?`) e API já suportam. Baixo risco.
- **Achado #1 da ADR-033 resolvido** para toda venda futura que identifique o cliente — "Crédito na loja" passa a ser alcançável no balcão.
- **Destrava valor além do crédito** (histórico, garantia, entrega, CPF) reusando um dado que o modelo sempre teve.
- **Dívida técnica endereçada:** o acoplamento acidental de UI (cliente só via fiado/crédito/retirada) deixa de existir; o `SCHEDULED`-com-cliente vira um caso do afford geral.
- **Limite honesto:** vendas **já registradas sem cliente** continuam sem crédito possível a menos que se adote o complemento pick-no-retorno (Alternativa 2). A v1 corrige o fluxo dali para a frente, não retroativamente.
- **Testes (regra 2):** este ADR não introduz cálculo novo em `packages/core` (não há nova regra de caixa/estoque/fechamento) — o comportamento de crédito no retorno já é coberto pelas funções puras da ADR-022/ADR-033. Se a implementação tocar alguma regra pura, valem os Vitest correspondentes.

## Próximos passos

> **Status atual:** ADR **Aceito** (Owner aprovou o desenho em 2026-09-10 — regra 4 satisfeita) e **implementado** na branch. **Sem migration, sem mudança de contrato.** Falta **deploy + E2E do Owner + push**.

O que foi implementado (fatia única, só `apps/web`):

1. **UI do PDV** ([`apps/web/app/(app)/venda/page.tsx`](../../apps/web/app/(app)/venda/page.tsx)) — **feito**:
   - Novo afford **"+ Identificar cliente (opcional)"** no topo das condições do checkout (reusa `renderCustomerPicker` + os estados `customerId`/`customerName`/busca já existentes), **colapsado por padrão** (estado `showCustomer`). Some quando fiado/crédito estão abertos (esses já coletam e exigem o cliente).
   - **Porta única de `customerId` no payload:** `...(customerId ? { customerId } : {})` passou a ser enviado em **qualquer** forma de pagamento (online e offline). Os ramos de fiado/crédito/`SCHEDULED` deixaram de mandar `customerId` por conta própria (convergência — decisão #4); fiado/crédito só mantêm seus campos próprios (`creditAmount`/`creditApplied`), e o servidor segue exigindo o cliente neles.
   - **Convergência do `SCHEDULED`:** abrir "retirada/entrega posterior" também revela o afford geral; o seletor embutido na seção de retirada foi trocado por um lembrete apontando para "Identificar cliente".
2. **API / shared:** nada a fazer — confirmado; `createSaleSchema.customerId?` e a persistência já suportavam. **Contrato de `POST /orders` inalterado.**
3. **Gates:** `tsc` do web **0** e `next build` **OK** (`/venda` 20.7 kB) em 2026-09-10. Sem `prisma migrate`. `core`/`api`/`shared` não foram tocados.
4. **Doc §8.2:** **não** atualizada — o contrato de `POST /orders` não mudou (regra 7 não acionada).
5. **Validação (pendente — do Owner):** E2E cobrindo o achado #1 da ADR-033 — venda paga (cartão/PIX) **com** cliente identificado → devolução → destino **"Crédito na loja"** habilitado e creditando o `creditBalance`. Registrar em `docs/testes/registro-de-testes.md` quando rodado.

## Decisões do Owner (aprovadas em 2026-09-10)

| # | Decisão | Resolução |
|---|---------|-----------|
| 1 | **Aprovar o desenho** (attach opcional na venda, sem migration/contrato)? | ✅ **Aprovado.** |
| 2 | **Escopo v1:** só *attach-na-venda*, ou já incluir *pick-no-retorno*? | ✅ **Só *attach-na-venda*** na v1. *Pick-no-retorno* fica como fatia posterior, se necessário. |
| 3 | **Posição/estilo do afford** no PDV. | Implementado como opt-in **"+ Identificar cliente (opcional)"** no topo das condições do checkout, colapsado por padrão. |
| 4 | **Convergência do `SCHEDULED`-com-cliente** (ADR-028). | ✅ **Convergir** — porta única de anexar cliente; a retirada futura passou a reusar o afford geral. |
| 5 | **Retroatividade:** vendas antigas sem cliente seguem sem crédito na v1. | ✅ **Aceitável** — corrige do ponto em diante (sem *pick-no-retorno* na v1). |
