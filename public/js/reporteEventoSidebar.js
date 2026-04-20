import { snapLngLatToLine } from './measurements.js';

const OFFLINE_QUEUE_KEY = 'reporteEventoQueueV1';
/** Distancia máxima (metros) entre GPS del técnico y una ruta para asociarla automáticamente. */
const GPS_ROUTE_SNAP_RADIUS_M = 150;

/**
 * Sidebar «REPORTE EVENTO»: flujo para técnico en campo (GPS + tap cable + cola offline).
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
 *   closeReportePanelUi?: () => void,
 *   findNearestRouteForLngLat?: (lng: number, lat: number, maxM: number) => null | {
 *     feature: import('geojson').Feature<import('geojson').LineString>,
 *     snapped: [number, number],
 *     meters: number
 *   }
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
    closeReportePanelUi,
    findNearestRouteForLngLat
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
  const btnUseGps = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reporte-use-gps'));
  const gpsStatusEl = document.getElementById('reporte-ev-gps-status');
  const offlineNoteEl = document.getElementById('reporte-ev-offline-note');

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

  let awaitingMapPick = false;
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

  function setGpsStatus(msg, level) {
    if (!gpsStatusEl) return;
    gpsStatusEl.textContent = msg || '';
    gpsStatusEl.dataset.level = level || '';
  }

  function startAwaitingMapPick() {
    awaitingMapPick = true;
    details.classList.add('reporte-ev--armed');
    disarmOtdrPick();
    setStatus('Reporte evento: toca el tendido o usa GPS para fijar el punto del incidente.');
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

  /**
   * Flujo GPS: el técnico está físicamente sobre el corte.
   * Toma la ubicación del móvil y la asocia automáticamente a la ruta más cercana
   * (≤ GPS_ROUTE_SNAP_RADIUS_M metros). Si no hay ruta cerca, igualmente guarda el punto crudo.
   */
  function handleGpsPick() {
    if (!('geolocation' in navigator)) {
      setGpsStatus('Tu dispositivo no permite ubicación GPS.', 'error');
      return;
    }
    if (!btnUseGps) return;
    btnUseGps.disabled = true;
    btnUseGps.classList.add('is-loading');
    setGpsStatus('Obteniendo ubicación…', 'info');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnUseGps.disabled = false;
        btnUseGps.classList.remove('is-loading');
        const lng = Number(pos.coords.longitude);
        const lat = Number(pos.coords.latitude);
        const acc = Number(pos.coords.accuracy);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          setGpsStatus('Ubicación inválida. Intenta de nuevo.', 'error');
          return;
        }

        let finalLng = lng;
        let finalLat = lat;
        let attachedRouteMsg = '';

        const nearest = findNearestRouteForLngLat?.(lng, lat, GPS_ROUTE_SNAP_RADIUS_M) || null;
        if (nearest?.feature && Array.isArray(nearest.snapped) && nearest.snapped.length === 2) {
          finalLng = nearest.snapped[0];
          finalLat = nearest.snapped[1];
          try {
            applyReportePickedRoute(nearest.feature, /** @type {any} */ ({ lngLat: { lng: finalLng, lat: finalLat } }));
          } catch {
            /* no-op: aplicar ruta seleccionada no debe bloquear el guardado. */
          }
          attachedRouteMsg = ` · Asociado al tendido «${String(nearest.feature.properties?.nombre ?? nearest.feature.id)}» (${Math.round(nearest.meters)} m).`;
        } else {
          attachedRouteMsg = ' · No hay tendido cercano: se guardará solo la coordenada GPS.';
        }

        pinnedLngLat = { lng: finalLng, lat: finalLat };
        setReportePin([finalLng, finalLat]);
        awaitingMapPick = false;
        details.classList.remove('reporte-ev--armed');
        onArmingChanged?.(false);

        try {
          const map = getMap();
          map.easeTo({ center: [finalLng, finalLat], zoom: Math.max(map.getZoom(), 17), duration: 600 });
        } catch {
          /* */
        }

        updatePhaseDom();
        refreshFechaText();
        const accTxt = Number.isFinite(acc) ? ` ±${Math.round(acc)} m` : '';
        setGpsStatus(`GPS obtenido${accTxt}.${attachedRouteMsg}`, 'ok');
        setStatus(`Reporte evento: ubicación fijada por GPS${accTxt}.${attachedRouteMsg}`);

        try {
          if (distEl) distEl.focus();
          else tipoEl.focus();
        } catch {
          /* */
        }
      },
      (err) => {
        btnUseGps.disabled = false;
        btnUseGps.classList.remove('is-loading');
        const codeMsg =
          err?.code === 1
            ? 'Permiso denegado. Habilita la ubicación para este sitio en el navegador.'
            : err?.code === 2
            ? 'Ubicación no disponible. Revisa GPS/datos móviles e inténtalo de nuevo.'
            : err?.code === 3
            ? 'Tiempo de espera agotado. Intenta otra vez al aire libre.'
            : 'No se pudo obtener la ubicación.';
        setGpsStatus(codeMsg, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
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
    setGpsStatus('', '');
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

  /* ——— Cola offline ——— */
  function loadQueue() {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveQueue(arr) {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(arr));
    } catch {
      /* cuota excedida o modo privado: ignoramos, el fallo se notifica arriba. */
    }
  }

  function updateOfflineBadge() {
    if (!offlineNoteEl) return;
    const n = loadQueue().length;
    if (n <= 0) {
      offlineNoteEl.hidden = true;
      offlineNoteEl.textContent = '';
      return;
    }
    offlineNoteEl.hidden = false;
    offlineNoteEl.textContent = `${n} reporte(s) pendiente(s) por enviar. Se reintentan al recuperar conexión.`;
  }

  function isTransientError(err) {
    if (!navigator.onLine) return true;
    const msg = err instanceof Error ? err.message : String(err || '');
    /* 0/Failed fetch = red caída; 5xx = servidor temporal. */
    if (/^0:|Failed to fetch|NetworkError|TypeError/.test(msg)) return true;
    if (/^(502|503|504):/.test(msg)) return true;
    return false;
  }

  async function flushQueue() {
    const q = loadQueue();
    if (!q.length) return { sent: 0, left: 0 };
    const left = [];
    let sent = 0;
    for (const body of q) {
      try {
        await api.postEventoReporte(body);
        sent++;
      } catch (err) {
        if (isTransientError(err)) {
          left.push(body);
        } else {
          /* Errores definitivos (400 validación, etc.) se descartan para no bloquear la cola; se avisa. */
          console.warn('Reporte offline descartado por error definitivo:', err);
        }
      }
    }
    saveQueue(left);
    updateOfflineBadge();
    if (sent > 0) {
      setStatus(`Reporte evento: ${sent} evento(s) en cola enviados correctamente.`);
      onEventoGuardado?.();
    }
    return { sent, left: left.length };
  }

  async function submit() {
    if (!pinnedLngLat) {
      setStatus('Reporte evento: primero indica el punto (usa GPS o toca el cable en el mapa).');
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

    btnGuardar.disabled = true;
    try {
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
      setGpsStatus('', '');
      if (isReportePanelOpen()) {
        startAwaitingMapPick();
      }
      refreshFechaText();
    } catch (err) {
      if (isTransientError(err)) {
        const q = loadQueue();
        q.push(body);
        saveQueue(q);
        updateOfflineBadge();
        setStatus('Sin conexión: evento guardado en el dispositivo. Se enviará cuando vuelva la red.');
        descEl.value = '';
        if (distEl) distEl.value = '';
        tipoEl.value = '';
        estadoEl.value = '';
        accionEl.value = '';
        pinnedLngLat = null;
        setReportePin(null);
        setGpsStatus('', '');
        if (isReportePanelOpen()) startAwaitingMapPick();
        refreshFechaText();
      } else {
        let msg = err instanceof Error ? err.message : String(err);
        if (/^503:/.test(msg) || msg.includes('eventos_reporte')) {
          msg += ' · En la carpeta del proyecto: npm run db:apply-eventos (o ejecuta sql/06_eventos_reporte.sql en PostgreSQL).';
        }
        setStatus(`Reporte evento: ${msg}`);
      }
    } finally {
      btnGuardar.disabled = false;
      refreshFechaText();
    }
  }

  refreshFechaText();
  updateOfflineBadge();

  function notifyReportePanelOpened() {
    refreshFechaText();
    updateOfflineBadge();
    void flushQueue();
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
    setStatus('Reporte evento: vuelve a elegir el punto (GPS o toque en el cable).');
  });

  btnUseGps?.addEventListener('click', () => handleGpsPick());

  /* Flush al recuperar red y cuando vuelve el foco de la pestaña. */
  window.addEventListener('online', () => void flushQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
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
