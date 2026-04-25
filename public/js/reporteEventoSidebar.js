/**
 * Panel «Montar evento»: enganchado desde `app.js` con `#reporte-evento-details` (float + mapa).
 */
import { distanceFromStartAlongLineMeters, snapLngLatToLine } from './measurements.js';

const OFFLINE_QUEUE_KEY = 'reporteEventoQueueV1';
const DRAFT_DESC_KEY = 'reporteEventoDescDraftV1';
/** Distancia máxima (metros) entre GPS del técnico y una ruta para asociarla automáticamente. */
const GPS_ROUTE_SNAP_RADIUS_M = 150;
/** Umbral (m) a partir del cual ofrecemos «Mejorar GPS» (precisión pobre). */
const GPS_POOR_ACCURACY_M = 50;

/** Presets rápidos: un tap llena tipo/estado/acción para los casos más comunes. */
const QUICK_PRESETS = {
  'corte-obras': { tipo_evento: 'OBRAS CIVILES', estado: 'CRITICO', accion: 'INTERVENCIÓN TECNICA' },
  vandalismo: { tipo_evento: 'VANDALISMO', estado: 'CRITICO', accion: 'REEMPLAZO DE FIBRA' },
  terceros: { tipo_evento: 'DAÑO POR TERCEROS', estado: 'CRITICO', accion: 'REEMPLAZO DE FIBRA' },
  mantenimiento: { tipo_evento: 'MANTENIMIENTO', estado: 'EN PROCESO', accion: 'INTERVENCIÓN TECNICA' }
};

