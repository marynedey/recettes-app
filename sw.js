// Service worker : met l'application en cache pour un usage hors ligne.
// Les recettes et photos sont gérées par l'app elle-même (localStorage + Cache API).
const VERSION = 'mr-app-1.10.1'; // = version de l'app (js/views/reglages.js)
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/courses.js', 'js/format.js', 'js/github.js', 'js/minuteurs.js', 'js/push.js', 'js/store.js', 'js/ui.js',
  'js/views/listes.js', 'js/views/courses.js', 'js/views/fiche.js', 'js/views/cuisine.js', 'js/views/editer.js', 'js/views/reglages.js',
  'fonts/fraunces.woff2', 'fonts/inter.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-minuteur.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
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

// Toucher la notification d'un minuteur ramène à l'app, sur le mode cuisine de la recette.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenetres => {
    const f = fenetres[0];
    if (!f) return self.clients.openWindow(url.href);
    f.postMessage({ aller: url.hash });
    return f.focus();
  }));
});

// Fin d'un minuteur signalée par le serveur des minuteurs (notification sans contenu,
// reçue même app fermée) : la copie gardée par l'app dit quel minuteur est terminé.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const reg = self.registration;
    let tous = {};
    try { tous = await (await caches.match(new URL('minuteurs.json', reg.scope).href)).json(); } catch { /* pas de copie */ }
    // Terminés à l'instant (l'app, si elle est ouverte, a pu le noter juste avant).
    const finis = Object.values(tous).filter(m => (m.fin !== null && !m.fini && m.fin <= Date.now() + 5000)
      || (m.fini && Date.now() - (m.finiA || 0) < 120e3));
    const commun = { icon: 'icons/icon-192.png', badge: 'icons/badge-minuteur.png', requireInteraction: true, vibrate: [400, 200, 400, 200, 400] };
    if (!finis.length) {
      await reg.showNotification('⏰ Minuteur terminé', { ...commun, tag: 'minuteur', body: 'Mes Recettes' });
      return;
    }
    for (const m of finis) {
      // Déjà sonné (deux minuteurs proches) : on le réaffiche sans sonner une seconde fois.
      const deja = (await reg.getNotifications({ tag: m.id })).some(n => n.title.startsWith('⏰'));
      await reg.showNotification(`⏰ ${m.titre} · étape ${m.etape + 1} : c'est prêt !`, {
        ...commun, tag: m.id, body: m.label, renotify: !deja, silent: deja,
        data: { url: `#/cuisine/${encodeURIComponent(m.slug)}?e=${m.etape}` },
      });
    }
  })());
});
