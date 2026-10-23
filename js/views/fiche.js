// Fiche recette : photo, temps, onglets Ingrédients / Étapes / Notes.

import * as store from '../store.js';
import { formatQty, formatDuree, flatSteps, nonRecalcule, listePhotos } from '../format.js';
import { esc, icon, visuel, chargerPhotos, ouvrirVisionneuse, tempsTotal, texteEtape, texteNotes, retour, toast } from '../ui.js';

const lireEtat = slug => JSON.parse(sessionStorage.getItem('mr.fiche.' + slug) || 'null');
const ecrireEtat = (slug, e) => sessionStorage.setItem('mr.fiche.' + slug, JSON.stringify(e));

export function fiche(root, { params }) {
  const r = store.recette(params[0]);
  if (!r) {
    root.className = 'page sans-tabbar';
    root.innerHTML = `<div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button></div>
      <div class="vide"><div class="serif">Recette introuvable</div><p>Elle a peut-être été supprimée ou n'est pas encore synchronisée.</p></div>`;
    root.querySelector('#retour').onclick = () => retour();
    return;
  }
  const base = Number(r.meta.portions) || 0;
  const etat = lireEtat(r.slug) || { onglet: 'ingredients', portions: base || 1, coches: [] };
  const sauver = () => ecrireEtat(r.slug, etat);
  const m = r.meta;
  const surtitre = m.categorie || '';
  const steps = flatSteps(r);
  const photos = listePhotos(m);

  root.className = '';
  root.innerHTML = `
    <div class="fiche-hero">${visuel(r)}${photos.length > 1 ? `
      <div class="carrousel" id="carrousel">${photos.map(c => `<div class="diapo" data-chemin="${esc(c)}"></div>`).join('')}</div>
      <div class="points" aria-hidden="true">${photos.map((_, i) => `<span${i ? '' : ' class="actif"'}></span>`).join('')}</div>` : ''}
      <div class="actions">
        <button class="btn-rond plein" id="retour" aria-label="Retour">${icon('back')}</button>
        <div>
          <a class="btn-rond plein" href="#/modifier/${encodeURIComponent(r.slug)}" aria-label="Modifier">${icon('edit')}</a>
          <button class="btn-rond plein ${store.estFavori(r.slug) ? 'actif' : ''}" id="fav" aria-label="Favori" aria-pressed="${store.estFavori(r.slug)}">${icon('heart')}</button>
        </div>
      </div>
    </div>
    <div class="fiche-feuille">
      ${surtitre ? `<div class="surtitre">${esc(surtitre)}</div>` : ''}
      <h1>${esc(m.titre)}</h1>
      <div class="stats">
        <div><b>${m.preparation ? esc(formatDuree(+m.preparation)) : '–'}</b><span>Préparation</span></div>
        <div><b>${m.cuisson ? esc(formatDuree(+m.cuisson)) : '–'}</b><span>Cuisson</span></div>
        ${m.repos ? `<div><b>${esc(formatDuree(+m.repos))}</b><span>Repos</span></div>` : ''}
        <div><b>${esc(m.difficulte || '–')}</b><span>Niveau</span></div>
      </div>
      ${m.repos && tempsTotal(r) ? `<p class="total">Temps total : <b>${esc(formatDuree(tempsTotal(r)))}</b></p>` : ''}
      <div class="segments" role="tablist">
        <button role="tab" data-o="ingredients">Ingrédients</button>
        <button role="tab" data-o="etapes">Étapes</button>
        <button role="tab" data-o="notes">Notes</button>
      </div>
      <div class="onglets-piste" id="piste">
        <div class="panneau" role="tabpanel" data-o="ingredients"></div>
        <div class="panneau" role="tabpanel" data-o="etapes"></div>
        <div class="panneau" role="tabpanel" data-o="notes"></div>
      </div>
    </div>
    ${steps.length ? `<div class="barre-bas"><div><a class="bouton" id="cuisiner" href="#/cuisine/${encodeURIComponent(r.slug)}">${icon('play')}Lancer le mode cuisine</a></div></div>` : ''}`;

  chargerPhotos(root, () => r);

  // Plusieurs photos : on les fait défiler en glissant, les points suivent.
  const carrousel = root.querySelector('#carrousel');
  if (photos.length) {
    const hero = root.querySelector('.fiche-hero');
    hero.classList.add('agrandissable');
    hero.addEventListener('click', e => {
      if (e.target.closest('.actions')) return; // retour, modifier, favori
      const k = carrousel ? Math.round(carrousel.scrollLeft / carrousel.clientWidth) : 0;
      ouvrirVisionneuse(photos, k);
    });
  }
  if (carrousel) {
    carrousel.querySelectorAll('.diapo').forEach(async d => {
      const url = await store.photoUrlChemin(d.dataset.chemin);
      if (url && d.isConnected) d.innerHTML = `<img src="${url}" alt="">`;
    });
    const points = root.querySelectorAll('.points span');
    carrousel.addEventListener('scroll', () => {
      const k = Math.round(carrousel.scrollLeft / carrousel.clientWidth);
      points.forEach((p, i) => p.classList.toggle('actif', i === k));
    }, { passive: true });
  }
  root.querySelector('#retour').onclick = () => retour();
  const fav = root.querySelector('#fav');
  fav.onclick = () => {
    const on = !store.estFavori(r.slug);
    store.setFavori(r.slug, on);
    fav.classList.toggle('actif', on);
    fav.setAttribute('aria-pressed', on);
    toast(on ? 'Ajoutée aux favoris' : 'Retirée des favoris');
  };
  const btnCuisine = root.querySelector('#cuisiner');
  const majLien = () => { if (btnCuisine) btnCuisine.href = `#/cuisine/${encodeURIComponent(r.slug)}?p=${etat.portions}`; };

  // Les trois onglets sont côte à côte dans une piste qui défile horizontalement :
  // le contenu suit le doigt, et s'aimante sur l'onglet le plus proche.
  const piste = root.querySelector('#piste');
  const panneaux = Object.fromEntries([...piste.children].map(p => [p.dataset.o, p]));
  const facteur = () => (base ? etat.portions / base : 1);

  const vues = {
    ingredients() {
      const contenu = panneaux.ingredients;
      let i = 0;
      const ajuste = facteur() !== 1;
      let aAjuster = false;
      const lignes = r.ingredients.map(g => `${g.group ? `<h3 class="groupe-titre">${esc(g.group)}</h3>` : ''}${g.items.map(ing => {
        const k = i++;
        const badge = ajuste && nonRecalcule(ing);
        if (badge) aAjuster = true;
        return `<label class="ingredient"><input type="checkbox" data-k="${k}" ${etat.coches.includes(k) ? 'checked' : ''}>
          <span class="case">${icon('check')}</span>
          <span class="qte">${esc(formatQty(ing, facteur()))}</span><span class="nom">${esc(ing.qty == null ? ing.raw : ing.name)}${badge ? ' <span class="ajuster">à ajuster</span>' : ''}</span></label>`;
      }).join('')}`).join('');
      contenu.innerHTML = `${base ? `<div class="portions"><span>Personnes</span><div class="stepper">
          <button id="moins" aria-label="Moins de personnes">${icon('minus')}</button><b id="nb">${etat.portions}</b>
          <button id="plus" aria-label="Plus de personnes">${icon('plus')}</button></div></div>` : ''}
        ${lignes || '<div class="vide"><p>Aucun ingrédient.</p></div>'}
        ${aAjuster ? `<p class="aide note-ajuster"><span class="ajuster">à ajuster</span> : quantité que l'app n'a pas su recalculer pour ${etat.portions} personne${etat.portions > 1 ? 's' : ''}, à multiplier vous-même (×${String(Math.round(facteur() * 100) / 100).replace('.', ',')}).</p>` : ''}`;
      const changer = d => { etat.portions = Math.max(1, etat.portions + d); sauver(); majLien(); vues.ingredients(); ajusterHauteur(); };
      contenu.querySelector('#moins')?.addEventListener('click', () => changer(-1));
      contenu.querySelector('#plus')?.addEventListener('click', () => changer(1));
      contenu.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', () => {
        const k = +c.dataset.k;
        etat.coches = c.checked ? [...etat.coches, k] : etat.coches.filter(x => x !== k);
        sauver();
      }));
    },
    etapes() {
      let n = 0;
      panneaux.etapes.innerHTML = r.etapes.map(g => `${g.group ? `<h3 class="groupe-titre">${esc(g.group)}</h3>` : ''}
        <ol class="etapes">${g.items.map(t => `<li class="etape"><span class="num">${++n}</span><p>${texteEtape(t)}</p></li>`).join('')}</ol>`).join('')
        || '<div class="vide"><p>Aucune étape.</p></div>';
    },
    notes() {
      const contenu = panneaux.notes;
      const src = m.source ? (/^https?:\/\//.test(m.source)
        ? `<div class="source">Source : <a href="${esc(m.source)}" target="_blank" rel="noopener">${esc(m.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a></div>`
        : `<div class="source">Source : ${esc(m.source)}</div>`) : '';
      contenu.innerHTML = `${r.notes ? `<div class="notes">${texteNotes(r.notes)}</div>` : '<p class="aide" style="padding-top:12px">Pas de notes.</p>'}
        ${src}
        ${(m.tags || []).length ? `<div class="tags">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${m.ajoutee ? `<p class="aide" style="margin-top:16px">Ajoutée le ${esc(new Date(m.ajoutee).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>` : ''}
        <div class="actions-fiche">
          <a class="bouton secondaire petit" href="#/modifier/${encodeURIComponent(r.slug)}">${icon('edit')}Modifier</a>
          <button class="bouton danger petit" id="suppr">${icon('trash')}Supprimer</button>
        </div>`;
      contenu.querySelector('#suppr').onclick = async e => {
        if (!confirm(`Supprimer définitivement « ${m.titre} » ?`)) return;
        e.currentTarget.disabled = true;
        try { await store.supprimerRecette(r.slug); toast('Recette supprimée'); location.replace('#/'); }
        catch (err) { e.currentTarget.disabled = false; alert(err.message); }
      };
    },
  };

  const ordre = ['ingredients', 'etapes', 'notes'];
  const onglets = root.querySelectorAll('[role=tab]');
  // La piste prend la hauteur de l'onglet affiché (sinon, celle du plus long).
  const ajusterHauteur = () => { piste.style.height = `${panneaux[etat.onglet].offsetHeight}px`; };
  const marquer = o => {
    if (etat.onglet !== o) { etat.onglet = o; sauver(); }
    onglets.forEach(b => b.setAttribute('aria-selected', b.dataset.o === o));
    ajusterHauteur();
  };
  const ouvrir = (o, doux = true) => {
    marquer(o);
    piste.scrollTo({ left: ordre.indexOf(o) * piste.clientWidth, behavior: doux ? 'smooth' : 'instant' });
  };
  onglets.forEach(b => b.addEventListener('click', () => ouvrir(b.dataset.o)));
  // Glissement au doigt : l'onglet suit la position de la piste.
  piste.addEventListener('scroll', () => {
    const o = ordre[Math.round(piste.scrollLeft / piste.clientWidth)];
    if (o && o !== etat.onglet) marquer(o);
  }, { passive: true });
  new ResizeObserver(ajusterHauteur).observe(panneaux.ingredients);
  ordre.forEach(o => vues[o]());
  majLien();
  ouvrir(etat.onglet, false);
}
