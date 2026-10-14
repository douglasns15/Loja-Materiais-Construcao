// Sobe a API local (`wrangler dev`, porta 8787) falando com o banco do `apps/api/.dev.vars`.
//
// Uso: node apps/api/scripts/dev-local.mjs   (ou a configuração "api" do .claude/launch.json)
//
// O `wrangler dev` exige a connection string LOCAL do Hyperdrive numa variável de ambiente
// (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`) — não lê do `.dev.vars`. Este script
// lê o `DATABASE_URL` de lá e repassa, para não precisar colar a string no terminal.
// Atenção: o banco é o REAL — testar só na loja de teste.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const vars = readFileSync(join(apiDir, '.dev.vars'), 'utf8');
const match = vars.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
if (!match) {
  console.error('DATABASE_URL não encontrada em apps/api/.dev.vars');
  process.exit(1);
}

const child = spawn('npx', ['wrangler', 'dev', '--port', '8787'], {
  cwd: apiDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: match[1] },
});
child.on('exit', (code) => process.exit(code ?? 0));
