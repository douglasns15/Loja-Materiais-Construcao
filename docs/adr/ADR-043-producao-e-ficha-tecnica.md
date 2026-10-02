# ADR-043 — Produção com ficha técnica (do cru ao pronto)

- **Status:** **Proposto** (2026-10-02) — aguardando decisão do Owner nas perguntas do fim e aprovação da migration `0044` (regra 1).
- **Deciders:** Owner do produto.
- **Relacionados:** ADR-001 (estoque = `StockMovement` + cache), ADR-027 (custo congelado na venda), ADR-039 (ramo → módulos),
  ADR-040 (venda por peso, `trackStock`, "vendido inteiro também" — §2 já previa: *"quando o módulo `RECIPES` existir
  (produção: frango cru → assado), aí sim a produção vira movimento"*).
- **Mockup:** Artifact "Produção e ficha técnica" (link na conversa de 2026-10-02).

## Contexto

Na rotisseria, a loja **compra o cru e vende o pronto**: recebe a caixa de frango (≈ 20 kg, ~9 frangos), tempera e
assa na máquina; recebe peças de carne, corta por tipo e assa para o fim de semana. Hoje o NexoLoja não liga os dois
lados:

- Se o **pronto** (Frango assado) fica **sem controle de estoque** (ADR-040 §2), a venda não desconta nada e o estoque
  do **cru** nunca baixa — a loja perde a noção do que tem e do que perdeu.
- Se o pronto **controla estoque**, alguém precisa dar entrada nele "na mão" e tirar o cru com um ajuste de
  inventário — dois passos soltos, sem custo, sem rastro de que um virou o outro.

O pedido do Owner (E2E de 2026-10-02): *receber o frango em caixa e controlar o estoque nesse cadastro; vender o
"Frango assado" / "Coxa" — e o estoque do cru tem que baixar.*

## Decisão

### 1. Ficha técnica (receita) por produto pronto

Um produto pronto pode ter **uma** ficha técnica: *"para produzir **N** (na unidade do pronto) de X, uso estes
insumos"*.

| Pronto | Rende | Insumos |
|---|---|---|
| Frango assado (kg, vendido inteiro ≈ 1,2 kg) | 1,200 kg | Frango inteiro cru — 1 un · Tempero baiano — 0,020 kg |
| Picanha assada (kg) | 0,650 kg | Picanha crua — 1,000 kg (rendimento de 65%) |
| Marmita (un) | 1 un | Arroz — 0,150 kg · Feijão — 0,100 kg · Embalagem — 1 un |

- O "rende" absorve a **quebra de cocção** (a carne perde água) sem conceito novo: o operador escreve o que
  acontece de verdade ("1 kg cru vira 650 g").
- Insumo **sem controle de estoque** (tempero a granel, gás) pode entrar na ficha: conta no **custo**, não mexe em
  estoque (mesma regra do ADR-040 §2).
- O pronto **precisa controlar estoque** (é o ponto da produção). Ao salvar a ficha de um produto com
  `trackStock = false`, a tela oferece ligar o controle.
- A ficha mostra o **custo por unidade do pronto** e a **margem** contra o preço de venda — ajuda a precificar.

### 2. Registrar produção = um evento atômico (ADR-001)

Tela **Produção** (menu Estoque): escolhe o pronto, informa **quanto produziu** e confirma. Numa transação só:

- para cada insumo controlado: `StockMovement` **EXPENSE** + `stockQty` decrementado (motivo `Produção P-0008`);
- para o pronto: `StockMovement` **INCOME** + `stockQty` incrementado, com `unitCost` = custo da produção;
- grava o registro da produção (`P-0008`, quem, quando, o que entrou e o que saiu) — o lastro para conferir depois.

Detalhes que vêm do mundo real:

- **Quantidade por peças ou por peso.** Pronto vendido inteiro (ADR-040 §4) aceita "15 peças" e sugere
  15 × peso médio = 18,000 kg; o operador corrige para o peso real da bandeja se pesar.
- **Consumo real editável.** A tela calcula os insumos pela ficha (15 frangos crus, 0,300 kg de tempero), mas
  o operador pode corrigir o que usou de fato (usou 16 porque um estava ruim). A ficha é o ponto de partida, não
  uma trava.
- **Custo do pronto** = Σ (insumo usado × custo do insumo) ÷ quantidade produzida. Atualiza o `costPrice` do pronto
  como **último custo** — a mesma regra da Entrada de estoque (inclusive o aviso "custo ajustado, confira o preço"
  via `priceReviewPendingAt`). Assim a margem dos relatórios (ADR-027) passa a ser real para o que é produzido.
- **Código `P-0001`** sequencial por loja (`Tenant.lastProductionNumber`, mesma mecânica de `V-`/`E-`/`D-`).

### 3. Sobra e perda do dia

O que foi assado e não vendeu vira **perda registrada** (botão "Registrar perda" na tela Produção, com motivo:
sobra do dia, queimou, caiu). É um `StockMovement` EXPENSE no pronto, motivo `Perda — …` — sem tabela nova.
O resumo do dia mostra **produzido × vendido × perda × em estoque** por produto.

### 4. Módulo `RECIPES` (ADR-039)

Novo módulo **"Produção (ficha técnica)"**, ligado pelo preset do ramo **Rotisseria** e ajustável no painel (o
Mercadinho da loja de teste liga à mão). Sem o módulo, nada aparece (ficha, menu Produção). Gating de
apresentação, como os demais.

### 5. Fora desta ADR (registrado para depois)

- **Desmembramento** (1 peça → vários cortes: quarto traseiro → picanha, alcatra, maminha, aparas). É o inverso da
  ficha (1 entra, N saem) e o custo precisa ser rateado entre os cortes (por peso × valor de venda, como se faz no
  açougue). O modelo de dados abaixo **já comporta** (linhas de entrada e de saída num mesmo evento); a tela e o
  rateio ficam para uma ADR própria, se o Owner quiser.
- **Produzir ao vender** (baixa automática dos insumos na venda — lanche montado na hora). Rejeitado como padrão
  (ver alternativas), mas pode virar opção por produto no futuro.

## Alternativas consideradas

- **Baixa automática na venda (backflush)**: vender 1 frango assado baixa 1 frango cru. Mais simples para o caixa,
  mas **esconde o que está pronto**: os 15 frangos na máquina continuam "crus" no sistema até serem vendidos, a sobra
  do dia some sem registro e não dá para saber quantos assados restam. Serve para o que é montado na hora, não para
  produção em lote. Rejeitada como padrão.
- **Dois passos manuais (entrada no pronto + ajuste no cru)**: é o que dá para fazer hoje. Sem custo, sem vínculo,
  sujeito a esquecer um dos lados. Fica como contorno até a Fatia 1.
- **Ficha como JSON no `Product`**: uma coluna só, mas sem integridade (insumo excluído some sem aviso) e sem
  consulta "em quais fichas este insumo entra". Rejeitada.

## Migration `0044` proposta (a aprovar — regra 1)

Aditiva, sem alterar dado existente:

1. `tenants` + `lastProductionNumber INT NOT NULL DEFAULT 0`.
2. `CREATE TYPE "ProductionLineDirection" AS ENUM ('INPUT','OUTPUT')`.
3. `CREATE TABLE recipes` — `id`, `tenantId` (FK cascade), `productId` (o pronto, **único**), `yieldQty DECIMAL(12,4)`,
   `notes VARCHAR(300)`, autoria (ADR-010), `createdAt/updatedAt`, `deletedAt`.
4. `CREATE TABLE recipe_items` — `id`, `tenantId`, `recipeId` (FK cascade), `productId` (o insumo, FK),
   `quantity DECIMAL(12,4)`; índice `(recipeId)`.
5. `CREATE TABLE productions` — `id`, `tenantId`, `productionNumber INT` (único por loja), `totalCost DECIMAL(12,2)`,
   `notes VARCHAR(300)`, `userId` + `registeredByName`, `createdAt`; índice `(tenantId, createdAt)`.
6. `CREATE TABLE production_lines` — `id`, `tenantId`, `productionId` (FK cascade), `productId` (FK), `direction`,
   `quantity DECIMAL(12,4)`, `unitCost DECIMAL(12,4)`, `stockMovementId UUID` (referência solta); índices
   `(productionId)` e `(tenantId, productId)`.
7. RLS de leitura por `tenant_id` nas 4 tabelas (padrão da 0042); escrita só pela API.

Custo de armazenamento: uma produção de frango = 1 cabeçalho + 3 linhas (≈ 0,5 KB). Mesmo com 10 produções por dia,
fica abaixo de 2 MB/ano por loja — dentro do free tier (regra 6).

## Contrato novo (regra 7, §8.2 — na implementação)

- `GET /products/:id/recipe` · `PUT /products/:id/recipe` 🔒 (Admin) · `DELETE /products/:id/recipe` 🔒.
- `GET /productions?day=` (lista + resumo do dia) · `POST /productions` (registrar) · `GET /productions/:id`.
- `POST /productions/loss` (perda do pronto, com motivo).

## Fatias

1. **Ficha + registrar produção** (migration `0044`, módulo `RECIPES`, core puro com testes: escalar a ficha,
   custo do pronto, checar saldo dos insumos). É o que resolve a dúvida do Owner.
2. **Sobra/perda + resumo do dia** (produzido × vendido × perda × em estoque) e histórico `P-0001…`.
3. *(opcional, ADR própria)* Desmembramento com rateio de custo.

## Perguntas ao Owner

1. **Insumo sem saldo** (ex.: a caixa de frango chegou mas ninguém deu entrada): **bloquear** a produção com a
   mensagem "Falta saldo de Frango inteiro cru (tem 3, precisa 15) — dê entrada antes" *(recomendado: mantém o
   estoque confiável, como na venda)* ou **permitir** e deixar o saldo do cru negativo?
2. **Quem registra produção:** **qualquer usuário** (cozinha/operador) *(recomendado)*, com a ficha técnica só para
   o Admin — ou só o Admin?
3. **Custo do pronto:** atualizar pelo **último custo** da produção *(recomendado — igual à Entrada de estoque)* ou
   manter o custo digitado no cadastro?
4. **Desmembramento** (peça → cortes) entra no planejamento agora como Fatia 3, ou fica para quando a loja pedir?
