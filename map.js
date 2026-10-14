'use strict';
/* Carte des morts — canvas zoomable : carte de chaleur ou points, zones les plus mortelles, fiche détaillée.
   Utilise les utilitaires de app.js (api, esc, dt, rel, playerLink, openLightbox…) au moment de l'appel. */

const DeathMap = (() => {
  /* Limites du monde GTA V (unités du jeu), nord en haut. */
  const B = { xMin: -4200, xMax: 4600, yMin: -4400, yMax: 8400 };

  /* Image de fond facultative : déposer une carte GTA V nommée map.jpg à la racine et ajuster IMG_BOUNDS
     pour la caler. Sans image, la carte affiche une grille et les noms de zones. */
  const IMG_SRC = 'map.jpg';
  const IMG_BOUNDS = { xMin: -5640, xMax: 6760, yMin: -4860, yMax: 8420 };

  /* Repères approximatifs (centre des zones). */
  const ZONES = [
    ['Los Santos', 100, -900], ['Vespucci', -1250, -1350], ['Aéroport LS', -1150, -2850], ['Port de LS', 950, -2950],
    ['Vinewood', 300, 850], ['Mirror Park', 1150, -550], ['Rancho', 400, -1800], ['Pacific Bluffs', -2000, -350],
    ['Chumash', -3150, 950], ['Tongva Hills', -1700, 1900], ['Fort Zancudo', -2250, 3100], ['Great Chaparral', -350, 2650],
    ['Harmony', 550, 2700], ['Grand Senora', 1700, 2900], ['Sandy Shores', 1850, 3700], ['Alamo Sea', 900, 4100],
    ['Grapeseed', 1700, 4800], ['Mont Chiliad', 500, 5600], ['Paleto Bay', -250, 6300], ['Palomino', 2600, -600],
    ['Mont Gordo', 2850, 5500], ['Raton Canyon', -1300, 4400],
  ];

  let els, ctx, dpr = 1, W = 0, H = 0;
  let view = { cx: 200, cy: 2000, scale: 0.05 };
  let points = [], shots = [], hovered = null, selected = null;
  let mode = 'heat', hours = 168, inited = false, pendingFocus = null;
  let img = null, imgReady = false, raf = 0, brush = null, lut = null;

  const colorFor = (s) => {
    const palette = ['#ff8a1f', '#3dd6c6', '#ff4d6d', '#8b7bff', '#ffd166', '#34d399'];
    let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  };
  const isLight = () => document.documentElement.dataset.theme === 'light';

  /* ----------------------------- transformations ---------------------------- */
  const toScreen = (x, y) => [(x - view.cx) * view.scale + W / 2, (view.cy - y) * view.scale + H / 2];
  const toWorld = (sx, sy) => [(sx - W / 2) / view.scale + view.cx, view.cy - (sy - H / 2) / view.scale];

  function fit() {
    view.scale = Math.min(W / (B.xMax - B.xMin), H / (B.yMax - B.yMin)) * 0.95;
    view.cx = (B.xMin + B.xMax) / 2;
    view.cy = (B.yMin + B.yMax) / 2;
  }
  function zoomAt(factor, sx = W / 2, sy = H / 2) {
    const [wx, wy] = toWorld(sx, sy);
    const min = Math.min(W / (B.xMax - B.xMin), H / (B.yMax - B.yMin)) * 0.6;
    view.scale = Math.min(Math.max(view.scale * factor, min), 4);
    const [nx, ny] = toWorld(sx, sy);
    view.cx += wx - nx; view.cy += wy - ny;
    draw();
  }
  function focus(x, y, scale = 0.6) { view.cx = x; view.cy = y; view.scale = scale; draw(); }

  /* -------------------------------- rendu ---------------------------------- */
  function makeBrush() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    brush = c;
    const l = document.createElement('canvas'); l.width = 256; l.height = 1;
    const lg = l.getContext('2d');
    const gr = lg.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(80,60,255,0)'); gr.addColorStop(0.25, 'rgba(139,123,255,.8)');
    gr.addColorStop(0.55, '#ff4d6d'); gr.addColorStop(0.8, '#ff8a1f'); gr.addColorStop(1, '#ffe08a');
    lg.fillStyle = gr; lg.fillRect(0, 0, 256, 1);
    lut = lg.getImageData(0, 0, 256, 1).data;
  }

  function drawBase() {
    const light = isLight();
    ctx.fillStyle = light ? '#dfe9f1' : '#0b1622';
    ctx.fillRect(0, 0, W, H);
    if (imgReady) {
      const [x0, y0] = toScreen(IMG_BOUNDS.xMin, IMG_BOUNDS.yMax);
      const [x1, y1] = toScreen(IMG_BOUNDS.xMax, IMG_BOUNDS.yMin);
      ctx.globalAlpha = light ? 0.9 : 0.75;
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1;
    } else {
      // Emprise du monde jouable
      const [x0, y0] = toScreen(B.xMin, B.yMax);
      const [x1, y1] = toScreen(B.xMax, B.yMin);
      ctx.fillStyle = light ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.025)';
      ctx.strokeStyle = light ? 'rgba(20,14,8,.12)' : 'rgba(255,255,255,.08)';
      ctx.lineWidth = 1;
      roundRect(x0, y0, x1 - x0, y1 - y0, 18 * dpr); ctx.fill(); ctx.stroke();
    }
    // Grille tous les 1000 unités
    ctx.strokeStyle = light ? 'rgba(20,14,8,.06)' : 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(B.xMin / 1000) * 1000; x <= B.xMax; x += 1000) { const [sx] = toScreen(x, 0); ctx.moveTo(sx, toScreen(0, B.yMax)[1]); ctx.lineTo(sx, toScreen(0, B.yMin)[1]); }
    for (let y = Math.ceil(B.yMin / 1000) * 1000; y <= B.yMax; y += 1000) { const [, sy] = toScreen(0, y); ctx.moveTo(toScreen(B.xMin, 0)[0], sy); ctx.lineTo(toScreen(B.xMax, 0)[0], sy); }
    ctx.stroke();
    // Noms de zones
    const size = Math.max(10, Math.min(15, view.scale * 160)) * dpr;
    ctx.font = `600 ${size}px Geist, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = light ? 'rgba(20,14,8,.42)' : 'rgba(255,255,255,.32)';
    for (const [name, x, y] of ZONES) { const [sx, sy] = toScreen(x, y); ctx.fillText(name.toUpperCase(), sx, sy); }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawHeat() {
    if (!points.length) return;
    if (!brush) makeBrush();
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const o = off.getContext('2d');
    const r = Math.max(10 * dpr, Math.min(90 * dpr, 140 * view.scale));
    o.globalAlpha = Math.min(0.5, Math.max(0.08, 6 / Math.sqrt(points.length)));
    for (const p of points) {
      const [sx, sy] = toScreen(p.x, p.y);
      if (sx < -r || sy < -r || sx > W + r || sy > H + r) continue;
      o.drawImage(brush, sx - r, sy - r, r * 2, r * 2);
    }
    const data = o.getImageData(0, 0, W, H);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      const k = a * 4;
      px[i] = lut[k]; px[i + 1] = lut[k + 1]; px[i + 2] = lut[k + 2]; px[i + 3] = Math.min(255, a * 1.6);
    }
    o.putImageData(data, 0, 0);
    ctx.drawImage(off, 0, 0);
  }

  function drawPoints(all) {
    const r = Math.max(2.5, Math.min(6, view.scale * 40)) * dpr;
    for (const p of points) {
      if (!all && p !== hovered && p !== selected) continue;
      const [sx, sy] = toScreen(p.x, p.y);
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(p.cause); ctx.globalAlpha = all ? 0.85 : 1; ctx.fill();
      ctx.globalAlpha = 1;
      if (p === hovered || p === selected) {
        ctx.lineWidth = 2 * dpr; ctx.strokeStyle = isLight() ? '#17120e' : '#fff';
        ctx.beginPath(); ctx.arc(sx, sy, r + 4 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!ctx) return;
      drawBase();
      if (mode === 'heat') { drawHeat(); drawPoints(false); } else drawPoints(true);
    });
  }

  /* ------------------------------ interactions ------------------------------ */
  function nearest(sx, sy, max = 12) {
    let best = null, bd = (max * dpr) ** 2;
    for (const p of points) {
      const [x, y] = toScreen(p.x, p.y);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function showTip(p, cx, cy) {
    const tip = els.tip;
    if (!p) { tip.classList.add('hidden'); return; }
    tip.innerHTML = `<b>${esc(p.player_name || p.citizenid || 'Inconnu')}</b><br><span>${esc(p.cause || '?')}${p.killer_name ? ' · par ' + esc(p.killer_name) : ''}</span><br><span>${esc(dt(p.ts))}${p.screenshot_url ? ' · capture dispo' : ''}</span>`;
    tip.classList.remove('hidden');
    const rect = els.stage.getBoundingClientRect();
    const x = Math.min(cx + 14, rect.width - tip.offsetWidth - 8);
    const y = Math.min(cy + 14, rect.height - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  function bind() {
    let drag = null;
    const st = els.stage;
    const local = (e) => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    st.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x * dpr, y * dpr);
    }, { passive: false });

    st.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.map-ctrl')) return;
      st.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    });
    st.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; st.classList.add('dragging'); }
        view.cx = drag.cx - dx * dpr / view.scale;
        view.cy = drag.cy + dy * dpr / view.scale;
        showTip(null);
        draw();
        return;
      }
      const p = nearest(x * dpr, y * dpr);
      if (p !== hovered) { hovered = p; draw(); }
      showTip(p, x, y);
      st.style.cursor = p ? 'pointer' : '';
    });
    const end = (e) => {
      if (drag && !drag.moved) {
        const [x, y] = local(e);
        const p = nearest(x * dpr, y * dpr);
        if (p) { selected = p; renderDetail(p); draw(); }
      }
      drag = null; st.classList.remove('dragging');
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', () => { drag = null; st.classList.remove('dragging'); });
    st.addEventListener('pointerleave', () => { if (!drag) { hovered = null; showTip(null); draw(); } });
    st.addEventListener('dblclick', (e) => { const [x, y] = local(e); zoomAt(2, x * dpr, y * dpr); });

    document.querySelector('.map-ctrl').addEventListener('click', (e) => {
      const b = e.target.closest('[data-zoom]');
      if (!b) return;
      if (b.dataset.zoom === 'in') zoomAt(1.5);
      else if (b.dataset.zoom === 'out') zoomAt(1 / 1.5);
      else { fit(); draw(); }
    });

    els.side.addEventListener('click', (e) => {
      const z = e.target.closest('[data-zone]');
      if (z) { const [, x, y] = ZONES[Number(z.dataset.zone)]; focus(x, y, 0.35); return; }
      if (e.target.closest('[data-back]')) { selected = null; renderZones(); draw(); return; }
      const im = e.target.closest('img[data-full]');
      if (im) openLightbox(im.dataset.full, im.alt);
    });

    new ResizeObserver(() => resize()).observe(st);
  }

  function resize() {
    if (!els) return;
    const r = els.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const first = !W;
    W = els.canvas.width = Math.round(r.width * dpr);
    H = els.canvas.height = Math.round(r.height * dpr);
    if (first) fit();
    draw();
  }

  /* ------------------------------- panneaux -------------------------------- */
  function zoneOf(p) {
    let best = 0, bd = Infinity;
    ZONES.forEach(([, x, y], i) => { const d = (x - p.x) ** 2 + (y - p.y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  function renderZones() {
    els.sideTitle.textContent = 'Zones les plus mortelles';
    const counts = new Map();
    for (const p of points) { const z = zoneOf(p); counts.set(z, (counts.get(z) || 0) + 1); }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = rows[0]?.[1] || 1;
    els.side.innerHTML = rows.length
      ? rows.map(([z, n]) => `<div class="zone-row" data-zone="${z}"><div style="flex:1;min-width:0"><b>${esc(ZONES[z][0])}</b><div class="rank-bar" style="margin-top:6px"><i style="width:${Math.round(n / max * 100)}%"></i></div></div><span class="zone-n">${fmt.format(n)}</span></div>`).join('')
      : '<div class="empty-block">Aucune mort géolocalisée sur la période.</div>';
  }

  function renderDetail(p) {
    els.sideTitle.textContent = 'Détail de la mort';
    const row = (k, v) => `<div class="dd-row"><span>${k}</span><b>${v}</b></div>`;
    els.side.innerHTML = `<div class="death-detail">
      <button type="button" class="back" data-back style="border:0;background:none;padding:0">${icon('arrow-left', 'sm')}Toutes les zones</button>
      ${p.screenshot_url ? `<img src="${esc(p.screenshot_url)}" data-full="${esc(p.screenshot_url)}" alt="Capture de la mort de ${esc(p.player_name || '')}" loading="lazy">` : ''}
      <div>
        ${row('Victime', playerLink(p.citizenid, p.player_name))}
        ${row('Cause', esc(p.cause || '?'))}
        ${row('Tueur', p.killer_name ? playerLink(p.killer_cid, p.killer_name) : '–')}
        ${row('Arme', p.weapon ? `<span class="code">${esc(p.weapon)}</span>` : '–')}
        ${row('Quand', `${esc(dt(p.ts))} · ${esc(rel(p.ts))}`)}
        ${row('Zone', esc(ZONES[zoneOf(p)][0]))}
        ${row('Position', `<span class="code">${Math.round(p.x)}, ${Math.round(p.y)}${p.z != null ? ', ' + Math.round(p.z) : ''}</span>`)}
      </div></div>`;
  }

  function renderShots() {
    els.shotCount.textContent = shots.length ? shots.length + ' captures' : 'aucune';
    els.shots.innerHTML = shots.length
      ? shots.map((s) => `<button type="button" class="shot" data-src="${esc(s.screenshot_url)}" data-cap="${esc((s.player_name || s.citizenid || '') + ' · ' + (s.cause || '') + ' · ' + dt(s.ts))}">
          <img src="${esc(s.screenshot_url)}" alt="" loading="lazy" onerror="this.closest('.shot').remove()">
          <div class="shot-cap"><b>${esc(s.player_name || s.citizenid || 'Inconnu')}</b><br><span>${esc(s.cause || '?')} · ${esc(rel(s.ts))}</span></div></button>`).join('')
      : '<div class="empty-block">Aucune capture pour le moment. Elles apparaissent quand le script de mort envoie une <span class="code">screenshot_url</span>.</div>';
  }

  /* --------------------------------- init ---------------------------------- */
  function init() {
    els = {
      stage: document.getElementById('mapStage'), canvas: document.getElementById('mapCanvas'), tip: document.getElementById('mapTip'),
      side: document.getElementById('mapSide'), sideTitle: document.getElementById('mapSideTitle'), count: document.getElementById('mapCount'),
      shots: document.getElementById('shots'), shotCount: document.getElementById('shotCount'),
    };
    ctx = els.canvas.getContext('2d');
    bind();
    img = new Image();
    img.onload = () => { imgReady = true; draw(); };
    img.src = IMG_SRC;

    const seg = (id, key, fn) => document.getElementById(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      document.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('active', x === b));
      fn(b.dataset[key]);
    });
    seg('mapRange', 'h', (h) => { hours = Number(h); load(); });
    seg('mapMode', 'mode', (m) => { mode = m; draw(); });
    els.shots.addEventListener('click', (e) => { const s = e.target.closest('.shot'); if (s) openLightbox(s.dataset.src, s.dataset.cap); });
    inited = true;
  }

  async function load(arg) {
    if (!inited) init();
    if (arg) {
      const [x, y] = arg.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) pendingFocus = { x, y };
    }
    const d = await api('deathmap', '?h=' + hours);
    points = (d.points || []).map((p) => ({ ...p, x: Number(p.x), y: Number(p.y), z: p.z == null ? null : Number(p.z) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    shots = d.screenshots || [];
    els.count.textContent = fmt.format(points.length) + ' morts géolocalisées';
    selected = null;
    resize();
    if (pendingFocus) {
      focus(pendingFocus.x, pendingFocus.y, 0.8);
      const near = points.reduce((b, p) => { const dd = (p.x - pendingFocus.x) ** 2 + (p.y - pendingFocus.y) ** 2; return !b || dd < b.d ? { p, d: dd } : b; }, null);
      if (near && near.d < 50 ** 2) { selected = near.p; renderDetail(near.p); } else renderZones();
      pendingFocus = null;
    } else renderZones();
    renderShots();
    draw();
  }

  // Nom de la zone la plus proche (utilisé par la page Performances).
  const zoneName = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? ZONES[zoneOf({ x, y })][0] : '?');

  return { load, redraw: draw, zoneName };
})();
