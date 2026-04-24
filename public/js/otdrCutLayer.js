import { getFtthMapIcon, pinSvgString } from './ftthMapIconsData.js';
import { rasterizeSvgStringForMapbox } from './rasterizeSvgForMapbox.js';
import {
  DEVICE_LABEL_LAYER_MIN_ZOOM,
  deviceLabelCollisionLayout,
  deviceLabelTextFieldFromProp,
  deviceLabelTextOpacityPaint,
  deviceLabelTextSizeLayout
} from './mapLabelZoom.js';

const SOURCE_ID = 'otdr-cut-source';
const SYMBOL_LAYER_ID = 'otdr-cut-symbol';
const CIRCLE_LAYER_ID = 'otdr-cut-circle';
const LABEL_ID = 'otdr-cut-label';
const ICON_IMAGE_ID = 'ftth-otdr-cut-map-icon';
/** Pin rojo con X (corte) en `public/icons/editor/otdr-cut-pin.png`. */
const OTDR_CUT_PNG_URL = '/icons/editor/otdr-cut-pin.png';

/** Capa Mapbox: punto de corte OTDR (único marcador). */
export class OtdrCutLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this._lastHadCut = false;
    this.sourceId = SOURCE_ID;
    this.symbolLayerId = SYMBOL_LAYER_ID;
    this.circleLayerId = CIRCLE_LAYER_ID;
    this.labelId = LABEL_ID;
    /** @type {Promise<void> | null} */
    this._iconRasterPromise = null;
  }

  _addLabelLayer() {
    if (this.map.getLayer(this.labelId)) return;
    this.map.addLayer({
      id: this.labelId,
      type: 'symbol',
      source: this.sourceId,
      minzoom: DEVICE_LABEL_LAYER_MIN_ZOOM,
      layout: {
        'text-field': deviceLabelTextFieldFromProp('label'),
        ...deviceLabelCollisionLayout(),
        'text-font': ['DIN Offc Pro Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': deviceLabelTextSizeLayout(18, 12),
        'text-offset': [0, 1.15],
        'text-anchor': 'top'
      },
      paint: {
        ...deviceLabelTextOpacityPaint(),
        'text-color': '#fef3c7',
        'text-halo-color': '#1c1917',
        'text-halo-width': 2
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
        'circle-radius': 11,
        'circle-color': '#fbbf24',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#1c1917',
        'circle-opacity': 1
      }
    });
  }

  _addSymbolLayer() {
    if (this.map.getLayer(this.symbolLayerId)) return;
    this.map.addLayer({
      id: this.symbolLayerId,
      type: 'symbol',
      source: this.sourceId,
      layout: {
        'icon-image': ICON_IMAGE_ID,
        /** PNG 64×64 (corte) o SVG raster 96; un tamaño intermedio sirve para ambos. */
        'icon-size': 0.42,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
  }

  _loadMapImage(url) {
    return new Promise((resolve, reject) => {
      this.map.loadImage(url, (err, img) => {
        if (err || !img) reject(err || new Error('loadImage'));
        else resolve(img);
      });
    });
  }

  _ensureGraphic() {
    if (this.map.getLayer(this.symbolLayerId) || this.map.getLayer(this.circleLayerId)) {
      this._addLabelLayer();
      return;
    }

    if (this.map.hasImage(ICON_IMAGE_ID)) {
      this._addSymbolLayer();
      this._addLabelLayer();
      return;
    }

    const afterRaster = () => {
      if (this.map.hasImage(ICON_IMAGE_ID)) {
        this._addSymbolLayer();
      } else {
        console.warn('OTDR: usando círculo (no se pudo registrar el icono de corte).');
        this._addCircleFallback();
      }
      if (!this.map.getLayer(this.labelId)) {
        this._addLabelLayer();
      }
    };

    if (!this._iconRasterPromise) {
      this._iconRasterPromise = this._loadMapImage(OTDR_CUT_PNG_URL)
        .then((img) => {
          if (!this.map.hasImage(ICON_IMAGE_ID)) {
            this.map.addImage(ICON_IMAGE_ID, img, { pixelRatio: 1 });
          }
        })
        .catch((e) => {
          console.warn('OTDR: PNG corte, se usa pin empalme (SVG)', e?.message || e);
          const ic = getFtthMapIcon('empalme');
          const svg = ic ? pinSvgString(ic) : '';
          return ic
            ? rasterizeSvgStringForMapbox(svg, 96).then((rgba) => {
                if (!this.map.hasImage(ICON_IMAGE_ID)) {
                  this.map.addImage(ICON_IMAGE_ID, rgba);
                }
              })
            : Promise.reject(new Error('icono empalme no definido'));
        })
        .finally(() => {
          afterRaster();
          this._iconRasterPromise = null;
        });
    }
  }

  ensureLayer() {
    if (this.map.getSource(this.sourceId)) {
      this._ensureGraphic();
      return;
    }

    this.map.addSource(this.sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    this._ensureGraphic();
  }

  clear() {
    if (!this.map.getSource(this.sourceId)) return;
    this.map.getSource(this.sourceId).setData({ type: 'FeatureCollection', features: [] });
    this._lastHadCut = false;
  }

  /** @returns {boolean} */
  hasMark() {
    return this._lastHadCut === true;
  }

  /**
   * @param {[number, number]} lngLat
   * @param {string} label
   */
  setCutPoint(lngLat, label) {
    this.ensureLayer();
    this._lastHadCut = true;
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: lngLat },
          properties: { label: label.slice(0, 80) }
        }
      ]
    };
    this.map.getSource(this.sourceId).setData(fc);
    try {
      if (this.map.getLayer(this.symbolLayerId)) this.map.moveLayer(this.symbolLayerId);
      else if (this.map.getLayer(this.circleLayerId)) this.map.moveLayer(this.circleLayerId);
      this.map.moveLayer(this.labelId);
    } catch {
      /* */
    }
  }

  bringToFront() {
    if (!this.map.getLayer(this.labelId)) return;
    try {
      if (this.map.getLayer(this.symbolLayerId)) this.map.moveLayer(this.symbolLayerId);
      else if (this.map.getLayer(this.circleLayerId)) this.map.moveLayer(this.circleLayerId);
      this.map.moveLayer(this.labelId);
    } catch {
      /* */
    }
  }
}
