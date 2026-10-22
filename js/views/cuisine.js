// Mode cuisine : une étape par écran, minuteurs (plusieurs à la fois), écran maintenu allumé.

import * as store from '../store.js';
import { flatSteps, ingredientsForStep, formatQty, detectTimers } from '../format.js';
import { esc, icon, texteEtape, toast } from '../ui.js';
import * as M from '../minuteurs.js';

const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtLong = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : fmt(s);

/* ---------- écran allumé ---------- */

let verrou = null;
async function garderEcranAllume() {
  if (!('wakeLock' in navigator)) return false;
  try {
    verrou = await navigator.wakeLock.request('screen');
    return true;
  } catch { return false; }
}

/* ---------- vue ---------- */

export function cuisine(root, { params, query }) {
  const r = store.recette(params[0]);
  if (!r) { location.replace('#/'); return; }
  const steps = flatSteps(r);
  if (!steps.length) { location.replace(`#/recette/${encodeURIComponent(r.slug)}`); return; }
  const base = Number(r.meta.portions) || 0;
  const portions = Number(query.get('p')) || base;
  const facteur = base ? portions / base : 1;
  const cle = 'mr.cuisine.' + r.slug;
  const etapeDemandee = query.has('e') ? Number(query.get('e')) : null;
  let i = Math.min(etapeDemandee ?? (Number(sessionStorage.getItem(cle)) || 0), steps.length - 1);
  store.marquerCuisinee(r.slug);

  root.className = 'cuisine';
  root.innerHTML = `
    <div class="cuisine-tete">
      <button class="btn-rond" id="fermer" aria-label="Quitter le mode cuisine">${icon('x')}</button>
      <span class="badge-veille off" id="veille">${icon('sun')}<span>Écran normal</span></span>
    </div>
    <div class="progression"><div id="barre"></div></div>
    <div class="cuisine-corps" id="corps" aria-live="polite"></div>
    <div class="cuisine-nav">
      <button class="bouton secondaire" id="prec">Précédente</button>
      <button class="bouton" id="suiv"></button>
    </div>`;

  const corps = root.querySelector('#corps');
  const badge = root.querySelector('#veille');

  const majBadge = ok => {
    badge.classList.toggle('off', !ok);
    badge.querySelector('span').textContent = ok ? 'Écran toujours allumé' : ('wakeLock' in navigator ? 'Écran normal' : 'Veille non gérée');
  };
  garderEcranAllume().then(majBadge);
  const surVisibilite = () => { if (!document.hidden) garderEcranAllume().then(majBadge); };
  document.addEventListener('visibilitychange', surVisibilite);

  let choixDuree = 0;
  let courant = null; // { s, timers } de l'étape affichée

  function rendreEtape() {
    sessionStorage.setItem(cle, i);
    const s = steps[i];
    const ings = ingredientsForStep(r, s);
    const timers = detectTimers(s.texte);
    if (choixDuree >= timers.length) choixDuree = 0;
    const id = timers.length ? M.idMinuteur(r.slug, i, choixDuree) : null;
    courant = { s, timers, id };
    // Tous les minuteurs lancés pour cette recette, celui de l'étape affichée compris.
    const autres = M.deRecette(r.slug);

    root.querySelector('#barre').style.width = `${((i + 1) / steps.length) * 100}%`;
    corps.innerHTML = `
      ${autres.length ? `<div class="minuteurs-autres">${autres.map(m => `
        <button class="minuteur-mini ${m.id === id ? 'ici' : ''}" data-id="${esc(m.id)}">${icon('clock')}
          <span class="m-etape">${m.id === id ? 'Cette étape' : `Étape ${m.etape + 1}`}</span><span class="m-lib">${esc(m.label)}</span><span class="temps"></span></button>`).join('')}</div>` : ''}
      <div class="etape-label">Étape ${i + 1} <span>sur ${steps.length}</span></div>
      ${s.group ? `<div class="etape-groupe">${esc(s.group)}</div>` : ''}
      <p class="cuisine-texte">${texteEtape(s.texte)}</p>
      ${ings.length ? `<div class="petit-label">Pour cette étape</div>
        <div class="puces-ing">${ings.map(g => `<span>${g.qty != null ? `<b>${esc(formatQty(g, facteur))}</b> ` : ''}${esc(g.qty == null ? g.raw : g.name)}</span>`).join('')}</div>` : ''}
      ${timers.length ? `
        ${timers.length > 1 ? `<div class="choix-durees">${timers.map((t, k) => `<button data-k="${k}" aria-pressed="${k === choixDuree}"
          class="${M.obtenir(M.idMinuteur(r.slug, i, k)) ? 'a-minuteur' : ''}">${esc(t.texte)}</button>`).join('')}</div>` : ''}
        <div class="minuteur" id="minuteur">
          <div class="anneau"><svg viewBox="0 0 100 100"><circle class="fond-anneau" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100"/></svg>
            <div class="centre"><span class="temps" id="t-bloc"></span><span class="lib" id="lib"></span></div></div>
          <div class="minuteur-btns">
            <button id="m-moins">−1 min</button>
            <button class="lecture" id="m-lecture"></button>
            <button id="m-plus">+1 min</button>
          </div>
        </div>
        <div class="minuteur-actions">
          <button class="lien" id="m-reset" hidden>Réinitialiser</button>
        </div>` : ''}`;

    const prec = root.querySelector('#prec');
    const suiv = root.querySelector('#suiv');
    prec.disabled = i === 0;
    suiv.innerHTML = i === steps.length - 1 ? `Terminé ${icon('check')}` : `Suivante ${icon('arrow')}`;

    corps.querySelectorAll('.minuteur-mini').forEach(b => b.addEventListener('click', () => {
      const m = M.obtenir(b.dataset.id);
      if (!m) return;
      if (m.id === id) corps.querySelector('#minuteur')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else allerA(m.etape, +m.id.split('|')[2]);
    }));
    corps.querySelectorAll('.choix-durees button').forEach(b => b.addEventListener('click', () => {
      choixDuree = +b.dataset.k;
      rendreEtape();
    }));

    if (id) {
      const t = timers[choixDuree];
      const defaut = { id, slug: r.slug, titre: r.meta.titre, etape: i, label: libelle(s, t), secondes: t.secondes };
      corps.querySelector('#m-lecture').onclick = () => {
        M.demanderNotifications();
        if (M.enCours(M.obtenir(id))) M.pause(id); else M.lancer(defaut);
      };
      corps.querySelector('#m-moins').onclick = () => M.ajuster(id, -60, defaut);
      corps.querySelector('#m-plus').onclick = () => M.ajuster(id, 60, defaut);
      corps.querySelector('#m-reset').onclick = () => M.supprimer(id);
    }
    tic();
  }

  function libelle(s, t) {
    const m = s.texte.match(/(cuisson|cuire|four|repos|reposer|lev[ée]e|pétrir|mijoter|frémir|feu \w+)/i);
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} · ${t.texte}` : t.texte;
  }

  // Met à jour les temps affichés (appelé toutes les demi-secondes).
  function tic() {
    corps.querySelectorAll('.minuteur-mini').forEach(b => {
      const m = M.obtenir(b.dataset.id);
      if (!m) return;
      b.classList.toggle('fini', m.fini);
      b.classList.toggle('pause', !m.fini && !M.enCours(m));
      b.querySelector('.temps').textContent = m.fini ? 'Terminé !' : fmtLong(M.restant(m));
    });
    const bloc = corps.querySelector('#minuteur');
    if (!bloc || !courant.id) return;
    const m = M.obtenir(courant.id);
    const defaut = courant.timers[choixDuree];
    const affiche = m ? M.restant(m) : defaut.secondes;
    const tBloc = bloc.querySelector('#t-bloc');
    tBloc.textContent = fmtLong(affiche);
    tBloc.classList.toggle('long', affiche >= 3600);
    bloc.querySelector('.val').style.strokeDashoffset = String(100 - (m && m.total ? affiche / m.total : 1) * 100);
    bloc.classList.toggle('fini', !!m?.fini);
    bloc.querySelector('#lib').textContent = m?.fini ? 'Terminé !' : (m ? m.label : libelle(courant.s, defaut));
    const enCours = M.enCours(m);
    bloc.querySelector('#m-lecture').innerHTML = enCours ? `${icon('pause')}<span class="sr">Pause</span>`
      : `${icon(m?.fini ? 'reset' : 'play')}<span class="sr">${m?.fini ? 'Relancer' : 'Démarrer'}</span>`;
    corps.querySelector('#m-reset').hidden = !m;
  }

  // Un minuteur lancé, arrêté ou terminé (ici ou depuis une autre étape) : on redessine.
  const desabonner = M.surChangement(() => rendreEtape());
  const intervalle = setInterval(tic, 500);

  // Chaque étape a sa propre entrée d'historique : le bouton retour d'Android
  // revient à l'étape précédente ; depuis l'étape 1, il quitte le mode cuisine.
  const afficher = (k, choix = 0) => { i = k; choixDuree = choix; rendreEtape(); window.scrollTo(0, 0); };
  let choixApresRetour = 0;
  const allerA = (k, choix = 0) => {
    k = Math.max(0, Math.min(steps.length - 1, k));
    if (k < i) { choixApresRetour = choix; history.go(k - i); return; } // popstate affiche l'étape
    for (let n = i + 1; n <= k; n++) history.pushState({ cuisine: r.slug, etape: n }, '');
    if (k !== i || choix !== choixDuree) afficher(k, choix);
  };
  let actif = true; // passe à false quand la vue est quittée
  const quitter = () => {
    history.go(-(i + 1));
    // Mode cuisine ouvert sans page avant lui : on va directement à la fiche.
    const fiche = `#/recette/${encodeURIComponent(r.slug)}`;
    setTimeout(() => { if (actif) location.replace(fiche); }, 400);
  };
  const aller = d => {
    if (i + d >= steps.length) {
      const restants = M.deRecette(r.slug).filter(m => !m.fini).length;
      if (restants && !confirm(`${restants > 1 ? `${restants} minuteurs sont` : 'Un minuteur est'} encore en cours. Terminer la recette et ${restants > 1 ? 'les' : 'l\''}arrêter ?`)) return;
      M.arreterRecette(r.slug); // minuteurs et notifications de la recette effacés
      sessionStorage.removeItem(cle);
      quitter();
      return;
    }
    allerA(i + d);
  };
  const surRetour = e => { if (e.state?.cuisine === r.slug) { afficher(e.state.etape, choixApresRetour); choixApresRetour = 0; } };
  window.addEventListener('popstate', surRetour);
  if (history.state?.cuisine === r.slug && etapeDemandee === null) {
    i = Math.min(history.state.etape, steps.length - 1); // page rechargée : l'historique existe déjà
  } else {
    // « ?e=<étape> » (notification touchée) ne sert qu'à l'ouverture : on le retire de l'adresse.
    const adresse = location.hash.replace(/([?&])e=\d+&?/, '$1').replace(/[?&]$/, '');
    history.replaceState({ cuisine: r.slug, etape: 0 }, '', adresse);
    for (let n = 1; n <= i; n++) history.pushState({ cuisine: r.slug, etape: n }, '', adresse);
  }

  root.querySelector('#prec').onclick = () => aller(-1);
  root.querySelector('#suiv').onclick = () => aller(1);
  root.querySelector('#fermer').onclick = () => {
    const n = M.deRecette(r.slug).filter(M.enCours).length;
    if (n) toast(`${n > 1 ? `${n} minuteurs continuent` : 'Le minuteur continue'} (notification et retour en mode cuisine).`, 4000);
    quitter();
  };

  // Balayage gauche / droite pour changer d'étape.
  let x0 = null, y0 = null;
  const debut = e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
  const fin = e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) aller(dx < 0 ? 1 : -1);
    x0 = null;
  };
  corps.addEventListener('touchstart', debut, { passive: true });
  corps.addEventListener('touchend', fin, { passive: true });

  const clavier = e => {
    if (e.key === 'ArrowRight') aller(1);
    if (e.key === 'ArrowLeft') aller(-1);
  };
  document.addEventListener('keydown', clavier);

  rendreEtape();

  return () => {
    actif = false;
    desabonner();
    clearInterval(intervalle);
    document.removeEventListener('visibilitychange', surVisibilite);
    document.removeEventListener('keydown', clavier);
    window.removeEventListener('popstate', surRetour);
    verrou?.release().catch(() => {});
    verrou = null;
  };
}
