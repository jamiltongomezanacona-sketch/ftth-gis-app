/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   red: 'ftth'|'corporativa',
 *   dist_odf: number | null,
 *   tipo_evento: string,
 *   estado: string,
 *   accion: string,
 *   descripcion: string,
 *   ruta_id: number | null,
 *   nombre_tendido: string | null,
 *   lng: number | null,
 *   lat: number | null
 * }} row
 * @returns {Promise<{ id: number }>}
 */
export async function insertEventoReporte(pool, row) {
  /**
   * Primero INSERT sin `geom` en la expresión: evita 500 si PostGIS no expone
   * `ST_MakePoint` en el search_path o hay un fallo puntual al construir el punto.
   * Luego UPDATE opcional para rellenar `geom` desde lng/lat.
   */
  const { rows } = await pool.query(
    `
    INSERT INTO eventos_reporte (
      red_tipo, dist_odf, tipo_evento, estado, accion, descripcion,
      ruta_id, nombre_tendido, lng, lat, geom
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      NULL
    )
    RETURNING id
    `,
    [
      row.red,
      row.dist_odf,
      row.tipo_evento,
      row.estado,
      row.accion,
      row.descripcion,
      row.ruta_id,
      row.nombre_tendido,
      row.lng,
      row.lat
    ]
  );
  const id = Number(rows[0].id);

  if (
    row.lng != null &&
    row.lat != null &&
    Number.isFinite(row.lng) &&
    Number.isFinite(row.lat) &&
    row.lng >= -180 &&
    row.lng <= 180 &&
    row.lat >= -90 &&
    row.lat <= 90
  ) {
    try {
      await pool.query(
        `
        UPDATE eventos_reporte
        SET geom = ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326)
        WHERE id = $3
        `,
        [row.lng, row.lat, id]
      );
    } catch {
      /* Sin geometría en mapa: el registro sigue válido con lng/lat. */
    }
  }

  return { id };
}

/**
 * Coincide `nombre_tendido` o prefijo `CENTRAL|MOL` del tendido en `rutas` con variantes (espacios vs `_`).
 * @param {string[]} moleculaCodigoVariants
 */
function sqlMoleculeMatchExpr(moleculaCodigoVariants) {
  const n = moleculaCodigoVariants.length;
  if (!n) return { where: '', params: /** @type {unknown[]} */ ([]) };
  return {
    where: `
    AND (
      (er.nombre_tendido IS NOT NULL AND er.nombre_tendido = ANY($2::text[]))
      OR EXISTS (
        SELECT 1
        FROM rutas r
        WHERE r.id = er.ruta_id
          AND position('|' IN trim(r.nombre)) > 0
          AND (
            split_part(trim(r.nombre), '|', 1) || '|' || split_part(trim(r.nombre), '|', 2)
          ) = ANY($2::text[])
      )
    )`,
    params: [moleculaCodigoVariants]
  };
}

/**
 * @param {Record<string, unknown>} r fila SELECT de `eventos_reporte` + geom_json
 * @returns {{ item: object, feature: import('geojson').Feature<import('geojson').Point> | null }}
 */
