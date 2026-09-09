# E2E — ADR-033 (Devolução unificada: defeito, forma do estorno, troca)

> Roteiro de QA para validar as **3 fatias** da ADR-033 ponta a ponta, no ambiente de testes.
> Legenda de resultado: ✅ passou · ❌ falhou · ⏭️ não executado.
> **Quem executa:** Claude dirige o navegador; o Owner faz o **login** no ambiente de testes quando
> solicitado. Cada caso diz o **passo a passo** e o **resultado esperado** (o que conferir na tela).

## Pré-condições (antes de começar)

1. **Deploy — ✅ JÁ APLICADO (2026-09-09):** migrations **`0038` + `0039` + `0040`** no Supabase; **API
   Version `24ab85d2`**; **web Version `85eb33b5`** (smoke ✅). Os fluxos novos já estão no ar.
2. **Login** na loja de testes (Owner/admin, para ver "Configurações" e "Devolvidos com defeito").
3. **Caixa aberto** (a maioria dos cenários de dinheiro exige caixa aberto). Anote o **valor esperado inicial**.
4. **Produtos de teste** (crie/ajuste antes; anote preço e estoque inicial):
   - **P1** — preço R$ 10,00, estoque ≥ 20, **com fornecedor** vinculado numa entrada (p/ ver o fornecedor na lista de defeito).
   - **P2** — preço R$ 25,00, estoque ≥ 20.
   - **P3** — preço R$ 8,00, estoque ≥ 20 (item mais barato, p/ trade-down).
5. **1 cliente de teste** cadastrado (p/ os casos de crédito na loja / a prazo).

> **Como Claude confere sem acesso ao banco:** estoque (tela **Estoque**/detalhe do produto), caixa
> (**Caixa** → valor esperado + extrato de movimentações), comprovante (tela final da venda),
> lista **Devolvidos com defeito**, e as mensagens de erro. Onde um número for crítico, anote o
> **antes** e o **depois**.

---

## Fatia 1 — Item com defeito (não volta ao estoque + lista/resolução)

### F1.0 (baseline) — Devolução de REVENDA repõe o estoque
1. Venda à vista de **2× P1** (dinheiro). Anote estoque de P1 (deve cair 2).
2. Histórico → **Devolver / Estornar** na venda → intenção **Devolver / desistir**.
3. No item P1, quantidade **2**, condição **Revenda**. Destino do troco: **Dinheiro**. Motivo "teste". Confirmar.
4. **Esperado:** estoque de P1 **volta +2**; sai R$ 20 do caixa (o esperado cai R$ 20).

### F1.1 — Devolução de DEFEITO não repõe + entra na fila
1. Venda à vista de **3× P1** (dinheiro). Estoque cai 3.
2. **Devolver / Estornar** → **Devolver/desistir** → P1 qtd **3**, condição **Defeito**. Destino **Dinheiro**. Confirmar.
3. **Esperado:**
   - Estoque vendável de P1 **NÃO muda** (continua −3 da venda).
   - Sai R$ 30 do caixa (o dinheiro volta ao cliente mesmo com defeito).
   - Menu **Devolvidos com defeito** lista **1 linha**: P1, qtd **3**, valor **R$ 30,00**, venda **V-000…**, **fornecedor** (o de P1), motivo.

### F1.2 — Resolver defeito: REPOR (fornecedor trocou)
1. Em **Devolvidos com defeito**, na linha de P1, clicar **Repor (fornecedor trocou)** → **Confirmar**.
2. **Esperado:** a linha **some** da lista; estoque vendável de P1 **sobe +3** (o substituto entrou).

### F1.3 — Resolver defeito: BAIXA/perda
1. Repita F1.1 com **1× P2** defeito (venda + devolução defeito).
2. Em **Devolvidos com defeito**, na linha de P2, clicar **Baixa/perda** → **Confirmar**.
3. **Esperado:** a linha **some**; estoque de P2 **NÃO muda** (perda registrada, nada reposto).

### F1.4 — Mistura revenda + defeito num único modal
1. Venda de **2× P1 + 1× P2** (dinheiro). 
2. **Devolver / Estornar** → devolver P1 qtd 2 **Revenda** e P2 qtd 1 **Defeito**. Destino **Dinheiro**. Confirmar.
3. **Esperado:** P1 **+2** no estoque; P2 **não muda** e aparece 1 nova linha em **Devolvidos com defeito**.

### F1.5 — Idempotência da resolução
1. Com uma linha pendente, abrir **Devolvidos com defeito**; clicar Repor → Confirmar e, **rápido**, não resolver a mesma 2×.
2. **Esperado:** a resolução acontece **uma vez**; a linha some; sem erro estranho. (Se houver forma de disparar 2×, a 2ª deve dar "já foi resolvido".)

