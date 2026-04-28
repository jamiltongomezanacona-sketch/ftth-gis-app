/**
 * Fibra GIS — medida OTDR en tendido (convención fibra ÷ 1,2) desde central, final o pin en el cable.
 * Sustituye la herramienta histórica «Trazar» con la misma geometría y encadenado por vértices.
 */
import {
  lineLengthMeters,
  cutPointFromOtdrFiberMeters,
  cutPointFromFiberFromClickRef,
  distanceFromStartAlongLineMeters,
  lengthWithReserve20Pct,
  pointAlongLineAtGeometricDistance
} from './measurements.js';

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
import { buildPuntoTramoPinLabel } from './trazarPuntoLabel.js';

/**
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
 * @typedef {object} FiberTraceControllerCtx
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
 * @property {() => GeoJSON.Feature[]} [getRouteLinesForChain]
 */

/**
 * @param {FiberTraceControllerCtx} ctx
 */
export function createFiberTraceController(ctx) {
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

  const fiberIn = /** @type {HTMLInputElement | null} */ (document.getElementById('editor-ft-fiber-m'));
  const puntoWorkspace = document.getElementById('editor-ft-punto-zone');
  const fiberStepPill = document.getElementById('editor-ft-fiber-step');
  const origenEls = document.querySelectorAll('input[name="editor-ft-origen"]');
  const dirEls = document.querySelectorAll('input[name="editor-ft-direccion"]');
  const dirBlock = document.getElementById('editor-ft-dir-block');
  const applyBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('editor-ft-apply'));
  const capsEl = document.getElementById('editor-ft-caps');
  const capStartEl = document.getElementById('editor-ft-cap-start');
  const capEndEl = document.getElementById('editor-ft-cap-end');
  const totalHintEl = document.getElementById('editor-ft-total-hint');

  /** @type {boolean} */
  let open = false;
  let origen = /** @type {'A' | 'B' | 'punto'} */ ('A');
  let direccion = /** @type {'toward_start' | 'toward_end'} */ ('toward_end');
  let refDistFromStartM = /** @type {number | null} */ (null);
  let refRouteId = /** @type {string | null} */ (null);
  let refEndsKey = /** @type {string | null} */ (null);
  let refAnchorLenM = /** @type {number | null} */ (null);
  /** @type {string | number | null} */
  let lastLineId = null;
  let refClickLngLat = /** @type {[number, number] | null} */ (null);
  let allowRefPickWithoutPanel = false;

  function getTurfNs() {
    return getTurf();
  }

  function endsKeyFromLine(line) {
    if (!line?.coordinates?.length) return null;
    const a = line.coordinates[0];
    const z = line.coordinates[line.coordinates.length - 1];
    const r = (/** @type {number} */ x) => Math.round(x * 1e6) / 1e6;
    return `${r(a[0])},${r(a[1])}|${r(z[0])},${r(z[1])}`;
  }

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

  function cutLabel(r) {
    /** Siempre leer el modo desde el DOM (evita «desde central» con pin cuando la variable interna va desfasada). */
    const mode = getOrigen();
    if (mode === 'punto') {
      /** @type {{ totalCableFiberM: number; refAlongGeomM: number; lineGeomM: number } | undefined} */
      let meta;
      if (r?.clamped) {
        const pc = resolvePuntoMeasureContext();
        const ln = pc?.line;
        if (ln && pc.refAlong != null) {
          const t = getTurfNs();
          const Lgeom = lineLengthMeters(ln, t);
          if (Number.isFinite(Lgeom) && Number.isFinite(pc.refAlong)) {
            meta = {
              totalCableFiberM: lengthWithReserve20Pct(Lgeom),
              refAlongGeomM: pc.refAlong,
              lineGeomM: Lgeom
            };
          }
        }
      }
      return buildPuntoTramoPinLabel(r, getDireccion(), fmtM, meta);
    }
    const d = Number(r?.distanceFromStartAlongLineM);
    if (!Number.isFinite(d)) return null;
    const fib = lengthWithReserve20Pct(d);
    return {
      primary: fmtM(fib),
      secondary: mode === 'B' ? 'desde final' : 'desde central'
    };
  }

  function parseFiberM() {
    const raw = String(fiberIn?.value ?? '').trim().replace(',', '.');
    if (raw === '') return null;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

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
        if (m?.merged?.coordinates?.length >= 2 && m.chained) {
          const Lm = lineLengthMeters(m.merged, turfNs);
          const La = lineLengthMeters(anchorLine, turfNs);
          const ra = m.refAlongMerged;
          const rs = refDistFromStartM;
          const okLen = Lm + 0.25 >= La;
          const okRef = Number.isFinite(ra) && ra >= rs - 3 && ra <= Lm + 2;
          if (okLen && okRef) {
            line = m.merged;
            refAlong = ra;
            chained = true;
          }
        }
      }
    } catch (e) {
      console.warn('Fibra GIS encadenado rutas', e);
    }
    return { line, refAlong, chained };
  }

  function updateCapabilityStrip() {
    if (!capsEl || !capStartEl || !capEndEl) return;
    if (origen !== 'punto' || refDistFromStartM == null || !Number.isFinite(refDistFromStartM)) {
      capsEl.hidden = true;
      return;
    }
    const f = getSelectedFeature();
    const pc = resolvePuntoMeasureContext();
    const capLine = pc?.line ?? resolveLineStringGeometry(f?.geometry);
    const refForCaps = pc?.refAlong ?? refDistFromStartM;
    const caps = directionalFiberCapsFromRef(capLine, refForCaps);
    if (!caps) {
      capsEl.hidden = true;
      return;
    }
    capStartEl.textContent = fmtM(caps.toward_start_fiber_m);
    capEndEl.textContent = fmtM(caps.toward_end_fiber_m);
    capsEl.hidden = false;

    if (totalHintEl && pc?.line) {
      const t = getTurfNs();
      try {
        const L = lineLengthMeters(pc.line, t);
        if (Number.isFinite(L) && L > 0) {
          totalHintEl.textContent = `Longitud tendido en esta medida: ~${fmtM(lengthWithReserve20Pct(L))} fibra (GIS${pc.chained ? ', cadena por vértices' : ''}).`;
          totalHintEl.hidden = false;
        } else {
          totalHintEl.hidden = true;
        }
      } catch {
        totalHintEl.hidden = true;
      }
    } else if (totalHintEl) {
      totalHintEl.hidden = true;
    }
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
    if (!isPunto && capsEl) capsEl.hidden = true;
    if (!isPunto && totalHintEl) totalHintEl.hidden = true;
  }

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

  function compute() {
    origen = getOrigen();
    direccion = getDireccion();
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
    origen = getOrigen();
    direccion = getDireccion();
    const f = getSelectedFeature();
    if (!isLineStringFeature(f)) {
      setStatus('Fibra GIS: selecciona un tendido en el mapa o en la búsqueda.');
      return;
    }
    if (origen === 'punto' && refDistFromStartM == null) {
      setStatus('Fibra GIS: primero fija el pin tocando el cable.');
      return;
    }
    if (origen === 'punto' && !routeMatchesAnchor(f)) {
      setStatus(
        'Fibra GIS: la referencia no coincide con el tendido actual. Pulsa de nuevo el cable para anclar el pin.'
      );
      return;
    }
    const r = compute();
    if (!r || !r.point) {
      setStatus('Fibra GIS: no se pudo colocar el punto; revisa metros de fibra o la geometría.');
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
        console.warn('Fibra GIS easeTo', e);
      }
    }
    scheduleMapResize?.();
    if (r.clamped && getOrigen() === 'punto') {
      const pc = resolvePuntoMeasureContext();
      const capLine = pc?.line ?? resolveLineStringGeometry(f?.geometry);
      const refForCaps = pc?.refAlong ?? refDistFromStartM;
      const caps = directionalFiberCapsFromRef(capLine, refForCaps);
      const maxFiber =
        direccion === 'toward_start' ? caps?.toward_start_fiber_m : caps?.toward_end_fiber_m;
      const asked = Number(r.fiberReadingM);
      const maxStr = Number.isFinite(maxFiber) ? fmtM(Number(maxFiber)) : '—';
      const askedStr = Number.isFinite(asked) ? fmtM(asked) : '—';
      const chainHint = pc?.chained ? ' Cadena GIS por vértices aplicada.' : '';
      setStatus(
        `Fibra GIS: lectura ${askedStr}. En este sentido hay ≈ ${maxStr} fibra desde el pin; el punto quedó en el extremo del tendido.${chainHint} Convención ÷1,2.`
      );
    } else {
      setStatus(
        r.clamped
          ? 'Fibra GIS: punto colocado (distancia ajustada al tramo dibujado).'
          : 'Fibra GIS: punto colocado en el mapa.'
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
    placeRefPinIfNeeded(geom, getTurfNs());
    updateCapabilityStrip();
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

  function snapRefToLineVertex(which) {
    if (getOrigen() !== 'punto') return;
    const f = getSelectedFeature();
    const line = resolveLineStringGeometry(f?.geometry);
    if (!line?.coordinates?.length) {
      setStatus('Fibra GIS: selecciona antes un tendido en el mapa o por búsqueda.');
      return;
    }
    const t = getTurfNs();
    const c = line.coordinates;
    const atStart = which === 'start';
    /** @type {[number, number]} */
    const lngLat = atStart
      ? [c[0][0], c[0][1]]
      : [c[c.length - 1][0], c[c.length - 1][1]];
    refDistFromStartM = atStart ? 0 : lineLengthMeters(line, t);
    refClickLngLat = lngLat;
    const fid = f?.id;
    refRouteId = fid != null && String(fid).trim() !== '' ? String(fid) : null;
    refEndsKey = endsKeyFromLine(line);
    try {
      refAnchorLenM = lineLengthMeters(line, t);
    } catch {
      refAnchorLenM = null;
    }
    setStatus(
      atStart
        ? 'Fibra GIS: referencia en el inicio del tendido (0 m — mismo criterio que «Desde central»).'
        : 'Fibra GIS: referencia en el final del tendido (mismo criterio que «Desde final»).'
    );
    syncForm();
    onInput();
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
    document.getElementById('editor-ft-ref-start')?.addEventListener('click', () => {
      snapRefToLineVertex('start');
    });
    document.getElementById('editor-ft-ref-end')?.addEventListener('click', () => {
      snapRefToLineVertex('end');
    });
  }

  installDom();
  origen = getOrigen();
  updateDirBlockVisible();

  function syncForm() {
    const f = getSelectedFeature();
    lastLineId = f?.id != null ? f.id : null;
    origen = getOrigen();
    updateDirBlockVisible();
    const g = f?.geometry;
    if (resolveLineStringGeometry(g)) {
      placeRefPinIfNeeded(g, getTurfNs());
    } else {
      placeRefPinIfNeeded(null, getTurfNs());
    }
    updateCapabilityStrip();
  }

  return {
    open() {
      if (isEditing() || isPolyDrawing()) {
        setStatus('Fibra GIS: no disponible mientras editas o mides con polilínea.');
        return false;
      }
      open = true;
      allowRefPickWithoutPanel = false;
      deactivateMeasurePolyline?.();
      try {
        document.body.classList.add('editor-ft-workspace-open');
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
    close(opts) {
      const keepMapMark = Boolean(opts?.keepMapMark);
      open = false;
      allowRefPickWithoutPanel = keepMapMark;
      try {
        if (!keepMapMark) {
          clearTrazarRefMarker(map);
          clearTrazarCutMarker(map);
        }
        document.body.classList.remove('editor-ft-workspace-open');
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
      refDistFromStartM = distanceFromStartAlongLineMeters(line, [lng, lat], t);
      const fid = f.id;
      refRouteId = fid != null && String(fid).trim() !== '' ? String(fid) : null;
      refEndsKey = endsKeyFromLine(line);
      try {
        refAnchorLenM = lineLengthMeters(line, t);
      } catch {
        refAnchorLenM = null;
      }
      refClickLngLat = [lng, lat];
      setStatus(
        'Fibra GIS: pin de referencia fijado. Indica fibra (OTDR) y sentido; el mapa aplica tendido ÷ 1,2 (reserva ~20 %).'
      );
      syncForm();
      onInput();
      return true;
    }
  };
}
