/**
 * Marcador visual y orden de capa del punto de corte (Fibra GIS / medición OTDR en editor).
 */
export const TRAZAR_CUT_SOURCE_ID = 'editor-trazar-cut-fc';
const TRAZAR_CUT_LAYER = 'editor-trazar-cut-circle';

/** Pin de referencia (modo punto): GeoJSON + Marker opcional (violeta). */
export const TRAZAR_REF_SOURCE_ID = 'editor-trazar-ref-fc';
const TRAZAR_REF_LAYER = 'editor-trazar-ref-circle';

let trazarDomMarker = null;
/** Pin del punto de referencia en modo «punto en el cable» (violeta, distinto del corte). */
let trazarRefDomMarker = null;

/**
 * @param {import('mapbox-gl').Map} map
 */
export function ensureTrazarCutLayers(map) {
  try {
    if (!map.getSource(TRAZAR_CUT_SOURCE_ID)) {
      map.addSource(TRAZAR_CUT_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    if (!map.getLayer(TRAZAR_CUT_LAYER)) {
      map.addLayer({
        id: TRAZAR_CUT_LAYER,
        type: 'circle',
        source: TRAZAR_CUT_SOURCE_ID,
        paint: {
          'circle-radius': 5,
          'circle-color': '#ef4444',
          'circle-stroke-color': '#450a0a',
          'circle-stroke-width': 2,
          'circle-opacity': 0.96
        }
      });
    } else {
      try {
        map.setPaintProperty(TRAZAR_CUT_LAYER, 'circle-radius', 5);
        map.setPaintProperty(TRAZAR_CUT_LAYER, 'circle-color', '#ef4444');
        map.setPaintProperty(TRAZAR_CUT_LAYER, 'circle-stroke-color', '#450a0a');
        map.setPaintProperty(TRAZAR_CUT_LAYER, 'circle-stroke-width', 2);
        map.setPaintProperty(TRAZAR_CUT_LAYER, 'circle-opacity', 0.96);
      } catch {
        /* */
      }
    }
  } catch (e) {
    console.warn('Trazar capa corte (GeoJSON):', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function ensureTrazarRefLayers(map) {
  try {
    if (!map.getSource(TRAZAR_REF_SOURCE_ID)) {
      map.addSource(TRAZAR_REF_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    if (!map.getLayer(TRAZAR_REF_LAYER)) {
      map.addLayer({
        id: TRAZAR_REF_LAYER,
        type: 'circle',
        source: TRAZAR_REF_SOURCE_ID,
        paint: {
          'circle-radius': 8,
          'circle-color': '#818cf8',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.95
        }
      });
    }
  } catch (e) {
    console.warn('Trazar capa referencia (GeoJSON):', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {[number, number]} lngLat
 */
function setTrazarRefGeoPoint(map, lngLat) {
  ensureTrazarRefLayers(map);
  try {
    const src = map.getSource(TRAZAR_REF_SOURCE_ID);
    if (src && 'setData' in src) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: lngLat },
            properties: { kind: 'trazar_ref' }
          }
        ]
      });
    }
  } catch (e) {
    console.warn('Trazar referencia (GeoJSON):', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {[number, number]} lngLat
 */
function setTrazarCutGeoPoint(map, lngLat) {
  ensureTrazarCutLayers(map);
  try {
    const src = map.getSource(TRAZAR_CUT_SOURCE_ID);
    if (src && 'setData' in src) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: lngLat },
            properties: { kind: 'trazar_cut' }
          }
        ]
      });
    }
  } catch (e) {
    console.warn('Trazar corte (GeoJSON):', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {import('mapbox-gl').LngLatLike} lngLat
 */
/**
 * @param {import('mapbox-gl').Map} map
 * @param {import('mapbox-gl').LngLatLike} lngLat
 */
export function setTrazarRefMarker(map, lngLat) {
  const ll = /** @type {[number, number]} */ (
    Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat]
  );
  setTrazarRefGeoPoint(map, ll);
  try {
    if (trazarRefDomMarker) {
      trazarRefDomMarker.remove();
      trazarRefDomMarker = null;
    }
    const mb = globalThis.mapboxgl ?? window.mapboxgl;
    if (typeof mb === 'object' && mb && typeof mb.Marker === 'function') {
      const el = document.createElement('div');
      el.className = 'editor-trazar-ref-pin-wrap';
      el.innerHTML =
        '<div class="editor-trazar-ref-pin-dot" aria-hidden="true" title="Referencia en el tendido (Fibra GIS)"></div>';
      trazarRefDomMarker = new mb.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map);
    }
  } catch (e) {
    console.warn('Trazar ref Marker:', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function clearTrazarRefMarker(map) {
  try {
    if (trazarRefDomMarker) {
      trazarRefDomMarker.remove();
      trazarRefDomMarker = null;
    }
    const src = map.getSource(TRAZAR_REF_SOURCE_ID);
    if (src && 'setData' in src) {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  } catch {
    /* */
  }
}

/**
 * @param {string | { primary: string; secondary: string; detail?: string } | null | undefined} cl
 * @returns {HTMLDivElement | null}
 */
function buildCutLabelElement(cl) {
  if (cl == null) return null;
  if (typeof cl === 'string') {
    const t = cl.trim();
    if (!t) return null;
    const lab = document.createElement('div');
    lab.className = 'editor-trazar-cut-pin-label';
    lab.setAttribute('role', 'status');
    lab.textContent = t;
    return lab;
  }
  if (
    typeof cl === 'object' &&
    typeof cl.primary === 'string' &&
    typeof cl.secondary === 'string' &&
    cl.primary.trim() !== ''
  ) {
    const lab = document.createElement('div');
    lab.className = 'editor-trazar-cut-pin-label editor-trazar-cut-pin-label--split';
    lab.setAttribute('role', 'status');
    const p = document.createElement('span');
    p.className = 'editor-trazar-cut-pin-label__primary';
    p.textContent = cl.primary.trim();
    lab.appendChild(p);
    const hasDetail = typeof cl.detail === 'string' && cl.detail.trim() !== '';
    if (hasDetail) {
      const sec = document.createElement('span');
      sec.className = 'editor-trazar-cut-pin-label__secondary editor-trazar-cut-pin-label__secondary--stacked';
      sec.textContent = cl.secondary.trim();
      const det = document.createElement('span');
      det.className = 'editor-trazar-cut-pin-label__detail';
      det.textContent = cl.detail.trim();
      lab.appendChild(sec);
      lab.appendChild(det);
    } else {
      const row = document.createElement('span');
      row.className = 'editor-trazar-cut-pin-label__row';
      const dot = document.createElement('span');
      dot.className = 'editor-trazar-cut-pin-label__dot';
      dot.setAttribute('aria-hidden', 'true');
      const s = document.createElement('span');
      s.className = 'editor-trazar-cut-pin-label__secondary';
      s.textContent = cl.secondary.trim();
      row.appendChild(dot);
      row.appendChild(s);
      lab.appendChild(row);
    }
    return lab;
  }
  return null;
}

/**
 * @param {import('mapbox-gl').Map} map
 * @param {import('mapbox-gl').LngLatLike} lngLat
 * @param {{ centralLabel?: string | { primary: string; secondary: string; detail?: string } | null }} [opts]
 */
export function setTrazarCutMarker(map, lngLat, opts) {
  const ll = /** @type {[number, number]} */ (
    Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat]
  );
  const centralLabel = opts?.centralLabel ?? null;
  setTrazarCutGeoPoint(map, ll);
  try {
    if (trazarDomMarker) {
      trazarDomMarker.remove();
      trazarDomMarker = null;
    }
    const mb = globalThis.mapboxgl ?? window.mapboxgl;
    if (typeof mb === 'object' && mb && typeof mb.Marker === 'function') {
      const el = document.createElement('div');
      el.className = 'editor-trazar-cut-pin-wrap';
      const stack = document.createElement('div');
      stack.className = 'editor-trazar-cut-pin-stack';
      stack.innerHTML = `<svg class="editor-trazar-cut-pin-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 48" width="28" height="37" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="editor-trazar-cut-pin-grad" x1="18" y1="2" x2="18" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#fca5a5" />
      <stop offset="45%" stop-color="#ef4444" />
      <stop offset="100%" stop-color="#991b1b" />
    </linearGradient>
    <filter id="editor-trazar-cut-pin-soft" x="-25%" y="-20%" width="150%" height="140%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#450a0a" flood-opacity="0.35" />
    </filter>
  </defs>
  <path class="editor-trazar-cut-pin-body" fill="none" stroke="#7f1d1d" stroke-width="1.75" stroke-opacity="0.55" d="M18 1.5C9.9 1.5 3.2 8.1 3.2 16c0 7.9 5 18.8 12.4 27.5a1.45 1.45 0 0 0 2.4 0C25.4 34.8 32.8 23.9 32.8 16 32.8 8.1 26.1 1.5 18 1.5Z"/>
  <path class="editor-trazar-cut-pin-body" filter="url(#editor-trazar-cut-pin-soft)" fill="url(#editor-trazar-cut-pin-grad)" stroke="#7f1d1d" stroke-width="1.1" stroke-linejoin="round" d="M18 2C10.2 2 4 8.1 4 16c0 8.1 5.1 19.1 12.7 28.1a1.3 1.3 0 0 0 2.1 0C25.1 35.2 32 24.2 32 16C32 8.1 25.8 2 18 2Z"/>
  <circle class="editor-trazar-cut-pin-ring" cx="18" cy="16" r="6.25" fill="none" stroke="#fef2f2" stroke-width="1.1" opacity="0.9" />
  <circle class="editor-trazar-cut-pin-dot" cx="18" cy="16" r="3.35" fill="#fef2f2" stroke="#b91c1c" stroke-width="0.85" />
</svg>`;
      const labEl = buildCutLabelElement(centralLabel);
      if (labEl) stack.insertBefore(labEl, stack.firstChild);
      el.appendChild(stack);
      trazarDomMarker = new mb.Marker({ element: el, anchor: 'bottom' }).setLngLat(ll).addTo(map);
    }
  } catch (e) {
    console.warn('Trazar Marker DOM:', e);
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function clearTrazarCutMarker(map) {
  try {
    if (trazarDomMarker) {
      trazarDomMarker.remove();
      trazarDomMarker = null;
    }
    const src = map.getSource(TRAZAR_CUT_SOURCE_ID);
    if (src && 'setData' in src) {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  } catch {
    /* */
  }
}

/**
 * @param {import('mapbox-gl').Map} map
 */
export function bringTrazarCutLayerToFront(map) {
  try {
    if (map.getLayer(TRAZAR_CUT_LAYER)) {
      map.moveLayer(TRAZAR_CUT_LAYER);
    }
  } catch {
    /* */
  }
}

/**
 * Sube la capa del pin de referencia (debajo del corte si ambas existen).
 * @param {import('mapbox-gl').Map} map
 */
export function bringTrazarRefLayerToFront(map) {
  try {
    if (map.getLayer(TRAZAR_REF_LAYER)) {
      map.moveLayer(TRAZAR_REF_LAYER);
    }
  } catch {
    /* */
  }
}
