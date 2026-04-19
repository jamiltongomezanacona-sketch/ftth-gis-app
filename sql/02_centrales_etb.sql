-- Centrales ETB (puntos WGS84). Ejecutar en la misma base que `rutas` (ej. ftth_local).

CREATE TABLE IF NOT EXISTS centrales_etb (
    id       serial PRIMARY KEY,
    nombre   text NOT NULL,
    props    jsonb NOT NULL DEFAULT '{}'::jsonb,
    geom     geometry(Point, 4326)
);

CREATE INDEX IF NOT EXISTS centrales_etb_geom_gix ON centrales_etb USING GIST (geom);
CREATE UNIQUE INDEX IF NOT EXISTS centrales_etb_nombre_key ON centrales_etb (nombre);
