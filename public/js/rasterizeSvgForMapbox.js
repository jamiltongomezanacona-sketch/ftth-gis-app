/**
 * Mapbox `loadImage` / `addImage` solo acepta datos raster (p. ej. RGBA).
 * @param {string} svgText
 * @param {number} pixelSize
 * @returns {Promise<{ width: number; height: number; data: Uint8Array }>}
 */
export function rasterizeSvgStringForMapbox(svgText, pixelSize = 96) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = pixelSize;
        canvas.height = pixelSize;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('sin contexto 2d'));
          return;
        }
        ctx.clearRect(0, 0, pixelSize, pixelSize);
        ctx.drawImage(img, 0, 0, pixelSize, pixelSize);
        const idata = ctx.getImageData(0, 0, pixelSize, pixelSize);
        URL.revokeObjectURL(objectUrl);
        resolve({
          width: idata.width,
          height: idata.height,
          data: new Uint8Array(idata.data)
        });
      } catch (e) {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('no se pudo decodificar el SVG como imagen'));
    };
    img.src = objectUrl;
  });
}

/**
 * @param {string} svgUrl
 * @param {number} pixelSize
 * @returns {Promise<{ width: number; height: number; data: Uint8Array }>}
 */
export function rasterizeSvgUrlForMapbox(svgUrl, pixelSize = 96) {
  return fetch(svgUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((svgText) => rasterizeSvgStringForMapbox(svgText, pixelSize));
}
