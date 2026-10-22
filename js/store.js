// État local : réglages, recettes en cache, photos, favoris, historique,
// imports en attente. Tout reste sur le téléphone.

import { GitHub } from './github.js';
import { parseRecipe, serializeRecipe, slugify } from './format.js';

const K = {
  reglages: 'mr.reglages',
  recettes: 'mr.recettes',
  favoris: 'mr.favoris',
  historique: 'mr.historique',
  imports: 'mr.imports',
  sync: 'mr.derniereSync',
};
const PHOTO_CACHE = 'mr-photos-v1';

function lire(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
}
function ecrire(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('Stockage local plein ?', e); }
}

/* ---------- réglages ---------- */

export function reglages() {
  return { prenom: '', jeton: '', depot: 'marynedey/mes-recettes', ...lire(K.reglages, {}) };
}
export function enregistrerReglages(r) {
  const avant = reglages();
  ecrire(K.reglages, { ...avant, ...r });
  gh = null;
  arbre = null;
  arbreTente = false;
  if (r.depot && r.depot !== avant.depot) viderCache();
}
export const estConfigure = () => !!reglages().jeton;

let gh = null;
export function github() {
  if (!gh) gh = new GitHub(reglages());
  return gh;
}

/* ---------- recettes ---------- */

// cache : { [slug]: { sha, text } } — on garde le texte brut, l'analyse est refaite au chargement.
let cache = lire(K.recettes, {});
let arbre = null; // Map chemin → sha du dernier état connu du dépôt
let arbreTente = false;
let parsed = null;
const listeners = new Set();

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notifier = () => { parsed = null; listeners.forEach(fn => fn()); };

const CAT_ALIAS = { dessert: 'Desserts', plat: 'Plats', entree: 'Entrées', vege: 'Végé', vegetarien: 'Végé', boisson: 'Boissons', aperitif: 'Apéro', sauce: 'Sauces', pain: 'Pains' };
function normaliserCategorie(c) {
  if (!c) return 'Plats';
  const k = String(c).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/s$/, '');
  return CAT_ALIAS[k] || c;
}

export function recettes() {
  if (!parsed) {
    parsed = Object.entries(cache).map(([slug, { text }]) => {
      try {
        const r = parseRecipe(text, `recettes/${slug}.md`);
        r.meta.categorie = normaliserCategorie(r.meta.categorie);
        return r;
      } catch (e) { console.warn('Recette illisible', slug, e); return null; }
    }).filter(Boolean).sort((a, b) => a.meta.titre.localeCompare(b.meta.titre, 'fr'));
  }
  return parsed;
}
export const recette = slug => recettes().find(r => r.slug === slug);
export const derniereSync = () => lire(K.sync, null);

let syncEnCours = null;
/** Récupère les nouveautés du dépôt (seuls les fichiers modifiés sont téléchargés). */
export function synchroniser() {
  if (!estConfigure()) return Promise.resolve(false);
  if (syncEnCours) return syncEnCours;
  syncEnCours = (async () => {
    const api = github();
    arbre = await api.tree();
    const suivant = {};
    let change = false;
    for (const [path, sha] of arbre) {
      const m = path.match(/^recettes\/([^/]+)\.md$/i);
      if (!m) continue;
      const slug = m[1];
      if (cache[slug]?.sha === sha) { suivant[slug] = cache[slug]; continue; }
      suivant[slug] = { sha, text: await api.blobText(sha) };
      change = true;
    }
    if (Object.keys(cache).some(s => !suivant[s])) change = true;
    cache = suivant;
    ecrire(K.recettes, cache);
    ecrire(K.sync, Date.now());
    if (change) notifier();
    return change;
  })().finally(() => { syncEnCours = null; });
  return syncEnCours;
}

async function shaActuel(path) {
  if (!arbre && !arbreTente && estConfigure()) {
    arbreTente = true;
    try { arbre = await github().tree(); } catch { return undefined; }
  }
  return arbre.get(path);
}

function slugLibre(titre) {
  const base = slugify(titre);
  let s = base, i = 2;
  while (cache[s] || arbre?.has(`recettes/${s}.md`)) s = `${base}-${i++}`;
  return s;
}

/** Réduit une image (max 1600 px) et la renvoie en JPEG. */
export async function preparerPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const img = bmp || await new Promise((ok, ko) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file);
  });
  const max = 1600;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
}

/** Enregistre (création ou modification) une recette, avec photo éventuelle. */
export async function enregistrerRecette(r, photoBlob) {
  const api = github();
  const nouveau = !r.slug;
  if (nouveau) r.slug = slugLibre(r.meta.titre);
  const path = `recettes/${r.slug}.md`;
  if (photoBlob) {
    const photoPath = `photos/${r.slug}.jpg`;
    const bytes = new Uint8Array(await photoBlob.arrayBuffer());
    const sha = await api.putFile(photoPath, bytes, `Photo : ${r.meta.titre}`, await shaActuel(photoPath));
    arbre?.set(photoPath, sha);
    await mettrePhotoEnCache(sha, photoBlob);
    const index = lire('mr.photosIndex', {}); index[photoPath] = sha; ecrire('mr.photosIndex', index);
    urls.delete(photoPath);
    r.meta.photo = photoPath;
  }
  const text = serializeRecipe(r);
  const sha = await api.putFile(path, text, `${nouveau ? 'Ajout' : 'Modification'} : ${r.meta.titre}`, nouveau ? undefined : (cache[r.slug]?.sha || await shaActuel(path)));
  arbre?.set(path, sha);
  cache[r.slug] = { sha, text };
  ecrire(K.recettes, cache);
  notifier();
  return r.slug;
}

