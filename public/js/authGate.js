import { isAuthenticated, setAuthSession } from './authSession.js';

let deferredInstallPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
}

function getOrCreateRoot() {
  let el = document.getElementById('auth-gate-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-gate-root';
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}

function dismiss(root) {
  root.classList.remove('auth-gate-root--visible');
  root.innerHTML = '';
  document.body.classList.remove('auth-gate-open');
}

/**
 * Muestra la tarjeta de acceso hasta login correcto (o sesión ya válida en sessionStorage).
 * @param {string} [apiBase]
 * @returns {Promise<void>}
 */
export async function ensureAuthenticated(apiBase = '') {
  if (isAuthenticated()) return;

  const base = String(apiBase ?? '').replace(/\/$/, '');
  const root = getOrCreateRoot();
  document.body.classList.add('auth-gate-open');
  root.classList.add('auth-gate-root', 'auth-gate-root--visible');

  root.innerHTML = `
<div class="auth-gate" role="dialog" aria-modal="true" aria-labelledby="auth-title">
  <div class="auth-card">
    <div class="auth-card-brand">
      <div class="auth-card-logo" aria-hidden="true">
        <img src="/icons/ui/layers.svg" width="34" height="34" alt="" decoding="async" />
      </div>
    </div>
    <h1 id="auth-title" class="auth-card-title">VISOR GIS</h1>
    <p class="auth-card-sub">Inicia sesión para continuar</p>
    <button type="button" class="auth-btn-install" id="auth-install">Instalar app</button>
    <form id="auth-form" class="auth-form" novalidate>
      <div id="auth-error" class="auth-error" role="alert" aria-live="polite"></div>
      <label class="auth-field-label">
        <span class="auth-sr-only">Correo electrónico</span>
        <input class="auth-input" type="email" name="email" autocomplete="username" id="auth-email" placeholder="correo@empresa.com" required />
      </label>
      <div class="auth-pass-wrap">
        <label class="auth-field-label auth-field-label--pass">
          <span class="auth-sr-only">Contraseña</span>
          <input class="auth-input" type="password" name="password" autocomplete="current-password" id="auth-password" placeholder="Contraseña" required minlength="4" />
        </label>
        <button type="button" class="auth-pass-toggle" id="auth-toggle-pass" aria-label="Mostrar u ocultar contraseña" title="Mostrar contraseña">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 5C7.36 5 3.29 7.69 2 12c1.29 4.31 5.36 7 10 7s8.71-2.69 10-7c-1.29-4.31-5.36-7-10-7zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <button type="submit" class="auth-submit" id="auth-submit">Iniciar sesión</button>
    </form>
    <div class="auth-card-foot">
      <button type="button" class="auth-link" id="auth-register">Crear cuenta</button>
      <span class="auth-dot" aria-hidden="true">·</span>
      <button type="button" class="auth-link" id="auth-forgot">¿Olvidaste tu contraseña?</button>
    </div>
  </div>
</div>`;

  const form = /** @type {HTMLFormElement} */ (root.querySelector('#auth-form'));
  const errEl = /** @type {HTMLDivElement} */ (root.querySelector('#auth-error'));
  const emailIn = /** @type {HTMLInputElement} */ (root.querySelector('#auth-email'));
  const passIn = /** @type {HTMLInputElement} */ (root.querySelector('#auth-password'));
  const toggleBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#auth-toggle-pass'));
  const installBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#auth-install'));
  const regBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#auth-register'));
  const forgotBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#auth-forgot'));

  const setFootMsg = (msg) => {
    errEl.textContent = msg;
  };

  regBtn?.addEventListener('click', () =>
    setFootMsg(
      'Altas: el administrador ejecuta en el servidor sql/09_gis_users.sql y npm run user:add -- correo@dominio.com "clave". En local sin usuarios en BD se usa modo desarrollo (correo válido + contraseña ≥ 4 caracteres).'
    )
  );
  forgotBtn?.addEventListener('click', () =>
    setFootMsg('Recuperación de contraseña no está configurada en esta instalación.')
  );

  let passVisible = false;
  toggleBtn?.addEventListener('click', () => {
    passVisible = !passVisible;
    passIn.type = passVisible ? 'text' : 'password';
    toggleBtn.setAttribute('aria-label', passVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    toggleBtn.setAttribute('title', passVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    toggleBtn.classList.toggle('auth-pass-toggle--on', passVisible);
  });

  installBtn?.addEventListener('click', async () => {
    const ev = deferredInstallPrompt;
    if (!ev) {
      setFootMsg('Instalación PWA no disponible en este navegador o la app ya está instalada.');
      return;
    }
    try {
      ev.prompt();
      await ev.userChoice;
    } catch {
      setFootMsg('No se pudo abrir el instalador.');
    }
    deferredInstallPrompt = null;
  });

  return new Promise((resolve) => {
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errEl.textContent = '';
      const email = emailIn.value.trim();
      const password = passIn.value;
      const url = `${base}/api/auth/login`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email, password }),
          cache: 'no-store'
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          /* */
        }
        if (!res.ok) {
          errEl.textContent = data?.error || `Error ${res.status}`;
          return;
        }
        if (!data?.token || !data?.email) {
          errEl.textContent = 'Respuesta del servidor incompleta.';
          return;
        }
        setAuthSession({ token: data.token, email: data.email });
        dismiss(root);
        resolve();
      } catch {
        errEl.textContent = 'No se pudo contactar el servidor. Comprueba la red o el origen del API.';
      }
    });
  });
}
