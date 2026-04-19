-- Dos redes independientes: FTTH y corporativa.
-- Ejecutar en la misma base que `rutas` y `centrales_etb` (ej. ftth_local).
-- Las filas existentes quedan como red `ftth`.

ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS red_tipo text NOT NULL DEFAULT 'ftth';

ALTER TABLE centrales_etb
  ADD COLUMN IF NOT EXISTS red_tipo text NOT NULL DEFAULT 'ftth';

UPDATE rutas SET red_tipo = 'ftth' WHERE red_tipo IS NULL OR red_tipo = '';
UPDATE centrales_etb SET red_tipo = 'ftth' WHERE red_tipo IS NULL OR red_tipo = '';

ALTER TABLE rutas DROP CONSTRAINT IF EXISTS rutas_red_tipo_chk;
ALTER TABLE rutas ADD CONSTRAINT rutas_red_tipo_chk
  CHECK (red_tipo IN ('ftth', 'corporativa'));

ALTER TABLE centrales_etb DROP CONSTRAINT IF EXISTS centrales_etb_red_tipo_chk;
ALTER TABLE centrales_etb ADD CONSTRAINT centrales_etb_red_tipo_chk
  CHECK (red_tipo IN ('ftth', 'corporativa'));

DROP INDEX IF EXISTS centrales_etb_nombre_key;
CREATE UNIQUE INDEX IF NOT EXISTS centrales_etb_nombre_red_key
  ON centrales_etb (nombre, red_tipo);

CREATE INDEX IF NOT EXISTS rutas_red_tipo_idx ON rutas (red_tipo);
CREATE INDEX IF NOT EXISTS centrales_etb_red_tipo_idx ON centrales_etb (red_tipo);
