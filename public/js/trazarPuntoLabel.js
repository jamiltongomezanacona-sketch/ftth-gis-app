/**
 * Etiqueta del pin en modo «Pin en cable»: la lectura OTDR se recorre **1:1** en metros sobre el tendido dibujado en GIS.
 * Si la lectura supera el tramo en el sentido elegido, el pin queda en el vértice extremo.
 */
/**
 * @typedef {object} PuntoLabelMeta
 * @property {number} lineGeomM metros geométricos totales del tendido usado en la medida.
 * @property {number} refAlongGeomM metros desde el inicio del LineString hasta el pin.
 * @property {number} [totalLineGeomM] reservado; en la práctica se usa lineGeomM.
 */

/**
 * @param {object} r Resultado de `cutPointFromFiberFromClickRef` con `useFiberReserve: false`.
 * @param {'toward_start' | 'toward_end'} direccion
 * @param {(n: number) => string} fmtM
 * @param {PuntoLabelMeta | undefined} meta
 * @param {{ otdrAlongMapGeometry?: boolean }} [opts]
 * @returns {{ primary: string; secondary: string; detail?: string } | null}
 */
export function buildPuntoTramoPinLabel(r, direccion, fmtM, meta, opts) {
  const alongMap = opts?.otdrAlongMapGeometry !== false;
  const fromRefGeom = Number(r?.geometricFromRefM);
  if (!Number.isFinite(fromRefGeom)) return null;

  const askedFib = Number(r?.fiberReadingM);
  const clamped = Boolean(r?.clamped);

  if (alongMap && clamped && Number.isFinite(askedFib) && askedFib >= 0) {
    let detail = '';
    if (
      meta &&
      Number.isFinite(meta.refAlongGeomM) &&
      Number.isFinite(meta.lineGeomM) &&
      meta.lineGeomM > 1e-6
    ) {
      const L = meta.lineGeomM;
      const ra = meta.refAlongGeomM;
      const remGeomTowardEnd = Math.max(0, L - ra);
      const remGeomTowardStart = Math.max(0, ra);
      const maxThisWayGeom =
        direccion === 'toward_end' ? remGeomTowardEnd : remGeomTowardStart;
      const sentido =
        direccion === 'toward_end' ? 'final del dibujo' : 'central (inicio del dibujo)';
      detail = `Pediste ${fmtM(
        askedFib
      )} m · hacia el ${sentido} solo caben ~${fmtM(
        maxThisWayGeom
      )} m de tendido desde el pin. El trazado completo en mapa es ~${fmtM(
        L
      )} m; el resto queda del otro lado del pin. El corte se ancló al vértice de ese extremo (máximo en este sentido).`;
      if (direccion === 'toward_end' && remGeomTowardEnd < L * 0.22) {
        detail += ' Prueba «hacia central» o mueve el pin.';
      } else if (direccion === 'toward_start' && remGeomTowardStart < L * 0.22) {
        detail += ' Prueba «hacia final» o mueve el pin.';
      }
    } else {
      detail = `Pediste ${fmtM(askedFib)} m · lectura mayor que el tramo en este sentido; pin en extremo.`;
    }

    return {
      primary: fmtM(fromRefGeom),
      secondary:
        direccion === 'toward_end'
          ? 'Corte en la punta del tendido (vértice final en mapa)'
          : 'Corte en la punta del tendido (vértice de central en mapa)',
      detail
    };
  }

  return {
    primary: fmtM(fromRefGeom),
    secondary: alongMap ? 'desde pin (tendido GIS)' : 'desde pin'
  };
}
