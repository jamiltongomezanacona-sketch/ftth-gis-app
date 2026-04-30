/**
 * Tras `build-app-css.mjs`, falla si `app.bundle.css` en disco no coincide con el índice git
 * (indica que alguien editó partials y no volvió a commitear el bundle).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execSync('node scripts/build-app-css.mjs', { cwd: root, stdio: 'inherit' });
try {
  execSync('git diff --quiet -- public/css/app.bundle.css', { cwd: root });
} catch {
  console.error(
    '\n[verify:css] public/css/app.bundle.css difiere de lo commiteado. ' +
      'Ejecuta `npm run build:css` y añade el bundle al commit.\n'
  );
  process.exit(1);
}
console.log('[verify:css] OK (bundle alineado con partials)');
