// Ajout (import par lien ou saisie manuelle) et modification d'une recette.

import * as store from '../store.js';
import { CATEGORIES, DIFFICULTES, emptyRecipe, groupsToText, textToGroups, parseIngredient } from '../format.js';
import { esc, icon, visuel, chargerPhotos, retour, toast } from '../ui.js';

function formulaire(root, r, { titrePage, onAnnuler }) {
  const m = r.meta;
  const cats = [...new Set([...CATEGORIES, m.categorie].filter(Boolean))];
  let photo = null;

  root.insertAdjacentHTML('beforeend', `
    <form id="form" novalidate>
      <label class="champ"><span>Titre *</span><input name="titre" required value="${esc(m.titre)}" placeholder="Tarte tatin" autocomplete="off"></label>
      <div class="champ"><span>Photo</span>
        <div class="photo-choix">
          <div class="photo-apercu" id="apercu">${visuel(r)}</div>
          <div class="photo-btns">
            <label class="bouton secondaire petit">${icon('image')}Galerie<input type="file" accept="image/*" id="f-galerie"></label>
            <label class="bouton secondaire petit">${icon('camera')}Appareil photo<input type="file" accept="image/*" capture="environment" id="f-camera"></label>
          </div>
        </div>
      </div>
      <label class="champ"><span>Catégorie</span>
        <select name="categorie">${cats.map(c => `<option ${c === m.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="rangee">
        <label class="champ"><span>Personnes</span><input name="portions" type="number" inputmode="numeric" min="1" value="${esc(m.portions)}"></label>
        <label class="champ"><span>Prépa (min)</span><input name="preparation" type="number" inputmode="numeric" min="0" value="${esc(m.preparation)}"></label>
        <label class="champ"><span>Cuisson (min)</span><input name="cuisson" type="number" inputmode="numeric" min="0" value="${esc(m.cuisson)}"></label>
        <label class="champ"><span>Repos (min)</span><input name="repos" type="number" inputmode="numeric" min="0" value="${esc(m.repos)}"><small>Pousse, frigo, marinade…</small></label>
      </div>
      <div class="champ"><span>Difficulté</span>
        <div class="choix">${DIFFICULTES.map(d => `<label><input type="radio" name="difficulte" value="${d}" ${d === (m.difficulte || 'Facile') ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
      <label class="champ"><span>Ingrédients</span>
        <textarea name="ingredients" rows="8" placeholder="200 g farine&#10;6 pommes Golden&#10;1 pincée fleur de sel">${esc(groupsToText(r.ingredients))}</textarea>
        <small>Un ingrédient par ligne, quantité en premier (« 200 g farine »). Pour des sous-parties, écrire une ligne « ### Pour la pâte ».</small></label>
      <label class="champ"><span>Étapes</span>
        <textarea name="etapes" rows="10" placeholder="Préchauffer le four à 180 °C.&#10;Mélanger la farine et le beurre…">${esc(groupsToText(r.etapes))}</textarea>
        <small>Une étape par ligne. Les durées (« 12 min ») deviennent des minuteurs. **mot** pour mettre en valeur.</small></label>
      <label class="champ"><span>Notes</span><textarea name="notes" rows="4">${esc(r.notes)}</textarea></label>
      <label class="champ"><span>Mots-clés</span><input name="tags" value="${esc((m.tags || []).join(', '))}" placeholder="classique, pommes" autocomplete="off"><small>Séparés par des virgules.</small></label>
      <label class="champ"><span>Source</span><input name="source" value="${esc(m.source)}" placeholder="https://…" autocomplete="off"></label>
      <div class="barre-bas"><div>
        <button type="button" class="bouton secondaire" id="annuler">Annuler</button>
        <button type="submit" class="bouton" id="enreg">${icon('check')}Enregistrer</button>
      </div></div>
    </form>`);

  const form = root.querySelector('#form');
  chargerPhotos(form, () => r);

  const choisir = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      photo = await store.preparerPhoto(f);
      const ap = root.querySelector('#apercu .visuel');
      ap.querySelector('img')?.remove();
      const img = new Image();
      img.src = URL.createObjectURL(photo);
      img.className = 'ok';
      ap.classList.add('a-photo');
      ap.appendChild(img);
    } catch { toast('Impossible de lire cette image.'); }
  };
  form.querySelector('#f-galerie').addEventListener('change', choisir);
  form.querySelector('#f-camera').addEventListener('change', choisir);
  form.querySelector('#annuler').onclick = onAnnuler;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(form);
    const titre = d.get('titre').trim();
    if (!titre) { form.titre.focus(); toast('Le titre est obligatoire.'); return; }
    const num = k => { const v = parseInt(d.get(k), 10); return Number.isFinite(v) && v >= 0 ? v : ''; };
    Object.assign(r.meta, {
      titre,
      categorie: d.get('categorie'),
      tags: d.get('tags').split(',').map(s => s.trim()).filter(Boolean),
      portions: num('portions') || '',
      preparation: num('preparation'),
      cuisson: num('cuisson'),
      repos: num('repos'),
      difficulte: d.get('difficulte'),
      source: d.get('source').trim(),
    });
    r.ingredients = textToGroups(d.get('ingredients')).map(g => ({ group: g.group, items: g.items.map(parseIngredient) }));
    r.etapes = textToGroups(d.get('etapes'));
    r.notes = d.get('notes').trim();
    const btn = form.querySelector('#enreg');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Enregistrement…';
    try {
      const slug = await store.enregistrerRecette(r, photo);
      toast('Recette enregistrée');
      location.replace(`#/recette/${encodeURIComponent(slug)}`);
    } catch (err) {
      btn.disabled = false; btn.innerHTML = `${icon('check')}Enregistrer`;
      alert(`Enregistrement impossible : ${err.message}`);
    }
  });
}

