/**
 * Consultas GeoJSON para la tabla `rutas` (PostGIS, SRID 4326).
 * Filtrado por `red_tipo` (FTTH vs corporativa).
 */

/**
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} redTipo
 */
export async function fetchRutasAsFeatureCollection(pool, redTipo) {
  const { rows } = await pool.query(
    `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'type', 'Feature',
              'id', r.id,
              'geometry', ST_AsGeoJSON(r.geom)::json,
              'properties', json_build_object(
                'nombre', r.nombre,
                'red_tipo', COALESCE(NULLIF(trim(r.red_tipo::text), ''), 'ftth')
              )
            )
            ORDER BY r.id
          )
          FROM rutas r
          WHERE r.geom IS NOT NULL
            AND (
              ($1::text = 'corporativa' AND lower(trim(r.red_tipo::text)) = 'corporativa')
              OR (
                $1::text = 'ftth'
                AND (r.red_tipo = 'ftth' OR r.red_tipo IS NULL OR trim(coalesce(r.red_tipo::text, '')) = '')
              )
            )
        ),
        '[]'::json
      )
    ) AS fc
    `,
    [redTipo]
  );
  let fc = rows[0]?.fc;
  if (typeof fc === 'string') {
    try {
      fc = JSON.parse(fc);
    } catch {
      fc = null;
    }
  }
  return fc && typeof fc === 'object' ? fc : { type: 'FeatureCollection', features: [] };
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {'ftth'|'corporativa'} redTipo
 */
export async function fetchRutaFeatureById(pool, id, redTipo) {
  const { rows } = await pool.query(
    `
    SELECT json_build_object(
      'type', 'Feature',
      'id', r.id,
      'geometry', ST_AsGeoJSON(r.geom)::json,
      'properties', json_build_object(
        'nombre', r.nombre,
        'red_tipo', COALESCE(NULLIF(trim(r.red_tipo::text), ''), 'ftth')
      )
    ) AS feature
    FROM rutas r
    WHERE r.id = $1
      AND r.geom IS NOT NULL
      AND (
        ($2::text = 'corporativa' AND lower(trim(r.red_tipo::text)) = 'corporativa')
        OR (
          $2::text = 'ftth'
          AND (r.red_tipo = 'ftth' OR r.red_tipo IS NULL OR trim(coalesce(r.red_tipo::text, '')) = '')
        )
      )
    `,
    [id, redTipo]
  );
  return rows[0]?.feature ?? null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} id
 * @param {object} geometry GeoJSON geometry object (LineString)
 * @param {'ftth'|'corporativa'} redTipo
 */
export async function updateRutaGeometry(pool, id, geometry, redTipo) {
  const geomJson = JSON.stringify(geometry);
  const { rows } = await pool.query(
    `
    UPDATE rutas
    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)::geometry(LineString, 4326)
    WHERE id = $2
      AND (
          ($3::text = 'corporativa' AND lower(trim(red_tipo::text)) = 'corporativa')
        OR (
          $3::text = 'ftth'
          AND (red_tipo = 'ftth' OR red_tipo IS NULL OR trim(coalesce(red_tipo::text, '')) = '')
        )
      )
    RETURNING id, nombre
    `,
    [geomJson, id, redTipo]
  );
  return rows[0] ?? null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} nombre
 * @param {object} geometry GeoJSON LineString
 * @param {'ftth'|'corporativa'} redTipo
 */
export async function insertRuta(pool, nombre, geometry, redTipo) {
  const geomJson = JSON.stringify(geometry);
  const { rows } = await pool.query(
    `
    INSERT INTO rutas (nombre, geom, red_tipo)
    VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326)::geometry(LineString, 4326), $3)
    RETURNING id, nombre
    `,
    [nombre, geomJson, redTipo]
  );
  return rows[0] ?? null;
}
