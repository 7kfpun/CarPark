// PWA glue: service-worker registration, "update ready" detection and the install prompt.

/** The non-standard Chrome/Edge install event. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** True when running as an installed app (no point offering install then). */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return (
    win.matchMedia('(display-mode: standalone)').matches ||
    win.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  );
}

/** A worker is an update only when an older one already controls the page (first install is not an update). */
export function isUpdateWaiting(reg: Pick<ServiceWorkerRegistration, 'waiting'>, hasController: boolean): boolean {
  return hasController && reg.waiting !== null;
}

export interface PwaHooks {
  /** An updated service worker is installed and waiting. */
  onUpdateReady(): void;
  /** The browser allows installing; call the returned function (from a click) to show its prompt. */
  onInstallable(install: () => Promise<void>): void;
  onInstalled(): void;
}

let waiting: ServiceWorker | null = null;

/** Tells the waiting worker to take over; the page reloads when it does. False when nothing is waiting. */
export function activateUpdate(): boolean {
  if (!waiting) return false;
  waiting.postMessage('SKIP_WAITING');
  return true;
}

export function initPwa(hooks: PwaHooks): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (isStandalone()) return;
    const ev = e as InstallPromptEvent;
    hooks.onInstallable(async () => {
      await ev.prompt();
      await ev.userChoice;
    });
  });
  window.addEventListener('appinstalled', () => hooks.onInstalled());

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // ignore the first claim on a fresh install
    reloading = true;
    location.reload();
  });
  const track = (reg: ServiceWorkerRegistration): void => {
    const check = (): void => {
      if (isUpdateWaiting(reg, navigator.serviceWorker.controller !== null)) {
        waiting = reg.waiting;
        hooks.onUpdateReady();
      }
    };
    check();
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', check);
    });
    document.addEventListener('visibilitychange', () => !document.hidden && void reg.update().catch(() => undefined));
  };
  navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI).href)
    .then(track)
    .catch(() => undefined); // never break the game over a worker
}
