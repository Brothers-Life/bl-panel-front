'use strict';
/* Panel Brothers Life — logique front. Pages: overview, economy, players, player, logs, admin. */

const API_BASE = 'https://panel-api.webgune.dev';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const charts = {};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------- formatage ------------------------------- */

const fmt = new Intl.NumberFormat('fr-FR');
const fmtCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const money = (v) => (v == null ? '–' : fmt.format(Math.round(v)) + ' $');
const moneyCompact = (v) => (v == null ? '–' : fmtCompact.format(v) + ' $');
const dt = (v) => (v ? new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').replace(/\^\d/g, '');
const icon = (name, cls = '') => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`;

function rel(v) {
  if (!v) return '–';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`;
  return dt(v);
}

function hue(str) {
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}
const avatar = (seed, name, cls = '') => `<span class="avatar ${cls}" style="--h:${hue(seed)}">${esc(initials(name))}</span>`;

const playerLink = (cid, label) => {
  if (!cid) return `<span class="who">${esc(label || '–')}</span>`;
  return `<a class="who" href="#player=${encodeURIComponent(cid)}">${avatar(cid, label || cid)}<span class="who-name">${esc(label || cid)}</span></a>`;
};

const LEVEL_BADGE = { error: 'danger', warn: 'warn', info: 'info' };
const levelBadge = (lvl) => `<span class="badge ${LEVEL_BADGE[lvl] || ''}">${esc(lvl || '?')}</span>`;

function animateNumber(el, to, format = (n) => fmt.format(n)) {
  if (to == null || Number.isNaN(Number(to))) { el.textContent = '–'; return; }
  to = Number(to);
  const from = Number(el.dataset.v) || 0;
  el.dataset.v = to;
  if (reduceMotion || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function trend(el, first, last) {
  if (!el) return;
  if (!first || last == null) { el.className = 'trend flat'; el.textContent = '—'; return; }
  const pct = ((last - first) / Math.abs(first)) * 100;
  const dir = Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down';
  el.className = 'trend ' + dir;
  el.textContent = (pct > 0 ? '↑ ' : pct < 0 ? '↓ ' : '') + Math.abs(pct).toFixed(1).replace('.', ',') + ' %';
}

/* ---------------------------------- API ---------------------------------- */

async function api(name, params = '') {
  const r = await fetch(API_BASE + '/api/' + name + params);
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} sur /api/${name}`), { status: r.status });
  return r.json();
}

/* ------------------------------- graphiques ------------------------------ */

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function theme() {
  return {
    c1: css('--c1'), c2: css('--c2'), c3: css('--c3'), c4: css('--c4'), c5: css('--c5'),
    ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), line: css('--line'),
    surface: css('--surface-solid'), lineStrong: css('--line-strong'),
  };
}
let T = theme();

function applyChartDefaults() {
  T = theme();
  Chart.defaults.color = T.ink3;
  Chart.defaults.borderColor = T.line;
  Chart.defaults.font.family = css('--font');
  Chart.defaults.font.size = 11;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2,
    borderColor: T.lineStrong, borderWidth: 1, padding: 10, cornerRadius: 10,
    boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' },
  });
  Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 14 });
  Chart.defaults.plugins.legend.align = 'end';
}

/* Hex → rgba */
function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* Remplissage dégradé vertical, recalculé à chaque redimensionnement. */
function gradient(color, top = 0.35) {
  return (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return alpha(color, top / 2);
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, alpha(color, top));
    g.addColorStop(1, alpha(color, 0));
    return g;
  };
}

const series = (label, data, color, extra = {}) => ({
  label, data, borderColor: color, backgroundColor: gradient(color), fill: true,
  pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBackgroundColor: T.surface,
  borderWidth: 2, tension: .35, ...extra,
});
const bars = (label, data, color, extra = {}) => ({
  label, data, backgroundColor: color, hoverBackgroundColor: color, borderWidth: 0, borderRadius: 2, maxBarThickness: 18, ...extra,
});

function timeLabel(v, span) {
  const d = new Date(v);
  if (span > 4 * 86400e3) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  if (span > 36 * 3600e3) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.getHours() + 'h';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function timeChart(id, datasets, opts = {}) {
  if (charts[id]) charts[id].destroy();
  for (const d of datasets) if (!opts.bar) d.data = downsample(d.data);
  let xMin = Infinity, xMax = -Infinity;
  for (const d of datasets) for (const p of d.data) if (Number.isFinite(p.x)) { if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x; }
  if (xMin === Infinity) xMin = xMax = undefined;
  const span = xMin === undefined ? 0 : xMax - xMin;
  const fmtY = opts.money ? (v) => moneyCompact(v) : (v) => fmtCompact.format(v);
  charts[id] = new Chart($('#' + id), {
    type: opts.bar ? 'bar' : 'line',
    data: { datasets },
    options: {
      animation: reduceMotion ? false : { duration: 600, easing: 'easeOutQuart' },
      responsive: true, maintainAspectRatio: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1 },
        tooltip: {
          callbacks: {
            title: (items) => items.length ? dt(items[0].parsed.x) : '',
            label: (c) => ` ${c.dataset.label} : ${opts.money ? money(c.parsed.y) : fmt.format(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear', stacked: !!opts.stacked, offset: !!opts.bar, min: xMin, max: xMax, bounds: 'data',
          grid: { display: false }, border: { display: false },
          ticks: { display: xMin !== undefined, maxTicksLimit: 7, maxRotation: 0, callback: (v) => timeLabel(v, span) },
        },
        y: {
          stacked: !!opts.stacked, beginAtZero: true,
          grid: { color: T.line, drawTicks: false }, border: { display: false },
          ticks: { padding: 8, maxTicksLimit: 5, callback: fmtY },
        },
      },
    },
  });
}

/* Garde au plus ~max points (min et max de chaque tranche) pour ne pas noyer Chart.js. */
function downsample(pts, max = 600) {
  if (pts.length <= max) return pts;
  const size = Math.ceil(pts.length / (max / 2));
  const out = [];
  for (let i = 0; i < pts.length; i += size) {
    let lo = null, hi = null;
    for (let j = i; j < Math.min(i + size, pts.length); j++) {
      const p = pts[j];
      if (p.y == null) continue;
      if (!lo || p.y < lo.y) lo = p;
      if (!hi || p.y > hi.y) hi = p;
    }
    if (lo && hi) out.push(...(lo === hi ? [lo] : lo.x < hi.x ? [lo, hi] : [hi, lo]));
  }
  return out;
}

const tsSeries = (list, key) => (list || []).map((r) => ({ x: new Date(isNaN(r.t) ? r.t : Number(r.t)).getTime(), y: r[key] == null ? null : Number(r[key]) }));

function groupBy(list, keyField, valueField) {
  const out = {};
  for (const r of list || []) {
    if (r[valueField] == null) continue;
    (out[r[keyField]] = out[r[keyField]] || []).push({ x: new Date(isNaN(r.t) ? r.t : Number(r.t)).getTime(), y: Number(r[valueField]) });
  }
  return out;
}

/* --------------------------------- tables -------------------------------- */

function rows(tableSel, list, render, emptyText = 'Rien pour le moment.') {
  const table = $(tableSel);
  const tb = $('tbody', table);
  const cols = $$('thead th', table).length || 1;
  list = list || [];
  tb.innerHTML = list.length
    ? list.map(render).join('')
    : `<tr><td class="empty" colspan="${cols}"><div class="empty-ic">${icon('list')}</div>${esc(emptyText)}</td></tr>`;
}

