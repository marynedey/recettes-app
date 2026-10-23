// « Avec ce que j'ai » : on écrit ses ingrédients, les recettes sont classées selon ce qu'il manque.

import * as store from '../store.js';
import { avecCeQueJai, liensRecherche, PLACARD_DEFAUT } from '../frigo.js';
import { esc, icon, visuel, chargerPhotos, retour, toast } from '../ui.js';

const lire = (k, defaut) => { try { return localStorage.getItem(k) ?? defaut; } catch { return defaut; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
const morceaux = t => t.split(/[,;\n]|\s+et\s+/i).map(s => s.trim()).filter(Boolean);

export function frigo(root) {
  let mes = lire('mr.frigo', '');
  let placard = lire('mr.placard', PLACARD_DEFAUT);
  root.className = 'page sans-tabbar';
  root.innerHTML = `
    <div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
      <h1 class="titre-page">Avec ce que j'ai</h1></div>
    <label class="champ"><span>Dans mon frigo et mes placards</span>
      <input id="mes" value="${esc(mes)}" placeholder="poulet, riz, œufs, citron" autocomplete="off" enterkeyhint="search"></label>
    <div class="puces-frigo" id="puces"></div>
    <div id="resultats-frigo"></div>
    <section class="carte-bloc sur-internet" id="internet" hidden>
      <h2>Sur internet</h2>
      <p class="aide">Des idées avec ces ingrédients. Une recette te plaît ? <b>Partager → Recettes</b> l'importe toute seule, ou colle son lien ici.</p>
      <div class="liens-internet" id="liens"></div>
      <form class="coller-lien" id="coller">
        <label class="sr" for="lien">Lien d'une recette</label>
        <input id="lien" inputmode="url" placeholder="Lien de la recette" autocomplete="off">
        <button class="bouton petit" type="submit">${icon('link')}Importer</button>
      </form>
    </section>
    <details class="placard">
      <summary>Toujours là, jamais comptés : <b id="placard-resume"></b></summary>
      <label class="champ"><span class="sr">Toujours là</span><input id="placard" value="${esc(placard)}" placeholder="${PLACARD_DEFAUT}">
        <small>Séparés par des virgules. Ce qui n'est pas ici compte (moutarde, ail, huile…).</small></label>
    </details>`;
  root.querySelector('#retour').onclick = () => retour();

  const zone = root.querySelector('#resultats-frigo');
  const afficher = () => {
    root.querySelector('#puces').innerHTML = morceaux(mes).map(m => `<span>${esc(m)}</span>`).join('');
    root.querySelector('#placard-resume').textContent = morceaux(placard).join(', ') || 'rien';
    const liens = liensRecherche(mes);
    root.querySelector('#internet').hidden = !liens.length;
    root.querySelector('#liens').innerHTML = liens.map(l =>
      `<a class="bouton secondaire petit" href="${esc(l.url)}" target="_blank" rel="noopener">${icon('search')}${esc(l.nom)}</a>`).join('');
    if (!morceaux(mes).length) {
      zone.innerHTML = '<p class="aide">Écris ce que tu as, séparé par des virgules : les recettes où il manque le moins arrivent en premier.</p>';
      return;
    }
    const res = avecCeQueJai(store.recettes(), mes, placard);
    zone.innerHTML = res.length ? `<div class="liste-frigo">${res.map(({ recette: r, manquants, part }) => {
      const manque = manquants.length > 3 ? `${manquants.slice(0, 3).join(', ')} et ${manquants.length - 3} autre${manquants.length > 4 ? 's' : ''}` : manquants.join(', ');
      return `<a class="ligne-frigo" href="#/recette/${encodeURIComponent(r.slug)}">${visuel(r, 'vignette')}
        <div><h3>${esc(r.meta.titre)}</h3>
          <p class="${manquants.length ? 'manque' : 'tout-la'}">${manquants.length ? `Il manque : ${esc(manque)}` : 'Tout est là'}</p></div>
        <span class="part">${Math.round(part * 100)} %</span></a>`;
    }).join('')}</div>`
      : '<div class="vide"><p>Aucune de mes recettes n\'utilise ces ingrédients : cherchons sur internet.</p></div>';
    chargerPhotos(zone, store.recette);
  };
  root.querySelector('#mes').addEventListener('input', e => { mes = e.target.value; ecrire('mr.frigo', mes); afficher(); });
  root.querySelector('#placard').addEventListener('input', e => { placard = e.target.value; ecrire('mr.placard', placard); afficher(); });
  // Lien collé : même import que « Partager → Recettes » (il part tout seul).
  root.querySelector('#coller').addEventListener('submit', e => {
    e.preventDefault();
    const url = (root.querySelector('#lien').value.match(/https?:\/\/\S+/) || [''])[0];
    if (!url) { toast('Colle le lien d\'une recette (https://…).'); return; }
    location.hash = `#/ajouter?url=${encodeURIComponent(url)}&auto=1`;
  });
  afficher();
}
