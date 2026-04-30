/**
 * Modal «Montar cierre»: flujo en dos pasos (elegir E1/E2 → datos).
 * Catálogo de tipos extensible (`MONTAR_CIERRE_TIPOS`).
 *
 * Posición: pin en mapa (Mapbox Marker, arrastrable); puede seguir el centro o fijarse por clic/arrastre.
 * Nombre: sugerencias desde `api.listCierresPorMolecula` (misma API que overlay / búsqueda).
 */

import { FTTH_ICON_CIERRE_E1, FTTH_ICON_CIERRE_E2 } from './ftthCierreIcons.js';

/** @typedef {{ id: string, label: string, short: string, hint: string, kindBadgeClass: string }} MontarCierreTipo */

function escapeHtml(/** @type {unknown} */ raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tipos de alta soportados (ampliar aquí al crecer el proyecto). */
export const MONTAR_CIERRE_TIPOS = /** @type {const} */ ([
  {
    id: 'E1',
    label: 'Cierre E1',
    short: 'E1',
    hint: 'Empalme / derivación típica hacia cliente.',
    kindBadgeClass: 'editor-mc-kind-badge--e1'
  },
  {
    id: 'E2',
    label: 'Cierre E2',
    short: 'E2',
    hint: 'Punto de paso o empalme secundario en la acometida.',
    kindBadgeClass: 'editor-mc-kind-badge--e2'
  }
]);

const NOMBRE_SUGGEST_DEBOUNCE_MS = 200;
const NOMBRE_SUGGEST_MAX = 10;
const SUBMOLECULA_COUNT = 18;
const CENTRAL_CODE_BY_NAME = {
  SANTA_INES: 'SI',
  MUZU: 'MU',
  CUNI: 'CU',
  CHICO: 'CO',
  FONTIBON: 'FO',
  HOLANDA: 'HO',
  BACHUE: 'BA',
  SUBA: 'SU',
  GUAYMARAL: 'GU',
  TOBERIN: 'TO'
};

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function subMoleculaToLetter(sub) {
  const n = Number(sub);
  if (!Number.isFinite(n) || n < 1 || n > SUBMOLECULA_COUNT) return '';
  return String.fromCharCode('A'.charCodeAt(0) + n - 1);
}

function extractCentralAndMoleculaFromFilter(moleculeFilter) {
  const molRaw = String(moleculeFilter?.molecula ?? '').trim().toUpperCase();
  const centralRaw = String(moleculeFilter?.central ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  let centralCode = '';
  let moleculaNum = '';
  const fromMol = molRaw.match(/^([A-Z]{2})(\d{2})$/);
  if (fromMol) {
    centralCode = fromMol[1];
    moleculaNum = fromMol[2];
  } else {
    const fromDigits = molRaw.match(/(\d{2})$/);
    moleculaNum = fromDigits ? fromDigits[1] : '';
    centralCode = CENTRAL_CODE_BY_NAME[centralRaw] || '';
  }
  return { centralCode, moleculaNum };
}

/**
 * @param {string} query
 * @param {string[]} names deduplicados preferentemente
 * @returns {string[]}
 */
function rankNombreSuggestions(query, names) {
  const stripDiacritics = (s) =>
    String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const q = stripDiacritics(String(query ?? '').trim()).toLowerCase();
  const norm = (s) => stripDiacritics(String(s)).toLowerCase();
  /** @type {{ n: string; score: number }[]} */
  const rows = [];
  const seen = new Set();
  for (const raw of names) {
    const n = String(raw ?? '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const ln = norm(n);
    let score = 0;
    if (!q) {
      score = 80 - Math.min(ln.length, 40);
    } else if (ln.startsWith(q)) {
      score = 300 - ln.length;
    } else if (` ${ln}`.includes(` ${q}`) || ln.includes(`_${q}`) || ln.includes(`-${q}`)) {
      score = 220 - ln.length;
    } else if (ln.includes(q)) {
      score = 120 - ln.length;
    } else {
      continue;
    }
    rows.push({ n, score });
  }
  rows.sort((a, b) => b.score - a.score || a.n.localeCompare(b.n));
  return rows.map((r) => r.n).slice(0, NOMBRE_SUGGEST_MAX);
}

/**
 * @param {{
 *   api: {
 *     postCierre: (b: Record<string, unknown>) => Promise<{ ok?: boolean, id?: string }>,
 *     listCierresPorMolecula?: (central: string, molecula: string) => Promise<{ features?: object[] }>
 *   },
 *   setStatus: (msg: string) => void,
 *   getMap: () => import('mapbox-gl').Map,
 *   getMoleculeFilter: () => { central: string, molecula: string } | null,
 *   onCierreCreado?: () => void | Promise<void>,
 *   canOpen?: () => boolean,
 *   scheduleMapResize?: (delay?: number) => void
 * }} opts
 */
export function initMontarCierreModal(opts) {
  const { api, setStatus, getMap, getMoleculeFilter, onCierreCreado, canOpen, scheduleMapResize } = opts;

  const root = document.getElementById('editor-montar-cierre-modal');
  const backdrop = document.getElementById('editor-mc-modal-backdrop');
  const btnClose = document.getElementById('btn-editor-mc-close');
  const btnCancel = document.getElementById('btn-editor-mc-cancel');
  const btnBack = document.getElementById('btn-editor-mc-back');
  const btnSave = document.getElementById('btn-editor-mc-save');
  const stepPick = document.getElementById('editor-mc-step-pick');
  const stepForm = document.getElementById('editor-mc-step-form');
  const cardsRoot = document.getElementById('editor-mc-cards-root');
  const molLine = document.getElementById('editor-mc-molecule-line');
  const kindBadge = document.getElementById('editor-mc-kind-badge');
  const inpNombre = /** @type {HTMLInputElement | null} */ (document.getElementById('editor-mc-nombre'));
  const inpDist = /** @type {HTMLInputElement | null} */ (document.getElementById('editor-mc-dist'));
  const inpDesc = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('editor-mc-desc'));
  const inpEstado = /** @type {HTMLInputElement | null} */ (document.getElementById('editor-mc-estado'));
  const coordsLine = document.getElementById('editor-mc-coords');
  const btnPickMap = document.getElementById('btn-editor-mc-pick-map');
  const btnUseGps = document.getElementById('btn-editor-mc-use-gps');
  const btnUseCenter = document.getElementById('btn-editor-mc-use-center');
  const ulNombreSuggest = document.getElementById('editor-mc-nombre-suggest');
  const subWrap = document.getElementById('editor-mc-sub-wrap');
  const inpSub = /** @type {HTMLSelectElement | null} */ (document.getElementById('editor-mc-sub'));
  const smartPreview = document.getElementById('editor-mc-smart-preview');
  const btnSuggestName = document.getElementById('btn-editor-mc-suggest-name');

  if (
    !root ||
    !backdrop ||
    !btnClose ||
    !btnCancel ||
    !btnBack ||
    !btnSave ||
    !stepPick ||
    !stepForm ||
    !cardsRoot ||
    !molLine ||
    !kindBadge ||
    !inpNombre ||
    !inpDist ||
    !inpDesc ||
    !inpEstado ||
    !coordsLine ||
    !btnPickMap ||
    !btnUseGps ||
    !btnUseCenter ||
    !ulNombreSuggest ||
    !subWrap ||
    !inpSub ||
    !smartPreview ||
    !btnSuggestName
  ) {
    return {
      open: () => {},
      close: () => {},
      isOpen: () => false
    };
  }

  /** @type {MontarCierreTipo | null} */
  let selected = null;
  /** @type {null | (() => void)} */
  let unsubMapMove = null;
  /** `null` = pin anclado al centro del mapa (se mueve con el mapa). Si hay valor = pin fijo (clic o arrastre). */
  /** @type {{ lng: number, lat: number } | null} */
  let pickedLngLat = null;
  /** @type {((e: import('mapbox-gl').MapLayerMouseEvent & import('mapbox-gl').EventData) => void) | null} */
  let mapClickHandler = null;
  /** @type {import('mapbox-gl').Marker | null} */
  let draftMarker = null;
  /** Nombres de cierres ya existentes en la molécula (caché al abrir el paso formulario). */
  /** @type {string[]} */
  let nombreSuggestPool = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let nombreSuggestTimer = null;
  /** @type {number} */
  let nombreSuggestActive = -1;
  /** Evita sobrescribir manualmente el nombre cuando el usuario ya lo editó. */
  let smartNameManual = false;
  /** Bloquea `input` al setear valor desde código. */
  let updatingNombreProgrammatically = false;

  function moleculaCodigoFromFilter(f) {
    if (!f?.central || !f?.molecula) return '';
    const under = String(f.central).trim().replace(/\s+/g, '_');
    return `${under}|${String(f.molecula).trim()}`;
  }

  function computeSmartNameSuggestion() {
    if (!selected) return { value: '', preview: 'Elige tipo de cierre para sugerir.' };
    const mf = getMoleculeFilter();
    const { centralCode, moleculaNum } = extractCentralAndMoleculaFromFilter(mf);
    if (!centralCode || !moleculaNum) {
      return { value: '', preview: 'No se pudo derivar central/molécula para sugerir código.' };
    }
    const existing = nombreSuggestPool.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    if (selected.id === 'E1') {
      const re = new RegExp(`^E1${escapeRe(centralCode)}${escapeRe(moleculaNum)}_(\\d+)$`, 'i');
      const nums = existing
        .map((n) => n.match(re))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n));
      const next = nums.length ? Math.max(...nums) + 1 : 1;
      const value = `E1${centralCode}${moleculaNum}_${next}`;
      return { value, preview: `Sugerido inteligente: ${value}` };
    }
    const sub = String(inpSub.value || '1');
    const letter = subMoleculaToLetter(sub);
    if (!letter) return { value: '', preview: 'Submolécula inválida para E2.' };
    const reNew = new RegExp(`^E2${escapeRe(centralCode)}${escapeRe(moleculaNum)}_${escapeRe(letter)}(\\d+)$`, 'i');
    const reOld = new RegExp(`^E2${escapeRe(centralCode)}${escapeRe(moleculaNum)}_${escapeRe(sub)}(\\d+)$`, 'i');
    const nums = [];
    for (const n of existing) {
      const hitNew = n.match(reNew);
      if (hitNew) {
        nums.push(Number(hitNew[1]));
        continue;
      }
      const hitOld = n.match(reOld);
      if (hitOld) nums.push(Number(hitOld[1]));
    }
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    const value = `E2${centralCode}${moleculaNum}_${letter}${next}`;
    return { value, preview: `Sugerido inteligente: ${value}` };
  }

  function renderSmartPreview() {
    const r = computeSmartNameSuggestion();
    smartPreview.textContent = r.preview;
  }

  function applySmartNameSuggestion(force = false) {
    const r = computeSmartNameSuggestion();
    renderSmartPreview();
    if (!r.value) return;
    if (smartNameManual && !force) return;
    updatingNombreProgrammatically = true;
    inpNombre.value = r.value;
    updatingNombreProgrammatically = false;
    scheduleNombreSuggest();
  }

  function validateNombreNoDuplicado() {
    const n = inpNombre.value.trim().toUpperCase();
    if (!n) return true;
    return !nombreSuggestPool.some((x) => String(x).trim().toUpperCase() === n);
  }

  function iconUrlForSelected() {
    if (selected?.id === 'E2') return FTTH_ICON_CIERRE_E2;
    return FTTH_ICON_CIERRE_E1;
  }

  function removeDraftMarker() {
    try {
      if (draftMarker) {
        draftMarker.remove();
        draftMarker = null;
      }
    } catch {
      /* */
    }
  }

  function ensureDraftMarker() {
    removeDraftMarker();
    const mb = globalThis.mapboxgl ?? window.mapboxgl;
    if (typeof mb !== 'object' || !mb || typeof mb.Marker !== 'function' || !selected) return;
    try {
      const m = getMap();
      const wrap = document.createElement('div');
      wrap.className = 'editor-mc-map-pin';
      wrap.setAttribute('role', 'img');
      wrap.setAttribute(
        'aria-label',
        `Pin de cierre ${selected.short} (arrastra o usa los botones de posición)`
      );
      const img = document.createElement('img');
      img.src = iconUrlForSelected();
      img.alt = '';
      img.width = 36;
      img.height = 36;
      wrap.appendChild(img);

      const start =
        pickedLngLat && Number.isFinite(pickedLngLat.lat) && Number.isFinite(pickedLngLat.lng)
          ? [pickedLngLat.lng, pickedLngLat.lat]
          : /** @type {[number, number]} */ ([m.getCenter().lng, m.getCenter().lat]);

      draftMarker = new mb.Marker({ element: wrap, anchor: 'bottom', draggable: true })
        .setLngLat(start)
        .addTo(m);

      draftMarker.on('dragend', () => {
        try {
          const ll = draftMarker?.getLngLat();
          if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return;
          setPickedPoint(ll.lng, ll.lat, 'arrastre');
        } catch {
          /* */
        }
      });
    } catch {
      draftMarker = null;
    }
  }

  function syncDraftMarkerToCenterIfNeeded() {
    try {
      if (!draftMarker || pickedLngLat) return;
      const c = getMap().getCenter();
      draftMarker.setLngLat([c.lng, c.lat]);
    } catch {
      /* */
    }
  }

  function setPickedPoint(lng, lat, sourceLabel) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pickedLngLat = { lng, lat };
    try {
      draftMarker?.setLngLat([lng, lat]);
    } catch {
      /* */
    }
    paintCoords();
    setStatus(`Montar cierre: pin fijado desde ${sourceLabel} en ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
  }

  function paintCoords() {
    try {
      if (
        pickedLngLat &&
        Number.isFinite(pickedLngLat.lat) &&
        Number.isFinite(pickedLngLat.lng)
      ) {
        coordsLine.textContent = `${pickedLngLat.lat.toFixed(5)}, ${pickedLngLat.lng.toFixed(5)} · pin fijo`;
        return;
      }
      const c = getMap().getCenter();
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        coordsLine.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · pin sigue el centro`;
      } else {
        coordsLine.textContent = '—';
      }
    } catch {
      coordsLine.textContent = '—';
    }
  }

  function disarmMapPick() {
    document.body.classList.remove('editor-mc-pick-map');
    root.classList.remove('editor-mc-modal--map-pick');
    try {
      const m = getMap();
      if (mapClickHandler) {
        m.off('click', mapClickHandler);
        mapClickHandler = null;
      }
      m.getCanvas().style.cursor = '';
    } catch {
      /* */
    }
  }

  function armMapPick() {
    disarmMapPick();
    document.body.classList.add('editor-mc-pick-map');
    root.classList.add('editor-mc-modal--map-pick');
    const m = getMap();
    mapClickHandler = (e) => {
      setPickedPoint(e.lngLat.lng, e.lngLat.lat, 'mapa');
      disarmMapPick();
    };
    m.on('click', mapClickHandler);
    try {
      m.getCanvas().style.cursor = 'crosshair';
    } catch {
      /* */
    }
    setStatus('Montar cierre: usa "Ubicar punto del cierre" y haz clic en el mapa para definir la posición.');
  }

  function hideNombreSuggest() {
    nombreSuggestTimer = null;
    ulNombreSuggest.hidden = true;
    ulNombreSuggest.innerHTML = '';
    nombreSuggestActive = -1;
    inpNombre.removeAttribute('aria-activedescendant');
    inpNombre.setAttribute('aria-expanded', 'false');
  }

  function applyNombreSuggestSelection(value) {
    inpNombre.value = value;
    hideNombreSuggest();
    inpNombre.focus();
  }

  function renderNombreSuggest(hits) {
    ulNombreSuggest.innerHTML = '';
    nombreSuggestActive = hits.length ? 0 : -1;
    if (!hits.length) {
      hideNombreSuggest();
      return;
    }
    hits.forEach((text, i) => {
      const li = document.createElement('li');
      li.id = `editor-mc-nombre-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      li.textContent = text;
      li.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        applyNombreSuggestSelection(text);
      });
      ulNombreSuggest.appendChild(li);
    });
    ulNombreSuggest.hidden = false;
    inpNombre.setAttribute('aria-expanded', 'true');
    if (hits[0]) inpNombre.setAttribute('aria-activedescendant', 'editor-mc-nombre-opt-0');
  }

  function refreshNombreSuggestHighlight() {
    const items = ulNombreSuggest.querySelectorAll('li[role="option"]');
    items.forEach((node, i) => {
      const sel = i === nombreSuggestActive;
      node.setAttribute('aria-selected', sel ? 'true' : 'false');
      if (sel) {
        inpNombre.setAttribute('aria-activedescendant', node.id || '');
        try {
          node.scrollIntoView({ block: 'nearest' });
        } catch {
          /* */
        }
      }
    });
  }

  function scheduleNombreSuggest() {
    if (nombreSuggestTimer) window.clearTimeout(nombreSuggestTimer);
    nombreSuggestTimer = window.setTimeout(() => {
      nombreSuggestTimer = null;
      const q = inpNombre.value;
      const hits = rankNombreSuggestions(q, nombreSuggestPool);
      renderNombreSuggest(hits);
    }, NOMBRE_SUGGEST_DEBOUNCE_MS);
  }

  /** Actualiza la lista sin esperar al debounce (p. ej. al llegar la caché de nombres desde la API). */
  function flushNombreSuggestIfFocused() {
    if (nombreSuggestTimer) window.clearTimeout(nombreSuggestTimer);
    nombreSuggestTimer = null;
    if (stepForm.hidden || document.activeElement !== inpNombre) return;
    const hits = rankNombreSuggestions(inpNombre.value, nombreSuggestPool);
    renderNombreSuggest(hits);
  }

  async function loadNombreSuggestPool() {
    nombreSuggestPool = [];
    const mol = getMoleculeFilter();
    if (!mol?.central || !mol?.molecula || typeof api.listCierresPorMolecula !== 'function') return;
    try {
      const fc = await api.listCierresPorMolecula(mol.central, mol.molecula);
      const feats = Array.isArray(fc?.features) ? fc.features : [];
      /** @type {string[]} */
      const names = [];
      for (const f of feats) {
        const p = f && typeof f === 'object' && 'properties' in f ? /** @type {{ nombre?: unknown, name?: unknown }} */ (f).properties : null;
        const raw = p && typeof p.nombre === 'string' ? p.nombre : p && typeof p.name === 'string' ? p.name : '';
        const t = String(raw ?? '').trim();
        if (t) names.push(t);
      }
      nombreSuggestPool = names;
      flushNombreSuggestIfFocused();
      renderSmartPreview();
      applySmartNameSuggestion(false);
    } catch {
      nombreSuggestPool = [];
      renderSmartPreview();
    }
  }

  function showStepPick() {
    disarmMapPick();
    removeDraftMarker();
    pickedLngLat = null;
    hideNombreSuggest();
    selected = null;
    stepPick.hidden = false;
    stepForm.hidden = true;
    btnBack.hidden = true;
    btnSave.hidden = true;
    kindBadge.textContent = '';
    subWrap.hidden = true;
    smartPreview.textContent = '';
  }

  function showStepForm(tipo) {
    disarmMapPick();
    pickedLngLat = null;
    selected = tipo;
    stepPick.hidden = true;
    stepForm.hidden = false;
    btnBack.hidden = false;
    btnSave.hidden = false;
    kindBadge.textContent = tipo.short;
    kindBadge.className = `editor-mc-kind-badge ${tipo.kindBadgeClass}`;
    inpNombre.value = '';
    inpDist.value = '';
    inpDesc.value = '';
    inpEstado.value = 'ACTIVO';
    inpSub.value = '1';
    subWrap.hidden = tipo.id !== 'E2';
    hideNombreSuggest();
    void loadNombreSuggestPool();
    smartNameManual = false;
    ensureDraftMarker();
    syncDraftMarkerToCenterIfNeeded();
    renderSmartPreview();
    applySmartNameSuggestion(true);
    paintCoords();
    window.requestAnimationFrame(() => inpNombre.focus());
  }

  function requestResize() {
    try {
      scheduleMapResize?.(0);
    } catch {
      /* */
    }
  }

  function open() {
    if (!canOpen?.()) return;
    const mol = getMoleculeFilter();
    const code = moleculaCodigoFromFilter(mol);
    if (!code) {
      setStatus('Montar cierre: busca primero una molécula en la barra hasta ver el tendido en el mapa.');
      return;
    }
    molLine.textContent = `Molécula · ${mol?.molecula ?? '—'} (${mol?.central ?? '—'}) · ${code}`;
    showStepPick();
    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('editor-mc-modal-open');
    try {
      const m = getMap();
      const onMoveEnd = () => {
        if (!pickedLngLat) {
          syncDraftMarkerToCenterIfNeeded();
          paintCoords();
        }
      };
      m.on('moveend', onMoveEnd);
      unsubMapMove = () => {
        try {
          m.off('moveend', onMoveEnd);
        } catch {
          /* */
        }
      };
    } catch {
      unsubMapMove = null;
    }
    requestResize();
  }

  function close() {
    disarmMapPick();
    removeDraftMarker();
    pickedLngLat = null;
    hideNombreSuggest();
    try {
      unsubMapMove?.();
    } catch {
      /* */
    }
    unsubMapMove = null;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('editor-mc-modal-open');
    showStepPick();
    requestResize();
  }

  function isOpen() {
    return !root.hidden;
  }

  backdrop.addEventListener('click', () => {
    if (mapClickHandler) return;
    close();
  });
  btnClose.addEventListener('click', () => close());
  btnCancel.addEventListener('click', () => close());
  btnBack.addEventListener('click', () => showStepPick());

  btnPickMap.addEventListener('click', () => {
    armMapPick();
  });
  btnUseGps.addEventListener('click', () => {
    disarmMapPick();
    if (!('geolocation' in navigator)) {
      setStatus('Montar cierre: este dispositivo no soporta GPS del navegador.');
      return;
    }
    setStatus('Montar cierre: obteniendo ubicación GPS del dispositivo...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos?.coords?.latitude);
        const lng = Number(pos?.coords?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setStatus('Montar cierre: GPS sin coordenadas válidas.');
          return;
        }
        setPickedPoint(lng, lat, 'GPS');
        try {
          getMap().easeTo({ center: [lng, lat], duration: 420 });
        } catch {
          /* */
        }
      },
      (err) => {
        const code = Number(err?.code || 0);
        if (code === 1) {
          setStatus('Montar cierre: permiso de ubicación denegado.');
          return;
        }
        if (code === 3) {
          setStatus('Montar cierre: GPS sin respuesta (timeout). Intenta de nuevo.');
          return;
        }
        setStatus('Montar cierre: no fue posible obtener ubicación GPS.');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
    );
  });
  btnUseCenter.addEventListener('click', () => {
    disarmMapPick();
    pickedLngLat = null;
    syncDraftMarkerToCenterIfNeeded();
    paintCoords();
    setStatus('Montar cierre: el pin vuelve a seguir el centro del mapa.');
  });

  btnSuggestName.addEventListener('click', () => {
    smartNameManual = false;
    applySmartNameSuggestion(true);
    inpNombre.focus();
  });
  inpSub.addEventListener('change', () => {
    renderSmartPreview();
    applySmartNameSuggestion(false);
  });

  inpNombre.setAttribute('role', 'combobox');
  inpNombre.setAttribute('aria-autocomplete', 'list');
  inpNombre.setAttribute('aria-controls', 'editor-mc-nombre-suggest');
  inpNombre.setAttribute('aria-expanded', 'false');

  inpNombre.addEventListener('input', () => {
    if (!updatingNombreProgrammatically) smartNameManual = true;
    scheduleNombreSuggest();
    renderSmartPreview();
  });
  inpNombre.addEventListener('focus', () => {
    scheduleNombreSuggest();
  });
  inpNombre.addEventListener('blur', () => {
    window.setTimeout(() => hideNombreSuggest(), 180);
  });
  inpNombre.addEventListener('keydown', (ev) => {
    if (ulNombreSuggest.hidden) return;
    const items = ulNombreSuggest.querySelectorAll('li[role="option"]');
    const n = items.length;
    if (!n) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      hideNombreSuggest();
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      nombreSuggestActive = Math.min(nombreSuggestActive + 1, n - 1);
      refreshNombreSuggestHighlight();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      nombreSuggestActive = Math.max(nombreSuggestActive - 1, 0);
      refreshNombreSuggestHighlight();
      return;
    }
    if (ev.key === 'Enter' && nombreSuggestActive >= 0) {
      const li = items[nombreSuggestActive];
      const t = li?.textContent?.trim();
      if (t) {
        ev.preventDefault();
        applyNombreSuggestSelection(t);
      }
    }
  });

  for (const t of MONTAR_CIERRE_TIPOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-mc-card';
    b.setAttribute('data-mc-kind', t.id);
    b.innerHTML = `<span class="editor-mc-card__badge editor-mc-card__badge--${t.id.toLowerCase()}" aria-hidden="true">${escapeHtml(t.short)}</span><span class="editor-mc-card__title">${escapeHtml(t.label)}</span>`;
    b.setAttribute('aria-label', `${t.label}. ${t.hint}`);
    b.addEventListener('click', () => {
      const hit = MONTAR_CIERRE_TIPOS.find((x) => x.id === t.id);
      if (hit) showStepForm(hit);
    });
    cardsRoot.appendChild(b);
  }

  btnSave.addEventListener('click', async () => {
    if (!selected) return;
    const mol = getMoleculeFilter();
    const molecula_codigo = moleculaCodigoFromFilter(mol);
    if (!molecula_codigo) {
      setStatus('Montar cierre: sin molécula activa.');
      return;
    }
    const nombre = inpNombre.value.trim();
    if (!nombre) {
      setStatus('Montar cierre: indica un nombre para el cierre.');
      inpNombre.focus();
      return;
    }
    if (!validateNombreNoDuplicado()) {
      setStatus('Montar cierre: el nombre/código ya existe en esta molécula. Usa "Sugerir nombre".');
      inpNombre.focus();
      return;
    }
    let lat;
    let lng;
    try {
      if (pickedLngLat && Number.isFinite(pickedLngLat.lat) && Number.isFinite(pickedLngLat.lng)) {
        lat = pickedLngLat.lat;
        lng = pickedLngLat.lng;
      } else {
        const center = getMap().getCenter();
        lat = center.lat;
        lng = center.lng;
      }
    } catch {
      setStatus('Montar cierre: mapa no disponible.');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setStatus('Montar cierre: coordenadas no válidas.');
      return;
    }
    const body = {
      nombre,
      tipo: selected.id,
      molecula_codigo,
      lat,
      lng,
      estado: inpEstado.value.trim() || null,
      descripcion: inpDesc.value.trim() || null,
      dist_odf: inpDist.value.trim() ? Number(inpDist.value) : null
    };
    btnSave.disabled = true;
    try {
      const r = await api.postCierre(body);
      setStatus(`Cierre ${selected.short} creado · id ${r?.id ?? '—'}.`);
      close();
      await onCierreCreado?.();
    } catch (err) {
      const msg = err?.message ? String(err.message) : String(err);
      setStatus(`Montar cierre: ${msg}`);
    } finally {
      btnSave.disabled = false;
    }
  });

  return { open, close, isOpen };
}
