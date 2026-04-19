/**
 * Copia tablas auxiliares desde Postgres local hacia Supabase (solo Node + pg).
 * Ejecutar después de `migrate:rutas:to-supabase` si quieres `ruta_id` coherente en eventos.
 *
 * Origen: SOURCE_DATABASE_URL o DATABASE_URL (.env).
 * Destino: TARGET_DATABASE_URL (pooler Supabase).
 *
 * Uso:
 *   npm run migrate:aux:to-supabase -- --replace-all-on-target
 *   npm run migrate:aux:to-supabase -- --centrales --cierres
 *   npm run migrate:aux:to-supabase -- --eventos --replace-all-on-target --dry-run
 *
 * Por defecto migra las tres: centrales_etb, cierres, eventos_reporte.
 */
import 'dotenv/config';
import { URL } from 'node:url';
import pg from 'pg';
import { poolConfig } from './pg-pool-config.mjs';

const { Pool } = pg;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const replaceAll = argv.includes('--replace-all-on-target');

const tableArgNames = ['--centrales', '--cierres', '--eventos', '--all'];
const hasTableArg = argv.some((a) => tableArgNames.includes(a));
/** Sin `--centrales` / `--cierres` / `--eventos` / `--all` → las tres tablas. */
const runCentrales = !hasTableArg || argv.includes('--centrales') || argv.includes('--all');
const runCierres = !hasTableArg || argv.includes('--cierres') || argv.includes('--all');
const runEventos = !hasTableArg || argv.includes('--eventos') || argv.includes('--all');

const sourceUrl =
  process.env.SOURCE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const targetUrl = process.env.TARGET_DATABASE_URL?.trim();

