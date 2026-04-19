-- Copia desde eventos_import_staging hacia eventos_reporte (app GIS).
-- Normaliza acción al catálogo del API y evita duplicados por UUID legado en descripción.
-- Requiere PostGIS para geom.

INSERT INTO eventos_reporte (
  red_tipo,
  dist_odf,
  tipo_evento,
  estado,
  accion,
  descripcion,
  ruta_id,
  nombre_tendido,
  lng,
  lat,
  geom,
  created_at
)
SELECT
  CASE
    WHEN s.molecula_codigo IS NOT NULL
      AND split_part(s.molecula_codigo, '|', 1) ILIKE 'CORPORATIVO'
    THEN 'corporativa'
    ELSE 'ftth'
  END AS red_tipo,
  s.dist_odf,
  CASE
    WHEN trim(upper(s.tipo_evento)) IN (
      'VANDALISMO',
      'OBRAS CIVILES',
      'DETERIORO',
      'MANTENIMIENTO',
      'DAÑO POR TERCEROS'
    )
    THEN trim(upper(s.tipo_evento))
    ELSE 'MANTENIMIENTO'
  END AS tipo_evento,
  CASE trim(upper(translate(s.estado, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')))
    WHEN 'CRITICO' THEN 'CRITICO'
    WHEN 'RESUELTO' THEN 'RESUELTO'
    WHEN 'EN PROCESO' THEN 'EN PROCESO'
    WHEN 'PENDIENTE' THEN 'PENDIENTE'
    WHEN 'ESCALADO' THEN 'ESCALADO'
    ELSE 'PENDIENTE'
  END AS estado,
  CASE
    WHEN trim(s.accion) IN ('REEMPLAZO DE FIBRA', 'SE INSTALA CIERRE') THEN trim(s.accion)
    WHEN trim(s.accion) IN (
      'INTERVENCIÓN TECNICA',
      'INTERVENCION TECNICA',
      'REPARACIÓN TEMPORAL',
      'AJUSTE DE HILOS'
    )
    THEN 'INTERVENCIÓN TECNICA'
    WHEN trim(s.accion) LIKE 'INTERVENCI%'
    THEN 'INTERVENCIÓN TECNICA'
    ELSE 'INTERVENCIÓN TECNICA'
  END AS accion,
  left(
    coalesce(s.descripcion, '') || ' [legacy:' || s.id::text || ']',
    8000
  ) AS descripcion,
  NULL::integer AS ruta_id,
  nullif(trim(s.molecula_codigo), '') AS nombre_tendido,
  s.lng,
  s.lat,
  CASE
    WHEN s.lng IS NOT NULL
      AND s.lat IS NOT NULL
      AND s.lng BETWEEN -180 AND 180
      AND s.lat BETWEEN -90 AND 90
    THEN ST_SetSRID(ST_MakePoint(s.lng::double precision, s.lat::double precision), 4326)
    ELSE NULL
  END AS geom,
  coalesce(s.fecha, s.created_at, now()) AS created_at
FROM eventos_import_staging s
WHERE
  s.lng IS NOT NULL
  AND s.lat IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM eventos_reporte er
    WHERE er.descripcion LIKE '%[legacy:' || s.id::text || ']%'
  );
