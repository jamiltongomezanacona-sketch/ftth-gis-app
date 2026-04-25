/**
 * Cabeceras ligeras sin CSP (Mapbox y scripts del front ya definen su propio modelo).
 */
export function securityHeadersMiddleware(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
  next();
}
