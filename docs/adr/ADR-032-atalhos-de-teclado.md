# ADR-032: Atalhos de teclado (navegação + ações), configuráveis e cross-platform

**Status:** **Aceito** — Fatias 1–4 implementadas, **NO AR e E2E do Owner VALIDADO** (2026-09-05, "validado com sucesso"; web Version `b938cc55`; commit `854bd5c`). Só `apps/web`; sem API/banco/migração/`core`/`shared`. Persistência em `localStorage` (custo-zero).
**Data:** 2026-09-05
**Deciders:** Owner do produto
**Relacionados:** [ADR-005](ADR-005-stack-e-arquitetura.md) (custo-zero / só `apps/web`), [ADR-031](ADR-031-janela-flutuante-de-tela.md) (subsistema de UI no shell, desktop-first, prefs em `localStorage`), [ARCHITECTURE §7](../ARCHITECTURE.md) (persistência custo-zero). CLAUDE.md: diretriz de UX "atalhos de teclado no desktop".

## Contexto

O Owner quer **atalhos de teclado** no sistema: teclas que, pressionadas dentro do app, executam algo
— abrir o PDV, ir ao Histórico, finalizar uma venda etc. — no estilo dos PDVs de mercado (Tiny/Bling),
onde `F2` etc. são memória muscular do balconista. Requisitos levantados na conversa:

1. Servir a **Windows, macOS e Linux** igualmente.
2. Cobrir **navegação entre telas** e **ações dentro do PDV** (finalizar, focar busca…).
3. Ter uma **tela de ajuda** (tabela dos atalhos) — descoberta sem decorar.
4. Ser **configurável**: uma seção em **Configurações → Acessibilidade** com os atalhos pré-definidos
   das telas principais, **editáveis** e com **adição** de novos.

Desafios reais que moldam a decisão:

- **Teclas F no Mac.** Existem, mas em boa parte dos MacBooks a fileira de cima é mídia por padrão →
  exige `fn` ou um ajuste do sistema. Logo, F-keys têm **atrito** no Mac que Windows/Linux não têm.
- **`event.key` é traiçoeiro cross-platform.** No Mac, `Option+V` insere `√`, `Option+C` insere `ç`
  (o SO troca o caractere); e o caractere muda com o **layout** (ABNT/US). Ler o caractere quebraria.
- **Modificadores conflitam com o navegador.** `Ctrl`/`Cmd`+letra colidem com atalhos do navegador
  (salvar, imprimir, nova aba…); `Alt+Shift` (só ele) **troca o layout de teclado no Windows** quando
  há 2+ idiomas instalados. Não dá para sobrepor esses sem surpresa.
- **Leitor de código de barras** "digita" rápido + Enter num campo — os atalhos **não** podem disparar
  enquanto se digita.

## Decisão

### 1. Motor lê o **código físico da tecla** (`event.code`) + modificadores — nunca o caractere

O binding é `event.code` (ex.: `KeyV`, `F2`, `Digit1`) mais os flags de modificador. Isso torna o
atalho **idêntico em Mac/Windows/Linux** e imune a layout de teclado e à troca de caractere do macOS
(`Option+V` → `√`). Um atalho é serializado como string normalizada (ex.: `"F2"`, `"N,KeyH"`),
que é o formato guardado no `localStorage` e exibido de forma amigável na ajuda ("N depois H").

### 2. Duas famílias de atalho, por natureza de uso

- **F-keys (tecla única) para as AÇÕES quentes** — memória muscular de PDV. Padrão inicial: `F2` abrir
  PDV · `F8` finalizar venda · `F9` focar a busca de produto. Evita as **reservadas** do navegador/SO
  (`F1` ajuda, `F5` recarregar, `F11` tela cheia, `F12` devtools; e `F3`/`F6`/`F10`, sensíveis em alguns
  navegadores). Nas que sobrescreve, chama `preventDefault()`. No Mac exigem `fn`/ajuste — aceitável e
  contornável (o usuário rebinda para um atalho de sequência, ver §3).
- **Sequência `N` + letra para NAVEGAR entre telas** — aperta **N**, solta, aperta a letra (padrão
  consagrado do GitHub/Gmail, que usam `g`; aqui **`N` de NexoLoja**). **Sem modificador** ⇒ **zero
  conflito** com navegador/SO nos três sistemas e sem `fn` no Mac. Um indicador discreto "N …" aparece
  quando o `N` arma a sequência; um **timeout curto** (~1,2 s) cancela se a letra não vier.

Padrão inicial de navegação (letras já **desempatadas** para os nomes em PT que colidem —
Caixa/Categorias/Clientes/Contas, Relatórios/Receber): `N V` Venda · `N H` Histórico · `N C` Caixa ·
`N R` Contas a Receber · `N E` Estoque · `N P` Produtos · `N O` Orçamentos · `N G` Entregas ·
`N L` Clientes · `N F` Fornecedores · `N T` Categorias · `N D` Relatórios (dashboards) · `N S`
Configurações. Como tudo é rebindável e aparece na ajuda, ninguém precisa decorar.

