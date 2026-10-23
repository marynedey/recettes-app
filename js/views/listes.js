// Accueil, liste alphabétique, favoris, courses.

import * as store from '../store.js';
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

// Tris proposés sur l'accueil (le choix est retenu sur le téléphone).
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

export function accueil(root) {
  const etat = JSON.parse(sessionStorage.getItem('mr.filtre') || '{"q":"","cat":"Tout"}');
  let tri = 'alpha';
  try { tri = localStorage.getItem('mr.tri') || 'alpha'; } catch { /* stockage indisponible */ }
  const toutes = store.recettes();
  const cats = ['Tout', ...CATEGORIES.filter(c => toutes.some(r => r.meta.categorie === c)),
    ...[...new Set(toutes.map(r => r.meta.categorie))].filter(c => !CATEGORIES.includes(c))];
  if (!cats.includes(etat.cat)) etat.cat = 'Tout';

  root.className = 'page';
  root.innerHTML = `
    <div class="entete">
      <div><p class="salut">${esc(salutation())}</p><h1 class="grand-titre">Qu'est-ce qu'on cuisine ce soir&nbsp;?</h1></div>
      <a class="btn-rond" href="#/reglages" aria-label="Réglages">${icon('settings')}</a>
    </div>
    <label class="recherche">${icon('search')}<span class="sr">Rechercher</span>
      <input type="search" placeholder="Recette, ingrédient…" value="${esc(etat.q)}" enterkeyhint="search"></label>
    <a class="raccourci-frigo" href="#/frigo">${icon('frigo')}<span><b>Avec ce que j'ai</b><small>Mes ingrédients, et les recettes qui vont avec</small></span>${icon('arrow')}</a>
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
    trier(liste, tri);
    const titre = !etat.q && etat.cat === 'Tout' ? `Mes recettes <span class="aide">${liste.length}</span>`
      : `${liste.length} résultat${liste.length > 1 ? 's' : ''}`;
    let html = `<div class="section-tete"><h2>${titre}</h2>
      <label class="tri">${icon('tri')}<span class="sr">Trier</span>
        <select id="tri">${TRIS.map(([v, lib]) => `<option value="${v}" ${v === tri ? 'selected' : ''}>${lib}</option>`).join('')}</select></label></div>`;
    if (liste.length) html += `<div class="grille">${liste.map(carteRecette).join('')}</div>`;
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
  afficher();
}

export function listeRecettes(root) {
  const toutes = store.recettes();
  let q = '';
  root.className = 'page';
  root.innerHTML = `
    <div class="entete"><h1 class="titre-page">Recettes</h1>
      <button class="btn-rond" id="sync" aria-label="Synchroniser">${icon('refresh')}</button></div>
    <label class="recherche">${icon('search')}<span class="sr">Rechercher</span>
      <input type="search" placeholder="Rechercher parmi ${toutes.length} recette${toutes.length > 1 ? 's' : ''}" enterkeyhint="search"></label>
    <div id="liste" class="liste"></div>
    ${store.estConfigure() ? fab() : ''}`;
  const zone = root.querySelector('#liste');
  const afficher = () => {
    const liste = toutes.filter(r => correspond(r, q));
    let lettre = '';
    zone.innerHTML = liste.map(r => {
      const l = sansAccents(r.meta.titre[0] || '#').toUpperCase();
      const tete = l !== lettre ? `<div class="lettre">${esc(l)}</div>` : '';
      lettre = l;
      return tete + ligneRecette(r);
    }).join('') || (store.estConfigure() ? `<div class="vide"><p>Aucune recette.</p></div>` : nonConfigure());
    chargerPhotos(zone, store.recette);
  };
  root.querySelector('input').addEventListener('input', e => { q = e.target.value; afficher(); });
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