function skeleton(page) {
  for (const table of $$('table.t', page)) {
    const cols = $$('thead th', table).length;
    const widths = [55, 80, 65, 90, 40, 70];
    $('tbody', table).innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<tr>${Array.from({ length: cols }, (_, j) => `<td><span class="sk" style="width:${widths[(i + j) % widths.length]}%"></span></td>`).join('')}</tr>`
    ).join('');
  }
}

/* ---------------------------- statut & fraîcheur -------------------------- */

let lastUpdate = 0;
let lastError = false;

function setStatus(counts) {
  const up = Number(counts.up) === 1;
  $('#statusDot').className = 'pulse ' + (up ? 'up' : 'down');
  $('#statusText').textContent = up ? 'Serveur en ligne' : 'Serveur injoignable';
  $('#statusPlayers').textContent = counts.online ?? '–';
  const pct = counts.max ? Math.min(100, (Number(counts.online) || 0) / Number(counts.max) * 100) : 0;
  $('#statusMeter').style.width = pct + '%';
}

function tickLive() {
  const el = $('#live');
  const txt = $('#liveText');
  if (lastError) { el.className = 'live error'; txt.textContent = 'Hors ligne'; return; }
  if (!lastUpdate) { el.className = 'live stale'; txt.textContent = 'Chargement…'; return; }
  const s = Math.floor((Date.now() - lastUpdate) / 1000);
  el.className = 'live' + (s > 90 ? ' stale' : '');
  txt.textContent = s < 5 ? 'À jour' : s < 60 ? `Il y a ${s} s` : `Il y a ${Math.floor(s / 60)} min`;
}
setInterval(tickLive, 1000);

function toast(title, detail = '', sev = 'critical', ic = 'alert') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast sev-' + sev;
  el.innerHTML = `${icon(ic)}<div><b>${esc(title)}</b><span>${esc(detail)}</span></div>`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 5000);
}

function openLightbox(src, caption = '') {
  $('#lightboxImg').src = src;
  $('#lightboxCap').textContent = caption;
  $('#lightbox').classList.remove('hidden');
}
function closeLightbox() { $('#lightbox').classList.add('hidden'); $('#lightboxImg').removeAttribute('src'); }
$('#lightbox').addEventListener('click', (e) => { if (e.target.closest('[data-close-lightbox]')) closeLightbox(); });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shot]');
  if (b) openLightbox(b.dataset.shot, b.dataset.cap || '');
});

/* --------------------------------- pages --------------------------------- */

async function loadOverview() {
  const d = await api('overview', '?h=24');
  const k = d.counts || {};
  const online = d.online || [];

  animateNumber($('#hudOnline'), k.online);
  $('#hudMax').textContent = k.max ? '/ ' + k.max : '';
  $('#hudCapacity').textContent = k.max ? `${k.max} places` : 'capacité –';
  const pct = k.max ? Math.min(100, Math.round((Number(k.online) || 0) / Number(k.max) * 100)) : 0;
  $('#hudRing').style.setProperty('--p', pct);
  $('#hudRing .ring-fill').style.opacity = pct > 0 ? 1 : 0;
  animateNumber($('#hudPct'), pct);

  animateNumber($('#kChars'), k.chars ?? 0);
  animateNumber($('#kSessions'), k.sessions24 ?? 0);
  animateNumber($('#kDeaths'), k.deaths24 ?? 0);
  animateNumber($('#kEvents'), k.events24 ?? 0);
  setStatus(k);

  // Jauge HUD : 48 segments sur l'historique 24 h
  const barsEl = $('#hudBars');
  const seg = 48;
  if (barsEl.children.length !== seg) barsEl.innerHTML = '<i></i>'.repeat(seg);
  const maxV = online.reduce((m, p) => Math.max(m, Number(p.value) || 0), Math.max(Number(k.max) || 0, 1));
  [...barsEl.children].forEach((el, i) => {
    const p = online[Math.floor(i * online.length / seg)];
    const v = p ? Number(p.value) : 0;
    el.style.height = Math.max(4, Math.round(v / maxV * 64)) + 'px';
    el.classList.toggle('on', v > 0);
    el.title = p ? `${dt(Number(p.t) || p.t)} · ${v} joueurs` : '';
  });

  timeChart('chOnline', [series('joueurs', tsSeries(online, 'value'), T.c1)]);
  const byThread = groupBy(d.tick, 'thread', 'ms');
  const threadColor = { svMain: T.c1, svNetwork: T.c2, svSync: T.c4 };
  timeChart('chTick', Object.entries(byThread).map(([th, data]) =>
    series(th, data, threadColor[th] || T.ink3, { fill: false, borderWidth: 1.6 })));

  renderUptime(d.up || []);

  const errors = d.errors || [];
  $('#errCount').textContent = errors.length ? `${errors.length} récentes` : 'aucune';
  rows('#tErrors', errors, (e) => `<tr class="lvl-row-error"><td class="time">${dt(e.ts)}</td><td><span class="code">${esc(e.channel)}</span></td><td class="msg">${esc(clean(e.line))}</td></tr>`, 'Aucune erreur récente. Tout roule.');
}

/* Bandeau de disponibilité : 48 tranches de 30 min sur 24 h. */
function renderUptime(up) {
  const seg = 48, end = Date.now(), start = end - 24 * 3600e3, step = (end - start) / seg;
  const buckets = Array.from({ length: seg }, () => ({ ok: 0, down: 0 }));
  let ok = 0;
  for (const r of up) {
    const t = Number(r.t), i = Math.floor((t - start) / step);
    if (i < 0 || i >= seg) continue;
    if (Number(r.value) === 1) { buckets[i].ok++; ok++; } else buckets[i].down++;
  }
  $('#uptimeBar').innerHTML = buckets.map((b, i) => {
    const cls = !b.ok && !b.down ? '' : !b.down ? 'u-ok' : !b.ok ? 'u-down' : 'u-part';
    const from = new Date(start + i * step).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const label = !b.ok && !b.down ? 'pas de relevé' : b.down ? `${b.down} relevé(s) en échec` : 'en ligne';
    return `<i class="${cls}" title="${from} · ${label}"></i>`;
  }).join('');
  const pct = up.length ? ok / up.length * 100 : null;
  const chip = $('#upPct');
  chip.textContent = pct == null ? '–' : pct.toFixed(pct === 100 ? 0 : 2).replace('.', ',') + ' % sur 24 h';
  chip.className = 'chip' + (pct != null && pct < 99 ? ' danger' : '');
}

async function loadEconomy() {
  const d = await api('economy', '?h=' + 24 * 7);
  const mass = d.mass || [];
  const first = mass[0] || {}, last = mass[mass.length - 1] || {};
  const tot = (r) => (r.total_cash == null && r.total_bank == null) ? null : (Number(r.total_cash) || 0) + (Number(r.total_bank) || 0);

  animateNumber($('#eTotal'), tot(last), moneyCompact);
  animateNumber($('#eCash'), last.total_cash, moneyCompact);
  animateNumber($('#eBank'), last.total_bank, moneyCompact);
  trend($('#eTotalTrend'), tot(first), tot(last));
  trend($('#eCashTrend'), Number(first.total_cash), Number(last.total_cash));
  trend($('#eBankTrend'), Number(first.total_bank), Number(last.total_bank));

  const shops = d.shops || [];
  const ca = shops.reduce((s, x) => s + (Number(x.ca) || 0), 0);
  animateNumber($('#eShops'), ca, moneyCompact);
  const latest = d.latest || {};
  const extra = d.extra || [];
  const firstX = extra.find((r) => r.crypto != null) || {}, lastX = [...extra].reverse().find((r) => r.crypto != null) || {};
  animateNumber($('#eCrypto'), latest.total_crypto == null ? null : Number(latest.total_crypto), (n) => fmt.format(n));
  animateNumber($('#eSociety'), latest.society_total == null ? null : Number(latest.society_total), moneyCompact);
  trend($('#eCryptoTrend'), Number(firstX.crypto), Number(lastX.crypto));
  trend($('#eSocietyTrend'), Number(extra.find((r) => r.society != null)?.society), Number([...extra].reverse().find((r) => r.society != null)?.society));
  timeChart('chSociety', [series('sociétés', tsSeries(extra, 'society'), T.c2)], { money: true });
  timeChart('chCrypto', [series('crypto', tsSeries(extra, 'crypto'), T.c5)]);
  $('#eShopsFoot').textContent = shops.length ? `${shops.length} boutiques · top : ${shops[0].shop}` : 'aucune vente';

  timeChart('chMass', [
    series('cash', tsSeries(mass, 'total_cash'), T.c1),
    series('banque', tsSeries(mass, 'total_bank'), T.c2),
  ], { money: true });

  const palette = [T.c1, T.c2, T.c4, T.c3, T.c5];
  const kinds = groupBy(d.flowsByHour, 'kind', 'total');
  timeChart('chFlows', Object.entries(kinds).map(([kind, data], i) => bars(kind, data, palette[i % palette.length])), { bar: true, stacked: true, money: true });

  if (charts.chShops) charts.chShops.destroy();
  charts.chShops = new Chart($('#chShops'), {
    type: 'bar',
    data: {
      labels: shops.map((s) => s.shop),
      datasets: [{
        data: shops.map((s) => Number(s.ca)), borderRadius: 6, borderSkipped: false, maxBarThickness: 22,
        backgroundColor: (ctx) => {
          const area = ctx.chart.chartArea;
          if (!area) return T.c1;
          const g = ctx.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
          g.addColorStop(0, alpha(T.c1, .55)); g.addColorStop(1, T.c1);
          return g;
        },
      }],
    },
    options: {
      indexAxis: 'y', animation: reduceMotion ? false : { duration: 600 }, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + money(c.parsed.x) } } },
      scales: {
        x: { grid: { color: T.line, drawTicks: false }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => moneyCompact(v) } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: T.ink2 } },
      },
    },
  });

  rows('#tTop', d.top, (p, i) => `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span> ${playerLink(p.citizenid, p.name)}</td><td class="r money">${money(p.cash)}</td><td class="r money">${money(p.bank)}</td><td class="r"><b class="money">${money(p.total)}</b></td></tr>`);
  rows('#tFlows', d.flows, (f) => `<tr><td class="time">${dt(f.ts)}</td><td><span class="badge plain">${esc(f.kind)}</span></td><td>${playerLink(f.from_cid)}</td><td>${playerLink(f.to_cid)}</td><td class="r money">${money(f.amount)}</td></tr>`);
  rows('#tPurchases', d.purchases, (p) => `<tr><td class="time">${dt(p.ts)}</td><td>${playerLink(p.citizenid, p.player_name)}</td><td>${esc(p.shop)}</td><td><b>${esc(p.article)}</b></td><td class="r">${p.qty ?? 1}</td><td class="r money">${money(p.total)}</td></tr>`);
}

let searchTimer;
async function loadPlayers() {
  const d = await api('players', '?q=' + encodeURIComponent($('#playerSearch').value.trim()));
  const list = d.players || [];
  $('#playerCount').textContent = fmt.format(list.length) + ' joueurs';
  rows('#tPlayers', list, (p) => `<tr data-href="#player=${encodeURIComponent(p.citizenid)}">
    <td>${playerLink(p.citizenid, p.name)}</td><td><span class="code">${esc(p.citizenid)}</span></td>
    <td>${p.job ? `<span class="badge plain">${esc(p.job)}</span>` : '<span class="time">–</span>'}</td>
    <td>${p.gang && p.gang !== 'none' ? `<span class="badge brand">${esc(p.gang)}</span>` : '<span class="time">–</span>'}</td>
    <td class="r money">${money(p.cash)}</td><td class="r money">${money(p.bank)}</td><td class="time" title="${esc(dt(p.ts))}">${rel(p.ts)}</td></tr>`,
  'Aucun joueur ne correspond à cette recherche.');
}

const ICON_BASE = 'https://raw.githubusercontent.com/overextended/ox_inventory/main/web/images/';
async function loadPlayer(cid) {
  const d = await api('player', '?cid=' + encodeURIComponent(cid));
  const id = d.ident || {};
  const stats = d.stats || {};
  const name = id.name || cid;

  $('#pName').textContent = name;
  $('#pageTitle').textContent = name;
  const av = $('#pAvatar');
  av.textContent = initials(name);
  av.style.setProperty('--h', hue(cid));
  const on = $('#pOnline');
  on.className = 'badge ' + (id.online ? 'ok' : '');
  on.textContent = id.online ? 'en ligne' : 'hors ligne';

  const tags = [`<span class="code">${esc(id.citizenid || cid)}</span>`];
  tags.push(`<span class="badge plain">${icon('cash', 'sm')} ${esc(id.job || 'sans métier')}${id.job_grade != null ? ' · grade ' + esc(id.job_grade) : ''}</span>`);
  if (id.gang && id.gang !== 'none') tags.push(`<span class="badge brand">gang ${esc(id.gang)}</span>`);
  if (!id.online && id.ts) tags.push(`<span class="badge plain">${icon('clock', 'sm')} vu ${esc(rel(id.ts))}</span>`);
  $('#pTags').innerHTML = tags.join('');

  $('#pHours').textContent = (Number(stats.hours) || 0).toFixed(1).replace('.', ',');
  $('#pDeaths').textContent = fmt.format(stats.deaths ?? 0);
  $('#pPurchases').textContent = fmt.format(stats.purchases ?? 0);
  $('#pMoney').textContent = money((Number(id.cash) || 0) + (Number(id.bank) || 0));

  timeChart('chPlayerMoney', [
    series('cash', tsSeries(d.money, 'cash'), T.c1),
    series('banque', tsSeries(d.money, 'bank'), T.c2),
  ], { money: true });

  const inv = d.inventory || [];
  $('#invCount').textContent = inv.length + ' objets';
  $('#pInv').innerHTML = inv.length
    ? inv.map((it) => `<div class="inv-item" title="${esc(it.name)}">
        <span class="inv-qty">×${fmt.format(it.count)}</span>
        <img loading="lazy" src="${ICON_BASE}${encodeURIComponent(it.name)}.png" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
        <span class="inv-fallback" hidden>${icon('package')}</span>
        <span class="inv-name">${esc(it.name.replace(/_/g, ' '))}</span></div>`).join('')
    : '<div class="empty-block">Inventaire vide.</div>';

  const veh = d.vehicles || [];
  $('#vehCount').textContent = veh.length + ' véhicules';
  $('#pVeh').innerHTML = veh.length
    ? veh.map((v) => {
      const state = v.state == 1 ? '<span class="badge ok">au garage</span>' : v.state == 0 ? '<span class="badge warn">sorti</span>' : `<span class="badge">${esc(v.state)}</span>`;
      return `<div class="veh"><div class="veh-top"><span class="plate">${esc(v.plate)}</span>${state}</div>
        <div class="veh-model">${esc(v.model)}</div><div class="veh-garage">${icon('car', 'sm')} ${esc(v.garage || 'garage inconnu')}</div></div>`;
    }).join('')
    : '<div class="empty-block">Aucun véhicule.</div>';

  rows('#tPDeaths', d.deaths, (m) => `<tr><td class="time">${dt(m.ts)}</td><td>${esc(m.cause)}</td><td>${m.killer_name ? playerLink(m.killer_cid, m.killer_name) : '–'}</td><td>${m.weapon ? `<span class="code">${esc(m.weapon)}</span>` : '–'}</td>
    <td class="r nowrap">${m.screenshot_url ? `<button type="button" class="shot-btn" data-shot="${esc(m.screenshot_url)}" data-cap="${esc(name + ' · ' + (m.cause || '') + ' · ' + dt(m.ts))}" title="Voir la capture">${icon('image')}</button>` : ''}
    ${m.x != null && m.y != null ? `<a class="shot-btn" href="#map=${Number(m.x).toFixed(0)},${Number(m.y).toFixed(0)}" title="Voir sur la carte">${icon('map')}</a>` : ''}</td></tr>`);
  rows('#tPSessions', d.sessions, (s) => `<tr><td class="time">${dt(s.start_ts)}</td><td class="time">${s.end_ts ? dt(s.end_ts) : '<span class="badge ok">en cours</span>'}</td><td class="r">${s.minutes != null ? fmt.format(s.minutes) + ' min' : '–'}</td></tr>`);
  rows('#tPFlows', d.flows, (f) => {
    const out = f.from_cid === cid;
    const other = out ? f.to_cid : f.from_cid;
    return `<tr><td class="time">${dt(f.ts)}</td><td><span class="badge plain">${esc(f.kind)}</span></td><td>${playerLink(other)}</td><td class="r money ${out ? 'neg' : 'pos'}">${out ? '−' : '+'}${money(f.amount)}</td></tr>`;
  });
  rows('#tPPurchases', d.purchases, (p) => `<tr><td class="time">${dt(p.ts)}</td><td>${esc(p.shop)}</td><td><b>${esc(p.article)}</b></td><td class="r money">${money(p.total)}</td></tr>`);
  rows('#tPEvents', d.events, (e) => `<tr><td class="time">${dt(e.ts)}</td><td><span class="badge plain">${esc(e.type)}${e.subtype ? ' · ' + esc(e.subtype) : ''}</span></td><td class="mono-cell">${esc(JSON.stringify(e.data).slice(0, 220))}</td></tr>`);
}

let logLevel = '';
let logsRendered = false;
const logRow = (l, isNew) => `<tr class="lvl-row-${esc(l.level)}${isNew ? ' row-new' : ''}"><td class="time">${dt(l.ts)}</td><td>${esc(l.channel)}</td><td>${levelBadge(l.level)}</td><td class="msg">${esc(clean(l.line))}</td></tr>`;
const chatRow = (c, isNew) => `<tr${isNew ? ' class="row-new"' : ''}><td class="time">${dt(c.ts)}</td><td>${playerLink(c.citizenid, c.player_name)}</td><td><span class="badge ${c.subtype === 'command' ? 'brand' : 'plain'}">${esc(c.subtype)}</span></td><td class="msg">${esc(clean(c.message))}</td></tr>`;
async function loadLogs() {
  const p = new URLSearchParams();
  const s = $('#logSearch').value.trim(); if (s) p.set('q', s);
  if (logLevel) p.set('level', logLevel);
  const d = await api('logs', '?' + p.toString());

  const byLevel = groupBy(d.volume, 'level', 'n');
  const colors = { info: T.c4, warn: css('--warn'), error: css('--danger') };
  const order = ['info', 'warn', 'error'];
  timeChart('chLogVolume', Object.entries(byLevel)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([lvl, data]) => bars(lvl, data, colors[lvl] || T.ink3)), { bar: true, stacked: true });

  logsRendered = true;
  rows('#tLogs', d.logs, (l) => logRow(l), 'Aucune ligne ne correspond.');
  rows('#tChat', d.chat, (c) => chatRow(c));
}

const EXPLOSIONS = ['grenade', 'lance-grenades', 'bombe collante', 'molotov', 'roquette', 'obus de tank', 'hi-octane', 'voiture', 'avion',
  'pompe à essence', 'moto', 'vapeur', 'flamme', 'bouche incendie', 'bonbonne de gaz', 'bateau', 'navire', 'camion', 'balle explosive',
  'lance-fumigènes', 'fumigène', 'gaz BZ', 'fusée éclairante', 'bidon d’essence', 'extincteur', 'charge programmable', 'train', 'baril',
  'propane', 'dirigeable', 'flamme explosive', 'citerne', 'roquette d’avion', 'balle de véhicule', 'réservoir', 'fiente d’oiseau'];
const explosionLabel = (t) => { const n = Number(t); return Number.isInteger(n) && EXPLOSIONS[n] ? `${EXPLOSIONS[n]} (${n})` : String(t ?? '?'); };

const ACTION_BADGE = { ban: 'danger', kick: 'warn', warn: 'warn', unban: 'ok', jail: 'info' };
async function loadAdmin() {
  const d = await api('admin');
  timeChart('chDeaths', [bars('morts', (d.deathsByHour || []).map((r) => ({ x: new Date(r.t).getTime(), y: Number(r.n) })), T.c3, { maxBarThickness: 8 })], { bar: true });
  rows('#tActions', d.actions, (a) => `<tr><td class="time">${dt(a.ts)}</td><td><span class="badge ${ACTION_BADGE[String(a.action).toLowerCase()] || 'plain'}">${esc(a.action)}</span></td><td><b>${esc(a.staff || '–')}</b></td><td>${esc(a.target || '–')}</td><td class="msg">${esc(clean(a.reason) || '–')}</td><td class="nowrap">${esc(a.duration || '–')}</td></tr>`);
  rows('#tConn', d.connections, (c) => `<tr><td class="time">${dt(c.start_ts)}</td><td>${playerLink(c.citizenid, c.player_name)}</td><td class="time">${c.end_ts ? dt(c.end_ts) : '<span class="badge ok">en ligne</span>'}</td><td class="reason" title="${esc(c.drop_reason || '')}">${esc(c.drop_reason || '–')}</td></tr>`);
  rows('#tExpl', d.explosions, (e) => `<tr><td class="time">${dt(e.ts)}</td><td>${playerLink(e.citizenid, e.player_name)}</td><td><span class="badge danger">${esc(explosionLabel(e.type))}</span></td></tr>`);
}


/* ------------------------------- statistiques ------------------------------ */

let statsDays = 7;
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function rankList(sel, list, label = (r) => esc(r.name)) {
  const max = list[0]?.n || 1;
  $(sel).innerHTML = list.length
    ? list.map((r) => `<li><span class="rank-name">${label(r)}</span><span class="rank-n">${fmt.format(r.n)}</span><span class="rank-bar"><i style="width:${Math.round(r.n / max * 100)}%"></i></span></li>`).join('')
    : '<li class="feed-empty" style="display:block">Pas encore de données.</li>';
}

function doughnut(id, list) {
  if (charts[id]) charts[id].destroy();
  const palette = [T.c1, T.c2, T.c4, T.c3, T.c5, '#34d399', '#f472b6', '#60a5fa', '#a3e635', '#fb923c', '#94a3b8', '#e879f9'];
  charts[id] = new Chart($('#' + id), {
    type: 'doughnut',
    data: { labels: list.map((r) => r.name), datasets: [{ data: list.map((r) => r.n), backgroundColor: palette, borderColor: T.surface, borderWidth: 2, hoverOffset: 6 }] },
    options: {
      animation: reduceMotion ? false : { duration: 600 }, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { position: 'right', align: 'center', labels: { color: T.ink2 } }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${fmt.format(c.parsed)}` } } },
    },
  });
}

