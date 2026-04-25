/**
 * Cookie de sesión JWT (httpOnly). El front no lee el token; solo envía la cookie con `credentials: 'include'`.
 */
export const GIS_SESSION_COOKIE = 'gis_session';

function cookieSecure(req) {
  if (String(process.env.GIS_SESSION_COOKIE_INSECURE ?? '').toLowerCase() === '1') {
    return false;
  }
  return Boolean(req.secure) || process.env.VERCEL === '1';
}

/** Opciones comunes para `res.cookie` / `res.clearCookie` (sin maxAge). */
export function sessionCookieBaseOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure(req)
  };
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} jwtToken
 */
export function attachSessionCookie(req, res, jwtToken) {
  res.cookie(GIS_SESSION_COOKIE, jwtToken, {
    ...sessionCookieBaseOptions(req),
    maxAge: MAX_AGE_MS
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function clearSessionCookie(req, res) {
  res.clearCookie(GIS_SESSION_COOKIE, sessionCookieBaseOptions(req));
}

/**
 * @param {import('express').Request} req
 * @returns {string} valor crudo del JWT o cadena vacía
 */
export function readSessionTokenFromCookie(req) {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') return '';
  const parts = raw.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== GIS_SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}
