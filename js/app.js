// Point d'entrée : routeur par ancre (#/…), barre d'onglets, service worker.

import { esc, icon, toast } from './ui.js';
import * as M from './minuteurs.js';
import * as store from './store.js';
import { accueil, listeRecettes, favorisVue } from './views/listes.js';
import { courses } from './views/courses.js';
import { fiche } from './views/fiche.js';
import { cuisine } from './views/cuisine.js';
import { editer, ajouter } from './views/editer.js';
import { reglagesVue } from './views/reglages.js';

const app = document.getElementById('app');
let nettoyage = null;

const ROUTES = [
  [/^\/?$/, accueil, 'accueil'],
  [/^\/recettes$/, listeRecettes, 'recettes'],
  [/^\/favoris$/, favorisVue, 'favoris'],
  [/^\/courses$/, courses, 'courses'],
  [/^\/recette\/([^/]+)$/, fiche],
  [/^\/cuisine\/([^/]+)$/, cuisine],
  [/^\/ajouter$/, ajouter],
  [/^\/modifier\/([^/]+)$/, editer],
  [/^\/reglages$/, reglagesVue],
];

const ONGLETS = [
  ['accueil', '#/', 'home', 'Accueil'],
  ['recettes', '#/recettes', 'book', 'Recettes'],
  ['favoris', '#/favoris', 'heart', 'Favoris'],
  ['courses', '#/courses', 'cart', 'Courses'],
];

function tabbar(actif) {
  return `<div class="tabbar"><nav aria-label="Navigation principale">${ONGLETS.map(([k, href, ic, lib]) =>
    `<a href="${href}"${k === actif ? ' aria-current="page"' : ''}>${icon(ic)}<span>${lib}</span></a>`).join('')}</nav></div>`;
}

export function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1) || '/');
  const [path, qs] = h.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

// Un écran s'ouvre toujours en haut ; seul le retour arrière retrouve la position d'avant.
// (Chrome déclenche aussi « popstate » pour une nouvelle ancre : on marque plutôt chaque
// entrée d'historique déjà affichée, et on ne retrouve la position que sur celles-là.)
const positions = new Map();
let dernierRendu = '';

function rendre() {
  // Après « Terminé » en mode cuisine, on arrive sur la fiche ; si « retour » ramène alors
  // au mode cuisine de cette recette, on va à l'accueil à la place.
  const apresCuisine = sessionStorage.getItem('mr.apresCuisine');
  if (apresCuisine && location.hash !== apresCuisine) {
    sessionStorage.removeItem('mr.apresCuisine');
    if (dernierRendu === apresCuisine && location.hash.startsWith('#/cuisine/')) { location.replace('#/'); return; }
  }
  dernierRendu = location.hash;
  const { path, query } = parseHash();
  if (nettoyage) { try { nettoyage(); } catch { /* ignore */ } nettoyage = null; }
  for (const [re, vue, onglet] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    const params = m.slice(1).map(decodeURIComponent);
    app.innerHTML = '';
    const page = document.createElement('div');
    app.appendChild(page);
    nettoyage = vue(page, { params, query, rerendre: rendre }) || null;
    if (onglet) app.insertAdjacentHTML('beforeend', tabbar(onglet));
    const dejaVue = !!history.state?.mr;
    window.scrollTo(0, dejaVue ? positions.get(location.hash) || 0 : 0);
    if (!dejaVue) history.replaceState({ ...history.state, mr: 1 }, '');
    return;
  }
  location.replace('#/');
}

window.addEventListener('hashchange', rendre);
window.addEventListener('scroll', () => positions.set(location.hash, window.scrollY), { passive: true });

window.addEventListener('hashchange', () => sessionStorage.setItem('mr.nav', '1'));

