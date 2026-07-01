# ADR-009 — Multi-loja, onboarding e Super Usuário (plataforma)

- **Status:** Proposto
- **Data:** 2026-07-01
- **Contexto de fase:** Fase nova dedicada — "Plataforma / Administração" (após a Fase 2)

> ⚠️ **Implica alteração de schema (migration) e mexe no modelo de segurança (RLS).**
> Pela regra 1 do `CLAUDE.md`, nada é aplicado ao banco antes de aprovação explícita.
> Este ADR fixa a direção; cada mudança de banco/segurança é um passo posterior e revisado.

## Contexto

O sistema **é multi-tenant por arquitetura** (ADR-003/005): várias lojas (`Tenant`)
coexistem isoladas por RLS. Mas faltam duas capacidades de **plataforma**, que **cruzam o
limite do tenant** e por isso não pertencem ao MVP de uma loja:

1. **Onboarding de loja** — hoje uma loja nova só nasce por **script de bootstrap
   (invite-only)**. Não há tela/fluxo para criar uma loja e seu primeiro Admin.
2. **Super Usuário (fabricante)** — a equipe do NexoLoja precisa de um papel **acima de
   qualquer loja**, capaz de enxergar/administrar **todas** as lojas (suporte, provisão,
   diagnóstico). Isso é fundamentalmente diferente do papel `Admin` **dentro** de uma loja
   (ver [ADR-008](./ADR-008-papeis-e-rbac.md)): exige acesso **cross-tenant controlado**.

Misturar isso na Fase 2 emperraria o fechamento do MVP e aumentaria o risco de brecha de
isolamento — a razão de ser um ADR e uma fase separados.

## Decisão

### 1. Super Usuário vive FORA do `UserRole` por-tenant

O `UserRole` (ADR-008) descreve o papel **dentro de uma loja** e não deve ganhar um valor
"super admin" — um super usuário não "pertence" a uma loja. Opções consideradas:

- **A) Flag/tabela de plataforma** — uma tabela `PlatformAdmin` (ou claim `is_platform_admin`
  no JWT) que marca contas da equipe do fabricante, independente de `tenant_id`. **Preferida.**
- **B) Tenant "sistema" especial** — modelar o fabricante como um tenant privilegiado.
  Rejeitada: sobrecarrega o conceito de `Tenant` e confunde o RLS.

**Adotar a opção A**: identidade de plataforma explícita e separada do vínculo com loja.

### 2. Acesso cross-tenant controlado (não enfraquecer o RLS)

O RLS por `tenant_id` (ADR-005) **permanece a fronteira**. O acesso do Super Usuário a
várias lojas é feito de forma **explícita e auditável**, não relaxando as políticas gerais:

- Preferir **rotas de plataforma dedicadas** na API (Worker, papel dono do banco) que
  recebem o `tenantId` alvo por parâmetro e **exigem** claim de plataforma — em vez de criar
  policies RLS que abram dados de todos os tenants ao papel `authenticated`.
- Toda ação de plataforma que toque dados de uma loja gera **auditoria** (quem, qual loja,
  o quê). Reavaliar a lista fechada do ADR-004 para incluir eventos de plataforma.

### 3. Onboarding de loja (provisão do primeiro Admin)

- Fluxo para **criar loja** (`Tenant`) + **primeiro usuário Admin** (ADR-008), substituindo
  o script de bootstrap por uma operação de produto. A criar depois de decidido o gatilho:
  **self-service** (signup público) **vs.** **provisionado pelo Super Usuário** (a equipe
  cria a loja e convida o Admin). **Recomendação inicial:** provisionado pelo Super Usuário
  (menos superfície de abuso; combina com o público de PMEs atendido diretamente).
- **Unicidade de `Tenant.cnpj`** (já `@unique` no schema) passa a ter uso real: bloqueia
  criar uma segunda loja com o mesmo CNPJ (a API já retorna **409** nesse caso — hoje o
  caminho não é alcançável por não haver criação de loja pela UI).

### 4. Painel de gestão de lojas

- Área exclusiva de Super Usuário para **listar lojas**, ver estado (ativa/inativa,
  `Tenant.isActive`), e entrar no contexto de uma loja para suporte. **Nunca** exposta a
  Admin/Usuário de loja.

## Consequências

- **Positivas:** habilita o modelo de negócio multi-loja sem enfraquecer o isolamento;
  separa claramente "papel de loja" (ADR-008) de "papel de plataforma"; onboarding deixa de
  depender de script manual.
- **Negativas / riscos:** acesso cross-tenant é a maior superfície de risco do sistema —
  exige rotas dedicadas, checagem estrita do claim de plataforma e auditoria; signup
  self-service (se escolhido) abre vetor de abuso e precisaria de verificação.
- **Dependências:** assenta sobre o RBAC do ADR-008 (papéis de loja) já existente.

## Decisões em aberto (a resolver antes de implementar)

- Onboarding **self-service** vs. **provisionado** (recomendação: provisionado).
- Forma da identidade de plataforma: tabela `PlatformAdmin` vs. claim no JWT (ou ambos).
- Estratégia de acesso cross-tenant: rotas de plataforma dedicadas (preferido) vs. policies
  RLS específicas para o claim de plataforma.

## Relacionadas

- **ADR-003 / ADR-005** — Multi-tenancy e RLS (a fronteira que este ADR respeita).
- **ADR-004** — Auditoria seletiva (estender para eventos de plataforma).
- **ADR-008** — Papéis e RBAC dentro da loja (o nível abaixo deste).
- **CLAUDE.md** — Regra 1 (aprovar migrations) e multi-tenancy estrito no banco.
