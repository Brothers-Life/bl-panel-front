'use strict';
/*
 * Serveur du panel Brothers Life.
 *  - sert le site (index.html, app.js, map.js, style.css, images) ;
 *  - gère la connexion Discord (server/auth.js) ;
 *  - relaie les demandes de données /api/* vers bl-panel-api avec la clé PANEL_API_KEY,
 *    uniquement pour les personnes connectées (flux en direct compris).
 * Aucune dépendance : node server.js. Configuration dans .env (voir .env.example).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Charge le fichier .env s'il existe ; les variables déjà définies gardent la priorité.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* pas de .env : variables de l'hébergeur */ }
// Nettoie les variables : espaces autour et commentaire en fin de ligne (" # ...") collés par erreur.
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') { const c = v.replace(/\s+#.*$/, '').trim(); if (c !== v) process.env[k] = c; }
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_URL = (process.env.API_URL || '').replace(/\/$/, '');
const PANEL_API_KEY = process.env.PANEL_API_KEY || '';
const MAX_BODY = 64 * 1024;

if (!API_URL) { console.error('API_URL manquante (adresse de bl-panel-api) — refus de démarrer.'); process.exit(1); }
if (!PANEL_API_KEY) console.warn('[panel] PANEL_API_KEY absente : l’API doit alors être publique pour que le panel fonctionne.');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ------------------------------ appels à l'API ------------------------------ */

const apiHeaders = (extra = {}) => ({ 'X-Panel-Key': PANEL_API_KEY, ...extra });

async function apiCall(method, pathname, body) {
  const r = await fetch(API_URL + pathname, {
    method,
    headers: apiHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`API ${method} ${pathname} : HTTP ${r.status}`);
  return r.json();
}

// Relais en flux (fonctionne aussi pour le flux en direct SSE).
function proxy(req, res, user) {
  const target = new URL(API_URL + req.url);
  const lib = target.protocol === 'https:' ? https : http;
  const headers = apiHeaders({ Accept: req.headers.accept || '*/*' });
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (user && user.id) headers['X-Panel-User'] = user.id;
  const up = lib.request(target, { method: req.method, headers }, (r) => {
    const out = { ...SECURITY_HEADERS, 'Cache-Control': r.headers['cache-control'] || 'no-store' };
    if (r.headers['content-type']) out['Content-Type'] = r.headers['content-type'];
    if (String(r.headers['content-type']).startsWith('text/event-stream')) out['X-Accel-Buffering'] = 'no';
    res.writeHead(r.statusCode === 401 ? 502 : r.statusCode, out); // un 401 de l'API = clé invalide, pas une session expirée
    res.flushHeaders?.();
    r.pipe(res);
  });
  up.on('error', (e) => { console.error('[panel] API injoignable :', e.message); if (!res.headersSent) json(res, 502, { error: 'API injoignable' }); else res.end(); });
  req.on('close', () => up.destroy());
  if (req.method === 'GET' || req.method === 'HEAD') up.end(); else req.pipe(up);
}

/* --------------------------------- fichiers -------------------------------- */

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/map.js': ['map.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/logo.png': ['logo.png', 'image/png'],
  '/map.jpg': ['map.jpg', 'image/jpeg'],
};
function serveFile(res, url) {
  const f = FILES[url];
  if (!f) return false;
  const file = path.join(__dirname, f[0]);
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, {
    'Content-Type': f[1],
    // index.html toujours revalidé ; le reste est versionné (?v=) dans index.html
    'Cache-Control': f[0] === 'index.html' ? 'no-cache' : 'public, max-age=86400',
    ...SECURITY_HEADERS,
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* --------------------------------- serveur --------------------------------- */

const auth = require('./server/auth')({ apiCall, json, readBody });

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/health') return json(res, 200, { ok: true, auth: auth.enabled });
    if (await auth.handle(req, res, url)) return;

    if (url.startsWith('/api/')) {
      // Le stockage des comptes ne passe que par auth.js, jamais depuis le navigateur.
      if (url === '/api/panel-users' || url.startsWith('/api/panel-users/')) return json(res, 404, { error: 'inconnu' });
      const user = await auth.guard(req, res);
      if (!user) return;
      return proxy(req, res, user === true ? null : user);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && serveFile(res, url)) return;
    json(res, 404, { error: 'introuvable' });
  } catch (e) {
    console.error('[panel] erreur :', e.message);
    if (!res.headersSent) json(res, 500, { error: 'erreur interne' });
  }
}).listen(PORT, () => console.log(`[panel] en ligne sur :${PORT} → API ${API_URL}`));