export async function supprimerRecette(slug) {
  const r = recette(slug);
  const api = github();
  const path = `recettes/${slug}.md`;
  const sha = cache[slug]?.sha || await shaActuel(path);
  await api.deleteFile(path, sha, `Suppression : ${r?.meta.titre || slug}`);
  arbre?.delete(path);
  if (r?.meta.photo && r.meta.photo.startsWith('photos/')) {
    const psha = await shaActuel(r.meta.photo);
    if (psha) { await api.deleteFile(r.meta.photo, psha, `Suppression photo : ${r.meta.titre}`).catch(() => {}); arbre?.delete(r.meta.photo); }
  }
  delete cache[slug];
  ecrire(K.recettes, cache);
  setFavori(slug, false);
  notifier();
}

/* ---------- photos (stockées dans le Cache API, clé = sha) ---------- */

const urls = new Map();
const photoKey = sha => new URL(`./__photo/${sha}`, location.href).href;

async function mettrePhotoEnCache(sha, blob) {
  try { await (await caches.open(PHOTO_CACHE)).put(photoKey(sha), new Response(blob)); } catch { /* pas de Cache API */ }
}

/** URL affichable de la photo d'une recette (ou null). */
export async function photoUrl(r) {
  const p = r?.meta.photo;
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  if (urls.has(p)) return urls.get(p);
  let cacheStore = null;
  try { cacheStore = await caches.open(PHOTO_CACHE); } catch { /* indisponible */ }
  const sha = await shaActuel(p);
  let blob = null;
  if (sha && cacheStore) {
    const hit = await cacheStore.match(photoKey(sha));
    if (hit) blob = await hit.blob();
  }
  if (!blob && !sha && cacheStore) {
    // Hors ligne : on prend n'importe quelle version déjà connue de ce chemin.
    const index = lire('mr.photosIndex', {});
    if (index[p]) { const hit = await cacheStore.match(photoKey(index[p])); if (hit) blob = await hit.blob(); }
  }
  if (!blob && sha && estConfigure()) {
    try {
      blob = await github().blobBytes(sha);
      await mettrePhotoEnCache(sha, blob);
      const index = lire('mr.photosIndex', {}); index[p] = sha; ecrire('mr.photosIndex', index);
    } catch { return null; }
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(p, u);
  return u;
}

/* ---------- favoris, historique ---------- */

export const favoris = () => lire(K.favoris, []);
export const estFavori = slug => favoris().includes(slug);
export function setFavori(slug, on) {
  const f = favoris().filter(s => s !== slug);
  if (on) f.unshift(slug);
  ecrire(K.favoris, f);
}

export const historique = () => lire(K.historique, []);
export function marquerCuisinee(slug) {
  ecrire(K.historique, [slug, ...historique().filter(s => s !== slug)].slice(0, 20));
}

/* ---------- import par lien (traité par GitHub Actions) ---------- */

export const importsEnAttente = () => lire(K.imports, []);
const setImports = l => ecrire(K.imports, l);

export async function demanderImport(url) {
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
  const contenu = JSON.stringify({ url, demande: new Date().toISOString() }, null, 2) + '\n';
  await github().putFile(`import/a-traiter/${id}.json`, contenu, `Import demandé : ${url}`);
  setImports([...importsEnAttente(), { id, url, depuis: Date.now() }]);
  return id;
}

/**
 * Vérifie l'état des imports en attente.
 * Renvoie la liste des imports terminés : { id, url, statut: 'ok'|'erreur', slug?, titre?, message? }.
 */
export async function verifierImports() {
  const enCours = importsEnAttente();
  if (!enCours.length || !estConfigure()) return [];
  const api = github();
  const termines = [];
  const restants = [];
  for (const imp of enCours) {
    const res = await api.getFile(`import/resultats/${imp.id}.json`).catch(() => null);
    if (res) {
      let data = {};
      try { data = JSON.parse(res.text); } catch { data = { statut: 'erreur', message: 'Résultat illisible.' }; }
      termines.push({ ...imp, ...data });
      api.deleteFile(`import/resultats/${imp.id}.json`, res.sha, 'Nettoyage résultat import').catch(() => {});
    } else if (Date.now() - imp.depuis > 6 * 60 * 1000) {
      termines.push({ ...imp, statut: 'erreur', message: 'L\'import n\'a pas abouti à temps (le workflow GitHub Actions est-il activé ?).' });
    } else {
      restants.push(imp);
    }
  }
  setImports(restants);
  if (termines.some(t => t.statut === 'ok')) await synchroniser().catch(() => {});
  return termines;
}

export function oublierImport(id) { setImports(importsEnAttente().filter(i => i.id !== id)); }

export function viderCache() {
  cache = {}; arbre = null;
  ecrire(K.recettes, {});
  localStorage.removeItem('mr.photosIndex');
  urls.clear();
  caches.delete(PHOTO_CACHE).catch(() => {});
  notifier();
}
