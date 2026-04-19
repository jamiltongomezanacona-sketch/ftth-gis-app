/**
 * GeoJSON FeatureCollection para centrales ETB (PostGIS Point, 4326).
 */

/**
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} [redTipo]
 */
export async function fetchCentralesEtBAsFeatureCollection(pool, redTipo = 'ftth') {
  try {
    return await fetchCentralesEtBAsFeatureCollectionQuery(pool, redTipo);
  } catch (e) {
    /** Tabla aún no creada (ejecutar sql/02_centrales_etb.sql en pgAdmin). */
    if (e.code === '42P01') {
      return { type: 'FeatureCollection', features: [] };
    }
    /** Columna `red_tipo` ausente: ejecutar sql/03_red_independientes.sql */
    if (e.code === '42703') {
      return { type: 'FeatureCollection', features: [] };
    }
    throw e;
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {'ftth'|'corporativa'} redTipo
 */
async function fetchCentralesEtBAsFeatureCollectionQuery(pool, redTipo) {
  const { rows } = await pool.query(
    `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'type', 'Feature',
              'id', c.id,
              'geometry', ST_AsGeoJSON(c.geom)::json,
              'properties', json_build_object(
                'nombre', c.nombre,
                'tipo', 'central_etb',
                'red_tipo', COALESCE(NULLIF(trim(c.red_tipo::text), ''), 'ftth')
              )
            )
            ORDER BY c.nombre
          )
          FROM centrales_etb c
          WHERE c.geom IS NOT NULL
            AND (
              ($1::text = 'corporativa' AND lower(trim(c.red_tipo::text)) = 'corporativa')
              OR (
                $1::text = 'ftth'
                AND (
                  c.red_tipo = 'ftth'
                  OR c.red_tipo IS NULL
                  OR trim(coalesce(c.red_tipo::text, '')) = ''
                )
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