function eventoDbRowToItemAndFeature(r) {
  let gj = r.geom_json;
  if (gj && typeof gj === 'string') {
    try {
      gj = JSON.parse(gj);
    } catch {
      gj = null;
    }
  }
  const hasMapPoint = Boolean(
    gj &&
      typeof gj === 'object' &&
      /** @type {import('geojson').Point} */ (gj).type === 'Point' &&
      Array.isArray(/** @type {import('geojson').Point} */ (gj).coordinates) &&
      /** @type {import('geojson').Point} */ (gj).coordinates.length >= 2
  );

  const item = {
    id: Number(r.id),
    created_at: r.created_at,
    red_tipo: String(r.red_tipo),
    dist_odf: r.dist_odf != null ? Number(r.dist_odf) : null,
    tipo_evento: String(r.tipo_evento ?? ''),
    estado: String(r.estado ?? ''),
    accion: String(r.accion ?? ''),
    descripcion: String(r.descripcion ?? ''),
    ruta_id: r.ruta_id != null ? Number(r.ruta_id) : null,
    nombre_tendido: r.nombre_tendido != null ? String(r.nombre_tendido) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    lat: r.lat != null ? Number(r.lat) : null,
    has_map_point: hasMapPoint
  };

  /** @type {import('geojson').Feature<import('geojson').Point> | null} */
  let feature = null;
  if (hasMapPoint && gj) {
    feature = {
      type: 'Feature',
      id: String(r.id),
      properties: {
        id: Number(r.id),
        tipo_evento: String(r.tipo_evento ?? ''),
        estado: String(r.estado ?? ''),
        accion: String(r.accion ?? ''),
        descripcion: String(r.descripcion ?? '').slice(0, 800),
        nombre_tendido: r.nombre_tendido != null ? String(r.nombre_tendido) : '',
        created_iso: r.created_at ? new Date(r.created_at).toISOString() : '',
        dist_odf: r.dist_odf != null ? Number(r.dist_odf) : null,
        ruta_id: r.ruta_id != null ? Number(r.ruta_id) : null,
        lng: r.lng != null ? Number(r.lng) : null,
        lat: r.lat != null ? Number(r.lat) : null
      },
      geometry: /** @type {import('geojson').Point} */ (gj)
    };
  }

  return { item, feature };
}

/**
 * Un evento por id (mapa / depuración / `?evento=` en el editor).
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} red
 * @param {number} id
 * @returns {Promise<{ item: object, feature: import('geojson').Feature | null } | null>}
 */
export async function getEventoReporteByIdForRed(pool, red, id) {
  const { rows } = await pool.query(
    `
    SELECT
      er.id,
      er.created_at,
      er.red_tipo,
      er.dist_odf,
      er.tipo_evento,
      er.estado,
      er.accion,
      er.descripcion,
      er.ruta_id,
      er.nombre_tendido,
      er.lng,
      er.lat,
      ST_AsGeoJSON(
        COALESCE(
          er.geom,
          CASE
            WHEN er.lng IS NOT NULL AND er.lat IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(er.lng::double precision, er.lat::double precision), 4326)
          END
        )
      )::json AS geom_json
    FROM eventos_reporte er
    WHERE er.id = $1::int AND er.red_tipo = $2
    `,
    [id, red]
  );
  if (!rows[0]) return null;
  return eventoDbRowToItemAndFeature(rows[0]);
}

/**
 * Lista eventos de la red para el mapa y el panel lateral.
 * @param {import('pg').Pool} pool
 * @param {{
 *   red: 'ftth'|'corporativa',
 *   limit?: number,
 *   moleculaCodigoVariants?: string[] | null
 * }} opts
 * @returns {Promise<{
 *   featureCollection: import('geojson').FeatureCollection,
 *   items: Array<{
 *     id: number,
 *     created_at: string | Date | null,
 *     red_tipo: string,
 *     dist_odf: number | null,
 *     tipo_evento: string,
 *     estado: string,
 *     accion: string,
 *     descripcion: string,
 *     ruta_id: number | null,
 *     nombre_tendido: string | null,
 *     lng: number | null,
 *     lat: number | null,
 *     has_map_point: boolean
 *   }>
 * }>}
 */
