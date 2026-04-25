import { parseWgs84SearchQuery } from './coordSearchParse.js';
import { searchCentralesFeatures, searchRouteFeatures } from './matchRutas.js';
import {
  FTTH_ICON_CIERRE_E1,
  FTTH_ICON_CIERRE_E2,
  FTTH_ICON_CIERRE_MAPA
} from './ftthCierreIcons.js';
import { effectiveCierreTipo } from './moleculeFlashfiberLoad.js';

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 18;
const MAX_MOLECULE_ROWS = 40;
const MAX_CIERRE_ROWS = 10;
const MAX_CENTRALE_ROWS = 10;

/**
 * Barra de búsqueda de cables sobre el mapa (listbox, teclado, debounce).
 * @param {HTMLElement} mapWrap contenedor del mapa
 * @param {{
 *   getRouteCollection: () => GeoJSON.FeatureCollection,
 *   onSelectRoute: (feature: GeoJSON.Feature, meta?: { searchQuery: string }) => void,
 *   onClearCable: () => void,
 *   isInteractionLocked: () => boolean,
 *   networkRed: 'ftth'|'corporativa',
 *   getCentralesCollection?: () => GeoJSON.FeatureCollection,
 *   onSelectCentral?: (feature: GeoJSON.Feature, meta?: { searchQuery: string }) => void,
 *   getMoleculeBrowseHits?: (query: string) => { central: string, molecula: string, label: string, paths: string[] }[],
 *   onSelectMoleculeBrowse?: (hit: { central: string, molecula: string, label: string, paths: string[] }) => void,
 *   getCierreBrowseHits?: (query: string) => Promise<GeoJSON.Feature[]>,
 *   onSelectCierre?: (feature: GeoJSON.Feature, meta?: { searchQuery: string }) => void,
 *   onSelectCoordinates?: (pos: { lng: number, lat: number }, meta?: { searchQuery: string }) => void,
 * }} opts
 */
