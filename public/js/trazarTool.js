/**
 * Trazar: medida de fibra (convención ÷1,2) desde inicio (A/central), final (B) o un punto en el tendido.
 */
import {
  lineLengthMeters,
  cutPointFromOtdrFiberMeters,
  cutPointFromFiberFromClickRef,
  distanceFromStartAlongLineMeters,
  lengthWithReserve20Pct,
  pointAlongLineAtGeometricDistance
} from './measurements.js';
import {
  setTrazarCutMarker,
  setTrazarRefMarker,
  clearTrazarCutMarker,
  clearTrazarRefMarker,
  bringTrazarCutLayerToFront,
  bringTrazarRefLayerToFront,
  ensureTrazarCutLayers
} from './trazarCutLayer.js';

/**
 * Línea única para medidas: LineString o MultiLineString (partes concatenadas).
 * @param {GeoJSON.Geometry | null | undefined} g
 * @returns {GeoJSON.LineString | null}
 */
function resolveLineStringGeometry(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return /** @type {GeoJSON.LineString} */ (g);
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates) && g.coordinates.length) {
    /** @type {GeoJSON.Position[]} */
    const merged = [];
    for (const part of g.coordinates) {
      if (!Array.isArray(part) || part.length < 2) continue;
      const last = merged[merged.length - 1];
      const first = part[0];
      if (last && first && last[0] === first[0] && last[1] === first[1]) {
        for (let i = 1; i < part.length; i++) merged.push(part[i]);
      } else {
        for (const p of part) merged.push(p);
      }
    }
    if (merged.length >= 2) return { type: 'LineString', coordinates: merged };
  }
  return null;
}

/**
 * @param {unknown} f
 * @returns {f is GeoJSON.Feature<GeoJSON.LineString>}
 */
function isLineStringFeature(f) {
  return (
    f != null &&
    typeof f === 'object' &&
    resolveLineStringGeometry(/** @type {GeoJSON.Feature} */ (f).geometry) != null
  );
}

/**
 * @typedef {object} TrazarControllerCtx
 * @property {import('mapbox-gl').Map} map
 * @property {() => object} getTurf
 * @property {() => GeoJSON.Feature<GeoJSON.LineString> | null} getSelectedFeature
 * @property {(f: import('mapbox-gl').MapboxGeoJSONFeature | null) => void} setRouteSelection
 * @property {(msg: string) => void} setStatus
 * @property {() => void} [scheduleMapResize]
 * @property {() => void} [refreshToolbar]
 * @property {() => void} [bumpLayersAfterPolylineMeasure]
 * @property {() => void} [deactivateMeasurePolyline]
 * @property {() => boolean} isEditing
 * @property {() => boolean} isPolyDrawing
 * @property {(n: number) => string} fmtM
 */

/**
 * @param {TrazarControllerCtx} ctx
 */
