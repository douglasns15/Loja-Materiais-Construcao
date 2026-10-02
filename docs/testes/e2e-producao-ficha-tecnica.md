# E2E — Produção com ficha técnica (ADR-043, Fatia 1)

Loja de alimentos de teste (`owner_kg`), como Admin. Antes: no **painel do Super Usuário**, ligar o módulo
**"Produção (ficha técnica)"** da loja (lojas novas do ramo Rotisseria já nascem com ele).

## A. Preparação

1. Produtos: confira que existem
   - **Frango inteiro congelado** — unidade **Unidade**, controla estoque, custo R$ 16,20;
   - **Tempero baiano** — kg, custo R$ 25,00 (pode ficar **sem** controle de estoque);
   - **Frango assado** — kg, "Vendido inteiro também" com peso médio 1,200 kg, R$ 39,90/kg.
2. Estoque › Entrada: dê entrada de **18** frangos crus.
   - ✅ O menu mostra **Produção** (logo abaixo de Estoque).

## B. Ficha técnica (detalhe do produto Frango assado)

1. Abra Frango assado › bloco **Ficha técnica** › **Criar ficha técnica**.
   - ✅ Se o produto não controla estoque, aparece "Ligar controle de estoque" (liga e segue).
2. "Para produzir **1,200** kg, uso": Frango inteiro congelado **1**; Tempero baiano **0,020** › **Salvar ficha**.
   - ✅ Mostra a tabela, custo por kg **R$ 13,92**, preço R$ 39,90 e margem **65%**.
   - ✅ O pronto não aparece como insumo de si mesmo; insumo repetido é recusado.
3. Com um usuário **Operador**: a ficha aparece, mas sem os botões de editar/excluir.

## C. Registrar produção (menu Produção)

1. Escolha **Frango assado** › Peças **15**.
   - ✅ Peso total sugerido **18,000** kg; insumos pela ficha: 15 un e 0,300 kg; saldo "tem 18" verde.
   - ✅ Custo da produção **R$ 250,50**, custo por kg **R$ 13,92**.
2. Mude para **20** peças.
   - ✅ O saldo fica vermelho, aparece "Falta saldo de Frango inteiro congelado (tem 18, precisa 20)" e o botão
     desabilita.
3. Volte a **15**, corrija "usado de fato" do frango para **16** (um estava ruim), observação › **Registrar**.
   - ✅ "P-0001 registrada…"; aparece em **Produções de hoje** com custo e o que usou.
   - ✅ Estoque: frango cru **2** (18 − 16); Frango assado **+18,000 kg**; tempero sem controle não mexe.
   - ✅ Estoque › movimentações: "Produção P-0001 — Frango assado" (saídas) e "Produção P-0001" (entrada).
   - ✅ O custo do Frango assado vira o da produção, com o aviso "custo ajustado, confira o preço".
4. PDV: venda de Frango assado inteiro.
   - ✅ Baixa só o assado (o cru não mexe).
5. Um Operador também consegue registrar produção.
