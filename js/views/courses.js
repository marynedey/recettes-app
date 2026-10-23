// Onglet Courses : recettes prévues (et pour combien), liste complète par rayon,
// cases à cocher et « j'en ai déjà » pour savoir ce qu'il manque. La liste est partagée
// par tous les téléphones connectés au dépôt (courses.js) : on la relit toutes les 8 s.

import * as store from '../store.js';
import * as C from '../courses.js';
import { esc, icon, toast } from '../ui.js';

const portionsDefaut = r => Number(r.meta.portions) || 1;

export function courses(root) {
  let ouverts = new Set(); // articles dépliés (détail par recette, « j'en ai déjà »)
  root.className = 'page';

  const rendre = () => {
    const e = C.etat();
    // Recettes supprimées entre-temps : on les oublie.
    const prevues = e.prevues.map(p => ({ ...p, recette: store.recette(p.slug) })).filter(p => p.recette);
    const articles = C.listeDeCourses(prevues, e.ajouts).filter(a => !C.estMasque(a, e.masques));
    const infos = a => {
      const s = e.articles[a.cle] || {};
      const m = C.manque(a, s.dispo);
      return { coche: !!s.coche, dispo: s.dispo || '', manque: m, fait: !!s.coche || (m && m.n === 0) };
    };
    const restants = articles.filter(a => !infos(a).fait).length;
    const rayons = [...new Set(articles.map(a => a.rayon))]
      .sort((a, b) => ordreRayon(a) - ordreRayon(b));

    root.innerHTML = `
      <div class="entete"><h1 class="titre-page">Courses</h1>
        ${articles.length ? `<button class="btn-rond" id="partager" aria-label="Partager la liste">${icon('share')}</button>` : ''}</div>

      <div class="section-tete"><h2>Recettes prévues</h2><span class="aide">${prevues.length || ''}</span></div>
      ${prevues.length ? `<div class="prevues">${prevues.map(p => {
        const base = Number(p.recette.meta.portions) || 0;
        return `<div class="prevue" data-slug="${esc(p.slug)}">
          <a class="pv-titre" href="#/recette/${encodeURIComponent(p.slug)}">${esc(p.recette.meta.titre)}</a>
          <div class="stepper petit">
            <button data-d="-1" aria-label="Moins">${icon('minus')}</button>
            <b>${base ? p.portions : `×${p.portions}`}</b>
            <button data-d="1" aria-label="Plus">${icon('plus')}</button>
          </div>
          <span class="pv-unite">${base ? `pers.` : 'fois'}</span>
          <button class="pv-retirer" aria-label="Retirer ${esc(p.recette.meta.titre)}">${icon('x')}</button>
        </div>`;
      }).join('')}</div>` : `<p class="aide">Ajoutez les recettes que vous voulez faire : la liste se remplit toute seule.</p>`}
      <button class="bouton secondaire petit large" id="ajouter-recettes">${icon('plus')}Ajouter des recettes</button>

      <div class="section-tete"><h2>Liste</h2>
        ${articles.length ? `<span class="aide">${restants ? `${restants} à acheter` : 'tout est prêt ✓'}</span>` : ''}</div>
      <form class="ajout-article" id="ajout-article">
        <input name="texte" placeholder="Ajouter : 2 citrons, papier cuisson…" autocomplete="off" enterkeyhint="done" aria-label="Ajouter un article à la liste">
        <button class="btn-rond" aria-label="Ajouter">${icon('plus')}</button>
      </form>
      ${articles.length ? `
        ${rayons.map(ry => `<h3 class="rayon">${esc(ry)}</h3>
          <div class="articles">${articles.filter(a => a.rayon === ry)
            .sort((a, b) => infos(a).fait - infos(b).fait)
            .map(a => article(a, infos(a), ouverts.has(a.cle))).join('')}</div>`).join('')}
        <div class="actions-courses">
          ${articles.some(a => infos(a).fait) ? `<button class="bouton secondaire petit" id="retirer-coches">${icon('check')}Retirer les articles cochés</button>` : ''}
          <button class="bouton secondaire petit" id="decocher">${icon('reset')}Tout décocher</button>
          <button class="bouton danger petit" id="vider">${icon('trash')}Vider les courses</button>
        </div>` : ''}`;

    // Recettes prévues
    root.querySelectorAll('.prevue').forEach(el => {
      const slug = el.dataset.slug;
      el.querySelectorAll('[data-d]').forEach(b => b.addEventListener('click', () => {
        const p = C.etat().prevues.find(x => x.slug === slug);
        C.prevoir(slug, Math.max(1, p.portions + Number(b.dataset.d)));
        rendre();
      }));
      el.querySelector('.pv-retirer').addEventListener('click', () => { C.retirer(slug); rendre(); });
    });
    root.querySelector('#ajouter-recettes').addEventListener('click', () => choisirRecettes(rendre));
    root.querySelector('#ajout-article').addEventListener('submit', ev => {
      ev.preventDefault();
      C.ajouterArticle(ev.target.texte.value);
      rendre();
      root.querySelector('#ajout-article input').focus(); // pour enchaîner les ajouts
    });
    root.querySelectorAll('[data-ajout]').forEach(b => b.addEventListener('click', () => { C.retirerArticle(b.dataset.ajout); rendre(); }));

    // Articles
    root.querySelectorAll('.article').forEach(el => {
      const cle = el.dataset.cle;
      glisserPourSupprimer(el, () => {
        const a = articles.find(x => x.cle === cle);
        const annuler = C.supprimerArticle(a);
        ouverts.delete(cle);
        rendre();
        toast(`« ${a.nom} » retiré de la liste`, 5000, { texte: 'Annuler', faire: () => { annuler(); rendre(); } });
      });
      const maj = f => C.majArticle(cle, f);
      el.querySelector('input[type=checkbox]').addEventListener('change', ev => { maj({ coche: ev.target.checked }); rendre(); });
      el.querySelector('.art-corps').addEventListener('click', () => {
        if (ouverts.has(cle)) ouverts.delete(cle); else ouverts.add(cle);
        rendre();
      });
      const dispo = el.querySelector('.art-dispo input');
      dispo?.addEventListener('change', () => {
        const v = parseFloat(dispo.value.replace(',', '.'));
        maj({ dispo: Number.isFinite(v) && v > 0 ? v : 0 });
        rendre();
        root.querySelector(`.article[data-cle="${CSS.escape(cle)}"] .art-dispo input`)?.focus();
      });
    });
    root.querySelector('#decocher')?.addEventListener('click', () => { C.toutDecocher(); rendre(); });
    // Cochés ou « j'en ai assez » : on les retire tous d'un coup (annulable).
    root.querySelector('#retirer-coches')?.addEventListener('click', () => {
      const faits = articles.filter(a => infos(a).fait);
      const annuler = C.supprimerArticles(faits);
      rendre();
      toast(`${faits.length} article${faits.length > 1 ? 's' : ''} retiré${faits.length > 1 ? 's' : ''}`, 5000, { texte: 'Annuler', faire: () => { annuler(); rendre(); } });
    });
    root.querySelector('#vider')?.addEventListener('click', () => {
      if (!confirm('Retirer toutes les recettes prévues et vider la liste ?')) return;
      C.vider(); ouverts = new Set(); rendre();
    });
    root.querySelector('#partager')?.addEventListener('click', () => partager(articles, infos));
  };

  rendre();

  // Liste partagée : modifications des autres téléphones (pas en pleine saisie ; le champ
  // « Ajouter » vide garde le focus).
  const desabonner = C.surChangement(() => {
    const actif = document.activeElement;
    if (!root.isConnected || (root.contains(actif) && actif.matches('input') && actif.value)) return;
    const ajout = actif?.closest?.('#ajout-article');
    rendre();
    if (ajout) root.querySelector('#ajout-article input')?.focus();
  });
  C.synchroniser().catch(() => {});
  const releve = setInterval(() => { if (!document.hidden) C.synchroniser().catch(() => {}); }, 8000);
  return () => { desabonner(); clearInterval(releve); };
}

