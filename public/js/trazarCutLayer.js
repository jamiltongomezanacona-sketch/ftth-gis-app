/** Fuente GeoJSON para el punto de corte OTDR / Trazar. */
export const TRAZAR_CUT_SOURCE_ID = 'editor-trazar-cut-fc';
const TRAZAR_CUT_LAYER = 'editor-trazar-cut-circle';

/**
 * @param {import('mapbox-gl').Map} map
 */
export function ensureTrazarCutLayers(map) {
  if (map.getSource(TRAZAR_CUT_SOURCE_ID)) return;
  map.addSource(TRAZAR_CUT_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: TRAZAR_CUT_LAYER,
    type: 'circle',
    source: TRAZAR_CUT_SOURCE_ID,
    paint: {
      'circle-radius': 11,
      'circle-color': '#34d399',
      'circle-opacity': 0.95,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ecfdf5'
    }
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {[number, number]} lngLat
 */
export function setTrazarCutMarker(map, lngLat) {
  ensureTrazarCutLayers(map);
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(TRAZAR_CUT_SOURCE_ID)).setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: lngLat }
      }
    ]
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function clearTrazarCutMarker(map) {
  if (!map.getSource(TRAZAR_CUT_SOURCE_ID)) return;
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource(TRAZAR_CUT_SOURCE_ID)).setData({
    type: 'FeatureCollection',
    features: []
  });
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function bringTrazarCutLayerToFront(map) {
  try {
    if (map.getLayer(TRAZAR_CUT_LAYER)) map.moveLayer(TRAZAR_CUT_LAYER);
  } catch {
    /* */
  }
}
