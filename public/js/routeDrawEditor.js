/**
 * Editor de líneas con @mapbox/mapbox-gl-draw (vértices, añadir, borrar).
 * Requiere globales: `mapboxgl` y `MapboxDraw`.
 */

export class RouteDrawEditor {
  /**
   * @param {import('mapbox-gl').Map} map
   * @param {{ onGeometryChange?: (geom: GeoJSON.LineString|null) => void }} [opts]
   */
  constructor(map, opts = {}) {
    this.map = map;
    this.onGeometryChange = opts.onGeometryChange ?? (() => {});
    /** @type {InstanceType<typeof MapboxDraw>|null} */
    this.draw = null;
    /** @type {string|null} id interno de Draw */
    this.drawFeatureId = null;
    /** Tras terminar draw_line_string, pasar a direct_select sobre la nueva línea */
    this._pendingNewLineSelect = false;
  }

  attach() {
    if (this.draw) return;

    const MapboxDraw = globalThis.MapboxDraw;
    if (!MapboxDraw) {
      const err = new Error('MapboxDraw no está cargado (¿mapbox-gl-draw.js antes de app.js?)');
      console.error(err);
      throw err;
    }

    try {
      this.draw = new MapboxDraw({
        displayControlsDefault: false,
        /* En direct_select los puntos medios permiten añadir vértices; papelera borra selección/aristas. */
        controls: { trash: true },
        defaultMode: 'simple_select'
      });

      this.map.addControl(this.draw, 'top-right');

      const emit = () => {
        const g = this.getActiveLineGeometry();
        this.onGeometryChange(g);
      };

      this.map.on('draw.create', (e) => {
        if (this._pendingNewLineSelect && e.features?.[0]?.id != null) {
          this._pendingNewLineSelect = false;
          this.drawFeatureId = e.features[0].id;
          this.draw.changeMode('direct_select', { featureId: this.drawFeatureId });
        }
        emit();
      });
      this.map.on('draw.update', emit);
      this.map.on('draw.delete', emit);
    } catch (e) {
      this.draw = null;
      console.error('MapboxDraw onAdd / eventos:', e);
      throw e;
    }
  }

  /** Dibuja una línea nueva; al cerrar el trazo se puede refinar en direct_select. */
  startNewLineDrawing() {
    if (!this.draw) this.attach();
    this._pendingNewLineSelect = true;
    this.draw.deleteAll();
    this.drawFeatureId = null;
    this.draw.changeMode('draw_line_string');
    this.onGeometryChange(this.getActiveLineGeometry());
  }

  /** @param {GeoJSON.Feature<GeoJSON.LineString>} feature */
  startEdit(feature) {
    if (!this.draw) this.attach();
    this._pendingNewLineSelect = false;
    this.draw.deleteAll();
    const clone = structuredClone(feature);
    clone.id = clone.id ?? clone.properties?.id;
    const ids = this.draw.add(clone);
    this.drawFeatureId = ids[0] ?? null;
    if (this.drawFeatureId) {
      this.draw.changeMode('direct_select', { featureId: this.drawFeatureId });
    }
    this.onGeometryChange(this.getActiveLineGeometry());
  }

  cancel() {
    if (!this.draw) return;
    this._pendingNewLineSelect = false;
    this.draw.deleteAll();
    this.drawFeatureId = null;
    this.draw.changeMode('simple_select');
    this.onGeometryChange(null);
  }

  /** Geometría LineString actual en Draw, o null. */
  getActiveLineGeometry() {
    if (!this.draw) return null;
    const fc = this.draw.getAll();
    const f = fc.features.find((x) => x.geometry?.type === 'LineString');
    if (!f?.geometry || f.geometry.type !== 'LineString') return null;
    return /** @type {GeoJSON.LineString} */ (f.geometry);
  }

  isEditing() {
    return Boolean(this.drawFeatureId && this.getActiveLineGeometry());
  }

  /**
   * Sustituye la LineString activa en Draw (misma sesión de edición).
   * @param {GeoJSON.LineString} newGeom
   * @returns {boolean}
   */
  replaceActiveLineGeometry(newGeom) {
    if (!this.draw || newGeom?.type !== 'LineString' || !Array.isArray(newGeom.coordinates)) {
      return false;
    }
    if (newGeom.coordinates.length < 2) return false;

    const fc = this.draw.getAll();
    const f = fc.features.find((x) => x.geometry?.type === 'LineString');
    if (!f?.id) return false;

    const id = String(f.id);
    const props = f.properties && typeof f.properties === 'object' ? { ...f.properties } : {};
    this.draw.delete(id);

    const nf = /** @type {GeoJSON.Feature<GeoJSON.LineString>} */ ({
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'LineString',
        coordinates: newGeom.coordinates
      }
    });
    const ids = this.draw.add(nf);
    this.drawFeatureId = ids[0] != null ? String(ids[0]) : null;
    if (this.drawFeatureId) {
      this.draw.changeMode('direct_select', { featureId: this.drawFeatureId });
    }
    this.onGeometryChange(this.getActiveLineGeometry());
    return true;
  }
}
