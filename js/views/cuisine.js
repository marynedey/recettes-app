// Mode cuisine : une étape par écran, minuteurs (plusieurs à la fois), écran maintenu allumé.

import * as store from '../store.js';
import { flatSteps, ingredientsForStep, formatQty, detectTimers } from '../format.js';
import { esc, icon, texteEtape, toast } from '../ui.js';
import { ecouter, reconnaissancePossible } from '../voix.js';
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
  // « f » : facteur du moule choisi sur la fiche (sinon, d'après le nombre de personnes).
  const facteur = Number(query.get('f')) || (base ? portions / base : 1);
  const cle = 'mr.cuisine.' + r.slug;
  const etapeDemandee = query.has('e') ? Number(query.get('e')) : null;
  let i = Math.min(etapeDemandee ?? (Number(sessionStorage.getItem(cle)) || 0), steps.length - 1);
  store.marquerCuisinee(r.slug);

  // Ingrédients déjà mis : les mêmes cases que sur la fiche (sessionStorage « mr.fiche.<slug> »),
  // repérés par leur rang dans la liste complète des ingrédients.
  const tousIngs = r.ingredients.flatMap(g => g.items);
  const cleFiche = 'mr.fiche.' + r.slug;
  const lireFiche = () => { try { return JSON.parse(sessionStorage.getItem(cleFiche)); } catch { return null; } };
  const coches = () => lireFiche()?.coches || [];
  const cocher = (k, oui) => {
    const e = lireFiche() || { onglet: 'ingredients', portions, coches: [] };
    e.coches = oui ? [...new Set([...e.coches, k])] : e.coches.filter(x => x !== k);
    sessionStorage.setItem(cleFiche, JSON.stringify(e));
  };

  root.className = 'cuisine';
  root.innerHTML = `
    <div class="cuisine-tete">
      <div class="cuisine-boutons">
        <button class="btn-rond" id="fermer" aria-label="Quitter le mode cuisine">${icon('x')}</button>
        <button class="btn-rond" id="recommencer" aria-label="Recommencer la recette">${icon('reset')}</button>
        ${reconnaissancePossible() ? `<button class="btn-rond" id="mains-libres" aria-label="Mains libres (commandes vocales)" aria-pressed="false">${icon('mic')}</button>` : ''}
      </div>
      <span class="badge-veille off" id="veille">${icon('sun')}<span>Écran normal</span></span>
    </div>
    <div class="progression"><div id="barre"></div></div>
    <div class="voix" id="voix" hidden>
      <div class="voix-tete"><span class="ecoute">${icon('mic')}J'écoute</span>
        <label class="voix-lire"><input type="checkbox" id="voix-lire"> Lire les étapes</label></div>
      <div class="voix-aide">Dites « Recette, » puis : ${['suivante', 'précédente', 'lance le minuteur', 'relis', 'ingrédients']
        .map(c => `<span>${c}</span>`).join('')}</div>
    </div>
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
    // Minuteurs de la recette en cours, en pause ou qui sonnent (un minuteur terminé et
    // arrêté n'a plus rien à dire ; celui de l'étape affichée reste sur sa carte).
    const autres = M.deRecette(r.slug).filter(m => !m.fini || m.sonne);

    root.querySelector('#barre').style.width = `${((i + 1) / steps.length) * 100}%`;
    corps.innerHTML = `
      ${autres.length ? `<div class="minuteurs-autres">${autres.map(m => `
        <button class="minuteur-mini ${m.id === id ? 'ici' : ''}" data-id="${esc(m.id)}">${icon('clock')}
          <span class="m-etape">${m.id === id ? 'Cette étape' : `Étape ${m.etape + 1}`}</span><span class="m-lib">${esc(m.label)}</span><span class="temps"></span></button>`).join('')}</div>` : ''}
      <div class="etape-label">Étape ${i + 1} <span>sur ${steps.length}</span></div>
      ${s.group ? `<div class="etape-groupe">${esc(s.group)}</div>` : ''}
      <p class="cuisine-texte">${texteEtape(s.texte)}</p>
      ${ings.length ? `<div class="petit-label">Pour cette étape</div>
        <div class="puces-ing">${ings.map(g => {
          const k = tousIngs.indexOf(g);
          const pris = coches().includes(k);
          return `<button class="${pris ? 'pris' : ''}" data-k="${k}" aria-pressed="${pris}">${g.qty != null ? `<b>${esc(formatQty(g, facteur))}</b> ` : ''}${esc(g.qty == null ? g.raw : g.name)}</button>`;
        }).join('')}</div>` : ''}
      ${timers.length ? `
        ${timers.length > 1 ? `<div class="choix-durees">${timers.map((t, k) => `<button data-k="${k}" aria-pressed="${k === choixDuree}"
          class="${M.obtenir(M.idMinuteur(r.slug, i, k)) ? 'a-minuteur' : ''}">${t.nom ? `<b>${esc(t.nom)}</b> · ` : ''}${esc(t.texte)}</button>`).join('')}</div>` : ''}
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
          <button class="bouton secondaire petit" id="m-reset" hidden>${icon('reset')}Réinitialiser</button>
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
    // Toucher un ingrédient : « c'est mis » (grisé et barré), comme cocher sur la fiche.
    corps.querySelectorAll('.puces-ing button').forEach(b => b.addEventListener('click', () => {
      const pris = !b.classList.contains('pris');
      b.classList.toggle('pris', pris);
      b.setAttribute('aria-pressed', pris);
      cocher(+b.dataset.k, pris);
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
        const m = M.obtenir(id);
        if (M.enCours(m)) M.pause(id); else if (m?.sonne) M.arreter(id); else M.lancer(defaut);
      };
      corps.querySelector('#m-moins').onclick = () => M.ajuster(id, -60, defaut);
      corps.querySelector('#m-plus').onclick = () => M.ajuster(id, 60, defaut);
      corps.querySelector('#m-reset').onclick = () => M.supprimer(id);
    }
    tic();
    lireSiNouvelle();
  }

  // Mains libres : désactivé par défaut, une commande ne compte que précédée de « Recette » (voix.js).
  let voix = null;
  let dernierLu = -1;
  const boutonVoix = root.querySelector('#mains-libres');
  const panneauVoix = root.querySelector('#voix');
  const caseLire = root.querySelector('#voix-lire');
  try { caseLire.checked = localStorage.getItem('mr.voix.lire') !== 'non'; } catch { caseLire.checked = true; }
  caseLire.addEventListener('change', () => {
    try { localStorage.setItem('mr.voix.lire', caseLire.checked ? 'oui' : 'non'); } catch { /* pas de stockage */ }
    if (!caseLire.checked) window.speechSynthesis?.cancel();
  });
  const lireEtape = () => { dernierLu = i; voix?.parler(steps[i].texte); };
  function lireSiNouvelle() { if (voix && caseLire.checked && dernierLu !== i) lireEtape(); }
  const minuteurIci = () => (courant?.id ? M.obtenir(courant.id) : null);
  const COMMANDES = {
    suivante: () => aller(1),
    precedente: () => { if (i > 0) aller(-1); },
    minuteur: () => {
      const m = minuteurIci();
      if (!courant?.id) voix.parler('Pas de minuteur à cette étape.');
      else if (!M.enCours(m) && !m?.sonne) corps.querySelector('#m-lecture')?.click();
    },
    pause: () => { if (M.enCours(minuteurIci())) corps.querySelector('#m-lecture')?.click(); },
    stop: () => {
      const sonnent = M.quiSonnent();
      if (sonnent.length) sonnent.forEach(m => M.arreter(m.id));
      else COMMANDES.pause();
    },
    relis: lireEtape,
    ingredients: () => {
      const ings = ingredientsForStep(r, steps[i]);
      voix.parler(ings.length ? ings.map(g => (g.qty != null ? `${formatQty(g, facteur)} ${g.name}` : g.raw)).join(', ')
        : 'Pas d\'ingrédient pour cette étape.');
    },
  };
  const NOMS = { suivante: 'Suivante', precedente: 'Précédente', minuteur: 'Minuteur', pause: 'Pause', stop: 'Arrêter', relis: 'Je relis', ingredients: 'Ingrédients' };
  const basculerVoix = on => {
    if (!on) { voix?.arreter(); voix = null; }
    else {
      voix = ecouter({
        surCommande: nom => { toast(`« ${NOMS[nom]} »`, 1500); COMMANDES[nom](); },
        surErreur: msg => { basculerVoix(false); toast(msg, 5000); },
      });
      dernierLu = -1;
      lireSiNouvelle();
    }
    boutonVoix.setAttribute('aria-pressed', String(on));
    boutonVoix.classList.toggle('actif', on);
    panneauVoix.hidden = !on;
  };
  boutonVoix?.addEventListener('click', () => basculerVoix(!voix));

  // Nom du minuteur (« Fouetter encore · 1 minute ») : le verbe devant la durée (format.js), sinon un mot-clé de l'étape.
  function libelle(s, t) {
    if (t.nom) return `${t.nom} · ${t.texte}`;
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
    bloc.classList.toggle('sonne', !!m?.sonne); // clignote seulement tant que ça sonne
    bloc.querySelector('#lib').textContent = m?.fini ? 'Terminé !' : (m ? m.label : libelle(courant.s, defaut));
    // Le bouton principal dit ce qu'il fait, en texte seul, centré comme « −1 min » et « +1 min ».
    const texte = M.enCours(m) ? 'Pause' : m?.sonne ? 'Arrêter' : m?.fini ? 'Relancer' : m ? 'Reprendre' : 'Démarrer';
    const lecture = bloc.querySelector('#m-lecture');
    if (lecture.textContent !== texte) lecture.textContent = texte;
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
      if (restants && !confirm(`${restants > 1 ? `${restants} minuteurs sont` : 'Un minuteur est'} encore en cours. Terminer la recette et ${restants > 1 ? 'les ' : 'l\''}arrêter ?`)) return;
      M.arreterRecette(r.slug); // minuteurs et notifications de la recette effacés
      sessionStorage.removeItem(cle);
      // Depuis la fiche, « retour » mènera à l'accueil et non à nouveau au mode cuisine (cf. app.js).
      sessionStorage.setItem('mr.apresCuisine', `#/recette/${encodeURIComponent(r.slug)}`);
      quitter();
      toast('Bon appétit !', 8000, { texte: 'Noter dans le carnet',
        faire: () => location.replace(`#/recette/${encodeURIComponent(r.slug)}?carnet=1`) });
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
  root.querySelector('#recommencer').onclick = () => {
    if (!confirm('Recommencer la recette depuis l\'étape 1 ? Les minuteurs seront arrêtés et les ingrédients décochés.')) return;
    M.arreterRecette(r.slug);
    sessionStorage.removeItem(cle);
    const e = lireFiche();
    if (e) { e.coches = []; sessionStorage.setItem(cleFiche, JSON.stringify(e)); }
    allerA(0);
    toast('Recette recommencée');
  };
  // Notification touchée alors que ce mode cuisine est déjà ouvert : on va à l'étape, sans rouvrir la page.
  const surEtape = e => { if (e.detail.slug === r.slug) allerA(e.detail.etape); };
  window.addEventListener('mr:etape', surEtape);
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
    window.removeEventListener('mr:etape', surEtape);
    voix?.arreter();
    verrou?.release().catch(() => {});
    verrou = null;
  };
}
