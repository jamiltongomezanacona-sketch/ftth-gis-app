/**
 * utils.geo.js — cálculo geoespacial puro (sin dependencia de Leaflet).
 * Requiere @turf/turf (mismo criterio que en FTTH: distancias geodésicas en WGS84).
 *
 * Uso offline: empaqueta @turf/turf en el bundle o sirve el .min.js local.
 *
 * @module utils.geo
 */

/**
 * Si la curva del OTDR devuelve **longitud de fibra** (con reserva), convierte a **metros de tendido**
 * en el mapa con el mismo criterio que en el resto de la app FTTH: tendido = fibra / 1,2.
 * @param {number} distanciaFibraKm
 * @returns {number} metros sobre el LineString
 */
export function distanciaTendidoDesdeFibraKm(distanciaFibraKm) {
  if (!Number.isFinite(distanciaFibraKm) || distanciaFibraKm < 0) return 0;
  return (distanciaFibraKm * 1000) / 1.2;
}

/**
 * Normaliza una GeoJSON a LineString.
 * @param {GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString} lineaGeoJSON
 * @returns {GeoJSON.LineString | null}
 */
function asLineString(lineaGeoJSON) {
  if (!lineaGeoJSON) return null;
  if (lineaGeoJSON.type === 'LineString' && Array.isArray(lineaGeoJSON.coordinates)) {
    return /** @type {GeoJSON.LineString} */ (lineaGeoJSON);
  }
  if (lineaGeoJSON.type === 'Feature' && lineaGeoJSON.geometry?.type === 'LineString') {
    return /** @type {GeoJSON.LineString} */ (lineaGeoJSON.geometry);
  }
  return null;
}

/**
 * Ubica el punto exacto sobre el tendido a una distancia acumulada desde el **primer vértice** (inicio de cable en GIS).
 *
 * @param {GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString} lineaGeoJSON
 * @param {number} distanciaMetros Distancia a lo largo del cable (≥ 0), e.g. 1.35 km → 1350
 * @param {import('@turf/turf').Turf} turf instancia o namespace de Turf (global en window.turf)
 * @returns {{
 *   ok: true,
 *   point: GeoJSON.Feature<GeoJSON.Point>,
 *   distanceFromStartM: number,
 *   lineLengthM: number,
 *   distanciaSolicitadaM: number,
 *   clamped: boolean
 * } | { ok: false, error: string, lineLengthM?: number }}
 */
export function calcularPuntoPorDistancia(lineaGeoJSON, distanciaMetros, turf) {
  const line = asLineString(lineaGeoJSON);
  if (!line || line.coordinates.length < 2) {
    return { ok: false, error: 'LineString inválido o con menos de 2 vértices' };
  }
  if (typeof distanciaMetros !== 'number' || !Number.isFinite(distanciaMetros) || distanciaMetros < 0) {
    return { ok: false, error: 'distanciaMetros debe ser un número ≥ 0' };
  }
  if (!turf || typeof turf.lineString !== 'function' || typeof turf.length !== 'function' || typeof turf.along !== 'function') {
    return { ok: false, error: 'Turf.js no está disponible' };
  }
  const lineFeature = turf.lineString(line.coordinates);
  let lineLengthM;
  try {
    lineLengthM = turf.length(lineFeature, { units: 'meters' });
  } catch {
    return { ok: false, error: 'No se pudo medir el tendido' };
  }
  let d = distanciaMetros;
  let clamped = false;
  if (d > lineLengthM) {
    d = lineLengthM;
    clamped = true;
  }
  if (d < 0) {
    d = 0;
    clamped = true;
  }
  let point;
  try {
    point = turf.along(lineFeature, d, { units: 'meters' });
  } catch {
    return { ok: false, error: 'Error al colocar el punto sobre el tendido', lineLengthM };
  }
  if (!point?.geometry) {
    return { ok: false, error: 'Punto nulo en along()', lineLengthM };
  }
  return {
    ok: true,
    point,
    distanceFromStartM: d,
    lineLengthM,
    distanciaSolicitadaM: distanciaMetros,
    clamped
  };
}

/**
 * Línea desde el inicio del cable hasta la distancia indicada (resaltado del "recorrido de señal").
 * @param {GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString} lineaGeoJSON
 * @param {number} distanciaMetros
 * @param {import('@turf/turf').Turf} turf
 * @returns {GeoJSON.Feature<GeoJSON.LineString> | null}
 */
export function tramoHastaDistancia(lineaGeoJSON, distanciaMetros, turf) {
  const line = asLineString(lineaGeoJSON);
  if (!line) return null;
  const r = calcularPuntoPorDistancia(line, distanciaMetros, turf);
  if (!r.ok || !r.point) return null;
  const start = turf.point(line.coordinates[0]);
  try {
    return turf.lineSlice(start, r.point, turf.lineString(line.coordinates));
  } catch {
    return null;
  }
}

