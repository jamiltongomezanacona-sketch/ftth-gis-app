/**
 * Importa tendidos LineString desde un GeoJSON (FeatureCollection) a `rutas` (PostGIS 4326).
 *
 * Uso:
 *   node scripts/import-rutas-geojson.mjs "C:\ruta\cables.geojson" --red=corporativa
 *   node scripts/import-rutas-geojson.mjs "…" --red=corporativa --replace
 *   node scripts/import-rutas-geojson.mjs "…" --dry-run --skip-existing
 *
 * `--replace` (solo con `--red=corporativa`): borra todas las filas `rutas` de esa red y vuelve a insertar.
 *
 * Requiere `.env` con DATABASE_URL, migración `sql/03_red_independientes.sql`.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../server/db.js';
import { MAX_LINE_VERTICES, MAX_NOMBRE_LEN } from '../server/rutasShared.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const posArgs = argv.filter((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const skipExisting = flags.has('--skip-existing');
const replace = flags.has('--replace');
const redArg = argv.find((a) => a.startsWith('--red='));
const importRed =
  String(redArg?.slice('--red='.length) ?? '')
    .trim()
    .toLowerCase() === 'corporativa'
    ? 'corporativa'
    : 'ftth';

const geoPath = posArgs[0];
if (!geoPath) {
  console.error('Indica la ruta al .geojson, por ejemplo:');
  console.error(
    '  node scripts/import-rutas-geojson.mjs "C:\\Users\\ASUS\\Desktop\\proyecto gis\\geojson actualizado\\CORPORATIVO\\cables.geojson" --red=corporativa --replace'
  );
  process.exit(1);
}

if (replace && importRed !== 'corporativa') {
  console.error('--replace solo está permitido con --red=corporativa.');
  process.exit(1);
}

const abs = path.isAbsolute(geoPath) ? geoPath : path.resolve(process.cwd(), geoPath);
if (!fs.existsSync(abs)) {
  console.error('No existe el archivo:', abs);
  process.exit(1);
}

let gj;
try {
  gj = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
  console.error('JSON inválido:', e.message);
  process.exit(1);
}

if (gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
  console.error('Se espera un FeatureCollection GeoJSON.');
  process.exit(1);
}

const nameUses = new Map();

function nombrePara(f, idx) {
  const raw =
    f.properties?.name ??
    f.properties?.nombre ??
    f.properties?.Nombre ??
    f.properties?.NOMBRE ??
    '';
  let base = String(raw).trim().replace(/\s+/g, ' ');
  if (!base) base = `Cable ${idx + 1}`;
  base = base.slice(0, Math.min(198, MAX_NOMBRE_LEN - 2));
  const n = (nameUses.get(base) || 0) + 1;
  nameUses.set(base, n);
  if (n === 1) return base.slice(0, MAX_NOMBRE_LEN);
  return `${base.slice(0, Math.max(1, MAX_NOMBRE_LEN - 12))} (${n})`.slice(0, MAX_NOMBRE_LEN);
}

/** @type {{ nombre: string, geometry: GeoJSON.LineString }[]} */
const toInsert = [];
let skippedShort = 0;
let skippedVerts = 0;
let skippedNonLine = 0;

for (let i = 0; i < gj.features.length; i++) {
  const f = gj.features[i];
  if (!f || f.type !== 'Feature') continue;
  const g = f.geometry;
  if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates)) {
    skippedNonLine++;
    continue;
  }
  const coords = g.coordinates.map((c) => [Number(c[0]), Number(c[1])]);
  if (coords.length < 2) {
    skippedShort++;
    continue;
  }
  if (coords.length > MAX_LINE_VERTICES) {
    skippedVerts++;
    continue;
  }
  if (!coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
    skippedShort++;
    continue;
  }
  toInsert.push({
    nombre: nombrePara(f, i),
    geometry: { type: 'LineString', coordinates: coords }
  });
}

console.log(`GeoJSON: ${abs}`);
console.log(`Red destino: ${importRed}`);
if (replace) console.log('Modo: --replace (se borran rutas corporativas actuales antes de insertar).');
console.log(`Features: ${gj.features.length}, LineString válidas: ${toInsert.length}`);
if (skippedNonLine) console.log(`Omitidas (no LineString): ${skippedNonLine}`);
if (skippedShort) console.log(`Omitidas (coords inválidas o <2): ${skippedShort}`);
if (skippedVerts) console.log(`Omitidas (>${MAX_LINE_VERTICES} vértices): ${skippedVerts}`);

if (dryRun) {
  console.log('[dry-run] No se escribe en la base de datos.');
  process.exit(0);
}

const pool = createPool();
const client = await pool.connect();
let inserted = 0;
let skippedDup = 0;
let deleted = 0;

try {
  await client.query('BEGIN');
  if (replace) {
    const { rowCount } = await client.query(
      `DELETE FROM rutas WHERE lower(trim(red_tipo::text)) = 'corporativa'`
    );
    deleted = rowCount ?? 0;
    console.log(`Eliminadas filas corporativas previas: ${deleted}`);
  }
  for (const row of toInsert) {
    if (skipExisting && !replace) {
      const { rows } = await client.query(
        'SELECT 1 FROM rutas WHERE nombre = $1 AND lower(trim(red_tipo::text)) = $2 LIMIT 1',
        [row.nombre, importRed]
      );
      if (rows.length) {
        skippedDup++;
        continue;
      }
    }
    await client.query(
      `INSERT INTO rutas (nombre, geom, red_tipo)
       VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)::geometry(LineString, 4326), $3)`,
      [row.nombre, JSON.stringify(row.geometry), importRed]
    );
    inserted++;
  }
  await client.query('COMMIT');
  console.log(`Insertadas: ${inserted} filas en rutas (red=${importRed}).`);
  if (skipExisting && skippedDup) console.log(`Omitidas (nombre ya existía en esa red): ${skippedDup}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