if (!sourceUrl) {
  console.error('Falta origen: SOURCE_DATABASE_URL o DATABASE_URL en .env.');
  process.exit(1);
}
if (!targetUrl) {
  console.error('Falta TARGET_DATABASE_URL (URI pooler Supabase).');
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

const sourcePool = new Pool(poolConfig(sourceUrl, 3));
const targetPool = new Pool(poolConfig(targetUrl, 3));

/** @param {import('pg').Pool} pool @param {string} nombre */
async function targetRutaIdByNombre(pool, nombre) {
  if (!nombre || !String(nombre).trim()) return null;
  const { rows } = await pool.query('SELECT id FROM rutas WHERE nombre = $1 LIMIT 1', [
    String(nombre).trim()
  ]);
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

async function migrateCentrales() {
  console.log('\n[migrar-aux] === centrales_etb ===');
  let sql = `
    SELECT
      nombre,
      props,
      ST_AsGeoJSON(geom)::json AS geom_json,
      CASE
        WHEN lower(trim(coalesce(red_tipo::text, ''))) = 'corporativa' THEN 'corporativa'
        ELSE 'ftth'
      END AS red_tipo
    FROM centrales_etb
    WHERE geom IS NOT NULL
    ORDER BY id
  `;
  let srcRows;
  try {
    const r = await sourcePool.query(sql);
    srcRows = r.rows;
  } catch (e) {
    if (e.code === '42703') {
      sql = `
        SELECT nombre, props, ST_AsGeoJSON(geom)::json AS geom_json, 'ftth'::text AS red_tipo
        FROM centrales_etb
        WHERE geom IS NOT NULL
        ORDER BY id
      `;
      const r = await sourcePool.query(sql);
      srcRows = r.rows;
    } else if (e.code === '42P01') {
      console.log('[migrar-aux] Origen sin tabla centrales_etb; omitido.');
      return;
    } else throw e;
  }

  console.log(`[migrar-aux] Origen centrales_etb (con geom): ${srcRows.length}`);
  if (!srcRows.length) return;

  if (!dryRun && replaceAll) {
    const { rowCount } = await targetPool.query('DELETE FROM centrales_etb');
    console.log(`[migrar-aux] Destino: eliminadas ${rowCount} filas centrales_etb.`);
  }

  let ok = 0;
  for (const row of srcRows) {
    const geomStr = JSON.stringify(row.geom_json);
    const propsJson = row.props != null ? JSON.stringify(row.props) : '{}';
    try {
      if (dryRun) {
        ok++;
        continue;
      }
      await targetPool.query(
        `
        INSERT INTO centrales_etb (nombre, props, geom, red_tipo)
        VALUES ($1, $2::jsonb, ST_SetSRID(ST_GeomFromGeoJSON($3::text), 4326)::geometry(Point, 4326), $4)
        ON CONFLICT (nombre, red_tipo) DO UPDATE SET
          props = EXCLUDED.props,
          geom = EXCLUDED.geom
        `,
        [row.nombre, propsJson, geomStr, row.red_tipo]
      );
      ok++;
    } catch (e) {
      if (e.code === '42P01') {
        console.error('[migrar-aux] Destino sin tabla centrales_etb. Ejecuta sql/02_centrales_etb.sql y sql/03_red_independientes.sql en Supabase.');
        return;
      }
      console.error(`[migrar-aux] Error central "${row.nombre}":`, e.message);
    }
  }
  console.log(`[migrar-aux] centrales_etb: ${dryRun ? 'simulado' : 'listo'}, filas procesadas: ${ok}`);
}

async function migrateCierres() {
  console.log('\n[migrar-aux] === cierres ===');
  let srcRows;
  try {
    const { rows } = await sourcePool.query(`
      SELECT
        id, molecula_id, nombre, tipo, estado, descripcion,
        ST_AsGeoJSON(geom)::json AS geom_json,
        created_at, molecula_codigo, lat, lng, usuario_id, dist_odf
      FROM cierres
      ORDER BY nombre NULLS LAST
    `);
    srcRows = rows;
  } catch (e) {
    if (e.code === '42P01') {
      console.log('[migrar-aux] Origen sin tabla cierres; omitido.');
      return;
    }
    throw e;
  }

  console.log(`[migrar-aux] Origen cierres: ${srcRows.length}`);
  if (!srcRows.length) return;

  if (!dryRun && replaceAll) {
    const { rowCount } = await targetPool.query('DELETE FROM cierres');
    console.log(`[migrar-aux] Destino: eliminadas ${rowCount} filas cierres.`);
  }

  let ok = 0;
  let err = 0;
  for (const row of srcRows) {
    const geomStr = row.geom_json ? JSON.stringify(row.geom_json) : null;
    try {
      if (dryRun) {
        ok++;
        continue;
      }
      await targetPool.query(
        `
        INSERT INTO cierres (
          id, molecula_id, nombre, tipo, estado, descripcion, geom,
          created_at, molecula_codigo, lat, lng, usuario_id, dist_odf
        )
        VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6,
          CASE WHEN $7::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($7::text), 4326)::geometry(Point, 4326) END,
          $8::timestamptz, $9, $10, $11, $12::uuid, $13
        )
        ON CONFLICT (id) DO UPDATE SET
          molecula_id = EXCLUDED.molecula_id,
          nombre = EXCLUDED.nombre,
          tipo = EXCLUDED.tipo,
          estado = EXCLUDED.estado,
          descripcion = EXCLUDED.descripcion,
          geom = EXCLUDED.geom,
          created_at = EXCLUDED.created_at,
          molecula_codigo = EXCLUDED.molecula_codigo,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          usuario_id = EXCLUDED.usuario_id,
          dist_odf = EXCLUDED.dist_odf
        `,
        [
          row.id,
          row.molecula_id,
          row.nombre,
          row.tipo,
          row.estado,
          row.descripcion,
          geomStr,
          row.created_at,
          row.molecula_codigo,
          row.lat,
          row.lng,
          row.usuario_id,
          row.dist_odf
        ]
      );
      ok++;
    } catch (e) {
      if (e.code === '42P01') {
        console.error('[migrar-aux] Destino sin tabla cierres. Ejecuta sql/04_cierres.sql en Supabase.');
        return;
      }
      err++;
      console.error(`[migrar-aux] Error cierre ${row.id}:`, e.message);
    }
  }
  console.log(`[migrar-aux] cierres: ${dryRun ? 'simulado' : 'listo'}, ok=${ok}` + (err ? ` err=${err}` : ''));
}

async function migrateEventos() {
  console.log('\n[migrar-aux] === eventos_reporte ===');
  if (!dryRun && !replaceAll) {
    console.warn(
      '[migrar-aux] eventos_reporte omitido: sin clave natural única; re-ejecuta con --replace-all-on-target para vaciar e insertar de cero.'
    );
    return;
  }
  let srcRows;
  try {
    const { rows } = await sourcePool.query(`
      SELECT
        e.created_at,
        e.red_tipo,
        e.dist_odf,
        e.tipo_evento,
        e.estado,
        e.accion,
        e.descripcion,
        r.nombre AS ruta_nombre,
        e.nombre_tendido,
        e.lng,
        e.lat,
        ST_AsGeoJSON(e.geom)::json AS geom_json
      FROM eventos_reporte e
      LEFT JOIN rutas r ON r.id = e.ruta_id
      ORDER BY e.id
    `);
    srcRows = rows;
  } catch (e) {
    if (e.code === '42P01') {
      console.log('[migrar-aux] Origen sin tabla eventos_reporte; omitido.');
      return;
    }
    throw e;
  }

  console.log(`[migrar-aux] Origen eventos_reporte: ${srcRows.length}`);
  if (!srcRows.length) return;

  if (!dryRun && replaceAll) {
    const { rowCount } = await targetPool.query('DELETE FROM eventos_reporte');
    console.log(`[migrar-aux] Destino: eliminadas ${rowCount} filas eventos_reporte.`);
  }

  let ok = 0;
  let err = 0;
  let sinRuta = 0;
  for (const row of srcRows) {
    try {
      if (dryRun) {
        ok++;
        continue;
      }
      let rutaId = null;
      if (row.ruta_nombre) {
        rutaId = await targetRutaIdByNombre(targetPool, row.ruta_nombre);
        if (rutaId == null) sinRuta++;
      }
      const geomStr = row.geom_json ? JSON.stringify(row.geom_json) : null;
      await targetPool.query(
        `
        INSERT INTO eventos_reporte (
          created_at, red_tipo, dist_odf, tipo_evento, estado, accion, descripcion,
          ruta_id, nombre_tendido, lng, lat, geom
        )
        VALUES (
          $1::timestamptz, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          CASE WHEN $12::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($12::text), 4326)::geometry(Point, 4326) END
        )
        `,
        [
          row.created_at,
          row.red_tipo,
          row.dist_odf,
          row.tipo_evento,
          row.estado,
          row.accion,
          row.descripcion,
          rutaId,
          row.nombre_tendido,
          row.lng,
          row.lat,
          geomStr
        ]
      );
      ok++;
    } catch (e) {
      if (e.code === '42P01') {
        console.error('[migrar-aux] Destino sin tabla eventos_reporte. Ejecuta sql/06_eventos_reporte.sql en Supabase.');
        return;
      }
      err++;
      console.error('[migrar-aux] Error evento:', e.message);
    }
  }
  console.log(
    `[migrar-aux] eventos_reporte: ${dryRun ? 'simulado' : 'listo'}, insertadas=${ok}` +
      (err ? ` err=${err}` : '') +
      (!dryRun && sinRuta ? ` (ruta_id NULL por nombre no encontrado en destino: ~${sinRuta})` : '')
  );
}

async function main() {
  console.log('[migrar-aux] Origen:', mask(sourceUrl));
  console.log('[migrar-aux] Destino:', mask(targetUrl));
  if (dryRun) console.log('[migrar-aux] DRY-RUN\n');
  console.log(
    '[migrar-aux] Tablas:',
    [runCentrales && 'centrales_etb', runCierres && 'cierres', runEventos && 'eventos_reporte']
      .filter(Boolean)
      .join(', ')
  );

  if (runCentrales) await migrateCentrales();
  if (runCierres) await migrateCierres();
  if (runEventos) await migrateEventos();

  await sourcePool.end();
  await targetPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
