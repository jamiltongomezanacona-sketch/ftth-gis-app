/**
 * Importa el dump legado (`sql/seeds/eventos_legacy_rows.sql`) hacia `eventos_reporte`.
 *
 * Flujo:
 * 1. Crea tabla staging (07_eventos_import_staging.sql)
 * 2. Trunca staging y ejecuta INSERT del seed (mismas filas que eventos_rows.sql del escritorio)
 * 3. Inserta en eventos_reporte con normalización (08_eventos_reporte_from_legacy_staging.sql)
 *
 * Uso: npm run db:seed-eventos-legacy
 * Requiere: npm run db:apply-eventos (tabla eventos_reporte), PostGIS, DATABASE_URL.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const pool = createPool();

async function readUtf8(rel) {
  let s = fs.readFileSync(path.join(root, rel), 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

try {
  const ddl = await readUtf8('sql/07_eventos_import_staging.sql');
  const seed = await readUtf8('sql/seeds/eventos_legacy_rows.sql');
  const transform = await readUtf8('sql/08_eventos_reporte_from_legacy_staging.sql');

  await pool.query(ddl);
  console.log('OK: eventos_import_staging');

  await pool.query('TRUNCATE eventos_import_staging');
  await pool.query(seed);
  const nStaging = await pool.query(
    'SELECT count(*)::int AS c FROM eventos_import_staging'
  );
  const staged = nStaging.rows[0]?.c ?? 0;
  console.log(`OK: staging cargado (${staged} fila(s) desde sql/seeds/eventos_legacy_rows.sql)`);

  const ins = await pool.query(transform);
  const inserted = ins.rowCount ?? 0;
  if (inserted === 0 && staged > 0) {
    console.log(
      'Aviso: 0 filas nuevas en eventos_reporte. Suele significar que ya se importaron antes (se evita duplicar por [legacy:uuid] en descripcion). Para volver a cargar desde cero, borra esas filas en PostgreSQL o trunca eventos_reporte (solo si te conviene).'
    );
  } else {
    console.log(`OK: insertados en eventos_reporte: ${inserted} fila(s) nueva(s)`);
  }
} catch (e) {
  console.error('Error:', e.message);
  if (e.code) console.error('code:', e.code);
  process.exitCode = 1;
} finally {
  await pool.end();
}
