// Réglages : rubriques repliables (prénom, connexion GitHub, apparence, serveur des minuteurs, données).

import * as store from '../store.js';
import { GitHub } from '../github.js';
import * as push from '../push.js';
import { esc, icon, retour, toast } from '../ui.js';

export const VERSION = '1.21.0';

const THEMES = [['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']];

// Chaque rubrique est repliée : une ligne (titre + résumé), une flèche pour dérouler le détail.
const rubrique = (id, ic, titre, resume, contenu, ouvert = false) => `
  <details class="reglage" id="${id}"${ouvert ? ' open' : ''}>
    <summary>${icon(ic)}<span><b>${titre}</b><small class="resume">${resume}</small></span>${icon('chevron')}</summary>
    <div class="reglage-corps">${contenu}</div>
  </details>`;

export function reglagesVue(root) {
  const r = store.reglages();
  const sync = store.derniereSync();
  const theme = window.mrTheme?.lire() || 'auto';
  const date = sync ? new Date(sync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  root.className = 'page sans-tabbar';
  root.innerHTML = `
    <div class="retour-tete"><button class="btn-rond" id="retour" aria-label="Retour">${icon('back')}</button>
      <h1 class="titre-page">Réglages</h1></div>
    <div class="reglages">
    ${rubrique('r-vous', 'user', 'Vous', esc(r.prenom || 'Pas de prénom'), `
      <label class="champ"><span>Prénom</span><input name="prenom" value="${esc(r.prenom)}" autocomplete="given-name" placeholder="Pour « Bonsoir … »"></label>`)}
    ${rubrique('r-github', 'link', 'Connexion GitHub', r.jeton ? esc(r.depot) : 'À configurer', `
      <form id="f">
        <p class="aide">Les recettes sont lues et enregistrées dans votre dépôt privé. Le jeton reste uniquement sur ce téléphone.</p>
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
      </form>`, !r.jeton)}
    ${rubrique('r-apparence', 'sun', 'Apparence', THEMES.find(([v]) => v === theme)[1], `
      <div class="segments trois" role="group" aria-label="Apparence">${THEMES.map(([v, lib]) =>
        `<button type="button" data-theme-choix="${v}" aria-pressed="${v === theme}">${lib}</button>`).join('')}</div>
      <p class="aide">Automatique : comme le téléphone (clair le jour, sombre le soir si le téléphone le fait).</p>`)}
    ${rubrique('r-minuteurs', 'clock', 'Minuteurs, app fermée', r.serveur ? 'Serveur activé' : 'Désactivé', `
      <p class="aide">Avec le serveur des minuteurs, la fin d'un minuteur sonne même quand l'app est fermée. Il ne reçoit que l'heure de fin, rien sur vos recettes.</p>
      <form id="f-serveur">
        <label class="champ"><span>Adresse du serveur (facultatif)</span>
          <input name="serveur" type="url" inputmode="url" value="${esc(r.serveur || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://mes-recettes-minuteurs.….workers.dev"></label>
        <button class="bouton secondaire large" id="tester-serveur">${icon('clock')}Enregistrer et tester</button>
      </form>
      <div id="etat-serveur"></div>`)}
    ${rubrique('r-donnees', 'refresh', 'Données', `${store.recettes().length} recette(s)${date ? ` · synchro ${date}` : ''}`, `
      <p class="aide">${store.recettes().length} recette(s) sur ce téléphone${date ? `, synchronisées le ${date}` : ''}. Vider le cache ne supprime rien sur GitHub.</p>
      <div class="actions-ligne">
        <button class="bouton secondaire petit" id="sync">${icon('refresh')}Synchroniser</button>
        <button class="bouton danger petit" id="vider">${icon('trash')}Vider le cache</button>
      </div>`)}
    </div>
    <p class="aide" style="text-align:center;margin-top:24px">Mes Recettes · version ${VERSION}</p>`;

  // Prénom : enregistré dès qu'on le tape.
  root.querySelector('[name=prenom]').addEventListener('input', e => {
    store.enregistrerReglages({ prenom: e.target.value.trim() });
    root.querySelector('#r-vous .resume').textContent = e.target.value.trim() || 'Pas de prénom';
  });
  // Apparence : appliquée tout de suite, retenue sur ce téléphone.
  root.querySelectorAll('[data-theme-choix]').forEach(b => b.addEventListener('click', () => {
    window.mrTheme?.choisir(b.dataset.themeChoix);
    root.querySelectorAll('[data-theme-choix]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    root.querySelector('#r-apparence .resume').textContent = b.textContent;
  }));
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
    const nouveau = { jeton: d.get('jeton').replace(/\s+/g, ''), depot: d.get('depot').trim().replace(/^https:\/\/github.com\//, '').replace(/\/$/, '') };
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
      root.querySelector('#r-github .resume').textContent = info.full_name;
      afficherEtat('ok', `Connecté à <b>${esc(info.full_name)}</b>${info.private ? ' (privé)' : ''} · ${store.recettes().length} recette(s).`);
      window.dispatchEvent(new Event('mr:imports'));
    } catch (err) {
      afficherEtat('ko', esc(err.message));
    }
  });

  const etatServeur = root.querySelector('#etat-serveur');
  root.querySelector('#f-serveur').addEventListener('submit', async e => {
    e.preventDefault();
    const serveur = e.target.serveur.value.trim().replace(/\/+$/, '');
    const afficher = (cls, html) => { etatServeur.className = `etat ${cls}`; etatServeur.innerHTML = html; };
    if (serveur && !/^https:\/\/[^/\s]+$/.test(serveur)) { afficher('ko', 'L\'adresse doit commencer par <b>https://</b> (par exemple https://mes-recettes-minuteurs.nom.workers.dev).'); return; }
    store.enregistrerReglages({ serveur });
    root.querySelector('#r-minuteurs .resume').textContent = serveur ? 'Serveur activé' : 'Désactivé';
    if (!serveur) { afficher('', 'Serveur désactivé : les minuteurs ne sonnent que l\'app ouverte.'); return; }
    afficher('', '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> Connexion…');
    try {
      await push.tester();
      afficher('ok', 'Serveur prêt. Pour vérifier : fermez l\'app, une notification « Minuteur terminé » doit arriver dans 10 secondes.');
    } catch (err) {
      afficher('ko', esc(err.message === 'Failed to fetch' ? 'Serveur injoignable : vérifiez l\'adresse.' : err.message));
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
