/**
 * Dock GPS (esquina inferior derecha del editor): dispara Mapbox GeolocateControl,
 * resume precisión, coordenadas WGS84, copiar y seguimiento del mapa.
 * @param {{ geolocate: import('mapbox-gl').GeolocateControl, setStatus: (msg: string) => void }} opts
 * @returns {() => void} Limpieza de listeners/timers.
 */
export function initEditorGpsDock(opts) {
  const { geolocate, setStatus } = opts;
  const root = document.getElementById('editor-gps-dock');
  if (!root || !geolocate) return () => {};

  const btnGps = document.getElementById('btn-map-gps');
  const btnExpand = document.getElementById('btn-editor-gps-expand');
  const panel = document.getElementById('editor-gps-panel');
  const pill = document.getElementById('editor-gps-pill');
  const ageEl = document.getElementById('editor-gps-age');
  const accM = document.getElementById('editor-gps-acc-m');
  const accFill = document.getElementById('editor-gps-acc-fill');
  const latEl = document.getElementById('editor-gps-lat');
  const lngEl = document.getElementById('editor-gps-lng');
  const btnCopy = document.getElementById('btn-editor-gps-copy');
  const btnFollow = document.getElementById('btn-editor-gps-follow');
  const headingRow = document.getElementById('editor-gps-heading-row');
  const headingEl = document.getElementById('editor-gps-heading');

  let lastCoordsText = '';
  /** @type {ReturnType<typeof setInterval> | null} */
  let ageTimer = null;

  function fmtDeg(n, d = 6) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    return n.toFixed(d);
  }

  /** Calidad visual 8–100 % a partir de radio de incertidumbre (m). */
  function accuracyQualityPct(meters) {
    if (typeof meters !== 'number' || meters <= 0) return 92;
    const m = Math.min(meters, 250);
    return Math.round(Math.max(8, Math.min(100, 100 - Math.sqrt(m) * 9)));
  }

  function setPill(text, variant) {
    if (!pill) return;
    pill.textContent = text;
    pill.classList.remove(
      'editor-gps-dock__pill--idle',
      'editor-gps-dock__pill--ok',
      'editor-gps-dock__pill--warn',
      'editor-gps-dock__pill--err',
      'editor-gps-dock__pill--wait'
    );
    if (variant === 'idle') pill.classList.add('editor-gps-dock__pill--idle');
    else if (variant === 'ok') pill.classList.add('editor-gps-dock__pill--ok');
    else if (variant === 'warn') pill.classList.add('editor-gps-dock__pill--warn');
    else if (variant === 'err') pill.classList.add('editor-gps-dock__pill--err');
    else if (variant === 'wait') pill.classList.add('editor-gps-dock__pill--wait');
  }

  function setSearching(on) {
    root.classList.toggle('editor-gps-dock--searching', on);
  }

  function clearAgeTimer() {
    if (ageTimer != null) {
      clearInterval(ageTimer);
      ageTimer = null;
    }
  }

  function updateAge(ts) {
    if (!ageEl || typeof ts !== 'number') return;
    clearAgeTimer();
    const tick = () => {
      const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
      ageEl.textContent = sec < 2 ? 'ahora' : `hace ${sec}s`;
    };
    tick();
    ageTimer = setInterval(tick, 1000);
  }

  function onTrackStart() {
    btnFollow?.setAttribute('aria-pressed', 'true');
    btnFollow?.classList.remove('editor-gps-dock__chip--off');
  }

  function onTrackEnd() {
    btnFollow?.setAttribute('aria-pressed', 'false');
    btnFollow?.classList.add('editor-gps-dock__chip--off');
  }

  /** @param {{ data?: GeolocationPosition }} ev */
  function onGeolocate(ev) {
    setSearching(false);
    const pos = ev?.data;
    const c = pos?.coords;
    if (!c) return;
    const lat = c.latitude;
    const lng = c.longitude;
    const acc = c.accuracy;
    lastCoordsText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    root.classList.add('editor-gps-dock--has-fix');
    setPill('Fijo', 'ok');
    if (latEl) latEl.textContent = fmtDeg(lat);
    if (lngEl) lngEl.textContent = fmtDeg(lng);
    if (accM) accM.textContent = `${Math.round(acc)} m`;
    if (accFill) accFill.style.width = `${accuracyQualityPct(acc)}%`;
    if (c.heading != null && !Number.isNaN(Number(c.heading))) {
      headingRow?.removeAttribute('hidden');
      if (headingEl) headingEl.textContent = String(Math.round(Number(c.heading)));
    } else {
      headingRow?.setAttribute('hidden', '');
    }
    updateAge(pos.timestamp || Date.now());
    setStatus('GPS: posición actualizada en el mapa.');
  }

  /** @param {{ data?: GeolocationPositionError }} ev */
  function onError(ev) {
    setSearching(false);
    const err = ev?.data;
    const code = err?.code;
    let msg = 'GPS: sin señal o permiso denegado. Revisa permisos del sitio y que la ubicación esté activa (móvil/PC).';
    if (code === 1) msg = 'GPS: permiso de ubicación denegado.';
    else if (code === 2) msg = 'GPS: posición no disponible en este momento.';
    else if (code === 3) msg = 'GPS: tiempo de espera agotado.';
    setPill('Sin señal', 'err');
    setStatus(msg);
  }

  function onOutOfMaxBounds() {
    setPill('Fuera de mapa', 'warn');
    setStatus('GPS: posición fuera de los límites del mapa.');
  }

  function onGpsClick() {
    setSearching(true);
    setPill('Buscando…', 'wait');
    try {
      geolocate.trigger();
    } catch {
      setSearching(false);
      setPill('Error', 'err');
      setStatus('GPS: no se pudo iniciar la solicitud.');
    }
  }

  btnGps?.addEventListener('click', onGpsClick);

  btnExpand?.addEventListener('click', () => {
    const open = btnExpand.getAttribute('aria-expanded') === 'true';
    const next = !open;
    btnExpand.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (panel) panel.hidden = !next;
    btnExpand.classList.toggle('editor-gps-dock__expand--open', next);
    root.classList.toggle('editor-gps-dock--expanded', next);
  });

  btnCopy?.addEventListener('click', async () => {
    if (!lastCoordsText) {
      setStatus('GPS: aún no hay posición para copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(lastCoordsText);
      setStatus('GPS: coordenadas copiadas al portapapeles.');
    } catch {
      setStatus('GPS: no se pudo copiar (permiso del navegador o contexto no seguro).');
    }
  });

  btnFollow?.addEventListener('click', () => {
    const next = btnFollow.getAttribute('aria-pressed') !== 'true';
    btnFollow.setAttribute('aria-pressed', next ? 'true' : 'false');
    btnFollow.classList.toggle('editor-gps-dock__chip--off', !next);
    try {
      geolocate.setFollowUserLocation(next);
    } catch {
      /* */
    }
  });

  geolocate.on('geolocate', onGeolocate);
  geolocate.on('error', onError);
  geolocate.on('outofmaxbounds', onOutOfMaxBounds);
  geolocate.on('trackuserlocationstart', onTrackStart);
  geolocate.on('trackuserlocationend', onTrackEnd);

  setPill('En espera', 'idle');

  return () => {
    geolocate.off('geolocate', onGeolocate);
    geolocate.off('error', onError);
    geolocate.off('outofmaxbounds', onOutOfMaxBounds);
    geolocate.off('trackuserlocationstart', onTrackStart);
    geolocate.off('trackuserlocationend', onTrackEnd);
    clearAgeTimer();
  };
}
