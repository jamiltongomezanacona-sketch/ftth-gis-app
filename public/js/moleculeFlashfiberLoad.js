import { inferMoleculeBasePath, flashfiberAssetUrl } from './flashfiberManifest.js';

/**
 * Desde `molecula_codigo` tipo CENTRAL|MOL (ej. SANTA_INES|SI26).
 * @param {string} codigo
 * @returns {{ central: string, molecula: string } | null}
 */
export function parseMoleculaCodigo(codigo) {
  const parts = String(codigo ?? '')
    .split('|')
    .map((s) => s.trim());
  if (parts.length >= 2 && parts[1]) {
    return { central: parts[0] || '', molecula: parts[1] };
  }
  return null;
}

/**
 * Desde `nombre` tipo `CENTRAL|MOL|…` o desde `properties.molecula`.
 * @param {GeoJSON.Feature} f
 * @returns {{ central: string, molecula: string } | null}
 */
export function parseMoleculeCentralFromRouteFeature(f) {
  const nom = String(f?.properties?.nombre ?? '');
  const parts = nom.split('|').map((s) => s.trim());
  if (parts.length >= 2 && parts[1]) {
    return { central: parts[0] || '', molecula: parts[1] };
  }
  const mol = f?.properties?.molecula;
  if (mol != null && String(mol).trim() !== '') {
    return {
      central: String(f.properties?.central ?? '').trim(),
      molecula: String(mol).trim()
    };
  }
  return null;
}

/**
 * @param {string} nombre
 * @param {string} molecula
 * @param {string} [central]
 */
export function routeNombreMatchesMolecule(nombre, molecula, central) {
  const mol = String(molecula ?? '').trim();
  if (!mol) return false;
  const parts = String(nombre ?? '')
    .split('|')
    .map((s) => s.trim());
  if (parts.length >= 2) {
    if (parts[1].toLowerCase() !== mol.toLowerCase()) return false;
    if (central && String(central).trim()) {
      if (parts[0].toLowerCase() !== String(central).trim().toLowerCase()) return false;
    }
    return true;
  }
  return false;
}

/**
 * Tendidos (LineString) de `allRoutesFc` que pertenecen a la molécula.
 * @param {GeoJSON.FeatureCollection} fc
 * @param {string} molecula
 * @param {string} [central]
 * @returns {GeoJSON.FeatureCollection}
 */
