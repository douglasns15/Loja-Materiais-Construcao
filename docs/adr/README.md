# Architecture Decision Records (ADRs)

Este diretório registra as decisões de arquitetura do projeto **NexoLoja**. Cada ADR documenta uma decisão importante, o contexto que a motivou, as opções consideradas e suas consequências.

## O que é um ADR

Um *Architecture Decision Record* é um documento curto e versionado que captura **uma** decisão técnica e o **porquê** dela. Serve para que decisões já tomadas não sejam rediscutidas e para que novas pessoas no projeto entendam o raciocínio por trás da arquitetura.

## Status possíveis

- **Proposto** — em discussão, ainda não aplicado ao código.
- **Aceito** — decisão validada e em vigor.
- **Descontinuado** — não vale mais, sem substituto.
- **Substituído** — trocado por um ADR mais recente (referenciar qual).

## Índice

| ADR | Título | Status |
|-----|--------|--------|
| [ADR-001](./ADR-001-consistencia-de-estoque.md) | Consistência de estoque (`stockQty` vs. `StockMovement`) | Proposto |
| [ADR-002](./ADR-002-delivery-status-enum.md) | Tipo do campo `Delivery.status` (`Int` vs. `enum`) | Proposto |
| [ADR-003](./ADR-003-payment-tenantid-syncstatus.md) | `tenantId` e `syncStatus` no modelo `Payment` | Proposto |
| [ADR-004](./ADR-004-soft-delete-e-auditoria.md) | Estratégia de soft-delete e auditoria | Proposto |
| [ADR-005](./ADR-005-stack-e-arquitetura.md) | Stack tecnológica e arquitetura geral | Aceito |
| [ADR-006](./ADR-006-devolucao-e-movimentacoes-de-caixa.md) | Devolução de venda e movimentações de caixa | Aceito |
| [ADR-007](./ADR-007-armazenamento-de-midia-r2.md) | Armazenamento de mídia no Cloudflare R2 (logo) | Aceito |
| [ADR-008](./ADR-008-papeis-e-rbac.md) | Papéis de usuário e RBAC dentro da loja | Aceito |
| [ADR-009](./ADR-009-multi-loja-e-super-admin.md) | Multi-loja, onboarding e Super Usuário (plataforma) | Proposto |

> O detalhamento da arquitetura (diagrama, estrutura do monorepo, segurança/RLS, offline, deploy e roadmap) está em [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Como adicionar um novo ADR

1. Copie a estrutura de um ADR existente.
2. Numere sequencialmente (`ADR-005-...`).
3. Comece com status **Proposto**; mude para **Aceito** após validação.
4. Adicione a linha correspondente na tabela acima.

> Lembrete (regra 1 do `CLAUDE.md`): qualquer ADR que implique alteração no banco de dados só deve ser aplicado após explicação de impacto e aprovação explícita.
