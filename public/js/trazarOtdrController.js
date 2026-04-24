/**
 * Trazar (OTDR) — módulo dedicado.
 * Tres orígenes: Inicio, Final, Punto tramo (Fijar referencia + segundo clic en el tendido + sentido).
 * Cálculo: `measurements.js` (reserva fibra ÷1,2).
 */
import {
  lineLengthMeters,
  lengthWithReserve20Pct,
  geometricLengthFromFiberLengthMeters,
  distanceFromStartAlongLineMeters,
  snapLngLatToLine,
  cutPointFromOtdrFiberMeters,
  cutPointFromFiberFromClickRef
} from './measurements.js';

/**
 * @typedef {Object} TrazarOtdrControllerDeps
 * @property {import('mapbox-gl').Map} map
 * @property {import('./otdrCutLayer.js').OtdrCutLayer} otdrCutLayer
 * @property {import('./medidaEventoMarkerLayer.js').MedidaEventoMarkerLayer} medidaEventoMarkerLayer
 * @property {import('./centralesLayer.js').CentralesEtBLayer} [centralesLayer]
 * @property {import('./moleculeOverlayLayer.js').MoleculeOverlayLayer} [moleculeOverlayLayer]
 * @property {import('./eventosReporteLayer.js').EventosReporteLayer} [eventosReporteLayer]
 * @property {() => import('geojson').Feature<import('geojson').LineString> | null} getSelectedFeature
 * @property {() => boolean} isEditing
 * @property {() => any} getTurf
 * @property {(msg: string) => void} setStatus
 * @property {(w: 'trazar' | 'reporte', on: boolean) => void} setEditorFloatPickMode
 * @property {() => void} onReporteCancelPick
 * @param {(m: string) => string} fmtM
 * @property {() => void} scheduleSync
 * @property {() => void} [onAfterClearRef] p. ej. re-sincronizar pin de referencia en mapa
 */

/**
 * @param {TrazarOtdrControllerDeps} d
 */