---

## Fatia 2 — Forma do estorno no caixa + unificação dos botões

### F2.0 — Um só botão (UI)
1. No Histórico, numa venda **imediata CONFIRMED**, confirmar que existe **um** botão **"Devolver / Estornar"** (não mais "Devolver itens" + "Cancelar venda" separados). Vendas **SCHEDULED** ainda mostram "Cancelar venda"/"Devolver".

### F2.1 — Cancelar venda à vista em DINHEIRO, estorno "mesma forma"
1. Venda de **1× P2** (R$ 25) **em dinheiro**, mesma sessão. Esperado do caixa: **+25**.
2. **Devolver / Estornar** → **Devolver/desistir** → **Devolver tudo** (seleciona P2 inteiro), condição **Revenda**.
   Como é a venda inteira, mesma sessão e sem devolução prévia, o botão vira **"Cancelar venda"**.
3. Forma do estorno: **Estorno (mesma forma)**. "Sai do caixa" deve mostrar **R$ 0,00** (a exclusão já cobre). Confirmar.
4. **Esperado:** estoque de P2 **+1**; a venda sai do **faturamento**; **valor esperado do caixa volta ao ponto anterior** (nem sobra nem falta); **nenhuma** movimentação "Cancelamento (estorno em dinheiro)" no extrato.

### F2.2 — Cancelar venda no CARTÃO, reembolso em DINHEIRO
1. Venda de **1× P2** (R$ 25) **no crédito** (cartão), mesma sessão. Esperado do caixa **não muda** (cartão não entra no dinheiro).
2. **Devolver / Estornar** → **Devolver tudo** → **Cancelar venda** → forma **Dinheiro do caixa**.
   "Sai do caixa" deve mostrar **R$ 25,00**. Confirmar.
3. **Esperado:** estoque **+1**; extrato do caixa ganha **"Cancelamento (estorno em dinheiro) — venda V-…" = −R$ 25,00**; **valor esperado cai R$ 25** (o dinheiro saiu fisicamente da gaveta).

### F2.3 — Cancelar venda MISTA (dinheiro + cartão), reembolso em DINHEIRO
1. Venda de **1× P2** (R$ 25) paga **R$ 10 dinheiro + R$ 15 crédito**.
2. **Cancelar venda** → **Dinheiro do caixa**. "Sai do caixa" = **R$ 15,00** (a parte que **não** era dinheiro; os R$ 10 a exclusão já cobre). Confirmar.
3. **Esperado:** extrato ganha **−R$ 15,00**; esperado do caixa cai R$ 15 no total (10 pela exclusão + 15 pelo movimento = 25 devolvidos).

### F2.4 — Devolução PARCIAL com excedente → "Estorno (mesma forma)"
1. Venda de **2× P2** (R$ 50) paga **R$ 25 dinheiro + R$ 25 crédito**.
2. **Devolver / Estornar** → devolver **1× P2** (não é a venda inteira ⇒ caminho **devolução**). Troco esperado **R$ 25**.
3. Destino do troco: **Estorno (mesma forma)**. "Sai do caixa" = **R$ 12,50** (metade do troco, proporcional à parte paga em dinheiro). Confirmar.
4. **Esperado:** estoque **+1**; extrato ganha **−R$ 12,50** (o restante é estorno de cartão, não sai do caixa).

### F2.5 — Devolução PARCIAL → "Dinheiro" e → "Crédito na loja"
1. (Dinheiro) Venda **2× P1** (R$ 20, dinheiro). Devolver 1 → troco R$ 10 → **Dinheiro** → caixa **−R$ 10**.
2. (Crédito) Venda **2× P1** para um **cliente**. Devolver 1 → troco R$ 10 → **Crédito na loja** → **saldo de crédito do cliente sobe R$ 10**, **caixa não muda**.

### F2.6 — Bloqueio: cancelar venda já devolvida
1. Numa venda que **já teve** uma devolução parcial (ex.: a de F2.5), tentar **Devolver tudo** o restante.
2. **Esperado:** o modal roteia para **devolução por item** (não "Cancelar venda"), porque há devolução anterior — e o backend recusa cancelamento com "já teve devoluções" se for forçado. Sem estorno de estoque em dobro.

---

## Fatia 3 — Troca integrada ao PDV (vale-troca)

