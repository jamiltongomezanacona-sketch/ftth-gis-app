/**
 * Etiqueta mínima del pin en modo «Pin en cable»: solo la medida efectiva (m) sobre el tendido GIS.
 */
/**
 * @param {object} r Resultado de `cutPointFromFiberFromClickRef`.
 * @param {'toward_start' | 'toward_end'} _direccion
 * @param {(n: number) => string} fmtM
 * @param {unknown} [_meta]
 * @param {unknown} [_opts]
 * @returns {{ primary: string } | null}
 */
export function buildPuntoTramoPinLabel(r, _direccion, fmtM, _meta, _opts) {
  const fromRefGeom = Number(r?.geometricFromRefM);
  if (!Number.isFinite(fromRefGeom)) return null;
  return { primary: fmtM(fromRefGeom) };
}
