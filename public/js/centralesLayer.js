import { getFtthMapIcon, pinSvgString } from './ftthMapIconsData.js';
import { rasterizeSvgStringForMapbox } from './rasterizeSvgForMapbox.js';
import { gisMarkerUrl } from './gisMarkersAssets.js';
import {
  DEVICE_LABEL_LAYER_MIN_ZOOM,
  deviceLabelCollisionLayout,
  deviceLabelTextFieldFromProp,
  deviceLabelTextOpacityPaint,
  deviceLabelTextSizeLayout
} from './mapLabelZoom.js';

const SOURCE_ID = 'centrales-etb-source';
/** Capa interactiva con icono SVG (preferida). */
const SYMBOL_LAYER_ID = 'centrales-etb-symbol';
/** Reserva si `loadImage` falla con el SVG. */
const CIRCLE_LAYER_ID = 'centrales-etb-circle';
const LABEL_LAYER_ID = 'centrales-etb-label';
/** Icono propio FTTH: cuadrado violeta / central ETB (`public/icons/ftth/central-etb.png`). */
const CENTRAL_CUSTOM_ICON_URL = '/icons/ftth/central-etb.png';
const CENTRAL_CUSTOM_ICON_ID = 'central-etb-purple-icon';
/** Pin raster del set `gis-markers` (fallback: SVG OLT). */
const ICON_IMAGE_ID = 'ftth-central-map-icon';
const GIS_CENTRAL_ICON_HI = 'gis-central-marker-hi';
const GIS_CENTRAL_ICON_LV = 'gis-central-marker-lv';
/** Zoom &lt; este valor: icono «-lv» (más legible alejado). */
const GIS_CENTRAL_ZOOM_SPLIT = 13;

/**
 * GeoJSON de centrales puede traer `properties.name` (export Google) o `nombre` (API).
 * Mapbox necesita coordenadas 2D [lng,lat] para evitar fallos raros con Z.
 * @param {GeoJSON.FeatureCollection} fc
 * @returns {GeoJSON.FeatureCollection}
 */
