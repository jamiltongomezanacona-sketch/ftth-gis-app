import { lengthWithReserve20Pct } from './measurements.js';

export const MEASURE_CABLE_ALONG_SOURCE = 'measure-cable-along-fc';

const LINE_A = 'measure-cable-seg-a';
const LINE_B = 'measure-cable-seg-b';
const REF_LAYER = 'measure-cable-ref';

/**
 * @param {GeoJSON.LineString} line
 * @param {number} refDistFromStartM metros de tendido desde el primer vértice hasta la referencia
 * @param {object} turf
 * @returns {{ lenTowardStartM: number, lenTowardEndM: number, fiberTowardStartM: number, fiberTowardEndM: number, totalGeomM: number, totalFiberM: number, refCoord: [number, number] | null }}
 */
export function cableSplitLengthsFromRef(line, refDistFromStartM, turf) {
  const coords = line?.coordinates;
  if (!coords?.length || coords.length < 2) {
    return {
      lenTowardStartM: 0,
      lenTowardEndM: 0,
      fiberTowardStartM: 0,
      fiberTowardEndM: 0,
      totalGeomM: 0,
      totalFiberM: 0,
      refCoord: null
    };
  }
  const lineFeature = turf.lineString(coords);
  let lineLen = 0;
  try {
    lineLen = turf.length(lineFeature, { units: 'meters' });
  } catch {
    return {
      lenTowardStartM: 0,
      lenTowardEndM: 0,
      fiberTowardStartM: 0,
      fiberTowardEndM: 0,
      totalGeomM: 0,
      totalFiberM: 0,
      refCoord: null
    };
  }
  const d = Math.min(Math.max(0, refDistFromStartM), lineLen);
  let refPt;
  try {
    refPt = turf.along(lineFeature, d, { units: 'meters' });
  } catch {
    return {
      lenTowardStartM: 0,
      lenTowardEndM: 0,
      fiberTowardStartM: 0,
      fiberTowardEndM: 0,
      totalGeomM: lineLen,
      totalFiberM: lengthWithReserve20Pct(lineLen),
      refCoord: null
    };
  }
  const refCoord = /** @type {[number, number]} */ (refPt.geometry.coordinates);
  const startPt = turf.point(coords[0]);
  const endPt = turf.point(coords[coords.length - 1]);

  let lenA = 0;
  let lenB = 0;
  try {
    if (d > 0.05) {
      const segA = turf.lineSlice(startPt, refPt, lineFeature);
      lenA = turf.length(segA, { units: 'meters' });
    }
  } catch {
    lenA = d;
  }
  try {
    if (lineLen - d > 0.05) {
      const segB = turf.lineSlice(refPt, endPt, lineFeature);
      lenB = turf.length(segB, { units: 'meters' });
    }
  } catch {
    lenB = Math.max(0, lineLen - d);
  }

  return {
    lenTowardStartM: lenA,
    lenTowardEndM: lenB,
    fiberTowardStartM: lengthWithReserve20Pct(lenA),
    fiberTowardEndM: lengthWithReserve20Pct(lenB),
    totalGeomM: lineLen,
    totalFiberM: lengthWithReserve20Pct(lineLen),
    refCoord
  };
}

/**
 * @param {GeoJSON.LineString} line
 * @param {number} refDistFromStartM
 * @param {object} turf
 * @returns {GeoJSON.FeatureCollection}
 */
export function cableAlongMeasureFeatureCollection(line, refDistFromStartM, turf) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  const coords = line?.coordinates;
  if (!coords?.length || coords.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const lineFeature = turf.lineString(coords);
  let lineLen = 0;
  try {
    lineLen = turf.length(lineFeature, { units: 'meters' });
  } catch {
    return { type: 'FeatureCollection', features: [] };
  }
  const d = Math.min(Math.max(0, refDistFromStartM), lineLen);
  let refPt;
  try {
    refPt = turf.along(lineFeature, d, { units: 'meters' });
  } catch {
    return { type: 'FeatureCollection', features: [] };
  }
  const startPt = turf.point(coords[0]);
  const endPt = turf.point(coords[coords.length - 1]);
  try {
    if (d > 0.05) {
      const segA = turf.lineSlice(startPt, refPt, lineFeature);
      features.push({
        type: 'Feature',
        properties: { kind: 'seg_a' },
        geometry: segA.geometry
      });
    }
  } catch {
    /* */
  }
  try {
    if (lineLen - d > 0.05) {
      const segB = turf.lineSlice(refPt, endPt, lineFeature);
      features.push({
        type: 'Feature',
        properties: { kind: 'seg_b' },
        geometry: segB.geometry
      });
    }
  } catch {
    /* */
  }
  features.push({
    type: 'Feature',
    properties: { kind: 'ref' },
    geometry: { type: 'Point', coordinates: refPt.geometry.coordinates }
  });
  return { type: 'FeatureCollection', features };
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function ensureMeasureCableAlongLayers(map) {
  if (map.getSource(MEASURE_CABLE_ALONG_SOURCE)) return;

  map.addSource(MEASURE_CABLE_ALONG_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: LINE_A,
    type: 'line',
    source: MEASURE_CABLE_ALONG_SOURCE,
    filter: ['==', ['get', 'kind'], 'seg_a'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#38bdf8',
      'line-width': 4,
      'line-opacity': 0.92
    }
  });

  map.addLayer({
    id: LINE_B,
    type: 'line',
    source: MEASURE_CABLE_ALONG_SOURCE,
    filter: ['==', ['get', 'kind'], 'seg_b'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#fbbf24',
      'line-width': 4,
      'line-opacity': 0.92
    }
  });

  map.addLayer({
    id: REF_LAYER,
    type: 'circle',
    source: MEASURE_CABLE_ALONG_SOURCE,
    filter: ['==', ['get', 'kind'], 'ref'],
    paint: {
      'circle-radius': 7,
      'circle-color': '#f8fafc',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#0ea5e9'
    }
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {GeoJSON.LineString} line
 * @param {number} refDistFromStartM
 * @param {object} turf
 */
export function setCableAlongMeasureData(map, line, refDistFromStartM, turf) {
  ensureMeasureCableAlongLayers(map);
  const fc = cableAlongMeasureFeatureCollection(line, refDistFromStartM, turf);
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(MEASURE_CABLE_ALONG_SOURCE)).setData(fc);
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function clearCableAlongMeasureData(map) {
  if (!map.getSource(MEASURE_CABLE_ALONG_SOURCE)) return;
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(MEASURE_CABLE_ALONG_SOURCE)).setData({
    type: 'FeatureCollection',
    features: []
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function bringMeasureCableAlongLayersToFront(map) {
  for (const id of [REF_LAYER, LINE_B, LINE_A]) {
    try {
      if (map.getLayer(id)) map.moveLayer(id);
    } catch {
      /* */
    }
  }
}
