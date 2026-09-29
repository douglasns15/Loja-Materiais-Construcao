# ADR-039 — Ramo da loja: perfis de ramo que ligam módulos (a loja só vê o que é do seu ramo)

- **Status:** **Proposto** — aguardando aprovação do Owner. **Nada será codado nem migrado até a aprovação**
  (regras 1 e 4 do `CLAUDE.md`).
- **Data:** 2026-09-29
- **Deciders:** Owner do produto (pendente).
- **Contexto de fase:** implantação da primeira loja **fora de material de construção** — um
  **Mercadinho + Sorveteria + Rotisseria**. Companheiras: [ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md)
  (peso, balança e produção própria) e [ADR-041](./ADR-041-importacao-de-catalogo-por-planilha.md) (carga inicial
  do catálogo).

---

## Contexto

O NexoLoja nasceu como ERP **multirramos** ("core genérico com módulos ativáveis" — `CLAUDE.md`), e o schema
já tem o primitivo para isso: `TenantModule (tenantId, moduleKey, isActive, config Json)`. Mas, na prática,
**só um módulo usa essa tabela**: `OFFLINE_SALES` (ADR-011 §9). Todo o resto que é específico de material de
construção está **sempre visível para qualquer loja**:

| Recurso de construção sempre ligado | Onde aparece |
|---|---|
| Unidades de obra: milheiro, saco, barra, rolo, m, m², m³ | Seletor de unidade do cadastro de produto |
| Unidade fechada com corte por metro (ADR-017) | Cadastro + PDV |
| Par parafuso + bucha (ADR-015) | Cadastro de produto |
| Peso para frete pesado (`weightKg`) | Cadastro de produto |

Para uma loja de alimentos isso é ruído — e ruído no cadastro é exatamente o "trauma de usabilidade" que a
implantação precisa evitar. Ao mesmo tempo, **ramo não é uma coisa só**: a loja nova é **três ramos na mesma
porta**. Um modelo "1 loja = 1 ramo" não serve.

---

## Decisão

### 1. Ramo é um **preset**; o que liga/desliga recurso é o **módulo**

Separar dois conceitos:

- **Ramo** (`StoreSegment`) = o que a loja **é**. **Multisseleção** (Mercadinho + Sorveteria + Rotisseria).
  Serve para: aplicar o preset na criação, sugerir categorias iniciais, e (no futuro) benchmark por ramo.
- **Módulo** (`TenantModule.moduleKey`) = o que a loja **tem ligado**. É o que a UI consulta para mostrar ou
  esconder recurso. Ajustável caso a caso no painel, independente do ramo.

Na criação, o ramo escolhido liga a **união** dos módulos dos seus presets. Depois disso o Super Usuário pode
ligar/desligar módulo individual (como já faz com `OFFLINE_SALES`). Uma função pura em `packages/core`
(`modulesForSegments(segments) → ModuleKey[]`) faz o mapeamento, com testes Vitest.

### 2. Catálogo inicial de ramos e módulos

| Ramo (`StoreSegment`) | Módulos ligados pelo preset | Categorias sugeridas (editáveis) |
|---|---|---|
| `CONSTRUCTION` — Material de construção | `CONSTRUCTION_UNITS` | Hidráulica, Elétrica, Básico, Ferragens, Tintas… |
| `GROCERY` — Mercadinho | `SCALE_LABEL` | Mercearia, Bebidas, Frios e laticínios, Hortifruti, Limpeza, Higiene |
| `ICE_CREAM` — Sorveteria | `SCALE_LABEL` | Sorvete por kg, Picolés, Açaí, Coberturas e adicionais |
| `ROTISSERIE` — Rotisseria | `SCALE_LABEL` | Assados, Marmitas, Porções, Salgados |
| `GENERAL_RETAIL` — Varejo geral | — | — |

| Módulo | O que liga |
|---|---|
| `CONSTRUCTION_UNITS` | Unidades de obra (milheiro, saco, barra, rolo, m, m², m³), corte por metro (ADR-017), par (ADR-015), peso p/ frete |
| `SCALE_LABEL` | Campo "Código na balança" no produto + leitura da etiqueta no PDV + config do layout ([ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md)) |
| `OFFLINE_SALES` | (já existe — ADR-011 §9, comercial) |

**Fica no core (sempre ligado, qualquer ramo)** — porque serve a todo mundo:

- Venda **fracionada por kg/litro** (prego a kg também é construção) — [ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md).
- **Produto sem controle de estoque** (produção do dia, serviço) — [ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md).
- Pacote/fardo que abre e vende unidade (ADR-030) — fardo de 12 latas é o caso clássico do mercadinho.
- Retirada/entrega futura (ADR-020) — encomenda da rotisseria usa o mesmo motor.
- Botões rápidos no PDV (fatia futura) e importação por planilha ([ADR-041](./ADR-041-importacao-de-catalogo-por-planilha.md)).

Módulos futuros previstos (sem desenho ainda): `EXPIRY` (validade/lote), `ADDONS` (adicionais de sorvete/açaí),
`RECIPES` (ficha técnica/produção da rotisseria).

