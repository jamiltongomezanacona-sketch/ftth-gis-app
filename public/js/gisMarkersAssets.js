/**
 * Iconos raster del set «proyecto gis / IMAGES» (chinchetas por color, forma y letras/números).
 * Archivos servidos desde `/icons/gis-markers/`. Listado: `public/icons/gis-markers/manifest.json`.
 */

export const GIS_MARKERS_BASE = '/icons/gis-markers/';

/** @param {string} filename p. ej. `red-circle.png`, `A-lv.png` */
export function gisMarkerUrl(filename) {
  if (!/^[a-zA-Z0-9._-]+\.png$/.test(filename)) {
    throw new Error(`gisMarkerUrl: nombre no válido (${filename})`);
  }
  return `${GIS_MARKERS_BASE}${filename}`;
}

/**
 * @returns {Promise<string[]>} nombres `*.png` (sin ruta) según manifest en servidor.
 */
export async function listGisMarkerFiles() {
  const res = await fetch(`${GIS_MARKERS_BASE}manifest.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`manifest gis-markers: ${res.status}`);
  const data = await res.json();
  const files = data?.files;
  return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && f.endsWith('.png')) : [];
}
