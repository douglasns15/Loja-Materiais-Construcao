# ADR-037 — Emissão fiscal de NFC-e: provedor, certificado e contingência

- **Status:** Proposto — decisões 1 a 5 recomendadas, **aguardando aprovação do Owner**. A Fatia 0
  (domínio + porta + adaptador de simulação) já está implementada em `apps/fiscal` e validada
  (63 testes). Nada aqui foi contratado nem aplicado ao banco.
- **Data:** 2026-08-25
- **Deciders:** Alexandre Papassoni (Owner do produto)
- **Contexto de fase:** Horizonte 0 do [`PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md), bloco A — o
  único bloqueio realmente crítico para monetizar.

## Contexto

Uma loja que vende ao consumidor precisa emitir cupom fiscal. Sem isso, o lojista mantém um segundo
sistema só para emitir e digita tudo duas vezes — o que destrói a proposta de valor do NexoLoja e o
transforma em "sistema paralelo". É a diferença entre um piloto simpático e algo pelo qual alguém
paga mensalidade.

Restrições que moldam a decisão:

1. **Multi-tenant.** Cada loja é um CNPJ com **seu próprio certificado digital**. O que funciona para
   uma loja precisa funcionar para N sem redeploy.
2. **Custo-zero é rompido aqui.** A emissão fiscal é o **primeiro custo variável real** do produto.
   É repassável, mas precisa entrar na formação de preço.
3. **Offline-first.** O caixa opera com rede instável ([ADR-011](ADR-011-fila-de-sincronizacao-offline.md)/[ADR-012](ADR-012-cold-start-offline-first-leitura.md));
   a SEFAZ também cai. A venda **não pode parar no balcão**.
4. **Edge.** A API roda em Cloudflare Workers — sem Node completo, sem binário nativo.

### O que já foi construído (Fatia 0)

`apps/fiscal` é um Worker separado com: domínio puro (chave de acesso de 44 dígitos com DV, CPF/CNPJ,
totais em centavos, máquina de estados, janela de cancelamento), a **porta `FiscalProvider`** e um
**adaptador de simulação** determinístico. Isso permitiu construir e testar o fluxo inteiro **antes**
de contratar qualquer provedor — e é o que torna as decisões abaixo baratas de reverter.

---

## Decisão 1 — Provedor: **Focus NFe** (contra integração direta com a SEFAZ)

### Opção A: Provedor de API fiscal (Focus NFe) — **recomendada**

| Dimensão | Avaliação |
|---|---|
| Esforço | Baixo — REST/JSON, adaptador de poucas centenas de linhas |
| Multi-tenant | **Resolvido** — token por empresa; certificado fica no provedor |
| Viabilidade no Workers | Alta — HTTP simples, sem assinatura XML local |
| Custo | Por nota (a confirmar) |

**Por que Focus NFe especificamente** (verificado na documentação em 2026-08-25):

- **API de NFC-e completa**: emitir, consultar, cancelar, **inutilizar numeração**, enviar por e-mail.
- **Token por empresa** (`token_producao` / `token_homologacao` retornados no cadastro) — guardamos
  um token por tenant; **o certificado de cada loja fica na Focus**, não na nossa infraestrutura.
- **Desenhada para SaaS multi-CNPJ**: a documentação tem seção explícita para quem "centraliza vários
  CNPJs (ERP, contabilidade ou SaaS)", com API de empresas (criar/listar/atualizar/excluir).
- **Contingência offline é flag da empresa** (`habilita_contingencia_offline_nfce`,
  `reaproveita_numero_nfce_contingencia`) — tratada no servidor, sem exigir componente local.
- **Homologação e produção só diferem na URL base**; a autenticação é a mesma (HTTP Basic, token como
  usuário e senha em branco). No adaptador isso é um parâmetro.
- **APIs acessórias** de NCM, CFOP, CNAE, CNPJ, municípios (código IBGE) e CEP — atacam diretamente a
  lacuna de cadastro fiscal da Decisão 4.
- **`dry_run=1`** permite simular a criação de empresa sem persistir.
- Documentação com `llms.txt` e versão `.md` por página — acelera muito a escrita do adaptador.

### Opção B: Integração direta com a SEFAZ — **rejeitada**

O ambiente de homologação da SEFAZ é gratuito e existe em todas as UFs, mas **não elimina** o
certificado A1, o credenciamento nem o CSC. O que ele exigiria a mais:

- Montar o XML no leiaute 4.00 e mantê-lo quando a norma muda;
- **Assinatura XMLDSig** (canonicalização C14N, RSA-SHA1, digest SHA-1) — e há dúvida real se o
  WebCrypto do Workers assina com SHA-1, o que poderia inviabilizar a rota;
- SOAP + gzip, com **endpoint diferente por UF**;
- Extrair a chave privada de um PKCS#12 dentro do Worker.

**O golpe fatal é o multi-tenant:** o Workers suporta mTLS por *binding* (`mtls_certificate`), mas
isso significa **um binding por loja** — há limite por Worker, exigiria redeploy a cada loja nova, e
colocaria a **chave privada de cada cliente** na nossa conta Cloudflare, o que é uma responsabilidade
jurídica pesada.

### Opção C: PlugNotas / TecnoSpeed — **plano B**

Suporte técnico forte e voltado a desenvolvedor. Fica como alternativa caso a Focus tropece em preço
ou em alguma exigência do certificado.

---

## Decisão 2 — Guarda do certificado: **no provedor, não na nossa infraestrutura**

O certificado A1 (PFX/P12) de cada loja é enviado **para a Focus** (`arquivo_certificado_base64` +
`senha_certificado`), que assina o XML. Nós guardamos apenas o **token da empresa**.

**Consequência direta:** o NexoLoja **nunca armazena chave privada de cliente**. É a decisão de menor
risco jurídico e a que dispensa desenhar cofre de segredos, rotação e cifragem em repouso — trabalho
que não agrega valor ao lojista.

O token por tenant é um segredo de baixo impacto relativo (permite emitir por aquela loja, não
personificar a empresa em outros contextos) e será guardado **cifrado** no banco ou como secret do
Worker fiscal — ver Decisão 4.

---

## Decisão 3 — Numeração: **do provedor** (já implementada)

A Focus mantém `proximo_numero_nfce_*` **por empresa** e incrementa sozinha. Centralizar a sequência
num lugar só evita buraco e duplicidade de numeração quando vários caixas emitem em paralelo — um
problema clássico e desagradável de corrigir (exige inutilização junto à SEFAZ).

**Já aplicado em `apps/fiscal`:** `IssueRequest.number` passou a ser **opcional**; ausente significa
"provedor, numere você". O adaptador **deve devolver** o número efetivamente usado
(`AuthorizedOutcome.number`), e é esse que o documento grava — não o que enviamos. Número explícito
segue aceito para o caso de **retransmissão de nota rejeitada**, que reaproveita a numeração.

---

## Decisão 4 — Cadastro fiscal: **migration nova** (aguardando aprovação)

O schema hoje **não tem onde guardar os dados fiscais obrigatórios**. O `Tenant` só tem `cnpj`; o
`Product` não tem nenhum campo fiscal. Sem isso, a nota é rejeitada pela SEFAZ.

### `Tenant` — dados do emitente

| Campo | Por quê |
|---|---|
| `inscricaoEstadual`, `inscricaoMunicipal` | Obrigatórios para emitir |
| `regimeTributario` | 1=Simples Nacional, 2=SN excesso de sublimite, 3=Regime Normal, 4=MEI |
| `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `codigoMunicipioIbge`, `uf`, `cep` | **Endereço completo é obrigatório no XML** |
| `cscNfce`, `idTokenNfce` (por ambiente) | Assinam o QR Code da NFC-e; emitidos pela SEFAZ estadual |
| `fiscalProviderToken` (cifrado) | Token da empresa no provedor |
| `serieNfce` | Série da numeração |

> Os nomes espelham deliberadamente os campos da API do provedor, para o adaptador ser uma tradução
> direta em vez de um mapeamento criativo.

> **Nota de modelagem ([ADR-038](ADR-038-empresa-acima-da-loja.md)):** estes campos ficam no `Tenant`
> porque a emissão fiscal é **por estabelecimento** — cada loja tem CNPJ, inscrição estadual, CSC,
> série e numeração próprios. Isso vale mesmo se um dia existir uma `Company` agrupando várias lojas:
> não existe "nota da empresa", existe nota **do estabelecimento**.

### `Product` — dados do item

| Campo | Por quê |
|---|---|
| `ncm` | Classificação fiscal (8 dígitos) |
| `cfop` | Natureza da operação (4 dígitos) |
| `cstOrCsosn` | Situação tributária |
| `origem` | Origem da mercadoria (0–8) |

**Mitigação do trabalho de cadastro** (são ~367 produtos): (a) **padrão por loja** — CFOP e CSOSN
costumam ser iguais para quase todo o catálogo, então o campo do produto vira exceção, não regra;
(b) o **NCM já existe no `ProductCatalog`** global do [ADR-025](ADR-025-catalogo-global-ean.md) e pode
ser propagado em massa por EAN; (c) as **APIs acessórias** da Focus validam NCM/CFOP e resolvem o
código IBGE do município.

⚠️ **Este serviço não calcula imposto.** CFOP, CST/CSOSN, NCM e origem são **entradas** do cadastro,
nunca inferidas — dependem do regime tributário e da UF, e devem ser definidos **com o contador do
cliente**. Um palpite errado gera nota rejeitada ou imposto recolhido a menor.

### `fiscal_documents` — persistência

A porta `FiscalDocumentStore` hoje tem só implementação em memória. A tabela definitiva guarda:
`tenantId`, `orderId` (**único por tenant** — a garantia de idempotência vira constraint de banco,
na lição do [ADR-025](ADR-025-catalogo-global-ean.md) §5.B), `status`, `accessKey`, `protocol`,
`number`, `series`, `totalCents`, `statusCode`, `statusReason`, timestamps.

---

## Decisão 5 — Contingência: **provedor + fila própria**

Quando a SEFAZ está fora, o serviço já marca o documento como `CONTINGENCY` e **não trava a venda**
(implementado e testado). Faltam duas peças:

1. Ligar `habilita_contingencia_offline_nfce` na empresa junto ao provedor;
2. Uma **fila de retransmissão** dos documentos em contingência — que deve reusar o desenho da fila
   offline do [ADR-011](ADR-011-fila-de-sincronizacao-offline.md) (FIFO, backoff, parar na 1ª falha
   dura), em vez de inventar um segundo mecanismo.

---

## Análise de Trade-offs

O eixo central é **onde mora a complexidade fiscal**. Trazê-la para dentro (Opção B) daria autonomia
total e custo marginal zero por nota, mas exigiria dominar assinatura XML, layouts por UF e
manutenção normativa — competências que **não diferenciam o NexoLoja** e que competiriam com o
roadmap de produto. Além disso, esbarra num limite estrutural: certificado por loja não escala em
bindings de Worker.

Delegar ao provedor troca **custo variável por velocidade e menor risco**, e ainda resolve de graça o
problema mais espinhoso (guarda de chave privada de terceiros). Para um produto que ainda vai
conquistar a primeira mensalidade, é a troca certa. Se um dia o volume tornar o custo por nota
relevante, a **porta `FiscalProvider` já isola essa decisão** — trocar de provedor, ou internalizar,
não toca o domínio.

## Consequências

- **Fica mais fácil:** emitir sem dominar o protocolo da SEFAZ; operar multi-tenant; trocar de
  provedor depois; nunca guardar chave privada de cliente.
- **Fica mais difícil:** o custo-zero acaba (custo por nota entra no preço); dependemos da
  disponibilidade de um terceiro; o cadastro fiscal vira pré-requisito de onboarding de cada loja.
- **Revisar no futuro:** se o volume tornar o custo por nota material, reavaliar internalização
  (mas provavelmente fora do Workers, num runtime com Node completo).

## Riscos e itens a verificar

| Item | Status |
|---|---|
| **Preço por nota** em produção | ❓ Não verificado — confirmar com a Focus |
| Homologação exige certificado A1? | ⚠️ **Sim para emitir.** O cadastro da empresa aceita ficar sem certificado (`senha_certificado` é "obrigatória apenas se informado o arquivo"), mas a doc é explícita: "a API cuida da assinatura digital" — sem certificado não há assinatura, e sem assinatura a SEFAZ não autoriza |
| CSC de homologação | Campo próprio (`csc_nfce_homologacao`); precisa ser gerado na SEFAZ estadual |
| Disponibilidade do provedor | Vira dependência de produção — monitorar |

## Action Items

1. [ ] **Owner:** cadastro gratuito na Focus NFe; confirmar **preço por nota** e a exigência de
       certificado em homologação.
2. [ ] **Owner:** obter **certificado A1** da loja piloto.
3. [ ] **Owner:** credenciamento na SEFAZ estadual + **CSC de homologação**.
4. [ ] **Owner + contador:** definir regime tributário e os códigos (CFOP, CST/CSOSN, NCM, origem).
5. [ ] Aprovar a **migration do cadastro fiscal** (Decisão 4) — regra 1 do `CLAUDE.md`.
6. [ ] Aprovar a **migration `fiscal_documents`** com `@@unique([tenantId, orderId])`.
7. [x] Numeração opcional no `IssueRequest` (Decisão 3) — **feito**, com testes.
8. [ ] Implementar `providers/focus.ts`, reusando os testes do adaptador de simulação como contrato.
9. [ ] Implementar `store/prisma.ts`.
10. [ ] DANFE NFC-e com QR Code.
11. [ ] Fila de retransmissão da contingência (Decisão 5).
12. [ ] Encaixe no PDV (`apps/api` chama o serviço na confirmação da venda) — **por último**.

## Fontes

- [Focus NFe — Introdução (assinatura digital, SaaS multi-CNPJ, APIs acessórias)](https://doc.focusnfe.com.br/reference/introducao)
- [Focus NFe — Ambientes de homologação e produção](https://doc.focusnfe.com.br/reference/ambiente)
- [Focus NFe — API de empresas (certificado, CSC, numeração, tokens)](https://doc.focusnfe.com.br/reference/criar_empresa)
- [Focus NFe — API de NFC-e](https://doc.focusnfe.com.br/reference/nfce)
- [SEFAZ/PE — Manual da NFC-e (CSC, credenciamento, homologação)](https://www.sefaz.pe.gov.br/Servicos/Nota-Fiscal-de-Consumidor-Eletronica/Manual%20da%20Nota%20Fiscal%20de%20Consumidor%20Eletrnica%20%20NFC/Guia%20da%20Nota%20Fiscal%20de%20Consumidor%20Eletr%C3%B4nica%20-%20v6.pdf)
- [Cloudflare Workers — bindings de mTLS](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/)
- [Comunicado de desativação da Nuvem Fiscal (31/07/2026)](https://www.projetoacbr.com.br/forum/topic/91922-comunicado-de-desativa%C3%A7%C3%A3o-do-servi%C3%A7o-nuvem-fiscal-22042026/)
