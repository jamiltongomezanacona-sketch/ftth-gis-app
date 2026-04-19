-- Tabla de rutas (troncales / tendidos) como LINESTRING WGS84.
-- Ejecutar en la base donde tengas PostGIS (ej. ftth_local).

CREATE TABLE IF NOT EXISTS rutas (
    id     serial PRIMARY KEY,
    nombre text NOT NULL,
    geom   geometry(LineString, 4326)
);

CREATE INDEX IF NOT EXISTS rutas_geom_gix ON rutas USING GIST (geom);

-- Datos de ejemplo (Bogotá, Colombia, WGS84); no duplica filas si ya existen por nombre
INSERT INTO rutas (nombre, geom)
SELECT 'Troncal A', ST_SetSRID(ST_GeomFromText(
    'LINESTRING(-74.090 4.710, -74.083 4.705, -74.076 4.700, -74.068 4.695)'
), 4326)
WHERE NOT EXISTS (SELECT 1 FROM rutas WHERE nombre = 'Troncal A');

INSERT INTO rutas (nombre, geom)
SELECT 'Troncal B', ST_SetSRID(ST_GeomFromText(
    'LINESTRING(-74.088 4.725, -74.078 4.718, -74.068 4.708)'
), 4326)
WHERE NOT EXISTS (SELECT 1 FROM rutas WHERE nombre = 'Troncal B');

-- Si ya tenías "Troncal A/B" con otras coordenadas (p. ej. demo antigua), al volver a ejecutar
-- este script se actualizan las geometrías a Bogotá:
UPDATE rutas SET geom = ST_SetSRID(ST_GeomFromText(
    'LINESTRING(-74.090 4.710, -74.083 4.705, -74.076 4.700, -74.068 4.695)'
), 4326) WHERE nombre = 'Troncal A';

UPDATE rutas SET geom = ST_SetSRID(ST_GeomFromText(
    'LINESTRING(-74.088 4.725, -74.078 4.718, -74.068 4.708)'
), 4326) WHERE nombre = 'Troncal B';

-- Si re-ejecutas inserts y quieres limpiar demo:
-- TRUNCATE rutas RESTART IDENTITY CASCADE;
-- Luego vuelve a insertar o usa tu propia carga.
