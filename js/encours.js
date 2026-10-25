// Recette pas terminée : commencée en mode cuisine (étape 2 atteinte ou minuteur lancé) et quittée
// sans « Terminé ». Un point en haut de chaque écran (sauf le mode cuisine) ; le toucher ouvre la
// question « Reprendre ou terminer ». Gardée sur le téléphone (« mr.encours »), même app fermée.

import * as store from './store.js';
import * as M from './minuteurs.js';
import { flatSteps } from './format.js';
import { esc, toast, visuel, chargerPhotos } from './ui.js';

const CLE = 'mr.encours';

// { [slug]: { slug, etape, adresse, debut, maj } } ; adresse : celle du mode cuisine (portions, moule).
const lire = () => { try { return JSON.parse(localStorage.getItem(CLE)) || {}; } catch { return {}; } };
const ecrire = e => { try { localStorage.setItem(CLE, JSON.stringify(e)); } catch { /* stockage plein */ } };

export const existe = slug => !!lire()[slug];

export function noter(slug, etape, adresse) {
  const e = lire();
  e[slug] = { slug, etape, adresse, debut: e[slug]?.debut || Date.now(), maj: Date.now() };
  ecrire(e);
}

export function retirer(slug) {
  const e = lire();
  if (!e[slug]) return;
  delete e[slug];
  ecrire(e);
  majPoint();
}

/** Recettes pas terminées (la plus récente d'abord), sans celles qui n'existent plus. */
export const liste = () => Object.values(lire()).filter(x => store.recette(x.slug)).sort((a, b) => b.maj - a.maj);

/** Fin de la recette : minuteurs arrêtés et effacés, plus de point. */
export function terminer(slug) {
  M.arreterRecette(slug);
  sessionStorage.removeItem('mr.cuisine.' + slug);
  retirer(slug);
}

/* ---------- le point ---------- */

export function majPoint() {
  let el = document.getElementById('point-encours');
  const visible = liste().length && !location.hash.startsWith('#/cuisine/');
  if (!visible) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('button');
  el.id = 'point-encours';
  el.className = 'point-encours';
  el.setAttribute('aria-label', 'Recette pas terminée');
  el.innerHTML = '<span></span>';
  el.addEventListener('click', demander);
  document.body.appendChild(el);
}

/* ---------- la question ---------- */

const heure = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
function quand(t) {
  const jour = d => new Date(d).setHours(0, 0, 0, 0);
  const ecart = Math.round((jour(Date.now()) - jour(t)) / 864e5);
  if (ecart <= 0) return `aujourd'hui à ${heure(t)}`;
  if (ecart === 1) return `hier à ${heure(t)}`;
  return `le ${new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${heure(t)}`;
}

function minuteurs(slug) {
  return M.deRecette(slug).filter(m => !m.fini || m.sonne).map(m => {
    const etat = m.sonne ? 'c\'est prêt !' : M.enCours(m) ? `prêt à ${heure(m.fin)}` : `en pause, reste ${M.duree(m.reste)}`;
    return `<p class="q-min">Minuteur ${esc(m.label)} · ${etat}</p>`;
  }).join('');
}

function demander() {
  const el = document.createElement('div');
  el.className = 'feuille-fond';
  el.innerHTML = `<div class="feuille" role="dialog" aria-label="Recette pas terminée">
      <div class="poignee"></div>
      ${liste().map(x => {
        const r = store.recette(x.slug);
        const n = flatSteps(r).length;
        const etape = Math.min(x.etape, n - 1) + 1;
        return `<div class="q-recette" data-slug="${esc(x.slug)}">
          <p class="q-sur">Recette pas terminée</p>
          <div class="q-carte">${visuel(r, 'vignette')}<div><h3>${esc(r.meta.titre)}</h3>
            <p class="q-info">Étape ${etape} sur ${n} · commencée ${quand(x.debut)}</p></div></div>
          ${minuteurs(x.slug)}
          <p class="q-texte">Vous la reprenez où vous en étiez, ou elle est terminée ?</p>
          <div class="q-boutons"><button class="bouton" data-a="reprendre">Reprendre à l'étape ${etape}</button>
            <button class="bouton secondaire" data-a="terminer">Terminer la recette</button></div>
        </div>`;
      }).join('')}
      <button class="q-plus-tard" data-a="plus-tard">Plus tard</button>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('sans-defilement');
  chargerPhotos(el, store.recette);

  // Une entrée d'historique : le retour Android ferme la feuille.
  history.pushState({ feuille: true }, '');
  let ensuite = null;
  const fermer = () => {
    window.removeEventListener('popstate', fermer);
    el.remove(); document.body.classList.remove('sans-defilement');
    ensuite?.();
  };
  window.addEventListener('popstate', fermer);
  el.addEventListener('click', ev => {
    if (ev.target === el) { history.back(); return; }
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const slug = b.closest('[data-slug]')?.dataset.slug;
    const x = lire()[slug];
    if (b.dataset.a === 'reprendre' && x) {
      const adresse = x.adresse || `#/cuisine/${encodeURIComponent(slug)}`;
      ensuite = () => { location.hash = `${adresse}${adresse.includes('?') ? '&' : '?'}e=${x.etape}`; };
    }
    if (b.dataset.a === 'terminer') {
      ensuite = () => {
        terminer(slug);
        toast('Bon appétit !', 8000, { texte: 'Noter dans le carnet', href: `#/recette/${encodeURIComponent(slug)}?carnet=1` });
      };
    }
    history.back();
  });
}

window.addEventListener('hashchange', majPoint);
window.addEventListener('storage', majPoint);
document.addEventListener('visibilitychange', () => { if (!document.hidden) majPoint(); });
store.onChange(majPoint);
