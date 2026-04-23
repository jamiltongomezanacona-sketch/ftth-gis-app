/**
 * Panel analítico: consume /api/db-check y APIs de rutas/centrales por red.
 * Mapa Mapbox: superposición de tendidos y nodos FTTH vs corporativa.
 */

const turf = globalThis.turf;

async function loadConfig() {
  const deploy = await import('./config.deploy.js');
  const tok = String(deploy.MAPBOX_ACCESS_TOKEN ?? '').trim();
  if (tok && !tok.includes('YOUR_')) {
    return deploy;
  }
  try {
    return await import('./config.local.js');
  } catch {
    return await import('./config.example.js');
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function fetchJson(path, redHeader) {
  const headers = {
    Accept: 'application/json',
    'X-Red-Tipo': redHeader
  };
  const res = await fetch(path, { headers, cache: 'no-store' });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

/** @param {GeoJSON.FeatureCollection} fc */
function sumLineLengthMeters(fc) {
  if (!turf?.length) return null;
  let m = 0;
  for (const f of fc?.features || []) {
    const g = f?.geometry;
    if (!g || g.type !== 'LineString' || !g.coordinates?.length) continue;
    try {
      m += turf.length(g, { units: 'meters' });
    } catch {
      /* */
    }
  }
  return m;
}

function fmtKm(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function fmtPct(x) {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)} %`;
}

function kpiCard(label, value, hint = '') {
  return `<div class="analitica-kpi">
    <span class="analitica-kpi-label">${esc(label)}</span>
    <span class="analitica-kpi-value">${esc(value)}</span>
    ${hint ? `<span class="analitica-kpi-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

function barRow(label, value, max) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="analitica-bar-row">
    <span class="analitica-bar-label">${esc(label)}</span>
    <div class="analitica-bar-track" role="img" aria-label="${esc(label)}: ${value}">
      <div class="analitica-bar-fill" style="width:${pct}%"></div>
    </div>
    <span class="analitica-bar-num">${esc(String(value))}</span>
  </div>`;
}

/** @type {import('mapbox-gl').Map | null} */
let map = null;

function tokenInvalid(t) {
  return !t || String(t).includes('YOUR_MAPBOX');
}

function initMap(token) {
  const el = document.getElementById('analitica-map');
  const fb = document.getElementById('analitica-map-fallback');
  const mb = globalThis.mapboxgl;
  if (!el || !mb) return;

  if (tokenInvalid(token)) {
    fb?.removeAttribute('hidden');
    return;
  }
  fb?.setAttribute('hidden', '');

  mb.accessToken = token;
  map = new mb.Map({
    container: el,
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-74.3, 4.65],
    zoom: 5.2,
    attributionControl: true
  });
  map.addControl(new mb.NavigationControl({ visualizePitch: true }), 'top-right');

  map.on('load', () => {
    map.addSource('rutas-ftth', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addSource('rutas-corp', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addSource('cent-ftth', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    map.addSource('cent-corp', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'rutas-ftth-line',
      type: 'line',
      source: 'rutas-ftth',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#38bdf8',
        'line-width': 2.2,
        'line-opacity': 0.85
      }
    });
    map.addLayer({
      id: 'rutas-corp-line',
      type: 'line',
      source: 'rutas-corp',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: {
        'line-color': '#1e40af',
        'line-width': 1.8,
        'line-opacity': 0.85
      }
    });
    map.addLayer({
      id: 'cent-ftth-pt',
      type: 'circle',
      source: 'cent-ftth',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#22d3ee',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0f172a'
      }
    });
    map.addLayer({
      id: 'cent-corp-pt',
      type: 'circle',
      source: 'cent-corp',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#c4b5fd',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0f172a'
      }
    });
  });
}

/**
 * @param {GeoJSON.FeatureCollection} fcFtth
 * @param {GeoJSON.FeatureCollection} fcCorp
 * @param {GeoJSON.FeatureCollection} centF
 * @param {GeoJSON.FeatureCollection} centC
 */
function updateMapData(fcFtth, fcCorp, centF, centC) {
  if (!map || !map.getSource('rutas-ftth')) return;

  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource('rutas-ftth')).setData(fcFtth || { type: 'FeatureCollection', features: [] });
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource('rutas-corp')).setData(fcCorp || { type: 'FeatureCollection', features: [] });
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource('cent-ftth')).setData(centF || { type: 'FeatureCollection', features: [] });
  /** @type {import('mapbox-gl').GeoJSONSource} */ (map.getSource('cent-corp')).setData(centC || { type: 'FeatureCollection', features: [] });

  if (!turf?.bbox || !turf.featureCollection) return;

  const merged = turf.featureCollection([
    ...(fcFtth?.features || []),
    ...(fcCorp?.features || []),
    ...(centF?.features || []),
    ...(centC?.features || [])
  ]);
  if (merged.features.length === 0) return;

  try {
    const b = turf.bbox(merged);
    map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]]
      ],
      { padding: 56, maxZoom: 14, duration: 650 }
    );
  } catch {
    /* */
  }
}

