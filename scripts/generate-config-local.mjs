/**
 * En Vercel (VERCEL=1) sobrescribe `public/js/config.deploy.js` (archivo versionado).
 * No usar `config.local.js` aquí: está en .gitignore y Vercel puede excluirlo del CDN.
 *
 * Vercel → Environment Variables: MAPBOX_ACCESS_TOKEN, PUBLIC_API_BASE (opcional)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dest = path.join(root, 'public', 'js', 'config.deploy.js');

if (!process.env.VERCEL) {
  console.log(
    '[generate-config-deploy] Omitido (no es build Vercel; en local usa config.local.js o edita token en config.deploy.js sin subir secretos a git).'
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
  '[generate-config-deploy] OK →',
  path.relative(root, dest),
  token ? '(MAPBOX_ACCESS_TOKEN presente)' : '(MAPBOX_ACCESS_TOKEN vacío — configura en Vercel)'
);
