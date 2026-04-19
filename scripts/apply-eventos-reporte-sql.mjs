/**
 * Crea la tabla `eventos_reporte` (reportes desde el editor GIS).
 * Equivale a ejecutar a mano: sql/06_eventos_reporte.sql
 *
 * Uso: npm run db:apply-eventos
 * Requiere .env con DATABASE_URL (o PG* como en server/db.js).
 * Debe existir la tabla `rutas` (FK ruta_id).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'sql', '06_eventos_reporte.sql');

const pool = createPool();
try {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('OK: eventos_reporte (06_eventos_reporte.sql)');
} catch (e) {
  console.error('Error:', e.message);
  if (e.code) console.error('code:', e.code);
  process.exitCode = 1;
} finally {
  await pool.end();
}
