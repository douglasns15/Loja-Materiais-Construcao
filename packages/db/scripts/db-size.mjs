// Diagnóstico de tamanho do banco (para avaliar limite de 500 MB do free tier).
// Uso: node packages/db/scripts/db-size.mjs
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?/);
  if (m) process.env[m[1]] = m[2];
}

const prisma = new PrismaClient();
try {
  const [{ size, pretty }] = await prisma.$queryRawUnsafe(
    `SELECT pg_database_size(current_database()) AS size, pg_size_pretty(pg_database_size(current_database())) AS pretty`,
  );
  console.log(`\nTamanho total do banco: ${pretty} (${Number(size).toLocaleString()} bytes)\n`);

  const tables = await prisma.$queryRawUnsafe(
    `SELECT relname AS table, n_live_tup AS rows,
            pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
            pg_total_relation_size(relid) AS total_bytes
       FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20`,
  );
  console.log('Maiores tabelas (dados + índices):');
  for (const t of tables) {
    console.log(`  ${String(t.table).padEnd(24)} ${String(t.rows).padStart(8)} linhas   ${t.total_size}`);
  }
} finally {
  await prisma.$disconnect();
}
