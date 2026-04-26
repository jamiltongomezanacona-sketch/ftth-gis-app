/**
 * Modal «Montar cierre»: flujo en dos pasos (elegir E1/E2 → datos).
 * Catálogo de tipos extensible (`MONTAR_CIERRE_TIPOS`).
 */

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

/**
 * @param {{
 *   api: { postCierre: (b: Record<string, unknown>) => Promise<{ ok?: boolean, id?: string }> },
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
    !coordsLine
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

  function moleculaCodigoFromFilter(f) {
    if (!f?.central || !f?.molecula) return '';
    const under = String(f.central).trim().replace(/\s+/g, '_');
    return `${under}|${String(f.molecula).trim()}`;
  }

  function paintCoords() {
    try {
      const c = getMap().getCenter();
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        coordsLine.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (centro del mapa)`;
      } else {
        coordsLine.textContent = '—';
      }
    } catch {
      coordsLine.textContent = '—';
    }
  }

  function showStepPick() {
    selected = null;
    stepPick.hidden = false;
    stepForm.hidden = true;
    btnBack.hidden = true;
    btnSave.hidden = true;
    kindBadge.textContent = '';
  }

  function showStepForm(tipo) {
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
      const onMoveEnd = () => paintCoords();
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

  backdrop.addEventListener('click', () => close());
  btnClose.addEventListener('click', () => close());
  btnCancel.addEventListener('click', () => close());
  btnBack.addEventListener('click', () => showStepPick());

  for (const t of MONTAR_CIERRE_TIPOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-mc-card';
    b.setAttribute('data-mc-kind', t.id);
    b.innerHTML = `<span class="editor-mc-card__badge editor-mc-card__badge--${t.id.toLowerCase()}" aria-hidden="true">${escapeHtml(t.short)}</span><span class="editor-mc-card__title">${escapeHtml(t.label)}</span><span class="editor-mc-card__hint">${escapeHtml(t.hint)}</span>`;
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
    let center;
    try {
      center = getMap().getCenter();
    } catch {
      setStatus('Montar cierre: mapa no disponible.');
      return;
    }
    const lat = center.lat;
    const lng = center.lng;
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
    try {
      const r = await api.postCierre(body);
      setStatus(`Cierre ${selected.short} creado · id ${r?.id ?? '—'}.`);
      close();
      await onCierreCreado?.();
    } catch (err) {
      const msg = err?.message ? String(err.message) : String(err);
      setStatus(`Montar cierre: ${msg}`);
    }
  });

  return { open, close, isOpen };
}