/** Acciones sugeridas por tipo para evitar combinaciones inválidas al guardar. */
const ACTIONS_BY_TYPE = {
  VANDALISMO: ['REEMPLAZO DE FIBRA', 'INTERVENCIÓN TECNICA'],
  'OBRAS CIVILES': ['INTERVENCIÓN TECNICA', 'REEMPLAZO DE FIBRA', 'SE INSTALA CIERRE'],
  DETERIORO: ['INTERVENCIÓN TECNICA', 'REEMPLAZO DE FIBRA'],
  MANTENIMIENTO: ['INTERVENCIÓN TECNICA', 'SE INSTALA CIERRE'],
  'DAÑO POR TERCEROS': ['REEMPLAZO DE FIBRA', 'INTERVENCIÓN TECNICA']
};

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
 *   canMountEvento?: () => boolean,
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
    canMountEvento,
    findNearestRouteForLngLat
  } = opts;

  const details = /** @type {HTMLElement | null} */ (document.getElementById('reporte-evento-details'));
  const phaseWait = document.getElementById('reporte-ev-phase-wait');
  const phaseForm = document.getElementById('reporte-ev-phase-form');
  const fechaEl = document.getElementById('reporte-evento-fecha');
  const distEl = /** @type {HTMLInputElement | null} */ (document.getElementById('reporte-ev-dist-odf'));
  const distAutoTag = document.getElementById('reporte-ev-dist-auto');
  const tipoEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-tipo'));
  const estadoEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-estado'));
  const accionEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-accion'));
  const descEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('reporte-ev-descripcion'));
  const descDraftTag = document.getElementById('reporte-ev-desc-draft');
  const btnGuardar = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reporte-evento-guardar'));
  const btnRapido = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reporte-evento-rapido'));
  const btnCancelWait = document.getElementById('btn-reporte-cancel-wait');
  const btnRepick = document.getElementById('btn-reporte-repick');
  const btnUseGps = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-reporte-use-gps'));
  const presetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('reporte-ev-preset-select'));
  const gpsStatusEl = document.getElementById('reporte-ev-gps-status');
  const offlineNoteEl = document.getElementById('reporte-ev-offline-note');
  const pinCardEl = document.getElementById('reporte-ev-pin-card');
  const toastEl = document.getElementById('reporte-ev-toast');
  const presetBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.reporte-ev-preset[data-preset]')
  );

  if (!tipoEl || !estadoEl || !accionEl || !descEl || !btnGuardar || !details) {
    return {
      handleRouteLinePick: () => false,
      handleMapTapPick: () => false,
      cancelMapPickMode: () => {},
      resetForCableCleared: () => {},
      isAwaitingRoutePick: () => false,
      notifyReportePanelOpened: () => {},
      notifyReportePanelClosed: () => {}
    };
  }

  const FLOAT_OPEN = 'editor-float-panel--open';

  /** Tras elegir modo en UI: solo tendido (`cable`) o coordenada exacta (`libre`). */
  let pickPlacementMode = /** @type {'cable' | 'libre' | null} */ (null);
  const placementRow = document.getElementById('reporte-ev-placement-row');

  function isReportePanelOpen() {
    return details.classList.contains(FLOAT_OPEN);
  }

  function showPlacementChooser() {
    pickPlacementMode = null;
    awaitingMapPick = false;
    details.classList.remove('reporte-ev--armed');
    onArmingChanged?.(false);
    if (placementRow) placementRow.hidden = false;
    if (phaseWait) phaseWait.hidden = false;
    if (phaseForm) phaseForm.hidden = true;
    updatePhaseDom();
    updatePinCard();
  }

  function hasMoleculeSelected() {
    try {
      if (typeof canMountEvento === 'function') return !!canMountEvento();
    } catch {
      /* */
    }
    return true;
  }

  function ensureMoleculeSelected(showMessage = true) {
    const ok = hasMoleculeSelected();
    if (!ok && showMessage) {
      setStatus('Primero selecciona una molécula en el buscador para montar un evento.');
    }
    return ok;
  }

  let awaitingMapPick = false;
  let pinnedLngLat = /** @type {{ lng: number, lat: number } | null} */ (null);
  /** Última precisión GPS reportada por el navegador (metros). */
  let lastGpsAccuracy = /** @type {number | null} */ (null);
  /** Ruta asociada al punto fijado (nombre para mostrar en la tarjeta). */
  let pinnedRouteLabel = /** @type {string | null} */ (null);
  /** Último «dist ODF» calculado automáticamente; si el usuario edita, se respeta. */
  let autoComputedDistOdf = /** @type {number | null} */ (null);
  let distOdfIsManual = false;

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
    updatePinCard();
  }

  function setGpsStatus(msg, level) {
    if (!gpsStatusEl) return;
    gpsStatusEl.textContent = msg || '';
    gpsStatusEl.dataset.level = level || '';
  }

  function updatePinCard() {
    if (!pinCardEl) return;
    if (!pinnedLngLat) {
      pinCardEl.hidden = true;
      return;
    }
    pinCardEl.hidden = false;
  }

  function startAwaitingMapPick() {
    if (!ensureMoleculeSelected(true)) {
      awaitingMapPick = false;
      details.classList.remove('reporte-ev--armed');
      onArmingChanged?.(false);
      if (phaseForm) phaseForm.hidden = true;
      if (phaseWait) phaseWait.hidden = false;
      if (placementRow) placementRow.hidden = false;
      updatePinCard();
      return;
    }
    if (!pickPlacementMode) {
      setStatus('Montar evento: elige primero «Sobre el tendido» o «Punto libre».');
      return;
    }
    awaitingMapPick = true;
    details.classList.add('reporte-ev--armed');
    disarmOtdrPick();
    if (pickPlacementMode === 'cable') {
      setStatus('Montar evento: toca el cable en el mapa. Cancelar abajo si te equivocas.');
    } else {
      setStatus('Montar evento: toca el mapa donde quieras el incidente (coordenada libre).');
    }
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

  function setDistOdfFromRoute(line) {
    if (!distEl) return;
    if (distOdfIsManual) return;
    try {
      if (!line || line.type !== 'LineString' || !pinnedLngLat) {
        autoComputedDistOdf = null;
        return;
      }
      const d = distanceFromStartAlongLineMeters(
        line,
        [pinnedLngLat.lng, pinnedLngLat.lat],
        turf
      );
      if (Number.isFinite(d) && d >= 0) {
        autoComputedDistOdf = Math.round(d);
        distEl.value = String(autoComputedDistOdf);
        if (distAutoTag) distAutoTag.hidden = false;
      }
    } catch {
      /* cálculo tolerante. */
    }
  }

  /**
   * @param {import('mapbox-gl').MapLayerMouseEvent} e
   * @param {import('geojson').Feature<import('geojson').LineString>} f
   * @returns {boolean}
   */
  function handleRouteLinePick(e, f) {
    if (!ensureMoleculeSelected(true)) return false;
    if (!awaitingMapPick) return false;
    /* Modo libre: un clic sobre el cable también fija el punto (coordenada del clic, sin encajar al trazado). */
    if (pickPlacementMode === 'libre') {
      const lng = Number(e.lngLat?.lng);
      const lat = Number(e.lngLat?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      try {
        applyReportePickedRoute(null, /** @type {any} */ (e));
      } catch {
        /* */
      }
      pinnedLngLat = { lng, lat };
      pinnedRouteLabel = null;
      lastGpsAccuracy = null;
      setReportePin([lng, lat]);
      autoComputedDistOdf = null;
      if (distAutoTag) distAutoTag.hidden = true;
      awaitingMapPick = false;
      details.classList.remove('reporte-ev--armed');
      onArmingChanged?.(false);
      updatePhaseDom();
      refreshFechaText();
      setStatus('Montar evento: punto libre fijado. Completa el formulario y guarda.');
      try {
        tipoEl.focus();
      } catch {
        /* */
      }
      return true;
    }
    if (pickPlacementMode !== 'cable') return false;
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
    pinnedRouteLabel = String(f.properties?.nombre ?? f.id ?? '').trim() || null;
    lastGpsAccuracy = null; /* tap en mapa: no hay precisión GPS que mostrar. */
    setReportePin([lng, lat]);
    setDistOdfFromRoute(line);

    awaitingMapPick = false;
    details.classList.remove('reporte-ev--armed');
    onArmingChanged?.(false);

    updatePhaseDom();
    refreshFechaText();
    setStatus(
      `Montar evento: punto fijado en «${pinnedRouteLabel || f.id}». Completa el formulario y guarda.`
    );
    try {
      tipoEl.focus();
    } catch {
      /* */
    }
    return true;
  }

  /**
   * Permite fijar evento con tap libre en mapa (no solo sobre cable).
   * Si hay un tendido cercano, asocia y ajusta el punto al tramo.
   * @param {import('mapbox-gl').MapMouseEvent & import('mapbox-gl').EventData} e
   * @param {{ hasRouteHit?: boolean }} [meta]
   * @returns {boolean}
   */
  function handleMapTapPick(e, meta = {}) {
    if (!ensureMoleculeSelected(true)) return false;
    if (!awaitingMapPick) return false;
    if (pickPlacementMode === 'cable' && !meta.hasRouteHit) return false;
    if (meta.hasRouteHit) return false;
    const lng = Number(e?.lngLat?.lng);
    const lat = Number(e?.lngLat?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;

    let finalLng = lng;
    let finalLat = lat;
    let msgExtra = 'Punto libre del mapa.';
    pinnedRouteLabel = null;

    if (pickPlacementMode === 'libre') {
      try {
        applyReportePickedRoute(null, /** @type {any} */ (e));
      } catch {
        /* */
      }
      autoComputedDistOdf = null;
      if (distAutoTag) distAutoTag.hidden = true;
      msgExtra = 'Coordenada libre (sin asociar al tendido).';
    } else {
      const nearest = findNearestRouteForLngLat?.(lng, lat, GPS_ROUTE_SNAP_RADIUS_M) || null;
      if (nearest?.feature && Array.isArray(nearest.snapped) && nearest.snapped.length === 2) {
        finalLng = Number(nearest.snapped[0]);
        finalLat = Number(nearest.snapped[1]);
        pinnedRouteLabel =
          String(nearest.feature.properties?.nombre ?? nearest.feature.id ?? '').trim() || null;
        try {
          applyReportePickedRoute(
            nearest.feature,
            /** @type {any} */ ({ lngLat: { lng: finalLng, lat: finalLat } })
          );
        } catch {
          /* */
        }
        const geomSel = /** @type {any} */ (nearest.feature.geometry);
        if (geomSel?.type === 'LineString' && geomSel.coordinates?.length >= 2) {
          setDistOdfFromRoute(geomSel);
        }
        msgExtra = `Ajustado al tendido «${pinnedRouteLabel ?? '—'}» (${Math.round(nearest.meters)} m).`;
      } else {
        autoComputedDistOdf = null;
        if (distAutoTag) distAutoTag.hidden = true;
      }
    }

    pinnedLngLat = { lng: finalLng, lat: finalLat };
    lastGpsAccuracy = null;
    setReportePin([finalLng, finalLat]);
    setGpsStatus('', '');
    awaitingMapPick = false;
    details.classList.remove('reporte-ev--armed');
    onArmingChanged?.(false);
    updatePhaseDom();
    refreshFechaText();
    setStatus(`Montar evento: punto fijado. ${msgExtra} Completa y guarda.`);
    try {
      tipoEl.focus();
    } catch {
      /* */
    }
    return true;
  }

  /**
   * Pide ubicación GPS, la asocia a la ruta más cercana (≤ radius) y abre el formulario.
   * @param {{ silent?: boolean }} [opts]
   */
  function handleGpsPick(opts = {}) {
    if (!ensureMoleculeSelected(true)) return Promise.resolve(false);
    if (!('geolocation' in navigator)) {
      setGpsStatus('Tu dispositivo no permite ubicación GPS.', 'error');
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
    const btn = btnUseGps;
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }
    if (!opts.silent) setGpsStatus('Obteniendo ubicación…', 'info');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-loading');
        }
        const lng = Number(pos.coords.longitude);
        const lat = Number(pos.coords.latitude);
        const acc = Number(pos.coords.accuracy);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          setGpsStatus('Ubicación inválida. Intenta de nuevo.', 'error');
          resolve(false);
          return;
        }
        lastGpsAccuracy = Number.isFinite(acc) ? acc : null;

        let finalLng = lng;
        let finalLat = lat;
        let attachedRouteMsg = '';
        pinnedRouteLabel = null;

        const nearest = findNearestRouteForLngLat?.(lng, lat, GPS_ROUTE_SNAP_RADIUS_M) || null;
        if (nearest?.feature && Array.isArray(nearest.snapped) && nearest.snapped.length === 2) {
          finalLng = nearest.snapped[0];
          finalLat = nearest.snapped[1];
          pinnedRouteLabel =
            String(nearest.feature.properties?.nombre ?? nearest.feature.id ?? '').trim() || null;
          try {
            applyReportePickedRoute(
              nearest.feature,
              /** @type {any} */ ({ lngLat: { lng: finalLng, lat: finalLat } })
            );
          } catch {
            /* no-op. */
          }
          attachedRouteMsg = ` · Tendido «${pinnedRouteLabel ?? ''}» a ${Math.round(nearest.meters)} m.`;
        } else {
          attachedRouteMsg = ' · Sin tendido a menos de 150 m: se guardará solo la coordenada GPS.';
        }

        pinnedLngLat = { lng: finalLng, lat: finalLat };
        setReportePin([finalLng, finalLat]);

        const geomSel = /** @type {any} */ (nearest?.feature?.geometry);
        if (geomSel?.type === 'LineString' && geomSel.coordinates?.length >= 2) {
          setDistOdfFromRoute(geomSel);
        } else {
          autoComputedDistOdf = null;
          if (distAutoTag) distAutoTag.hidden = true;
        }

        awaitingMapPick = false;
        details.classList.remove('reporte-ev--armed');
        onArmingChanged?.(false);

        try {
          const map = getMap();
          map.easeTo({
            center: [finalLng, finalLat],
            zoom: Math.max(map.getZoom(), 17),
            duration: 600
          });
        } catch {
          /* */
        }

        updatePhaseDom();
        refreshFechaText();
        const accTxt = Number.isFinite(acc) ? ` ±${Math.round(acc)} m` : '';
        const accLevel = !Number.isFinite(acc)
          ? 'info'
          : acc <= 15
          ? 'ok'
          : acc <= GPS_POOR_ACCURACY_M
          ? 'warn'
          : 'bad';
        setGpsStatus(`GPS obtenido${accTxt}.${attachedRouteMsg}`, accLevel);
        setStatus(`Montar evento: ubicación fijada por GPS${accTxt}.${attachedRouteMsg}`);
        resolve(true);
      },
      (err) => {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-loading');
        }
        const codeMsg =
          err?.code === 1
            ? 'Permiso denegado. Habilita la ubicación en el navegador y vuelve a intentarlo.'
            : err?.code === 2
            ? 'Ubicación no disponible. Revisa GPS/datos móviles e inténtalo al aire libre.'
            : err?.code === 3
            ? 'Tiempo de espera agotado. Intenta otra vez sin obstáculos.'
            : 'No se pudo obtener la ubicación.';
        setGpsStatus(codeMsg, 'error');
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
    });
  }

  function resetForCableCleared() {
    pickPlacementMode = null;
    cancelAwaitingMapPickOnly();
    pinnedLngLat = null;
    pinnedRouteLabel = null;
    lastGpsAccuracy = null;
    autoComputedDistOdf = null;
    distOdfIsManual = false;
    if (distAutoTag) distAutoTag.hidden = true;
    setReportePin(null);
    details.classList.remove('reporte-ev--armed');
    if (placementRow) placementRow.hidden = false;
    if (phaseForm) phaseForm.hidden = true;
    if (phaseWait) phaseWait.hidden = false;
    onArmingChanged?.(false);
    updatePinCard();
  }

  function clearPinnedAndRearm() {
    pinnedLngLat = null;
    pinnedRouteLabel = null;
    lastGpsAccuracy = null;
    autoComputedDistOdf = null;
    distOdfIsManual = false;
    if (distAutoTag) distAutoTag.hidden = true;
    if (distEl) distEl.value = '';
    setReportePin(null);
    setGpsStatus('', '');
    updatePinCard();
    if (isReportePanelOpen()) {
      showPlacementChooser();
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
      /* cuota excedida o modo privado. */
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
          console.warn('Reporte offline descartado por error definitivo:', err);
        }
      }
    }
    saveQueue(left);
    updateOfflineBadge();
    if (sent > 0) {
      setStatus(`Montar evento: ${sent} evento(s) en cola enviados correctamente.`);
      onEventoGuardado?.();
    }
    return { sent, left: left.length };
  }

  /* ——— Borrador de descripción ——— */
  function persistDraft() {
    try {
      const v = String(descEl.value ?? '').trim();
      if (v) {
        localStorage.setItem(DRAFT_DESC_KEY, v);
        if (descDraftTag) descDraftTag.hidden = false;
      } else {
        localStorage.removeItem(DRAFT_DESC_KEY);
        if (descDraftTag) descDraftTag.hidden = true;
      }
    } catch {
      /* */
    }
  }

  function restoreDraft() {
    try {
      const v = localStorage.getItem(DRAFT_DESC_KEY);
      if (v && !descEl.value) {
        descEl.value = v;
        if (descDraftTag) descDraftTag.hidden = false;
      }
    } catch {
      /* */
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_DESC_KEY);
    } catch {
      /* */
    }
    if (descDraftTag) descDraftTag.hidden = true;
  }

  /* ——— Toast y vibración ——— */
  function showToast(msg, level) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.dataset.level = level || 'ok';
    toastEl.hidden = false;
    toastEl.classList.remove('is-leave');
    /* Reinicia animación de entrada si se dispara varias veces. */
    toastEl.classList.remove('is-enter');
    /* reflow para reiniciar animación */
    void toastEl.offsetWidth;
    toastEl.classList.add('is-enter');
    clearTimeout(/** @type {any} */ (toastEl).__hideTimer);
    /** @type {any} */ (toastEl).__hideTimer = setTimeout(() => {
      toastEl.classList.add('is-leave');
      setTimeout(() => {
        toastEl.hidden = true;
        toastEl.classList.remove('is-enter', 'is-leave');
      }, 260);
    }, 2600);
  }

  function vibrateOk() {
    try {
      if ('vibrate' in navigator) navigator.vibrate([40, 30, 40]);
    } catch {
      /* */
    }
  }

  function applyPreset(key) {
    const p = QUICK_PRESETS[key];
    if (!p) return;
    tipoEl.value = p.tipo_evento;
    estadoEl.value = p.estado;
    syncActionsForTipo(p.accion);
    accionEl.value = p.accion;
    /* Feedback visual: resalta el preset activo brevemente. */
    presetBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.preset === key));
    setStatus(`Plantilla aplicada: ${p.tipo_evento} · ${p.estado} · ${p.accion}.`);
    try {
      descEl.focus({ preventScroll: true });
    } catch {
      /* */
    }
  }

  /**
   * @param {string} preferredAction
   */
  function syncActionsForTipo(preferredAction = '') {
    const tipo = String(tipoEl.value ?? '').trim().toUpperCase();
    const actions = ACTIONS_BY_TYPE[tipo] || [];
    if (!actions.length) {
      accionEl.disabled = true;
      accionEl.innerHTML = '<option value="">Primero elige tipo</option>';
      return;
    }
    const prev = String(preferredAction || accionEl.value || '').trim().toUpperCase();
    accionEl.disabled = false;
    accionEl.innerHTML = '<option value="">Selecciona acción</option>';
    for (const action of actions) {
      const opt = document.createElement('option');
      opt.value = action;
      opt.textContent = action;
      accionEl.appendChild(opt);
    }
    const hasPrev = actions.some((a) => a.toUpperCase() === prev);
    if (hasPrev) accionEl.value = prev;
  }

  function shouldRetryWithoutDistOdf(err) {
    const raw = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''}`.toLowerCase();
    const code = String(err?.code ?? '');
    const mentionsDist = raw.includes('dist_odf');
    const schemaIssue =
      /column|schema cache|does not exist|unknown|pgrst/.test(raw) ||
      code === '42703' ||
      code === 'PGRST204';
    return mentionsDist && schemaIssue;
  }

  function resetFormAfterSubmit() {
    descEl.value = '';
    clearDraft();
    if (distEl) distEl.value = '';
    if (distAutoTag) distAutoTag.hidden = true;
    tipoEl.value = '';
    estadoEl.value = '';
    accionEl.value = '';
    pinnedLngLat = null;
    pinnedRouteLabel = null;
    lastGpsAccuracy = null;
    autoComputedDistOdf = null;
    distOdfIsManual = false;
    presetBtns.forEach((b) => b.classList.remove('is-active'));
    setReportePin(null);
    setGpsStatus('', '');
    updatePinCard();
    if (isReportePanelOpen()) showPlacementChooser();
    refreshFechaText();
  }

  async function submit() {
    if (!ensureMoleculeSelected(true)) return;
    if (!pinnedLngLat) {
      setStatus('Montar evento: primero indica el punto (usa GPS o toca el cable en el mapa).');
      return;
    }
    const tipo = tipoEl.value.trim();
    const estado = estadoEl.value.trim();
    const accion = accionEl.value.trim();
    if (!tipo || !estado || !accion) {
      setStatus('Montar evento: elige tipo, estado y acción.');
      return;
    }
    const descripcionRaw = descEl.value.trim();
    if (!descripcionRaw) {
      setStatus('Montar evento: describe el incidente.');
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
      let res;
      try {
        res = await api.postEventoReporte(body);
      } catch (err) {
        if (dist_odf != null && shouldRetryWithoutDistOdf(err)) {
          const fallbackBody = { ...body, dist_odf: null };
          res = await api.postEventoReporte(fallbackBody);
        } else {
          throw err;
        }
      }
      const id = res?.id;
      setStatus(`Evento guardado${id != null ? ` (id ${id})` : ''}.`);
      showToast(`✓ Evento guardado${id != null ? ` (id ${id})` : ''}`, 'ok');
      vibrateOk();
      onEventoGuardado?.();
      resetFormAfterSubmit();
    } catch (err) {
      if (isTransientError(err)) {
        const q = loadQueue();
        q.push(body);
        saveQueue(q);
        updateOfflineBadge();
        showToast('Guardado en el dispositivo. Se enviará al volver la red.', 'warn');
        vibrateOk();
        setStatus('Sin conexión: evento guardado en el dispositivo. Se enviará cuando vuelva la red.');
        resetFormAfterSubmit();
      } else {
        let msg = err instanceof Error ? err.message : String(err);
        if (/^503:/.test(msg) || msg.includes('eventos_reporte')) {
          msg += ' · En la carpeta del proyecto: npm run db:apply-eventos (o ejecuta sql/06_eventos_reporte.sql en PostgreSQL).';
        }
        showToast(`Error al guardar: ${msg}`, 'err');
        setStatus(`Montar evento: ${msg}`);
      }
    } finally {
      btnGuardar.disabled = false;
      refreshFechaText();
    }
  }

  refreshFechaText();
  updateOfflineBadge();
  restoreDraft();

  function notifyReportePanelOpened() {
    refreshFechaText();
    updateOfflineBadge();
    restoreDraft();
    void flushQueue();
    if (!pinnedLngLat) {
      showPlacementChooser();
    }
    updatePhaseDom();
  }

  function notifyReportePanelClosed() {
    pickPlacementMode = null;
    if (placementRow) placementRow.hidden = false;
    cancelAwaitingMapPickOnly();
  }

  btnGuardar.addEventListener('click', () => void submit());

  btnCancelWait?.addEventListener('click', () => {
    cancelAwaitingMapPickOnly();
    pickPlacementMode = null;
    if (placementRow) placementRow.hidden = false;
    closeReportePanelUi?.();
    setStatus('Montar evento: modo mapa cancelado.');
  });

  document.getElementById('btn-reporte-pick-cable')?.addEventListener('click', () => {
    if (!ensureMoleculeSelected(true)) return;
    pickPlacementMode = 'cable';
    if (placementRow) placementRow.hidden = true;
    startAwaitingMapPick();
  });
  document.getElementById('btn-reporte-pick-free')?.addEventListener('click', () => {
    if (!ensureMoleculeSelected(true)) return;
    pickPlacementMode = 'libre';
    if (placementRow) placementRow.hidden = true;
    startAwaitingMapPick();
  });

  btnRepick?.addEventListener('click', () => {
    clearPinnedAndRearm();
    setStatus('Montar evento: vuelve a elegir el punto (GPS o toque en el cable).');
  });

  btnUseGps?.addEventListener('click', () => handleGpsPick());
  btnRapido?.addEventListener('click', async () => {
    if (!ensureMoleculeSelected(true)) return;
    if (btnRapido.disabled) return;
    btnRapido.disabled = true;
    try {
      let hasPoint =
        !!pinnedLngLat &&
        Number.isFinite(pinnedLngLat.lng) &&
        Number.isFinite(pinnedLngLat.lat);
      if (!hasPoint) {
        hasPoint = await handleGpsPick({ silent: false });
      }
      if (!hasPoint) {
        setStatus('Evento rápido: no se pudo fijar ubicación GPS.');
        return;
      }
      applyPreset('corte-obras');
      if (!String(descEl.value || '').trim()) {
        descEl.value = 'Evento rápido en campo';
      }
      await submit();
    } finally {
      btnRapido.disabled = false;
    }
  });

  presetBtns.forEach((b) => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset || ''));
  });
  presetSelect?.addEventListener('change', () => {
    const key = String(presetSelect.value || '').trim();
    if (!key) return;
    applyPreset(key);
  });

  tipoEl.addEventListener('change', () => {
    syncActionsForTipo();
  });

  /* Detectar edición manual del campo Dist ODF para no sobreescribirlo luego. */
  distEl?.addEventListener('input', () => {
    distOdfIsManual = true;
    if (distAutoTag) distAutoTag.hidden = true;
  });

  /* Borrador automático de la descripción. */
  descEl.addEventListener('input', () => persistDraft());

  syncActionsForTipo();

  /* Flush al recuperar red y cuando vuelve el foco de la pestaña. */
  window.addEventListener('online', () => void flushQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
  });

  return {
    handleRouteLinePick,
    handleMapTapPick,
    cancelMapPickMode,
    resetForCableCleared,
    isAwaitingRoutePick: () => awaitingMapPick,
    notifyReportePanelOpened,
    notifyReportePanelClosed
  };
}