async function loadStats() {
  const d = await api('insights', '?d=' + statsDays);
  const peak = d.peak;
  animateNumber($('#sPeak'), peak ? Number(peak.n) : null);
  $('#sPeakFoot').textContent = peak ? `le ${dt(peak.ts)}` : '–';
  const pct = (v) => (v == null ? '–' : Number(v).toFixed(2).replace('.', ',') + ' %');
  $('#sUpDay').textContent = pct(d.uptime?.day);
  $('#sUpPeriod').textContent = pct(d.uptime?.period);
  $('#sUpPeriodFoot').textContent = `sur ${d.days} jours`;
  const deaths = (d.causes || []).reduce((s, r) => s + r.n, 0);
  animateNumber($('#sDeaths'), deaths);
  $('#sDeathsFoot').textContent = `sur ${d.days} jours · ${fmt.format(Math.round(deaths / d.days))} / jour`;
  $('#heatTz').textContent = `joueurs en moyenne · heure de ${String(d.tz || '').split('/').pop().replace('_', ' ')}`;

  // Carte d'affluence 7 × 24
  const grid = {};
  let max = 0;
  for (const r of d.heat || []) { const v = Number(r.avg) || 0; grid[r.dow + '-' + r.hour] = { v, max: Number(r.max) || 0 }; max = Math.max(max, v); }
  const color = (v) => {
    if (!max || !v) return '';
    const k = v / max;
    const stops = [[139, 123, 255, .25], [139, 123, 255, .65], [255, 77, 109, .85], [255, 138, 31, 1], [255, 209, 102, 1]];
    const pos = k * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(pos)), f = pos - i;
    const c = stops[i].map((x, j) => x + (stops[i + 1][j] - x) * f);
    return `background:rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(2)})`;
  };
  let html = '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="hh">${h % 3 === 0 ? h + 'h' : ''}</span>`).join('');
  for (let dow = 1; dow <= 7; dow++) {
    html += `<span class="hl">${DAYS[dow - 1]}</span>`;
    for (let h = 0; h < 24; h++) {
      const c = grid[dow + '-' + h];
      html += `<span class="hc" style="${color(c?.v)}" title="${DAYS[dow - 1]} ${h}h–${h + 1}h · ${c ? fmt.format(c.v) + ' en moyenne, pic ' + c.max : 'aucun relevé'}"></span>`;
    }
  }
  $('#heat').innerHTML = html;

  doughnut('chJobs', d.jobs || []);
  if (charts.chGangs) charts.chGangs.destroy();
  const gangs = d.gangs || [];
  charts.chGangs = new Chart($('#chGangs'), {
    type: 'bar',
    data: { labels: gangs.map((g) => g.name), datasets: [
      bars('membres', gangs.map((g) => g.n), alpha(T.c4, .55), { borderRadius: 6, maxBarThickness: 22 }),
      bars('en ligne', gangs.map((g) => g.online), T.c1, { borderRadius: 6, maxBarThickness: 22 }),
    ] },
    options: {
      indexAxis: 'y', animation: reduceMotion ? false : { duration: 600 }, maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { x: { grid: { color: T.line, drawTicks: false }, border: { display: false }, ticks: { precision: 0 } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: T.ink2 } } },
    },
  });
  rankList('#sKillers', d.killers || [], (r) => playerLink(r.citizenid, r.name));
  rankList('#sWeapons', d.weapons || [], (r) => `<span class="code">${esc(String(r.name).replace(/^WEAPON_/i, '').toLowerCase())}</span>`);
  doughnut('chCauses', d.causes || []);
}

