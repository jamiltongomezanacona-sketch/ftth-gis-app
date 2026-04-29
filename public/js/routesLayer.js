const SOURCE_ID = 'rutas-source';
const LAYER_ID = 'rutas-layer';

/** Tendidos FTTH y corporativa: mismo color unificado. */
const FTTH_LINE_COLOR = '#1e40af';

/** Color/grosor con resaltado del tendido seleccionado (clic o buscador). */
const PAINT_COLOR_WITH_SELECTION = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  [
    'match',
    ['get', 'red_tipo'],
    'corporativa',
    '#22d3ee',
    '#22d3ee'
  ],
  ['match', ['get', 'red_tipo'], 'corporativa', FTTH_LINE_COLOR, FTTH_LINE_COLOR]
];

const PAINT_WIDTH_WITH_SELECTION = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  9,
  5
];

/** Misma apariencia para todos los tendidos (p. ej. varios cables de una molécula). */
const PAINT_COLOR_UNIFORM = FTTH_LINE_COLOR;

const PAINT_WIDTH_UNIFORM = 5;

export class RoutesLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this.sourceId = SOURCE_ID;
    this.layerId = LAYER_ID;
    /** @type {string|number|null} */
    this.selectedId = null;
    /** @type {'normal' | 'uniform'} */
    this._lineStyleMode = 'normal';
  }

  /**
   * `normal`: el seleccionado más grueso y con color de resaltado.
   * `uniform`: todos igual (mismo color y grosor por red_tipo).
   * @param {'normal' | 'uniform'} mode
   */
  setLineStyleMode(mode) {
    this._lineStyleMode = mode === 'uniform' ? 'uniform' : 'normal';
    this._syncLinePaint();
  }

  _syncLinePaint() {
    if (!this.map.getLayer(this.layerId)) return;
    if (this._lineStyleMode === 'uniform') {
      this.map.setPaintProperty(this.layerId, 'line-color', PAINT_COLOR_UNIFORM);
      this.map.setPaintProperty(this.layerId, 'line-width', PAINT_WIDTH_UNIFORM);
    } else {
      this.map.setPaintProperty(this.layerId, 'line-color', PAINT_COLOR_WITH_SELECTION);
      this.map.setPaintProperty(this.layerId, 'line-width', PAINT_WIDTH_WITH_SELECTION);
    }
  }

  ensureLayer() {
    if (this.map.getSource(this.sourceId)) return;

    this.map.addSource(this.sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      /** Asegura `id` para `setFeatureState` (selección) aunque el API no envíe `id` en cada feature. */
      generateId: true
    });

    this.map.addLayer({
      id: this.layerId,
      type: 'line',
      source: this.sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': PAINT_COLOR_WITH_SELECTION,
        'line-width': PAINT_WIDTH_WITH_SELECTION,
        'line-opacity': 0.95
      }
    });
    this._syncLinePaint();
  }

  /** @param {GeoJSON.FeatureCollection} fc */
  setData(fc) {
    this.ensureLayer();
    this.map.getSource(this.sourceId).setData(fc);
  }

  /**
   * Todas las rutas LineString/MultiLineString del source GeoJSON cargado.
   * Importante: **`querySourceFeatures` suele devolver solo features en el viewport**; para Fibra GIS /
   * encadenado de tendidos hay que usar los datos completos del source (serialize / `_data`).
   * @returns {GeoJSON.Feature[]}
   */
  getFeatureList() {
    this.ensureLayer();
    const src = /** @type {any} */ (this.map.getSource(this.sourceId));
    if (!src) return [];

    const lineOk = (/** @type {GeoJSON.Feature} */ f) =>
      f?.geometry &&
      (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');

    /** Dataset completo del GeoJSON (no recortado por zoom / teselas visibles). */
    /** @type {GeoJSON.Feature[] | null} */
    let allFeatures = null;
    if (typeof src.serialize === 'function') {
      try {
        const ser = src.serialize();
        const data = ser?.data;
        if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
          allFeatures = data.features;
        }
      } catch {
        /* */
      }
    }
    if (!allFeatures?.length && src._data?.type === 'FeatureCollection' && Array.isArray(src._data.features)) {
      allFeatures = src._data.features;
    }
    if (allFeatures?.length) {
      const lines = allFeatures.filter(lineOk);
      if (lines.length) return lines;
    }

    try {
      if (this.map && typeof this.map.querySourceFeatures === 'function' && this.map.isStyleLoaded()) {
        const queried = this.map.querySourceFeatures(this.sourceId) || [];
        const lines = queried.filter(lineOk);
        if (lines.length) return lines;
      }
    } catch (e) {
      console.warn('rutas getFeatureList (querySourceFeatures):', e);
    }
    return [];
  }

  /**
   * Resalta una ruta por id (numérico o string).
   * @param {string|number|null} id
   */
  setSelected(id) {
    this.ensureLayer();
    if (this.selectedId != null) {
      this.map.setFeatureState(
        { source: this.sourceId, id: this.selectedId },
        { selected: false }
      );
    }
    this.selectedId = id;
    if (id != null) {
      this.map.setFeatureState({ source: this.sourceId, id }, { selected: true });
    }
  }

  /**
   * Oculta una ruta en la capa base mientras se edita en Draw (evita duplicado visual).
   * @param {string|number|null} id
   */
  setHiddenRouteId(id) {
    this.ensureLayer();
    if (id == null) {
      this.map.setFilter(this.layerId, null);
      return;
    }
    this.map.setFilter(this.layerId, [
      '!=',
      ['to-string', ['id']],
      String(id)
    ]);
  }

  /** @param {(e: mapboxgl.MapLayerMouseEvent) => void} handler */
  onLineClick(handler) {
    this.map.on('click', this.layerId, handler);
  }

  offLineClick(handler) {
    this.map.off('click', this.layerId, handler);
  }

  setCursorPointerOnHover() {
    this.map.on('mouseenter', this.layerId, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', this.layerId, () => {
      this.map.getCanvas().style.cursor = '';
    });
  }
}

export { LAYER_ID as ROUTES_LAYER_ID, SOURCE_ID as ROUTES_SOURCE_ID };
