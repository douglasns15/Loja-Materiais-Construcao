# ADR-028: Conta de retiradas do cliente (agrupamento com código E-0001)

**Status:** Aceito — **NO AR e E2E do Owner VALIDADO (2026-08-29, "tudo validado com sucesso")**. Migration `0034` aplicada + backfill validado no banco. Deploy inicial API `dd930a23` + web `f75b3a0d`; refinos pós-validação (mesmo dia) API `1fa958bc` + web `f004cadd`: **(a) comprovante ÚNICO da conta** (junta os itens de todas as retiradas num só cupom) e **(b) busca** na tela de Entregas (por código `E-000X`/`V-000XXX` ou nome do cliente) — ver Consequências. Escolha do Owner (2026-08-29): agrupar as retiradas por cliente com **entidade** e código próprio (`E-0001`), espelhando a dívida (ADR-026).
**Data:** 2026-08-29
**Deciders:** Owner do produto
**Relacionados:** [ADR-020](ADR-020-retirada-entrega-futura.md) (retirada/entrega futura — o eixo da entrega), [ADR-026](ADR-026-divida-do-cliente-como-entidade.md) (a dívida `D-0001`, que este ADR espelha), [ADR-023](ADR-023-numeracao-sequencial-de-vendas.md) (contador sequencial por loja), [ADR-001](ADR-001-consistencia-de-estoque.md) (estoque)

## Contexto

A ADR-020 modela a retirada/entrega futura: uma venda `SCHEDULED` reserva a mercadoria e ela sai depois, parcial, na tela de Entregas. Cada venda de retirada era uma **linha isolada** na tela.

Achado do Owner (2026-08-29): quando um cliente deixa material pago para retirar depois e **volta e leva mais** (nova venda de retirada), a tela criava **um card novo** — o mesmo cliente aparecia duplicado, sem uma visão do que ele tem para retirar no total. O Owner pediu para **agrupar por cliente em forma de extrato**, "mais ou menos como o Contas a Receber".

Há uma diferença importante em relação ao fiado: **dinheiro é fungível** (dá para somar num saldo único e quitar); **mercadoria reservada não é** — cada venda tem seus itens, previsão e comprovante (`V-000XXX`). Então o agrupamento é uma camada de **visão/identidade**, não de baixa: a baixa continua por venda/item (ADR-020/ADR-001).

Decisão do Owner entre "só agrupar na tela" e "criar entidade com código": **criar a entidade** com código `E-0001`, para o agrupamento ter identidade estável (um código derivado na tela seria instável quando uma venda do grupo fechasse). Isso reconsidera — conscientemente — a decisão registrada em `UI.Entregas.CodigoVenda` (reusar `V-000XXX`, não criar `E-000X`): aquela valia quando "a entrega ERA a venda"; agora o card agrupa **várias** vendas.

## Decisão

### 1. A conta de retiradas vira **entidade** com código `E-0001`

Nasce **`DeliveryAccount`** (tabela `delivery_accounts`), com código sequencial por loja **`E-0001`** (4 dígitos, mesma largura do `D-0001`; padrão do `lastOrderNumber`/`lastDebtNumber` — ADR-023). Uma conta agrega **1+ vendas `SCHEDULED`** do mesmo cliente e é a **unidade EXIBIDA** na tela de Entregas.

### 2. **Uma conta ABERTA por cliente** (espelha a dívida)

- Toda venda `SCHEDULED` **com cliente** entra na conta **aberta** dele; se não houver, **abre `E-000X`** (aloca o próximo número atômico em `Tenant.lastDeliveryNumber`, dentro da transação da venda — a invariante "1 aberta por cliente" é garantida sem constraint pelo lock da linha do tenant já tomado para numerar a venda, mesma prova da dívida).
- A conta é **OPEN** enquanto houver mercadoria a retirar em alguma de suas vendas. Quando **todas** as vendas ficam `COMPLETED`, a conta vira **COMPLETED** + `closedAt` e arquiva na aba **Finalizadas**.
- A **próxima** venda de retirada do mesmo cliente abre a conta **seguinte** (`E-000X+1`) — cada `E-000X` é um "capítulo" fechado das retiradas daquele cliente.

