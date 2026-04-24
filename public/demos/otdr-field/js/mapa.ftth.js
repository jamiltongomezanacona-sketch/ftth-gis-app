/**
 * mapa.ftth.js — integración Leaflet: marcador de falla, tramo resaltado, popups, zoom.
 * Requiere: Leaflet en `window.L` (cargar hoja de estilos y script antes de importar o usar en bundle).
 *
 * Uso offline: coloca `leaflet.css` y `leaflet.js` en /vendor y enlázalos sin CDN.
 *
 * @module mapa.ftth
 */

/**
 * Crea o devuelve el mapa Leaflet en un contenedor.
 * @param {string|HTMLElement} containerId
 * @param {object} [view]
 * @param {[number, number]} [view.center] [lat, lng] convención Leaflet
 * @param {number} [view.zoom]
 * @returns {L.Map}
 */
export function crearMapaFtth(containerId, view = {}) {
  const L = getLeaflet();
  const el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!el) throw new Error('Contenedor de mapa no encontrado');
  const center = view.center ?? [4.65, -74.05];
  const zoom = view.zoom ?? 15;
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  // OSM: requiere red. Offline: reemplaza por L.tileLayer('/data/mtiles/...', { tms: true ... }) o mapa en blanco + GeoJSON
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);
  map.setView(center, zoom);
  return map;
}

/**
 * Muestra el evento (falla) en el mapa: marcador, popup, línea de tramo opcional, zoom.
 *
 * @param {L.Map} map
 * @param {object} data
 * @param {[number, number]} data.punto [lng, lat] WGS84
 * @param {string} [data.nombreCable]
 * @param {string} [data.textoDetalle] HTML seguro: escapar en caller si es input de usuario
 * @param {number} [data.distanciaKm] solo lectura para popup
 * @param {number} [data.distanciaM] en metros
 * @param {GeoJSON.Feature<GeoJSON.LineString> | null} [data.tramoResaltado] tramo recorrido hasta la falla
 * @param {object} [opts]
 * @param {() => L.Layer} [opts.iconoFactory] icono rojo de evento
 * @returns {{ marker: L.Marker, linea: L.Polyline | null, capa: L.FeatureGroup }}
 */
export function mostrarEventoEnMapa(map, data, opts = {}) {
  const L = getLeaflet();
  const g = L.featureGroup().addTo(map);
  const [lng, lat] = data.punto;
  const icon =
    typeof opts.iconoFactory === 'function'
      ? opts.iconoFactory()
      : L.divIcon({
          className: 'ftth-otdr-marker',
          html: '<div class="ftth-otdr-marker__dot"></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
  const marker = L.marker([lat, lng], { title: 'Falla OTDR', icon }).addTo(g);
  const distTxt =
    data.distanciaM != null
      ? `${(data.distanciaM / 1000).toFixed(3)} km (${Math.round(data.distanciaM)} m)`
      : data.distanciaKm != null
        ? `${Number(data.distanciaKm).toFixed(3)} km`
        : '—';
  const safeNombre = String(data.nombreCable ?? 'Cable');
  const coordsTxt = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const cuerpo = `
    <div class="ftth-otdr-popup">
      <strong>Localización falla (OTDR)</strong><br/>
      Tendido: <strong>${escapeHtml(safeNombre)}</strong><br/>
      Distancia: <strong>${escapeHtml(String(distTxt))}</strong><br/>
      WGS84: <code>${escapeHtml(coordsTxt)}</code>
      ${data.textoDetalle ? `<p class="ftth-otdr-popup__more">${data.textoDetalle}</p>` : ''}
    </div>
  `;
  marker.bindPopup(cuerpo, { minWidth: 200 });
  let linea = null;
  if (data.tramoResaltado?.geometry?.type === 'LineString' && data.tramoResaltado.geometry.coordinates?.length) {
    const ll = data.tramoResaltado.geometry.coordinates.map((c) => [c[1], c[0]]);
    linea = L.polyline(ll, { color: '#ef4444', weight: 5, opacity: 0.9 }).addTo(g);
  }
  g.bringToFront();
  try {
    if (linea) map.fitBounds(linea.getBounds().pad(0.15), { maxZoom: 18 });
    else map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true });
  } catch {
    map.panTo([lat, lng]);
  }
  marker.openPopup();
  return { marker, linea, capa: g };
}

/**
 * Limpia capa devuelta por `mostrarEventoEnMapa` (nueva búsqueda).
 * @param {L.Map} map
 * @param {L.FeatureGroup} capa
 */
export function quitarEventoDeMapa(map, capa) {
  if (capa && map.hasLayer(capa)) map.removeLayer(capa);
}

function getLeaflet() {
  const L = typeof globalThis !== 'undefined' && globalThis.L;
  if (!L) throw new Error('Leaflet (L) no está cargado. Añade leaflet.js antes de mapa.ftth.js');
  return L;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
