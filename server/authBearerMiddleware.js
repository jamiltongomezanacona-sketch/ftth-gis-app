import { verifySessionJwt } from './authJwt.js';
import { readSessionTokenFromCookie } from './authCookie.js';

/**
 * Exige sesión válida: cabecera `Authorization: Bearer`, `X-GIS-Token`, o cookie httpOnly `gis_session`.
 * Asigna `req.authUser = { email }` si es válido.
 */
export function requireBearerAuth(req, res, next) {
  let token = '';
  const auth = String(req.headers.authorization ?? '');
  if (/^Bearer\s+/i.test(auth)) {
    token = auth.replace(/^Bearer\s+/i, '').trim();
  } else if (req.headers['x-gis-token']) {
    token = String(req.headers['x-gis-token']).trim();
  } else {
    token = readSessionTokenFromCookie(req);
  }
  if (!token) {
    res.status(401).json({
      error: 'Autenticación requerida. Inicia sesión en el visor e inténtalo de nuevo.'
    });
    return;
  }
  let user;
  try {
    user = verifySessionJwt(token);
  } catch (e) {
    console.error('[auth]', e?.message || e);
    res.status(503).json({
      error: 'Servidor mal configurado para sesiones (revisa GIS_SESSION_SECRET en el entorno).'
    });
    return;
  }
  if (!user) {
    res.status(401).json({ error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.' });
    return;
  }
  req.authUser = user;
  next();
}
