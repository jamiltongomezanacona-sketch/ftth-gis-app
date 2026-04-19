/**
 * Iconos pin FTTH (mismo set que `mapa_iconos_ftth_fibra.html` en Downloads).
 * @typedef {{ id: string; lbl: string; sub: string; f: string; s: string; d: string }} FtthMapIcon
 */

export const FTTH_MAP_PIN_PATH =
  'M16,2C10.48,2,6,6.48,6,12c0,7.5,10,18,10,18s10-10.5,10-18C26,6.48,21.52,2,16,2Z';

/** @type {FtthMapIcon[]} */
export const FTTH_MAP_ICONS = [
  {
    id: 'olt',
    lbl: 'OLT',
    sub: 'Equipo activo central',
    f: '#14532d',
    s: '#021c0d',
    d: `<rect x="11" y="6" width="10" height="2.3" rx="0.7" fill="#01180e" opacity="0.98"/>
<rect x="11" y="9.2" width="10" height="2.3" rx="0.7" fill="#01180e" opacity="0.98"/>
<rect x="11" y="12.4" width="10" height="2.3" rx="0.7" fill="#01180e" opacity="0.98"/>
<circle cx="19.2" cy="7.15" r="0.85" fill="#15803d"/>
<circle cx="19.2" cy="10.35" r="0.85" fill="#15803d"/>
<circle cx="19.2" cy="13.5" r="0.85" fill="#15803d"/>`
  },
  {
    id: 'splitter',
    lbl: 'Splitter',
    sub: 'Divisor óptico 1:N',
    f: '#FAC775',
    s: '#854F0B',
    d: `<line x1="16" y1="5.5" x2="16" y2="10.5" stroke="#633806" stroke-width="1.8" stroke-linecap="round"/>
<circle cx="16" cy="10.5" r="1.3" fill="#633806"/>
<line x1="16" y1="10.5" x2="12" y2="16.5" stroke="#633806" stroke-width="1.3" stroke-linecap="round"/>
<line x1="16" y1="10.5" x2="16" y2="17" stroke="#633806" stroke-width="1.3" stroke-linecap="round"/>
<line x1="16" y1="10.5" x2="20" y2="16.5" stroke="#633806" stroke-width="1.3" stroke-linecap="round"/>
<circle cx="12" cy="16.5" r="1" fill="#633806"/>
<circle cx="16" cy="17" r="1" fill="#633806"/>
<circle cx="20" cy="16.5" r="1" fill="#633806"/>`
  },
  {
    id: 'cierre',
    lbl: 'Cierre / Mufa',
    sub: 'Caja de empalme FO',
    f: '#FAC775',
    s: '#854F0B',
    d: `<rect x="11" y="8.5" width="10" height="5" fill="#EF9F27" opacity="0.5"/>
<line x1="11" y1="8.5" x2="21" y2="8.5" stroke="#633806" stroke-width="1"/>
<line x1="11" y1="13.5" x2="21" y2="13.5" stroke="#633806" stroke-width="1"/>
<ellipse cx="11" cy="11" rx="1.8" ry="2.5" fill="#EF9F27" stroke="#633806" stroke-width="1"/>
<ellipse cx="21" cy="11" rx="1.8" ry="2.5" fill="#EF9F27" stroke="#633806" stroke-width="1"/>
<line x1="14.5" y1="8.5" x2="14.5" y2="13.5" stroke="#633806" stroke-width="0.8" opacity="0.55"/>
<line x1="17.5" y1="8.5" x2="17.5" y2="13.5" stroke="#633806" stroke-width="0.8" opacity="0.55"/>
<line x1="9" y1="11" x2="11" y2="11" stroke="#633806" stroke-width="1.5" stroke-linecap="round"/>
<line x1="21" y1="11" x2="23" y2="11" stroke="#633806" stroke-width="1.5" stroke-linecap="round"/>`
  },
  {
    id: 'nap',
    lbl: 'Caja NAP',
    sub: 'Nodo de acceso',
    f: '#FAC775',
    s: '#854F0B',
    d: `<rect x="10.5" y="6.5" width="11" height="9.5" rx="1.5" fill="none" stroke="#633806" stroke-width="1.2"/>
<rect x="12" y="8" width="3" height="2.8" rx="0.8" fill="#633806" opacity="0.7"/>
<rect x="16" y="8" width="3" height="2.8" rx="0.8" fill="#633806" opacity="0.7"/>
<rect x="12" y="11.8" width="3" height="2.8" rx="0.8" fill="#633806" opacity="0.5"/>
<rect x="16" y="11.8" width="3" height="2.8" rx="0.8" fill="#633806" opacity="0.5"/>
<line x1="10.5" y1="5.5" x2="21.5" y2="5.5" stroke="#633806" stroke-width="1.6" stroke-linecap="round"/>`
  },
  {
    id: 'porteria',
    lbl: 'Portería',
    sub: 'Acceso conjunto',
    f: '#C0DD97',
    s: '#3B6D11',
    d: `<rect x="12" y="6.5" width="2.5" height="10" rx="1" fill="#27500A"/>
<rect x="14.5" y="9" width="8" height="2.2" rx="1" fill="#27500A"/>
<line x1="15.5" y1="9" x2="14.5" y2="11.2" stroke="#C0DD97" stroke-width="0.9" opacity="0.8"/>
<line x1="17.5" y1="9" x2="16.5" y2="11.2" stroke="#C0DD97" stroke-width="0.9" opacity="0.8"/>
<line x1="19.5" y1="9" x2="18.5" y2="11.2" stroke="#C0DD97" stroke-width="0.9" opacity="0.8"/>
<circle cx="14.5" cy="10.1" r="1.6" fill="#27500A" stroke="#3B6D11" stroke-width="0.8"/>
<line x1="11" y1="16.5" x2="23" y2="16.5" stroke="#27500A" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/>`
  },
  {
    id: 'casa',
    lbl: 'Casa FTTH',
    sub: 'Acometida residencial',
    f: '#B5D4F4',
    s: '#185FA5',
    d: `<polygon points="16,5 22,10.5 10,10.5" fill="#0C447C" opacity="0.45"/>
<polygon points="16,5 22,10.5 10,10.5" fill="none" stroke="#0C447C" stroke-width="1" stroke-linejoin="round"/>
<rect x="11" y="10.5" width="10" height="6.5" fill="none" stroke="#0C447C" stroke-width="1.1"/>
<rect x="14.5" y="13" width="3" height="4" rx="0.5" fill="#0C447C" opacity="0.5"/>
<rect x="11.5" y="11.2" width="3" height="2.5" rx="0.5" fill="none" stroke="#0C447C" stroke-width="0.8" opacity="0.7"/>`
  },
  {
    id: 'ont',
    lbl: 'ONT / ONU',
    sub: 'Equipo del cliente',
    f: '#B5D4F4',
    s: '#185FA5',
    d: `<path d="M11,8.5 Q16,3.5 21,8.5" fill="none" stroke="#0C447C" stroke-width="1.4" stroke-linecap="round"/>
<path d="M12.5,10.5 Q16,7 19.5,10.5" fill="none" stroke="#0C447C" stroke-width="1.4" stroke-linecap="round"/>
<path d="M14,12.5 Q16,10.5 18,12.5" fill="none" stroke="#0C447C" stroke-width="1.4" stroke-linecap="round"/>
<circle cx="16" cy="13.5" r="1.1" fill="#0C447C"/>
<rect x="13" y="14.5" width="6" height="2" rx="0.8" fill="#0C447C" opacity="0.4"/>`
  },
  {
    id: 'edificio',
    lbl: 'Edificio corp.',
    sub: 'Red corporativa',
    f: '#CECBF6',
    s: '#534AB7',
    d: `<rect x="11" y="6" width="10" height="11" rx="0.8" fill="none" stroke="#3C3489" stroke-width="1.2"/>
<rect x="12.2" y="7.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="15.2" y="7.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="18.2" y="7.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="12.2" y="10.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="15.2" y="10.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="18.2" y="10.3" width="2.5" height="2" rx="0.4" fill="#3C3489" opacity="0.6"/>
<rect x="14.5" y="13.5" width="3" height="3.5" rx="0.5" fill="#3C3489" opacity="0.45"/>`
  },
  {
    id: 'poste',
    lbl: 'Poste',
    sub: 'Planta aérea',
    f: '#D3D1C7',
    s: '#5F5E5A',
    d: `<line x1="16" y1="5.5" x2="16" y2="16.5" stroke="#444441" stroke-width="2" stroke-linecap="round"/>
<line x1="11.5" y1="8.5" x2="20.5" y2="8.5" stroke="#444441" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="12" cy="8.5" r="1.3" fill="none" stroke="#444441" stroke-width="1.1"/>
<circle cx="20" cy="8.5" r="1.3" fill="none" stroke="#444441" stroke-width="1.1"/>
<path d="M12,8.5 Q11,11 10.5,16.5" fill="none" stroke="#444441" stroke-width="0.8" stroke-dasharray="2 1.5" opacity="0.5"/>
<path d="M20,8.5 Q21,11 21.5,16.5" fill="none" stroke="#444441" stroke-width="0.8" stroke-dasharray="2 1.5" opacity="0.5"/>`
  },
  {
    id: 'ducto',
    lbl: 'Ducto FO',
    sub: 'Canalización',
    f: '#D3D1C7',
    s: '#5F5E5A',
    d: `<circle cx="16" cy="11" r="6.5" fill="none" stroke="#444441" stroke-width="1.2"/>
<circle cx="16" cy="11" r="4" fill="none" stroke="#444441" stroke-width="0.8" opacity="0.5"/>
<circle cx="16" cy="11" r="1.5" fill="#444441" opacity="0.75"/>
<circle cx="13" cy="9.5" r="1.2" fill="none" stroke="#444441" stroke-width="0.8" opacity="0.5"/>
<circle cx="19" cy="9.5" r="1.2" fill="none" stroke="#444441" stroke-width="0.8" opacity="0.5"/>
<circle cx="13" cy="12.5" r="1.2" fill="none" stroke="#444441" stroke-width="0.8" opacity="0.5"/>
<circle cx="19" cy="12.5" r="1.2" fill="none" stroke="#444441" stroke-width="0.8" opacity="0.5"/>`
  },
  {
    id: 'empalme',
    lbl: 'Empalme',
    sub: 'Fusión y bandeja FO',
    f: '#FAC775',
    s: '#854F0B',
    d: `<line x1="9.5" y1="11" x2="13.5" y2="11" stroke="#633806" stroke-width="1.6" stroke-linecap="round"/>
<line x1="18.5" y1="11" x2="22.5" y2="11" stroke="#633806" stroke-width="1.6" stroke-linecap="round"/>
<rect x="13.5" y="8.5" width="5" height="5" rx="1.2" fill="#FAC775" stroke="#633806" stroke-width="1.2"/>
<line x1="13.5" y1="8.5" x2="18.5" y2="13.5" stroke="#633806" stroke-width="0.8" opacity="0.5"/>
<line x1="18.5" y1="8.5" x2="13.5" y2="13.5" stroke="#633806" stroke-width="0.8" opacity="0.5"/>
<line x1="9.5" y1="9" x2="9.5" y2="13" stroke="#633806" stroke-width="0.9" stroke-linecap="round" opacity="0.45"/>
<line x1="22.5" y1="9" x2="22.5" y2="13" stroke="#633806" stroke-width="0.9" stroke-linecap="round" opacity="0.45"/>`
  },
  {
    id: 'camara',
    lbl: 'Cámara',
    sub: 'Registro subterráneo',
    f: '#D3D1C7',
    s: '#5F5E5A',
    d: `<rect x="10" y="7.5" width="12" height="8" rx="1.5" fill="none" stroke="#444441" stroke-width="1.2"/>
<line x1="16" y1="7.5" x2="16" y2="15.5" stroke="#444441" stroke-width="0.8" opacity="0.45"/>
<line x1="10" y1="11.5" x2="22" y2="11.5" stroke="#444441" stroke-width="0.8" opacity="0.45"/>
<rect x="11.5" y="8.8" width="3.5" height="2.5" rx="0.5" fill="#444441" opacity="0.3"/>
<rect x="17" y="8.8" width="3.5" height="2.5" rx="0.5" fill="#444441" opacity="0.3"/>
<rect x="11.5" y="12.3" width="3.5" height="2.5" rx="0.5" fill="#444441" opacity="0.3"/>
<rect x="17" y="12.3" width="3.5" height="2.5" rx="0.5" fill="#444441" opacity="0.3"/>
<line x1="12.5" y1="15.5" x2="11" y2="17.5" stroke="#444441" stroke-width="1.1" stroke-linecap="round" opacity="0.5"/>
<line x1="19.5" y1="15.5" x2="21" y2="17.5" stroke="#444441" stroke-width="1.1" stroke-linecap="round" opacity="0.5"/>`
  }
];

/**
 * @param {string} id
 * @returns {FtthMapIcon | undefined}
 */
export function getFtthMapIcon(id) {
  return FTTH_MAP_ICONS.find((ic) => ic.id === id);
}

/**
 * SVG completo del pin (misma composición que `pinSVG` / `codeStr` del HTML de referencia).
 * @param {FtthMapIcon} ic
 * @param {{ xmlDeclaration?: boolean }} [opts]
 */
export function pinSvgString(ic, opts = {}) {
  const inner = ic.d.trim();
  const svg = `<svg viewBox="0 0 32 40" width="32" height="40" xmlns="http://www.w3.org/2000/svg">
  <!-- ${ic.lbl} — ${ic.sub} -->
  <path d="${FTTH_MAP_PIN_PATH}" fill="${ic.f}" stroke="${ic.s}" stroke-width="0.8"/>
  <circle cx="16" cy="11" r="7" fill="white" opacity="0.93"/>
  ${inner}
</svg>`;
  if (opts.xmlDeclaration) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
  }
  return svg;
}
