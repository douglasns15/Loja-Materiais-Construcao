# 🗺️ Roadmap — NexoLoja (ERP/POS Multiramos)

> Fonte de verdade do progresso do projeto. Atualizado a cada avanço.
> Legenda: `[x]` concluído · `[ ]` pendente · 🟡 em andamento · ⏭️ adiado p/ fase futura
>
> **Última atualização:** 2026-08-17 — **ADR-025 (catálogo global de EAN) — Fatia 1 CONCLUÍDA (E2E do
> Owner validado) + 2 ajustes.** No E2E o Owner apontou dois pontos, ambos resolvidos e no ar (deploy web
> `1970f365`, só frontend): **(1)** o campo EAN da **edição** não tinha o leitor de **câmera** (só o
> cadastro novo tinha) → adicionado `BarcodeScanButton` na edição; **(2)** o **"🔄 Sincronizar dados pelo
> EAN"** só preenchia campo vazio e nunca tocava no nome (correto no desenho antigo, mas o Owner quis mais)
> → passou a **propor as diferenças** (nome/marca/foto) num painel ficha × cadastro: vazio vem marcado
> (preencher), divergente vem desmarcado (substituir é opt-in), "Aplicar selecionados" grava só o escolhido
> — nunca sobrescreve sozinho (ADR-025 §6). **Fontes de EAN — estado real:** só cache global local +
> **Open Food Facts** ativos (conferido via `wrangler secret list`: **`COSMOS_TOKEN` não provisionado** ⇒
> **Cosmos dormente**). OFF só cobre alimentos/bebidas/cosméticos ⇒ cobertura baixa p/ construção
> (esperado). **CRONOGRAMA ACORDADO com o Owner (2026-08-17):** **(1) Fatia 2 — importação de XML de NF-e**
> AGORA (motor principal p/ construção; ver desenho na ADR-025 §5 e "mais abaixo"); **(2) logo após fechar
> a Fatia 2, LIGAR a Bluesoft Cosmos** (`wrangler secret put COSMOS_TOKEN`; free tier = **25 consultas/dia**,
> sem cartão, sem cobrança automática — excedente vira 429 tratado como "sem ficha"; avaliar um **contador
> de consumo nosso** no Worker já que a Cosmos não avisa proximidade de limite). Depois, seguir com
> **CATEGORIAS** e demais itens da Fase 3.
>
> **Fatia 2.A (NF-e) — NO AR (2026-08-17), E2E do Owner ⏸️ EM ANDAMENTO (pausado).** Decisões:
> operador confirma qtde/custo (sem conversão de unidade na 2.A); fornecedor casado por CNPJ (criado se
> novo); **idempotência POR ITEM** (reupar a nota pré-marca só o que falta; "já lançado" é aviso, não
> bloqueio). **SEM migration** (reusa Product/StockMovement/ProductCatalog/Supplier/AuditEvent). Peças:
> `shared/nfe.ts` (parser puro + schemas, **35/35** com +13 testes), `web/lib/nfe.ts` (`parseNfeXml` via
> DOMParser, sem dep), `api/routes/nfe.ts` (`POST /nfe/entry` transação por item ADR-001 + `GET
> /nfe/imported`), `web/components/NfeImportModal.tsx` (De-Para) + botão "📄 Importar NF-e" em Estoque.
> Gates: web/api typecheck ✅, api dry-run ✅. **NO AR:** API `2c4d40fc` + web `66bcdfd1`; smokes ✅.
> **RETOMAR o E2E pelo roteiro passo a passo `docs/testes/e2e-nfe-fatia-2a.md`** (6 casos). Commit local
> em `main` (push do Owner). Detalhes originais da Fatia 1 ↓.
>
> **2026-08-15 — ADR-025 Fatia 1: enriquecimento
> do cadastro por código de barras — NO AR, aguardando E2E do Owner.** Pedido do Owner: evoluir o
> módulo de Produtos ao padrão dos grandes ERPs, enriquecendo o cadastro **automaticamente** via
> leitura de **EAN** (câmera/digitação) e, adiante, por **XML de NF-e** — tudo **custo-zero** e
> compatível com os ~367 produtos legados. **Decisões do Owner (perguntas de produto ANTES de codar):**
> (1) **catálogo global COMPARTILHADO** entre lojas (efeito de rede: o que uma busca, a próxima acha de
> graça); (2) coluna **`ean` NOVA** no `Product`, distinta do `sku` interno; (3) **imagens por HOTLINK**
> (URL externa; nunca cópia no R2 — custo-zero); (4) **Open Food Facts + Bluesoft Cosmos** como
> enriquecedores **opcionais**, com o **cache global + XML da NF-e** como motor principal (para
> construção, a nota é a melhor fonte). **Ponto-chave do desenho:** o `Product` continua sendo a tabela
> do lojista (preço/custo/estoque, fonte de verdade) — NÃO foi substituído; ganhou só o `ean`. **ADR-025
> escrita (regra 4) e migration `0028_ean_catalog` aprovada antes de aplicar (regra 1), aplicada sem
> drift:** `products.ean` (VarChar(14) nullable + índice, referência SOLTA ao catálogo — sem FK dura,
> como a autoria) + tabela **cross-tenant** `product_catalog_global` (ficha técnica por GTIN: nome
> oficial/marca/NCM/foto). **Segurança (exceção consciente ao RLS-por-tenant):** a tabela global tem
> **RLS ligado SEM policy** → `supabase-js`/PostgREST fica 100% bloqueado; acesso só pela API (papel
> `postgres`/Prisma, que ignora RLS). Sem dado comercial lá. **shared (+8 testes → 22/22):** validador de
> **GTIN** (dígito verificador GS1) + `normalizeNcm` + schemas do catálogo; `ean`/`imageUrl` nos schemas
> de produto. **API:** `GET /catalog/ean/:ean` — Smart Cache (cache global → **Cosmos** só com
> `COSMOS_TOKEN` → **Open Food Facts**), upsert no cache, `existingProductId` anti-duplicata,
> **resiliente** (falha/limite externo nunca vira 500; timeout 4 s/provider). O `COSMOS_TOKEN` é secret
> **opcional** — ausente ⇒ Cosmos pulada, **nunca gera custo**. **Web:** campo **"Código de barras (EAN)"**
> com scanner + **card de enriquecimento** (foto hotlink/nome/marca/NCM + "Preencher") no cadastro; no
> **ProductDetail** foto no cabeçalho, linha EAN, campo EAN na edição e botão **"🔄 Sincronizar dados pelo
> EAN"** (preenche marca/foto vazias). SKU relabelado p/ **"SKU (código interno)"**. Gates: shared
> **22/22**, web typecheck + build (**22 rotas**, `/products` 14.2 kB), API dry-run; migration `0028` sem
> drift. ⚠️ **Deploy de API obrigatório** (rota `/catalog` nova). **NO AR:** API `589f3cad` + web
> `34035807`; smokes ✅ (health 200; `/catalog/ean` sem token 401; web HTML no-store + CSS 200). **Commit
> `8d6b9cf` — ⚠️ NÃO foi feito `git push` (pendente, a critério do Owner).** **Falta: E2E do Owner** (o
> Owner encerrou a sessão antes de testar — checklist de 6 casos no registro, seção "ADR-025 … Fatia 1").
> **Próximo passo combinado: Fatia 2 — importação de XML de NF-e** (tela De-Para item-a-item: casa por
> EAN, sugestão por nome, busca manual sempre disponível, cadastro na hora pré-preenchido; confirmar
> atualiza custo "último custo" + gera Entrada de estoque ADR-001 + alimenta o catálogo global; desenho
> aprovado na ADR-025 §5). Ver ADR-025 e "ADR-025 … Fatia 1" no registro de testes.
>
> **Antes:** 2026-08-14 — **Refino do cadastro (2 pedidos do Owner no E2E): máscaras de
> telefone/CNPJ/CPF + busca de Fornecedor no padrão da busca de Produto — NO AR e VALIDADO pelo Owner.** O
> Owner **validou os 4 fluxos** da fatia UI.Cadastros.Fornecedores e pediu dois ajustes. **(1) Máscaras:** todo
> campo de **telefone/CNPJ/CPF** passa a **formatar ao sair do campo** (blur) com a máscara respectiva —
> `(11) 98765-4321`, `11.222.333/0001-81`, `123.456.789-09`. **shared (+5 testes → 14/14):** novos
> `formatCpf` e `formatCpfCnpj` (decide CPF×CNPJ pela contagem de dígitos) ao lado dos já existentes
> `formatCnpj`/`formatPhoneBr`. **web:** componente **`MaskedInput`** (mesmo padrão de **buffer de foco** do
> `MoneyInput`: dígitos crus enquanto focado — sem pulo de cursor — e máscara ao desfocar; guarda só os
> **dígitos**, forma canônica do banco, então busca por dígitos e envio ao servidor não mudam). Aplicado em
> **todos** os campos doc/telefone: `SupplierFormModal`, tela `/fornecedores` (form + lista),
> `CustomerQuickAddModal`, `CustomerProfile` e tela `/customers` (form + lista) — as listas também exibem
> mascarado. **(2) Busca de Fornecedor = busca de Produto:** na Entrada de Estoque o `<select>` de fornecedor
> virou o **mesmo componente de busca** do Produto — novo **`SupplierPicker`** (espelha o `ProductPicker`:
> campo de busca, lista ao digitar, "pílula" do selecionado + "Trocar"; filtro client-side acento-insensível
> por nome/CNPJ), com rodapé **"+ Cadastrar novo fornecedor"** preservando o quick-add. **Web-only, sem
> API/migration.** **Dois ajustes finais no `SupplierPicker` pedidos no E2E:** (a) **bug** — a lista não
> fechava ao clicar fora (ficava presa até escolher algo); adicionado fechamento por **clique-fora + Esc**
> (fornecedor é opcional ⇒ clicar fora deixa o campo vazio); (b) **paridade com o Produto** — a lista passa a
> aparecer **só ao digitar** (`open && query.trim()`), então "Trocar" **limpa sem reabrir** a lista; o rodapé
> "+ Cadastrar novo fornecedor" acompanha a busca. Gates: shared **14/14**, web typecheck + build (**22
> rotas**). **NO AR:** web `011ae5cb` → `75ac6571` (clique-fora + CNPJ mascarado na lista) → `6f5e49e0`
> (lista só ao digitar); smokes ✅ (HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-14):** "tudo
> funcionando corretamente" — máscaras nos 5 pontos e a busca de fornecedor no Estoque (buscar, selecionar,
> Trocar limpa sem travar). Commits `9b6b9c7` (refino) + `99e3f6f` (clique-fora) + `95227f8` (lista só ao
> digitar). **Fatia UI.Cadastros.Fornecedores CONCLUÍDA.** Ver "UI.Cadastros.Fornecedores" (refino) no
> registro.
>
> **Antes:** 2026-08-14 — **Cadastro de Fornecedor (tela + submenu "Cadastros") +
> quick-add de Fornecedor no Estoque e de Cliente no PDV — NO AR, aguardando E2E do Owner.** Achado do
> Owner: a Entrada de Estoque tinha o dropdown "Fornecedor" mas **não existia tela para cadastrá-lo** —
> o backend (`Supplier`, CRUD `/suppliers`, schemas Zod) existe desde a Fase 1, mas a UI nunca foi feita
> (o checklist marcava `/suppliers` como pronto referindo-se **só à API**). **Decisões de produto (Owner,
> antes de codar):** (1) tela própria de Fornecedores, agrupada com Clientes num **submenu recolhível
> "Cadastros"** (encurta a barra lateral; Produtos fica fora — é uso diário); (2) **quick-add**: "+ Novo
> fornecedor" na Entrada de Estoque e "+ Cadastrar cliente" na busca do PDV (quando não acha, cadastra na
> hora e **já seleciona**); (3) nome obrigatório, demais opcionais + **campo de observações**. **Migration
> `0027_supplier_notes` aprovada antes de aplicar (regra 1) e aplicada sem drift:** `Supplier.notes
> VarChar(500)?` — 100% aditiva/reversível (sem DEFAULT/backfill, sem RLS), mesmo perfil da 0018
> (`customers`). **shared:** `createSupplierSchema`/`updateSupplierSchema` ganharam `notes`. **web:** rota
> `/fornecedores` (listar + busca client-side acento-insensível + cadastrar + editar + remover
> soft-delete), componente único **`SupplierFormModal`** (criar/editar, reusado no quick-add do Estoque),
> **`CustomerQuickAddModal`** (create-only, nome pré-preenchido pela busca), menu reestruturado com **grupo
> "Cadastros"** recolhível (preferência lembrada em `localStorage`; abre sozinho quando a rota ativa é um
> filho). **Sem lógica de `core`.** Gates: shared **9/9**, web typecheck + build (**22 rotas**,
> `/fornecedores` 3.09 kB, `/estoque` 10.8 kB, `/venda` 18.2 kB), API dry-run; migration `0027` sem drift.
> ⚠️ **Deploy de API obrigatório** (aceita/retorna `notes`). **NO AR:** migration aplicada; API `0cc280b2`
> + web `45fcca5d`; smokes ✅ (health 200; `/suppliers` e `/customers` sem token 401; web HTML no-store +
> CSS 200). **Falta: E2E do Owner.** Ver "UI.Cadastros.Fornecedores" no registro.
>
> **Antes:** 2026-08-14 — **Esteira de precificação sincronizada (Custo · Markup ·
> Preço · Margem) + aviso de revisão de preço — NO AR e VALIDADO pelo Owner.** Pedido do Owner:
> adotar o padrão de mercado (Bling/Conta Azul/Omie) de precificação em tempo real no cadastro/edição
> de produtos, com os 4 campos interligados, sem "botão escondido". **Decisão central que elimina o
> loop de re-render:** a VERDADE são só `costPrice` e `salePrice`; **markup e margem são SEMPRE
> derivados** (nunca viram estado próprio) — editar markup/margem só recalcula o Preço, sem ciclo
> A→B→A; não há `useEffect` de sincronização. **Core (+13 testes → 256/256):** `markupPercent`,
> `salePriceFromMarkup`, `salePriceFromMargin`, `repriceHoldingMarkup` (a margem sobre venda reusa
> `calcMarginPercent`; preservar o markup ao mudar o custo = **escalar o preço na proporção do
> custo**). Testes de **ida-e-volta** (preço→markup→preço e preço→margem→preço idempotentes no
> centavo) travam a esteira. **Web:** `PercentInput` (buffer de foco — não trava ao digitar centavos,
> regra de UX #3) + `PricingEsteira` (4 campos + **semáforo**: prejuízo/no custo/margem magra/saudável;
> trava **margem ≥ 100%**, matematicamente impossível → orienta usar markup). Ligado no cadastro
> (`/products`) e na edição (`ProductDetail`). **Arredondamento reverso (item 2 do pedido) sai de
> graça:** o Preço é a única grandeza monetária (2 casas); markup/margem, por derivarem do preço já
> arredondado, refletem os centavos reais sozinhos. **Item 5 — aviso de revisão de preço:** quando uma
> Entrada de estoque sobrescreve o custo ("último custo", 2026-08-11), a margem muda em todo o sistema
> mas o Preço **não**. **Migration `0026_product_price_review` aprovada antes de aplicar (regra 1) e
> aplicada sem drift:** `Product.priceReviewPendingAt DateTime?` — 100% aditiva/reversível (sem
> DEFAULT/backfill, sem mudança de RLS, mesmo perfil das 0010–0012). `POST /stock/movements` grava o
> instante quando a entrada **muda** o custo (mesma transação, ADR-001); `PATCH /products/:id` limpa
> via `dismissPriceReview` (**sinal, não coluna** — salvar só o estoque mínimo pela lista NÃO dispensa
> o aviso). `ProductDetail` mostra faixa **âmbar discreta** "custo ajustado, confira o preço" com
> "Revisar preço" / "Marcar como conferido". **2 refinos do E2E (web-only):** (a) **Preço de venda
> sempre 2 casas** — as fórmulas do core já arredondavam, mas `salePrice` é `Decimal(12,4)` e um valor
> legado (ex.: `33,1075`) aparecia com 4 casas ao **focar** o campo (o `MoneyInput` mostra a precisão
> cheia); normalizado na carga (`toForm`/`copyFrom`), na digitação direta e na exibição (helper
> `money2`). (b) **Ícones "ⓘ" clicáveis** em Markup e Margem com frase curta explicando cada um (clique
> alterna, funciona no toque). Gates: core **256/256**, typecheck shared/api/web, build web (`/products`
> 12.6 kB), migration `0026` sem drift. ⚠️ **Deploy de API obrigatório** (o item 5 vive no `POST
> /stock/movements`). **NO AR:** migration aplicada; API `2b172964` + web `6731a3c5` (esteira+item 5 em
> `8ab68a4f`); smokes ✅ (health 200; `/stock/movements` e `/products` sem token 401; web HTML no-store
> + CSS 200). **E2E do Owner VALIDADO (2026-08-14):** "validado com sucesso" — os 4 fluxos da esteira,
> margem negativa, margem ≥100 travada, UX de centavos, item 5 (Entrada muda custo → aviso → Revisar/
> Conferido), preço a 2 casas e ícones de info. Commits `69aa807` (esteira + item 5) + `ced3303`
> (refinos); push do Owner. **Fatia UI.Produtos.EsteiraPrecificacao CONCLUÍDA.** Ver
> "UI.Produtos.EsteiraPrecificacao" no registro.
>
> **Antes:** 2026-08-12 — **Estoque: zerado sempre conta como baixo, mesmo sem mínimo
> cadastrado — NO AR e VALIDADO pelo Owner.** Achado do Owner: produtos **zerados** sem "Estoque mínimo"
> cadastrado (`minStockQty=0`) **não** apareciam no painel "Reposição de estoque" nem no filtro "Só baixo"
> — ficavam invisíveis mesmo com saldo 0. **Causa raiz:** a regra canônica `isLowStock` exige mínimo
> definido (`minStockQty > 0 && stockQty <= minStockQty`), escondendo a ruptura de venda de quem deixou o
> mínimo em branco (vários, num catálogo de 367). **Decisão do Owner (produto):** **Opção 1 — "zerado
> sempre é crítico"** (vs. Opção 2 — filtro/aba "Zerados" à parte, adiada; a Opção 1 é mais enxuta e já
> herda a distinção visual que a UI fazia). **Core:** nova função pura **`needsReplenishment`** =
> `stockQty <= 0` **OU** `isLowStock` — zerado entra no alerta independentemente de mínimo; `isLowStock`
> **intocada** (regra estrita do ponto de reposição, reusada no PDV). **+6 testes → 243/243.** **Web
> `/estoque`:** painel de reposição + filtro (agora **"Só baixo/zerado"**) usam `needsReplenishment`; badge
> distingue **"zerado"** (vermelho) de **"baixo"** (âmbar); coluna "Comprar" mostra **"—"** para zerado sem
> mínimo (não há meta). **Suporte (API + web):** dashboard **"Estoque baixo/zerado"** e a lista de produtos
> (flag `low` + filtro `lowStock=1`) usam a mesma regra — a query passou a incluir `stockQty <= 0` (`OR` no
> `where`); badge zerado/baixo. Lógica do `/estoque` é client-side; a de Suporte vive no servidor. **Sem
> migration.** Gates: core **243/243**, web typecheck+build (`/estoque` 9.53 kB, `/plataforma/suporte`
> 4.71 kB) ✅, API dry-run ✅. ⚠️ **Deploy de API obrigatório** (`low`/`lowStock` do Suporte). **NO AR:** API
> `8d509c1f` + web `b6ed7012`; smokes ✅ (health 200, `/support/:tenantId/products` sem token 401; web HTML
> no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-12):** "tudo validado com sucesso". Commit
> `59502c2`. **Fatia UI.Estoque.ZeradoBaixo CONCLUÍDA.** Ver "UI.Estoque.ZeradoBaixo" no registro.
>
> **Antes:** 2026-08-11 — **Nome do PDF da nota pelo código + impressão do resumo da
> dívida (dívida e conta) — NO AR e VALIDADO pelo Owner.** Dois pedidos do Owner (Horizonte 1). **(1) Nome do arquivo
> PDF:** ao "Salvar como PDF", toda nota baixava como **"NexoLoja.pdf"** (o navegador usa o
> `document.title` como nome sugerido). Agora o PDF sai nomeado pelo **código do documento** — venda
> **`V-000128.pdf`**, orçamento **`O-000045.pdf`** — trocando o `document.title` antes de imprimir e
> restaurando via `afterprint` (com teto de segurança). **(2) Impressão do resumo da dívida:** a tela de
> Contas a Receber (e o perfil do cliente) não imprimia o resumo de uma dívida específica → o
> `ReceivableDetailModal` ganhou **"Imprimir resumo"** (80mm/A4) que gera um documento novo
> (`ReceivablePrint`: cabeçalho da loja + `V-000128` + situação original/recebido/devolvido/saldo + itens
> + recebimentos + devoluções), com o PDF nomeado pelo **código da dívida** (a venda de origem —
> `V-000128.pdf`). **Follow-up (pedido do Owner):** faltava o botão na visão **Por Cliente**
> (`CustomerAccountModal`), que é justamente o resumo consolidado de tudo que o cliente deve → mesmo
> "Imprimir resumo" (novo `CustomerAccountPrint`: saldo devedor total + crédito a favor + dívidas em
> aberto por venda + itens em aberto consolidados), PDF nomeado pelo cliente (`Conta ….pdf`).
> **Refatoração:** os 3 `imprimir()` (PDV/Histórico/Orçamentos) que repetiam o mesmo
> bloco foram unificados em **`printArea()`** (lib/print.ts), que centraliza modelo + `@page` + logo +
> nome do arquivo. **Web-only** (sem API/migration). Gates: web typecheck ✅, build (**21 rotas**,
> `/contas-a-receber` 6.71 kB, `/venda` 17.3 kB) ✅. **NO AR:** web `5b79dfb1` → `3f19d4e8` (Por Cliente);
> smoke ✅ (HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-11):** "tudo validado e testado com
> sucesso" — nome do PDF pelo código (venda/orçamento) e "Imprimir resumo" nas duas visões (por dívida e
> Por Cliente). Commits `6e74ac0` + `5b4ae2c`. **Fatia UI.Impressao.NomePdfEDivida CONCLUÍDA.** Ver
> "UI.Impressao.NomePdfEDivida" no registro.
>
> **Antes:** 2026-08-11 — **Custo do produto atualizado pela Entrada de estoque (opcional,
> com confirmação) — NO AR e VALIDADO pelo Owner.** Pedido do Owner (Horizonte 1): o campo **Custo
> Unitário (opcional)** da Entrada de estoque era gravado só no `StockMovement.unitCost` (e exibido como
> coluna histórica no detalhe do produto), mas **não atualizava o custo do cadastro** (`Product.costPrice`)
> — que alimenta a margem (ADR-016), o PDV e os relatórios ("essa info não vai para lugar nenhum",
> confirmado no código). **Decisão do Owner (produto):** ao informar o custo na entrada, **sobrescrever o
> custo do cadastro (método "último custo") — pedindo confirmação** (muda a margem em todo o sistema);
> descartados custo médio ponderado e sobrescrever sem avisar. **Sem migration** (`costPrice` já existe).
> **shared:** `createStockMovementSchema` ganhou `newCostPrice` opcional (novo `costPrice` por **unidade de
> venda**; distinto do `unitCost`, que é por unidade-BASE/metro e vive só no movimento). **API (`POST
> /stock/movements`):** em entrada (INCOME), se vier `newCostPrice`, sobrescreve `product.costPrice` na
> **MESMA transação** do `StockMovement` + `stockQty` (ADR-001); saída nunca mexe no custo. **Web
> (`/estoque`):** ao registrar, se o custo digitado ≠ custo do cadastro, `confirm()` "o custo vai passar de
> R$ A para R$ B — confirmar?"; **OK** atualiza, **Cancelar** registra a entrada e mantém o custo (a
> confirmação gate só o custo). **Barra/rolo (ADR-017):** o valor enviado ao cadastro é o **digitado** (por
> barra = unidade de venda, que é o que `costPrice` guarda), não o `unitCost` convertido por metro. Gates:
> web typecheck ✅, API dry-run ✅, shared **9/9** ✅ (core intocado). ⚠️ **Deploy de API obrigatório** (a
> atualização vive no `POST /stock/movements`). **NO AR:** API `ddcd426f` + web `ba308d91`; smokes ✅ (health
> 200, `POST /stock/movements` sem token 401; web HTML no-store + CSS 200). **E2E do Owner VALIDADO
> (2026-08-11):** "testado e validado com sucesso". Commit `b836bb9`. **Fatia UI.Estoque.CustoNaEntrada
> CONCLUÍDA.** Ver "UI.Estoque.CustoNaEntrada" no registro.
>
> **Antes:** 2026-08-11 — **Busca padronizada: tokenizada (AND) + acento-insensível no
> servidor — NO AR e VALIDADO pelo Owner.** Pedido do Owner (Horizonte 1): padronizar a busca. **Dois
> problemas achados no código:** (1) o match era por **substring da query inteira** — "Luva 40" **não**
> achava "Luva ESG 40mm"; (2) só o **cliente** dobrava acento — o **servidor** era só case-insensitive
> (divergência já anotada como "refino futuro" no registro). **Decisão do Owner (consulta de produto):**
> **Opção A** — busca **tokenizada** (a query vira palavras; CADA palavra precisa aparecer, ordem-livre =
> AND) + `unaccent` no servidor — vs. **Opção B** (coluna denormalizada `searchText` + índice `pg_trgm`),
> **adiada** (só compensa em base grande ou p/ tolerância a erro de digitação; a B fica como upgrade
> natural). **Core:** `productMatchesQuery` reescrito — quebra a query em tokens e casa quando **todos**
> aparecem no palheiro concatenado (nome/nome popular/fabricante/SKU, separados por espaço p/ um token não
> vazar entre campos); acento-fold por token. **+6 testes → 237/237.** **API (introduz `$queryRaw` — não
> havia SQL cru antes; padrão novo, regra 4):** `GET /products/search` e `GET /customers` montam o WHERE com
> `Prisma.sql` (**parametrizado ⇒ à prova de injeção**) usando `extensions.unaccent()` por token, dobrando
> acento nos **dois** lados (dado e busca); helper `likeEscape` neutraliza os curingas `%`/`_`/`\` (substring
> literal, igual ao `.includes` do core); **keyset e ordenação (name asc, id asc) preservados**. Clientes:
> nome/e-mail tokenizado+unaccent, **CPF/telefone seguem por dígitos** (forma canônica). **Migration
> `0025_unaccent_extension` aprovada ANTES de aplicar (regra 1) e aplicada sem drift:** `CREATE EXTENSION IF
> NOT EXISTS unaccent WITH SCHEMA extensions` — **100% aditiva/reversível** (não toca tabela/coluna/índice/
> dado/RLS); validada no banco (`extensions.unaccent(...)` chamável pelo papel do runtime). Gates: core
> **237/237**, API dry-run/typecheck ✅, web typecheck ✅. ⚠️ **Deploy de API obrigatório** (rotas com SQL
> cru + a migration). **NO AR:** API `b113161b` + web `26f08971`; smokes ✅ (health 200, `/products/search`
> e `/customers` sem token 401; web HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-11):** "tudo
> validado com sucesso" — "Luva 40" → "Luva ESG 40mm", ordem-livre, acento ignorado (Produtos/Clientes/
> servidor), AND real (`Luva 50` não traz o de 40mm). Commit `003761f`. Ver "UI.Busca.Tokenizada" no
> registro. **Base p/ o futuro:** a Opção B (typo-tolerance via `pg_trgm`) reusa este desenho quando fizer
> falta.
>
> **Antes:** 2026-08-10 — **Navegação ‹ Hoje › + default "Hoje" nos filtros por data —
> NO AR e VALIDADO pelo Owner.** Pedido do Owner (Horizonte 1): navegar dia a dia sem digitar datas, em
> **todas** as telas com filtro por período, e abrir sempre em **Hoje**. **Só UI, sem API/migration.** Novo
> componente reutilizável **`apps/web/components/PeriodFilter.tsx`** (controlado por `{ from, to }` local):
> barra **‹ Hoje ›** (as setas deslocam a **janela inteira** em 1 dia — num período de 7/30 dias vira
> período anterior/seguinte; no default de 1 dia é navegação dia a dia), rótulo central **Hoje/Ontem/data**
> (clicável → volta pra hoje), **"próximo" travado no futuro**, + os atalhos **Hoje/7d/30d** e **De/Até**.
> Datas no fuso LOCAL (parse manual, sem passar por UTC). Prop `bare` para embutir numa barra de filtros
> existente. **Aplicado em 3 telas, todas abrindo em Hoje:** (a) **Relatórios** (era 30d) — troca o filtro
> inline pelo componente; (b) **Histórico de Vendas** (era "tudo") — filtro ficou **ao vivo** (removido o
> botão "Aplicar"; ordenação e busca por código intactas); (c) **Estoque › Movimentações** (era sem borda) —
> período embutido (`bare`) na barra com Produto/Tipo/Motivo; **"Limpar" mostra todo o histórico** (escape
> hatch). Fora de escopo: Orçamentos (o date input ali é "Válido até"), Contas a Receber e Entregas (sem
> filtro por data). Gates: web typecheck + build (**21 rotas**, `/relatorios` 4.83 kB, `/vendas` 8.15 kB) ✅.
> **NO AR:** web `c0a8b9d0`; smoke ✅ (HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-10):**
> "tudo validado". Ver "UI.Filtro.Periodo" no registro.
>
> **Antes:** 2026-08-10 — **Valor recebido e troco por venda (Histórico + comprovante) —
> NO AR e VALIDADO pelo Owner.** Pedido do Owner (Horizonte 1 do roadmap funcional): o Histórico listava as
> formas de pagamento mas **não** o valor recebido nem o troco (que o comprovante imprime). **Achado:** o
> troco **não era persistido** — `buildPersistedPayments()` grava o dinheiro que **fecha o total** (invariante
> do Caixa, ADR-016: "o troco fica fora do caixa"), então o valor entregue pelo cliente só existia na UI do
> PDV e se perdia após a venda. **Migration `0024_order_change_amount` aprovada ANTES de codar (regra 1) e
> aplicada sem drift:** `orders.changeAmount Decimal(12,2)` **nullable**, 100% aditiva (sem DEFAULT/backfill;
> RLS intacta). **NULL = venda antiga** sem o dado; vendas novas gravam **0** quando não há troco (informativo
> — NÃO entra no caixa; as parcelas seguem somando o total). **shared:** `createSaleSchema` ganhou
> `changeAmount` opcional. **API `POST /orders`:** grava `changeAmount ?? 0` (a lista `GET /orders` usa
> `include`, então o campo já viaja). **PDV:** envia o troco online **e** offline (via fila; omitido quando 0).
> **Histórico (`/vendas`):** cada venda passou a mostrar as **formas com valores** + **"Dinheiro recebido"** e
> **"Troco"** (só quando registrado e > 0); a reimpressão sai com o troco. **Refino pós-E2E (web-only):** na
> **nota impressa** faltava o "Dinheiro recebido" (mostrava só cobrado + troco) → o `ReceiptPrint` ganhou a
> linha **"Dinheiro recebido"** (= dinheiro aplicado + troco), antes do "Troco", quando há troco. Gates: core
> **231/231**, shared **9/9**, API tsc + dry-run ✅, web typecheck + build (**21 rotas**, `/vendas` 7.73 kB) ✅;
> migration `0024` sem drift. ⚠️ **Deploy de API obrigatório** (grava o campo + migration). **NO AR:** API
> `31046990` + web `64a784c4` → `a52b328c` (refino da nota); smokes ✅ (health 200, `/orders` sem token 401;
> web HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-10):** "validado com sucesso" (troco na nota,
> Dinheiro recebido/Troco no Histórico e na reimpressão, venda sem troco sem a linha, venda antiga "não
> registrado") + o refino do "Dinheiro recebido" na nota ("agora sim, validado com sucesso"). Ver
> "UI.Vendas.RecebidoTroco" no registro.
>
> **Antes:** 2026-08-10 — **🐞 Bug do logo no comprovante (some ao ser trocado) —
> CORRIGIDO, NO AR e VALIDADO pelo Owner.** Pedido do Owner (Horizonte 1 do roadmap funcional). **Sintoma:**
> ao **trocar** a logo da loja, ela **sumia do comprovante impresso** (quebrava a identidade da loja).
> **Causa raiz:** o `#print-area` fica `display:none` na tela (`globals.css`) e só aparece na impressão;
> o navegador **não garante o download** de um `<img>` em subárvore oculta (às vezes nem inicia até ficar
> visível). Como `imprimir()` chamava `window.print()` **de forma síncrona**, o snapshot saía antes de a
> logo baixar. Aparecia sobretudo **ao trocar** porque a URL nova carrega cache-bust
> (`/public/logo/:tenantId?v=<ts>`) e **nunca tinha sido buscada** — a anterior já estava no cache do
> navegador. Confirmado que no PDV a logo existe **só** no print-area (a prévia na tela não a renderiza),
> então nada aquecia o cache. **Correção (web-only, sem migration/API):** novo helper
> `apps/web/lib/print.ts` `ensureImageLoaded(url)` que **pré-carrega a logo** (mesma URL do `<img>` ⇒ cai
> no cache) **antes** de `window.print()`, com **teto de 2,5 s** para nunca travar a impressão se a rede/
> imagem falhar. Aplicado nas **três** telas que imprimem (PDV `/venda`, Histórico `/vendas`, Orçamentos
> `/orcamentos`) — também corrige a 1ª impressão logo após abrir a tela. Gates: typecheck web ✅, build web
> (**21 rotas**, `/venda` 17.1 kB) ✅. **NO AR:** web `3ddcc237` (só os 3 assets `venda`/`vendas`/`orcamentos`
> mudaram); smoke pós-deploy ✅ (HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-10):** "tudo
> testado e validado com sucesso" — logo aparece após trocar, no PDV/Histórico/Orçamentos, 80mm e A4. Ver
> "UI.Comprovante.Logo" no registro. **Plano B guardado** (se reaparecer em algum aparelho): embutir a logo
> como data-URI no print, eliminando qualquer dependência de rede na hora de imprimir.
>
> **Antes:** 2026-08-10 — **ADR-024 (orçamentos salvos — documento `O-000045`) —
> Sub-fatia 2.B COMPLETA (Opção 2) NO AR e VALIDADA pelo Owner. ADR-024 (par ADR-023/024) COMPLETO.**
> **E2E do Owner VALIDADO (2026-08-10):** "tudo validado com sucesso" — nome livre (salvar + busca), gerar
> venda (orçamento → V-… CONVERTED), editar rascunho (mesmo O-…) e fidelidade de par. Commit `43bf9f8`. **Migration `0023`
> (`quotes.customerName`, aditiva, aplicada sem drift — aprovada antes de codar, regra 1).** Quatro entregas:
> **(a) nome livre de balcão** — campo opcional para identificar de quem é o orçamento SEM criar cadastro
> (a pessoa pode não voltar); aparece em salvar/editar/listar/detalhe e entra na busca "por cliente".
> **(b) Converter em venda** — "Gerar venda" no detalhe abre o PDV pré-preenchido (`?quoteId=`); ao concluir,
> o `POST /orders` marca o orçamento `CONVERTED` + `convertedOrderId` na MESMA transação da venda (guarda
> `updateMany` condicional à prova de corrida; recusa se já convertido). **(c) Editar rascunho** — reabrir um
> DRAFT no PDV (`?quoteId=&edit=1`) carrega o carrinho; "Salvar alterações" grava por cima do mesmo `O-…` via
> `PATCH /quotes/:id` com `items` (discriminado — o CORS não libera PUT; só enquanto DRAFT). **(d) Fidelidade
> de par** — o orçamento passou a SALVAR o par expandido em 2 itens com `pairGroup` (mesmo motor da venda,
> `splitPairLine`), e a exibição/nota reagrupam via `groupPairedItems` (core). **Reconstrução** reusa os
> construtores de linha do PDV (extraídos p/ `buildCartLine`/`buildPairCartLine`, sem duplicar preço) com
> preço/estoque ATUAIS. **Limitação:** orçamentos da **2.A** guardaram o par colapsado sem `pairGroup` → ao
> reabrir, essas linhas (e produtos fora do catálogo) entram numa **lista de revisão** p/ re-adicionar à mão.
> Gates: core **231/231**, shared **9/9**, typecheck api/web ✅, build web (**21 rotas**, `/venda` 17 kB) ✅,
> dry-run api ✅; migration `0023` sem drift. ⚠️ **Deploy de API obrigatório** (conversão + `customerName` +
> revisão). **NO AR:** API `c5980090` + web `ea0b2614`; smokes ✅ (health 200; `/quotes`, `PATCH /quotes/:id`,
> `/orders` sem token 401; web HTML no-store + CSS 200). **Falta:** E2E do Owner. Ver ADR-024 e "ADR-024" no
> registro. **ADR-024 (par ADR-023/024) COMPLETO após o E2E.**
>
> **Antes:** 2026-08-10 — **ADR-024 (orçamentos salvos — documento `O-000045`) —
> refino de UX do PDV NO AR e VALIDADO pelo Owner (web `10389bcb`).** O refino pedido no E2E de 2.A:
> **"Orçamento" virou botão único** (gera a prévia) e **"Válido até" + "Salvar orçamento" migraram para a
> tela de prévia** (junto do "Imprimir") — o bloco redundante do carrinho foi removido. **Só UI, sem
> migration/API** (typecheck + build web ✅, 21 rotas, `/venda` 15.9 kB; deploy web-only, smoke ✅). **E2E do
> Owner VALIDADO (2026-08-10):** "validado com sucesso". Commit `34b6611`. **Próximo: Sub-fatia 2.B** —
> editar rascunho no PDV (`?quoteId=`) + converter em venda (`quoteId` no `POST /orders` marca `CONVERTED` +
> `convertedOrderId` na transação da venda; ⚠️ exige deploy de API). Ver ADR-024 e "ADR-024" no registro.
>
> **Antes:** 2026-08-07 — **ADR-024 (orçamentos salvos — documento `O-000045`) —
> Sub-fatia 2.A NO AR, aguardando E2E do Owner.** Fatia 2 do par do ADR-023: o orçamento vira
> **documento guardado e localizável**, com código próprio `O-000045` (reusa o motor de numeração por
> loja do ADR-023). **Decisões do Owner (antes de codar):** salvar por **ação explícita** ("Salvar
> orçamento" no PDV — a cotação efêmera continua, custo-zero); **ciclo de vida completo**
> (Rascunho/Enviado/Aceito/Recusado/Convertido); **com validade**; **converter em venda** (na 2.B).
> **ADR-024 escrito e migration `0022` aprovada ANTES de codar (regras 1 e 4).** **Migration `0022_quotes`
> (aditiva, tabelas VAZIAS ⇒ sem janela quebrada; RLS por tenant padrão 0019; sem drift):** enum
> `QuoteStatus`; tabelas `quotes` + `quote_items` (snapshot, SEM efeito de estoque); `tenants.lastQuoteNumber`
> (contador). **"Expirado" é DERIVADO** de `validUntil` (sem cron — custo-zero). **Sub-fatia 2.A:** motor +
> CRUD + tela. `formatQuoteNumber`/`parseQuoteNumberQuery` (shared, +2 testes → **9/9**; `formatOrderNumber`
> refatorado sobre base comum). API `quotes.ts`: `POST /quotes` (salva, aloca o nº atômico como o ADR-023),
> `GET /quotes` (lista/busca por código/cliente/status/período, keyset), `GET /quotes/:id`, `PATCH
> /quotes/:id` (status/validade/observação; imutável se convertido/enviado), `DELETE` (soft-delete de
> rascunho). Web: **menu "Orçamentos"** + tela `/orcamentos` (lista + busca + selo por status efetivo +
> detalhe com ciclo de vida + reimpressão + exclusão); PDV ganhou **"Salvar orçamento"** (validade default
> +7d) + confirmação com o código; `ReceiptPrint` do orçamento imprime `O-000045` + "Válido até". Gates:
> core **231/231**, shared **9/9**, typecheck api/web ✅, build web (**21 rotas**, `/orcamentos` 4.76 kB,
> `/venda` 15.9 kB) ✅, dry-run api ✅; migration `0022` sem drift. ⚠️ **Deploy de API obrigatório** (rotas
> novas). **NO AR:** API `83c465f2` + web `0e0465dd`; smokes ✅ (health 200, `/quotes` sem token 401; web
> HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-08-07):** os 4 testes "passaram com sucesso"
> (salvar no PDV → O-000045 na nota; busca por código/cliente/status; ciclo de vida + validade +
> reimpressão + exclusão; "Expirado" derivado). **Refino de UX pedido no E2E (planejado, ainda NÃO
> implementado):** o Owner notou que o botão "Orçamento" + o bloco "Válido até/Salvar orçamento" ficaram
> **redundantes** no carrinho → **"Orçamento" vira botão único** (gera a prévia) e **validade + "Salvar
> orçamento" migram para a tela de prévia** (junto do Imprimir), onde se decide imprimir (efêmero) ou
> salvar; só UI, sem migration/API. **Sub-fatia 2.B (próximo passo combinado):** editar rascunho reabrindo
> no PDV + **converter em venda** (`quoteId` no `POST /orders` marca `CONVERTED`) — fazer o refino de UX
> antes ou junto. Ver ADR-024 e "ADR-024" no registro.
>
> **Antes:** 2026-08-07 — **ADR-023 (numeração sequencial de vendas — código
> `V-000128`) — Fatia 1 de 2 — NO AR, aguardando E2E do Owner.** Fecha o **refino pendente do
> ADR-022** ("busca por código") **e** o pedido do Owner de um identificador humano nas vendas/notas.
> **Problema:** o `Order` só tinha `id` UUID; o "código" mostrado nas dívidas era `#slice(0,8)` do UUID
> — **aleatório, não memorável, ausente na nota, e não pesquisável sem cast de UUID**. **Decisão do
> Owner (perguntas de produto ANTES de codar):** número **sequencial por loja**, formato **`V-000128`**
> (prefixo `V-` + zeros); orçamento fica para a **Fatia 2** (hoje não é salvo → sem número; a busca de
> orçamento nascerá numa tela "Orçamentos" própria com código `O-000045`, reusando o mesmo motor). **ADR
> escrito e migration aprovada ANTES de codar (regras 1 e 4).** **Migration `0021_order_sequential_number`
> (aditiva, sem tabela nova, RLS intacta, aplicada sem drift):** `orders.orderNumber INT` +
> `@@unique([tenantId, orderNumber])`; **backfill** dos pedidos existentes por loja
> (`ROW_NUMBER() OVER (PARTITION BY tenantId ORDER BY createdAt, id)`); contador `tenants.lastOrderNumber
> INT DEFAULT 0` acertado pro maior nº. **Atribuição atômica** no `POST /orders`: `UPDATE tenants
> SET lastOrderNumber = lastOrderNumber+1 RETURNING` **sob lock da linha do tenant**, dentro da transação
> da venda (à prova de corrida; rollback devolve o nº). **Offline:** nº é autoridade do servidor → a nota
> offline sai "código pendente de sincronização"; a reimpressão pelo Histórico traz o `V-000128`
> (idempotência garante 1 nº por venda). **Helpers puros (`packages/shared/format.ts`):**
> `formatOrderNumber` (V-000128) + `parseOrderNumberQuery` (aceita `V-000128`/`000128`/`128`) — **+7
> testes** (Vitest ligado ao `packages/shared`). **Superfícies:** nota (`ReceiptPrint`), **Histórico de
> Vendas** (código por linha + **busca por código** no servidor, `?number=`, em todo o histórico), Contas
> a Receber (Por venda + extrato), perfil do cliente e descrições de movimentação de estoque — os três
> `#slice(0,8)` substituídos por `V-000128` (payloads de `/receivables`, extrato, `/customers/:id/history`
> ganharam `orderNumber`; crédito resolve `relatedOrderNumber`). Gates: core **231/231**, shared **7/7**,
> typecheck api/web ✅, build web (20 rotas, `/vendas` 7.37 kB, `/venda` 15.4 kB) ✅, dry-run api ✅;
> migration `0021` sem drift. ⚠️ **Deploy de API obrigatório** (a alocação vive no `POST /orders`; e a
> migration NOT NULL exige a API nova). **NO AR:** API `c2336501` + web `de6715b8`; smokes ✅ (health 200,
> `/orders?number=` sem token 401; web HTML no-store + CSS 200). **Falta:** E2E do Owner. Ver ADR-023 e
> "ADR-023" no registro. **Próximo passo combinado:** **Fatia 2 — orçamentos salvos (`O-000045`)** — ADR
> próprio (salvar por ação explícita ao imprimir/enviar; tela "Orçamentos" com busca; converter em venda;
> futuro envio por WhatsApp/e-mail).
>
> **Antes:** 2026-08-05 — **ADR-022 Fatias B + C (devolução por item + crédito do
> cliente) — NO AR e VALIDADAS pelo Owner.** **Fatia B (devolução/troca por item):** migration
> **`0019`** (`order_returns`/`order_return_items`/`customer_credits` + `order_items.returnedBaseQty` +
> `customers.creditBalance` + enum `ReturnTarget`). `POST /orders/:id/return-items` estorna estoque,
> grava `returnedBaseQty`, abate a dívida (`Receivable.returnedAmount`); excedente → **crédito OU
> dinheiro** (escolha). **Decisão de produto:** a devolução aparece como **evento próprio append-only**
> (não muta a venda). Refinos: evento "− Devolução" na timeline; resumo consolidado "Itens em aberto";
> devolução no detalhe por-venda (`GET /receivables/:id` → `returnedAmount`+`returns`). **Fatia C
> (crédito):** **C.1** filtro "Com dívida / Com crédito / Todos" na visão Por cliente + `creditBalance`
> por linha. **C.2** usar crédito no PDV = forma **"Crédito da loja"** (opt-in, espelha o fiado; campo
> `creditApplied`; servidor grava parcela `STORE_CREDIT` + debita `CustomerCredit`/`creditBalance` com
> `updateMany` condicional; cancelar/`return` estornam). **Achado:** persistir `Payment 'STORE_CREDIT'`
> faz relatório e caixa (`cashInflow` só CASH) funcionarem sozinhos — só faltou `paymentMethodLabel`.
> Core `maxStoreCreditForSale` (+4 → **231/231**). **Refinos do E2E:** Revisão do PDV mostra as formas;
> aviso ao exceder crédito; uso do crédito no extrato ("Crédito gerado/usado/estornado"); **código
> `#xxxx` + status por dívida** (extrato/Por venda/perfil, dívida quitada é **link** no perfil);
> **extrato = só dívidas EM ABERTO** (quitada sai; crédito segue visível). **C.3 (acréscimo de cartão
> ao Receber):** migration **`0020`** (aditiva `receivable_payments.surcharge`). Ao receber por
> débito/crédito, se um item tiver acréscimo (ADR-016), avisa e libera **campo MANUAL** (operador
> decide o valor — resolve o rateio no parcial); é receita a mais (não abate a dívida; soma no
> relatório à forma). Vale nos dois recebimentos (uma dívida **e** conta inteira). Gates a cada fatia:
> core 231/231, typecheck api/web, build web, dry-run api; migrations `0019`/`0020` sem drift. **NO AR:**
> API `49b0f461` + web (deploys por fatia); smokes ✅. **E2E do Owner VALIDADO (2026-08-05):** B, C.1,
> C.2, C.3 e todos os refinos ("tudo certo"). Commits `383e17f`…`3d73fb2`. **ADR-022 (A/B/C) COMPLETO.**
> **Refino pendente:** busca por código (`orderId` é UUID → precisa cast no Postgres / query raw).
>
> **Antes:** 2026-07-31 — **Conta do cliente (fiado acumulado) — ADR-022, Fatia A
> (+ A.2 + 2 refinos) — NO AR e VALIDADO pelo Owner.** Pedido do Owner: uma vez gerada uma venda a
> prazo, não dava para **adicionar/remover/trocar** itens — mas o cliente **volta pegar mais** e
> **paga no fim**. **ADR-022 escrito e aprovado ANTES de codar** (regras 1 e 4). **Decisões de
> produto:** (1) **adicionar itens = nova venda a prazo que SOMA na conta** (o `Order` original fica
> imutável — preserva estoque/auditoria); (2) **conta IMPLÍCITA por cliente** (`saldo = Σ recebíveis
> em aberto`); (3) devolução com **escolha crédito×dinheiro** (fica p/ a Fatia B). **Fatia A = a
> conta que soma + receber no fim (FIFO), SEM migration.** **Core (+7 → 219/219):**
> `distributeAccountPayment` (rateia um recebimento nas dívidas do mais antigo pro mais novo, em
> centavos) + `customerAccountBalance`. **API:** `GET /receivables/accounts` (agrupa por cliente via
> `groupBy` — saldo somado, nº de dívidas, vencimento mais próximo), `POST
> /receivables/accounts/:customerId/receive` (recebe contra a conta inteira, abate FIFO, lança **um**
> Suprimento no caixa pelo total; reúso do motor do ADR-019). **Web (`/contas-a-receber`):** duas
> visões — **"Por cliente"** (padrão, a conta que soma) e **"Por venda"** (a lista dívida-a-dívida de
> antes, preservada, sem regressão). **A.2 (mesma sessão):** **extrato consolidado** — clicar no
> cliente abre uma tela maior (`CustomerAccountModal`) com **log cronológico único** (cada venda com
> seus itens + cada recebimento, saldo corrente linha a linha; `GET /receivables/accounts/:customerId`);
> **PDV** ganhou **alerta "Dívida ativa: R$ X"** (vermelho) ao escolher cliente que já deve e um
> atalho **"+ Adicionar itens"** que abre o PDV já com o cliente (`?customerId=`) — a saída de
> mercadoria roda no PDV (motor único), **prática de mercado** (opção validada com o Owner vs.
> adicionar itens dentro da tela de contas). **Refino (observação da dívida):** a nota tinha que ser
> **da dívida, separada do cadastro** e **compartilhada por todas as vendas** do cliente → migration
> **`0018_customer_debt_notes`** (1 coluna aditiva `customers.debtNotes VARCHAR(500)`, aplicada, **sem
> drift**), editada nas duas visões, isolada de `customers.notes` (perfil). Gates a cada passo: core
> **219/219**, typecheck api/web, build web (**20 rotas**, `/contas-a-receber` 5.25 kB), dry-run api;
> migration `0018` sem drift. ⚠️ **Deploy de API obrigatório** (rotas novas). **NO AR (deploy final):**
> API `72cd47d5` + web `bef084f8`; smokes ✅ (health 200; `/receivables/accounts` e `.../receive` e
> `.../accounts/:id` sem token 401; postdeploy do web HTML no-store + CSS 200). **E2E do Owner
> VALIDADO (2026-07-31):** Fatia A **5/5** ("passaram com sucesso"), A.2 (extrato + PDV) e a separação
> da observação (dívida × cadastro) — "Tudo certo e aprovado". **Fatia A CONCLUÍDA.** Ver ADR-022 e
> "ADR-022" no registro. **Próximo passo (combinado):** **Fatia B — devolução/troca por item** (abate
> a dívida; excedente vira crédito **ou** dinheiro, escolha do operador) — usa a migration **`0019`**
> (renumerada: a `0018` foi consumida pelo refino da observação; anotado no ADR-022).
>
> **Antes:** 2026-07-31 — **Tela de Estoque: 4 ajustes de UI + ordenação das
> Movimentações — NO AR e VALIDADO pelo Owner.** Pedidos do Owner, todos na tela de Estoque; sem
> migration. **(1) Rótulo por unidade fechada (ADR-017):** ao escolher um produto de **rolo** o campo
> de quantidade mostrava "Quantidade (barras)" fixo → agora reflete a unidade real ("Quantidade
> (rolos)", "Custo por rolo…") via helper `unitWord`. **(2) Busca estilo PDV:** os dois `<select>`
> gigantes de produto (Entrada e Ajuste) viraram o mesmo campo de **busca do PDV** — novo
> `apps/web/components/ProductPicker.tsx` (reusa `productMatchesQuery`: nome/apelido/fabricante/SKU),
> lista só ao digitar, estoque por linha, botão "Trocar". **(3) Filtros das Movimentações no
> SERVIDOR:** o `GET /stock/movements` filtrava com `take:50` + filtro no cliente, então **Motivo** e
> **Data** só enxergavam as 50 linhas carregadas → agora o endpoint aceita `type`/`reason`/`from`/`to`
> (reason casa motivo **OU** fornecedor, case-insensitive; datas no fuso da loja UTC-3), a busca varre
> **todo o histórico** e o período enxuga de verdade; teto de 1000 + "Mostrar mais". **(4) Ordenação
> das Movimentações:** cabeçalhos clicáveis (↑/↓) como no "Estoque atual" — Data (default desc),
> Produto, Tipo, Qtd, Motivo, Registrado por; ordenação client-side sobre a lista já filtrada. Gates:
> core 212/212, typecheck web, build web (20 rotas, `/estoque` 8.52 kB), API dry-run. ⚠️ **Deploy de
> API obrigatório** (fix 3). **NO AR:** API `0cddb35b` + web `dd9c4fa5` (ordenação: web `9695c005`);
> smoke ✅ (health 200, `/stock/movements` com filtros sem token 401; web HTML no-store + CSS 200).
> **E2E do Owner VALIDADO (2026-07-31):** os 4 ajustes ("passaram com sucesso") + a ordenação
> ("funcionou perfeitamente"). Commits `779f196` (ajustes) + `3158a71` (ordenação). **Fatia
> UI.Estoque.Ajustes CONCLUÍDA.** Ver "UI.Estoque.Ajustes" no registro.
>
> **Antes:** 2026-07-31 — **ADR-020 (retirada / entrega futura) — NO AR e
> VALIDADO pelo Owner (E2E 6/6 + 3 refinos). Fatia CONCLUÍDA.** Eixo ortogonal ao fiado (ADR-019, que adia o
> PAGAMENTO): aqui adiamos a **SAÍDA da mercadoria**. **Decisões de produto fechadas com o Owner:**
> entrega **PARCIAL, item a item** (leva parte hoje, parte depois); **tela dedicada "Entregas"**
> (lista + detalhe/log, na mesma lógica de Contas a Receber); **previsão de retirada** com **data
> única do pedido** + **flag opcional "Data por item"**; no PDV, opção opt-in **"Venda com
> retirada/entrega posterior"** (estilo "+ Venda a prazo"). **Migration `0017_scheduled_delivery`
> desenhada, aprovada (regra 1) e aplicada** (via `db:deploy`, sem drift): **100% aditiva** (2 enums
> `DeliveryMode`/`FulfillmentStatus`; `orders.deliveryMode/fulfillmentStatus/scheduledPickupAt/
> perItemSchedule`; `order_items.deliveredBaseQty/scheduledPickupAt`; `products.reservedQty` —
> **disponível = `stockQty − reservedQty`**; tabela nova **`order_item_deliveries`** = o LOG de cada
> retirada + RLS). **Desenho espelha o fiado:** `order_item_deliveries` ≡ `receivable_payments`,
> `OrderItem.deliveredBaseQty` ≡ `Receivable.settledAmount`. **Reúso do `Delivery` (ADR-002)
> descartado** (é por-pedido/tudo-ou-nada, `address` NOT NULL; parcial exige rastreio por linha).
> **Como preserva as invariantes:** venda SCHEDULED **reserva** (`reservedQty += base`) e NÃO baixa;
> a baixa REAL (ADR-001: `StockMovement EXPENSE` + `stockQty`) dispara na **retirada**, parcial, no
> `POST /deliveries/:id/deliver`, que também abate `reservedQty`, incrementa `deliveredBaseQty`,
> grava o log e recalcula `fulfillmentStatus`. **PDV trava pelo disponível** (num ponto só, no
> carregamento do catálogo). **Cancelamento/devolução cientes da reserva:** liberam o reservado
> remanescente e estornam via `INCOME` só a parte já retirada. **Compõe com o fiado** (ortogonal:
> leva-depois **e/ou** paga-depois). **Core +23 → 212/212** (`availableQty`, `remainingToDeliver`,
> `isValidDelivery`, `applyItemDelivery`, `orderFulfillmentStatus`, `reconcileReserved`). Gates:
> core **212/212** ✅, typecheck API ✅, dry-run API ✅, build web (**20 rotas**, `/entregas` 3.54 kB,
> `/venda` 14.2 kB) ✅; migration `0017` aplicada, **sem drift**. **NO AR:** API `0d9ef2bf` + web
> `1025446e`; smoke ✅ (health 200, `/deliveries` e `/deliveries/:id/deliver` sem token 401, `/orders`
> 401; postdeploy do web: HTML no-store + CSS 200). **E2E do Owner VALIDADO (2026-07-31):** os 6
> passos passaram. **3 refinos pedidos no E2E (NO AR):** (a) **espaçamento** entre os links "+ Venda a
> prazo" e "+ Venda com retirada/entrega posterior" (viraram `block` + `mt-2`); (b) **cliente na
> retirada futura sem fiado** — o seletor de cliente (extraído p/ `renderCustomerPicker`, reusado nos
> dois blocos) agora aparece também no bloco de agendamento (cliente **opcional**; antes a Entrega
> saía "sem nome" quando não era a prazo); (c) **observação livre do pedido** — campo geral no PDV
> **e editável no detalhe da Entrega** (`Order.notes`; novo `PATCH /deliveries/:id` +
> `updateOrderNotesSchema`), distinta da "observação da retirada" (que fica no log). Gates: core
> 212/212, typecheck api/web, build web (20 rotas, `/entregas` 3.86 kB, `/venda` 14.5 kB). **NO AR
> (refinos):** API `e7e7b7c7` + web `27d7d416`; smoke ✅ (health 200, `PATCH /deliveries/:id` 401).
> **E2E do Owner VALIDADO (2026-07-31):** "deu tudo certo" (E2E 6/6 + os 3 refinos). Commits
> `a5202a6` (fatia) + `e7f60b7` (refinos), **push feito pelo Owner**. **Fatia ADR-020 CONCLUÍDA.**
> Ver ADR-020 (seção "Implementação") e "ADR-020" no registro de testes.
>
> **Antes:** 2026-07-30 — **Cesta (ADR-021) NO AR + 🐞 bug do DELETE (ressurreição)
> corrigido — E2E do Owner VALIDADO · trava de regressão do "abre sem CSS" · 2 ajustes de UI no PDV.**
> **(1) Cesta:** deploy de API+web da ADR-021; no E2E do Owner surgiu um **bug de sincronização**: ao
> **excluir** a cesta num aparelho, ela **ressuscitava** nos outros ("volta como se nunca tivesse sido
> excluída"; o navegador do celular tinha armazenamento separado do PWA, o que embaralhava o sintoma).
> **Causa raiz:** o `DELETE /cart` fazia `deleteMany` e **apagava a linha** → o `GET` devolvia
> `updatedAt: null`, lido no cliente como época 0 (muito velho); qualquer aparelho com o **espelho local
> ainda cheio** (`localMs > 0`) vencia o last-write-wins e **re-enviava os itens excluídos**. **Correção:**
> o DELETE não apaga mais a linha — faz upsert da cesta **vazia com `updatedAt` novo** (tombstone datado):
> "cesta limpa" vira um estado datado *agora* que vence os espelhos antigos ⇒ todos os aparelhos convergem
> para vazio, deterministicamente. **Sem migration.** Typecheck API ✅. **NO AR:** API `bd036f55`; smoke ✅
> (health 200, `DELETE`/`GET /cart` sem token 401). **E2E do Owner VALIDADO (2026-07-30):** "funcionou
> corretamente". Commit `5635495`. **(2) CSS "abre sem estilo" — trava de regressão:** as correções já no
> ar (force-dynamic + `no-store` nos documentos + predeploy clean + SW v4) mataram a causa raiz (HTML preso
> no cache de borda apontando p/ hash de CSS que sumiu no deploy); para **garantir que não volte**, novo
> `apps/web/scripts/verify-deploy.mjs` — falha (exit 1) se o HTML voltar a ser cacheável (sem `no-store` /
> com `s-maxage`) **ou** se algum CSS `/_next/static` referenciado der ≠ 200 — ligado como **`postdeploy`**,
> roda sozinho após todo `npm run deploy` do web (deixa de depender de conferência manual). Validado contra
> produção ✅ (mesmo commit `5635495`). **(3) PDV — 2 ajustes de UI** (web-only, sem API/migration): **(a)
> overflow no celular** — ao pôr itens no carrinho a tabela esticava a **página inteira** e "sambava" (o
> grid do PDV não definia colunas no mobile ⇒ coluna `auto` = largura do conteúdo, e `min-width:auto` de
> item de grid não encolhe); colunas → `minmax(0,…)` + `min-w-0` nos 4 blocos ⇒ a tabela rola dentro do
> próprio card, a página fica estática. **(b) campo de quantidade travado** — o `<input type="number">`
> controlado pelo número não deixava **apagar** para digitar outro (voltava ao valor na hora); novo
> componente **`QtyInput`** (rascunho de texto interno: apaga/digita livre, comita só número válido, no
> `blur` volta ao valor real com a **mesma trava de estoque** do `changeLineQty`). Gates: typecheck web ✅,
> build web (19 rotas, `/venda` 13.6 kB) ✅. **NO AR:** web `ddf86898` (o `postdeploy` rodou e o smoke do
> CSS passou). **E2E do Owner VALIDADO (2026-07-30):** "tudo certo, nos dois pontos". Commit `3140118`. Ver
> "UI.PDV.MobileQty" no registro. **Em seguida (mesmo dia) — polimento visual (UI.Tema.Contraste):** (i)
> **"Falta receber" em vermelho** (simétrico ao Troco verde) no PDV; (ii) **cabeçalhos de tabela** (o
> `<thead>` de todas as telas) do cinza-100 → **azul-200** (`text-blue-900`) — pedido do Owner ("as barras
> azuis dos cabeçalhos mais vivas", escolhido +2 tons sobre preview); (iii) **textos cinzas um tom mais
> escuros** em todas as telas (cinza-400→500, cinza-500→600; tamanhos mantidos). Script único (10 theads +
> 2 sub-tabelas + 264 textos, 28 arquivos). Gates: typecheck web ✅, build web ✅. **NO AR:** web `30af452c`
> (smoke do CSS OK). **E2E do Owner VALIDADO (2026-07-30):** "tudo funcionando corretamente". Commit
> `d96be73`. **Depois (mesmo dia) — Estoque: paginação + reposição fechada (UI.Estoque.Paginacao):** pedido
> do Owner. **(a) "Reposição de estoque"** passa a abrir **FECHADA** por padrão (`usePersistedOpen(…, false)`;
> quem já tinha preferência mantém a dele). **(b) "Estoque atual"** ordena pelos **mais recentemente
> atualizados** (novo default `updatedAt` desc — o payload de `GET /products` já traz `updatedAt`) e mostra
> **20 + "Mostrar mais"** (+20). **(c) "Movimentações recentes"** também **20 + "Mostrar mais"**. Paginação
> **client-side** (a lista já vem inteira em memória — sem tocar na API), no mesmo padrão do
> `StockDetail`/Histórico; volta à 1ª página quando busca/filtro/ordenação muda. Web-only, sem API/migration.
> Gates: typecheck web ✅, build web (19 rotas, `/estoque` 7.76 kB) ✅. **NO AR:** web `a4b775b0` (smoke do CSS
> OK). **E2E do Owner VALIDADO (2026-07-30):** "tudo validado com sucesso". Commit `9c5eeb5`. Ver
> "UI.Estoque.Paginacao" no registro. **Próximo passo — ADR-020 (retirada / entrega futura): DIREÇÃO
> APROVADA, sessão encerrada aqui a pedido do Owner.** Capturadas **3 decisões de produto** (ver
> `docs/adr/ADR-020-retirada-entrega-futura.md`): **(1)** reserva no ato e a **saída real de estoque só na
> entrega/retirada** (adia a saída de verdade; preserva o ADR-001, que passa a disparar no evento de
> entrega); **(2)** o PDV trava pelo **disponível = estoque − reservado** (não vende a mesma peça 2×);
> **(3)** pagamento suporta **as duas** formas (pago no ato **e** a prazo/ADR-019, que compõem no mesmo
> pedido — dinheiro pendente + mercadoria pendente). **NADA de estoque/venda/schema foi tocado.**
> **Retomar em outra sessão DESTE ponto:** decidir os itens ainda abertos (entrega **parcial** vs
> tudo-ou-nada; onde marcar "entregue"; reúso do modelo `Delivery` ADR-002 vs colunas novas) → **desenhar
> e aprovar a migration (regra 1)** → implementar core → API → UI.
>
> **Antes:** 2026-07-29 — **Cesta persistente sincronizada (carrinho do PDV por
> usuário, entre dispositivos) — ADR-021 — CÓDIGO PRONTO, aguardando deploy + E2E do Owner.**
> Pedido do Owner (antes de ADR-020): o carrinho da Nova Venda vivia só em `useState` e **se perdia**
> ao trocar de tela/recarregar. Agora vira **"Cesta"**: persiste, **segue o usuário entre
> dispositivos**, avisa ao fechar com itens, mostra **ícone no topo** (estilo e-commerce) e um **"i"**
> por linha abre as **infos do item**. **Decisão de escopo do Owner:** entre dispositivos ⇒
> persistência no **servidor** (não só localStorage). **ADR-021 escrito e aprovado ANTES de codar**
> (regras 1 e 4); **migration `0016_carts` aprovada ANTES de aplicar**. **Modelo (decisão central):**
> **1 linha por usuário, itens em JSONB** (`carts`: `userId` PK, `tenantId`, `items`, `updatedAt`) —
> a cesta é **rascunho de UI** (par/acréscimo/unidade fechada); preço/estoque são **revalidados no
> `POST /orders`**, então o servidor só sincroniza o snapshot. **Cost-zero:** 1 upsert (debounced
> ~1 s) por mudança. **RLS por USUÁRIO** (`auth.uid()`, não só tenant — dado pessoal). **API:**
> `GET/POST/DELETE /cart` (POST, não PUT — CORS libera GET/POST/PATCH/DELETE). **Front:**
> `CartProvider`+`useCart` no shell (PDV e ícone compartilham o estado), **espelho `localStorage`**
> por usuário (hidrata na hora + offline, ADR-012), **rede vence** por `updatedAt` (last-write-wins),
> `beforeunload` com itens, **limpa a cesta ao vender** (online+offline; comprovante usa snapshot
> próprio). `CartChip` no header, `CartItemInfo` modal (infos cruzando linha × catálogo, margem real
> ADR-016). **Sem mudança no motor de venda/estoque** (`POST /orders` intocado). Gates: core
> **189/189**, typecheck api/web ✅, build web (19 rotas, `/venda` 13.5 kB) ✅, dry-run API ✅;
> migration `0016` aplicada no Supabase, **sem drift**. ⚠️ **Deploy de API obrigatório** (rotas novas
> + migration) + **web**. **Falta:** deploy + E2E do Owner. Ver ADR-021 e "UI.PDV.Cesta" no registro.
> **Próximo passo (combinado):** **ADR-020 — retirada / entrega futura.**
>
> **Antes:** 2026-07-28 — **Venda a prazo / Contas a Receber (o "fiado") — ADR-019 — NO
> AR e VALIDADO pelo Owner (E2E + refinos + observações/perfil).** A 2ª metade do par que começou na
> CX.Movimentacao. **ADR-019 escrito e aprovado ANTES de codar** (regras 1 e 4). **Desenho central:** o
> fiado é uma **condição de pagamento** no PDV (reúso do pagamento dividido) — leva agora, paga depois;
> a mercadoria **sai na venda** (o fiado adia o **pagamento**, não a entrega ⇒ o motor de estoque
> ADR-001 **não muda**), só o dinheiro fica pendente numa **conta a receber**. **2 migrations aditivas:**
> `0014` (enum `ReceivableStatus` + tabelas `receivables` e `receivable_payments` + RLS) e `0015`
> (`receivables.notes`). **Core (+9 → 189/189):** `receivableBalance` (saldo devedor), `isValidReceipt`
> (não receber além do saldo), `applyReceivablePayment` (parcial→quitação), `creditSaleBalances`
> (entrada + a prazo = total). **Decisão de produto do Owner (regime de CAIXA no relatório):** o
> faturamento virou **"Recebido no período"** = dinheiro que entrou (pagamentos à vista **+**
> recebimentos de fiado, por `paidAt`) — o fiado conta **no dia do recebimento**, não no da venda, sem
> contar o mesmo real 2×; linha informativa **"Vendas a prazo geradas"** (o que foi vendido a prazo, não
> muda ao receber). **Recebimento em dinheiro = Suprimento no caixa** (reúso da CX.Movimentacao — a
> descrição do Suprimento já citava "pagamento atrasado recebido"). **PDV:** "A prazo" é **opt-in**
> (link "+ Venda a prazo", escondido até precisar — PDV limpo); `payableNow = total − a prazo` alimenta
> toda a mecânica de parcelas (com `credit = 0` é a venda de sempre, zero regressão); exige **cliente**;
> **online-only** nesta fatia. **Contas a Receber:** lista **paginada** (cursor keyset) + **busca** por
> cliente + filtro **Em aberto / Quitadas / Todas**; **detalhe da dívida** (itens + histórico de
> recebimentos com data/hora + **observação da dívida**). **Histórico de Vendas:** badge amarelo **"A
> prazo"** (+ "· quitada"). **Perfil do cliente** (clicar no nome em Clientes): dados editáveis +
> **observações** + **histórico** (contas a receber com selo **"Dívida ativa"** + vendas); novo `GET
> /customers/:id/history`; `Customer.notes` já existia (sem migration). **Reúso:** `ReceivableDetailModal`
> único nas duas telas. **🐞 Corrigido no refino:** o recebimento em dinheiro aparecia como "Estorno de
> Sangria" — o `relatedOrderId` que ele setava colidia com o marcador de estorno (`isReversalRow`);
> removido (o elo já existe via `ReceivablePayment.cashMovementId`). Gates a cada fatia: core 189/189,
> typecheck api/web, build web (19 rotas), dry-run api; sem drift. ⚠️ **Deploy de API obrigatório** (rotas
> novas + migrations). **NO AR (deploys finais):** API `47d0ed05` + web `a29d32e0` (fatias intermediárias:
> `df12f3c8`/`51391172`, `acbea5cf`/`a2003504`); smokes ✅. **E2E do Owner VALIDADO (2026-07-28)** nas três
> etapas ("validei tudo", "tudo ajustado e os fluxos do E2E validados", "tudo validado com sucesso").
> Commits `39122cd` (venda a prazo) + `4d586f4` (refinos) + `4175eb3` (observações/perfil). **Fatia
> ADR-019 CONCLUÍDA.** Ver "ADR-019" no registro. **Próximo passo combinado:** **ADR-020 — retirada /
> entrega futura** (eixo ortogonal: adia a **saída de estoque**, não o pagamento; toca a invariante
> ADR-001 ⇒ ADR próprio + aprovação de migration antes de codar).
>
> **Antes:** 2026-07-28 — **Estorno de lançamento manual (Suprimento/Sangria) — NO AR
> e VALIDADO pelo Owner.** Pergunta do Owner: faltava como **corrigir** um lançamento manual feito por
> engano. Decisão de produto (aprovada antes de codar): **não apagar a linha** — corrige-se com um
> **contra-lançamento** (estorno) de sinal oposto que zera o efeito no caixa, deixando o par *erro +
> correção* visível no extrato, **na mesma filosofia da devolução vs. apagar a venda** (o `CashMovement`
> nunca teve `deletedAt`, é append-only como `StockMovement`). **Sem migration:** reusa `CashMovement`
> (ADR-006) e o elo com o original vai em `relatedOrderId` (referência solta — ninguém faz join com
> `Order`, então desambiguar pelo `kind` é seguro). **Core:** `reversalKindFor(kind)` inverte
> SUPPLY↔WITHDRAWAL; como o sinal (`type`) é derivado do `kind`, o estorno fica com o sinal oposto e
> zera o caixa — +4 testes, incluindo a propriedade "original −X + estorno +X = 0" → **180/180**.
> **Shared:** `reverseCashMovementSchema` (motivo opcional) + `isReversalRow`/`hasBeenReversed`/
> `isReversibleRow` (fonte única das guardas p/ API e UI concordarem). **API:** `POST
> /cash-sessions/movement/:id/reverse` — guardas: só **caixa aberto** da loja (ADR-018; caixa fechado é
> imutável, ADR-004), só lançamento **manual**, **não estorna estorno**, **não estorna em dobro** (409);
> autoria (ADR-010). **Web (`/caixa`):** botão **"Estornar"** com confirmação inline no extrato (opt-in
> via `onReverse` — **Relatórios segue só-leitura**) + rótulo **"Estorno de Sangria/Suprimento"**. ⚠️
> **Deploy de API obrigatório** (rota nova); web também. Gates: core **180/180** ✅, typecheck web ✅,
> build web (18 rotas, `/caixa` 4.42 → 5.88 kB) ✅, dry-run API ✅. **NO AR:** API `03b15e1d` + web
> `ae955134`; smoke ✅ (health 200, `reverse` sem token 401, `/login` 200). **E2E do Owner VALIDADO
> (2026-07-28):** "testado e validado com sucesso". Commit `1c72d0d` (push feito pelo Owner). **Fatia
> CX.Estorno CONCLUÍDA.** Ver "CX.Estorno" no registro. **Próximo passo:** Fatia 2 — **ADR-019 (Venda a
> prazo / Contas a Receber, o "fiado")** — escrever o ADR e aprovar a migration ANTES de codar (regras 1 e 4).
>
> **Antes:** 2026-07-27 — **Movimentação de Caixa (Suprimento/Sangria) — entrada/saída
> manual de dinheiro no caixa — NO AR e VALIDADO pelo Owner.** Pedido do Owner: lançar dinheiro que
> entra/sai do caixa **fora de uma venda** (pagamento atrasado recebido, reforço de troco, retirada,
> despesa paga pela gaveta). **Fatia 1 de 2** — a 2ª é o "fiado", que virá como **Venda a prazo /
> Contas a Receber** (ADR-019 + migration, ainda por escrever/aprovar). **Reúso máximo, SEM
> migration:** a tabela `CashMovement` e os tipos `SUPPLY`/`WITHDRAWAL` **já existiam** (ADR-006), e a
> mini-DRE do caixa já tinha as linhas "+ Suprimentos" / "− saídas" **prontas** — foi só dar superfície
> ao que estava dormente; caixa, esperado e fechamento **não mudaram de lógica** (sangria/suprimento já
> entravam no `netCashMovements`). **Core:** `manualCashMovementType(kind)` — fonte ÚNICA do sinal
> (`SUPPLY`→INCOME, `WITHDRAWAL`→EXPENSE), +3 testes → **176/176**. **Shared:** `cashMovementSchema`
> (kind + valor > 0 + motivo obrigatório). **API:** `POST /cash-sessions/movement` — lança no caixa
> aberto da LOJA (ADR-018), autoria (ADR-010), bloqueia sem caixa aberto (404). **Web (`/caixa`):**
> botão **"Movimentar caixa"** + modal `CashMovementModal` (Suprimento verde / Sangria vermelho, valor
> com `MoneyInput`, motivo obrigatório); ao lançar, recarrega o caixa → a mini-DRE e o Esperado
> atualizam na hora. **+2 extensões no mesmo dia (que fecham a fatia):** (1) **Extrato do caixa
> aberto** — `GET /cash-sessions/movements` + seção colapsável "Movimentações do caixa" na tela do
> Caixa, listando cada lançamento (Suprimento/Sangria/Devolução/Despesa) com valor, motivo, autor e
> hora — detalha a linha agregada "saídas" da mini-DRE (antes só havia os TOTAIS). (2) **Histórico por
> fechamento** — o endpoint ganhou `?sessionId=` (checando o `tenantId`) e cada fechamento em
> **Relatórios** ganhou um "▸ movimentações" que expande o extrato daquele turno (lazy + cache), para
> auditar caixas já fechados (o extrato do Caixa é só do turno aberto, some ao fechar — correto).
> **DRY:** `CashMovementRow` + `CASH_MOVEMENT_KIND_LABELS` movidos p/ o `shared` e componente
> `CashMovementsList` reusado nas duas telas. ⚠️ **Deploy de API obrigatório** (endpoints novos); web
> também. Gates: core **176/176** ✅, typecheck API/web ✅, build web (18 rotas) ✅. **NO AR (3 deploys no
> dia):** lançamento API `a0c8a7a5` + web `2c23b403`; extrato API `59c2b538` + web `97c6fd96`; histórico
> API `61636021` + web `e522f97a`; smokes ✅ (health 200, `movement`/`movements` sem token 401, `/login`
> 200). **E2E do Owner VALIDADO (2026-07-27):** os três — "testado e aprovado" / "validado com sucesso".
> Commits `a35a288` (lançamento) + `f9cff3a` (extrato) + `86bda6a` (histórico). **Fatia CX.Movimentacao
> CONCLUÍDA** (lançamento + extrato do caixa aberto + histórico por fechamento). Ver "CX.Movimentacao" no
> registro. **Próximo passo:** Fatia 2 — escrever o **ADR-019 (Venda a prazo / Contas a Receber)** e
> aprovar a migration ANTES de codar (regra 1 e 4).
>
> **Antes:** 2026-07-27 — **Busca no servidor (Clientes/Produtos) + revisão dos tetos
> de Relatórios — NO AR e VALIDADO pelo Owner.** Continuação do combate às "telas que abrem com
> muita info": onde a base cresce e a pessoa **procura** em vez de rolar, o remédio é **busca no
> servidor (`?q=`) + paginação** em vez de baixar tudo. As três telas numa fatia só. **Sem migration.**
> **Clientes:** `GET /customers` trocou "lista tudo" por `?q=` (nome/e-mail; CPF/CNPJ e telefone por
> dígitos) + keyset (`{rows,nextCursor}`); tela com busca (debounce) + "Mostrar mais" (era o único
> consumidor). **Produtos:** `GET /products` (array cru) **intocado** (PDV/Estoque/offline dependem dele);
> nova rota `GET /products/search` (keyset, `q` = nome/popular/fabricante/SKU) alimenta a **tabela**. O
> catálogo completo (scan + dropdown de par ADR-015 + par reverso do `ProductDetail`) virou **lazy**
> (`ensureCatalog`, uma vez sob demanda) — a tela **abre leve** e o scan decide sobre o **catálogo
> inteiro**, não a página visível. **Relatórios:** `/sales` é agregação (sem teto); `/cash-sessions`
> tinha `take:200`+`1000` mas é sempre period-bound (default 30d, ~1 fechamento/dia) — elevados p/
> `2000`/`5000` como margem (paginar seria overkill). Gates: typecheck API/web ✅, build web (18 rotas,
> `/customers` 2.09 kB, `/products` 11 kB) ✅, build API dry-run ✅. ⚠️ **Deploy de API obrigatório**
> (formato de `/customers` mudou array → `{rows}`), API+web subiram juntos. **NO AR:** API `13ab6452` +
> web `cd12db31`; smoke ✅ (health 200, `/products/search` e `/customers` sem token 401, `/login` 200).
> **E2E do Owner VALIDADO (2026-07-27):** "tudo certo, validado". Commit `8d9cbd8`. **Fatia
> UI.Busca.Servidor CONCLUÍDA.** Ver "UI.Busca.Servidor" no registro.
>
> **Antes:** 2026-07-27 — **Histórico de Vendas: ordenação (maior/menor venda, data
> ↑/↓) + botão "Voltar ao topo" — NO AR e VALIDADO pelo Owner.**
> Pedido do Owner. **Ponto da fatia:** o Histórico já pagina por **cursor keyset** — então ordenar por
> maior/menor venda **no cliente** ordenaria só as páginas já baixadas ("a maior entre as 20
> carregadas"), não a maior do período (a mesma **visão parcial enganosa** do `take:100`). Por isso a
> ordenação foi feita **no servidor**, estendendo o keyset: `GET /orders?scope=all` ganhou `sort`
> (`recent` default / `oldest` / `highest` / `lowest`), o cursor passou a codificar o **valor do campo
> ordenado** (`<ISO|total>|<id>`) e o `orderBy` segue o par (campo, direção) com `id` desempatando na
> mesma direção. **Sem migration.** A resposta `{ rows, nextCursor }` **não mudou** (a API antiga só
> **ignora** `sort` — aditivo), mas o recurso **só funciona após o deploy da API**. **Web (`/vendas`):**
> seletor "Ordenar por" (troca recarrega da 1ª página, mantém o período) + botão flutuante **"Voltar ao
> topo"** que rola o `<main>` do shell (`overflow-y-auto`, não a window) e aparece após rolar um pouco.
> Gates: typecheck API ✅, typecheck web ✅, build web (18 rotas, `/vendas` 4.5 → 5.12 kB) ✅. ⚠️ **Deploy
> de API obrigatório** para o `sort` valer (a API antiga só ignorava o parâmetro); **web** também.
> **NO AR:** API `ea214bbd` + web `6c6b553e`; smoke ✅ (health 200, `sort=highest` sem token 401,
> `/login` 200). **E2E do Owner VALIDADO (2026-07-27):** "validado com sucesso". Commit `04c0895`.
> **Fatia UI.Vendas.Ordenacao CONCLUÍDA.** Ver "UI.Vendas.Ordenacao" no registro. **Próximo passo
> natural (mesmo padrão):** busca no servidor para os cadastros grandes (Produtos/Clientes) e revisar
> os tetos dos Relatórios.
>
> **Antes:** 2026-07-25 — **Histórico de Vendas paginado (cursor keyset) + filtro de
> período — NO AR e VALIDADO pelo Owner ("tudo validado com sucesso").** Ponto do Owner: telas que abrem
> com muita informação carregada ficam lentas conforme a base cresce — o **Histórico de Vendas** já
> pesava. Diagnóstico: `GET /orders?scope=all` trazia as **100 vendas mais recentes com todos os itens
> e pagamentos de uma vez** e a tela montava tudo junto; passando de 100, as antigas **sumiam sem
> aviso** (mesma classe do `take:100`). **Sem migration, sem tocar no schema.** **API:** `scope=all`
> agora **pagina por cursor keyset** (não `OFFSET`, que degrada com a base) em `createdAt desc, id
> desc` — aceita `limit` (default 20, teto 50), `cursor` opaco e `from`/`to` (AAAA-MM-DD, fuso da loja
> UTC-3, mesmo critério do relatório) e responde `{ rows, nextCursor }`; `take: limit+1` sinaliza a
> próxima página. O scope padrão (caixa aberto) segue array cru (contrato antigo preservado). **Web
> (`/vendas`):** filtro de período (atalhos **Hoje / 7d / 30d** + **De/Até** + Aplicar/Limpar) e botão
> **"Mostrar mais"** que anexa a próxima página (some no fim); cancelar/devolver recarrega da 1ª
> página. Gates: typecheck API ✅, typecheck web ✅, build web (18 rotas, `/vendas` 3.34 → 4.5 kB) ✅.
> ⚠️ **Deploy da API foi obrigatório** mesmo sem migration (o formato de `scope=all` mudou: array →
> `{ rows, nextCursor }`), então API e web subiram juntos. **Ajuste de UX no mesmo dia** (feedback do
> Owner): o atalho de período selecionado (Hoje/7d/30d) agora fica **preto** e volta a branco no Limpar
> ou ao editar as datas manualmente. **NO AR:** API `609bd385` + web `d23c8e7f` → `7451757d`; smoke ✅
> (health 200, `scope=all` sem token 401, `/login` 200). **E2E do Owner VALIDADO (2026-07-25):** "tudo
> validado com sucesso". Commits `d1cc98f` (paginação) + `03d9479` (destaque). **Fatia
> UI.Vendas.Paginacao CONCLUÍDA.** Ver "UI.Vendas.Paginacao" no registro. **Próximo passo natural
> (mesmo padrão):** busca no servidor para os cadastros grandes (Produtos/Clientes) e revisar os tetos
> dos Relatórios.
>
> **Antes:** 2026-07-25 — **PDV redesenhado em duas colunas + botão "Limpar carrinho"
> — NO AR e VALIDADO pelo Owner.** Duas fatias de UX do Owner no PDV, **100% de apresentação (sem
> migration, sem API, sem core; nenhuma lógica de venda tocada)**. **(1) Layout em duas colunas:** a
> tela saiu da coluna única estreita (`max-w-3xl` → `max-w-6xl`) para um PDV de duas colunas no
> desktop — **carrinho protagonista à esquerda** (carrinho → pagamento → total/desconto/ações) e
> **busca à direita**, fixa ao rolar (`sticky`), com os **resultados aparecendo só ao digitar** (sem
> busca a área fica limpa com uma dica; decisão do Owner: "área limpa + dica"). Posicionamento
> explícito de grid (`col-start`/`row-start`) reposiciona os blocos **sem reordenar o DOM** — nenhuma
> lógica de item/carrinho/pagamento reescrita; no celular/tablet volta a empilhar (busca, carrinho,
> pagamento, total). **(2) Limpar carrinho:** cabeçalho no cartão do carrinho com botão **"Limpar
> carrinho"** (só com itens) + **confirmação inline** ("Limpar tudo? Sim / Cancelar") para não apagar
> um carrinho grande por engano; só limpa a tela (nada gravado). Gates: typecheck web ✅, build web (18
> rotas, `/venda` 13.7 kB) ✅. **NO AR:** commits `0dff33a` (layout) + `4c2d2ca` (limpar); web
> `2ec4202c` → `3d834200`; smoke `/login` 200 ✅. **E2E do Owner VALIDADO (2026-07-25)** nas duas
> fatias ("tudo certo, testado e aprovado"). **Fatia UI.PDV.Layout CONCLUÍDA.** Ver "UI.PDV.Layout" no
> registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade (par natural: botão de **Sangria/Suprimento** no
> caixa), ou endurecimento.
>
> **Antes:** 2026-07-25 — **PDV: pagamento dividido (mais de uma forma na mesma
> venda) — NO AR e VALIDADO pelo Owner (E2E 7/7).** Pedido do Owner:
> uma venda pode ter **mais de uma forma de pagamento** (parte cartão, parte dinheiro…). **Achado que
> barateou a entrega:** o backend **já era multi-parcela** desde a Fase 2 — `Payment` é tabela
> 1-para-muitos com `Order`, `createSaleSchema.payments` já é `z.array(...).min(1)` e `POST /orders` já
> cria N pagamentos, soma tudo e valida `pago ≥ total`. Fatia **100% de UI + 1 função pura: sem
> migration, sem deploy de API, sem tocar no schema compartilhado.** **Decisão de produto (opção 1,
> validada com o Owner após comparar com POS profissionais; adenda no ADR-016):** com acréscimo por
> forma de pagamento no carrinho, a **1ª forma** é a **principal** e precifica tudo ("condição de
> pagamento"); modelo "item → forma" descartado. **Persistência preserva a invariante do Caixa:** as
> parcelas gravadas **somam exatamente o total** (cartão/PIX como digitado, o **dinheiro fecha o
> resto**); o troco continua **fora do caixa** (o Caixa soma `Payment.amount` de `CASH` e precisa do
> dinheiro líquido). Nova função pura `paymentStatus` (troco só do dinheiro, limitado ao recebido; em
> centavos). UI: lista de parcelas (adicionar/remover, valor com `MoneyInput`, placeholder = "resto"),
> painel **Falta / Troco / Pago** ao vivo, **Concluir** só com `pago ≥ total`; comprovante imprime
> **uma linha por forma** + troco; reimpressão passa **todas** as formas (antes só a 1ª). Gates: core
> **173/173** (+9) ✅, typecheck web+API ✅, build web (18 rotas, `/venda` 13.4 kB) ✅. **NO AR:** commit
> `4c0cd19`; web `7e2e2873`; smoke `/login` 200 ✅. **E2E do Owner VALIDADO 7/7 (2026-07-25):** venda
> normal (1 forma) intacta, dividido cartão+dinheiro, troco no dividido, caixa bate (troco fora do
> caixa), trava de cartão/PIX acima do total, acréscimo pela 1ª forma, reimpressão com todas as formas.
> **Fatia UI.PDV.SplitPayment CONCLUÍDA.** Ver "UI.PDV.SplitPayment" no registro. **Próximo passo:**
> direções abertas — go-live (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova
> funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-25 — **Caixa mais claro: contador de cédulas/moedas +
> mini-DRE entradas × saídas (CX.Contador + CX.DRE) — CÓDIGO PRONTO, aguardando deploy + E2E do
> Owner.** Duas ideias do Owner para o Caixa, na mesma sessão. **(1) Contador de cédulas e moedas:** botão
> **"Usar contador"** abre um painel para digitar as **quantidades** de cada moeda (0,05 · 0,10 · 0,25 ·
> 0,50 · 1,00) e cédula (2 · 5 · 10 · 20 · 50 · 100 · 200) do Real, soma ao vivo e joga o **total no
> campo** — na **abertura** e no **fechamento** (contar a gaveta). **100% de UI, sem migration, sem API.**
> Função pura `sumCashCount` (regra 2): soma **em centavos** (sem erro de ponto flutuante — `0,05 × 3 =
> 0,15`); quantidade inválida conta 0; constantes `BRL_COIN_VALUES`/`BRL_BILL_VALUES` como fonte única.
> Componente `apps/web/components/CashCounter.tsx` (modal, Esc/clique-fora fecham, subtotal por linha,
> "Limpar"/"Usar total") plugado nos dois campos via `MoneyInput`. **(2) Mini-DRE do caixa:** o cartão do
> caixa aberto mostrava só o que ENTROU (as saídas ficavam numa linha líquida, escondida quando zero).
> Agora vira um **extrato**: `Valor de abertura` · `+ Vendas em dinheiro` · `+ Suprimentos` (se houver) ·
> `− Devoluções / saídas` (se houver) · `= Esperado no caixa`, com entradas em verde e saídas em vermelho.
> Nova função pura `grossCashMovements` (Σ INCOME e Σ EXPENSE brutos, ≥ 0) ao lado de `netCashMovements`
> (o líquido segue mandando na conta do esperado); `/cash-sessions/current` passa a devolver
> `cashMovementsIn`/`cashMovementsOut`. **Sem migration.** ⚠️ **A DRE exige deploy da API** (o front
> degrada com segurança sem ela: mostra abertura + vendas + esperado e omite as linhas novas). Gates: core
> **164/164** Vitest (+8: 5 do contador, 3 da DRE) ✅, typecheck API ✅, typecheck web ✅, build web (18
> rotas, `/caixa` 4.42 kB) ✅. **NO AR:** commit `6508ab4`; API `9063ed0e` + web `c71d1af9`; smoke ✅
> (health 200, `/cash-sessions/current` sem token 401, `/login` 200). **Correções pós-teste do Owner
> (CX.Fix, web `c795968e`):** (1) contador **perdia o foco** no 1º dígito → `CounterRow` extraído p/
> componente de módulo (o input não remonta mais); (3) **fechou mas o visual seguia "aberto"** → fechamento
> limpa a sessão localmente (otimista), sem depender do `GET /current` que podia vir de cache. (2) troco
> não é bug — o caixa grava o **total da venda** (líquido), o "recebido"/troco não são persistidos. **Falta:**
> re-teste do Owner. Ver "CX.Contador", "CX.DRE" e "CX.Fix" no registro. **Próximo passo (par natural
> futuro):** botão de **Sangria /
> Suprimento** (retirar/repor dinheiro no meio do dia) — a DRE já tem as linhas prontas para ele.
> **Direções abertas:** go-live (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova
> funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-24 — **UX da Nova Venda (marca na busca + edição de quantidade no
> carrinho) — NO AR e VALIDADO pelo Owner.** Duas melhorias do Owner no PDV, **100% de UI (sem migration,
> sem tocar na API)**: (1) a linha de busca do produto mostra `popular · marca · SKU` — as ramificações de
> rolo/barra e embalagem/par já traziam as três partes; só a **comum** (unidade única) estava sem a **marca**,
> agora corrigida; (2) **editar a quantidade da linha já no carrinho** — mantida a forma atual (campo
> Quantidade antes de adicionar) **e** somada edição inline na coluna Qtd com **− / +** (passo 0,5 no metro,
> 1 nos demais) + digitação direta. `changeLineQty` reusa a **mesma trava de estoque** do `addToCart`
> (`baseUsedByProduct`; par checa os dois lados; metro em múltiplos de 0,5); qtd ≤ 0 remove a linha; estouro
> de estoque avisa e não altera. Como o carrinho é a única fonte de totais/comprovante/payload (invariante do
> PA.1), a edição reprecifica tudo junto. Gates: typecheck web ✅, build web (18 rotas, `/venda` 12.5 kB) ✅.
> **NO AR:** web `2903e0d3`; smoke `/login` 200 ✅. **E2E do Owner VALIDADO (2026-07-24):** "está tudo certo"
> (marca na busca + ajuste de quantidade no carrinho com − / + e digitação, trava de estoque respeitada).
> **Fatia UI.PDV.UX CONCLUÍDA.** Ver "UI.PDV.UX" no registro. **Próximo passo:** direções abertas — go-live
> (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-24 — **Campos monetários formatam em BRL ao sair do campo
> (`MoneyInput`) — NO AR e VALIDADO pelo Owner** (inclui o fix do campo "Valor recebido", que passara
> despercebido e foi corrigido no mesmo dia; web `1547a2cc`). Pedido do Owner: em todo campo de dinheiro (Custo,
> valor em real…), ao terminar de digitar e mudar de campo, exibir sempre o valor **formatado em moeda**
> ("R$ 0,00", com casas decimais), deixando claro que é monetário — na tela de Produtos **e em todas as
> outras**. **100% de UI, sem migration e sem tocar na API.** Novo componente reutilizável
> `apps/web/components/MoneyInput.tsx`: enquanto digita aceita vírgula OU ponto; ao **blur** formata em BRL;
> guarda o valor **canônico** (ponto decimal) igual ao antigo `type="number"`, então venda/caixa/margem/
> estoque (`Number(value)`) **não mudam**. Heurística do separador validada por script (só é decimal com
> 1–2 dígitos depois; senão é milhar → "1.000" = R$ 1.000,00, não R$ 1,00). Aplicado nos campos monetários
> de **Produtos** (cadastro + ver/editar: Custo, Preço, por metro, embalagem, par, acréscimos débito/
> crédito), **Nova Venda** (Desconto), **Caixa** (abertura + fechamento) e **Estoque** (custo da entrada);
> percentuais (taxa da maquininha) e quantidades ficaram como estavam. Bônus: o "Custo/Preço da barra" fixo
> na edição do produto também passou a respeitar a unidade ("do rolo"/"da barra"). Gates: typecheck web ✅,
> build web (18 rotas) ✅, `parseMoneyInput` 15/15 (`node -e`) ✅. **NO AR:** web `e527d848`; smoke `/login`
> 200 ✅. **Falta:** E2E do Owner. Ver "UI.MoneyInput" no registro. **Próximo passo:** direções abertas —
> go-live (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-24 — **UX da tela de Produtos (rótulos acima dos campos + preço da
> unidade fechada + listagem mais larga) — NO AR e VALIDADO pelo Owner.** Três pedidos do Owner no
> cadastro de Produtos, todos **100% de UI (sem migration, sem tocar na API)**: (1) o nome de cada campo
> ficava só no **placeholder** e sumia ao preencher → novo helper `Field` põe o **rótulo acima** do controle
> (Nome, Nome popular, Fabricante, SKU, Custo, Preço, Unidade, Peso, Estoque mín., Estoque inicial,
> Descrição; os três blocos pontilhados ficaram como estavam, a pedido, pois já têm legenda própria);
> (2) ao escolher **Rolo** o preço mostrava "Preço da **Barra**" → agora reflete a unidade com o artigo
> certo (`unitArticle`): "Preço do rolo" / "Preço da barra"; (3) a **listagem** usava pouca largura e os
> botões finais ficavam cortados → container `max-w-4xl` → `max-w-6xl` (a tabela de 9 colunas respira sem
> arrastar; `overflow-x-auto` mantido p/ telas estreitas). Gates: typecheck web ✅, build web (18 rotas,
> `/products` 10.3 kB) ✅. **NO AR:** web `55660117`; smoke `/login` 200 ✅. **E2E do Owner VALIDADO
> (2026-07-24):** "tudo funcionou corretamente" (rótulos acima dos campos, "Preço do rolo" ao selecionar
> Rolo, e a listagem mais larga sem corte lateral). **Fatia UI.Produtos.UX CONCLUÍDA.** Ver "UI.Produtos.UX"
> no registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-24 — **UX da tela de Estoque (seções colapsáveis + busca/ordenação +
> detalhe do produto) — NO AR e VALIDADO pelo Owner.** Pedido do Owner, três pontos: (1) o painel
> **"Reposição de estoque"** cresce e atrapalha → agora é **colapsável** (cabeçalho vira botão com seta;
> estado lembrado em `localStorage`, badge de contagem visível mesmo minimizado); (2) achar produto na
> tabela **"Estoque atual"** exigia rolar a página → **busca** (nome/apelido/fabricante/SKU, via
> `productMatchesQuery` do core), filtro **"Só baixo"** e **ordenação por qualquer coluna** (clique no
> cabeçalho, ↑/↓); (3) as **justificativas** de Entrada/Ajuste **não apareciam em lugar nenhum** e a lista
> global crescia → clicar no produto abre um **modal de detalhe** (`components/StockDetail.tsx`) com as
> **características** do item + o **histórico daquele produto**, com filtros próprios (Tipo/Motivo/período),
> **custo unitário e motivo por linha** e paginação "Mostrar mais". **Extensão (mesmo dia, pedido do Owner
> após validar o 1º lote):** o mesmo botão de minimizar foi aplicado a **"Estoque atual"** e
> **"Movimentações recentes"** — as **três seções** agora colapsam (hook `usePersistedOpen`, cada uma
> lembra seu estado), deixando visível só o que o operador quer no momento. **Mudança 100% de UI: sem
> migration, sem tocar na API** (`GET /products` já traz todos os campos; `/stock/movements?productId=` já
> traz as justificativas). Gates: typecheck web ✅, build web (18 rotas, `/estoque` 7.29 kB) ✅. **E2E do
> Owner VALIDADO nos dois lotes** (1º lote "está funcionando perfeitamente"; extensão do colapso das três
> seções "publiquei e testei, funcionou corretamente"). **Fatia UI.Estoque.UX CONCLUÍDA.** Ver
> "UI.Estoque.UX" no registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-23 — **ADR-018 (Caixa compartilhado por loja) — NO AR e VALIDADO pelo
> Owner.** Bug grave reportado pelo Owner: ele abriu o caixa com o próprio usuário
> (`douglasns.work`) e outra operadora da **mesma loja** (`amanda.ns92`), ao logar, via **"caixa fechado"**.
> **Causa raiz:** o caixa nascera **por operador** — toda resolução de "há caixa aberto?" filtrava por
> `{tenantId, userId, closedAt:null}` (em `cashSessions.ts` e `orders.ts`), então cada usuário só via o
> próprio caixa. Nunca virou ADR. Não bate com a loja real (um caixa físico, vários operadores).
> **Decisão do Owner (ADR-018, aprovada ANTES de codar — regra 4):** caixa **por LOJA** — quem abre, abre
> para todos; **qualquer operador fecha**. **Sem migration** (`CashSession.userId` vira "quem abriu"; sem
> constraint única por usuário; RLS por `tenantId` intacto). Autoria (ADR-010) preservada. Mudança
> **puramente de query** (remoção do filtro `userId` em 8 pontos). Relatórios **já** eram por loja — ficaram
> coerentes de graça. Typecheck API ✅; front sem mudança (só exibe o retorno de `/current`). **NO AR:** API
> `3bd5cade`; smoke 200 + 401 ✅. **E2E do Owner VALIDADO** (Douglas abre → Amanda vê aberto → vende no
> mesmo caixa → fecha somando os dois; 2º caixa recusado com 409) — **sem nenhuma ação manual de dados**, o
> caixa já aberto passou a ser enxergado por todos. Commit `cbccb3f`. **Fatia CONCLUÍDA.** Ver ADR-018 e
> "ADR-018" no registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-23 — **ADR-017 (Barra/Rolo como unidade fechada principal + venda por
> metro) — NO AR e VALIDADO pelo Owner (E2E 7/7).** Pedido do Owner: cadastrar pela **unidade fechada** (Barra,
> Rolo) com o **preço fechado**; a **venda por metro** vira a opção fracionada; nova unidade **Barra**.
> **ADR-017 escrito e aprovado ANTES de codar** (regra 4). Decisões do Owner: contar em barra, só `BARRA` no
> enum, venda por metro em **múltiplos de 0,5 m**, entrada **em barras**, saldo **"X barras + Y m"**, preço
> por metro **opcional** (vazio ⇒ só inteiro). **Sem coluna nova:** `unit=BARRA`, `salePrice/costPrice` = da
> barra, `conversionFactor` = tamanho (m), `altSalePrice` = preço/metro (nullable). **Estoque em METROS**
> (desacoplado do `unit`) por **precisão** — o motor é o EF-3 (ADR-013) com **papéis invertidos** (barra
> baixa `qtd × tamanho`; metro baixa `qtd`); cancelamento/devolução usam `baseQuantity`, sem mudança.
> **Migration `0013`** (`ALTER TYPE UnitType ADD VALUE 'BARRA'`) aplicada. Core **+17 → 156/156**
> (`isValidMeterStep`, `metersFromWhole`, `splitWholeAndRemainder`, `isClosedPrimary`, `sellsByMeter`,
> `resolveClosedSale`, `closedStockMeters`). Web: PDV (barra inteira × por metro 0,5), cadastro invertido,
> Estoque ("barras + sobra" + entrada em barras), ProductDetail invertido. Gates: typecheck api+web ✅, build
> web ✅. **NO AR:** API `5c426eb7` + web `0041891a`; smoke 200/200. **E2E do Owner VALIDADO 7/7
> (2026-07-23)** — fatia CONCLUÍDA. Ver ADR-017 e "ADR-017" no registro.
>
> **Antes:** 2026-07-22 — **Fix de truncamento silencioso das listas de cadastro (take:100)
> — NO AR e VALIDADO pelo usuário** (após publicar, os produtos além dos 100 voltaram a aparecer). Bug grave reportado: ao cadastrar vários produtos, um ("Vass…")
> **sumiu** de Produtos, Estoque e Venda após "Adicionar", mas **existia no banco** (o `POST` retornou 201).
> **Causa raiz:** `GET /products` fazia `findMany({ orderBy: { name:'asc' }, take: 100 })` — passando de
> **100 produtos**, a API devolvia só os 100 primeiros **em ordem alfabética**; nomes tardios (V…) caíam
> fora e sumiam das três telas (todas leem `GET /products`), e a busca client-side também não achava. **Não
> houve perda de dado — só invisibilidade.** **Achado sistêmico:** o mesmo `take:100` estava em Clientes,
> Fornecedores e Categorias. **Correção (escolha do usuário "cadastros todos"; sem migration):** removido o
> teto de `GET /products`, `/customers`, `/suppliers`, `/categories` — o escopo já é o do tenant (RLS), listar
> tudo é o correto (se um dia um catálogo ficar enorme, o caminho é busca no servidor `?q=` + paginação, não
> corte cego). Typecheck API ✅; **NO AR:** API `687c3f28`; smoke health 200 + 401 sem token ✅. **Falta:** E2E
> do usuário (hard-refresh e conferir "Vass…" de volta). **Limitação conhecida aberta:** Histórico de
> Vendas/Relatórios ainda têm teto (crescem sem limite → pedem paginação de verdade, tarefa própria). Ver
> "API.Listas.Take100" no registro.
>
> **Antes:** 2026-07-22 — **Fix de disponibilidade na tela de Produtos — NO AR e VALIDADO
> pelo usuário.** Bug reportado: **Ver / editar** produto caía na fronteira de erro ("Algo deu errado ao
> abrir a tela") e reload não resolvia — só o painel `ProductDetail` quebrava, a lista carregava normal.
> **Causa raiz (descasamento de tipo da fatia FP/ADR-016):** `cardFee*Percent` são `Decimal` no Prisma e
> `GET /tenant` os devolve **crus** → em JSON viram **string** (`"3.50"`); no core `cardFeePercentFor` fazia
> `raw.toFixed(2)`, que só existe em `number` → `TypeError` **no render**. A Nova Venda já convertia com
> `Number(...)`; a tela de Produtos passava o valor cru ao painel. Só disparava **com taxa de maquininha
> cadastrada** (com `null` retornava 0 antes do `.toFixed`), por isso surgiu depois que o Owner configurou a
> taxa e o reload não ajudava. **Correção (só front, sem migration):** (1) `products/page.tsx` converte os
> fees com `Number(...)` ao ler `/tenant`, como a Nova Venda; (2) blindagem no core — `cardFeePercentFor` e
> `surchargePerBaseUnit` coagem com `Number()` antes do `.toFixed` (+2 testes → **139/139**). Gates:
> typecheck web+API ✅, build 18 rotas ✅. **NO AR:** web `4bd4e540`; smoke `/login` 200 ✅. **E2E do usuário
> validado** (painel abre normal com taxa cadastrada). Commit `939d919`. Ver "UI.Produtos.FP-fix" no
> registro. **Próximo passo:** direções abertas — E2E do Owner da fatia FP (pendente), go-live (Supabase
> Pro/CORS/SMTP), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-21 — **CD (Copiar produto + Excluir/Desativar) — NO AR e VALIDADO
> pelo usuário.** E2E 7/7, incluindo o **bônus** do usuário: uma venda antiga com o item **excluído**
> que fazia par **permaneceu no histórico** — o soft-delete tira do catálogo mas preserva a integridade
> referencial do `OrderItem`. Pedido do usuário na tela de Produtos: (1) **Copiar** um produto como base de um
> novo cadastro e (2) **remover** produto — as duas formas: **Excluir** (definitivo, "uma vez excluído
> já era") e **Desativar/Reativar** (reversível, para tirar de circulação e poder voltar). **Surpresa
> boa: zero migration** — a coluna `isActive` já existia no `0_init` (dormente) e o `DELETE /products`
> (soft-delete ADR-004) já existia. **shared:** `updateProductSchema` aceita `isActive`. **API:** `GET
> /products` traz só **ativos por padrão** (PDV/Estoque ficam corretos sem tocar em nada) e aceita
> `?includeInactive=true` (só a tela de gestão usa); `DELETE` agora, numa transação, **limpa o vínculo
> de par reverso** (ADR-015 — o outro lado não fica apontando p/ um produto que sumiu; no soft-delete o
> `onDelete:SetNull` do FK não dispara); `PATCH` liga/desliga `isActive`. **Web Produtos:** botão
> **Copiar** na linha (preenche o form, mas zera SKU/estoque inicial/par — únicos/deliberados), lista
> com inativos acinzentados + selo "Inativo". **Web ProductDetail:** **Excluir** (confirmação inline +
> aviso quando desfaz um par) e **Desativar/Reativar** no rodapé. ⚠️ Deploy da **API obrigatório**
> mesmo sem migration (Zod antigo descartaria `isActive` — mesmo tropeço do `popularName`/`manufacturer`).
> Gates: typecheck API ✅, core **137/137** ✅, build web (18 rotas) ✅. **NO AR:** API `79b94595` + web
> `922f0c5f`; smoke ✅ (health, 401 sem token, web 200). **E2E do usuário validado 7/7.** Commit
> `1f3b52c`. Ver "UI.Produtos.CD" no registro. **Próximo passo:** direções abertas — E2E do Owner da
> fatia FP (pendente), go-live (Supabase Pro/CORS/SMTP), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-21 — **Fix de UX no Relatórios — NO AR e VALIDADO.** O popover do
> turno (ADR-010) na célula "Fechado em" era posicionado sempre **abaixo** do gatilho e **antes de
> renderizar**, sem conhecer a própria altura — com a linha perto do rodapé (ex.: filtro com 1
> fechamento) estourava a tela e era cortado. Correção **100% client-side** (`apps/web/app/(app)/
> relatorios/page.tsx`, sem migration nem deploy de API): monta invisível e posiciona num
> `useLayoutEffect` medindo `offsetHeight`, **vira para cima** quando não cabe abaixo e **clampa na
> viewport** na vertical. Typecheck + build (18 rotas) ✅; web `278bdd64`; smoke ✅; **E2E do usuário
> validado** ("agora está mostrando sem cortar"). Commit `89296b9`. Ver "UI.Relatorios.Popover" no
> registro.
>
> **Antes:** 2026-07-20 — **FP (preço e margem por forma de pagamento, ADR-016) — NO AR,
> aguardando E2E do Owner.** Pedido do Owner: "mais campos de Custo — Custo Débito e Custo Crédito —
> e o PDV lê a forma de pagamento e insere o valor correspondente". No refinamento o pedido se
> **separou em dois mecanismos independentes**, e a distinção é a decisão de produto da fatia:
> **(1) taxa da maquininha** (%, por loja, em Configurações) que **só informa a margem real** e
> **(2) acréscimo em R$ por produto** (opt-in, no cadastro) que é o único que **muda o preço
> cobrado**. O Owner recusou explicitamente derivar o preço da taxa: *"o valor acrescentado não pode
> ser automático — só os produtos que receberem valor no cadastro"*. **ADR-016 escrito e aprovado
> ANTES de codar** (regra 4), com 4 decisões: acréscimo (não custo absoluto nem preço final — travado
> com exemplo numérico), embutido no preço do item no comprovante, só débito/crédito (sem
> parcelamento), e os dois mecanismos separados. **Desenho central: o acréscimo entra no `unitPrice`**,
> como o par e a embalagem já faziam — por isso **estoque, cancelamento, devolução, caixa, relatórios
> e o protocolo de sync não mudaram uma linha**. No PDV o carrinho guarda o **preço base** e o
> efetivo é **derivado** (`pricedCart`) da forma de pagamento, que é escolhida *depois* de montar o
> carrinho: trocar Dinheiro → Crédito reprecifica tela, totais, comprovante e payload de uma vez —
> mantendo a invariante do PA.1 (o front soma exatamente o que envia). **Migration `0012` APLICADA**
> (aprovada): `products.surchargeDebit/surchargeCredit` + `tenants.cardFeeDebitPercent/CreditPercent`
> — 4 colunas nullable, RLS intacta, sem drift. Core **+29 → 137/137** (`surchargePerBaseUnit`,
> `resolveSurcharge` — proporcional na embalagem —, `priceForPaymentMethod`,
> `pairPriceForPaymentMethod` — acréscimo **antes** do rateio, com teste de propriedade de 1 a 100
> pares —, `cardFeePercentFor`, `netMarginPercent`). **🔎 Achado dos testes:** o acréscimo repõe o
> **lucro em R$**, mas **não** a **margem %** (o denominador cresce junto): no caso do Owner, +R$1,50
> leva o lucro de R$12,00 → R$12,15, mas a margem de 32,43% → 31,56%; repor a margem % exigiria
> +R$2,02. Documentado no ADR — é para essa escolha que a margem real na tela existe. Web: campos no
> cadastro/edição de produto (com prévia "no crédito sai R$…"), taxas em Configurações, acréscimo
> visível na linha do carrinho + aviso do total, margem real no tooltip do PDV e no painel do produto,
> espelho offline atualizado. ⚠️ Deploy da API obrigatório mesmo sem rota nova (Zod/Prisma antigos
> descartariam os campos — mesmo tropeço do `popularName` e do `manufacturer`). **NO AR:** API
> `060acc7e` + web `58fbe607`; smoke ✅. **Falta:** E2E do Owner.
>
> **Antes:** 2026-07-20 — **PA (produto agregado: venda em par, ADR-015) — NO AR e
> VALIDADO pelo usuário; ADR-015 fechado.** Pedido do Owner: parafuso R$0,60 + bucha R$0,20 são produtos independentes, mas o
> **par sai R$0,70**; no PDV escolhe-se avulso ou par. **ADR-015 escrito e aprovado ANTES de codar**
> (regra 4), com 3 decisões do Owner: par de 2 itens (colunas, não tabela de combo), par vale **dos dois
> lados** (cadastra uma vez só), e comprovante em **linha única** (*"comprado separado o valor muda —
> mostrar uma linha evita questionamento"*). **Desenho central: o par grava DOIS `OrderItem` com preço
> rateado** (0,5250 + 0,1750), não uma linha "kit" — por isso **estoque, cancelamento e devolução não
> mudaram uma linha** (os três percorrem os itens) e os relatórios por produto seguem honestos.
> **Migration `0011` APLICADA** (aprovada): `products.pairedProductId` (FK auto-relação) +
> `products.pairPrice` + `order_items.pairGroup` + índice — aditiva, RLS intacta, sem drift. Core
> **+21 → 103/103** (`splitPairPrice` — a soma é **sempre exatamente** o preço do par, testado até com
> proporção dízima —, `hasPair`, `pairAvailableQty`, `groupPairedItems`). API: `validatePair`
> (auto-referência, agregado inexistente, par invertido duplicado). Web: par no cadastro/edição, botão
> **"+ par c/ …"** no PDV com trava dos **dois** estoques, carrinho/comprovante/histórico/reimpressão em
> linha única, par vendável offline. **NO AR:** API `95498aff` + web `bf20b770`; smoke ✅.
> **🐞 PA.1 corrigido (mesmo dia, achado no E2E do usuário):** 5 pares de R$0,70 davam "Pagamento
> insuficiente: total 3.51, pago 3.50" — o servidor arredonda **cada linha** a 2 casas, e o rateio *por
> unidade* fazia os dois arredondamentos subirem juntos (2,625→2,63 + 0,875→0,88), enquanto o front
> somava a linha do par (0,70×5). Correção em 2 camadas: **`splitPairLine`** (rateio sobre o **total da
> linha**, ciente da quantidade) e — o que mata a classe de bug — o PDV passa a **somar exatamente os
> itens que envia** (`cartToSaleItems`), com a mesma função do servidor. Limite documentado: com
> `Decimal(12,4)` o desvio pode chegar a **1 centavo** acima de ~100 pares, mas a tela sempre mostra o
> que será cobrado. Core **+5 → 108/108** (teste de propriedade: exato de 1 a 100 pares, ≤1 centavo até
> 600). Web `31a5e1d6`. **E2E do usuário VALIDADO (5/5):** par baixa 1 de cada; cancelamento estorna 1
> de cada; bucha zerada tira o par do PDV (parafuso segue avulso); par invertido recusado; 5 pares
> fecham em R$3,50 sem erro. Commits `999bb45` + `992259e`. **Fatia PA CONCLUÍDA.** **Próximo passo:**
> direções abertas — go-live (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova
> funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-20 — **EP (visualizar/editar cadastro de produto + campo Fabricante) —
> NO AR e VALIDADO pelo usuário.** Pedido do usuário. **Diagnóstico:** editar produto
> tinha **impacto ZERO de backend** — `PATCH /products/:id` já aceitava todos os campos, com autoria (ADR-010),
> desde a Fase 2; a lacuna era só de UI (a tela só editava `minStockQty` inline). **Migration `0010`
> APLICADA** (aprovada pelo usuário): `products.manufacturer VARCHAR(120)` nullable + índice
> `[tenantId, manufacturer]` — aditiva, sem alteração de RLS, sem drift. Core: `productMatchesQuery` agora casa
> por **nome, popular, fabricante ou SKU** (**+2 → 84/84**). Shared: `manufacturer` no create; o
> `updateProductSchema` passou a aceitar **`null`** nos opcionais (**ausente = não mexe; `null` = limpar**) —
> sem isso a edição só sabia preencher, nunca apagar. Web: novo `components/ProductDetail.tsx` — clicar no nome
> do produto abre o **cadastro completo em leitura** (todos os campos + autoria) e o botão **Editar** vira
> formulário (Salvar/Descartar, Salvar só habilita com alteração real, **PATCH só dos campos alterados**);
> **estoque read-only ali de propósito** (ADR-001 — saldo só muda por movimentação). Fabricante também no
> cadastro, na tabela, no PDV e no espelho offline. Gates: typecheck API+web ✅, build web (18 rotas) ✅, core
> **84/84** ✅. ⚠️ **Deploy da API era obrigatório** mesmo sem rota nova (Zod/Prisma antigos descartariam o campo —
> igual ao `popularName` em 14/07) — feito. **NO AR:** API `539b629b` + web `fbb08eb5`; smoke ✅.
> **E2E do usuário validado 7/7** (cadastrar com fabricante, buscar pela marca, abrir o cadastro, editar
> preço, **apagar o fabricante** — o `null` limpa a coluna —, estoque read-only, produto antigo edita
> normal). Commit `23f975b`. **Fatia EP CONCLUÍDA.** **Próximo passo:** direções abertas — go-live
> (Supabase Pro/CORS/SMTP, ver `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-17 — **"Última atividade da loja" no painel do Super Usuário — NO AR e
> VALIDADO.** Ideia do usuário ("mostrar se a loja está online?") virou um sinal **honesto**: não existe
> "online/offline por loja" (online/offline é do dispositivo/sessão, não do tenant; a API é única na edge), então
> mostramos **quando foi a última operação real** — responde de verdade "está sendo usada?". **Cost-zero, sem
> migration, sem tabela de log:** `GET /platform/tenants` deriva `lastActivityAt` do `MAX` de sinais que já
> existem (última venda + último movimento de estoque + abertura/fechamento de caixa, 3 `groupBy`). Web: coluna
> **"Última atividade"** no `/plataforma` — "• ativa agora" (verde, < 15 min) senão rótulo relativo PT-BR
> (`timeAgoPtBr`, puro) ou "— sem atividade". *(A "ideia 1", badge "Online" p/ o operador, foi descartada:
> `navigator.onLine` mente — só diz que há rede, não que a API responde.)* Gates: typecheck API+web, build web
> (17 rotas), core **82/82**. **No ar:** API `d3fc9568` + web `4feb010c`; commit `2f0f14b`. **E2E do usuário
> validado** (Loja Demo "ativa agora" após operação; outra loja "há 13 dias"). Ver "Plataforma — Última
> atividade da loja" no registro. **Próximo passo:** direções abertas — go-live (Supabase Pro/CORS/SMTP, ver
> `docs/plano-producao.md`), nova funcionalidade, ou endurecimento.
>
> **Antes:** 2026-07-16 — **EF-3 COMPLETO, NO AR e VALIDADO** (venda em unidade alternativa —
> rolo fechado × por metro, 2 preços). Fecha o **módulo de estoque fino** (EF-1→EF-2→EF-3). **ADR-013
> (Opção A):** segundo preço reusando `conversionFactor`; **2 migrations aditivas** — `0008`
> (`products.altUnit`/`altSalePrice`) e `0009` (`order_items.baseQuantity`). Core
> `hasAltUnit`/`resolveSaleUnit`/`toBaseQuantity`/`effectiveBaseUnitPrice` (**+14 → 82/82**). API
> `POST /orders`: baixa e `StockMovement` em **unidade-base** (`qtd × fator`), `OrderItem` grava
> `baseQuantity`; **cancelar/devolver estornam em base** (`baseQuantity ?? quantity`). Web: cadastro com
> bloco "unidade alternativa"; PDV com botões **base × embalagem** + trava de estoque em base (`saleMode`
> no payload online/offline); comprovante imprime a embalagem. **No ar:** API `4f19776c` + web `98453ac5`.
> **E2E validado** (fio metro R$2 / rolo 100 m R$150, estoque 500: venda rolo 2× baixou **200**, cancelamento
> estornou **200** — não 2 — saldo 495). **Pendência 1 (reconciliação de estoque do seed) FECHADA em
> 2026-07-16** — rotina `reconcile-stock.mjs` corrigiu 3 produtos (Tijolo 955→905, Cimento 220→190, e o
> soft-deleted Cimento CP-II 120→0); pós-apply 0 divergências (ver registro). **Próximo passo:** pendência 2
> (limpar dado de teste do EF-3) **ou** pendência 3 / itens finais da Fase 3 (pooler 6543, avaliar Supabase Pro).
>
> **Antes:** 2026-07-15 — **EF-2 COMPLETO e NO AR** (estoque fino online-first). Duas fatias: **(1)
> painel de reposição** (topo do Estoque — tudo no ponto de reposição, badge zerado/baixo + sugestão de compra)
> e **(2) visão consolidada por produto** (colunas Entradas/Saídas/Saldo-hist. na tabela "Estoque atual", com ⚠
> de divergência ADR-001 e clique no produto p/ filtrar o histórico). Novo endpoint agregado `GET /stock/summary`
> (`groupBy`, cost-zero). Core `isLowStock` + `replenishmentShortfall` (**68/68**). No ar: API `d1f6799a` + web
> `3523dd7c`; E2E validado (o ⚠ até pegou divergências reais no seed: Cimento 230≠200, Tijolo 955≠905). **Antes,
> no mesmo dia:** fix da **busca do PDV** (lista visível/clicável, web `c15b93a1`) + **EF-1 completo**.
> **Próximo passo:** **EF-3** (venda em unidade alternativa — rolo × metro, 2 preços) — **exige ADR próprio +
> aprovação da migration antes de codar** (regra 4 do CLAUDE.md). Alternativa: investigar/reconciliar as
> divergências de estoque do seed (rotina de reconciliação, ADR-001).
>
> **Antes:** 2026-07-15 — **EF-1 COMPLETO e NO AR** (cadastro de produto enriquecido fechado).
> Deployado o **resto do EF-1** (só UI, sem migration/API): **descrição/observação** (textarea ≤500), **peso**
> com toggle **kg/g** (canônico em kg) e **unidade de venda** (dropdown `UnitType` + `unitTypeLabels` PT-BR novo
> em `packages/shared`). Web Version `4baf2760-c0e2-442a-a5a7-c25d6f52e337`; **E2E do usuário validado** (Metro /
> 250 g→0,25 kg / descrição persistiram — conferido na API). Gates: typecheck web ✅, build web (18 rotas) ✅,
> core 58/58 ✅. **Próximo: EF-2** (estoque fino online-first). Detalhe abaixo (bloco "EF-1 FECHADO").
>
> **Antes:** 2026-07-14 — **EF-1 (parte do apelido) + busca + código de barras NO AR (API + web deployados e validados).**
> Entregue a fatia **"nome popular + busca + leitura de código de barras"** (parte do EF-1 planejado, com desvios anotados):
> - **Nome popular do produto** — coluna nova **`popularName`** (renomeamos o `nickname` do plano; `VarChar(150)`,
>   nullable, sem mudança de RLS) + índice `products_tenantId_popularName_idx`. **Migration `0007` aplicada** via
>   `wrangler`/`migrate deploy` (aprovada pelo usuário). Campo **genérico p/ qualquer ramo** (sistema é multiramos),
>   exemplo só ilustrativo ("Ferro 8" p/ "Vergalhão CA-50 8mm"). Exposto no cadastro e na listagem (linha secundária).
> - **Busca de produto** por **nome oficial + nome popular + SKU** (digitar qualquer um acha) nas telas **Produtos** e
>   **Venda**. Lógica pura `productMatchesQuery` + `normalizeSearchText` em `packages/core` (acento- e caixa-insensível,
>   substring; **+7 testes → 58/58**). Na venda, o `<select>` passa a listar só os matches.
> - **Código de barras (BÔNUS, fora do plano original):** o `sku` **é** o código de barras, então buscar por SKU já é
>   buscar por código. (a) **Leitor físico (HID)**: campo de busca com **Enter-quando-sobra-1** — na venda **auto-adiciona
>   ao carrinho**; em Produtos **acha+destaca** a linha ou, se o código for novo, **joga no SKU do cadastro e foca Nome**.
>   (b) **Câmera**: componente reutilizável `apps/web/components/BarcodeScanButton.tsx` (📷) — `BarcodeDetector` nativo
>   com fallback **`@zxing/library`** (dep nova, dynamic import só ao abrir); integrado na venda (📷 busca) e em Produtos
>   (📷 busca + 📷 campo SKU). `CachedProduct` (cache offline) ganhou `popularName`.
> - **API re-deployada** (`nexoloja-api`, Version `54acd8eb-4c89-4f58-a5a6-44aca930b7e6`): a API é um **Worker deployado**
>   e o `@nexoloja/shared`/Prisma antigos **descartavam** o `popularName` (Zod tira campo desconhecido; client antigo não
>   lê a coluna) — sem o redeploy o campo nem salvava nem retornava. **Validado E2E pós-deploy:** produto "Tubo PVC 100mm"
>   / popular "Cano 100" **persistiu** (DB confere) e a **busca por "cano" (só no nome popular) achou**.
> - **Web deployado** (`nexoloja-web`, Version `2bc2eab3-1aa4-4151-bd61-3e3a168300bd`) — smoke OK (login serve em
>   `nexoloja-web.imortal.workers.dev`). Fatia **100% no ar** (API + web). Login de produção fica p/ o usuário conferir.
> - **EF-1 FECHADO — NO AR e VALIDADO (2026-07-15):** os 3 campos que faltavam no cadastro de produto entraram,
>   **só UI, sem migration e sem deploy de API** (a API de 14/07 já aceita — `POST /products` repassa
>   `...parsed.data` ao Prisma): **descrição/observação** (textarea ≤500), **peso** com toggle **kg/g** (canônico
>   em kg — gramas ÷ 1000 no envio) e **unidade de venda** (dropdown do `UnitType` com rótulos PT-BR, novo
>   `unitTypeLabels` em `packages/shared`). Gates: typecheck web ✅, build web (18 rotas) ✅, core 58/58 ✅.
>   **Web deployado** (Version `4baf2760-c0e2-442a-a5a7-c25d6f52e337`). **E2E do usuário validado:** produto
>   "Cabo Flexível 2,5mm — TESTE EF1" com Metro/250 g/descrição → API confere `unit="METER"`, `weightKg="0.25"`
>   (250 g → 0,25 kg), descrição íntegra. Com o cadastro enriquecido pronto (apelido+busca+código de barras da
>   fatia anterior **+** descrição/peso/unidade), **EF-1 está completo.**
> - **PRÓXIMO PASSO (próxima sessão) — EF-2 (estoque fino online-first, sem migration):** dar superfície ao que já
>   existe no core — **alerta/painel de estoque baixo** (`stockQty <= minStockQty`, já testado) + **movimentações
>   detalhadas** / visão de reposição, usando `StockMovement` e `minStockQty`. **Não toca a fila offline.**
> - Gates: core **58/58**, typecheck web ✅, build API (dry-run) ✅. Dados de teste deixados no tenant do usuário (a pedido):
>   caixa aberto R$100 + produtos FE8-TESTE (sem popular) e PVC100-TESTE (popular "Cano 100").
>
> **Antes:** 2026-07-13 — **CS-5 fechada e validada; direção do próximo bloco travada.**
> **Decisão de produto:** estoque e caixa seguem **ONLINE-ONLY** — NÃO haverá mutação offline de estoque/
> caixa agora. O offline valeu para a **VENDA** (cliente no balcão, não pode esperar); já entrada/ajuste de
> estoque e abrir/fechar caixa são **retaguarda** (podem esperar a rede voltar), e o **"ajuste"** é
> justamente a classe **conflituosa** que exigiria a tela de **CONFLICT**. Fica adiado até haver demanda
> real — junto com os cadastros mutáveis e a tela de conflito (ordem já prevista na Fase 3). **Próximo
> trabalho = módulo ESTOQUE FINO + enriquecimento do cadastro de Produto**, em **3 fatias** (detalhe na
> Fase 3 → "Módulo de estoque fino + enriquecimento do cadastro"): **EF-1** cadastro enriquecido —
> **apelido** (busca por **nome E apelido**), **descrição/observação**, **peso** (kg/g), **unidade de
> venda** — só **1 migration aditiva** (coluna `nickname`); **EF-2** estoque fino online-first — alerta de
> **estoque baixo** + **movimentações detalhadas** (sem migration); **EF-3** **venda em unidade
> alternativa** (fio: **rolo fechado × por metro**, dois preços — toca PDV/estoque/comprovante → **ADR
> próprio antes de codar**). ⚠️ Muitos campos pedidos **JÁ EXISTEM no schema** (`description`, `weightKg`,
> `unit UnitType`) — só faltam na UI. **Nada codado ainda: só documentação/roadmap para começar em outra
> sessão.**
>
> **Antes:** 2026-07-13 (**Fase 3 — CS-5 (esperado ajustado + divergência recalculada no
> relatório) NO AR e conferida** + adendo "responsável do caixa" no relatório). CS-5 fecha a conferência
> da CS-4: `POST /orders` grava `cashAmount` no `meta` do `SALE_ON_CLOSED_CASH`; função pura
> `calcAdjustedCashClosing` no core (+4 testes, **51/51**); `GET /reports/cash-sessions` devolve
> `lateCashSalesTotal`/`adjustedExpected`/`adjustedDivergence` (só o DINHEIRO das vendas tardias; fallback
> ao `total` p/ marcas antigas); UI `/relatorios` mostra "ajust. R$…" sob Esperado/Divergência. **Adendo:**
> tooltip na célula "Fechado em" com abertura/fechamento + **quem abriu/fechou** (`openedByName`/
> `closedByName`, ADR-010), exibido num **popover** (hover no desktop + toque no celular/PWA). **Sem
> migration.** **NO AR:** API `3c926d4c` + web `ac7c5b14`. **PRÓXIMO
> PASSO** = direções abertas: (b) próximas naturezas de mutação offline (estoque/caixa) ou (c) outros
> itens da Fase 3. Ver 3.F.CS-5 no registro.
> **Antes:** ADR-012 (cold-start / offline-first de leitura) CONCLUÍDO ponta a ponta (CS-1…CS-4 NO AR e
> VALIDADAS pelo usuário). **CS-4 (semântica de caixa fechado no sync,
> decisão b) — validada:** a venda offline anexada a um caixa **fechado** grava `AuditEvent
> SALE_ON_CLOSED_CASH` (marca de reconciliação, não bloqueia; **sem migration**) e o relatório mostra o
> badge "N após fechamento". E2E de dois contextos OK; verificação de estoque da venda `#c0d0b8b9` (CASH
> R$370): Cimento **240 → 230**, débito atômico intacto (a marca não afeta estoque/validade). API
> `94f277ea` + web `ae5296b5`. **Antes: CS-3 (navegação offline entre telas) VALIDADA** — navegação por
> reload (`OfflineNav`) + Service Worker v3 (aquece o shell de todas as 9 telas do menu; cache `STATIC`
> sobrevive a deploys) + `lib/meCache.ts` (papel/nome offline); 3 achados dos E2E corrigidos
> (3.F.CS-3.1/.2/.3). Web Version `624912fe`.
> **Antes: CS-1 + CS-2
> NO AR e VALIDADAS** — o PDV segue **vendável offline após remontar/reabrir**). **ADR-012 escrito e
> ACEITO** (5 decisões a–e). **CS-1** (cache do caixa aberto em `localStorage`) + **CS-2** (cache do
> catálogo no IndexedDB — abridor compartilhado `lib/db.ts`, `DB_VERSION`→2 com store `catalog`;
> `outbox.ts` refatorado): online a rede vence/sobrescreve; offline, `/venda` e `/caixa` leem do cache
> (rótulo "dados de HH:MM"), com baixa otimista fazendo write-through no catálogo. **Sem migration.**
> E2E do usuário **7/7** (web `b55d670f`). **Refinos de UX offline (decisão c do ADR-012):** aviso de
> rede amigável (`components/OfflineNotice.tsx`) nas **6 telas online-only** (Produtos, Estoque,
> Clientes, Relatórios, Histórico, **Configurações**) no lugar do "Failed to fetch"/"Acesso restrito"
> crus (web `a4cebe57` + `c1679c08`) — **validado pelo usuário em todas as telas**. **Achado 3.F.CS-2.2
> (aberto):** navegar offline **entre telas** ainda quebra (chunk/RSC não cacheado → erro do roteador);
> mitigado com `app/global-error.tsx` (aviso recuperável, web `51faac08`), mas a correção real é a
> **fatia CS-3** (spike do SW: precache de rotas/RSC ou navegação-por-reload). **PRÓXIMO PASSO = CS-3.**
> Typecheck + build **18 rotas** + core 47/47 ✅ em todo o caminho. Ver 3.F.CS-1/CS-2/CS-2.1/CS-2.2 no
> registro. **Antes (2026-07-10): Fase 3 — Refinos da fila offline (3.E): CÓDIGO PRONTO** —
> drenagem global (worker no shell `(app)` + chip de status no topo, drena em qualquer tela), poda de
> `SYNCED` (`pruneSynced` no fim do dreno) e tela **`/pendencias`** (lista a fila incl. `FAILED`;
> **Tentar novamente**/**Descartar**); pub/sub na `outbox` sincroniza chip/PDV/tela. Só cliente, sem
> migration. Typecheck + build **18 rotas** + core 47/47 ✅; **no ar (web `3921af94` + `300254fc`) +
> smoke ✅; E2E validado pelo usuário (2026-07-11)** — chip global + drenagem + vendas registradas.
> **Achados** (3.E.1 tela branca ao navegar offline → mitigado com `(app)/error.tsx`; 3.E.2 PDV assume
> "caixa fechado" offline após remontar) são a **lacuna de offline-first de leitura** — a próxima
> fatia natural: **cold-start offline** (persistir `sessionId` + cachear catálogo/rotas). Ver 3.E no
> registro. **Antes: Fase 3 — Fila de sync offline, Fatias 3–6 (round-trip da
> venda offline) NO AR e VALIDADO em produção**: PDV enfileira offline → worker (`syncWorker.ts` +
> `useOutboxSync`) drena FIFO ao voltar a rede, para na 1ª falha, retry só transitório → servidor
> `POST /orders` **idempotente por PK** (dedup do reenvio; caixa do envelope; estoque insuficiente
> registra e deixa negativo p/ reconciliação, §6). Máquina de estados pura em `packages/core`
> (+12 testes → **47/47**) + indicador "X vendas pendentes" no PDV. **Sem migration** (AI 10:
> dedup usa a PK existente). **E2E validado**: offline→enfileira→online→sincroniza; venda com a
> mesma PK, estoque 258→256; **reenvio não duplica**. 2 achados corrigidos (3.D.1). API `897d5524`
> + web `c74bbc5f`. Ver 3.D no registro de testes. **Próximo:** refinos do offline (drenagem global,
> tela `FAILED`, caminho OFF) ou as próximas naturezas de mutação (estoque/caixa offline). **Antes:**
> Fatia 2 (envelope + store
> `outbox` + flag em `localStorage`) — código pronto (ver 3.C). **Antes:** Fatia 1 (flag `OFFLINE_SALES`
> + avisos) CONCLUÍDA e validada: interruptor por loja via `TenantModule` (sem migration, default
> OFF, plano pago), `GET /me` expõe o flag, toggle no painel `/plataforma` (`AuditEvent
> SET_TENANT_MODULE`), avisos offline no PDV/Caixa (abrir caixa segue online-only); API `0b8c0348`
> + web `c35f8592`, E2E do usuário OK. Ver 3.B
> no registro de testes. **Antes:** **Fatia 3.A: PWA instalável (manifest,
> ícones, service worker de app-shell só-GET-same-origin, prompt "Instalar", página `/offline`);
> só front, sem migration; typecheck + build (17 rotas) + smoke ✅; **no ar** (web Version
> `1f290a7d`) + **instalação validada pelo usuário nas 3 plataformas (Android/iPhone/PC) → 3.A
> concluída**. Antes:** **"Registrado por" (ADR-010) + estoque inicial no cadastro —
> no ar e validados pelo usuário**: (1) **atribuição de autoria** — cada registro guarda quem executou
> (id solto + **snapshot do nome**, congelado) e reusa o "quando"; migration **`0006`** aplicada
> (aditiva, nullable): `products`/`customers` (`createdBy/updatedBy/deletedBy`), `orders`/`cash_movements`
> (`registeredByName`), `stock_movements` (`userId` — antes inexistente — + `registeredByName`),
> `cash_sessions` (`openedByName`/`closedBy`). `requireAuth` expõe `userName`; write-path grava a
> autoria; UI mostra "Registrado por"/"Última alteração"/"Aberto por" em Vendas, Estoque, Produtos,
> Clientes, Caixa (+ painel de suporte). Nível "quem fez por último" (complementar ao ADR-004,
> cost-zero). API `a3503411` + web `93c9a95e`. (2) **Estoque inicial no cadastro** — campo opcional que,
> se > 0, cria o produto **e** gera a Entrada (`StockMovement` INCOME, "Estoque inicial (cadastro)")
> na mesma transação (ADR-001), com autoria; fecha a brecha do `stockQty` solto no schema. Sem
> migration. API `cad0fe6e` + web `ef59a575`. Typecheck API+web ✅; build ✅; core 35/35.
> **Antes:** (**Fase 2.5 — Fatia E (impersonation auditada) no ar, read-only**:
> Super Usuário entra na loja para **suporte somente-leitura** sem virar usuário dela. Token de
> suporte assinado e curto (`lib/supportToken.ts`, HS256 com secret `SUPPORT_TOKEN_SECRET`, TTL 30 min,
> escopo `{ platformAdminId, targetTenantId, exp }`) emitido por `POST /platform/tenants/:id/support`
> (+ `AuditEvent SUPPORT_SESSION_START`). Rotas **`/support/*`** fora de `/platform/*` (o Bearer é o
> token de suporte, não JWT do Supabase), com `requireSupportSession` que verifica o token **e**
> revalida `platform_admins.isActive`: `GET /support/:tenantId/overview` (dados da loja read-only) +
> `POST /support/end` (`SUPPORT_SESSION_END`). RLS de loja **intacto**. UI: botão **Entrar (suporte)**
> em `/plataforma` → `/plataforma/suporte/[tenantId]` (banner "somente leitura"). ADR-004 (2 novos
> `action`s, `meta.support=true`) + ADR-009 (Fatia E ✅ read-only) atualizados. **Sem migration.**
> Typecheck API+web ✅; build ✅; core 35/35. **No ar:** secret provisionado + API + web publicados +
> smoke em produção ✅ + **E2E do usuário validado (2026-07-05)**. Painel de suporte depois evoluiu para
> **navegável** (2.5.E.2): abas Resumo/Vendas/Produtos & Estoque com filtros e detalhes, também
> read-only e validado pelo usuário (API `1397654d` + web `d3f54d16`). Também marcados como validados pelo usuário
> os E2E que estavam pendentes (Fatia C criar loja, 2.5.Del excluir usuário, 2.5.Inact loja desativada).
> **Antes:** (**Fatias A–D concluídas**: exclusão de usuário
> da loja adicionada — `DELETE /users/:id` apaga a linha em `users` + revoga a identidade no
> Supabase Auth (`deleteAuthUser`, libera o e-mail) + `AuditEvent DELETE_USER`; bloqueia
> self/`OWNER` e usuários com histórico (→ 409 *Desativar*); botão **Excluir** em
> `/configuracoes`. **Fatia D (documental)**: `CREATE_TENANT`/`SET_TENANT_ACTIVE`/`DELETE_USER`
> formalizados na lista fechada do **ADR-004** e **ADR-009 fechado** (Fatias A–D). Sem migration.
> Typecheck API + web ✅; falta deploy do Worker + E2E do usuário. **Fatia E** (entrar no contexto
> da loja p/ suporte, impersonation auditada) fica como futura — direção no ADR-009. Antes:
> **Fatia C (painel `/plataforma`) no ar**: UI do
> Super Usuário (listar/criar/ativar lojas), `PATCH /platform/tenants/:id` + `SET_TENANT_ACTIVE`,
> login roteia por papel. API `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada no navegador
> (super usuário → painel, lista Loja Demo). Falta E2E de e-mail real (usuário) e a **Fatia D**
> (formalizar auditoria no ADR-004 + fechar ADR-009). Antes: **Fatia B (onboarding) no ar**: `POST
> /platform/tenants` cria loja + convida 1º Admin (`OWNER`); `createTenantSchema`+`slugify`,
> `inviteAuthUser` extraído p/ `lib/authAdmin.ts`, `AuditEvent CREATE_TENANT`; sem migration.
> API publicada (Version `ff3889d4`); E2E 12/12 (loja de teste criada e removida). Falta o E2E do
> e-mail real → cai na Fatia C. Antes: **Fatia A (ADR-009) no ar**: identidade
> de plataforma. Migration `0005_platform_admin` aplicada (tabela cross-tenant `platform_admins` +
> RLS + hook estendido p/ claim `is_platform_admin`), middleware `requirePlatformAuth`, rotas
> `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. API publicada (Version
> `7f7fcd7e`); E2E 10/10 (super usuário lista lojas cross-tenant; owner de loja barrado com 403;
> hook não quebrou a auth de loja). 1º super usuário: `super_owner@nexoloja.local`. Plano completo
> em `docs/plano-fase-2.5.md`. Próximo: **Fatia B (onboarding)**. Antes: **UI responsiva (2.S)** —
> correção de
> usabilidade no celular/tablet: `<meta viewport>` adicionado, menu lateral vira **gaveta**
> no celular (☰) e **recolhe** no desktop (persistido em `localStorage`), 7 tabelas passam a
> rolar (`overflow-x-auto`). Front puro, sem migration/API. Build + **deploy publicado**
> (Version `c13b1755`); falta só o E2E visual do usuário no celular. ⚠️ No Windows o
> `opennextjs-cloudflare deploy` quebrava (workerd `--debug-port`) — **corrigido em 2026-07-03**
> fixando `@cloudflare/workerd-windows-64@1.20260630.1` como optionalDependency do `apps/web`
> (casa com o workerd do wrangler 4); `npm run deploy` do web agora funciona direto. Ver
> "Infra.Deploy-Win" no registro de testes. Antes: **Web publicado no Cloudflare via OpenNext e validado** →
> `nexoloja-web.imortal.workers.dev` (convite E2E OK pela URL publicada); ver bloco abaixo.
> Antes: **Fase 2 CONCLUÍDA** — **Convite de usuário por e-mail —
> fatia 2 do ADR-008 (2.Q)**: `POST /users/invite` (Supabase `inviteUserByEmail` via
> `service_role` + linha em `users` + `AuditEvent CHANGE_ROLE`), botão **Convidar** em
> `/configuracoes` e página `/definir-senha`; binding `SUPABASE_SERVICE_ROLE_KEY` provisionado
> + Worker publicado + **E2E validado pelo usuário no navegador**. Antes: **Perfil "Meus
> dados" (2.P)**: menu de conta
> no rodapé (ícone + nome, popover com Meus dados/Sair); painel edita nome + **telefone**
> (`PATCH /me`) e troca **senha** via Supabase Auth com **reautenticação**. Migration
> `0004_user_phone` (coluna `phone` opcional em `users`) aplicada; Worker publicado (versão
> `685109c2`); E2E `PATCH /me` 6/6. Antes disso: **RBAC + gestão de usuários (ADR-008 fatia 1,
> 2.O)** — papéis Admin/Usuário derivados do `UserRole` sem migration, `requireAdmin`, `/me`,
> `/users`, gate de Configurações; E2E de RBAC 14/14. Falta a **fatia 2** do ADR-008 (convite
> por e-mail via `service_role`), que **fecha a Fase 2**, e a conferência visual no navegador)

> ✅ **Fase 2 fechada** — a fatia 2 do ADR-008 (convite de usuário por e-mail) foi validada
> ponta a ponta pelo usuário no navegador (convite → e-mail → `/definir-senha` → login). Com
> ela, gestão de usuários + RBAC concluídos. Logins de teste: Admin `owner@lojademo.com`,
> Usuário `caixa@lojademo.com`.
>
> ℹ️ **E-mail de convite — personalização adiada.** O convite já envia o nome da loja
> (`data.store_name`), pronto para uso, mas **editar o template de e-mail é bloqueado no free
> tier do Supabase** (exige Custom SMTP, Pro ou Send Email hook). Como isso se acopla ao
> **remetente próprio**, template + branding + campo de e-mail da loja ficaram todos como
> **melhorias futuras** (ver item da fatia 2). Hoje o convite funciona com o template padrão.
>
> ✅ **Web publicado no Cloudflare (OpenNext) — 2026-07-01 — validado:** `apps/web` roda na edge
> em **https://nexoloja-web.imortal.workers.dev** (Workers via `@opennextjs/cloudflare`; Pages
> descontinuado, ADR-005), sem domínio próprio por ora. As `NEXT_PUBLIC_*` são embutidas no
> build (não são secrets de runtime). CORS da API liberado para a nova origem + API republicada;
> Supabase *URL Configuration* atualizado (Site URL + Redirect `.../**` cobrindo `/definir-senha`,
> localhost mantido p/ dev). Smoke automatizado ✅ (login 200, env embutidas, preflight CORS 204)
> e **E2E de convite pela URL publicada validado pelo usuário no navegador** (convite → e-mail →
> `/definir-senha` → login). Ver 2.R no registro de testes.
>
> ▶️ **Próximo passo: deploy da API+web + E2E do usuário da CS-5.** A **Fatia CS-5 — "esperado ajustado" +
> divergência recalculada no relatório de fechamento** (melhoria da conferência da CS-4) está **CÓDIGO
> PRONTO (2026-07-13)**, sem migration: `POST /orders` grava `cashAmount` no `meta` do
> `SALE_ON_CLOSED_CASH`; função pura `calcAdjustedCashClosing` no core (+4 testes, **51/51**); `GET
> /reports/cash-sessions` devolve `lateCashSalesTotal`/`adjustedExpected`/`adjustedDivergence` (**só o
> DINHEIRO** das vendas tardias — cartão/PIX conciliam na maquininha; **fallback ao `total`** p/ marcas
> antigas sem `cashAmount`); UI `/relatorios` mostra "ajust. R$…" sob Esperado/Divergência. **NÃO
> reescreve o dado congelado** do fechamento (auditoria). api tsc + web typecheck/build (18 rotas) ✅.
> **Falta:** `npm run deploy` (API e web) + E2E do usuário (registrar venda offline num caixa que será
> fechado → sincronizar → conferir "esperado ajustado" e divergência recalculada em Relatórios). O
> **ADR-012 (CS-1…CS-4) segue CONCLUÍDO e VALIDADO**. **Depois da CS-5:** (b) próximas naturezas de
> mutação offline (estoque e caixa; depois cadastros mutáveis → tela de `CONFLICT`); (c) outros itens da
> Fase 3 (módulo de estoque fino, pooler, avaliar Supabase Pro).
>
> ⚠️ **Ao retomar o teste offline após qualquer deploy:** abra o app **online uma vez** e visite as
> telas que vai testar (o deploy troca o hash dos chunks; o SW só os cacheia ao visitá-las online) —
> senão a navegação offline bate em chunk não-cacheado. É exatamente o que o CS-3 vai resolver.
> **Antes:** Fatia 2 (envelope + `outbox` + flag em `localStorage`) — código pronto (2026-07-10, ver
> 3.C). **Antes:**
> **Fatia 1 (flag `OFFLINE_SALES` + avisos)
> CONCLUÍDA e validada (2026-07-09)**. Interruptor por loja via `TenantModule` (sem migration,
> default OFF, plano pago), `GET /me` expõe o flag, toggle no painel `/plataforma` (`AuditEvent
> SET_TENANT_MODULE`), e avisos offline no PDV/Caixa (`OfflineSalesNotice` + `useOnline`; abrir
> caixa segue online-only). No ar: API `0b8c0348` + web `c35f8592`; E2E do usuário validado. **A
> seguir (quebrado em sub-passos no item da Fase 3):** Fatia 2 = envelope de mutação + store
> `outbox` (IndexedDB) + persistir o flag em `localStorage`; depois worker de fila, `POST /orders`
> idempotente por PK, core+testes e UI de pendentes. Ver 3.B no registro de testes. **Antes:**
> **Fatia 3.A (PWA instalável) concluída (2026-07-06)**. O `apps/web` é **instalável** (manifest + ícones + service worker de
> app-shell + prompt "Instalar" + página `/offline`); o SW intercepta **só GET same-origin**
> (API/Supabase nunca são cacheados) e o registro é gated a produção. Sem migration, sem API;
> typecheck + build (17 rotas) + smoke no navegador ✅. **No ar (2026-07-06):** web publicado
> (Version `1f290a7d`) + smoke em produção ✅ + **instalação validada pelo usuário nas 3 plataformas
> (Android, iPhone, PC)** → **Fatia 3.A concluída**. (PWA atualiza sozinho a cada deploy — não
> precisa reinstalar; ver nota na Fase 3.) **Depois de 3.A:** a **fila de sincronização
> offline** (IndexedDB → Supabase) — parte difícil, que **exige um ADR próprio** (ex. ADR-011:
> idempotência, resolução de conflito, atomicidade do ADR-001/RLS) antes de codar. *Nada bloqueia:
> produção roda a Fase 2.5 completa.* Antes: **Fase 2.5 concluída (A–E) e no ar**; duas melhorias
> transversais **validadas pelo usuário (2026-07-05)**: **(1) "Registrado por" (ADR-010)** —
> autoria por snapshot; migration `0006` (API `a3503411` + web `93c9a95e`). **(2) Estoque inicial
> no cadastro** — Entrada atômica no cadastro (ADR-001); sem migration (API `cad0fe6e` + web `ef59a575`).
> - *Melhoria futura na Fatia E:* **escrita em modo suporte** (exceção auditada, `meta.support=true`)
>   — hoje o suporte é somente-leitura (direção no ADR-009).
> - *Melhoria futura na Fase 2:* devolução **parcial** (itens/quantidades com rateio).
> - *Fase própria (Plataforma, ver abaixo):* **multi-loja + Super Usuário + onboarding** (ADR-009).
> - *Fase futura dedicada:* **NFC-e fiscal** (SEFAZ + certificado).
> Estado atual: PDV completo (carrinho → revisão → confirmar → impressão, com layout
> 80mm/A4 validado no navegador), **cancelamento de venda** (estorno de estoque/caixa +
> auditoria, restrito ao caixa aberto), **gestão de estoque** (entrada/ajuste/histórico),
> caixa, auth+RLS e CRUDs de cadastro funcionando e publicados. App roda com
> `npm run dev` na **raiz** (sobe só o web via turbo filter; `dev:all`/`dev:api` exigem
> Postgres local p/ Hyperdrive). O front chama a API publicada em
> `nexoloja-api.imortal.workers.dev`.

---

## 🟢 Fase 0 — Fundação, Arquitetura e Banco de Dados — **Concluída**

- [x] Definição arquitetural: 5 ADRs + `docs/ARCHITECTURE.md`
- [x] Modelagem completa do `schema.prisma` (multi-tenant, produtos, estoque, vendas, caixa, entregas, auditoria)
- [x] Tabelas criadas fisicamente no Supabase (schema `public`)
- [x] Ambiente Prisma estabilizado na v6 (conexão via porta direta 5432)

---

## 🟡 Fase 1 — Monorepo e Backend — **Concluída**

- [x] Turborepo + npm workspaces na raiz (`package.json`, `turbo.json`, `tsconfig.base.json`)
- [x] `packages/db` — Prisma isolado (schema + client + migrations)
- [x] `packages/shared` — base de schemas Zod / tipos compartilhados
- [x] `packages/core` — lógica de negócio pura + testes Vitest
- [x] `apps/api` — Hono em Cloudflare Workers (scaffold)
- [x] `apps/web` — placeholder reservado p/ Fase 2
- [x] **Ajuste:** `directUrl` (5432) no datasource p/ migrations
- [x] **Ajuste:** baseline de migrations (`0_init` + `0001_drop_password_hash`)
- [x] **Ajuste:** auth alinhada ao Supabase Auth (remoção de `User.passwordHash`; `User.id` = `auth.users.id`)
- [x] Endpoint de validação `GET /db-check` lendo o banco (validado em `wrangler dev`)
- [x] CRUD de **Produtos** (`/products`) — validado ponta a ponta no Supabase
- [x] CRUD de **Clientes** (`/customers`) — validado ponta a ponta no Supabase
- [x] CRUD de **Categorias** (`/categories`, com hierarquia) e **Fornecedores** (`/suppliers`) — API
      (a **tela** de Fornecedores só chegou em 2026-08-14; ver "UI.Cadastros.Fornecedores"). Categorias
      seguem sem tela dedicada.
- [x] Deploy na edge (Cloudflare Workers + Hyperdrive) — `https://nexoloja-api.imortal.workers.dev`

> ℹ️ Tenant ainda vem do header temporário `x-tenant-id` — será substituído pelo
> claim do JWT (Supabase Auth + RLS) na Fase 2.

---

## 🔵 Fase 2 — Autenticação, Segurança (RLS) e MVP funcional — **Concluída (MVP)**

> Fechada pelo item que a define (gestão de usuários + RBAC, ADR-008), validado no navegador.
> Itens ainda desmarcados abaixo **não** travam o fechamento: **NFC-e** é fase futura dedicada;
> o **vínculo FK cross-schema** é endurecimento opcional (o `users.id = auth.users.id` já é
> garantido em código); **devolução parcial** e **melhorias de e-mail** são melhorias futuras.

- [x] **API protegida por JWT do Supabase** (middleware `requireAuth`) — aposenta o `x-tenant-id`
- [x] Bootstrap de loja + OWNER (`users.id` = `auth.users.id`)
- [x] Custom Access Token Hook (injeta `tenant_id`/`user_role` no JWT)
- [x] Ativar RLS nas tabelas + políticas de isolamento por `tenant_id`
- [x] UI (Next.js + Tailwind): scaffold + tela de **login** (Supabase Auth)
- [x] UI: **app shell** (menu lateral + proteção de login centralizada)
- [x] UI: tela de **produtos** (lista + cadastro via API, com CORS)
- [x] UI: tela de **clientes** (lista + cadastro)
- [x] UI + API: abertura/fechamento de **caixa** (com divergência e auditoria)
- [x] UI + API: **venda/PDV** — carrinho, pagamento (Dinheiro/Déb/Créd/PIX),
      Concluir e Orçamento; estoque atômico (ADR-001) e baixa no caixa
- [x] Impressão: comprovante de venda (não-fiscal) + orçamento — térmica 80mm e A4,
      com cabeçalho (nome + logo da loja) — *layout validado no navegador (2.H.4)*
- [x] UI + API: **gestão de estoque** — entrada (compra/recebimento, transação atômica
      ADR-001) e ajuste de inventário (com `AuditEvent ADJUST_STOCK`, ADR-004), histórico
      de movimentações e alerta de estoque baixo — *validado no navegador e via API (2.J)*
- [x] UI: **estoque mínimo por produto** — campo no cadastro + edição inline na tela de
      Produtos (`PATCH /products`); arma o alerta de “baixo” na tela de Estoque — *(2.J.2)*
- [x] UI + API: **cancelamento de venda** (ADR-004) — estorno de estoque (StockMovement
      reverso INCOME), reversão do pagamento no caixa (esperado ignora `CANCELLED`) e
      `AuditEvent CANCEL_ORDER`; restrito ao caixa aberto — *validado via API publicada
      (14/14) e UI no navegador (2.K)*
- [x] **Relatórios** de vendas e caixa — nova rota `/reports` (`GET /sales`,
      `GET /cash-sessions`) com agregação no servidor (Prisma `aggregate`/`groupBy`,
      cost-zero); vendas por período (faturamento, nº de vendas, ticket médio,
      canceladas à parte), totais por forma de pagamento (com participação %) e
      histórico de fechamentos de caixa com divergência; UI `/relatorios` com atalhos
      (Hoje/7d/30d) e período De–Até. Core: `calcAverageTicket` + `withPaymentShare`
      (testes Vitest). **Sem migration** — usa `Order`/`Payment`/`CashSession`. *(2.L)*
- [x] **Devolução de venda de caixa fechado** (ADR-006) — fluxo separado do cancelamento:
      repõe estoque (StockMovement INCOME reverso) e lança a **saída no caixa de hoje**
      (nova tabela `CashMovement`, `EXPENSE/RETURN`), sem tocar no caixa original já
      fechado; marca o pedido como `RETURNED` e registra `AuditEvent RETURN_ORDER`. O
      esperado do caixa passa a descontar saídas (`netCashMovements` no core). UI: botão
      **Devolver** no Histórico (vendas de caixas fechados) + linha de saídas no Caixa.
      Migration `0003_cash_movements_and_return` (tabela + enum + RLS). *(2.L2)*
  - [ ] **Devolução parcial** (itens/quantidades específicas com rateio de valor) — melhoria
        futura; hoje a devolução é sempre da venda inteira.
- [x] **Upload de logo da loja (Cloudflare R2)** — **concluído**. **R2 binding** no Worker
      (ADR-007, não presigned): `POST /tenant/logo` valida tipo/tamanho (`validateLogo` em
      `packages/shared`), grava no R2 (`env.MEDIA.put`) e salva só a `logoUrl` (nunca
      BLOB/Base64); `DELETE /tenant/logo` remove; leitura pública pelo próprio Worker em
      `GET /public/logo/:tenantId` (cache longo + cache-bust `?v=`). UI nova `/configuracoes`
      (upload + preview + validação). **Sem migration** — `logoUrl` já existia. Bucket
      `nexoloja-media` criado + Worker publicado + E2E validado no navegador. *(2.M)*
- [x] **Editar dados da loja (nome/CNPJ/telefone)** — API `PATCH /tenant` (Zod
      `updateTenantSchema`: nome obrigatório, CNPJ/telefone opcionais → `null` quando vazio;
      `P2002` do CNPJ único → 409) e o card "Dados da loja" em `/configuracoes` virou
      formulário (editar/salvar/descartar; "Salvar" habilita só com alteração real). **Sem
      migration** — campos já existiam no `Tenant`. Máscara de CNPJ/telefone: digita só
      números e formata ao sair do campo (`formatCnpj`/`formatPhoneBr` em `packages/shared`);
      banco guarda **só dígitos** (canônico → índice único de `cnpj` robusto). Typecheck da
      API + build do web ✅. **Worker publicado** (`wrangler deploy`) + **editar→salvar e
      máscara validados pelo usuário no navegador**. *(2.N)*
- [x] **Gestão de usuários da loja + RBAC (ADR-008)** — *fecha a Fase 2*. Papéis
      **Admin** (`OWNER`/`MANAGER`) e **Usuário** (`CASHIER`/`STOCK`) derivados do `UserRole`
      atual — **sem migration** (funções puras em `packages/shared/roles.ts`). Convenção de
      escrita: Admin→`MANAGER`, dono→`OWNER` (preservado), Usuário→`CASHIER`.
  - [x] **Fatia 1 (feita):** `requireAdmin` na API; `GET /me` (papel p/ o front); `/users`
        (listar + definir papel + ativar/desativar, com `AuditEvent CHANGE_ROLE`, ADR-004);
        `PATCH /tenant` e logo agora exigem Admin; front esconde **Configurações** do menu e
        bloqueia a tela para não-Admin + seção de **Usuários** em `/configuracoes`. Typecheck
        API + build web ✅; **Worker publicado** (versão `909427d2`) + smoke 401 OK. *(2.O)*
  - [x] **Fatia 2 (feita):** convite por e-mail (`inviteUserByEmail`). `inviteUserSchema`
        (shared), `POST /users/invite` (cria/recupera no Supabase Auth + linha em `users` com
        papel + `AuditEvent CHANGE_ROLE`), formulário **Convidar** em `/configuracoes` e página
        pública `/definir-senha`. Secret `SUPABASE_SERVICE_ROLE_KEY` provisionado + Worker
        publicado; **E2E no navegador validado pelo usuário** (convite → e-mail → definir senha
        → login). Ver 2.Q. O convite já envia o **nome da loja** (`data.store_name`), pronto
        para o template — mas hoje usa o **template padrão** do Supabase (ver melhoria abaixo).
    - [ ] *Melhorias futuras de e-mail (fora do ADR-008):* **(a)** **personalizar o template**
          do convite (PT-BR + `{{ .Data.store_name }}`) — **bloqueado no free tier** (exige
          Custom SMTP, Pro ou Send Email hook); **(b)** **remetente próprio (branded)** via
          **Custom SMTP** (Resend/SES) — exige **domínio** com SPF/DKIM; **(c)** campo `email`
          no cadastro da loja (migration em `Tenant`) para **Reply-To**/contato no e-mail e no
          comprovante. Padrão de SaaS: envio pela plataforma, com nome de exibição = loja e
          Reply-To = e-mail da loja. (a) e (b) andam juntos: editar o template requer o SMTP.
- [x] **Perfil do usuário ("Meus dados")** — menu de conta no rodapé do menu lateral (ícone +
      nome; abre popover com nome/e-mail/papel, **Meus dados** e **Sair**). Painel edita nome
      e **telefone** (via `PATCH /me`) e troca a **senha** pelo Supabase Auth no cliente **com
      reautenticação** (pede a senha atual). E-mail é somente leitura. **Migration
      `0004_user_phone`** (coluna `phone` opcional em `users`; sem alteração de RLS). API+build
      ✅; Worker publicado (versão `685109c2`); E2E do `PATCH /me` 6/6. *(2.P)*
- [ ] Vínculo formal `users.id` ↔ `auth.users.id` (FK cross-schema) — *endurecimento opcional;
      não bloqueia o MVP (o vínculo já é garantido em código)*
- [ ] **NFC-e fiscal** (SEFAZ + certificado) — *fase futura dedicada (não é Fase 2)*

> **Gestão de usuários fecha a Fase 2 (ADR-008):** foi deixada por último de propósito —
> só faz sentido depois do núcleo do MVP (login → cadastros → venda → caixa → estoque →
> relatórios), e não bloqueou nada até aqui porque o primeiro OWNER de cada loja nasce do
> script de **bootstrap** (invite-only). Agora entra como o item de fechamento, trazendo
> junto o **RBAC** (o `user_role` já vai no JWT, mas ainda não é verificado). O papel de
> **Super Usuário (fabricante)** NÃO entra aqui — é de plataforma (cross-tenant) e vive na
> fase abaixo (ADR-009).

> **Nota de infra:** o cache de leitura do Hyperdrive foi **desabilitado**
> (`--caching-disabled`) para evitar listas desatualizadas logo após uma escrita —
> essencial num ERP/POS. O pooling de conexão segue ativo.

---

## 🟠 Fase 2.5 — Plataforma: multi-loja, Super Usuário e onboarding — **Concluída (A–E, Fatia E read-only)**

> Capacidades de **plataforma** que **cruzam o limite do tenant** (a fronteira de segurança
> via RLS). Separadas da Fase 2 de propósito: não são necessárias para uma loja operar e
> mexem no modelo de isolamento — ver **ADR-009**. Assentam sobre o RBAC da Fase 2 (ADR-008).

> **Decisões travadas (2026-07-02, ver `docs/plano-fase-2.5.md`):** onboarding **provisionado
> pelo Super Usuário** (sem signup público); identidade = **tabela `platform_admins` + claim
> `is_platform_admin`**; acesso cross-tenant por **rotas `/platform/*` dedicadas** (RLS de loja
> intacto). Execução em fatias A–D.

- [x] **Fatia A — Super Usuário (identidade + acesso cross-tenant)** — papel de plataforma **fora**
      do `UserRole` por-tenant: tabela `platform_admins` (verdade) + claim `is_platform_admin`
      (atalho de UI, via hook estendido). Middleware `requirePlatformAuth` (autoriza pela tabela),
      rotas `/platform/me` e `/platform/tenants`, script `create-platform-admin.mjs`. Migration
      `0005_platform_admin` (aditiva) aplicada + Worker publicado + **E2E 10/10** (2.5.A). Falta a
      **auditoria de plataforma** (Fatia D).
- [x] **Fatia B — Onboarding de loja (API)** — `POST /platform/tenants` cria `Tenant` + convida o
      primeiro **Admin** (`OWNER`) reusando o convite por e-mail (`inviteAuthUser` extraído p/
      `lib/authAdmin.ts`). `createTenantSchema` + `slugify` (shared); unicidade `slug`/`cnpj` (409);
      transação com `AuditEvent CREATE_TENANT`. **Sem migration.** API publicada (Version `ff3889d4`)
      + **E2E 12/12** (2.5.B). Falta o E2E do **e-mail real** (fica na Fatia C, com o navegador).
- [x] **Fatia C — Painel de gestão de lojas** (UI `/plataforma`, exclusivo do Super Usuário) —
      área separada do shell `(app)` com guard próprio (`GET /platform/me`); lista lojas + form
      "Nova loja" (`POST /platform/tenants`) + ativar/inativar (`PATCH /platform/tenants/:id` +
      `AuditEvent SET_TENANT_ACTIVE`). Login roteia por papel (`tokenIsPlatformAdmin`): super
      usuário → `/plataforma`. API Version `76fe3134` + web `05a05fc4`; E2E PATCH 7/7 + UI validada
      no navegador (2.5.C). *Entrar no contexto de uma loja p/ suporte = futuro (fatia própria).*
      **E2E do usuário validado (2026-07-05):** criar loja com e-mail real → convite → 1º Admin
      define senha → entra; ativar/inativar por linha.
- [x] **Exclusão de usuário da loja (ADR-008)** — `DELETE /users/:id` (Admin): apaga a linha em
      `users` **+ revoga a identidade no Supabase Auth** (`deleteAuthUser`, libera o e-mail para
      novo convite) **+ `AuditEvent DELETE_USER`**. Bloqueia excluir a si mesmo/o `OWNER`; usuário
      **com histórico** (pedidos/caixa — FKs sem cascade) → **409** orientando a *Desativar*
      (preserva integridade + auditoria). Botão **Excluir** na seção Usuários de `/configuracoes`.
      **Sem migration.** Typecheck API + web ✅. Worker publicado (Version `9f86b36c`) + **E2E no
      navegador validado pelo usuário (2026-07-05)**: excluir sem histórico some da lista + libera o
      e-mail; com histórico → 409 *Desativar*; `DELETE_USER` gravado. Pré-requisito da Fatia D (liberar
      o e-mail de teste).
- [x] **Fatia D — Auditoria de plataforma** — eventos `CREATE_TENANT` e `SET_TENANT_ACTIVE`
      (e `DELETE_USER`, de loja) **formalizados na lista fechada do ADR-004** (`meta.platform = true`;
      `userId` = Super Usuário; `tenantId` = loja-alvo) e **ADR-009 fechado** (Fatias A–D). **Sem
      migration, sem deploy** (só documentação).
- [x] **Endurecimento — bloqueio de loja desativada (ADR-009)** — desativar a loja (`SET_TENANT_ACTIVE`)
      passou a ter efeito real: `requireAuth` carrega `Tenant.isActive` → `tenantActive` no contexto;
      `GET /me` devolve o flag; novo middleware `requireActiveTenant` barra `POST /orders` (nova venda)
      com **403** quando inativa. Front: **aviso vermelho no topo** de toda tela (`(app)/layout`) +
      tela de **Nova Venda bloqueada**. Consultas/fechar caixa/cancelar/devolver seguem liberados (a
      loja ainda "encerra" pendências). Bloqueio aplicado a **novas vendas** (`POST /orders`),
      **abertura de caixa** (`POST /cash-sessions/open`) e **entrada de estoque** (`POST
      /stock/movements`); fechar caixa, ajuste de inventário, cancelar/devolver e consultas seguem
      liberados (ações de encerramento/correção). O aviso do topo lista as três operações. **Sem
      migration.** API `daf90038` + web `533c1921`; typecheck API+web ✅. **E2E no navegador validado
      pelo usuário (2026-07-05)**: inativar no painel → aviso vermelho + 3 operações bloqueadas (403) →
      reativar → volta ao normal.
- [x] **Fatia E — Entrar no contexto da loja para suporte (impersonation auditada)** — **read-only
      (2026-07-05)**. Token de suporte assinado e curto (HS256, secret `SUPPORT_TOKEN_SECRET`, TTL
      30 min) de escopo `{ platformAdminId, targetTenantId, exp }` — **não** login do lojista;
      emitido por `POST /platform/tenants/:id/support`. Rotas **`/support/*`** (fora de `/platform/*`)
      com `requireSupportSession` (verifica o token + revalida `platform_admins.isActive`): `GET
      /support/:tenantId/overview` + `POST /support/end`; RLS de loja **intacto** (fronteira =
      checagem explícita). Auditoria `SUPPORT_SESSION_START/END` (`meta.support = true`) na lista do
      ADR-004. UI: botão **Entrar (suporte)** em `/plataforma` → `/plataforma/suporte/[tenantId]`
      (banner "somente leitura" + overview + encerrar). **Sem migration.** Typecheck API+web ✅;
      build ✅ (nova rota); core 35/35. **No ar:** secret `SUPPORT_TOKEN_SECRET` provisionado + API
      (Version `1e323a22`) + web (Version `c13a34de`) publicados + smoke em produção ✅ (rotas exigem
      auth; `Bearer` inválido → 401, não 503, confirmando o secret). **Painel de suporte navegável
      (2.5.E.2, read-only):** a tela virou **3 abas** — Resumo, **Vendas** (filtro período/status +
      "Ver" itens/pagamentos) e **Produtos & Estoque** (busca nome/SKU + "só estoque baixo" +
      movimentações por material). 3 rotas de leitura novas (`/support/:id/orders|products|
      stock-movements`), API Version `1397654d` + web `d3f54d16`. **E2E no navegador validado pelo
      usuário (2026-07-05)** — sessão de suporte, abas/filtros/detalhes e read-only conferidos.
      **Escrita em modo suporte** (exceção auditada) fica como fatia futura — ADR-009.

---

## 🟣 Fase 3 — Recursos Avançados e Produção — **Em andamento**

- [x] **Fatia 3.A — PWA instalável + cache de app-shell** — `apps/web` virou PWA instalável
      (adicionar à tela inicial no celular/desktop). `app/manifest.ts` (`/manifest.webmanifest`),
      ícones (192/512 + maskable + apple-touch, gerados via sharp: "N" verde sobre `#111827`),
      metadata PWA (theme-color/apple-web-app) no `layout`, **service worker** (`public/sw.js`)
      de casca — **só GET same-origin** (API/Supabase passam direto pela rede, nunca cacheados;
      navegações network-first), registro **gated a produção** (`RegisterSW`), botão **"Instalar
      app"** (`beforeinstallprompt`) e página **`/offline`**. **Sem migration, sem API.** Typecheck
      web ✅; build ✅ (17 rotas: `/manifest.webmanifest` + `/offline`); smoke no navegador (manifest/
      ícones/meta/sw.js/offline) ✅. **No ar:** `npm run deploy` (web Version `1f290a7d`) + smoke em
      produção ✅. **E2E de instalação validado pelo usuário (2026-07-06)** — instalou com sucesso nas
      **3 plataformas** (Android, iPhone e PC). *(3.A)* **Fatia 3.A concluída.**

  > **ℹ️ Atualização do PWA (não precisa reinstalar):** um PWA instalado é um atalho para o app no
  > ar, não um pacote congelado. Todo `npm run deploy` é pego no **próximo carregamento** com
  > internet, porque as navegações são *network-first* e os assets do Next têm nome com hash (build
  > novo = arquivo novo). O `sw.js` se atualiza sozinho (`skipWaiting` + `clients.claim`); às vezes
  > a versão nova só "assume" no **2º abrir** (a 1ª abertura baixa em segundo plano). **Única
  > exceção:** trocar **ícone/nome** (vêm do manifest) pode exigir remover e readicionar à tela
  > inicial — sobretudo no **iPhone**, que segura o ícone antigo. Mudanças de código/tela/API: só
  > reabrir o app.
- [x] **Fila de sincronização offline — só VENDA, atrás de flag por loja — CONCLUÍDA e validada
      (2026-07-10)**. **ADR-011 escrito e
      ACEITO (2026-07-06)**. Estratégia travada (Outbox no cliente; **idempotência pela PK UUID do
      cliente**, sem tabela nova no 1º corte; servidor reaplica a venda em transação única e debita
      estoque no sync, ADR-001; append-only=dedup; `tenantId` validado contra o JWT, RLS intacto).
      **Decisões de produto aprovadas:** (a) estoque — trava **na venda** (cache local, como online);
      no resíduo do sync, **registrar e deixar negativo** p/ reconciliação (não rejeitar venda
      física concluída); (b) **1ª fatia = venda**, depois estoque e caixa, cadastros mutáveis por
      último; (c) **feature flag `OFFLINE_SALES` por loja via `TenantModule`** (sem migration),
      **nasce DESLIGADO** (ausência da linha = OFF), ligável pelo Super Usuário no painel
      `/plataforma` — recurso de **plano pago**; com o flag OFF e sem energia/internet, o plano B é
      **nota manual**. Como a fatia é só venda (append-only), **não há tela de resolução de
      conflito** neste corte. **Implementada e validada em produção (Fatias 1–6):** flag na ponta →
      envelope + `outbox` → worker de fila → `POST /orders` idempotente por PK → core+testes (47/47) →
      indicador de pendentes. **Sem migration** (AI 10). E2E ON + OFF + idempotência conferidos. Ver
      3.B/3.C/3.D no registro de testes.
  - [x] **Fatia 1 — flag `OFFLINE_SALES` + avisos (AI 4) — CONCLUÍDA e validada (2026-07-09)**.
        Interruptor por loja reusando `TenantModule` (**sem migration**; ausência/inativa = OFF).
        `packages/shared/modules.ts` (`MODULE_OFFLINE_SALES` + `isOfflineSalesOn` + `setTenantModuleSchema`);
        `GET /me` devolve `offlineSales`; `PATCH /platform/tenants/:id/modules` (upsert + `AuditEvent
        SET_TENANT_MODULE`, formalizado no ADR-004); toggle "Offline (pago)" no painel `/plataforma`;
        aviso de conexão no PDV/Caixa (`OfflineSalesNotice` + hook `useOnline`, só offline —
        OFF=nota manual / ON=recurso habilitado). Escopo: **só ler o flag + aviso** (a `outbox` real
        é a Fatia 2). Refinos após o E2E: aviso também no **caixa fechado** + botão "Abrir caixa"
        desabilitado offline (abrir caixa é online-only nesta fatia); erro cru de rede
        ("Failed to fetch") escondido offline (3.B.1/3.B.2). **No ar + E2E validado pelo usuário:**
        API `0b8c0348` + web `c35f8592`. Ver 3.B no registro de testes.
  - [x] **Fatia 2 — envelope de mutação + store `outbox` no IndexedDB (AI 5) — CÓDIGO PRONTO
        (2026-07-10)**. Infra do cliente (sem migration, sem API). Formato do envelope
        (`kind`/`entityId` UUID/`schemaVersion`/`payload`/`createdAt`) + `mutationEnvelopeSchema` +
        builder puro `buildSaleMutation` em `packages/shared/src/outbox.ts` (contrato compartilhado,
        idempotência pela PK, ADR-011 §2). Store `outbox` no IndexedDB (`apps/web/lib/outbox.ts`):
        FIFO por `seq` autoincremental, índice único `entityId` (dedup de enfileiramento), índice
        `status`; `enqueue`/`list`/`peekPending`/`countPending`/`markSynced`/`markError`/`remove`.
        Flag `OFFLINE_SALES` persistido em `localStorage` (`offlineFlag.ts` + `useMe` expõe
        `offlineSales` efetivo com fallback no cold start offline; `/venda` e `/caixa` usam-no).
        **Infra dormente/aditiva** — o PDV **ainda não enfileira** (isso pareia com o worker, Fatia 3),
        então o caminho vivo da venda não muda. Typecheck shared/api/web + build (17 rotas) + core
        35/35 ✅. **Deploy opcional** (nada user-observable ainda). Ver 3.C no registro de testes.
  - [x] **Fatias 3–6 — round-trip da venda offline NO AR e VALIDADO (2026-07-10).**
        Ciclo completo: PDV enfileira offline → worker drena ao voltar a rede → servidor aplica
        idempotente por PK. **Sem migration** (AI 10 avaliado: dedup usa a PK existente; estoque
        negativo permitido pelo tipo). **E2E validado em produção** (loja-demo ON): offline→enfileira→
        online→sincroniza; venda `#981d99d6` com a mesma PK, autoria "owner", estoque 258→256;
        **reenvio não duplica** (dedup por PK, estoque segue 256). Dois achados corrigidos (3.D.1):
        indicador de pendentes atualiza após enfileirar; copy do aviso ON. API `897d5524` + web
        `c74bbc5f`; core 47/47. Ver 3.D no registro de testes. Detalhe por fatia:
    - [x] **Fatia 3 — worker de sincronização (AI 6)** — `apps/web/lib/syncWorker.ts` drena FIFO
          (gatilhos `online`/foreground/montagem/botão via `useOutboxSync`), **para na 1ª falha**,
          retry só transitório. PDV enfileira quando **offline + recurso ON** (UUID no cliente +
          baixa otimista no cache local + tela "Salva offline — pendente").
    - [x] **Fatia 4 — `POST /orders` idempotente por PK (AI 7)** — `id` presente ⇒ venda offline:
          dedup por `orders.id` (no-op devolve a persistida), caixa vem do envelope (validado
          tenant+user), **estoque insuficiente não bloqueia** (registra e deixa negativo p/
          reconciliação, §6). Online intacto (gera PK, mantém bloqueio de estoque). `tenantId`/autoria
          do JWT (§7). **Sem migration.**
    - [x] **Fatia 5 — máquina de estados em `packages/core` (AI 8)** — `classifyHttpOutcome`
          (409=dedup=SYNCED), `classifyNetworkError`, `shouldRetry`/`MAX_SYNC_ATTEMPTS`,
          `syncBackoffMs` (exp., teto 30s), `haltsQueue` — **+12 testes Vitest** (47/47).
    - [x] **Fatia 6 — indicador de pendentes (AI 9)** — "X vendas pendentes" + "Sincronizar agora"
          no PDV + rótulo por venda offline. *Tela de `CONFLICT` segue adiada (venda é append-only).*
  - [x] **Refinos da fila offline (3.E) — NO AR e VALIDADO (2026-07-11)**. Três pontas soltas da venda
        offline, **só cliente** (sem migration/API): **(1) drenagem global** — o worker saiu de dentro
        do `/venda` para o shell `(app)` via `OutboxSyncProvider` (instância única) + **chip de status
        no topo** (aparece só com fila não-vazia; vermelho=falha/índigo=pendente); drena em qualquer
        tela quando a rede volta. **(2) poda de `SYNCED`** — `pruneSynced()` no fim do dreno (fila não
        cresce sem limite). **(3) tela `/pendencias`** — lista a fila (inclui `FAILED`, que sumia do
        contador) com **Tentar novamente** (`requeue`) e **Descartar**. Pub/sub na `outbox`
        (`subscribeOutbox`) mantém chip/PDV/tela em sincronia. Typecheck + build (**18 rotas**) + core
        47/47 ✅. **No ar:** web `3921af94` (+ `300254fc` do `error.tsx`) + smoke ✅. **E2E validado
        pelo usuário (2026-07-11)** no PWA do macOS: chip global + drenagem + vendas registradas
        (`#2f0d11b0`/`#7bfa4d01`). **Achados do E2E:** (3.E.1) navegar **offline entre telas** dava tela
        branca (chunk não cacheado) → mitigado com `(app)/error.tsx` (mantém shell/chip + aviso);
        (3.E.2) offline após remontar, o PDV assume "caixa fechado" (não lê `sessionId`/catálogo sem
        rede) — ambos são a lacuna de offline-first de leitura (fatia própria), não do refino. Ver
        3.E/3.E.1/3.E.2 no registro.
  - [x] **Cold-start / offline-first de LEITURA — fatia própria — CONCLUÍDA e VALIDADA (CS-1…CS-5, ver
        cabeçalho).** **Problema original (achados 3.E.1/3.E.2):** offline, `GET /me`, `/cash-sessions/current`
        e `/products` falham (API cross-origin, nunca cacheada — ADR-011 §7). A venda offline de 3.D só
        funciona porque `sessionId` + produtos ficam **em memória** enquanto o operador **não sai do
        `/venda`**; ao **navegar/remontar/reabrir offline**, essa memória se perde → PDV assume "caixa
        fechado" e catálogo vazio; e navegar para rota sem chunk cacheado quebra (hoje mitigado por
        `(app)/error.tsx`). **Meta:** o PDV segue **vendável offline** após remontar/reabrir. **Tudo no
        cliente — sem migration, sem custo de free tier** (IndexedDB/localStorage/SW cache no aparelho).
    - [x] **Passo 0 — ADR-012 escrito e ACEITO (2026-07-11)** (regra 4 cumprida). 5 decisões (a)–(e)
          aprovadas pelo Owner (`docs/adr/ADR-012-cold-start-offline-first-leitura.md`; índice do
          README das ADRs atualizado). Decisões travadas:
          (a) **validade do cache** offline — confiar no último snapshot conhecido enquanto offline,
          sempre preferir a rede online, e **rotular "dados de HH:MM"** quando servir do cache;
          (b) **caixa fechado no servidor durante o offline** — a venda offline referencia um
          `cashSessionId` que pode ter sido fechado noutro dispositivo: **anexar mesmo assim** (a venda
          ocorreu fisicamente naquele turno; divergência aparece na reconciliação) **ou** rejeitar →
          `FAILED` (tela de pendências); (c) **quais rotas são "offline-capable"** (venda + caixa-leitura
          no mínimo; histórico/estoque a decidir) para escopar o precache do SW; (d) **estoque offline**
          = último cache + baixas otimistas locais, reconciliação no sync (já ADR-001/ADR-011 §6);
          (e) **abrir caixa NOVO segue online-only** (âncora financeira) — cold-start cobre "caixa **já
          aberto**", não abrir um do zero sem rede.
    - [x] **Fatia CS-1 — cache do caixa aberto — CÓDIGO PRONTO (2026-07-11)** (pequena). Nova lib
          `apps/web/lib/cashSessionCache.ts` persiste `{ id, openedAt, openingAmount, openedByName,
          cachedAt }` em `localStorage` a cada `GET /cash-sessions/current` com caixa; **limpa** quando
          vier `null` (fechado online). Online a **rede sempre vence** (sobrescreve/limpa, decisão (a));
          offline, `/venda` e `/caixa` leem o cache → PDV reconhece o caixa aberto e recupera o
          `sessionId` p/ enfileirar, com rótulo **"dados de HH:MM"**. `/caixa` offline mostra card
          enxuto (sem "Abrir caixa", online-only). **Sem migration/API.** Typecheck + build (18 rotas)
          ✅; core 47/47 (não tocado). **NO AR (web `b55d670f`) + E2E validado pelo usuário (7/7,
          2026-07-11).** Ver 3.F.CS-1 no registro.
    - [x] **Fatia CS-2 — cache do catálogo de produtos — CÓDIGO PRONTO (2026-07-11)** (média). Abridor
          compartilhado extraído p/ `apps/web/lib/db.ts` (dono da versão do IndexedDB `nexoloja` +
          cria os stores num só `onupgradeneeded`); **bump `DB_VERSION`→2** adiciona o store `catalog`
          (upgrade v1→v2 preserva a `outbox`; **sem migration de servidor**). Nova lib
          `apps/web/lib/catalog.ts` (`cacheProducts`/`readCachedProducts`): a cada `GET /products` OK a
          rede vence e **sobrescreve** o espelho; offline, `/venda` monta o carrinho do cache (estoque =
          último conhecido − baixas otimistas, que agora fazem **write-through** no cache). `outbox.ts`
          refatorado p/ usar o `db.ts` (mantém `hasOutbox` como alias). Typecheck + build (18 rotas) ✅;
          core 47/47 (não tocado). **NO AR (web `b55d670f`) + E2E validado pelo usuário (7/7,
          2026-07-11).** Com CS-1 + CS-2, o PDV fica **vendável offline após remontar/reabrir** (ficando
          no `/venda`). Ver 3.F.CS-2 no registro. **Refino 3.F.CS-2.1 (web `a4cebe57`):** aviso de rede
          amigável (`OfflineNotice`) nas 5 telas online-only (Produtos/Estoque/Clientes/Relatórios/
          Histórico) no lugar do "Failed to fetch" cru — decisão (c) do ADR-012.
    - [x] **Fatia CS-3 — navegação offline entre telas — VALIDADA pelo usuário (2026-07-11)** (spike
          concluído). **Achado do spike:** a client-nav do Next (`<Link>`) busca o **RSC** (`?_rsc=`) pela
          rede — o SW não intercepta e falha offline; a **navegação real** (full load) embute o RSC no
          HTML e o SW serve documento + chunks do cache. Correção = **navegação por reload** offline
          (fallback pré-aprovado). `apps/web/app/(app)/OfflineNav.tsx` (interceptor de clique em captura:
          offline → `location.assign`; online = no-op) + **Service Worker v3** que **aquece o shell de
          todas as 9 telas do menu** (`warmRoutes` busca o HTML e cacheia documento + chunks `/_next/static/`;
          cache `STATIC` não-versionado sobrevive a deploys). Cópia dos error boundaries ajustada (viram
          rede de segurança). Typecheck + build (**18 rotas**) + core 47/47 ✅. **Substitui o paliativo do
          `error.tsx` pelo caminho real. NO AR + E2E validado pelo usuário** (offline: navega por todas as
          telas sem tela branca/`/offline`/`global-error`; online-only mostram banner "Sem conexão" com
          menu; Venda/Caixa/Pendências operam do cache). **3 achados corrigidos durante os E2E:** (.1)
          `router.prefetch` não cacheava o JS + bump do SW apagava chunks → SW v3 (`warmRoutes` + cache
          `STATIC`); (.2) tela online-only caía no beco `/offline` → aquecer todas as telas do menu; (.3)
          item **Configurações** sumia offline (`/me` falha → `isAdmin` false) → `lib/meCache.ts` cacheia o
          `/me` p/ o shell offline. Web Version `624912fe`. Ver 3.F.CS-3 (+ .1/.2/.3) no registro.
    - [x] **Fatia CS-4 — semântica de caixa fechado no sync — NO AR e VALIDADA (2026-07-11/12)** (decisão
          (b), a única sub-fatia que toca o servidor, **sem migration** — `AuditEvent.action` é String
          livre). `POST /orders` idempotente: no ramo offline detecta caixa **fechado** (`session.closedAt`)
          e, além de anexar (já anexava), grava **`AuditEvent SALE_ON_CLOSED_CASH`** (marca de
          reconciliação, não bloqueia). `GET /reports/cash-sessions` agrega as marcas por sessão
          (`lateSalesCount`/`lateSalesTotal`); a UI `/relatorios` mostra badge "N após fechamento · R$…"
          na linha do caixa. `SALE_ON_CLOSED_CASH` formalizado no ADR-004. Shared/api/web typecheck +
          build (18 rotas) + core 47/47 ✅. **NO AR (API `94f277ea` + web `ae5296b5`).** **E2E validado**
          (dois contextos: PWA offline registra a venda; aba anônima fecha o caixa; PWA sincroniza → venda
          entra + badge no relatório). Verificação de estoque da venda `#c0d0b8b9` (CASH R$370): Cimento
          **240 → 230**, débito atômico (ADR-001) intacto — a marca **não** afeta estoque/validade da
          venda. Ver 3.F.CS-4 no registro. **Com a CS-4, o ADR-012 (cold-start / offline-first de leitura)
          está CONCLUÍDO ponta a ponta (CS-1…CS-4).**
    > **Ordem de valor:** CS-1 + CS-2 entregam o essencial (PDV vendável offline após remontar, sem
    > navegar). CS-3 adiciona a navegação offline entre telas. CS-4 endurece a borda do caixa fechado.
    - [x] **Fatia CS-5 — "esperado ajustado" e divergência recalculada no relatório de fechamento
          (melhoria da conferência da CS-4) — CÓDIGO PRONTO (2026-07-13)**. Fecha a conta que o dono fazia
          na cabeça (ver 3.F.CS-4: caixa `8bda91ce` esperado R$893,20 + venda tardia CASH R$370 = R$1.263,20).
          **Implementado, sem migration:** (1) `POST /orders` enriquece o `meta` do `SALE_ON_CLOSED_CASH`
          com **`cashAmount`** (parcela CASH da venda — evita join nos `payments`); (2) função pura
          **`calcAdjustedCashClosing`** em `packages/core` (`adjustedExpected = expected + lateCashSalesTotal`,
          `adjustedDivergence = closing − adjustedExpected`) **+4 testes Vitest (47→51)**; (3)
          `GET /reports/cash-sessions` acumula `lateCashSalesTotal` (**só o DINHEIRO** — cartão/PIX conciliam
          na maquininha; **fallback ao `total`** p/ marcas antigas sem `cashAmount`) e devolve
          `adjustedExpected`/`adjustedDivergence`; (4) `CashSessionReport` (`packages/shared`) estendido; (5)
          UI `/relatorios` mostra "ajust. R$…" sob Esperado e Divergência quando há venda tardia em dinheiro.
          **NÃO reescreve o dado congelado** do fechamento (auditoria) — só exibe o cálculo pronto; o caixa
          fechado segue imutável e a venda tardia legítima **não** se devolve (ADR-006). Core 51/51 + api
          tsc + web typecheck/build (18 rotas) ✅. **NO AR (API `dedff652` + web `8e398cfd`) + conferido no
          navegador** (linha "ajust." aparece usando o dado da CS-4, fallback ao `total`). **Adendo (mesmo
          dia): responsável do caixa no relatório** — `GET /reports/cash-sessions` mapeia
          `openedByName`/`closedByName` (ADR-010, sem migration) e a UI mostra um **popover na célula
          "Fechado em"** (`CashSessionSummary`) com abertura/fechamento + quem abriu/fechou — **hover no
          desktop + toque no celular/PWA**, `position: fixed` (não é cortado pelo overflow da tabela), fecha
          ao tocar fora/Esc/rolar; não duplica as colunas financeiras. No ar (API `3c926d4c` + web
          `ac7c5b14`). Ver 3.F.CS-5 no registro.
- [x] **Módulo de ESTOQUE FINO + enriquecimento do cadastro de Produto — CONCLUÍDO (EF-1 → EF-2 → EF-3,
      todos no ar e validados; ver cabeçalho).** Decisão travada: **estoque/caixa seguem
      ONLINE-ONLY** (mutação offline adiada — ver a nota da decisão no topo do arquivo). Boa parte dos
      campos pedidos **já existe no schema** e não precisa de migration; falta só a UI + validação. Mapa
      do que **já existe** vs. **novo** (conferido em `packages/db/prisma/schema.prisma`, `model Product`):
      - `description VarChar(500)` → **já existe** (observação/descrição) — só falta na tela.
      - `weightKg Decimal(8,3)` → **já existe** (peso; 3 casas cobrem gramas). "kg/g" é **toggle de UI**,
        guardando canônico em **kg** (mesmo padrão de CNPJ/telefone: banco canônico, UI formata).
      - `unit UnitType` → **já existe** (UNIT / METER / SQUARE_METER / CUBIC_METER / KILOGRAM / LITER /
        THOUSAND / BAG / ROLL) — só falta expor o seletor no cadastro.
      - **apelido** → **NÃO existe** → coluna nova (a única migration da EF-1).
      - **segundo preço** (rolo fechado) → **NÃO existe** (`conversionFactor` existe, mas sem preço próprio) → EF-3.
  - [x] **EF-1 — Cadastro de produto enriquecido** *(rápida; 1 migration aditiva)* — **COMPLETO e NO AR (2026-07-15).**
    - [x] **Apelido/nome popular + BUSCA** — FEITO. Renomeamos `nickname`→**`popularName`** (`VarChar(150)`,
          nullable, sem RLS); **migration `0007` aplicada**; índice `products_tenantId_popularName_idx`. Busca por
          **nome + nome popular + SKU** nas telas Produtos e Venda (`productMatchesQuery` no core, +7 testes). **Bônus:**
          leitura de **código de barras** (o `sku` é o código) — Enter-scan (leitor físico) + `BarcodeScanButton` (câmera,
          `BarcodeDetector` + `@zxing`). **API + web deployados e validados (no ar).**
    - [x] **Descrição/observação** (`description`, já no banco) — textarea (até 500) no cadastro. **NO AR (2026-07-15).**
    - [x] **Peso** com toggle **kg/g** (canônico em kg — `weightKg` já no banco) — input + seletor kg/g;
          gramas ÷ 1000 no envio (mesmo padrão CNPJ/telefone: UI formata, banco canônico). **NO AR.**
    - [x] **Unidade de venda** (dropdown do `UnitType`, já no banco) — `<select>` com rótulos PT-BR
          (`unitTypeLabels` novo em `packages/shared`, reutilizável no PDV/comprovante). **NO AR.**
    - Sem nova migration (campos já existem) e **sem deploy de API** (a API de 14/07 já aceita os 3 campos —
      `POST /products` repassa `...parsed.data` ao Prisma). **Não toca PDV/estoque transacional.** Gates:
      typecheck web ✅, build web (18 rotas) ✅, core 58/58 ✅. **Web deployado** (Version `4baf2760-…`) +
      **E2E do usuário validado** (Metro/250 g→0,25 kg/descrição persistiram — ver registro). **EF-1 fechado.**
  - [x] **EF-2 — Estoque fino (online-first)** *(sem migration)* — **COMPLETO e NO AR (2026-07-15).** Deu
        superfície ao que já existia no core, usando `StockMovement`/`minStockQty`. Online-first — **não toca a
        fila offline**.
    - [x] **Fatia 1 — Painel de reposição** — Card no topo da tela de Estoque que junta num lugar só tudo que
          está no ponto de reposição (saldo ≤ mínimo, mínimo > 0), com **badge zerado/baixo**, **sugestão de
          compra** (quanto falta p/ o mínimo) e ordenação (zerados primeiro, maior falta no topo). Funções puras
          novas no core **`isLowStock`** + **`replenishmentShortfall`** (+10 testes → **68/68**), reusadas também
          no badge e na tabela (removida a duplicação da regra inline). Só front (web `42314d77`). **E2E
          validado** (Cimento baixo +70; Mouse zerado +5; dados de teste revertidos após a demo).
    - [x] **Fatia 2 — Visão consolidada por produto (saldo × mínimo × histórico)** — a tabela "Estoque atual"
          ganhou colunas **Entradas** (Σ INCOME), **Saídas** (Σ EXPENSE) e **Saldo (hist.)** = Σ entradas − Σ
          saídas, com **aviso ⚠ quando diverge** do `stockQty` (consistência do cache, ADR-001). Clicar no
          produto **filtra as movimentações** daquele item (liga saldo ↔ histórico). Novo endpoint agregado
          **`GET /stock/summary`** (Prisma `groupBy`+`_sum`, cost-zero — não trafega o histórico inteiro). Sem
          migration; **deploy de API** (Version `d1f6799a`) + web (`3523dd7c`). **E2E validado** — Argamassa
          confere (55−6=49); o ⚠ **capturou divergências reais no seed** (Cimento 230≠200, Tijolo 955≠905) e o
          clique no produto filtrou o histórico. *(ver EF-2 fatia 2 no registro)*
  - [x] **EF-3 — Venda em unidade alternativa** *(complexa; ADR próprio)* — **COMPLETO, NO AR e VALIDADO
        (2026-07-16).** Vender o mesmo produto **por metro** OU como **rolo fechado**, com **preços
        diferentes** (o rolo sai mais barato por metro). **ADR-013 (Opção A, aprovada):** segundo preço
        reusando `conversionFactor`; **2 migrations aditivas** — `0008` (`products.altUnit`/`altSalePrice`)
        e `0009` (`order_items.baseQuantity`, snapshot p/ o estorno em unidade-base ser robusto a mudança
        de fator). **Core:** `hasAltUnit`/`resolveSaleUnit`/`toBaseQuantity`/`effectiveBaseUnitPrice`
        (**+14 → 82/82**). **API `POST /orders`:** baixa e `StockMovement` em unidade-base (`qtd × fator`),
        `OrderItem` grava `baseQuantity` + unidade vendida; **cancelar/devolver** estornam em base
        (`baseQuantity ?? quantity`, cobre pedidos antigos). **Web:** cadastro ganhou o bloco "unidade
        alternativa"; PDV mostra botões **base × embalagem**, carrinho com a base equivalente e trava de
        estoque em base (`saleMode` no payload online+offline); **comprovante** imprime a embalagem
        ("Fio — Rolo (100 m)"). Cache do catálogo estendido. **No ar:** API `4f19776c` + web `98453ac5`.
        **E2E validado:** fio metro R$2 / rolo 100 m R$150 (estoque 500) → venda metro Saída 5; venda rolo
        (2×) Saída **200**; cancelamento Entrada **200** (não 2!); saldo 495. Casos extras (margem efetiva,
        dois modos no mesmo carrinho, produto comum inalterado) OK.
- [ ] Otimização do pooler (6543) para limites do free tier
- [ ] Avaliar upgrade Supabase Pro p/ produção

---

## 📌 Notas / decisões em aberto

### ▶️ Pendências para a próxima sessão (deixadas após o EF-3, 2026-07-16)

> Nenhuma bloqueia produção. **Não há deploy pendente** — API `4f19776c` + web `98453ac5` estão no ar e
> commitados (`4802a63` código + `c794811` docs). Ordem sugerida:

1. [x] **Reconciliar as divergências de estoque do seed (rotina do ADR-001).** ✅ **FEITO (2026-07-16).**
       Nova rotina geral `packages/db/scripts/reconcile-stock.mjs` (dry-run por padrão; `--apply` corrige;
       `--tenant <slug>` opcional) recalcula `stockQty = Σ INCOME − Σ EXPENSE` e alinha o cache. No dry-run,
       além de **Tijolo 955→905** e **Cimento 220→190** (o Cimento havia andado desde o snapshot — era 230→200;
       mais uma saída de 10 no meio), apareceu um **3º caso**: soft-deleted **Cimento CP-II (CIM-50) 120→0**
       (estoque-fantasma, zero movimentos). Aprovado e aplicado nos 3; verificação pós-apply = **0
       divergências**. Só corrigiu dado (UPDATE em `products.stockQty`), sem migration/deploy. Ver
       "Reconciliação de estoque do seed" no registro de testes.
2. [x] **Limpar o dado de teste do EF-3.** ✅ **DECIDIDO (2026-07-16): manter.** O produto **"Cabo Flexível
       2,5mm — TESTE 2 EF1"** (estoque 495) + vendas de teste (`f3939b7d` metro, `52408f3e` rolo cancelada)
       ficam **de propósito** no tenant — é a **loja Demo**, servem para futuros testes/demos do rolo. Sem ação.
3. [~] **Itens finais da Fase 3 — LEVANTADOS e DOCUMENTADOS (2026-07-16), execução adiada p/ go-live.**
       Plano completo em **`docs/plano-producao.md`**. Achados:
       - **Pooler:** a premissa "otimizar p/ 6543" estava **invertida** — a Cloudflare recomenda a conexão de
         **sessão (5432)**, não a de transação (6543), pois o Hyperdrive já é um pooler. **O projeto já está
         em sessão/5432** (`aws-1-...pooler.supabase.com`, `origin_connection_limit=20`). Único ajuste real:
         baixar o `origin_connection_limit` **se** aparecer "too many connections". Comentário do
         `wrangler.toml` (que dizia usar `DIRECT_URL`) corrigido.
       - **Supabase Pro:** banco em **12 MB de 500 MB** (o teto está a ~160 mil vendas → anos). Gatilho real
         **não é tamanho**, e sim confiabilidade ao entrar a 1ª loja real: backups diários, sem auto-pause,
         e-mail com marca. Script de medição: `packages/db/scripts/db-size.mjs`.

- **Prisma 6 (não 7):** mantido de propósito por estabilidade de conexão. Não subir sem revalidar a conexão pela edge.
- **Atualizar o wrangler da API (3.114 → 4.x) — ✅ concluído (2026-07-03):** as **duas apps** agora usam **wrangler `4.107.0`** e um **único `workerd 1.20260701.1`** na raiz (meta + binário), **sem binários aninhados** (os `optionalDependencies` de workerd que existiam no web foram removidos — deixaram de ser necessários). A config `wrangler.toml` da API não precisou de mudança (chaves padrão). Validado com `deploy --dry-run` (bindings Hyperdrive/R2/`SUPABASE_URL` ok; secret `SUPABASE_SERVICE_ROLE_KEY` persiste no Worker) + smoke (`/health`, `/db-check` → tenants:2, `/me` 401). Ver "Infra.WranglerV4" no registro de testes.
- **Migrations no Supabase:** usar `migrate diff` + `migrate deploy` (o `migrate dev` tropeça no *shadow database* do free tier).
- **Auth:** credenciais são do Supabase Auth; a tabela `users` não guarda senha.
