# ADR-001: Consistência de Estoque — `stockQty` desnormalizado vs. derivado de `StockMovement`

**Status:** Proposto
**Data:** 2026-06-21
**Deciders:** Alexandre Papassoni (Owner do produto)

## Contexto

O schema atual mantém duas fontes de informação sobre estoque:

- `Product.stockQty` — um saldo desnormalizado (Decimal) gravado diretamente no produto.
- `StockMovement` — o histórico de entradas (`INCOME`) e saídas (`EXPENSE`) que, somado, também representa o saldo atual.

Isso cria risco de **divergência entre as duas fontes** caso uma seja atualizada sem a outra. O problema é agravado por dois requisitos do projeto:

- **Offline-first:** vendas nascem como `PENDING` no caixa (IndexedDB) e são sincronizadas depois. O saldo precisa ser recalculado/reconciliado no momento do sync, não apenas no momento da venda.
- **Diretriz de custo-zero:** o `CLAUDE.md` pede tipos leves e evitar carga desnecessária no Postgres (plano gratuito do Supabase), o que desencoraja recalcular o saldo a partir do histórico inteiro a cada leitura de tela.

O `CLAUDE.md` também exige explicitamente testes unitários para funções de cálculo de estoque, fechamento de caixa e fluxo de caixa.

## Decisão

Manter `Product.stockQty` como **cache desnormalizado autoritativo para leitura**, com as seguintes regras de integridade:

1. `stockQty` **nunca** é alterado diretamente por UPDATE solto. Toda mudança de saldo passa por uma operação que, na **mesma transação de banco**, insere um registro em `StockMovement` e atualiza `Product.stockQty`.
2. A operação de escrita é encapsulada em um único serviço/função (ex: `applyStockMovement`) — ponto único de verdade, coberto por testes unitários.
3. `StockMovement` é a **fonte de verdade auditável**. Em caso de suspeita de divergência, existe uma rotina de reconciliação que recalcula `stockQty = Σ INCOME − Σ EXPENSE` e corrige o cache.
4. Na sincronização offline, vendas `PENDING` só debitam o estoque ao serem confirmadas no servidor, dentro da mesma transação descrita em (1).

## Opções Consideradas

### Opção A: Saldo desnormalizado em `Product.stockQty` (cache) + `StockMovement` como histórico — **escolhida**

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Média (exige transação + reconciliação) |
| Custo (leitura) | Baixo — saldo lido direto da linha do produto |
| Escalabilidade | Boa — leitura O(1), sem agregação no banco |
| Familiaridade do time | Alta — padrão comum em ERPs |

**Prós:** leituras de tela (catálogo, PDV) são baratas; compatível com a diretriz custo-zero; saldo disponível offline sem agregar histórico.
**Contras:** risco de divergência se a disciplina transacional falhar; exige rotina de reconciliação e testes rigorosos.

### Opção B: Saldo sempre derivado (somar `StockMovement` on-the-fly, sem `stockQty`)

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Baixa (sem cache para sincronizar) |
| Custo (leitura) | Alto — agregação a cada consulta de saldo |
| Escalabilidade | Ruim — degrada conforme o histórico cresce |
| Familiaridade do time | Alta |

**Prós:** zero risco de divergência; uma única fonte de verdade.
**Contras:** caro para o plano gratuito do Supabase; ruim para o PDV que consulta saldo constantemente; difícil de servir offline.

### Opção C: Cache derivado materializado (materialized view / tabela de saldo recalculada por job)

| Dimensão | Avaliação |
|----------|-----------|
| Complexidade | Alta (infraestrutura de refresh) |
| Custo | Médio/Alto |
| Escalabilidade | Boa |
| Familiaridade do time | Baixa |

**Prós:** desacopla leitura de escrita.
**Contras:** saldo fica defasado entre refreshes (ruim para PDV em tempo real); excesso de infraestrutura para o estágio atual do projeto.

## Análise de Trade-offs

O ponto central é **custo de leitura vs. risco de divergência**. O PDV e o catálogo leem saldo com altíssima frequência, enquanto escritas de estoque são comparativamente raras — o que favorece o cache (Opção A) em vez de agregar o histórico a cada leitura (Opção B). O risco de divergência da Opção A é mitigável por disciplina transacional e uma rotina de reconciliação, ambos cobríveis por testes — exatamente o que o `CLAUDE.md` já exige. A Opção C resolve escala mas introduz defasagem inaceitável para um caixa em tempo real e infraestrutura prematura.

## Consequências

- **Fica mais fácil:** leitura de saldo no PDV/catálogo; operação offline; aderência à diretriz custo-zero.
- **Fica mais difícil:** toda escrita de estoque obriga transação atômica (movimento + saldo); é preciso manter e testar a rotina de reconciliação.
- **Revisar no futuro:** se o volume de produtos por tenant crescer muito, avaliar particionamento de `stock_movements` por período; considerar mover `stockQty` para uma tabela de saldo dedicada se houver concorrência alta de escrita no mesmo produto.

## Action Items

1. [ ] Implementar serviço único `applyStockMovement` com transação (insert em `StockMovement` + update em `Product.stockQty`).
2. [ ] Escrever testes unitários cobrindo entrada, saída, estoque negativo e idempotência no sync.
3. [ ] Implementar rotina de reconciliação `recalcStock(productId)` e teste correspondente.
4. [ ] Definir comportamento do débito de estoque na confirmação de vendas `PENDING` vindas do offline.
