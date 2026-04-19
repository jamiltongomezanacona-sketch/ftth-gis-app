/**
 * Importa centrales desde un GeoJSON (Features Point) a `centrales_etb`.
 *
 * Uso:
 *   node scripts/import-centrales-geojson.mjs "C:\\ruta\\centrales-etb.geojson"
 *   node scripts/import-centrales-geojson.mjs "…" --dry-run
 *   node scripts/import-centrales-geojson.mjs "…" --replace   (borra solo la red indicada)
 *   node scripts/import-centrales-geojson.mjs "…" --red=corporativa
 *
 * Requiere sql/02_centrales_etb.sql y sql/03_red_independientes.sql en la base.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../server/db.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const posArgs = argv.filter((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');
const replace = flags.has('--replace');
const redArg = argv.find((a) => a.startsWith('--red='));
const importRed =
  String(redArg?.slice('--red='.length) ?? '')
    .trim()
    .toLowerCase() === 'corporativa'
    ? 'corporativa'
    : 'ftth';

const filePath = posArgs[0];
if (!filePath) {
  console.error('Indica la ruta al .geojson, por ejemplo:');
  console.error('  node scripts/import-centrales-geojson.mjs "C:\\…\\centrales-etb.geojson"');
  process.exit(1);
}

const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
if (!fs.existsSync(abs)) {
  console.error('No existe:', abs);
  process.exit(1);
}

const raw = fs.readFileSync(abs, 'utf8');
const gj = JSON.parse(raw);
if (gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
  console.error('Se espera un FeatureCollection GeoJSON.');
  process.exit(1);
}

const rows = [];
for (let i = 0; i < gj.features.length; i++) {
  const f = gj.features[i];
  if (!f || f.type !== 'Feature') continue;
  const g = f.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
  const lon = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const nombre = String(f.properties?.name ?? f.properties?.nombre ?? '').trim();
  if (!nombre) continue;
  const props = { ...(f.properties || {}) };
  delete props.name;
  delete props.nombre;
  rows.push({
    nombre: nombre.slice(0, 500),
    props,
    lon,
    lat
  });
}

console.log(`Archivo: ${abs}`);
console.log(`Red destino: ${importRed}`);
console.log(`Puntos válidos: ${rows.length}`);

if (dryRun) {
  console.log('[dry-run] No se escribe en la base.');
  process.exit(0);
}

const pool = createPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  if (replace) {
    const { rowCount } = await client.query(
      'DELETE FROM centrales_etb WHERE red_tipo = $1',
      [importRed]
    );
    console.log(`[replace] Eliminadas ${rowCount ?? 0} filas con red_tipo=${importRed}.`);
  }
  let n = 0;
  for (const r of rows) {
    await client.query(
      `
      INSERT INTO centrales_etb (nombre, props, geom, red_tipo)
      VALUES ($1, $2::jsonb, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)
      ON CONFLICT (nombre, red_tipo) DO UPDATE SET
        props = EXCLUDED.props,
        geom = EXCLUDED.geom
      `,
      [r.nombre, JSON.stringify(r.props), r.lon, r.lat, importRed]
    );
    n++;
  }
  await client.query('COMMIT');
  console.log(`Upsert: ${n} centrales.`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Error:', e.message);
  if (e.code === '42P01') {
    console.error('Crea la tabla con sql/02_centrales_etb.sql en tu base (pgAdmin).');
  }
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
