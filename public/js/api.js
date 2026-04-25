import { getAuthSession } from './authSession.js';

/**
 * Deja solo el origen (protocolo + host + puerto), sin sufijo /api/rutas.
 * Evita URLs duplicadas tipo .../api/rutas/api/rutas si API_BASE estaba mal puesto.
 */
export function normalizeApiOrigin(apiBase) {
  let s = String(apiBase ?? '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/api\/rutas\/?$/i, '').replace(/\/+$/, '');
  // Error habitual: API_BASE=http://host:3001/api → rutas /api/api/cierres (404).
  s = s.replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  return s;
}

/**
 * Corrige rutas erróneas /api/rutas:123 (falta la barra antes del id).
 * Evita el bug de `new URL('…/rutas:1', base)` que deja el `:` en el pathname.
 */
function fixRutasPath(path) {
  return path.replace(/\/api\/rutas:(\d+)(?=$|[?#])/g, '/api/rutas/$1');
}

/**
 * Cliente HTTP para rutas y centrales filtrados por red (solo una red por instancia).
 * @param {string} apiBase ej. '' o 'http://127.0.0.1:3000' (no incluyas /api/rutas)
 * @param {'ftth'|'corporativa'} redTipo obligatorio; misma red en query y cabecera
 */
export function createRutasApi(apiBase, redTipo) {
  if (redTipo !== 'ftth' && redTipo !== 'corporativa') {
    throw new Error('createRutasApi: redTipo debe ser "ftth" o "corporativa".');
  }
  const origin = normalizeApiOrigin(apiBase);
  const red = redTipo;
  const redQs = `?red=${encodeURIComponent(red)}`;

  function resolveUrl(path) {
    let p = String(path ?? '').trim();
    if (!p.startsWith('/')) p = `/${p}`;
    p = fixRutasPath(p);
    if (!origin) return p;
    const base = origin.replace(/\/+$/, '');
    return `${base}${p}`;
  }

  async function getJson(path, options = {}) {
    const url = resolveUrl(path);
    const method = String(options.method || 'GET').toUpperCase();
    /** GET/HEAD sin cuerpo: no enviar Content-Type (evita peticiones «no simples» y rarezas en proxy/CORS). */
    const session = getAuthSession();
    const bearer =
      session?.token && typeof session.token === 'string'
        ? { Authorization: `Bearer ${session.token}` }
        : {};
    const headers = {
      Accept: 'application/json',
      'X-Red-Tipo': red,
      ...bearer,
      ...options.headers
    };
    if (method !== 'GET' && method !== 'HEAD') {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.error || res.statusText || 'Error HTTP';
      const detail = data?.detail ? ` — ${data.detail}` : '';
      const pg = data?.code ? ` [${data.code}]` : '';
      throw new Error(`${res.status}: ${msg}${detail}${pg}`);
    }
    return data;
  }

  return {
    /** Red activa en cliente (misma que `?red=`). */
    getRedTipo() {
      return red;
    },

    /** @returns {Promise<object>} FeatureCollection */
    listRutas(options = {}) {
      return getJson(`/api/rutas${redQs}`, options);
    },

    /** @returns {Promise<object>} Feature */
    getRuta(id) {
      return getJson(`/api/rutas/${encodeURIComponent(id)}${redQs}`);
    },

    /**
     * @param {number|string} id
     * @param {GeoJSON.LineString} geometry
     */
    async updateRutaGeometry(id, geometry) {
      return getJson(`/api/rutas/${encodeURIComponent(id)}${redQs}`, {
        method: 'PUT',
        body: JSON.stringify({ geometry })
      });
    },

    /**
     * @param {string} nombre
     * @param {GeoJSON.LineString} geometry
     */
    async createRuta(nombre, geometry) {
      return getJson('/api/rutas', {
        method: 'POST',
        body: JSON.stringify({ nombre, geometry, red })
      });
    },

    /** @returns {Promise<object>} FeatureCollection de centrales (Point) */
    listCentralesEtB(options = {}) {
      return getJson(`/api/centrales-etb${redQs}`, options);
    },

    /**
     * Cierres por molécula (tabla PostgreSQL `cierres`). Solo red FTTH devuelve datos.
     * @param {string} central ej. SANTA_INES
     * @param {string} molecula ej. SI26
     * @returns {Promise<{ type: 'FeatureCollection', features: object[] }>}
     */
    listCierresPorMolecula(central, molecula) {
      const c = String(central ?? '').trim();
      const m = String(molecula ?? '').trim();
      const qs = new URLSearchParams();
      qs.set('red', red);
      qs.set('central', c);
      qs.set('molecula', m);
      return getJson(`/api/cierres?${qs.toString()}`);
    },

    /**
     * Búsqueda global en todos los cierres (solo FTTH). Mínimo 2 caracteres en el servidor.
     * @param {string} query
     * @param {number} [limit]
     */
    searchCierres(query, options = {}) {
      if (red !== 'ftth') {
        return Promise.resolve({ type: 'FeatureCollection', features: [] });
      }
      const q = String(query ?? '').trim();
      const qs = new URLSearchParams();
      qs.set('red', red);
      qs.set('buscar', q);
      qs.set('limit', '48');
      return getJson(`/api/cierres?${qs.toString()}`, options);
    },

    /**
     * Reporte de evento / incidencia (sidebar editor).
     * @param {Record<string, unknown>} body dist_odf, tipo_evento, estado, accion, descripcion, ruta_id?, nombre_tendido?, lng?, lat?
     */
    postEventoReporte(body) {
      return getJson(`/api/eventos-reporte${redQs}`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    },

    /**
     * Lista eventos de la red: `featureCollection` (puntos en mapa) + `items` (panel).
     * En FTTH, opcionalmente filtra por molécula (`CENTRAL|MOL` vía `central` + `molecula`).
     * @param {{ central?: string, molecula?: string } | null | undefined} [molecule]
     */
    listEventosReporte(molecule, options = {}) {
      const c = molecule?.central != null ? String(molecule.central).trim() : '';
      const m = molecule?.molecula != null ? String(molecule.molecula).trim() : '';
      /** El servidor por defecto usa 500; con muchas incidencias recientes, IDs antiguos no aparecen en mapa/lista. */
      const limMax = '2000';
      if (!c || !m) {
        return getJson(`/api/eventos-reporte${redQs}&limit=${limMax}`, options);
      }
      const q = new URLSearchParams();
      q.set('central', c);
      q.set('molecula', m);
      q.set('limit', limMax);
      return getJson(`/api/eventos-reporte${redQs}&${q.toString()}`, options);
    },

    /**
     * @param {number|string} id
     * @param {Record<string, unknown>} body
     */
    patchEventoReporte(id, body) {
      return getJson(`/api/eventos-reporte/${encodeURIComponent(id)}${redQs}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    },

    /**
     * @param {number|string} id
     */
    deleteEventoReporte(id) {
      return getJson(`/api/eventos-reporte/${encodeURIComponent(id)}${redQs}`, {
        method: 'DELETE'
      });
    },

    /**
     * Actualiza cierre en PostgreSQL (solo FTTH).
     * @param {string} id uuid
     * @param {Record<string, unknown>} body
     */
    patchCierre(id, body) {
      if (red !== 'ftth') {
        return Promise.reject(new Error('Solo red FTTH'));
      }
      return getJson(`/api/cierres/${encodeURIComponent(id)}${redQs}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    },

    /**
     * @param {string} id uuid
     */
    deleteCierre(id) {
      if (red !== 'ftth') {
        return Promise.reject(new Error('Solo red FTTH'));
      }
      return getJson(`/api/cierres/${encodeURIComponent(id)}${redQs}`, {
        method: 'DELETE'
      });
    }
  };
}
