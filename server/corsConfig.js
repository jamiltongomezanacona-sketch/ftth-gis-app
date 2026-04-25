import cors from 'cors';

const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Red-Tipo', 'X-GIS-Token'];

/** Vercel o NODE_ENV=production (para CORS, db-check, etc.). */
export function isProductionDeployment() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function parseAllowedOrigins() {
  return String(process.env.GIS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CORS: en producción/Vercel, si defines `GIS_ALLOWED_ORIGINS` (coma-separado),
 * solo esos orígenes reciben `Access-Control-Allow-Origin`. Sin variable → mismo
 * comportamiento que antes (`origin: true`). En desarrollo local → `origin: true`.
 */
export function createCorsMiddleware() {
  const origins = parseAllowedOrigins();
  const prod = isProductionDeployment();

  if (prod && origins.length > 0) {
    const set = new Set(origins);
    console.log(`[cors] Lista blanca activa (${set.size} origen(es)).`);
    return cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, set.has(origin));
      },
      allowedHeaders: ALLOWED_HEADERS,
      credentials: true
    });
  }

  if (prod && origins.length === 0) {
    console.warn(
      '[cors] Producción sin GIS_ALLOWED_ORIGINS: cualquier origen puede llamar al API desde el navegador. Define GIS_ALLOWED_ORIGINS=https://tu-app.vercel.app (coma si hay varios).'
    );
  }

  return cors({
    origin: true,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: true
  });
}
