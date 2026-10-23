// « Avec ce que j'ai » : recettes classées selon ce qu'il manque, d'après les ingrédients qu'on a.
// Sans dépendance navigateur : testé avec `node --test`.

import { cleIngredient, nomCourses } from './courses.js';

// Toujours là, jamais comptés comme manquants (modifiable sur l'écran).
// Volontairement court : la moutarde, l'ail, l'huile… doivent être écrits.
export const PLACARD_DEFAUT = 'sel, poivre, eau';

/** « poulet, riz et œufs » → ['poulet', 'riz', 'oeuf'] (clés comparables). */
export function lireListe(texte) {
  return String(texte || '').split(/[,;\n]|\s+et\s+|\s\+\s/i)
    .map(s => cleIngredient(s.trim())).filter(Boolean);
}

const motif = k => new RegExp(`(^|[^a-z-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z-])`);

/** L'ingrédient (clé) est-il couvert par ce que j'ai ? « poulet » couvre « blanc de poulet ». */
export const couvert = (cle, mesCles) => mesCles.some(k => cle === k || motif(k).test(cle));

/** Ingrédient de placard : « sel », « sel fin », « fleur de sel » (mais pas « beurre demi-sel »). */
export const dePlacard = (cle, placard) =>
  placard.some(p => cle === p || cle.startsWith(p + ' ') || cle.endsWith(' de ' + p) || cle.endsWith(' d ' + p));

const nomIngredient = i => (i.qty == null ? i.raw : i.name);

/**
 * Pour chaque recette où au moins un de mes ingrédients sert :
 * { recette, manquants: [noms], utilises: n, total: n, part: 0..1 }, triées par nombre de manquants.
 */
export function avecCeQueJai(recettes, mesIngredients, placard = PLACARD_DEFAUT) {
  const mes = lireListe(mesIngredients);
  const base = lireListe(placard);
  if (!mes.length) return [];
  const resultats = [];
  for (const r of recettes) {
    const vus = new Set();
    const manquants = [];
    let utilises = 0;
    for (const i of r.ingredients.flatMap(g => g.items)) {
      const cle = cleIngredient(nomIngredient(i));
      if (!cle || vus.has(cle) || dePlacard(cle, base)) continue;
      vus.add(cle);
      if (couvert(cle, mes)) utilises++;
      else manquants.push((nomCourses(nomIngredient(i)) || nomIngredient(i)).replace(/^\p{Lu}(?!\p{Lu})/u, c => c.toLowerCase()));
    }
    if (!utilises) continue;
    const total = utilises + manquants.length;
    resultats.push({ recette: r, manquants, utilises, total, part: utilises / total });
  }
  return resultats.sort((a, b) => a.manquants.length - b.manquants.length || b.part - a.part
    || a.recette.meta.titre.localeCompare(b.recette.meta.titre, 'fr'));
}

/* ---------- sur internet ---------- */

// Recherches toutes prêtes (pas de lecture des sites depuis l'app : on ouvre la page de recherche,
// puis « Partager → Recettes » sur la recette choisie l'importe toute seule).
export function liensRecherche(mesIngredients) {
  const mots = String(mesIngredients || '').split(/[,;\n]|\s+et\s+/i).map(s => s.trim()).filter(Boolean).join(' ');
  if (!mots) return [];
  const q = encodeURIComponent(mots);
  return [
    { nom: 'Marmiton', url: `https://www.marmiton.org/recettes/recherche.aspx?aqt=${q}` },
    { nom: 'Google', url: `https://www.google.com/search?q=${encodeURIComponent(`recette ${mots}`)}` },
  ];
}