function article(a, info, ouvert) {
  // Sans quantité : rien pour un article ajouté à la main ; « selon la recette » sinon (« sel, poivre »).
  const qte = !a.sansQuantite ? C.texteQuantites(a) : a.details.every(d => d.ajout) ? '' : 'selon la recette';
  const reste = info.manque
    ? (info.manque.n ? `il manque ${C.formatQuantite(info.manque.n, info.manque.unite)}` : 'j\'en ai assez ✓')
    : '';
  return `<div class="article ${info.fait ? 'fait' : ''} ${ouvert ? 'ouvert' : ''}" data-cle="${esc(a.cle)}">
    <div class="art-ligne">
      <label class="art-case"><input type="checkbox" ${info.coche ? 'checked' : ''} aria-label="${esc(a.nom)} : acheté ou déjà là">
        <span class="case">${icon('check')}</span></label>
      <button class="art-corps" aria-expanded="${ouvert}">
        <span class="art-nom">${esc(a.nom)}</span>
        <span class="art-qte">${esc(qte)}${reste ? `<small>${esc(reste)}</small>` : ''}</span>
      </button>
    </div>
    ${ouvert ? `<div class="art-detail">
      <ul>${a.details.map(d => `<li><b>${esc(d.titre)}</b>${d.partie ? ` <span class="partie">(${esc(d.partie.replace(/^pour (la |le |les |l')?/i, ''))})</span>` : ''} : ${esc(d.texte)}${d.ajout ? ` <button class="lien" data-ajout="${esc(d.ajout)}">Retirer</button>` : ''}</li>`).join('')}</ul>
      ${a.quantites.length ? `<label class="art-dispo">J'en ai déjà
        <input type="text" inputmode="decimal" value="${esc(String(info.dispo).replace('.', ','))}" placeholder="0">
        <span>${esc(a.quantites[0].unite || 'unité(s)')}</span></label>` : ''}
    </div>` : ''}
  </div>`;
}

/** Glisser un article vers la gauche ou la droite le retire (au-delà d'un tiers de la largeur). */
function glisserPourSupprimer(el, supprimer) {
  const ligne = el.querySelector('.art-ligne');
  let doigt = null, x0 = 0, y0 = 0, dx = 0, mode = null, bloquerClic = 0;
  const remettre = () => { ligne.style.transition = 'transform .2s'; ligne.style.transform = ''; el.classList.remove('glisse'); };
  ligne.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || doigt !== null) return;
    doigt = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null;
  });
  ligne.addEventListener('pointermove', e => {
    if (e.pointerId !== doigt) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!mode && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
      mode = 'glisse';
      ligne.setPointerCapture(doigt);
      ligne.style.transition = 'none';
      el.classList.add('glisse');
    } else if (!mode && Math.abs(my) > 10) mode = 'defile';
    if (mode !== 'glisse') return;
    dx = mx;
    ligne.style.transform = `translateX(${dx}px)`;
  });
  const fin = e => {
    if (e.pointerId !== doigt) return;
    doigt = null;
    if (mode !== 'glisse') return;
    bloquerClic = Date.now(); // le doigt levé ne doit pas aussi cocher ou déplier
    if (Math.abs(dx) < ligne.offsetWidth / 3 || e.type === 'pointercancel') { remettre(); return; }
    ligne.style.transition = 'transform .18s ease-in';
    ligne.style.transform = `translateX(${Math.sign(dx) * ligne.offsetWidth}px)`;
    setTimeout(supprimer, 180);
  };
  ligne.addEventListener('pointerup', fin);
  ligne.addEventListener('pointercancel', fin);
  ligne.addEventListener('click', e => {
    if (Date.now() - bloquerClic < 400) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

const ordreRayon = r => {
  const i = C.RAYONS.findIndex(([n]) => n === r);
  return i === -1 ? 99 : i;
};

/** Partage (ou copie) ce qu'il reste à acheter, rayon par rayon. */
async function partager(articles, infos) {
  const lignes = [];
  let rayonCourant = '';
  for (const a of [...articles].sort((x, y) => ordreRayon(x.rayon) - ordreRayon(y.rayon))) {
    const i = infos(a);
    if (i.fait) continue;
    if (a.rayon !== rayonCourant) { lignes.push(`\n${a.rayon.toUpperCase()}`); rayonCourant = a.rayon; }
    const q = i.manque ? C.formatQuantite(i.manque.n, i.manque.unite) : (a.sansQuantite ? '' : C.texteQuantites(a));
    lignes.push(`- ${a.nom}${q ? ` : ${q}` : ''}`);
  }
  const texte = `Liste de courses${lignes.join('\n')}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Liste de courses', text: texte });
    else { await navigator.clipboard.writeText(texte); toast('Liste copiée'); }
  } catch { /* partage annulé */ }
}

/** Feuille de choix des recettes (ajout / retrait d'un appui). */
function choisirRecettes(apres) {
  const el = document.createElement('div');
  el.className = 'feuille-fond';
  el.innerHTML = `<div class="feuille" role="dialog" aria-label="Choisir des recettes">
      <div class="feuille-tete"><h2>Quelles recettes ?</h2>
        <button class="btn-rond" id="f-fermer" aria-label="Terminé">${icon('check')}</button></div>
      <label class="recherche">${icon('search')}<input type="search" placeholder="Rechercher" aria-label="Rechercher une recette"></label>
      <div class="f-liste"></div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('sans-defilement');
  const liste = el.querySelector('.f-liste');
  const afficher = (q = '') => {
    const n = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    liste.innerHTML = store.recettes().filter(r => n(r.meta.titre).includes(n(q))).map(r => {
      const pris = C.estPrevue(r.slug);
      return `<button class="f-recette ${pris ? 'pris' : ''}" data-slug="${esc(r.slug)}" aria-pressed="${pris}">
        <span>${esc(r.meta.titre)}</span>${icon(pris ? 'check' : 'plus')}</button>`;
    }).join('') || '<p class="aide">Aucune recette.</p>';
    liste.querySelectorAll('.f-recette').forEach(b => b.addEventListener('click', () => {
      const r = store.recette(b.dataset.slug);
      if (C.estPrevue(r.slug)) C.retirer(r.slug); else C.prevoir(r.slug, portionsDefaut(r));
      afficher(el.querySelector('input').value);
    }));
  };
  afficher();
  el.querySelector('input').addEventListener('input', ev => afficher(ev.target.value));
  // Une entrée d'historique : le retour Android ferme la feuille au lieu de quitter les courses.
  history.pushState({ feuille: true }, '');
  const fermer = () => {
    window.removeEventListener('popstate', fermer);
    el.remove(); document.body.classList.remove('sans-defilement'); apres();
  };
  window.addEventListener('popstate', fermer);
  el.querySelector('#f-fermer').addEventListener('click', () => history.back());
  el.addEventListener('click', ev => { if (ev.target === el) history.back(); });
}

/** Depuis une fiche : ajoute (ou met à jour) la recette avec le nombre de personnes affiché. */
export function ajouterAuxCourses(r, portions) {
  C.prevoir(r.slug, portions || portionsDefaut(r));
  toast(`Ajoutée aux courses${Number(r.meta.portions) ? ` (${portions} pers.)` : ''}`, 5000,
    { texte: 'Voir la liste', href: '#/courses' });
}
