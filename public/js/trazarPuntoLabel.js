/**
 * Modelo de etiqueta para Trazar «Punto tramo»: separa lectura OTDR (campo) de recorrido efectivo en GIS.
 * Sin techo artificial de metros: el clamp solo acota al extremo geométrico del tendido dibujado.
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
      /** Número principal = lectura que reporta el técnico (OTDR / orden de trabajo). */
      primary: fmtM(askedFib),
      secondary:
        direccion === 'toward_end'
          ? 'Corte en extremo del tendido (final en mapa)'
          : 'Corte en extremo del tendido (central en mapa)',
      /** Fibra equivalente al tramo geométrico realmente recorrido desde el pin (÷1,2 ya aplicado en la medida). */
      detail: `Recorrido tendido desde el pin: ${fmtM(fibFromRef)}`
    };
  }

  return {
    primary: fmtM(fibFromRef),
    secondary: 'desde pin'
  };
}
