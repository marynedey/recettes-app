// Service worker : met l'application en cache pour un usage hors ligne.
// Les recettes et photos sont gérées par l'app elle-même (localStorage + Cache API).
const VERSION = 'mr-app-v4';
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/format.js', 'js/github.js', 'js/store.js', 'js/ui.js',
  'js/views/listes.js', 'js/views/fiche.js', 'js/views/cuisine.js', 'js/views/editer.js', 'js/views/reglages.js',
  'fonts/fraunces.woff2', 'fonts/inter.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(k => k.startsWith('mr-app-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache d'abord pour un démarrage instantané, mise à jour en arrière-plan
// (la nouvelle version est utilisée au lancement suivant).
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // ignoreSearch : le partage Android ouvre « ./?url=… ».
    const enCache = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    // no-cache : ne pas reprendre la copie du cache HTTP (GitHub Pages la garde 10 min).
    const reseau = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    }).catch(() => null);
    if (enCache) { e.waitUntil(reseau); return enCache; }
    return (await reseau) || (await cache.match('./')) || Response.error();
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => (l[0] ? l[0].focus() : self.clients.openWindow('./'))));
});
