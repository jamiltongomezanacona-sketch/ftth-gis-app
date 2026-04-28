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

/** Tolerancia (m) para considerar el mismo tendido si cambia levemente la fuente GeoJSON. */
const ROUTE_LEN_MATCH_TOLERANCE_M = 3;
import {
  setTrazarCutMarker,
  setTrazarRefMarker,
  clearTrazarCutMarker,
  clearTrazarRefMarker,
  bringTrazarCutLayerToFront,
  bringTrazarRefLayerToFront,
  ensureTrazarCutLayers
} from './trazarCutLayer.js';
import { mergeConnectedRouteLinesForTrazar } from './routeChainGeometry.js';

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
 * @property {() => GeoJSON.Feature[]} [getRouteLinesForChain] tendidos visibles en capa (p. ej. molécula) para encadenar medida
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
    fmtM,
    getRouteLinesForChain
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
  /** Id del tendido anclado al pin (si la feature lo trae en el clic). */
  let refRouteId = /** @type {string | null} */ (null);
  /** Extremos del tendido al anclar (evita fallos id vs sin-id entre capa y búsqueda). */
  let refEndsKey = /** @type {string | null} */ (null);
  /** Longitud del tendido (m) al anclar; compara con tolerancia si la geometría viene de otra fuente. */
  let refAnchorLenM = /** @type {number | null} */ (null);
  /** @type {string | number | null} */
  let lastLineId = null;
  /** Clic que fijó el pin (para encadenar polilíneas y recalcular posición sobre la línea unida). */
  let refClickLngLat = /** @type {[number, number] | null} */ (null);
  /** Tras ocultar el sidebar con marcas en mapa, se permite seguir pulsando el tendido sin `open`. */
  let allowRefPickWithoutPanel = false;

  function getTurfNs() {
    return getTurf();
  }

  /**
   * Primer y último vértice redondeados (estable entre fuentes / precisión flotante).
   * @param {GeoJSON.LineString | null} line
   */
  function endsKeyFromLine(line) {
    if (!line?.coordinates?.length) return null;
    const a = line.coordinates[0];
    const z = line.coordinates[line.coordinates.length - 1];
    const r = (/** @type {number} */ x) => Math.round(x * 1e6) / 1e6;
    return `${r(a[0])},${r(a[1])}|${r(z[0])},${r(z[1])}`;
  }

  /**
   * El tendido seleccionado es el mismo al que se ancló el pin (modo punto).
   * Resuelve el caso clic sin `id` + selección desde búsqueda con `id` (o geometría equivalente).
   * @param {GeoJSON.Feature<GeoJSON.LineString> | import('mapbox-gl').MapboxGeoJSONFeature | null | undefined} f
   */
  function routeMatchesAnchor(f) {
    const line = resolveLineStringGeometry(f?.geometry);
    if (!line) return false;
    const tid = f?.id != null && String(f.id).trim() !== '' ? String(f.id) : null;
    if (refRouteId != null && tid != null && refRouteId === tid) return true;
    if (!refEndsKey) return false;
    if (endsKeyFromLine(line) !== refEndsKey) return false;
    if (refAnchorLenM == null || !Number.isFinite(refAnchorLenM)) {
      return true;
    }
    const t = getTurfNs();
    let curLen = 0;
    try {
      curLen = lineLengthMeters(line, t);
    } catch {
      return true;
    }
    return Math.abs(curLen - refAnchorLenM) <= ROUTE_LEN_MATCH_TOLERANCE_M;
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
      const primary = fmtM(fibFromRef);
      const askedFib = Number(r?.fiberReadingM);
      if (r?.clamped && Number.isFinite(askedFib) && askedFib > 0) {
        const tope =
          direccion === 'toward_end'
            ? 'Tope: final de esta polilínea en el mapa'
            : 'Tope: inicio de esta polilínea (central)';
        return {
          primary,
          secondary: tope,
          detail: `Pediste ${fmtM(askedFib)}`
        };
      }
      return { primary, secondary: 'desde pin' };
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
   * @param {GeoJSON.LineString | null} line línea de medida (ancla o encadenada)
   * @param {number | null | undefined} refAlongFromLineStart m desde el inicio de `line` hasta el pin (encadenado u ancla)
   * @returns {{ toward_start_fiber_m: number, toward_end_fiber_m: number } | null}
   */
  function directionalFiberCapsFromRef(line, refAlongFromLineStart) {
    const refD =
      refAlongFromLineStart != null && Number.isFinite(refAlongFromLineStart)
        ? refAlongFromLineStart
        : refDistFromStartM;
    if (!line || refD == null || !Number.isFinite(refD)) return null;
    const L = lineLengthMeters(line, getTurfNs());
    if (!Number.isFinite(L) || L < 0) return null;
    const toStartGeom = Math.min(Math.max(0, refD), L);
    const toEndGeom = Math.max(0, L - toStartGeom);
    return {
      toward_start_fiber_m: lengthWithReserve20Pct(toStartGeom),
      toward_end_fiber_m: lengthWithReserve20Pct(toEndGeom)
    };
  }

  /**
   * Línea efectiva modo punto (ancla ± tendidos conectados en la misma capa).
   * @returns {{ line: GeoJSON.LineString; refAlong: number; chained: boolean } | null}
   */
  function resolvePuntoMeasureContext() {
    const f = getSelectedFeature();
    const anchorLine = resolveLineStringGeometry(f?.geometry);
    if (!anchorLine || refDistFromStartM == null || !Number.isFinite(refDistFromStartM)) return null;
    const turfNs = getTurfNs();
    let line = anchorLine;
    let refAlong = refDistFromStartM;
    let chained = false;
    try {
      const flist = typeof getRouteLinesForChain === 'function' ? getRouteLinesForChain() : [];
      if (flist?.length >= 1 && refClickLngLat) {
        const m = mergeConnectedRouteLinesForTrazar(
          flist,
          f,
          refDistFromStartM,
          refClickLngLat,
          turfNs,
          1
        );
        // Solo sustituir geometría cuando hay tramos vecinos reales. Si no, medimos como antes
        // sobre el LineString del ancla + refDistFromStartM (evita redondeo/proyección distinta).
        if (m?.merged?.coordinates?.length >= 2 && m.chained) {
          const Lm = lineLengthMeters(m.merged, turfNs);
          const La = lineLengthMeters(anchorLine, turfNs);
          const ra = m.refAlongMerged;
          const rs = refDistFromStartM;
          const okLen = Lm + 0.25 >= La;
          const okRef =
            Number.isFinite(ra) && ra >= rs - 3 && ra <= Lm + 2;
          if (okLen && okRef) {
            line = m.merged;
            refAlong = ra;
            chained = true;
          }
        }
      }
    } catch (e) {
      console.warn('Trazar encadenado rutas', e);
    }
    return { line, refAlong, chained };
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

  function clearAnchorState() {
    refDistFromStartM = null;
    refRouteId = null;
    refEndsKey = null;
    refAnchorLenM = null;
  }

  function clearRefIfCableChanged() {
    const f = getSelectedFeature();
    const id = f?.id != null ? f.id : null;
    if (lastLineId != null && id != null && id !== lastLineId) {
      clearAnchorState();
    }
    lastLineId = id;
    if (!f || origen !== 'punto') return;
    if (refDistFromStartM != null && Number.isFinite(refDistFromStartM) && !routeMatchesAnchor(f)) {
      clearAnchorState();
    }
  }

  function syncRefHint(geom, turfNs) {
    if (!refHintEl) return;
    refHintEl.textContent = '';
    refHintEl.hidden = true;
    refHintEl.classList.remove('editor-trazar-ref--waiting', 'editor-trazar-ref--ok');
    return;
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
    if (origen === 'punto' && !routeMatchesAnchor(f)) {
      return null;
    }

    let r;
    if (origen === 'A') {
      r = cutPointFromOtdrFiberMeters(line, fib, 'start', turfNs);
    } else if (origen === 'B') {
      r = cutPointFromOtdrFiberMeters(line, fib, 'end', turfNs);
    } else {
      const pc = resolvePuntoMeasureContext();
      if (!pc) return null;
      r = cutPointFromFiberFromClickRef(pc.line, pc.refAlong, fib, getDireccion(), turfNs);
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
    if (origen === 'punto' && !routeMatchesAnchor(f)) {
      setStatus(
        'Trazar: la referencia no coincide con el tendido actual. Pulsa de nuevo el cable para fijar el pin.'
      );
      return;
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
      const pc = resolvePuntoMeasureContext();
      const capLine = pc?.line ?? resolveLineStringGeometry(f?.geometry);
      const refForCaps = pc?.refAlong ?? refDistFromStartM;
      const caps = directionalFiberCapsFromRef(capLine, refForCaps);
      const maxFiber =
        direccion === 'toward_start' ? caps?.toward_start_fiber_m : caps?.toward_end_fiber_m;
      const asked = Number(r.fiberReadingM);
      const maxStr = Number.isFinite(maxFiber) ? fmtM(Number(maxFiber)) : '—';
      const askedStr = Number.isFinite(asked) ? fmtM(asked) : '—';
      const chainHint = pc?.chained
        ? ' Se incluyeron tramos conectados por vértice en la capa actual.'
        : ' Si falta tendido, revisa geometría GIS o busca la molécula para cargar todos los tramos.';
      setStatus(
        `Trazar: tope en la cadena dibujada (≈ ${maxStr} fibra desde el pin; pediste ${askedStr}).${chainHint} ÷1,2 tendido/fibra.`
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
          clearAnchorState();
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
        clearAnchorState();
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
      const fid = f.id;
      refRouteId =
        fid != null && String(fid).trim() !== '' ? String(fid) : null;
      refEndsKey = endsKeyFromLine(line);
      try {
        refAnchorLenM = lineLengthMeters(line, t);
      } catch {
        refAnchorLenM = null;
      }
      refClickLngLat = [lng, lat];
      setStatus(
        'Trazar: origen de medida fijado en el tendido. Indica metros de fibra (OTDR/evento) y sentido; el mapa usa tendido ÷ 1,2 (reserva ~20 %).'
      );
      syncForm();
      onInput();
      return true;
    }
  };
}
