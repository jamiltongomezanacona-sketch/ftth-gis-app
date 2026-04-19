/**
 * Escribe `public/icons/ftth-mapa/<id>.svg` a partir de `ftthMapIconsData.js`
 * (mismo set que el HTML de referencia del usuario).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FTTH_MAP_ICONS, pinSvgString } from '../public/js/ftthMapIconsData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons', 'ftth-mapa');

fs.mkdirSync(outDir, { recursive: true });
for (const ic of FTTH_MAP_ICONS) {
  const body = pinSvgString(ic, { xmlDeclaration: true });
  fs.writeFileSync(path.join(outDir, `${ic.id}.svg`), body, 'utf8');
}
console.log(`OK: ${FTTH_MAP_ICONS.length} SVG en ${outDir}`);
