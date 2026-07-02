// Configuração do adaptador OpenNext para Cloudflare Workers (ADR-005).
// Cloudflare Pages foi descontinuado para Next.js; o caminho oficial é
// Workers + @opennextjs/cloudflare. Config padrão é suficiente para o MVP
// (sem cache incremental externo / R2 por enquanto — leitura vem da API).
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
