import {
  FTTH_ICON_CIERRE_E1,
  FTTH_ICON_CIERRE_E2
} from './ftthCierreIcons.js';
import {
  DEVICE_LABEL_LAYER_MIN_ZOOM,
  deviceLabelCollisionLayout,
  deviceLabelTextFieldCoalesceNombreName,
  deviceLabelTextOpacityPaint,
  deviceLabelTextSizeLayout,
  deviceLabelTextSizeLayoutOffset
} from './mapLabelZoom.js';

/**
 * Capa única de overlay FTTH en el mapa: los mismos iconos (E1/E2/…) se aplican a
 * TODAS las moléculas y centrales de la red FTTH. No hay estilos por molécula:
 * solo importa `ftth_overlay_kind`, derivado del campo `tipo` de cada punto.
 */
const SOURCE_ID = 'molecule-ftth-overlay-source';
const CIRCLE_LAYER_ID = 'molecule-ftth-overlay-circle';
const SYMBOL_E1_LAYER_ID = 'molecule-ftth-overlay-e1-symbol';
const SYMBOL_E2_LAYER_ID = 'molecule-ftth-overlay-e2-symbol';
/** Fondo blanco (texto blanco más grande). */
const LABEL_LAYER_BG_ID = 'molecule-ftth-overlay-labels-bg';
const LABEL_LAYER_ID = 'molecule-ftth-overlay-labels';

/** Capas con hit-test para popup de propiedades (cierre / NAP). */
export const MOLECULE_OVERLAY_INTERACTIVE_LAYER_IDS = [
  CIRCLE_LAYER_ID,
  SYMBOL_E1_LAYER_ID,
  SYMBOL_E2_LAYER_ID,
  LABEL_LAYER_BG_ID,
  LABEL_LAYER_ID
];

const E1_IMAGE_ID = 'ftth-cierre-e1-pin';
const E1_ICON_URL = FTTH_ICON_CIERRE_E1;
const E2_IMAGE_ID = 'ftth-cierre-e2-pin';
const E2_ICON_URL = FTTH_ICON_CIERRE_E2;

/** Tamaño al rasterizar SVG → ImageData para Mapbox (cf. `medidaEventoMarkerLayer`). */
const E1E2_RASTER_PX = 108;

/** Mismo azul que los tendidos FTTH (`routesLayer`). */
const MOLECULE_POINT_COLOR = '#1e40af';

/** Decimales al agrupar coordenadas iguales (~1 m con 5 decimales en latitud media). */
const STACK_KEY_PRECISION = 5;
/** Ángulo áureo para repartir puntos en espiral alrededor del mismo sitio. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Iconos E1/E2: se permiten encima del mapa base; los puntos en el mismo sitio se separan
 * en `setData` (espiral) para que no desaparezcan por colisiones entre sí.
 */
/** @type {import('mapbox-gl').SymbolLayerSpecification['layout']} */
const PIN_LAYOUT = {
  'icon-size': [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    0.15,
    14,
    0.23,
    18,
    0.32
  ],
  'icon-anchor': 'bottom',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true
};

/**
 * Clona features y desplaza en espiral los que comparten la misma posición redondeada,
 * para que iconos/etiquetas no compitan por un solo píxel. La posición original queda en
 * `properties.ftth_orig_lon` / `ftth_orig_lat` (solo si hubo apilamiento).
 * @param {GeoJSON.Feature[]} features
 * @returns {GeoJSON.Feature[]}
 */
