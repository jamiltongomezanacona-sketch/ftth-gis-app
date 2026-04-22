/**
 * GIS Dashboard — lógica UI (vanilla ES module).
 * Preparado para: Mapbox GL, fetch a APIs propias, WebSocket estado.
 */

const DASH_STORAGE_KEY = 'gis-dash-sidebar-collapsed';
const MOBILE_SIDEBAR_BREAKPOINT = 900;

/** Iconos estilo stroke (Heroicons / Lucide-like), 24x24 viewBox */
const ICONS = {
  layout:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z"/></svg>',
  home:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>',
  building:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
  wrench:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
  alert:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
  chart:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/></svg>',
  settings:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
  bell:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>',
  menu:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16"/></svg>',
  'chevron-left':
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>'
};

const KPI_ICONS = {
  alert:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>',
  wrench:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655-5.653a2.548 2.548 0 010-3.586L11.4 2.842a2.547 2.547 0 013.586 0l5.653 4.654a2.548 2.548 0 010 3.586L15.83 15.17"/></svg>',
  fiber:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>',
  pulse:
    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l2.25-3 2.25 4.5 2.25-7.5 2.25 4.5 2.25-3 2.25 3"/></svg>'
};

/**
 * @param {string} name
 * @param {Record<string, string>} map
 */
