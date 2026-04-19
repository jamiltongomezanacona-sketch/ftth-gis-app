/**
 * Local: copia como `config.local.js` y rellena el token (no versionar en git).
 * Vercel: define MAPBOX_ACCESS_TOKEN; el build rellena `config.deploy.js`.
 */
export const MAPBOX_ACCESS_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN';

/**
 * Origen del API (ej. http://127.0.0.1:3000). Déjalo vacío si la app se sirve desde el mismo Express.
 * No pongas /api/rutas ni /api al final (p. ej. …:3001/api duplica rutas → 404 en /api/api/…).
 */
export const API_BASE = '';

/**
 * (Opcional) Si el servidor tiene FLASHFIBER_FTTH_DIR en .env, los GeoJSON están en
 * la misma origen bajo `/geojson/ftth/` (p. ej. fetch(`${location.origin}/geojson/ftth/moleculas-manifest.json`)).
 */
export const FLASHFIBER_GEOJSON_BASE = '';
