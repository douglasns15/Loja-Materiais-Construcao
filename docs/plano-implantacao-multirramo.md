# Plano — Implantação multirramo (1ª loja de alimentos) + usuário multi-loja

> **Estado em 2026-10-09 (noite):** **#8 etiqueta de balança** (ADR-040 F3) **implementada e validada no navegador**
> (web de dev + API local contra o banco real, loja de teste de alimentos) — sem migration (`scaleCode` já na `0041`;
> layout em `TenantModule.config`). **Formato da etiqueta parametrizado** (PLU 4/5/6, valor 5/6, dígito do valor;
> padrão `2 CCCC 0 VVVVVV D` + preço) com "Testar etiqueta" no painel. **NO AR** (API `8932d7a3`, web `9146d36d`).
> Validar o formato com a balança real quando ela for comprada. Próxima: **#9 planilha** (ADR-041 Fatia 3).
>
> **Estado em 2026-10-09 (tarde):** **#7 cadastro no caixa** (ADR-041 §B) **implementada e validada no navegador**
> (web de dev + **API local** contra o banco real, loja de teste de alimentos) — sem migration (`pendingReview` já
> existia, `0041`). **NO AR** (API `7d56b1c0`, web `68d3dd0e`; deploy autorizado pelo Owner). Corrigidos no caminho 2 bugs antigos do PDV
> (ver registro de testes). Próxima: **#8 etiqueta de balança** (ADR-040 F3).
>
> **Estado em 2026-10-09:** **#6 cadastro em sequência** (ADR-041 §A) **implementada e validada no navegador** (dev
> local contra a API de produção, loja de teste de alimentos) — tela `/products/sequencia`, só web, sem rota nova nem
> migration. **NO AR** (web `3e49c8d1`, deploy autorizado pelo Owner). Próxima: **#7 cadastro no caixa** (ADR-041 §B).
>
> **Estado em 2026-10-08:** **Produção Fatia 3 — desmembramento** (peça → cortes, ADR-043) **NO AR** (API `2102b938`,
> web `b776da67`; migration `0045` `productions.kind` aprovada e aplicada; commits `793e063`, `7f104a4`) e **E2E
> validado no navegador** com usuário Operador. ADR-043 completa. Também: teste com **Operador** das Fatias 1+2
> validado e **recarga automática pós-deploy** (ChunkLoadError, `a0814d7`). Próxima: **#6 cadastro em sequência**.
>
> **Estado em 2026-10-07:** **Produção Fatia 2** (perda do pronto + resumo do dia + histórico por dia, ADR-043 §3)
> **NO AR** (API `674f35a3`, web `f94f5c7f`; commits `9118d94`, `5e0801d`) e **E2E validado no navegador**; sem
> migration. Próxima: **Fatia 3 (desmembramento)** ou **#6 cadastro em sequência** — Owner escolhe.
>
> **Estado em 2026-10-02:** E2E do Owner da agenda/peças feito; os achados viraram a **revisão da ADR-042**
> (Saiu p/ entrega conclui, Voltou/reagendar, Data por item na agenda, concluídos ocultos) + **Funcionários
> `0043`** + **Produção com ficha técnica (ADR-043 Fatia 1, `0044`)** — tudo **NO AR** (API `490fab8d`, web
> `8840ab5f`) e **E2E validado no navegador**. Próxima: **Produção Fatia 2** (perda + resumo do dia), depois a
> Fatia 3 (desmembramento) e então a #6.
>
> **Estado em 2026-10-01 (noite):** encaixados antes da #6, a pedido do Owner — **Estoque de pesados por
> peças** (ADR-040 §4.1, commit `a0cb22d`) e **Agenda de entregas** (ADR-042: migration `0042` aplicada +
> 3 fatias, commits `74d0568`/`9dbb6ae`/`106ba9f`). Ambos **NO AR** (API `952ae59c`, web `ea2b5931`);
> **E2E do Owner pendente**. Próxima: #6 (cadastro em sequência).
>
> Entrega #5 (`trackStock`) + "vendido inteiro também" (ADR-040 §4) NO AR — API `22042b01`, web `8cfe172e`;
> E2E do Owner VALIDADO.
>
> Entrega #4 (gating na web) NO AR — web `275b72a9`; E2E do Owner VALIDADO (inclui a criação da loja de
> alimentos pelo painel, entrega #3).
>
> Estado em 2026-09-30: ADRs 014/039/040/041 ACEITAS pelo Owner (decisões no §4). Entregas #1 (kg/L), #2
> (migration `0041`) e #3 (ramo no painel + módulos) NO AR — API `351e86ac`, web `dbc6a24a`. E2E do Owner
> pendente.
>
> Estado em 2026-09-29: PLANEJAMENTO. Nada codado, nada migrado, nada deployado.
> Só documentação: ADRs [039](adr/ADR-039-ramo-da-loja-e-modulos.md), [040](adr/ADR-040-venda-por-peso-balanca-e-producao-propria.md)
> e [041](adr/ADR-041-importacao-de-catalogo-por-planilha.md) escritas como **Proposto**; [ADR-014](adr/ADR-014-usuario-multi-loja.md)
> (multi-loja, de 2026-07-17) priorizada pelo Owner, ainda **Proposto**.
>
> **Para retomar em outra sessão:** leia este arquivo, depois a seção "O que falta o Owner decidir".

