import { ensureAuthenticated } from './authGate.js';
import { createRutasApi } from './api.js';
import { RoutesLayer, ROUTES_LAYER_ID, ROUTES_SOURCE_ID } from './routesLayer.js';
import { CentralesEtBLayer } from './centralesLayer.js';
import { OtdrCutLayer } from './otdrCutLayer.js';
import { MedidaEventoMarkerLayer } from './medidaEventoMarkerLayer.js';
import {
  EventosReporteLayer,
  EVENTOS_REPORTE_INTERACTIVE_LAYER_IDS
} from './eventosReporteLayer.js?v=20260420c';
import { snapEventPointsToRouteCatalog } from './eventosReporteSnap.js';
import { RouteDrawEditor } from './routeDrawEditor.js';
import { createCableSearchBar } from './cableSearchBar.js';
import { initReporteEventoSidebar } from './reporteEventoSidebar.js';
import {
  findManifestEntryForMolecule,
  indexManifestEntries,
  matchMoleculeEntries,
  moleculeTokenFromSearchInput
} from './flashfiberManifest.js';
import {
  MoleculeOverlayLayer,
  MOLECULE_OVERLAY_INTERACTIVE_LAYER_IDS
} from './moleculeOverlayLayer.js';
import {
  filterRouteLinesByMolecule,
  loadMoleculeOverlayPointsCombined,
  parseMoleculaCodigo,
  parseMoleculeCentralFromRouteFeature
} from './moleculeFlashfiberLoad.js';
import {
  filterRoutesByNetwork,
  normalizeRouteFeatureProperties,
  redTipoOfFeature
} from './matchRutas.js';
import {
  lineLengthMeters,
  lengthWithReserve20Pct,
  geometricLengthFromFiberLengthMeters,
  distanceFromStartAlongLineMeters,
  snapLngLatToLine,
  nearestCentralMeters,
  cutPointFromOtdrFiberMeters,
  cutPointFromFiberFromClickRef
} from './measurements.js';
import {
  ensureMeasurePolylineLayers,
  setMeasurePolylineData,
  clearMeasurePolylineData,
  lineLengthMetersSafe,
  fmtTotalHuman
} from './measurePolylineLayer.js';
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

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEventoFechaEs(iso) {
  if (!iso || String(iso).trim() === '') return '—';
  try {
    return new Date(String(iso)).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  } catch {
    return String(iso);
  }
}

const PERF_DEBUG_KEY = 'ftth-perf-debug';
const PERF_DEBUG_PARAM = 'perf';
const PERF_STORE_MAX = 180;

function perfNowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isPerfDebugEnabled() {
  try {
    const qs = new URLSearchParams(window.location.search || '');
    if (qs.get(PERF_DEBUG_PARAM) === '1') return true;
  } catch {
    /* */
  }
  try {
    return localStorage.getItem(PERF_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Registra una métrica liviana en memoria y consola (solo si debug está activo).
 * @param {string} metric
 * @param {number} ms
 * @param {Record<string, unknown>} [meta]
 */
function pushPerfMetric(metric, ms, meta = {}) {
  if (!isPerfDebugEnabled()) return;
  const w = /** @type {any} */ (window);
  const store = Array.isArray(w.__FTTH_PERF_METRICS__) ? w.__FTTH_PERF_METRICS__ : [];
  store.push({
    ts: new Date().toISOString(),
    metric,
    ms: Number.isFinite(ms) ? Number(ms.toFixed(1)) : ms,
    ...meta
  });
  while (store.length > PERF_STORE_MAX) store.shift();
  w.__FTTH_PERF_METRICS__ = store;
  w.__FTTH_PERF_PUSH__ = pushPerfMetric;
  w.__FTTH_PERF_SUMMARY__ = () => {
    /** @type {Record<string, { n: number, total: number, max: number }>} */
    const acc = {};
    for (const row of store) {
      const name = String(row?.metric ?? 'unknown');
      const val = Number(row?.ms);
      if (!Number.isFinite(val)) continue;
      if (!acc[name]) acc[name] = { n: 0, total: 0, max: 0 };
      acc[name].n += 1;
      acc[name].total += val;
      acc[name].max = Math.max(acc[name].max, val);
    }
    return Object.entries(acc).map(([name, a]) => ({
      metric: name,
      n: a.n,
      avgMs: Number((a.total / Math.max(1, a.n)).toFixed(1)),
      maxMs: Number(a.max.toFixed(1))
    }));
  };
  console.debug(`[perf] ${metric}: ${Number(ms).toFixed(1)}ms`, meta);
}

try {
  const w = /** @type {any} */ (window);
  w.__FTTH_PERF_PUSH__ = pushPerfMetric;
} catch {
  /* */
}

/**
 * Contenido HTML escapado para el popup de un evento en el mapa (propiedades GeoJSON).
 * @param {Record<string, unknown>} p
 */
/** Modificador CSS para píldora de estado (evento popup). */
function eventoEstadoPillModifier(estadoRaw) {
  const e = String(estadoRaw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (e.includes('CRITICO')) return 'evento-popup__pill--critico';
  if (e.includes('RESUELTO')) return 'evento-popup__pill--resuelto';
  if (e.includes('PROCESO')) return 'evento-popup__pill--proceso';
  if (e.includes('PENDIENTE')) return 'evento-popup__pill--pendiente';
  if (e.includes('ESCALADO')) return 'evento-popup__pill--escalado';
  return 'evento-popup__pill--neutral';
}

/** Claves solo para layout / posición en mapa (no como filas genéricas). */
const CIERRE_POPUP_LAYOUT_KEYS = new Set([
  'ftth_overlay_kind',
  'ftth_orig_lon',
  'ftth_orig_lat'
]);

/** Ficha cierre (solo lectura): no mostrar estas claves (siguen en `p` para admin/API). */
const CIERRE_POPUP_OMIT_KEYS = new Set(['tipo', 'molecula_codigo', 'molecula_id', 'id', 'source']);

/** Claves alternativas a `dist_odf` en GeoJSON / export (una sola fila «Dist. ODF» en la ficha). */
const CIERRE_DIST_ODF_ALIAS_KEYS = [
  'dist_odf',
  'dist_odf_m',
  'distancia_odf',
  'distancia_odf_m',
  'DIST_ODF',
  'metros_odf',
  'metros_odf_m',
  'metraje_odf',
  'metraje_odf_m',
  'odf_m',
  'distOdf'
];

/**
 * @param {Record<string, unknown>} p
 * @returns {number | null}
 */
function pickDistOdfMetersFromProps(p) {
  for (const k of CIERRE_DIST_ODF_ALIAS_KEYS) {
    if (!(k in p) || p[k] == null || String(p[k]).trim() === '') continue;
    const d = Number(String(p[k]).replace(',', '.'));
    if (Number.isFinite(d) && d >= 0) return d;
  }
  return null;
}

/** Misma regla que `server/cierresRepo.js` (`isUuidString`). */
const CIERRE_DB_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function isCierreDbUuidLike(id) {
  return CIERRE_DB_UUID_RE.test(String(id ?? '').trim());
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
function isEventoReporteIdAdmin(id) {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1;
}

/**
 * @param {string} key
 */
function labelCierreProp(key) {
  const map = /** @type {Record<string, string>} */ ({
    nombre: 'Nombre',
    name: 'Nombre (name)',
    tipo: 'Tipo',
    molecula_codigo: 'Molécula',
    estado: 'Estado',
    dist_odf: 'Dist. ODF (m)',
    descripcion: 'Descripción',
    id: 'ID',
    molecula_id: 'Molécula ID',
    usuario_id: 'Usuario ID',
    created_at: 'Creado',
    lat: 'Latitud',
    lng: 'Longitud'
  });
  if (map[key]) return map[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param {Record<string, unknown>} p
 * @param {string} coordsWgs84 texto ya formateado lng, lat
 */
function htmlCierreMapPopup(p, coordsWgs84) {
  const nombre = String(p.nombre ?? p.name ?? '').trim();
  const title = nombre || 'Cierre / NAP';
  const kind = String(p.ftth_overlay_kind ?? '').trim();
  const kindLabel =
    kind === 'cierre_e1'
      ? 'Cierre E1'
      : kind === 'cierre_e2'
        ? 'Cierre E2'
        : kind === 'cierre_e0'
          ? 'Cierre E0'
          : kind === 'nap'
            ? 'NAP'
            : kind === 'cierre_otro'
              ? 'Cierre / punto'
              : kind || 'Punto';

  const preferred = ['estado', 'dist_odf', 'usuario_id', 'created_at', 'lat', 'lng'];
  const distM = pickDistOdfMetersFromProps(p);
  const isE1E2 = kind === 'cierre_e1' || kind === 'cierre_e2';

  /** @type {string[]} */
  const chunks = [];
  const pushRow = (dt, ddHtml) => {
    chunks.push(`<dt>${escapeHtml(dt)}</dt><dd>${ddHtml}</dd>`);
  };

  pushRow('Clase', `<span class="evento-popup__pill evento-popup__pill--tipo">${escapeHtml(kindLabel)}</span>`);
  if (nombre) {
    pushRow('Nombre', `<span class="evento-popup__value evento-popup__value--tendido">${escapeHtml(nombre)}</span>`);
  }

  if (isE1E2) {
    const distHtml =
      distM != null
        ? `<span class="evento-popup__value evento-popup__value--mono">${escapeHtml(String(distM))}</span>`
        : `<span class="evento-popup__value evento-popup__value--mono">—</span>`;
    pushRow('Dist. ODF (m)', distHtml);
  } else {
    for (const key of preferred) {
      if (key === 'dist_odf') {
        if (distM == null) continue;
        pushRow(
          labelCierreProp('dist_odf'),
          `<span class="evento-popup__value evento-popup__value--mono">${escapeHtml(String(distM))}</span>`
        );
        continue;
      }
      if (!(key in p) || p[key] == null || String(p[key]).trim() === '') continue;
      let raw = p[key];
      if (key === 'created_at') raw = formatEventoFechaEs(raw);
      const val = escapeHtml(String(raw));
      const mono = key === 'usuario_id' ? ' evento-popup__value--mono' : '';
      pushRow(labelCierreProp(key), `<span class="evento-popup__value${mono}">${val}</span>`);
    }
  }

  pushRow(
    'Coordenadas (WGS84)',
    `<span class="evento-popup__value evento-popup__value--mono">${escapeHtml(coordsWgs84)}</span>`
  );

  const used = new Set([
    'nombre',
    'name',
    ...preferred,
    ...CIERRE_POPUP_LAYOUT_KEYS,
    ...CIERRE_POPUP_OMIT_KEYS,
    ...CIERRE_DIST_ODF_ALIAS_KEYS
  ]);
  if (!isE1E2) {
    const restKeys = Object.keys(p)
      .filter((k) => !used.has(k) && k !== 'descripcion' && !CIERRE_POPUP_OMIT_KEYS.has(k))
      .sort((a, b) => a.localeCompare(b, 'es'));
    for (const key of restKeys) {
      const v = p[key];
      if (v == null || v === '') continue;
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (s.length > 280) s = `${s.slice(0, 280)}…`;
      pushRow(labelCierreProp(key), `<span class="evento-popup__value">${escapeHtml(s)}</span>`);
    }

    const lo = p.ftth_orig_lon != null ? Number(p.ftth_orig_lon) : NaN;
    const la = p.ftth_orig_lat != null ? Number(p.ftth_orig_lat) : NaN;
    if (Number.isFinite(lo) && Number.isFinite(la)) {
      pushRow(
        'Coord. inventario',
        `<span class="evento-popup__value evento-popup__value--mono">${escapeHtml(`${lo.toFixed(6)}, ${la.toFixed(6)}`)}</span>`
      );
    }
  }

  const desc = escapeHtml(String(p.descripcion ?? '').trim());
  const idStr = String(p.id ?? '').trim();
  const canAdmin = String(p.source) === 'db_cierres' && isCierreDbUuidLike(idStr);
  const admin = canAdmin
    ? `<div class="evento-popup__actions">
    <button type="button" class="evento-popup__btn" data-admin="ci-edit">Editar</button>
    <button type="button" class="evento-popup__btn evento-popup__btn--danger" data-admin="ci-del">Borrar</button>
  </div>`
    : '';
  return `<div class="evento-popup">
  <div class="evento-popup__title">${escapeHtml(title)}</div>
  <dl class="evento-popup__grid">
    ${chunks.join('')}
  </dl>
  <div class="evento-popup__desc">
    <span class="evento-popup__desc-label">Descripción</span>
    <p class="evento-popup__desc-text">${desc || '—'}</p>
  </div>
  ${admin}
</div>`;
}

const EVENTO_TIPO_OPTS = [
  'VANDALISMO',
  'OBRAS CIVILES',
  'DETERIORO',
  'MANTENIMIENTO',
  'DAÑO POR TERCEROS'
];
const EVENTO_ESTADO_OPTS = ['CRITICO', 'EN PROCESO', 'RESUELTO', 'PENDIENTE', 'ESCALADO'];
const EVENTO_ACCION_OPTS = ['REEMPLAZO DE FIBRA', 'SE INSTALA CIERRE', 'INTERVENCIÓN TECNICA'];

/**
 * @param {string[]} values
 * @param {unknown} current
 */
function htmlSelectOpts(values, current) {
  const c = String(current ?? '').trim();
  return values
    .map((v) => `<option value="${escapeHtml(v)}"${v === c ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

/**
 * @param {Record<string, unknown>} p
 */
function htmlEventoMapPopupEditForm(p) {
  const id = p.id != null ? String(p.id) : '';
  const dist =
    p.dist_odf != null && Number.isFinite(Number(p.dist_odf)) ? String(Number(p.dist_odf)) : '';
  return `<div class="evento-popup evento-popup--edit">
  <div class="evento-popup__title">Editar evento #${escapeHtml(id)}</div>
  <div class="evento-popup__edit-grid">
    <label class="evento-popup__edit-lab">Tipo</label>
    <select class="evento-popup__edit-ctl" data-f="tipo">${htmlSelectOpts(EVENTO_TIPO_OPTS, p.tipo_evento)}</select>
    <label class="evento-popup__edit-lab">Estado</label>
    <select class="evento-popup__edit-ctl" data-f="estado">${htmlSelectOpts(EVENTO_ESTADO_OPTS, p.estado)}</select>
    <label class="evento-popup__edit-lab">Acción</label>
    <select class="evento-popup__edit-ctl" data-f="accion">${htmlSelectOpts(EVENTO_ACCION_OPTS, p.accion)}</select>
    <label class="evento-popup__edit-lab">Dist. ODF (m)</label>
    <input class="evento-popup__edit-ctl" type="number" min="0" step="0.1" data-f="dist_odf" value="${escapeHtml(dist)}" />
    <label class="evento-popup__edit-lab">Descripción</label>
    <textarea class="evento-popup__edit-ctl evento-popup__edit-ta" rows="5" maxlength="8000" data-f="desc">${escapeHtml(String(p.descripcion ?? ''))}</textarea>
  </div>
  <div class="evento-popup__actions">
    <button type="button" class="evento-popup__btn" data-admin="ev-cancel">Volver</button>
    <button type="button" class="evento-popup__btn evento-popup__btn--primary" data-admin="ev-save">Guardar</button>
  </div>
</div>`;
}

/**
 * @param {Record<string, unknown>} p
 * @param {string} coordsWgs84
 */
function htmlCierreMapPopupEditForm(p, coordsWgs84) {
  const id = String(p.id ?? '').trim();
  return `<div class="evento-popup evento-popup--edit">
  <div class="evento-popup__title">Editar cierre</div>
  <p class="evento-popup__hint">ID <span class="evento-popup__value--mono">${escapeHtml(id)}</span> · WGS84 ${escapeHtml(coordsWgs84)}</p>
  <div class="evento-popup__edit-grid">
    <label class="evento-popup__edit-lab">Nombre</label>
    <input class="evento-popup__edit-ctl" type="text" data-f="nombre" value="${escapeHtml(String(p.nombre ?? p.name ?? ''))}" maxlength="500" />
    <label class="evento-popup__edit-lab">Tipo</label>
    <input class="evento-popup__edit-ctl" type="text" data-f="tipo" value="${escapeHtml(String(p.tipo ?? ''))}" maxlength="80" />
    <label class="evento-popup__edit-lab">Estado</label>
    <input class="evento-popup__edit-ctl" type="text" data-f="estado" value="${escapeHtml(String(p.estado ?? ''))}" maxlength="120" />
    <label class="evento-popup__edit-lab">Molécula</label>
    <input class="evento-popup__edit-ctl" type="text" data-f="molecula_codigo" value="${escapeHtml(String(p.molecula_codigo ?? ''))}" maxlength="200" />
    <label class="evento-popup__edit-lab">Dist. ODF</label>
    <input class="evento-popup__edit-ctl" type="number" data-f="dist_odf" min="0" step="0.1" value="${p.dist_odf != null && Number.isFinite(Number(p.dist_odf)) ? escapeHtml(String(Number(p.dist_odf))) : ''}" />
    <label class="evento-popup__edit-lab">Lat / Lng</label>
    <div class="evento-popup__edit-pair">
      <input class="evento-popup__edit-ctl" type="number" step="any" data-f="lat" placeholder="lat" value="${p.lat != null ? escapeHtml(String(Number(p.lat))) : ''}" />
      <input class="evento-popup__edit-ctl" type="number" step="any" data-f="lng" placeholder="lng" value="${p.lng != null ? escapeHtml(String(Number(p.lng))) : ''}" />
    </div>
    <label class="evento-popup__edit-lab">Descripción</label>
    <textarea class="evento-popup__edit-ctl evento-popup__edit-ta" rows="4" maxlength="8000" data-f="desc">${escapeHtml(String(p.descripcion ?? ''))}</textarea>
  </div>
  <div class="evento-popup__actions">
    <button type="button" class="evento-popup__btn" data-admin="ci-cancel">Volver</button>
    <button type="button" class="evento-popup__btn evento-popup__btn--primary" data-admin="ci-save">Guardar</button>
  </div>
</div>`;
}

function htmlEventoMapPopup(p) {
  const id = p.id != null ? String(p.id) : '?';
  const tipo = escapeHtml(p.tipo_evento);
  const estado = escapeHtml(p.estado);
  const accion = escapeHtml(p.accion);
  const nom = escapeHtml(p.nombre_tendido ?? '');
  const desc = escapeHtml(p.descripcion ?? '');
  const fecha = escapeHtml(formatEventoFechaEs(p.created_iso));
  const d = p.dist_odf != null ? Number(p.dist_odf) : NaN;
  const dist = Number.isFinite(d) ? escapeHtml(String(d)) : '—';
  const r = p.ruta_id != null ? Number(p.ruta_id) : NaN;
  const ruta = Number.isFinite(r) && r > 0 ? escapeHtml(String(r)) : '—';
  let coords = '—';
  const lo = p.lng != null ? Number(p.lng) : NaN;
  const la = p.lat != null ? Number(p.lat) : NaN;
  if (Number.isFinite(lo) && Number.isFinite(la)) {
    coords = escapeHtml(`${lo.toFixed(6)}, ${la.toFixed(6)}`);
  }
  const stMod = eventoEstadoPillModifier(p.estado);
  const canEventoAdmin = isEventoReporteIdAdmin(p.id);
  const eventoActions = canEventoAdmin
    ? `<div class="evento-popup__actions">
    <button type="button" class="evento-popup__btn" data-admin="ev-edit">Editar</button>
    <button type="button" class="evento-popup__btn evento-popup__btn--danger" data-admin="ev-del">Borrar</button>
  </div>`
    : '';
  return `<div class="evento-popup">
  <div class="evento-popup__title">Evento #${escapeHtml(id)}</div>
  <dl class="evento-popup__grid">
    <dt>Fecha</dt><dd><span class="evento-popup__value">${fecha}</span></dd>
    <dt>Tipo</dt><dd><span class="evento-popup__pill evento-popup__pill--tipo">${tipo || '—'}</span></dd>
    <dt>Estado</dt><dd><span class="evento-popup__pill evento-popup__pill--estado ${stMod}">${estado || '—'}</span></dd>
    <dt>Acción</dt><dd><span class="evento-popup__pill evento-popup__pill--accion">${accion || '—'}</span></dd>
    <dt>Molécula / tendido</dt><dd><span class="evento-popup__value evento-popup__value--tendido">${nom || '—'}</span></dd>
    <dt>Dist. ODF</dt><dd><span class="evento-popup__value evento-popup__value--mono">${dist}</span></dd>
    <dt>Ruta ID</dt><dd><span class="evento-popup__value evento-popup__value--mono">${ruta}</span></dd>
    <dt>Coordenadas (WGS84)</dt><dd><span class="evento-popup__value evento-popup__value--mono">${coords}</span></dd>
  </dl>
  <div class="evento-popup__desc">
    <span class="evento-popup__desc-label">Descripción</span>
    <p class="evento-popup__desc-text">${desc || '—'}</p>
  </div>
  ${eventoActions}
</div>`;
}

const STORAGE_KEY = 'ftth-gis-network';

function readSessionNetwork() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === 'ftth' || v === 'corporativa') return v;
  } catch {
    /* modo privado u otro */
  }
  return null;
}

/**
 * Red fijada por URL (?red=ftth|corporativa). Prioridad sobre sessionStorage.
 * @returns {'ftth'|'corporativa'|null}
 */
function readNetworkFromUrl() {
  try {
    const u = new URL(window.location.href);
    for (const key of ['red', 'tipo', 'network']) {
      const raw = u.searchParams.get(key);
      const s = String(raw ?? '')
        .trim()
        .toLowerCase();
      if (s === 'ftth') return 'ftth';
      if (s === 'corporativa' || s === 'corp' || s === 'corporate') return 'corporativa';
    }
  } catch {
    /* */
  }
  return null;
}

/**
 * Deja la red visible en la barra de direcciones (un proyecto por URL).
 * @param {'ftth'|'corporativa'} red
 */
function syncBrowserUrlRed(red) {
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.get('red') === red) return;
    u.searchParams.set('red', red);
    const qs = u.searchParams.toString();
    history.replaceState({}, '', qs ? `${u.pathname}?${qs}${u.hash}` : `${u.pathname}${u.hash}`);
  } catch {
    /* */
  }
}

function syncEditorFloatBackdrop() {
  const bd = document.getElementById('editor-float-backdrop');
  if (!bd) return;
  const t = document.getElementById('editor-float-trazar')?.classList.contains('editor-float-panel--open');
  const r = document
    .getElementById('reporte-evento-details')
    ?.classList.contains('editor-float-panel--open');
  if (t || r) {
    bd.removeAttribute('hidden');
    bd.setAttribute('aria-hidden', 'false');
  } else {
    bd.setAttribute('hidden', '');
    bd.setAttribute('aria-hidden', 'true');
  }
}

/** Cierra ventanas flotantes Trazar / Reporte (backdrop + estado de botones). */
function closeAllEditorFloatPanels() {
  document.getElementById('editor-float-trazar')?.classList.remove('editor-float-panel--open');
  document.getElementById('reporte-evento-details')?.classList.remove('editor-float-panel--open');
  document.getElementById('btn-open-panel-trazar')?.setAttribute('aria-expanded', 'false');
  document.getElementById('btn-open-panel-reporte')?.setAttribute('aria-expanded', 'false');
  syncEditorFloatBackdrop();
}

/**
 * Activa o desactiva el «modo pick» en un panel flotante: el panel se reduce
 * a una píldora arriba con un botón Cancelar, dejando el mapa totalmente
 * libre para el clic. Si el panel está cerrado, lo abre brevemente para que
 * la píldora sea visible (estado armado).
 *
 * @param {'trazar'|'reporte'} which Panel a marcar.
 * @param {boolean} on `true` para entrar en modo pick, `false` para restaurar.
 */
function setEditorFloatPickMode(which, on) {
  const id = which === 'reporte' ? 'reporte-evento-details' : 'editor-float-trazar';
  const el = document.getElementById(id);
  if (!el) return;
  if (on) {
    /* Solo un flotante activo: al armar pick (OTDR o reporte) cerramos el otro panel
       — si no, Trazar + Montar evento quedan abiertos y en documento se ven apilados. */
    const otherId = which === 'reporte' ? 'editor-float-trazar' : 'reporte-evento-details';
    const other = document.getElementById(otherId);
    other?.classList.remove('editor-float-panel--open');
    if (which === 'reporte') {
      document.getElementById('btn-open-panel-trazar')?.setAttribute('aria-expanded', 'false');
    } else {
      document.getElementById('btn-open-panel-reporte')?.setAttribute('aria-expanded', 'false');
    }
    /* Si el usuario armó la herramienta sin el panel abierto (caso raro pero posible),
       garantizamos que la píldora se vea: añadimos --open + --pick-mode. */
    el.classList.add('editor-float-panel--open');
    el.classList.add('editor-float-panel--pick-mode');
    if (which === 'reporte') {
      el.classList.add('editor-float-panel--pick-mode-reporte');
    }
    document.body.classList.add('editor-pick-mode-active');
    syncEditorFloatBackdrop();
  } else {
    el.classList.remove('editor-float-panel--pick-mode');
    el.classList.remove('editor-float-panel--pick-mode-reporte');
    /* Si ningún panel sigue armado, retiramos la marca global del body. */
    const stillArmed = document.querySelector('.editor-float-panel--pick-mode');
    if (!stillArmed) document.body.classList.remove('editor-pick-mode-active');
  }
}

/**
 * Abre/cierra una ventana flotante de herramienta (solo una visible; mismo botón cierra).
 * @param {'trazar'|'reporte'} which
 * @param {{ onReporteOpen?: () => void, onReporteClose?: () => void, onTrazarOpen?: () => void }} [hooks]
 */
function toggleEditorFloatPanel(which, hooks) {
  const tr = document.getElementById('editor-float-trazar');
  const rep = document.getElementById('reporte-evento-details');
  const openT = !!tr?.classList.contains('editor-float-panel--open');
  const openR = !!rep?.classList.contains('editor-float-panel--open');
  if (which === 'trazar') {
    if (openT) {
      tr?.classList.remove('editor-float-panel--open');
    } else {
      if (openR) hooks?.onReporteClose?.();
      rep?.classList.remove('editor-float-panel--open');
      tr?.classList.add('editor-float-panel--open');
      hooks?.onTrazarOpen?.();
    }
  } else if (openR) {
    rep?.classList.remove('editor-float-panel--open');
    hooks?.onReporteClose?.();
  } else {
    if (openT) tr?.classList.remove('editor-float-panel--open');
    rep?.classList.add('editor-float-panel--open');
    hooks?.onReporteOpen?.();
  }
  syncEditorFloatBackdrop();
  document.getElementById('btn-open-panel-trazar')?.setAttribute(
    'aria-expanded',
    tr?.classList.contains('editor-float-panel--open') ? 'true' : 'false'
  );
  document.getElementById('btn-open-panel-reporte')?.setAttribute(
    'aria-expanded',
    rep?.classList.contains('editor-float-panel--open') ? 'true' : 'false'
  );
}

/** v2: migración para quitar estado «colapsado» heredado cuando el panel quedaba detrás del mapa. */
const SIDEBAR_COLLAPSED_KEY = 'ftth-gis-sidebar-collapsed-v2';

/** Por defecto el mapa abre con el panel cerrado; solo se expande si el usuario guardó explícitamente «abierto» (`0`). */
function readSidebarCollapsedPreference() {
  try {
    const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (v === '0') return false;
  } catch {
    /* */
  }
  return true;
}

/**
 * Panel flotante (escritorio) / apilado (móvil). El mapa va a pantalla completa bajo la barra superior.
 * @param {{ resize: () => void }} mapInstance
 * @param {{ getSuppressMapSidebarCollapse?: () => boolean }} [opts]
 */
function initSidebarRail(mapInstance, opts) {
  const layout = document.getElementById('layout');
  const btn = document.getElementById('sidebar-toggle');
  if (!layout || !btn) return;

  const collapsed = readSidebarCollapsedPreference();

  function applyExpandedUi(/** @type {boolean} */ expanded) {
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.title = expanded ? 'Ocultar herramientas' : 'Mostrar herramientas';
    btn.setAttribute('aria-label', expanded ? 'Ocultar panel de herramientas' : 'Mostrar panel de herramientas');
  }

  function bumpMapResize() {
    if (typeof opts?.scheduleMapResize === 'function') {
      opts.scheduleMapResize();
      return;
    }
    window.requestAnimationFrame(() => mapInstance.resize());
    window.setTimeout(() => mapInstance.resize(), 120);
  }

  function setCollapsed(/** @type {boolean} */ c) {
    if (c) closeAllEditorFloatPanels();
    layout.classList.toggle('sidebar-collapsed', c);
    applyExpandedUi(!c);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, c ? '1' : '0');
    } catch {
      /* */
    }
    bumpMapResize();
  }

  if (collapsed) {
    layout.classList.add('sidebar-collapsed');
    applyExpandedUi(false);
  } else {
    layout.classList.remove('sidebar-collapsed');
    applyExpandedUi(true);
  }

  btn.addEventListener('click', () => {
    setCollapsed(!layout.classList.contains('sidebar-collapsed'));
  });

  /**
   * Tras tocar el menú hamburguesa / rail de herramientas, Mapbox a veces emite
   * también `click` en el mapa: eso colapsaba el menú y cerraba paneles al instante
   * (Trazar / reporte / medir «no hacen nada»). Damos un margen e ignoramos cierres
   * cuyo evento no provenga del canvas WebGL.
   */
  const SIDEBAR_RAIL_INTERACTION_GRACE_MS = 520;
  let suppressMapClickUntil = 0;
  const markRailInteraction = () => {
    suppressMapClickUntil = performance.now() + SIDEBAR_RAIL_INTERACTION_GRACE_MS;
  };
  const sidebar = document.getElementById('sidebar');
  const chrome = document.querySelector('header.editor-chrome');
  for (const ev of ['click', 'pointerdown', 'touchstart']) {
    const opt = ev === 'click' ? false : { capture: true, passive: true };
    sidebar?.addEventListener(ev, markRailInteraction, opt);
    if (ev !== 'click') {
      btn?.addEventListener(ev, markRailInteraction, { capture: true, passive: true });
    }
  }
  btn?.addEventListener('click', markRailInteraction, false);
  chrome?.addEventListener('click', markRailInteraction, false);
  chrome?.addEventListener('pointerdown', markRailInteraction, { capture: true, passive: true });

  /** Clic en el **lienzo** (canvas): cierra flotantes y retrae el menú. No a clicks fantasma. */
  mapInstance.on('click', (e) => {
    if (performance.now() < suppressMapClickUntil) return;
    if (layout.classList.contains('sidebar-collapsed')) return;
    if (opts?.getSuppressMapSidebarCollapse?.()) return;
    const t = e?.originalEvent && e.originalEvent.target;
    if (!(t instanceof Node)) return;
    let canvas;
    try {
      canvas = mapInstance.getCanvas();
    } catch {
      return;
    }
    if (canvas && !canvas.contains(/** @type {Node} */ (t))) return;
    closeAllEditorFloatPanels();
    setCollapsed(true);
  });
}

/**
 * Indicadores de red / guardado (la barra inferior VSCode es opcional en DOM).
 * Coordenadas y zoom solo se pintan si existen los nodos `#status-bar-*`.
 *
 * @param {{ on: Function, getZoom: () => number }} mapInstance
 * @returns {{ setNet: (label: string) => void, setSave: (state: 'ready'|'busy'|'ok'|'error', msg?: string) => void }}
 */
function initStatusBar(mapInstance) {
  const coordsEl = document.querySelector('#status-bar-coords .editor-status-bar__coords-text');
  const zoomEl = document.querySelector('#status-bar-zoom .editor-status-bar__zoom-text');
  const netEl = document.querySelector('#status-bar-net .editor-status-bar__net-label');
  const saveItem = document.getElementById('status-bar-save');
  const saveTextEl = saveItem?.querySelector('.editor-status-bar__save-text') ?? null;

  /** Formatea coordenadas con 5 decimales (~1.1m de precisión, suficiente para FTTH urbano). */
  function fmtLngLat(/** @type {number} */ lng, /** @type {number} */ lat) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '—, —';
    const lngTxt = lng.toFixed(5);
    const latTxt = lat.toFixed(5);
    return `${latTxt}, ${lngTxt}`;
  }

  function fmtZoom(/** @type {number} */ z) {
    if (!Number.isFinite(z)) return '—';
    return z.toFixed(2);
  }

  /** Throttle simple via rAF: actualizamos coords como mucho 60 fps. */
  let pendingFrame = false;
  let lastLngLat = /** @type {[number, number] | null} */ (null);
  function scheduleCoordsPaint() {
    if (pendingFrame || !coordsEl) return;
    pendingFrame = true;
    window.requestAnimationFrame(() => {
      pendingFrame = false;
      if (!lastLngLat) return;
      coordsEl.textContent = fmtLngLat(lastLngLat[0], lastLngLat[1]);
    });
  }

  try {
    mapInstance.on('mousemove', (/** @type {{ lngLat: { lng: number, lat: number } }} */ e) => {
      lastLngLat = [e.lngLat.lng, e.lngLat.lat];
      scheduleCoordsPaint();
    });
    mapInstance.on('mouseout', () => {
      if (coordsEl) coordsEl.textContent = '—, —';
    });
  } catch {
    /* mapInstance puede no soportar el evento; ignorar. */
  }

  function paintZoom() {
    try {
      if (zoomEl) zoomEl.textContent = fmtZoom(mapInstance.getZoom());
    } catch {
      /* */
    }
  }
  paintZoom();
  try {
    mapInstance.on('zoom', paintZoom);
    mapInstance.on('zoomend', paintZoom);
  } catch {
    /* */
  }

  /** Cambia el indicador de red activa (FTTH / Corporativa) en la status bar. */
  function setNet(/** @type {string} */ label) {
    if (netEl) netEl.textContent = label;
  }

  /**
   * Indicador de guardado / actividad. Estados:
   *   'ready' (verde, "Listo"), 'busy' (naranja parpadea), 'ok' (verde, mensaje), 'error' (rojo).
   */
  let resetSaveTimer = /** @type {number | null} */ (null);
  function setSave(/** @type {'ready'|'busy'|'ok'|'error'} */ state, /** @type {string} */ msg) {
    if (!saveItem) return;
    saveItem.classList.remove('editor-status-bar__item--save-busy', 'editor-status-bar__item--save-error');
    if (state === 'busy') saveItem.classList.add('editor-status-bar__item--save-busy');
    if (state === 'error') saveItem.classList.add('editor-status-bar__item--save-error');
    const defaultText =
      state === 'busy' ? 'Guardando…' :
      state === 'error' ? 'Error' :
      state === 'ok' ? (msg || 'Guardado') :
      'Listo';
    if (saveTextEl) saveTextEl.textContent = msg || defaultText;
    if (resetSaveTimer != null) {
      window.clearTimeout(resetSaveTimer);
      resetSaveTimer = null;
    }
    if (state === 'ok' || state === 'error') {
      resetSaveTimer = window.setTimeout(() => {
        if (saveTextEl) saveTextEl.textContent = 'Listo';
        saveItem.classList.remove('editor-status-bar__item--save-busy', 'editor-status-bar__item--save-error');
        resetSaveTimer = null;
      }, 3500);
    }
  }

  return { setNet, setSave };
}

/**
 * Acciones de campo: FAB GPS en mapa, medir y paneles desde el menú lateral.
 * @param {{ resize: () => void }} mapInstance
 * @param {{ trigger: () => void }} geolocateCtl
 * @param {() => void} scheduleMapResize
 * @param {() => void} [onToggleMeasurePolyline] En editor el FAB de medir está oculto; el menú llama aquí.
 */
function initFieldSidebar(mapInstance, geolocateCtl, scheduleMapResize, onToggleMeasurePolyline) {
  const editorBody = document.body;

  function requestMapResize() {
    if (typeof scheduleMapResize === 'function') {
      scheduleMapResize();
      return;
    }
    window.requestAnimationFrame(() => {
      try {
        mapInstance.resize();
      } catch {
        /* */
      }
    });
  }

  function clearBottomSheetSpacer() {
    if (!editorBody) return;
    editorBody.style.setProperty('--editor-op-visible-height', '0px');
  }

  clearBottomSheetSpacer();
  window.requestAnimationFrame(() => {
    clearBottomSheetSpacer();
    requestMapResize();
  });
  window.addEventListener('resize', () => {
    clearBottomSheetSpacer();
  });

  document.getElementById('btn-map-gps')?.addEventListener('click', () => {
    try {
      geolocateCtl.trigger();
    } catch {
      /* */
    }
  });

  document.getElementById('btn-open-panel-measure')?.addEventListener('click', () => {
    if (typeof onToggleMeasurePolyline === 'function') {
      onToggleMeasurePolyline();
    } else {
      document.getElementById('measure-fab')?.click();
    }
  });
}

function waitForNetworkChoice() {
  return new Promise((resolve) => {
    const gate = document.getElementById('network-gate');
    const ftthBtn = document.getElementById('btn-network-ftth');
    const corpBtn = document.getElementById('btn-network-corp');
    if (!gate || !ftthBtn || !corpBtn) {
      resolve('ftth');
      return;
    }
    gate.classList.remove('network-gate--dismissed');
    document.body.classList.add('network-gate-open');
    const finish = (/** @type {'ftth'|'corporativa'} */ red) => {
      try {
        sessionStorage.setItem(STORAGE_KEY, red);
      } catch {
        /* */
      }
      syncBrowserUrlRed(red);
      gate.classList.add('network-gate--dismissed');
      document.body.classList.remove('network-gate-open');
      resolve(red);
    };
    ftthBtn.onclick = () => finish('ftth');
    corpBtn.onclick = () => finish('corporativa');
  });
}

/**
 * @param {'ftth'|'corporativa'} network
 */
function applyNetworkUi(network) {
  const isCorp = network === 'corporativa';
  const h = document.getElementById('app-heading');
  const chromeTitle = document.getElementById('editor-chrome-title');
  const chromeMeta = document.getElementById('editor-chrome-meta');
  const brandImg = document.querySelector('.brand-mark img');
  const fav = document.querySelector('link[rel="icon"]');
  const lblDist = document.getElementById('metric-label-nearest-dist');
  const lblName = document.getElementById('metric-label-nearest-name');
  if (h) h.textContent = isCorp ? 'Operación · corporativa' : 'Operación';
  if (chromeTitle) {
    chromeTitle.textContent = isCorp ? 'GIS · corporativa' : 'GIS · FTTH';
    chromeTitle.setAttribute(
      'title',
      isCorp
        ? 'Buscador en barra · medición (pin evento en cable) · tendidos corporativos'
        : 'Buscador en barra · medición (pin evento) · Trazar en panel · tendidos FTTH'
    );
  }
  if (chromeMeta) {
    chromeMeta.textContent = '';
  }
  if (brandImg) {
    brandImg.src = isCorp ? '/icons/ftth-mapa/edificio.svg' : '/icons/ui/operacion.svg';
  }
  if (fav) {
    fav.href = isCorp ? '/icons/ftth-mapa/edificio.svg' : '/icons/ui/operacion.svg';
  }
  if (lblDist) {
    lblDist.textContent = isCorp ? 'A nodo de red más cercano (aire)' : 'A central ETB más cercana (aire)';
  }
  if (lblName) {
    lblName.textContent = isCorp ? 'Nombre del nodo' : 'Nombre central';
  }
  document.title = isCorp ? 'Operación · corporativa · GIS' : 'Operación · FTTH · GIS';
  document.body.classList.toggle('editor-network-corporativa', isCorp);
  document.body.classList.toggle('editor-network-ftth', !isCorp);
}

/**
 * Subtítulo en la barra superior: totales del catálogo tras recargar rutas/centrales.
 * @param {number} nRoutes
 * @param {number} nCentrales
 * @param {'ftth'|'corporativa'} network
 */
/**
 * @param {number} nRoutes
 * @param {number} nCentrales
 * @param {'ftth'|'corporativa'} network
 * @param {number | null} [eventosLista] total incidencias API (null = no mostrar tramo)
 * @param {number | null} [eventosMapa] puntos con coordenadas (null = omitir)
 */
function updateEditorChromeMeta(nRoutes, nCentrales, network, eventosLista, eventosMapa) {
  const el = document.getElementById('editor-chrome-meta');
  if (!el) return;
  const nr = Math.max(0, Number(nRoutes) || 0);
  const nc = Math.max(0, Number(nCentrales) || 0);
  let line;
  if (network === 'corporativa') {
    line = nr ? `${nr} cable(s) en catálogo` : '0 cables en catálogo';
  } else {
    line =
      nc > 0 ? `${nr} tendido(s) · ${nc} central(es)` : `${nr} tendido(s) (sin centrales en mapa)`;
  }
  if (typeof eventosLista === 'number' && eventosLista >= 0) {
    line += ` · ${eventosLista} incidencia(s)`;
    if (typeof eventosMapa === 'number' && eventosMapa >= 0) {
      line += ` (${eventosMapa} en mapa)`;
    }
  }
  el.textContent = line;
}

function fmtM(n) {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)} m`;
}

/** Formato del dock de polilínea (km con 2 decimales si ≥ 1 km, como la referencia UI). */
function formatPolylineDockMeters(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

/** @param {number[][]} coords */
function bboxFromLineCoords(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of coords) {
    const x = Number(c[0]);
    const y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  const padX = Math.max((maxX - minX) * 0.08, 0.0008);
  const padY = Math.max((maxY - minY) * 0.08, 0.0008);
  return [
    [minX - padX, minY - padY],
    [maxX + padX, maxY + padY]
  ];
}

/** @param {GeoJSON.FeatureCollection} fc */
function bboxFromCentralPoints(fc) {
  const pts = [];
  for (const f of fc.features || []) {
    if (f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      pts.push(f.geometry.coordinates);
    }
  }
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pts) {
    const x = Number(c[0]);
    const y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  const dx = Math.max((maxX - minX) * 0.15, 0.006);
  const dy = Math.max((maxY - minY) * 0.15, 0.006);
  return [
    [minX - dx, minY - dy],
    [maxX + dx, maxY + dy]
  ];
}

/** Vista inicial en red FTTH: central CUNI (catálogo ETB / GeoJSON local). */
const MAP_FTTH_CUNI_VIEW = {
  center: /** @type {[number, number]} */ ([-74.087926, 4.62991]),
  zoom: 14.25,
  centralAliases: ['cuni']
};

/**
 * @param {GeoJSON.FeatureCollection} fc
 * @param {string[]} needles
 * @returns {{ lng: number, lat: number } | null}
 */
function findCentralLngLatByAliases(fc, needles) {
  const set = new Set(
    needles
      .map((n) => String(n).trim().toLowerCase())
      .filter((n) => n.length > 0)
  );
  if (!set.size) return null;
  for (const f of fc?.features || []) {
    if (!f || f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) continue;
    const nom = String(f.properties?.nombre ?? f.properties?.name ?? '')
      .trim()
      .toLowerCase();
    if (!nom || !set.has(nom)) continue;
    const c = f.geometry.coordinates;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
  }
  return null;
}

export async function boot() {
  const { MAPBOX_ACCESS_TOKEN, API_BASE } = await loadConfig();
  await ensureAuthenticated(API_BASE ?? '');
  if (!MAPBOX_ACCESS_TOKEN || MAPBOX_ACCESS_TOKEN.includes('YOUR_')) {
    $('status').textContent =
      'Configura MAPBOX_ACCESS_TOKEN (local: public/js/config.local.js; Vercel: variable de entorno + build).';
    return;
  }

  const turf = globalThis.turf;
  if (!turf) {
    $('status').textContent = 'Turf.js no está cargado.';
    return;
  }

  const mapboxgl = globalThis.mapboxgl;
  if (!mapboxgl) {
    $('status').textContent = 'Mapbox GL JS no está cargado.';
    return;
  }

  const urlRed = readNetworkFromUrl();
  let appNetwork = urlRed;
  if (urlRed) {
    try {
      sessionStorage.setItem(STORAGE_KEY, urlRed);
    } catch {
      /* */
    }
  }
  if (!appNetwork) {
    appNetwork = readSessionNetwork();
  }
  const gateEl = document.getElementById('network-gate');
  if (appNetwork && gateEl) {
    gateEl.classList.add('network-gate--dismissed');
  }
  if (!appNetwork) {
    appNetwork = await waitForNetworkChoice();
  } else if (!urlRed) {
    syncBrowserUrlRed(appNetwork);
  }
  applyNetworkUi(appNetwork);

  /**
   * Android/Chrome: `100dvh` en CSS puede no coincidir con el área realmente visible
   * (barra URL, WebView). Fijamos `--editor-vv-height` al alto del visualViewport para
   * que body → #layout → #map-wrap encajen antes del primer layout de Mapbox.
   */
  function syncEditorVisualViewportHeight() {
    const root = document.documentElement;
    const isEditor = document.body?.classList.contains('editor-body');
    let mqMobile = false;
    try {
      mqMobile = window.matchMedia('(max-width: 900px)').matches;
    } catch {
      mqMobile = window.innerWidth <= 900;
    }
    if (!isEditor || !mqMobile) {
      root.style.removeProperty('--editor-vv-height');
      return;
    }
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.height) && vv.height > 80) {
      root.style.setProperty('--editor-vv-height', `${Math.round(vv.height)}px`);
    } else {
      root.style.removeProperty('--editor-vv-height');
    }
  }

  syncEditorVisualViewportHeight();

  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
  const api = createRutasApi(API_BASE, appNetwork);

  /** FTTH: arranque cerca de la central CUNI; corporativa: Bogotá amplio. */
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: appNetwork === 'ftth' ? MAP_FTTH_CUNI_VIEW.center : [-74.0817, 4.6097],
    zoom: appNetwork === 'ftth' ? MAP_FTTH_CUNI_VIEW.zoom : 11.5
  });

  let mapResizeTimer = 0;
  let mapResizeRafPending = false;
  let mapResizeDueAt = 0;
  let viewportSyncTimer = 0;
  let viewportRafPending = false;
  let lastViewportWidth = 0;
  let lastViewportHeight = 0;
  function scheduleMapResize(delay = 90) {
    const safeDelay = Math.max(0, Number(delay) || 0);
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const dueAt = now + safeDelay;
    const runResize = () => {
      mapResizeTimer = 0;
      if (mapResizeRafPending) return;
      mapResizeRafPending = true;
      window.requestAnimationFrame(() => {
        mapResizeRafPending = false;
        syncEditorVisualViewportHeight();
        try {
          map.resize();
        } catch {
          /* */
        }
      });
    };
    if (!mapResizeTimer) {
      mapResizeDueAt = dueAt;
      mapResizeTimer = window.setTimeout(runResize, safeDelay);
      return;
    }
    if (dueAt + 1 < mapResizeDueAt) {
      mapResizeDueAt = dueAt;
      window.clearTimeout(mapResizeTimer);
      mapResizeTimer = window.setTimeout(runResize, safeDelay);
    }
  }

  /** Unifica eventos de viewport para evitar tormenta de resize/reflow en Android. */
  function queueViewportSync(delay = 80) {
    window.clearTimeout(viewportSyncTimer);
    viewportSyncTimer = window.setTimeout(() => {
      if (viewportRafPending) return;
      viewportRafPending = true;
      window.requestAnimationFrame(() => {
        viewportRafPending = false;
        const vv = window.visualViewport;
        const width = Math.round(vv?.width ?? window.innerWidth);
        const height = Math.round(vv?.height ?? window.innerHeight);
        if (width === lastViewportWidth && height === lastViewportHeight) return;
        lastViewportWidth = width;
        lastViewportHeight = height;
        scheduleMapResize(0);
      });
    }, delay);
  }

  scheduleMapResize(0);

  /** Móvil: el lienzo debe coincidir con el tamaño real de #map-wrap (padding, barra URL, teclado). */
  const mapWrapEl = document.getElementById('map-wrap');
  if (mapWrapEl && typeof ResizeObserver !== 'undefined') {
    const mapWrapRo = new ResizeObserver(() => {
      scheduleMapResize(0);
    });
    mapWrapRo.observe(mapWrapEl);
  }

  /** Android/Chrome: una sola suscripción para barra URL/teclado/orientación. */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => queueViewportSync(80));
    window.visualViewport.addEventListener('scroll', () => queueViewportSync(80));
  }
  window.addEventListener('resize', () => queueViewportSync(90));
  window.addEventListener('orientationchange', () => queueViewportSync(240));
  queueViewportSync(0);

  const routesLayer = new RoutesLayer(map);
  const moleculeOverlayLayer = new MoleculeOverlayLayer(map);
  const centralesLayer = new CentralesEtBLayer(map);
  const otdrCutLayer = new OtdrCutLayer(map);
  const medidaEventoMarkerLayer = new MedidaEventoMarkerLayer(map);
  const eventosReporteLayer = new EventosReporteLayer(map);
  /* Blindaje contra "flash" de pines al arrancar: dejamos memorizada la
     intención de "no visibles" antes de que cualquier carga async pueda
     materializar la capa. La regla real (mostrar solo si hay molécula
     activa) se aplica más adelante en `refreshEventosReporteDisplay`. */
  eventosReporteLayer.setVisible(false);

  /** Conteos de eventos tras último GET exitoso (para la barra superior). */
  let lastChromeEventCounts = /** @type {{ list: number | null, map: number | null }} */ ({
    list: null,
    map: null
  });
  /** @type {AbortController | null} */
  let eventosDisplayAbortCtrl = null;
  /** @type {AbortController | null} */
  let refreshCatalogAbortCtrl = null;

  /**
   * FTTH: molécula asociada al contexto actual (tendido o vista «Ver molécula …» / cierre).
   * Filtra GET `/api/eventos-reporte` para mapa + lista.
   */
  let editorMoleculeFilter = /** @type {{ central: string, molecula: string } | null} */ (null);

  /** Popup Mapbox al hacer clic en un pin de evento (se cierra al recargar datos o limpiar cable). */
  let eventoMapPopup = /** @type {import('mapbox-gl').Popup | null} */ (null);

  function closeEventoMapPopup() {
    try {
      eventoMapPopup?.remove();
    } catch {
      /* */
    }
    eventoMapPopup = null;
  }

  /** Popup al clic en cierre / NAP del overlay FTTH. */
  let cierreMapPopup = /** @type {import('mapbox-gl').Popup | null} */ (null);

  function closeCierreMapPopup() {
    try {
      cierreMapPopup?.remove();
    } catch {
      /* */
    }
    cierreMapPopup = null;
  }

  /** Popup: abrir punto en Waze / Google Maps (clic en mapa sin features GIS). */
  let mapExternalNavPopup = /** @type {import('mapbox-gl').Popup | null} */ (null);

  function closeMapExternalNavPopup() {
    try {
      mapExternalNavPopup?.remove();
    } catch {
      /* */
    }
    mapExternalNavPopup = null;
  }

  /** Se asignan al montar el mapa (callbacks de popups con acceso a `api`). */
  let attachEventoPopupAdmin = /** @type {((popup: import('mapbox-gl').Popup, p: Record<string, unknown>) => void) | null} */ (
    null
  );
  let attachCierrePopupAdmin =
    /** @type {((popup: import('mapbox-gl').Popup, p: Record<string, unknown>, coords: string) => void) | null} */ (
      null
    );

  /**
   * @param {import('mapbox-gl').PointLike} point
   * @returns {GeoJSON.Feature | null}
   */
  function queryMoleculeOverlayFeatureAtPoint(point) {
    const layers = MOLECULE_OVERLAY_INTERACTIVE_LAYER_IDS.filter((id) => map.getLayer(id));
    if (!layers.length) return null;
    const hits = map.queryRenderedFeatures(point, { layers });
    return hits[0] || null;
  }

  /**
   * @param {GeoJSON.Feature} feature
   * @param {mapboxgl.LngLat} lngLatDefault
   */
  function openCierreMapPopupFromFeature(feature, lngLatDefault) {
    const polyBusy = measurePolylineActive && !measurePolylineConfirmed;
    if (editing || polyBusy) return;
    const raw = feature?.properties;
    if (!raw || typeof raw !== 'object') return;
    const p = /** @type {Record<string, unknown>} */ (raw);
    if (!String(p.ftth_overlay_kind ?? '').trim()) return;

    const loOrig = p.ftth_orig_lon != null ? Number(p.ftth_orig_lon) : NaN;
    const laOrig = p.ftth_orig_lat != null ? Number(p.ftth_orig_lat) : NaN;
    const g = feature.geometry;
    const gc =
      g && g.type === 'Point' && Array.isArray(g.coordinates)
        ? [Number(g.coordinates[0]), Number(g.coordinates[1])]
        : [NaN, NaN];

    const lo = Number.isFinite(loOrig) ? loOrig : gc[0];
    const la = Number.isFinite(laOrig) ? laOrig : gc[1];
    const coordsWgs84 =
      Number.isFinite(lo) && Number.isFinite(la) ? `${lo.toFixed(6)}, ${la.toFixed(6)}` : '—';

    const anchorLng = Number.isFinite(loOrig) ? loOrig : lngLatDefault.lng;
    const anchorLat = Number.isFinite(laOrig) ? laOrig : lngLatDefault.lat;

    closeEventoMapPopup();
    closeCierreMapPopup();

    const nom = String(p.nombre ?? p.name ?? 'Cierre').trim();
    const kindShort = String(p.ftth_overlay_kind ?? '');
    setStatus(`Cierre / punto: ${nom || kindShort} · ${coordsWgs84}`);

    try {
      const popup = new mapboxgl.Popup({
        className: 'evento-popup-wrap',
        offset: 12,
        maxWidth: window.matchMedia('(max-width: 900px)').matches ? 'min(calc(100vw - 20px), 288px)' : 'min(92vw, 360px)',
        closeButton: true,
        closeOnClick: true
      })
        .setLngLat([anchorLng, anchorLat])
        .setHTML(htmlCierreMapPopup(p, coordsWgs84))
        .addTo(map);
      cierreMapPopup = popup;
      popup.on('close', () => {
        if (cierreMapPopup === popup) cierreMapPopup = null;
      });
      attachCierrePopupAdmin?.(popup, p, coordsWgs84);
    } catch (err) {
      console.warn('Popup cierre:', err);
    }
  }

  function getMoleculeFilterForEventosApi() {
    if (appNetwork !== 'ftth' || !editorMoleculeFilter) return null;
    return {
      central: editorMoleculeFilter.central,
      molecula: editorMoleculeFilter.molecula
    };
  }

  /**
   * Puntos del overlay de molécula (cierres E1/E2, etc.): coordenadas originales del GeoJSON/API.
   * (Sin proyección al tendido/troncal; `linesFc` se ignora.)
   * @param {GeoJSON.Feature[]} pts
   * @param {GeoJSON.FeatureCollection} _linesFc
   * @returns {GeoJSON.Feature[]}
   */
  function snapMoleculeOverlayE1Features(pts, _linesFc) {
    return pts;
  }

  /**
   * @param {{ suppressMapPins?: boolean }} [opts] Si `suppressMapPins`, la lista se rellena pero la capa de pins queda oculta (arranque limpio).
   */
  async function refreshEventosReporteDisplay(opts) {
    eventosDisplayAbortCtrl?.abort();
    const abortCtrl = new AbortController();
    eventosDisplayAbortCtrl = abortCtrl;
    const t0 = perfNowMs();
    try {
      closeEventoMapPopup();
      closeCierreMapPopup();
      const res = await api.listEventosReporte(getMoleculeFilterForEventosApi(), {
        signal: abortCtrl.signal
      });
      if (abortCtrl.signal.aborted || eventosDisplayAbortCtrl !== abortCtrl) return;
      const fc = res?.featureCollection;
      const items = Array.isArray(res?.items) ? res.items : [];
      const fcBase =
        fc && fc.type === 'FeatureCollection'
          ? fc
          : { type: 'FeatureCollection', features: [] };
      const fcRoutesForSnap = filterRoutesByNetwork(allRoutesFc, appNetwork);
      const fcForMap =
        turf && fcBase.features?.length
          ? snapEventPointsToRouteCatalog(fcBase, fcRoutesForSnap, turf, 400)
          : fcBase;
      const nMapPoints = fcForMap.features?.length ?? 0;
      eventosReporteLayer.ensureLayer();
      eventosReporteLayer.setData(fcForMap);
      const evCb = document.getElementById('reporte-ev-layer-visible');
      const wantPinsCheckbox = evCb instanceof HTMLInputElement ? evCb.checked : true;
      /* Regla de negocio: los pines de eventos en el MAPA solo se pintan
         cuando hay una molécula activa (búsqueda de tendido en FTTH).
         Sin molécula activa => pines ocultos en mapa, pero la lista del
         panel «Reporte evento» sí se rellena con todos los registros.
         Esto evita el ruido visual al abrir el editor. */
      const hasActiveMoleculeFilter = !!getMoleculeFilterForEventosApi();
      const wantPins = hasActiveMoleculeFilter && wantPinsCheckbox;
      eventosReporteLayer.setVisible(opts?.suppressMapPins ? false : wantPins);
      const ul = document.getElementById('reporte-ev-ul');
      if (ul) {
        ul.replaceChildren();
        const molFilt = getMoleculeFilterForEventosApi();
        if (!items.length) {
          const li = document.createElement('li');
          li.className = 'reporte-ev-li reporte-ev-li--empty';
          if (molFilt) {
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.gap = '10px';
            const t = document.createElement('p');
            t.style.margin = '0';
            t.textContent = `Sin eventos que coincidan con la molécula «${molFilt.central} · ${molFilt.molecula}» (filtro activo al tener un tendido en mapa).`;
            wrap.appendChild(t);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'reporte-ev-btn reporte-ev-btn--ghost-sm';
            btn.textContent = 'Mostrar todas las incidencias de la red';
            btn.addEventListener('click', () => {
              editorMoleculeFilter = null;
              void refreshEventosReporteDisplay();
              setStatus(
                'Filtro por molécula desactivado: lista y mapa usan todos los eventos de esta red (FTTH).'
              );
            });
            wrap.appendChild(btn);
            const hint = document.createElement('p');
            hint.style.margin = '0';
            hint.style.opacity = '0.85';
            hint.style.fontSize = '12px';
            hint.textContent =
              'Alternativa: pulsa × en el buscador para quitar el cable del mapa y volver a solo centrales.';
            wrap.appendChild(hint);
            li.appendChild(wrap);
          } else {
            li.textContent =
              'No hay eventos en el API para esta red. ¿Migraste eventos y la red correcta (ftth/corporativa)? Tabla: sql/06_eventos_reporte.sql.';
          }
          ul.appendChild(li);
        } else {
          for (const it of items.slice(0, 40)) {
            const li = document.createElement('li');
            li.className = 'reporte-ev-li';
            const l1 = document.createElement('div');
            l1.className = 'reporte-ev-li-line1';
            l1.textContent = `${it.estado} · ${it.tipo_evento}`;
            const l2 = document.createElement('div');
            l2.className = 'reporte-ev-li-line2';
            const fecha = it.created_at
              ? new Date(it.created_at).toLocaleString('es-CO', {
                  dateStyle: 'short',
                  timeStyle: 'short'
                })
              : '—';
            l2.textContent =
              `${fecha}` + (it.has_map_point === false ? ' · sin coordenadas en mapa' : '');
            li.appendChild(l1);
            li.appendChild(l2);
            li.addEventListener('click', () => {
              const desc = String(it.descripcion ?? '').slice(0, 500);
              setStatus(
                `Evento #${it.id}: ${it.tipo_evento} · ${it.estado} · ${it.accion}. ${desc}${desc.length >= 500 ? '…' : ''}`
              );
            });
            ul.appendChild(li);
          }
        }
      }
      lastChromeEventCounts = { list: items.length, map: nMapPoints };
      try {
        bumpLayersAfterPolylineMeasure();
      } catch (e) {
        console.warn('Orden de capas (eventos):', e);
      }
      map.once('idle', () => {
        try {
          scheduleOperationalLayersBump([0, 80, 220]);
        } catch {
          /* */
        }
      });
      syncEditorChromeBarMeta();
    } catch (e) {
      if (e?.name === 'AbortError') return;
      let msg = e instanceof Error ? e.message : String(e);
      if (/^503:/.test(msg) || msg.includes('eventos_reporte')) {
        msg += ' · En el proyecto: npm run db:apply-eventos (o sql/06_eventos_reporte.sql).';
      }
      setStatus(`Eventos: ${msg}`);
    } finally {
      if (!abortCtrl.signal.aborted) {
        pushPerfMetric('eventos.refresh', perfNowMs() - t0, {
          red: appNetwork,
          suppressMapPins: !!opts?.suppressMapPins
        });
      }
      if (eventosDisplayAbortCtrl === abortCtrl) eventosDisplayAbortCtrl = null;
    }
  }

  const editor = new RouteDrawEditor(map, {
    onGeometryChange: (geom) => {
      updateMetrics(geom, turf);
      syncButtons();
    }
  });

  /** @type {GeoJSON.Feature<GeoJSON.LineString>|null} */
  let selectedFeature = null;
  let editing = false;
  /** Alta nueva vía POST (nombre ya pedido al usuario). */
  let isNewRoute = false;
  let newRouteNombre = '';
  /** Polilínea en mapa (clics sucesivos): distancia total + reserva 20 %. */
  let measurePolylineActive = false;
  /** Tras «Cerrar» no se añaden vértices hasta deshacer o borrar. */
  let measurePolylineConfirmed = false;
  /** @type {[number, number][]} */
  let measurePolylineCoords = [];

  /** Esperando clic en el cable para fijar referencia de trazado (fibra) en el tramo. */
  let otdrAwaitingCableClick = false;
  /** Metros desde el inicio del cable hasta el punto de referencia (modo clic). */
  let otdrClickRefFromStartM = /** @type {number | null} */ (null);
  /** Coordenadas WGS84 del punto de referencia por clic (pin de evento) para trazado. */
  let otdrClickRefLngLat = /** @type {[number, number] | null} */ (null);
  /** Pin en mapa: coordenada del reporte de evento (clic en tendido). */
  let reporteEventoPinLngLat = /** @type {[number, number] | null} */ (null);
  const btnEdit = $('btn-edit');
  const btnSave = $('btn-save');
  const btnCancel = $('btn-cancel');
  const btnReload = $('btn-reload');
  const btnNewRoute = $('btn-new-route');
  const statusEl = $('status');
  const lenEl = $('metric-length');
  const resEl = $('metric-reserve');
  const metricNearestCentralDist = $('metric-nearest-central-dist');
  const metricNearestCentralName = $('metric-nearest-central-name');

  const measureFab = $('measure-fab');
  const measurePolyLenDock = $('measure-poly-len-dock');
  const measurePolyResDock = $('measure-poly-res-dock');

  const measurePolyDock = $('measure-polyline-dock');
  const measurePolyUndo = /** @type {HTMLButtonElement} */ ($('measure-poly-undo'));
  const measurePolyConfirm = /** @type {HTMLButtonElement} */ ($('measure-poly-confirm'));
  const measurePolyTrash = /** @type {HTMLButtonElement} */ ($('measure-poly-trash'));

  const otdrRefFieldset = $('otdr-ref-fieldset');
  const otdrClickPanel = $('otdr-click-panel');
  const otdrClickStatus = $('otdr-click-status');
  const btnOtdrArmClick = $('btn-otdr-arm-click');
  const otdrFiberInput = /** @type {HTMLInputElement} */ ($('otdr-fiber-m'));
  const otdrFiberGeomHint = document.getElementById('otdr-fiber-geom-hint');
  const btnOtdrMark = $('btn-otdr-mark');
  const btnOtdrClear = $('btn-otdr-clear');

  document.getElementById('btn-change-network')?.addEventListener('click', () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* */
    }
    window.location.href = '/';
  });

  /** Última colección de centrales (API o /data) para distancia en aire desde el cable. */
  let lastCentralesFc = /** @type {GeoJSON.FeatureCollection} */ ({
    type: 'FeatureCollection',
    features: []
  });

  /** Todas las rutas desde API (memoria para buscador). En el mapa solo se pinta el cable elegido (FTTH y corporativa). */
  let allRoutesFc = /** @type {GeoJSON.FeatureCollection} */ ({
    type: 'FeatureCollection',
    features: []
  });

  /** Solo el primer `reloadRoutes`: encuadre CUNI en FTTH; luego se usa el encuadre global de centrales. */
  let firstReloadRoutes = true;

  /** Primera carga: mapa sin nodos catálogo, sin encuadre global y sin pins de incidencias hasta «Actualizar catálogo». */
  let cleanMapBootstrap = true;

  /**
   * Entradas del manifiesto Flashfiber (solo FTTH), para «Ver molécula …».
   * @type {{ central: string, molecula: string, label: string, paths: string[] }[]}
   */
  let ftthManifestEntries = [];

  function ftthGeojsonBaseUrl() {
    try {
      return new URL('/geojson/ftth/', window.location.href).href;
    } catch {
      return '/geojson/ftth/';
    }
  }

  async function loadFtthManifestIfNeeded() {
    ftthManifestEntries = [];
    if (appNetwork !== 'ftth') return;
    try {
      const url = new URL('moleculas-manifest.json', ftthGeojsonBaseUrl()).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const doc = await res.json();
      ftthManifestEntries = indexManifestEntries(doc);
    } catch {
      ftthManifestEntries = [];
    }
  }

  /** @type {ReturnType<typeof createCableSearchBar> | null} */
  let cableSearch = null;

  function setStatus(msg) {
    statusEl.textContent = msg;
    /* Heurística pequeña: si el texto sugiere actividad de guardado/error,
       reflejarlo en el indicador discreto de la status bar. */
    try {
      const lower = String(msg ?? '').toLowerCase();
      if (/error|fall(o|ó)|no se pudo/.test(lower)) {
        statusBar.setSave('error', 'Error');
      } else if (/guardad|salvad|crear?|cre(a|ó|ado)|actualiza/.test(lower)) {
        statusBar.setSave('ok', 'Guardado');
      } else if (/guardando|enviando|subiendo|cargando/.test(lower)) {
        statusBar.setSave('busy');
      }
    } catch {
      /* */
    }
  }

  /** GPS del navegador (Geolocation API). Control Mapbox oculto; el técnico usa el FAB `#btn-map-gps` (inferior derecha del lienzo). */
  const geolocate = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    trackUserLocation: true,
    showUserHeading: true,
    showAccuracyCircle: true
  });
  map.addControl(geolocate, 'bottom-right');
  /**
   * Blindaje de layout: si por cualquier motivo Mapbox o una reestructuración
   * posterior deja el control GPS en otro corner, se fuerza su grupo al
   * contenedor `.mapboxgl-ctrl-bottom-right`.
   */
  function ensureGeolocateBottomRight() {
    try {
      const mapContainer = map.getContainer();
      const geoBtn = mapContainer.querySelector('button.mapboxgl-ctrl-geolocate');
      const geoGroup = geoBtn?.closest('.mapboxgl-ctrl-group');
      const bottomRight = mapContainer.querySelector('.mapboxgl-ctrl-bottom-right');
      if (geoGroup && bottomRight && geoGroup.parentElement !== bottomRight) {
        bottomRight.appendChild(geoGroup);
      }
    } catch {
      /* */
    }
  }
  ensureGeolocateBottomRight();
  geolocate.on('error', () => {
    setStatus(
      'GPS: sin señal o permiso denegado. Revisa permisos del sitio y que la ubicación esté activa (móvil/PC).'
    );
  });
  geolocate.on('geolocate', () => {
    ensureGeolocateBottomRight();
    setStatus('GPS: posición actualizada en el mapa.');
  });

  const reporteCtl = initReporteEventoSidebar({
    api,
    setStatus,
    getMap: () => map,
    resolveRouteForMapClick: (e) => {
      try {
        if (!map.getLayer(ROUTES_LAYER_ID)) return null;
        const pt = e.point;
        const pad = 16;
        const box = [
          [pt.x - pad, pt.y - pad],
          [pt.x + pad, pt.y + pad]
        ];
        const hits = map.queryRenderedFeatures(box, { layers: [ROUTES_LAYER_ID] });
        const f = hits.find((x) => {
          const g = /** @type {any} */ (x?.geometry);
          return g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2;
        });
        return f ? /** @type {any} */ (f) : null;
      } catch {
        return null;
      }
    },
    canMountEvento: () => {
      if (appNetwork !== 'ftth') return false;
      return !!getMoleculeFilterForEventosApi();
    },
    /**
     * Resuelve la ruta más cercana a una coordenada (p. ej. GPS del técnico).
     * Escanea todas las features del source de rutas (estén o no en pantalla)
     * y devuelve la más cercana dentro del radio en metros indicado.
     */
    findNearestRouteForLngLat: (lng, lat, maxM) => {
      try {
        if (!map.getSource(ROUTES_SOURCE_ID)) return null;
        /** querySourceFeatures: devuelve todas las features cargadas del source GeoJSON. */
        const feats = map.querySourceFeatures(ROUTES_SOURCE_ID) || [];
        if (!feats.length) return null;
        const pt = turf.point([lng, lat]);
        /** @type {{ feature: any, snapped: [number, number], meters: number } | null} */
        let best = null;
        /** Evita evaluar duplicados: un LineString partido en tiles puede aparecer varias veces. */
        const seen = new Set();
        for (const f of feats) {
          const g = /** @type {any} */ (f?.geometry);
          if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) continue;
          const id = f.id ?? f.properties?.id ?? null;
          const dedupKey = id != null ? `id:${id}` : `coords:${g.coordinates.length}:${g.coordinates[0]?.join(',')}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          try {
            const snap = turf.nearestPointOnLine(turf.lineString(g.coordinates), pt, { units: 'meters' });
            const d = Number(snap?.properties?.dist);
            if (!Number.isFinite(d)) continue;
            if (!best || d < best.meters) {
              const sc = /** @type {[number, number]} */ (snap.geometry.coordinates);
              best = { feature: /** @type {any} */ (f), snapped: sc, meters: d };
            }
          } catch {
            /* tolera geometrías raras y sigue con la siguiente. */
          }
        }
        if (!best) return null;
        if (Number.isFinite(maxM) && maxM > 0 && best.meters > maxM) return null;
        return best;
      } catch {
        return null;
      }
    },
    getSelectedFeature: () => selectedFeature,
    turf,
    applyReportePickedRoute: (f, e) => {
      const prevId = selectedFeature?.id;
      selectedFeature = /** @type {any} */ (f);
      if (prevId != null && prevId !== f.id) {
        clearOtdrMarkAndRef();
      }
      routesLayer.setSelected(f.id);
      const geom = /** @type {any} */ (f.geometry);
      if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
        updateCentralMetricForCableClick(geom, e.lngLat);
      } else {
        clearCentralMetric();
      }
      updateMetrics(geom, turf);
      syncButtons();
    },
    setReportePin: (ll) => {
      reporteEventoPinLngLat = ll;
      syncMedidaEventoPin();
    },
    disarmOtdrPick: () => {
      otdrAwaitingCableClick = false;
      try {
        btnOtdrArmClick.classList.remove('active');
      } catch {
        /* */
      }
      setEditorFloatPickMode('trazar', false);
    },
    onArmingChanged: (armed) => {
      try {
        map.getCanvas().style.cursor = armed ? 'crosshair' : '';
      } catch {
        /* */
      }
      /* Mantener panel visible: no colapsar a píldora al armar reporte. */
      setEditorFloatPickMode('reporte', false);
    },
    onEventoGuardado: () => {
      void refreshEventosReporteDisplay();
      try {
        statusBar.setSave('ok', 'Evento guardado');
      } catch {
        /* */
      }
    },
    closeReportePanelUi: () => {
      document.getElementById('reporte-evento-details')?.classList.remove('editor-float-panel--open');
      document.getElementById('btn-open-panel-reporte')?.setAttribute('aria-expanded', 'false');
      syncEditorFloatBackdrop();
    }
  });

  /* Status bar inferior (estilo VSCode): coords del cursor, zoom, red activa, guardado. */
  const statusBar = initStatusBar(map);
  statusBar.setNet(appNetwork === 'corporativa' ? 'CORP' : 'FTTH');

  initFieldSidebar(map, geolocate, scheduleMapResize, toggleMeasurePolylineMode);

  initSidebarRail(map, {
    getSuppressMapSidebarCollapse: () => {
      if (editing) return true;
      if (measurePolylineActive && !measurePolylineConfirmed) return true;
      if (otdrAwaitingCableClick) return true;
      try {
        if (reporteCtl.isAwaitingRoutePick?.()) return true;
      } catch {
        /* */
      }
      return false;
    },
    scheduleMapResize
  });

  const editorFloatHooks = {
    onReporteOpen: () => {
      void refreshEventosReporteDisplay();
      reporteCtl.notifyReportePanelOpened();
    },
    onReporteClose: () => {
      reporteCtl.notifyReportePanelClosed();
    },
    onTrazarOpen: () => {
      if (!selectedFeature) {
        setStatus(
          'Trazar (OTDR): elige un tendido — clic en un cable del mapa o cárgalo con el buscador. Luego: origen, metros de fibra, Marcar corte.'
        );
      }
    }
  };

  document.getElementById('btn-open-panel-trazar')?.addEventListener('click', () => {
    toggleEditorFloatPanel('trazar', editorFloatHooks);
  });
  document.getElementById('btn-open-panel-reporte')?.addEventListener('click', () => {
    toggleEditorFloatPanel('reporte', editorFloatHooks);
  });
  document.getElementById('btn-open-panel-ruta')?.addEventListener('click', () => {
    try {
      btnNewRoute?.click();
      toggleEditorFloatPanel('trazar', editorFloatHooks);
    } catch {
      setStatus('No se pudo iniciar el montaje de ruta.');
    }
  });
  document.getElementById('btn-open-panel-cierre')?.addEventListener('click', () => {
    setStatus('Montar cierre: función en preparación.');
  });

  document.getElementById('editor-float-backdrop')?.addEventListener('click', () => {
    editorFloatHooks.onReporteClose();
    closeAllEditorFloatPanels();
  });

  document.querySelectorAll('[data-close-float]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.getAttribute('data-close-float');
      const panelId = which === 'reporte' ? 'reporte-evento-details' : 'editor-float-trazar';
      const panel = document.getElementById(panelId);
      /* Si el panel está en modo «pick chip», el botón actúa como Cancelar
         del armado y restaura el panel a su estado normal en lugar de cerrarlo. */
      if (panel?.classList.contains('editor-float-panel--pick-mode')) {
        if (which === 'reporte') {
          try {
            reporteCtl?.cancelMapPickMode?.();
          } catch {
            /* */
          }
        } else if (which === 'trazar') {
          if (otdrAwaitingCableClick) {
            otdrAwaitingCableClick = false;
            try {
              btnOtdrArmClick.classList.remove('active');
            } catch {
              /* */
            }
            setStatus('Referencia por clic cancelada.');
            try {
              syncButtons();
            } catch {
              /* */
            }
          }
        }
        setEditorFloatPickMode(/** @type {'trazar'|'reporte'} */ (which), false);
        return;
      }
      if (which === 'reporte') {
        editorFloatHooks.onReporteClose();
        document.getElementById('reporte-evento-details')?.classList.remove('editor-float-panel--open');
        document.getElementById('btn-open-panel-reporte')?.setAttribute('aria-expanded', 'false');
      } else if (which === 'trazar') {
        document.getElementById('editor-float-trazar')?.classList.remove('editor-float-panel--open');
        document.getElementById('btn-open-panel-trazar')?.setAttribute('aria-expanded', 'false');
      }
      syncEditorFloatBackdrop();
    });
  });

  function updateMetrics(geom, turfNs) {
    if (!geom?.coordinates?.length) {
      lenEl.textContent = '—';
      resEl.textContent = '—';
      return;
    }
    const L = lineLengthMeters(geom, turfNs);
    const fib = lengthWithReserve20Pct(L);
    lenEl.textContent = fmtM(L);
    resEl.textContent = fmtM(fib);
  }

  function getOtdrRef() {
    const el = document.querySelector('input[name="otdr-ref"]:checked');
    return /** @type {'start'|'end'|'click'} */ (el?.value ?? 'start');
  }

  function getOtdrDir() {
    const el = document.querySelector('input[name="otdr-dir"]:checked');
    return el?.value === 'toward_start' ? 'toward_start' : 'toward_end';
  }

  /**
   * Pin de **evento**: referencia de trazado por clic en tramo.
   */
  function syncMedidaEventoPin() {
    const polyDrawing = measurePolylineActive && !measurePolylineConfirmed;
    if (polyDrawing || editing) {
      medidaEventoMarkerLayer.clear();
      return;
    }
    if (reporteEventoPinLngLat) {
      medidaEventoMarkerLayer.ensureLayer();
      medidaEventoMarkerLayer.setPoint(reporteEventoPinLngLat);
      medidaEventoMarkerLayer.bringToFront();
      try {
        otdrCutLayer.bringToFront();
      } catch {
        /* */
      }
      return;
    }
    if (!selectedFeature) {
      medidaEventoMarkerLayer.clear();
      return;
    }
    const g = /** @type {any} */ (selectedFeature.geometry);
    if (g?.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) {
      medidaEventoMarkerLayer.clear();
      return;
    }
    if (getOtdrRef() === 'click' && otdrClickRefLngLat) {
      medidaEventoMarkerLayer.ensureLayer();
      medidaEventoMarkerLayer.setPoint(otdrClickRefLngLat);
      medidaEventoMarkerLayer.bringToFront();
      try {
        otdrCutLayer.bringToFront();
      } catch {
        /* */
      }
      return;
    }
    medidaEventoMarkerLayer.clear();
  }

  function updateOtdrClickPanelVisibility() {
    otdrClickPanel.hidden = getOtdrRef() !== 'click';
  }

  /** Texto bajo "Fibra OTDR": explica reserva 20% (tendido = fibra ÷ 1,2), coherente con `measurements.js`. */
  function syncOtdrFiberGeomHint() {
    if (!otdrFiberGeomHint) return;
    const v = Number(otdrFiberInput.value);
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

  /** Tendido seleccionado: longitud en mapa y fibra equivalente (+20%), visible en el panel Trazar. */
  function syncOtdrCableReadout() {
    const box = document.getElementById('otdr-cable-readout');
    const geomEl = document.getElementById('otdr-ro-geom');
    const fibEl = document.getElementById('otdr-ro-fib');
    if (!box || !geomEl || !fibEl) return;
    const ok = !!selectedFeature && !editing && selectedFeature.geometry?.type === 'LineString';
    if (!ok) {
      box.hidden = true;
      return;
    }
    const geom = /** @type {GeoJSON.LineString} */ (selectedFeature.geometry);
    const L = lineLengthMeters(geom, turf);
    const fib = lengthWithReserve20Pct(L);
    geomEl.textContent = fmtM(L);
    fibEl.textContent = fmtM(fib);
    box.hidden = false;
  }

  function syncOtdrUi() {
    const ok =
      !!selectedFeature && !editing && selectedFeature.geometry?.type === 'LineString';
    otdrFiberInput.disabled = !ok;
    btnOtdrMark.disabled = !ok;
    btnOtdrClear.disabled = !ok;
    btnOtdrArmClick.disabled = !ok || getOtdrRef() !== 'click';
    otdrRefFieldset.querySelectorAll('input').forEach((/** @type {HTMLInputElement} */ el) => {
      el.disabled = !ok;
    });
    otdrClickPanel.querySelectorAll('input').forEach((/** @type {HTMLInputElement} */ el) => {
      el.disabled = !ok;
    });
    if (!ok) {
      otdrAwaitingCableClick = false;
      btnOtdrArmClick.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
    }
    updateOtdrClickPanelVisibility();
    syncOtdrFiberGeomHint();
    syncOtdrCableReadout();
  }

  function clearOtdrMapOverlay() {
    otdrCutLayer.clear();
  }

  function clearOtdrMarkAndRef() {
    clearOtdrMapOverlay();
    otdrClickRefFromStartM = null;
    otdrClickRefLngLat = null;
    otdrAwaitingCableClick = false;
    btnOtdrArmClick.classList.remove('active');
    setEditorFloatPickMode('trazar', false);
    otdrClickStatus.textContent = 'Referencia: —';
    syncMedidaEventoPin();
  }

  function markOtdrCut() {
    if (!selectedFeature || editing) return;
    const geom = /** @type {GeoJSON.LineString} */ (selectedFeature.geometry);
    if (geom.type !== 'LineString' || !geom.coordinates?.length) return;

    const fiber = Number(otdrFiberInput.value);
    if (!Number.isFinite(fiber) || fiber < 0) {
      setStatus('Indica metros de fibra (trazado) ≥ 0.');
      return;
    }

    const ref = getOtdrRef();
    let res;
    if (ref === 'click') {
      if (otdrClickRefFromStartM == null) {
        setStatus(
          'Pulsa Fijar referencia y haz clic en el mismo tendido seleccionado.'
        );
        return;
      }
      res = cutPointFromFiberFromClickRef(
        geom,
        otdrClickRefFromStartM,
        fiber,
        getOtdrDir(),
        turf
      );
    } else {
      res = cutPointFromOtdrFiberMeters(geom, fiber, ref === 'end' ? 'end' : 'start', turf);
    }

    if (!res.point?.geometry?.coordinates) {
      setStatus('No se pudo calcular el punto de corte.');
      return;
    }

    const [lng, lat] = res.point.geometry.coordinates;

    otdrCutLayer.ensureLayer();
    otdrCutLayer.setCutPoint([lng, lat], `Corte ${fmtM(fiber)} m fibra`);
    centralesLayer.bringToFront();
    moleculeOverlayLayer.bringToFront();
    eventosReporteLayer.bringToFront();
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

    let statusMsg = `Corte por trazado (${fmtM(fiber)} m fibra) en «${selectedFeature.properties?.nombre ?? selectedFeature.id}». ${lng.toFixed(5)}, ${lat.toFixed(5)}`;
    if (res.clamped) {
      statusMsg += ' · Lectura acotada al extremo del tendido en el mapa.';
    }
    setStatus(statusMsg);
  }

  function syncButtons() {
    const polyDrawing = measurePolylineActive && !measurePolylineConfirmed;
    btnNewRoute.disabled = editing || polyDrawing;
    btnEdit.disabled = !selectedFeature || editing;
    btnSave.disabled = !editing;
    btnCancel.disabled = !editing;
    measureFab.disabled = editing;
    measureFab.classList.toggle('measure-fab--muted', editing);
    cableSearch?.setDisabled(editing || polyDrawing);
    syncOtdrUi();
    syncMeasureFloatUi();
    syncMeasurePolyDockVisibility();
    syncMedidaEventoPin();
  }

  /** Longitud geodésica del trazo libre y +20 % fibra (dock inferior). */
  function syncPolylineMeasureReadout() {
    const dash = '—';
    let lenTxt = dash;
    let resTxt = dash;
    if (measurePolylineActive) {
      if (measurePolylineCoords.length >= 2) {
        const line = /** @type {GeoJSON.LineString} */ ({
          type: 'LineString',
          coordinates: measurePolylineCoords
        });
        const L = lineLengthMetersSafe(line, turf);
        lenTxt = formatPolylineDockMeters(L);
        resTxt = formatPolylineDockMeters(lengthWithReserve20Pct(L));
      } else if (measurePolylineCoords.length === 1) {
        lenTxt = formatPolylineDockMeters(0);
        resTxt = formatPolylineDockMeters(lengthWithReserve20Pct(0));
      }
    }
    if (measurePolyLenDock) measurePolyLenDock.textContent = lenTxt;
    if (measurePolyResDock) measurePolyResDock.textContent = resTxt;
  }

  /** Sincroniza estado visual del FAB y lecturas del dock de medición. */
  function syncMeasureFloatUi() {
    syncPolylineMeasureReadout();
    measureFab.classList.toggle('measure-fab--active', measurePolylineActive);
    measureFab.setAttribute('aria-pressed', measurePolylineActive ? 'true' : 'false');
  }

  function bringMeasurePolylineLayersToFront() {
    try {
      for (const id of ['measure-polyline-line', 'measure-polyline-vertices', 'measure-polyline-labels']) {
        if (map.getLayer(id)) map.moveLayer(id);
      }
    } catch {
      /* */
    }
  }

  /** Tras subir la polilínea de medición, vuelve a poner pins de eventos (y OTDR/medida) por encima del trazo naranja. */
  function bumpLayersAfterPolylineMeasure() {
    bringMeasurePolylineLayersToFront();
    eventosReporteLayer.bringToFront();
    medidaEventoMarkerLayer.bringToFront();
    otdrCutLayer.bringToFront();
    /* Crítico: sin esto, tras medición/actualización, Draw vuelve a quedar bajo otras capas (trazo inactivo). */
    bringMapboxDrawLayersToTop();
  }

  /**
   * Capas de MapboxDraw encima de rutas/eventos/medición; si no, el trazo no recibe clics
   * (quedan por debajo de `routesLayer` y el modo «Trazar / nueva ruta» parece roto).
   */
  function bringMapboxDrawLayersToTop() {
    try {
      if (!editing) return;
      const layers = map.getStyle()?.layers;
      if (!layers?.length) return;
      const drawIds = layers
        .map((l) => l.id)
        .filter(
          (id) =>
            typeof id === 'string' &&
            (id.startsWith('mapbox-gl-draw') || id.startsWith('gl-draw'))
        );
      for (const id of drawIds) {
        try {
          map.moveLayer(id);
        } catch {
          /* */
        }
      }
    } catch (e) {
      console.warn('MapboxDraw (orden de capas):', e);
    }
  }

  /** Mantiene el orden visual estable de capas operativas tras cambios de datos/estilo. */
  function bringOperationalLayersToFront() {
    centralesLayer.bringToFront();
    moleculeOverlayLayer.bringToFront();
    bumpLayersAfterPolylineMeasure();
    bringMapboxDrawLayersToTop();
  }

  /** @type {number[]} */
  let overlayBumpTimers = [];
  let overlayBumpTicket = 0;
  /**
   * Evita duplicar ráfagas de reordenamiento: conserva solo la secuencia más reciente.
   * @param {number[]} [delaysMs]
   */
  function scheduleOperationalLayersBump(delaysMs = [0, 100, 300]) {
    overlayBumpTicket += 1;
    const ticket = overlayBumpTicket;
    for (const t of overlayBumpTimers) window.clearTimeout(t);
    overlayBumpTimers = [];
    const runIfCurrent = () => {
      if (ticket !== overlayBumpTicket) return;
      bringOperationalLayersToFront();
    };
    try {
      map.once('idle', runIfCurrent);
    } catch {
      /* */
    }
    for (const ms of delaysMs) {
      overlayBumpTimers.push(
        window.setTimeout(() => {
          runIfCurrent();
        }, Math.max(0, Number(ms) || 0))
      );
    }
  }

  function syncMeasurePolylinePanel() {
    if (!measurePolylineActive) {
      measurePolyUndo.disabled = true;
      measurePolyConfirm.disabled = true;
      measurePolyTrash.disabled = true;
      return;
    }
    measurePolyUndo.disabled =
      !measurePolylineActive || (measurePolylineCoords.length === 0 && !measurePolylineConfirmed);
    measurePolyConfirm.disabled =
      !measurePolylineActive ||
      measurePolylineCoords.length < 2 ||
      measurePolylineConfirmed;
    measurePolyTrash.disabled = !measurePolylineActive || measurePolylineCoords.length === 0;
  }

  /** Dock inferior (acciones del trazo): solo con medición por trazo en mapa activa. */
  function syncMeasurePolyDockVisibility() {
    measurePolyDock.hidden = !measurePolylineActive;
    syncMeasurePolylinePanel();
  }

  function setMeasurePolylineCursor() {
    try {
      map.getCanvas().style.cursor =
        measurePolylineActive && !measurePolylineConfirmed ? 'crosshair' : '';
    } catch {
      /* */
    }
  }

  function deactivateMeasurePolyline() {
    measurePolylineActive = false;
    measurePolylineConfirmed = false;
    measurePolylineCoords = [];
    try {
      clearMeasurePolylineData(map);
    } catch {
      /* */
    }
    setMeasurePolylineCursor();
    syncMeasurePolyDockVisibility();
    syncMeasureFloatUi();
  }

  function toggleMeasurePolylineMode() {
    if (editing) return;
    if (measurePolylineActive) {
      deactivateMeasurePolyline();
      setStatus('Medición por trazo en mapa desactivada.');
      syncButtons();
      return;
    }
    measurePolylineActive = true;
    measurePolylineConfirmed = false;
    reporteCtl?.cancelMapPickMode?.();
    measurePolylineCoords = [];
    ensureMeasurePolylineLayers(map);
    setMeasurePolylineData(map, measurePolylineCoords, turf);
    bumpLayersAfterPolylineMeasure();
    syncMeasurePolyDockVisibility();
    setMeasurePolylineCursor();
    syncMeasureFloatUi();
    syncButtons();
    setStatus('Trazar ruta: clics en el mapa para vértices. Panel inferior: distancia y +20 %.');
  }

  function clearCentralMetric() {
    metricNearestCentralDist.textContent = '—';
    metricNearestCentralName.textContent = '—';
  }

  /**
   * Punto del cable bajo el clic → distancia geodésica a la central ETB más cercana.
   * @param {GeoJSON.LineString} line
   * @param {mapboxgl.LngLat} lngLatEvent
   * @returns {{ meters: number, nombre: string } | null}
   */
  function updateCentralMetricForCableClick(line, lngLatEvent) {
    const lngLat = [lngLatEvent.lng, lngLatEvent.lat];
    try {
      const onCable = snapLngLatToLine(line, lngLat, turf);
      const nc = nearestCentralMeters(onCable, lastCentralesFc, turf);
      if (!nc) {
        metricNearestCentralDist.textContent = '—';
        metricNearestCentralName.textContent = lastCentralesFc?.features?.length
          ? '—'
          : appNetwork === 'corporativa'
            ? 'Sin nodos cargados'
            : 'Sin centrales cargadas';
        return null;
      }
      metricNearestCentralDist.textContent = fmtM(nc.meters);
      metricNearestCentralName.textContent = nc.nombre;
      return nc;
    } catch (e) {
      console.warn('Distancia a central ETB:', e);
      clearCentralMetric();
      return null;
    }
  }

  function clearMeasureClickModes() {
    deactivateMeasurePolyline();
    syncMedidaEventoPin();
  }

  /** Carga o reset del mapa: sin medición polilínea ni dock inferior. */
  function forceCloseMeasureOverlaysForMapReset() {
    measureFab.setAttribute('aria-pressed', 'false');
    clearMeasureClickModes();
  }

  /**
   * @param {AbortSignal} [signal]
   */
  async function loadCentralesFeatureCollection(signal) {
    let fcCent = { type: 'FeatureCollection', features: [] };
    try {
      fcCent = await api.listCentralesEtB(signal ? { signal } : undefined);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('Puntos de red (API centrales):', e.message);
    }
    if (!fcCent?.features?.length && appNetwork === 'ftth') {
      try {
        const res = await fetch('/data/centrales-etb.geojson', { cache: 'no-store' });
        if (res.ok) {
          fcCent = await res.json();
          if (fcCent?.features?.length) {
            console.info(
              `[centrales] ${fcCent.features.length} puntos desde /data (solo red FTTH; tabla vacía o sin datos).`
            );
          }
        }
      } catch (e) {
        console.warn('Centrales ETB (archivo local):', e.message);
      }
    }
    return fcCent;
  }

  /** Estilo de líneas: FTTH siempre mismo color/grosor; corporativa con resaltado. */
  function syncRoutesLineStyleMode() {
    routesLayer.setLineStyleMode(appNetwork === 'ftth' ? 'uniform' : 'normal');
  }

  /** Quita el cable del mapa (siguen las centrales); no recarga API. */
  function clearCableFromMapOnly() {
    editorMoleculeFilter = null;
    closeEventoMapPopup();
    closeCierreMapPopup();
    reporteCtl?.resetForCableCleared?.();
    clearOtdrMarkAndRef();
    routesLayer.ensureLayer();
    syncRoutesLineStyleMode();
    moleculeOverlayLayer.ensureLayer();
    moleculeOverlayLayer.clear();
    routesLayer.setData({ type: 'FeatureCollection', features: [] });
    routesLayer.setSelected(null);
    selectedFeature = null;
    clearMeasureClickModes();
    clearCentralMetric();
    updateMetrics(null, turf);
    setStatus(
      appNetwork === 'corporativa'
        ? 'Solo nodos de red en el mapa. Busca un cable por nombre o ID para dibujarlo.'
        : 'Solo centrales ETB en el mapa. Busca un tendido por nombre o ID para dibujarlo.'
    );
    syncButtons();
    void refreshEventosReporteDisplay();
  }

  /** @param {GeoJSON.Feature} feat */
  function fitMapToRouteFeature(feat) {
    const g = feat.geometry;
    if (!g || g.type !== 'LineString' || !g.coordinates?.length) return;
    const b = bboxFromLineCoords(g.coordinates);
    if (!b) return;
    try {
      map.fitBounds(b, {
        padding: { top: 120, bottom: 72, left: 72, right: 72 },
        maxZoom: 16,
        duration: 820
      });
    } catch {
      /* estilo o bounds inválidos */
    }
  }

  /**
   * Encuadre conjunto: tendidos (LineString) + puntos (cierres/NAPs).
   * @param {GeoJSON.FeatureCollection} lineFc
   * @param {GeoJSON.Feature[]} pointFeatures
   */
  function fitMapBoundsFromLinesAndPoints(lineFc, pointFeatures) {
    const coords = [];
    for (const f of lineFc?.features || []) {
      if (f?.geometry?.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
        coords.push(...f.geometry.coordinates);
      }
    }
    for (const f of pointFeatures || []) {
      if (f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        coords.push(f.geometry.coordinates);
      }
    }
    const b = bboxFromLineCoords(coords);
    if (!b) return;
    try {
      map.fitBounds(b, {
        padding: { top: 120, bottom: 72, left: 72, right: 72 },
        maxZoom: 16,
        duration: 820
      });
    } catch {
      /* */
    }
  }

  /**
   * Tendidos de BD + cierres/NAPs desde GeoJSON Flashfiber (`/geojson/ftth/`).
   * @param {{ central: string, molecula: string, label: string, paths: string[] }} hit
   */
  async function showMoleculeFullView(hit) {
    const { central, molecula, label, paths } = hit;
    editorMoleculeFilter = {
      central: String(central ?? '').trim(),
      molecula: String(molecula ?? '').trim()
    };
    clearOtdrMarkAndRef();
    moleculeOverlayLayer.ensureLayer();
    routesLayer.ensureLayer();

    const fcNet = filterRoutesByNetwork(allRoutesFc, 'ftth');
    const linesFc = filterRouteLinesByMolecule(fcNet, molecula, central);
    routesLayer.setData(linesFc);
    syncRoutesLineStyleMode();

    const pts = await loadMoleculeOverlayPointsCombined(
      api,
      ftthGeojsonBaseUrl(),
      central,
      molecula,
      paths || [],
      appNetwork
    );
    moleculeOverlayLayer.setData({
      type: 'FeatureCollection',
      features: snapMoleculeOverlayE1Features(pts, linesFc)
    });

    const firstLine = linesFc.features?.find(
      (f) => f && f.geometry?.type === 'LineString' && f.geometry.coordinates?.length >= 2
    );
    selectedFeature = firstLine ? /** @type {any} */ (firstLine) : null;
    routesLayer.setSelected(selectedFeature?.id ?? null);

    forceCloseMeasureOverlaysForMapReset();
    if (selectedFeature) {
      const geom = /** @type {any} */ (selectedFeature.geometry);
      if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
        const mid = Math.floor(geom.coordinates.length / 2);
        const c = geom.coordinates[mid];
        updateCentralMetricForCableClick(geom, { lng: c[0], lat: c[1] });
      } else {
        clearCentralMetric();
      }
      updateMetrics(geom, turf);
    } else {
      clearCentralMetric();
      updateMetrics(null, turf);
    }

    if (linesFc.features?.length || pts.length) {
      fitMapBoundsFromLinesAndPoints(linesFc, pts);
    }

    setStatus(
      `Molécula «${molecula}» (${label}): ${linesFc.features?.length ?? 0} tendido(s) en mapa · ${pts.length} punto(s) cierre/NAP (GeoJSON + BD). × limpia el mapa.`
    );
    scheduleOperationalLayersBump([0, 100, 300]);
    syncButtons();
    void refreshEventosReporteDisplay();
  }

  /**
   * Cierre elegido en el buscador (catálogo global): carga molécula y acerca al punto.
   * @param {GeoJSON.Feature} f
   */
  async function showCierreFromSearch(f) {
    clearOtdrMarkAndRef();
    moleculeOverlayLayer.ensureLayer();
    routesLayer.ensureLayer();

    const props = /** @type {Record<string, unknown>} */ (f.properties || {});
    const parsed = parseMoleculaCodigo(String(props.molecula_codigo ?? ''));
    if (!parsed) {
      setStatus('Este cierre no tiene molecula_codigo válido (CENTRAL|MOL).');
      return;
    }
    const { central, molecula } = parsed;
    editorMoleculeFilter = {
      central: String(central ?? '').trim(),
      molecula: String(molecula ?? '').trim()
    };
    const fcNet = filterRoutesByNetwork(allRoutesFc, 'ftth');
    const linesFc = filterRouteLinesByMolecule(fcNet, molecula, central || undefined);
    routesLayer.setData(linesFc);
    syncRoutesLineStyleMode();

    const manifestHit = findManifestEntryForMolecule(ftthManifestEntries, central, molecula);
    const pathsFromManifest = manifestHit?.paths ?? [];

    setStatus(`Cargando cierres/NAP para «${molecula}»…`);
    fitMapBoundsFromLinesAndPoints(linesFc, []);

    let pts = [];
    try {
      pts = await loadMoleculeOverlayPointsCombined(
        api,
        ftthGeojsonBaseUrl(),
        central,
        molecula,
        pathsFromManifest,
        appNetwork
      );
      moleculeOverlayLayer.setData({
        type: 'FeatureCollection',
        features: snapMoleculeOverlayE1Features(pts, linesFc)
      });
    } catch (e) {
      console.error(e);
      setStatus(`No se pudieron cargar cierres: ${e?.message ?? e}`);
      return;
    }

    const firstLine = linesFc.features?.find(
      (feat) =>
        feat &&
        feat.geometry?.type === 'LineString' &&
        feat.geometry.coordinates?.length >= 2
    );
    selectedFeature = firstLine ? /** @type {any} */ (firstLine) : null;
    routesLayer.setSelected(selectedFeature?.id ?? null);

    forceCloseMeasureOverlaysForMapReset();
    if (selectedFeature) {
      const geom = /** @type {any} */ (selectedFeature.geometry);
      if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
        const mid = Math.floor(geom.coordinates.length / 2);
        const c = geom.coordinates[mid];
        updateCentralMetricForCableClick(geom, { lng: c[0], lat: c[1] });
      } else {
        clearCentralMetric();
      }
      updateMetrics(geom, turf);
    } else {
      clearCentralMetric();
      updateMetrics(null, turf);
    }

    if (linesFc.features?.length || pts.length) {
      fitMapBoundsFromLinesAndPoints(linesFc, pts);
    }

    const g = /** @type {any} */ (f.geometry);
    if (g?.type === 'Point' && g.coordinates?.length >= 2) {
      try {
        map.easeTo({
          center: g.coordinates,
          zoom: Math.max(map.getZoom(), 15),
          duration: 800,
          essential: true
        });
      } catch {
        /* */
      }
    }

    const nom = String(props.nombre ?? props.name ?? f.id ?? '');
    setStatus(
      `Cierre «${nom}» (${String(props.tipo ?? '—')}) · ${String(props.molecula_codigo ?? '')}. ${linesFc.features?.length ?? 0} tendido(s), ${pts.length} punto(s). × limpia.`
    );
    scheduleOperationalLayersBump([0, 100, 300]);
    syncButtons();
    void refreshEventosReporteDisplay();
  }

  /** Actualiza el texto de `#editor-chrome-meta` con los conteos ya cargados en memoria (red activa). */
  function syncEditorChromeBarMeta() {
    const nR = allRoutesFc.features?.length ?? 0;
    const nC = lastCentralesFc.features?.length ?? 0;
    const evL = lastChromeEventCounts.list;
    const evM = lastChromeEventCounts.map;
    updateEditorChromeMeta(
      nR,
      nC,
      appNetwork,
      typeof evL === 'number' ? evL : null,
      typeof evM === 'number' ? evM : null
    );
  }

  /**
   * Recarga desde el API totales de rutas, centrales y eventos, y el buscador, sin vaciar el tendido dibujado.
   */
  async function refreshEditorChromeFromApi() {
    const btn = document.getElementById('btn-refresh-editor-catalog');
    refreshCatalogAbortCtrl?.abort();
    const abortCtrl = new AbortController();
    refreshCatalogAbortCtrl = abortCtrl;
    const t0 = perfNowMs();
    try {
      if (btn instanceof HTMLButtonElement) btn.disabled = true;
      const fcRaw = await api.listRutas({ signal: abortCtrl.signal });
      if (abortCtrl.signal.aborted || refreshCatalogAbortCtrl !== abortCtrl) return;
      const fcParsed =
        fcRaw && fcRaw.type === 'FeatureCollection'
          ? fcRaw
          : { type: 'FeatureCollection', features: [] };
      const fcBase = normalizeRouteFeatureProperties(fcParsed);
      allRoutesFc = filterRoutesByNetwork(fcBase, appNetwork);
      const fcCent = await loadCentralesFeatureCollection(abortCtrl.signal);
      if (abortCtrl.signal.aborted || refreshCatalogAbortCtrl !== abortCtrl) return;
      lastCentralesFc = fcCent;
      centralesLayer.ensureLayer();
      centralesLayer.setData(fcCent);
      syncEditorChromeBarMeta();
      await refreshEventosReporteDisplay();
      cableSearch?.refresh();
      setStatus('Datos actualizados desde el servidor (catálogo, centrales, incidencias, buscador).');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Error al actualizar catálogo (${msg}). Se mantienen datos en memoria.`);
      syncEditorChromeBarMeta();
      cableSearch?.refresh();
      void refreshEventosReporteDisplay();
    } finally {
      if (!abortCtrl.signal.aborted) {
        pushPerfMetric('catalog.refresh', perfNowMs() - t0, { red: appNetwork });
      }
      if (refreshCatalogAbortCtrl === abortCtrl) refreshCatalogAbortCtrl = null;
      if (btn instanceof HTMLButtonElement) btn.disabled = false;
    }
  }

  async function reloadRoutes() {
    const wasCleanBootstrap = cleanMapBootstrap;
    const t0 = perfNowMs();
    try {
      editorMoleculeFilter = null;
      closeEventoMapPopup();
      closeCierreMapPopup();
      const fcRaw = await api.listRutas();
      const fcParsed =
        fcRaw && fcRaw.type === 'FeatureCollection'
          ? fcRaw
          : { type: 'FeatureCollection', features: [] };
      const fcBase = normalizeRouteFeatureProperties(fcParsed);
      /** Solo cables de la red activa (por si la API o datos mezclaran filas). */
      allRoutesFc = filterRoutesByNetwork(fcBase, appNetwork);

      routesLayer.ensureLayer();
      syncRoutesLineStyleMode();
      moleculeOverlayLayer.ensureLayer();
      moleculeOverlayLayer.clear();
      routesLayer.setData({ type: 'FeatureCollection', features: [] });
      routesLayer.setSelected(null);

      const fcCent = await loadCentralesFeatureCollection();
      lastCentralesFc = fcCent;
      centralesLayer.ensureLayer();
      centralesLayer.setData(
        wasCleanBootstrap ? { type: 'FeatureCollection', features: [] } : fcCent
      );

      if (appNetwork === 'ftth' && firstReloadRoutes) {
        firstReloadRoutes = false;
        const hit = findCentralLngLatByAliases(fcCent, MAP_FTTH_CUNI_VIEW.centralAliases);
        const lng = hit ? hit.lng : MAP_FTTH_CUNI_VIEW.center[0];
        const lat = hit ? hit.lat : MAP_FTTH_CUNI_VIEW.center[1];
        try {
          map.easeTo({
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), MAP_FTTH_CUNI_VIEW.zoom),
            duration: 720,
            essential: true
          });
        } catch {
          /* */
        }
      } else {
        firstReloadRoutes = false;
        const boxC = bboxFromCentralPoints(lastCentralesFc);
        if (boxC && !wasCleanBootstrap) {
          try {
            map.fitBounds(boxC, { padding: 52, maxZoom: 14, duration: 720 });
          } catch {
            /* */
          }
        }
      }

      cableSearch?.reset();
      cableSearch?.refresh();
      clearOtdrMarkAndRef();

      routesLayer.setSelected(null);
      selectedFeature = null;
      editing = false;
      isNewRoute = false;
      newRouteNombre = '';
      forceCloseMeasureOverlaysForMapReset();
      clearCentralMetric();
      routesLayer.setHiddenRouteId(null);
      editor.cancel();
      const nR = allRoutesFc.features?.length ?? 0;
      const nC = lastCentralesFc.features?.length ?? 0;
      const pointsLabel =
        appNetwork === 'corporativa' ? 'nodo(s) de red' : 'central(es) ETB';
      const redNom = appNetwork === 'corporativa' ? 'corporativa' : 'FTTH';
      let msg = nC
        ? `Mapa ${redNom}: ${nC} ${pointsLabel} · ${nR} tendido(s) en catálogo. Solo se dibuja en el mapa el que elijas en el buscador.`
        : appNetwork === 'ftth'
          ? `Mapa FTTH: ${nR} tendido(s) en catálogo (sin centrales en API o /data). Solo se dibuja el buscado.`
          : `Sin nodos en mapa · ${nR} cable(s) en catálogo corporativa. Busca por nombre o ID para dibujar uno.`;
      if (wasCleanBootstrap) {
        msg = `Vista limpia: sin nodos ni incidencias en el mapa. ${msg} «Actualizar catálogo» muestra nodos y encuadre global.`;
      }
      setStatus(msg);
      syncEditorChromeBarMeta();
      updateMetrics(null, turf);
      syncButtons();
    } finally {
      /** Aunque falle `/api/rutas`, se intentan cargar eventos (otro fallo no debe bloquear la lista). */
      void refreshEventosReporteDisplay({ suppressMapPins: wasCleanBootstrap });
      if (wasCleanBootstrap) {
        cleanMapBootstrap = false;
      }
      pushPerfMetric('routes.reload', perfNowMs() - t0, {
        red: appNetwork,
        cleanBootstrap: !!wasCleanBootstrap
      });
    }
  }

  map.on('load', async () => {
    /* Tras cambiar modo en Draw, volver a subir capas (otras rutinas reordenan el estilo). */
    map.on('draw.modechange', () => {
      bringMapboxDrawLayersToTop();
    });
    /* Tras reposo del mapa, re-asegurar Draw arriba (tiles/estilo pueden reordenar capas). Throttle leve. */
    let _idleDrawBumpAt = 0;
    map.on('idle', () => {
      if (!editing) return;
      const t = Date.now();
      if (t - _idleDrawBumpAt < 220) return;
      _idleDrawBumpAt = t;
      bringMapboxDrawLayersToTop();
    });
    scheduleMapResize(0);
    /* Segundo resize en timer aparte: no cancelar el primero (mismo mapResizeTimer). */
    window.setTimeout(() => scheduleMapResize(0), 280);
    map.once('idle', () => {
      scheduleMapResize(0);
    });
    forceCloseMeasureOverlaysForMapReset();

    /** Medición: rail superior solo fuera del editor; en editor se usa el menú lateral (FAB oculto vía CSS). */
    const mapTopRight = map.getContainer().querySelector('.mapboxgl-ctrl-top-right');
    const measureRow = document.getElementById('map-fab-row-measure');
    const measureDock = document.getElementById('measure-fab-dock');
    const editorChrome = document.body.classList.contains('editor-body');
    if (measureRow && mapTopRight && !editorChrome) {
      if (!measureRow.closest('.mapboxgl-ctrl-top-right')) {
        mapTopRight.appendChild(measureRow);
      }
      measureDock?.classList.add('measure-fab-dock--in-map');
      scheduleMapResize(0);
    }
    ensureGeolocateBottomRight();

    await loadFtthManifestIfNeeded();

    const mapWrap = $('map-wrap');
    cableSearch = createCableSearchBar(mapWrap, {
      /** Siempre re-filtra por red activa (nunca mezcla catálogos en el buscador). */
      getRouteCollection: () => filterRoutesByNetwork(allRoutesFc, appNetwork),
      networkRed: appNetwork,
      getMoleculeBrowseHits:
        appNetwork === 'ftth'
          ? (q) => matchMoleculeEntries(ftthManifestEntries, q, 40)
          : undefined,
      onSelectMoleculeBrowse: (hit) => {
        if (appNetwork !== 'ftth') return;
        showMoleculeFullView(hit).catch((e) => {
          setStatus(`No se pudo cargar la molécula: ${e.message}`);
          console.error(e);
        });
      },
      getCierreBrowseHits:
        appNetwork === 'ftth'
          ? async (q) => {
              const fc = await api.searchCierres(q);
              return Array.isArray(fc?.features) ? fc.features : [];
            }
          : undefined,
      onSelectCierre: (f) => {
        if (appNetwork !== 'ftth') return;
        showCierreFromSearch(f).catch((e) => {
          setStatus(`No se pudo abrir el cierre: ${e.message}`);
          console.error(e);
        });
      },
      onSelectRoute: (f, meta) => {
        if (redTipoOfFeature(f) !== appNetwork) {
          setStatus('Cable no pertenece a la red de esta sesión. Usa «Cambiar de red» o recarga.');
          return;
        }
        clearOtdrMarkAndRef();
        moleculeOverlayLayer.ensureLayer();
        moleculeOverlayLayer.clear();

        const sq = String(meta?.searchQuery ?? '').trim();
        const sqMol = moleculeTokenFromSearchInput(sq);
        const parsedMol =
          appNetwork === 'ftth' && sq ? parseMoleculeCentralFromRouteFeature(f) : null;
        const sameMoleculeAsQuery =
          parsedMol &&
          sqMol.toLowerCase() === String(parsedMol.molecula).trim().toLowerCase();

        if (sameMoleculeAsQuery && parsedMol) {
          editorMoleculeFilter = {
            central: String(parsedMol.central ?? '').trim(),
            molecula: String(parsedMol.molecula ?? '').trim()
          };
        }

        if (sameMoleculeAsQuery) {
          const fcNet = filterRoutesByNetwork(allRoutesFc, 'ftth');
          const linesFc = filterRouteLinesByMolecule(
            fcNet,
            parsedMol.molecula,
            parsedMol.central || undefined
          );
          if (linesFc.features?.length) {
            selectedFeature = /** @type {any} */ (f);
            routesLayer.ensureLayer();
            routesLayer.setData(linesFc);
            syncRoutesLineStyleMode();
            routesLayer.setSelected(f.id);
            clearMeasureClickModes();
            const geom = /** @type {any} */ (f.geometry);
            if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
              const mid = Math.floor(geom.coordinates.length / 2);
              const c = geom.coordinates[mid];
              updateCentralMetricForCableClick(geom, { lng: c[0], lat: c[1] });
            } else {
              clearCentralMetric();
            }
            updateMetrics(geom, turf);
            const cen = parsedMol.central || '';
            const mol = parsedMol.molecula;
            const manifestHit = findManifestEntryForMolecule(
              ftthManifestEntries,
              cen,
              mol
            );
            const pathsFromManifest = manifestHit?.paths ?? [];
            setStatus(`Cargando cierres/NAP para «${mol}»…`);
            fitMapBoundsFromLinesAndPoints(linesFc, []);
            void loadMoleculeOverlayPointsCombined(
              api,
              ftthGeojsonBaseUrl(),
              cen,
              mol,
              pathsFromManifest,
              appNetwork
            )
              .then((pts) => {
                moleculeOverlayLayer.setData({
                  type: 'FeatureCollection',
                  features: snapMoleculeOverlayE1Features(pts, linesFc)
                });
                fitMapBoundsFromLinesAndPoints(linesFc, pts);
                const nL = linesFc.features.length;
                setStatus(
                  `Búsqueda «${mol}»: ${nL} tendido(s) en mapa · ${pts.length} punto(s) cierre/NAP (GeoJSON + BD). Cable activo «${f.properties?.nombre ?? f.id}». × limpia.`
                );
              })
              .catch((e) => {
                console.error(e);
                setStatus(`No se pudieron cargar cierres: ${e?.message ?? e}`);
              });
            scheduleOperationalLayersBump([0, 100, 300]);
            syncButtons();
            void refreshEventosReporteDisplay();
            return;
          }
        }

        selectedFeature = /** @type {any} */ (f);
        routesLayer.ensureLayer();
        syncRoutesLineStyleMode();
        routesLayer.setData({ type: 'FeatureCollection', features: [f] });
        routesLayer.setSelected(f.id);
        clearMeasureClickModes();
        const geom = /** @type {any} */ (f.geometry);
        if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
          const mid = Math.floor(geom.coordinates.length / 2);
          const c = geom.coordinates[mid];
          const fakeLL = { lng: c[0], lat: c[1] };
          updateCentralMetricForCableClick(geom, fakeLL);
        } else {
          clearCentralMetric();
        }
        updateMetrics(geom, turf);
        if (appNetwork === 'ftth') {
          if (!sameMoleculeAsQuery) {
            const pm = parseMoleculeCentralFromRouteFeature(f);
            editorMoleculeFilter =
              pm && pm.molecula
                ? {
                    central: String(pm.central ?? '').trim(),
                    molecula: String(pm.molecula ?? '').trim()
                  }
                : null;
          }
        } else {
          editorMoleculeFilter = null;
        }
        void refreshEventosReporteDisplay();
        fitMapToRouteFeature(f);
        setStatus(`Cable «${f.properties?.nombre ?? f.id}» · usa el buscador (×) para volver a solo centrales.`);
        scheduleOperationalLayersBump([0, 100, 300]);
        syncButtons();
      },
      onSelectCoordinates: ({ lng, lat }) => {
        try {
          map.easeTo({
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), 15),
            duration: 750
          });
        } catch (e) {
          console.warn('onSelectCoordinates', e);
        }
        setStatus(`WGS84 · ${lat.toFixed(6)}, ${lng.toFixed(6)} · mapa centrado.`);
      },
      onClearCable: () => {
        clearCableFromMapOnly();
      },
      isInteractionLocked: () => editing || (measurePolylineActive && !measurePolylineConfirmed)
    });

    document.getElementById('btn-refresh-editor-catalog')?.addEventListener('click', () => {
      void refreshEditorChromeFromApi();
    });

    const reporteEvVis = document.getElementById('reporte-ev-layer-visible');
    if (reporteEvVis instanceof HTMLInputElement) {
      /* Coherente con la regla: pines de eventos solo visibles si hay
         molécula activa Y la checkbox está marcada. */
      const computeWantPins = () =>
        reporteEvVis.checked && !!getMoleculeFilterForEventosApi();
      eventosReporteLayer.setVisible(computeWantPins());
      reporteEvVis.addEventListener('change', () => {
        eventosReporteLayer.setVisible(computeWantPins());
      });
    }
    async function refreshFtthMoleculeOverlayIfFiltered() {
      if (appNetwork !== 'ftth' || !editorMoleculeFilter) return;
      const { central, molecula } = editorMoleculeFilter;
      const fcNet = filterRoutesByNetwork(allRoutesFc, 'ftth');
      const linesFc = filterRouteLinesByMolecule(fcNet, molecula, central || undefined);
      const manifestHit = findManifestEntryForMolecule(ftthManifestEntries, central, molecula);
      const pathsFromManifest = manifestHit?.paths ?? [];
      try {
        const pts = await loadMoleculeOverlayPointsCombined(
          api,
          ftthGeojsonBaseUrl(),
          central,
          molecula,
          pathsFromManifest,
          appNetwork
        );
        moleculeOverlayLayer.setData({
          type: 'FeatureCollection',
          features: snapMoleculeOverlayE1Features(pts, linesFc)
        });
        moleculeOverlayLayer.bringToFront();
      } catch (e) {
        console.warn('refreshFtthMoleculeOverlayIfFiltered', e);
      }
    }

    attachEventoPopupAdmin = (popup, p) => {
      window.setTimeout(() => {
        const root = popup.getElement();
        const wrap = /** @type {HTMLElement | null} */ (root?.querySelector('.evento-popup:not(.evento-popup--edit)'));
        if (!wrap) return;
        if (!isEventoReporteIdAdmin(p.id)) return;
        const evId = Number(p.id);

        wrap.querySelector('[data-admin="ev-del"]')?.addEventListener('click', async () => {
          if (!confirm(`¿Borrar el evento #${evId}? Esta acción no se puede deshacer.`)) return;
          try {
            await api.deleteEventoReporte(evId);
            closeEventoMapPopup();
            await refreshEventosReporteDisplay();
            setStatus(`Evento #${evId} eliminado.`);
          } catch (err) {
            setStatus(err?.message ? String(err.message) : String(err));
          }
        });

        wrap.querySelector('[data-admin="ev-edit"]')?.addEventListener(
          'click',
          () => {
            popup.setHTML(htmlEventoMapPopupEditForm(p));
            bindEventoPopupEdit(popup, p);
          },
          { once: true }
        );
      }, 0);
    };

    /**
     * @param {import('mapbox-gl').Popup} popup
     * @param {Record<string, unknown>} p
     */
    function bindEventoPopupEdit(popup, p) {
      window.setTimeout(() => {
        const root = popup.getElement();
        const wrap = /** @type {HTMLElement | null} */ (root?.querySelector('.evento-popup--edit'));
        if (!wrap) return;
        if (!isEventoReporteIdAdmin(p.id)) return;
        const evId = Number(p.id);

        wrap.querySelector('[data-admin="ev-cancel"]')?.addEventListener(
          'click',
          () => {
            popup.setHTML(htmlEventoMapPopup(p));
            attachEventoPopupAdmin?.(popup, p);
          },
          { once: true }
        );

        wrap.querySelector('[data-admin="ev-save"]')?.addEventListener('click', async () => {
          const tipo = /** @type {HTMLSelectElement | null} */ (wrap.querySelector('[data-f="tipo"]'));
          const estado = /** @type {HTMLSelectElement | null} */ (wrap.querySelector('[data-f="estado"]'));
          const accion = /** @type {HTMLSelectElement | null} */ (wrap.querySelector('[data-f="accion"]'));
          const distEl = /** @type {HTMLInputElement | null} */ (wrap.querySelector('[data-f="dist_odf"]'));
          const descEl = /** @type {HTMLTextAreaElement | null} */ (wrap.querySelector('[data-f="desc"]'));
          const body = {
            tipo_evento: tipo?.value,
            estado: estado?.value,
            accion: accion?.value,
            descripcion: descEl?.value?.trim() ?? '',
            dist_odf: distEl?.value ? Number(distEl.value) : null
          };
          try {
            await api.patchEventoReporte(evId, body);
            closeEventoMapPopup();
            await refreshEventosReporteDisplay();
            setStatus(`Evento #${evId} actualizado.`);
          } catch (err) {
            setStatus(err?.message ? String(err.message) : String(err));
          }
        });
      }, 0);
    }

    attachCierrePopupAdmin = (popup, p, coordsWgs84) => {
      window.setTimeout(() => {
        const root = popup.getElement();
        const wrap = /** @type {HTMLElement | null} */ (root?.querySelector('.evento-popup:not(.evento-popup--edit)'));
        if (!wrap) return;
        const cid = String(p.id ?? '').trim();
        if (String(p.source ?? '').trim() !== 'db_cierres' || !isCierreDbUuidLike(cid)) return;

        wrap.querySelector('[data-admin="ci-del"]')?.addEventListener('click', async () => {
          if (!confirm(`¿Borrar el cierre «${String(p.nombre ?? p.name ?? cid)}»?`)) return;
          try {
            await api.deleteCierre(cid);
            closeCierreMapPopup();
            await refreshFtthMoleculeOverlayIfFiltered();
            setStatus('Cierre eliminado.');
          } catch (err) {
            setStatus(err?.message ? String(err.message) : String(err));
          }
        });

        wrap.querySelector('[data-admin="ci-edit"]')?.addEventListener(
          'click',
          () => {
            popup.setHTML(htmlCierreMapPopupEditForm(p, coordsWgs84));
            bindCierrePopupEdit(popup, p, coordsWgs84);
          },
          { once: true }
        );
      }, 0);
    };

    /**
     * @param {import('mapbox-gl').Popup} popup
     * @param {Record<string, unknown>} p
     * @param {string} coordsWgs84
     */
    function bindCierrePopupEdit(popup, p, coordsWgs84) {
      window.setTimeout(() => {
        const root = popup.getElement();
        const wrap = /** @type {HTMLElement | null} */ (root?.querySelector('.evento-popup--edit'));
        if (!wrap) return;
        const cid = String(p.id ?? '').trim();

        wrap.querySelector('[data-admin="ci-cancel"]')?.addEventListener(
          'click',
          () => {
            popup.setHTML(htmlCierreMapPopup(p, coordsWgs84));
            attachCierrePopupAdmin?.(popup, p, coordsWgs84);
          },
          { once: true }
        );

        wrap.querySelector('[data-admin="ci-save"]')?.addEventListener('click', async () => {
          const val = (k) =>
            /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (wrap.querySelector(`[data-f="${k}"]`));
          const latEl = val('lat');
          const lngEl = val('lng');
          const lat = latEl?.value ? Number(latEl.value) : NaN;
          const lng = lngEl?.value ? Number(lngEl.value) : NaN;
          const distEl = val('dist_odf');
          /** @type {Record<string, unknown>} */
          const body = {
            nombre: val('nombre')?.value?.trim(),
            tipo: val('tipo')?.value?.trim(),
            estado: val('estado')?.value?.trim(),
            descripcion: val('desc')?.value?.trim(),
            molecula_codigo: val('molecula_codigo')?.value?.trim(),
            dist_odf: distEl?.value ? Number(distEl.value) : null
          };
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            body.lat = lat;
            body.lng = lng;
          }
          try {
            await api.patchCierre(cid, body);
            closeCierreMapPopup();
            await refreshFtthMoleculeOverlayIfFiltered();
            setStatus('Cierre actualizado.');
          } catch (err) {
            setStatus(err?.message ? String(err.message) : String(err));
          }
        });
      }, 0);
    }

    const onEventoPinClick = (e) => {
      const polyBusy = measurePolylineActive && !measurePolylineConfirmed;
      if (editing || polyBusy) return;
      const f = e.features?.[0];
      if (!f?.properties) return;
      const p = /** @type {Record<string, unknown>} */ (f.properties);
      const descShort = String(p.descripcion ?? '').slice(0, 420);
      setStatus(
        `Evento #${p.id}: ${p.tipo_evento} · ${p.estado} · ${p.accion}. ${descShort}${descShort.length >= 420 ? '…' : ''}`
      );
      closeCierreMapPopup();
      closeEventoMapPopup();
      try {
        const popup = new mapboxgl.Popup({
          className: 'evento-popup-wrap',
          offset: 12,
          maxWidth: window.matchMedia('(max-width: 900px)').matches ? 'min(calc(100vw - 20px), 288px)' : 'min(92vw, 340px)',
          closeButton: true,
          closeOnClick: true
        })
          .setLngLat(e.lngLat)
          .setHTML(htmlEventoMapPopup(p))
          .addTo(map);
        eventoMapPopup = popup;
        popup.on('close', () => {
          if (eventoMapPopup === popup) eventoMapPopup = null;
        });
        attachEventoPopupAdmin?.(popup, p);
      } catch (err) {
        console.warn('Popup evento:', err);
      }
    };
    const onEventoPinEnter = () => {
      try {
        map.getCanvas().style.cursor = 'pointer';
      } catch {
        /* */
      }
    };
    const onEventoPinLeave = () => {
      try {
        map.getCanvas().style.cursor = '';
      } catch {
        /* */
      }
    };
    for (const layerId of EVENTOS_REPORTE_INTERACTIVE_LAYER_IDS) {
      map.on('click', layerId, onEventoPinClick);
      map.on('mouseenter', layerId, onEventoPinEnter);
      map.on('mouseleave', layerId, onEventoPinLeave);
    }

    routesLayer.ensureLayer();
    moleculeOverlayLayer.ensureLayer();
    otdrCutLayer.ensureLayer();
    medidaEventoMarkerLayer.ensureLayer();
    routesLayer.setCursorPointerOnHover();

    const onOverlayCierreEnter = () => {
      try {
        map.getCanvas().style.cursor = 'pointer';
      } catch {
        /* */
      }
    };
    const onOverlayCierreLeave = () => {
      try {
        map.getCanvas().style.cursor = '';
      } catch {
        /* */
      }
    };
    const wireOverlayCierreHover = () => {
      for (const layerId of MOLECULE_OVERLAY_INTERACTIVE_LAYER_IDS) {
        if (!map.getLayer(layerId)) continue;
        try {
          map.off('mouseenter', layerId, onOverlayCierreEnter);
          map.off('mouseleave', layerId, onOverlayCierreLeave);
        } catch {
          /* */
        }
        map.on('mouseenter', layerId, onOverlayCierreEnter);
        map.on('mouseleave', layerId, onOverlayCierreLeave);
      }
    };
    wireOverlayCierreHover();
    map.once('idle', wireOverlayCierreHover);

    try {
      await reloadRoutes();
    } catch (e) {
      setStatus(`Error cargando rutas: ${e.message}`);
      console.error(e);
    }

    centralesLayer.setCursorPointerOnHover();
    centralesLayer.onCentralClick((e) => {
      const polyBusy = measurePolylineActive && !measurePolylineConfirmed;
      if (editing || polyBusy) return;
      const ovCentral = queryMoleculeOverlayFeatureAtPoint(e.point);
      if (
        ovCentral?.properties &&
        String(ovCentral.properties.ftth_overlay_kind ?? '').trim()
      ) {
        openCierreMapPopupFromFeature(ovCentral, e.lngLat);
        return;
      }
      const f = e.features?.[0];
      if (!f) return;
      const nom = f.properties?.nombre ?? f.properties?.name ?? f.id;
      setStatus(
        appNetwork === 'corporativa' ? `Nodo de red: ${nom}` : `Central ETB: ${nom}`
      );
    });

    /** Centrales encima de rutas; cierres/NAP encima; polilínea de medición; eventos y marcas OTDR por encima del trazo. */
    scheduleOperationalLayersBump([0, 80, 250, 600]);

    routesLayer.onLineClick((e) => {
      const polyBusy = measurePolylineActive && !measurePolylineConfirmed;
      if (editing || polyBusy) return;
      const ovRoute = queryMoleculeOverlayFeatureAtPoint(e.point);
      if (ovRoute?.properties && String(ovRoute.properties.ftth_overlay_kind ?? '').trim()) {
        openCierreMapPopupFromFeature(ovRoute, e.lngLat);
        return;
      }
      const f = e.features?.[0];
      if (!f) return;
      const geomEarly = /** @type {any} */ (f.geometry);

      if (reporteCtl.handleRouteLinePick(e, f)) return;

      if (otdrAwaitingCableClick) {
        if (!selectedFeature || f.id !== selectedFeature.id) {
          setStatus(
            'Usa <strong>Fijar referencia</strong> sobre el mismo tendido ya seleccionado.'
          );
          return;
        }
        if (geomEarly?.type === 'LineString' && geomEarly.coordinates?.length >= 2) {
          const clickLL = [e.lngLat.lng, e.lngLat.lat];
          /** Misma geometría que en «Marcar corte» (evita desfase ref vs tendido si el clic devuelve coords distintas). */
          const geomSel = /** @type {any} */ (selectedFeature.geometry);
          const lineForOtdrRef =
            geomSel?.type === 'LineString' && geomSel.coordinates?.length >= 2
              ? /** @type {GeoJSON.LineString} */ (geomSel)
              : /** @type {GeoJSON.LineString} */ (geomEarly);
          otdrClickRefFromStartM = distanceFromStartAlongLineMeters(lineForOtdrRef, clickLL, turf);
          const snapped = snapLngLatToLine(lineForOtdrRef, clickLL, turf);
          otdrClickRefLngLat = /** @type {[number, number]} */ ([snapped[0], snapped[1]]);
          medidaEventoMarkerLayer.ensureLayer();
          medidaEventoMarkerLayer.setPoint(otdrClickRefLngLat);
          medidaEventoMarkerLayer.bringToFront();
          otdrCutLayer.bringToFront();
          otdrAwaitingCableClick = false;
          btnOtdrArmClick.classList.remove('active');
          setEditorFloatPickMode('trazar', false);
          otdrClickStatus.textContent = `Referencia en tramo: ${fmtM(otdrClickRefFromStartM)} desde inicio (por tendido).`;
          setStatus(
            'Referencia fijada. Metros de fibra y sentido; luego <strong>Marcar corte</strong>.'
          );
          syncButtons();
        }
        return;
      }

      const prevId = selectedFeature?.id;
      selectedFeature = /** @type {any} */ (f);
      if (prevId != null && prevId !== f.id) {
        clearOtdrMarkAndRef();
      }
      routesLayer.setSelected(f.id);
      const geom = /** @type {any} */ (f.geometry);
      let statusExtra = '';
      if (geom?.type === 'LineString' && geom.coordinates?.length >= 2) {
        const nc = updateCentralMetricForCableClick(geom, e.lngLat);
        if (nc) {
          statusExtra =
            appNetwork === 'corporativa'
              ? ` · Nodo más cercano (aire): ${fmtM(nc.meters)} (${nc.nombre})`
              : ` · Central más cercana (aire): ${fmtM(nc.meters)} (${nc.nombre})`;
        } else if (!lastCentralesFc?.features?.length) {
          statusExtra =
            appNetwork === 'corporativa'
              ? ' · Sin nodos en mapa para medir distancia.'
              : ' · Sin centrales en mapa para medir distancia.';
        }
      } else {
        clearCentralMetric();
      }
      setStatus(`Seleccionada: ${f.properties?.nombre ?? f.id}${statusExtra}`);
      updateMetrics(geom, turf);
      syncButtons();
    });

    /**
     * @param {mapboxgl.LngLat} lngLat
     */
    function openMapExternalNavPopup(lngLat) {
      const lat = lngLat.lat;
      const lng = lngLat.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      closeMapExternalNavPopup();
      const gUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
      const wUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
      const html = `
    <div class="map-external-nav-popup">
      <div class="map-external-nav-popup__title">Navegar a este punto</div>
      <div class="map-external-nav-popup__hint">Mantén pulsado el mapa ~2 s (sin mover). En PC: Mayús+clic.</div>
      <div class="map-external-nav-popup__coords">${escapeHtml(lat.toFixed(6))}, ${escapeHtml(lng.toFixed(6))}</div>
      <div class="map-external-nav-popup__actions">
        <a class="map-external-nav-popup__btn map-external-nav-popup__btn--gmaps" href="${gUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a>
        <a class="map-external-nav-popup__btn map-external-nav-popup__btn--waze" href="${wUrl}" target="_blank" rel="noopener noreferrer">Waze</a>
      </div>
    </div>`;
      const popup = new mapboxgl.Popup({
        className: 'map-external-nav-popup-wrap',
        closeButton: true,
        closeOnClick: true,
        maxWidth: 'min(92vw, 280px)',
        offset: 12
      })
        .setLngLat(lngLat)
        .setHTML(html)
        .addTo(map);
      mapExternalNavPopup = popup;
      popup.on('close', () => {
        if (mapExternalNavPopup === popup) mapExternalNavPopup = null;
      });
    }

    /** Waze / Google Maps: mantener pulsado ~2 s en el mapa (táctil o ratón). */
    const LONG_PRESS_NAV_MS = 2000;
    const LONG_PRESS_MOVE_CANCEL_PX = 16;
    let navLongPressTimer = 0;
    /** @type {{ x: number, y: number, lngLat: mapboxgl.LngLat } | null} */
    let navLongPressStart = null;
    let navLongPressMouseDown = false;

    function lngLatFromCanvasClient(clientX, clientY) {
      const rect = map.getCanvas().getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return map.unproject([x, y]);
    }

    function shouldBlockExternalNavLongPress() {
      if (editing) return true;
      if (document.body.classList.contains('editor-pick-mode-active')) return true;
      if (otdrAwaitingCableClick) return true;
      if (measurePolylineActive && !measurePolylineConfirmed) return true;
      return false;
    }

    function clearNavLongPress() {
      if (navLongPressTimer) {
        window.clearTimeout(navLongPressTimer);
        navLongPressTimer = 0;
      }
      navLongPressStart = null;
    }

    function startNavLongPress(clientX, clientY) {
      clearNavLongPress();
      if (shouldBlockExternalNavLongPress()) return;
      try {
        const lngLat = lngLatFromCanvasClient(clientX, clientY);
        navLongPressStart = { x: clientX, y: clientY, lngLat };
        navLongPressTimer = window.setTimeout(() => {
          navLongPressTimer = 0;
          if (!navLongPressStart) return;
          openMapExternalNavPopup(navLongPressStart.lngLat);
          try {
            if (navigator.vibrate) navigator.vibrate(20);
          } catch {
            /* */
          }
          navLongPressStart = null;
        }, LONG_PRESS_NAV_MS);
      } catch {
        clearNavLongPress();
      }
    }

    function moveNavLongPress(clientX, clientY) {
      if (!navLongPressStart || !navLongPressTimer) return;
      const dx = clientX - navLongPressStart.x;
      const dy = clientY - navLongPressStart.y;
      if (dx * dx + dy * dy > LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX) {
        clearNavLongPress();
      }
    }

    const mapCanvas = map.getCanvas();
    mapCanvas.addEventListener(
      'touchstart',
      (ev) => {
        if (ev.touches.length !== 1) return;
        const t = ev.touches[0];
        startNavLongPress(t.clientX, t.clientY);
      },
      { passive: true }
    );
    mapCanvas.addEventListener(
      'touchmove',
      (ev) => {
        if (ev.touches.length !== 1) return;
        const t = ev.touches[0];
        moveNavLongPress(t.clientX, t.clientY);
      },
      { passive: true }
    );
    mapCanvas.addEventListener('touchend', () => clearNavLongPress());
    mapCanvas.addEventListener('touchcancel', () => clearNavLongPress());

    mapCanvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      navLongPressMouseDown = true;
      startNavLongPress(ev.clientX, ev.clientY);
    });
    mapCanvas.addEventListener('mousemove', (ev) => {
      if (!navLongPressMouseDown) return;
      moveNavLongPress(ev.clientX, ev.clientY);
    });
    mapCanvas.addEventListener('mouseleave', () => {
      navLongPressMouseDown = false;
      clearNavLongPress();
    });
    window.addEventListener('mouseup', () => {
      navLongPressMouseDown = false;
      clearNavLongPress();
    });
    mapCanvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
    });
    map.on('dragstart', () => clearNavLongPress());

    map.on('click', (e) => {
      if (editing) return;
      try {
        const hasRouteHit =
          map.getLayer(ROUTES_LAYER_ID) != null
            ? map.queryRenderedFeatures(e.point, { layers: [ROUTES_LAYER_ID] }).length > 0
            : false;
        if (reporteCtl.handleMapTapPick?.(e, { hasRouteHit })) return;
      } catch {
        /* */
      }
      const polyBusy = measurePolylineActive && !measurePolylineConfirmed;
      if (!polyBusy) {
        const ov = queryMoleculeOverlayFeatureAtPoint(e.point);
        if (ov?.properties && String(ov.properties.ftth_overlay_kind ?? '').trim()) {
          const routeUnder =
            map.getLayer(ROUTES_LAYER_ID) != null
              ? map.queryRenderedFeatures(e.point, { layers: [ROUTES_LAYER_ID] })
              : [];
          if (!routeUnder.length) {
            openCierreMapPopupFromFeature(ov, e.lngLat);
            return;
          }
        }
      }
      if (polyBusy) {
        measurePolylineCoords.push([e.lngLat.lng, e.lngLat.lat]);
        setMeasurePolylineData(map, measurePolylineCoords, turf);
        bumpLayersAfterPolylineMeasure();
        syncMeasurePolylinePanel();
        syncMeasureFloatUi();
        syncButtons();
        return;
      }
      const forceNav =
        e.originalEvent &&
        'shiftKey' in e.originalEvent &&
        /** @type {MouseEvent} */ (e.originalEvent).shiftKey;
      if (!forceNav) return;
      if (document.body.classList.contains('editor-pick-mode-active')) return;
      if (otdrAwaitingCableClick) return;
      openMapExternalNavPopup(e.lngLat);
    });
  });

  btnReload.addEventListener('click', async () => {
    try {
      await reloadRoutes();
    } catch (e) {
      setStatus(e.message);
    }
  });

  document.querySelectorAll('input[name="otdr-ref"]').forEach((el) => {
    el.addEventListener('change', () => {
      updateOtdrClickPanelVisibility();
      if (getOtdrRef() !== 'click') {
        otdrAwaitingCableClick = false;
        btnOtdrArmClick.classList.remove('active');
        setEditorFloatPickMode('trazar', false);
        otdrClickRefFromStartM = null;
        otdrClickRefLngLat = null;
        otdrClickStatus.textContent = 'Referencia: —';
      }
      syncButtons();
    });
  });

  btnOtdrArmClick.addEventListener('click', () => {
    if (!selectedFeature || editing) return;
    if (getOtdrRef() !== 'click') return;
    if (otdrAwaitingCableClick) {
      otdrAwaitingCableClick = false;
      btnOtdrArmClick.classList.remove('active');
      setEditorFloatPickMode('trazar', false);
      setStatus('Referencia por clic cancelada.');
      syncButtons();
      return;
    }
    reporteCtl?.cancelMapPickMode?.();
    otdrAwaitingCableClick = true;
    btnOtdrArmClick.classList.add('active');
    setEditorFloatPickMode('trazar', true);
    setStatus('Haz clic en el tendido seleccionado para fijar la referencia de trazado.');
  });

  otdrFiberInput.addEventListener('input', () => {
    syncOtdrFiberGeomHint();
  });
  otdrFiberInput.addEventListener('change', () => {
    syncOtdrFiberGeomHint();
  });

  btnOtdrMark.addEventListener('click', () => markOtdrCut());
  btnOtdrClear.addEventListener('click', () => clearOtdrMapOverlay());

  btnNewRoute.addEventListener('click', () => {
    const raw = window.prompt(
      'Nombre de la nueva ruta (troncal, tendido, etc.):',
      `Ruta ${new Date().toISOString().slice(0, 10)}`
    );
    if (raw == null) {
      setStatus('Creación cancelada.');
      return;
    }
    const nombre = raw.trim().slice(0, 200);
    if (!nombre) {
      setStatus('Indica un nombre para la ruta.');
      return;
    }
    isNewRoute = true;
    newRouteNombre = nombre;
    selectedFeature = null;
    editing = true;
    reporteCtl?.cancelMapPickMode?.();
    clearOtdrMarkAndRef();
    clearMeasureClickModes();
    clearCentralMetric();
    routesLayer.ensureLayer();
    syncRoutesLineStyleMode();
    moleculeOverlayLayer.ensureLayer();
    moleculeOverlayLayer.clear();
    routesLayer.setData({ type: 'FeatureCollection', features: [] });
    routesLayer.setSelected(null);
    routesLayer.setHiddenRouteId(null);
    cableSearch?.reset();
    editor.attach();
    editor.startNewLineDrawing();
    bringMapboxDrawLayersToTop();
    try {
      map.once('idle', () => {
        bringMapboxDrawLayersToTop();
      });
    } catch {
      /* */
    }
    setStatus(
      `Nueva ruta «${nombre}»: traza la línea en el mapa (doble clic para cerrar el trazo). Luego Guardar.`
    );
    syncButtons();
  });

  btnEdit.addEventListener('click', () => {
    if (!selectedFeature) return;
    isNewRoute = false;
    newRouteNombre = '';
    editing = true;
    reporteCtl?.cancelMapPickMode?.();
    clearOtdrMarkAndRef();
    clearMeasureClickModes();
    clearCentralMetric();
    routesLayer.setHiddenRouteId(selectedFeature.id);
    editor.attach();
    editor.startEdit(selectedFeature);
    bringMapboxDrawLayersToTop();
    try {
      map.once('idle', () => {
        bringMapboxDrawLayersToTop();
      });
    } catch {
      /* */
    }
    setStatus('Modo edición: arrastra vértices, añade puntos (+ línea) o borra (papelera).');
    syncButtons();
  });

  btnCancel.addEventListener('click', async () => {
    editor.cancel();
    routesLayer.setHiddenRouteId(null);
    editing = false;
    isNewRoute = false;
    newRouteNombre = '';
    try {
      await reloadRoutes();
    } catch (e) {
      setStatus(e.message);
    }
    syncButtons();
  });

  btnSave.addEventListener('click', async () => {
    if (!isNewRoute && !selectedFeature) return;
    const geom = editor.getActiveLineGeometry();
    if (!geom?.coordinates || geom.coordinates.length < 2) {
      setStatus('Geometría inválida (mínimo 2 vértices).');
      return;
    }
    try {
      setStatus('Guardando…');
      if (isNewRoute) {
        await api.createRuta(newRouteNombre, geom);
      } else {
        const routeId = Number(selectedFeature.id);
        if (!Number.isInteger(routeId) || routeId < 1) {
          setStatus('La ruta no tiene un id numérico válido; recarga y selecciónala de nuevo.');
          syncButtons();
          return;
        }
        await api.updateRutaGeometry(routeId, geom);
      }
      editor.cancel();
      routesLayer.setHiddenRouteId(null);
      editing = false;
      isNewRoute = false;
      newRouteNombre = '';
      await reloadRoutes();
      setStatus('Guardado correctamente.');
    } catch (e) {
      setStatus(`Error al guardar: ${e.message}`);
      console.error(e);
    }
    syncButtons();
  });

  measureFab.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (measureFab.disabled) return;
    toggleMeasurePolylineMode();
  });

  measurePolyUndo.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!measurePolylineActive) return;
    if (measurePolylineConfirmed) {
      measurePolylineConfirmed = false;
      setMeasurePolylineCursor();
      syncMeasurePolylinePanel();
      syncMeasureFloatUi();
      syncButtons();
      return;
    }
    if (measurePolylineCoords.length === 0) return;
    measurePolylineCoords.pop();
    setMeasurePolylineData(map, measurePolylineCoords, turf);
    bumpLayersAfterPolylineMeasure();
    syncMeasurePolylinePanel();
    syncButtons();
  });

  measurePolyConfirm.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!measurePolylineActive || measurePolylineCoords.length < 2) return;
    measurePolylineConfirmed = true;
    const line = /** @type {GeoJSON.LineString} */ ({
      type: 'LineString',
      coordinates: measurePolylineCoords
    });
    const Lm = lineLengthMetersSafe(line, turf);
    setStatus(
      `Medición cerrada: ${fmtTotalHuman(Lm)} m (${fmtTotalHuman(lengthWithReserve20Pct(Lm))} m con +20 %). Papelera para borrar el trazo.`
    );
    setMeasurePolylineCursor();
    syncMeasurePolylinePanel();
    syncMeasureFloatUi();
    syncButtons();
  });

  measurePolyTrash.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!measurePolylineActive) return;
    measurePolylineCoords = [];
    measurePolylineConfirmed = false;
    setMeasurePolylineData(map, measurePolylineCoords, turf);
    bumpLayersAfterPolylineMeasure();
    syncMeasurePolylinePanel();
    setMeasurePolylineCursor();
    syncMeasureFloatUi();
    syncButtons();
    setStatus('Trazo de medición borrado. Sigue en modo trazo: nuevos clics añaden vértices.');
  });

  measurePolyDock.addEventListener('click', (ev) => {
    ev.stopPropagation();
  });

  syncButtons();
}

boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('status');
  if (s) s.textContent = String(e.message || e);
});
