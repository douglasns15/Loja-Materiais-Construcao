# 🧭 Roadmap Funcional — NexoLoja

> **O que é este documento.** A visão de **produto**: o que queremos que o NexoLoja faça, por quê e em que ordem. É deliberadamente especulativo — itens aqui **não** são compromissos, e mudam conforme aprendemos com as lojas reais.
>
> **Última atualização:** 2026-08-22 — reorganizado em torno do **go-live comercial**.

## Como este documento se relaciona com os outros

| Documento | Responde | Natureza |
|---|---|---|
| **`PRODUCT-ROADMAP.md`** (este) | **O quê** e **por quê** — valor para o lojista | Futuro, incerto, reordenado com frequência |
| [`ROADMAP.md`](ROADMAP.md) | **O que já foi feito** — execução por fase | Histórico, fonte de verdade do progresso |
| [`adr/`](adr/) | **Como** — decisões técnicas com trade-offs | Pontual, imutável após aceito |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Como o sistema é hoje | Referência técnica viva |
| [`plano-producao.md`](plano-producao.md) | Checklist de infra para o go-live | Operacional |

**Regra prática:** uma ideia nasce aqui. Quando é priorizada e exige uma escolha técnica com consequências (modelagem, privacidade, custo, segurança), **aí** vira um ADR — e a execução é registrada no `ROADMAP.md`. Ideia sem decisão não vira ADR; ADR não é lista de desejos.

---

## Onde estamos

**Funcionalmente, o produto já é vendável.** PDV, caixa, estoque, fiado com conta do cliente, orçamentos, retirada/entrega futura, relatórios, multi-loja, offline e cadastro enriquecido por EAN/NF-e — é mais do que muitos concorrentes entregam no plano de entrada.

O que separa o NexoLoja da primeira mensalidade **não são features de operação de loja**. São quatro frentes que raramente entram num roadmap porque não parecem "produto": emissão fiscal, confiabilidade, adoção e cobrança. É isso que o Horizonte 0 organiza.

---

## Horizonte 0 — Go-live comercial (bloqueia a primeira venda)

> Objetivo: **poder cobrar de uma loja real, com segurança e sem digitação dupla.** Ordem sugerida de ataque: A → B → C → D. O fiscal começa primeiro por ser o mais longo e arriscado; a cobrança pode vir por último porque os primeiros contratos podem ser faturados na mão (PIX/boleto) enquanto o preço é validado.

### A. Emissão fiscal (NFC-e) — **o único bloqueio realmente crítico**

Uma loja que vende ao consumidor precisa emitir cupom fiscal. Sem isso o lojista mantém um segundo sistema só para emitir e digita tudo duas vezes — o que destrói a proposta de valor e transforma o NexoLoja em "sistema paralelo". É a diferença entre um piloto simpático e algo pelo qual alguém paga todo mês.

| Frente | Por que importa |
|---|---|
| **Provedor de API fiscal** | Focus NFe, PlugNotas/TecnoSpeed, Nuvem Fiscal ou eNotas. Ninguém deve falar com a SEFAZ na mão |
| **Certificado digital A1 da loja** | Exige armazenamento seguro e cifrado — decisão arquitetural nova (o R2 hoje guarda logo, não segredo) |
| **Contingência offline** | A NFC-e tem modo de contingência para quando a SEFAZ cai; conversa direto com o design offline-first ([ADR-011](adr/ADR-011-fila-de-sincronizacao-offline.md)/[012](adr/ADR-012-cold-start-offline-first-leitura.md)) e precisa ser desenhado junto |
| **DANFE NFC-e com QR Code** | Impressão diferente do comprovante atual |
| **Ciclo completo** | Cancelamento, inutilização de numeração, carta de correção |

⚠️ **Isto quebra o custo-zero** — é o primeiro custo variável real do produto. É repassável, mas precisa entrar na formação do preço. A importação de XML já entregue ([ADR-025](adr/ADR-025-catalogo-global-ean.md)) ajuda na familiaridade com o layout fiscal, mas **emitir é outro problema**.

> Obrigações específicas dependem do regime tributário de cada loja e devem ser confirmadas com o contador do cliente — nada aqui substitui orientação contábil.

### B. Confiabilidade — precondição, não feature

