/**
 * Búsqueda de cables por nombre e id (coincidencias parciales, sin acentos).
 * @param {string} s
 */
export function normalizeSearchText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Red efectiva del tendido (alineado con el servidor: null/vacío → FTTH).
 * @param {GeoJSON.Feature} f
 * @returns {'ftth'|'corporativa'}
 */
export function redTipoOfFeature(f) {
  const raw = f?.properties?.red_tipo;
  if (raw == null || String(raw).trim() === '') return 'ftth';
  const s = String(raw).trim().toLowerCase();
  if (s === 'corporativa' || s === 'corp' || s === 'corporate') return 'corporativa';
  return 'ftth';
}

/**
 * Solo features de la red indicada (aislamiento FTTH / corporativa).
 * @param {GeoJSON.FeatureCollection} fc
 * @param {'ftth'|'corporativa'} redTipo
 * @returns {GeoJSON.FeatureCollection}
 */
export function filterRoutesByNetwork(fc, redTipo) {
  if (redTipo !== 'ftth' && redTipo !== 'corporativa') {
    return fc && typeof fc === 'object' ? fc : { type: 'FeatureCollection', features: [] };
  }
  const features = (fc?.features || []).filter(
    (f) => f && f.type === 'Feature' && redTipoOfFeature(f) === redTipo
  );
  return { type: 'FeatureCollection', features };
}

/** Catálogos con hasta este tamaño muestran lista al enfocar sin escribir (p. ej. red corporativa). */
const MAX_CATALOG_EMPTY_QUERY = 80;

/**
 * Asegura `properties` como objeto (algunos proxies devuelven JSON como string).
 * @param {GeoJSON.FeatureCollection} fc
 * @returns {GeoJSON.FeatureCollection}
 */
export function normalizeRouteFeatureProperties(fc) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return fc && typeof fc === 'object' ? fc : { type: 'FeatureCollection', features: [] };
  }
  const features = fc.features.map((f) => {
    if (!f || f.type !== 'Feature') return f;
    let p = f.properties;
    if (typeof p === 'string') {
      try {
        p = JSON.parse(p);
      } catch {
        p = {};
      }
    }
    if (!p || typeof p !== 'object') p = {};
    return { ...f, properties: { ...p } };
  });
  return { type: 'FeatureCollection', features };
}

/**
 * @param {GeoJSON.FeatureCollection} fc
 * @param {string} rawQuery
 * @param {number} limit
 * @param {'ftth'|'corporativa'} networkRed obligatorio: solo se buscan cables de esa red
 * @returns {GeoJSON.Feature[]}
 */
export function searchRouteFeatures(fc, rawQuery, limit = 20, networkRed) {
  if (networkRed !== 'ftth' && networkRed !== 'corporativa') {
    return [];
  }
  const fcSoloRed = filterRoutesByNetwork(fc, networkRed);
  const feats = fcSoloRed.features || [];
  if (!feats.length) return [];

  const q = normalizeSearchText(rawQuery);
  if (!q) {
    if (feats.length <= MAX_CATALOG_EMPTY_QUERY) {
      return [...feats]
        .sort((a, b) =>
          String(a.properties?.nombre ?? '').localeCompare(
            String(b.properties?.nombre ?? ''),
            'es',
            { sensitivity: 'base' }
          )
        )
        .slice(0, limit);
    }
    return [];
  }

  const words = q.split(' ').filter((w) => w.length > 0);
  const ranked = [];

  for (const f of feats) {
    if (!f || f.type !== 'Feature') continue;
    const nombre = normalizeSearchText(f.properties?.nombre ?? '');
    const idRaw = String(f.id ?? '').trim();
    const idNorm = normalizeSearchText(idRaw);

    let score = 0;

    if (idNorm === q || idRaw === String(rawQuery).trim()) score = 100000;
    else if (idNorm.includes(q) || idRaw.includes(q)) score = 75000 + Math.min(q.length * 50, 5000);

    const nameWordMatch = words.length > 0 && words.every((w) => nombre.includes(w));
    if (nameWordMatch) {
      let s = 25000;
      if (nombre.includes(q)) s += 6000;
      if (nombre.startsWith(q)) s += 4000;
      score = Math.max(score, s);
    }

    if (score > 0) ranked.push({ f, score });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const na = String(a.f.properties?.nombre ?? '');
    const nb = String(b.f.properties?.nombre ?? '');
    return na.localeCompare(nb, 'es', { sensitivity: 'base' });
  });
  return ranked.slice(0, limit).map((x) => x.f);
}
