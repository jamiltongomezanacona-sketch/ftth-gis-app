import { randomUUID } from 'node:crypto';

/**
 * Cierres por molécula (tabla `cierres`, campo `molecula_codigo` tipo CENTRAL|MOL).
 * @param {import('pg').Pool} pool
 * @param {string | string[]} moleculaCodigo ej. "SANTA_INES|SI26" o varias variantes (espacios vs _)
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchCierresAsFeatureCollection(pool, moleculaCodigo) {
  const codes = Array.isArray(moleculaCodigo)
    ? moleculaCodigo.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [String(moleculaCodigo ?? '').trim()].filter(Boolean);
  const uniq = [...new Set(codes)];
  if (!uniq.length) {
    return { type: 'FeatureCollection', features: [] };
  }

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.nombre,
      c.tipo,
      c.estado,
      c.descripcion,
      c.molecula_codigo,
      c.dist_odf,
      ST_AsGeoJSON(
        COALESCE(
          c.geom,
          CASE
            WHEN c.lat IS NOT NULL AND c.lng IS NOT NULL THEN
              ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)
            ELSE NULL
          END
        )
      )::json AS geometry
    FROM cierres c
    WHERE c.molecula_codigo = ANY($1::text[])
      AND (
        c.geom IS NOT NULL
        OR (c.lat IS NOT NULL AND c.lng IS NOT NULL)
      )
    ORDER BY c.nombre NULLS LAST
    `,
    [uniq]
  );

  return { type: 'FeatureCollection', features: mapCierreRowsToFeatures(rows) };
}

/**
 * Búsqueda global de cierres (nombre, molécula, tipo, descripción).
 * @param {import('pg').Pool} pool
 * @param {string} query texto ≥ 2 caracteres (sin comodines)
 * @param {number} [limit]
 */
export async function fetchCierresSearch(pool, query, limit = 40) {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase();
  if (needle.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);

  const { rows } = await pool.query(
    `
    SELECT
      c.id,
      c.nombre,
      c.tipo,
      c.estado,
      c.descripcion,
      c.molecula_codigo,
      c.dist_odf,
      ST_AsGeoJSON(
        COALESCE(
          c.geom,
          CASE
            WHEN c.lat IS NOT NULL AND c.lng IS NOT NULL THEN
              ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)
            ELSE NULL
          END
        )
      )::json AS geometry
    FROM cierres c
    WHERE (
        c.geom IS NOT NULL
        OR (c.lat IS NOT NULL AND c.lng IS NOT NULL)
      )
      AND (
        strpos(lower(coalesce(c.nombre, '')), $1::text) > 0
        OR strpos(lower(coalesce(c.molecula_codigo, '')), $1::text) > 0
        OR strpos(lower(coalesce(c.tipo, '')), $1::text) > 0
        OR strpos(lower(coalesce(c.descripcion, '')), $1::text) > 0
      )
    ORDER BY c.nombre NULLS LAST
    LIMIT $2
    `,
    [needle, lim]
  );

  return { type: 'FeatureCollection', features: mapCierreRowsToFeatures(rows) };
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {GeoJSON.Feature[]}
 */
function mapCierreRowsToFeatures(rows) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const r of rows) {
    const g = r.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    const cid = r.id != null ? String(r.id) : '';
    features.push({
      type: 'Feature',
      id: r.id,
      geometry: g,
      properties: {
        id: cid,
        nombre: r.nombre ?? '',
        name: r.nombre ?? '',
        tipo: r.tipo ?? '',
        estado: r.estado ?? '',
        descripcion: r.descripcion ?? '',
        molecula_codigo: r.molecula_codigo ?? '',
        dist_odf: r.dist_odf,
        source: 'db_cierres'
      }
    });
  }
  return features;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} id
 */
export function isUuidString(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} id uuid
 * @param {Record<string, unknown>} body
 */