A partir do primeiro cliente pagante, o dado é dele e a falha é sua.

| Frente | Estado |
|---|---|
| **Supabase Pro** (backups diários, sem auto-pause) | Planejado em [`plano-producao.md`](plano-producao.md) |
| **Restauração de backup testada** | Pendente — backup não testado não é backup |
| **CI** (lint/typecheck/test/build a cada push) | **Não existe.** Com ~35k linhas e 29 migrations, uma regressão agora custa dinheiro e reputação |
| **CORS de produção + SMTP com marca** | Planejado em [`plano-producao.md`](plano-producao.md) |
| **Monitoramento e alerta básico** | A definir |

### C. Adoção — o que trava a primeira semana do lojista

| Frente | Por que importa |
|---|---|
| **Importador de catálogo (CSV/Excel)** | Uma loja real chega com 1.000–3.000 SKUs numa planilha ou sistema antigo. Sem importação, a migração vira semanas de digitação e o cliente desiste. EAN e NF-e resolvem o fluxo daqui pra frente, não o acervo inicial |
| **Categorias** | A 2.000 SKUs, catálogo sem categoria é inutilizável. O Owner já sinalizou ("vamos de Categorias") — faltam 2-3 decisões de produto |
| **Inventário inicial** | Contagem de abertura; o ajuste de estoque já existe, falta o fluxo guiado |

### D. Cobrança — o que efetivamente monetiza

| Frente | Estado |
|---|---|
| **Planos e preço** | A definir — depende do custo fiscal por nota |
| **Assinatura** (Asaas / Stripe / Pagar.me) | A definir |
| **Suspensão por inadimplência** | **O primitivo já existe**: `Tenant.isActive` + `SET_TENANT_ACTIVE` ([ADR-009](adr/ADR-009-multi-loja-e-super-admin.md)). Falta ligar ao status da assinatura |
| **Contrato, termos de uso e política de privacidade** | Pendente. Vocês armazenam CPF/nome/telefone de **clientes finais das lojas** → são operadores de dados sob a LGPD. Requer revisão jurídica |
| **Trial** | A definir |

> **Onboarding self-service NÃO entra aqui.** Para os primeiros clientes, o provisionamento manual pelo Super Usuário ([ADR-009](adr/ADR-009-multi-loja-e-super-admin.md)) é preferível: alto contato e aprendizado a cada instalação.

### Caminho alternativo (legítimo)

**Monetizar sem emissão fiscal**, posicionando o NexoLoja como camada de gestão para lojas que já emitem por outro meio. Encurta o caminho até a receita e serve para validar preço e demanda — mas convive com digitação dupla e não é produto definitivo.

---

## Horizonte 1 — Refino do balcão

Foco: **tornar o dia a dia impecável**. Origem: pedidos do Owner em `Uteis_Projeto_NexoLoja.txt`. Não bloqueia o go-live, mas melhora retenção.

> Verificado contra o código em 2026-08-20. Itens entregues saem daqui — o histórico fica no [`ROADMAP.md`](ROADMAP.md).

| Tema | Valor para o lojista |
|---|---|
| **Modernização visual** | Percepção de produto profissional; legibilidade no balcão. *Para vender, um polimento pontual em Venda/Caixa basta — o redesenho completo pode esperar* |
| **Gestão de senha pelo Super Usuário** | Destravar lojista que esqueceu a senha, sem depender de e-mail. *Vira suporte manual sem isso* |
| **Ver usuários de cada loja no painel** | Clicar no número de usuários e listar quem são |
| **Crédito parcelado** | Parcelamento sobre o total, com campo para valor extra |
| **Documentação de origem dos dados** | Cada número em tela com explicação de origem e cálculo — parcialmente atendido por `DOCUMENTACAO-TECNICA.md` |
| **Autocomplete de fabricante** | Sugerir marca já existente ao digitar (com Tab) |
| **Relatórios como painel de decisão** | Repaginação + inteligência: drill-down por forma de pagamento (pop-up), comparação com período anterior, **lucro/margem** ([ADR-027](adr/ADR-027-custo-congelado-na-venda.md)), top produtos/clientes com busca, projeções, insights configuráveis e export CSV/PDF. **Planejado e detalhado em [`plano-relatorios-v2.md`](plano-relatorios-v2.md)** (aprovado 2026-08-26; falta desenvolver) |
| **Contador de caixa persistente** | Manter valores digitados até abrir/fechar o caixa + botão "zerar contador" |
| **Filtro por coluna** | Filtrar em cada cabeçalho de tabela |

