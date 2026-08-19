# Roteiro E2E — Importação de NF-e (ADR-025, Fatia 2.A)

> **Status:** ✅ **CONCLUÍDO (2026-08-19)** — Owner validou os 6 casos ("tudo validado com sucesso"). O
> Caso 6 achou 2 bugs (auto-casamento frouxo casava no produto errado; busca não olhava o `ean`) + 1 refino
> (MoneyInput nos campos Custo/Preço), todos corrigidos e no ar. Detalhes na seção "ADR-025 — Fatia 2.A:
> E2E do Owner CONCLUÍDO + 3 ajustes (2026-08-19)" do `registro-de-testes.md`.
> **No ar:** API `b2948c41` + web `57d79bf7` (`https://nexoloja-web.imortal.workers.dev`).
> **Código:** `shared/nfe.ts` (+testes 35/35), `web/lib/nfe.ts`, `api/routes/nfe.ts`,
> `web/components/NfeImportModal.tsx`, botão "📄 Importar NF-e" em Estoque. **Sem migration.**

## Pré-requisitos
1. Abrir o web **online** e logar (`owner@lojademo.com`). Se o PWA estiver instalado, feche/reabra
   (ou use aba anônima) para pegar a versão nova.
2. Ter **1 arquivo XML de NF-e de compra** salvo no aparelho (o XML, não o DANFE em PDF).
3. Caixa aberto **não** é necessário — entrada de estoque independe de caixa.

## Preparação (para o Caso 1 casar de propósito)
4. Abra o XML num bloco de notas e escolha **um item cujo `cEAN` (EAN)** você vai cadastrar à mão antes:
   - **Produtos → Novo** → cadastre um produto e cole esse **EAN** em "Código de barras (EAN)". Anote o
     **estoque atual** (ex.: 0). Assim, na importação, esse item **casa sozinho por EAN**.

---

## Caso 1 — Item com EAN já cadastrado (casa sozinho + custo)
5. Estoque → **📄 Importar NF-e** → escolher o XML.
6. Confira o **cabeçalho**: fornecedor, CNPJ e número da nota no topo.
7. Ache a linha do item preparado no passo 4.
   - **Esperado:** já vem em **"Casar com produto"** com o produto certo selecionado e marcado (✓).
8. Confira **Quantidade** e **Custo (un)** pré-preenchidos da nota; ajuste se quiser.
9. **Confirmar entrada.** → **Esperado:** "1 item lançado"; a linha fica verde.
10. **Verificar** (Produtos → abrir o produto): estoque **subiu** pela quantidade da nota; custo
    atualizado + aviso âmbar **"custo ajustado, confira o preço"** (se o custo mudou).
11. **Verificar** (Estoque → Movimentações recentes): entrada **"Compra NF &lt;número&gt;"** com o
    **fornecedor** e o custo.

## Caso 2 — Item novo (cadastrar na hora)
12. Reabra a importação e ache um item que **não existe** no cadastro.
    - **Esperado:** vem em **"Cadastrar novo"** com **SKU**, **Nome** e **EAN** pré-preenchidos.
13. Preencha o **Preço de venda** (a nota não traz preço de venda — vazio entra R$ 0,00). Ajuste a
    **unidade** se não for "Unidade".
14. **Confirmar entrada.** → **Esperado:** cria o produto **e** dá a entrada na mesma ação (estoque =
    quantidade da nota; custo = da nota).

## Caso 3 — Item "SEM GTIN"
15. Se houver item com `cEAN` = **"SEM GTIN"**: a linha mostra **"sem EAN"** e não casa por EAN. Use a
    **busca manual** ("Buscar produto ou SKU…") ou "Cadastrar novo".
16. Confirmar → entra normalmente; **o catálogo global não recebe ficha** (sem EAN válido) — esperado.

## Caso 4 — Reimportar a MESMA nota (idempotência por item)
17. Feche e **abra de novo com o MESMO XML**.
    - **Esperado:** itens **já lançados** vêm com selo **"já lançado"** e **desmarcados**; os que faltam
      vêm **marcados**.
18. (Opcional) Marque à força um "já lançado" e confirme → **não bloqueia** (dá entrada de novo; é aviso,
    para o caso de ter recebido a mercadoria duas vezes).

## Caso 5 — Fornecedor
19. Menu **Fornecedores** → **Esperado:** o fornecedor da nota está lá (criado por **CNPJ** se novo;
    **não duplica** se já existia com aquele CNPJ).

## Caso 6 — Linha com erro não derruba as outras
20. Force um erro: em 2+ itens "Cadastrar novo", ponha o **mesmo SKU** em dois.
    - **Esperado:** a linha duplicada fica **vermelha** ("Já existe um produto com esse SKU"); as demais
      entram. Resumo: "X lançados · 1 com erro".

---

## O que reportar
- Qualquer caso que **não** bateu com o "Esperado".
- Se **quantidade/custo** vier errado: diga a `uCom`/`qCom`/`vUnCom` do item (unidade comercial diferente
  é ajuste manual na 2.A; conversão automática fica para a 2.B).
- Print/descrição de qualquer erro cru.

## Depois do E2E
- Se tudo passar: marcar Fatia 2.A CONCLUÍDA (aqui + registro-de-testes + ROADMAP) e seguir o cronograma:
  **ligar a Cosmos** (`wrangler secret put COSMOS_TOKEN`; free = 25 consultas/dia) → **Fatia 2.B**
  (conversão de unidade comercial, idempotência forte).