export function createTrazarOtdrController(d) {
  const otdrCutLayer = d.otdrCutLayer;
  const medidaEventoMarkerLayer = d.medidaEventoMarkerLayer;
  const getSelectedFeature = d.getSelectedFeature;
  const isEditing = d.isEditing;
  const turf = () => d.getTurf();
  const { map, setStatus, setEditorFloatPickMode, onReporteCancelPick, fmtM, scheduleSync } = d;

  let otdrAwaitingCableClick = false;
  let otdrClickRefFromStartM = /** @type {number | null} */ (null);
  let otdrClickRefLngLat = /** @type {[number, number] | null} */ (null);

  const otdrRefFieldset = /** @type {HTMLFieldSetElement | null} */ (document.getElementById('otdr-ref-fieldset'));
  const otdrClickPanel = document.getElementById('otdr-click-panel');
  const otdrClickStatus = document.getElementById('otdr-click-status');
  const btnOtdrArmClick = document.getElementById('btn-otdr-arm-click');
  const otdrFiberInput = /** @type {HTMLInputElement | null} */ (document.getElementById('otdr-fiber-m'));
  const otdrFiberGeomHint = document.getElementById('otdr-fiber-geom-hint');
  const btnOtdrMark = document.getElementById('btn-otdr-mark');
  const btnOtdrClear = document.getElementById('btn-otdr-clear');

  function getOtdrRef() {
    const el = document.querySelector('input[name="otdr-ref"]:checked');
    return /** @type {'start' | 'end' | 'click'} */ (el?.value ?? 'start');
  }

  function getOtdrDir() {
    const el = document.querySelector('input[name="otdr-dir"]:checked');
    return el?.value === 'toward_start' ? 'toward_start' : 'toward_end';
  }

  function updateOtdrClickPanelVisibility() {
    if (otdrClickPanel) otdrClickPanel.hidden = getOtdrRef() !== 'click';
  }

  function syncOtdrFiberGeomHint() {
    if (!otdrFiberGeomHint) return;
    const v = Number(otdrFiberInput?.value);
    if (!Number.isFinite(v) || v < 0) {
      otdrFiberGeomHint.textContent =
        'Reserva 20%: el trazado en el mapa usa tendido = fibra ÷ 1,2 (mismo criterio que en el resto de la app).';
      return;
    }
    if (v === 0) {
      otdrFiberGeomHint.textContent = 'Reserva 20%: 0 m de fibra → 0 m de recorrido en el tendido.';
      return;
    }
    const g = geometricLengthFromFiberLengthMeters(v);
    otdrFiberGeomHint.textContent = `Reserva 20%: ≈${fmtM(g)} m de tendido (geométrico) en el mapa por ${fmtM(
      v
    )} m de fibra OTDR (÷1,2).`;
  }

  function syncOtdrCableReadout() {
    const box = document.getElementById('otdr-cable-readout');
    const geomEl = document.getElementById('otdr-ro-geom');
    const fibEl = document.getElementById('otdr-ro-fib');
    if (!box || !geomEl || !fibEl) return;
    const sf = getSelectedFeature();
    const ok = !!sf && !isEditing() && sf.geometry?.type === 'LineString';
    if (!ok) {
      box.hidden = true;
      return;
    }
    const geom = /** @type {GeoJSON.LineString} */ (sf.geometry);
    const t = turf();
    const L = lineLengthMeters(geom, t);
    const fib = lengthWithReserve20Pct(L);
    geomEl.textContent = fmtM(L);
    fibEl.textContent = fmtM(fib);
    box.hidden = false;
  }

  function syncOtdrUi() {
    const sf = getSelectedFeature();
    const ok = !!sf && !isEditing() && sf.geometry?.type === 'LineString';
    if (otdrFiberInput) otdrFiberInput.disabled = !ok;
    if (btnOtdrMark) btnOtdrMark.disabled = !ok;
    if (btnOtdrClear) btnOtdrClear.disabled = !ok;
    if (btnOtdrArmClick) {
      btnOtdrArmClick.disabled = !ok || getOtdrRef() !== 'click';
    }
    otdrRefFieldset?.querySelectorAll('input').forEach((el) => {
      /** @type {HTMLInputElement} */ (el).disabled = !ok;
    });
    otdrClickPanel?.querySelectorAll('input').forEach((el) => {
      /** @type {HTMLInputElement} */ (el).disabled = !ok;
    });
    if (!ok) {
      otdrAwaitingCableClick = false;
      btnOtdrArmClick?.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
    }
    updateOtdrClickPanelVisibility();
    syncOtdrFiberGeomHint();
    syncOtdrCableReadout();
  }

  function clearOtdrMapOverlay() {
    otdrCutLayer.clear();
  }

  function disarmPick() {
    otdrAwaitingCableClick = false;
    try {
      btnOtdrArmClick?.classList.remove('active');
    } catch {
      /* */
    }
    setEditorFloatPickMode('trazar', false);
  }

  function clearOtdrMarkAndRef() {
    clearOtdrMapOverlay();
    otdrClickRefFromStartM = null;
    otdrClickRefLngLat = null;
    disarmPick();
    if (otdrClickStatus) otdrClickStatus.textContent = 'Referencia: —';
    try {
      d.onAfterClearRef?.();
    } catch {
      /* */
    }
  }

  function markOtdrCut() {
    const sf = getSelectedFeature();
    if (!sf || isEditing()) return;
    const geom = /** @type {GeoJSON.LineString} */ (sf.geometry);
    if (geom.type !== 'LineString' || !geom.coordinates?.length) return;

    const fiber = Number(otdrFiberInput?.value);
    if (!Number.isFinite(fiber) || fiber < 0) {
      setStatus('Indica metros de fibra (trazado) ≥ 0.');
      return;
    }

    const ref = getOtdrRef();
    const t = turf();
    let res;
    if (ref === 'click') {
      if (otdrClickRefFromStartM == null) {
        setStatus('Pulsa Fijar referencia y haz clic en el mismo tendido seleccionado.');
        return;
      }
      res = cutPointFromFiberFromClickRef(geom, otdrClickRefFromStartM, fiber, getOtdrDir(), t);
    } else {
      res = cutPointFromOtdrFiberMeters(geom, fiber, ref === 'end' ? 'end' : 'start', t);
    }

    if (!res.point?.geometry?.coordinates) {
      setStatus('No se pudo calcular el punto de corte.');
      return;
    }

    const [lng, lat] = res.point.geometry.coordinates;

    otdrCutLayer.ensureLayer();
    otdrCutLayer.setCutPoint([lng, lat], `Corte ${fmtM(fiber)} m fibra`);
    d.centralesLayer?.bringToFront();
    d.moleculeOverlayLayer?.bringToFront();
    d.eventosReporteLayer?.bringToFront();
    medidaEventoMarkerLayer.bringToFront();
    otdrCutLayer.bringToFront();

    try {
      map.easeTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 700
      });
    } catch {
      /* */
    }

    let statusMsg = `Corte por trazado (${fmtM(fiber)} m fibra) en «${sf.properties?.nombre ?? sf.id}». ${lng.toFixed(5)}, ${lat.toFixed(5)}`;
    if (res.clamped) {
      statusMsg += ' · Lectura acotada al extremo del tendido en el mapa.';
    }
    setStatus(statusMsg);
  }

  /**
   * Si estamos armados para fijar referencia en tramo, consume el clic en el tendido.
   * @param {import('mapbox-gl').MapLayerMouseEvent} e
   * @param {GeoJSON.Feature} f
   * @param {any} geomEarly
   * @returns {boolean} true si el evento queda consumido
   */
  function handleOtdrRefLinePick(/** @type {any} */ e, f, geomEarly) {
    if (!otdrAwaitingCableClick) return false;
    const sel = getSelectedFeature();
    if (!sel || f.id !== sel.id) {
      setStatus('Usa Fijar referencia sobre el mismo tendido ya seleccionado (el que está resaltado).');
      return true;
    }
    if (geomEarly?.type === 'LineString' && geomEarly.coordinates?.length >= 2) {
      const clickLL = [e.lngLat.lng, e.lngLat.lat];
      const geomSel = /** @type {any} */ (getSelectedFeature()?.geometry);
      const lineForOtdrRef =
        geomSel?.type === 'LineString' && geomSel.coordinates?.length >= 2
          ? /** @type {GeoJSON.LineString} */ (geomSel)
          : /** @type {GeoJSON.LineString} */ (geomEarly);
      const t = turf();
      otdrClickRefFromStartM = distanceFromStartAlongLineMeters(lineForOtdrRef, clickLL, t);
      const snapped = snapLngLatToLine(lineForOtdrRef, clickLL, t);
      otdrClickRefLngLat = /** @type {[number, number]} */ ([snapped[0], snapped[1]]);
      medidaEventoMarkerLayer.ensureLayer();
      medidaEventoMarkerLayer.setPoint(otdrClickRefLngLat);
      medidaEventoMarkerLayer.bringToFront();
      otdrCutLayer.bringToFront();
      otdrAwaitingCableClick = false;
      btnOtdrArmClick?.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
      if (otdrClickStatus)
        otdrClickStatus.textContent = `Referencia en tramo: ${fmtM(otdrClickRefFromStartM)} desde inicio (por tendido).`;
      setStatus('Referencia fijada. Metros de fibra y sentido; luego Marcar corte.');
      scheduleSync();
    }
    return true;
  }

  function onRefInputChange() {
    updateOtdrClickPanelVisibility();
    if (getOtdrRef() !== 'click') {
      otdrAwaitingCableClick = false;
      btnOtdrArmClick?.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
      otdrClickRefFromStartM = null;
      otdrClickRefLngLat = null;
      if (otdrClickStatus) otdrClickStatus.textContent = 'Referencia: —';
    }
    scheduleSync();
  }

  document.querySelectorAll('input[name="otdr-ref"]').forEach((el) => {
    el.addEventListener('change', onRefInputChange);
  });

  btnOtdrArmClick?.addEventListener('click', () => {
    if (!getSelectedFeature() || isEditing()) return;
    if (getOtdrRef() !== 'click') return;
    if (otdrAwaitingCableClick) {
      otdrAwaitingCableClick = false;
      if (btnOtdrArmClick) btnOtdrArmClick.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
      setStatus('Referencia por clic cancelada.');
      scheduleSync();
      return;
    }
    onReporteCancelPick();
    otdrAwaitingCableClick = true;
    if (btnOtdrArmClick) btnOtdrArmClick.classList.add('active');
    setEditorFloatPickMode('trazar', true);
    setStatus('Haz clic en el tendido seleccionado para fijar la referencia de trazado.');
  });

  otdrFiberInput?.addEventListener('input', () => {
    syncOtdrFiberGeomHint();
  });
  otdrFiberInput?.addEventListener('change', () => {
    syncOtdrFiberGeomHint();
  });
  btnOtdrMark?.addEventListener('click', () => {
    markOtdrCut();
  });
  btnOtdrClear?.addEventListener('click', () => {
    clearOtdrMapOverlay();
  });

  return {
    isAwaitingRefPick: () => otdrAwaitingCableClick,
    disarmPick,
    clearMarkAndRef: clearOtdrMarkAndRef,
    clearMapMarkOnly: clearOtdrMapOverlay,
    syncOtdrUi,
    getOtdrRef,
    getOtdrDir,
    getClickRefLngLat: () => otdrClickRefLngLat,
    handleOtdrRefLinePick
  };
}
