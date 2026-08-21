# Architecture Decision Records (ADRs)

Este diretório registra as decisões de arquitetura do projeto **NexoLoja**. Cada ADR documenta uma decisão importante, o contexto que a motivou, as opções consideradas e suas consequências.

## O que é um ADR

Um *Architecture Decision Record* é um documento curto e versionado que captura **uma** decisão técnica e o **porquê** dela. Serve para que decisões já tomadas não sejam rediscutidas e para que novas pessoas no projeto entendam o raciocínio por trás da arquitetura.

> **O que NÃO é um ADR:** ideia de funcionalidade ainda não priorizada. Intenção de produto vive em [`../PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md); quando um item de lá é priorizado e exige uma escolha técnica com trade-offs, **aí** nasce o ADR.

## Status possíveis

- **Proposto** — em discussão, ainda não aplicado ao código.
- **Aceito** — decisão validada e em vigor.
- **Descontinuado** — não vale mais, sem substituto.
- **Substituído** — trocado por um ADR mais recente (referenciar qual).

## Índice

| ADR | Título | Status |
|-----|--------|--------|
| [ADR-001](./ADR-001-consistencia-de-estoque.md) | Consistência de estoque (`stockQty` vs. `StockMovement`) | Aceito — implementado |
| [ADR-002](./ADR-002-delivery-status-enum.md) | Tipo do campo `Delivery.status` (`Int` vs. `enum`) | Aceito — implementado |
| [ADR-003](./ADR-003-payment-tenantid-syncstatus.md) | `tenantId` e `syncStatus` no modelo `Payment` | Aceito — implementado |
| [ADR-004](./ADR-004-soft-delete-e-auditoria.md) | Estratégia de soft-delete e auditoria | Aceito — implementado |
| [ADR-005](./ADR-005-stack-e-arquitetura.md) | Stack tecnológica e arquitetura geral | Aceito |
| [ADR-006](./ADR-006-devolucao-e-movimentacoes-de-caixa.md) | Devolução de venda e movimentações de caixa | Aceito |
| [ADR-007](./ADR-007-armazenamento-de-midia-r2.md) | Armazenamento de mídia no Cloudflare R2 (logo) | Aceito |
| [ADR-008](./ADR-008-papeis-e-rbac.md) | Papéis de usuário e RBAC dentro da loja | Aceito |
| [ADR-009](./ADR-009-multi-loja-e-super-admin.md) | Multi-loja, onboarding e Super Usuário (plataforma) | Aceito |
| [ADR-010](./ADR-010-atribuicao-de-autoria.md) | Atribuição de autoria ("Registrado por") | Aceito |
| [ADR-011](./ADR-011-fila-de-sincronizacao-offline.md) | Fila de sincronização offline (IndexedDB → Supabase) | Aceito |
| [ADR-012](./ADR-012-cold-start-offline-first-leitura.md) | Cold-start / offline-first de leitura (cache de caixa, catálogo e navegação) | Aceito |
| [ADR-013](./ADR-013-venda-em-unidade-alternativa.md) | Venda em unidade alternativa (segundo preço: rolo fechado × por metro) | Aceito (Opção A) — implementado/validado |
| [ADR-014](./ADR-014-usuario-multi-loja.md) | Usuário multi-loja (membership + loja ativa da sessão) | Proposto |
| [ADR-015](./ADR-015-produto-agregado-venda-em-par.md) | Produto agregado: venda em par com preço promocional (parafuso + bucha) | Aceito — implementado/validado |
| [ADR-016](./ADR-016-preco-e-margem-por-forma-de-pagamento.md) | Preço e margem por forma de pagamento (taxa da maquininha + acréscimo por produto) | Aceito — implementado/validado |
| [ADR-017](./ADR-017-unidade-fechada-como-principal-barra.md) | Unidade fechada como principal (barra/rolo) + venda por metro | Aceito — implementado/validado |
| [ADR-018](./ADR-018-caixa-compartilhado-por-loja.md) | Caixa compartilhado por loja (quem abre, abre para todos) | Aceito — implementado/validado |
| [ADR-019](./ADR-019-venda-a-prazo-contas-a-receber.md) | Venda a prazo / Contas a receber (o "fiado") | Aceito — implementado/validado |
| [ADR-020](./ADR-020-retirada-entrega-futura.md) | Retirada / entrega futura (adiar a saída de estoque) | Aceito — implementado/validado |
| [ADR-021](./ADR-021-cesta-persistente-sincronizada.md) | Cesta persistente sincronizada (carrinho do PDV entre dispositivos) | Aceito — implementado (migration `0016_carts`) |
| [ADR-022](./ADR-022-conta-do-cliente-fiado-acumulado.md) | Conta do cliente (fiado acumulado): conta que soma + devolução por item + crédito | Aceito — implementado/validado |
| [ADR-023](./ADR-023-numeracao-sequencial-de-vendas.md) | Numeração sequencial de vendas por loja (código `V-000128`) | Aceito — implementado/validado |
| [ADR-024](./ADR-024-orcamentos-salvos.md) | Orçamentos salvos (documento `O-000045`, ciclo de vida, validade, conversão) | Aceito — implementado/validado (2.A + 2.B) |
| [ADR-025](./ADR-025-catalogo-global-ean.md) | Catálogo global de EAN (enriquecimento por código de barras e NF-e; cache cross-tenant custo-zero) | Aceito — Fatias 1 e 2.A implementadas/validadas; Fatia 2.B desenhada (§5.B), não implementada |

> O detalhamento da arquitetura (diagrama, estrutura do monorepo, segurança/RLS, offline, deploy e roadmap) está em [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Como adicionar um novo ADR

1. Copie a estrutura de um ADR existente.
2. Numere sequencialmente (`ADR-005-...`).
3. Comece com status **Proposto**; mude para **Aceito** após validação.
4. Adicione a linha correspondente na tabela acima.

> Lembrete (regra 1 do `CLAUDE.md`): qualquer ADR que implique alteração no banco de dados só deve ser aplicado após explicação de impacto e aprovação explícita.
