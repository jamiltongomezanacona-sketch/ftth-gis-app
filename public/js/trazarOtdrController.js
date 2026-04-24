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
  const otdrFiberInputKm = /** @type {HTMLInputElement | null} */ (document.getElementById('otdr-fiber-km'));
  const otdrFiberGeomHint = document.getElementById('otdr-fiber-geom-hint');
  /** Evita bucle m ↔ km */
  let otdrFiberSyncLock = false;
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

  /**
   * Refuerza el estilo "seleccionado" en móviles / WebView sin :has() en CSS.
   * @see .otdr-seg-card--selected
   */
  function syncOtdrSegCardClasses() {
    otdrRefFieldset?.querySelectorAll('input[name="otdr-ref"]').forEach((inp) => {
      const lab = /** @type {HTMLInputElement} */ (inp).closest('label.otdr-seg-card');
      if (lab) lab.classList.toggle('otdr-seg-card--selected', /** @type {HTMLInputElement} */ (inp).checked);
    });
    otdrClickPanel?.querySelectorAll('input[name="otdr-dir"]').forEach((inp) => {
      const lab = /** @type {HTMLInputElement} */ (inp).closest('label.otdr-seg-card');
      if (lab) lab.classList.toggle('otdr-seg-card--selected', /** @type {HTMLInputElement} */ (inp).checked);
    });
  }

  function formatKmFromM(/** @type {number} */ m) {
    if (!Number.isFinite(m) || m < 0) return '';
    if (m === 0) return '';
    const km = m / 1000;
    const t = Math.round(km * 1000) / 1000;
    return String(t).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function parseKmToM(/** @type {string} */ raw) {
    const t = String(raw).trim().replace(/,/, '.');
    if (t === '') return NaN;
    const km = Number.parseFloat(t);
    if (!Number.isFinite(km) || km < 0) return NaN;
    return km * 1000;
  }

  function syncKmFieldFromMeters() {
    if (otdrFiberSyncLock) return;
    if (!otdrFiberInput || !otdrFiberInputKm) return;
    const m = Number(otdrFiberInput.value);
    otdrFiberSyncLock = true;
    if (!Number.isFinite(m) || m < 0) otdrFiberInputKm.value = '';
    else otdrFiberInputKm.value = formatKmFromM(m);
    otdrFiberSyncLock = false;
  }

  function syncMetersFieldFromKm() {
    if (otdrFiberSyncLock) return;
    if (!otdrFiberInput || !otdrFiberInputKm) return;
    const m = parseKmToM(otdrFiberInputKm.value);
    otdrFiberSyncLock = true;
    if (!Number.isFinite(m) || m < 0) otdrFiberInput.value = '';
    else otdrFiberInput.value = String(Math.round(m * 10) / 10);
    otdrFiberSyncLock = false;
    syncOtdrFiberGeomHint();
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
    if (otdrFiberInputKm) otdrFiberInputKm.disabled = !ok;
    if (btnOtdrMark) btnOtdrMark.disabled = !ok;
    if (btnOtdrClear) {
      const marcas = otdrCutLayer.hasMark?.() === true;
      btnOtdrClear.disabled = !ok && !marcas;
    }
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
    syncOtdrSegCardClasses();
    if (ok) syncKmFieldFromMeters();
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

    let fiber = Number(otdrFiberInput?.value);
    if ((!Number.isFinite(fiber) || fiber < 0) && otdrFiberInputKm && String(otdrFiberInputKm.value).trim() !== '') {
      syncMetersFieldFromKm();
      fiber = Number(otdrFiberInput?.value);
    }
    if (!Number.isFinite(fiber) || fiber < 0) {
      setStatus('Indica fibra (m) o lectura (km); debe ser ≥ 0.');
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

    let statusMsg = `Falla ubicada (${fmtM(fiber)} m fibra) en «${sf.properties?.nombre ?? sf.id}». ${lng.toFixed(5)}, ${lat.toFixed(5)}`;
    if (res.clamped) {
      statusMsg += ' · Lectura acotada al extremo del tendido en el mapa.';
    }
    setStatus(statusMsg);
    scheduleSync();
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
      setStatus('Referencia fijada. Metros de fibra y sentido; luego «Ubicar falla».');
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
  document.querySelectorAll('input[name="otdr-dir"]').forEach((el) => {
    el.addEventListener('change', () => {
      scheduleSync();
    });
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
    syncKmFieldFromMeters();
    syncOtdrFiberGeomHint();
  });
  otdrFiberInput?.addEventListener('change', () => {
    syncKmFieldFromMeters();
    syncOtdrFiberGeomHint();
  });
  otdrFiberInputKm?.addEventListener('input', () => {
    syncMetersFieldFromKm();
  });
  otdrFiberInputKm?.addEventListener('change', () => {
    syncMetersFieldFromKm();
  });
  btnOtdrMark?.addEventListener('click', () => {
    markOtdrCut();
  });
  btnOtdrClear?.addEventListener('click', () => {
    clearOtdrMapOverlay();
    scheduleSync();
  });

  syncOtdrSegCardClasses();

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
