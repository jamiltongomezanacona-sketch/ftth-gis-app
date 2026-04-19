/**
 * Opciones de `pg.Pool` para URLs Postgres.
 * Supabase (pooler `*.supabase.com` o directo `*.supabase.co`): sin `connectionString`
 * y `ssl.rejectUnauthorized: false` para evitar SELF_SIGNED_CERT_IN_CHAIN en Windows/Node.
 */
import { URL } from 'node:url';

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isSupabasePostgresHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  return h.endsWith('.supabase.com') || h.endsWith('.supabase.co');
}

/**
 * @param {string} connectionString
 * @param {number} [max]
 * @returns {import('pg').PoolConfig}
 */
export function poolConfig(connectionString, max = 3) {
  const raw = String(connectionString);
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { connectionString: raw, max };
  }
  if (!isSupabasePostgresHost(u.hostname)) {
    return { connectionString: raw, max };
  }
  const port = u.port ? Number(u.port) : 5432;
  const database = (u.pathname || '/postgres').replace(/^\//, '') || 'postgres';
  let user = u.username ? decodeURIComponent(u.username) : 'postgres';
  let password = u.password != null ? decodeURIComponent(u.password) : '';
  return {
    host: u.hostname,
    port,
    user,
    password,
    database,
    max,
    ssl: { rejectUnauthorized: false }
  };
}
