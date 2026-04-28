/**
 * Une tendidos conectados por vértices (misma capa / molécula) para medir fibra en cadena.
 */
import { distanceFromStartAlongLineMeters, lineLengthMeters } from './measurements.js';

/**
 * @param {GeoJSON.Geometry | null | undefined} g
 * @returns {GeoJSON.LineString | null}
 */
function resolveLineStringGeometry(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return /** @type {GeoJSON.LineString} */ (g);
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates) && g.coordinates.length) {
    /** @type {GeoJSON.Position[]} */
    const merged = [];
    for (const part of g.coordinates) {
      if (!Array.isArray(part) || part.length < 2) continue;
      const last = merged[merged.length - 1];
      const first = part[0];
      if (last && first && last[0] === first[0] && last[1] === first[1]) {
        for (let i = 1; i < part.length; i++) merged.push(part[i]);
      } else {
        for (const p of part) merged.push(p);
      }
    }
    if (merged.length >= 2) return { type: 'LineString', coordinates: merged };
  }
  return null;
}

/** @param {GeoJSON.Position[]} arr */
function dedupeConsecutiveCoords(arr) {
  /** @type {GeoJSON.Position[]} */
  const out = [];
  for (const c of arr) {
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  return out;
}

/**
 * @param {GeoJSON.Position} a
 * @param {GeoJSON.Position} b
 */
function coordsClose(a, b, tolM, turf) {
  try {
    return turf.distance(turf.point(a), turf.point(b), { units: 'meters' }) <= tolM;
  } catch {
    return false;
  }
}

/**
 * Parte un LineString en dos en la distancia acumulada desde el primer vértice (metros).
 * @param {GeoJSON.LineString} line
 * @param {number} distM
 * @param {object} turf
 */
export function splitLineStringAtDistanceFromStart(line, distM, turf) {
  const coords = line.coordinates;
  if (!coords || coords.length < 2) return null;
  const L = lineLengthMeters(line, turf);
  if (!Number.isFinite(L) || L <= 0) return null;
  if (distM <= 1e-4) {
    return {
      before: { type: 'LineString', coordinates: dedupeConsecutiveCoords([coords[0]]) },
      after: line
    };
  }
  if (distM >= L - 1e-4) {
    return {
      before: line,
      after: { type: 'LineString', coordinates: dedupeConsecutiveCoords([coords[coords.length - 1]]) }
    };
  }
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p = coords[i];
    const q = coords[i + 1];
    let segLen = 0;
    try {
      segLen = turf.distance(turf.point(p), turf.point(q), { units: 'meters' });
    } catch {
      return null;
    }
    if (!Number.isFinite(segLen)) continue;
    if (acc + segLen >= distM - 1e-4) {
      const t = Math.min(1, Math.max(0, (distM - acc) / segLen));
      const split = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
      const before = dedupeConsecutiveCoords([...coords.slice(0, i + 1), split]);
      const after = dedupeConsecutiveCoords([split, ...coords.slice(i + 1)]);
      return {
        before: { type: 'LineString', coordinates: before },
        after: { type: 'LineString', coordinates: after }
      };
    }
    acc += segLen;
  }
  return {
    before: line,
    after: { type: 'LineString', coordinates: [coords[coords.length - 1]] }
  };
}

/**
 * @param {GeoJSON.Position[]} seq
 * @param {object} turf
 */
function estimateSeqLen(seq, turf) {
  if (!seq?.length) return 0;
  let s = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    try {
      s += turf.distance(turf.point(seq[i]), turf.point(seq[i + 1]), { units: 'meters' });
    } catch {
      /* */
    }
  }
  return s;
}

/**
 * Añade coordenadas desde `tip` por segmentos no usados (vecinos en tolerancia).
 * @param {GeoJSON.Position} tip
 * @param {GeoJSON.Feature[]} features
 * @param {Set<number>} usedIndices
 * @param {object} turf
 * @param {number} tolM
 * @returns {{ coords: GeoJSON.Position[], tip: GeoJSON.Position }}
 */
function extendOpenChainFromTip(tip, features, usedIndices, turf, tolM) {
  /** @type {GeoJSON.Position[]} */
  const total = [];
  let curTip = tip;
  let guard = 0;
  while (guard++ < 1000) {
    /** @type {{ fi: number; seq: GeoJSON.Position[]; nextTip: GeoJSON.Position }[]} */
    const candidates = [];
    for (let fi = 0; fi < features.length; fi++) {
      if (usedIndices.has(fi)) continue;
      const ln = resolveLineStringGeometry(features[fi].geometry);
      if (!ln?.coordinates?.length) continue;
      const c = ln.coordinates;
      const c0 = c[0];
      const cz = c[c.length - 1];
      if (coordsClose(c0, curTip, tolM, turf)) {
        candidates.push({ fi, seq: c.slice(1), nextTip: cz });
      } else if (coordsClose(cz, curTip, tolM, turf)) {
        candidates.push({
          fi,
          seq: c.length >= 2 ? c.slice(0, -1).reverse() : [],
          nextTip: c0
        });
      }
    }
    if (!candidates.length) break;
    if (candidates.length > 1) {
      candidates.sort((a, b) => estimateSeqLen(b.seq, turf) - estimateSeqLen(a.seq, turf));
    }
    const pick = candidates[0];
    usedIndices.add(pick.fi);
    total.push(...pick.seq);
    curTip = pick.nextTip;
  }
  return { coords: total, tip: curTip };
}

