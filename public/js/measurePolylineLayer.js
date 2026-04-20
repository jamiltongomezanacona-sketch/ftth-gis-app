import {
  DEVICE_LABEL_LAYER_MIN_ZOOM,
  deviceLabelCollisionLayout,
  deviceLabelTextFieldFromProp,
  deviceLabelTextOpacityPaint,
  deviceLabelTextSizeLayout
} from './mapLabelZoom.js';

/** @type {string} */
export const MEASURE_POLY_SOURCE = 'measure-polyline-fc';

const LINE_LAYER = 'measure-polyline-line';
const VERTEX_LAYER = 'measure-polyline-vertices';
const LABEL_LAYER = 'measure-polyline-labels';

/**
 * @param {number} m
 */
export function fmtSegmentLabel(m) {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/**
 * @param {number} m
 */
export function fmtTotalHuman(m) {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

/**
 * @param {[number, number][]} coords
 * @param {object} turf
 * @returns {GeoJSON.FeatureCollection}
 */
export function measurePolylineFeatureCollection(coords, turf) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  if (coords.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'line' },
      geometry: { type: 'LineString', coordinates: coords }
    });
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      let d = 0;
      try {
        d = turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
      } catch {
        d = 0;
      }
      let mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      try {
        const mp = turf.midpoint(turf.point(a), turf.point(b));
        if (mp?.geometry?.coordinates) mid = mp.geometry.coordinates;
      } catch {
        /* */
      }
      features.push({
        type: 'Feature',
        properties: { kind: 'label', text: fmtSegmentLabel(d) },
        geometry: { type: 'Point', coordinates: mid }
      });
    }
  }
  for (const c of coords) {
    features.push({
      type: 'Feature',
      properties: { kind: 'vertex' },
      geometry: { type: 'Point', coordinates: c }
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * @param {GeoJSON.LineString} line
 * @param {object} turf
 */
export function lineLengthMetersSafe(line, turf) {
  if (!line?.coordinates?.length || line.coordinates.length < 2) return 0;
  try {
    return turf.length(turf.lineString(line.coordinates), { units: 'meters' });
  } catch {
    return 0;
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function ensureMeasurePolylineLayers(map) {
  if (map.getSource(MEASURE_POLY_SOURCE)) return;

  map.addSource(MEASURE_POLY_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: MEASURE_POLY_SOURCE,
    filter: ['==', ['get', 'kind'], 'line'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#f97316',
      'line-width': 3,
      'line-opacity': 0.96,
      'line-blur': 0.08
    }
  });

  map.addLayer({
    id: VERTEX_LAYER,
    type: 'circle',
    source: MEASURE_POLY_SOURCE,
    filter: ['==', ['get', 'kind'], 'vertex'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#7c2d12',
      'circle-stroke-width': 2.25,
      'circle-stroke-color': '#fb923c'
    }
  });

  map.addLayer({
    id: LABEL_LAYER,
    type: 'symbol',
    source: MEASURE_POLY_SOURCE,
    minzoom: DEVICE_LABEL_LAYER_MIN_ZOOM,
    filter: ['==', ['get', 'kind'], 'label'],
    layout: {
      'text-field': deviceLabelTextFieldFromProp('text'),
      ...deviceLabelCollisionLayout(),
      'text-size': deviceLabelTextSizeLayout(18, 12),
      'text-anchor': 'center',
      'text-offset': [0, -0.9]
    },
    paint: {
      ...deviceLabelTextOpacityPaint(),
      'text-color': '#9a3412',
      'text-halo-color': 'rgba(255,255,255,0.94)',
      'text-halo-width': 2
    }
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {[number, number][]} coords
 * @param {object} turf
 */
export function setMeasurePolylineData(map, coords, turf) {
  ensureMeasurePolylineLayers(map);
  const fc = measurePolylineFeatureCollection(coords, turf);
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(MEASURE_POLY_SOURCE)).setData(fc);
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function clearMeasurePolylineData(map) {
  if (!map.getSource(MEASURE_POLY_SOURCE)) return;
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(MEASURE_POLY_SOURCE)).setData({
    type: 'FeatureCollection',
    features: []
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function removeMeasurePolylineLayers(map) {
  for (const id of [LABEL_LAYER, VERTEX_LAYER, LINE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(MEASURE_POLY_SOURCE)) map.removeSource(MEASURE_POLY_SOURCE);
}
