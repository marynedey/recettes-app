import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseRecipe } from '../js/format.js';
import { avecCeQueJai, lireListe, couvert, dePlacard, liensRecherche } from '../js/frigo.js';

const dir = new URL('./fixtures/', import.meta.url);
const recettes = readdirSync(dir).map(f => parseRecipe(readFileSync(new URL(f, dir), 'utf8'), `recettes/${f}`));

test('avec ce que j\'ai : ma liste, au singulier, sans accents', () => {
  assert.deepEqual(lireListe('Poulet, riz et Œufs ; citrons'), ['poulet', 'riz', 'oeuf', 'citron']);
  assert.deepEqual(lireListe(''), []);
});

test('avec ce que j\'ai : un ingrédient couvre ceux qui le contiennent', () => {
  assert.ok(couvert('blanc de poulet', ['poulet']));
  assert.ok(couvert('jaune d oeuf', ['oeuf']));
  assert.ok(couvert('beurre demi-sel', ['beurre']));
  assert.ok(!couvert('poulet', ['poule']));
  assert.ok(!couvert('beurre demi-sel', ['sel']), 'le sel ne couvre pas le beurre demi-sel');
});

test('avec ce que j\'ai : seuls le sel, le poivre et l\'eau sont toujours là', () => {
  const base = lireListe('sel, poivre, eau');
  for (const c of ['sel', 'sel fin', 'fleur de sel', 'poivre', 'poivre noir', 'eau']) assert.ok(dePlacard(c, base), c);
  for (const c of ['beurre demi-sel', 'moutarde', 'ail', 'huile d olive', 'gousse d ail']) assert.ok(!dePlacard(c, base), c);
});

test('avec ce que j\'ai : recettes triées par ce qui manque', () => {
  const res = avecCeQueJai(recettes, 'pommes, beurre, sucre, farine');
  assert.deepEqual(res.map(r => r.recette.meta.titre), ['Tarte tatin', 'Cinnamon rolls', 'Risotto aux champignons']);
  // Tarte tatin : la fleur de sel et l'eau ne comptent pas, le beurre demi-sel est du beurre.
  assert.deepEqual(res[0].manquants, []);
  assert.equal(res[0].part, 1);
  assert.deepEqual(res[1].manquants, ['levure boulangère', 'lait', 'yaourt nature', 'cannelle en poudre']);
  // Risotto : l'ail et l'huile comptent (seul le beurre est là).
  assert.ok(res[2].manquants.includes('ail'));
  assert.ok(res[2].manquants.includes('huile d\'olive'));
  assert.equal(res[2].utilises, 1);
});

test('avec ce que j\'ai : rien d\'utile, rien d\'affiché ; placard personnalisé', () => {
  assert.deepEqual(avecCeQueJai(recettes, 'chocolat'), []);
  assert.deepEqual(avecCeQueJai(recettes, ''), []);
  const risotto = avecCeQueJai(recettes, 'riz, champignons', 'sel, poivre, eau, huile')[0];
  assert.equal(risotto.recette.meta.titre, 'Risotto aux champignons');
  assert.ok(!risotto.manquants.includes('huile d\'olive'), 'huile ajoutée au placard');
});

test('sur internet : recherches avec mes ingrédients', () => {
  assert.deepEqual(liensRecherche('poulet, riz et œufs'), [
    { nom: 'Marmiton', url: 'https://www.marmiton.org/recettes/recherche.aspx?aqt=poulet%20riz%20%C5%93ufs' },
    { nom: 'Google', url: 'https://www.google.com/search?q=recette%20poulet%20riz%20%C5%93ufs' },
  ]);
  assert.deepEqual(liensRecherche('  '), []);
});