function spreadStackedPointFeatures(features) {
  if (!Array.isArray(features) || features.length === 0) return features;

  const out = features.map((f) => {
    if (!f || f.type !== 'Feature') return f;
    const g = f.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return f;
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return f;
    return {
      type: 'Feature',
      id: f.id,
      properties: { ...f.properties },
      geometry: { type: 'Point', coordinates: [lng, lat] }
    };
  });

  const groups = new Map();
  for (const f of out) {
    const g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    const [lng, lat] = g.coordinates;
    const key = `${lng.toFixed(STACK_KEY_PRECISION)},${lat.toFixed(STACK_KEY_PRECISION)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const lng0 = group[0].geometry.coordinates[0];
    const lat0 = group[0].geometry.coordinates[1];
    const cosLat = Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * cosLat;

    for (let i = 0; i < group.length; i++) {
      const f = group[i];
      f.properties.ftth_orig_lon = lng0;
      f.properties.ftth_orig_lat = lat0;
      const theta = i * GOLDEN_ANGLE;
      const rM = 5.5 + Math.sqrt(i + 0.55) * 7.5;
      const dxM = rM * Math.cos(theta);
      const dyM = rM * Math.sin(theta);
      f.geometry.coordinates = [lng0 + dxM / mPerDegLng, lat0 + dyM / mPerDegLat];
    }
  }

  return out;
}

/**
 * @param {GeoJSON.FeatureCollection} fc
 * @returns {GeoJSON.FeatureCollection}
 */
function spreadStackedPointsInCollection(fc) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection', features: [] };
  }
  return { ...fc, features: spreadStackedPointFeatures(fc.features) };
}

/**
 * @param {boolean} hasE1
 * @param {boolean} hasE2
 */
function circleFilterForIcons(hasE1, hasE2) {
  /** @type {unknown[]} */
  const parts = [];
  if (hasE1) parts.push(['!=', ['get', 'ftth_overlay_kind'], 'cierre_e1']);
  if (hasE2) parts.push(['!=', ['get', 'ftth_overlay_kind'], 'cierre_e2']);
  if (parts.length === 0) return true;
  if (parts.length === 1) return parts[0];
  return ['all', ...parts];
}

/**
 * Puntos auxiliares FTTH (cierres E0/E1/E2, NAPs, etc.): alcance global del proyecto.
 * E1/E2 → iconos raster (gota E1/E2) desde `/icons/ftth/cierre-e*.svg`; el resto → círculos azules.
 */

/**
 * Rasteriza SVG en ImageData para `map.addImage` (los PNG pin no están en el repo).
 * @param {import('mapbox-gl').Map} map
 * @param {string} imageId
 * @param {string} svgUrl
 * @param {number} sizePx
 * @param {() => void} onDone
 */
function addSvgRasterImage(map, imageId, svgUrl, sizePx, onDone) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const W = sizePx;
      const H = sizePx;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        onDone();
        return;
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);
      if (!map.hasImage(imageId)) {
        map.addImage(imageId, imageData, { pixelRatio: 1 });
      }
    } catch {
      /* */
    }
    onDone();
  };
  img.onerror = () => onDone();
  img.src = svgUrl;
}

export class MoleculeOverlayLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this.sourceId = SOURCE_ID;
    this.layerId = CIRCLE_LAYER_ID;
    /** @type {boolean} */
    this._addingLayers = false;
  }

  ensureLayer() {
    if (this.map.getLayer(CIRCLE_LAYER_ID)) return;

    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (this._addingLayers) return;
    this._addingLayers = true;

    const finish = () => {
      this._addingLayers = false;
      if (this.map.getLayer(CIRCLE_LAYER_ID)) return;

      const hasE1 = this.map.hasImage(E1_IMAGE_ID);
      const hasE2 = this.map.hasImage(E2_IMAGE_ID);
      const circleFilter = circleFilterForIcons(hasE1, hasE2);

      this.map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'circle',
        source: this.sourceId,
        filter: circleFilter,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 5.5, 18, 7],
          'circle-color': MOLECULE_POINT_COLOR,
          'circle-stroke-width': 0,
          'circle-opacity': 0.95
        }
      });

      if (hasE1) {
        this.map.addLayer({
          id: SYMBOL_E1_LAYER_ID,
          type: 'symbol',
          source: this.sourceId,
          filter: ['==', ['get', 'ftth_overlay_kind'], 'cierre_e1'],
          layout: { ...PIN_LAYOUT, 'icon-image': E1_IMAGE_ID },
          paint: { 'icon-opacity': 0.98 }
        });
      }
      if (hasE2) {
        this.map.addLayer({
          id: SYMBOL_E2_LAYER_ID,
          type: 'symbol',
          source: this.sourceId,
          filter: ['==', ['get', 'ftth_overlay_kind'], 'cierre_e2'],
          layout: { ...PIN_LAYOUT, 'icon-image': E2_IMAGE_ID },
          paint: { 'icon-opacity': 0.98 }
        });
      }

      const filterHasNombre = /** @type {const} */ ([
        '>',
        ['length', ['coalesce', ['get', 'nombre'], ['get', 'name'], '']],
        0
      ]);

      /** Encuadre blanco: capa inferior (mismo ancla que el texto encima). */
      this.map.addLayer({
        id: LABEL_LAYER_BG_ID,
        type: 'symbol',
        source: this.sourceId,
        minzoom: DEVICE_LABEL_LAYER_MIN_ZOOM,
        filter: filterHasNombre,
        layout: {
          'text-field': deviceLabelTextFieldCoalesceNombreName(),
          ...deviceLabelCollisionLayout(),
          'text-padding': 20,
          'text-font': ['DIN Offc Pro Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': deviceLabelTextSizeLayoutOffset(18, 12, 2.5),
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
          'text-max-width': 14
        },
        paint: {
          ...deviceLabelTextOpacityPaint(),
          'text-color': '#ffffff',
          'text-halo-width': 0,
          'text-halo-blur': 0
        }
      });

      /** Nombre debajo del icono, texto oscuro sobre el fondo blanco. */
      this.map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: this.sourceId,
        minzoom: DEVICE_LABEL_LAYER_MIN_ZOOM,
        filter: filterHasNombre,
        layout: {
          'text-field': deviceLabelTextFieldCoalesceNombreName(),
          ...deviceLabelCollisionLayout(),
          'text-padding': 18,
          'text-font': ['DIN Offc Pro Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': deviceLabelTextSizeLayout(18, 12),
          'text-anchor': 'top',
          'text-offset': [0, 0.5],
          'text-max-width': 14
        },
        paint: {
          ...deviceLabelTextOpacityPaint(),
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
          'text-halo-blur': 0.1
        }
      });
    };

    const needE1 = !this.map.hasImage(E1_IMAGE_ID);
    const needE2 = !this.map.hasImage(E2_IMAGE_ID);
    if (!needE1 && !needE2) {
      finish();
      return;
    }

    let pending = (needE1 ? 1 : 0) + (needE2 ? 1 : 0);
    const doneOne = () => {
      pending -= 1;
      if (pending <= 0) finish();
    };

    if (needE1) {
      addSvgRasterImage(this.map, E1_IMAGE_ID, E1_ICON_URL, E1E2_RASTER_PX, doneOne);
    }
    if (needE2) {
      addSvgRasterImage(this.map, E2_IMAGE_ID, E2_ICON_URL, E1E2_RASTER_PX, doneOne);
    }
  }

  /** @param {GeoJSON.FeatureCollection} fc */
  setData(fc) {
    this.ensureLayer();
    const raw = fc && fc.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: [] };
    this.map.getSource(this.sourceId).setData(spreadStackedPointsInCollection(raw));
  }

  clear() {
    this.setData({ type: 'FeatureCollection', features: [] });
  }

  /** Sube círculos, iconos E1/E2 y etiquetas de nombre por encima de rutas/centrales base. */
  bringToFront() {
    const ids = [
      CIRCLE_LAYER_ID,
      SYMBOL_E1_LAYER_ID,
      SYMBOL_E2_LAYER_ID,
      LABEL_LAYER_BG_ID,
      LABEL_LAYER_ID
    ];
    try {
      for (const id of ids) {
        if (this.map.getLayer(id)) this.map.moveLayer(id);
      }
    } catch {
      /* */
    }
  }
}