---

## 1. O pedido

Implantar uma loja nova — **Mercadinho + Sorveteria + Rotisseria** (sem sistema anterior; balança ainda não
comprada) — de forma moderna e sem trauma de usabilidade, começando pelo cadastro inicial dos produtos. E, no
mesmo movimento:

- **Ramo escolhido no painel do Super Usuário** ao cadastrar a loja, deixando só as opções relevantes ao ramo.
- **Um mesmo usuário acessando mais de uma loja**, com seletor de loja no login.
- Prever clientes futuros que **venham de outro sistema** (exportação → importação).
- **NFC-e:** registrada como muito importante; já há a branch `feat/nfe-emissao`. **O Owner avisa quando for
  retomar — não iniciar antes.**

## 2. O que a análise do código revelou (2026-09-29)

A loja de alimentos **não consegue vender hoje**:

| Bloqueio | Onde | Resolve |
|---|---|---|
| Sem venda fracionada por kg (stepper passo 1, exceto metro de barra) | `apps/web/app/(app)/venda/page.tsx` (`isMeterLine`) | ADR-040 §1 |
| Venda trava sem estoque (produção do dia) | `apps/api/src/routes/orders.ts` ("Estoque insuficiente") | ADR-040 §2 (`trackStock`) |
| Sem leitura de etiqueta de balança | não existe | ADR-040 §3 |
| Recursos de construção visíveis a qualquer loja | `TenantModule` só usado por `OFFLINE_SALES` | ADR-039 |
| PDV não oferece cadastrar código desconhecido | `venda/page.tsx` ("Nenhum produto encontrado.") | ADR-041 §B |
| Produto sem NCM (pré-requisito da NFC-e) | só `ProductCatalog.ncm` | decisão em aberto (ADR-040) |

## 3. Decisões de desenho (propostas)

- **Ramo × módulo (ADR-039):** ramo = o que a loja é (multisseleção, `Tenant.segments`); módulo = o que está
  ligado (`TenantModule`). Ramo aplica um preset de módulos + categorias sugeridas. Gating só de apresentação.
  Lojas atuais recebem `CONSTRUCTION` no backfill ⇒ nada muda para elas.
- **Peso e balança (ADR-040):** kg/L com 3 casas (core, sem migration); `Product.trackStock`; `Product.scaleCode`
  + `parseScaleBarcode` (EAN-13 prefixo `2` = PLU + preço ou peso; layout por loja). Etiquetadora funciona com
  qualquer marca (o PDV só lê o código); balança de checkout (serial) fica para depois. Recomendação de compra:
  etiquetadora com **preço** embutido.
- **Carga do catálogo (ADR-041):** a loja **não precisa de 100% do catálogo no dia 1**.
  - **Cadastro em sequência** (bipa → catálogo global preenche → preço + qtd) — porta principal, pois loja
    pequena **nem sempre recebe XML** (ponto levantado pelo Owner).
  - **Cadastro no caixa** — código desconhecido no PDV vira "Cadastrar agora"; a cauda longa se cadastra sozinha.
  - **Planilha** — itens sem código de barras (sorvete, pratos, granel) e exportação de sistema anterior (De-Para).
  - **XML de NF-e** — já existe; quando houver.
  - **Futuro (fase NFC-e):** download automático das NF-e recebidas na SEFAZ com o certificado A1.
  - Descartado por ora: foto da nota com IA (custo por foto, erra, sem EAN).
- **Multi-loja (ADR-014, já desenhada):** `TenantMembership` com papel por loja; loja ativa via header
  `x-active-tenant` validado na API; seletor no login + "trocar de loja"; convite de e-mail existente com aceite;
  RLS "as lojas do usuário" (Opção RLS-B). Compatível com a invariante 1 da ADR-038 (fronteira de RLS continua
  sendo a loja). Também resolve o acesso do **implantador** à loja do cliente (o suporte do Super Usuário é
  somente leitura).

## 4. Decisões do Owner (2026-09-30) ✅

