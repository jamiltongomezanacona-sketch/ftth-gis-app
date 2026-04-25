/** Clave en sessionStorage: solo metadatos de UI (correo); el JWT va en cookie httpOnly. */
export const AUTH_STORAGE_KEY = 'ftth-gis-auth';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @returns {{ email: string, at: number, token?: string } | null}
 * `token` solo en sesiones antiguas (antes de cookie httpOnly); no guardar en nuevos logins.
 */
export function getAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.email !== 'string') return null;
    return {
      email: o.email,
      at: typeof o.at === 'number' ? o.at : 0,
      ...(typeof o.token === 'string' && o.token.length > 0 ? { token: o.token } : {})
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ email: string, token?: string }} p sin `token` en el flujo normal (sesión solo por cookie).
 */
export function setAuthSession({ email, token }) {
  const payload = {
    email: String(email),
    at: Date.now()
  };
  if (token != null && String(token).length > 0) {
    payload.token = String(token);
  }
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
}

export function clearAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* */
  }
}

/** Hay datos de sesión recientes (correo y/o token legado). No garantiza que la cookie siga válida. */
export function isAuthenticated() {
  const a = getAuthSession();
  if (!a?.email) return false;
  if (Date.now() - (a.at || 0) > MAX_AGE_MS) {
    clearAuthSession();
    return false;
  }
  return true;
}

/**
 * Cierra sesión en servidor (borra cookie httpOnly) y limpia almacenamiento local.
 * @param {string} [apiBase] mismo criterio que `ensureAuthenticated` (origen del API)
 */
export async function logoutSession(apiBase = '') {
  const base = String(apiBase ?? '').replace(/\/$/, '');
  const url = base ? `${base}/api/auth/logout` : '/api/auth/logout';
  try {
    await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
  } catch {
    /* */
  }
  clearAuthSession();
}
