// Vérifie qu'une PR qui modifie l'app augmente sa version (X.Y.Z).
// Usage : node tests/verifier-version.mjs [branche de base, défaut origin/main]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const lireVersion = texte => (texte.match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);

// Fichiers qui composent l'app publiée (les tests et la doc ne comptent pas).
const APP = /^(index\.html|manifest\.webmanifest|sw\.js|css\/|js\/|fonts\/|icons\/)/;
const modifies = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(f => APP.test(f));
if (!modifies.length) {
  console.log('Aucun fichier de l\'app modifié : pas besoin de changer de version.');
  process.exit(0);
}

const avant = lireVersion(git('show', `${base}:js/views/reglages.js`));
const apres = lireVersion(readFileSync(new URL('../js/views/reglages.js', import.meta.url), 'utf8'));
// Comparaison X, puis Y, puis Z.
const k = [0, 1, 2].find(i => apres[i] !== avant[i]);
const plusGrand = apres.length === 3 && (avant.length !== 3 || (k !== undefined && apres[k] > avant[k]));

console.log(`Fichiers de l'app modifiés : ${modifies.join(', ')}`);
console.log(`Version : ${avant.join('.') || '?'} → ${apres.join('.') || '?'}`);
if (!plusGrand) {
  console.error(`\nLa version doit augmenter (dans js/views/reglages.js ET sw.js).
  correction → ${avant[0]}.${avant[1]}.${avant[2] + 1} · fonctionnalité → ${avant[0]}.${avant[1] + 1}.0 · incompatible → ${avant[0] + 1}.0.0`);
  process.exit(1);
}
console.log('OK : la version a augmenté.');