1. **Migration única ADR-039 + ADR-040 — APROVADA** (aditiva, sem perda): `Tenant.segments` (enum `StoreSegment[]`,
   backfill `CONSTRUCTION` + módulo `CONSTRUCTION_UNITS` nas lojas atuais), `Product.trackStock` (default `true`),
   `Product.scaleCode` (+ índice único parcial por loja).
2. **`Product.ncm` — INCLUÍDO** na mesma migration. **Visível no cadastro de qualquer loja**, não só da loja nova
   (sem gating de ramo).
3. **Excel: `read-excel-file`** — e um **modelo simples de preenchimento** para enviar ao cliente antes da
   implantação.
4. **ADR-014 aprovada como está.**
5. **Cadastro no caixa: operador também pode** — e o admin recebe **alerta dos produtos cadastrados no caixa**
   para conferência (lista exata, não heurística).
6. **Ordem de execução confirmada** (multi-loja por último).
7. **Balança:** ainda não comprada — quando comprar, informar marca/modelo e se a etiqueta embute preço ou peso
   (não bloqueia o início; a Fatia 3 do ADR-040 espera por isso).

## 5. Ordem de execução proposta

| # | Entrega | Migration? | ADR |
|---|---|---|---|
| 1 | Venda por kg/L fracionada (3 casas) — **NO AR 2026-09-30** (web `dbc6a24a`; E2E pendente) | Não | 040 §1 |
| 2 | Migration única (segments, trackStock, scaleCode, ncm, pendingReview) — **`0041` aplicada 2026-09-30** | **Sim** — aprovada | 039/040/041 |
| 3 | Ramo no painel + módulos + `GET /me` com módulos — **NO AR 2026-09-30** (API `351e86ac`, web `dbc6a24a`; E2E pendente) | (usa a #2) | 039 F1 |
| 4 | Gating na web (esconder construção) — **NO AR 2026-10-01** (web `275b72a9`; E2E do Owner VALIDADO) | Não | 039 F2 |
| 5 | `trackStock` na venda/devolução/alertas — **NO AR 2026-10-01** (API `22042b01`, web `8cfe172e`; E2E do Owner VALIDADO) + "vendido inteiro também" (040 §4) | (usa a #2) | 040 F2 |
| 5a | **Estoque de pesados por peças** (Entrada peça a peça, "≈ N peças", última peça) + peso com 3 casas — pedido do Owner, encaixado antes da #6 (commits `3d57bc7`, `a0cb22d`) | Não | 040 §4.1 |
| 5b | **Agenda de entregas** (Funcionários, agendamento no PDV, Agenda do dia, Período de entregas, Saiu p/ entrega) — pedido do Owner, encaixado antes da #6 (commits `74d0568`, `9dbb6ae`, `106ba9f`) — E2E do Owner feito 2026-10-02 | **Sim** — `0042` aprovada e aplicada | 042 |
| 5c | **Revisão da agenda** (Saiu p/ entrega conclui, Voltou/reagendar, Data por item na agenda, concluídos ocultos) + **Funcionários** (e-mail + 7 funções) — **NO AR + E2E validado 2026-10-02** (commits `672da74`, `f69ad3a`, `d5c37cd`, `dbc0e5a`) | **Sim** — `0043` aprovada e aplicada | 042 (revisão) |
| 5d | **Produção com ficha técnica — Fatia 1** (ficha, tela Produção, P-0001, último custo, módulo `RECIPES`) — **NO AR + E2E validado 2026-10-02** (commits `0164bb9`, `947522e`, `dbc0e5a`) | **Sim** — `0044` aprovada e aplicada | 043 |
| 5e | **Produção — Fatia 2** (perda/sobra + resumo do dia + histórico por dia) — **NO AR + E2E validado 2026-10-07** (API `674f35a3`, web `f94f5c7f`; commits `9118d94`, `5e0801d`) | Não | 043 |
| 5f | **Produção — Fatia 3** (desmembramento: peça → cortes, rateio pelo valor de venda, cortes sugeridos pelos últimos 5 desmembramentos) — **NO AR + E2E validado 2026-10-08** (API `2102b938`, web `b776da67`; commits `793e063`, `7f104a4`) | **Sim** — `0045` (`productions.kind`) aprovada e aplicada; sem tabela de modelo | 043 |
| 6 | **Cadastro em sequência** (bipa → ficha do catálogo → preço + qtd → Enter; código já cadastrado ⇒ contagem de abertura) — **NO AR + validada no navegador 2026-10-09** (web `3e49c8d1`; commit `97a99e1`) | Não | 041 §A |
| 7 | **Cadastro no caixa** + alerta de revisão — **NO AR + validada no navegador 2026-10-09** (API `7d56b1c0`, web `68d3dd0e`; commit `6e223b9`) | Não (`pendingReview` já na `0041`) | 041 §B |
| 8 | Etiqueta de balança (`scaleCode` + parser + PDV + formato parametrizado) — **NO AR + validada no navegador 2026-10-09** (API `8932d7a3`, web `9146d36d`) | Não (usa a `0041`) | 040 F3 |
| 9 | Importador de planilha (modelo + De-Para) | Não | 041 §1–§6 |
| 10 | Usuário multi-loja (5 fatias da ADR-014) | **Sim** (3 migrations) | 014 |
| — | NFC-e + download automático de NF-e | — | **aguarda o Owner** |

Racional: #1–#8 são o que a loja nova precisa para abrir; a planilha fica para os poucos itens sem código e
para clientes futuros; o multi-loja é grande e não bloqueia a abertura (se o Owner precisar dele antes, sobe).

## 6. Onde paramos (2026-10-08)

- **Teste com Operador VALIDADO** (`operador_kg@lojademo.com`, papel Usuário, loja Demo Mercardinho — criado com
  `packages/db/scripts/create-user.mjs`, senha padrão dos scripts): ficha só leitura (tela + `PUT`/`DELETE` 403),
  registra produção (P-0002) e perda.
- **5f NO AR 2026-10-08** — aba **Desmembrar** na Produção: peça (sem saldo bloqueia) + peso de cada corte, rateio do
  custo **pelo valor de venda** (`splitBreakdownCost`), **quebra** informativa, cortes acima da peça recusados, último
  custo por corte; lista pré-montada com os cortes que **costumam sair** da peça (últimos 5 desmembramentos, mais
  frequentes primeiro — `suggestBreakdownCuts`; dica discreta na tela); cortes entram no resumo do dia e na perda.
  Rotas `POST /productions/breakdown` e `GET /productions/breakdown/cuts/:productId`. Migration `0045`.
- **Recarga automática pós-deploy** (só web): aba aberta antes de um deploy que caía em "Algo deu errado ao abrir a
  tela" (ChunkLoadError) agora recarrega sozinha 1 vez (online, trava de 30 s) — `apps/web/lib/chunkReload.ts`.
- Dados de teste na Demo Mercardinho: Quarto traseiro (teste) `tst-qtr` (12 kg), Picanha/Alcatra/Aparas (teste)
  `tst-pic`/`tst-alc`/`tst-apa`, desmembramentos P-0003 e P-0004, perda de 0,5 kg de Aparas, produção P-0002 e perda
  de 1,2 kg do Frango Assado (Operador).
- **Próxima entrega de código:** **#9 planilha** (ADR-041 Fatia 3) — #6, #7 e #8 feitas em 2026-10-09.
- Push dos commits em `main`: Owner (ver ROADMAP "Onde paramos").

### Histórico — onde paramos em 2026-10-07

- **5e NO AR 2026-10-07 (API `674f35a3`, web `f94f5c7f`)** — perda do pronto (`POST /productions/loss`), resumo do
  dia (`GET /productions/summary`) e histórico por dia na tela Produção; E2E validado no navegador (roteiro
  [testes/e2e-producao-ficha-tecnica.md](testes/e2e-producao-ficha-tecnica.md) §D). Dado de teste novo: perda de
  2,4 kg "Sobra do dia" do Frango Assado (estoque 20,300 kg).
- Próxima entrega era 5f ou #6 — o Owner escolheu a **5f**, feita em 2026-10-08 (acima), junto com o teste do Operador.

### Histórico — onde paramos em 2026-10-02

- #1–#5, 5a, 5b no ar e validadas. **5c e 5d NO AR 2026-10-02 (API `490fab8d`, web `8840ab5f`)**, E2E validado no
  navegador (roteiros [testes/e2e-pecas-e-agenda-de-entregas.md](testes/e2e-pecas-e-agenda-de-entregas.md) §F/§G e
  [testes/e2e-producao-ficha-tecnica.md](testes/e2e-producao-ficha-tecnica.md); evidência em
  [testes/registro-de-testes.md](testes/registro-de-testes.md)).
- Próxima entrega era a Produção Fatia 2 — **feita em 2026-10-07** (acima).
- Faltou testar com usuário **Operador** (ficha só leitura; registra produção).
- Dados de teste na loja `owner_kg`: insumos Frango inteiro congelado / Tempero baiano, ficha do Frango Assado,
  produção P-0001, venda V-000006 (Data por item), funcionário "Carlos Teste E2E".
- Push dos commits em `main`: Owner.

## 7. Pendências de repositório a lembrar

- Branch `feat/nfe-emissao` usa **ADR-037** (NFC-e) e **ADR-038** (Empresa acima da loja); na `main` a ADR-037 já
  é o "Recebido líquido". No merge: **renumerar a de NFC-e**; 038 está reservada no índice.
