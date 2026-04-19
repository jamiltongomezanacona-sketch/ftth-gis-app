/** Redes independientes en base de datos (`rutas`, `centrales_etb`). */
export const RED_TIPOS = ['ftth', 'corporativa'];

const MSG_RED_OBL =
  'Obligatorio y exclusivo: red=ftth o red=corporativa (no se mezclan datos entre redes).';

/**
 * @param {unknown} value
 * @param {'ftth'|'corporativa'} [fallback]
 * @returns {'ftth'|'corporativa'}
 */
export function normalizeRedTipo(value, fallback = 'ftth') {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'corporativa' || s === 'corp' || s === 'corporate') return 'corporativa';
  if (s === 'ftth') return 'ftth';
  return fallback;
}

/**
 * `red` explícita: sin valor o inválido → null (la API debe responder 400).
 * @param {unknown} value
 * @returns {'ftth'|'corporativa'|null}
 */
export function parseRedTipoObligatorio(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'ftth') return 'ftth';
  if (s === 'corporativa' || s === 'corp' || s === 'corporate') return 'corporativa';
  return null;
}

/**
 * GET/PUT: `?red=` o `?tipo=` o cabecera `X-Red-Tipo` (una basta; deben coincidir si vienen varias).
 * @param {import('express').Request} req
 * @returns {{ ok: true, red: 'ftth'|'corporativa' } | { ok: false, error: string }}
 */
function primerValorQuery(v) {
  if (v == null) return '';
  const x = Array.isArray(v) ? v[0] : v;
  return String(x ?? '').trim();
}

/**
 * Valor de query fiable: `req.query` a veces pierde claves con caracteres especiales o montajes raros;
 * se rellena desde `req.originalUrl` (URLSearchParams).
 * @param {import('express').Request} req
 * @param {string} key
 */
/**
 * @param {URLSearchParams} sp
 * @param {string} key
 */
function searchParamsGetCI(sp, key) {
  const direct = sp.get(key);
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const low = key.toLowerCase();
  for (const [k, v] of sp) {
    if (k.toLowerCase() === low && String(v ?? '').trim() !== '') return String(v).trim();
  }
  return '';
}

export function queryStringParam(req, key) {
  const fromQ = primerValorQuery(req.query?.[key]);
  if (fromQ !== '') return fromQ;
  try {
    const raw = String(req.originalUrl ?? req.url ?? '/');
    const u = new URL(raw, 'http://localhost');
    return searchParamsGetCI(u.searchParams, key);
  } catch {
    return '';
  }
}

export function redTipoDesdePeticionLectura(req) {
  const qRed = queryStringParam(req, 'red');
  const qTipo = queryStringParam(req, 'tipo');
  /** `req.get` es más fiable que `req.headers[...]` con CORS/proxy. */
  const h =
    String(req.get?.('X-Red-Tipo') ?? req.get?.('x-red-tipo') ?? '').trim() ||
    primerValorQuery(req.headers['x-red-tipo']);
  const parts = [qRed, qTipo, h].filter((s) => s !== '');
  if (parts.length === 0) {
    return { ok: false, error: MSG_RED_OBL };
  }
  const parsed = parts.map((v) => parseRedTipoObligatorio(v));
  if (parsed.some((p) => p == null)) {
    return { ok: false, error: 'Valor de red no válido. Use ftth o corporativa.' };
  }
  const first = parsed[0];
  if (!parsed.every((p) => p === first)) {
    return { ok: false, error: 'Los valores de red en query y cabecera deben coincidir.' };
  }
  return { ok: true, red: /** @type {'ftth'|'corporativa'} */ (first) };
}

/** Límite de vértices para evitar payloads abusivos (producción). */
export const MAX_LINE_VERTICES = 50_000;

export const MAX_NOMBRE_LEN = 200;

export function normalizeNombre(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_NOMBRE_LEN);
}

export function isLineStringGeometry(g) {
  if (
    !g ||
    g.type !== 'LineString' ||
    !Array.isArray(g.coordinates) ||
    g.coordinates.length < 2
  ) {
    return false;
  }
  if (g.coordinates.length > MAX_LINE_VERTICES) return false;
  return g.coordinates.every(
    (c) =>
      Array.isArray(c) &&
      c.length >= 2 &&
      Number.isFinite(c[0]) &&
      Number.isFinite(c[1])
  );
}
