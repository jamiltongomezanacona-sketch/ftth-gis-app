/**
 * Copia filas de `rutas` desde la base local (SOURCE) hacia Supabase (TARGET) usando solo Node + pg.
 * No requiere pg_dump en el PATH.
 *
 * Origen: `SOURCE_DATABASE_URL` o, si no existe, `DATABASE_URL` del `.env` (típico: 127.0.0.1).
 * Destino: `TARGET_DATABASE_URL` obligatoria (URI pooler Supabase con sslmode=require).
 *
 * Uso (PowerShell):
 *   cd ftth-gis-app
 *   $env:TARGET_DATABASE_URL = "postgresql://postgres.PROJECT:CLAVE@aws-....pooler.supabase.com:5432/postgres?sslmode=require"
 *   node scripts/migrate-rutas-local-to-supabase.mjs --replace-all-on-target
 *
 *   # Solo simular:
 *   node scripts/migrate-rutas-local-to-supabase.mjs --replace-all-on-target --dry-run
 *
 * `--replace-all-on-target` borra TODAS las filas de `rutas` en el destino antes de insertar
 * (eventos_reporte.ruta_id queda NULL por ON DELETE SET NULL). Úsalo solo si es lo que quieres.
 */
import 'dotenv/config';
import { URL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const replaceAll = argv.includes('--replace-all-on-target');

const sourceUrl =
  process.env.SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const targetUrl = process.env.TARGET_DATABASE_URL?.trim();

if (!sourceUrl) {
  console.error('Falta origen: define SOURCE_DATABASE_URL o DATABASE_URL en .env (Postgres local).');
  process.exit(1);
}
if (!targetUrl) {
  console.error(
    'Falta TARGET_DATABASE_URL (URI de Supabase pooler). Ejemplo en PowerShell:\n' +
      '  $env:TARGET_DATABASE_URL = "postgresql://postgres.xxx:CLAVE@aws-....pooler.supabase.com:5432/postgres?sslmode=require"'
  );
  process.exit(1);
}

if (sourceUrl === targetUrl) {
  console.error('SOURCE y TARGET no pueden ser la misma URL.');
  process.exit(1);
}

function mask(u) {
  try {
    const x = new URL(u);
    if (x.password) x.password = '***';
    return x.toString();
  } catch {
    return '(url inválida)';
  }
}

/**
 * Supabase + `sslmode=require` en la URL hace que `pg` verifique el certificado estricto y en Windows
 * suele fallar con SELF_SIGNED_CERT_IN_CHAIN. Para destino Supabase no usamos connectionString:
 * pasamos host/user/… y `ssl.rejectUnauthorized: false` (solo este script de migración).
 */
function poolConfig(connectionString) {
  const raw = String(connectionString);
  const remote = raw.includes('supabase.co');
  if (!remote) {
    return { connectionString: raw, max: 3 };
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { connectionString: raw, max: 3, ssl: { rejectUnauthorized: false } };
  }
  const port = u.port ? Number(u.port) : 5432;
  const database = (u.pathname || '/postgres').replace(/^\//, '') || 'postgres';
  let user = u.username ? decodeURIComponent(u.username) : 'postgres';
  let password = u.password != null ? decodeURIComponent(u.password) : '';
  return {
    host: u.hostname,
    port,
    user,
    password,
    database,
    max: 3,
    ssl: { rejectUnauthorized: false }
  };
}

const sourcePool = new Pool(poolConfig(sourceUrl));
const targetPool = new Pool(poolConfig(targetUrl));

async function main() {
  console.log('[migrar] Origen:', mask(sourceUrl));
  console.log('[migrar] Destino:', mask(targetUrl));
  if (dryRun) console.log('[migrar] MODO DRY-RUN (no escribe en destino)\n');

  const { rows: srcRows } = await sourcePool.query(`
    SELECT
      nombre,
      ST_AsGeoJSON(geom)::json AS geom_json,
      CASE
        WHEN lower(trim(coalesce(red_tipo::text, ''))) = 'corporativa' THEN 'corporativa'
        ELSE 'ftth'
      END AS red_tipo
    FROM rutas
    WHERE geom IS NOT NULL
    ORDER BY id
  `);

  console.log(`[migrar] Filas en origen (con geom): ${srcRows.length}`);

  if (srcRows.length === 0) {
    console.log('[migrar] Nada que copiar.');
    await sourcePool.end();
    await targetPool.end();
    return;
  }

  if (!dryRun && replaceAll) {
    const { rowCount } = await targetPool.query('DELETE FROM rutas');
    console.log(`[migrar] Destino: eliminadas ${rowCount} filas de rutas (--replace-all-on-target).`);
  } else if (!dryRun && !replaceAll) {
    console.warn(
      '[migrar] AVISO: no usaste --replace-all-on-target. Se insertarán filas ADICIONALES (puede haber nombres duplicados).\n' +
        '         Si quieres vaciar rutas en Supabase antes, vuelve a ejecutar con: --replace-all-on-target'
    );
  }

  let ok = 0;
  let err = 0;

  for (const row of srcRows) {
    const geomStr = JSON.stringify(row.geom_json);
    try {
      if (dryRun) {
        ok++;
        continue;
      }
      await targetPool.query(
        `
        INSERT INTO rutas (nombre, geom, red_tipo)
        VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)::geometry(LineString, 4326), $3)
        `,
        [row.nombre, geomStr, row.red_tipo]
      );
      ok++;
    } catch (e) {
      err++;
      console.error(`[migrar] Error fila "${row.nombre}":`, e.message);
    }
  }

  console.log(
    `[migrar] ${dryRun ? 'Simulado' : 'Insertadas'}: ${ok} correctas` + (err ? `, ${err} con error` : '')
  );

  if (!dryRun) {
    const { rows: c } = await targetPool.query('SELECT COUNT(*)::int AS n FROM rutas');
    console.log(`[migrar] Total filas rutas en destino ahora: ${c[0]?.n ?? '?'}`);
  }

  await sourcePool.end();
  await targetPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
