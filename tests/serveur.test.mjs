import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerCles, jetonVapid, adresseValide, envoyer } from '../serveur/src/webpush.js';

const decoder = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('serveur : jeton VAPID signé avec la clé, pour le bon service', async () => {
  const cles = await creerCles();
  assert.equal(decoder(cles.publique).length, 65, 'clé publique brute P-256');
  const adresse = 'https://fcm.googleapis.com/fcm/send/abc:123';
  const jeton = await jetonVapid(adresse, cles, 'https://marynedey.github.io/recettes-app/', Date.UTC(2026, 9, 23));
  const [tete, corps, signature] = jeton.split('.');
  assert.deepEqual(JSON.parse(decoder(tete)), { typ: 'JWT', alg: 'ES256' });
  const c = JSON.parse(decoder(corps));
  assert.equal(c.aud, 'https://fcm.googleapis.com');
  assert.equal(c.exp, Date.UTC(2026, 9, 23) / 1000 + 12 * 3600);
  const publique = await crypto.subtle.importKey('raw', decoder(cles.publique), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publique, decoder(signature), new TextEncoder().encode(`${tete}.${corps}`)));
});

test('serveur : n\'envoie qu\'aux services de notifications des navigateurs', () => {
  assert.ok(adresseValide('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(adresseValide('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(adresseValide('https://web.push.apple.com/x'));
  assert.ok(!adresseValide('http://fcm.googleapis.com/x'));
  assert.ok(!adresseValide('https://exemple.fr/x'));
  assert.ok(!adresseValide('https://fcm.googleapis.com.exemple.fr/x'));
  assert.ok(!adresseValide(undefined));
});

test('serveur : notification vide, urgente, avec l\'en-tête VAPID', async () => {
  const cles = await creerCles();
  let appel;
  await envoyer('https://fcm.googleapis.com/fcm/send/x', cles, 'https://a.b/', async (url, o) => { appel = { url, ...o }; return { status: 201 }; });
  assert.equal(appel.method, 'POST');
  assert.equal(appel.headers.Urgency, 'high');
  assert.equal(appel.headers['Content-Length'], '0');
  assert.match(appel.headers.Authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${cles.publique}$`));
  assert.equal(appel.body, undefined);
});