### 3. **Configurável**; padrões restauráveis; adição de novos — em Configurações → Acessibilidade

O mapa efetivo = **padrões do código** mesclados com as **sobrescritas do usuário** (`localStorage`).
A tela de Acessibilidade lista cada atalho, permite **editar** (capturando a nova combinação por
`event.code`), **restaurar o padrão** e **adicionar** um novo apontando para uma tela. Conflitos
(mesma combinação em duas ações) são detectados e sinalizados na hora da captura.

### 4. As telas registram suas **ações** no motor (navegação é embutida)

A navegação (`N`+letra, F2→PDV) o motor resolve sozinho via `useRouter`. As **ações contextuais**
(finalizar venda, focar busca) são registradas pela tela ativa (ex.: o PDV registra `finalizar`/
`focar-busca` num `ShortcutsProvider` do shell) e desregistradas ao sair — o motor só as executa quando
a tela dona está montada. Assim o `F8` "finalizar" não faz nada fora do PDV.

### 5. **Desktop-only**; sem disparar enquanto se digita

Sem teclado físico, atalhos não valem no PWA mobile — o motor só liga no desktop (as telas seguem
acessíveis por toque). O motor **ignora** eventos quando o foco está em `input`/`textarea`/`select`/
`[contenteditable]` (protege o leitor de código de barras e a digitação normal), **exceto** F-keys e
`Escape`, que são seguros. `?` (Shift+/) abre a ajuda.

### 6. Persistência **custo-zero** (`localStorage`), sem dependência nova (regra 4)

As sobrescritas ficam em `localStorage` por dispositivo — **sem migração, sem tocar no banco**
(alinhado ao ADR-005 / ARCHITECTURE §7). O motor é escrito à mão (sem lib — regra 4). Sincronizar os
atalhos **entre dispositivos** (via banco, por usuário) fica como evolução futura — aí exigiria
migração + aprovação (regra 1).

## Alternativas consideradas

- **`Ctrl`/`Cmd`+letra (estilo apps nativos).** Rejeitada: colide com atalhos do navegador (imprimir,
  salvar, nova aba) — sobrescrever gera surpresa e perda de função esperada.
- **`Alt`(+`Shift`)+letra.** Rejeitada como padrão: no Mac `Option` insere caractere (contornável por
  `event.code`, mas fora do idioma da tecla) e **`Alt+Shift` troca o layout no Windows** com 2+ idiomas.
- **F-keys puras também para navegar.** Preterida para navegação por causa do atrito no Mac (`fn`) e dos
  conflitos espalhados (F3/F5/F6/F10/F11/F12); mantidas só para as ações quentes, onde o ganho de
  tecla-única compensa. Continua possível via rebind.
- **Sincronizar atalhos no banco (por usuário) já na v1.** Preterida: exigiria migração; `localStorage`
  entrega o valor imediato custo-zero. Promovível depois.

## Consequências

- ✅ Atalhos que funcionam **igual** em Windows/Mac/Linux (motor por `event.code`), sem quebrar com
  layout de teclado nem com a troca de caractere do macOS.
- ✅ Navegação `N`+letra **sem conflito** com navegador/SO e **sem `fn`** no Mac; F-keys para as ações
  onde a memória muscular de PDV compensa.
- ✅ Configurável e descoberto pela ajuda (`?`) e pela tela de Acessibilidade — não precisa decorar.
- ✅ **Custo-zero**: só `apps/web` + `localStorage`; não toca API/banco/migração/`core`/`shared`.
- ⚠️ F-keys exigem `fn`/ajuste em muitos MacBooks — mitigado pelo rebind para sequência.
- ⚠️ Atalhos por dispositivo (não seguem o usuário entre aparelhos) na v1 — sincronização é evolução
  futura (migração + aprovação).
- ⚠️ Sequência exige um pequeno "modo armado" (o `N`), com indicador + timeout — leve curva vs. a
  tecla única, compensada por zero conflito cross-platform.

## Plano (fatias) — todas CONCLUÍDAS (2026-09-05)

1. ✅ **Motor + navegação** (`N`+letra) + ignorar-em-campos + indicador do "N …".
2. ✅ **Overlay de ajuda** (`?`, pelo caractere) com a tabela dos atalhos (padrões + sobrescritas + customizados).
3. ✅ **Ações do PDV** (F8 finalizar, F9 focar busca) via registro por tela (`ShortcutsProvider`).
4. ✅ **Configurações → Acessibilidade**: ver/editar/restaurar/adicionar/remover, com detecção de conflito.

**Backlog:** expor a edição ao operador (a tela é admin-only); sincronizar atalhos entre dispositivos (banco + migração).
