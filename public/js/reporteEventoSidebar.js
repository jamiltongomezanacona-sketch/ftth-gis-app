import { snapLngLatToLine } from './measurements.js';

/**
 * Sidebar «REPORTE EVENTO»: primero clic en tendido (coordenada), luego formulario y POST.
 * @param {{
 *   api: { postEventoReporte: (b: Record<string, unknown>) => Promise<{ ok?: boolean, id?: number }> },
 *   setStatus: (msg: string) => void,
 *   getMap: () => import('mapbox-gl').Map,
 *   getSelectedFeature: () => import('geojson').Feature<import('geojson').LineString> | null,
 *   turf: object,
 *   applyReportePickedRoute: (
 *     feature: import('geojson').Feature<import('geojson').LineString>,
 *     e: import('mapbox-gl').MapLayerMouseEvent
 *   ) => void,
 *   setReportePin: (lngLat: [number, number] | null) => void,
 *   disarmOtdrPick: () => void,
 *   onArmingChanged?: (armed: boolean) => void,
 *   onEventoGuardado?: () => void,
 *   closeReportePanelUi?: () => void
 * }} opts
 */
export function initReporteEventoSidebar(opts) {
  const {
    api,
    setStatus,
    getMap,
    getSelectedFeature,
    turf,
    applyReportePickedRoute,
    setReportePin,
    disarmOtdrPick,
    onArmingChanged,
    onEventoGuardado,
    closeReportePanelUi
  } = opts;

  const details = /** @type {HTMLElement | null} */ (document.getElementById('reporte-evento-details'));
  const phaseWait = document.getElementById('reporte-ev-phase-wait');
  const phaseForm = document.getElementById('reporte-ev-phase-form');
  const fechaEl = document.getElementById('reporte-evento-fecha');
  const distEl = /** @type {HTMLInputElement | null} */ (document.getElementById('reporte-ev-dist-odf'));
  const tipoEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-tipo'));
  const estadoEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-estado'));
  const accionEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-accion'));
  const descEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('reporte-ev-descripcion'));
  const btnGuardar = document.getElementById('btn-reporte-evento-guardar');
  const btnCancelWait = document.getElementById('btn-reporte-cancel-wait');
  const btnRepick = document.getElementById('btn-reporte-repick');

  if (!tipoEl || !estadoEl || !accionEl || !descEl || !btnGuardar || !details) {
    return {
      handleRouteLinePick: () => false,
      cancelMapPickMode: () => {},
      resetForCableCleared: () => {},
      isAwaitingRoutePick: () => false,
      notifyReportePanelOpened: () => {},
      notifyReportePanelClosed: () => {}
    };
  }

  const FLOAT_OPEN = 'editor-float-panel--open';

  function isReportePanelOpen() {
    return details.classList.contains(FLOAT_OPEN);
  }

  /** Esperando clic en una línea del mapa. */
  let awaitingMapPick = false;
  /** Coordenada proyectada en el tendido (tras clic). */
  let pinnedLngLat = /** @type {{ lng: number, lat: number } | null} */ (null);

  function refreshFechaText() {
    if (!fechaEl) return;
    try {
      fechaEl.textContent = `Fecha: ${new Date().toLocaleString('es-CO', {
        dateStyle: 'short',
        timeStyle: 'short'
      })}`;
    } catch {
      fechaEl.textContent = `Fecha: ${new Date().toISOString()}`;
    }
  }

  function updatePhaseDom() {
    if (!phaseWait || !phaseForm) return;
    if (!isReportePanelOpen()) return;
    const has = pinnedLngLat != null;
    phaseWait.hidden = has;
    phaseForm.hidden = !has;
  }

  function startAwaitingMapPick() {
    awaitingMapPick = true;
    details.classList.add('reporte-ev--armed');
    disarmOtdrPick();
    setStatus('Reporte evento: haz clic en el tendido en el punto exacto del incidente.');
    onArmingChanged?.(true);
    updatePhaseDom();
  }

  function cancelAwaitingMapPickOnly() {
    if (!awaitingMapPick) return;
    awaitingMapPick = false;
    details.classList.remove('reporte-ev--armed');
    onArmingChanged?.(false);
  }

  function cancelMapPickMode() {
    cancelAwaitingMapPickOnly();
  }

  /**
   * @param {import('mapbox-gl').MapLayerMouseEvent} e
   * @param {import('geojson').Feature<import('geojson').LineString>} f
   * @returns {boolean}
   */
  function handleRouteLinePick(e, f) {
    if (!awaitingMapPick) return false;
    const geomEarly = /** @type {any} */ (f.geometry);
    if (geomEarly?.type !== 'LineString' || !Array.isArray(geomEarly.coordinates) || geomEarly.coordinates.length < 2) {
      return false;
    }
    const line = /** @type {GeoJSON.LineString} */ (geomEarly);
    const clickLL = /** @type {[number, number]} */ ([e.lngLat.lng, e.lngLat.lat]);
    const snapped = snapLngLatToLine(line, clickLL, turf);
    const lng = snapped[0];
    const lat = snapped[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;

    applyReportePickedRoute(f, e);
    pinnedLngLat = { lng, lat };
    setReportePin([lng, lat]);

    awaitingMapPick = false;
    details.classList.remove('reporte-ev--armed');
    onArmingChanged?.(false);

    updatePhaseDom();
    refreshFechaText();
    setStatus(
      `Reporte evento: punto fijado en «${String(f.properties?.nombre ?? f.id)}». Completa el formulario y guarda.`
    );
    try {
      if (distEl) distEl.focus();
      else tipoEl.focus();
    } catch {
      /* */
    }
    return true;
  }

  function resetForCableCleared() {
    cancelAwaitingMapPickOnly();
    pinnedLngLat = null;
    setReportePin(null);
    details.classList.remove('reporte-ev--armed');
    if (phaseForm) phaseForm.hidden = true;
    if (phaseWait) phaseWait.hidden = false;
    onArmingChanged?.(false);
  }

  function clearPinnedAndRearm() {
    pinnedLngLat = null;
    setReportePin(null);
    if (isReportePanelOpen()) {
      startAwaitingMapPick();
    }
  }

  function routeContext() {
    const f = getSelectedFeature();
    if (!f || f.geometry?.type !== 'LineString') {
      return { ruta_id: null, nombre_tendido: null };
    }
    const id = f.id != null ? Number(f.id) : NaN;
    const nombre = String(f.properties?.nombre ?? '').trim() || null;
    return {
      ruta_id: Number.isInteger(id) && id > 0 ? id : null,
      nombre_tendido: nombre
    };
  }

  function mapCenterLngLat() {
    try {
      const c = getMap().getCenter();
      return { lng: c.lng, lat: c.lat };
    } catch {
      return { lng: null, lat: null };
    }
  }

  function eventLngLatForSubmit() {
    if (pinnedLngLat && Number.isFinite(pinnedLngLat.lng) && Number.isFinite(pinnedLngLat.lat)) {
      return { lng: pinnedLngLat.lng, lat: pinnedLngLat.lat };
    }
    return mapCenterLngLat();
  }

  async function submit() {
    if (!pinnedLngLat) {
      setStatus('Reporte evento: primero indica el punto en el tendido (abre el panel y haz clic en el cable).');
      return;
    }
    const tipo = tipoEl.value.trim();
    const estado = estadoEl.value.trim();
    const accion = accionEl.value.trim();
    if (!tipo || !estado || !accion) {
      setStatus('Reporte evento: elige tipo, estado y acción.');
      return;
    }
    const descripcionRaw = descEl.value.trim();
    if (!descripcionRaw) {
      setStatus('Reporte evento: describe el incidente.');
      descEl.focus();
      return;
    }
    const descripcion = descripcionRaw;

    const { ruta_id, nombre_tendido } = routeContext();
    const { lng, lat } = eventLngLatForSubmit();

    let dist_odf = null;
    if (distEl?.value.trim()) {
      const d = Number(distEl.value);
      if (Number.isFinite(d) && d >= 0) dist_odf = d;
    }

    const body = {
      tipo_evento: tipo,
      estado,
      accion,
      descripcion,
      dist_odf,
      ruta_id,
      nombre_tendido,
      lng,
      lat
    };

    try {
      btnGuardar.disabled = true;
      const res = await api.postEventoReporte(body);
      setStatus(`Evento guardado (id ${res?.id ?? '—'}).`);
      onEventoGuardado?.();
      descEl.value = '';
      if (distEl) distEl.value = '';
      tipoEl.value = '';
      estadoEl.value = '';
      accionEl.value = '';
      pinnedLngLat = null;
      setReportePin(null);
      if (isReportePanelOpen()) {
        startAwaitingMapPick();
      }
      refreshFechaText();
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (/^503:/.test(msg) || msg.includes('eventos_reporte')) {
        msg += ' · En la carpeta del proyecto: npm run db:apply-eventos (o ejecuta sql/06_eventos_reporte.sql en PostgreSQL).';
      }
      setStatus(`Reporte evento: ${msg}`);
    } finally {
      btnGuardar.disabled = false;
      refreshFechaText();
    }
  }

  refreshFechaText();

  function notifyReportePanelOpened() {
    refreshFechaText();
    if (!pinnedLngLat) {
      startAwaitingMapPick();
    }
    updatePhaseDom();
  }

  function notifyReportePanelClosed() {
    cancelAwaitingMapPickOnly();
  }

  btnGuardar.addEventListener('click', () => void submit());

  btnCancelWait?.addEventListener('click', () => {
    cancelAwaitingMapPickOnly();
    closeReportePanelUi?.();
    setStatus('Reporte evento: modo mapa cancelado.');
  });

  btnRepick?.addEventListener('click', () => {
    clearPinnedAndRearm();
    setStatus('Reporte evento: haz clic de nuevo en el tendido para el nuevo punto.');
  });

  return {
    handleRouteLinePick,
    cancelMapPickMode,
    resetForCableCleared,
    isAwaitingRoutePick: () => awaitingMapPick,
    notifyReportePanelOpened,
    notifyReportePanelClosed
  };
}