function exigeConfig(root) {
  if (store.estConfigure()) return false;
  root.className = 'page sans-tabbar';
  root.innerHTML = `<div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button></div>
    <div class="vide"><div class="serif">Réglages nécessaires</div><p>Ajoutez d'abord votre jeton GitHub pour pouvoir enregistrer des recettes.</p>
    <a class="bouton" href="#/reglages">Ouvrir les réglages</a></div>`;
  root.querySelector('#retour').onclick = () => retour();
  return true;
}

export function editer(root, { params }) {
  if (exigeConfig(root)) return;
  const orig = store.recette(params[0]);
  if (!orig) { location.replace('#/'); return; }
  const r = structuredClone(orig);
  root.className = 'page sans-tabbar';
  root.innerHTML = `<div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
    <h1 class="titre-page">Modifier</h1></div>`;
  root.querySelector('#retour').onclick = () => retour(`#/recette/${encodeURIComponent(r.slug)}`);
  formulaire(root, r, { onAnnuler: () => retour(`#/recette/${encodeURIComponent(r.slug)}`) });
}

export function ajouter(root, { query }) {
  if (exigeConfig(root)) return;
  const url = query.get('url') || '';
  const manuel = query.get('manuel') === '1';
  root.className = 'page sans-tabbar';
  root.innerHTML = `<div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
      <h1 class="titre-page">Nouvelle recette</h1></div>
    <div class="segments" role="tablist" style="grid-template-columns:1fr 1fr;margin-top:0">
      <button role="tab" data-o="lien" aria-selected="${!manuel}">Par lien</button>
      <button role="tab" data-o="manuel" aria-selected="${manuel}">Saisie manuelle</button>
    </div>
    <div id="zone"></div>`;
  root.querySelector('#retour').onclick = () => retour();
  const zone = root.querySelector('#zone');

  const vueLien = () => {
    zone.innerHTML = `<div class="carte-bloc">
        <h2>Importer depuis un site</h2>
        <p>Marmiton, 750g, Cuisine AZ, Journal des Femmes, blogs… L'import prend environ une minute et se fait en arrière-plan.</p>
        <form id="f-lien">
          <label class="champ"><span class="sr">Adresse de la recette</span>
            <input name="url" type="url" inputmode="url" placeholder="https://www.marmiton.org/recettes/…" value="${esc(url)}" required autocomplete="off"></label>
          <button class="bouton large" id="go">${icon('link')}Importer la recette</button>
        </form>
      </div>
      <p class="aide" style="margin-top:16px">Astuce : depuis Chrome ou l'app Marmiton, utilisez <b>Partager → Mes Recettes</b>.</p>`;
    zone.querySelector('#f-lien').addEventListener('submit', async e => {
      e.preventDefault();
      const v = e.target.url.value.trim();
      let u;
      try { u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { toast('Adresse invalide.'); return; }
      const b = zone.querySelector('#go');
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>Envoi…';
      try {
        await store.demanderImport(u.href);
        window.dispatchEvent(new Event('mr:imports'));
        toast('Import lancé, la recette arrive dans une minute.', 4000);
        location.replace('#/');
      } catch (err) {
        b.disabled = false; b.innerHTML = `${icon('link')}Importer la recette`;
        alert(err.message);
      }
    });
  };

  const vueManuel = () => {
    zone.innerHTML = '';
    const r = emptyRecipe();
    if (url) r.meta.source = url;
    formulaire(zone, r, { onAnnuler: () => retour() });
  };

  const tabs = root.querySelectorAll('[role=tab]');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.setAttribute('aria-selected', x === t));
    (t.dataset.o === 'lien' ? vueLien : vueManuel)();
  }));
  (manuel ? vueManuel : vueLien)();
}
