# ADR-010 — Atribuição de autoria ("Registrado por")

- **Status:** Aceito (2026-07-05) · **Implementado** (migration `0006_authorship_attribution`)
- **Data:** 2026-07-05
- **Contexto de fase:** melhoria transversal pedida antes da Fase 3 (offline-first)

## Contexto

Faltava rastrear **quem** executou cada ação no sistema e mostrar isso em tela ("Registrado
por … em <data>"). O estado antes desta decisão:

- **Vendas** (`Order.userId`) e **caixa** (`CashSession.userId`, `CashMovement.userId`) já
  gravavam o operador, mas o nome só existia por relação viva (mudaria se o usuário se
  renomeasse; some se o usuário fosse apagado).
- **Estoque** (`StockMovement`) **não registrava operador nenhum** — lacuna real.
- **Cadastros** (`Product`, `Customer`) não registravam autoria de criação/edição/exclusão.

Requisito do usuário: mesmo que um usuário seja **excluído**, o histórico e a atribuição em
tela **não podem sumir** — devem continuar aparecendo em "Registrado por".

## Decisão

### 1. Snapshot do nome + referência solta ao id

Cada registro relevante guarda:

- **`*Id`** (`uuid`, nullable, **sem FK**) — referência **solta** ao usuário, no mesmo estilo
  de `AuditEvent.userId`. Não bloqueia a exclusão do usuário e **sobrevive** a ela.
- **`*Name`** (`varchar(100)`, nullable) — **snapshot** do nome do operador **no momento da
  ação**. É o que aparece em tela. Fica **congelado**: não muda se o usuário se renomear
  depois (o comprovante/registro deve refletir quem agiu **naquele** momento) e sobrevive à
  exclusão do usuário.

O nome é capturado do contexto de autenticação (`requireAuth` passou a expor `userName`).

### 2. Nível "quem fez por último" (não histórico completo)

Para cadastros **editáveis** (`Product`, `Customer`), guardamos **quem criou / alterou por
último / excluiu** (+ o "quando" reusa `createdAt`/`updatedAt`/`deletedAt`). **Não** é um log
de todas as edições — isso seria uma timeline por registro que **contraria a auditoria
seletiva do [ADR-004](./ADR-004-soft-delete-e-auditoria.md)** (cost-zero). Esta atribuição é
**complementar** ao ADR-004: é um **snapshot na própria linha**, não um fluxo de eventos.

### 3. O "quando" reusa timestamps existentes

Nenhuma coluna de data nova: `Product`/`Customer` já têm `createdAt`/`updatedAt`/`deletedAt`;
`Order`/`StockMovement`/`CashMovement` têm `createdAt`; `CashSession` tem `openedAt`/`closedAt`.

## Escopo (migration `0006`, aditiva, nullable, sem mudar RLS)

| Tabela | Colunas | Semântica |
|---|---|---|
| `products` | `createdBy{Id,Name}`, `updatedBy{Id,Name}`, `deletedBy{Id,Name}` | criou / alterou / excluiu |
| `customers` | idem | idem |
| `orders` | `registeredByName` | `userId` já existia (vendedor) |
| `stock_movements` | `userId` (solto) + `registeredByName` | **novo** — antes sem operador |
| `cash_movements` | `registeredByName` | `userId` já existia |
| `cash_sessions` | `openedByName`, `closedBy{Id,Name}` | abriu / fechou (podem diferir) |

Categorias e Fornecedores ficam de fora **por ora** (sem tela própria para exibir); o princípio
se aplica quando ganharem UI.

## Consequências

- **Positivas:** atribuição visível e **imutável** (sobrevive a rename/exclusão); estoque passa
  a ter operador; continua cost-zero (snapshot na linha, sem log de eventos); reusa timestamps.
- **Negativas / limites:** registros **antigos** (anteriores à `0006`) ficam com autoria `NULL`
  → a tela mostra "—" (backfill possível para vendas/caixa a partir do `userId`; estoque/
  cadastros antigos não têm o dado). Não é histórico de todas as edições (decisão consciente).
- **Interação com [ADR-008](./ADR-008-papeis-e-rbac.md):** a regra de que usuário **com
  histórico** é *desativado* (não apagado) continua; a atribuição por snapshot torna a exibição
  robusta **mesmo se** um dia permitirmos o hard-delete.

## Relacionadas

- **ADR-004** — Auditoria seletiva (isto complementa; não vira log de eventos).
- **ADR-008** — Papéis/RBAC e exclusão de usuário (o "quem" vem do usuário autenticado).
- **ADR-001** — Movimentações de estoque (agora carregam o operador).
