/**
 * Rótulos de dispositivos (cierres, centrales, medidas, OTDR): como el mapa base,
 * sin nombre hasta acercar el zoom; luego aparición suave (opacidad + tamaño).
 *
 * Solo `text-opacity` falla a veces con GeoJSON/símbolos superpuestos; por eso
 * `text-field` usa `step` + zoom: por debajo de `Z_DEVICE_LABEL_SHOW` el texto es
 * cadena vacía (Mapbox no coloca el rótulo).
 */

/** Zoom mínimo de la capa `symbol` (por debajo no se pinta la capa). */
export const DEVICE_LABEL_LAYER_MIN_ZOOM = 10;

/** A partir de este zoom el `text-field` deja de ser vacío (empieza el nombre). */
export const Z_DEVICE_LABEL_SHOW = 13.5;

/** Zoom en que el rótulo llega a opacidad 1. */
export const Z_DEVICE_LABEL_FULL = 16.5;

function deviceLabelOpacityZoomExpr() {
  return /** @type {const} */ ([
    'interpolate',
    ['linear'],
    ['zoom'],
    Z_DEVICE_LABEL_SHOW - 0.55,
    0,
    Z_DEVICE_LABEL_SHOW + 0.2,
    0.22,
    Z_DEVICE_LABEL_SHOW + 1.05,
    0.62,
    Z_DEVICE_LABEL_FULL,
    1,
    22,
    1
  ]);
}

/**
 * @returns {Record<string, unknown>}
 */
export function deviceLabelTextOpacityPaint() {
  const e = deviceLabelOpacityZoomExpr();
  return {
    // Mapbox GL JS no define `text-halo-opacity`; el halo sigue el texto vía `text-opacity`.
    'text-opacity': e
  };
}

/**
 * Tamaño de fuente según zoom (progresivo una vez visible el nombre).
 * @param {number} [zEnd]
 * @param {number} [pxEnd]
 */
export function deviceLabelTextSizeLayout(zEnd = 18, pxEnd = 12) {
  return /** @type {const} */ ([
    'interpolate',
    ['linear'],
    ['zoom'],
    Z_DEVICE_LABEL_SHOW - 0.35,
    6,
    Z_DEVICE_LABEL_SHOW + 0.45,
    8,
    Z_DEVICE_LABEL_SHOW + 2,
    10,
    zEnd,
    pxEnd
  ]);
}

/**
 * Misma rampa que `deviceLabelTextSizeLayout` desplazada en px (capa de fondo detrás del texto).
 * @param {number} [zEnd]
 * @param {number} [pxEnd]
 * @param {number} [pxExtra]
 */
export function deviceLabelTextSizeLayoutOffset(zEnd = 18, pxEnd = 12, pxExtra = 0) {
  const e = Number(pxExtra) || 0;
  return /** @type {const} */ ([
    'interpolate',
    ['linear'],
    ['zoom'],
    Z_DEVICE_LABEL_SHOW - 0.35,
    6 + e,
    Z_DEVICE_LABEL_SHOW + 0.45,
    8 + e,
    Z_DEVICE_LABEL_SHOW + 2,
    10 + e,
    zEnd,
    pxEnd + e
  ]);
}

/** Cierres / NAP overlay: nombre o name. */
export function deviceLabelTextFieldCoalesceNombreName() {
  return /** @type {const} */ ([
    'step',
    ['zoom'],
    '',
    Z_DEVICE_LABEL_SHOW,
    ['coalesce', ['get', 'nombre'], ['get', 'name'], ['literal', '']]
  ]);
}

/**
 * @param {'nombre' | 'text' | 'label'} prop
 */
export function deviceLabelTextFieldFromProp(prop) {
  return /** @type {const} */ ([
    'step',
    ['zoom'],
    '',
    Z_DEVICE_LABEL_SHOW,
    ['coalesce', ['get', prop], ['literal', '']]
  ]);
}

/**
 * Colisiones Mapbox: no dibujar un nombre encima de otro (ni de otros símbolos del mapa
 * salvo que el motor decida omitir el rótulo). `text-optional` permite ocultar el que no cabe.
 * @returns {Record<string, string | number | boolean>}
 */
export function deviceLabelCollisionLayout() {
  return {
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-optional': true,
    'text-padding': 12,
    'symbol-z-order': 'viewport-y'
  };
}
