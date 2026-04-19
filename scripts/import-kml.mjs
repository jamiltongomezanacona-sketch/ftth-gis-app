/**
 * Importa cables desde un KML (LineString) a la tabla `rutas` (PostGIS 4326).
 *
 * Uso:
 *   node scripts/import-kml.mjs "C:\ruta\CABLES.kml"
 *   node scripts/import-kml.mjs "C:\ruta\CABLES.kml" --dry-run
 *   node scripts/import-kml.mjs "C:\ruta\CABLES.kml" --skip-existing
 *   node scripts/import-kml.mjs "…" --red=corporativa
 *
 * Requiere `.env` con DATABASE_URL (o PG*), sql/01_rutas.sql y sql/03_red_independientes.sql.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import tj from '@mapbox/togeojson';
import { createPool } from '../server/db.js';
import { MAX_LINE_VERTICES } from '../server/rutasShared.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const posArgs = argv.filter((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const skipExisting = flags.has('--skip-existing');
const redArg = argv.find((a) => a.startsWith('--red='));
const importRed =
  String(redArg?.slice('--red='.length) ?? '')
    .trim()
    .toLowerCase() === 'corporativa'
    ? 'corporativa'
    : 'ftth';

const kmlPath = posArgs[0];
if (!kmlPath) {
  console.error('Indica la ruta al .kml, por ejemplo:');
  console.error('  node scripts/import-kml.mjs "C:\\Users\\ASUS\\Desktop\\CABLES.kml"');
  process.exit(1);
}

const abs = path.isAbsolute(kmlPath) ? kmlPath : path.resolve(process.cwd(), kmlPath);
if (!fs.existsSync(abs)) {
  console.error('No existe el archivo:', abs);
  process.exit(1);
}

const xml = fs.readFileSync(abs, 'utf8');
const dom = new DOMParser().parseFromString(xml, 'text/xml');
const fc = tj.kml(dom);

/** @type {GeoJSON.Feature<GeoJSON.LineString>[]} */
const lines = fc.features.filter(
  (f) => f.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)
);

const nameUses = new Map();

function nombrePara(f, idx) {
  let base = (f.properties?.name || `Cable ${idx + 1}`).trim().replace(/\s+/g, ' ');
  if (!base) base = `Cable ${idx + 1}`;
  base = base.slice(0, 198);
  const n = (nameUses.get(base) || 0) + 1;
  nameUses.set(base, n);
  if (n === 1) return base.slice(0, 200);
  return `${base.slice(0, 190)} (${n})`.slice(0, 200);
}

let skippedVerts = 0;
let skippedShort = 0;
const toInsert = [];

for (let i = 0; i < lines.length; i++) {
  const f = lines[i];
  const geom = /** @type {GeoJSON.LineString} */ (f.geometry);
  const coords = geom.coordinates.map((c) => [Number(c[0]), Number(c[1])]);
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

console.log(`KML: ${abs}`);
console.log(`Red destino: ${importRed}`);
console.log(`Placemarks GeoJSON: ${fc.features.length}, LineString válidas: ${toInsert.length}`);
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

try {
  await client.query('BEGIN');
  for (const row of toInsert) {
    if (skipExisting) {
      const { rows } = await client.query(
        'SELECT 1 FROM rutas WHERE nombre = $1 AND red_tipo = $2 LIMIT 1',
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
  console.log(`Insertadas: ${inserted} filas en rutas.`);
  if (skipExisting && skippedDup) console.log(`Omitidas (nombre ya existía): ${skippedDup}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
