# Plano — Implantação multirramo (1ª loja de alimentos) + usuário multi-loja

> **Estado em 2026-09-30: ADRs 014/039/040/041 ACEITAS pelo Owner (decisões no §4). Entregas #1 (kg/L), #2
> (migration `0041`) e #3 (ramo no painel + módulos) NO AR — API `351e86ac`, web `dbc6a24a`. E2E do Owner
> pendente. ⬅️ Retomar pela #4 (gating na web).**
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
| 4 | Gating na web (esconder construção) | Não | 039 F2 |
| 5 | `trackStock` na venda/devolução/alertas | (usa a #2) | 040 F2 |
| 6 | **Cadastro em sequência** | Não | 041 §A |
| 7 | **Cadastro no caixa** + alerta de revisão | Não (a confirmar) | 041 §B |
| 8 | Etiqueta de balança (`scaleCode` + parser + PDV) | (usa a #2) | 040 F3 |
| 9 | Importador de planilha (modelo + De-Para) | Não | 041 §1–§6 |
| 10 | Usuário multi-loja (5 fatias da ADR-014) | **Sim** (3 migrations) | 014 |
| — | NFC-e + download automático de NF-e | — | **aguarda o Owner** |

Racional: #1–#8 são o que a loja nova precisa para abrir; a planilha fica para os poucos itens sem código e
para clientes futuros; o multi-loja é grande e não bloqueia a abertura (se o Owner precisar dele antes, sobe).

## 6. Pendências de repositório a lembrar

- Branch `feat/nfe-emissao` usa **ADR-037** (NFC-e) e **ADR-038** (Empresa acima da loja); na `main` a ADR-037 já
  é o "Recebido líquido". No merge: **renumerar a de NFC-e**; 038 está reservada no índice.
