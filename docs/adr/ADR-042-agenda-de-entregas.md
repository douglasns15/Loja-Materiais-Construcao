# ADR-042 — Agenda de entregas: retirada × entrega, faixa de horário e linha do tempo do dia

- **Status:** **Proposta** (2026-10-01) — aguardando decisão do Owner (perguntas no fim) e aprovação da
  migration (regra 1).
- **Data:** 2026-10-01
- **Deciders:** Owner do produto.
- **Mockups:** Artifact "Agenda de Entregas NexoLoja" (https://claude.ai/artifact/QWj7tYctZs13QNcuYEd2xv).
- **Contexto de fase:** implantação da loja de alimentos (rotisseria/encomendas), mas vale para qualquer ramo —
  construção também entrega material. Evolui o [ADR-020](./ADR-020-retirada-entrega-futura.md) (retirada/entrega
  futura) e o [ADR-028](./ADR-028-conta-de-retiradas-do-cliente.md) (conta de retiradas).

---

## Contexto

Pedido do Owner (2026-10-01): cliente que **agenda para retirar depois** e pedido que **a própria loja entrega**.
Hoje:

- A venda `SCHEDULED` (ADR-020) reserva o estoque e a baixa acontece na retirada. Mas **não distingue retirada de
  entrega**, a tela só pede **o dia** (`Order.scheduledPickupAt` é `DateTime`, já comporta hora) e **não há
  endereço no pedido**.
- `Customer.address` (VarChar 300) **já existe**, mas só aparece ao editar o perfil — não no cadastro rápido do
  PDV nem no cadastro da tela Clientes.
- A tela Entregas lista por conta de cliente (ADR-028); não mostra **a fila do dia por horário** nem a urgência.

## Decisão proposta

1. **Cadastro mínimo do cliente:** nome, telefone e **endereço** no cadastro rápido do PDV e na tela Clientes.
   Sem migration.
2. **Etapa de agendamento no PDV:** venda com "Retirada/Entrega posterior" → após "Concluir", a confirmação pede
   **Retirada × Entrega**, **dia**, **faixa de horário** (chips; padrão 30 min), **endereço** (na entrega; vem do
   cliente, editável só para o pedido, com opção de salvar no cadastro), **taxa de entrega** (reusa
   `freightAmount`) e **observações** (reusa `Order.notes`). Sem cliente, exige ao menos nome + telefone.
3. **Agenda do dia (tela Entregas):** linha do tempo horizontal (régua de horas, uma linha por pedido, grupos
   Entregas / Retiradas, linha do "agora"), lista lateral "Próximas" com contagem regressiva e ação no cartão
   ("Retirado", "Saiu p/ entrega"), chips com contagem (Todas · Atrasadas · Próximas 1h · Entregas · Retiradas) e
   navegação por dia. No celular vira lista por horário com as mesmas cores. Contas de retirada e busca por código
   ficam numa aba própria (sem mudança).
4. **Cor por urgência** — função pura no core (`deliveryUrgency(início, fim, agora, status)`, com testes):
   **Atrasado** (passou do fim da faixa e não concluído) · **Agora** (começa em ≤ 15 min ou já começou) ·
   **Em breve** (≤ 60 min) · **Agendado** · **Concluído**.

Referências de mercado (padrões gerais): iFood Gestor de Pedidos (status por etapa, tempo correndo, selo de
atraso, agendados à parte), Anota AI/Goomer (aba de agendados), Toast/Square ("pronto às", aviso antecipado),
Shopify entrega local (entregas do dia com endereço/paradas), Google Agenda (blocos na régua com linha do agora).
Linha do tempo em vez de só colunas por etapa: aqui o pedido é marcado com horas/dias de antecedência, então a
pergunta do balcão é "o que vem agora?" — tempo, não etapa.

## Impacto no banco (a aprovar — regra 1)

Migration **aditiva**, todos os campos opcionais, sem perda de dado:

| Campo | Tipo | Para quê |
|---|---|---|
| `Order.fulfillmentType` | enum `FulfillmentType { PICKUP, DELIVERY }`, nullable | Retirada × entrega (nulo em venda `IMMEDIATE`; vendas `SCHEDULED` antigas tratadas como `PICKUP`) |
| `Order.scheduledUntil` | `DateTime?` | Fim da faixa de horário (o início segue em `scheduledPickupAt`) |
| `Order.deliveryAddress` | `VarChar(300)?` | Snapshot do endereço no momento da venda |
| `Order.dispatchedAt` | `DateTime?` | "Saiu para entrega" (fatia 3, se o Owner quiser) |

Contrato: `POST /orders` aceita os campos novos; `GET /deliveries` ganha uma visão por dia (`?day=AAAA-MM-DD`,
ordenada por horário) e devolve tipo/faixa/endereço; `POST /deliveries/:id/dispatch` (fatia 3). Atualizar
`DOCUMENTACAO-TECNICA.md` §8.2 na mesma mudança (regra 7).

## Fatias (ordem aprovada pelo Owner)

1. Migration `0042` + endereço no cadastro (rápido + Clientes) + **cadastro de Funcionários** + etapa de
   agendamento no PDV (retirada × entrega, faixa, endereço, taxa, observações, entregador opcional).
2. Agenda do dia (linha do tempo, chips, "Próximas", cores) + versão celular + **painel "Período de entregas"**.
3. "Saiu para entrega" + limite de pedidos por faixa no PDV.

## Perguntas ao Owner — RESPONDIDAS (2026-10-01)

1. **Faixa de horário, padrão 30 min.**
2. **"Saiu para entrega": sim** (entra na fatia 3, pela ordem sugerida).
3. **Período de entregas configurável na própria tela de Entregas** (dias/horários de atendimento, tamanho da
   faixa, limite de pedidos por faixa).
4. **Ordem das fatias como sugerida.**
5. **Novo pedido do Owner: cadastro de FUNCIONÁRIOS** (para cadastrar os entregadores) e campo **opcional
   "Entregador"** em cada entrega.

## Desenho revisado após as respostas

- **Funcionários** — entidade nova `Employee` (o entregador normalmente **não tem login**; por isso não é `User`,
  que exige identidade no Supabase Auth — ADR-005). Campos: nome, telefone, **função** (`EmployeeRole`:
  `COURIER` entregador · `OTHER` outro — enum extensível), ativo, soft-delete e autoria (ADR-010). Tela
  "Funcionários" em Cadastros (admin). O pedido ganha `courierId` opcional (FK, `SetNull` ao excluir).
- **Período de entregas** — `Tenant.deliverySettings Json?` validado por Zod no shared:
  `{ slotMinutes: 30, maxPerSlot: number | null, hours: { [diaDaSemana]: [{ start: "08:00", end: "18:00" }] } }`.
  JSON pequeno por loja (uma linha), sem tabela nova; editado num painel da tela Entregas. O PDV sugere só faixas
  dentro do horário e marca as cheias (`maxPerSlot`). Função pura no core gera as faixas (`deliverySlots`) e a
  lotação, com testes.
- **Tabela antiga `deliveries` (ADR-002)** — rascunho da Fase 1, **sem uso no código**. Não é reaproveitada (exigiria
  cliente e endereço obrigatórios, o que não serve para retirada sem cliente, e espalharia o agendamento entre duas
  tabelas). Fica como está; remoção, se desejada, em migration separada com aprovação própria.

## Migration `0042` proposta (a aprovar — regra 1)

Aditiva, sem perda de dado:

1. `CREATE TYPE "FulfillmentType" AS ENUM ('PICKUP','DELIVERY')` e `CREATE TYPE "EmployeeRole" AS ENUM ('COURIER','OTHER')`.
2. `orders` + `fulfillmentType "FulfillmentType"` · `scheduledUntil TIMESTAMP` · `deliveryAddress VARCHAR(300)` ·
   `dispatchedAt TIMESTAMP` · `courierId UUID` (FK `employees.id` ON DELETE SET NULL) + índice
   `(tenantId, scheduledPickupAt)` para a agenda do dia.
3. **Backfill:** `UPDATE orders SET "fulfillmentType" = 'PICKUP' WHERE "deliveryMode" = 'SCHEDULED'` (todo
   agendamento antigo era retirada).
4. `CREATE TABLE employees` (id, tenantId FK cascade, name VARCHAR(120), phone VARCHAR(20), role, isActive,
   deletedAt, autoria, createdAt/updatedAt) + índice `(tenantId, isActive)` + RLS por `tenant_id` no padrão das
   demais tabelas.
5. `tenants` + `deliverySettings JSONB` (nulo = padrão: faixa 30 min, sem limite, sem restrição de horário).

Contrato novo (regra 7, §8.2): `POST /orders` aceita `fulfillmentType`/`scheduledUntil`/`deliveryAddress`/
`courierId`; CRUD `/employees`; `GET /deliveries?day=`; `PATCH /deliveries/:id` (entregador, faixa, endereço);
`POST /deliveries/:id/dispatch` (fatia 3); `GET`/`PUT` das configurações de entrega.
