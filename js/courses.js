// Liste de courses : recettes prévues (avec leur nombre de personnes),
// ingrédients additionnés et rangés par rayon, ce qu'on a déjà à la maison.
// La partie calcul n'utilise pas le navigateur : testée avec `node --test`.

import { sansAccents, formatNumber, formatQty, parseIngredient, quantiteAdaptee } from './format.js';

/* ---------- unités ---------- */

// Unités converties dans une unité de base pour pouvoir additionner.
const CONVERSIONS = {
  g: ['g', 1], kg: ['g', 1000], mg: ['g', 0.001],
  mL: ['mL', 1], cL: ['mL', 10], dL: ['mL', 100], L: ['mL', 1000],
  'c. à café': ['c. à café', 1], 'c. à soupe': ['c. à café', 3],
};

// Ordre d'affichage (le dernier passe en premier).
const ORDRE_UNITES = ['c. à café', 'mL', 'g'];

/**
 * Quantité lisible dans l'unité la plus naturelle (1500 g → 1,5 kg).
 * Jamais arrondie vers le bas : sur une liste de courses, il ne doit rien manquer.
 */
export function formatQuantite(n, unite) {
  // Arrondi vers le haut : au gramme / millilitre près, sinon au quart (cuillères, pièces).
  n = unite === 'g' || unite === 'mL' ? Math.ceil(n - 1e-9) : Math.ceil(n * 4 - 1e-9) / 4;
  const f = (x, u) => formatNumber(x, u, true);
  if (unite === 'g' && n >= 1000) return `${f(n / 1000, 'kg')} kg`;
  if (unite === 'mL' && n >= 1000) return `${f(n / 1000, 'L')} L`;
  if (unite === 'mL' && n >= 100 && n % 5 === 0) return `${f(n / 10, 'cL')} cL`; // 115 mL → 11,5 cL, comme la fiche
  if (unite === 'c. à café' && n >= 3 && Number.isInteger(n / 3)) return `${f(n / 3)} c. à soupe`;
  const s = f(n, unite);
  if (!unite) return s;
  const pluriel = n > 1 && !['g', 'mL', 'c. à café', 'c. à soupe', 'noix'].includes(unite) && !unite.endsWith('s') ? 's' : '';
  return `${s} ${unite}${pluriel}`;
}

/* ---------- noms ---------- */

// États ou préparations qui ne changent pas ce qu'on achète.
const PRECISIONS = /\b(fondus?|fondues?|froids?|froides?|tr[eè]s|ti[eè]des?|chauds?|chaudes?|ramollis?|pommade|[àa] temp[ée]rature ambiante|en morceaux|bien m[ûu]re?s?|[ée]cras[ée]e?s?|fra[iî]ches?|pel[ée]e?s? et r[âa]p[ée]e?s?|r[âa]p[ée]e?s?|en lamelles|hach[ée]e?s?|entiers?|gros(se)?s?|petite?s?|pour la pr[ée]sentation|pour la d[ée]co\w*)\b/gi;

