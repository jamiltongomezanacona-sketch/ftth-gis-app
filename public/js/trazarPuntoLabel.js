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
    /** Texto que evita la confusión «total tendido grande pero pin en medio». */
    let detail = '';
    if (
      meta &&
      Number.isFinite(meta.totalCableFiberM) &&
      Number.isFinite(meta.refAlongGeomM) &&
      Number.isFinite(meta.lineGeomM) &&
      meta.lineGeomM > 1e-6
    ) {
      const L = meta.lineGeomM;
      const ra = meta.refAlongGeomM;
      const remGeomTowardEnd = Math.max(0, L - ra);
      const remGeomTowardStart = Math.max(0, ra);
      const maxFibThisWay =
        direccion === 'toward_end'
          ? lengthWithReserve20Pct(remGeomTowardEnd)
          : lengthWithReserve20Pct(remGeomTowardStart);
      const sentido =
        direccion === 'toward_end' ? 'final del dibujo' : 'central (inicio del dibujo)';
      detail = `Pediste ${fmtM(
        askedFib
      )} · hacia el ${sentido} solo caben ~${fmtM(
        maxFibThisWay
      )} fibra desde el pin. El tendido completo en mapa es ~${fmtM(
        meta.totalCableFiberM
      )}; el resto queda del otro lado del pin.`;
      if (direccion === 'toward_end' && remGeomTowardEnd < L * 0.22) {
        detail += ' Prueba «hacia central» o mueve el pin.';
      } else if (direccion === 'toward_start' && remGeomTowardStart < L * 0.22) {
        detail += ' Prueba «hacia final» o mueve el pin.';
      }
    } else {
      detail = `Pediste ${fmtM(askedFib)} · lectura mayor que el tramo en este sentido; pin en extremo.`;
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
