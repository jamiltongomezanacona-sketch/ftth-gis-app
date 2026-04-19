/**
 * Marca un subconjunto mínimo como corporativa para que la sesión
 * «corporativa» no quede vacía (ajusta los ids según tu criterio).
 *
 * Por defecto: ids 1–3 (Troncal A/B, Ruta 2026-04-12 en bases típicas).
 * Uso:
 *   node scripts/db-seed-corporativa-ejemplo.mjs
 *   node scripts/db-seed-corporativa-ejemplo.mjs --ids=10,20,30
 */
import 'dotenv/config';
import { createPool } from '../server/db.js';

const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const ids = idsArg
  ? idsArg
      .slice('--ids='.length)
      .split(/[,;]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [1, 2, 3];

if (ids.length === 0) {
  console.error('Sin ids válidos.');
  process.exit(1);
}

const pool = createPool();
try {
  const { rowCount } = await pool.query(
    `UPDATE rutas SET red_tipo = 'corporativa' WHERE id = ANY($1::int[])`,
    [ids]
  );
  console.log('Filas actualizadas:', rowCount, 'ids:', ids.join(', '));

  const r = await pool.query(`
    SELECT red_tipo, COUNT(*)::int AS n FROM rutas GROUP BY red_tipo ORDER BY red_tipo
  `);
  console.log('rutas por red_tipo:', r.rows);
} finally {
  await pool.end();
}