### F3.1 — Troca "trade-up" (item novo mais caro)
1. Venda de **1× P1** (R$ 10, dinheiro). 
2. **Devolver / Estornar** → intenção **Trocar por outro item** → P1 qtd 1, **Revenda** → **Ir para a troca**.
3. **Esperado:** abre o **PDV** com o banner **"Troca da venda V-… — vale de R$ 10,00"**; o "a pagar" já considera o vale.
4. Adicionar **1× P2** (R$ 25). "A pagar agora" = **R$ 15,00** (25 − 10). Pagar **R$ 15 em dinheiro** → **Concluir**.
5. **Esperado:** venda concluída; o **comprovante mostra a linha "Vale-troca R$ 10,00"** + "Pagamento Dinheiro R$ 15,00"; caixa entra **+R$ 15** (só o dinheiro; o vale não toca o caixa); estoque de **P1 +1** (voltou) e **P2 −1** (saiu).

### F3.2 — Troca de valor exato
1. Venda **1× P2** (R$ 25). Trocar por **outro P2** (mesmo valor) → vale R$ 25, novo item R$ 25 → **a pagar R$ 0** → Concluir sem pagamento.
2. **Esperado:** conclui; comprovante só com "Vale-troca R$ 25,00"; caixa não muda.

### F3.3 — Troca "trade-down" bloqueada (v1)
1. Venda **1× P2** (R$ 25). Trocar → vale R$ 25 → adicionar só **1× P3** (R$ 8).
2. Tentar **Concluir**.
3. **Esperado:** bloqueio com mensagem **"A troca é de valor ≥ R$ 25,00 (o vale). Adicione itens."** Não conclui.

### F3.4 — Vale-troca não é reutilizável
1. Complete uma troca (F3.1). Depois tente forçar reuso: volte ao Histórico e ao PDV (o vale já foi consumido/limpo).
2. **Esperado:** o banner de troca **não reaparece** (sessionStorage consumido). (Se por algum caminho um `exchangeReturnId` já usado for reenviado, o servidor responde **"Este vale-troca já foi usado em outra venda."**)

### F3.5 — "Cancelar troca" no banner
1. Faça uma troca até abrir o PDV com o banner. Clique **Cancelar troca**.
2. **Esperado:** o banner some, o "a pagar" volta ao total cheio. (A devolução já registrada permanece como um vale **não consumido** — comportamento aceito na v1; anotar.)

### F3.6 — Troca de item DEFEITUOSO
1. Venda **1× P1**. **Trocar** → P1 qtd 1, condição **Defeito** → Ir para a troca.
2. **Esperado:** o P1 **não** volta ao estoque e **aparece em Devolvidos com defeito**; o vale (R$ 10) abre no PDV normalmente. Conclua a troca com P2.

### F3.7 — Troca bloqueada em venda a prazo em aberto
1. Venda **1× P2 a prazo** (fiado) para um cliente (fica devendo).
2. **Devolver / Estornar** → **Trocar** → Ir para a troca.
3. **Esperado:** erro **"Troca não disponível para venda a prazo em aberto; faça uma devolução."**

### F3.8 — Troca é online-only
1. Simule offline (se possível no ambiente) e tente concluir uma venda com vale.
2. **Esperado:** bloqueio "A troca exige conexão." (Se não der para simular offline, marcar ⏭️.)

---

## Regressão (garantir que o que já existia não quebrou)

- **R1** — Venda normal à vista (dinheiro/cartão/PIX) conclui e imprime o comprovante.
- **R2** — Venda a prazo (fiado) + usar crédito da loja seguem funcionando (parcelas corretas no comprovante).
- **R3** — "Vender de novo" (reorder) e conversão de orçamento seguem funcionando (não confundir com o carry da troca).
- **R4** — Fechar o caixa: o **valor esperado bate** com o contado depois de todos os cenários (a mini-DRE mostra as saídas de RETURN corretas).
- **R5** — Devolução de venda de **caixa fechado** (botão em vendas de outra sessão) segue funcionando.

---

## Registro do resultado

| Caso | Resultado | Observação |
|---|---|---|
| F1.0 · F1.1 · F1.2 · F1.3 · F1.4 · F1.5 | ⏭️ | |
| F2.0 · F2.1 · F2.2 · F2.3 · F2.4 · F2.5 · F2.6 | ⏭️ | |
| F3.1 · F3.2 · F3.3 · F3.4 · F3.5 · F3.6 · F3.7 · F3.8 | ⏭️ | |
| R1 · R2 · R3 · R4 · R5 | ⏭️ | |

> Ao final, consolidar em `docs/testes/registro-de-testes.md` (evidência) e marcar as fatias como
> **E2E do Owner VALIDADO** no `ROADMAP.md`/ADR-033.
