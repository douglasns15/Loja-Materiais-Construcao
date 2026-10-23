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
> **Última atualização:** 2026-10-23.

---

## Índice

1. [Carga do catálogo](#1-carga-do-catálogo)
   - 1.1 [Cadastro em sequência](#11-cadastro-em-sequência)
   - 1.2 [Cadastro no caixa ("Cadastrar agora")](#12-cadastro-no-caixa-cadastrar-agora)
   - 1.3 [Importar planilha](#13-importar-planilha)
2. [Venda por peso e balança](#2-venda-por-peso-e-balança)
   - 2.1 [Etiqueta de balança](#21-etiqueta-de-balança)
3. [Usuário com mais de uma loja](#3-usuário-com-mais-de-uma-loja)
4. [Teclado: setas, Esc e F8](#4-teclado-setas-esc-e-f8)
5. [Ficha do produto pelo código de barras (Cosmos)](#5-ficha-do-produto-pelo-código-de-barras-cosmos)
6. [Impressão de comprovantes](#6-impressão-de-comprovantes)
   - 6.1 [Comprovante de dívida quitada](#61-comprovante-de-dívida-quitada)
   - 6.2 [Imprimir pelo iPhone/iPad (app instalado)](#62-imprimir-pelo-iphoneipad-app-instalado)
7. [Receber conta: troco e acréscimo do cartão](#7-receber-conta-troco-e-acréscimo-do-cartão)
8. [Histórico de custo e preço do produto](#8-histórico-de-custo-e-preço-do-produto)
9. [Entrada de estoque: custo e preço de venda](#9-entrada-de-estoque-custo-e-preço-de-venda)
10. [Troca por item mais barato (sobra do vale)](#10-troca-por-item-mais-barato-sobra-do-vale)
11. [Extrato do crédito do cliente](#11-extrato-do-crédito-do-cliente)
12. [Histórico de Vendas: buscar por produto](#12-histórico-de-vendas-buscar-por-produto)
13. [Pendências de cobertura](#pendências-de-cobertura)
14. [Histórico deste documento](#histórico-deste-documento)

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
- A ficha vem dos catálogos gratuitos (Cosmos/Open Food Facts); quando não existe, digita-se o nome. Se o Cosmos
  falhar (limite do plano, acesso recusado, fora do ar), a linha do item diz isso — ver
  [§5](#5-ficha-do-produto-pelo-código-de-barras-cosmos).

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

## 3. Usuário com mais de uma loja

**Para que serve:** o dono de duas lojas (ou um gerente que atende mais de uma) entra com **um único login** e escolhe
em qual loja vai trabalhar — sem precisar de um e-mail por loja. Decisão: [ADR-014](adr/ADR-014-usuario-multi-loja.md).

**Quem usa:** quem tem acesso a 2 ou mais lojas. **Quem tem uma loja só não vê nada diferente** — entra direto, como
sempre.

**Passo a passo**

1. Entre com e-mail e senha. Aparece **"Selecione a loja"** com as suas lojas e o seu papel em cada uma.
2. Toque na loja. O sistema abre nela.
3. No topo de todas as telas aparece o **nome da loja atual** (com o símbolo ⇄). Toque nele — ou em **"Trocar de loja"**
   no menu da sua conta — para voltar à lista e escolher outra loja, sem sair e entrar de novo.

**Ganhar acesso a outra loja**

- **Convite do administrador da loja:** ele vai em **Configurações → Usuários → Convidar novo usuário**, digita o seu
  e-mail e escolhe o papel. Se você já usa o NexoLoja, o convite fica **pendente**: no topo do app aparece **"Você tem
  1 convite para outra loja — Ver convite"** e, na escolha da loja, **"Você foi convidado para a Loja X — Aceitar /
  Recusar"**. Só depois de **Aceitar** a loja entra na sua lista. Se você ainda não usa o NexoLoja, chega o e-mail de
  sempre para definir a senha.
- **Equipe NexoLoja (implantação):** pelo painel da plataforma, em **Membros** da loja, damos o acesso direto a uma
  conta que já existe (sem o passo de aceite) e retiramos ao fim. Ao **criar uma loja nova** para alguém que já usa o
  NexoLoja (ex.: o dono abrindo a segunda loja), essa pessoa vira a **Dona da loja nova** com o mesmo login.
- **Sair de uma loja:** na escolha da loja, **"Sair desta loja"** (só aparece com 2 ou mais lojas e nunca onde você é
  o Dono). O que você registrou na loja continua lá.

**Para o administrador (Configurações → Usuários)**

- A lista mostra **quem tem acesso a esta loja** — inclusive **convites pendentes**, que aparecem **só com o e-mail**
  (o nome e outros dados da pessoa ficam ocultos até ela aceitar).
- O convite responde sempre **"Convite enviado"** — o sistema não conta se a pessoa já tinha conta nem em quais lojas
  ela está.
- **Papel** e **Desativar** valem **só para esta loja** (a pessoa continua com as outras).
- **Remover da loja** tira o acesso a esta loja (o histórico de vendas/caixa dela fica). Se a pessoa não tiver mais
  loja nenhuma nem histórico, a conta é apagada e o e-mail fica livre para um convite novo. Em convite pendente, o
  botão é **Cancelar convite**.
- O **Dono** e você mesmo não podem ser alterados nem removidos ali.

**Regras**

| Situação | O que acontece |
|---|---|
| Papel por loja | Você pode ser **Admin numa loja e Usuário em outra**: telas e ações seguem o papel da loja atual. |
| Trocar de loja | O sistema recarrega na loja escolhida e **apaga deste aparelho os dados da loja anterior** (carrinho, caixa aberto em tela, rascunhos, catálogo guardado para uso offline). O carrinho em montagem fica para trás. |
| Vendas offline ainda não enviadas | **Não dá para trocar de loja** até elas serem enviadas (aviso na tela). Cada venda offline é sempre enviada para a loja em que foi feita. |
| Duas abas abertas | Trocar de loja numa aba **recarrega as outras** na loja nova — nenhuma aba fica operando a loja antiga. |
| Acesso a uma loja retirado | Na próxima ação, o sistema avisa "Você não tem acesso a esta loja" e volta para a escolha da loja. |
| Sair | Ao sair, a loja escolhida e os dados dela são apagados do aparelho. |

**Limitações (por enquanto)**

- O convite para quem **já usa** o NexoLoja não manda e-mail: a pessoa vê o convite **ao entrar no sistema**.
- Sair da **única** loja não é possível pela própria pessoa (fale com o administrador).
- O carrinho é **um por pessoa**: ao trocar de loja, o carrinho em montagem na loja anterior se perde.

---

## 4. Teclado: setas, Esc e F8

**Para que serve:** usar o sistema no computador sem tirar a mão do teclado — buscar e escolher um item, fechar uma
janela e confirmar/salvar, com as mesmas teclas em todas as telas. Decisão: [ADR-032](adr/ADR-032-atalhos-de-teclado.md)
(adendo 2026-10-15). Os demais atalhos (`N` + letra para navegar, `F2`, `F9`) seguem como antes — veja com **`?`**.

**Setas nos resultados de uma busca**

1. Digite na busca (ex.: no PDV, "cimento").
2. Aperte **↓**: o primeiro resultado fica realçado em azul. **↓ / ↑** andam pela lista (produto sem estoque é pulado).
3. **Enter** escolhe — no PDV, o produto entra no carrinho e o cursor volta para a busca, pronto para o próximo.
4. **↑** no primeiro resultado (ou **Esc**) volta para o campo; começar a digitar também volta a escrever na busca.

Vale em: PDV (produto e cliente), todo campo "Buscar produto" de Estoque, NF-e, Receita e Desmembramento, busca de
fornecedor, Produtos, Clientes, Fornecedores, Funcionários, Categorias, Estoque, Contas a Receber, Histórico de Vendas,
Orçamentos, Entregas, cliente do crédito na devolução, histórico de NF-e e os rankings de Relatórios. Num produto com
mais de uma forma de venda (barra × metro, embalagem × unidade), cada botão da linha é uma parada da seta.

**Esc fecha a janela (pop-up)**

- Qualquer janela aberta fecha com **Esc** — como clicar fora ou no ✕. Com **duas** abertas (ex.: cadastro rápido de
  cliente por cima da venda), fecha só a de cima.
- Com a lista de um seletor de produto/fornecedor aberta, o primeiro Esc fecha só a lista.
- **Janela flutuante** (ex.: Produtos aberta por cima do PDV): o Esc fecha a janela flutuante quando você está
  nela — acabou de abrir ou clicou dentro dela. Se você voltou a clicar na tela de trás (ex.: na busca do PDV), o
  Esc não fecha a janela flutuante. Com um pop-up aberto dentro dela, o Esc fecha primeiro o pop-up.
- Também fecha o painel de pendências (sino), o menu lateral no celular/tablet com teclado e o painel de
  cancelar/devolver aberto num cartão do Histórico.

**F8 = Confirmar / Salvar**

O **F8** aperta o **botão principal** da janela aberta ou, sem janela, da tela:

| Onde | O que o F8 faz |
|---|---|
| PDV | "Concluir venda" (abre a revisão) e, na revisão, "Confirmar venda" — F8, F8 fecha a venda |
| Produtos / Clientes / Fornecedores / Funcionários / Categorias | Salva o novo cadastro ("Adicionar …") |
| Janela de cadastro ou edição (produto, categoria, fornecedor, cliente…) | "Salvar" / "Cadastrar" |
| Estoque | "Registrar entrada" ou "Registrar ajuste" — o do formulário em que o cursor está |
| Caixa | "Abrir caixa" / "Fechar caixa" |
| Sangria/suprimento, contador de cédulas, NF-e, devolução, perda, receber dívida | O botão de confirmar da janela |

**Regras**

- O F8 só faz o que o clique faria: se o botão está **apagado** (ex.: venda sem pagamento suficiente, campo
  obrigatório vazio), nada acontece — e a validação do formulário aparece como no clique.
- Numa janela **só de consulta** (detalhe de venda, de cliente, de alerta) o F8 não faz nada — nunca aperta um botão
  da tela que está por trás.
- "Salvar observação" e o "Salvar" do estoque mínimo de uma linha de Produtos só respondem ao F8 com o cursor
  naquele campo.

**Configuração**

- A tecla do **Confirmar** pode ser trocada em **Configurações → Acessibilidade** (grupo "Geral"). Quem já tinha
  trocado a tecla do antigo "Finalizar venda" leva a mesma tecla para o Confirmar. **Esc** e **setas** são fixos.
- A ajuda **`?`** lista tudo, inclusive as teclas fixas ("Sempre ativos").

**Limitações (por enquanto)**

- F8 e os demais atalhos de função valem no computador (tela ≥ 768 px); Esc e setas valem em qualquer tela com
  teclado.
- Em muitos MacBooks as teclas F pedem `fn` (ou o ajuste do sistema) — dá para trocar o Confirmar por outra tecla.
- Filtros que não listam opções (ex.: "Motivo" nas movimentações de estoque) não têm navegação por seta.

---

## 5. Ficha do produto pelo código de barras (Cosmos)

**Para que serve:** ao cadastrar um produto novo, o sistema busca o **nome, a marca e a foto** pelo código de barras
(EAN) e oferece preencher o cadastro — sem digitar. Decisão: [ADR-025](adr/ADR-025-catalogo-global-ean.md).

**Onde aparece**

- **Produtos → novo produto:** ao digitar ou bipar o código de barras, aparece o cartão da ficha com o botão
  **"Preencher com esta ficha"**.
- **Detalhe do produto → "🔄 Sincronizar dados pelo EAN":** compara o cadastro com a ficha e propõe as diferenças.
- **Cadastro em sequência** ([§1.1](#11-cadastro-em-sequência)) e **Cadastrar agora** do caixa
  ([§1.2](#12-cadastro-no-caixa-cadastrar-agora)): o nome já vem preenchido.

**De onde vem a ficha:** primeiro do **catálogo da própria plataforma** (fichas já consultadas por qualquer loja —
instantâneo); se não estiver lá, do **Bluesoft Cosmos** (base brasileira, plano gratuito com limite de consultas por
dia); por último do **Open Food Facts** (só alimentos/bebidas/cosméticos). O que vem de fora fica guardado no
catálogo, e a próxima consulta do mesmo código é instantânea e não gasta o limite.

**O que cada mensagem quer dizer**

| Mensagem | Significado | O que fazer |
|---|---|---|
| "Ficha encontrada" | Achou nome/marca/foto. | Confira e clique em **Preencher**. |
| "Produto não encontrado no catálogo (Cosmos/Open Food Facts)…" | As fontes responderam e **não têm** esse código. | Preencha à mão — o cadastro passa a alimentar o catálogo. |
| "O Cosmos … atingiu o limite diário de consultas do plano" | A **franquia diária** do plano gratuito acabou (toda consulta conta, inclusive de código que não existe lá). O produto pode existir no Cosmos. | Preencha à mão ou tente de novo depois da **meia-noite (horário de Brasília)**, quando a franquia reinicia. Se acontecer todo dia logo cedo, confira o consumo no painel da conta Cosmos (o token pode estar sendo usado em outro lugar, ou o plano pode ter mudado). |
| "O Cosmos recusou o acesso (token inválido, expirado ou plano encerrado)" | A chave de acesso do NexoLoja ao Cosmos não vale mais. **Nenhum produto novo vai carregar ficha até resolver.** | Avise o administrador da plataforma (é preciso gerar um token novo no site do Cosmos e regravar no servidor). |
| "O Cosmos não respondeu agora (fora do ar ou lento)" | Falha passageira do serviço. | Tente de novo em instantes. |
| "Não foi possível consultar o código de barras agora (sem conexão com o servidor)" | A internet ou o servidor do NexoLoja falhou. | Confira a conexão e tente de novo. |

**Regras**

- Só consulta código de **fabricante** válido (dígito verificador conferido). Código interno não consulta nada.
- A consulta **nunca trava o cadastro**: qualquer falha deixa preencher à mão e salvar normalmente.
- O **Preencher** grava nome, marca e foto; a foto fica como link para a imagem da fonte (não ocupa espaço da loja).
- Se a loja **já tem** um produto com aquele código, o cartão avisa e oferece **Abrir** (evita duplicar).

**Limitações**

- O plano gratuito do Cosmos tem limite diário de consultas; consultas repetidas do mesmo código não contam (vêm do
  catálogo), mas cada código **novo** consulta.
- Um código que "não foi encontrado" não fica guardado: se o produto entrar no Cosmos depois, a próxima consulta acha.
  Para poupar o limite, o mesmo código "não encontrado" pode não ser consultado de novo no Cosmos por até 24 horas.
- Depois que o limite diário estoura, o sistema **não tenta o Cosmos de novo até a meia-noite** (horário de Brasília) e
  já mostra o aviso de limite — a consulta fica mais rápida e não insiste à toa.

---

## 6. Impressão de comprovantes

Todos os documentos (cupom de venda, orçamento, fechamento de caixa, movimentação do caixa, resumo de dívida,
recibo de recebimento, entrega e comprovante de quitação) saem em **80mm** (impressora térmica) ou **A4**, escolhido
no seletor "Imprimir:" ao lado do botão. No computador e no Android abre a janela de impressão do navegador, onde
também dá para **Salvar como PDF** — o arquivo já vem com o nome do documento (ex.: `V-000128.pdf`, `D-0001.pdf`).

### 6.1 Comprovante de dívida quitada

**Para que serve:** entregar ao cliente a prova de que a dívida foi paga.

**Onde fica:** **Contas a Receber → aba Quitadas →** toque na dívida (ex.: `D-0003`) **→ Imprimir comprovante**.

**O que sai no papel:** dados da loja, "COMPROVANTE DE QUITAÇÃO", "Conta D-0001" (no papel a palavra é **Conta**,
não "Dívida" — mais educado para o cliente; o código continua com **D**), nome do cliente e data/hora da
quitação; quando foi aberta; valores **Original**, **Recebido** e **Devolvido** (se houve); **Saldo R$ 0,00** e a
marca **CONTA QUITADA**; as vendas a prazo que formavam a conta (código, data, valor); todos os **recebimentos**
(data, forma de pagamento, valor) e as **devoluções** que abateram a dívida.

**Regras e limitações**

- Disponível para qualquer dívida da aba Quitadas, inclusive as quitadas antes desta melhoria.
- Pode ser reimpresso quantas vezes quiser; não altera nada na dívida.
- Documento sem valor fiscal (como os demais comprovantes).
- Dívida **em aberto** continua com o "Imprimir resumo" (o que o cliente ainda deve). Ali também o papel usa
  **Conta**: "RESUMO DA CONTA" (de uma venda ou do cliente inteiro), "Vendas em aberto" e a coluna "Venda".

### 6.2 Imprimir pelo iPhone/iPad (app instalado)

**Como funciona:** com o NexoLoja **instalado na tela de início** do iPhone/iPad, **Imprimir** abre a **tela de
impressão do iOS** — lá você escolhe a impressora configurada no celular ou, se preferir, gera o PDF pela própria tela
de impressão. Para mandar o PDF direto (WhatsApp etc.) continuam os botões próprios de imagem/PDF.

**Passo a passo**

1. Toque em **Imprimir** (no PDV, Histórico de Vendas, Caixa, Orçamentos, Entregas ou Contas a Receber).
2. Na tela de impressão do iOS, escolha a **impressora** (AirPrint) e toque em **Imprimir** — ou use as opções da
   própria tela para salvar/compartilhar o PDF.

**Se a tela de impressão não abrir:** em cerca de 2 segundos o sistema abre, no lugar, a **tela de compartilhar** com o
PDF do comprovante (ex.: `V-000128.pdf`) — ali também tem **Imprimir**. Isso é só um plano B, para o botão nunca
ficar sem resposta. Se acontecer com frequência em alguma tela, avise o suporte dizendo qual.

**Limitações**

- A impressora precisa ser compatível com **AirPrint** (ou ter app próprio que apareça no iOS).
- **Relatórios** (a tela inteira) não imprimem pelo app instalado do iPhone: aparece um aviso para abrir pelo Safari
  ou pelo computador, ou usar **Exportar CSV**.
- Em **Entregas → imprimir a conta inteira**, o sistema junta as vendas antes de imprimir; nesse caso pode cair no
  plano B (tela de compartilhar).

---

## 7. Receber conta: troco e acréscimo do cartão

**Para que serve:** receber o fiado com as mesmas contas do PDV — troco no dinheiro e preço de cartão nos produtos
que têm acréscimo.

**Onde fica:** **Contas a Receber → Em aberto → Receber** (no cartão do cliente ou dentro do extrato).

**Dinheiro — passo a passo**

1. Confira o **Valor a receber** (vem o saldo todo; mude para receber só uma parte).
2. Em **Forma de pagamento**, deixe **Dinheiro**.
3. Em **Dinheiro entregue**, digite quanto o cliente deu (opcional). Aparece o **Troco** — ou **Falta**, se deu menos.
4. Toque em **Receber**. A mensagem confirma o recebimento e repete o troco.

Regras: no caixa entra o **valor recebido** (o troco volta para o cliente). Se o dinheiro entregue for menor que o valor a
receber, o sistema não deixa concluir — diminua o "Valor a receber" para registrar um pagamento parcial. Precisa de
caixa aberto.

**Cartão de débito ou crédito — passo a passo**

1. Escolha **Cartão de débito** ou **Cartão de crédito**.
2. Se algum produto da conta tem acréscimo nessa forma (cadastro do produto), aparece o quadro amarelo com os itens e o
   **Acréscimo a cobrar já calculado**, e o **Total a cobrar no cartão** (valor + acréscimo) — é o que passa na maquininha.
3. Toque em **Receber**.

Regras:

- **Quitar a conta toda:** o acréscimo é o mesmo que o PDV cobraria pelos itens que ainda estão em aberto (rolo/pacote
  contam pela unidade, itens devolvidos saem da conta).
- **Receber só uma parte:** o acréscimo é **proporcional** ao valor recebido, começando pela venda mais antiga (a mesma
  ordem em que o sistema abate a conta). A tela avisa "Recebimento parcial".
- O acréscimo **não abate a dívida**: é receita a mais da forma de pagamento (aparece nos relatórios junto da forma).
- Dá para **ajustar** o acréscimo à mão; **recalcular** volta para o valor calculado.
- PIX e dinheiro não têm acréscimo.

**Limitações:** o troco não fica gravado (não aparece em reimpressões).

---

## 8. Histórico de custo e preço do produto

**Para que serve:** ver quando o custo e o preço de venda de um produto mudaram, de quanto para quanto, quem mudou e
por onde — para acompanhar aumentos de fornecedor e conferir reajustes.

**Onde fica:** **Produtos →** abra o produto **→** no fim da ficha, **"Histórico de custo e preço"**.

**O que cada linha mostra**

- **Data e hora** da mudança e **quem fez**.
- **Por onde foi feito** (etiqueta azul): Cadastro do produto · Tela de Produtos · Entrada de estoque · Importação de
  NF-e · Importação de planilha · Produção · Desmembramento. Quando há, vem junto a referência (ex.: "Compra NF 12345",
  nome da planilha, código da produção).
- **Custo** e/ou **Preço**: o valor antigo (riscado) → o novo, com a variação em % (**vermelho** = subiu, **verde** =
  caiu). Só aparece o que mudou. No cadastro aparece "Custo inicial" / "Preço inicial".

**Regras**

- Entra uma linha **toda vez** que o custo ou o preço muda — pela tela de Produtos, numa entrada de estoque com custo
  novo, ao importar NF-e ou planilha, numa produção ou desmembramento.
- Salvar o produto **sem mudar** custo nem preço não gera linha.
- A mais recente fica em cima; aparecem 8 e o botão **Ver tudo** mostra o resto.
- Só leitura: o histórico não pode ser editado nem apagado.

**Limitações**

- O histórico começa a contar a partir desta versão (16/10/2026): mudanças feitas antes não aparecem.
- Precisa de internet para carregar.

## 9. Entrada de estoque: custo e preço de venda

**Para que serve:** ao dar entrada de uma compra, já atualizar o **custo** e, se quiser, o **preço de venda** do
produto — do mesmo jeito que na importação de NF-e, sem precisar abrir a tela de Produtos depois.

**Onde fica:** **Estoque →** quadro **"Entrada de estoque"**.

**Passo a passo**

1. Escolha o produto e informe a quantidade (ou o peso, ou peça a peça).
2. **Custo** (opcional): o custo da compra. Se for diferente do custo do cadastro, o sistema pergunta se deve
   atualizar o custo do produto.
3. **Preço de venda — vazio: não muda** (opcional): digite o preço novo para reajustar o produto. Ao lado aparecem o
   **preço atual** e a **margem** que fica com o custo e o preço informados (sem nada digitado, a margem é a do
   cadastro).
4. Fornecedor e motivo, como sempre → **Registrar entrada** (ou F8).

**Regras**

- O preço é na **unidade de venda** do produto: por barra/rolo/pacote (unidade fechada), por kg/L (peso) ou por
  unidade — o rótulo do campo diz qual.
- Campo **vazio** ou com o **mesmo** preço de hoje: o preço do produto não muda.
- Preço novo informado: o produto passa a vender por ele na hora, e o aviso **"confira o preço"** do cadastro some
  (você já revisou a margem). Mudou só o custo, sem preço novo: o aviso acende, como antes.
- Toda mudança de custo/preço feita aqui entra no **Histórico de custo e preço** (§8) como "Entrada de estoque".

**Limitações**

- Não há sugestão automática de preço pela margem; para isso use a precificação na tela de Produtos.
- Precisa de internet (como toda a tela de Estoque).

---

## 10. Troca por item mais barato (sobra do vale)

**Para que serve:** o cliente devolve um item e leva outro **mais barato**. O valor do que ele devolveu vira um
**vale-troca**; o vale paga a compra nova e a **sobra** volta para ele — em dinheiro, estornada no cartão/PIX ou
como crédito na loja. Tudo num passo só, sem precisar fazer uma devolução e uma venda separadas.

**Onde fica:** **Histórico de Vendas →** na venda, **Cancelar / Devolver → Trocar por outro item**. O PDV abre com o
banner da troca; o quadro **"Sobra do vale — como devolver?"** aparece no pagamento quando a compra nova fica menor
que o vale.

**Passo a passo**

1. No Histórico, abra a venda → **Cancelar / Devolver** → **Trocar por outro item** → escolha os itens, a condição
   (revenda/defeito) e o motivo → **Ir para a troca**.
2. No PDV, monte a compra nova. Se ela ficar **mais barata** que o vale, aparece o quadro verde com a sobra.
3. Escolha **uma** forma de devolver a sobra:
   - **Dinheiro** — a sobra inteira sai da gaveta. A tela mostra "Sai do caixa: R$ …".
   - **Estorno na forma original** — volta como o cliente pagou a venda de origem: a parte que foi paga em dinheiro
     sai da gaveta e o resto você estorna **na maquininha** (a tela mostra quanto é cada um).
   - **Crédito na loja** — vira crédito para o cliente usar depois. Não sai do caixa.
4. **Concluir venda** (ou F8) → confira na revisão → **Confirmar**. O comprovante mostra o "Vale-troca" usado e a
   linha **"Sobra do vale (em dinheiro / estorno na forma original / crédito na loja)"**.

**Regras**

- A sobra é: **vale − valor da compra nova**. Se a compra for **igual ou maior** que o vale, não há sobra: o cliente
  paga a diferença, como sempre.
- Com sobra, a compra já está paga pelo vale: não dá para usar outra forma de pagamento, crédito da loja nem "a prazo"
  junto.
- **Uma forma só** por troca (não dá para dividir a sobra, ex.: parte em dinheiro e parte em crédito).
- **Crédito na loja precisa de cliente:** vai para o cliente da venda de origem. Se a venda de origem não tinha
  cliente, use **"+ Identificar cliente"** no PDV — ele recebe o crédito e passa a constar na venda de origem.
- **Cliente obrigatório em verde:** sempre que o PDV **exige** o cliente — sobra do vale em crédito com venda de
  origem sem cliente, ou **entrega** (retirada/entrega posterior → Entrega) — o "+ Identificar cliente" aparece como
  um **botão verde** com o motivo ("Obrigatório para receber a sobra do vale em crédito" / "para a entrega"), e o
  painel do cliente fica verde até escolher alguém. O "(opcional)" só aparece quando o cliente é mesmo opcional.
- **Dinheiro** e a parte em dinheiro do **estorno** aparecem no Caixa como saída "Troca (sobra do vale) — venda V-…".
- Nos **Relatórios**, a sobra devolvida em dinheiro/estorno sai do **Recebido** (no dia da venda de origem, na forma
  em que voltou), igual a uma devolução. Sobra em crédito não sai do Recebido.
- No **Histórico de Vendas** a sobra aparece nos dois cartões: na venda de origem, "Troca → V-…: sobra devolvida ·
  em dinheiro R$ …" (uma linha por troca); na venda nova, "Sobra do vale devolvida · em dinheiro R$ …". **Reimprimir**
  e **WhatsApp** da venda nova repetem a linha "Sobra do vale" no comprovante.

**Limitações**

- Troca de venda **a prazo em aberto** continua bloqueada — faça uma devolução.
- Precisa de internet (como toda troca).

---

## 11. Extrato do crédito do cliente

**Para que serve:** ver de onde veio o crédito que o cliente tem na loja e onde ele já foi usado — como um extrato de
banco. Responde na hora perguntas como "por que tenho R$ 40 de crédito?" ou "quanto ainda sobrou depois daquela
compra?".

**Onde fica:** **Contas a Receber → Em aberto → filtro "Com crédito" →** toque no cliente. Também abre:

- pelo selo verde **"crédito R$ … ›"** no cartão do cliente (em qualquer filtro);
- pelo link **"ver extrato"** ao lado de "Crédito a favor", dentro do extrato da dívida do cliente.

**O que aparece**

1. **Resumo no topo:**
   - **Saldo do crédito** — quanto o cliente ainda pode usar.
   - **Entrou** — tudo o que virou crédito (devoluções e sobras de troca), com quantas foram.
   - **Usado** — quanto já foi gasto em compras, com quantas compras.
   - **Retirado** — quanto já foi devolvido ao cliente (só aparece se houve retirada).
   - **Estornado** — só aparece quando uma compra paga com crédito foi cancelada/devolvida e o valor voltou.
2. **Movimentações**, da mais antiga para a mais nova, cada uma com o **saldo depois dela**:
   - **Crédito de devolução · da venda V-…** — a devolução que gerou o crédito, com o motivo, os itens que voltaram e
     **como a venda foi paga** ("Venda paga em: Dinheiro R$ 22,00"; se a venda foi fiado, "Venda a prazo:
     R$ 111,00"; se foi parte à vista e parte a prazo, "Venda paga em: Dinheiro R$ 20,00 + a prazo R$ 91,00").
   - **Sobra de troca** — a sobra do vale de uma troca que o cliente pediu como crédito (veja §10).
   - **Utilizado na compra: V-…** — a compra em que usou o crédito, com "Compra de R$ X · R$ Y pago com crédito" e
     os itens comprados.
   - **Crédito retirado em dinheiro/PIX/cartão · da venda V-…** — o valor que voltou ao cliente, com o motivo.
   - **Estorno de compra · V-… cancelada/devolvida** — o crédito que voltou.
3. Botão **Usar na venda** — abre o PDV com o cliente já identificado; lá, use **"Usar crédito da loja"**.

**Retirar o crédito — passo a passo** (o cliente quer o valor de volta em vez de comprar)

1. No extrato do crédito, toque em **Retirar crédito**.
2. **Valor a devolver:** vem o saldo todo; mude para devolver só uma parte.
3. **Devolver em:** Dinheiro, PIX, Cartão Débito ou Cartão Crédito. Já vem marcada a forma em que a venda de origem
   foi paga — "(forma da venda de origem)" —, mas pode escolher qualquer outra.
4. **Motivo** (obrigatório) → **Retirar**.

Regras da retirada:

- **Dinheiro** sai da gaveta do **caixa aberto hoje** (aparece no Caixa como "Retirada de crédito — cliente"). Precisa
  de caixa aberto.
- **PIX ou cartão** não mexem no caixa: faça o PIX ou o estorno na maquininha.
- Crédito que veio de mais de uma venda sai **da mais antiga para a mais nova**.
- Nos **Relatórios**, o valor retirado sai do **Recebido no dia da venda de origem**, na forma em que voltou (igual a
  uma devolução em dinheiro/estorno). No detalhe da forma aparece "· retirada de crédito".
- Qualquer operador com acesso a Contas a Receber pode retirar.

**Regras**

- O saldo é sempre a soma das movimentações (entradas − usos + estornos).
- Uma compra paga com crédito e depois cancelada aparece duas vezes: o uso e o estorno. No resumo, "Usado" já desconta
  o estorno.
- Crédito se gera por devolução/troca; sai usando no PDV ou retirando (acima).

**Limitações**

- Mostra as últimas 300 movimentações; acima disso, a primeira linha é o **Saldo anterior**.
- Ainda não tem impressão (o "Imprimir resumo" do extrato da dívida não inclui o detalhe do crédito).
- Precisa de internet.

---

## 12. Histórico de Vendas: buscar por produto

**Para que serve:** achar as vendas em que saiu um produto — por exemplo, "quem levou aquele piso Eliane?" ou "em
que venda saiu esse código de barras?".

**Onde fica:** **Histórico de Vendas →** quadro de busca, opção **Produto** (ao lado de Código, Cliente e Valor).

**Passo a passo**

1. Toque em **Produto**.
2. Digite qualquer informação do produto: **nome**, **nome popular**, **fabricante**, **SKU** ou **código de barras
   (EAN)** — ou bipe o código com o leitor.
3. **Buscar** (ou Enter). A lista mostra as vendas que têm **ao menos um item** desse produto.
4. **Limpar busca** volta à lista do período.

**Regras**

- Procura em **todo o histórico** — o período escolhido é ignorado durante a busca (igual às outras buscas).
- Pode digitar várias palavras, em qualquer ordem e sem acento: "cimento votorantim" acha "Cimento CP-II 50kg —
  Votorantim". Cada palavra precisa aparecer em algum dos campos do produto.
- Um pedaço basta: "7891" acha os códigos de barras que contêm 7891.
- Acha também vendas de produtos que **já foram desativados ou excluídos** do cadastro.
- Ordenação, "Mostrar mais", reimpressão e as ações da venda funcionam normalmente nos resultados.

**Limitações**

- A busca usa o cadastro **atual** do produto: se o nome mudou, procure pelo nome novo (ou pelo SKU/código de barras).
- Uma busca muito genérica (uma letra só) pode casar centenas de produtos; nesse caso considera os 500 primeiros —
  seja mais específico.

---

## Pendências de cobertura

Funcionalidades já em uso que ainda não estão descritas aqui (entram conforme forem tocadas): PDV (pagamentos,
fiado, crédito da loja, troca/devolução), Caixa, Estoque e importação de NF-e, Entregas e agenda, Produção com ficha
técnica, Relatórios, Central de Alertas, Clientes/Fornecedores/Funcionários/Categorias, atalhos de navegação (`N` + letra),
painel da plataforma.

## Histórico deste documento

| Data | Mudança |
|---|---|
| 2026-10-09 | Criação: cadastro em sequência (#6), cadastro no caixa (#7), etiqueta de balança (#8) com formato parametrizado. |
| 2026-10-09 | Etiqueta digitada: botão "Lançar etiqueta" no lugar do "Cadastrar agora" (achado do Owner no teste em produção). |
| 2026-10-09 | Etiqueta com preço: tela e cupom mostram o preço/kg do cadastro + selo "etiqueta" (opção C do Owner). |
| 2026-10-14 | Importar planilha (#9): modelo NexoLoja, .xlsx/.csv, pré-visualização, importação idempotente e CSV de erros. |
| 2026-10-14 | Cupom com etiqueta conferido; colunas Qtd/Unit./Total do cupom 80 mm não grudam nem quebram mais. |
| 2026-10-14 | Usuário com mais de uma loja (multi-loja, Fatia 2): escolha da loja no login e "Trocar de loja". |
| 2026-10-14 | Multi-loja, Fatia 5: criar loja nova para quem já tem conta (vira Dono com o mesmo login). |
| 2026-10-14 | Multi-loja, Fatia 4: convite com aceite, "Sair desta loja", Usuários por loja (pendente só com e-mail; remover da loja), Membros no painel da plataforma. |
| 2026-10-15 | Teclado (§4): setas nos resultados de busca, Esc fecha a janela de cima, F8 = Confirmar/Salvar em todas as telas. |
| 2026-10-15 | Teclado: Esc fecha a janela flutuante em uso; Esc logo após abrir um pop-up pela lista fecha o pop-up (antes voltava à busca). |
| 2026-10-15 | Teclado (§4) conferido pelo Owner em produção: setas, Esc e F8 funcionando em todas as telas testadas. |
| 2026-10-15 | Ficha pelo código de barras (§5): a tela distingue "não encontrado no catálogo" de falha do Cosmos (limite do plano, acesso recusado, fora do ar) e de falha de conexão. |
| 2026-10-15 | Ficha pelo código de barras (§5): depois do limite diário o Cosmos só é tentado de novo após a meia-noite; código "não encontrado" não é reconsultado por 24 h. |
| 2026-10-16 | Impressão (§6): comprovante de dívida quitada (aba Quitadas) e impressão pelo iPhone/iPad com o app instalado (PDF + tela de compartilhar → Imprimir). |
| 2026-10-16 | Impressão (§6): no iPhone/iPad (app instalado) "Imprimir" abre a impressão do iOS; o PDF + compartilhar virou só plano B. Comprovante de quitação diz "Conta" em vez de "Dívida". |
| 2026-10-16 | Resumos de contas em aberto (de uma venda e do cliente) também dizem "Conta" no papel ("RESUMO DA CONTA", "Vendas em aberto"). |
| 2026-10-16 | Impressão (§6) conferida pelo Owner no iPhone (app instalado): "Imprimir" abre a impressão do iOS; comprovante de quitação e resumos com "Conta". |
| 2026-10-16 | Receber conta (§7): troco no dinheiro e acréscimo do cartão calculado como no PDV (proporcional no parcial). |
| 2026-10-16 | Receber conta (§7) conferido pelo Owner em produção: troco e acréscimo (total e parcial proporcional) funcionando; regra do parcial aprovada. |
| 2026-10-16 | Histórico de custo e preço do produto (§8): de → para, data/hora, quem e por onde, no fim da ficha do produto. |
| 2026-10-16 | Histórico de custo e preço (§8) conferido pelo Owner na Loja Demo: Tela de Produtos, Entrada de estoque e Importação de NF-e registrando certo. |
| 2026-10-21 | Entrada de estoque (§9): campo opcional de preço de venda (vazio não muda), com preço atual e margem, igual à importação de NF-e. |
| 2026-10-21 | Entrada de estoque com preço de venda (§9) conferida pelo Owner em produção. |
| 2026-10-22 | Troca por item mais barato (§10): a sobra do vale volta ao cliente em dinheiro, estorno na forma original ou crédito na loja. |
| 2026-10-22 | Troca por item mais barato (§10) conferida em produção na Loja Demo: os três destinos, caixa, crédito do cliente e Relatórios. |
| 2026-10-22 | Troca por item mais barato (§10): a sobra aparece no Histórico (venda de origem e venda nova) e na reimpressão; avisos do sistema com valor saem em "R$ 7,50". |
| 2026-10-22 | Reimpressão da venda da troca conferida pelo Owner: o comprovante sai com a linha "Sobra do vale". |
| 2026-10-22 | Extrato do crédito do cliente (§11): em Contas a Receber → "Com crédito", resumo (saldo, entrou, usado, estornado) e as movimentações com de onde veio e onde foi usado. |
| 2026-10-22 | Extrato do crédito (§11): retirada do crédito (qualquer forma, a da venda de origem sugerida; dinheiro sai do caixa de hoje; Recebido abatido no dia da venda de origem), forma de pagamento da origem no extrato e "Utilizado na compra: V-…". |
| 2026-10-22 | PDV: quando o cliente é obrigatório (sobra do vale em crédito, entrega), "+ Identificar cliente" fica verde com o motivo e sem "(opcional)". |
| 2026-10-22 | Extrato do crédito (§11): venda de origem fiado mostra "Venda a prazo: R$ …" (antes ficava sem a linha). |
| 2026-10-23 | Histórico de Vendas (§12): nova busca por **Produto** (nome, nome popular, fabricante, SKU ou código de barras). |
| 2026-10-23 | Busca por Produto no Histórico (§12) conferida pelo Owner em produção. |
