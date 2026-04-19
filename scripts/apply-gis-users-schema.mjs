/**
 * Crea la tabla `gis_users` ejecutando sql/09_gis_users.sql.
 * Uso: DATABASE_URL en .env o entorno → node scripts/apply-gis-users-schema.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { poolConfig } from './pg-pool-config.mjs';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'sql', '09_gis_users.sql');

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const pool = new Pool(poolConfig(url, 2));

await pool.query(sql);
console.log('[apply-gis-users-schema] OK → gis_users');
await pool.end();
