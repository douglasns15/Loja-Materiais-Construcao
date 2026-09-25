# ADR-037: "Recebido" líquido de estornos + lucro e rankings líquidos do devolvido

**Status:** Aceito — implementado 2026-09-25 (gates verdes; validado read-only contra os dados reais de produção). Deploy, E2E do Owner e push PENDENTES. Sem migration.
**Data:** 2026-09-25
**Deciders:** Owner do produto
**Relacionados:** [ADR-036](ADR-036-relatorios-coerentes-devolucoes-trocas-credito.md) (revisa as Decisões A/B para o Recebido), [ADR-035](ADR-035-credito-no-retorno-pick-cliente-e-faturamento-liquido.md) (faturamento líquido), [ADR-033](ADR-033-devolucao-unificada-defeito-estorno-troca.md) (forma do estorno), [ADR-019](ADR-019-venda-a-prazo-contas-a-receber.md) (Recebido = regime de caixa), [ADR-027](ADR-027-custo-congelado-na-venda.md) (base de lucro)

## Contexto

Erro grave relatado pelo Owner (2026-09-25, produção, loja Maria ConstruLar): a venda **V-001025** (R$ 48,00 no débito) teve **devolução parcial de R$ 40,00** estornada na mesma forma, e o **"Recebido no período" continuou com o valor cheio**.

Causa (verificada no código e nos dados): pelas ADR-035/036 o card mostrava o Recebido **bruto** no número grande e só subtraía a devolução numa linha pequena de "Líquido". A tabela por forma (Débito R$ 154 em vez de R$ 114), o gráfico diário, o ticket médio, a projeção do mês e a comparação com o período anterior usavam o bruto. A varredura achou ainda:

1. **Gráfico "Recebido por dia"** somava crédito da loja e vale-troca como dinheiro (não batia com o card).
2. **Devolução de venda a prazo** (parte que só abate a dívida) era subtraída do Recebido — dinheiro que nunca entrou.
3. **Devolução em crédito na loja** era subtraída; quando o cliente usa o crédito, a nova venda também não soma ⇒ o valor sumia do Recebido para sempre. A devolução **total** em crédito (RETURNED) tinha o mesmo defeito.
4. **Lucro/margem e rankings** (produtos, clientes e seus detalhes) não descontavam itens devolvidos parcialmente nem trocados (a troca contava a mercadoria 2×: a peça devolvida + a nova).
5. **Detalhe por forma** não mostrava o estorno.

## Decisão

1. **Recebido = dinheiro que entrou − dinheiro que voltou ao cliente.** O número grande já é o líquido. O estorno é rateado por forma (função pura `refundSlicesByMethod`, core): destino `CASH` ⇒ tudo em dinheiro; `SAME_AS_PAYMENT` ⇒ fatia em dinheiro idêntica à saída da gaveta (`cashRefundPortion`) e o resto proporcional às demais formas pagas; `STORE_CREDIT` ⇒ nada. `netReceivedByMethod` (core) abate por forma; Σ formas = Recebido.
2. **Crédito na loja não abate o Recebido** (decisão do Owner): o dinheiro fica na loja; ao usar o crédito, a nova venda não soma de novo. Exibido como informativo "Virou crédito na loja". **Abatimento de dívida** também não abate (nunca entrou) — informativo "Abatido de dívida".
3. **O estorno abate o dia da VENDA** (decisão do Owner, coerente com a ADR-036-A). O **caixa** (gaveta) continua registrando a saída no dia do estorno (CashMovement RETURN) — sem mudança.
4. **Vendas RETURNED pela devolução por item voltam a contar o pago e abatem o estorno** (a estornada zera como antes; a devolvida em crédito mantém o dinheiro, corrigindo o item 3). Só a devolução total da **rota antiga `/return`** (pré-ADR-033, sem `OrderReturn`, não usada pela UI) segue excluída. `salesCount`/contadores/mercadoria continuam excluindo RETURNED (ADR-036-A intacta para faturamento de mercadoria).
5. **Mercadoria líquida do devolvido:** lucro, margem, `goodsRevenue` e todos os rankings/detalhes usam a fração que ficou com o cliente (`1 − returnedBaseQty/baseQuantity`) — receita, quantidade e custo. Produto/cliente devolvido por inteiro sai do ranking.
6. **Gráfico diário** exclui crédito/vale e abate estornos; **detalhe por forma** ganha a linha `estorno` (negativa). **A prazo gerado** fica líquido do abatido por devolução.

## Guardas / invariantes

- Sem migration, sem tabela/coluna nova (regra 6); agregações no banco + leitura enxuta dos estornos (raros).
- Estoque (ADR-001) e caixa intocados — mudança só de leitura/relatório.
- Gates por construção: Σ formas = Recebido; Σ dias do gráfico = Recebido; Σ linhas do detalhe = total da forma (validados nos dados reais).
- Regra 2: `refundSlicesByMethod` e `netReceivedByMethod` com testes Vitest (+12).
- Regra 7: §8.2 da documentação técnica atualizada (`/sales`, `/payment-composition`, `/top-products` e irmãos, `/daily`).

## Consequências

- V-001025: Recebido de 24/09 da Maria ConstruLar vai de R$ 282,50 para **R$ 242,50** (Débito R$ 154 → R$ 114).
- Números históricos mudam para o correto (mesma aceitação da ADR-035/036). Loja Demo 10/09: Recebido R$ 596 → R$ 559 (o estorno em dinheiro da V-000121 agora sai; a V-000122 devolvida em dinheiro segue zerada; R$ 90 em crédito e R$ 129,50 de dívida viram informativos em vez de serem subtraídos).
- Uma forma pode ficar negativa num período (ex.: venda no cartão estornada em dinheiro) — número honesto; o gráfico reescala a barra para o total líquido do dia.

## Limites conhecidos

- Estorno "mesma forma" de venda paga em parte com crédito da loja: a fatia proporcional ao crédito não volta ao Recebido (nunca esteve nele) — correto para o relatório; a restauração desse crédito ao cliente no `return-items` é assunto à parte.
- Velocidade de estoque das projeções segue baseada em saídas (EXPENSE); devoluções não a reduzem (não é valor monetário).
