-- Reportes de evento / incidencias desde el editor GIS (sidebar REPORTE EVENTO).
-- Ejecutar después de tener PostGIS y la app Node apuntando a esta base.

CREATE TABLE IF NOT EXISTS eventos_reporte (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  red_tipo text NOT NULL CHECK (red_tipo IN ('ftth', 'corporativa')),
  dist_odf double precision NULL,
  tipo_evento text NOT NULL,
  estado text NOT NULL,
  accion text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  ruta_id integer NULL REFERENCES rutas (id) ON DELETE SET NULL,
  nombre_tendido text NULL,
  lng double precision NULL,
  lat double precision NULL,
  geom geometry(Point, 4326) NULL
);

CREATE INDEX IF NOT EXISTS eventos_reporte_created_idx ON eventos_reporte (created_at DESC);
CREATE INDEX IF NOT EXISTS eventos_reporte_red_idx ON eventos_reporte (red_tipo);
CREATE INDEX IF NOT EXISTS eventos_reporte_geom_gix
  ON eventos_reporte USING GIST (geom)
  WHERE geom IS NOT NULL;

COMMENT ON TABLE eventos_reporte IS 'Incidencias registradas desde el editor (TRAZAR / tendido); opcional enlace a ruta.';
