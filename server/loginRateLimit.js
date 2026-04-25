/**
 * Limita intentos de POST /api/auth/login por IP (memoria del proceso).
 * En Vercel cada instancia tiene su propio contador; sigue reduciendo abuso por IP en cada instancia.
 */

const store = new Map();

function windowMs() {
  const n = Number.parseInt(String(process.env.GIS_LOGIN_RATE_WINDOW_MS ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

function maxAttempts() {
  const n = Number.parseInt(String(process.env.GIS_LOGIN_RATE_MAX ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

function prune(now) {
  const ttl = windowMs() * 2;
  for (const [k, v] of store) {
    if (now - v.windowStart > ttl) store.delete(k);
  }
}

let pruneCounter = 0;

/**
 * @param {import('express').Request} req
 */
function clientKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  return ip;
}

/**
 * Middleware Express: responde 429 si se supera el máximo de intentos por ventana.
 */
export function loginRateLimitMiddleware(req, res, next) {
  if (String(process.env.GIS_LOGIN_RATE_DISABLE ?? '').toLowerCase() === '1') {
    next();
    return;
  }

  const now = Date.now();
  const w = windowMs();
  const max = maxAttempts();
  const key = clientKey(req);

  if ((pruneCounter = (pruneCounter + 1) % 200) === 0) {
    prune(now);
  }

  let slot = store.get(key);
  if (!slot || now - slot.windowStart >= w) {
    slot = { count: 0, windowStart: now };
    store.set(key, slot);
  }

  slot.count += 1;
  if (slot.count > max) {
    const retrySec = Math.max(1, Math.ceil((slot.windowStart + w - now) / 1000));
    res.setHeader('Retry-After', String(retrySec));
    res.status(429).json({
      error:
        'Demasiados intentos de inicio de sesión desde esta conexión. Espera unos minutos e inténtalo de nuevo.'
    });
    return;
  }

  next();
}
