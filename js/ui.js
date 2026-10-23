// Petites aides d'affichage : échappement, icônes, visuels, toast.

import { photoUrl, photoUrlChemin } from './store.js';
import { formatDuree, detectTimers, listePhotos } from './format.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  book: '<path d="M5 4h13a1 1 0 0 1 1 1v15H6.5A1.5 1.5 0 0 1 5 18.5z"/><path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H19"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>',
  cart: '<path d="M3 4h2.2l2.2 11h10.4L20 7.5H6.4"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  tri: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M14 6h7M14 12h5M14 18h3"/>',
  plate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="3"/><path d="M3 4v5a1.5 1.5 0 0 0 3 0V4M4.5 4v16M21 4c-1.5 0-2.5 2-2.5 5s1 4 2.5 4v7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

// Palettes chaudes pour les recettes sans photo (cf. maquette).
const PALETTES = [
  ['#9A3F1E', '#D9853B', '#E39A45', '#8E3A1E'],
  ['#6E5E40', '#C2AB80', '#D5C08E', '#6A573A'],
  ['#C8642A', '#EDA25A', '#F0A458', '#B94D1E'],
  ['#A8781E', '#E0B444', '#E6BC3F', '#9B5A18'],
  ['#7F3B2A', '#C9705A', '#D98A6C', '#6B2D1F'],
  ['#5E6B3A', '#B7B26A', '#CFC57C', '#4F5B2E'],
];
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

/** Visuel d'une recette : dégradé chaud, remplacé par la photo une fois chargée. */
export function visuel(r, cls = '') {
  const [c1, c2, c3, c4] = PALETTES[hash(r?.slug || r?.meta?.titre || '') % PALETTES.length];
  const attr = r?.meta && listePhotos(r.meta).length ? ` data-photo="${esc(r.slug)}"` : '';
  return `<div class="visuel ${cls}" style="--c1:${c1};--c2:${c2};--c3:${c3};--c4:${c4}"${attr}>
    <span class="rond r1"></span><span class="rond r2"></span><span class="rond r3"></span>
    <span class="assiette">${icon('plate')}</span></div>`;
}

/** Charge les photos des visuels présents dans `root`. */
export function chargerPhotos(root, trouver) {
  root.querySelectorAll('.visuel[data-photo]').forEach(async el => {
    const r = trouver(el.dataset.photo);
    const url = await photoUrl(r);
    if (!url || !el.isConnected) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => { img.classList.add('ok'); el.classList.add('a-photo'); };
    img.src = url;
    el.appendChild(img);
  });
}

export function tempsTotal(r) {
  return (Number(r.meta.preparation) || 0) + (Number(r.meta.cuisson) || 0) + (Number(r.meta.repos) || 0);
}

export function carteRecette(r) {
  const t = tempsTotal(r);
  const sing = { Desserts: 'Dessert', Plats: 'Plat', Entrées: 'Entrée', Sauces: 'Sauce', Pains: 'Pain', Boissons: 'Boisson' }[r.meta.categorie] || r.meta.categorie;
  return `<a class="carte" href="#/recette/${encodeURIComponent(r.slug)}">
    ${visuel(r, 'vignette')}
    <div class="corps"><h3>${esc(r.meta.titre)}</h3>
    <div class="meta-ligne">${t ? icon('clock') + esc(formatDuree(t)) + ' · ' : ''}${esc(sing)}</div></div></a>`;
}

export function ligneRecette(r) {
  const t = tempsTotal(r);
  return `<a class="ligne-recette" href="#/recette/${encodeURIComponent(r.slug)}">
    ${visuel(r, 'vignette')}
    <div><h3>${esc(r.meta.titre)}</h3>
    <div class="meta-ligne">${t ? icon('clock') + esc(formatDuree(t)) + ' · ' : ''}${esc(r.meta.categorie)}</div></div></a>`;
}

/** Texte d'étape : **gras** en terracotta, durées mises en avant. */
export function texteEtape(t) {
  let s = esc(t);
  const timers = detectTimers(t);
  // On travaille sur le texte échappé : les durées n'ont pas de caractères spéciaux.
  for (const tm of timers.sort((a, b) => b.texte.length - a.texte.length)) {
    s = s.split(esc(tm.texte)).join(`\u0001${esc(tm.texte)}\u0002`);
  }
  s = s.replace(/\u0001+/g, '<span class="duree">').replace(/\u0002+/g, '</span>');
  return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

/** Rendu Markdown très simple pour les notes. */
export function texteNotes(t) {
  return t.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</p>`).join('');
}

let toastTimer;
/** Message temporaire en bas d'écran, avec un bouton facultatif ({ texte, href }). */
export function toast(msg, ms = 2800, action = null) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('avec-action', !!action);
  if (action) {
    // Lien (« Voir la liste ») ou bouton (« Annuler »).
    const a = document.createElement(action.href ? 'a' : 'button');
    a.className = 'toast-action';
    if (action.href) a.href = action.href;
    a.textContent = action.texte;
    a.addEventListener('click', () => { el.classList.remove('visible'); action.faire?.(); });
    el.append(' ', a);
  }
  requestAnimationFrame(() => el.classList.add('visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

/** Retour arrière : revient dans l'historique si possible, sinon vers `defaut`. */
export function retour(defaut = '#/') {
  if (history.length > 1 && sessionStorage.getItem('mr.nav')) history.back();
  else location.hash = defaut;
}

/**
 * Visionneuse plein écran : photos entières sur fond noir, on glisse de l'une
 * à l'autre, on pince pour zoomer. Le bouton retour d'Android la ferme.
 */
export function ouvrirVisionneuse(chemins, depart = 0) {
  const el = document.createElement('div');
  el.className = 'visionneuse';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Photos');
  el.innerHTML = `<div class="v-defile">${chemins.map(() => '<div class="v-photo"></div>').join('')}</div>
    <button class="btn-rond plein v-fermer" aria-label="Fermer">${icon('x')}</button>
    ${chemins.length > 1 ? `<div class="v-compteur" aria-live="polite"></div>` : ''}`;
  document.body.appendChild(el);
  document.body.classList.add('sans-defilement');
  const defile = el.querySelector('.v-defile');
  const compteur = el.querySelector('.v-compteur');
  const majCompteur = () => {
    if (compteur) compteur.textContent = `${Math.round(defile.scrollLeft / defile.clientWidth) + 1} / ${chemins.length}`;
  };
  el.querySelectorAll('.v-photo').forEach(async (d, i) => {
    const url = await photoUrlChemin(chemins[i]);
    if (url && d.isConnected) d.innerHTML = `<img src="${url}" alt="Photo ${i + 1}">`;
  });
  defile.scrollLeft = depart * defile.clientWidth;
  majCompteur();
  defile.addEventListener('scroll', majCompteur, { passive: true });

  // Une entrée d'historique : le retour Android ferme la visionneuse au lieu de quitter la fiche.
  history.pushState({ visionneuse: true }, '');
  const fermer = () => {
    window.removeEventListener('popstate', fermer);
    document.body.classList.remove('sans-defilement');
    el.remove();
  };
  window.addEventListener('popstate', fermer);
  el.querySelector('.v-fermer').onclick = () => history.back();
}
