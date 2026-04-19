import { snapLngLatToLine } from './measurements.js';

/**
 * @param {string} nomRaw
 * @param {GeoJSON.Feature[]} routes
 * @returns {GeoJSON.Feature | null}
 */
function findRouteByNombreTendido(nomRaw, routes) {
  const t = String(nomRaw ?? '').trim();
  if (!t) return null;
  const tLower = t.toLowerCase();
  for (const f of routes) {
    const n = String(f.properties?.nombre ?? '').trim();
    if (n && n.toLowerCase() === tLower) return f;
  }
  const parts = t.split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const pref = `${parts[0]}|${parts[1]}`.toLowerCase();
    for (const f of routes) {
      const n = String(f.properties?.nombre ?? '').trim().toLowerCase();
      if (n.startsWith(pref)) return f;
    }
  }
  return null;
}

/**
 * Tendido LineString más cercano al punto (metros), o null si ninguno ≤ `maxMeters`.
 * @param {[number, number]} lngLat
 * @param {GeoJSON.Feature[]} routeLineFeatures
 * @param {object} turf
 * @param {number} maxMeters
 * @returns {GeoJSON.LineString | null}
 */
function nearestLineAmongRoutes(lngLat, routeLineFeatures, turf, maxMeters) {
  const cap = Number(maxMeters);
  if (!Number.isFinite(cap) || cap <= 0 || !turf?.point || !turf?.lineString || !turf?.nearestPointOnLine) {
    return null;
  }
  const pt = turf.point(lngLat);
  let bestLine = /** @type {GeoJSON.LineString | null} */ (null);
  let bestD = Infinity;
  for (const rf of routeLineFeatures) {
    const ln =
      rf?.geometry?.type === 'LineString' && Array.isArray(rf.geometry.coordinates)
        ? /** @type {GeoJSON.LineString} */ (rf.geometry)
        : null;
    if (!ln?.coordinates?.length) continue;
    try {
      const lf = turf.lineString(ln.coordinates);
      const sn = turf.nearestPointOnLine(lf, pt, { units: 'meters' });
      const d = turf.distance(pt, sn, { units: 'meters' });
      if (d < bestD) {
        bestD = d;
        bestLine = ln;
      }
    } catch {
      /* */
    }
  }
  if (bestLine && bestD <= cap) return bestLine;
  return null;
}

/**
 * Mueve cada punto de evento al **cable más cercano** del catálogo (misma red):
 * 1) `ruta_id` → ese tendido; 2) `nombre_tendido` → nombre o prefijo `CENTRAL|MOL`;
 * 3) si no, el LineString más cercano si está dentro de `maxSnapMeters`.
 *
 * @param {GeoJSON.FeatureCollection} fcEvents
 * @param {GeoJSON.FeatureCollection} fcRoutes rutas ya filtradas por red activa
 * @param {object} turf `window.turf`
 * @param {number} [maxSnapMeters] solo para el fallback «cable más cercano» (p. ej. 400)
 * @returns {GeoJSON.FeatureCollection}
 */
