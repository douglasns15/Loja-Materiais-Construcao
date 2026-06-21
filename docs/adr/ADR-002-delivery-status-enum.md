# ADR-002: Tipo do campo `Delivery.status` — `Int` (SmallInt) cru vs. `enum`

**Status:** Proposto
**Data:** 2026-06-21
**Deciders:** Alexandre Papassoni (Owner do produto)

## Contexto

O schema usa `enum` do Prisma para os demais estados de domínio (`OrderStatus`, `TransactionType`, `SyncStatus`, `UserRole`, `UnitType`). A exceção é `Delivery.status`, modelado como inteiro cru:

```prisma
/// Status: 0=Pendente, 1=Em rota, 2=Entregue, 3=Cancelado
status Int @default(0) @db.SmallInt
```

A escolha pelo `Int` foi feita por aderência à diretriz de **tipos leves** do `CLAUDE.md`. O problema é a **inconsistência** com o resto do schema e a perda de segurança de tipo: qualquer valor inteiro é aceito pelo banco (ex: `99`), o significado fica só no comentário, e o código de aplicação manipula números mágicos em vez de nomes.

Vale notar que enums nativos do PostgreSQL **não** são pesados — são armazenados de forma compacta (OID de 4 bytes internamente, mas otimizados) e não violam a intenção da diretriz, que visa evitar `Text` genérico e BLOBs, não enums.

## Decisão

Substituir o `Int` cru por um **enum Prisma** `DeliveryStatus`, mantendo a semântica atual:

```prisma
enum DeliveryStatus {
  PENDING    // Pendente
  IN_ROUTE   // Em rota
  DELIVERED  // Entregue
  CANCELLED  // Cancelado
}

model Delivery {
  // ...
  status DeliveryStatus @default(PENDING)
  // ...
}
```

Isso uniformiza o tratamento de estados em todo o schema e elimina números mágicos no código.

## Opções Consideradas

### Opção A: `enum DeliveryStatus` (Prisma → enum nativo do PostgreSQL) — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa |
| Custo / armazenamento | Baixo — enum nativo é compacto |
| Segurança de tipo | Alta — valores inválidos rejeitados |
| Consistência com o schema | Alta — alinha com os outros enums |

**Prós:** type-safety no TypeScript e no banco; consistência; legibilidade (sem números mágicos); migrações controladas ao adicionar estados.
**Contras:** adicionar um novo valor exige migração de schema (DDL).

### Opção B: Manter `Int @db.SmallInt` com constante/enum só na aplicação

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa |
| Custo / armazenamento | Muito baixo (2 bytes) |
| Segurança de tipo | Baixa — banco aceita qualquer inteiro |
| Consistência com o schema | Baixa — destoa dos demais campos |

**Prós:** menor footprint teórico; adicionar estado não exige DDL.
**Contras:** sem validação no banco; significado preso a comentário; inconsistente; propenso a bug por número mágico.

### Opção C: `String` com CHECK constraint

**Prós:** legível em queries diretas.
**Contras:** mais pesado que enum; foge da diretriz de tipos leves; CHECK manual fora do controle do Prisma.

## Análise de Trade-offs

O único ganho real da Opção B é evitar uma migração ao adicionar estados — algo raro no ciclo de vida de "status de entrega" e que, quando acontece, é justamente quando se quer revisão controlada. Esse benefício marginal não compensa a perda de type-safety nem a inconsistência com o restante do schema. A economia de bytes do SmallInt sobre o enum nativo é desprezível e não é o tipo de peso que a diretriz custo-zero pretende combater.

## Consequências

- **Fica mais fácil:** ler e escrever código de entrega (nomes em vez de 0/1/2/3); garantir integridade dos estados; manter o schema uniforme.
- **Fica mais difícil:** adicionar um novo estado passa a exigir migração de schema (efeito desejado: mudança controlada).
- **Revisar no futuro:** se surgir necessidade de estados muito dinâmicos/configuráveis por tenant, reavaliar para uma tabela de status parametrizável.

## Action Items

1. [ ] Criar `enum DeliveryStatus` no `schema.prisma`.
2. [ ] Alterar `Delivery.status` para `DeliveryStatus @default(PENDING)`.
3. [ ] Gerar migração (`npx prisma migrate dev`) — **requer aprovação prévia conforme regra 1 do CLAUDE.md**, pois altera o banco.
4. [ ] Ajustar qualquer seed/código que use os valores numéricos antigos.