export function createTrazarController(ctx) {
  const {
    map,
    getTurf,
    getSelectedFeature,
    setRouteSelection,
    setStatus,
    scheduleMapResize,
    refreshToolbar,
    bumpLayersAfterPolylineMeasure,
    deactivateMeasurePolyline,
    isEditing,
    isPolyDrawing,
    fmtM
  } = ctx;

  const fiberIn = /** @type {HTMLInputElement | null} */ (document.getElementById('editor-trazar-fiber-m'));
  const refHintEl = document.getElementById('editor-trazar-ref-hint');
  const puntoWorkspace = document.getElementById('editor-trazar-punto-workspace');
  const fiberStepPill = document.getElementById('editor-trazar-fiber-step');
  const origenEls = document.querySelectorAll('input[name="editor-trazar-origen"]');
  const dirEls = document.querySelectorAll('input[name="editor-trazar-direccion"]');
  const dirBlock = document.getElementById('editor-trazar-dir-block');
  const applyBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('editor-trazar-apply'));

  /** @type {boolean} */
  let open = false;
  /** A | B | punto */
  let origen = /** @type {'A' | 'B' | 'punto'} */ ('A');
  /** toward_start = hacia central, toward_end = final de cable (valores radio inicio/final) */
  let direccion = /** @type {'toward_start' | 'toward_end'} */ ('toward_end');
  /** m desde inicio, solo origen=punto */
  let refDistFromStartM = /** @type {number | null} */ (null);
  /** Clave del tendido al que pertenece la referencia (modo punto). */
  let refLineKey = /** @type {string | null} */ (null);
  /** @type {string | number | null} */
  let lastLineId = null;
  /** Tras ocultar el sidebar con marcas en mapa, se permite seguir pulsando el tendido sin `open`. */
  let allowRefPickWithoutPanel = false;

  function getTurfNs() {
    return getTurf();
  }

  /**
   * Clave estable de tendido para invalidar referencia al cambiar de cable,
   * incluso cuando la feature no trae `id`.
   * @param {GeoJSON.Feature<GeoJSON.LineString> | import('mapbox-gl').MapboxGeoJSONFeature | null | undefined} f
   * @returns {string | null}
   */
  function routeKeyOfFeature(f) {
    if (!f) return null;
    const id = f.id;
    if (id != null && String(id).trim() !== '') return `id:${String(id)}`;
    const line = resolveLineStringGeometry(f.geometry);
    if (!line || !Array.isArray(line.coordinates) || line.coordinates.length < 2) return null;
    const a = line.coordinates[0];
    const z = line.coordinates[line.coordinates.length - 1];
    if (!a || !z) return null;
    return `geom:${line.coordinates.length}:${a[0]},${a[1]}:${z[0]},${z[1]}`;
  }

  /**
   * Etiqueta del pin según el origen de medida activo.
   * - A/B: mantiene "desde central" (histórico).
   * - Punto tramo: muestra metros efectivos "desde pin".
   */
  function cutLabel(r) {
    if (origen === 'punto') {
      const fromRefGeom = Number(r?.geometricFromRefM);
      if (!Number.isFinite(fromRefGeom)) return null;
      const fibFromRef = lengthWithReserve20Pct(fromRefGeom);
      return { primary: fmtM(fibFromRef), secondary: 'desde pin' };
    }
    const d = Number(r?.distanceFromStartAlongLineM);
    if (!Number.isFinite(d)) return null;
    const fib = lengthWithReserve20Pct(d);
    return { primary: fmtM(fib), secondary: 'desde central' };
  }

  function parseFiberM() {
    const raw = String(fiberIn?.value ?? '').trim().replace(',', '.');
    if (raw === '') return null;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  /**
   * Topes de fibra desde el pin de referencia por dirección (convención ×1,2).
   * @param {GeoJSON.LineString | null} line
   * @returns {{ toward_start_fiber_m: number, toward_end_fiber_m: number } | null}
   */
  function directionalFiberCapsFromRef(line) {
    if (!line || refDistFromStartM == null || !Number.isFinite(refDistFromStartM)) return null;
    const L = lineLengthMeters(line, getTurfNs());
    if (!Number.isFinite(L) || L < 0) return null;
    const toStartGeom = Math.min(Math.max(0, refDistFromStartM), L);
    const toEndGeom = Math.max(0, L - toStartGeom);
    return {
      toward_start_fiber_m: lengthWithReserve20Pct(toStartGeom),
      toward_end_fiber_m: lengthWithReserve20Pct(toEndGeom)
    };
  }

  function getOrigen() {
    for (const el of origenEls) {
      if (el instanceof HTMLInputElement && el.checked) {
        const v = el.value;
        if (v === 'A' || v === 'B' || v === 'punto') return v;
      }
    }
    return 'A';
  }

  function getDireccion() {
    for (const el of dirEls) {
      if (el instanceof HTMLInputElement && el.checked) {
        if (el.value === 'inicio') return 'toward_start';
        if (el.value === 'final') return 'toward_end';
      }
    }
    return 'toward_end';
  }

  function updateDirBlockVisible() {
    const isPunto = origen === 'punto';
    if (puntoWorkspace instanceof HTMLElement) {
      puntoWorkspace.hidden = !isPunto;
    }
    if (fiberStepPill instanceof HTMLElement) {
      fiberStepPill.hidden = !isPunto;
      fiberStepPill.setAttribute('aria-hidden', isPunto ? 'false' : 'true');
    }
    if (dirBlock) {
      dirBlock.setAttribute('aria-hidden', isPunto ? 'false' : 'true');
    }
  }

  /**
   * Pin violeta en el cable en la posición de referencia (solo modo punto).
   * @param {GeoJSON.Geometry | null | undefined} geom
   * @param {object} turfNs
   */
  function placeRefPinIfNeeded(geom, turfNs) {
    if (origen !== 'punto' || refDistFromStartM == null || !Number.isFinite(refDistFromStartM)) {
      try {
        clearTrazarRefMarker(map);
      } catch {
        /* */
      }
      return;
    }
    const line = resolveLineStringGeometry(geom);
    if (!line) {
      try {
        clearTrazarRefMarker(map);
      } catch {
        /* */
      }
      return;
    }
    const pt = pointAlongLineAtGeometricDistance(line, refDistFromStartM, turfNs);
    const c = pt?.geometry?.coordinates;
    if (c && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      try {
        setTrazarRefMarker(map, [c[0], c[1]]);
        bumpLayersAfterPolylineMeasure?.();
        bringTrazarRefLayerToFront(map);
        bringTrazarCutLayerToFront(map);
      } catch {
        /* */
      }
    } else {
      try {
        clearTrazarRefMarker(map);
      } catch {
        /* */
      }
    }
  }

  function clearRefIfCableChanged() {
    const f = getSelectedFeature();
    const id = f?.id != null ? f.id : null;
    if (lastLineId != null && id != null && id !== lastLineId) {
      refDistFromStartM = null;
      refLineKey = null;
    }
    lastLineId = id;
    if (!f || origen !== 'punto') return;
    const currentKey = routeKeyOfFeature(f);
    if (!currentKey || !refLineKey || currentKey === refLineKey) return;
    refDistFromStartM = null;
    refLineKey = null;
  }

  function syncRefHint(geom, turfNs) {
    if (!refHintEl) return;
    refHintEl.classList.remove('editor-trazar-ref--waiting', 'editor-trazar-ref--ok');
    if (origen !== 'punto') {
      refHintEl.textContent = '';
      refHintEl.hidden = true;
      return;
    }
    refHintEl.hidden = false;
    if (refDistFromStartM == null) {
      refHintEl.classList.add('editor-trazar-ref--waiting');
      refHintEl.textContent =
        'Pulsa el tendido en el mapa.';
      return;
    }
    const line = resolveLineStringGeometry(geom);
    if (!line) {
      refHintEl.classList.add('editor-trazar-ref--waiting');
      refHintEl.textContent = 'Selecciona un tendido con geometría de línea.';
      return;
    }
    const L = lineLengthMeters(line, turfNs);
    const caps = directionalFiberCapsFromRef(line);
    refHintEl.classList.add('editor-trazar-ref--ok');
    refHintEl.textContent = `Pin colocado. Desde el inicio del tramo (A) hasta el pin: ≈ ${fmtM(refDistFromStartM)} · Longitud total del tendido: ≈ ${fmtM(L)}.${caps ? ` Máximo desde pin -> hacia central: ≈ ${fmtM(caps.toward_start_fiber_m)} · hacia final: ≈ ${fmtM(caps.toward_end_fiber_m)}.` : ''}`;
  }

  function compute() {
    const f = getSelectedFeature();
    const line = resolveLineStringGeometry(f?.geometry);
    if (!line) {
      return null;
    }
    const turfNs = getTurfNs();
    const fib = parseFiberM();
    if (fib == null) {
      return null;
    }
    if (origen === 'punto' && (refDistFromStartM == null || !Number.isFinite(refDistFromStartM))) {
      return null;
    }
    if (origen === 'punto') {
      const currentKey = routeKeyOfFeature(f);
      if (!currentKey || !refLineKey || currentKey !== refLineKey) {
        return null;
      }
    }

    let r;
    if (origen === 'A') {
      r = cutPointFromOtdrFiberMeters(line, fib, 'start', turfNs);
    } else if (origen === 'B') {
      r = cutPointFromOtdrFiberMeters(line, fib, 'end', turfNs);
    } else {
      r = cutPointFromFiberFromClickRef(
        line,
        /** @type {number} */ (refDistFromStartM),
        fib,
        getDireccion(),
        turfNs
      );
    }
    const lng = r.point?.geometry?.coordinates?.[0];
    const lat = r.point?.geometry?.coordinates?.[1];
    return {
      ...r,
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null
    };
  }

  function applyToMap(focus) {
    const f = getSelectedFeature();
    if (!isLineStringFeature(f)) {
      setStatus('Trazar: selecciona un tendido en el mapa o búsqueda.');
      return;
    }
    if (origen === 'punto' && refDistFromStartM == null) {
      setStatus('Trazar: fija primero un punto de referencia tocando el cable.');
      return;
    }
    if (origen === 'punto') {
      const currentKey = routeKeyOfFeature(f);
      if (!currentKey || !refLineKey || currentKey !== refLineKey) {
        setStatus('Trazar: la referencia no coincide con el tendido actual. Pulsa de nuevo el cable para fijar el pin.');
        return;
      }
    }
    const r = compute();
    if (!r || !r.point) {
      setStatus('Trazar: no se pudo colocar el corte; revisa fibra (m) o la geometría.');
      return;
    }
    const coords = r.point.geometry.coordinates;
    ensureTrazarCutLayers(map);
    setTrazarCutMarker(map, [coords[0], coords[1]], { centralLabel: cutLabel(r) });
    try {
      bumpLayersAfterPolylineMeasure?.();
      bringTrazarCutLayerToFront(map);
    } catch {
      /* */
    }
    if (focus) {
      try {
        const pad = 85;
        map.easeTo({
          center: [coords[0], coords[1]],
          padding: { top: 24, bottom: pad, left: 0, right: 0 },
          duration: 520
        });
      } catch (e) {
        console.warn('Trazar easeTo', e);
      }
    }
    scheduleMapResize?.();
    if (r.clamped && origen === 'punto') {
      const line = resolveLineStringGeometry(f?.geometry);
      const caps = directionalFiberCapsFromRef(line);
      const maxFiber =
        direccion === 'toward_start' ? caps?.toward_start_fiber_m : caps?.toward_end_fiber_m;
      setStatus(
        `Trazar: punto marcado en el extremo del cable (tope en esta dirección: ${Number.isFinite(maxFiber) ? fmtM(Number(maxFiber)) : '—'}).`
      );
    } else {
      setStatus(
        r.clamped
          ? 'Trazar: punto marcado (distancia ajustada al tramo).'
          : 'Trazar: punto de corte marcado en el mapa.'
      );
    }
  }

  function onInput() {
    origen = getOrigen();
    direccion = getDireccion();
    updateDirBlockVisible();
    clearRefIfCableChanged();
    const f = getSelectedFeature();
    const geom = f?.geometry;
    syncRefHint(geom, getTurfNs());
    placeRefPinIfNeeded(geom, getTurfNs());
    if (isPolyDrawing() || isEditing()) return;
    const r = compute();
    if (r?.point) {
      const c = r.point.geometry.coordinates;
      setTrazarCutMarker(map, [c[0], c[1]], { centralLabel: cutLabel(r) });
      try {
        bumpLayersAfterPolylineMeasure?.();
        bringTrazarCutLayerToFront(map);
      } catch {
        /* */
      }
    } else {
      try {
        clearTrazarCutMarker(map);
      } catch {
        /* */
      }
    }
  }

  function installDom() {
    for (const el of origenEls) {
      el.addEventListener('change', () => {
        origen = getOrigen();
        if (origen !== 'punto') {
          refDistFromStartM = null;
          refLineKey = null;
        }
        onInput();
      });
    }
    for (const el of dirEls) {
      el.addEventListener('change', onInput);
    }
    fiberIn?.addEventListener('input', onInput);
    fiberIn?.addEventListener('change', onInput);
    applyBtn?.addEventListener('click', () => applyToMap(true));
  }

  installDom();
  origen = getOrigen();
  updateDirBlockVisible();

  /** Sincroniza UI con el tendido seleccionado (pins de referencia, hints). */
  function syncForm() {
    const f = getSelectedFeature();
    lastLineId = f?.id != null ? f.id : null;
    origen = getOrigen();
    updateDirBlockVisible();
    const g = f?.geometry;
    if (resolveLineStringGeometry(g)) {
      syncRefHint(g, getTurfNs());
      placeRefPinIfNeeded(g, getTurfNs());
    } else {
      syncRefHint(null, getTurfNs());
      placeRefPinIfNeeded(null, getTurfNs());
    }
  }

  return {
    /** @returns {boolean} false si no se pudo abrir (edición / medición activa) */
    open() {
      if (isEditing() || isPolyDrawing()) {
        setStatus('Trazar: no disponible mientras editas o mides con polilínea.');
        return false;
      }
      open = true;
      allowRefPickWithoutPanel = false;
      deactivateMeasurePolyline?.();
      try {
        document.body.classList.add('editor-trazar-side-open');
      } catch {
        /* */
      }
      origen = getOrigen();
      direccion = getDireccion();
      clearRefIfCableChanged();
      syncForm();
      onInput();
      refreshToolbar?.();
      return true;
    },
    /**
     * Cierra la sesión de panel Trazar.
     * @param {{ keepMapMark?: boolean }} [opts] Si `keepMapMark: true`, no quita el pin ni la referencia en mapa (p. ej. al ocultar solo el sidebar).
     */
    close(opts) {
      const keepMapMark = Boolean(opts?.keepMapMark);
      open = false;
      allowRefPickWithoutPanel = keepMapMark;
      try {
        if (!keepMapMark) {
          clearTrazarRefMarker(map);
          clearTrazarCutMarker(map);
        }
        document.body.classList.remove('editor-trazar-side-open');
      } catch {
        /* */
      }
      if (!keepMapMark) {
        refDistFromStartM = null;
        refLineKey = null;
      }
      refreshToolbar?.();
    },
    isOpen: () => open,
    syncForm,
    /**
     * @param {import('mapbox-gl').MapLayerMouseEvent} _e
     * @param {import('mapbox-gl').MapboxGeoJSONFeature} f
     * @returns {boolean} true si consumió el evento
     */
    handleRouteLineClick(_e, f) {
      if (!open && !allowRefPickWithoutPanel) return false;
      if (isEditing() || isPolyDrawing()) return false;
      if (getOrigen() !== 'punto') return false;
      const line = resolveLineStringGeometry(f.geometry);
      if (!line) return false;
      const t = getTurfNs();
      setRouteSelection(/** @type {any} */ (f));
      const lat = _e.lngLat?.lat;
      const lng = _e.lngLat?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
      refDistFromStartM = distanceFromStartAlongLineMeters(
        line,
        [lng, lat],
        t
      );
      refLineKey = routeKeyOfFeature(/** @type {any} */ (f));
      setStatus(
        'Trazar: pin de referencia colocado. Elige hacia central o final de cable e indica los metros de fibra.'
      );
      syncForm();
      onInput();
      return true;
    }
  };
}
