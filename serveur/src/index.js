// Serveur des minuteurs : l'app lui confie « préviens ce téléphone à telle heure »,
// il envoie la notification à l'heure dite, même si l'app est fermée.
//
//   GET    /cle             → { cle } : clé publique VAPID (créée au premier appel)
//   PUT    /minuteurs/<id>  { adresse, fin } : planifie (ou replanifie) l'envoi
//   DELETE /minuteurs/<id>  : annule
//
// Un Durable Object par minuteur, réveillé par son alarme. À la fin du minuteur, la notification
// est renvoyée toutes les 30 s (RAPPELS fois) pour sonner comme un réveil, jusqu'à « Arrêter » ou
// « +1 min » (DELETE ou PUT) ; tout est effacé ensuite.

import { DurableObject } from 'cloudflare:workers';
import { creerCles, envoyer, adresseValide } from './webpush.js';

const SUJET = 'https://marynedey.github.io/recettes-app/';
const DELAI_MAX = 24 * 3600e3;
const RAPPELS = 4;          // envois en plus du premier
const ECART_RAPPELS = 30e3;

const cles = env => env.CLES.get(env.CLES.idFromName('vapid')).obtenir();

function entetesCors(req, env) {
  const origine = req.headers.get('Origin') || '';
  const permises = env.ORIGINES.split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': permises.includes(origine) ? origine : permises[0],
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(req, env) {
    const cors = entetesCors(req, env);
    const reponse = (corps, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/cle') return reponse({ cle: (await cles(env)).publique });
    if (req.method === 'GET' && pathname === '/') return reponse({ ok: true, service: 'Mes Recettes · minuteurs' });

    const m = pathname.match(/^\/minuteurs\/([^/]{1,400})$/);
    if (!m) return reponse({ erreur: 'Adresse inconnue' }, 404);
    const minuteur = env.MINUTEUR.get(env.MINUTEUR.idFromName(decodeURIComponent(m[1])));

    if (req.method === 'DELETE') {
      await minuteur.annuler();
      return reponse({ ok: true });
    }
    if (req.method === 'PUT') {
      let d;
      try { d = await req.json(); } catch { return reponse({ erreur: 'JSON attendu' }, 400); }
      const fin = Number(d.fin);
      if (!adresseValide(d.adresse)) return reponse({ erreur: 'Adresse de notification refusée' }, 400);
      if (!(fin > Date.now() - 60e3 && fin < Date.now() + DELAI_MAX)) return reponse({ erreur: 'Heure de fin invalide' }, 400);
      await minuteur.planifier(d.adresse, fin);
      return reponse({ ok: true });
    }
    return reponse({ erreur: 'Méthode non prise en charge' }, 405);
  },
};

export class Minuteur extends DurableObject {
  async planifier(adresse, fin) {
    await this.ctx.storage.put('envoi', { adresse, fin, rappels: RAPPELS });
    await this.ctx.storage.setAlarm(fin);
  }

  async annuler() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const envoi = await this.ctx.storage.get('envoi');
    if (envoi) {
      const r = await envoyer(envoi.adresse, await cles(this.env), SUJET);
      // Erreur passagère du service : l'exception fait réessayer l'alarme.
      // 404/410 : le téléphone s'est désabonné, inutile d'insister.
      if (r.status >= 500 || r.status === 429) throw new Error(`Service de notifications : ${r.status}`);
      if (r.ok && envoi.rappels > 0) {
        await this.ctx.storage.put('envoi', { ...envoi, rappels: envoi.rappels - 1 });
        await this.ctx.storage.setAlarm(Date.now() + ECART_RAPPELS);
        return;
      }
    }
    await this.ctx.storage.deleteAll();
  }
}

export class Cles extends DurableObject {
  async obtenir() {
    let c = await this.ctx.storage.get('cles');
    if (!c) {
      c = await creerCles();
      await this.ctx.storage.put('cles', c);
    }
    return c;
  }
}