/**
 * @param {object} p
 */
function deepAnalysisHtml(p) {
  const {
    nFtth,
    nCorp,
    lenF,
    lenC,
    ncF,
    ncC,
    sqlFtth,
    sqlCorp,
    sqlOtro
  } = p;

  const nTot = nFtth + nCorp;
  const lenTot = (Number.isFinite(lenF) ? lenF : 0) + (Number.isFinite(lenC) ? lenC : 0);
  const shareCablesFtth = nTot > 0 ? nFtth / nTot : NaN;
  const shareKmFtth = lenTot > 0 && Number.isFinite(lenF) ? lenF / lenTot : NaN;

  const avgLenF = nFtth > 0 && Number.isFinite(lenF) ? lenF / nFtth : NaN;
  const avgLenC = nCorp > 0 && Number.isFinite(lenC) ? lenC / nCorp : NaN;

  const deltaApiSqlF = Number.isFinite(sqlFtth) ? nFtth - sqlFtth : NaN;
  const deltaApiSqlC = Number.isFinite(sqlCorp) ? nCorp - sqlCorp : NaN;

  const coherence =
    (Number.isFinite(deltaApiSqlF) && deltaApiSqlF !== 0) ||
    (Number.isFinite(deltaApiSqlC) && deltaApiSqlC !== 0);

  const bullets = [];
  if (Number.isFinite(shareCablesFtth)) {
    bullets.push(
      `Partición de <strong>cables</strong> (API): ${fmtPct(shareCablesFtth)} FTTH frente a ${fmtPct(1 - shareCablesFtth)} corporativa.`
    );
  }
  if (Number.isFinite(shareKmFtth)) {
    bullets.push(
      `Partición de <strong>kilometraje</strong> acumulado: ${fmtPct(shareKmFtth)} FTTH; el resto corresponde a corporativa.`
    );
  }
  if (Number.isFinite(avgLenF) || Number.isFinite(avgLenC)) {
    bullets.push(
      `Longitud media por tendido (aprox.): FTTH ${fmtKm(avgLenF)}, corporativa ${fmtKm(avgLenC)}. Útil para comparar tramos típicos, no densidad territorial.`
    );
  }
  const ncTot = ncF + ncC;
  if (ncTot > 0) {
    bullets.push(
      `Nodos: ${ncF} FTTH y ${ncC} corporativa (${fmtPct(ncF / ncTot)} / ${fmtPct(ncC / ncTot)} del total).`
    );
  }

  let coherenceBlock = '';
  if (coherence) {
    coherenceBlock = `<div class="analitica-deep-callout analitica-deep-callout--warn" role="note">
      <strong>Coherencia SQL vs listado API</strong>
      <p class="analitica-deep-callout-p">Los conteos en base (<code>rutas_by_red</code>) no coinciden con el número de <code>LineString</code> devueltas por la API en esta petición. Diferencia FTTH: ${Number.isFinite(deltaApiSqlF) ? esc(String(deltaApiSqlF)) : '—'}; corporativa: ${Number.isFinite(deltaApiSqlC) ? esc(String(deltaApiSqlC)) : '—'}. Conviene revisar filtros, <code>red_tipo</code> o caché.</p>
    </div>`;
  } else if (Number.isFinite(sqlFtth) && Number.isFinite(sqlCorp)) {
    coherenceBlock = `<div class="analitica-deep-callout analitica-deep-callout--ok" role="note">
      <strong>Coherencia SQL vs API</strong>
      <p class="analitica-deep-callout-p">Los conteos de rutas por red alinean el criterio SQL con el GeoJSON actual de la API.</p>
    </div>`;
  }

  const otroNote =
    typeof sqlOtro === 'number' && sqlOtro > 0
      ? `<p class="analitica-deep-note">Hay <strong>${esc(String(sqlOtro))}</strong> filas con <code>red_tipo</code> distinto de FTTH/corporativa; conviene normalizar.</p>`
      : '';

  const bulletsHtml = bullets.map((s) => `<li>${s}</li>`).join('');

  return `
    ${coherenceBlock}
    ${otroNote}
    <ul class="analitica-deep-list">${bulletsHtml}</ul>
    <div class="analitica-deep-mini">
      ${kpiCard('Δ cables FTTH (API − SQL)', Number.isFinite(deltaApiSqlF) ? String(deltaApiSqlF) : '—', '—')}
      ${kpiCard('Δ cables corp. (API − SQL)', Number.isFinite(deltaApiSqlC) ? String(deltaApiSqlC) : '—', '—')}
      ${kpiCard('Media km/tendido FTTH', fmtKm(avgLenF), '')}
      ${kpiCard('Media km/tendido corp.', fmtKm(avgLenC), '')}
    </div>
  `;
}

