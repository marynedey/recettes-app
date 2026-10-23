// Réglages : prénom, jeton GitHub, dépôt, test de connexion.

import * as store from '../store.js';
import { GitHub } from '../github.js';
import { esc, icon, retour, toast } from '../ui.js';

export const VERSION = '1.6.0';

export function reglagesVue(root) {
  const r = store.reglages();
  const sync = store.derniereSync();
  root.className = 'page sans-tabbar';
  root.innerHTML = `
    <div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
      <h1 class="titre-page">Réglages</h1></div>
    <form id="f">
      <div class="carte-bloc">
        <h2>Vous</h2>
        <label class="champ"><span>Prénom</span><input name="prenom" value="${esc(r.prenom)}" autocomplete="given-name" placeholder="Pour « Bonsoir … »"></label>
      </div>
      <div class="carte-bloc">
        <h2>Dépôt GitHub</h2>
        <p>Les recettes sont lues et enregistrées dans votre dépôt privé. Le jeton reste uniquement sur ce téléphone.</p>
        <label class="champ"><span>Jeton d'accès (fine-grained)</span>
          <span class="jeton-ligne">
            <input name="jeton" type="text" class="masque" value="${esc(r.jeton)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="github_pat_…">
            <button type="button" class="bouton secondaire petit" id="voir">Afficher</button>
          </span>
          <small>Limité au dépôt des recettes, permission « Contents : Read and write ».</small></label>
        <label class="champ"><span>Dépôt</span>
          <input name="depot" value="${esc(r.depot)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="utilisateur/mes-recettes"></label>
        <button class="bouton large" id="tester">${icon('check')}Enregistrer et tester</button>
        <div id="etat"></div>
      </div>
    </form>
    <div class="carte-bloc">
      <h2>Données</h2>
      <p>${store.recettes().length} recette(s) sur ce téléphone${sync ? ` · synchronisées ${new Date(sync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="bouton secondaire petit" id="sync">${icon('refresh')}Synchroniser</button>
        <button class="bouton danger petit" id="vider">${icon('trash')}Vider le cache</button>
      </div>
    </div>
    <p class="aide" style="text-align:center;margin-top:24px">Mes Recettes · version ${VERSION}</p>`;

  root.querySelector('#retour').onclick = () => retour();
  const champJeton = root.querySelector('[name=jeton]');
  root.querySelector('#voir').onclick = e => {
    const masque = champJeton.classList.toggle('masque');
    e.currentTarget.textContent = masque ? 'Afficher' : 'Masquer';
  };
  const etat = root.querySelector('#etat');
  const afficherEtat = (cls, html) => { etat.className = `etat ${cls}`; etat.innerHTML = html; };

  root.querySelector('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const d = new FormData(e.target);
    const nouveau = { prenom: d.get('prenom').trim(), jeton: d.get('jeton').replace(/\s+/g, ''), depot: d.get('depot').trim().replace(/^https:\/\/github.com\//, '').replace(/\/$/, '') };
    store.enregistrerReglages(nouveau);
    if (!nouveau.jeton) { afficherEtat('', 'Réglages enregistrés (pas de jeton).'); return; }
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(nouveau.jeton)) {
      afficherEtat('ko', `Ce n'est pas un jeton GitHub : il doit commencer par <b>github_pat_</b> (ici : « ${esc(nouveau.jeton.slice(0, 6))}… », ${nouveau.jeton.length} caractères). Touchez « Afficher » pour vérifier, puis recollez-le.`);
      return;
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(nouveau.depot)) { afficherEtat('ko', 'Le dépôt doit être de la forme <b>utilisateur/nom-du-depot</b>.'); return; }
    afficherEtat('', '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> Connexion…');
    try {
      const info = await new GitHub(nouveau).repoInfo();
      if (info.permissions && !info.permissions.push) {
        afficherEtat('ko', `Connecté à <b>${esc(info.full_name)}</b>, mais en lecture seule : ajoutez la permission « Contents : Read and write » au jeton.`);
        return;
      }
      await store.synchroniser();
      afficherEtat('ok', `Connecté à <b>${esc(info.full_name)}</b>${info.private ? ' (privé)' : ''} · ${store.recettes().length} recette(s).`);
      window.dispatchEvent(new Event('mr:imports'));
    } catch (err) {
      afficherEtat('ko', esc(err.message));
    }
  });

  root.querySelector('#sync').onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await store.synchroniser(); toast('Recettes à jour'); reglagesVue(root); }
    catch (err) { toast(err.message, 4000); b.disabled = false; }
  };
  root.querySelector('#vider').onclick = () => {
    if (!confirm('Effacer les recettes et photos gardées sur ce téléphone ? (Rien n\'est supprimé sur GitHub.)')) return;
    store.viderCache();
    toast('Cache vidé');
    reglagesVue(root);
  };
}
