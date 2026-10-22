// Mode cuisine : une étape par écran, minuteur, écran maintenu allumé.

import * as store from '../store.js';
import { flatSteps, ingredientsForStep, formatQty, detectTimers } from '../format.js';
import { esc, icon, texteEtape, retour } from '../ui.js';

/* ---------- minuteur (survit au changement d'étape) ---------- */

const minuteur = {
  slug: null, etape: -1, total: 0, reste: 0, fin: null, fini: false, label: '',
  get enCours() { return this.fin !== null; },
  restant() { return this.fin ? Math.max(0, Math.round((this.fin - Date.now()) / 1000)) : this.reste; },
  regler(slug, etape, sec, label) {
    Object.assign(this, { slug, etape, total: sec, reste: sec, fin: null, fini: false, label });
  },
  lancer() { if (!this.fin && this.reste > 0) { this.fin = Date.now() + this.reste * 1000; this.fini = false; } },
  pause() { if (this.fin) { this.reste = this.restant(); this.fin = null; } },
  ajuster(d) {
    if (this.fin) this.fin = Math.max(Date.now() + 1000, this.fin + d * 1000);
    else this.reste = Math.max(0, this.reste + d);
    this.total = Math.max(this.total + d, this.restant(), 1);
    if (this.restant() > 0) this.fini = false;
  },
};