### Bugs conhecidos (reportados pelo Owner)

- **Peso do produto:** cadastrado em gramas, é convertido para quilos ao salvar.
- **Crédito de devolução:** o botão de crédito não habilita no fluxo devolução → nova compra.
- **Observação do produto:** não aparece na info do item no carrinho.

### Entregues recentemente (não repetir aqui)

Pagamento dividido · paginação por cursor + filtro de período no histórico · ordenação (maior/menor valor, data) · botão "voltar ao topo" · sangria/suprimento e extrato do caixa · contador de cédulas e mini-DRE · troco e formas no comprovante · busca no servidor em Clientes/Produtos · numeração sequencial de vendas (`V-000128`) e busca por código · orçamentos salvos (`O-000045`, ciclo de vida, converter em venda) · correção do logo que sumia do comprovante ao ser trocado · valor recebido e troco por venda (Histórico + comprovante) · navegação ‹ Hoje › + default "Hoje" nos filtros por data (Relatórios/Vendas/Movimentações) · fiado / contas a receber ([ADR-019](adr/ADR-019-venda-a-prazo-contas-a-receber.md)) e conta do cliente com devolução por item + crédito ([ADR-022](adr/ADR-022-conta-do-cliente-fiado-acumulado.md)) · **dívida do cliente como conta-corrente** (`D-0001`, visão unificada Em aberto/Quitadas, vencimento na dívida — [ADR-026](adr/ADR-026-divida-do-cliente-como-entidade.md)) · cadastro por código de barras via catálogo global + importação de XML de NF-e ([ADR-025](adr/ADR-025-catalogo-global-ean.md)) · busca do histórico de vendas por cliente e por valor · cadastro de fornecedores · esteira de precificação · retirada/entrega futura ([ADR-020](adr/ADR-020-retirada-entrega-futura.md)) · cesta persistente entre dispositivos ([ADR-021](adr/ADR-021-cesta-persistente-sincronizada.md)).

---

## Horizonte 2 — Loja completa

Foco: **fechar o ciclo comercial** e o módulo de material de construção. Depois do go-live.

| Tema | Valor | Notas |
|---|---|---|
| **Frete pesado e roteiro de entrega** | Diferencial do ramo: motorista, veículo, peso | `Delivery` já existe no schema; retirada/entrega futura entregue ([ADR-020](adr/ADR-020-retirada-entrega-futura.md)) |
| **Compras e reposição** | Fechar o ciclo com fornecedor; sugestão de compra pelo mínimo | `Supplier`, `minStockQty` e entrada por NF-e já existem |
| **Contas a pagar** | Fluxo de caixa real do lojista — hoje só há contas a **receber** | — |
| **Exportação para o contador** | Envio mensal de dados; com NFC-e boa parte vem dos XMLs | — |
| **Offline-first completo** | Caixa 100% sem internet | Venda offline entregue ([ADR-011](adr/ADR-011-fila-de-sincronizacao-offline.md)); falta cobertura total |
| **Usuário multi-loja** | Um operador atuando em mais de uma loja | [ADR-014](adr/ADR-014-usuario-multi-loja.md) segue **Proposto**, não implementado |

---

## Horizonte 3 — Depois (a plataforma como vantagem)

> Este é o horizonte que justifica ser **multi-loja**. Nada aqui está decidido, e **quase tudo depende de resolver privacidade e consentimento antes** (ver a seção seguinte).

Quando muitas lojas usam o sistema, os dados agregados passam a valer mais do que a soma das partes:

| Ideia | Valor potencial |
|---|---|
| **Tendências de preço** | "O cimento CP-II subiu 8% na sua região no último mês" — apoia decisão de compra e remarcação |
| **Benchmark de margem** | "Sua margem em vergalhão está abaixo da mediana de lojas parecidas" |
| **Previsão de demanda** | Sazonalidade do setor (chuva, safra, obras) para antecipar compra |
| **Sugestão de reposição inteligente** | Ponto de reposição calculado por histórico real, não por mínimo fixo |
| **Poder de compra coletivo** | Agregar demanda de várias lojas para negociar com fornecedor |
| **Detecção de anomalia** | Alertar preço de venda abaixo do custo, ou ajuste de estoque atípico |

