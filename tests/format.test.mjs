import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listePhotos, parseRecipe, serializeRecipe, parseIngredient, formatQty, detectTimers, flatSteps, ingredientsForStep, textToGroups, slugify } from '../js/format.js';

const DIR = new URL('./fixtures/', import.meta.url).pathname;

test('ingrédients', () => {
  const t = (s, qty, unit, name) => { const i = parseIngredient(s); assert.deepEqual([i.qty, i.unit, i.name], [qty, unit, name], s); };
  t('200 g farine', 200, 'g', 'farine');
  t('540g de farine', 540, 'g', 'farine');
  t('270mL de lait', 270, 'mL', 'lait');
  t('3 cuillères à soupe de cannelle en poudre', 3, 'c. à soupe', 'cannelle en poudre');
  t('1 gousse d\'ail', 1, 'gousse', 'ail');
  t('6 pommes Golden', 6, '', 'pommes Golden');
  t('6 gros œufs', 6, '', 'gros œufs');
  t('1/2 citron', 0.5, '', 'citron');
  t('1,5 L de bouillon', 1.5, 'L', 'bouillon');
  t('sel, poivre', null, '', 'sel, poivre');
  t('2 c. à s. d\'huile', 2, 'c. à soupe', 'huile');
  t('une pincée de sel', 1, 'pincée', 'sel');
  t('deux oeufs', 2, '', 'oeufs');
  t('un peu de sel', null, '', 'un peu de sel');
});

test('recalcul des portions', () => {
  assert.equal(formatQty(parseIngredient('200 g farine'), 1.5), '300 g');
  assert.equal(formatQty(parseIngredient('1 pincée sel'), 2), '2 pincées');
  assert.equal(formatQty(parseIngredient('3 oeufs'), 0.5), '1½');
  assert.equal(formatQty(parseIngredient('8 g levure'), 0.5), '4 g');
  assert.equal(formatQty(parseIngredient('113 g beurre'), 1), '113 g');
  assert.equal(formatQty(parseIngredient('1,5 L lait'), 1), '1,5 L');
  assert.equal(formatQty(parseIngredient('2-3 c. à soupe crème'), 2), '4–6 c. à soupe');
});

test('minuteurs', () => {
  assert.deepEqual(detectTimers('laisser 10 min à température ambiante').map(t => t.secondes), [600]);
  assert.deepEqual(detectTimers('four à 35-40 °C pendant 1 h').map(t => t.secondes), [3600]);
  assert.deepEqual(detectTimers('compter 20-22 min de cuisson, vers 15 min').map(t => t.secondes), [1200, 900]);
  assert.deepEqual(detectTimers('cuire 1h30').map(t => t.secondes), [5400]);
  assert.deepEqual(detectTimers('un rectangle de 50 × 30 cm').length, 0);
});

test('aller-retour des recettes d\'exemple', () => {
  for (const f of ['cinnamon-rolls.md', 'tarte-tatin.md', 'risotto-aux-champignons.md']) {
    const txt = readFileSync(DIR + f, 'utf8');
    const r = parseRecipe(txt, 'recettes/' + f);
    assert.ok(r.meta.titre && r.ingredients.length && r.etapes.length, f);
    const again = parseRecipe(serializeRecipe(r), r.path);
    assert.deepEqual(again, r, f);
  }
});

test('cinnamon rolls', () => {
  const r = parseRecipe(readFileSync(DIR + 'cinnamon-rolls.md', 'utf8'), 'recettes/cinnamon-rolls.md');
  assert.equal(r.slug, 'cinnamon-rolls');
  assert.equal(r.meta.portions, 12);
  assert.equal(r.meta.repos, 80);
  assert.deepEqual(r.ingredients.map(g => g.group), ['Pour la pâte à brioche', 'Pour la garniture', 'Pour le glaçage']);
  const steps = flatSteps(r);
  assert.equal(steps.length, 18);
  const glacage = ingredientsForStep(r, steps[16]).map(i => i.name);
  assert.deepEqual(glacage, ['sucre glace', 'beurre fondu', 'sucre vanillé']);
  const garniture = ingredientsForStep(r, steps[9]).map(i => i.name);
  assert.ok(garniture.includes('cannelle en poudre') && garniture.includes('sucre roux') && !garniture.includes('sucre glace'));
});

test('ingrédients d\'une étape : quantité citée et homonymes', () => {
  const r = parseRecipe(`## Ingrédients
- 540 g farine
- 8 g levure
- 1 c. à soupe sucre (pour la levure)
- 1 c. à soupe farine (pour la levure)
- 90 g sucre
- 100 g beurre froid
- 50 g beurre demi-sel

## Étapes
1. Ajouter 1 c. à soupe de sucre, 1 c. à soupe de farine et la levure.
2. Mélanger la farine et le sucre.
3. Sabler avec le beurre froid.
`, 'recettes/t.md');
  const [e1, e2, e3] = flatSteps(r).map(s => ingredientsForStep(r, s).map(i => i.raw));
  assert.deepEqual(e1, ['8 g levure', '1 c. à soupe sucre (pour la levure)', '1 c. à soupe farine (pour la levure)']);
  assert.deepEqual(e2, ['540 g farine', '90 g sucre']);
  assert.deepEqual(e3, ['100 g beurre froid']);
});

test('formulaire', () => {
  assert.deepEqual(textToGroups('Pour la pâte :\n- 200 g farine\n\n### Sauce\n2 oeufs'), [
    { group: 'Pour la pâte', items: ['200 g farine'] }, { group: 'Sauce', items: ['2 oeufs'] }]);
  assert.equal(slugify('Velouté de potimarron & châtaignes'), 'veloute-de-potimarron-chataignes');
});

test('photos : nouvelle liste et ancien champ « photo »', () => {
  assert.deepEqual(listePhotos({ photo: 'photos/a.jpg' }), ['photos/a.jpg']);
  assert.deepEqual(listePhotos({ photos: ['photos/a.jpg', 'photos/a-2.jpg'] }), ['photos/a.jpg', 'photos/a-2.jpg']);
  assert.deepEqual(listePhotos({ photos: ['photos/b.jpg'], photo: 'photos/a.jpg' }), ['photos/b.jpg']);
  assert.deepEqual(listePhotos({}), []);
  const r = parseRecipe('---\ntitre: T\nphotos: [photos/t.jpg, photos/t-2.jpg]\n---\n## Ingrédients\n- 1 oeuf\n', 'recettes/t.md');
  assert.match(serializeRecipe(r), /\nphotos: \[photos\/t\.jpg, photos\/t-2\.jpg\]\n/);
});
