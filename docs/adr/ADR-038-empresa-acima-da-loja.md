# ADR-038 — Empresa (grupo) acima da Loja: o que `Tenant` modela e quando separar

- **Status:** Aceito — **decisão de ADIAR a separação**, com as invariantes definidas desde já. O
  desenho-alvo da seção 4 é um esboço para quando o gatilho ocorrer, **não** um compromisso de
  implementação. Nenhuma mudança de schema decorre deste ADR.
- **Data:** 2026-08-25
- **Deciders:** Alexandre Papassoni (Owner do produto)
- **Contexto de fase:** levantado durante o desenho da emissão fiscal ([ADR-037](ADR-037-emissao-fiscal-nfce.md)),
  que foi o que expôs a tensão.

## Contexto

O modelo `Tenant` nasceu no terceiro commit do repositório (`1add355 Create schema.prisma`) como
"a loja" — a raiz do multi-tenancy. Hoje há **88 ocorrências de `tenantId`** no schema: praticamente
toda tabela de dados pendura nele.

Na prática, `Tenant` acumula **quatro papéis** ao mesmo tempo:

| Papel | Como aparece |
|---|---|
| **Fronteira de isolamento** (o principal) | É o que a RLS usa: `tenant_id = auth.jwt() ->> 'tenant_id'` ([ADR-005](ADR-005-stack-e-arquitetura.md)) |
| **Unidade operacional** | Estoque, caixa, catálogo, clientes, fornecedores e preços são todos por loja |
| **Identidade comercial/jurídica** | `name`, `slug`, `cnpj`, `logoUrl`, taxa da maquininha, sequências `lastOrderNumber`/`lastQuoteNumber` |
| **Unidade de contrato** | `isActive` + `SET_TENANT_ACTIVE` ([ADR-009](ADR-009-multi-loja-e-super-admin.md)) é o mecanismo de suspender quem não paga |

> A única exceção deliberada ao `tenantId` é o `ProductCatalog` do [ADR-025](ADR-025-catalogo-global-ean.md)
> — cross-tenant de propósito, porque ficha técnica de produto é dado público.

### A tensão

`Tenant` colapsa três conceitos que normalmente se separam: **estabelecimento** (loja física),
**empresa** (pessoa jurídica) e **assinante** (quem paga). Isso funcionou perfeitamente enquanto cada
cliente é uma loja só. Três forças começam a puxar em direções diferentes:

1. **Fiscal ([ADR-037](ADR-037-emissao-fiscal-nfce.md)).** A emissão é por **estabelecimento**: cada
   um tem CNPJ próprio, inscrição estadual própria, CSC próprio e numeração própria. Matriz e filial
   são CNPJs distintos — inclusive na API do provedor, que trata "matriz e filiais" como empresas
   separadas com o mesmo CNPJ base.
2. **Cobrança (Horizonte 0, bloco D do [`PRODUCT-ROADMAP.md`](../PRODUCT-ROADMAP.md)).** Quem paga é
   o *cliente*, que pode ter várias lojas. Faturar por tenant significa faturar por loja — pode até
   ser a política desejada, mas deveria ser uma **decisão consciente**, não um acidente do modelo.
3. **Usuário multi-loja ([ADR-014](ADR-014-usuario-multi-loja.md), ainda Proposto).** Ele existe
   justamente porque `User` pertence a exatamente um tenant. É o primeiro sintoma da tensão.

## Decisão

**Manter o colapso por enquanto** e **fixar desde já as invariantes** que valerão quando a separação
acontecer. O valor deste ADR não é mudar código — é impedir que a separação futura seja feita da
forma errada.

### Invariante 1 — a fronteira de RLS continua sendo a LOJA (a mais importante)

Quando `Company` existir, ela é uma camada **acima**, para agrupamento comercial. O `tenant_id` das
policies **não migra** para a empresa.

O motivo é operacional, não estético: o isolamento que importa é o do **estabelecimento físico** —
estoque, caixa e numeração fiscal são dele. Mover a fronteira para a empresa faria duas lojas do
mesmo dono enxergarem o caixa e o estoque uma da outra, o que está errado mesmo quando o dono é o
mesmo. E como o isolamento é a maior força de segurança do projeto ([ADR-005](ADR-005-stack-e-arquitetura.md)),
afrouxá-lo por conveniência de agrupamento seria o pior negócio possível.

### Invariante 2 — a emissão fiscal é sempre por estabelecimento

Mesmo com `Company` acima, cada loja mantém CNPJ, inscrição estadual, CSC, série e numeração
próprios. Não existe "nota da empresa" — existe nota **do estabelecimento**.