/* --------------------------------- alertes --------------------------------- */

const ALERT_KIND = {
  server_down: { label: 'Serveur tombé', icon: 'activity' },
  server_up: { label: 'Serveur revenu', icon: 'activity' },
  error_burst: { label: 'Rafale d’erreurs', icon: 'alert' },
  anticheat: { label: 'Anticheat', icon: 'shield' },
  money_jump: { label: 'Saut d’argent', icon: 'trending' },
};
let anoMin = 1000000, anoHours = 24;

function seenAlertId() { try { return Number(localStorage.getItem('bl-alert-seen')) || 0; } catch { return 0; } }
function markAlertsSeen(id) { try { localStorage.setItem('bl-alert-seen', String(id)); } catch { /* idem */ } setAlertBadge(0); }
function setAlertBadge(n) {
  const b = $('#alertBadge');
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
}

async function loadAlerts() {
  const [d, a] = await Promise.all([api('alerts'), api('anomalies', `?h=${anoHours}&min=${anoMin}`)]);
  const cfg = d.config || {};
  $('#cfgIcon').classList.toggle('on', !!cfg.discord);
  $('#cfgTitle').textContent = cfg.discord ? 'Alertes Discord actives' : 'Alertes Discord désactivées';
  $('#cfgSub').innerHTML = cfg.discord
    ? 'Chaque alerte est aussi envoyée sur le salon Discord configuré.'
    : 'Les alertes restent visibles ici. Ajoute la variable <span class="code">DISCORD_WEBHOOK_URL</span> côté API pour les recevoir sur Discord.';
  $('#cfgRules').innerHTML = [
    `≥ ${cfg.errors5min ?? '–'} erreurs / 5 min`,
    `saut ≥ ${moneyCompact(cfg.moneyJump)}`,
    `canal « ${esc(cfg.anticheatChannel || '–')} »`,
  ].map((t) => `<span class="chip">${t}</span>`).join('');

  const by = Object.fromEntries((d.byKind || []).map((r) => [r.kind, r.n]));
  $('#alertKpis').innerHTML = [['server_down', 'var(--danger)'], ['error_burst', 'var(--warn)'], ['anticheat', 'var(--c3)'], ['money_jump', 'var(--c1)']]
    .map(([k, c]) => `<article class="card kpi" style="--accent:${c}"><div class="kpi-icon">${icon(ALERT_KIND[k].icon)}</div><div class="kpi-label">${ALERT_KIND[k].label}</div><div class="kpi-value">${fmt.format(by[k] || 0)}</div><div class="kpi-foot">sur 24 h</div></article>`).join('');

  const list = d.alerts || [];
  $('#alertCount').textContent = list.length ? `${list.length} dernières` : 'aucune';
  $('#alertList').innerHTML = list.length
    ? list.map((al) => {
      const k = ALERT_KIND[al.kind] || { label: al.kind, icon: 'bell' };
      return `<li class="sev-${esc(al.severity)}"><span class="feed-ic">${icon(k.icon)}</span><div>
        <div class="tl-title">${esc(al.title)}</div>
        ${al.detail ? `<div class="tl-detail">${esc(al.detail)}</div>` : ''}
        <div class="tl-meta"><span title="${esc(dt(al.ts))}">${esc(rel(al.ts))}</span><span class="badge plain">${esc(k.label)}</span>
          ${al.notified ? `<span class="badge info">${icon('discord', 'sm')} envoyé</span>` : ''}
          ${al.citizenid ? `<a class="badge brand" href="#player=${encodeURIComponent(al.citizenid)}">fiche joueur</a>` : ''}</div></div></li>`;
    }).join('')
    : '<li class="feed-empty" style="display:block">Aucune alerte. Le serveur est calme.</li>';
  if (list[0]) markAlertsSeen(Number(list[0].id));

  rows('#tAnomalies', a.players, (p) => `<tr>
    <td>${playerLink(p.citizenid, p.name)}</td>
    <td class="r"><b class="money pos">+${money(p.jump)}</b></td>
    <td class="time" title="${esc(dt(p.ts))}">${esc(rel(p.ts))}</td>
    <td class="r money">${moneyCompact(Number(p.prev))} → ${moneyCompact(Number(p.total))}</td>
    <td class="r money ${Number(p.net) >= 0 ? 'pos' : 'neg'}">${Number(p.net) >= 0 ? '+' : '−'}${moneyCompact(Math.abs(Number(p.net)))}</td></tr>`,
  'Aucun saut au-dessus du seuil sur la période.');
}

