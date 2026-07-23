# ADR-018 — Caixa compartilhado por loja (uma sessão de caixa por tenant, não por operador)

- **Status:** **Aceito, NO AR e VALIDADO pelo Owner (2026-07-23).** Owner escolheu o modelo compartilhado e
  "qualquer operador fecha". Implementado em `cashSessions.ts` e `orders.ts` (remoção do filtro `userId` na
  resolução do caixa); typecheck API ✅; sem migration. API `3bd5cade`; commit `cbccb3f`. E2E do Owner
  validado — a segunda operadora passou a enxergar e operar o caixa aberto da loja.
- **Data:** 2026-07-23
- **Contexto de fase:** Fase 3, correção de semântica reportada em produção.
- **Deciders:** Owner do produto.

> ✅ **Este ADR NÃO implica alteração de banco.** A coluna `CashSession.userId` já existe (vira
> definitivamente "quem abriu"), não há constraint única por usuário e o RLS é por `tenantId`. A mudança é
> **puramente de query** (remover o filtro `userId` da resolução do caixa aberto).

---

## Contexto

Reportado em produção pelo Owner: ele abriu o caixa com o próprio usuário (`douglasns.work@gmail.com`) e
operou normal; **outra operadora da MESMA loja** (`amanda.ns92@hotmail.com`), ao logar, via **"caixa
fechado"**.

**Causa raiz:** a sessão de caixa nasceu **por operador**. Toda a resolução de "há caixa aberto?" filtra
por `{ tenantId, userId, closedAt: null }` — em `cashSessions.ts` (`/current`, `/open`, `/close`) e em
`orders.ts` (venda online, venda offline anexada, cancelamento, devolução). Cada usuário enxergava,
portanto, **apenas o próprio caixa**. Isso nunca foi um ADR — foi uma escolha de implementação
("uma por operador por vez") que passou batida e não bate com a realidade da loja.

Numa loja de material de construção (o público-alvo) há tipicamente **um caixa físico só** e vários
funcionários no balcão. O modelo esperado é: **quem abre o caixa abre para a loja**; todos vendem no mesmo
caixa; o fechamento soma tudo.

---

## Decisão

**A sessão de caixa passa a ser por LOJA (tenant), não por operador.** No máximo **um caixa aberto por vez
por loja**.

1. **Resolução do caixa aberto** deixa de filtrar por `userId` em todos os pontos: `{ tenantId, closedAt:
   null }`. Vale para `/cash-sessions/current`, `/open` (o bloqueio 409 passa a ser "a loja já tem caixa
   aberto"), `/close`, e para a venda/cancelamento/devolução em `orders.ts`.
2. **Qualquer operador pode fechar** o caixa da loja (decisão do Owner). Sem gate de papel no fechamento.
3. **Autoria preservada (ADR-010):** `CashSession.userId`/`openedByName` continuam gravando **quem abriu**;
   `closedById`/`closedByName`, **quem fechou** (pode ser outro operador). Cada venda/cancelamento/devolução
   segue com o `userId` de **quem executou**. Ou seja, a rastreabilidade por pessoa **não se perde** — só
   deixa de fragmentar o caixa.
4. **Venda offline anexada:** a resolução idempotente da sessão do envelope passa a validar só
   `{ id: sale.cashSessionId, tenantId }` (sem `userId`) — uma venda offline de qualquer operador se
   reconcilia com a sessão da loja que o envelope carrega.

### Alternativas descartadas

- **Manter por operador (status quo):** só faria sentido com **gavetas físicas separadas** por caixa —
  não é o caso da loja. Descartado pelo Owner.
- **Multi-caixa nomeado (N caixas simultâneos por loja, cada um com um rótulo):** resolve lojas com vários
  pontos de venda, mas é over-engineering para a necessidade atual (um caixa físico). Fica como evolução
  futura, se houver demanda real — a coluna `userId` e a autoria não impedem esse caminho depois.

---

## Consequências

- **Positivas:** o caixa reflete o caixa físico; a Amanda vende no caixa que o Douglas abriu; o fechamento
  soma as vendas de todos; **relatórios já eram por loja** (`GET /reports/cash-sessions` já consultava
  `{ tenantId, closedAt }`), então ficam **coerentes** sem mudança. Sem migration, RLS intacto.
- **Limitações:** **um caixa por vez por loja** — se um dia a loja tiver 2 pontos de venda físicos
  simultâneos, será preciso o "multi-caixa nomeado" (evolução futura acima). O fechamento com divergência
  (ADR-004) continua registrando quem fechou, mas a divergência agora é do **caixa da loja** (soma de todos
  os operadores), não de um operador isolado — que é justamente o comportamento desejado.
- **Estado ao subir:** hoje há um caixa aberto do Douglas em produção. Após o deploy, o `/current` da
  Amanda passa a retornar **esse mesmo** caixa — o problema some sem nenhuma ação manual de dados.

---

## Relação com outros ADRs

- **ADR-010 (autoria):** a base que torna o modelo compartilhado seguro — quem abriu/fechou/vendeu segue
  gravado por pessoa.
- **ADR-004 (auditoria):** `CLOSE_CASH_WITH_DIVERGENCE` inalterado; passa a ser do caixa da loja.
- **ADR-012 (offline):** a venda offline anexa-se à sessão da loja pelo `cashSessionId` do envelope.