function injectIcons(selector, map) {
  document.querySelectorAll(selector).forEach((el) => {
    const name = el.getAttribute('data-icon') || el.getAttribute('data-kpi-icon');
    if (!name || !map[name]) return;
    el.innerHTML = map[name];
  });
}

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(DASH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(DASH_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function initSidebar() {
  const root = document.getElementById('dash-app');
  const btn = document.getElementById('btn-sidebar-collapse');
  if (!root || !btn) return;

  const apply = (collapsed) => {
    root.classList.toggle('is-sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    writeSidebarCollapsed(collapsed);
  };

  apply(readSidebarCollapsed());

  btn.addEventListener('click', () => {
    apply(!root.classList.contains('is-sidebar-collapsed'));
  });
}

function initMobileSidebar() {
  const root = document.getElementById('dash-app');
  const menuBtn = document.getElementById('btn-sidebar-menu');
  const nav = document.getElementById('dash-sidebar-nav');
  if (!root || !menuBtn || !nav) return;

  const setOpen = (open) => {
    root.classList.toggle('is-mobile-sidebar-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const isMobileViewport = () => window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches;

  if (!isMobileViewport()) setOpen(true);
  else setOpen(false);

  menuBtn.addEventListener('click', () => {
    setOpen(!root.classList.contains('is-mobile-sidebar-open'));
  });

  nav.querySelectorAll('.dash-nav__link').forEach((link) => {
    link.addEventListener('click', () => {
      if (isMobileViewport()) setOpen(false);
    });
  });

  window.addEventListener('resize', () => {
    if (isMobileViewport()) {
      setOpen(false);
      return;
    }
    setOpen(true);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMobileViewport()) {
      setOpen(false);
    }
  });
}

/** Simula ping API; sustituir por fetch('/api/db-check') o similar */
async function checkApiHealth() {
  const statusEl = document.getElementById('dash-api-status');
  if (!statusEl) return;

  const setOnline = () => {
    statusEl.classList.remove('is-offline');
    statusEl.querySelector('.dash-api-status__text').textContent = 'API online';
  };

  const setOffline = () => {
    statusEl.classList.add('is-offline');
    statusEl.querySelector('.dash-api-status__text').textContent = 'API offline';
  };

  try {
    const base = window.location.origin;
    const res = await fetch(`${base}/api/db-check`, { method: 'GET', cache: 'no-store' });
    if (res.ok) setOnline();
    else setOffline();
  } catch {
    setOffline();
  }
}

function initApiStatus() {
  void checkApiHealth();
  document.getElementById('dash-api-status')?.addEventListener('dblclick', () => {
    void checkApiHealth();
  });
}

function initDetailTabs() {
  const tabs = document.querySelectorAll('.dash-tab');
  const blocks = document.querySelectorAll('.dash-detail-block[data-panel]');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      if (!id) return;

      tabs.forEach((t) => {
        t.classList.toggle('dash-tab--active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });

      blocks.forEach((block) => {
        const match = block.getAttribute('data-panel') === id;
        block.classList.toggle('dash-detail-block--hidden', !match);
        block.toggleAttribute('hidden', !match);
      });
    });
  });

  const app = document.getElementById('dash-app');
  document.getElementById('btn-close-detail')?.addEventListener('click', () => {
    app?.classList.add('is-detail-hidden');
  });
  document.getElementById('btn-toggle-detail')?.addEventListener('click', () => {
    app?.classList.toggle('is-detail-hidden');
  });
}

/**
 * Barras horizontales simuladas (reemplazar por Chart.js / ECharts + datos API).
 * @param {string} containerId
 * @param {{ label: string; value: number }[]} series
 */
function renderBarChart(containerId, series) {
  const root = document.getElementById(containerId);
  if (!root) return;
  const max = Math.max(...series.map((s) => s.value), 1);

  root.innerHTML = '';
  series.forEach((s) => {
    const h = Math.round((s.value / max) * 100);
    const col = document.createElement('div');
    col.className = 'dash-bar';
    col.innerHTML = `
      <div class="dash-bar__fill" style="height:${Math.max(h, 8)}%"></div>
      <span class="dash-bar__label">${escapeHtml(s.label)}<br><strong>${s.value}</strong></span>
    `;
    root.appendChild(col);
  });
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Sparkline SVG simple (tendencia mock) */
function renderSparkline(containerId) {
  const root = document.getElementById(containerId);
  if (!root) return;

  const w = 400;
  const h = 120;
  const pts = [30, 45, 38, 62, 55, 70, 65, 78, 72, 85, 80, 92];
  const step = w / (pts.length - 1);
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const norm = (v) => h - 12 - ((v - min) / (max - min + 0.001)) * (h - 24);

  let d = `M 0 ${norm(pts[0])}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${i * step} ${norm(pts[i])}`;
  }

  root.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="dash-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(34,211,238,0.35)"/>
          <stop offset="100%" stop-color="rgba(34,211,238,0)"/>
        </linearGradient>
        <linearGradient id="dash-spark-line" x1="0" y1="0" x2="1" y2="0">
          <stop stop-color="#22d3ee"/><stop offset="1" stop-color="#3b82f6"/>
        </linearGradient>
      </defs>
      <path d="${d} L ${w} ${h} L 0 ${h} Z" fill="url(#dash-spark-fill)" />
      <path d="${d}" fill="none" stroke="url(#dash-spark-line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

function initMapToolButtons() {
  document.querySelectorAll('.dash-tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-tool-btn').forEach((b) => b.classList.remove('dash-tool-btn--active'));
      btn.classList.add('dash-tool-btn--active');
    });
  });
}

function initNotificationsDemo() {
  document.getElementById('btn-notifications')?.addEventListener('click', () => {
    // Hook: abrir drawer de notificaciones
    console.info('[dashboard] Notificaciones: conectar a API / SSE');
  });
}

function init() {
  injectIcons('[data-icon]', ICONS);
  injectIcons('[data-kpi-icon]', KPI_ICONS);
  initSidebar();
  initMobileSidebar();
  initApiStatus();
  initDetailTabs();
  initMapToolButtons();
  initNotificationsDemo();

  renderBarChart('chart-zones', [
    { label: 'Norte', value: 42 },
    { label: 'Centro', value: 28 },
    { label: 'Sur', value: 35 },
    { label: 'Occ.', value: 19 },
    { label: 'Or.', value: 24 }
  ]);
  renderSparkline('chart-spark');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
