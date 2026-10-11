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
  if (!r.ok) throw new Error(`HTTP ${r.status} sur /api/${name}`);
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
  const xs = datasets.flatMap((d) => d.data.map((p) => p.x)).filter(Number.isFinite);
  const xMin = xs.length ? Math.min(...xs) : undefined;
  const xMax = xs.length ? Math.max(...xs) : undefined;
  const span = xs.length ? xMax - xMin : 0;
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
          ticks: { maxTicksLimit: 7, maxRotation: 0, callback: (v) => timeLabel(v, span) },
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

function toast(title, detail = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon('alert')}<div><b>${esc(title)}</b><span>${esc(detail)}</span></div>`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 5000);
}

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
  const maxV = Math.max(Number(k.max) || 0, ...online.map((p) => Number(p.value) || 0), 1);
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

  const errors = d.errors || [];
  $('#errCount').textContent = errors.length ? `${errors.length} récentes` : 'aucune';
  rows('#tErrors', errors, (e) => `<tr class="lvl-row-error"><td class="time">${dt(e.ts)}</td><td><span class="code">${esc(e.channel)}</span></td><td class="msg">${esc(e.line)}</td></tr>`, 'Aucune erreur récente. Tout roule.');
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

  rows('#tPDeaths', d.deaths, (m) => `<tr><td class="time">${dt(m.ts)}</td><td>${esc(m.cause)}</td><td>${esc(m.killer_name || '–')}</td><td>${m.weapon ? `<span class="code">${esc(m.weapon)}</span>` : '–'}</td></tr>`);
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

  rows('#tLogs', d.logs, (l) => `<tr class="lvl-row-${esc(l.level)}"><td class="time">${dt(l.ts)}</td><td>${esc(l.channel)}</td><td>${levelBadge(l.level)}</td><td class="msg">${esc(l.line)}</td></tr>`, 'Aucune ligne ne correspond.');
  rows('#tChat', d.chat, (c) => `<tr><td class="time">${dt(c.ts)}</td><td>${playerLink(c.citizenid, c.player_name)}</td><td><span class="badge ${c.subtype === 'command' ? 'brand' : 'plain'}">${esc(c.subtype)}</span></td><td class="msg">${esc(c.message)}</td></tr>`);
}

const ACTION_BADGE = { ban: 'danger', kick: 'warn', warn: 'warn', unban: 'ok', jail: 'info' };
async function loadAdmin() {
  const d = await api('admin');
  timeChart('chDeaths', [bars('morts', (d.deathsByHour || []).map((r) => ({ x: new Date(r.t).getTime(), y: Number(r.n) })), T.c3, { maxBarThickness: 8 })], { bar: true });
  rows('#tActions', d.actions, (a) => `<tr><td class="time">${dt(a.ts)}</td><td><span class="badge ${ACTION_BADGE[String(a.action).toLowerCase()] || 'plain'}">${esc(a.action)}</span></td><td><b>${esc(a.staff || '–')}</b></td><td>${esc(a.target || '–')}</td><td class="msg">${esc(a.reason || '–')}</td><td class="nowrap">${esc(a.duration || '–')}</td></tr>`);
  rows('#tConn', d.connections, (c) => `<tr><td class="time">${dt(c.start_ts)}</td><td>${playerLink(c.citizenid, c.player_name)}</td><td class="time">${c.end_ts ? dt(c.end_ts) : '<span class="badge ok">en ligne</span>'}</td></tr>`);
  rows('#tExpl', d.explosions, (e) => `<tr><td class="time">${dt(e.ts)}</td><td>${playerLink(e.citizenid, e.player_name)}</td><td><span class="badge danger">${esc(e.type || '?')}</span></td></tr>`);
}

/* ------------------------------- navigation ------------------------------ */

const loaders = { overview: loadOverview, economy: loadEconomy, players: loadPlayers, logs: loadLogs, admin: loadAdmin };
const AUTO_REFRESH = { overview: 30000, logs: 30000 };
let current = { page: null, arg: null };
let refreshTimer;

async function run(first) {
  const { page, arg } = current;
  const el = $('#page-' + page);
  if (first) skeleton(el);
  $('#refreshBtn').classList.add('spin');
  try {
    await (page === 'player' ? loadPlayer(arg) : loaders[page]?.());
    lastUpdate = Date.now();
    lastError = false;
  } catch (err) {
    console.error(err);
    lastError = true;
    toast('Impossible de charger les données', err.message || 'API injoignable');
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

  current = { page, arg };
  clearInterval(refreshTimer);
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  run(true);
  if (AUTO_REFRESH[page]) refreshTimer = setInterval(() => run(false), AUTO_REFRESH[page]);
}

function route() {
  const h = location.hash.slice(1) || 'overview';
  if (h.startsWith('player=')) show('player', decodeURIComponent(h.slice(7)));
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
  if (current.page) run(false);
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
  { title: 'Staff & sécurité', sub: 'Actions staff, connexions, explosions', href: '#admin', icon: 'shield' },
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