### Invariante 3 — consolidação é assunto de leitura, não de escrita

Relatórios consolidados, cobrança única e visão de grupo são **agregações** feitas por cima de lojas
isoladas. Nunca justificam relaxar a policy de RLS: se for preciso ler várias lojas, o caminho é o
mesmo do Super Usuário ([ADR-009](ADR-009-multi-loja-e-super-admin.md)) — rota dedicada com a API
como dona do banco, isolando por código, sem tocar nas policies.

## Opções Consideradas

### Opção A: Adiar a separação, fixando invariantes — **escolhida**

| Dimensão | Avaliação |
|---|---|
| Complexidade agora | Nenhuma |
| Risco de decisão errada no futuro | Baixo — as invariantes ficam registradas |
| Custo se o gatilho chegar | Migration aditiva (ver §4) |

**Prós:** não paga por complexidade que ninguém usa; mantém a fronteira de RLS inequívoca; a
migração futura é aditiva e sem perda de dado.
**Contras:** um cliente com duas lojas hoje precisa de dois tenants, com catálogo e clientes
duplicados entre eles.

### Opção B: Criar `Company` agora

**Prós:** pronto quando precisar; evita retrabalho.
**Contras:** introduz uma entidade sem nenhum caso de uso real, com uma coluna nula em todo lugar;
torna a fronteira de isolamento **ambígua** para quem lê o schema ("isolo por empresa ou por loja?"),
que é exatamente o tipo de dúvida que produz vazamento entre tenants. Rejeitada.

### Opção C: Assumir que nunca haverá empresa com várias lojas

**Prós:** simplicidade permanente.
**Contras:** irrealista no ramo — material de construção tem redes pequenas e matriz/filial é comum.
Rejeitada.

## 4. Desenho-alvo (esboço para quando o gatilho chegar)

Registrado para orientar, **não** para comprometer:

```prisma
model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(120)
  /// CNPJ base (8 primeiros dígitos) — matriz e filiais compartilham
  cnpjBase  String?  @db.VarChar(8)
  isActive  Boolean  @default(true)
  tenants   Tenant[]
}

model Tenant {
  // ...
  /// Nullable: loja sem grupo continua válida (é o caso de hoje).
  companyId String? @db.Uuid
  company   Company? @relation(fields: [companyId], references: [id])
}
```

**A migração é aditiva:** nova tabela + coluna nullable. Nenhum dado existente muda, nenhuma policy
de RLS é tocada, e lojas sem grupo seguem funcionando como hoje.

### O que seria compartilhado vs. por loja

Esta é a parte que exige decisão de **produto**, não de arquitetura:

| Domínio | Provável | Observação |
|---|---|---|
| Estoque, caixa, numeração fiscal | **Sempre por loja** | Invariantes 1 e 2 |
| Catálogo e preços | Compartilhável | É a principal dor de quem tem duas lojas |
| Clientes e fiado | A decidir | Cliente é do grupo ou da loja? Muda a cobrança da dívida |
| Usuários | Por loja, com acesso a várias | Depende do [ADR-014](ADR-014-usuario-multi-loja.md) |
| Assinatura e fatura | Provável na empresa | Consolidação comercial |

## Gatilhos para revisar este ADR

Qualquer um destes reabre a decisão:

1. **O primeiro cliente com duas lojas do mesmo dono** pedindo catálogo ou preços compartilhados.
2. Necessidade de **cobrança consolidada** (uma fatura para várias lojas).
3. Implementação do [ADR-014](ADR-014-usuario-multi-loja.md) — se o usuário multi-loja for entregue
   antes, ele já toca essa fronteira e deve respeitar as invariantes acima.

## Consequências

- **Fica mais fácil:** manter o schema e a RLS simples; a separação futura já tem regra escrita.
- **Fica mais difícil:** atender hoje um cliente com duas lojas sem duplicar catálogo e clientes.
- **Revisar no futuro:** quando qualquer gatilho ocorrer — e, ao fazê-lo, **começar pelas
  invariantes**, não pelo modelo de dados.

## Action Items

1. [ ] Nenhuma mudança de código ou schema decorre deste ADR — é deliberadamente inerte.
2. [ ] Ao implementar o [ADR-014](ADR-014-usuario-multi-loja.md), conferir a Invariante 1.
3. [ ] Ao definir os planos de cobrança (Horizonte 0, bloco D), decidir explicitamente se a fatura é
       por loja ou por empresa — e registrar a escolha.
