// Accès minimal à l'API REST GitHub (dépôt des recettes).

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function toBase64(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64Text(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  constructor({ jeton, depot }) {
    this.token = jeton;
    [this.owner, this.repo] = (depot || '').split('/');
    this.branch = null;
  }

  get base() { return `${API}/repos/${this.owner}/${this.repo}`; }

  async req(url, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false } = {}) {
    let res;
    try {
      res = await fetch(url.startsWith('http') ? url : this.base + url, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('Pas de connexion internet.', 0);
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* corps vide */ }
      const messages = {
        401: 'Jeton refusé (expiré ou mal copié).',
        403: 'Accès refusé : vérifiez les droits du jeton (Contents : lecture et écriture).',
        404: 'Introuvable : vérifiez le nom du dépôt et que le jeton y a accès.',
        409: 'Conflit : le fichier a changé entre-temps, synchronisez puis réessayez.',
        422: 'Requête refusée par GitHub.',
      };
      throw new GitHubError(messages[res.status] || `Erreur GitHub ${res.status} ${msg}`, res.status);
    }
    if (raw) return res;
    return res.status === 204 ? null : res.json();
  }

  async repoInfo() {
    const info = await this.req('');
    this.branch = info.default_branch;
    return info;
  }

  async ensureBranch() {
    if (!this.branch) await this.repoInfo();
    return this.branch;
  }

  /** Tous les fichiers du dépôt : Map chemin → sha. */
  async tree() {
    const branch = await this.ensureBranch();
    let data;
    try {
      data = await this.req(`/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    } catch (e) {
      if (e.status === 409 || e.status === 404) return new Map(); // dépôt vide
      throw e;
    }
    return new Map(data.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
  }

  async blobText(sha) {
    const b = await this.req(`/git/blobs/${sha}`);
    return fromBase64Text(b.content);
  }

  async blobBytes(sha) {
    const res = await this.req(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw', raw: true });
    return res.blob();
  }

  /** Contenu d'un fichier (ou null s'il n'existe pas) : { text, sha }. */
  async getFile(path) {
    const branch = await this.ensureBranch();
    try {
      const f = await this.req(`/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
      return { text: fromBase64Text(f.content), sha: f.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async putFile(path, content, message, sha) {
    const branch = await this.ensureBranch();
    const body = { message, branch, content: toBase64(content) };
    if (sha) body.sha = sha;
    const r = await this.req(`/contents/${encodePath(path)}`, { method: 'PUT', body });
    return r.content.sha;
  }

  async deleteFile(path, sha, message) {
    const branch = await this.ensureBranch();
    await this.req(`/contents/${encodePath(path)}`, { method: 'DELETE', body: { message, sha, branch } });
  }
}
