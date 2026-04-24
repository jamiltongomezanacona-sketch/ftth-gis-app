/**
 * Pin de **evento** en el mapa: punto donde se mide (proyección del clic en el cable)
 * o referencia OTDR por clic en tramo.
 * Icono: raster desde `evento.svg` (fallback círculo rosa).
 *
 * Re-enganche: en `app.js`, `import { MedidaEventoMarkerLayer } from './medidaEventoMarkerLayer.js'`
 * e instanciar junto al flujo de reporte cuando se reactive el panel de evento.
 */

const SOURCE_ID = 'medida-evento-source';
const SYMBOL_LAYER_ID = 'medida-evento-symbol';
const CIRCLE_LAYER_ID = 'medida-evento-circle';
const ICON_IMAGE_ID = 'medida-evento-map-icon';
const EVENTO_SVG_URL = '/icons/ftth/evento.svg';

export class MedidaEventoMarkerLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this.sourceId = SOURCE_ID;
    this.symbolLayerId = SYMBOL_LAYER_ID;
    this.circleLayerId = CIRCLE_LAYER_ID;
    /** @type {Promise<void> | null} */
    this._iconPromise = null;
  }

  _addCircleFallback() {
    if (this.map.getLayer(this.circleLayerId)) return;
    this.map.addLayer({
      id: this.circleLayerId,
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-radius': 10,
        'circle-color': '#f43f5e',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#fff7ed',
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
        'icon-size': 0.42,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
  }

  _ensureGraphic() {
    if (this.map.getLayer(this.symbolLayerId) || this.map.getLayer(this.circleLayerId)) {
      return;
    }

    if (this.map.hasImage(ICON_IMAGE_ID)) {
      this._addSymbolLayer();
      return;
    }

    const after = () => {
      if (this.map.hasImage(ICON_IMAGE_ID)) {
        this._addSymbolLayer();
      } else {
        console.warn('Medida evento: usando círculo (icono no cargado).');
        this._addCircleFallback();
      }
    };

    if (!this._iconPromise) {
      this._iconPromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const W = 56;
            const H = 56;
            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('canvas'));
              return;
            }
            ctx.clearRect(0, 0, W, H);
            ctx.drawImage(img, 0, 0, W, H);
            const imageData = ctx.getImageData(0, 0, W, H);
            if (!this.map.hasImage(ICON_IMAGE_ID)) {
              this.map.addImage(ICON_IMAGE_ID, imageData, { pixelRatio: 1 });
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('svg'));
        img.src = EVENTO_SVG_URL;
      })
        .catch((e) => {
          console.warn('Medida evento SVG:', e?.message || e);
        })
        .finally(() => {
          after();
          this._iconPromise = null;
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
    this._ensureGraphic();
  }

  clear() {
    if (!this.map.getSource(this.sourceId)) return;
    this.map.getSource(this.sourceId).setData({ type: 'FeatureCollection', features: [] });
  }

  /**
   * @param {[number, number]} lngLat [lng, lat]
   */
  setPoint(lngLat) {
    this.ensureLayer();
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: lngLat },
          properties: {}
        }
      ]
    };
    this.map.getSource(this.sourceId).setData(fc);
    try {
      if (this.map.getLayer(this.symbolLayerId)) this.map.moveLayer(this.symbolLayerId);
      else if (this.map.getLayer(this.circleLayerId)) this.map.moveLayer(this.circleLayerId);
    } catch {
      /* */
    }
  }

  bringToFront() {
    if (!this.map.getSource(this.sourceId)) return;
    try {
      if (this.map.getLayer(this.symbolLayerId)) this.map.moveLayer(this.symbolLayerId);
      else if (this.map.getLayer(this.circleLayerId)) this.map.moveLayer(this.circleLayerId);
    } catch {
      /* */
    }
  }
}
