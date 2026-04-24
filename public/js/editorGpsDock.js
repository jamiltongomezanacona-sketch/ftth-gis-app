/**
 * Brújula GPS mínima: solo UI — giro mientras sincroniza, color cuando el seguimiento está activo.
 * @param {{ geolocate: import('mapbox-gl').GeolocateControl, setStatus: (msg: string) => void }} opts
 * @returns {() => void}
 */
export function initEditorGpsDock(opts) {
  const { geolocate, setStatus } = opts;
  const root = document.getElementById('editor-gps-dock');
  if (!root || !geolocate) return () => {};

  const btnGps = document.getElementById('btn-map-gps');
  /** @type {ReturnType<typeof setTimeout> | null} */
  let errResetTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let syncWatchdog = null;

  function clearSyncWatchdog() {
    if (syncWatchdog != null) {
      clearTimeout(syncWatchdog);
      syncWatchdog = null;
    }
  }

  function clearModeClasses() {
    root.classList.remove(
      'editor-gps-dock--syncing',
      'editor-gps-dock--active',
      'editor-gps-dock--idle',
      'editor-gps-dock--error'
    );
  }

  function setMode(mode) {
    clearModeClasses();
    if (mode === 'syncing') root.classList.add('editor-gps-dock--syncing');
    else if (mode === 'active') root.classList.add('editor-gps-dock--active');
    else if (mode === 'error') root.classList.add('editor-gps-dock--error');
    else root.classList.add('editor-gps-dock--idle');
  }

  /** @param {{ data?: GeolocationPosition }} _ev */
  function onGeolocate(_ev) {
    clearSyncWatchdog();
    setMode('active');
    setStatus('GPS: posición actualizada en el mapa.');
  }

  /** @param {{ data?: GeolocationPositionError }} ev */
  function onError(ev) {
    clearSyncWatchdog();
    const err = ev?.data;
    const code = err?.code;
    let msg = 'GPS: sin señal o permiso denegado.';
    if (code === 1) msg = 'GPS: permiso de ubicación denegado.';
    else if (code === 2) msg = 'GPS: posición no disponible.';
    else if (code === 3) msg = 'GPS: tiempo de espera agotado.';
    setMode('error');
    setStatus(msg);
    if (errResetTimer) clearTimeout(errResetTimer);
    errResetTimer = setTimeout(() => {
      errResetTimer = null;
      setMode('idle');
    }, 2600);
  }

  function onOutOfMaxBounds() {
    setStatus('GPS: posición fuera de los límites del mapa.');
  }

  function onTrackStart() {
    setMode('active');
  }

  function onTrackEnd() {
    setMode('idle');
  }

  function onGpsClick() {
    if (errResetTimer) {
      clearTimeout(errResetTimer);
      errResetTimer = null;
    }
    clearSyncWatchdog();
    setMode('syncing');
    syncWatchdog = setTimeout(() => {
      syncWatchdog = null;
      if (!root.classList.contains('editor-gps-dock--syncing')) return;
      setMode('idle');
      setStatus('GPS: sin respuesta a tiempo. Vuelve a intentar.');
    }, 13000);
    try {
      geolocate.trigger();
    } catch {
      clearSyncWatchdog();
      setMode('error');
      setStatus('GPS: no se pudo iniciar la solicitud.');
      errResetTimer = setTimeout(() => {
        errResetTimer = null;
        setMode('idle');
      }, 2600);
    }
  }

  btnGps?.addEventListener('click', onGpsClick);

  geolocate.on('geolocate', onGeolocate);
  geolocate.on('error', onError);
  geolocate.on('outofmaxbounds', onOutOfMaxBounds);
  geolocate.on('trackuserlocationstart', onTrackStart);
  geolocate.on('trackuserlocationend', onTrackEnd);

  setMode('idle');

  return () => {
    geolocate.off('geolocate', onGeolocate);
    geolocate.off('error', onError);
    geolocate.off('outofmaxbounds', onOutOfMaxBounds);
    geolocate.off('trackuserlocationstart', onTrackStart);
    geolocate.off('trackuserlocationend', onTrackEnd);
    if (errResetTimer) clearTimeout(errResetTimer);
    clearSyncWatchdog();
  };
}
