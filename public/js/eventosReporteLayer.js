/**
 * Puntos de eventos / incidencias (`eventos_reporte`) en el mapa.
 * Icono: cuadrado rojo con X blanca (`/icons/ftth/eventos-x-pin.png`).
 * Si falla la imagen, se usa una capa `circle` para que los puntos sigan visibles.
 */

const SOURCE_ID = 'eventos-reporte-src';
const IMAGE_ID = 'eventos-reporte-x-icon';
/** Capa interactiva (clic / cursor): símbolo con imagen. */
export const EVENTOS_REPORTE_LAYER_ID = 'eventos-reporte-symbols';
/** Fallback cuando no carga el PNG (misma fuente GeoJSON). */
export const EVENTOS_REPORTE_CIRCLE_LAYER_ID = 'eventos-reporte-circles';

/** Todas las capas que reciben clic / cursor (símbolo o círculo). */
export const EVENTOS_REPORTE_INTERACTIVE_LAYER_IDS = [
  EVENTOS_REPORTE_LAYER_ID,
  EVENTOS_REPORTE_CIRCLE_LAYER_ID
];

const ICON_URL = '/icons/ftth/eventos-x-pin.png';

export class EventosReporteLayer {
  /**
   * @param {import('mapbox-gl').Map} map
   */
  constructor(map) {
    this.map = map;
    this.sourceId = SOURCE_ID;
    this.symbolLayerId = EVENTOS_REPORTE_LAYER_ID;
    this.circleLayerId = EVENTOS_REPORTE_CIRCLE_LAYER_ID;
    this.imageId = IMAGE_ID;
    /** @type {boolean} */
    this._imageLoading = false;
    /**
     * Visibilidad deseada por el cliente. Empieza `false` para evitar el
     * "flash" de pines al abrir el editor: solo aparecen cuando hay una
     * molécula buscada (regla controlada en `app.js`).
     * @type {boolean}
     */
    this._desiredVisibility = false;
  }

  _addSymbolLayer() {
    if (this.map.getLayer(this.symbolLayerId)) return;
    this.map.addLayer({
      id: this.symbolLayerId,
      type: 'symbol',
      source: this.sourceId,
      layout: {
        'icon-image': this.imageId,
        'icon-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.48,
          14,
          0.66,
          18,
          0.82
        ],
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        visibility: this._desiredVisibility ? 'visible' : 'none'
      },
      paint: {
        'icon-opacity': 0.98
      }
    });
  }

  _addCircleLayer() {
    if (this.map.getLayer(this.circleLayerId)) return;
    this.map.addLayer({
      id: this.circleLayerId,
      type: 'circle',
      source: this.sourceId,
      layout: {
        visibility: this._desiredVisibility ? 'visible' : 'none'
      },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 8, 18, 10],
        'circle-color': '#dc2626',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fef2f2',
        'circle-opacity': 0.95
      }
    });
  }

  /**
   * Carga el PNG en Mapbox y crea la capa `symbol` (o reintenta si aún no hay imagen).
   */
  ensureLayer() {
    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (this.map.getLayer(this.symbolLayerId) || this.map.getLayer(this.circleLayerId)) {
      return;
    }

    if (this.map.hasImage(this.imageId)) {
      this._addSymbolLayer();
      return;
    }

    if (this._imageLoading) {
      return;
    }
    this._imageLoading = true;

    this.map.loadImage(ICON_URL, (err, image) => {
      this._imageLoading = false;
      if (err || !image) {
        console.warn('Eventos: no se pudo cargar el icono', ICON_URL, err);
        try {
          this._addCircleLayer();
        } catch (e) {
          console.warn('Eventos: capa círculo fallback falló', e);
        }
        return;
      }
      try {
        if (!this.map.hasImage(this.imageId)) {
          this.map.addImage(this.imageId, /** @type {HTMLImageElement | ImageBitmap} */ (image));
        }
        this._addSymbolLayer();
      } catch (e) {
        console.warn('Eventos: addImage falló', e);
        try {
          this._addCircleLayer();
        } catch (e2) {
          console.warn('Eventos: capa círculo fallback falló', e2);
        }
      }
    });
  }

  /**
   * @param {import('geojson').FeatureCollection} fc
   */
  setData(fc) {
    this.ensureLayer();
    const src = this.map.getSource(this.sourceId);
    if (!src || src.type !== 'geojson') return;
    const safe =
      fc && fc.type === 'FeatureCollection' && Array.isArray(fc.features)
        ? fc
        : { type: 'FeatureCollection', features: [] };
    src.setData(safe);
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    /* Memorizar el deseo aunque la capa todavía no exista (carga async de
       la imagen): cuando _addSymbolLayer/_addCircleLayer se ejecute, leerá
       este flag para nacer con la visibilidad correcta. */
    this._desiredVisibility = !!visible;
    const v = visible ? 'visible' : 'none';
    for (const id of [this.symbolLayerId, this.circleLayerId]) {
      if (!this.map.getLayer(id)) continue;
      try {
        const cur = this.map.getLayoutProperty(id, 'visibility');
        if (cur === v) continue;
        this.map.setLayoutProperty(id, 'visibility', v);
      } catch {
        /* */
      }
    }
  }

  bringToFront() {
    for (const id of [this.symbolLayerId, this.circleLayerId]) {
      if (!this.map.getLayer(id)) continue;
      try {
        this.map.moveLayer(id);
      } catch {
        /* */
      }
    }
  }
}
