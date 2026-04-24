/**
 * tool.trazar.js — flujo de campo: distancia OTDR (km) → "Ubicar falla" → cálculo + mapa + sugerencia de elemento.
 * Depende de: ./utils.geo.js, ./mapa.ftth.js, Turf global, Leaflet (L) global, cable y elementos en GeoJSON.
 *
 * Uso: import { montarHerramientaTrazarOtdr } from './tool.trazar.js'
 *
 * @module tool.trazar
 */
import { calcularPuntoPorDistancia, tramoHastaDistancia, buscarElementoCercano } from './utils.geo.js';
import { crearMapaFtth, mostrarEventoEnMapa, quitarEventoDeMapa } from './mapa.ftth.js';

/**
 * Inyecta UI compacta (1 pantalla) y conecta al mapa Leaflet.
 * @param {object} o
 * @param {string|HTMLElement} o.mapContainerId id del div del mapa, ej. "map"
 * @param {string|HTMLElement} [o.panelId] contenedor de formulario; si no existe, se inserta un panel fijo
 * @param {GeoJSON.Feature<GeoJSON.LineString>} o.cable Tendido actual (p.ej. BA01FH144)
 * @param {string} o.nombreCable
 * @param {GeoJSON.FeatureCollection} o.elementosCercanos Cierres E1/E2 y NAPs (puntos)
 * @param {import('@turf/turf').Turf} o.turf
 */
export function montarHerramientaTrazarOtdr(o) {
  const turf = o.turf;
  if (!turf) throw new Error('Se requiere turf (window.turf o import)');

  const L = globalThis.L;
  const lineCenter = o.cable?.geometry?.coordinates?.[0];
  const center = Array.isArray(lineCenter) && lineCenter.length >= 2 ? [lineCenter[1], lineCenter[0]] : [4.65, -74.05];
  const map = crearMapaFtth(o.mapContainerId, { center, zoom: 14 });
  /** @type {any} */
  let capaEvento = null;
  if (o.cable?.geometry?.type === 'LineString' && L?.geoJSON) {
    L.geoJSON(o.cable, { style: { color: '#2563eb', weight: 4 } }).addTo(map);
    try {
      const b = L.geoJSON(o.cable).getBounds();
      map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
    } catch {
      /* */
    }
  }

  const panel = ensurePanel(o.panelId);
  panel.innerHTML = buildPanelHtml();
  const btn = /** @type {HTMLButtonElement} */ (panel.querySelector('#trazar-btn-ubicar'));
  const input = /** @type {HTMLInputElement} */ (panel.querySelector('#trazar-input-km'));
  const msg = panel.querySelector('#trazar-msg');

  btn.addEventListener('click', () => onUbicar());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onUbicar();
  });

  function onUbicar() {
    const raw = String(input.value).replace(',', '.').trim();
    const km = Number.parseFloat(raw);
    if (!Number.isFinite(km) || km < 0) {
      showMsg('Indica una distancia en km (ej. 1.35)', true);
      return;
    }
    const m = km * 1000;
    const r = calcularPuntoPorDistancia(o.cable, m, turf);
    if (!r.ok) {
      showMsg(r.error, true);
      return;
    }
    const c = r.point.geometry.coordinates;
    const tramo = tramoHastaDistancia(o.cable, r.distanceFromStartM, turf);
    const cerca = buscarElementoCercano(
      r.point,
      o.elementosCercanos,
      { turf, umbralMetros: 20 }
    );
    const detalleHtml = `<span>${cerca.etiqueta}</span>`;
    if (capaEvento) quitarEventoDeMapa(map, capaEvento);
    const { capa } = mostrarEventoEnMapa(
      map,
      {
        punto: /** @type {[number, number]} */ ([c[0], c[1]]),
        nombreCable: o.nombreCable,
        distanciaM: m,
        textoDetalle: detalleHtml,
        tramoResaltado: tramo
      },
      {}
    );
    capaEvento = capa;
    let t = cerca.hayCercano
      ? 'Cerca de un elemento: revisa el popup.'
      : 'Sin elemento < 20 m: revisa cajas a lo largo del trazado.';
    if (r.clamped) t += ' (distancia ajustada al final del trazado dibujado)';
    showMsg(t, false);
  }

  function showMsg(text, err) {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = err ? '#b91c1c' : '#0f172a';
  }
}

/**
 * @param {string|HTMLElement|undefined} panelId
 */
function ensurePanel(panelId) {
  if (panelId) {
    const p = typeof panelId === 'string' ? document.getElementById(panelId) : panelId;
    if (p) return p;
  }
  const f = document.createElement('div');
  f.id = 'trazar-otdr-panel-fallback';
  f.setAttribute('class', 'trazar-otdr-panel');
  document.body.appendChild(f);
  return f;
}

function buildPanelHtml() {
  return `
  <div class="trazar-otdr">
    <label class="trazar-otdr__lab" for="trazar-input-km">Distancia detectada (OTDR) — km</label>
    <div class="trazar-otdr__row">
      <input
        type="text"
        inputmode="decimal"
        id="trazar-input-km"
        class="trazar-otdr__input"
        placeholder="1,35 o 1.35"
        autocomplete="off"
      />
      <button type="button" class="trazar-otdr__btn" id="trazar-btn-ubicar">Ubicar falla</button>
    </div>
    <p class="trazar-otdr__msg" id="trazar-msg" role="status"></p>
  </div>
  `;
}