export function createCableSearchBar(mapWrap, opts) {
  const perfNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const mount = document.createElement('div');
  mount.className = 'cable-search-mount';
  if (opts.networkRed !== 'ftth' && opts.networkRed !== 'corporativa') {
    throw new Error('createCableSearchBar: opts.networkRed debe ser "ftth" o "corporativa".');
  }
  const redEtiqueta = opts.networkRed === 'corporativa' ? 'red corporativa' : 'red FTTH';

  const netClass = opts.networkRed === 'corporativa' ? 'cable-search--corp' : 'cable-search--ftth';

  const searchTitle = 'Buscador general';
  const searchTitleEsc = searchTitle.replace(/"/g, '&quot;');

  mount.innerHTML = `
    <div class="cable-search-wrap ${netClass}">
      <div class="cable-search-col">
        <div class="cable-search-toolbar">
          <div class="cable-search ${netClass}" role="search" title="${searchTitleEsc}">
            <div class="cable-search-row">
              <input
                id="cable-search-input"
                class="cable-search-input"
                type="text"
                enterkeyhint="search"
                role="searchbox"
                aria-label="${searchTitleEsc}"
                autocomplete="off"
                spellcheck="false"
                placeholder="${searchTitleEsc}"
                aria-autocomplete="list"
                aria-controls="cable-search-listbox"
                aria-expanded="false"
              />
              <button type="button" class="cable-search-clear" id="cable-search-clear" aria-label="Quitar cable del mapa" title="Quitar tendido del mapa" hidden>
                <svg class="cable-search-clear-svg" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        </div>
        <div id="cable-search-listbox" class="cable-search-listbox" role="listbox" hidden></div>
      </div>
    </div>
  `;
  const chromeSlot = typeof document !== 'undefined' ? document.querySelector('.editor-chrome-search-slot') : null;
  if (chromeSlot) {
    chromeSlot.appendChild(mount);
    mount.classList.add('cable-search-mount--chrome');
  } else {
    mapWrap.insertBefore(mount, mapWrap.firstChild);
  }

  const input = /** @type {HTMLInputElement} */ (mount.querySelector('#cable-search-input'));
  const clearBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#cable-search-clear'));
  const listbox = /** @type {HTMLDivElement} */ (mount.querySelector('#cable-search-listbox'));

  const mqCompact =
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)') : { matches: false };

  function syncSearchPlaceholder() {
    input.placeholder = searchTitle;
  }

  syncSearchPlaceholder();
  if (typeof mqCompact.addEventListener === 'function') {
    mqCompact.addEventListener('change', syncSearchPlaceholder);
  } else if (typeof mqCompact.addListener === 'function') {
    mqCompact.addListener(syncSearchPlaceholder);
  }

  let debounceTimer = 0;
  /**
   * @type {(
   *   | { type: 'coords'; lng: number; lat: number; labelDec: string; labelDms: string }
   *   | { type: 'molecule'; hit: { central: string; molecula: string; label: string; paths: string[] } }
   *   | { type: 'cierre'; feature: GeoJSON.Feature }
   *   | { type: 'central'; feature: GeoJSON.Feature }
   *   | { type: 'route'; feature: GeoJSON.Feature }
   * )[]}
   */
  let activeRows = [];
  let activeIndex = -1;
  let cableShown = false;
  let searchSeq = 0;

  function setExpanded(open) {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeList() {
    listbox.hidden = true;
    listbox.innerHTML = '';
    activeRows = [];
    activeIndex = -1;
    setExpanded(false);
  }

  /**
   * @param {{ central: string, molecula: string, label: string, paths: string[] }[]} molHits
   * @param {GeoJSON.Feature[]} cierreHits
   * @param {GeoJSON.Feature[]} centralHits
   * @param {GeoJSON.Feature[]} routeHits
   * @param {ReturnType<typeof parseWgs84SearchQuery>} coordHit
   */
  function renderCombinedList(molHits, cierreHits, centralHits, routeHits, coordHit) {
    const cierreSlice = cierreHits.slice(0, MAX_CIERRE_ROWS);
    const centSlice = centralHits.slice(0, MAX_CENTRALE_ROWS);
    const used =
      molHits.slice(0, MAX_MOLECULE_ROWS).length + cierreSlice.length + centSlice.length + (coordHit ? 1 : 0);
    const maxRoutes = Math.max(0, MAX_RESULTS - used);
    const routes = routeHits.slice(0, maxRoutes);
    activeRows = [
      ...(coordHit
        ? [
            {
              type: /** @type {const} */ ('coords'),
              lng: coordHit.lng,
              lat: coordHit.lat,
              labelDec: coordHit.labelDec,
              labelDms: coordHit.labelDms
            }
          ]
        : []),
      ...molHits.slice(0, MAX_MOLECULE_ROWS).map((hit) => ({ type: /** @type {const} */ ('molecule'), hit })),
      ...cierreSlice.map((feature) => ({ type: /** @type {const} */ ('cierre'), feature })),
      ...centSlice.map((feature) => ({ type: /** @type {const} */ ('central'), feature })),
      ...routes.map((feature) => ({ type: /** @type {const} */ ('route'), feature }))
    ];
    activeIndex = activeRows.length ? 0 : -1;
    listbox.innerHTML = '';
    if (!activeRows.length) {
      listbox.hidden = true;
      setExpanded(false);
      return;
    }
    activeRows.forEach((row, i) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className =
        row.type === 'molecule'
          ? 'cable-search-item cable-search-item-molecule'
          : row.type === 'cierre'
            ? 'cable-search-item cable-search-item-cierre'
            : row.type === 'central'
              ? 'cable-search-item cable-search-item-central'
              : row.type === 'coords'
                ? 'cable-search-item cable-search-item-coords'
                : 'cable-search-item';
      opt.setAttribute('role', 'option');
      opt.setAttribute('id', `cable-search-opt-${i}`);
      opt.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      opt.dataset.index = String(i);
      if (row.type === 'molecule') {
        opt.innerHTML =
          '<span class="cable-search-item-label"></span><span class="cable-search-item-action" aria-hidden="true">VISTA MOLÉCULA</span>';
        const labelEl = opt.querySelector('.cable-search-item-label');
        if (labelEl) labelEl.textContent = row.hit.label;
      } else if (row.type === 'cierre') {
        opt.innerHTML = `<span class="cable-search-item-main cable-search-item-main--cierre"><img class="cable-search-cierre-ico" src="${FTTH_ICON_CIERRE_MAPA}" width="20" height="20" alt="" decoding="async" /><span class="cable-search-item-label"></span></span><span class="cable-search-item-action" aria-hidden="true">VER CIERRE</span>`;
        const f = row.feature;
        const p = f.properties || {};
        const tipoU = effectiveCierreTipo(p);
        let iconSrc = FTTH_ICON_CIERRE_MAPA;
        if (tipoU === 'E1') iconSrc = FTTH_ICON_CIERRE_E1;
        else if (tipoU === 'E2') iconSrc = FTTH_ICON_CIERRE_E2;
        const ico = opt.querySelector('.cable-search-cierre-ico');
        if (ico && ico instanceof HTMLImageElement) {
          ico.src = iconSrc;
          if (tipoU === 'E1' || tipoU === 'E2') {
            ico.width = 16;
            ico.height = 16;
          } else {
            ico.width = 20;
            ico.height = 20;
          }
        }
        const labelEl = opt.querySelector('.cable-search-item-label');
        const mc = String(p.molecula_codigo ?? '').trim();
        const tipoBit = [tipoU || String(p.tipo ?? '').trim(), mc].filter(Boolean).join(' · ');
        if (labelEl) {
          labelEl.textContent = `${String(p.nombre ?? p.name ?? 'Sin nombre')}${tipoBit ? ` · ${tipoBit}` : ''}`;
        }
      } else if (row.type === 'central') {
        const centralAction = opts.networkRed === 'corporativa' ? 'IR A NODO' : 'IR A CENTRAL';
        const centralDefault = opts.networkRed === 'corporativa' ? 'Nodo' : 'Central';
        opt.innerHTML = `<span class="cable-search-item-label"></span><span class="cable-search-item-action" aria-hidden="true">${centralAction}</span>`;
        const f = row.feature;
        const labelEl = opt.querySelector('.cable-search-item-label');
        if (labelEl) {
          labelEl.textContent = String(
            f.properties?.nombre ?? f.properties?.name ?? centralDefault
          ).trim();
        }
      } else if (row.type === 'coords') {
        opt.innerHTML =
          '<span class="cable-search-item-main cable-search-item-main--coords"><span class="cable-search-item-label cable-search-item-label--coords-dec"></span><span class="cable-search-item-id cable-search-item-id--coords-dms" aria-hidden="false"></span></span><span class="cable-search-item-action" aria-hidden="true">CENTRAR MAPA</span>';
        const decEl = opt.querySelector('.cable-search-item-label--coords-dec');
        const dmsEl = opt.querySelector('.cable-search-item-id--coords-dms');
        if (decEl) decEl.textContent = row.labelDec;
        if (dmsEl) dmsEl.textContent = row.labelDms;
      } else {
        opt.innerHTML =
          '<span class="cable-search-item-label"></span><span class="cable-search-item-action" aria-hidden="true">VER TENDIDO</span>';
        const f = row.feature;
        const labelEl = opt.querySelector('.cable-search-item-label');
        if (labelEl) {
          labelEl.textContent = String(f.properties?.nombre ?? 'Sin nombre').trim();
        }
      }
      listbox.appendChild(opt);
    });
    listbox.hidden = false;
    setExpanded(true);
    highlightActive();
  }

  function highlightActive() {
    const items = listbox.querySelectorAll('.cable-search-item');
    items.forEach((el, i) => {
      const on = i === activeIndex;
      el.classList.toggle('cable-search-item-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function pickIndex(i) {
    const row = activeRows[i];
    if (!row) return;
    /** Texto del buscador antes de sustituirlo por el nombre del cable (para detectar código de molécula, ej. SI03). */
    const searchQueryBeforePick = input.value.trim();
    closeList();
    cableShown = true;
    clearBtn.hidden = false;
    if (row.type === 'molecule') {
      input.value = row.hit.molecula;
      opts.onSelectMoleculeBrowse?.(row.hit);
      return;
    }
    if (row.type === 'cierre') {
      input.value = String(row.feature.properties?.nombre ?? row.feature.properties?.name ?? row.feature.id ?? '');
      opts.onSelectCierre?.(row.feature, { searchQuery: searchQueryBeforePick });
      return;
    }
    if (row.type === 'central') {
      input.value = String(
        row.feature.properties?.nombre ?? row.feature.properties?.name ?? row.feature.id ?? ''
      );
      opts.onSelectCentral?.(row.feature, { searchQuery: searchQueryBeforePick });
      return;
    }
    if (row.type === 'coords') {
      input.value = `${row.labelDec} · ${row.labelDms}`;
      opts.onSelectCoordinates?.({ lng: row.lng, lat: row.lat }, { searchQuery: searchQueryBeforePick });
      return;
    }
    input.value = String(row.feature.properties?.nombre ?? row.feature.id ?? '');
    opts.onSelectRoute(row.feature, { searchQuery: searchQueryBeforePick });
  }

  async function runSearch() {
    if (opts.isInteractionLocked()) return;
    const t0 = perfNow();
    const currentSeq = ++searchSeq;
    const q = input.value;
    const trimmed = q.trim();
    /* Sin texto no se abre el listado (evita el catálogo completo al cargar / refresh / focus). */
    if (!trimmed) {
      closeList();
      return;
    }
    const fc = opts.getRouteCollection();
    const coordHit = parseWgs84SearchQuery(trimmed);
    const molQ = trimmed.length >= 2 ? trimmed : '';
    const molHits =
      typeof opts.getMoleculeBrowseHits === 'function' && molQ
        ? opts.getMoleculeBrowseHits(molQ).slice(0, MAX_MOLECULE_ROWS)
        : [];
    /** @type {GeoJSON.Feature[]} */
    let cierreHits = [];
    if (
      opts.networkRed === 'ftth' &&
      typeof opts.getCierreBrowseHits === 'function' &&
      molQ
    ) {
      try {
        cierreHits = await opts.getCierreBrowseHits(molQ);
      } catch {
        cierreHits = [];
      }
    }
    if (currentSeq !== searchSeq) return;
    const cierreSlice = cierreHits.slice(0, MAX_CIERRE_ROWS);
    const usedBase = molHits.length + cierreSlice.length + (coordHit ? 1 : 0);
    const maxCentrSlot = Math.max(0, Math.min(MAX_CENTRALE_ROWS, MAX_RESULTS - usedBase));
    const fcCen =
      typeof opts.getCentralesCollection === 'function' ? opts.getCentralesCollection() : null;
    const centralHits =
      maxCentrSlot > 0 && fcCen
        ? searchCentralesFeatures(fcCen, q, maxCentrSlot, opts.networkRed)
        : [];
    const used = usedBase + Math.min(centralHits.length, maxCentrSlot);
    const routeLimit = Math.max(0, MAX_RESULTS - used);
    const routeHits = searchRouteFeatures(fc, q, routeLimit, opts.networkRed);

    if (!molHits.length && !cierreSlice.length && !routeHits.length && !coordHit && !centralHits.length) {
      closeList();
      if (!trimmed) {
        return;
      }
      const empty = document.createElement('div');
      empty.className = 'cable-search-empty';
      empty.textContent =
        opts.networkRed === 'corporativa'
          ? `Sin coincidencias en ${redEtiqueta}. Prueba nodo, cable, «Troncal»/ID o coordenadas WGS84.`
          : `Sin coincidencias en ${redEtiqueta}. Prueba central, cierre, tendido, molécula o coordenadas.`;
      listbox.appendChild(empty);
      listbox.hidden = false;
      setExpanded(true);
      const perfPush = /** @type {any} */ (window).__FTTH_PERF_PUSH__;
      if (typeof perfPush === 'function') {
        perfPush('search.routes', perfNow() - t0, {
          red: opts.networkRed,
          qLen: trimmed.length,
          total: 0
        });
      }
      return;
    }
    renderCombinedList(molHits, cierreHits, centralHits, routeHits, coordHit);
    const perfPush = /** @type {any} */ (window).__FTTH_PERF_PUSH__;
    if (typeof perfPush === 'function') {
      perfPush('search.routes', perfNow() - t0, {
        red: opts.networkRed,
        qLen: trimmed.length,
        total: activeRows.length
      });
    }
  }

  function scheduleSearch() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void runSearch();
    }, DEBOUNCE_MS);
  }

  function clearCableUi() {
    input.value = '';
    cableShown = false;
    clearBtn.hidden = true;
    closeList();
    opts.onClearCable();
  }

  input.addEventListener('input', () => {
    if (opts.isInteractionLocked()) return;
    scheduleSearch();
  });

  input.addEventListener('focus', () => {
    if (opts.isInteractionLocked()) return;
    scheduleSearch();
  });

  listbox.addEventListener('mousedown', (ev) => {
    const item = ev.target instanceof Element ? ev.target.closest('.cable-search-item') : null;
    if (!item || !listbox.contains(item)) return;
    ev.preventDefault();
  });

  listbox.addEventListener('click', (ev) => {
    const item = ev.target instanceof Element ? ev.target.closest('.cable-search-item') : null;
    if (!item || !listbox.contains(item)) return;
    const idx = Number(item.dataset.index);
    if (!Number.isInteger(idx)) return;
    pickIndex(idx);
  });

  clearBtn.addEventListener('click', () => clearCableUi());

  input.addEventListener('keydown', (ev) => {
    if (opts.isInteractionLocked()) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (listbox.hidden || !activeRows.length) {
        void runSearch();
        return;
      }
      activeIndex = Math.min(activeIndex + 1, activeRows.length - 1);
      highlightActive();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!listbox.hidden && activeRows.length) {
        activeIndex = Math.max(activeIndex - 1, 0);
        highlightActive();
      }
    } else if (ev.key === 'Enter') {
      if (!listbox.hidden && activeRows.length && activeIndex >= 0) {
        ev.preventDefault();
        pickIndex(activeIndex);
      }
    } else if (ev.key === 'Escape') {
      if (!listbox.hidden && activeRows.length) {
        ev.preventDefault();
        closeList();
      } else if (input.value.trim() || cableShown) {
        ev.preventDefault();
        clearCableUi();
      }
    }
  });

  function onDocDown(ev) {
    if (!mount.contains(/** @type {Node} */ (ev.target))) closeList();
  }
  document.addEventListener('mousedown', onDocDown);

  return {
    reset() {
      input.value = '';
      cableShown = false;
      clearBtn.hidden = true;
      closeList();
    },
    /** Vuelve a ejecutar la búsqueda con el catálogo actual (p. ej. tras recargar rutas). */
    refresh() {
      if (input.disabled) return;
      void runSearch();
    },
    /** @param {boolean} locked */
    setDisabled(locked) {
      input.disabled = locked;
      clearBtn.disabled = locked;
      if (locked) closeList();
    },
    dispose() {
      window.clearTimeout(debounceTimer);
      document.removeEventListener('mousedown', onDocDown);
      searchSeq += 1;
      if (typeof mqCompact.removeEventListener === 'function') {
        mqCompact.removeEventListener('change', syncSearchPlaceholder);
      } else if (typeof mqCompact.removeListener === 'function') {
        mqCompact.removeListener(syncSearchPlaceholder);
      }
      mount.remove();
    }
  };
}
