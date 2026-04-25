/**
 * PWA: un solo manejador de `beforeinstallprompt`.
 * `preventDefault()` exige ofrecer `event.prompt()` con gesto de usuario, o el DevTools
 * de Chromium muestra «Banner not shown: … must call .prompt()».
 */

/** @type {Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null} */
let deferredInstallPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
  });
}

/**
 * Invoca el diálogo de instalación (solo con gesto de usuario).
 * @returns {Promise<{ outcome: 'accepted' | 'dismissed' } | 'no-prompt' | 'error'>}
 */
export async function runPwaInstallPrompt() {
  const ev = deferredInstallPrompt;
  if (!ev) {
    return 'no-prompt';
  }
  try {
    ev.prompt();
    const { outcome } = await ev.userChoice;
    deferredInstallPrompt = null;
    return { outcome };
  } catch {
    return 'error';
  }
}

/** @returns {boolean} */
export function isPwaInstallPromptAvailable() {
  return Boolean(deferredInstallPrompt);
}
