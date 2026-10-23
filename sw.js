// Service worker : met l'application en cache pour un usage hors ligne.
// Les recettes et photos sont gérées par l'app elle-même (localStorage + Cache API).
const VERSION = 'mr-app-1.19.0'; // = version de l'app (js/views/reglages.js)
const FICHIERS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/courses.js', 'js/format.js', 'js/frigo.js', 'js/github.js', 'js/minuteurs.js', 'js/voix.js', 'js/push.js', 'js/store.js', 'js/ui.js',
  'js/views/listes.js', 'js/views/courses.js', 'js/views/fiche.js', 'js/views/cuisine.js', 'js/views/editer.js', 'js/views/reglages.js', 'js/views/frigo.js',
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

/* ---------- minuteurs ---------- */

// Copies écrites par l'app (le service worker n'a pas accès au localStorage) :
// minuteurs.json (les minuteurs), config.json (serveur des minuteurs), actions.json (à appliquer).
const DONNEES = 'mr-donnees';
const donnee = nom => new URL(nom, self.registration.scope).href;
const lire = async (nom, defaut) => { try { return (await (await caches.match(donnee(nom))).json()) ?? defaut; } catch { return defaut; } };
const ecrire = async (nom, valeur) => (await caches.open(DONNEES)).put(donnee(nom), new Response(JSON.stringify(valeur)));

const SONNERIE = { icon: 'icons/icon-192.png', badge: 'icons/badge-minuteur.png', requireInteraction: true, vibrate: [400, 200, 400, 200, 400, 200, 400] };
const BOUTONS = [{ action: 'arreter', title: 'Arrêter' }, { action: 'plus1', title: '+1 min' }];
const heure = ms => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Toucher une notification ramène à l'app, sur le mode cuisine de la recette ;
// ses boutons « Arrêter » et « +1 min » agissent sans ouvrir l'app.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data?.minuteur;
  if (id && (e.action === 'arreter' || e.action === 'plus1')) { e.waitUntil(actionMinuteur(e.action, id)); return; }
  const url = new URL(e.notification.data?.url || './', self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenetres => {
    const f = fenetres[0];
    if (!f) return self.clients.openWindow(url.href);
    f.postMessage({ aller: url.hash });
    return f.focus();
  }));
});

async function actionMinuteur(action, id) {
  // App ouverte (même en arrière-plan) : elle s'en charge.
  const fenetres = await self.clients.matchAll({ type: 'window' });
  if (fenetres.length) { fenetres.forEach(f => f.postMessage({ minuteur: { action, id } })); return; }

  // App fermée : on prévient le serveur, on met à jour la copie, et l'app appliquera l'action à sa réouverture.
  const fin = Date.now() + 60e3;
  const actions = await lire('actions.json', []);
  await ecrire('actions.json', [...actions, { id, action, fin }]);
  const tous = await lire('minuteurs.json', {});
  const m = tous[id];
  if (m) {
    Object.assign(m, action === 'arreter' ? { sonne: false } : { fini: false, sonne: false, finiA: null, fin, reste: 60, total: 60 });
    await ecrire('minuteurs.json', tous);
  }
  const { serveur, appareil } = await lire('config.json', {});
  const abonnement = await self.registration.pushManager.getSubscription().catch(() => null);
  if (serveur && appareil) {
    const adresse = `${serveur}/minuteurs/${encodeURIComponent(`${appareil}|${id}`)}`;
    await (action === 'arreter'
      ? fetch(adresse, { method: 'DELETE' })
      : abonnement && fetch(adresse, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adresse: abonnement.endpoint, fin }) })
    ).catch(() => {});
  }
  if (action === 'plus1' && m) {
    await self.registration.showNotification(`⏳ ${m.titre} · étape ${m.etape + 1} · prêt à ${heure(fin)}`, {
      icon: SONNERIE.icon, badge: SONNERIE.badge, tag: id, body: `${m.label} (+1 min)`, silent: true,
      data: { url: `#/cuisine/${encodeURIComponent(m.slug)}?e=${m.etape}`, minuteur: id },
    });
  }
}

// Fin d'un minuteur signalée par le serveur des minuteurs (notification sans contenu, reçue même
// app fermée, puis renvoyée toutes les 30 s pour sonner comme un réveil) : la copie gardée par
// l'app dit quel minuteur est terminé.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const reg = self.registration;
    const tous = await lire('minuteurs.json', {});
    // Terminés : à l'instant (l'app, si elle est ouverte, a pu le noter juste avant) ou qui sonnent encore.
    const finis = Object.values(tous).filter(m => (m.fin !== null && !m.fini && m.fin <= Date.now() + 5000)
      || (m.fini && m.sonne !== false && Date.now() - (m.finiA || 0) < 180e3));
    // App à l'écran : elle sonne déjà elle-même, la notification reste silencieuse.
    const visible = (await self.clients.matchAll({ type: 'window' })).some(f => f.visibilityState === 'visible');
    for (const m of finis) {
      // (Chrome refuse une notification à la fois silencieuse et vibrante.)
      await reg.showNotification(`⏰ ${m.titre} · étape ${m.etape + 1} : c'est prêt !`, {
        ...SONNERIE, ...(visible ? { vibrate: undefined, silent: true } : { renotify: true }), tag: m.id, body: m.label, actions: BOUTONS,
        data: { url: `#/cuisine/${encodeURIComponent(m.slug)}?e=${m.etape}`, minuteur: m.id },
      });
    }
    if (finis.length) return;
    // Rien à annoncer : notification d'essai des réglages, sinon un rappel déjà arrêté
    // (le navigateur exige d'afficher quelque chose : on l'efface aussitôt).
    const { essaiJusqua = 0 } = await lire('config.json', {});
    if (Date.now() < essaiJusqua) {
      await reg.showNotification('⏰ Minuteur terminé', { ...SONNERIE, tag: 'essai', body: 'Notification d\'essai : le serveur des minuteurs fonctionne.' });
      return;
    }
    await reg.showNotification('Minuteur', { tag: 'vide', silent: true });
    (await reg.getNotifications({ tag: 'vide' })).forEach(n => n.close());
  })());
});
