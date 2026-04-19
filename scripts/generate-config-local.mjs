/**
 * En Vercel (VERCEL=1) escribe `public/js/config.local.js` desde variables de entorno,
 * para que el import dinámico no devuelva 404 y el mapa tenga token sin subir el archivo a git.
 *
 * Vercel → Project → Settings → Environment Variables:
 *   MAPBOX_ACCESS_TOKEN
 *   PUBLIC_API_BASE (opcional, ej. "" si mismo origen)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dest = path.join(root, 'public', 'js', 'config.local.js');

if (!process.env.VERCEL) {
  console.log(
    '[generate-config-local] Omitido (solo corre en build de Vercel; en local usa public/js/config.local.js a mano).'
  );
  process.exit(0);
}

const token = process.env.MAPBOX_ACCESS_TOKEN ?? '';
const apiBase = process.env.PUBLIC_API_BASE ?? '';
const flash = process.env.FLASHFIBER_GEOJSON_BASE ?? '';

const body = `/* Generado en build Vercel — no editar en el despliegue */
export const MAPBOX_ACCESS_TOKEN = ${JSON.stringify(token)};
export const API_BASE = ${JSON.stringify(apiBase)};
export const FLASHFIBER_GEOJSON_BASE = ${JSON.stringify(flash)};
`;

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, body, 'utf8');
console.log(
  '[generate-config-local] OK →',
  path.relative(root, dest),
  token ? '(MAPBOX_ACCESS_TOKEN presente)' : '(MAPBOX_ACCESS_TOKEN vacío — configura en Vercel)'
);