export function normalizeCentralesFeatureCollection(fc) {
  if (!fc || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  let i = 0;
  for (const f of fc.features) {
    if (!f || f.type !== 'Feature') continue;
    const g = f.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    const c = g.coordinates;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const nombre = String(
      f.properties?.nombre ?? f.properties?.name ?? `Central ${i + 1}`
    ).trim();
    i++;
    features.push({
      type: 'Feature',
      id: f.id != null ? f.id : i,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        nombre,
        tipo: f.properties?.tipo ?? 'central_etb'
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

export class CentralesEtBLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this.sourceId = SOURCE_ID;
    this.symbolLayerId = SYMBOL_LAYER_ID;
    this.circleLayerId = CIRCLE_LAYER_ID;
    this.labelLayerId = LABEL_LAYER_ID;
    /** @type {((e: mapboxgl.MapLayerMouseEvent) => void) | null} */
    this._centralClickHandler = null;
    /** @type {boolean} */
    this._hoverEnabled = false;
    this._onCentralEnter = () => {
      this.map.getCanvas().style.cursor = 'pointer';
    };
    this._onCentralLeave = () => {
      this.map.getCanvas().style.cursor = '';
    };
    /** @type {Promise<void> | null} */
    this._centralRasterPromise = null;
  }

  /** Capa a usar en `map.on('click', …)` / hover (símbolo o círculo). */
  getInteractiveLayerId() {
    if (this.map.getLayer(this.symbolLayerId)) return this.symbolLayerId;
    if (this.map.getLayer(this.circleLayerId)) return this.circleLayerId;
    return null;
  }

  _addLabelLayer() {
    if (this.map.getLayer(this.labelLayerId)) return;
    this.map.addLayer({
      id: this.labelLayerId,
      type: 'symbol',
      source: this.sourceId,
      minzoom: DEVICE_LABEL_LAYER_MIN_ZOOM,
      layout: {
        'text-field': deviceLabelTextFieldFromProp('nombre'),
        ...deviceLabelCollisionLayout(),
        'text-font': ['DIN Offc Pro Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': deviceLabelTextSizeLayout(17, 11),
        'text-offset': [0, 1.12],
        'text-anchor': 'top'
      },
      paint: {
        ...deviceLabelTextOpacityPaint(),
        'text-color': '#021c0d',
        'text-halo-color': 'rgba(255, 255, 255, 0.94)',
        'text-halo-width': 1.35
      }
    });
  }

  _addCircleFallback() {
    if (this.map.getLayer(this.circleLayerId)) return;
    this.map.addLayer({
      id: this.circleLayerId,
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-radius': 4,
        'circle-color': '#14532d',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#86efac',
        'circle-opacity': 1
      }
    });
  }

  _addSymbolLayer() {
    if (this.map.getLayer(this.symbolLayerId)) return;
    const useCustom = this.map.hasImage(CENTRAL_CUSTOM_ICON_ID);
    const useGisRasters =
      !useCustom &&
      this.map.hasImage(GIS_CENTRAL_ICON_HI) &&
      this.map.hasImage(GIS_CENTRAL_ICON_LV);
    /** @type {any} */
    let iconImage;
    /** @type {number | any} */
    let iconSize;
    if (useCustom) {
      iconImage = CENTRAL_CUSTOM_ICON_ID;
      iconSize = [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        0.34,
        12,
        0.44,
        15,
        0.54,
        18,
        0.64
      ];
    } else if (useGisRasters) {
      iconImage = [
        'step',
        ['zoom'],
        GIS_CENTRAL_ICON_LV,
        GIS_CENTRAL_ZOOM_SPLIT,
        GIS_CENTRAL_ICON_HI
      ];
      iconSize = 0.44;
    } else {
      iconImage = ICON_IMAGE_ID;
      iconSize = 0.24;
    }
    this.map.addLayer({
      id: this.symbolLayerId,
      type: 'symbol',
      source: this.sourceId,
      layout: {
        'icon-image': iconImage,
        'icon-size': iconSize,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
  }

  _bindHoverIfEnabled() {
    if (!this._hoverEnabled) return;
    this.map.off('mouseenter', this.symbolLayerId, this._onCentralEnter);
    this.map.off('mouseleave', this.symbolLayerId, this._onCentralLeave);
    this.map.off('mouseenter', this.circleLayerId, this._onCentralEnter);
    this.map.off('mouseleave', this.circleLayerId, this._onCentralLeave);
    const lid = this.getInteractiveLayerId();
    if (lid) {
      this.map.on('mouseenter', lid, this._onCentralEnter);
      this.map.on('mouseleave', lid, this._onCentralLeave);
    }
  }

  _syncInteractionListeners() {
    if (!this._centralClickHandler) return;
    this.map.off('click', this.symbolLayerId, this._centralClickHandler);
    this.map.off('click', this.circleLayerId, this._centralClickHandler);
    const lid = this.getInteractiveLayerId();
    if (lid) {
      this.map.on('click', lid, this._centralClickHandler);
    }
    this._bindHoverIfEnabled();
  }

  /**
   * @param {string} url
   * @returns {Promise<import('mapbox-gl').ImageDataType | import('mapbox-gl').ImageData>}
   */
  _loadMapImage(url) {
    return new Promise((resolve, reject) => {
      this.map.loadImage(url, (err, img) => {
        if (err || !img) reject(err || new Error('loadImage'));
        else resolve(img);
      });
    });
  }

  _ensureMarkerGraphic() {
    if (this.map.getLayer(this.symbolLayerId) || this.map.getLayer(this.circleLayerId)) {
      this._addLabelLayer();
      this._syncInteractionListeners();
      return;
    }

    const customReady = this.map.hasImage(CENTRAL_CUSTOM_ICON_ID);
    const gisReady =
      this.map.hasImage(GIS_CENTRAL_ICON_HI) && this.map.hasImage(GIS_CENTRAL_ICON_LV);
    if (customReady || gisReady) {
      this._addSymbolLayer();
      this._addLabelLayer();
      this._syncInteractionListeners();
      return;
    }

    if (this.map.hasImage(ICON_IMAGE_ID)) {
      this._addSymbolLayer();
      this._addLabelLayer();
      this._syncInteractionListeners();
      return;
    }

    const afterIcons = () => {
      if (this.map.hasImage(CENTRAL_CUSTOM_ICON_ID)) {
        this._addSymbolLayer();
      } else if (
        this.map.hasImage(GIS_CENTRAL_ICON_HI) &&
        this.map.hasImage(GIS_CENTRAL_ICON_LV)
      ) {
        this._addSymbolLayer();
      } else if (this.map.hasImage(ICON_IMAGE_ID)) {
        this._addSymbolLayer();
      } else {
        console.warn('Centrales ETB: usando círculo (no se pudo registrar el icono).');
        this._addCircleFallback();
      }
      if (!this.map.getLayer(this.labelLayerId)) {
        this._addLabelLayer();
      }
      this._syncInteractionListeners();
      this._bindHoverIfEnabled();
    };

    if (!this._centralRasterPromise) {
      this._centralRasterPromise = this._loadMapImage(CENTRAL_CUSTOM_ICON_URL)
        .then((img) => {
          if (!this.map.hasImage(CENTRAL_CUSTOM_ICON_ID)) {
            this.map.addImage(CENTRAL_CUSTOM_ICON_ID, img, { pixelRatio: 1 });
          }
        })
        .catch((e) => {
          console.warn(
            'Centrales ETB: icono custom no disponible, se prueban gis-markers',
            e?.message || e
          );
          return Promise.all([
            this._loadMapImage(gisMarkerUrl('red-circle.png')),
            this._loadMapImage(gisMarkerUrl('red-circle-lv.png'))
          ])
            .then(([hi, lv]) => {
              if (!this.map.hasImage(GIS_CENTRAL_ICON_HI)) {
                this.map.addImage(GIS_CENTRAL_ICON_HI, hi, { pixelRatio: 1 });
              }
              if (!this.map.hasImage(GIS_CENTRAL_ICON_LV)) {
                this.map.addImage(GIS_CENTRAL_ICON_LV, lv, { pixelRatio: 1 });
              }
            })
            .catch((e2) => {
              console.warn(
                'Centrales ETB: iconos PNG gis-markers, se usa pin SVG OLT',
                e2?.message || e2
              );
              const olt = getFtthMapIcon('olt');
              const svg = olt ? pinSvgString(olt) : '';
              return olt
                ? rasterizeSvgStringForMapbox(svg, 96).then((rgba) => {
                    if (!this.map.hasImage(ICON_IMAGE_ID)) {
                      this.map.addImage(ICON_IMAGE_ID, rgba);
                    }
                  })
                : Promise.reject(new Error('icono OLT no definido'));
            });
        })
        .finally(() => {
          afterIcons();
          this._centralRasterPromise = null;
        });
    }
  }

  ensureLayer() {
    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    this._ensureMarkerGraphic();
  }

  /** @param {GeoJSON.FeatureCollection} fc */
  setData(fc) {
    this.ensureLayer();
    const clean = normalizeCentralesFeatureCollection(fc);
    this.map.getSource(this.sourceId).setData(clean);
    this.bringToFront();
  }

  bringToFront() {
    const sym = this.map.getLayer(this.symbolLayerId);
    const circ = this.map.getLayer(this.circleLayerId);
    const lab = this.map.getLayer(this.labelLayerId);
    if (!lab) return;
    try {
      if (sym) this.map.moveLayer(this.symbolLayerId);
      else if (circ) this.map.moveLayer(this.circleLayerId);
      this.map.moveLayer(this.labelLayerId);
    } catch {
      /* estilo aún no listo */
    }
  }

  /** @param {(e: mapboxgl.MapLayerMouseEvent) => void} handler */
  onCentralClick(handler) {
    this._centralClickHandler = handler;
    this._syncInteractionListeners();
  }

  setCursorPointerOnHover() {
    this._hoverEnabled = true;
    this._bindHoverIfEnabled();
  }
}

/** Id de capa interactiva (símbolo si existe; compatibilidad con código que esperaba el círculo). */
export { SYMBOL_LAYER_ID as CENTRALES_CIRCLE_LAYER_ID };