/**
 * Busca el artefacto FTTH más cercano a un punto (E1, E2, NAP) entre varias capas puntuales.
 *
 * @param {GeoJSON.Feature<GeoJSON.Point> | [number, number]} punto [lng, lat] o Feature Point
 * @param {GeoJSON.FeatureCollection} capasFTTH Colección o varias: cada feature debería tener
 *   `properties.tipo` o `properties.tipo_cierre` ('E1'|'E2'|'NAP', etc.) y un nombre en `properties.nombre` o `id`
 * @param {object} [opts]
 * @param {number} [opts.umbralMetros=20] Si la distancia mínima > umbral, no se considera "en elemento"
 * @param {import('@turf/turf').Turf} opts.turf
 * @returns {{
 *   hayCercano: boolean,
 *   distanciaMinM: number,
 *   feature: GeoJSON.Feature | null,
 *   etiqueta: string,
 *   rol: 'E1' | 'E2' | 'NAP' | 'otro' | 'ninguno'
 * }}
 */
export function buscarElementoCercano(punto, capasFTTH, opts) {
  const turf = opts?.turf;
  if (!turf) {
    return { hayCercano: false, distanciaMinM: Infinity, feature: null, etiqueta: 'Sin Turf', rol: 'ninguno' };
  }
  const p =
    Array.isArray(punto) && punto.length >= 2
      ? turf.point(/** @type {[number, number]} */ ([punto[0], punto[1]]))
      : /** @type {GeoJSON.Feature<GeoJSON.Point>} */ (punto);
  if (!p?.geometry || p.geometry.type !== 'Point') {
    return { hayCercano: false, distanciaMinM: Infinity, feature: null, etiqueta: 'Punto inválido', rol: 'ninguno' };
  }
  const umbral = Number.isFinite(opts?.umbralMetros) && opts.umbralMetros > 0 ? opts.umbralMetros : 20;
  const fc = normalizarAFeatureCollection(capasFTTH);
  if (!fc?.features?.length) {
    return { hayCercano: false, distanciaMinM: Infinity, feature: null, etiqueta: 'Sin capas de elementos', rol: 'ninguno' };
  }
  let best = /** @type {{ d: number, f: GeoJSON.Feature } | null} */ (null);
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) continue;
    const q = /** @type {GeoJSON.Feature<GeoJSON.Point>} */ (f);
    let d;
    try {
      d = turf.distance(p, q, { units: 'meters' });
    } catch {
      continue;
    }
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.d) best = { d, f: q };
  }
  if (!best) {
    return { hayCercano: false, distanciaMinM: Infinity, feature: null, etiqueta: 'Capa sin puntos', rol: 'ninguno' };
  }
  const props = /** @type {Record<string, unknown>} */ (best.f.properties || {});
  const tipoRaw = String(props.tipo_cierre || props.tipo || props.categoria || '').toUpperCase();
  let rol = /** @type {'E1' | 'E2' | 'NAP' | 'otro' | 'ninguno'} */ ('otro');
  if (tipoRaw.includes('E1') || tipoRaw === '1') rol = 'E1';
  else if (tipoRaw.includes('E2') || tipoRaw === '2') rol = 'E2';
  else if (tipoRaw.includes('NAP') || tipoRaw.includes('NAP-')) rol = 'NAP';

  const nombre = String(props.nombre ?? props.label ?? props.id ?? 'elemento');
  const hayCercano = best.d <= umbral;
  const etiqueta = hayCercano
    ? `Posible falla en ${rol !== 'otro' ? `${rol} ` : ''}${nombre} (~${Math.round(best.d)} m)`
    : `Falla en tramo de cable (elemento más cercano a ${Math.round(best.d)} m)`;
  return {
    hayCercano,
    distanciaMinM: best.d,
    feature: best.f,
    etiqueta,
    rol: best.d <= umbral ? rol : 'otro'
  };
}

/**
 * Acepta FeatureCollection, array de features o objeto { e1, e2, naps } con FCollections.
 * @param {any} capas
 * @returns {GeoJSON.FeatureCollection}
 */
function normalizarAFeatureCollection(capas) {
  if (capas?.type === 'FeatureCollection' && Array.isArray(capas.features)) {
    return /** @type {GeoJSON.FeatureCollection} */ (capas);
  }
  if (Array.isArray(capas)) {
    return { type: 'FeatureCollection', features: capas };
  }
  if (capas && typeof capas === 'object') {
    const features = [];
    for (const k of Object.keys(capas)) {
      const c = capas[k];
      if (c?.type === 'FeatureCollection' && c.features) features.push(...c.features);
    }
    return { type: 'FeatureCollection', features };
  }
  return { type: 'FeatureCollection', features: [] };
}
