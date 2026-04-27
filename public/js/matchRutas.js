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
 * Red efectiva del tendido.
 * Si `targetNetwork` es `corporativa`, `red_tipo` ausente cuenta como corporativa
 * (la API ya devuelve solo esa red; evita vaciar el mapa si el GeoJSON no trae la propiedad).
 * En cualquier otro caso, null/vacío → FTTH (alineado con COALESCE del servidor en FTTH).
 * @param {GeoJSON.Feature} f
 * @param {'ftth'|'corporativa'|null|undefined} [targetNetwork] red de la sesión o del filtro activo
 * @returns {'ftth'|'corporativa'}
 */
export function redTipoOfFeature(f, targetNetwork) {
  const raw = f?.properties?.red_tipo;
  if (raw == null || String(raw).trim() === '') {
    return targetNetwork === 'corporativa' ? 'corporativa' : 'ftth';
  }
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
    (f) => f && f.type === 'Feature' && redTipoOfFeature(f, redTipo) === redTipo
  );
  return { type: 'FeatureCollection', features };
}

/** Catálogos con hasta este tamaño muestran lista al enfocar sin escribir (p. ej. red corporativa). */
const MAX_CATALOG_EMPTY_QUERY = 80;
/** Caché de índice para puntos (centrales) por red. */
const CENTRALES_INDEX_CACHE = new WeakMap();
/**
 * Cache en memoria por colección para evitar normalizaciones repetidas
 * durante búsquedas sucesivas.
 * @type {WeakMap<GeoJSON.FeatureCollection, { ftth: ReturnType<typeof buildSearchIndex>|null, corporativa: ReturnType<typeof buildSearchIndex>|null }>}
 */
const SEARCH_INDEX_CACHE = new WeakMap();

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
 * @param {GeoJSON.Feature[]} feats
 */
function buildSearchIndex(feats) {
  const entries = [];
  for (const f of feats) {
    if (!f || f.type !== 'Feature') continue;
    const nombreRaw = String(f.properties?.nombre ?? f.properties?.name ?? '');
    const idRaw = String(f.id ?? '').trim();
    entries.push({
      f,
      nombreRaw,
      nombreNorm: normalizeSearchText(nombreRaw),
      idRaw,
      idNorm: normalizeSearchText(idRaw)
    });
  }
  const emptyQuerySorted = [...entries]
    .sort((a, b) => a.nombreRaw.localeCompare(b.nombreRaw, 'es', { sensitivity: 'base' }))
    .map((entry) => entry.f);
  return { entries, emptyQuerySorted };
}

/**
 * @param {GeoJSON.FeatureCollection} fc
 * @param {'ftth'|'corporativa'} networkRed
 */
function getOrCreateSearchIndex(fc, networkRed) {
  let byNetwork = SEARCH_INDEX_CACHE.get(fc);
  if (!byNetwork) {
    byNetwork = { ftth: null, corporativa: null };
    SEARCH_INDEX_CACHE.set(fc, byNetwork);
  }
  if (byNetwork[networkRed]) return byNetwork[networkRed];
  const fcSoloRed = filterRoutesByNetwork(fc, networkRed);
  const index = buildSearchIndex(fcSoloRed.features || []);
  byNetwork[networkRed] = index;
  return index;
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
  const index = getOrCreateSearchIndex(fc, networkRed);
  const entries = index.entries;
  if (!entries.length) return [];

  const q = normalizeSearchText(rawQuery);
  if (!q) {
    if (entries.length <= MAX_CATALOG_EMPTY_QUERY) {
      return index.emptyQuerySorted.slice(0, limit);
    }
    return [];
  }

  const words = q.split(' ').filter((w) => w.length > 0);
  const ranked = [];

  for (const entry of entries) {
    const { f, nombreNorm: nombre, idRaw, idNorm } = entry;

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

/**
 * Aíndice de búsqueda solo para `Point` (centrales / nodos) con `nombre` e `id`.
 * @param {GeoJSON.Feature[]} feats
 */
function getOrCreateCentralesSearchIndex(feats) {
  const onlyPoints = feats.filter(
    (f) => f && f.type === 'Feature' && f.geometry?.type === 'Point'
  );
  return buildSearchIndex(onlyPoints);
}

/**
 * Búsqueda de centrales o nodos por `nombre` e `id` (misma lógica que tendidos, solo puntos).
 * @param {GeoJSON.FeatureCollection} fc
 * @param {string} rawQuery
 * @param {number} limit
 * @param {'ftth'|'corporativa'} networkRed
 * @returns {GeoJSON.Feature[]}
 */
export function searchCentralesFeatures(fc, rawQuery, limit = 20, networkRed) {
  if (networkRed !== 'ftth' && networkRed !== 'corporativa') {
    return [];
  }
  let byNetwork = CENTRALES_INDEX_CACHE.get(fc);
  if (!byNetwork) {
    byNetwork = { ftth: null, corporativa: null };
    CENTRALES_INDEX_CACHE.set(fc, byNetwork);
  }
  if (!byNetwork[networkRed]) {
    /**
     * En el editor, red corporativa fusiona en capa centrales FTTH + corporativas; el buscador
     * debe indexar todos los `Point` de la colección, no solo `red_tipo=corporativa`.
     */
    const featsToIndex =
      networkRed === 'corporativa'
        ? (fc?.features || []).filter(
            (f) => f && f.type === 'Feature' && f.geometry?.type === 'Point'
          )
        : filterRoutesByNetwork(fc, networkRed).features || [];
    byNetwork[networkRed] = getOrCreateCentralesSearchIndex(featsToIndex);
  }
  const index = byNetwork[networkRed];
  const entries = index.entries;
  if (!entries.length) return [];

  const q = normalizeSearchText(rawQuery);
  if (!q) {
    if (entries.length <= MAX_CATALOG_EMPTY_QUERY) {
      return index.emptyQuerySorted.slice(0, limit);
    }
    return [];
  }

  const words = q.split(' ').filter((w) => w.length > 0);
  const ranked = [];

  for (const entry of entries) {
    const { f, nombreNorm: nombre, idRaw, idNorm } = entry;

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
    const na = String(a.f.properties?.nombre ?? a.f.properties?.name ?? '');
    const nb = String(b.f.properties?.nombre ?? b.f.properties?.name ?? '');
    return na.localeCompare(nb, 'es', { sensitivity: 'base' });
  });
  return ranked.slice(0, limit).map((x) => x.f);
}
