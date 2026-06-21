# ADR-004: Estratégia de Soft-Delete e Auditoria

**Status:** Proposto
**Data:** 2026-06-21
**Deciders:** Alexandre Papassoni (Owner do produto)

## Contexto

O schema atual usa `isActive Boolean` em entidades de cadastro (`Tenant`, `User`, `Category`, `Product`, `Customer`, `Supplier`) como forma de "desativar" registros sem apagá-los. Não existe:

- Marca de **quando** e **por quem** algo foi desativado/excluído (`deletedAt`, `deletedBy`).
- Trilha de **auditoria** de alterações (quem mudou preço, quem cancelou venda, quem ajustou estoque).

O `CLAUDE.md` impõe restrições relevantes de **custo-zero**:

- Plano gratuito do Supabase (espaço limitado).
- **Proibido** salvar logs de cliques/navegação no PostgreSQL principal; auditoria pesada deve ir para storage/serviço externo.

Ao mesmo tempo, um ERP/POS tem **necessidades legais e operacionais** de rastreabilidade — especialmente em operações financeiras e fiscais (cancelamento de venda, alteração de preço, ajuste de inventário) e em material de construção (quem alterou uma entrega).

Há, portanto, uma tensão entre **rastreabilidade** e **custo-zero**, que exige uma estratégia seletiva em vez de tudo-ou-nada.

## Decisão

Adotar uma estratégia **em camadas**, proporcional ao valor de cada dado:

1. **Soft-delete leve e padronizado** nas entidades de cadastro: manter `isActive` e adicionar `deletedAt DateTime?` (nulo = ativo). Isso preserva integridade referencial histórica (um produto desativado ainda é referenciado por vendas antigas).
2. **Carimbos de criação/atualização** já existentes (`createdAt`/`updatedAt`) mantidos; não criar tabela de histórico genérica de todas as alterações no Postgres.
3. **Auditoria seletiva de eventos críticos** apenas, gravada em uma tabela enxuta `AuditEvent` (multi-tenant), restrita a um conjunto fechado de ações sensíveis: cancelamento de venda, alteração de preço de produto, ajuste manual de estoque, fechamento de caixa com divergência, mudança de papel de usuário. Campos mínimos: `tenantId`, `userId`, `entity`, `entityId`, `action`, `at`, e um `meta Json?` compacto.
4. **Logs operacionais/volumosos NÃO vão para o Postgres** (cumprindo a diretriz): ficam em log externo ou descartáveis.

`StockMovement` já funciona como auditoria natural do estoque e não precisa ser duplicado no `AuditEvent` — apenas eventos de **ajuste manual** são registrados.

## Opções Consideradas

### Opção A: Camadas — soft-delete leve + `AuditEvent` seletivo — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Média |
| Custo de armazenamento | Baixo/controlado — só eventos críticos |
| Rastreabilidade | Boa onde importa (financeiro/fiscal) |
| Aderência ao custo-zero | Alta |

**Prós:** equilíbrio entre rastreabilidade legal e custo; não infla o banco; integridade histórica preservada.
**Contras:** exige decidir e manter a lista de "ações sensíveis"; cobertura de auditoria parcial por design.

### Opção B: Auditoria completa (tabela de histórico de toda alteração / triggers)

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Alta |
| Custo de armazenamento | Alto — cresce sem limite |
| Rastreabilidade | Máxima |
| Aderência ao custo-zero | Baixa — conflita com a diretriz |

**Prós:** rastro total.
**Contras:** estoura o plano gratuito; contraria explicitamente a diretriz de não acumular logs no Postgres principal. Rejeitada nesta fase.

### Opção C: Nada além do `isActive` atual

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Nenhuma |
| Custo | Mínimo |
| Rastreabilidade | Insuficiente para um ERP financeiro |
| Aderência ao custo-zero | Alta |

**Prós:** simplicidade.
**Contras:** sem "quando/quem" e sem trilha de eventos críticos; arriscado para operações fiscais e disputas. Rejeitada.

## Análise de Trade-offs

A questão é **quanto rastrear sem violar custo-zero**. A Opção B daria rastreabilidade total mas colide frontalmente com a diretriz de não acumular logs no Postgres e com o limite do plano gratuito. A Opção C é barata mas deixa lacunas inaceitáveis num sistema que movimenta dinheiro e estoque. A Opção A concentra o investimento de armazenamento exatamente onde há risco legal/operacional (eventos financeiros e fiscais), reaproveita estruturas que já são auditáveis (`StockMovement`), e mantém o resto enxuto — sendo a que melhor honra simultaneamente os dois objetivos do projeto.

## Consequências

- **Fica mais fácil:** investigar disputas financeiras/fiscais; desativar cadastros sem quebrar histórico; manter o banco dentro do plano gratuito.
- **Fica mais difícil:** a aplicação precisa emitir eventos de auditoria nos pontos sensíveis (disciplina de código + testes); a lista de ações auditadas vira algo a manter.
- **Revisar no futuro:** se requisitos fiscais aumentarem, migrar auditoria para storage externo/serviço dedicado; avaliar retenção/expurgo de `AuditEvent` por janela de tempo.

## Action Items

1. [ ] Adicionar `deletedAt DateTime?` às entidades de cadastro com soft-delete.
2. [ ] Padronizar consultas para filtrar `deletedAt IS NULL` (helper/escopo no Prisma).
3. [ ] Criar modelo enxuto `AuditEvent` (multi-tenant) e definir a lista fechada de ações sensíveis.
4. [ ] Emitir eventos de auditoria nos serviços de: cancelamento de venda, alteração de preço, ajuste manual de estoque, fechamento de caixa com divergência, mudança de papel de usuário.
5. [ ] Gerar migração (`npx prisma migrate dev`) — **requer aprovação prévia conforme regra 1 do CLAUDE.md**.
