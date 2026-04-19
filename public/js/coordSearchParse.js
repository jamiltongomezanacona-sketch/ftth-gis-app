/**
 * Interpreta coordenadas WGS84 tecleadas en el buscador del editor.
 * Formatos: `4.574857, -74.226656` (decimal) y `4°34'29.5"N 74°13'36.0"W` (DMS).
 */

/**
 * @param {number} deg
 * @param {number} min
 * @param {number} sec
 * @param {string} hemi N|S|E|W
 * @returns {number|null}
 */
function dmsHemiToSignedDecimal(deg, min, sec, hemi) {
  const H = String(hemi).toUpperCase();
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  if (H !== 'N' && H !== 'S' && H !== 'E' && H !== 'W') return null;
  const mag = deg + min / 60 + sec / 3600;
  if (H === 'S' || H === 'W') return -mag;
  return mag;
}

/**
 * @param {string} raw
 * @returns {{ lat: number, lng: number } | null}
 */
function tryParseDmsPair(raw) {
  const s = String(raw ?? '')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .trim();
  if (!s.includes('°')) return null;

  const re =
    /(\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*"\s*([NnSsEeWw])/g;
  /** @type {{ deg: number, min: number, sec: number, hemi: string }[]} */
  const caps = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    caps.push({
      deg: Number(m[1]),
      min: Number(m[2]),
      sec: Number(m[3]),
      hemi: String(m[4]).toUpperCase()
    });
  }
  if (caps.length < 2) return null;

  let a = caps[0];
  let b = caps[1];

  const isLatH = (h) => h === 'N' || h === 'S';
  const isLngH = (h) => h === 'E' || h === 'W';

  if (isLngH(a.hemi) && isLatH(b.hemi)) {
    const t = a;
    a = b;
    b = t;
  } else if (!isLatH(a.hemi) || !isLngH(b.hemi)) {
    return null;
  }

  const lat = dmsHemiToSignedDecimal(a.deg, a.min, a.sec, a.hemi);
  const lng = dmsHemiToSignedDecimal(b.deg, b.min, b.sec, b.hemi);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * @param {string} raw
 * @returns {{ lat: number, lng: number } | null}
 */
function tryParseDecimalPair(raw) {
  const t = String(raw ?? '')
    .trim()
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = t.split(' ').filter(Boolean);
  if (parts.length !== 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(b) > 90) {
    return { lat: a, lng: b };
  }
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180 && Math.abs(a) > 90) {
    return { lat: b, lng: a };
  }
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90 && (Math.abs(a) > 90 || a < 0)) {
    return { lng: a, lat: b };
  }
  if (Math.abs(b) <= 180 && Math.abs(a) <= 90 && (Math.abs(b) > 90 || b < 0)) {
    return { lat: a, lng: b };
  }
  if (Math.abs(a) <= 90 && Math.abs(b) <= 90) {
    if (b < 0 && Math.abs(b) > Math.abs(a)) return { lat: a, lng: b };
    if (a < 0 && Math.abs(a) > Math.abs(b)) return { lng: a, lat: b };
    return { lat: a, lng: b };
  }
  return null;
}

/**
 * @param {string} trimmed consulta ya recortada
 * @returns {{ lat: number, lng: number, labelDec: string, labelDms: string } | null}
 */
export function parseWgs84SearchQuery(trimmed) {
  const q = String(trimmed ?? '').trim();
  if (q.length < 3) return null;

  const dms = tryParseDmsPair(q);
  const dec = dms ?? tryParseDecimalPair(q);
  if (!dec) return null;

  const { lat, lng } = dec;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const labelDec = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const labelDms = `${formatLatDms(lat)} ${formatLngDms(lng)}`;

  return { lat, lng, labelDec, labelDms };
}

/**
 * @param {number} x
 * @param {'lat'|'lng'} kind
 */
function toDmsParts(x, kind) {
  const ax = Math.abs(x);
  const deg = Math.floor(ax);
  const minFloat = (ax - deg) * 60;
  const min = Math.floor(minFloat);
  let sec = (minFloat - min) * 60;
  if (sec >= 59.9995) {
    sec = 0;
    const min2 = min + 1;
    if (min2 >= 60) {
      return { deg: deg + 1, min: 0, sec: 0 };
    }
    return { deg, min: min2, sec };
  }
  return { deg, min, sec };
}

/** @param {number} lat */
function formatLatDms(lat) {
  const hemi = lat >= 0 ? 'N' : 'S';
  const { deg, min, sec } = toDmsParts(lat, 'lat');
  return `${deg}°${min}'${sec.toFixed(1)}"${hemi}`;
}

/** @param {number} lng */
function formatLngDms(lng) {
  const hemi = lng >= 0 ? 'E' : 'W';
  const { deg, min, sec } = toDmsParts(lng, 'lng');
  return `${deg}°${min}'${sec.toFixed(1)}"${hemi}`;
}