export async function listEventosReporteForRed(pool, opts) {
  const red = opts.red;
  const limit = Math.min(Math.max(Number(opts.limit) || 2000, 1), 2000);
  const variants = Array.isArray(opts.moleculaCodigoVariants)
    ? opts.moleculaCodigoVariants.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  const mol = sqlMoleculeMatchExpr(variants);

  const sql = `
    SELECT
      er.id,
      er.created_at,
      er.red_tipo,
      er.dist_odf,
      er.tipo_evento,
      er.estado,
      er.accion,
      er.descripcion,
      er.ruta_id,
      er.nombre_tendido,
      er.lng,
      er.lat,
      ST_AsGeoJSON(
        COALESCE(
          er.geom,
          CASE
            WHEN er.lng IS NOT NULL AND er.lat IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(er.lng::double precision, er.lat::double precision), 4326)
          END
        )
      )::json AS geom_json
    FROM eventos_reporte er
    WHERE er.red_tipo = $1
    ${mol.where}
    ORDER BY er.created_at DESC
    LIMIT $${mol.params.length ? 3 : 2}
    `;

  const params =
    mol.params.length > 0 ? [red, ...mol.params, limit] : [red, limit];

  const { rows } = await pool.query(sql, params);

  /** @type {import('geojson').Feature[]} */
  const features = [];
  const items = [];

  for (const r of rows) {
    const { item, feature } = eventoDbRowToItemAndFeature(r);
    items.push(item);
    if (feature) features.push(feature);
  }

  return {
    featureCollection: {
      type: 'FeatureCollection',
      features
    },
    items
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} red
 * @param {number} id
 * @param {Record<string, unknown>} body
 */
export async function updateEventoReporteById(pool, red, id, body) {
  const fields = [];
  const vals = [];
  let n = 1;

  const push = (col, val) => {
    fields.push(`${col} = $${n}`);
    vals.push(val);
    n += 1;
  };

  if (body.tipo_evento != null) {
    push('tipo_evento', String(body.tipo_evento).trim().toUpperCase());
  }
  if (body.estado != null) {
    push('estado', String(body.estado).trim().toUpperCase());
  }
  if (body.accion != null) {
    let accion = String(body.accion).trim();
    if (accion.toUpperCase() === 'INTERVENCION TECNICA') accion = 'INTERVENCIÓN TECNICA';
    push('accion', accion);
  }
  if (body.descripcion != null) {
    push('descripcion', String(body.descripcion).trim().slice(0, 8000));
  }
  if (body.dist_odf !== undefined) {
    if (body.dist_odf === null || body.dist_odf === '') {
      push('dist_odf', null);
    } else {
      const d = Number(body.dist_odf);
      push('dist_odf', Number.isFinite(d) && d >= 0 ? d : null);
    }
  }
  if (body.nombre_tendido !== undefined) {
    push(
      'nombre_tendido',
      body.nombre_tendido == null ? null : String(body.nombre_tendido).trim().slice(0, 500) || null
    );
  }
  if (body.ruta_id !== undefined) {
    if (body.ruta_id === null || body.ruta_id === '') {
      push('ruta_id', null);
    } else {
      const rid = Number(body.ruta_id);
      push('ruta_id', Number.isInteger(rid) && rid > 0 ? rid : null);
    }
  }

  let lng = null;
  let lat = null;
  if (body.lng != null && body.lat != null) {
    const lo = Number(body.lng);
    const la = Number(body.lat);
    if (Number.isFinite(lo) && Number.isFinite(la) && lo >= -180 && lo <= 180 && la >= -90 && la <= 90) {
      lng = lo;
      lat = la;
      push('lng', lng);
      push('lat', lat);
    }
  }

  if (!fields.length) {
    return { updated: 0 };
  }

  const idPos = n;
  const redPos = n + 1;
  vals.push(id, red);
  const sql = `
    UPDATE eventos_reporte er
    SET ${fields.join(', ')}
    WHERE er.id = $${idPos}::int AND er.red_tipo = $${redPos}
    RETURNING er.id
  `;
  const { rows } = await pool.query(sql, vals);

  if (lng != null && lat != null && rows[0]?.id) {
    try {
      await pool.query(
        `UPDATE eventos_reporte SET geom = ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326) WHERE id = $3::int AND red_tipo = $4`,
        [lng, lat, id, red]
      );
    } catch {
      /* */
    }
  }

  return { updated: rows.length };
}

/**
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} red
 * @param {number} id
 */
export async function deleteEventoReporteById(pool, red, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM eventos_reporte WHERE id = $1::int AND red_tipo = $2`,
    [id, red]
  );
  return { deleted: rowCount ?? 0 };
}
