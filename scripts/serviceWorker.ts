// Builds the service worker source. Emitted as dist/sw.js by vite.config.ts; pure so validate can test it.

/** Cache name for one build: a new build means a new cache, and old caches are deleted on activate. */
export function cacheName(build: string): string {
  return `park-it-${build}`;
}

/** Files precached at install: everything the shell and game need to start offline. */
export function precacheList(emitted: string[], extra: string[]): string[] {
  const skip = /(^|\/)(sw\.js|version\.json|CNAME)$|\.map$/;
  return [...new Set(['./', ...emitted, ...extra])].filter((f) => !skip.test(f)).sort();
}

export function serviceWorkerSource(build: string, files: string[]): string {
  return `// Generated at build time (scripts/serviceWorker.ts). Do not edit.
const CACHE = ${JSON.stringify(cacheName(build))};
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  // No skipWaiting here: the page asks for it (the "Update" button) so a level is never swapped mid-play.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('park-it-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // version.json must always be live: it is the update signal.
  if (new URL(req.url).pathname.endsWith('/version.json')) return;
  if (req.mode === 'navigate') {
    // Network first so a reload picks up a new build; fall back to the cached shell offline.
    event.respondWith(
      fetch(req).catch(() => caches.match(new URL('./index.html', self.registration.scope).href).then((r) => r || caches.match('./'))),
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)));
});
`;
}
