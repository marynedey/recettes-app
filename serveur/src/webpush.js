// Web Push sans contenu (RFC 8030) signé VAPID (RFC 8292), avec l'API WebCrypto seule.
// Rien sur la recette ne passe par le serveur : à la réception, le service worker de
// l'app retrouve lui-même quel minuteur vient de se terminer.

const base64url = octets => btoa(String.fromCharCode(...new Uint8Array(octets)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = o => new TextEncoder().encode(JSON.stringify(o));
const P256 = { name: 'ECDSA', namedCurve: 'P-256' };

/** Paire de clés VAPID : { prive: JWK, publique: base64url (format brut, 65 octets) }. */
export async function creerCles() {
  const paire = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  return {
    prive: await crypto.subtle.exportKey('jwk', paire.privateKey),
    publique: base64url(await crypto.subtle.exportKey('raw', paire.publicKey)),
  };
}

/** Jeton VAPID (JWT ES256) pour le service de notifications de l'adresse donnée. */
export async function jetonVapid(adresse, cles, sujet, maintenant = Date.now()) {
  const tete = base64url(json({ typ: 'JWT', alg: 'ES256' }));
  const corps = base64url(json({ aud: new URL(adresse).origin, exp: Math.floor(maintenant / 1000) + 12 * 3600, sub: sujet }));
  const cle = await crypto.subtle.importKey('jwk', cles.prive, P256, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, new TextEncoder().encode(`${tete}.${corps}`));
  return `${tete}.${corps}.${base64url(signature)}`;
}

// Services de notifications des navigateurs : le serveur n'envoie rien ailleurs.
const SERVICES = /^(fcm\.googleapis\.com|android\.googleapis\.com|([\w-]+\.)?push\.services\.mozilla\.com|[\w.-]+\.notify\.windows\.com|web\.push\.apple\.com)$/;

export function adresseValide(adresse) {
  try {
    const u = new URL(adresse);
    return u.protocol === 'https:' && SERVICES.test(u.hostname);
  } catch { return false; }
}

/** Envoie la notification (vide, urgente, valable 10 min). */
export async function envoyer(adresse, cles, sujet, envoi = fetch) {
  const jeton = await jetonVapid(adresse, cles, sujet);
  return envoi(adresse, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jeton}, k=${cles.publique}`, TTL: '600', Urgency: 'high', 'Content-Length': '0' },
  });
}
