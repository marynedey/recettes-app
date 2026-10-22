import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecipe, serializeRecipe, parseIngredient, formatQty, detectTimers, flatSteps, ingredientsForStep, textToGroups, slugify } from '../js/format.js';

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
});

test('recalcul des portions', () => {
  assert.equal(formatQty(parseIngredient('200 g farine'), 1.5), '300 g');
  assert.equal(formatQty(parseIngredient('1 pincée sel'), 2), '2 pincées');
  assert.equal(formatQty(parseIngredient('3 oeufs'), 0.5), '1½');
  assert.equal(formatQty(parseIngredient('8 g levure'), 0.5), '4 g');
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
  assert.deepEqual(r.ingredients.map(g => g.group), ['Pour la pâte à brioche', 'Pour la garniture', 'Pour le glaçage']);
  const steps = flatSteps(r);
  assert.equal(steps.length, 18);
  const glacage = ingredientsForStep(r, steps[16]).map(i => i.name);
  assert.deepEqual(glacage, ['sucre glace', 'beurre fondu', 'sucre vanillé']);
  const garniture = ingredientsForStep(r, steps[9]).map(i => i.name);
  assert.ok(garniture.includes('cannelle en poudre') && garniture.includes('sucre roux') && !garniture.includes('sucre glace'));
});

test('formulaire', () => {
  assert.deepEqual(textToGroups('Pour la pâte :\n- 200 g farine\n\n### Sauce\n2 oeufs'), [
    { group: 'Pour la pâte', items: ['200 g farine'] }, { group: 'Sauce', items: ['2 oeufs'] }]);
  assert.equal(slugify('Velouté de potimarron & châtaignes'), 'veloute-de-potimarron-chataignes');
});