async function loadAll() {
  const statusEl = document.getElementById('analitica-status');
  const kpiDb = document.getElementById('kpi-db');
  const kpiLen = document.getElementById('kpi-lengths');
  const kpiCent = document.getElementById('kpi-cent');
  const barsRoutes = document.getElementById('bars-routes');
  const deepEl = document.getElementById('analitica-deep');

  if (!statusEl || !kpiDb || !kpiLen || !kpiCent || !barsRoutes) return;

  statusEl.textContent = 'Cargando datos…';
  statusEl.classList.remove('analitica-status--err');

  try {
    const cfg = await loadConfig();
    if (!map) {
      initMap(cfg.MAPBOX_ACCESS_TOKEN);
    }

    const db = await fetchJson('/api/db-check', 'ftth');

    const [fcFtth, fcCorp, centF, centC] = await Promise.all([
      fetchJson('/api/rutas?red=ftth', 'ftth'),
      fetchJson('/api/rutas?red=corporativa', 'corporativa'),
      fetchJson('/api/centrales-etb?red=ftth', 'ftth'),
      fetchJson('/api/centrales-etb?red=corporativa', 'corporativa')
    ]);

    const nFtth = fcFtth?.features?.length ?? 0;
    const nCorp = fcCorp?.features?.length ?? 0;
    const lenF = sumLineLengthMeters(fcFtth);
    const lenC = sumLineLengthMeters(fcCorp);

    const ncF = centF?.features?.length ?? 0;
    const ncC = centC?.features?.length ?? 0;

    const byRed = db.rutas_by_red || {};
    const maxBar = Math.max(nFtth, nCorp, byRed.ftth ?? 0, byRed.corporativa ?? 0, 1);

    if (db.ok) {
      statusEl.textContent = `Última lectura: ${new Date().toLocaleString('es-CO')}`;
    } else {
      statusEl.textContent = 'API respondió sin ok=true';
    }

    kpiDb.innerHTML = [
      kpiCard('PostgreSQL', db.ok ? 'Conectado' : 'Error', ''),
      kpiCard('Tabla rutas', db.rutas_table ? 'Sí' : 'No', db.rutas_count != null ? `~${db.rutas_count} filas totales` : ''),
      kpiCard('Tabla centrales_etb', db.centrales_etb_table ? 'Sí' : 'No', ''),
      kpiCard('Rutas clasificadas FTTH (SQL)', String(byRed.ftth ?? '—'), 'criterio mismo que API listado FTTH'),
      kpiCard('Rutas corporativa (SQL)', String(byRed.corporativa ?? '—'), ''),
      byRed.otro != null && byRed.otro > 0
        ? kpiCard('Rutas «otro» valor red_tipo', String(byRed.otro), 'Revisar datos')
        : ''
    ]
      .filter(Boolean)
      .join('');

    barsRoutes.innerHTML =
      barRow('Cables listados API FTTH', nFtth, maxBar) +
      barRow('Cables listados API corporativa', nCorp, maxBar);

    kpiLen.innerHTML = [
      kpiCard('Longitud total FTTH (API)', fmtKm(lenF ?? NaN), `${nFtth} LineString`),
      kpiCard('Longitud total corporativa (API)', fmtKm(lenC ?? NaN), `${nCorp} LineString`)
    ].join('');

    kpiCent.innerHTML = [
      kpiCard('Puntos FTTH', String(ncF), 'GET centrales-etb?red=ftth'),
      kpiCard('Puntos corporativa', String(ncC), 'GET centrales-etb?red=corporativa')
    ].join('');

    if (deepEl) {
      deepEl.innerHTML = deepAnalysisHtml({
        nFtth,
        nCorp,
        lenF,
        lenC,
        ncF,
        ncC,
        sqlFtth: byRed.ftth,
        sqlCorp: byRed.corporativa,
        sqlOtro: byRed.otro
      });
    }

    const scheduleMap = () => {
      if (!map || tokenInvalid(cfg.MAPBOX_ACCESS_TOKEN)) return;
      const run = () => updateMapData(fcFtth, fcCorp, centF, centC);
      if (map.getSource('rutas-ftth')) run();
      else map.once('load', run);
    };
    scheduleMap();
  } catch (e) {
    statusEl.textContent = String(e.message || e);
    statusEl.classList.add('analitica-status--err');
    kpiDb.innerHTML = '';
    kpiLen.innerHTML = '';
    kpiCent.innerHTML = '';
    barsRoutes.innerHTML = '';
    if (deepEl) deepEl.innerHTML = '';
  }
}

document.getElementById('btn-refresh')?.addEventListener('click', () => loadAll());

(async () => {
  const cfg = await loadConfig();
  const { ensureAuthenticated } = await import('./authGate.js');
  await ensureAuthenticated(cfg.API_BASE ?? '');
  document.body.classList.remove('auth-pending');
  loadAll();
})();
