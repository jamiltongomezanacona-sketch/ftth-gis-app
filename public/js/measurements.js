/**
 * Longitud geodésica de un LineString en metros (WGS84).
 * @param {GeoJSON.LineString} line
 * @param {object} turf espacio de nombres `window.turf`
 */
export function lineLengthMeters(line, turf) {
  if (!line?.coordinates?.length) return 0;
  return turf.length(line, { units: 'meters' });
}

/** Factor fibra / tendido geométrico (misma convención que +20 % reserva). */
export const FIBER_RESERVE_FACTOR = 1.2;

/** Longitud de tendido + 20 % de reserva (fibra). */
export function lengthWithReserve20Pct(lengthM) {
  return lengthM * FIBER_RESERVE_FACTOR;
}

/**
 * Lectura OTDR o metros de **fibra** (incl. criterio +20 %) → metros a recorrer por el **tendido geométrico** del mapa.
 * Convención: fibra_pedida = tendido_geom × 1,2 ⇒ tendido_geom = fibra / 1,2.
 * @param {number} fiberMeters
 */
export function geometricLengthFromFiberLengthMeters(fiberMeters) {
  if (!Number.isFinite(fiberMeters) || fiberMeters < 0) return 0;
  return fiberMeters / FIBER_RESERVE_FACTOR;
}

/**
 * Punto sobre la polilínea a una distancia acumulada desde el primer vértice (metros, por tendido).
 * @param {GeoJSON.LineString} line
 * @param {number} distanceMetersFromStart
 * @param {object} turf
 * @returns {GeoJSON.Feature<GeoJSON.Point> | null}
 */
/**
 * Metros desde el inicio del LineString hasta el punto proyectado, según `nearestPointOnLine`.
 * Alinea cálculo con `along`/`length` y evita desajustes frente a `lineSlice` en algunos casos.
 * @param {GeoJSON.Feature<GeoJSON.Point>} snapped resultado de nearestPointOnLine
 * @returns {number | null}
 */
function metersAlongLineFromSnapped(snapped) {
  const ld = snapped?.properties?.lineDistance;
  if (typeof ld === 'number' && Number.isFinite(ld) && ld >= 0) return ld;
  const loc = snapped?.properties?.location;
  if (typeof loc === 'number' && Number.isFinite(loc) && loc >= 0) return loc;
  return null;
}

export function pointAlongLineAtGeometricDistance(line, distanceMetersFromStart, turf) {
  if (!line?.coordinates?.length) return null;
  const lineFeature = turf.lineString(line.coordinates);
  let len;
  try {
    len = turf.length(lineFeature, { units: 'meters' });
  } catch {
    return null;
  }
  const d = Math.min(Math.max(0, distanceMetersFromStart), len);
  try {
    return turf.along(lineFeature, d, { units: 'meters' });
  } catch {
    return null;
  }
}

/**
 * Punto de corte a partir de lectura OTDR en metros de **fibra** desde inicio o desde final (÷ 1,2 → tendido).
 * @param {'start'|'end'} from
 */
export function cutPointFromOtdrFiberMeters(line, fiberMetersFromRef, from, turf) {
  const lineLen = lineLengthMeters(line, turf);
  const geomAlong = geometricLengthFromFiberLengthMeters(fiberMetersFromRef);
  let distFromStart = from === 'start' ? geomAlong : lineLen - geomAlong;
  let clamped = false;
  if (distFromStart < 0) {
    distFromStart = 0;
    clamped = true;
  }
  if (distFromStart > lineLen) {
    distFromStart = lineLen;
    clamped = true;
  }
  /** Metros por tendido desde el punto de referencia (inicio o final) hasta el corte, tras clamp. */
  const geometricFromRefM =
    from === 'start' ? distFromStart : lineLen - distFromStart;
  const pt = pointAlongLineAtGeometricDistance(line, distFromStart, turf);
  if (!pt) {
    return {
      point: null,
      lineLengthM: lineLen,
      fiberReadingM: fiberMetersFromRef,
      geometricFromRefM,
      distanceFromStartAlongLineM: distFromStart,
      clamped
    };
  }
  return {
    point: pt,
    lineLengthM: lineLen,
    fiberReadingM: fiberMetersFromRef,
    geometricFromRefM,
    distanceFromStartAlongLineM: distFromStart,
    clamped
  };
}

/**
 * Punto de corte: fibra OTDR desde un punto de referencia ya situado en el tendido (m desde inicio),
 * avanzando hacia el final o hacia el inicio del cable.
 * @param {'toward_end'|'toward_start'} direction
 */
export function cutPointFromFiberFromClickRef(
  line,
  refDistFromStartM,
  fiberMeters,
  direction,
  turf
) {
  const lineLen = lineLengthMeters(line, turf);
  const delta = geometricLengthFromFiberLengthMeters(fiberMeters);
  const sign = direction === 'toward_end' ? 1 : -1;
  let distFromStart = refDistFromStartM + sign * delta;
  let clamped = false;
  if (distFromStart < 0) {
    distFromStart = 0;
    clamped = true;
  }
  if (distFromStart > lineLen) {
    distFromStart = lineLen;
    clamped = true;
  }
  const pt = pointAlongLineAtGeometricDistance(line, distFromStart, turf);
  const geometricFromRefM = Math.abs(distFromStart - refDistFromStartM);
  if (!pt) {
    return {
      point: null,
      lineLengthM: lineLen,
      fiberReadingM: fiberMeters,
      geometricFromRefM,
      distanceFromStartAlongLineM: distFromStart,
      refDistFromStartM,
      clamped
    };
  }
  return {
    point: pt,
    lineLengthM: lineLen,
    fiberReadingM: fiberMeters,
    geometricFromRefM,
    distanceFromStartAlongLineM: distFromStart,
    refDistFromStartM,
    clamped
  };
}

