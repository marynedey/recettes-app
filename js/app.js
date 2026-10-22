// Point d'entrée : routeur par ancre (#/…), barre d'onglets, service worker.

import { icon, toast } from './ui.js';
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

const positions = new Map();

function rendre() {
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
    window.scrollTo(0, positions.get(location.hash) || 0);
    return;
  }
  location.replace('#/');
}

window.addEventListener('hashchange', rendre);
window.addEventListener('scroll', () => positions.set(location.hash, window.scrollY), { passive: true });

window.addEventListener('hashchange', () => sessionStorage.setItem('mr.nav', '1'));

// « Partager → Mes Recettes » (share_target) : ?url=…&text=…
function partageEntrant() {
  const q = new URLSearchParams(location.search);
  if (!q.has('url') && !q.has('text') && !q.has('title')) return;
  const brut = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  const url = (brut.match(/https?:\/\/[^\s]+/) || [''])[0];
  history.replaceState(null, '', location.pathname + '#/ajouter' + (url ? `?url=${encodeURIComponent(url)}` : ''));
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
      if (e.data?.aller && location.hash !== e.data.aller) location.hash = e.data.aller;
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
