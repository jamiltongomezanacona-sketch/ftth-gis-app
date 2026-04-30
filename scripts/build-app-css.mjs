/**
 * Concatena tokens + partials en un solo CSS para una sola petición HTTP.
 * Orden idéntico a public/css/app.css (@import).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssDir = join(__dirname, '..', 'public', 'css');

const FILES = [
  'tokens.css',
  'partials/01-base-layout-gates.css',
  'partials/02-editor-chrome-map-shell.css',
  'partials/03-tools-trazar-otdr.css',
  'partials/04-reporte-popups-chrome-tools.css',
  'partials/05-sidebar-fab-stack.css',
  'partials/06-sheet-operation-measure-fab.css',
  'partials/07-editor-hub-modals-panels.css',
  'partials/08-attribution-mobile-overrides.css',
];

let out =
  '/* Generado por scripts/build-app-css.mjs — no editar; cambiar partials y ejecutar npm run build:css */\n';

for (const rel of FILES) {
  const buf = await readFile(join(cssDir, rel), 'utf8');
  out += `\n/* ========== ${rel} ========== */\n`;
  out += buf.trimEnd();
  out += '\n';
}

const dest = join(cssDir, 'app.bundle.css');
await writeFile(dest, out, 'utf8');
console.log(`OK  ${dest}`);