### 3. Gating é de **apresentação**, não de dado

- `GET /me` passa a devolver a lista de módulos ativos da loja (hoje devolve só o flag de offline).
- A web esconde o que o módulo não liga: opções do seletor de unidade, blocos do cadastro, colunas.
- A API **não recusa** dado de módulo desligado (ex.: produto já cadastrado em "barra" continua vendendo se
  alguém desligar o módulo). Desligar módulo **nunca** quebra venda nem apaga campo — só tira da tela o que
  não é usado. Isso torna ligar/desligar reversível e sem risco.

### 4. Retrocompatibilidade: lojas atuais não mudam nada

As lojas existentes são todas de material de construção. O backfill grava `segments = [CONSTRUCTION]` e liga
`CONSTRUCTION_UNITS` para **todas** as lojas atuais ⇒ comportamento idêntico ao de hoje. Só loja nova sem o
ramo construção passa a ver a tela enxuta.

### 5. Painel do Super Usuário (UX)

- **Nova loja:** além de nome/CNPJ/e-mail do admin, um seletor de **ramos em chips** (multisseleção, com
  ícone). Abaixo, um resumo do que vai ser ligado ("Etiqueta de balança ✓ · Unidades de obra ✗") e a lista de
  categorias sugeridas, que o implantador pode desmarcar antes de criar.
- **Lista de lojas:** cada loja mostra os ramos e ganha um painel "Módulos" com os interruptores (o de venda
  offline migra para ali).
- `POST /platform/tenants` ganha `segments` (e opcionalmente `seedCategories`); `PATCH /platform/tenants/:id/modules`
  já existe e só amplia a lista de chaves aceitas. **Contrato muda ⇒ atualizar `DOCUMENTACAO-TECNICA.md` §8.2
  na mesma mudança (regra 7).**

---

## Opções consideradas (onde guardar o ramo)

| Opção | Prós | Contras |
|---|---|---|
| **A — Coluna `Tenant.segments StoreSegment[]`** (enum nativo em array) — **recomendada** | Explícito no schema; consultável; enum leve (regra 6) | Exige migration (aditiva) |
| B — Guardar os ramos no `config` de um `TenantModule` "SEGMENTS" | Zero migration | Usa tabela de módulo para algo que não é módulo; JSON sem tipo; confunde quem lê o schema |
| C — Não guardar ramo, só módulos | Mais simples | Perde a informação "o que a loja é" (sugestões, benchmark do Horizonte 3) |

---

## Impacto no banco (a aprovar — regra 1)

Uma migration **aditiva**, sem perda de dado:

1. `CREATE TYPE "StoreSegment" AS ENUM ('CONSTRUCTION','GROCERY','ICE_CREAM','ROTISSERIE','GENERAL_RETAIL')`.
2. `ALTER TABLE tenants ADD COLUMN segments "StoreSegment"[] NOT NULL DEFAULT '{}'`.
3. Backfill: `UPDATE tenants SET segments = '{CONSTRUCTION}'` + `INSERT ... tenant_modules (moduleKey='CONSTRUCTION_UNITS', isActive=true)` para
   cada loja existente (`ON CONFLICT DO NOTHING`).

Os campos de produto do [ADR-040](./ADR-040-venda-por-peso-balanca-e-producao-propria.md) podem ir na **mesma**
migration (uma aprovação, um deploy).

---

## Consequências

- **Fica mais fácil:** implantar qualquer ramo novo = adicionar um valor ao enum + uma linha no preset; a loja
  de alimentos vê um cadastro enxuto no primeiro dia.
- **Fica mais difícil:** cada recurso específico de ramo precisa de **uma** checagem de módulo na UI — disciplina
  a manter nas próximas features (registrar o módulo no ADR de cada uma).
- **Risco:** esquecer de gatear um recurso de construção em alguma tela. Mitigação: um helper único
  `useModule('CONSTRUCTION_UNITS')` e o E2E da loja nova percorrendo cadastro/PDV/estoque.

## Fatias

1. **Fatia 1 — Dados + painel:** migration, `modulesForSegments` (core + testes), `POST /platform/tenants` com
   ramos e categorias sugeridas, painel "Módulos", `GET /me` com módulos.
2. **Fatia 2 — Gating na web:** helper `useModule`; esconder unidades/blocos de construção no cadastro, detalhe e
   PDV. E2E: loja Demo (construção) idêntica; loja nova enxuta.

## Relacionadas

- [ADR-009](./ADR-009-multi-loja-e-super-admin.md) — painel do Super Usuário e onboarding.
- [ADR-011](./ADR-011-fila-de-sincronizacao-offline.md) §9 — precedente de módulo por loja (`OFFLINE_SALES`).
- [ADR-013](./ADR-013-venda-em-unidade-alternativa.md), [ADR-015](./ADR-015-produto-agregado-venda-em-par.md),
  [ADR-017](./ADR-017-unidade-fechada-como-principal-barra.md) — recursos que passam para `CONSTRUCTION_UNITS`.
- [ADR-030](./ADR-030-pacote-como-unidade-fechada.md) — pacote fica no core (fardo do mercadinho).
