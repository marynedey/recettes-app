// Accueil (raccourcis), Recettes (grille ou liste alphabétique), Favoris.

import * as store from '../store.js';
import * as C from '../courses.js';
import { CATEGORIES, sansAccents } from '../format.js';
import { esc, icon, carteRecette, ligneRecette, chargerPhotos, tempsTotal, toast } from '../ui.js';

const norm = s => sansAccents(s).toLowerCase();

function correspond(r, q) {
  if (!q) return true;
  const foin = norm([r.meta.titre, r.meta.categorie, ...(r.meta.tags || []),
    ...r.ingredients.flatMap(g => g.items.map(i => i.name))].join(' '));
  return norm(q).split(/\s+/).filter(Boolean).every(m => foin.includes(m));
}

function salutation() {
  const h = new Date().getHours();
  const prenom = store.reglages().prenom;
  return (h >= 18 || h < 4 ? 'Bonsoir' : 'Bonjour') + (prenom ? ' ' + prenom : '');
}

const fab = () => `<a class="fab" href="#/ajouter">${icon('plus')}Ajouter</a>`;

function bannieres() {
  let html = '';
  for (const imp of store.importsEnAttente()) {
    html += `<div class="banniere"><span class="spinner"></span><div class="txt"><strong>Import en cours…</strong>
      <span class="aide">${esc(new URL(imp.url).hostname.replace(/^www\./, ''))} · environ 1 minute</span></div>
      <button class="btn-rond" data-annuler="${esc(imp.id)}" aria-label="Annuler l'import">${icon('x')}</button></div>`;
  }
  const err = sessionStorage.getItem('mr.importErreur');
  if (err) {
    const e = JSON.parse(err);
    html += `<div class="banniere erreur"><div class="txt"><strong>L'import n'a pas fonctionné</strong>
      <span class="aide">${esc(e.message || 'Erreur inconnue')}</span></div>
      <a class="bouton petit" href="#/ajouter?manuel=1&url=${encodeURIComponent(e.url)}" data-oublier>Saisir</a>
      <button class="btn-rond" data-oublier aria-label="Fermer">${icon('x')}</button></div>`;
  }
  return html;
}

function brancherBannieres(root) {
  root.querySelectorAll('[data-annuler]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Annuler cet import ?')) return;
    b.closest('.banniere').remove();
    try { await store.annulerImport(b.dataset.annuler); toast('Import annulé'); }
    catch (err) { toast(err.message, 4000); }
  }));
  root.querySelectorAll('[data-oublier]').forEach(b => b.addEventListener('click', () => {
    sessionStorage.removeItem('mr.importErreur');
    if (b.tagName === 'BUTTON') b.closest('.banniere').remove();
  }));
}

function nonConfigure() {
  return `<div class="vide"><div class="serif">Bienvenue !</div>
    <p>Pour retrouver vos recettes, connectez l'app à votre dépôt GitHub privé.</p>
    <a class="bouton" href="#/reglages">${icon('settings')}Ouvrir les réglages</a></div>`;
}

// Tris proposés sur l'écran Recettes (le choix est retenu sur le téléphone).
const TRIS = [['alpha', 'A → Z'], ['rapide', 'Plus rapides'], ['recente', 'Plus récentes'], ['ancienne', 'Plus anciennes']];

/** Trie la liste sur place. Durée inconnue : en dernier ; à égalité, ordre alphabétique. */
export function trier(liste, tri) {
  const alpha = (a, b) => a.meta.titre.localeCompare(b.meta.titre, 'fr');
  const duree = r => tempsTotal(r) || Infinity;
  const date = r => String(r.meta.ajoutee || '');
  const comparer = {
    rapide: (a, b) => duree(a) - duree(b) || alpha(a, b),
    recente: (a, b) => date(b).localeCompare(date(a)) || alpha(a, b),
    ancienne: (a, b) => date(a).localeCompare(date(b)) || alpha(a, b),
  }[tri] || alpha;
  return liste.sort(comparer);
}

