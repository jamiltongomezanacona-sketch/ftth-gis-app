/**
 * Modelo de etiqueta para Trazar «Punto tramo»: separa lectura OTDR (campo) de recorrido efectivo en GIS.
 * Sin techo artificial de metros: el clamp solo acota al extremo geométrico del tendido dibujado.
 *
 * Cuando la lectura es mayor que el trazado, el número GRANDE es siempre el **recorrido en mapa**
 * (coincide con el pin). Mostrar primero la lectura OTDR confundía (ej. 10000 parecía «límite del sistema»).
 */
import { lengthWithReserve20Pct } from './measurements.js';

/**
 * @param {object} r Resultado de `cutPointFromFiberFromClickRef` (incl. clamped, fiberReadingM, geometricFromRefM).
 * @param {'toward_start' | 'toward_end'} direccion
 * @param {(n: number) => string} fmtM
 * @returns {{ primary: string; secondary: string; detail?: string } | null}
 */
export function buildPuntoTramoPinLabel(r, direccion, fmtM) {
  const fromRefGeom = Number(r?.geometricFromRefM);
  if (!Number.isFinite(fromRefGeom)) return null;
  const fibFromRef = lengthWithReserve20Pct(fromRefGeom);
  const askedFib = Number(r?.fiberReadingM);
  const clamped = Boolean(r?.clamped);

  if (clamped && Number.isFinite(askedFib) && askedFib >= 0) {
    return {
      /** Grande = fibra equivalente al tendido real desde el pin hasta el corte (lo que «cabe» en GIS). */
      primary: fmtM(fibFromRef),
      secondary:
        direccion === 'toward_end'
          ? 'Pin en extremo del cable (final del trazado)'
          : 'Pin en extremo del cable (lado central)',
      /** Lectura de campo aparte: cualquier valor admisible; no hay máximo en la aplicación. */
      detail: `Lectura cargada ${fmtM(askedFib)} · mayor que el trazado GIS`
    };
  }

  return {
    primary: fmtM(fibFromRef),
    secondary: 'desde pin'
  };
}