/**
 * Distancia desde el primer vértice hasta el punto más cercano sobre la línea (metros).
 * @param {GeoJSON.LineString} line
 * @param {[number, number]} lngLat [lng, lat]
 * @param {object} turf espacio de nombres `window.turf`
 */
export function distanceFromStartAlongLineMeters(line, lngLat, turf) {
  const pt = turf.point(lngLat);
  const lineFeature = turf.lineString(line.coordinates);
  const snapped = turf.nearestPointOnLine(lineFeature, pt, { units: 'meters' });
  const along = metersAlongLineFromSnapped(snapped);
  if (along != null) return along;
  const start = turf.point(line.coordinates[0]);
  const slice = turf.lineSlice(start, snapped, lineFeature);
  return turf.length(slice, { units: 'meters' });
}

/**
 * Distancia por el cable desde el último vértice hasta la proyección del clic (metros).
 * @param {GeoJSON.LineString} line
 * @param {[number, number]} lngLat [lng, lat]
 * @param {object} turf
 */
export function distanceFromEndAlongLineMeters(line, lngLat, turf) {
  const pt = turf.point(lngLat);
  const lineFeature = turf.lineString(line.coordinates);
  const snapped = turf.nearestPointOnLine(lineFeature, pt, { units: 'meters' });
  const along = metersAlongLineFromSnapped(snapped);
  if (along != null) {
    const lineLen = turf.length(lineFeature, { units: 'meters' });
    return Math.max(0, lineLen - along);
  }
  const end = turf.point(line.coordinates[line.coordinates.length - 1]);
  const slice = turf.lineSlice(snapped, end, lineFeature);
  return turf.length(slice, { units: 'meters' });
}

/**
 * Distancia geodésica en línea recta desde el primer vértice de la ruta hasta un punto cualquiera (metros).
 * @param {GeoJSON.LineString} line
 * @param {[number, number]} lngLat [lng, lat]
 * @param {object} turf
 */
export function geodesicDistanceFromStartToPointMeters(line, lngLat, turf) {
  const a = turf.point(line.coordinates[0]);
  const b = turf.point(lngLat);
  return turf.distance(a, b, { units: 'meters' });
}

/**
 * Distancia geodésica en línea recta desde el último vértice hasta el clic (metros).
 * @param {GeoJSON.LineString} line
 * @param {[number, number]} lngLat [lng, lat]
 * @param {object} turf
 */
export function geodesicDistanceFromEndToPointMeters(line, lngLat, turf) {
  const a = turf.point(line.coordinates[line.coordinates.length - 1]);
  const b = turf.point(lngLat);
  return turf.distance(a, b, { units: 'meters' });
}

/**
 * Proyección del clic sobre la polilínea (punto del cable más cercano).
 * @param {GeoJSON.LineString} line
 * @param {[number, number]} lngLat [lng, lat]
 * @returns {[number, number]}
 */
export function snapLngLatToLine(line, lngLat, turf) {
  const pt = turf.point(lngLat);
  const lineFeature = turf.lineString(line.coordinates);
  const snapped = turf.nearestPointOnLine(lineFeature, pt, { units: 'meters' });
  return /** @type {[number, number]} */ (snapped.geometry.coordinates);
}

/**
 * Distancia en línea recta (metros) desde un punto WGS84 a la central ETB más cercana.
 * @param {[number, number]} lngLatPoint [lng, lat]
 * @param {GeoJSON.FeatureCollection} fcCent colección de Point
 * @param {object} turf
 * @returns {{ meters: number, nombre: string } | null}
 */
export function nearestCentralMeters(lngLatPoint, fcCent, turf) {
  const full = nearestCentralPoint(lngLatPoint, fcCent, turf);
  if (!full) return null;
  return { meters: full.meters, nombre: full.nombre };
}

/**
 * Central o nodo más cercano (aire) a un punto, con coordenadas para proyectar al tendido.
 * @param {[number, number]} lngLatPoint
 * @param {GeoJSON.FeatureCollection} fcCent
 * @param {object} turf
 * @returns {{ meters: number, nombre: string, coordinates: [number, number] } | null}
 */
export function nearestCentralPoint(lngLatPoint, fcCent, turf) {
  const feats = fcCent?.features?.filter(
    (f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
  );
  if (!feats?.length) return null;
  const target = turf.point(lngLatPoint);
  let best = /** @type {{ meters: number, nombre: string, coordinates: [number, number] } | null} */ (
    null
  );
  for (const f of feats) {
    const c = /** @type {[number, number]} */ (f.geometry.coordinates);
    const d = turf.distance(target, turf.point(c), { units: 'meters' });
    const nombre = String(
      f.properties?.nombre ?? f.properties?.name ?? 'Central'
    ).trim();
    if (!best || d < best.meters) {
      best = { meters: d, nombre: nombre || 'Central', coordinates: c };
    }
  }
  return best;
}