let audio = null;
function sonnerie() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.32);
    }
  } catch { /* pas de son */ }
  navigator.vibrate?.([400, 200, 400, 200, 400]);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    navigator.serviceWorker?.ready.then(reg => reg.showNotification('Minuteur terminé', {
      body: minuteur.label || 'C\'est prêt !', icon: 'icons/icon-192.png', tag: 'minuteur', renotify: true, vibrate: [400, 200, 400],
    })).catch(() => {});
  }
}

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
  let i = Math.min(Number(sessionStorage.getItem(cle)) || 0, steps.length - 1);
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

  // Demande discrète d'autorisation de notification au premier lancement de minuteur.
  const demanderNotif = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  };

  let choixDuree = 0;
  let courant = null; // { s, timers } de l'étape affichée

  function rendreEtape() {
    sessionStorage.setItem(cle, i);
    const s = steps[i];
    const ings = ingredientsForStep(r, s);
    const timers = detectTimers(s.texte);
    if (choixDuree >= timers.length) choixDuree = 0;
    courant = { s, timers };
    const ceMinuteur = minuteur.slug === r.slug && minuteur.etape === i;
    const autre = minuteur.slug === r.slug && minuteur.etape !== i && (minuteur.enCours || minuteur.fini);

    root.querySelector('#barre').style.width = `${((i + 1) / steps.length) * 100}%`;
    corps.innerHTML = `
      ${autre ? `<button class="minuteur-mini ${minuteur.fini ? 'fini' : ''}" id="mini" style="width:100%">${icon('clock')}
        <span>Étape ${minuteur.etape + 1}${minuteur.fini ? ' : terminé !' : ''}</span><span class="temps" data-temps>${fmtLong(minuteur.restant())}</span></button>` : ''}
      <div class="etape-label">Étape ${i + 1} <span>sur ${steps.length}</span></div>
      ${s.group ? `<div class="etape-groupe">${esc(s.group)}</div>` : ''}
      <p class="cuisine-texte">${texteEtape(s.texte)}</p>
      ${ings.length ? `<div class="petit-label">Pour cette étape</div>
        <div class="puces-ing">${ings.map(g => `<span>${g.qty != null ? `<b>${esc(formatQty(g, facteur))}</b> ` : ''}${esc(g.qty == null ? g.raw : g.name)}</span>`).join('')}</div>` : ''}
      ${timers.length || ceMinuteur ? `
        ${timers.length > 1 ? `<div class="choix-durees">${timers.map((t, k) => `<button data-k="${k}" aria-pressed="${k === choixDuree}">${esc(t.texte)}</button>`).join('')}</div>` : ''}
        <div class="minuteur" id="minuteur">
          <div class="anneau"><svg viewBox="0 0 100 100"><circle class="fond-anneau" cx="50" cy="50" r="44"/><circle class="val" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="100"/></svg>
            <div class="centre"><span class="temps" id="t-bloc"></span><span class="lib" id="lib"></span></div></div>
          <div class="minuteur-btns">
            <button id="m-moins">−1 min</button>
            <button class="lecture" id="m-lecture"></button>
            <button id="m-plus">+1 min</button>
          </div>
        </div>` : ''}`;

    const prec = root.querySelector('#prec');
    const suiv = root.querySelector('#suiv');
    prec.disabled = i === 0;
    suiv.innerHTML = i === steps.length - 1 ? `Terminé ${icon('check')}` : `Suivante ${icon('arrow')}`;

    corps.querySelector('#mini')?.addEventListener('click', () => { i = minuteur.etape; rendreEtape(); });
    corps.querySelectorAll('.choix-durees button').forEach(b => b.addEventListener('click', () => {
      choixDuree = +b.dataset.k;
      if (!(ceMinuteur && minuteur.enCours)) minuteur.regler(r.slug, i, timers[choixDuree].secondes, s.group || 'Minuteur');
      rendreEtape();
    }));

    const bloc = corps.querySelector('#minuteur');
    if (bloc) {
      if (!ceMinuteur && !minuteur.enCours) minuteur.regler(r.slug, i, timers[choixDuree].secondes, libelle(s, timers[choixDuree]));
      const lecture = bloc.querySelector('#m-lecture');
      lecture.onclick = () => {
        demanderNotif();
        if (minuteur.slug !== r.slug || minuteur.etape !== i) minuteur.regler(r.slug, i, timers[choixDuree].secondes, libelle(s, timers[choixDuree]));
        if (minuteur.fini || minuteur.restant() === 0) { minuteur.regler(r.slug, i, minuteur.total || timers[choixDuree]?.secondes || 60, minuteur.label); }
        if (minuteur.enCours) minuteur.pause(); else minuteur.lancer();
        tic();
      };
      bloc.querySelector('#m-moins').onclick = () => { if (minuteur.etape === i) { minuteur.ajuster(-60); tic(); } };
      bloc.querySelector('#m-plus').onclick = () => { if (minuteur.etape === i) { minuteur.ajuster(60); tic(); } };
    }
    tic();
  }

  function libelle(s, t) {
    const m = s.texte.match(/(cuisson|cuire|four|repos|reposer|lev[ée]e|pétrir|mijoter|frémir|feu \w+)/i);
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} · ${t.texte}` : t.texte;
  }

  function tic() {
    const reste = minuteur.restant();
    if (minuteur.enCours && reste === 0) {
      minuteur.pause(); minuteur.fini = true; sonnerie();
      if (minuteur.etape !== i) { rendreEtape(); return; }
    }
    corps.querySelectorAll('[data-temps]').forEach(el => { el.textContent = fmtLong(minuteur.restant()); });
    const mini = corps.querySelector('#mini');
    if (mini) mini.classList.toggle('fini', minuteur.fini);
    const bloc = corps.querySelector('#minuteur');
    if (!bloc) return;
    const actif = minuteur.slug === r.slug && minuteur.etape === i;
    const defaut = courant.timers[choixDuree];
    const frac = actif && minuteur.total ? minuteur.restant() / minuteur.total : 1;
    bloc.querySelector('#t-bloc').textContent = fmtLong(actif ? minuteur.restant() : defaut?.secondes || 0);
    bloc.querySelector('.val').style.strokeDashoffset = String(100 - frac * 100);
    bloc.classList.toggle('fini', actif && minuteur.fini);
    bloc.querySelector('#lib').textContent = actif && minuteur.fini ? 'Terminé !'
      : (actif ? minuteur.label : defaut ? libelle(courant.s, defaut) : 'Minuteur');
    const lecture = bloc.querySelector('#m-lecture');
    const enCours = actif && minuteur.enCours;
    lecture.innerHTML = enCours ? `${icon('pause')}<span class="sr">Pause</span>` : `${icon(minuteur.fini ? 'reset' : 'play')}<span class="sr">${minuteur.fini ? 'Relancer' : 'Démarrer'}</span>`;
  }

  const intervalle = setInterval(tic, 500);

  const aller = d => {
    if (i + d >= steps.length) { sessionStorage.removeItem(cle); location.hash = `#/recette/${encodeURIComponent(r.slug)}`; return; }
    i = Math.max(0, Math.min(steps.length - 1, i + d));
    choixDuree = 0;
    rendreEtape();
    window.scrollTo(0, 0);
  };
  root.querySelector('#prec').onclick = () => aller(-1);
  root.querySelector('#suiv').onclick = () => aller(1);
  root.querySelector('#fermer').onclick = () => {
    if (minuteur.enCours && minuteur.slug === r.slug && !confirm('Un minuteur est en cours. Quitter quand même ?')) return;
    if (minuteur.slug === r.slug) minuteur.regler(null, -1, 0, '');
    retour(`#/recette/${encodeURIComponent(r.slug)}`);
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
    clearInterval(intervalle);
    document.removeEventListener('visibilitychange', surVisibilite);
    document.removeEventListener('keydown', clavier);
    verrou?.release().catch(() => {});
    verrou = null;
  };
}