// Minuteur terminé, sur n'importe quel écran : bandeau « C'est prêt ! » (la sonnerie
// tourne en boucle dans minuteurs.js) avec « Arrêter » et « +1 min ».
function alarme() {
  let el = document.getElementById('alarme');
  // Dans le mode cuisine de la recette, son minuteur affiche déjà « Arrêter » et « +1 min ».
  const ici = (location.hash.match(/^#\/cuisine\/([^?]+)/) || [])[1];
  const liste = M.quiSonnent().filter(m => encodeURIComponent(m.slug) !== ici);
  if (!liste.length) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'alarme'; el.className = 'alarme'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', 'Minuteur terminé');
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      if (b.dataset.a === 'arreter') M.arreter(id); else M.prolonger(id, 60);
    });
    document.body.appendChild(el);
  }
  el.innerHTML = liste.map(m => `<div class="alarme-ligne" data-id="${esc(m.id)}">
      <div class="alarme-txt"><strong>⏰ C'est prêt !</strong><span>${esc(m.titre)} · étape ${m.etape + 1} · ${esc(m.label)}</span></div>
      <div class="alarme-btns"><button class="bouton secondaire petit" data-a="plus1">+1 min</button>
        <button class="bouton petit" data-a="arreter">${icon('stop')}Arrêter</button></div>
    </div>`).join('');
}
M.surChangement(alarme);
window.addEventListener('hashchange', alarme);
alarme();

// « Partager → Mes Recettes » (share_target) : ?url=…&text=…
function partageEntrant() {
  const q = new URLSearchParams(location.search);
  if (!q.has('url') && !q.has('text') && !q.has('title')) return;
  const brut = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  const url = (brut.match(/https?:\/\/[^\s]+/) || [''])[0];
  // Avec un lien, l'import part tout seul (auto=1) : rien à toucher après « Partager ».
  history.replaceState(null, '', location.pathname + '#/ajouter' + (url ? `?url=${encodeURIComponent(url)}&auto=1` : ''));
}

// Suivi des imports en attente.
let suiviImports = null;
function suivreImports() {
  if (suiviImports || !store.importsEnAttente().length) return;
  suiviImports = setInterval(async () => {
    if (document.hidden) return;
    const termines = await store.verifierImports().catch(() => []);
    for (const t of termines) {
      if (t.statut === 'ok') toast(`« ${t.titre || 'Recette'} » importée !`, 4000);
      else sessionStorage.setItem('mr.importErreur', JSON.stringify(t));
    }
    if (termines.length) rendreSiListe();
    if (!store.importsEnAttente().length) { clearInterval(suiviImports); suiviImports = null; }
  }, 8000);
}

function rendreSiListe() {
  const { path } = parseHash();
  if (['/', '', '/recettes', '/favoris'].includes(path)) rendre();
}

store.onChange(rendreSiListe);
window.addEventListener('mr:imports', suivreImports);

async function demarrer() {
  partageEntrant();
  rendre();
  if (store.estConfigure()) {
    store.synchroniser().catch(e => { if (e.status !== 0) toast(e.message, 4000); });
    suivreImports();
  }
  if ('serviceWorker' in navigator) {
    // Nouvelle version installée : on recharge une fois pour l'utiliser tout de suite.
    const avait = !!navigator.serviceWorker.controller;
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (avait && !recharge) { recharge = true; location.reload(); }
    });
    // Notification de minuteur touchée : le service worker demande d'aller sur la recette.
    navigator.serviceWorker.addEventListener('message', e => {
      const aller = e.data?.aller;
      if (!aller || location.hash === aller) return;
      const m = aller.match(/^#\/cuisine\/([^?]+)\?e=(\d+)/);
      // Déjà dans le mode cuisine de cette recette : on change juste d'étape
      // (rouvrir la page empilerait un second historique d'étapes).
      if (m && location.hash.split('?')[0] === `#/cuisine/${m[1]}`) {
        window.dispatchEvent(new CustomEvent('mr:etape', { detail: { slug: decodeURIComponent(m[1]), etape: Number(m[2]) } }));
      } else location.hash = aller;
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(e => console.warn('SW', e));
  }
}

window.addEventListener('online', () => store.estConfigure() && store.synchroniser().catch(() => {}));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && store.estConfigure()) {
    const d = store.derniereSync();
    if (!d || Date.now() - d > 5 * 60 * 1000) store.synchroniser().catch(() => {});
  }
});

demarrer();
