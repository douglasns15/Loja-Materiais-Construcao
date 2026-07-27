# 🧭 Roadmap Funcional — NexoLoja

> **O que é este documento.** A visão de **produto**: o que queremos que o NexoLoja faça, por quê e em que ordem. É deliberadamente especulativo — itens aqui **não** são compromissos, e mudam conforme aprendemos com as lojas reais.
>
> **Última atualização:** 2026-07-27

## Como este documento se relaciona com os outros

| Documento | Responde | Natureza |
|---|---|---|
| **`PRODUCT-ROADMAP.md`** (este) | **O quê** e **por quê** — valor para o lojista | Futuro, incerto, reordenado com frequência |
| [`ROADMAP.md`](ROADMAP.md) | **O que já foi feito** — execução por fase | Histórico, fonte de verdade do progresso |
| [`adr/`](adr/) | **Como** — decisões técnicas com trade-offs | Pontual, imutável após aceito |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Como o sistema é hoje | Referência técnica viva |

**Regra prática:** uma ideia nasce aqui. Quando é priorizada e exige uma escolha técnica com consequências (modelagem, privacidade, custo, segurança), **aí** vira um ADR — e a execução é registrada no `ROADMAP.md`. Ideia sem decisão não vira ADR; ADR não é lista de desejos.

---

## Horizonte 1 — Agora (loja única, uso diário)

Foco: **tornar o dia a dia do balcão impecável**. Origem: pedidos do Owner registrados em `Uteis_Projeto_NexoLoja.txt` (conferir no `ROADMAP.md` quais já saíram).

| Tema | Valor para o lojista |
|---|---|
| **Modernização visual** | Percepção de produto profissional; legibilidade no balcão |
| **Histórico de vendas completo** | Ver *tudo* da venda (dinheiro recebido, troco, formas); agrupar, filtrar por coluna, ordenar, buscar por nota |
| **Numeração de nota** | Número visível no comprovante impresso e no histórico — referência ao conversar com o cliente |
| **Navegação por período nos relatórios** | Percorrer dias com `< Hoje >` sem digitar datas |
| **Gestão de senha pelo Super Usuário** | Destravar lojista que esqueceu a senha, sem depender de e-mail |
| **Correção do logo** | Logo sumindo do comprovante ao ser trocado — quebra a identidade da loja |
| **Documentação de origem dos dados** | Cada número em tela deve ter explicado de onde vem e como é calculado |

---

## Horizonte 2 — Próximo (loja completa)

Foco: **fechar o ciclo comercial** e o módulo de material de construção.

| Tema | Valor | Notas |
|---|---|---|
| **Entregas e frete pesado** | Diferencial do ramo: agendar entrega, motorista, veículo, peso | Modelo `Delivery` **já existe** no schema; falta produto/UI |
| **Fiado / contas a receber** | Prática comum no balcão de material de construção | Exige modelagem de crédito do cliente |
| **Compras e reposição** | Fechar o ciclo com fornecedor; sugestão de compra pelo mínimo | `Supplier` e `minStockQty` já existem |
| **Crédito parcelado** | Parcelamento sobre o total, com valor extra | Interage com [ADR-016](adr/ADR-016-preco-e-margem-por-forma-de-pagamento.md) |
| **Emissão fiscal (NFC-e/NF-e)** | Obrigação legal para operar formalmente | Depende de integração terceira — decisão em aberto |
| **Offline-first completo** | Caixa opera sem internet | Fase 3 do `ROADMAP.md`; ADRs [011](adr/ADR-011-fila-de-sincronizacao-offline.md)/[012](adr/ADR-012-cold-start-offline-first-leitura.md) |
| **Orçamento / pré-venda** | Cotação que vira venda — comum em obra | — |

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
| **Catálogo compartilhado** | Cadastrar produto por código de barras puxando nome/marca já cadastrados por outras lojas — reduz drasticamente o atrito de cadastro |
| **Poder de compra coletivo** | Agregar demanda de várias lojas para negociar com fornecedor |
| **Detecção de anomalia** | Alertar preço de venda abaixo do custo, ou ajuste de estoque atípico |

**O ativo mais subestimado da lista é o catálogo compartilhado:** ele entrega valor imediato ao lojista (cadastro rápido), gera dado estruturado para todo o resto e tem risco de privacidade baixo — dado de produto de fabricante não é dado comercial sensível. É o candidato natural a *primeiro passo*.

---

## Restrições que valem para todo o Horizonte 3

Antes de qualquer funcionalidade que cruze dados entre lojas, três coisas precisam estar resolvidas. Ignorá-las cria risco jurídico e, pior, quebra a confiança do cliente:

1. **Base legal e consentimento (LGPD).** Usar dados de uma loja para gerar produto que beneficia outras exige previsão contratual clara e, provavelmente, **opt-in explícito**. O lojista precisa entender e concordar. *Não sou advogado — isto precisa de revisão jurídica antes de virar produto.*
2. **Anonimização e agregação.** Nada deve permitir inferir a operação de uma loja específica. Isso implica pisos de agregação (ex.: só publicar um indicador com no mínimo N lojas na amostra) e granularidade regional, nunca por concorrente identificável.
3. **Isolamento arquitetural.** O multi-tenancy hoje é garantido por **RLS** ([ADR-005](adr/ADR-005-stack-e-arquitetura.md)) — o que é uma força a preservar. Análise cross-tenant **não pode** ser feita relaxando policies de RLS; precisa de um caminho separado (pipeline/dataset agregado), no espírito do que o [ADR-009](adr/ADR-009-multi-loja-e-super-admin.md) fez para o Super Usuário.

Há ainda uma restrição de negócio: o lojista **compete** com outras lojas. Um benchmark mal desenhado pode ser lido como "o sistema entrega meus números para o concorrente". A comunicação e o controle do lojista sobre isso são parte do produto, não detalhe.

---

## Perguntas em aberto (viram ADR quando priorizadas)

Cada item abaixo é uma decisão real com trade-offs — exatamente o material de um ADR:

- **Consentimento:** opt-in por loja, por módulo, ou contratual global? O que a loja recebe em troca (desconto? acesso ao insight?)?
- **Onde processar:** agregação no próprio Postgres (barato, mas concorre com a carga transacional) ou um dataset/pipeline separado?
- **Piso de anonimato:** qual N mínimo de lojas por indicador? Qual granularidade geográfica?
- **Identidade de produto entre lojas:** como reconciliar catálogos? Por GTIN/código de barras, ou uma entidade canônica de produto na plataforma?
- **Emissão fiscal:** qual provedor, e o que acontece com o offline quando a emissão exige rede?
- **Modelo de negócio:** o insight é do plano base ou de um plano superior?

---

## Como manter este documento

- Revisar a cada ciclo, ao fechar uma fase do `ROADMAP.md`.
- Item entregue **sai daqui** — o histórico fica no `ROADMAP.md`.
- Item priorizado que exija decisão técnica **ganha um ADR** antes da implementação (regra 1 do [`CLAUDE.md`](../CLAUDE.md) para mudanças de banco).
- Ideias cruas do Owner podem continuar chegando por `Uteis_Projeto_NexoLoja.txt`; este documento é onde elas são **organizadas e priorizadas**.
