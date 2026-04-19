/**
 * Resumen red_tipo en rutas y centrales_etb (diagnóstico).
 * Uso: node scripts/db-snapshot-red.mjs
 */
import 'dotenv/config';
import { createPool } from '../server/db.js';

const pool = createPool();
try {
  const r = await pool.query(`
    SELECT red_tipo, COUNT(*)::int AS n
    FROM rutas
    GROUP BY red_tipo
    ORDER BY red_tipo
  `);
  console.log('rutas por red_tipo:', r.rows);

  const c = await pool.query(`
    SELECT red_tipo, COUNT(*)::int AS n
    FROM centrales_etb
    GROUP BY red_tipo
    ORDER BY red_tipo
  `);
  console.log('centrales_etb por red_tipo:', c.rows);

  const sample = await pool.query(`
    SELECT id, nombre, red_tipo
    FROM rutas
    ORDER BY id
    LIMIT 20
  `);
  console.log('muestra nombres (rutas):', sample.rows);
} finally {
  await pool.end();
}
