import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const lire = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('le service worker porte la même version que l\'app', () => {
  const app = lire('js/views/reglages.js').match(/VERSION = '([\d.]+)'/)[1];
  const sw = lire('sw.js').match(/VERSION = 'mr-app-([\d.]+)'/)[1];
  assert.equal(sw, app, 'mettre à jour VERSION dans sw.js et js/views/reglages.js ensemble');
});

test('le service worker met en cache tous les fichiers JS', () => {
  const sw = lire('sw.js');
  const fichiers = [
    ...readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => 'js/' + f),
    ...readdirSync(new URL('../js/views/', import.meta.url)).map(f => 'js/views/' + f),
  ];
  for (const f of fichiers) assert.ok(sw.includes(`'${f}'`), `${f} manque dans FICHIERS (sw.js)`);
});
