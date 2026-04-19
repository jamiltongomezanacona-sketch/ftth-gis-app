/**
 * Alta de usuario GIS en PostgreSQL (`gis_users`).
 * Ejecutar sql/09_gis_users.sql antes en esa base.
 *
 *   DATABASE_URL=... node scripts/add-gis-user.mjs correo@dominio.com "ContraseñaSegura"
 *
 * PowerShell (Supabase sin tocar .env local):
 *   $env:TARGET_DATABASE_URL = "postgresql://postgres.REF:CLAVE@....pooler.supabase.com:5432/postgres?sslmode=require"
 *   npm run user:add -- usuario@mail.com "TuClave"
 *
 * También válido: solo DATABASE_URL (ej. desde .env).
 */
import 'dotenv/config';
import pg from 'pg';
import { hashPassword } from '../server/authPassword.js';
import { poolConfig } from './pg-pool-config.mjs';

const { Pool } = pg;

const url =
  process.env.TARGET_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const emailArg = process.argv[2]?.trim();
const passArg = process.argv[3];

if (!url) {
  console.error('Falta TARGET_DATABASE_URL o DATABASE_URL en el entorno (.env o PowerShell).');
  process.exit(1);
}
if (!emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
  console.error('Uso: node scripts/add-gis-user.mjs correo@dominio.com "contraseña"');
  process.exit(1);
}
if (!passArg || String(passArg).length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const pool = new Pool(poolConfig(url, 2));

async function main() {
  const hash = hashPassword(passArg);
  const email = emailArg.toLowerCase().trim();
  await pool.query(
    `
    INSERT INTO gis_users (email, password_hash)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `,
    [email, hash]
  );
  console.log('[user:add] OK:', email);
  await pool.end();
}

main().catch((e) => {
  if (e.code === '42P01') {
    console.error('[user:add] La tabla gis_users no existe. Ejecuta sql/09_gis_users.sql en esta base.');
  } else {
    console.error(e.message || e);
  }
  process.exit(1);
});
