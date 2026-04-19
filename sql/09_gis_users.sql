-- Usuarios del login del visor GIS (varios correos / contraseñas distintas).
-- Contraseña guardada como hash (scrypt); no guardar texto plano.
-- Ejecutar en la misma base que usa la app (local o Supabase).
-- El email se guarda en minúsculas (único).

CREATE TABLE IF NOT EXISTS gis_users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE gis_users IS 'Login GIS: email + hash scrypt; alta con npm run user:add';
