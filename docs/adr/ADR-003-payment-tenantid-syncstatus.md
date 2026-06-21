# ADR-003: Inclusão de `tenantId` e `syncStatus` no modelo `Payment`

**Status:** Proposto
**Data:** 2026-06-21
**Deciders:** Alexandre Papassoni (Owner do produto)

## Contexto

O modelo `Payment` representa um pagamento de um pedido (um pedido pode ter múltiplos pagamentos: dinheiro + cartão + PIX). Diferente de quase todas as outras tabelas de dados do schema, `Payment` **não possui**:

- `tenantId` — o identificador de tenant exigido pela diretriz de **multi-tenancy estrito** do `CLAUDE.md`.
- `syncStatus` — o campo de sincronização usado nas entidades offline-first (`Order`, `OrderItem` implícito via `Order`, `Customer`, etc.).

Atualmente `Payment` só se vincula ao tenant **indiretamente**, via `Order.tenantId`. Isso levanta duas questões:

1. **Segurança multi-tenant:** consultas e políticas de isolamento (incluindo Row-Level Security do Supabase/Postgres) ficam mais frágeis e mais caras quando o `tenantId` exige um JOIN com `orders` em vez de estar na própria linha.
2. **Offline-first:** um pagamento é criado no caixa junto com a venda (que nasce `PENDING`). Sem `syncStatus` próprio, o pagamento não pode ser rastreado/reconciliado individualmente durante a sincronização — embora, na prática, pagamentos sejam filhos do `Order` e tendam a sincronizar atomicamente com ele.

## Decisão

Adicionar **`tenantId`** a `Payment` (denormalização do tenant para isolamento e RLS), e **não** adicionar `syncStatus` próprio neste momento, tratando o `Payment` como parte do agregado `Order` para fins de sincronização.

```prisma
model Payment {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @db.Uuid          // + denormalizado para multi-tenancy/RLS
  orderId   String   @db.Uuid
  method    String   @db.VarChar(30)
  amount    Decimal  @db.Decimal(12, 2)
  paidAt    DateTime @default(now())
  reference String?  @db.VarChar(100)

  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([tenantId, orderId])
  @@map("payments")
}
```

> Requer adicionar `payments Payment[]` em `Tenant`.

## Opções Consideradas

### Opção A: Adicionar só `tenantId`; sync via agregado `Order` — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa |
| Segurança multi-tenant | Alta — isolamento e RLS diretos na linha |
| Custo offline | Baixo — sincroniza junto com o Order |
| Consistência com o schema | Alta |

**Prós:** isolamento de tenant robusto e barato; RLS direto; pagamento segue o ciclo de sync do pedido (atômico, sem estado órfão).
**Contras:** pagamento não tem rastreio de sync individual (aceitável, pois é filho do Order).

### Opção B: Adicionar `tenantId` **e** `syncStatus`

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Média |
| Segurança multi-tenant | Alta |
| Custo offline | Médio — mais um estado para reconciliar |
| Consistência com o schema | Alta |

**Prós:** rastreio de sincronização granular por pagamento.
**Contras:** estado redundante — se o Order é a unidade de sync, o `syncStatus` do pagamento pode divergir do pai e gerar casos de borda (pagamento `SYNCED` sob Order `PENDING`). Complexidade sem ganho claro no fluxo atual.

### Opção C: Manter como está (tenant só via `Order`)

**Prós:** menos um campo.
**Contras:** viola na prática o espírito do multi-tenancy estrito; RLS e queries exigem JOIN; mais caro e mais frágil. Rejeitada.

## Análise de Trade-offs

O `tenantId` é praticamente inegociável diante da diretriz de multi-tenancy estrito e do uso de RLS no Supabase — o custo de um UUID por linha é trivial frente ao ganho de isolamento e simplicidade de política de acesso. Já o `syncStatus` é uma decisão de **granularidade de sincronização**: como pagamento é semanticamente filho de `Order` e raramente faz sentido sincronizar um pagamento sem seu pedido, tratá-lo como parte do agregado evita estados inconsistentes entre pai e filho. Caso o produto futuramente permita registrar/baixar pagamentos de forma independente (ex: pagamento posterior de uma venda a prazo, conciliação de cartão), reabrir esta decisão.

## Consequências

- **Fica mais fácil:** aplicar RLS e filtros por tenant em pagamentos; relatórios financeiros por loja sem JOIN extra.
- **Fica mais difícil:** a escrita de pagamento precisa preencher e validar que `Payment.tenantId == Order.tenantId` (a garantir no serviço, com teste).
- **Revisar no futuro:** se surgir baixa/conciliação de pagamento independente do pedido, adicionar `syncStatus` (Opção B).

## Action Items

1. [ ] Adicionar `tenantId` (+ relação e `@@index`) em `Payment` no `schema.prisma`.
2. [ ] Adicionar `payments Payment[]` no modelo `Tenant`.
3. [ ] Garantir no serviço de venda que `Payment.tenantId` é herdado do `Order` e validado (com teste unitário).
4. [ ] Gerar migração (`npx prisma migrate dev`) — **requer aprovação prévia conforme regra 1 do CLAUDE.md**.