/** Nom affiché sur la liste : sans parenthèses ni précisions de préparation. */
export function nomCourses(nom) {
  // Parenthèses, même imbriquées (« beurre (demi-sel ici (doux possible)) ») : de l'intérieur vers l'extérieur.
  let s = nom;
  while (/\([^()]*\)/.test(s)) s = s.replace(/\([^()]*\)/g, '');
  return s.replace(/[()]/g, '').replace(/,.*$/, '').replace(PRECISIONS, '')
    .replace(/^(de |d['’]\s*)/i, '').replace(/\s+/g, ' ').trim();
}

/** Clé de regroupement : « Œufs », « oeuf » et « œuf » donnent la même. */
export function cleIngredient(nom) {
  return sansAccents(nomCourses(nom)).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .split(/\s+/).map(m => (m.length > 3 ? m.replace(/[sx]$/, '') : m)).join(' ');
}

/* ---------- rayons ---------- */

export const RAYONS = [
  ['Fruits et légumes', /\b(pomme|banane|citron|orange|fraise|framboise|carotte|oignon|echalote|ail|gingembre|champignon|tomate|courgette|poireau|salade|coriandre|persil|basilic|ciboulette|pomme de terre|potimarron|legume|fruit|herbe)/],
  ['Viandes et poissons', /\b(porc|poulet|boeuf|veau|jambon|chorizo|lardon|saucisse|dinde|canard|poisson|saumon|thon|crevette|viande|filet mignon|echine)/],
  ['Crèmerie', /\b(beurre|lait|creme|yaourt|fromage|comte|parmesan|mozzarella|oeuf|jaune|blanc d)/],
  ['Boulangerie', /\b(pain|brioche|baguette)/],
  ['Épicerie salée', /\b(sel|poivre|huile|vinaigre|sauce|soja|bouillon|epice|nouille|riz|pate|semoule|tofu|sesame|cacahuete|moutarde|quatre)/],
  ['Épicerie sucrée', /\b(sucre|farine|levure|bicarbonate|chocolat|cacao|miel|vanille|confiture|amande|noisette|glucose|gelatine|cafe|sirop|cannelle)/],
  ['Boissons', /\b(rhum|vin|biere|jus|eau)/],
];

export function rayon(cle) {
  return (RAYONS.find(([, re]) => re.test(cle)) || ['Autres'])[0];
}

/* ---------- liste ---------- */

/**
 * Additionne les ingrédients des recettes prévues et les articles ajoutés à la main.
 * prevues : [{ recette, portions }] ; ajouts : [{ id, texte }] (« 2 citrons », « papier cuisson »).
 * Renvoie [{ cle, nom, rayon, quantites: [{ n, unite }], sansQuantite, details: [{ titre, partie?, texte, ajout? }] }].
 */
export function listeDeCourses(prevues, ajouts = []) {
  const articles = new Map();
  const compter = (ing, facteur, detail) => {
    const nom = ing.qty == null ? ing.raw : ing.name;
    const cle = cleIngredient(nom);
    if (!cle) return;
    let a = articles.get(cle);
    if (!a) {
      const affiche = nomCourses(nom) || nom;
      a = { cle, nom: affiche[0].toUpperCase() + affiche.slice(1), rayon: rayon(cle), parUnite: new Map(), origine: new Map(), sansQuantite: false, details: [] };
      articles.set(cle, a);
    }
    if (ing.qty == null) {
      a.sansQuantite = true;
      a.details.push({ ...detail, texte: ing.raw });
      return;
    }
    // Une fourchette (« 600-800 g ») : on achète pour le haut de la fourchette.
    // Même arrondi que la fiche : 281,25 g de carottes s'affichent 280 g des deux côtés.
    const q = quantiteAdaptee(ing.qtyMax ?? ing.qty, ing.unit, facteur);
    const [unite, k] = CONVERSIONS[ing.unit] || [ing.unit, 1];
    a.parUnite.set(unite, (a.parUnite.get(unite) || 0) + q * k);
    a.origine.set(ing.unit, (a.origine.get(ing.unit) || 0) + q);
    a.details.push({ ...detail, quantite: true, texte: `${formatQty(ing, facteur)} ${ing.name}`.trim() });
  };
  for (const { recette: r, portions } of prevues) {
    const base = Number(r.meta.portions) || 0;
    const facteur = base ? portions / base : portions; // sans nombre de personnes : « × n »
    for (const g of r.ingredients) {
      for (const ing of g.items) {
        // L'eau du robinet d'une recette ne s'achète pas (une « eau gazeuse » ajoutée à la main, si).
        if (/^eau\b/.test(cleIngredient(ing.qty == null ? ing.raw : ing.name))) continue;
        compter(ing, facteur, { titre: r.meta.titre, partie: g.group });
      }
    }
  }
  for (const { id, texte } of ajouts) compter(parseIngredient(texte), 1, { titre: 'Ajouté à la main', ajout: id });
  return [...articles.values()].map(a => ({
    cle: a.cle, nom: a.nom, rayon: a.rayon, details: a.details,
    // Poids et volumes d'abord : c'est la quantité principale (et celle de « j'en ai déjà »).
    // Venu d'une seule ligne de recette : écrit exactement comme sur la fiche (« ½ c. à soupe », « 280 g ») ;
    // plusieurs lignes : additionnées dans l'unité la plus naturelle (1 L + 25 cL → 1,25 L).
    quantites: a.origine.size === 1 && a.details.filter(d => d.quantite).length === 1
      ? [...a.origine].map(([unite, n]) => ({ unite, n: Math.round(n * 100) / 100, commeLaFiche: true }))
      : [...a.parUnite].map(([unite, n]) => ({ unite, n: Math.round(n * 100) / 100 }))
        .sort((x, y) => ORDRE_UNITES.indexOf(y.unite) - ORDRE_UNITES.indexOf(x.unite)),
    sansQuantite: a.sansQuantite && !a.parUnite.size,
  })).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
}

/** Quantité qui manque, une fois retiré ce qu'on a déjà (même unité que la première quantité). */
export function manque(article, dispo) {
  if (!article.quantites.length || !dispo) return null;
  const [{ n, unite }] = article.quantites;
  return { n: Math.max(0, Math.round((n - dispo) * 100) / 100), unite };
}

export const texteQuantites = a => a.quantites.map(q => (q.commeLaFiche ? formatQty({ qty: q.n, unit: q.unite }) : formatQuantite(q.n, q.unite))).join(' + ');

/* ---------- liste partagée : opérations ---------- */

// La liste est gardée sur le téléphone et, si l'app est connectée au dépôt, dans `courses.json`
// (partagée par toute la famille). Chaque modification est une opération : appliquée tout de
// suite ici, puis envoyée ; si quelqu'un d'autre a modifié la liste entre-temps, on rejoue nos
// opérations sur sa version au lieu de l'écraser.

const CLE = 'mr.courses';
const ATTENTE = 'mr.courses.attente'; // opérations pas encore envoyées
const SHA = 'mr.courses.sha';         // version du dépôt sur laquelle la copie locale est basée
const vide = () => ({ prevues: [], ajouts: [], articles: {}, masques: {} });
const normaliser = e => ({ ...vide(), ...(e || {}) });

const lire = (k, defaut) => { try { return JSON.parse(localStorage.getItem(k)) ?? defaut; } catch { return defaut; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein */ } };

/** { prevues: [{ slug, portions, moule? }] (avec un moule : portions exactes, ex. 8,17), ajouts: [{ id, texte }], articles: { [cle]: { coche, dispo } }, masques: { [cle]: signature } } */
export const etat = () => normaliser(lire(CLE, null));

const OPS = {
  prevoir(e, { slug, portions, moule }) {
    let p = e.prevues.find(x => x.slug === slug);
    if (p) p.portions = portions; else e.prevues.push(p = { slug, portions });
    if (moule) p.moule = moule; else delete p.moule;
  },
  retirer(e, { slug }) { e.prevues = e.prevues.filter(x => x.slug !== slug); },
  ajouter(e, { id, texte }) { if (!e.ajouts.some(a => a.id === id)) e.ajouts.push({ id, texte }); },
  retirerAjout(e, { id }) { e.ajouts = e.ajouts.filter(a => a.id !== id); },
  article(e, { cle, champs }) { e.articles[cle] = { ...e.articles[cle], ...champs }; },
  // Retrait (glissement, « Retirer les articles cochés ») et son annulation.
  retirerArticles(e, { liste }) {
    for (const { cle, signature: sig, ajouts } of liste) {
      e.ajouts = e.ajouts.filter(a => !ajouts.includes(a.id));
      if (sig) e.masques[cle] = sig;
      delete e.articles[cle];
    }
  },
  remettreArticles(e, { liste }) {
    for (const { cle, ajouts, articles } of liste) {
      for (const a of ajouts) OPS.ajouter(e, a);
      delete e.masques[cle];
      if (articles) e.articles[cle] = articles;
    }
  },
  decocher(e) { e.articles = {}; },
  vider(e) { Object.assign(e, vide()); },
  remplacer(e, { etat: nouveau }) { Object.assign(e, vide(), nouveau); },
};

const ecouteurs = new Set();
/** Prévient quand la liste change (ici ou par quelqu'un d'autre). */
export const surChangement = fn => { ecouteurs.add(fn); return () => ecouteurs.delete(fn); };

function faire(type, args = {}) {
  const e = etat();
  OPS[type](e, args);
  ecrire(CLE, e);
  if (depot) { ecrire(ATTENTE, [...lire(ATTENTE, []), { type, args }]); planifierEnvoi(); }
}

/** `moule` (« rond 28 cm ») : quantités pour ce moule, `portions` = son équivalent exact en personnes. */
export const prevoir = (slug, portions, moule) => faire('prevoir', moule ? { slug, portions, moule } : { slug, portions });
export const retirer = slug => faire('retirer', { slug });
export const estPrevue = slug => etat().prevues.some(x => x.slug === slug);
export const majArticle = (cle, champs) => faire('article', { cle, champs });
export const toutDecocher = () => faire('decocher');
export const vider = () => faire('vider');

/** Ajoute un article à la main (« 2 citrons », « papier cuisson »). */
export function ajouterArticle(texte) {
  texte = texte.trim();
  if (!texte) return;
  faire('ajouter', { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texte });
}
export const retirerArticle = id => faire('retirerAjout', { id });

/* ---------- articles retirés (glissement, « Retirer les articles cochés ») ---------- */

// Ce dont l'article est fait : s'il change (recette ajoutée, personnes en plus), il revient sur la liste.
const signature = a => `${texteQuantites(a)}|${a.details.map(d => d.texte).join('|')}`;

export const estMasque = (a, masques = {}) => masques[a.cle] === signature(a);

/**
 * Retire des articles de la liste. Ajouté à la main : supprimé ; venant d'une recette : masqué
 * (tant que les quantités ne changent pas). Renvoie de quoi annuler.
 */
export function supprimerArticles(liste) {
  const e = etat();
  const retraits = liste.map(a => {
    const ids = new Set(a.details.map(d => d.ajout).filter(Boolean));
    const seulementAMain = ids.size === a.details.length;
    return {
      cle: a.cle, signature: seulementAMain ? null : signature(a), ajouts: [...ids],
      remise: { cle: a.cle, ajouts: e.ajouts.filter(x => ids.has(x.id)), articles: e.articles[a.cle] || null },
    };
  });
  faire('retirerArticles', { liste: retraits.map(({ remise, ...r }) => r) });
  return () => faire('remettreArticles', { liste: retraits.map(r => r.remise) });
}
export const supprimerArticle = a => supprimerArticles([a]);

/* ---------- synchronisation avec le dépôt (courses.json) ---------- */

let depot = null; // { lire: () => Promise<{ texte, sha } | null>, ecrire: (texte, sha) => Promise<sha> }
let minuterie = null;
let enCours = null;

/** Branche la liste sur le dépôt (null : liste gardée seulement sur ce téléphone). */
export function brancherDepot(api) {
  depot = api;
  // Première fois : ce qui est déjà sur ce téléphone est proposé au dépôt (fusionné avec l'existant).
  if (api && localStorage.getItem(SHA) === null && localStorage.getItem(ATTENTE) === null) {
    const e = etat();
    if (e.prevues.length || e.ajouts.length || Object.keys(e.articles).length) ecrire(ATTENTE, [{ type: 'fusionner', args: { etat: e } }]);
  }
}

// Fusion de la première synchronisation : on ajoute ce qui manque sans rien retirer.
OPS.fusionner = (e, { etat: local }) => {
  for (const p of local.prevues) if (!e.prevues.some(x => x.slug === p.slug)) e.prevues.push(p);
  for (const a of local.ajouts) OPS.ajouter(e, a);
  e.articles = { ...local.articles, ...e.articles };
  e.masques = { ...local.masques, ...e.masques };
};

function planifierEnvoi() {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => synchroniser().catch(() => {}), 800); // regroupe les touches rapprochées
}

/**
 * Récupère la liste du dépôt et y envoie nos opérations en attente.
 * Renvoie true si la liste affichée a changé.
 */
export function synchroniser() {
  if (!depot) return Promise.resolve(false);
  enCours ||= (async () => {
    try {
      for (let essai = 0; essai < 5; essai++) {
        const distant = await depot.lire();
        const base = normaliser(distant ? JSON.parse(distant.texte) : null);
        const attente = lire(ATTENTE, []);
        if (!attente.length) {
          const change = (distant?.sha ?? '') !== (lire(SHA, '') ?? '');
          if (change) { ecrire(CLE, base); ecrire(SHA, distant?.sha ?? ''); }
          return change;
        }
        const fusion = structuredClone(base);
        for (const op of attente) OPS[op.type]?.(fusion, op.args);
        try {
          const sha = await depot.ecrire(`${JSON.stringify(fusion, null, 1)}\n`, distant?.sha);
          // Des touches ont pu arriver pendant l'envoi : elles restent en attente, rejouées sur cette version.
          const reste = lire(ATTENTE, []).slice(attente.length);
          const local = structuredClone(fusion);
          for (const op of reste) OPS[op.type]?.(local, op.args);
          ecrire(ATTENTE, reste);
          ecrire(SHA, sha);
          ecrire(CLE, local);
          if (reste.length) planifierEnvoi();
          return true;
        } catch (err) {
          if (err.status === 409 || err.status === 422) continue; // modifiée entre-temps : on recommence
          throw err;
        }
      }
      return false;
    } finally { enCours = null; }
  })().then(change => { if (change) ecouteurs.forEach(fn => fn()); return change; });
  return enCours;
}
