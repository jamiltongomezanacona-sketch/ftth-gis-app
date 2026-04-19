/**
 * Importa cables (LineString) desde el árbol GeoJSON de Flashfiber FTTH a `rutas`.
 *
 * Origen: carpeta que contiene `moleculas-manifest.json` (ej. flashfiber-ftth/public/geojson/FTTH).
 * Solo se leen archivos bajo rutas con `/cables/` y extensión `.geojson` (se ignoran cierres/puntos).
 *
 * Uso:
 *   En .env: FLASHFIBER_FTTH_DIR=C:\Users\ASUS\Desktop\flashfiber-ftth\public\geojson\FTTH
 *   npm run import:flashfiber-ftth -- --dry-run
 *   npm run import:flashfiber-ftth -- --skip-existing
 *   npm run import:flashfiber-ftth -- --limit=50
 *   npm run import:flashfiber-ftth -- "C:\ruta\a\FTTH" --red=ftth
 *   npm run import:flashfiber-ftth -- "C:\…\FTTH" --replace-ftth
 *     → borra todas las rutas FTTH (incl. legacy sin red_tipo) y carga solo lo del manifiesto.
 *
 * Requiere PostGIS, sql/01_rutas.sql y sql/03_red_independientes.sql.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../server/db.js';
import { insertRuta } from '../server/rutasRepo.js';
import {
  normalizeNombre,
  normalizeRedTipo,
  MAX_NOMBRE_LEN,
  isLineStringGeometry
} from '../server/rutasShared.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const posArgs = argv.filter((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const skipExisting = flags.has('--skip-existing');
const replaceFtth = flags.has('--replace-ftth');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const maxInserts = limitArg ? Math.max(0, parseInt(limitArg.slice('--limit='.length), 10) || 0) : 0;
const redArg = argv.find((a) => a.startsWith('--red='));
const importRed = normalizeRedTipo(redArg?.slice('--red='.length));

const rootFromEnv = process.env.FLASHFIBER_FTTH_DIR
  ? path.resolve(process.env.FLASHFIBER_FTTH_DIR)
  : '';
const rootFromArg = posArgs[0] ? path.resolve(posArgs[0]) : '';
const rootDir = rootFromArg || rootFromEnv;

if (!rootDir) {
  console.error('Indica la carpeta FTTH o define FLASHFIBER_FTTH_DIR en .env, por ejemplo:');
  console.error('  npm run import:flashfiber-ftth -- --dry-run');
  console.error(
    '  npm run import:flashfiber-ftth -- "C:\\Users\\ASUS\\Desktop\\flashfiber-ftth\\public\\geojson\\FTTH"'
  );
  console.error(
    '  npm run import:flashfiber-ftth -- "…\\FTTH" --replace-ftth   (solo FTTH en BD = esta carpeta)'
  );
  process.exit(1);
}

if (replaceFtth && importRed !== 'ftth') {
  console.error('--replace-ftth solo aplica con red FTTH (por defecto o --red=ftth).');
  process.exit(1);
}

const manifestPath = path.join(rootDir, 'moleculas-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('No existe moleculas-manifest.json en:', rootDir);
  process.exit(1);
}

const manifestDoc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifest = manifestDoc.manifest ?? manifestDoc;
if (!manifest || typeof manifest !== 'object') {
  console.error('manifest inválido (se esperaba { manifest: { … } }).');
  process.exit(1);
}

/** @type {{ rel: string; central: string; molecula: string }[]} */
const cableFiles = [];
for (const entry of Object.values(manifest)) {
  if (!entry || typeof entry !== 'object') continue;
  const central = String(entry.central ?? '').trim();
  const molecula = String(entry.molecula ?? '').trim();
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  for (const rel of paths) {
    const r = String(rel ?? '').replace(/\\/g, '/');
    const low = r.toLowerCase();
    if (!r.includes('/cables/')) continue;
    if (low.endsWith('/index.json') || low.endsWith('index.json')) continue;
    if (!low.endsWith('.geojson') && !low.endsWith('.json')) continue;
    cableFiles.push({ rel: r, central, molecula });
  }
}

console.log(`Raíz FTTH: ${rootDir}`);
console.log(`Archivos bajo cables/ en manifiesto (.geojson / .json): ${cableFiles.length}`);
console.log(`Red destino (rutas.red_tipo): ${importRed}`);
if (replaceFtth) {
  console.log(
    '[replace-ftth] Se borrarán rutas FTTH (red_tipo ftth, NULL o vacío) antes de insertar; corporativa no se toca.'
  );
}
if (dryRun) console.log('[dry-run] No se escribe en la base.');

