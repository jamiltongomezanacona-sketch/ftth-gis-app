/**
 * Encaja un LineString a la red vial de Mapbox (Map Matching API).
 * Útil como boceto sobre calzada; los tendidos reales pueden ir por canalización o aéreo.
 *
 * @see https://docs.mapbox.com/api/navigation/map-matching/
 */

const DEFAULT_MAX_WAYPOINTS = 90;
const MAX_MAPBOX_WAYPOINTS = 100;

/**
 * @param {[number, number][]} coords
 * @param {number} maxPts
 * @returns {[number, number][]}
 */
function downsampleCoords(coords, maxPts) {
  const n = coords.length;
  if (n <= 1 || maxPts < 2) return coords.slice();
  if (n <= maxPts) return coords.slice();

  const out = [];
  const span = maxPts - 1;
  for (let i = 0; i < maxPts; i++) {
    const idx = Math.round((i / span) * (n - 1));
    out.push(coords[idx]);
  }
  /** @type {[number, number][]} */
  const deduped = [];
  for (const c of out) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
    deduped.push([c[0], c[1]]);
  }
  if (deduped.length < 2) {
    return [coords[0], coords[n - 1]];
  }
  return deduped;
}

/**
 * @param {GeoJSON.LineString} line
 * @param {string} accessToken
 * @param {{
 *   profile?: string,
 *   maxWaypoints?: number,
 *   radiusMeters?: number,
 * }} [opts]
 * @returns {Promise<GeoJSON.LineString>}
 */
export async function matchLineStringToMapboxStreets(line, accessToken, opts = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw new Error('Falta MAPBOX_ACCESS_TOKEN para usar Map Matching.');
  }

  const raw = line?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error('Se necesita un tendido con al menos 2 vértices.');
  }

  /** @type {[number, number][]} */
  const coords = [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    coords.push([lng, lat]);
  }
  if (coords.length < 2) {
    throw new Error('Coordenadas del tendido no válidas.');
  }

  const maxWaypoints = Math.min(
    Math.max(2, Number(opts.maxWaypoints) || DEFAULT_MAX_WAYPOINTS),
    MAX_MAPBOX_WAYPOINTS
  );
  const sampled = downsampleCoords(coords, maxWaypoints);
  const profile = opts.profile || 'mapbox/driving';
  const radiusMeters = Math.max(5, Math.min(50, Number(opts.radiusMeters) || 32));

  const pathSegment = sampled.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const params = new URLSearchParams({
    access_token: token,
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
    radiuses: sampled.map(() => String(radiusMeters)).join(';')
  });

  const url = `https://api.mapbox.com/matching/v5/${profile}/${pathSegment}.json?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : await res.text().catch(() => '');
    throw new Error(
      msg?.trim()
        ? `Map Matching (${res.status}): ${msg.trim().slice(0, 220)}`
        : `Map Matching respondió ${res.status}.`
    );
  }

  const m = data.matchings?.[0];
  const matched = m?.geometry;
  if (!matched || matched.type !== 'LineString' || !Array.isArray(matched.coordinates)) {
    const hint =
      data?.message ||
      'No hubo encaje a vía. Acerca los vértices a calles conocidas o prueba otro trazado.';
    throw new Error(String(hint));
  }

  return /** @type {GeoJSON.LineString} */ ({
    type: 'LineString',
    coordinates: matched.coordinates
  });
}
