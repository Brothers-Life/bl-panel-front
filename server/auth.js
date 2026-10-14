'use strict';
/*
 * Connexion Discord (OAuth2) du panel.
 * Accès accordé si l'utilisateur est :
 *   - webmaster (WEBMASTER_DISCORD_IDS dans le .env du panel) : tous les droits + page « Accès » ;
 *   - autorisé à la main par un webmaster depuis le panel ;
 *   - membre de DISCORD_GUILD_ID avec un des rôles DISCORD_ALLOWED_ROLE_IDS (facultatif).
 * Un webmaster peut retirer l'accès à quelqu'un, même s'il a le rôle (effet en 30 s max).
 * Les comptes sont stockés par l'API (routes /api/panel-users) ; la session est un cookie HttpOnly signé.
 */
const crypto = require('crypto');

const list = (s) => String(s || '').split(/[\s,;]+/).filter(Boolean);

module.exports = function createAuth({ apiCall, json, readBody }) {
  const D = {
    clientId: process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    redirectUri: process.env.DISCORD_REDIRECT_URI || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    roleIds: list(process.env.DISCORD_ALLOWED_ROLE_IDS),
    webmasters: list(process.env.WEBMASTER_DISCORD_IDS),
    api: (process.env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/$/, ''),
    authorize: process.env.DISCORD_AUTHORIZE_URL || 'https://discord.com/oauth2/authorize',
  };
  const secret = process.env.SESSION_SECRET || '';
  const REQUIRED = { DISCORD_CLIENT_ID: D.clientId, DISCORD_CLIENT_SECRET: D.clientSecret, DISCORD_REDIRECT_URI: D.redirectUri, WEBMASTER_DISCORD_IDS: D.webmasters.join(','), SESSION_SECRET: secret };
  const missing = Object.entries(REQUIRED).filter(([, v]) => !v).map(([k]) => k);
  const enabled = missing.length === 0;
  const SESSION_DAYS = Math.max(1, parseInt(process.env.SESSION_DAYS || '7', 10) || 7);
  const COOKIE = 'blp_session';
  const panelOrigin = enabled ? new URL(D.redirectUri).origin : null;
  const secure = !panelOrigin || panelOrigin.startsWith('https:');

  if (!enabled) console.warn(`[auth] Connexion Discord DESACTIVEE (manque : ${missing.join(', ')}) — le panel est PUBLIC.`);
  else console.log(`[auth] Connexion Discord active — ${D.webmasters.length} webmaster(s)${D.guildId ? `, serveur ${D.guildId}` + (D.roleIds.length ? ` (${D.roleIds.length} rôle(s))` : ' (tous les membres)') : ''}.`);

  /* ------------------------------ jetons signés ------------------------------ */
  const hmac = (v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const signed = (obj) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return p + '.' + hmac(p); };
  function verify(token) {
    if (!token) return null;
    const i = token.lastIndexOf('.');
    if (i < 1) return null;
    const p = token.slice(0, i), sig = Buffer.from(token.slice(i + 1)), exp = Buffer.from(hmac(p));
    if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) return null;
    try {
      const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      return o && o.exp && Date.now() < o.exp ? o : null;
    } catch { return null; }
  }
  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* illisible */ } }
    }
    return out;
  }
  const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${maxAge}`;
  function redirect(res, location, setCookies = []) {
    res.writeHead(302, { Location: location, 'Set-Cookie': setCookies, 'Cache-Control': 'no-store' });
    res.end();
  }
  const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64);

  /* --------------------------------- accès ---------------------------------- */
  const isWebmaster = (id) => D.webmasters.includes(String(id));
  const decide = (row, roleOk) => (!row && !roleOk ? { ok: false }
    : row?.access === 'revoked' ? { ok: false, via: 'retiré' }
    : row?.access === 'granted' ? { ok: true, via: 'liste' }
    : roleOk ? { ok: true, via: 'rôle' } : { ok: false });
  const cache = new Map();
  async function access(id) {
    if (isWebmaster(id)) return { ok: true, webmaster: true, via: 'webmaster' };
    const hit = cache.get(id);
    if (hit && Date.now() - hit.t < 30000) return hit.v;
    const { user } = await apiCall('GET', '/api/panel-users/' + id);
    const v = decide(user, user?.role_ok);
    cache.set(id, { t: Date.now(), v });
    return v;
  }

  async function currentUser(req) {
    const s = verify(cookies(req)[COOKIE]);
    if (!s || !s.id) return null;
    const a = await access(s.id).catch(() => ({ ok: false }));
    return a.ok ? { id: s.id, name: s.name, username: s.username, avatar: s.avatar, webmaster: !!a.webmaster, via: a.via } : null;
  }

  /* -------------------------------- OAuth2 ---------------------------------- */
  const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

  async function discord(pathname, token) {
    const r = await fetch(D.api + pathname, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw Object.assign(new Error(`discord ${pathname} ${r.status}`), { status: r.status });
    return r.json();
  }

  function startLogin(req, res, u) {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      response_type: 'code', client_id: D.clientId, redirect_uri: D.redirectUri, state, prompt: 'none',
      scope: D.guildId ? 'identify guilds.members.read' : 'identify',
    });
    redirect(res, D.authorize + '?' + params, [cookie('blp_oauth', signed({ state, next: safeNext(u.searchParams.get('next')), exp: Date.now() + 600e3 }), 600)]);
  }

  async function callback(req, res, u) {
    const clear = cookie('blp_oauth', '', 0);
    const fail = (why) => redirect(res, '/#connexion=' + why, [clear]);
    if (u.searchParams.get('error')) return fail('annulee');
    const st = verify(cookies(req).blp_oauth);
    if (!st || st.state !== u.searchParams.get('state') || !u.searchParams.get('code')) return fail('expiree');
    try {
      const tr = await fetch(D.api + '/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: D.clientId, client_secret: D.clientSecret, grant_type: 'authorization_code', code: u.searchParams.get('code'), redirect_uri: D.redirectUri }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tr.ok) throw new Error('échange du code : HTTP ' + tr.status);
      const { access_token: token } = await tr.json();
      const me = await discord('/users/@me', token);
      let roleOk = false;
      if (D.guildId) {
        try {
          const m = await discord(`/users/@me/guilds/${D.guildId}/member`, token);
          roleOk = D.roleIds.length ? (m.roles || []).some((r) => D.roleIds.includes(r)) : true;
        } catch (e) { if (e.status !== 404) throw e; } // pas membre du serveur
      }
      const { user: row } = await apiCall('GET', '/api/panel-users/' + me.id);
      const a = isWebmaster(me.id) ? { ok: true } : decide(row, roleOk);
      await apiCall('POST', '/api/panel-users/login', {
        discord_id: me.id, username: me.username, global_name: me.global_name || null, avatar: me.avatar || null,
        role_ok: roleOk, allowed: a.ok, ip: clientIp(req),
      });
      cache.delete(me.id);
      if (!a.ok) return fail('refusee');
      const name = me.global_name || me.username;
      const session = signed({ id: me.id, name, username: me.username, avatar: me.avatar || null, exp: Date.now() + SESSION_DAYS * 86400e3 });
      redirect(res, st.next, [clear, cookie(COOKIE, session, SESSION_DAYS * 86400)]);
    } catch (e) {
      console.error('[auth] connexion Discord :', e.message);
      fail('erreur');
    }
  }

  /* ------------------------- gestion des accès (webmaster) ------------------------- */
  async function listAccess() {
    const d = await apiCall('GET', '/api/panel-users');
    const rows = (d.users || []).map((u) => ({ ...u, webmaster: isWebmaster(u.discord_id) }));
    for (const id of D.webmasters) if (!rows.some((u) => u.discord_id === id)) rows.unshift({ discord_id: id, webmaster: true });
    return { users: rows, logins: d.logins || [], config: { guild: !!D.guildId, roles: D.roleIds.length, webmasters: D.webmasters.length, sessionDays: SESSION_DAYS } };
  }

  async function setAccess(req, res, user) {
    if (req.headers.origin && req.headers.origin !== panelOrigin) return json(res, 403, { error: 'origine refusée' });
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'JSON invalide' }); }
    const id = String(body.discord_id || '').trim();
    if (!/^\d{15,22}$/.test(id)) return json(res, 400, { error: 'ID Discord invalide (15 à 22 chiffres)' });
    if (isWebmaster(id)) return json(res, 400, { error: 'Les webmasters se gèrent dans le .env du panel' });
    await apiCall('POST', '/api/panel-users/access', {
      discord_id: id, access: body.access === 'granted' || body.access === 'revoked' ? body.access : null,
      note: body.note == null ? null : String(body.note), added_by: user.name,
    });
    cache.delete(id);
    return json(res, 200, { ok: true });
  }

  /* -------------------------------- routes --------------------------------- */
  // Renvoie true si la requête a été traitée ici.
  async function handle(req, res, url) {
    const u = new URL(req.url, 'http://x');
    if ((url === '/auth/discord' || url === '/auth/discord/callback') && req.method === 'GET') {
      if (!enabled) { json(res, 503, { error: 'connexion Discord non configurée', missing }); return true; }
      if (url === '/auth/discord') startLogin(req, res, u); else await callback(req, res, u);
      return true;
    }
    if (url === '/auth/logout') { redirect(res, '/', [cookie(COOKIE, '', 0)]); return true; }
    if (url === '/api/me') {
      if (!enabled) { json(res, 200, { auth: false }); return true; }
      const user = await currentUser(req);
      json(res, user ? 200 : 401, user ? { auth: true, user } : { auth: true });
      return true;
    }
    if (url === '/api/access') {
      const user = enabled ? await currentUser(req) : null;
      if (!user || !user.webmaster) { json(res, user ? 403 : 401, { error: 'réservé aux webmasters' }); return true; }
      if (req.method === 'POST') await setAccess(req, res, user);
      else json(res, 200, await listAccess());
      return true;
    }
    return false;
  }

  // Protège les données : renvoie l'utilisateur (ou true si la connexion est désactivée).
  async function guard(req, res) {
    if (!enabled) return true;
    const user = await currentUser(req);
    if (user) return user;
    json(res, 401, { error: 'connexion requise', auth: true });
    return null;
  }

  return { enabled, handle, guard };
};
