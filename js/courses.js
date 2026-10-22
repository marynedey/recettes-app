// Liste de courses : recettes prévues (avec leur nombre de personnes),
// ingrédients additionnés et rangés par rayon, ce qu'on a déjà à la maison.
// La partie calcul n'utilise pas le navigateur : testée avec `node --test`.

import { sansAccents, formatNumber, formatQty } from './format.js';

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
  const f = (x, u) => formatNumber(x, u, true);
  if (unite === 'g' && n >= 1000) return `${f(n / 1000, 'kg')} kg`;
  if (unite === 'mL' && n >= 1000) return `${f(n / 1000, 'L')} L`;
  if (unite === 'mL' && n >= 100 && n % 10 === 0) return `${f(n / 10, 'cL')} cL`;
  if (unite === 'c. à café' && n >= 3 && Number.isInteger(n / 3)) return `${f(n / 3)} c. à soupe`;
  const s = f(Math.ceil(n * 10) / 10, unite);
  if (!unite) return s;
  const pluriel = n > 1 && !['g', 'mL', 'c. à café', 'c. à soupe', 'noix'].includes(unite) && !unite.endsWith('s') ? 's' : '';
  return `${s} ${unite}${pluriel}`;
}

/* ---------- noms ---------- */

// États ou préparations qui ne changent pas ce qu'on achète.
const PRECISIONS = /\b(fondus?|fondues?|froids?|froides?|tr[eè]s|ti[eè]des?|chauds?|chaudes?|ramollis?|pommade|[àa] temp[ée]rature ambiante|en morceaux|bien m[ûu]re?s?|[ée]cras[ée]e?s?|fra[iî]ches?|pel[ée]e?s? et r[âa]p[ée]e?s?|r[âa]p[ée]e?s?|en lamelles|hach[ée]e?s?|entiers?|gros(se)?s?|petite?s?|pour la pr[ée]sentation|pour la d[ée]co\w*)\b/gi;

/** Nom affiché sur la liste : sans parenthèses ni précisions de préparation. */
export function nomCourses(nom) {
  return nom.replace(/\(.*?\)/g, '').replace(/,.*$/, '').replace(PRECISIONS, '')
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
 * Additionne les ingrédients des recettes prévues.
 * prevues : [{ recette, portions }] ; renvoie [{ cle, nom, rayon, quantites: [{ n, unite }],
 * sansQuantite: bool, details: [{ titre, texte }] }].
 */
export function listeDeCourses(prevues) {
  const articles = new Map();
  for (const { recette: r, portions } of prevues) {
    const base = Number(r.meta.portions) || 0;
    const facteur = base ? portions / base : portions; // sans nombre de personnes : « × n »
    for (const g of r.ingredients) {
      for (const ing of g.items) {
        const nom = ing.qty == null ? ing.raw : ing.name;
        const cle = cleIngredient(nom);
        if (!cle || /^eau\b/.test(cle)) continue; // l'eau du robinet ne s'achète pas
        let a = articles.get(cle);
        if (!a) {
          const affiche = nomCourses(nom);
          a = { cle, nom: affiche[0].toUpperCase() + affiche.slice(1), rayon: rayon(cle), parUnite: new Map(), sansQuantite: false, details: [] };
          articles.set(cle, a);
        }
        if (ing.qty == null) {
          a.sansQuantite = true;
          a.details.push({ titre: r.meta.titre, partie: g.group, texte: ing.raw });
          continue;
        }
        // Une fourchette (« 600-800 g ») : on achète pour le haut de la fourchette.
        const q = (ing.qtyMax ?? ing.qty) * facteur;
        const [unite, k] = CONVERSIONS[ing.unit] || [ing.unit, 1];
        a.parUnite.set(unite, (a.parUnite.get(unite) || 0) + q * k);
        a.details.push({ titre: r.meta.titre, partie: g.group, texte: `${formatQty(ing, facteur)} ${ing.name}`.trim() });
      }
    }
  }
  return [...articles.values()].map(a => ({
    cle: a.cle, nom: a.nom, rayon: a.rayon, details: a.details,
    // Poids et volumes d'abord : c'est la quantité principale (et celle de « j'en ai déjà »).
    quantites: [...a.parUnite].map(([unite, n]) => ({ unite, n: Math.round(n * 100) / 100 }))
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

export const texteQuantites = a => a.quantites.map(q => formatQuantite(q.n, q.unite)).join(' + ');

/* ---------- enregistrement sur le téléphone ---------- */

const CLE = 'mr.courses';
const vide = () => ({ prevues: [], articles: {} });

/** { prevues: [{ slug, portions }], articles: { [cle]: { coche, dispo } } } */
export function etat() {
  try { return { ...vide(), ...JSON.parse(localStorage.getItem(CLE)) }; } catch { return vide(); }
}
export function enregistrer(e) {
  try { localStorage.setItem(CLE, JSON.stringify(e)); } catch { /* stockage plein */ }
}

export function prevoir(slug, portions) {
  const e = etat();
  const p = e.prevues.find(x => x.slug === slug);
  if (p) p.portions = portions; else e.prevues.push({ slug, portions });
  enregistrer(e);
}
export function retirer(slug) {
  const e = etat();
  e.prevues = e.prevues.filter(x => x.slug !== slug);
  enregistrer(e);
}
export const estPrevue = slug => etat().prevues.some(x => x.slug === slug);