export async function updateCierreById(pool, id, body) {
  const fields = [];
  const vals = [];
  let n = 1;

  const setStr = (col, val) => {
    fields.push(`${col} = $${n}`);
    vals.push(val);
    n += 1;
  };

  if (body.nombre != null) setStr('nombre', String(body.nombre).trim().slice(0, 500) || null);
  if (body.tipo != null) setStr('tipo', String(body.tipo).trim().slice(0, 80) || null);
  if (body.estado !== undefined) setStr('estado', body.estado == null ? null : String(body.estado).trim().slice(0, 120));
  if (body.descripcion !== undefined) {
    setStr('descripcion', body.descripcion == null ? null : String(body.descripcion).trim().slice(0, 8000));
  }
  if (body.molecula_codigo != null) {
    setStr('molecula_codigo', String(body.molecula_codigo).trim().slice(0, 200) || null);
  }
  if (body.dist_odf !== undefined) {
    if (body.dist_odf === null || body.dist_odf === '') {
      setStr('dist_odf', null);
    } else {
      const d = Number(body.dist_odf);
      setStr('dist_odf', Number.isFinite(d) && d >= 0 ? d : null);
    }
  }

  let lat = null;
  let lng = null;
  if (body.lat != null && body.lng != null) {
    const la = Number(body.lat);
    const lo = Number(body.lng);
    if (Number.isFinite(la) && Number.isFinite(lo) && lo >= -180 && lo <= 180 && la >= -90 && la <= 90) {
      lat = la;
      lng = lo;
      setStr('lat', lat);
      setStr('lng', lng);
    }
  }

  if (!fields.length) {
    return { updated: 0 };
  }

  vals.push(id.trim());
  const sql = `
    UPDATE cierres
    SET ${fields.join(', ')}
    WHERE id = $${n}::uuid
    RETURNING id
  `;
  const { rows } = await pool.query(sql, vals);

  if (lat != null && lng != null && rows[0]?.id) {
    try {
      await pool.query(
        `UPDATE cierres SET geom = ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326) WHERE id = $3::uuid`,
        [lng, lat, id.trim()]
      );
    } catch {
      /* */
    }
  }

  return { updated: rows.length };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} id uuid
 */
export async function deleteCierreById(pool, id) {
  const { rowCount } = await pool.query(`DELETE FROM cierres WHERE id = $1::uuid`, [id.trim()]);
  return { deleted: rowCount ?? 0 };
}

/**
 * Alta de cierre FTTH (E1 / E2 u otros tipos cortos).
 * @param {import('pg').Pool} pool
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ id: string }>}
 */
export async function insertCierre(pool, payload) {
  const nombre = String(payload.nombre ?? '')
    .trim()
    .slice(0, 500);
  const tipo = String(payload.tipo ?? '')
    .trim()
    .slice(0, 80)
    .toUpperCase();
  const molecula_codigo = String(payload.molecula_codigo ?? '')
    .trim()
    .slice(0, 200);
  const la = Number(payload.lat);
  const lo = Number(payload.lng);
  if (!nombre) {
    throw Object.assign(new Error('nombre requerido'), { code: 'VALIDATION' });
  }
  if (!tipo) {
    throw Object.assign(new Error('tipo requerido'), { code: 'VALIDATION' });
  }
  if (!molecula_codigo) {
    throw Object.assign(new Error('molecula_codigo requerido'), { code: 'VALIDATION' });
  }
  if (!Number.isFinite(la) || !Number.isFinite(lo) || lo < -180 || lo > 180 || la < -90 || la > 90) {
    throw Object.assign(new Error('lat/lng inválidos'), { code: 'VALIDATION' });
  }

  let dist_odf = null;
  if (payload.dist_odf != null && payload.dist_odf !== '') {
    const d = Number(payload.dist_odf);
    if (Number.isFinite(d) && d >= 0) dist_odf = d;
  }

  const estado =
    payload.estado != null && String(payload.estado).trim() !== ''
      ? String(payload.estado).trim().slice(0, 120)
      : null;
  const descripcion =
    payload.descripcion != null && String(payload.descripcion).trim() !== ''
      ? String(payload.descripcion).trim().slice(0, 8000)
      : null;

  const id = randomUUID();

  const { rows } = await pool.query(
    `
    INSERT INTO cierres (
      id,
      molecula_codigo,
      nombre,
      tipo,
      estado,
      descripcion,
      lat,
      lng,
      dist_odf,
      created_at,
      geom
    )
    VALUES (
      $1::uuid,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::double precision,
      $8::double precision,
      $9::double precision,
      now(),
      ST_SetSRID(ST_MakePoint($8::double precision, $7::double precision), 4326)
    )
    RETURNING id::text AS id
    `,
    [id, molecula_codigo, nombre, tipo, estado, descripcion, la, lo, dist_odf]
  );

  return { id: String(rows[0]?.id ?? id) };
}
