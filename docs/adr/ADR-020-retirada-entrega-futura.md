# ADR-020: Retirada / Entrega Futura (adiar a saída de estoque)

**Status:** IMPLEMENTADO (2026-07-31) — migration `0017` aplicada, core+API+UI no código, gates
verdes. **Falta:** deploy (API+web) + E2E do Owner. Direção e schema aprovados pelo Owner.
**Data:** 2026-07-30 (decisões) · 2026-07-31 (implementação)
**Deciders:** Owner do produto

> **Atualização (2026-07-31):** as pendências de produto foram fechadas com o Owner e a **migration
> `0017_scheduled_delivery` foi desenhada, aprovada e aplicada** (regra 1). Decisões finais:
> **entrega PARCIAL, item a item**; tela dedicada **"Entregas"** (lista + detalhe/log, estilo
> Contas a Receber); **previsão de retirada** com data única do pedido **e** flag opcional "Data por
> item"; **reúso do `Delivery` (ADR-002) descartado** (é por-pedido/tudo-ou-nada e tem `address` NOT
> NULL — parcial exige rastreio por linha). Ver a seção "Implementação (2026-07-31)" no fim.

## Contexto

Hoje toda venda **baixa o estoque na hora** — invariante do **ADR-001** (mudança de estoque = insert
em `StockMovement` + update em `Product.stockQty`, numa transação atômica). Falta o caso de balcão em
que o cliente **compra agora e leva depois**: a **mercadoria sai do estoque mais tarde**, não no ato
da venda (ex.: produto que será separado/entregue, retirada agendada, entrega futura).

Este é um eixo **ortogonal** ao "fiado" (**ADR-019**), que adia o **pagamento**. Aqui adiamos a
**saída da mercadoria**. Os dois compõem: um pedido pode ter, ao mesmo tempo, **dinheiro pendente**
(conta a receber, ADR-019) **e** **mercadoria pendente** (a entregar/retirar, este ADR) — cada
pendência no seu mecanismo, sem retrabalho. (Já antecipado na nota de abertura do ADR-019.)

## Decisão (aprovada pelo Owner — 2026-07-30)

### 1. Reserva no ato; a **saída real** de estoque acontece na entrega/retirada
No ato da venda a quantidade fica **RESERVADA** (comprometida com aquele pedido), mas a **baixa real**
(`StockMovement EXPENSE` + decremento de `stockQty`) só ocorre quando o operador marca a mercadoria
como **entregue/retirada**. Isso **adia a saída de verdade** — e **preserva o ADR-001**: a invariante
"toda saída de estoque é uma transação atômica `StockMovement` + `stockQty`" continua valendo, apenas
**disparada no momento da entrega**, não no da venda.

### 2. Disponível = estoque − reservado (o PDV trava pelo disponível)
Enquanto a mercadoria está reservada (vendida mas não entregue), o PDV passa a mostrar/travar pelo
**disponível** = `stockQty − reservado` (o reservado é a soma do que está comprometido com
entregas/retiradas pendentes). Assim a loja **não vende duas vezes a mesma peça**. (A reconciliação do
"reservado" segue a mesma filosofia do `stockQty` no ADR-001: cache desnormalizado + fonte auditável.)

### 3. Pagamento: suportar **as duas** formas desde o início
A venda com retirada/entrega futura pode ser **paga no ato** (à vista ou dividido, como hoje) **ou**
**a prazo** (fiado, ADR-019). Ou seja, os dois motores (dinheiro-pendente e mercadoria-pendente)
**compõem livremente** num mesmo pedido: leva-depois **e/ou** paga-depois.

## Como se encaixa nas invariantes

- **ADR-001 (estoque):** honrado — a baixa continua atômica, só que no evento de **entrega**. Cancelar
  um pedido ainda **não entregue** apenas **libera a reserva** (não há `StockMovement` a estornar,
  porque a saída nunca ocorreu). Cancelar/devolver depois da entrega segue o caminho atual (estorno).
- **ADR-019 (fiado):** intocado; apenas passa a **coexistir** com a pendência de mercadoria no mesmo
  pedido (decisão 3).
- **ADR-002 (`Delivery`):** existe um modelo `Delivery` (enum `DeliveryStatus`, `scheduledAt`, etc.)
  criado para o módulo de entrega pesada e **hoje ocioso** — **candidato a reúso/extensão** para a
  retirada/entrega futura. **Decisão de schema fica para a próxima sessão** (ver pendências).

## Pendências (retomar na próxima sessão — NADA feito ainda)

1. **Decisões de produto ainda em aberto:**
   - **Entrega parcial?** A nota do ADR-019 fala em "marcar os itens retirados conforme saem
     (parcial/total)". Definir se a entrega é **por item/quantidade** (retirada parcial) ou
     **tudo-ou-nada** por pedido. **← decidir com o Owner antes do schema.**
   - Onde marcar "entregue/retirado" (nova tela? ação no Histórico de Vendas? reúso da futura
     tela de entregas?).
