# ADR-041 — Carga inicial do catálogo: planilha, cadastro em sequência e cadastro no caixa

- **Status:** **Aceito** (2026-09-30) — dependência `read-excel-file` aprovada; ver "Decisões do Owner" abaixo.
- **Data:** 2026-09-29 (proposta) · 2026-09-30 (aceite)
- **Deciders:** Owner do produto.

> **Decisões do Owner (2026-09-30):**
> 1. **Leitura de `.xlsx` com `read-excel-file`** (opção A). E um **modelo simples de preenchimento**, pronto
>    para ser **enviado ao cliente** (por WhatsApp/e-mail) antes da implantação — o lojista preenche em casa e
>    devolve. O modelo é artefato de primeira classe da Fatia 3, não um detalhe da tela.
> 2. **Cadastro no caixa: operador também pode** ("Cadastrar agora" disponível a qualquer papel com acesso ao
>    PDV). Em contrapartida, **o admin recebe um alerta com os produtos cadastrados no caixa para conferência**
>    (custo, categoria, estoque, nome) — o alerta lista **exatamente** os produtos que nasceram no caixa, não uma
>    heurística "sem custo/sem categoria".
- **Contexto de fase:** Horizonte 0, bloco C ("Adoção") do [`PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md) —
  "Importador de catálogo" e "Inventário inicial". Resolve a pergunta em aberto "formato livre com De-Para ou
  template fixo?".

---

## Contexto

O cadastro inicial é a parte mais trabalhosa da implantação. A primeira ideia era "NF-e para os
industrializados + planilha para o resto", mas o Owner apontou (2026-09-29) que **loja pequena nem sempre
recebe XML**: compra no atacarejo como pessoa física, na feira, ou o fornecedor simplesmente não envia. Sem XML,
a planilha teria que carregar também os industrializados — e digitar EAN de 13 dígitos em planilha é onde mais
se erra.

Fontes de catálogo, por tipo de produto:

| Fonte | Cobre | Estado |
|---|---|---|
| XML de NF-e de compra | Industrializados com EAN, custo, fator de embalagem — **quando há XML** | **Já existe** (ADR-025) |
| Cadastro por código de barras + catálogo global | Open Food Facts/Cosmos preenchem nome, marca, foto | **Já existe** (ADR-025), mas como formulário completo, um a um |
| **Cadastro em sequência** (§A) | Industrializados **sem XML** — o grosso do mercadinho | **Esta ADR** |
| **Cadastro no caixa** (§B) | A cauda longa: o que não foi cadastrado na implantação | **Esta ADR** |
| **Planilha** (§1–§6) | Itens sem EAN (sorvete, pratos, granel) **e** exportação de sistema anterior | **Esta ADR** |
| Download automático de NF-e na SEFAZ (§C) | Toda compra com nota no CNPJ da loja, mesmo sem o fornecedor enviar | **Futuro** — fase da NFC-e |

A loja atual não tem sistema anterior, mas os próximos clientes podem ter — e cada sistema exporta com colunas,
nomes e formatos diferentes ("Preço", "PRECO_VENDA", "Vlr. Venda"; "12,50" ou "12.50"; "KG" ou "Quilo").

---

## Decisão

### Princípio: a loja não precisa de 100% do catálogo no dia 1

Num mercadinho, uma fração pequena dos itens responde pela maior parte das vendas. A implantação cadastra os
**~300 que mais giram** (cadastro em sequência); o resto se cadastra **sozinho nas primeiras semanas**, conforme
aparece no caixa (cadastro no caixa). O que nunca vendeu nunca precisou ser cadastrado.

### Motor único de casamento

Todas as portas (planilha, XML, cadastro em sequência, cadastro no caixa) usam a **mesma regra**: casar por
código de barras (`gtinKey`) → código interno → senão cria. As portas em lote (planilha, XML) passam pela mesma
**pré-visualização** (✅ novo / 🔄 atualiza / ⚠️ erro).

---

## A. Cadastro em sequência (celular ou leitor) — **porta principal para quem compra sem XML**

Tela dedicada, pensada para o implantador percorrer a prateleira:

**bipa → catálogo global preenche nome/marca/foto → digita preço e quantidade → Enter → próximo bipe**

- Foco sempre no campo de leitura; só **preço** e **quantidade** pedidos (unidade/categoria opcionais, com a
  última usada lembrada — prateleira costuma ser da mesma categoria).
- Código já cadastrado ⇒ mostra o produto e só pergunta a **quantidade** (vira contagem de abertura).
- A quantidade vira **Entrada de estoque "Carga inicial"** (ADR-001) — cadastro e inventário na mesma passada.
- Lista ao lado com os últimos bipados (desfazer/corrigir o último sem sair do fluxo).
- Ritmo esperado: 15–20 s por item ⇒ ~1.500 itens em 1–2 dias com duas pessoas.
- Reusa o `GET` de catálogo por EAN (ADR-025) e o `POST /products` existente — **sem migration**; a Entrada de
  estoque inicial pode ir na mesma requisição (a decidir na implementação: rota nova ou extensão do `POST`;
  qualquer mudança de contrato ⇒ `DOCUMENTACAO-TECNICA.md` §8.2).
- Funciona no celular (PWA + câmera via `BarcodeDetector`/`@zxing`) e no desktop com leitor USB.

## B. Cadastro no caixa — **a cauda longa se resolve sozinha**

Hoje, bipar um código desconhecido no PDV mostra só "Nenhum produto encontrado."
(`apps/web/app/(app)/venda/page.tsx`). Passa a oferecer **"Cadastrar agora"**:

- Modal mínimo (fila no caixa!): nome já vem do catálogo global; operador digita **só o preço**; o item entra no
  carrinho e a venda segue.
- O produto nasce marcado para revisão (custo, categoria, estoque). A Central de Alertas (ADR-029) ganha o alerta
  **"Produtos cadastrados no caixa para revisar"**, calculado sob demanda (produto sem custo e/ou sem categoria
  criado nos últimos N dias — sem migration se der para derivar dos campos existentes; senão, flag a aprovar).
- Estoque: a venda de produto recém-criado sem estoque **não pode travar**. Opções (decidir na implementação):
  nascer com `trackStock = false` até a revisão ([ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md)),
  ou nascer com Entrada automática da quantidade vendida. Recomendação: `trackStock = false` + alerta de revisão
  (não inventa estoque).
- Permissão: **admin e operador** (decisão do Owner, 2026-09-30), com o alerta de conferência acima para o admin.

## C. Download automático de NF-e na SEFAZ — **futuro, junto da NFC-e**

"Não recebi o XML" quase sempre significa "o fornecedor não mandou por e-mail" — mas a nota emitida contra o
CNPJ da loja **existe na SEFAZ**. Com o **certificado A1** da loja (que a NFC-e já vai exigir) e o provedor
fiscal (ex.: Focus NFe, da branch `feat/nfe-emissao`), dá para baixar automaticamente todas as NF-e recebidas
(Distribuição DF-e / manifestação do destinatário) e jogá-las na importação existente (ADR-025). Não resolve
compra como pessoa física (atacarejo/feira) — para essas, §A e §B. **Registrado aqui; desenho fica para a ADR
de NFC-e.**

## Descartado por ora: foto da nota/cupom com IA (OCR)

Funciona, mas tem **custo por foto** (quebra o custo-zero), erra e exige revisão linha a linha, e a nota de papel
quase nunca traz o EAN — o casamento com o catálogo ficaria fraco. Fica como ideia.

---

## Planilha (§1–§6)

### 1. Uma tela só, dois caminhos: **modelo NexoLoja** ou **qualquer planilha com mapeamento de colunas**

Fluxo em 4 passos, em **Produtos → Importar planilha** (admin):

1. **Enviar arquivo** (`.xlsx` ou `.csv`). Link para **baixar o modelo NexoLoja** já com as colunas certas e
   uma aba de instruções.
2. **Conferir colunas (De-Para).** Cada coluna do arquivo é **casada automaticamente** por apelidos conhecidos
   ("Preço"/"Preco venda"/"Vlr. Venda" → Preço de venda). O operador só corrige o que ficou errado, num select por
   coluna. Com o modelo NexoLoja, este passo já chega 100% preenchido e passa direto.
3. **Pré-visualizar.** Tabela com cada linha marcada ✅ **Novo** / 🔄 **Atualiza** / ⚠️ **Erro** (com o motivo:
   "preço vazio", "código de barras inválido", "EAN repetido na linha 34"). Resumo no topo: "812 novos, 40
   atualizações, 6 com erro". Linhas com erro podem ser puladas ou corrigidas no arquivo e reenviadas.
4. **Importar** com barra de progresso. Ao fim, resumo + opção de baixar as linhas com erro em CSV.

**Mapeamento lembrado:** o De-Para confirmado fica salvo (localStorage da loja) como "perfil" — quem reexporta do
mesmo sistema não remapeia. Perfis prontos por sistema de mercado entram conforme aparecerem clientes.

### 2. Colunas do modelo NexoLoja

| Coluna | Obrigatória | Observação |
|---|---|---|
| Nome | ✅ | |
| Preço de venda | ✅ | Aceita "R$ 1.234,56", "1234,56", "1234.56" |
| Unidade | — | UN (padrão), KG, L, PCT… (apelidos: "Quilo", "Kg", "Litro"). Só as do ramo ([ADR-039](./ADR-039-ramo-da-loja-e-modulos.md)) |
| Código de barras | — | Validado pelo dígito verificador; casado por `gtinKey` (ADR-025) |
| Código interno | — | Vira o `sku`; se vazio, gerado |
| Nome popular, Marca, Descrição | — | |
| Categoria | — | "Sorvetes" ou "Sorvetes > Premium"; criada se não existir |
| Custo | — | |
| Estoque atual | — | Vira Entrada de estoque (ver §4) |
| Estoque mínimo | — | |
| Controla estoque (S/N) | — | Padrão S ([ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md)) |
| Código na balança | — | Só com módulo `SCALE_LABEL` ([ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md)) |
| NCM | — | 8 dígitos; campo aprovado no ADR-040 (2026-09-30), vale para qualquer ramo |

### 3. Casamento idempotente — reimportar não duplica

Cada linha é casada com produto existente por **código de barras (`gtinKey`) → código interno** (mesma ordem da
NF-e, ADR-025). Casou ⇒ **atualiza só as colunas preenchidas** (célula vazia não apaga dado). Não casou ⇒ cria.
A mesma planilha importada 2× dá o mesmo resultado — é a rede de segurança para "deu erro no meio, reenviei".

### 4. Estoque inicial respeita o ADR-001

"Estoque atual" **não** grava `stockQty` direto: gera `StockMovement` de ajuste com motivo **"Carga inicial
(planilha)"** e atualiza o cache na mesma transação. Em produto existente, o movimento é a **diferença** para o
saldo atual (vira a contagem de abertura — o "inventário inicial" do roadmap).

### 5. Onde roda o trabalho (limites do Worker free)

- **Leitura e validação no navegador**, não no Worker: o Worker free tem 10 ms de CPU por requisição (lição do
  `GET /products`). Parse de planilha de 3.000 linhas no servidor estouraria.
- Normalização e validação como **funções puras** em `packages/core`/`packages/shared` (preço BR, unidade por
  apelido, EAN com DV, "Cat > Subcat"), reusadas no cliente e na API, com testes Vitest.
- O cliente envia **lotes de ~100 linhas** para `POST /products/import` (nova rota, admin). Cada lote é uma
  transação (produtos + movimentos); a API revalida com Zod. Idempotente por lote (casamento do §3), então
  retry de rede é seguro. **Rota nova ⇒ `DOCUMENTACAO-TECNICA.md` §8.2 na mesma mudança (regra 7).**
- Um `AuditEvent` `IMPORT_PRODUCTS` por importação (arquivo, contagens), auditoria seletiva (regra 6).

### 6. Quem executa na implantação

No início, **nós importamos** junto com o lojista (implantação acompanhada, ADR-009). Como o modo suporte do
Super Usuário é **somente leitura**, o implantador precisa de acesso real à loja — o caminho limpo é o
**usuário multi-loja** ([ADR-014](./ADR-014-usuario-multi-loja.md)): o Super Usuário concede um vínculo
temporário ao implantador e revoga ao fim. A mesma tela depois vira autoatendimento do lojista.

---

## Dependência nova (regra 4 — a confirmar)

Ler `.xlsx` no navegador exige biblioteca. Opções:

| Opção | Prós | Contras |
|---|---|---|
| **A — `read-excel-file`** (só leitura, MIT) — **recomendada** | Pequena, mantida, só faz o que precisamos; carregada sob demanda (só na tela de importação) | Uma dependência nova |
| B — SheetJS (`xlsx`) | Muito popular, lê tudo | Versão do npm está parada (0.18.5) com vulnerabilidade conhecida; a atual só sai do CDN próprio deles |
| C — Só CSV (sem dependência) | Zero dependência | Lojista precisa "Salvar como CSV" e errar separador/acentuação — atrito justamente na implantação |

CSV é lido sem dependência (parser próprio simples, com aspas, `;` ou `,`, UTF-8/Latin-1).

---

## Consequências

- **Fica mais fácil:** implantar loja com acervo grande em uma tarde; migrar cliente de outro sistema.
- **Fica mais difícil:** manter a lista de apelidos de coluna/unidade (vive em `shared`, cresce com o uso).
- **Fora do escopo:** importar clientes, fornecedores e dívidas (mesmo motor pode servir depois); imagens por
  URL (a foto vem do catálogo global por EAN).

## Fatias

1. **Fatia 1 — Cadastro em sequência (§A)** — porta principal da loja de alimentos; sem migration.
2. **Fatia 2 — Cadastro no caixa (§B)** + alerta de revisão na Central de Alertas. Depende do `trackStock` (ADR-040).
3. **Fatia 3 — Planilha: modelo NexoLoja + CSV/XLSX + pré-visualização + importar** (casamento, estoque inicial, categorias).
4. **Fatia 4 — Planilha: De-Para editável + perfis lembrados** (exportação de sistema anterior).
5. **Futuro:** download automático de NF-e (§C, fase NFC-e); importar clientes/fornecedores; perfis prontos por
   sistema de mercado.

## Relacionadas

- [ADR-001](./ADR-001-consistencia-de-estoque.md) — estoque inicial como movimento.
- [ADR-025](./ADR-025-catalogo-global-ean.md) — `gtinKey`, casamento e enriquecimento por EAN.
- [ADR-014](./ADR-014-usuario-multi-loja.md) — acesso do implantador à loja.
- [ADR-039](./ADR-039-ramo-da-loja-e-modulos.md) / [ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md) — unidades do ramo, controle de estoque, código na balança.
