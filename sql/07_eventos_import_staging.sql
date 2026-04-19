-- Tabla temporal para importar filas del sistema legado (`eventos` / dump SQL).
-- No forma parte del modelo en producción: solo staging antes de `eventos_reporte`.
-- Ver: npm run db:seed-eventos-legacy

CREATE TABLE IF NOT EXISTS eventos_import_staging (
  id uuid PRIMARY KEY,
  molecula_id uuid NULL,
  tipo text NULL,
  prioridad text NULL,
  estado text NOT NULL,
  descripcion text NULL,
  geom geometry(Point, 4326) NULL,
  created_at timestamptz NULL,
  molecula_codigo text NULL,
  lat double precision NULL,
  lng double precision NULL,
  usuario_id uuid NULL,
  tipo_evento text NOT NULL,
  accion text NOT NULL,
  codigo_cierre text NULL,
  fecha timestamptz NULL,
  central_codigo text NULL,
  molecula_num text NULL,
  sub_molecula text NULL,
  dist_odf double precision NULL
);

COMMENT ON TABLE eventos_import_staging IS 'Staging: datos del dump eventos_rows.sql antes de migrar a eventos_reporte.';
