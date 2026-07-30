# ADR-020: Retirada / Entrega Futura (adiar a saída de estoque)

**Status:** Direção APROVADA pelo Owner (3 decisões, 2026-07-30). **Pendente, para a próxima
sessão:** desenho + aprovação da **migration**, e só então implementação. ⚠️ **NÃO iniciar código
nem aplicar migration antes disso** (regras 1 e 4 do CLAUDE.md).
**Data:** 2026-07-30
**Deciders:** Owner do produto

> **Ponto de parada (2026-07-30):** a sessão capturou as **3 decisões de produto** abaixo e encerrou
> aqui, a pedido do Owner. A próxima sessão retoma **deste ponto**: desenhar o schema/migration,
> explicar o impacto e pedir aprovação (regra 1), aplicar, e então implementar core → API → UI.
> **Nada de estoque/venda foi tocado ainda.**

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
