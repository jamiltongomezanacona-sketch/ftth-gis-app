/**
 * Lee el HTML del artefacto Claude guardado en Escritorio y escribe SVG en public/icons/ftth/.
 * Uso: node scripts/extract-ftth-icons-from-claude-html.mjs [ruta-al-72ed02bb....html]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const defaultSrc = path.join(
  'C:',
  'Users',
  'ASUS',
  'Desktop',
  'FTTH Modern Icons – 12 Professional SVG Icons _ Claude_files',
  '72ed02bb-0dfe-48ba-8208-7ef1c23d52c2.html'
);

const src = process.argv[2] || defaultSrc;
const html = fs.readFileSync(src, 'utf8');

const re =
  /<svg viewBox="0 0 88 88" fill="none" xmlns="http:\/\/www\.w3\.org\/2000\/svg">[\s\S]*?<\/svg>/g;
const svgs = [...html.matchAll(re)].map((m) => m[0]);

const names = [
  'central',
  'troncal',
  'evento',
  'cierre-e1',
  'cierre-e2',
  'mantenimiento',
  'nap-libre',
  'nap-ocupado',
  'nap-lleno',
  'cliente',
  'cliente-corporativo',
  'gps'
];

if (svgs.length !== names.length) {
  console.error(`Se esperaban ${names.length} SVG, se encontraron ${svgs.length}.`);
  process.exit(1);
}

const outDir = path.join(root, 'public', 'icons', 'ftth');
fs.mkdirSync(outDir, { recursive: true });

names.forEach((name, i) => {
  const prefix = `ftth-${name}-`;
  let s = svgs[i];
  s = s.replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`);
  s = s.replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`);
  /* HTML/React exporta tags en minúsculas; SVG XML válido para Mapbox loadImage */
  s = s.replace(/lineargradient/g, 'linearGradient').replace(/fedropshadow/g, 'feDropShadow');
  const out = `<?xml version="1.0" encoding="UTF-8"?>\n${s}\n`;
  fs.writeFileSync(path.join(outDir, `${name}.svg`), out, 'utf8');
  console.log('OK', name);
});

console.log('→', outDir);