/** Articles de la liste de courses qu'il reste à acheter (même calcul que l'écran Courses). */
function resteAAcheter() {
  const e = C.etat();
  const prevues = e.prevues.map(p => ({ ...p, recette: store.recette(p.slug) })).filter(p => p.recette);
  return C.listeDeCourses(prevues, e.ajouts).filter(a => !C.estMasque(a, e.masques)).filter(a => {
    const s = e.articles[a.cle] || {};
    const m = C.manque(a, s.dispo);
    return !s.coche && !(m && m.n === 0);
  }).length;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function tuile(href, ic, titre, detail, cls = '') {
  return `<a class="tuile ${cls}" href="${href}"><span class="tuile-icone">${icon(ic)}</span>
    <span class="tuile-txt"><b>${esc(titre)}</b><small>${esc(detail)}</small></span></a>`;
}

// Accueil : des raccourcis vers les écrans de l'app ; la recherche affiche ses résultats à la place.
export function accueil(root) {
  let q = sessionStorage.getItem('mr.rechercheAccueil') || '';
  const toutes = store.recettes();
  root.className = 'page';
  root.innerHTML = `
    <div class="entete">
      <div><p class="salut">${esc(salutation())}</p><h1 class="grand-titre">Qu'est-ce qu'on cuisine ce soir&nbsp;?</h1></div>
      <a class="btn-rond" href="#/reglages" aria-label="Réglages">${icon('settings')}</a>
    </div>
    <label class="recherche">${icon('search')}<span class="sr">Rechercher</span>
      <input type="search" placeholder="Recette, ingrédient…" value="${esc(q)}" enterkeyhint="search"></label>
    <div id="bannieres">${bannieres()}</div>
    <div id="resultats"></div>`;
  brancherBannieres(root);

  const zone = root.querySelector('#resultats');
  const afficher = () => {
    sessionStorage.setItem('mr.rechercheAccueil', q);
    if (!store.estConfigure() && !toutes.length) { zone.innerHTML = nonConfigure(); return; }
    if (q.trim()) {
      const liste = trier(toutes.filter(r => correspond(r, q)), 'alpha');
      zone.innerHTML = `<div class="liste">${liste.map(ligneRecette).join('')
        || `<div class="vide"><p>Rien ne correspond à « ${esc(q)} ».</p></div>`}</div>`;
      chargerPhotos(zone, store.recette);
      return;
    }
    const nbFav = store.favoris().filter(s => store.recette(s)).length;
    const reste = resteAAcheter();
    const prevues = C.etat().prevues.length;
    zone.innerHTML = `<nav class="tuiles" aria-label="Raccourcis">
      <a class="tuile tuile-recettes" href="#/recettes"><span class="tuile-txt"><b>Mes recettes</b>
        <small>${toutes.length ? pluriel(toutes.length, 'recette') : 'Aucune pour l\'instant'}</small></span>${icon('chevron')}</a>
      ${tuile('#/courses', 'cart', 'Courses', reste ? `${reste} à acheter` : prevues ? 'Tout est prêt' : 'Liste vide')}
      ${tuile('#/favoris', 'heart', 'Favoris', nbFav ? pluriel(nbFav, 'recette') : 'Aucun pour l\'instant')}
      ${tuile('#/frigo', 'frigo', 'Avec ce que j\'ai', 'Selon mon frigo', 'tuile-frigo')}
      ${store.estConfigure() ? tuile('#/ajouter', 'plus', 'Ajouter', 'Par lien ou à la main', 'tuile-ajouter') : ''}
    </nav>`;
  };

  root.querySelector('input').addEventListener('input', e => { q = e.target.value; afficher(); });
  afficher();
  return C.surChangement(() => { if (!q.trim()) afficher(); });
}

// Recettes : toutes les recettes, en grille (catégories, tri) ou en liste alphabétique.
export function listeRecettes(root) {
  const etat = JSON.parse(sessionStorage.getItem('mr.filtre') || '{"q":"","cat":"Tout"}');
  let tri = 'alpha';
  let vue = 'grille';
  try { tri = localStorage.getItem('mr.tri') || 'alpha'; vue = localStorage.getItem('mr.vue') || 'grille'; } catch { /* stockage indisponible */ }
  const toutes = store.recettes();
  const cats = ['Tout', ...CATEGORIES.filter(c => toutes.some(r => r.meta.categorie === c)),
    ...[...new Set(toutes.map(r => r.meta.categorie))].filter(c => !CATEGORIES.includes(c))];
  if (!cats.includes(etat.cat)) etat.cat = 'Tout';

  root.className = 'page';
  root.innerHTML = `
    <div class="entete"><h1 class="titre-page">Recettes</h1>
      <div class="boutons-entete">
        <button class="btn-rond" id="vue" aria-pressed="${vue === 'liste'}" aria-label="Affichage en liste">${icon('liste')}</button>
        <button class="btn-rond" id="sync" aria-label="Synchroniser">${icon('refresh')}</button>
      </div></div>
    <label class="recherche">${icon('search')}<span class="sr">Rechercher</span>
      <input type="search" placeholder="Rechercher parmi ${pluriel(toutes.length, 'recette')}" value="${esc(etat.q)}" enterkeyhint="search"></label>
    <div class="puces" role="group" aria-label="Catégories">${cats.map(c =>
      `<button class="puce" aria-pressed="${c === etat.cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="bannieres">${bannieres()}</div>
    <div id="resultats"></div>
    ${store.estConfigure() ? fab() : ''}`;
  brancherBannieres(root);

  const resultats = root.querySelector('#resultats');
  const afficher = () => {
    sessionStorage.setItem('mr.filtre', JSON.stringify(etat));
    if (!store.estConfigure() && !toutes.length) { resultats.innerHTML = nonConfigure(); return; }
    const liste = toutes.filter(r => (etat.cat === 'Tout' || r.meta.categorie === etat.cat) && correspond(r, etat.q));
    trier(liste, vue === 'liste' ? 'alpha' : tri);
    const titre = !etat.q && etat.cat === 'Tout' ? pluriel(liste.length, 'recette')
      : `${liste.length} résultat${liste.length > 1 ? 's' : ''}`;
    let html = `<div class="section-tete"><h2>${titre}</h2>
      ${vue === 'grille' ? `<label class="tri">${icon('tri')}<span class="sr">Trier</span>
        <select id="tri">${TRIS.map(([v, lib]) => `<option value="${v}" ${v === tri ? 'selected' : ''}>${lib}</option>`).join('')}</select></label>` : ''}</div>`;
    if (liste.length && vue === 'liste') {
      let lettre = '';
      html += `<div class="liste">${liste.map(r => {
        const l = sansAccents(r.meta.titre[0] || '#').toUpperCase();
        const tete = l !== lettre ? `<div class="lettre">${esc(l)}</div>` : '';
        lettre = l;
        return tete + ligneRecette(r);
      }).join('')}</div>`;
    } else if (liste.length) html += `<div class="grille">${liste.map(carteRecette).join('')}</div>`;
    else if (!toutes.length) html += `<div class="vide"><div class="serif">Aucune recette pour l'instant</div><p>Synchronisation en cours, ou ajoutez votre première recette.</p></div>`;
    else html += `<div class="vide"><p>Rien ne correspond à « ${esc(etat.q)} ».</p></div>`;
    resultats.innerHTML = html;
    chargerPhotos(resultats, store.recette);
  };

  root.querySelector('input').addEventListener('input', e => { etat.q = e.target.value; afficher(); });
  resultats.addEventListener('change', e => {
    if (e.target.id !== 'tri') return;
    tri = e.target.value;
    try { localStorage.setItem('mr.tri', tri); } catch { /* stockage indisponible */ }
    afficher();
  });
  root.querySelectorAll('.puce').forEach(b => b.addEventListener('click', () => {
    etat.cat = b.dataset.cat;
    root.querySelectorAll('.puce').forEach(x => x.setAttribute('aria-pressed', x === b));
    afficher();
  }));
  root.querySelector('#vue').addEventListener('click', e => {
    vue = vue === 'liste' ? 'grille' : 'liste';
    e.currentTarget.setAttribute('aria-pressed', vue === 'liste');
    try { localStorage.setItem('mr.vue', vue); } catch { /* stockage indisponible */ }
    afficher();
  });
  root.querySelector('#sync').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await store.synchroniser(); } catch (err) { alert(err.message); }
    b.disabled = false; b.innerHTML = icon('refresh');
  });
  afficher();
}

export function favorisVue(root) {
  const liste = store.favoris().map(store.recette).filter(Boolean);
  root.className = 'page';
  root.innerHTML = `<h1 class="titre-page">Favoris</h1>
    ${liste.length ? `<div class="grille" style="margin-top:20px">${liste.map(carteRecette).join('')}</div>`
      : `<div class="vide"><div class="serif">Pas encore de favoris</div><p>Touchez le ${icon('heart')} sur une recette pour la retrouver ici.</p></div>`}`;
  chargerPhotos(root, store.recette);
}
