import pg from 'pg';
import { URL } from 'node:url';

const { Pool } = pg;

/**
 * `node-pg` exige que `password` sea siempre string (SCRAM).
 * Si falta o viene raro desde `.env` / URL, sin esto aparece:
 * "client password must be a string".
 */
function str(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/**
 * Hosts Supabase (pooler `*.supabase.com` o `*.supabase.co`).
 * Misma lógica que `scripts/pg-pool-config.mjs` para TLS en Node sin cadena de confianza corporativa.
 * @param {string} hostname
 */
function isSupabasePostgresHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  return h.endsWith('.supabase.com') || h.endsWith('.supabase.co');
}

/**
 * Pool de conexiones PostgreSQL (variables estándar o DATABASE_URL).
 */
export function createPool() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    try {
      const u = new URL(connectionString);
      let user = u.username || 'postgres';
      try {
        user = decodeURIComponent(user);
      } catch {
        /* usuario sin % */
      }
      let password = u.password != null ? u.password : '';
      try {
        password = decodeURIComponent(password);
      } catch {
        /* contraseña sin % */
      }
      const host = u.hostname || '127.0.0.1';
      const port = Number(u.port || 5432);
      const database = str(u.pathname.replace(/^\//, ''), 'postgres');
      /** @type {import('pg').PoolConfig} */
      const cfg = {
        host,
        port,
        database,
        user,
        password: str(password),
        max: 10,
        idleTimeoutMillis: 30_000
      };
      if (isSupabasePostgresHost(host)) {
        cfg.ssl = { rejectUnauthorized: false };
      }
      return new Pool(cfg);
    } catch {
      return new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30_000
      });
    }
  }
  return new Pool({
    host: str(process.env.PGHOST, '127.0.0.1'),
    port: Number(process.env.PGPORT ?? 5432),
    database: str(process.env.PGDATABASE, 'ftth_local'),
    user: str(process.env.PGUSER, 'postgres'),
    password: str(process.env.PGPASSWORD, ''),
    max: 10,
    idleTimeoutMillis: 30_000
  });
}