async function refreshAlertBadge() {
  try {
    const d = await api('alerts');
    const seen = seenAlertId();
    setAlertBadge((d.alerts || []).filter((a) => Number(a.id) > seen).length);
  } catch { /* API pas encore à jour */ }
}

/* Notifications bureau */
function notifEnabled() { try { return localStorage.getItem('bl-notif') === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } }
function renderNotifBtn() {
  const b = $('#notifBtn');
  const on = notifEnabled();
  b.classList.toggle('on', on);
  b.querySelector('span').textContent = on ? 'Notifications bureau activées' : 'Activer les notifications bureau';
}
$('#notifBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('Notifications indisponibles', 'Ce navigateur ne les gère pas.', 'warn'); return; }
  if (notifEnabled()) { try { localStorage.setItem('bl-notif', ''); } catch { /* idem */ } renderNotifBtn(); return; }
  const perm = await Notification.requestPermission();
  try { localStorage.setItem('bl-notif', perm === 'granted' ? '1' : ''); } catch { /* idem */ }
  renderNotifBtn();
});

/* ------------------------------ temps réel (SSE) ----------------------------- */

let liveOn = true;
let stream = null, streamFails = 0;
const FEED_MAX = 40;

function feedItem({ ic, accent, html, ts }) {
  const ul = $('#feed');
  $('.feed-empty', ul)?.remove();
  const li = document.createElement('li');
  li.className = 'new';
  li.innerHTML = `<span class="feed-ic" style="--accent:${accent}">${icon(ic)}</span><div class="feed-main">${html}</div><span class="feed-time" data-ts="${esc(ts)}">${esc(rel(ts))}</span>`;
  ul.prepend(li);
  while (ul.children.length > FEED_MAX) ul.lastChild.remove();
}
setInterval(() => $$('#feed .feed-time').forEach((el) => { el.textContent = rel(el.dataset.ts); }), 30000);

