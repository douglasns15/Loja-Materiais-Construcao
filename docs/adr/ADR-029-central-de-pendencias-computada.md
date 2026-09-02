# ADR-029: Central de pendências computada (sino de alertas sem push nem tabela)

**Status:** **Proposto** (2026-09-02 — aguardando aprovação do Owner para iniciar). Detalhamento em [plano da Central de Alertas](../plano-central-de-alertas.md).
**Data:** 2026-09-02
**Deciders:** Owner do produto
**Relacionados:** [ADR-001](ADR-001-consistencia-de-estoque.md) (`stockQty` é cache; fonte = `StockMovement`), [ADR-026](ADR-026-divida-do-cliente-como-entidade.md) (dívida do cliente `D-0001`), [ADR-027](ADR-027-custo-congelado-na-venda.md) (custo carimbado — por que "sem custo" prejudica o lucro), ARCHITECTURE §7 (persistência custo-zero)

## Contexto

O app tem dados de cadastro que, quando ficam **inconsistentes ou incompletos**, degradam silenciosamente
o resto do sistema — o caso que originou esta decisão: produtos **sem custo cadastrado** derrubam o
"Lucro bruto estimado" dos Relatórios (só ~19% das vendas tinham custo num mês real), sem que ninguém
seja avisado de onde está o buraco. Hoje não existe nenhum lugar no app que **junte e mostre** essas
pendências; o dono só descobre por acaso, olhando um número estranho.

A demanda é um **sino de alertas** no topo (ao lado da cesta) que concentre esses avisos e ofereça a
ação de corrigir (ex.: baixar a lista de produtos sem custo).

O risco de projeto é resolver isso do jeito "rede social": um feed de **eventos empurrados e
armazenados** (tabela de notificações, um registro por evento, marcação de lido/não-lido). Isso
contraria frontalmente o **custo-zero** (ARCHITECTURE §7: *sem logs de navegação/eventos no Postgres*)
e adiciona escrita/armazenamento sem valor — o alerta não é um evento histórico, é um **estado atual**.

## Decisão

### 1. Alertas são **calculados sob demanda**, não eventos armazenados

Quando o usuário abre o sino, uma chamada única (`GET /alerts`) roda um punhado de agregações
(`COUNT(*) FILTER (WHERE …)`) sobre os dados **que já existem** e devolve a lista
`[{ kind, count, severity, actionHref }]`. O badge do sino é a soma das contagens relevantes.

- **Um alerta existe enquanto a inconsistência existir** e **desaparece sozinho** quando o dado é
  corrigido — sem job de limpeza, sem "marcar como resolvido" no banco.
- **Zero tabela nova, zero migração.** Todo o catálogo sai de colunas já presentes
  (`Product.costPrice/salePrice/ean/categoryId/stockQty/minStockQty`, `CashSession`, `Debt`).
- **Zero push/service worker novo.** Não há notificação fora do app; o sino é um _pull_ na abertura
  (e um refresh leve ao focar a janela). Sem infra de push (custo-zero, e evita permissão de browser).

### 2. Uma varredura barata, agregada no banco (guarda de CPU do Worker)

O endpoint de contagens agrega **no Postgres** com `$queryRaw` — os alertas de produto saem de **uma
única varredura** de `products` com vários `COUNT(*) FILTER`. Nunca `findMany` + laço em JS (já
estourou o teto de 10 ms de CPU do Worker free no catálogo; ver histórico do `GET /products`).
O **detalhe** de cada alerta (a lista para download) é uma rota **separada e paginada** — não vem
junto na abertura do sino.

### 3. CSV gerado no cliente (custo-zero)

O download da lista ("X produtos sem custo") segue o padrão já usado em Relatórios: a rota devolve as
**linhas** (JSON), e o **CSV é montado no navegador**. Sem lib de planilha, sem gerar arquivo no
servidor.

### 4. Nasce **visível para todos**; o role-scoping é aditivo e vem depois

Cada alerta carrega no seu metadado a lista de papéis a que ele **deveria** interessar
(`roles: UserRole[]`) — ex.: "sem custo" e "margem negativa" são assunto de `OWNER`/`MANAGER`;
"estoque negativo" interessa a `STOCK`. **Nesta primeira entrega esse metadado é informativo: o
endpoint devolve tudo para qualquer papel** (decisão do Owner — nascer útil para todos, sem travar).
Quando a **tela de permissões por usuário** existir (épico seguinte), o filtro passa a ser aplicado
sem retrabalho de modelagem — só liga a checagem que já está descrita no metadado.

### 5. "Silenciar" é preferência local, não estado de banco

Um "não me mostrar este alerta por 7 dias" vive no `localStorage` por usuário (como as prefs de menu
já fazem), não em tabela. Se a pendência ainda existir quando o prazo vencer, o alerta reaparece.
Mantém o custo-zero e evita a complexidade de "lido/dispensado" persistente.

### 6. Limiares e severidade são **função pura** em `core` (testados)

Os limites que definem um alerta acionável (ex.: caixa aberto há **> N horas**, dívida parada há
**> N dias**) e a classificação de **severidade** (`info`/`warn`/`danger`) ficam em `packages/core`
como funções puras com testes Vitest (regra 2). A API só passa os números crus agregados; o `core`
decide se vira alerta e com que gravidade. Assim a regra é reaproveitável e testável sem I/O.

## Alternativas consideradas

- **Feed de notificações persistido (tabela `Notification`, um registro por evento, lido/não-lido).**
  Rejeitada: contraria o custo-zero (§7), adiciona escrita por evento e um ciclo de vida
  ("resolver/limpar") que o modelo de **estado atual calculado** não precisa.
- **Push real (Web Push/service worker) para avisar fora do app.** Fora de escopo e custo-zero:
  exige infra de push e permissão do browser, sem demanda que justifique agora. O sino resolve a dor
  (ninguém vai atrás do dado) com um _pull_ barato.
- **Calcular tudo no cliente (buscar produtos e contar no JS).** Rejeitada: joga volume de dados e
  CPU para o dispositivo e a rede; a agregação no Postgres é mais barata e já é o padrão de Relatórios.

## Consequências

- ✅ Uma dor real (dado que existe mas ninguém corrige) ganha um lugar único e acionável, **sem
  nenhuma migração** e sem escrever nada no banco.
- ✅ Extensível: cada alerta novo é **mais uma linha** no agregado + um metadado — o esqueleto (sino,
  painel, download) é escrito uma vez.
- ✅ Pronto para o role-scoping: o metadado `roles` já nasce em cada alerta; a tela de permissões
  liga a checagem depois, sem remodelar.
- ⚠️ O número do sino reflete o **agora** (recalculado ao abrir/focar), não um histórico — é o
  comportamento desejado, mas significa que **não há trilha** de "quando surgiu/sumiu" um alerta
  (aceitável; se algum dia precisar auditar, entra via `AuditEvent` seletivo, não aqui).
- ⚠️ Cada alerta é uma varredura: manter tudo como `COUNT`/agregado enxuto e o detalhe paginado, para
  não estourar o CPU do Worker free (guarda explícita na Fatia 1).
