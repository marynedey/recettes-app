// Fiche recette : photo, temps, onglets Ingrédients / Étapes / Notes.

import * as store from '../store.js';
import { formatQty, nomIngredient, formatDuree, flatSteps, nonRecalcule, listePhotos, lireMoule, texteMoule, facteurMoule, AVIS } from '../format.js';
import { ajouterAuxCourses } from './courses.js';
import { esc, icon, visuel, chargerPhotos, ouvrirVisionneuse, tempsTotal, texteEtape, texteNotes, retour, toast, ongletsGlissants } from '../ui.js';

const lireEtat = slug => JSON.parse(sessionStorage.getItem('mr.fiche.' + slug) || 'null');
const ecrireEtat = (slug, e) => sessionStorage.setItem('mr.fiche.' + slug, JSON.stringify(e));

export function fiche(root, { params, query }) {
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
  // Moule de la recette (« moule: rond 24 cm ») : on peut adapter les quantités à son propre moule.
  const mouleRecette = lireMoule(m.moule);
  if (!mouleRecette) etat.mode = 'personnes';
  if (mouleRecette && !etat.monMoule) etat.monMoule = { ...mouleRecette };
  // « ?carnet=1 » (après « Terminé » en mode cuisine) : onglet Notes, formulaire du carnet ouvert.
  const ouvrirCarnet = query?.get('carnet') === '1';
  if (ouvrirCarnet) {
    etat.onglet = 'notes';
    history.replaceState(history.state, '', location.hash.replace(/\?.*$/, ''));
  }
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
    <div class="barre-bas"><div>
      ${r.ingredients.length ? `<button class="bouton secondaire bouton-courses" id="aux-courses" aria-label="Ajouter aux courses">${icon('cart')}</button>` : ''}
      ${steps.length ? `<a class="bouton" id="cuisiner" href="#/cuisine/${encodeURIComponent(r.slug)}">${icon('play')}Lancer le mode cuisine</a>` : ''}
    </div></div>`;

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
  const enMoule = () => !!mouleRecette && etat.mode === 'moule';
  const facteur = () => (enMoule() ? facteurMoule(mouleRecette, etat.monMoule) : base ? etat.portions / base : 1);
  // Aux courses avec le moule : quantités exactes du moule (équivalent en personnes non arrondi) et son nom.
  root.querySelector('#aux-courses')?.addEventListener('click', () => (enMoule() && base
    ? ajouterAuxCourses(r, Math.round(base * facteur() * 100) / 100, texteMoule(etat.monMoule))
    : ajouterAuxCourses(r, etat.portions)));
  const btnCuisine = root.querySelector('#cuisiner');
  btnCuisine?.addEventListener('click', () => sessionStorage.removeItem('mr.apresCuisine'));
  const majLien = () => {
    if (btnCuisine) btnCuisine.href = `#/cuisine/${encodeURIComponent(r.slug)}?p=${etat.portions}${enMoule() ? `&f=${Math.round(facteur() * 1000) / 1000}` : ''}`;
  };
  const fois = x => String(Math.round(x * 100) / 100).replace('.', ',');

  // Les trois onglets sont côte à côte dans une piste qui défile horizontalement :
  // le contenu suit le doigt, puis se cale sur l'onglet voulu (ongletsGlissants, ui.js).
  const piste = root.querySelector('#piste');
  const panneaux = Object.fromEntries([...piste.children].map(p => [p.dataset.o, p]));

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
          <span class="qte">${esc(formatQty(ing, facteur()))}</span><span class="nom">${esc(nomIngredient(ing, facteur()))}${badge ? ' <span class="ajuster">à ajuster</span>' : ''}</span></label>`;
      }).join('')}`).join('');
      const mien = etat.monMoule;
      const taille = (id, v, nom) => `<div class="stepper petit">
          <button data-taille="${id}" data-d="-1" aria-label="${nom} plus petit">${icon('minus')}</button><b id="${id}">${String(v).replace('.', ',')} cm</b>
          <button data-taille="${id}" data-d="1" aria-label="${nom} plus grand">${icon('plus')}</button></div>`;
      const personnes = base ? `<div class="portions"><span>Personnes</span><div class="stepper">
          <button id="moins" aria-label="Moins de personnes">${icon('minus')}</button><b id="nb">${etat.portions}</b>
          <button id="plus" aria-label="Plus de personnes">${icon('plus')}</button></div></div>` : '';
      const moule = mouleRecette ? `<div class="moule-carte">
          <div class="moule-ligne"><span class="aide">Recette prévue pour</span><b>${esc(texteMoule(mouleRecette))}</b></div>
          <div class="moule-formes" role="group" aria-label="Forme de mon moule">${['rond', 'carré', 'rectangle'].map(f =>
            `<button data-forme="${f}" aria-pressed="${mien.forme === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
          <div class="moule-ligne"><span>${mien.forme === 'rond' ? 'Diamètre' : mien.forme === 'carré' ? 'Côté' : 'Longueur'}</span>${taille('taille-a', mien.a, 'Moule')}</div>
          ${mien.forme === 'rectangle' ? `<div class="moule-ligne"><span>Largeur</span>${taille('taille-b', mien.b, 'Largeur')}</div>` : ''}
          <p class="moule-facteur" id="facteur-moule">Quantités × ${fois(facteur())} (surface du moule)${base ? `, soit ≈ ${Math.max(1, Math.round(base * facteur()))} personne${Math.round(base * facteur()) > 1 ? 's' : ''}` : ''}</p>
        </div>` : '';
      contenu.innerHTML = `${mouleRecette ? `<div class="segments deux" role="group" aria-label="Adapter les quantités">
          <button data-mode="personnes" aria-pressed="${!enMoule()}">Personnes</button>
          <button data-mode="moule" aria-pressed="${enMoule()}">Taille du moule</button></div>` : ''}
        ${enMoule() ? moule : personnes}
        ${lignes || '<div class="vide"><p>Aucun ingrédient.</p></div>'}
        ${aAjuster ? `<p class="aide note-ajuster"><span class="ajuster">à ajuster</span> : quantité que l'app n'a pas su recalculer ${enMoule() ? 'pour ce moule' : `pour ${etat.portions} personne${etat.portions > 1 ? 's' : ''}`}, à multiplier vous-même (×${fois(facteur())}).</p>` : ''}`;
      const maj = () => { sauver(); majLien(); vues.ingredients(); };
      const changer = d => { etat.portions = Math.max(1, etat.portions + d); maj(); };
      contenu.querySelector('#moins')?.addEventListener('click', () => changer(-1));
      contenu.querySelector('#plus')?.addEventListener('click', () => changer(1));
      contenu.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { etat.mode = b.dataset.mode; maj(); }));
      contenu.querySelectorAll('[data-forme]').forEach(b => b.addEventListener('click', () => {
        const f = b.dataset.forme;
        etat.monMoule = { forme: f, a: mien.a, b: f === 'rectangle' ? (mien.forme === 'rectangle' ? mien.b : mien.a) : mien.a };
        maj();
      }));
      contenu.querySelectorAll('[data-taille]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.taille === 'taille-a' ? 'a' : 'b';
        const v = Math.max(5, Math.round(mien[k]) + Number(b.dataset.d));
        etat.monMoule = { ...mien, [k]: v };
        if (mien.forme !== 'rectangle') etat.monMoule.b = etat.monMoule.a;
        maj();
      }));
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
        <section class="carnet" id="carnet"></section>
        ${src}
        ${(m.tags || []).length ? `<div class="tags">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${m.ajoutee ? `<p class="aide" style="margin-top:16px">Ajoutée le ${esc(new Date(m.ajoutee).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>` : ''}
        <div class="actions-fiche">
          <a class="bouton secondaire petit" href="#/modifier/${encodeURIComponent(r.slug)}">${icon('edit')}Modifier</a>
          <button class="bouton danger petit" id="suppr">${icon('trash')}Supprimer</button>
        </div>`;
      vues.carnet(contenu.querySelector('#carnet'), ouvrirCarnet);
      contenu.querySelector('#suppr').onclick = async e => {
        if (!confirm(`Supprimer définitivement « ${m.titre} » ?`)) return;
        e.currentTarget.disabled = true;
        try { await store.supprimerRecette(r.slug); toast('Recette supprimée'); location.replace('#/'); }
        catch (err) { e.currentTarget.disabled = false; alert(err.message); }
      };
    },
    // Mon carnet : une note par fois cuisinée (avis, moule, four, personnes), enregistrée dans la recette.
    carnet(bloc, formulaireOuvert = false) {
      const notes = r.carnet || [];
      const date = d => new Date(d + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      const classeAvis = a => (a === 'Réussi' ? 'ok' : a === 'Raté' ? 'rate' : '');
      bloc.innerHTML = `<div class="carnet-tete"><h2>Mon carnet</h2>
          ${formulaireOuvert ? '' : `<button class="lien" id="carnet-ajouter">${icon('plus')}Ajouter</button>`}</div>
        ${notes.length ? `<p class="aide carnet-stats">Cuisinée ${notes.length} fois · dernière fois le ${esc(date(notes[0].date))}</p>` : ''}
        ${formulaireOuvert ? formulaireCarnet() : ''}
        ${notes.length ? `<ul class="carnet-liste">${notes.map((n, k) => `<li class="carte carnet-note">
            <div class="carnet-ligne"><span class="aide">${esc(date(n.date))}${n.personnes ? ` · ${n.personnes} pers.` : ''}</span>
              ${n.avis ? `<span class="avis ${classeAvis(n.avis)}">${esc(n.avis)}</span>` : ''}
              <button class="carnet-suppr" data-k="${k}" aria-label="Supprimer la note du ${esc(date(n.date))}">${icon('x')}</button></div>
            ${n.moule || n.four ? `<div class="carnet-details">${[n.moule && `Moule ${esc(n.moule)}`, n.four && `Four ${esc(n.four)}`].filter(Boolean).join(' · ')}</div>` : ''}
            ${n.texte ? `<p>${esc(n.texte)}</p>` : ''}</li>`).join('')}</ul>`
          : formulaireOuvert ? '' : '<p class="aide">Note ici comment ça s\'est passé : moule, four, ce qu\'il faudra changer la prochaine fois.</p>'}`;
      bloc.querySelector('#carnet-ajouter')?.addEventListener('click', () => {
        vues.carnet(bloc, true);
        bloc.querySelector('[name=texte]')?.focus();
      });
      bloc.querySelectorAll('.carnet-suppr').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Supprimer cette note du carnet ?')) return;
        const k = +b.dataset.k;
        await enregistrerCarnet(notes.filter((_, i) => i !== k), 'Note supprimée', bloc);
      }));
      const form = bloc.querySelector('form');
      if (!form) return;
      form.querySelectorAll('[data-avis]').forEach(b => b.addEventListener('click', () => {
        const oui = b.getAttribute('aria-pressed') !== 'true';
        form.querySelectorAll('[data-avis]').forEach(x => x.setAttribute('aria-pressed', String(oui && x === b)));
      }));
      form.querySelector('#carnet-annuler').onclick = () => vues.carnet(bloc);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = new FormData(form);
        const four = d.get('four').trim();
        const note = {
          date: d.get('date') || new Date().toISOString().slice(0, 10),
          avis: form.querySelector('[data-avis][aria-pressed="true"]')?.dataset.avis || '',
          moule: d.get('moule').trim(),
          four: /^\d+$/.test(four) ? `${four} °C` : four,
          personnes: parseInt(d.get('personnes'), 10) || '',
          texte: d.get('texte').trim(),
        };
        if (!note.avis && !note.moule && !note.four && !note.texte) { toast('La note est vide.'); return; }
        form.querySelector('[type=submit]').disabled = true;
        // La plus récente en premier.
        const liste = [...notes, note].sort((a, b) => b.date.localeCompare(a.date));
        await enregistrerCarnet(liste, 'Note ajoutée au carnet', bloc);
      });
    },
  };

  function formulaireCarnet() {
    const moule = enMoule() ? texteMoule(etat.monMoule) : mouleRecette ? texteMoule(mouleRecette) : '';
    return `<form class="carte carnet-form" id="carnet-form">
      <div class="rangee">
        <label class="champ"><span>Date</span><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="champ"><span>Personnes</span><input name="personnes" type="number" inputmode="numeric" min="1" value="${enMoule() || !base ? '' : etat.portions}"></label>
      </div>
      <div class="champ"><span>C'était comment ?</span><div class="avis-choix" role="group" aria-label="Avis">${AVIS.map(a =>
        `<button type="button" data-avis="${esc(a)}" aria-pressed="false">${esc(a)}</button>`).join('')}</div></div>
      <div class="rangee">
        <label class="champ"><span>Moule</span><input name="moule" value="${esc(moule)}" placeholder="rond 24 cm"></label>
        <label class="champ"><span>Four</span><input name="four" inputmode="numeric" placeholder="180 °C"></label>
      </div>
      <label class="champ"><span>Note</span><textarea name="texte" rows="3" placeholder="Pousse 1 h 30, baisser le four la prochaine fois…"></textarea></label>
      <div class="actions-fiche">
        <button type="button" class="bouton secondaire petit" id="carnet-annuler">Annuler</button>
        <button type="submit" class="bouton petit">${icon('check')}Enregistrer</button>
      </div>
    </form>`;
  }

  // Le carnet est dans le fichier de la recette (section « ## Carnet ») : il est enregistré dans le dépôt.
  async function enregistrerCarnet(liste, message, bloc) {
    const avant = r.carnet;
    r.carnet = liste;
    try {
      await store.enregistrerRecette(r);
      toast(message);
      vues.carnet(bloc);
    } catch (err) {
      r.carnet = avant;
      bloc.querySelector('[type=submit]')?.removeAttribute('disabled');
      alert(`Enregistrement impossible : ${err.message}`);
    }
  }

  Object.keys(panneaux).forEach(o => vues[o]());
  majLien();
  ongletsGlissants(root, piste, { depart: etat.onglet, surChangement: o => { if (etat.onglet !== o) { etat.onglet = o; sauver(); } } });
  // « Noter dans le carnet » : on arrive sur le formulaire, pas en haut de la recette
  // (après le retour en haut que fait le routeur à chaque nouvel écran).
  if (ouvrirCarnet) setTimeout(() => panneaux.notes.querySelector('#carnet')?.scrollIntoView({ block: 'start' }), 0);
}