### 3. Vendas `SCHEDULED` **sem cliente** ficam **avulsas**

Diferente do fiado (que sempre exige cliente), a retirada futura pode ser de balcão anônimo ("pego depois", sem cadastrar cliente). Essas vendas ficam com `deliveryAccountId = null` e aparecem como **card avulso** (uma venda), como antes. Não se muda a regra de exigir/não exigir cliente no PDV.

### 4. A baixa continua **por venda/item** (não muda a ADR-020)

A conta é agrupamento/visão. Dar baixa (`POST /deliveries/:id/deliver`), o comprovante de retirada e o log continuam **por venda** (`V-000XXX`). Ao finalizar a última venda da conta, o `deliver` **fecha a conta** (helper `closeDeliveryAccountIfFulfilled`, espelho do `closeDebtIfSettled`).

### 5. Tela de Entregas: **card por conta** com extrato

A tela passa a listar **cards**: cada conta (`E-0001` + cliente + agregado: nº de vendas, total, itens a retirar, previsão mais próxima) com o **extrato** das vendas (cada `V-000XXX`, clicável — abre o detalhe/baixa e o resumo da venda). Vendas avulsas seguem como card único. Abas **A retirar / Finalizadas / Todas** (contas OPEN / COMPLETED / ambas + avulsas por `fulfillmentStatus`).

## Consequências

- **Migration `0034`** (aditiva): enum `DeliveryAccountStatus`, tabela `delivery_accounts` (com RLS `SELECT` por tenant), `Tenant.lastDeliveryNumber`, `Order.deliveryAccountId` (FK `ON DELETE SET NULL`). **Backfill** por `(tenant, customer)`: vendas SCHEDULED CONFIRMED não-finalizadas → uma conta `OPEN` por cliente; cada finalizada → sua própria conta `COMPLETED`; sem cliente → sem conta. Reversível (dropar a tabela, a coluna e o contador devolve o estado anterior). Aplicar com `npm run db:deploy` (não `migrate dev` — shadow DB no schema `auth`).
- **Sem novo cálculo em core** (agregados são somas triviais no servidor); o código `E-0001` ganha `formatDeliveryNumber`/`parseDeliveryNumberQuery` puros em `shared`, com testes (Regra 2).
- **Contrato de `GET /deliveries` muda** (de `{ rows }` para `{ cards }`) — doc §8.2 atualizada; a tela de Entregas foi reescrita para consumir os cards.
- **Limite honesto:** a conta é visão, não unidade de baixa/pagamento — não há "quitar a conta"; o pagamento da mercadoria segue no fluxo da venda (à vista / a prazo via ADR-019).
- **Comprovante ÚNICO da conta (refino 2026-08-29, só web):** no card com 2+ vendas, um botão "Comprovante da conta (todas as retiradas)" junta os itens de TODAS as vendas da conta num só cupom. Reusa o `ReceiptPrint` (novo prop `codeLabel` imprime o `E-000X` no lugar do `V-000XXX`), buscando o detalhe de cada venda (`GET /deliveries/:id`) e concatenando itens + progresso por item (`pickupLines`); desconto agregado = subtotal dos itens − total da conta. Sem API/migration/shared. Contas de 1 venda seguem usando o comprovante da própria venda (no detalhe).
- **Busca na tela de Entregas (refino 2026-08-29):** campo com segmentado Código/Cliente. `GET /deliveries?code=` casa a conta pelo `accountNumber` (`E-000X`) OU uma venda dela pelo `orderNumber` (`V-000XXX`) — e as avulsas pelo `orderNumber`; `?customer=` filtra a conta pelo nome do cliente (avulsas, sem cliente, ficam de fora). Qualquer busca varre TODAS as situações (ignora a aba), como no Histórico. Sem migration.