export function filterRouteLinesByMolecule(fc, molecula, central) {
  const mol = String(molecula ?? '').trim();
  const cen = central != null ? String(central).trim() : '';
  const features = [];
  for (const f of fc?.features || []) {
    if (!f || f.type !== 'Feature' || f.geometry?.type !== 'LineString') continue;
    const pMol = f.properties?.molecula != null ? String(f.properties.molecula).trim() : '';
    if (pMol && pMol.toLowerCase() === mol.toLowerCase()) {
      if (!cen || String(f.properties?.central ?? '').trim().toLowerCase() === cen.toLowerCase()) {
        features.push(f);
      }
      continue;
    }
    const nom = String(f.properties?.nombre ?? '');
    if (routeNombreMatchesMolecule(nom, mol, cen)) features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Infiere E1/E2/E0 desde el prefijo del nombre (p. ej. `E1SI22-G2`) cuando `tipo` en datos viene vacío o inconsistente.
 * Evita `E10…` clasificándose como E1: tras "E1" no debe seguir un dígito.
 * @param {unknown} nomRaw
 * @returns {'' | 'E1' | 'E2' | 'E0'}
 */
export function inferTipoCierreFromNombre(nomRaw) {
  const s = String(nomRaw ?? '').trim();
  if (!s) return '';
  if (/^E1(?!\d)/i.test(s)) return 'E1';
  if (/^E2(?!\d)/i.test(s)) return 'E2';
  if (/^E0(?!\d)/i.test(s)) return 'E0';
  return '';
}

/**
 * Tipo de cierre efectivo para mapa y búsqueda: columna `tipo` si es E0/E1/E2; si no, heurística por `nombre`/`name`.
 * @param {Record<string, unknown> | null | undefined} props
 * @returns {'' | 'E1' | 'E2' | 'E0'}
 */
export function effectiveCierreTipo(props) {
  if (!props || typeof props !== 'object') return '';
  const raw = String(
    /** @type {Record<string, unknown>} */ (props).tipo ??
      /** @type {Record<string, unknown>} */ (props).Tipo ??
      /** @type {Record<string, unknown>} */ (props).TIPO ??
      ''
  )
    .trim()
    .toUpperCase();
  if (raw === 'E1' || raw === 'E2' || raw === 'E0') return raw;
  return inferTipoCierreFromNombre(
    /** @type {Record<string, unknown>} */ (props).nombre ?? /** @type {Record<string, unknown>} */ (props).name
  );
}

/**
 * Clasificación visual para el mapa FTTH (todas las moléculas): tipo efectivo E0/E1/E2 + NAP por columna o nombre.
 * @param {unknown} props
 */
function overlayKindFromProps(props) {
  const p = props && typeof props === 'object' ? /** @type {Record<string, unknown>} */ (props) : {};
  const tipoEff = effectiveCierreTipo(p);
  const name = String(p.name ?? p.nombre ?? '');
  const tipoRaw = String(p.tipo ?? p.Tipo ?? p.TIPO ?? '')
    .trim()
    .toUpperCase();

  if (tipoEff === 'E1') return 'cierre_e1';
  if (tipoEff === 'E2') return 'cierre_e2';
  if (tipoEff === 'E0') return 'cierre_e0';
  if (tipoRaw.includes('NAP') || /\bNAP\b/i.test(name)) return 'nap';
  return 'cierre_otro';
}

/**
 * @param {GeoJSON.Feature} f
 * @returns {Omit<GeoJSON.Feature, 'id'> | null}
 */
function pointFeatureForOverlay(f) {
  const g = f?.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
  const lng = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const nombre = String(f.properties?.name ?? f.properties?.nombre ?? 'Punto').trim();
  const tipoEff = effectiveCierreTipo(f.properties);
  const base =
    f.properties && typeof f.properties === 'object'
      ? /** @type {Record<string, unknown>} */ ({ ...f.properties })
      : {};
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      ...base,
      nombre: String(base.nombre ?? base.name ?? nombre).trim() || nombre,
      name: String(base.name ?? base.nombre ?? nombre).trim() || nombre,
      tipo: tipoEff || String(base.tipo ?? '').trim(),
      ftth_overlay_kind: overlayKindFromProps(f.properties)
    }
  };
}

/**
 * @param {string} url
 * @returns {Promise<Omit<GeoJSON.Feature, 'id'>[]>}
 */