**O primeiro passo desta lista — o catálogo compartilhado — já foi dado** ([ADR-025](adr/ADR-025-catalogo-global-ean.md)): cadastrar produto por código de barras puxando nome/marca do catálogo global cross-tenant, além de importação de XML de NF-e. Foi a escolha certa de *primeiro passo* justamente porque entrega valor imediato ao lojista (cadastro rápido), gera dado estruturado para todo o resto e tem risco de privacidade baixo — dado de produto de fabricante não é dado comercial sensível. O restante deste horizonte permanece como visão futura.

---

## Restrições que valem para todo o Horizonte 3

Antes de qualquer funcionalidade que cruze dados entre lojas, três coisas precisam estar resolvidas. Ignorá-las cria risco jurídico e, pior, quebra a confiança do cliente:

1. **Base legal e consentimento (LGPD).** Usar dados de uma loja para gerar produto que beneficia outras exige previsão contratual clara e, provavelmente, **opt-in explícito**. O lojista precisa entender e concordar. *Não sou advogado — isto precisa de revisão jurídica antes de virar produto.*
2. **Anonimização e agregação.** Nada deve permitir inferir a operação de uma loja específica. Isso implica pisos de agregação (ex.: só publicar um indicador com no mínimo N lojas na amostra) e granularidade regional, nunca por concorrente identificável.
3. **Isolamento arquitetural.** O multi-tenancy hoje é garantido por **RLS** ([ADR-005](adr/ADR-005-stack-e-arquitetura.md)) — o que é uma força a preservar. Análise cross-tenant **não pode** ser feita relaxando policies de RLS; precisa de um caminho separado (pipeline/dataset agregado), no espírito do que o [ADR-009](adr/ADR-009-multi-loja-e-super-admin.md) fez para o Super Usuário.

Há ainda uma restrição de negócio: o lojista **compete** com outras lojas. Um benchmark mal desenhado pode ser lido como "o sistema entrega meus números para o concorrente". A comunicação e o controle do lojista sobre isso são parte do produto, não detalhe.

---

## Não é prioridade agora

Registrado para evitar esforço fora de hora: **dark mode e customização de cores**, **signup self-service**, **redesenho visual completo**, e a **inteligência multi-loja do Horizonte 3** (só faz sentido com massa de lojas).

---

## Perguntas em aberto (viram ADR quando priorizadas)

Cada item abaixo é uma decisão real com trade-offs — exatamente o material de um ADR:

**Go-live**

- **Emissão fiscal:** qual provedor? Onde guardar o certificado A1 com segurança? Como a contingência offline conversa com a fila de sincronização? → candidato a **nova ADR** (ADR-027+; o número ADR-026 já é a dívida do cliente).
- **Monetização:** quantos planos? O que entra no plano de entrada? A nota fiscal é cobrada à parte (custo variável) ou embutida?
- **Importação de catálogo:** formato livre com De-Para (como na NF-e) ou template fixo?

**Plataforma (Horizonte 3)**

- **Consentimento:** opt-in por loja, por módulo, ou contratual global? O que a loja recebe em troca?
- **Onde processar:** agregação no próprio Postgres (barato, mas concorre com a carga transacional) ou dataset/pipeline separado?
- **Piso de anonimato:** qual N mínimo de lojas por indicador? Qual granularidade geográfica?
- ~~**Identidade de produto entre lojas**~~ — **Resolvido** por [ADR-025](adr/ADR-025-catalogo-global-ean.md): catálogo global chaveado por GTIN/EAN.

---

## Como manter este documento

- Revisar a cada ciclo, ao fechar uma fase do `ROADMAP.md`.
- Item entregue **sai daqui** — o histórico fica no `ROADMAP.md`.
- Item priorizado que exija decisão técnica **ganha um ADR** antes da implementação (regra 1 do [`CLAUDE.md`](../CLAUDE.md) para mudanças de banco).
- Ideias cruas do Owner podem continuar chegando por `Uteis_Projeto_NexoLoja.txt`; este documento é onde elas são **organizadas e priorizadas**.
