/**
 * Lee `moleculas-manifest.json` (Flashfiber FTTH) para enlazar búsqueda → molécula y rutas en disco.
 */

/**
 * @param {unknown} doc
 * @returns {{ central: string, molecula: string, label: string, paths: string[] }[]}
 */
export function indexManifestEntries(doc) {
  const manifest = doc && typeof doc === 'object' ? doc.manifest ?? doc : null;
  if (!manifest || typeof manifest !== 'object') return [];
  const out = [];
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue;
    const central = String(entry.central ?? '').trim();
    const molecula = String(entry.molecula ?? '').trim();
    const paths = Array.isArray(entry.paths) ? entry.paths.map((p) => String(p ?? '').replace(/\\/g, '/')) : [];
    const label = String(entry.label ?? `${molecula} (${central})`).trim();
    if (!molecula) continue;
    out.push({ central, molecula, label, paths });
  }
  return out;
}

/**
 * @param {string} a
 * @param {string} b
 */
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Texto del buscador con formato Flashfiber `CENTRAL|MOL|…` → código de molécula (`MOL`, ej. SI22).
 * Sin al menos dos segmentos separados por `|`, se devuelve el texto tal cual (recortado).
 * @param {string} raw
 * @returns {string}
 */
export function moleculeTokenFromSearchInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const parts = s.split('|').map((p) => p.trim());
  if (parts.length >= 2 && parts[1] !== '') return parts[1];
  return s;
}

/**
 * @param {{ central: string, molecula: string, label: string, paths: string[] }[]} entries
 * @param {string} rawQuery
 * @param {number} limit
 */
export function matchMoleculeEntries(entries, rawQuery, limit = 6) {
  const q = norm(moleculeTokenFromSearchInput(rawQuery));
  if (!q) return [];
  const scored = [];
  for (const e of entries) {
    const m = norm(e.molecula);
    const l = norm(e.label);
    const c = norm(e.central);
    let score = 0;
    if (m === q) score = 100_000;
    else if (m.startsWith(q)) score = 50_000;
    else if (m.includes(q)) score = 30_000;
    else if (l.includes(q)) score = 10_000 + (l.startsWith(q) ? 2000 : 0);
    else if (c.includes(q)) score = 5000;
    if (score > 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.e.molecula.localeCompare(b.e.molecula));
  const seen = new Set();
  const uniq = [];
  for (const { e } of scored) {
    const k = `${e.central}|${e.molecula}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(e);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

/**
 * Entrada del manifiesto que coincide con central + molécula (tolerante a `_` vs espacios).
 * @param {{ central: string, molecula: string, label: string, paths: string[] }[]} entries
 * @param {string} central
 * @param {string} molecula
 */
export function findManifestEntryForMolecule(entries, central, molecula) {
  const m = norm(molecula);
  const c = norm(String(central ?? '').replace(/_/g, ' '));
  if (!m) return null;
  for (const e of entries || []) {
    if (norm(e.molecula) !== m) continue;
    if (!c) return e;
    const ec = norm(String(e.central ?? '').replace(/_/g, ' '));
    if (ec === c) return e;
  }
  return null;
}

/**
 * Primer segmento `CENTRAL/MOL` a partir de rutas del manifiesto.
 * @param {string[]} paths
 */
export function inferMoleculeBasePath(paths) {
  for (const p of paths) {
    const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  }
  return '';
}

/**
 * @param {string} rootUrl base con barra final, ej. http://host/geojson/ftth/
 * @param {string} rel ruta relativa dentro de FTTH
 */
export function flashfiberAssetUrl(rootUrl, rel) {
  const base = String(rootUrl ?? '').replace(/\/?$/, '/');
  const r = String(rel ?? '').replace(/^\/+/, '');
  return `${base}${r}`;
}
