import crypto from 'node:crypto';

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash para almacenar en `gis_users.password_hash`.
 * @param {string} plain
 */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(plain), salt, 64, SCRYPT_OPTS);
  return `v1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * @param {string} plain
 * @param {string} stored
 */
export function verifyPassword(plain, stored) {
  const m = /^v1\$([0-9a-f]+)\$([0-9a-f]+)$/i.exec(String(stored ?? ''));
  if (!m) return false;
  const salt = Buffer.from(m[1], 'hex');
  const expected = Buffer.from(m[2], 'hex');
  let derived;
  try {
    derived = crypto.scryptSync(String(plain), salt, 64, SCRYPT_OPTS);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}
