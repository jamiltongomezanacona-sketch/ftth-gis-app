-- Cierres por molécula (PostgreSQL + PostGIS).
-- Orden sugerido:
--   1) Este archivo (tabla + índices)
--   2) psql -f sql/cierres_datos.sql   (INSERT desde export)
--   3) psql -f sql/05_cierres_geom.sql  (rellenar geom desde lat/lng)

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cierres (
  id uuid PRIMARY KEY,
  molecula_id uuid,
  nombre text,
  tipo text,
  estado text,
  descripcion text,
  geom geometry(Point, 4326),
  created_at timestamptz,
  molecula_codigo text,
  lat double precision,
  lng double precision,
  usuario_id uuid,
  dist_odf double precision
);

CREATE INDEX IF NOT EXISTS cierres_molecula_codigo_idx
  ON cierres (molecula_codigo);

CREATE INDEX IF NOT EXISTS cierres_geom_gix
  ON cierres USING GIST (geom)
  WHERE geom IS NOT NULL;

COMMENT ON TABLE cierres IS 'Cierres FTTH por molécula; molecula_codigo formato CENTRAL|MOL (ej. SANTA_INES|SI26).';
