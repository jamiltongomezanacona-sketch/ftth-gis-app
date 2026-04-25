import crypto from 'node:crypto';

/** Misma ventana que `public/js/authSession.js` (24 h). */
const DEFAULT_TTL_SEC = 24 * 60 * 60;

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

/**
 * Secreto HMAC para firmar sesiones. En producción es obligatorio.
 * En local, si falta, se usa un valor por defecto (solo desarrollo).
 */
export function getSessionSecret() {
  const s = String(process.env.GIS_SESSION_SECRET ?? '').trim();
  if (s.length >= 16) return s;
  if (isProductionLike()) {
    throw new Error(
      'GIS_SESSION_SECRET debe estar definido en el entorno (mínimo 16 caracteres). Sin él no se pueden firmar sesiones.'
    );
  }
  return 'local-dev-only-gis-session-secret-min32chars!!';
}

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecodeToString(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}

/**
 * @param {string} email correo normalizado (minúsculas recomendado)
 * @param {number} [ttlSec]
 * @returns {string} JWT compacto (HS256)
 */
export function signSessionJwt(email, ttlSec = DEFAULT_TTL_SEC) {
  const secret = getSessionSecret();
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlJson({ sub: String(email), iat: now, exp: now + ttlSec });
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ email: string } | null}
 */
export function verifySessionJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    if (!h || !p || !sig) return null;
    const secret = getSessionSecret();
    const data = `${h}.${p}`;
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const sigBuf = Buffer.from(String(sig), 'utf8');
    const expBuf = Buffer.from(String(expected), 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payloadObj = JSON.parse(b64urlDecodeToString(p));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payloadObj.exp !== 'number' || payloadObj.exp < now) return null;
    const email = payloadObj.sub;
    if (typeof email !== 'string' || !email.trim()) return null;
    return { email: email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