let inserted = 0;
let skippedGeom = 0;
let skippedDup = 0;
let skippedMissing = 0;
let errors = 0;

function buildNombre(central, molecula, feature, fileBase) {
  const props = feature?.properties || {};
  const part = String(props.name ?? fileBase)
    .trim()
    .replace(/\s+/g, ' ');
  const raw = `${central}|${molecula}|${part || fileBase}`;
  let n = normalizeNombre(raw);
  if (!n) n = normalizeNombre(fileBase) || 'cable';
  return n.slice(0, MAX_NOMBRE_LEN);
}

if (dryRun) {
  let would = 0;
  let badJson = 0;
  for (const { rel, central, molecula } of cableFiles) {
    const full = path.join(rootDir, rel.split('/').join(path.sep));
    if (!fs.existsSync(full)) {
      skippedMissing++;
      continue;
    }
    const raw = fs.readFileSync(full, 'utf8').trim();
    if (!raw) {
      badJson++;
      continue;
    }
    let gj;
    try {
      gj = JSON.parse(raw);
    } catch {
      badJson++;
      console.warn(`[dry-run] JSON inválido o vacío: ${rel}`);
      continue;
    }
    for (const f of gj.features || []) {
      const g = f?.geometry;
      if (!g || g.type !== 'LineString') continue;
      if (!isLineStringGeometry(g)) {
        skippedGeom++;
        continue;
      }
      const base = path.basename(rel, '.geojson');
      const nombre = buildNombre(central, molecula, f, base);
      would++;
      if (would <= 5) console.log(`  ejemplo: ${nombre}`);
      if (maxInserts > 0 && would >= maxInserts) break;
    }
    if (maxInserts > 0 && would >= maxInserts) break;
  }
  console.log(`[dry-run] Líneas LineString válidas (aprox.): ${would} (mostrando hasta 5 nombres).`);
  if (badJson) console.log(`[dry-run] Archivos JSON omitidos: ${badJson}`);
  process.exit(0);
}

const pool = createPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');
  if (replaceFtth && !dryRun) {
    const { rowCount } = await client.query(
      `DELETE FROM rutas
       WHERE lower(trim(coalesce(red_tipo::text, ''))) <> 'corporativa'`
    );
    console.log(`Eliminadas filas FTTH/legacy antes de importar: ${rowCount ?? 0}`);
  }
  outer: for (const { rel, central, molecula } of cableFiles) {
    if (maxInserts > 0 && inserted >= maxInserts) break outer;
    const full = path.join(rootDir, rel.split('/').join(path.sep));
    if (!fs.existsSync(full)) {
      skippedMissing++;
      continue;
    }
    const raw = fs.readFileSync(full, 'utf8').trim();
    if (!raw) {
      errors++;
      continue;
    }
    let gj;
    try {
      gj = JSON.parse(raw);
    } catch {
      console.warn(`JSON inválido: ${rel}`);
      errors++;
      continue;
    }
    for (const f of gj.features || []) {
      if (maxInserts > 0 && inserted >= maxInserts) break outer;
      const g = f?.geometry;
      if (!g || g.type !== 'LineString') continue;
      if (!isLineStringGeometry(g)) {
        skippedGeom++;
        continue;
      }
      const base = path.basename(rel, '.geojson');
      const nombre = buildNombre(central, molecula, f, base);
      if (skipExisting) {
        const { rows } = await client.query(
          'SELECT 1 FROM rutas WHERE nombre = $1 AND red_tipo = $2 LIMIT 1',
          [nombre, importRed]
        );
        if (rows.length) {
          skippedDup++;
          continue;
        }
      }
      try {
        const row = await insertRuta(client, nombre, g, importRed);
        if (row) inserted++;
        else errors++;
      } catch (e) {
        console.warn(`Error insertando «${nombre}»:`, e.message);
        errors++;
      }
    }
  }
  await client.query('COMMIT');
  console.log(`Insertadas: ${inserted}`);
  if (skippedGeom) console.log(`Omitidas (geometría no válida): ${skippedGeom}`);
  if (skippedDup) console.log(`Omitidas (nombre ya existía, --skip-existing): ${skippedDup}`);
  if (skippedMissing) console.log(`Archivos del manifiesto no encontrados: ${skippedMissing}`);
  if (errors) console.log(`Errores: ${errors}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Rollback:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