/**
 * @param {GeoJSON.Feature} f
 */
function anchorFeatureFingerprint(f) {
  const ln = resolveLineStringGeometry(f?.geometry);
  if (!ln?.coordinates?.length) return '';
  const a = ln.coordinates[0];
  const z = ln.coordinates[ln.coordinates.length - 1];
  const r = (/** @type {number} */ x) => Math.round(x * 1e6) / 1e6;
  return `${ln.coordinates.length}|${r(a[0])},${r(a[1])}|${r(z[0])},${r(z[1])}`;
}

/**
 * Reduce cruces espurios en ciudades: si el ancla tiene molécula/central, prioriza mismos metadatos.
 * Las features sin molécula se mantienen para no romper datos legacy.
 * @param {GeoJSON.Feature[]} features
 * @param {GeoJSON.Feature} anchorFeature
 */
function filterFeaturesForChain(features, anchorFeature) {
  const rawMol = anchorFeature?.properties?.molecula;
  const mol =
    rawMol != null && String(rawMol).trim() !== '' ? String(rawMol).trim().toLowerCase() : '';
  if (!mol) return features;
  const rawCen = anchorFeature?.properties?.central;
  const cen =
    rawCen != null && String(rawCen).trim() !== '' ? String(rawCen).trim().toLowerCase() : '';
  const filtered = features.filter((f) => {
    const fmRaw = f?.properties?.molecula;
    const fm =
      fmRaw != null && String(fmRaw).trim() !== '' ? String(fmRaw).trim().toLowerCase() : '';
    if (!fm) return true;
    if (fm !== mol) return false;
    if (!cen) return true;
    const fcRaw = f?.properties?.central;
    const fc =
      fcRaw != null && String(fcRaw).trim() !== '' ? String(fcRaw).trim().toLowerCase() : '';
    return !fc || fc === cen;
  });
  return filtered.length ? filtered : features;
}

/**
 * @param {GeoJSON.Feature[]} features
 * @param {GeoJSON.Feature} anchorFeature
 */
function findAnchorIndex(features, anchorFeature) {
  const aid = anchorFeature?.id;
  if (aid != null && aid !== '') {
    const i = features.findIndex((f) => f?.id != null && String(f.id) === String(aid));
    if (i >= 0) return i;
  }
  const fp = anchorFeatureFingerprint(anchorFeature);
  if (fp) {
    const j = features.findIndex((f) => anchorFeatureFingerprint(f) === fp);
    if (j >= 0) return j;
  }
  return features.indexOf(anchorFeature);
}

/**
 * Construye un LineString continuo uniendo el tendido anclado con otros que comparten vértice (capa actual).
 * @param {GeoJSON.Feature[]} features Lista del layer de rutas (p. ej. molécula completa).
 * @param {GeoJSON.Feature} anchorFeature Tendido donde cayó el clic.
 * @param {number} refDistOnAnchor Distancia desde el primer vértice del ancla hasta el pin (m tendido).
 * @param {[number, number]} refLngLat Clic de referencia [lng, lat].
 * @param {object} turf
 * @param {number} [tolM] empalme en vértice (metros); más bajo = menos cruces falsos en esquinas.
 * @returns {{ merged: GeoJSON.LineString; refAlongMerged: number; chained: boolean } | null}
 */
export function mergeConnectedRouteLinesForTrazar(
  features,
  anchorFeature,
  refDistOnAnchor,
  refLngLat,
  turf,
  tolM = 1
) {
  if (!features?.length || !anchorFeature || !refLngLat?.length) return null;
  features = filterFeaturesForChain(features, anchorFeature);
  const anchorIdx = findAnchorIndex(features, anchorFeature);
  if (anchorIdx < 0) return null;
  const anchorLine = resolveLineStringGeometry(anchorFeature.geometry);
  if (!anchorLine?.coordinates?.length) return null;

  const usedIndices = new Set([anchorIdx]);
  const p0 = anchorLine.coordinates[0];
  const pn = anchorLine.coordinates[anchorLine.coordinates.length - 1];

  const extBack = extendOpenChainFromTip(p0, features, usedIndices, turf, tolM);
  const extFwd = extendOpenChainFromTip(pn, features, usedIndices, turf, tolM);

  const split = splitLineStringAtDistanceFromStart(anchorLine, refDistOnAnchor, turf);
  if (!split) return null;

  const revBack = extBack.coords.length ? [...extBack.coords].reverse() : [];
  const backwardPart = dedupeConsecutiveCoords([...revBack, ...split.before.coordinates]);
  const forwardPart = dedupeConsecutiveCoords([...split.after.coordinates, ...extFwd.coords]);

  if (backwardPart.length < 1 || forwardPart.length < 1) return null;

  const fullCoords = dedupeConsecutiveCoords([...backwardPart, ...forwardPart.slice(1)]);
  if (fullCoords.length < 2) return null;

  const merged = /** @type {GeoJSON.LineString} */ ({
    type: 'LineString',
    coordinates: fullCoords
  });

  let refAlongMerged = 0;
  try {
    refAlongMerged = distanceFromStartAlongLineMeters(merged, refLngLat, turf);
  } catch {
    refAlongMerged = lineLengthMeters(
      { type: 'LineString', coordinates: backwardPart },
      turf
    );
  }
  if (!Number.isFinite(refAlongMerged) || refAlongMerged < 0) return null;

  const chained = extBack.coords.length > 0 || extFwd.coords.length > 0;
  return { merged, refAlongMerged, chained };
}
