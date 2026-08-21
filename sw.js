// Offline shell cache. Stale-while-revalidate so a deploy is picked up on the
// next load without ever leaving the user staring at a broken page.

const VERSION = 'v1';
const CACHE = `todo-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'assets/styles.css',
  'assets/icon.svg',
  'manifest.webmanifest',
  'src/main.js',
  'src/store.js',
  'src/model.js',
  'src/query.js',
  'src/dates.js',
  'src/dom.js',
  'src/dnd.js',
  'src/persist.js',
  'src/quickadd.js',
  'src/ui/list.js',
  'src/ui/sidebar.js',
  'src/ui/toast.js',
  'src/ui/dialog.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