function setFeedState(state) {
  const chip = $('#feedState');
  chip.className = 'chip live-chip ' + state;
  chip.innerHTML = `<span class="pulse sm"></span> ${state === 'on' ? 'en direct' : state === 'off' ? 'indisponible' : 'connexion…'}`;
}

function matchesLogFilter(l) {
  const q = $('#logSearch').value.trim().toLowerCase();
  return (!logLevel || l.level === logLevel) && (!q || String(l.line || '').toLowerCase().includes(q));
}

function prependRows(sel, html, max) {
  const tb = $(sel + ' tbody');
  $('td.empty', tb)?.closest('tr').remove();
  tb.insertAdjacentHTML('afterbegin', html);
  while (tb.children.length > max) tb.lastElementChild.remove();
}

function onTick(d) {
  lastUpdate = Date.now(); lastError = false;
  const st = d.status || {};
  if (st.online != null) {
    setStatus(st);
    if (current.page === 'overview') {
      animateNumber($('#hudOnline'), st.online);
      const pct = st.max ? Math.min(100, Math.round((Number(st.online) || 0) / Number(st.max) * 100)) : 0;
      $('#hudRing').style.setProperty('--p', pct);
      $('#hudRing .ring-fill').style.opacity = pct > 0 ? 1 : 0;
      animateNumber($('#hudPct'), pct);
    }
  }
  for (const s of d.sessions || []) feedItem({ ic: 'login', accent: 'var(--ok)', ts: s.ts, html: `${playerLink(s.citizenid, s.player_name)} s’est connecté` });
  for (const m of d.deaths || []) feedItem({ ic: 'skull', accent: 'var(--c3)', ts: m.ts, html: `${playerLink(m.citizenid, m.player_name)} est mort · ${esc(m.cause || '?')}${m.killer_name ? ' par <b>' + esc(m.killer_name) + '</b>' : ''}` });
  for (const c of d.chat || []) feedItem({ ic: 'message', accent: 'var(--c4)', ts: c.ts, html: `${playerLink(c.citizenid, c.player_name)} : ${esc(clean(c.message)).slice(0, 160)}` });
  for (const l of (d.logs || []).filter((x) => x.level === 'error')) feedItem({ ic: 'alert', accent: 'var(--danger)', ts: l.ts, html: `<span class="code">${esc(l.channel || '?')}</span> ${esc(clean(l.line)).slice(0, 160)}` });

  for (const al of d.alerts || []) {
    const k = ALERT_KIND[al.kind] || { icon: 'bell' };
    feedItem({ ic: k.icon, accent: 'var(--brand-1)', ts: al.ts, html: `<b>${esc(al.title)}</b>` });
    toast(al.title, clean(al.detail || ''), al.severity, k.icon);
    if (notifEnabled() && document.hidden) { try { new Notification('Brothers Life · ' + al.title, { body: clean(al.detail || ''), icon: 'logo.png' }); } catch { /* idem */ } }
  }
  if ((d.alerts || []).length) {
    if (current.page === 'alerts') run(false);
    else refreshAlertBadge();
  }

  if (current.page === 'logs' && liveOn && logsRendered) {
    const logs = (d.logs || []).filter(matchesLogFilter).reverse();
    if (logs.length) prependRows('#tLogs', logs.map((l) => logRow(l, true)).join(''), 400);
    const chat = [...(d.chat || [])].reverse();
    if (chat.length) prependRows('#tChat', chat.map((c) => chatRow(c, true)).join(''), 150);
  }
  tickLive();
}