2. **Schema/migration (regra 1 — explicar impacto e aprovar ANTES de aplicar):**
   - Como registrar a **reserva** e o **status de entrega** por pedido/linha (reúso de `Delivery`
     ADR-002 vs. tabela/colunas novas; possível `OrderItem.deliveredQty`/`reservedQty`; status no
     `Order`; cache `Product.reservedQty` para o "disponível" da decisão 2).
   - Índices e RLS (multi-tenant, ADR-003).
3. **Core (`packages/core`, funções puras + Vitest — regra 2):** disponível = `stockQty − reservado`;
   aplicação da baixa na entrega; reserva/estorno de reserva no cancelamento.
4. **API:** venda marca reserva em vez de baixa quando for entrega futura; endpoint de **entrega**
   (dispara a baixa atômica ADR-001); `POST /orders` passa a validar contra o **disponível**.
5. **UI:** opção "retirada/entrega futura" no PDV (opt-in, como o "+ Venda a prazo" do ADR-019);
   PDV mostra **disponível**; tela/ação para marcar entregue.

## Alternativa descartada

**"Sai no ato (só um rótulo)"** — baixar o estoque já na venda e usar "retirada futura" apenas como
status operacional. Mais simples, mas **não adia a saída** de estoque (o pedido do Owner), então foi
recusada na decisão 1.

## Implementação (2026-07-31)

### Decisões de produto (fechadas com o Owner)
- **Entrega PARCIAL, item a item** (o cliente leva parte hoje, parte depois) — não tudo-ou-nada.
- **Tela dedicada "Entregas"** (novo item de menu), na **mesma lógica de Contas a Receber**: lista
  paginada com filtro **A retirar / Finalizadas / Todas** + **detalhe com o LOG completo** (o que já
  saiu, o que falta, quando e por quem) + ações de baixa.
- **Previsão de retirada:** data **única do pedido** por padrão + **flag opcional "Data por item"**
  (liga um campo de data por linha). Sempre opcional.
- **PDV:** opção opt-in **"Venda com retirada/entrega posterior"** (no estilo do "+ Venda a prazo").

### Schema — migration `0017_scheduled_delivery` (aditiva, sem backfill)
- Enums novos: `DeliveryMode {IMMEDIATE, SCHEDULED}`, `FulfillmentStatus {PENDING, PARTIAL, COMPLETED}`.
- `orders`: `deliveryMode` (default IMMEDIATE), `fulfillmentStatus?` (cache, indexado), `scheduledPickupAt?`,
  `perItemSchedule` (flag "Data por item").
- `order_items`: `deliveredBaseQty` (cache do retirado, ≡ `Receivable.settledAmount`), `scheduledPickupAt?`.
- `products`: `reservedQty` (cache do reservado, ADR-001; **disponível = `stockQty − reservedQty`**).
- Tabela nova `order_item_deliveries` (o LOG de cada retirada, ≡ `receivable_payments`) + RLS por tenant.

### Core (`packages/core`, +23 testes → 212)
`availableQty`, `remainingToDeliver`, `isValidDelivery`, `applyItemDelivery`, `orderFulfillmentStatus`,
`reconcileReserved` — todas puras, espelhando as funções do fiado (ADR-019).

### API
- `POST /orders` (SCHEDULED): **reserva** (`reservedQty += base`) em vez de baixar; trava pelo
  **disponível** (vale p/ os dois modos); grava modo/previsão/flag. Online-only.
- `POST /deliveries/:id/deliver`: **retirada parcial** — por item, valida com `isValidDelivery`;
  numa transação faz `StockMovement EXPENSE` + `stockQty--` + `reservedQty--` + `deliveredBaseQty++`
  + `OrderItemDelivery` (log); recalcula `fulfillmentStatus`. A baixa REAL (ADR-001) dispara aqui.
- `GET /deliveries` (lista, filtro de situação) e `GET /deliveries/:id` (detalhe + log).
- **Cancelamento/devolução** cientes da reserva: liberam o reservado remanescente e estornam via
  `INCOME` **só a parte já retirada** (o reservado nunca deixou o estoque).

### UI
- **PDV:** opt-in "Venda com retirada/entrega posterior" + previsão (única/por item); o PDV passou a
  travar pelo **disponível** (`stockQty − reservedQty`, num ponto só no carregamento do catálogo).
- **Tela "Entregas"** + `DeliveryDetailModal` (detalhe + log + "Retirar" por item + "Retirar tudo o
  que falta").

### Como compõe com o fiado (ADR-019)
Ortogonais: um pedido pode ser SCHEDULED **e** a prazo — leva depois **e/ou** paga depois. O
`deliveryMode` não toca o `Receivable`.
