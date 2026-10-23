// Ajout (import par lien ou saisie manuelle) et modification d'une recette.

import * as store from '../store.js';
import { CATEGORIES, emptyRecipe, groupsToText, textToGroups, parseIngredient, nonRecalcule, listePhotos, lireMoule, texteMoule } from '../format.js';
import { esc, icon, retour, toast, ongletsGlissants } from '../ui.js';

function formulaire(root, r, { titrePage, onAnnuler }) {
  const m = r.meta;
  const cats = [...new Set([...CATEGORIES, m.categorie].filter(Boolean))];
  // Photos, la principale en premier : { chemin } déjà dans le dépôt, ou { blob, url } nouvelle.
  let photos = listePhotos(m).map(chemin => ({ chemin }));
  let photosModifiees = false;

  root.insertAdjacentHTML('beforeend', `
    <form id="form" novalidate>
      <label class="champ"><span>Titre *</span><input name="titre" required value="${esc(m.titre)}" placeholder="Tarte tatin" autocomplete="off"></label>
      <div class="champ"><span>Photos</span>
        <div class="photos-liste" id="photos"></div>
        <div class="photo-btns">
          <label class="bouton secondaire petit">${icon('image')}Galerie<input type="file" accept="image/*" multiple id="f-galerie"></label>
          <label class="bouton secondaire petit">${icon('camera')}Appareil photo<input type="file" accept="image/*" capture="environment" id="f-camera"></label>
        </div>
        <small>La première est la photo principale. Faites glisser une photo pour changer l'ordre, ou touchez-la pour la mettre en premier.</small>
      </div>
      <label class="champ"><span>Catégorie</span>
        <select name="categorie">${cats.map(c => `<option ${c === m.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="rangee">
        <label class="champ"><span>Personnes</span><input name="portions" type="number" inputmode="numeric" min="1" value="${esc(m.portions)}"></label>
        <label class="champ"><span>Prépa (min)</span><input name="preparation" type="number" inputmode="numeric" min="0" value="${esc(m.preparation)}"></label>
        <label class="champ"><span>Cuisson (min)</span><input name="cuisson" type="number" inputmode="numeric" min="0" value="${esc(m.cuisson)}"></label>
        <label class="champ"><span>Repos (min)</span><input name="repos" type="number" inputmode="numeric" min="0" value="${esc(m.repos)}"><small>Pousse, frigo, marinade…</small></label>
      </div>
      <label class="champ"><span>Moule (facultatif)</span><input name="moule" value="${esc(m.moule || '')}" placeholder="rond 24 cm, carré 20 cm, rectangle 30 x 20 cm">
        <small>Pour adapter les quantités à un autre moule depuis la fiche.</small></label>
      <label class="champ"><span>Ingrédients</span>
        <textarea name="ingredients" rows="8" placeholder="200 g farine&#10;6 pommes Golden&#10;1 pincée fleur de sel">${esc(groupsToText(r.ingredients))}</textarea>
        <small>Un ingrédient par ligne, quantité en premier (« 200 g farine »). Pour des sous-parties, écrire une ligne « ### Pour la pâte ».</small></label>
      <div id="verif-ing" class="verif" hidden></div>
      <details class="aide-bloc">
        <summary>Comment écrire les ingrédients ?</summary>
        <p>Pour que les quantités soient recalculées selon le nombre de personnes, écrire <b>quantité → unité → ingrédient</b>.</p>
        <ul>
          <li><b>Quantités</b> : <code>2</code>, <code>1,5</code>, <code>1/2</code>, <code>½</code>, <code>2-3</code>, <code>2 à 3</code>, <code>un</code>, <code>une</code>, <code>deux</code>…</li>
          <li><b>Unités</b> : <code>g</code>, <code>kg</code>, <code>mL</code>, <code>cL</code>, <code>L</code>, <code>c. à soupe</code> (ou <code>cuillère à soupe</code>, <code>cs</code>), <code>c. à café</code> (ou <code>cc</code>), pincée, sachet, pot, gousse, tranche, verre, botte, feuille…</li>
          <li>Pas d'unité ? Ça marche aussi : <code>6 pommes</code>.</li>
          <li>« de » / « d' » sont acceptés : <code>200 g de farine</code>.</li>
        </ul>
        <table>
          <tr><th>Écrire</th><th>Plutôt que</th></tr>
          <tr><td><code>200 g farine</code></td><td><code>Farine : 200 g</code></td></tr>
          <tr><td><code>1 c. à soupe sucre</code></td><td><code>1 cuillère soupe sucre</code></td></tr>
          <tr><td><code>87 g yaourt</code></td><td><code>1 pot yaourt (87 g)</code></td></tr>
        </table>
        <p>Une ligne sans quantité (<code>sel, poivre</code>) est affichée telle quelle. Un nombre placé ailleurs qu'en début de ligne n'est <b>pas recalculé</b> : la fiche le signale par « à ajuster » quand on change le nombre de personnes.</p>
      </details>
      <label class="champ"><span>Étapes</span>
        <textarea name="etapes" rows="10" placeholder="Préchauffer le four à 180 °C.&#10;Mélanger la farine et le beurre…">${esc(groupsToText(r.etapes))}</textarea>
        <small>Une étape par ligne. Les durées (« 12 min ») deviennent des minuteurs. **mot** pour mettre en valeur.</small></label>
      <details class="aide-bloc">
        <summary>Comment écrire les étapes ?</summary>
        <ul>
          <li><b>Une étape par ligne</b> : elle s'affiche seule, en grand, en mode cuisine.</li>
          <li><b>Minuteurs</b> : une durée écrite dans l'étape (<code>12 min</code>, <code>1 h</code>, <code>1h30</code>, <code>20-22 min</code>) propose un minuteur.</li>
          <li><b>Mise en valeur</b> : <code>**bien serrés**</code> s'affiche en couleur.</li>
          <li><b>Sous-parties</b> : une ligne <code>### Pour la pâte</code>. Si une sous-partie d'ingrédients porte le même nom, le mode cuisine propose ses ingrédients à chaque étape.</li>
        </ul>
      </details>
      <label class="champ"><span>Notes</span><textarea name="notes" rows="4">${esc(r.notes)}</textarea></label>
      <label class="champ"><span>Mots-clés</span><input name="tags" value="${esc((m.tags || []).join(', '))}" placeholder="classique, pommes" autocomplete="off"><small>Séparés par des virgules.</small></label>
      <label class="champ"><span>Source</span><input name="source" value="${esc(m.source)}" placeholder="https://…" autocomplete="off"></label>
      <div class="barre-bas"><div>
        <button type="button" class="bouton secondaire" id="annuler">Annuler</button>
        <button type="submit" class="bouton" id="enreg">${icon('check')}Enregistrer</button>
      </div></div>
    </form>`);

  const form = root.querySelector('#form');

  const zonePhotos = form.querySelector('#photos');
  let bloquerClic = 0;
  // Glisser-déposer : la photo suit le doigt et prend la place de celle sur laquelle on la lâche.
  const deplacable = el => {
    let doigt = null, x0 = 0, y0 = 0, glisse = false, cible = null;
    el.addEventListener('pointerdown', e => {
      if (doigt !== null || e.button > 0 || e.target.closest('.vp-retirer')) return;
      doigt = e.pointerId; x0 = e.clientX; y0 = e.clientY; glisse = false; cible = null;
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== doigt) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!glisse && Math.hypot(dx, dy) > 6) { glisse = true; el.setPointerCapture(doigt); el.classList.add('deplacee'); }
      if (!glisse) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      cible = [...zonePhotos.children].find(v => {
        const b = v.getBoundingClientRect();
        return v !== el && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      }) || null;
      zonePhotos.querySelectorAll('.vignette-photo').forEach(v => v.classList.toggle('cible', v === cible));
    });
    const fin = e => {
      if (e.pointerId !== doigt) return;
      doigt = null;
      if (!glisse) return;
      bloquerClic = Date.now();
      if (cible && e.type === 'pointerup') {
        photos.splice(+cible.dataset.i, 0, ...photos.splice(+el.dataset.i, 1));
        photosModifiees = true;
      }
      afficherPhotos();
    };
    el.addEventListener('pointerup', fin);
    el.addEventListener('pointercancel', fin);
  };
  const afficherPhotos = () => {
    zonePhotos.innerHTML = photos.map((p, i) => `<div class="vignette-photo" data-i="${i}">
        <button type="button" class="vp-image" aria-label="${i ? 'Mettre en photo principale' : 'Photo principale'}"></button>
        ${i ? '' : '<span class="vp-principale">Principale</span>'}
        <button type="button" class="vp-retirer" aria-label="Retirer cette photo">${icon('x')}</button>
      </div>`).join('');
    zonePhotos.querySelectorAll('.vignette-photo').forEach(async el => {
      const p = photos[+el.dataset.i];
      const url = p.url || await store.photoUrlChemin(p.chemin);
      if (url && el.isConnected) el.querySelector('.vp-image').style.backgroundImage = `url("${url}")`;
    });
    zonePhotos.querySelectorAll('.vignette-photo').forEach(deplacable);
    zonePhotos.querySelectorAll('.vp-image').forEach(b => b.addEventListener('click', () => {
      const i = +b.closest('.vignette-photo').dataset.i;
      if (!i || Date.now() - bloquerClic < 400) return;
      photos.unshift(...photos.splice(i, 1));
      photosModifiees = true;
      afficherPhotos();
    }));
    zonePhotos.querySelectorAll('.vp-retirer').forEach(b => b.addEventListener('click', () => {
      photos.splice(+b.closest('.vignette-photo').dataset.i, 1);
      photosModifiees = true;
      afficherPhotos();
    }));
  };
  afficherPhotos();

  const choisir = async e => {
    for (const f of e.target.files || []) {
      try {
        const blob = await store.preparerPhoto(f);
        photos.push({ blob, url: URL.createObjectURL(blob) });
        photosModifiees = true;
      } catch { toast('Impossible de lire une des images.'); }
    }
    e.target.value = '';
    afficherPhotos();
  };
  form.querySelector('#f-galerie').addEventListener('change', choisir);
  form.querySelector('#f-camera').addEventListener('change', choisir);
  form.querySelector('#annuler').onclick = onAnnuler;

  // Signale en direct les lignes dont la quantité ne sera pas recalculée.
  const verif = form.querySelector('#verif-ing');
  const verifier = () => {
    const lignes = textToGroups(form.ingredients.value).flatMap(g => g.items).map(parseIngredient).filter(nonRecalcule);
    verif.hidden = !lignes.length;
    verif.innerHTML = lignes.length ? `<b>Non recalculé${lignes.length > 1 ? 's' : ''} selon le nombre de personnes :</b>
      <ul>${lignes.map(l => `<li>${esc(l.raw)}</li>`).join('')}</ul>Mettre la quantité en début de ligne (voir l'aide ci-dessous).` : '';
  };
  form.ingredients.addEventListener('input', verifier);
  verifier();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(form);
    const titre = d.get('titre').trim();
    if (!titre) { form.titre.focus(); toast('Le titre est obligatoire.'); return; }
    const mouleSaisi = d.get('moule').trim();
    const moule = mouleSaisi ? lireMoule(mouleSaisi) : null;
    if (mouleSaisi && !moule) { form.moule.focus(); toast('Moule : indiquer la taille, par ex. « rond 24 cm ».'); return; }
    const num = k => { const v = parseInt(d.get(k), 10); return Number.isFinite(v) && v >= 0 ? v : ''; };
    Object.assign(r.meta, {
      titre,
      categorie: d.get('categorie'),
      tags: d.get('tags').split(',').map(s => s.trim()).filter(Boolean),
      portions: num('portions') || '',
      preparation: num('preparation'),
      cuisson: num('cuisson'),
      repos: num('repos'),
      source: d.get('source').trim(),
    });
    if (moule) r.meta.moule = texteMoule(moule); else delete r.meta.moule;
    delete r.meta.difficulte; // plus de niveau : rien n'est difficile en cuisine
    r.ingredients = textToGroups(d.get('ingredients')).map(g => ({ group: g.group, items: g.items.map(parseIngredient) }));
    r.etapes = textToGroups(d.get('etapes'));
    r.notes = d.get('notes').trim();
    const btn = form.querySelector('#enreg');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Enregistrement…';
    try {
      const slug = await store.enregistrerRecette(r, photosModifiees ? photos : undefined);
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
  root.insertAdjacentHTML('beforeend', `<div class="zone-suppr">
    <button type="button" class="bouton danger large" id="suppr-recette">${icon('trash')}Supprimer la recette</button></div>`);
  root.querySelector('#suppr-recette').onclick = async e => {
    if (!confirm(`Supprimer définitivement « ${orig.meta.titre} » ?`)) return;
    e.currentTarget.disabled = true;
    try { await store.supprimerRecette(orig.slug); toast('Recette supprimée'); location.replace('#/'); }
    catch (err) { e.currentTarget.disabled = false; alert(err.message); }
  };
}

export function ajouter(root, { query }) {
  if (exigeConfig(root)) return;
  const url = query.get('url') || '';
  const onglet = query.get('manuel') === '1' ? 'manuel' : 'lien';
  root.className = 'page sans-tabbar';
  root.innerHTML = `<div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
      <h1 class="titre-page">Nouvelle recette</h1></div>
    <div class="segments" role="tablist" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:0">
      <button role="tab" data-o="lien">Par lien</button>
      <button role="tab" data-o="manuel">Saisie manuelle</button>
    </div>
    <div class="onglets-piste" id="piste">
      <div class="panneau" role="tabpanel" data-o="lien">
        <div class="carte-bloc">
          <h2>Importer depuis un site</h2>
          <p>Marmiton, 750g, Cuisine AZ, Journal des Femmes, blogs… L'import prend environ une minute et se fait en arrière-plan.</p>
          <form id="f-lien">
            <label class="champ"><span class="sr">Adresse de la recette</span>
              <input name="url" type="url" inputmode="url" placeholder="https://www.marmiton.org/recettes/…" value="${esc(url)}" required autocomplete="off"></label>
            <button class="bouton large" id="go">${icon('link')}Importer la recette</button>
          </form>
        </div>
        <p class="aide" style="margin-top:16px">Astuce : depuis Chrome ou l'app Marmiton, utilisez <b>Partager → Recettes</b> : l'import part tout seul.</p>
      </div>
      <div class="panneau" role="tabpanel" data-o="manuel"></div>
    </div>`;
  root.querySelector('#retour').onclick = () => retour();
  const piste = root.querySelector('#piste');
  const panneaux = Object.fromEntries([...piste.children].map(p => [p.dataset.o, p]));

  panneaux.lien.querySelector('#f-lien').addEventListener('submit', async e => {
    e.preventDefault();
    const v = e.target.url.value.trim();
    let u;
    try { u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { toast('Adresse invalide.'); return; }
    const b = panneaux.lien.querySelector('#go');
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

  // Lien reçu par « Partager → Recettes » : on lance l'import directement.
  if (url && query.get('auto') === '1') panneaux.lien.querySelector('#f-lien').requestSubmit();

  const r = emptyRecipe();
  if (url) r.meta.source = url;
  formulaire(panneaux.manuel, r, { onAnnuler: () => retour() });

  // Même glissement que les onglets d'une fiche ; la barre Annuler / Enregistrer
  // ne concerne que la saisie manuelle.
  ongletsGlissants(root, piste, { depart: onglet, surChangement: o => root.classList.toggle('sur-lien', o === 'lien') });
}