export function snapEventPointsToRouteCatalog(fcEvents, fcRoutes, turf, maxSnapMeters = 400) {
  if (!fcEvents?.features?.length || !turf?.nearestPointOnLine || !turf?.point || !turf?.lineString) {
    return fcEvents;
  }
  const maxM = Number(maxSnapMeters);
  const cap = Number.isFinite(maxM) && maxM > 0 ? maxM : 400;

  const routes = (fcRoutes?.features || []).filter(
    (f) =>
      f &&
      f.type === 'Feature' &&
      f.geometry?.type === 'LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2
  );
  if (!routes.length) return fcEvents;

  /** @type {Map<number, GeoJSON.Feature>} */
  const byId = new Map();
  for (const f of routes) {
    const id = f.id != null ? Number(f.id) : NaN;
    if (Number.isInteger(id) && id > 0) byId.set(id, f);
  }

  const features = fcEvents.features.map((f) => {
    if (!f || f.type !== 'Feature' || f.geometry?.type !== 'Point') return f;
    const coords = f.geometry.coordinates;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return f;
    const lngLat = /** @type {[number, number]} */ ([lng, lat]);
    const p = /** @type {Record<string, unknown>} */ ({ ...(f.properties || {}) });
    const rutaId = p.ruta_id != null ? Number(p.ruta_id) : NaN;

    /** @type {GeoJSON.LineString | null} */
    let line = null;

    if (Number.isInteger(rutaId) && rutaId > 0) {
      const rf = byId.get(rutaId);
      if (rf?.geometry?.type === 'LineString') {
        line = /** @type {GeoJSON.LineString} */ (rf.geometry);
      }
    }
    if (!line && p.nombre_tendido) {
      const rf = findRouteByNombreTendido(String(p.nombre_tendido), routes);
      if (rf?.geometry?.type === 'LineString') {
        line = /** @type {GeoJSON.LineString} */ (rf.geometry);
      }
    }
    if (!line) {
      line = nearestLineAmongRoutes(lngLat, routes, turf, cap);
    }

    if (!line) return f;

    try {
      const snapped = snapLngLatToLine(line, lngLat, turf);
      return {
        ...f,
        geometry: { type: 'Point', coordinates: snapped },
        properties: {
          ...p,
          lng: snapped[0],
          lat: snapped[1]
        }
      };
    } catch {
      return f;
    }
  });

  return { type: 'FeatureCollection', features };
}

/** Iconos chapas E1/E2 en overlay de molécula (`ftth_overlay_kind`): al cable de la vista actual. */
const OVERLAY_E1E2_KINDS = new Set(['cierre_e1', 'cierre_e2']);

/**
 * @param {GeoJSON.FeatureCollection} fcOverlay puntos con `ftth_overlay_kind` (molécula / Flashfiber)
 * @param {GeoJSON.FeatureCollection} fcRoutes tendidos de la molécula (`filterRouteLinesByMolecule` + red FTTH)
 * @param {object} turf `window.turf`
 * @param {number} [maxSnapMeters] p. ej. 380 (cierres suelen estar más cerca del cable que GPS suelto)
 * @returns {GeoJSON.FeatureCollection}
 */
export function snapOverlayE1E2PointsToRoutes(fcOverlay, fcRoutes, turf, maxSnapMeters = 380) {
  if (!fcOverlay?.features?.length || !turf?.nearestPointOnLine) {
    return fcOverlay;
  }
  const maxM = Number(maxSnapMeters);
  const cap = Number.isFinite(maxM) && maxM > 0 ? maxM : 380;

  const routes = (fcRoutes?.features || []).filter(
    (f) =>
      f &&
      f.type === 'Feature' &&
      f.geometry?.type === 'LineString' &&
      Array.isArray(f.geometry.coordinates) &&
      f.geometry.coordinates.length >= 2
  );
  if (!routes.length) return fcOverlay;

  const features = fcOverlay.features.map((f) => {
    if (!f || f.type !== 'Feature' || f.geometry?.type !== 'Point') return f;
    const kind = String(f.properties?.ftth_overlay_kind ?? '');
    if (!OVERLAY_E1E2_KINDS.has(kind)) return f;
    const coords = f.geometry.coordinates;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return f;
    const lngLat = /** @type {[number, number]} */ ([lng, lat]);
    const line = nearestLineAmongRoutes(lngLat, routes, turf, cap);
    if (!line) return f;
    try {
      const snapped = snapLngLatToLine(line, lngLat, turf);
      return {
        ...f,
        geometry: { type: 'Point', coordinates: snapped },
        properties: { ...(f.properties || {}) }
      };
    } catch {
      return f;
    }
  });

  return { type: 'FeatureCollection', features };
}