function connectStream() {
  if (!('EventSource' in window)) { setFeedState('off'); return; }
  stream = new EventSource(API_BASE + '/api/stream');
  stream.addEventListener('open', () => { streamFails = 0; setFeedState('on'); });
  stream.addEventListener('tick', (e) => { try { onTick(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  stream.addEventListener('error', () => {
    setFeedState('wait');
    if (++streamFails >= 5) { stream.close(); setFeedState('off'); setTimeout(() => { streamFails = 0; connectStream(); }, 60000); }
  });
}

$('#liveToggle').addEventListener('click', () => {
  liveOn = !liveOn;
  const b = $('#liveToggle');
  b.classList.toggle('on', liveOn);
  b.setAttribute('aria-pressed', liveOn);
  b.querySelector('span:last-child').textContent = liveOn ? 'Direct' : 'En pause';
  if (liveOn) run(false);
});

/* ------------------------------- export CSV -------------------------------- */

function exportTable(table, name) {
  const cell = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('.avatar, .rank, svg, button').forEach((x) => x.remove());
    return '"' + c.textContent.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
  };
  const head = $$('thead th', table).map(cell).join(';');
  const body = $$('tbody tr', table).filter((tr) => !tr.querySelector('.empty, .sk')).map((tr) => $$('td', tr).map(cell).join(';'));
  if (!body.length) { toast('Rien à exporter', 'Le tableau est vide.', 'warn'); return; }
  const blob = new Blob(['﻿' + [head, ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function addExportButtons() {
  for (const table of $$('table.t')) {
    if (table.dataset.export) continue;
    table.dataset.export = '1';
    const card = table.closest('.card');
    const head = card && $('.card-head, .console-head', card);
    const name = (head?.innerText || table.id).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || table.id;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'icon-btn export-btn'; btn.title = 'Exporter en CSV'; btn.setAttribute('aria-label', 'Exporter en CSV');
    btn.innerHTML = icon('download');
    btn.addEventListener('click', () => exportTable(table, name));
    if (head) {
      let tools = $('.card-tools', head);
      if (!tools) {
        tools = document.createElement('div'); tools.className = 'card-tools';
        const chip = $(':scope > .chip', head);
        if (chip) tools.appendChild(chip);
        head.appendChild(tools);
        if (head.classList.contains('console-head')) tools.style.marginLeft = 'auto';
      }
      tools.appendChild(btn);
    } else if (table.id === 'tPlayers') $('#page-players .toolbar').appendChild(btn);
  }
}
addExportButtons();

/* Segments des nouvelles pages */
function segmented(id, key, fn) {
  $('#' + id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b));
    fn(b.dataset[key]);
  });
}
segmented('statsRange', 'd', (v) => { statsDays = Number(v); run(true); });
segmented('anoMin', 'min', (v) => { anoMin = Number(v); run(false); });
segmented('anoRange', 'h', (v) => { anoHours = Number(v); run(false); });

/* ----------------------------- base de données ----------------------------- */

const bytes = (b) => {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0; b = Number(b) || 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (i ? b.toFixed(b < 10 ? 1 : 0).replace('.', ',') : b) + ' ' + u[i];
};
const growth = (now, before) => (before == null ? '<span class="time">–</span>'
  : now - before === 0 ? '<span class="time">0</span>'
  : `<span class="${now > before ? 'pos' : 'neg'}">${now > before ? '+' : '−'}${fmt.format(Math.abs(now - before))}</span>`);
const colLabel = (c) => String(c).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const cellLabel = (v) => String(v ?? '–').replace(/^\d+\.\s/, ''); // "1. < 10 k$" -> "< 10 k$" (préfixe de tri)
const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v));

function dbCard(s, i) {
  const id = 'db-' + s.name;
  const head = `<header class="card-head"><div class="card-title">${icon(s.kind === 'table' ? 'list' : 'chart')}${esc(s.label)}</div><span class="chip" title="${esc(dt(s.ts))}">${esc(rel(s.ts))}</span></header>`;
  if ((s.kind === 'bar' || s.kind === 'donut') && s.rows.length) return `<article class="card chart-card">${head}<div class="chart"><canvas id="${id}"></canvas></div></article>`;
  const cols = s.columns || [];
  const numeric = cols.map((_, j) => s.rows.length && s.rows.every((r) => r[j] == null || isNum(r[j])));
  const body = s.rows.length
    ? s.rows.map((r) => `<tr>${cols.map((_, j) => numeric[j] ? `<td class="r money">${fmt.format(Number(r[j]) || 0)}</td>` : `<td>${esc(cellLabel(r[j]))}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${cols.length || 1}"><div class="empty-ic">${icon('list')}</div>Aucune ligne.</td></tr>`;
  const wide = cols.length > 3 ? ' wide' : '';
  return `<article class="card${wide}">${head}<div class="table-wrap"><table class="t" id="${id}"><thead><tr>${cols.map((c, j) => `<th class="${numeric[j] ? 'r' : ''}">${esc(colLabel(c))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}

function dbChart(s) {
  const id = 'db-' + s.name;
  const el = document.getElementById(id);
  if (!el || el.tagName !== 'CANVAS') return;
  const labels = s.rows.map((r) => cellLabel(r[0]));
  const values = s.rows.map((r) => Number(r[1]) || 0);
  if (s.kind === 'donut') { doughnut(id, labels.map((name, i) => ({ name, n: values[i] }))); return; }
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, {
    type: 'bar',
    data: { labels, datasets: [bars(colLabel(s.columns?.[1] || 'valeur'), values, T.c1, { borderRadius: 6, maxBarThickness: 26 })] },
    options: {
      indexAxis: labels.length > 6 ? 'y' : 'x', animation: reduceMotion ? false : { duration: 600 }, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt.format(c.parsed[labels.length > 6 ? 'x' : 'y'])} ${s.columns?.[1] || ''}` } } },
      scales: {
        x: { grid: { display: labels.length > 6, color: T.line, drawTicks: false }, border: { display: false }, ticks: { color: T.ink2 } },
        y: { grid: { display: labels.length <= 6, color: T.line, drawTicks: false }, border: { display: false }, ticks: { color: T.ink2, precision: 0 } },
      },
    },
  });
}

async function loadDb() {
  const d = await api('db');
  const tables = d.tables || [];
  const totalRows = tables.reduce((s, t) => s + t.rows, 0);
  animateNumber($('#dbTables'), tables.length || null);
  animateNumber($('#dbRows'), tables.length ? totalRows : null, (n) => fmtCompact.format(n));
  const before = tables.filter((t) => t.rows24h != null);
  const grown = before.reduce((s, t) => s + (t.rows - t.rows24h), 0);
  $('#dbRowsFoot').innerHTML = before.length ? `${growth(totalRows, totalRows - grown)} sur 24 h` : 'estimation MySQL';
  $('#dbSize').textContent = tables.length ? bytes(tables.reduce((s, t) => s + t.bytes, 0)) : '–';
  const top = before.map((t) => ({ ...t, g: t.rows - t.rows24h })).sort((a, b) => b.g - a.g)[0];
  $('#dbGrowth').textContent = top && top.g > 0 ? '+' + fmtCompact.format(top.g) : '–';
  $('#dbGrowthFoot').textContent = top && top.g > 0 ? `${top.name} · sur 24 h` : 'pas encore d’historique';
  $('#dbTs').textContent = d.tablesTs ? 'lu ' + rel(d.tablesTs) : 'en attente de bl_telemetry';

  const maxB = tables[0]?.bytes || 1;
  rows('#tDbTables', tables, (t) => `<tr><td><span class="code">${esc(t.name)}</span></td><td class="r money">${fmt.format(t.rows)}</td>
    <td class="r money">${growth(t.rows, t.rows24h)}</td><td class="r money">${growth(t.rows, t.rows7d)}</td>
    <td><div class="size-bar"><div class="rank-bar"><i style="width:${Math.max(2, Math.round(t.bytes / maxB * 100))}%"></i></div><span>${bytes(t.bytes)}</span></div></td></tr>`,
  'Aucune donnée : installe bl_telemetry 1.1 (module dbsync) sur le serveur.');

  const snaps = d.snapshots || [];
  $('#dbCards').innerHTML = snaps.length ? snaps.map(dbCard).join('')
    : '<article class="card wide"><div class="empty-block">Les lectures de la base apparaîtront ici après la mise à jour de <span class="code">bl_telemetry</span> sur le serveur.</div></article>';
  snaps.forEach(dbChart);
  addExportButtons();
}

/* ------------------------------- navigation ------------------------------ */

const loaders = { overview: loadOverview, economy: loadEconomy, players: loadPlayers, logs: loadLogs, admin: loadAdmin, stats: loadStats, alerts: loadAlerts, db: loadDb };
/* Les logs arrivent en direct par le flux ; le rafraîchissement complet sert de filet de sécurité. */
const AUTO_REFRESH = { overview: 30000, logs: 60000, alerts: 60000 };
let current = { page: null, arg: null };
let refreshTimer;

async function run(first) {
  const { page, arg } = current;
  const el = $('#page-' + page);
  if (first) skeleton(el);
  $('#refreshBtn').classList.add('spin');
  try {
    await (page === 'player' ? loadPlayer(arg) : page === 'map' ? DeathMap.load(arg) : loaders[page]?.());
    lastUpdate = Date.now();
    lastError = false;
  } catch (err) {
    console.error(err);
    lastError = true;
    if (err.status === 404) toast('Fonction pas encore disponible', 'Cette page a besoin de la dernière version de l’API (bl-panel).', 'warn');
    else toast('Impossible de charger les données', err.message || 'API injoignable');
    if (first) $$('tbody', el).forEach((tb) => { tb.innerHTML = ''; });
  } finally {
    $('#refreshBtn').classList.remove('spin');
    tickLive();
  }
}

function show(page, arg) {
  const el = $('#page-' + page);
  if (!el) { location.hash = '#overview'; return; }
  $$('.page').forEach((p) => p.classList.add('hidden'));
  el.classList.remove('hidden');
  const navPage = page === 'player' ? 'players' : page;
  $$('#nav a, #tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.page === navPage));
  $('#pageTitle').textContent = el.dataset.title;
  document.title = `${el.dataset.title} · Brothers Life`;
  if (page === 'player') selectTab('assets');
  if (page === 'logs') logsRendered = false;
  if (page === 'alerts') renderNotifBtn();

  current = { page, arg };
  clearInterval(refreshTimer);
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  run(true);
  if (AUTO_REFRESH[page]) refreshTimer = setInterval(() => run(false), AUTO_REFRESH[page]);
}

function route() {
  const h = location.hash.slice(1) || 'overview';
  if (h.startsWith('player=')) show('player', decodeURIComponent(h.slice(7)));
  else if (h.startsWith('map=')) show('map', decodeURIComponent(h.slice(4)));
  else show(h);
}
window.addEventListener('hashchange', route);

/* Statut serveur toujours à jour dans la barre latérale, quelle que soit la page. */
async function pingStatus() {
  if (current.page === 'overview') return;
  try { setStatus((await api('overview', '?h=1')).counts || {}); } catch { /* le toast de la page suffit */ }
}
setInterval(pingStatus, 60000);

/* --------------------------------- onglets -------------------------------- */

function selectTab(name) {
  $$('#playerTabs .tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $$('#page-player .tabpanel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
}
$('#playerTabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) selectTab(t.dataset.tab); });

/* ------------------------------- interactions ----------------------------- */

$('#playerSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => run(false), 300); });
$('#logSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => run(false), 400); });
$('#logLevel').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  logLevel = b.dataset.level;
  $$('#logLevel button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
  run(false);
});

/* Ligne de table entière cliquable (hors liens internes). */
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
});

$('#refreshBtn').addEventListener('click', () => run(false));

/* Thème */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('bl-theme', t); } catch { /* stockage indisponible */ }
  $('meta[name="theme-color"]').content = t === 'light' ? '#f6f4f1' : '#0a090c';
  applyChartDefaults();
  DeathMap.redraw();
  if (current.page && current.page !== 'map') run(false);
}
$('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));

/* Barre latérale repliable */
function setCollapsed(on) {
  $('#app').classList.toggle('collapsed', on);
  try { localStorage.setItem('bl-collapsed', on ? '1' : ''); } catch { /* idem */ }
  setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 360);
}
$('#collapseBtn').addEventListener('click', () => setCollapsed(!$('#app').classList.contains('collapsed')));
try { if (localStorage.getItem('bl-collapsed')) $('#app').classList.add('collapsed'); } catch { /* idem */ }

/* --------------------------- palette de commandes ------------------------- */

const PAGES = [
  { title: "Vue d'ensemble", sub: 'Joueurs en ligne, tick, erreurs', href: '#overview', icon: 'dashboard' },
  { title: 'Économie', sub: 'Masse monétaire, flux, boutiques', href: '#economy', icon: 'wallet' },
  { title: 'Joueurs', sub: 'Liste et recherche', href: '#players', icon: 'users' },
  { title: 'Logs', sub: 'Console serveur, chat et commandes', href: '#logs', icon: 'terminal' },
  { title: 'Statistiques', sub: 'Affluence, métiers, gangs, tueurs, armes', href: '#stats', icon: 'chart' },
  { title: 'Base de données', sub: 'Tables, fortunes, objets, véhicules, bans', href: '#db', icon: 'database' },
  { title: 'Staff & sécurité', sub: 'Actions staff, connexions, explosions', href: '#admin', icon: 'shield' },
  { title: 'Alertes', sub: 'Historique, Discord, sauts d’argent suspects', href: '#alerts', icon: 'bell' },
  { title: 'Carte des morts', sub: 'Carte de chaleur, zones, captures', href: '#map', icon: 'map' },
];
let palItems = [];
let palPlayers = [];
let palSel = 0;
let palTimer;
let palSeq = 0;

function renderPalette(loading = false) {
  const players = palPlayers;
  const q = $('#paletteInput').value.trim().toLowerCase();
  const pages = PAGES.filter((p) => !q || (p.title + ' ' + p.sub).toLowerCase().includes(q));
  palItems = [
    ...players.map((p) => ({ title: p.name || p.citizenid, sub: `${p.citizenid}${p.job ? ' · ' + p.job : ''}`, href: '#player=' + encodeURIComponent(p.citizenid), avatar: p.citizenid })),
    ...pages,
  ];
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const item = (it, i) => `<button type="button" class="palette-item ${i === palSel ? 'sel' : ''}" data-i="${i}">
      ${it.avatar ? avatar(it.avatar, it.title) : icon(it.icon)}
      <span class="pi-main"><span class="pi-title">${esc(it.title)}</span><br><span class="pi-sub">${esc(it.sub)}</span></span>
      <span class="pi-go">${icon('enter', 'sm')}</span></button>`;
  let html = '';
  if (players.length) html += '<div class="palette-group">Joueurs</div>' + players.map((_, i) => item(palItems[i], i)).join('');
  else if (loading) html += '<div class="palette-group">Joueurs</div><div class="palette-empty">Recherche…</div>';
  if (pages.length) html += '<div class="palette-group">Pages</div>' + pages.map((_, i) => item(palItems[players.length + i], players.length + i)).join('');
  if (!palItems.length && !loading) html = `<div class="palette-empty">Aucun résultat pour « ${esc(q)} »</div>`;
  $('#paletteList').innerHTML = html;
  $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  $('#palette').classList.remove('hidden');
  $('#paletteInput').value = '';
  palSel = 0;
  palPlayers = [];
  renderPalette();
  setTimeout(() => $('#paletteInput').focus(), 10);
}
function closePalette() { $('#palette').classList.add('hidden'); }
function goPalette(i) { const it = palItems[i]; if (!it) return; closePalette(); location.hash = it.href; }

$('#paletteInput').addEventListener('input', () => {
  palSel = 0;
  palPlayers = [];
  const q = $('#paletteInput').value.trim();
  const seq = ++palSeq;
  clearTimeout(palTimer);
  if (q.length < 2) { renderPalette(); return; }
  renderPalette(true);
  palTimer = setTimeout(async () => {
    try {
      const d = await api('players', '?q=' + encodeURIComponent(q));
      if (seq === palSeq) palPlayers = (d.players || []).slice(0, 6);
    } catch { /* on garde les pages */ }
    if (seq === palSeq) renderPalette();
  }, 220);
});
$('#paletteInput').addEventListener('keydown', (e) => {
  const n = Math.max(1, palItems.length);
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = (palSel + 1) % n; renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel - 1 + n) % n; renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); goPalette(palSel); }
});
$('#paletteList').addEventListener('click', (e) => { const b = e.target.closest('.palette-item'); if (b) goPalette(Number(b.dataset.i)); });
$('#palette').addEventListener('click', (e) => { if (e.target.closest('[data-close-palette]')) closePalette(); });
$$('[data-open-palette]').forEach((b) => b.addEventListener('click', openPalette));

document.addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName);
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); openPalette(); }
  else if (e.key === 'Escape' && !$('#palette').classList.contains('hidden')) closePalette();
});
if (!/Mac|iPhone|iPad/.test(navigator.platform)) $$('kbd').forEach((k) => { if (k.textContent === '⌘K') k.textContent = 'Ctrl K'; });

/* ----------------------------------- go ----------------------------------- */

applyChartDefaults();
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 150); });

/* Accès direct, sans login. */
route();
pingStatus();
connectStream();
refreshAlertBadge();
