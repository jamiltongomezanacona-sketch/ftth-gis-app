/**
 * Garantiza tablas base y aplica sql/03_red_independientes.sql.
 * 1) sql/02_centrales_etb.sql (IF NOT EXISTS)
 * 2) sql/03_red_independientes.sql
 *
 * Uso: npm run db:apply-red
 * Requiere .env con DATABASE_URL o PG* (igual que el servidor).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

const pool = createPool();
try {
  const order = ['02_centrales_etb.sql', '03_red_independientes.sql'];
  for (const name of order) {
    const sqlPath = path.join(sqlDir, name);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('OK:', name);
  }
} catch (e) {
  console.error('Error:', e.message);
  if (e.code) console.error('code:', e.code);
  process.exitCode = 1;
} finally {
  await pool.end();
}
