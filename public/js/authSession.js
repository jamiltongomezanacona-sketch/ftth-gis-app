/** Clave en sessionStorage para la “sesión” del visor (sin cookies). */
export const AUTH_STORAGE_KEY = 'ftth-gis-auth';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** @returns {{ token: string, email: string, at: number } | null} */
export function getAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.token !== 'string' || typeof o.email !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

export function setAuthSession({ token, email }) {
  sessionStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      token: String(token),
      email: String(email),
      at: Date.now()
    })
  );
}

export function clearAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    /* */
  }
}

export function isAuthenticated() {
  const a = getAuthSession();
  if (!a?.token || !a?.email) return false;
  if (Date.now() - (a.at || 0) > MAX_AGE_MS) {
    clearAuthSession();
    return false;
  }
  return true;
}
