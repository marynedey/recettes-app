import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from '../js/github.js';

test('le jeton des réglages est envoyé à GitHub', async () => {
  let auth;
  globalThis.fetch = async (url, opts) => {
    auth = opts.headers.Authorization;
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
  };
  // Même forme d'objet que reglages() dans store.js.
  await new GitHub({ prenom: 'X', jeton: 'github_pat_abc', depot: 'u/r' }).repoInfo();
  assert.equal(auth, 'Bearer github_pat_abc');
});
