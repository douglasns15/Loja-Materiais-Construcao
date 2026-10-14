# NexoLoja — Documentação Funcional

> **Documento vivo.** Explica **como cada funcionalidade funciona do ponto de vista de quem usa** (lojista, caixa,
> implantador): para que serve, onde fica, passo a passo, regras de negócio e configuração.
>
> **Par técnico:** [`DOCUMENTACAO-TECNICA.md`](DOCUMENTACAO-TECNICA.md) (rotas, contratos, arquitetura) e as decisões
> em [`adr/`](adr/README.md). **Regra:** toda entrega que muda comportamento atualiza a técnica **e** esta, no mesmo
> commit.
>
> **Cobertura:** começa pelas entregas de 2026-10-09 (carga do catálogo e balança). As funcionalidades anteriores
> entram aqui conforme forem tocadas — ver [Pendências de cobertura](#pendências-de-cobertura).
>
> **Última atualização:** 2026-10-14.

---

## Índice

1. [Carga do catálogo](#1-carga-do-catálogo)
   - 1.1 [Cadastro em sequência](#11-cadastro-em-sequência)
   - 1.2 [Cadastro no caixa ("Cadastrar agora")](#12-cadastro-no-caixa-cadastrar-agora)
   - 1.3 [Importar planilha](#13-importar-planilha)
2. [Venda por peso e balança](#2-venda-por-peso-e-balança)
   - 2.1 [Etiqueta de balança](#21-etiqueta-de-balança)
3. [Pendências de cobertura](#pendências-de-cobertura)
4. [Histórico deste documento](#histórico-deste-documento)

---

## 1. Carga do catálogo

A loja não precisa ter 100% do catálogo no primeiro dia. A implantação cadastra os itens que mais giram pelo
**cadastro em sequência**; o restante se cadastra sozinho nas primeiras semanas, conforme aparece no caixa, pelo
**cadastro no caixa**. Itens com nota fiscal eletrônica podem entrar pela importação de NF-e (Estoque → Importar NF-e),
e um catálogo pronto (planilha do lojista ou exportação do sistema anterior) entra pela **importação de planilha**.
Decisão: [ADR-041](adr/ADR-041-importacao-de-catalogo-por-planilha.md).

### 1.1 Cadastro em sequência

**Para que serve:** cadastrar produtos andando pela prateleira — bipa, confere, digita preço e quantidade, Enter,
próximo. Cadastro e contagem do estoque de abertura na mesma passada.

**Quem usa:** quem faz a implantação ou o inventário (qualquer usuário com acesso a Produtos).

**Onde fica:** **Produtos → botão "▦ Cadastro em sequência"** (endereço `/products/sequencia`). Precisa de internet.

**Passo a passo**

1. Com o cursor no campo **"Código de barras"**, bipe o produto (leitor USB) ou toque no 📷 para ler pela câmera do
   celular.
2. **Produto novo** (a loja não tem esse código):
   - se o código é de fabricante, a ficha do catálogo preenche **nome, marca e foto** (a primeira consulta de um
     código pode levar alguns segundos; depois fica guardada);
   - confira o nome, digite o **preço de venda** e, se quiser, a **quantidade na prateleira**;
   - unidade e categoria são opcionais e **ficam lembradas** para o próximo item;
   - **Enter** cadastra e volta para o campo do código.
3. **Produto já cadastrado:** a tela mostra o produto e o **saldo atual** e pede só a **quantidade contada**. O preço
   pode ser corrigido na mesma passada. **Enter** salva e volta para o código.
4. A lista **"Últimos bipados"**, ao lado, mostra o que foi feito em cada item, com o botão **Corrigir**.

**Regras**

| Situação | O que o sistema faz |
|---|---|
| Produto novo com quantidade | Cria o produto e lança uma **Entrada "Estoque inicial (cadastro)"** com a quantidade. |
| Produto novo sem quantidade | Cria o produto com estoque zero. |
| Código interno (não é código de fabricante) | Não há ficha a buscar: digita-se o nome. O código vira o código interno (SKU). |
| Produto existente, contagem diferente do saldo | Lança um **ajuste de inventário** pela diferença, com o motivo "Carga inicial (cadastro em sequência)". Ex.: saldo 12, contou 15 ⇒ entrada de 3. |
| Produto existente, contagem igual ao saldo | Nada é lançado ("Estoque já conferia"). |
| Produto existente, campo de quantidade vazio | Não mexe no estoque. |
| Produto sem controle de estoque | Só o preço pode ser ajustado. |
| Custo | Fica em **zero**. O produto aparece no sino como **"Produtos sem custo"** para completar depois. |

**Ajudas**

- **Esc** pula o item sem gravar nada.
- Se o leitor bipar **dentro do campo de preço ou de quantidade** por engano, o valor é recusado com aviso (um código
  de barras viraria um preço absurdo).
- A ficha vem dos catálogos gratuitos (Cosmos/Open Food Facts); quando não existe, digita-se o nome.

**Limitações**

- Produtos vendidos em **barra, rolo ou pacote fechado** não entram por aqui — use o cadastro completo em Produtos.
- Não grava custo, estoque mínimo, código na balança etc. — completar no cadastro do produto.

### 1.2 Cadastro no caixa ("Cadastrar agora")

**Para que serve:** quando o caixa bipa um produto que a loja ainda não tem, cadastrar na hora, sem segurar a fila,
e seguir a venda. O administrador confere depois.

**Quem usa:** **qualquer usuário com acesso ao PDV** (caixa/operador e administrador). A conferência é só do
administrador.

**Passo a passo — no caixa**

1. Bipe o produto na busca do PDV e aperte **Enter** (o leitor já faz isso). Se o código não existe, abre a janela
   **"Cadastrar agora"**. Também dá para clicar no botão **"Cadastrar agora …"** que aparece embaixo de
   "Nenhum produto encontrado".
2. O nome vem da ficha do catálogo quando o código é de fabricante (com foto); senão, digite o nome.
3. Digite **só o preço** (a unidade é opcional) e aperte **Enter**.
4. O item **entra no carrinho** com a quantidade do campo "Quantidade" e a venda segue normalmente.

**O que acontece com o produto**

- Nasce **sem controle de estoque** — a venda não trava por falta de saldo e nenhum estoque é inventado.
- Nasce com **custo zero** e o código lido como código interno.
- Fica marcado como **"cadastrado no caixa"**, aguardando a conferência do administrador.

**Passo a passo — conferência do administrador**

1. O sino de pendências mostra **"Cadastrados no caixa para revisar"** com a lista exata desses produtos.
2. Em **Ver**, clique no **nome do produto**: o cadastro dele abre direto em Produtos.
3. O aviso amarelo traz **"Revisar cadastro"** (abre a edição) e **"Marcar como conferido"**. **Salvar a edição também
   conta como conferido.**
4. Na conferência, o recomendado é completar **custo e categoria** e, se o produto deve ter estoque, **ligar "Controlar
   estoque"** e dar a entrada em Estoque.

**Regras**

- Só abre para buscas com **cara de código** (sem espaços, ao menos 4 caracteres, com algum número). Busca por nome sem
  resultado não oferece cadastro.
- Precisa de internet (offline o botão não aparece).
- Se o código já existe na loja mas não aparece no caixa (produto **inativo**), a janela avisa e não cadastra de
  novo — o administrador confere em Produtos.
- Um **operador não consegue marcar como conferido** (só administrador).

### 1.3 Importar planilha

**Para que serve:** cadastrar ou atualizar **muitos produtos de uma vez** a partir de uma planilha — a que o lojista
preencheu em casa no **modelo NexoLoja** ou a exportação do sistema que ele usava antes. Também serve para corrigir
preços em massa ou fazer a contagem de abertura do estoque.

**Quem usa:** **só o administrador** da loja (na implantação acompanhada, quem implanta com o acesso de administrador).

**Onde fica:** **Produtos → botão "⤒ Importar planilha"** (endereço `/products/importar`). Precisa de internet.

**Passo a passo**

1. **Baixar o modelo** (botão "⤓ Baixar modelo (.xlsx)") e mandar ao lojista por WhatsApp ou e-mail. A aba
   **Produtos** tem as colunas certas (com lista de escolha em Unidade e em "Controla estoque") e a aba
   **Instruções** explica cada coluna, com exemplos. Já tem a planilha do sistema anterior? Pode usar direto.
2. **Enviar a planilha:** clicar em "Escolher arquivo ou arrastar aqui" (aceita **.xlsx** e **.csv**, até 5.000
   produtos e 10 MB).
3. **Conferir as colunas:** a tela mostra quais colunas foram reconhecidas e quais serão ignoradas. As colunas são
   reconhecidas **pelo título** — "Preço", "Vlr. Venda" e "Preço de venda" valem a mesma coisa; uma planilha sem
   coluna de nome usa a "Descrição" como nome. Faltando **Nome** ou **Preço de venda**, a tela pede para acertar o
   título e enviar de novo.
4. **Pré-visualizar:** cada linha aparece como **Novo**, **Atualiza** (com o que muda: "Preço de venda: 8,99 → 9,49"),
   **Sem mudança** ou **Erro** (com o motivo). O resumo no topo conta tudo ("3 novos · 2 atualizações · 1 sem mudança ·
   5 com erro"). Os filtros mostram cada grupo.
5. **Importar:** o botão "Importar N produtos" grava os novos e as atualizações, com barra de progresso (não feche a
   tela). As linhas com erro são **puladas**.
6. **Corrigir os erros:** "Baixar linhas com erro (CSV)" gera um arquivo só com essas linhas e uma coluna **Erro** com
   o motivo. Corrija ali mesmo e envie esse arquivo — o resto já entrou.

**Colunas do modelo** (só Nome e Preço de venda são obrigatórias)

| Coluna | Como preencher |
|---|---|
| Nome | Nome do produto como aparece no caixa. |
| Preço de venda | `24,90`, `R$ 24,90` ou `24.90`. |
| Unidade | `UN` (padrão), `KG`, `L`. Aceita apelidos: "Quilo", "Litro", "Unid". Lojas de obra: `M`, `M2`, `M3`, `MIL`, `SC`. |
| Código de barras | O EAN da embalagem (8, 12, 13 ou 14 dígitos). O dígito verificador é conferido. |
| Código interno | Código da loja. Vazio: usa o código de barras; sem nenhum código, é **gerado a partir do nome** (ex.: `SORVETE-DE-CHOCOLATE`). |
| Nome popular, Marca, Descrição | Texto livre. |
| Categoria | `Sorvetes` ou `Sorvetes > Premium` (até 2 níveis). **Criada** se não existir; maiúsculas e acentos não importam para achar a que já existe. |
| Custo | Quanto a loja paga por unidade. |
| Estoque atual | Quantidade na loja hoje (ver regras de estoque). |
| Estoque mínimo | Ponto de reposição (alerta de estoque baixo). |
| Controla estoque (S/N) | `N` para o que não se conta (produção do dia, serviço). Vazio = `S`. |
| Código na balança | O PLU, só para loja que usa etiqueta de balança. |
| NCM | 8 dígitos (pontos são aceitos: `1006.30.21`). |

**Regras**

| Situação | O que o sistema faz |
|---|---|
| Como acha o produto que já existe | Pelo **código de barras** (EAN-13 e a forma de 14 dígitos da caixa valem igual) → senão pelo **código interno** → linha sem nenhum código: pelo **nome exato** (sem diferença de maiúscula/acento). |
| Reimportar a mesma planilha | **Não duplica**: o que já entrou aparece como "Sem mudança". |
| Célula vazia em produto existente | **Não apaga** o dado do cadastro — só o que está preenchido é atualizado. |
| Produto novo com Estoque atual | Cria o produto e lança uma **Entrada "Carga inicial (planilha)"** com a quantidade (custo da planilha). |
| Produto existente com Estoque atual | Vira **contagem de abertura**: lança só a **diferença** para o saldo, com o motivo "Carga inicial (planilha)". Ex.: saldo 15, planilha 20 ⇒ entrada de 5. Igual ao saldo ⇒ nada. |
| Produto sem controle de estoque | O Estoque atual é ignorado (aviso na linha). |
| Custo muda e a planilha não traz preço | O produto ganha o aviso **"custo ajustado, confira o preço"** (como na NF-e). Planilha com preço = preço já revisado. |
| Unidade ou "Controla estoque" diferente do cadastro | **Não muda** (mudaria o sentido do saldo e do histórico) — aviso na linha; troque editando o produto. |
| Código de barras com dígito errado | Erro: "não é um código de barras válido". Se for um código da própria loja, use a coluna Código interno. |
| Mesmo código (ou mesmo nome, sem código) em duas linhas | A segunda vira erro: "repetido na linha N". |
| Dois produtos do cadastro com o mesmo nome e linha sem código | Erro: informe o código para saber qual atualizar. |
| Código interno ou PLU de outro produto | Erro com o nome do produto dono do código. |
| Unidade de obra (milheiro, saco, metro) em loja sem o módulo de obra | Erro: unidade não disponível para o ramo da loja. |
| Código na balança em loja sem etiqueta de balança | Ignorado (aviso na linha). |
| Produto novo sem custo | Custo **zero** — aparece no sino como "Produtos sem custo". |

**Limitações**

- Produtos vendidos em **barra, rolo ou pacote fechado** não entram pela planilha (precisam do tamanho da embalagem) —
  use o cadastro completo em Produtos.
- Planilhas **.xls** antigas: abrir no Excel e salvar como .xlsx ou .csv. Só a **primeira aba** é lida.
- O casamento das colunas é automático; escolher à mão qual coluna é qual (De-Para) e lembrar o perfil de um sistema
  anterior ficam para a próxima etapa.
- Não importa foto, preço por forma de pagamento, par (parafuso + bucha) nem embalagem alternativa.

---

## 2. Venda por peso e balança

Produtos vendidos por **quilo ou litro** aceitam quantidade com 3 casas (ex.: 0,412 kg) e podem ser lidos pela
**etiqueta da balança**. Decisão: [ADR-040](adr/ADR-040-venda-por-peso-balanca-e-producao-propria.md).

### 2.1 Etiqueta de balança

**Para que serve:** a balança etiquetadora (Toledo, Filizola, Urano, Elgin…) pesa o produto e imprime uma etiqueta
com código de barras. No caixa, basta passar o leitor: o item entra no carrinho com o valor da etiqueta.

**Quem usa:** o caixa (leitura); o administrador (código na balança de cada produto); o implantador/Super Usuário
(formato da etiqueta da loja).

**Como a etiqueta funciona**

O código impresso tem 13 dígitos, **começa com 2** (faixa reservada para uso interno da loja, nunca colide com código
de fabricante) e carrega **só duas informações**:

- **qual produto** — o código dele na balança, chamado **PLU**;
- **quanto** — o **preço total** (em centavos) **ou** o **peso** (em gramas), conforme a balança foi configurada.

Nome, preço por kg e validade vão impressos em texto na etiqueta, não no código.

**Configuração (uma vez por loja)**

1. **Ligar o módulo** "Etiqueta de balança" no painel da plataforma (Super Usuário). Os ramos Mercadinho, Sorveteria e
   Rotisseria já nascem com ele ligado.
2. **Escolher o formato da etiqueta**, no mesmo painel, ao lado do interruptor:
   - **Formato** — como os 13 dígitos estão organizados (tabela abaixo);
   - **Valor** — **Preço total** (recomendado) ou **Peso (gramas)**.
3. **Testar etiqueta:** no campo "Testar etiqueta (bipe aqui)", bipe uma etiqueta impressa pela balança da loja. O
   painel mostra o que o caixa vai ler (ex.: "✓ PLU 123 · R$ 24,68"). **Compare com o PLU e o valor impressos em
   texto na etiqueta**; se não baterem, troque o formato até bater. Se mais de um formato ler certo, qualquer um
   deles serve (eles só diferem em valores acima de R$ 999,99 / 99,999 kg) — prefira o que estiver no manual da
   balança.
4. **Informar o PLU em cada produto:** em Produtos, no cadastro ou na edição, campo **"Código na balança (PLU)"** —
   o **mesmo número** cadastrado na balança para aquele produto. O campo só aparece com o módulo ligado.

**Formatos aceitos**

Legenda: `2` = prefixo · `C` = código do produto (PLU) · `0` = preenchimento · `V` = valor · `K` = dígito verificador
do valor · `D` = dígito verificador final. Exemplos com PLU 123 e R$ 24,68.

| Formato | Código (PLU) | Valor | Dígito do valor | Exemplo |
|---|---|---|---|---|
| `2 CCCC 0 VVVVVV D` — **padrão** | 4 | 6 | não | `2012300024684` |
| `2 CCCC VVVVVV K D` | 4 | 6 | sim | `2012300246802` |
| `2 CCCC 00 VVVVV D` | 4 | 5 | não | `2012300024684` |
| `2 CCCC 0 VVVVV K D` | 4 | 5 | sim | `2012300246802` |
| `2 CCCCC VVVVVV D` | 5 | 6 | não | `2001230024680` |
| `2 CCCCC 0 VVVVV D` | 5 | 5 | não | `2001230024680` |
| `2 CCCCC VVVVV K D` | 5 | 5 | sim | `2001230246808` |
| `2 CCCCCC VVVVV D` | 6 | 5 | não | `2000123024684` |

**Padrão escolhido e por quê:** `2 CCCC 0 VVVVVV D` com **Preço total**. É o desenho mais comum nas etiquetadoras
brasileiras configuradas de fábrica; e o **preço total** evita diferença de centavo entre a etiqueta e o caixa (o
cliente paga exatamente o que está impresso). Loja que nunca configurou usa esse padrão.

**No caixa**

- Passe o leitor na etiqueta — o leitor manda o **Enter** sozinho e o item entra no carrinho.
- **Digitando o código** (ou no celular, sem Enter): enquanto ele estiver na busca, aparece o botão **"Etiqueta de
  balança (PLU N) — Lançar etiqueta"**. O "Cadastrar agora" **não** aparece para código de etiqueta (cadastraria um
  produto com o código da pesagem).
- **Cada etiqueta vira uma linha** — duas bandejas do mesmo produto são duas linhas, cada uma com o seu valor.
- **Formato com preço:** vale o **valor impresso**. O sistema calcula o peso (total ÷ preço por kg, arredondado ao
  grama) só para baixar o estoque. A linha do carrinho e o cupom mostram o **preço por kg do cadastro** com o selo
  **🏷️ etiqueta** (no cupom, "(etiqueta)"), e o total é o impresso. Ex.: etiqueta de R$ 10,00 de um produto a
  R$ 24,90/kg ⇒ "0,402 kg · R$ 24,90/kg 🏷️ etiqueta · R$ 10,00". No cupom de 80 mm a linha sai como
  "Teste sequencia granel (etiqueta) | 0,402 kg | R$ 24,90 | R$ 10,00" (conferido em 2026-10-14).
  - **Por que a conta "não fecha" no centavo:** 0,402 kg × R$ 24,90 = R$ 10,01. O peso exato seria 0,40160… kg,
    mas o estoque anda em gramas. A diferença (1 a 3 centavos; maior em etiquetas de valor pequeno) fica absorvida
    no preço gravado na venda, ajustado na 4ª casa (R$ 24,8756/kg) para quantidade × preço = valor impresso. O selo
    avisa o caixa e o cliente de que o total é o da etiqueta. Decisão do Owner (2026-10-09, "opção C").
- **Formato com peso:** a quantidade é o peso impresso e o preço é o do cadastro.

**Regras e mensagens**

| Situação | O que acontece |
|---|---|
| PLU da etiqueta não existe na loja | "Etiqueta de balança: nenhum produto com o código N na balança. Informe o PLU no cadastro do produto." |
| Produto não é vendido por kg/L | Aviso para conferir a unidade no cadastro; não lança. |
| Produto sem preço de venda | Aviso; não lança. |
| Estoque insuficiente (produto com controle) | Aviso de estoque insuficiente, como em qualquer item. |
| Dois produtos com o mesmo PLU | Não é permitido: "Já existe um produto com esse código na balança (PLU)." |
| Produto excluído | O PLU dele fica livre para outro produto. |
| Sem internet | A leitura funciona (o formato fica guardado no aparelho). |

**Limitações**

- **Reimpressão pelo Histórico de Vendas** e relatórios mostram o preço **gravado** (ajustado, ex.: R$ 24,88/kg) e sem
  o selo — a venda não guarda que a linha veio de etiqueta. O total é o mesmo.
- Se o produto tiver **acréscimo de cartão** (débito/crédito), ele é somado também à linha da etiqueta.
- Só etiquetas que **começam com 2**. Balança configurada com outro caractere inicial não é lida (ainda não houve
  caso real).
- O dígito verificador **do valor** (formatos com `K`) não é conferido — o algoritmo muda de fabricante para
  fabricante; o dígito final do código já protege contra leitura errada.
- **Balança de checkout ligada ao computador** (o caixa pesa e o peso entra sozinho) não faz parte — enquanto isso, o
  peso pode ser digitado na linha do produto.
- Cadastrar os produtos **na balança** (PLU, nome, preço/kg) é feito no software ou no teclado da balança. Exportar
  essa lista a partir do NexoLoja é evolução futura.

---

## Pendências de cobertura

Funcionalidades já em uso que ainda não estão descritas aqui (entram conforme forem tocadas): PDV (pagamentos,
fiado, crédito da loja, troca/devolução), Caixa, Estoque e importação de NF-e, Entregas e agenda, Produção com ficha
técnica, Relatórios, Central de Alertas, Clientes/Fornecedores/Funcionários/Categorias, Atalhos de teclado, painel da
plataforma.

## Histórico deste documento

| Data | Mudança |
|---|---|
| 2026-10-09 | Criação: cadastro em sequência (#6), cadastro no caixa (#7), etiqueta de balança (#8) com formato parametrizado. |
| 2026-10-09 | Etiqueta digitada: botão "Lançar etiqueta" no lugar do "Cadastrar agora" (achado do Owner no teste em produção). |
| 2026-10-09 | Etiqueta com preço: tela e cupom mostram o preço/kg do cadastro + selo "etiqueta" (opção C do Owner). |
| 2026-10-14 | Importar planilha (#9): modelo NexoLoja, .xlsx/.csv, pré-visualização, importação idempotente e CSV de erros. |
| 2026-10-14 | Cupom com etiqueta conferido; colunas Qtd/Unit./Total do cupom 80 mm não grudam nem quebram mais. |
