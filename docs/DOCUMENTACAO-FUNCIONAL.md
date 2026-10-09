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
> **Última atualização:** 2026-10-09.

---

## Índice

1. [Carga do catálogo](#1-carga-do-catálogo)
   - 1.1 [Cadastro em sequência](#11-cadastro-em-sequência)
   - 1.2 [Cadastro no caixa ("Cadastrar agora")](#12-cadastro-no-caixa-cadastrar-agora)
2. [Venda por peso e balança](#2-venda-por-peso-e-balança)
   - 2.1 [Etiqueta de balança](#21-etiqueta-de-balança)
3. [Pendências de cobertura](#pendências-de-cobertura)
4. [Histórico deste documento](#histórico-deste-documento)

---

## 1. Carga do catálogo

A loja não precisa ter 100% do catálogo no primeiro dia. A implantação cadastra os itens que mais giram pelo
**cadastro em sequência**; o restante se cadastra sozinho nas primeiras semanas, conforme aparece no caixa, pelo
**cadastro no caixa**. Itens com nota fiscal eletrônica podem entrar pela importação de NF-e (Estoque → Importar NF-e).
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
- **Formato com preço:** vale o **valor impresso**. O sistema calcula o peso (total ÷ preço por kg, 3 casas) só para
  baixar o estoque. Para o total bater no centavo, o preço por kg da linha pode aparecer levemente diferente do
  cadastro (ex.: etiqueta de R$ 10,00 de um produto a R$ 24,90/kg ⇒ linha "0,402 kg · R$ 24,88/kg · R$ 10,00").
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
