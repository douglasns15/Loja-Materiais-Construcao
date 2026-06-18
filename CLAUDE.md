# Diretrizes do Projeto: NexoLoja (ERP/POS Multiramos)

## Visão Geral do Sistema
- **Objetivo:** Sistema de gestão comercial completo, ultra-simples quando a usabilidade e profissional, desgin moderno, para pequenas e médias empresas.
- **Arquitetura Inicial:** Arquitetura modular/SaaS. O core deve ser genérico, com módulos específicos ativáveis (ex: módulo "Material de Construção" ativa controle de milheiros, metragens, frete/entrega pesada).
- **Plataformas:** Web (Desktop) e Mobile (iOS/Android) compartilhando a mesma lógica de negócios (API unificada).

## Stack Tecnológica e Infraestrutura (Foco: Custo-Zero & Offline-First)
- **Banco de Dados Central:** Supabase (PostgreSQL) - Plano Gratuito.
- **Armazenamento de Mídia:** Cloudflare R2 (10GB gratuitos para fotos de produtos, evitando inflar o banco de dados).
- **Backend / APIs:** Cloudflare Workers (TypeScript) - Execução via Edge Computing (ultra-rápido, escalável e gratuito).
- **Frontend & Mobile (Abordagem Única PWA):** Next.js (TypeScript) hospedado na Cloudflare Pages.
  - *Nota:* O sistema deve ser 100% responsivo, com design adaptável e focado em computadores, tablets e celulares.
  - *Nota:* Deve ser configurado estritamente como PWA (Progressive Web App) para permitir instalação direta pelo navegador (PC, Tablet e Celular) e funcionamento Offline-First via **IndexedDB** para o caixa, eliminando a necessidade de publicação em lojas nativas (App Store/Google Play) nesta fase inicial.

## Padrões de Código e Arquitetura
- **Estilo:** TypeScript estrito. Prefira funções puras e componentização atômica.
- **Tratamento de Erros:** Sempre use blocos try/catch no backend retornando mensagens amigáveis para o cliente e logs detalhados no servidor.
- **Interface (UI/UX):** Foco absoluto em usabilidade. Menos cliques, fontes legíveis, suporte a leitores de código de barras e comandos rápidos de teclado no desktop.
- **Segurança:** Multi-tenancy estrito (uma loja nunca pode ver os dados de outra). Senhas hasheadas com bcrypt, autenticação via JWT/HttpOnly Cookies.

## Comandos Úteis do Projeto
- Instalar dependências: `npm install`
- Rodar ambiente de desenvolvimento: `npm run dev`
- Executar testes unitários: `npm run test`
- Rodar migrações do banco: `npx prisma migrate dev`

## Regras de Interação com o Claude
1. ANTES de escrever qualquer código que altere o banco de dados, explique o impacto e peça aprovação.
2. Sempre escreva testes unitários para funções de cálculo de fechamento de caixa, estoque e fluxo de caixa.
3. Não remova comentários explicativos existentes no código.

## Diretrizes de Otimização de Banco de Dados (Foco em Cost-Zero)
- **Imagens:** Proibido salvar arquivos binários (BLOB/Base64) no banco. Salve apenas a URL gerada por serviços de storage.
- **Tipos de Dados:** Use os tipos mais leves possíveis (ex: `SmallInt` para status e enums numéricos, `VarChar` com limite estrito em vez de `Text` genérico).
- **Logs e Auditoria:** Não salvar logs de cliques ou histórico de navegação no PostgreSQL principal. Usar serviços de log externos ou armazenamento local.

