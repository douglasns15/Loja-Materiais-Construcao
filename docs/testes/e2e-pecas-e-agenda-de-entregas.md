# E2E — Peso com 3 casas, estoque de pesados por peças e Agenda de entregas

> **Escopo:** commits `3d57bc7` (0,850), `a0cb22d` (ADR-040 §4.1 — pesados por peças) e `74d0568` /
> `9dbb6ae` / `106ba9f` (ADR-042 — agenda de entregas, migration `0042`).
> **Pré-requisito:** deploy **API → web** desta leva (a migration `0042` já está aplicada no Supabase).
> **Lojas:** `owner_kg@lojademo.com` (alimentos) e Demo (`owner@lojademo.com`) — logins em `docs/Uteis_Projeto_NexoLoja.txt`.
> Registrar o resultado em `registro-de-testes.md`.

## A. Peso com 3 casas (loja `owner_kg`)

1. PDV: lance um produto em kg e digite `0,85` no peso.
   - ✅ O campo mostra **0,850**; o resumo/confirmação mostra **0,850 kg**; o cupom impresso também.

## B. Estoque de pesados por peças (loja `owner_kg`)

1. Cadastre "Picanha" em **kg**, **com** "Controlar estoque" ligado, preço do quilo e "Vendido inteiro também"
   (preço do inteiro + peso médio, ex.: 4,0 kg).
2. Estoque › Entrada de estoque › escolha a Picanha › **Peça a peça**: digite 4,2 ↵ 3,9 ↵ 4,4 ↵ › Registrar.
   - ✅ Resumo "3 peças · 12,500 kg (média 4,167)"; movimentação com o motivo "3 peças: 4,200 + 3,900 + 4,400 kg".
   - ✅ Estoque mostra **12,500 kg (≈ 3 peças)**; a busca do PDV mostra `est. 12,500 kg (≈ 3 pç)`.
3. Venda por kg (ex.: 1,250 kg) → saldo cai exatamente 1,250 kg.
4. **Última peça:** ajuste o estoque para um valor menor que o peso médio (ex.: 3,5 kg com média 4,0) e venda
   **1 inteiro**.
   - ✅ A venda passa; o estoque **zera** (não fica negativo). Um 2º inteiro em seguida é bloqueado.
5. Na loja Demo, uma venda comum continua baixando o estoque normalmente.

## C. Funcionários e cadastro de cliente (loja `owner_kg`, como Admin)

1. Cadastros › **Funcionários**: cadastre "Zé Entregador" (Entregador) com telefone.
   - ✅ Editar, Desativar/Reativar e Excluir (com confirmação) funcionam.
2. Clientes: cadastre um cliente **com endereço**. No PDV, "Identificar cliente" › cadastro rápido também tem
   **Endereço** (nome, telefone e endereço em cima).

## D. Período de entregas (Entregas › Agenda do dia › "Período de entregas")

1. Configure segunda 08:00–12:00 e 14:00–18:00, "Copiar segunda para terça–sexta", faixa **30 min**, limite **1**.
   - ✅ Salva e reabre com os mesmos valores; cada dia mostra quantas faixas gera.

## E. Agendar no PDV

1. Venda com "+ Venda com retirada/entrega posterior" › **Entrega** › taxa **R$ 5,00**.
   - ✅ O total já soma a taxa antes do pagamento; sem cliente aparece o aviso para identificar.
2. Identifique o cliente, pague, **Concluir**.
   - ✅ A revisão mostra a linha "Taxa de entrega" e a etapa de agendamento: dia (hoje), faixas do período
     (as já passadas somem), endereço **vindo do cadastro**, entregador, observações.
   - ✅ Sem faixa escolhida, "Confirmar" pede o dia e a faixa.
3. Altere o endereço e marque "Salvar este endereço no cadastro do cliente" › Confirmar.
   - ✅ Venda concluída; o cadastro do cliente passa a ter o endereço novo.
4. Nova venda de entrega para **a mesma faixa**.
   - ✅ A faixa aparece **lotada** (riscada, "lotada"); se duas pessoas tentarem ao mesmo tempo, a 2ª recebe
     "Esta faixa de horário já está lotada".
5. Uma venda com **Retirada**, sem cliente, com faixa e observação.

## F. Agenda do dia (tela Entregas)

1. A tela abre na aba **Agenda do dia** (a aba "Contas e retiradas" segue igual a antes).
   - ✅ Linha do tempo com os pedidos em **Entregas** e **Retiradas**, linha vermelha do "agora" (hoje).
   - ✅ Cores: atrasado (vermelho) · agora (laranja, ≤ 15 min) · em breve (âmbar, ≤ 60 min) · agendado (índigo).
   - ✅ Chips com contagem filtram; ‹ › e o calendário trocam o dia.
   - ✅ "Próximas" mostra contagem ("em 10 min", "há 20 min").
   - ✅ Agendamentos antigos (só com dia) aparecem em "Sem horário definido".
2. No cartão da entrega: **Saiu p/ entrega**.
   - ✅ Fica **A caminho** (verde-azulado) com "saiu às HH:MM"; não mexe no estoque.
3. Abra o pedido: troque o entregador, "Desfazer saída" e "Saiu para entrega" de novo; registre a **retirada** de
   tudo.
   - ✅ O pedido fica **Concluído** na agenda e o estoque baixa (produto com controle).
4. Celular (ou janela estreita): a agenda vira **lista por horário** com as mesmas cores.
