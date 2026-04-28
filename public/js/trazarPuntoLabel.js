/**
 * Modelo de etiqueta para Trazar «Punto tramo»: separa lectura OTDR (campo) de recorrido efectivo en GIS.
 * Sin techo artificial de metros: el clamp solo acota al extremo geométrico del tendido dibujado.
 *
 * El número grande es el recorrido efectivo en mapa (coincide con el pin). Si `meta` trae longitud total
 * GIS, el técnico ve si el dibujo es corto (dato incompleto) o si el pin está mal ubicado/dirección.
 */
import { lengthWithReserve20Pct } from './measurements.js';

/**
 * @typedef {object} PuntoLabelMeta
 * @property {number} totalCableFiberM fibra equivalente a la longitud geométrica total del tendido en mapa (×1,2).
 * @property {number} refAlongGeomM metros geométricos desde el inicio del LineString hasta el pin.
 * @property {number} lineGeomM metros geométricos totales del tendido dibujado.
 */

/**
 * @param {object} r Resultado de `cutPointFromFiberFromClickRef` (incl. clamped, fiberReadingM, geometricFromRefM).
 * @param {'toward_start' | 'toward_end'} direccion
 * @param {(n: number) => string} fmtM
 * @param {PuntoLabelMeta | undefined} meta
 * @returns {{ primary: string; secondary: string; detail?: string } | null}
 */
export function buildPuntoTramoPinLabel(r, direccion, fmtM, meta) {
  const fromRefGeom = Number(r?.geometricFromRefM);
  if (!Number.isFinite(fromRefGeom)) return null;
  const fibFromRef = lengthWithReserve20Pct(fromRefGeom);
  const askedFib = Number(r?.fiberReadingM);
  const clamped = Boolean(r?.clamped);

  if (clamped && Number.isFinite(askedFib) && askedFib >= 0) {
    let detail = `Lectura ${fmtM(askedFib)} · mayor que lo disponible en GIS`;
    if (
      meta &&
      Number.isFinite(meta.totalCableFiberM) &&
      Number.isFinite(meta.refAlongGeomM) &&
      Number.isFinite(meta.lineGeomM) &&
      meta.lineGeomM > 1e-6
    ) {
      const L = meta.lineGeomM;
      const ra = meta.refAlongGeomM;
      const remTowardEnd = Math.max(0, L - ra);
      const remTowardStart = Math.max(0, ra);
      detail += ` · tendido dibujado ~${fmtM(meta.totalCableFiberM)} fibra total`;
      if (direccion === 'toward_end' && remTowardEnd < L * 0.22) {
        detail +=
          ' · poco cable hacia «final»: el pin está cerca de ese extremo del dibujo → prueba «hacia central» o mueve el pin';
      } else if (direccion === 'toward_start' && remTowardStart < L * 0.22) {
        detail +=
          ' · poco cable hacia «central»: el pin está cerca de ese extremo → prueba «hacia final» o mueve el pin';
      } else if (meta.totalCableFiberM + 5 < askedFib) {
        detail +=
          ' · si el cable real es más largo, falta tendido en el mapa o revisar dirección del trazo';
      }
    }

    return {
      primary: fmtM(fibFromRef),
      secondary:
        direccion === 'toward_end'
          ? 'Pin en extremo del cable (final del trazado)'
          : 'Pin en extremo del cable (lado central)',
      detail
    };
  }

  return {
    primary: fmtM(fibFromRef),
    secondary: 'desde pin'
  };
}
