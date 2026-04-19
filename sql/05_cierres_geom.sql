-- Rellena geometría WGS84 desde columnas lat/lng cuando geom vino NULL en el volcado.

UPDATE cierres
SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE geom IS NULL
  AND lat IS NOT NULL
  AND lng IS NOT NULL;

ANALYZE cierres;