async function fetchPointFeaturesFromGeojsonUrl(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const gj = await res.json();
    const out = [];
    for (const f of gj?.features || []) {
      const g = f?.geometry;
      if (g?.type === 'Point') {
        const pf = pointFeatureForOverlay(f);
        if (pf) out.push(pf);
      } else if (g?.type === 'MultiPoint' && Array.isArray(g.coordinates)) {
        for (const c of g.coordinates) {
          if (!Array.isArray(c) || c.length < 2) continue;
          const pf = pointFeatureForOverlay({ ...f, geometry: { type: 'Point', coordinates: c } });
          if (pf) out.push(pf);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Cierres / NAPs desde GeoJSON servidos bajo `/geojson/ftth/`.
 * @param {string} ftthRootUrl ej. `${location.origin}/geojson/ftth/`
 * @param {string[]} manifestPaths rutas del manifiesto
 */
export async function loadMoleculeAuxiliaryPoints(ftthRootUrl, manifestPaths) {
  const paths = Array.isArray(manifestPaths) ? manifestPaths : [];
  const tried = new Set();
  const merged = [];
  let nextId = 1;

  async function pull(rel) {
    const r = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!r || tried.has(r)) return;
    tried.add(r);
    const low = r.toLowerCase();
    if (!low.includes('/cierres/') && !low.includes('/naps/')) return;
    const url = flashfiberAssetUrl(ftthRootUrl, r);
    const pts = await fetchPointFeaturesFromGeojsonUrl(url);
    for (const pf of pts) {
      merged.push({ ...pf, id: nextId++ });
    }
  }

  for (const rel of paths) {
    await pull(rel);
  }

  const base = inferMoleculeBasePath(paths);
  if (base) {
    await pull(`${base}/naps/naps.geojson`);
    await pull(`${base}/naps.geojson`);
  }

  return merged;
}

/**
 * Une puntos GeoJSON (Flashfiber) y cierres API evitando duplicados cercanos (misma posición + nombre).
 * @param {Omit<GeoJSON.Feature, 'id'>[]} geoPts
 * @param {Omit<GeoJSON.Feature, 'id'>[]} dbPts
 * @returns {Omit<GeoJSON.Feature, 'id'>[]}
 */
export function mergeMoleculeOverlayFeatures(geoPts, dbPts) {
  const keyOf = (f) => {
    const c = f?.geometry?.coordinates;
    const n = String(f?.properties?.nombre ?? f?.properties?.name ?? '');
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        return `${lng.toFixed(6)}|${lat.toFixed(6)}|${n}`;
      }
    }
    return `nom|${n}`;
  };
  const seen = new Set();
  /** @type {Omit<GeoJSON.Feature, 'id'>[]} */
  const out = [];
  for (const f of [...geoPts, ...dbPts]) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  let id = 1;
  return out.map((f) => ({ ...f, id: id++ }));
}

/**
 * Cierres desde `/api/cierres` (tabla PostgreSQL).
 * @param {{ listCierresPorMolecula?: (c: string, m: string) => Promise<GeoJSON.FeatureCollection> }} api
 */
export async function loadCierresFromApi(api, central, molecula) {
  if (!api || typeof api.listCierresPorMolecula !== 'function') return [];
  const cen = String(central ?? '').trim();
  const mol = String(molecula ?? '').trim();
  if (!cen || !mol) return [];
  try {
    const fc = await api.listCierresPorMolecula(cen, mol);
    const merged = [];
    let nextId = 1;
    for (const f of fc?.features || []) {
      const pf = pointFeatureForOverlay(f);
      if (pf) merged.push({ ...pf, id: nextId++ });
    }
    return merged;
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.warn('[cierres API]', msg);
    if (/\b404\b/i.test(msg)) {
      console.warn(
        '[cierres API] 404: el origen actual no tiene la API Node. Abre la app con el servidor del proyecto (npm start en ftth-gis-app), no solo un servidor estático de la carpeta public/. Si el puerto 3000 estaba ocupado, mira la consola del servidor: puede estar en 3001 u otro.'
      );
    }
    return [];
  }
}

/**
 * GeoJSON Flashfiber (`/geojson/ftth/`) + cierres PostgreSQL para una molécula.
 * Misma regla de iconos E1/E2/… que para cualquier otra molécula FTTH del proyecto.
 * @param {{ listCierresPorMolecula?: (c: string, m: string) => Promise<GeoJSON.FeatureCollection> }} api
 * @param {string} ftthRootUrl
 * @param {string} central
 * @param {string} molecula
 * @param {string[]} manifestPaths
 * @param {string} appNetwork
 */
export async function loadMoleculeOverlayPointsCombined(
  api,
  ftthRootUrl,
  central,
  molecula,
  manifestPaths,
  appNetwork
) {
  const paths = Array.isArray(manifestPaths) ? manifestPaths : [];
  const ptsGeo = await loadMoleculeAuxiliaryPoints(ftthRootUrl, paths);
  const ptsDb =
    appNetwork === 'ftth'
      ? await loadCierresFromApi(api, central, molecula)
      : [];
  return mergeMoleculeOverlayFeatures(ptsGeo, ptsDb);
}
