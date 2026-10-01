/* ══════════════════════════════════════════════════════════════════════════════
   COOL GRADIENT — app: sidebar, state, preview loop, settings files, export
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const S = window.CG_SCHEMA;
  const { Engine, TRANSPARENT_OK } = window.CG_ENGINE;

  const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/+esm';
  const GIFENC_URL = 'https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js';
  const LS_AUTOSAVE = 'cg-autosave';
  const LS_RECENT = 'cg-recent-colors';
  const LS_PRESETS = 'cg-user-presets';

  const $ = id => document.getElementById(id);
  const canvas = $('fx-canvas');
  const canvasArea = $('canvas-area');
  const sbBody = $('sb-body');
  const exportBtn = $('btn-export');
  const exportLbl = $('export-lbl');
  const overlay = $('upload-overlay');

  // ── State ──────────────────────────────────────────────────────────────────
  const app = {
    cfg: S.defaults(),
    name: 'Untitled gradient',
    exp: {
      sizePreset: '1920x1080', width: 1920, height: 1080, lockRatio: true,
      format: 'png', quality: 92, lossless: false, transparent: false, embedSettings: true,
      includeSettings: false, fps: 30, duration: 8, loop: true, bitrate: 'high', scroll: 0,
    },
    assets: {},       // id → data URL (what the settings file embeds)
    images: {},       // id → canvas (what the engine uploads)
    imageNames: {},   // id → original file name
    playing: false,   // preview starts paused
    sec: 4.7,         // the default design's saved preview frame
    activeSlot: 0,
    activePreset: 0,  // the default design is the first gradient preset
    hevc: false,
  };

  let engine = null;

  // ── Small helpers ──────────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    if (kids !== undefined) (Array.isArray(kids) ? kids : [kids]).forEach(c => {
      if (c === null || c === undefined) return;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const slug = s => (s || 'cool-gradient').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cool-gradient';

  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const t = $('cg-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function isoLocal(d) {
    const pad = n => String(Math.abs(Math.trunc(n))).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
  }

  const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  // ── Bindings: every control registers an updater under its key ─────────────
  const binds = {};
  function bind(key, fn) { (binds[key] = binds[key] || []).push(fn); fn(); }
  function syncKey(key) { (binds[key] || []).forEach(fn => fn()); }
  function syncUI() { Object.keys(binds).forEach(syncKey); }

  // ── Control builders (markup matches docs/sidebar-style-guide.md) ──────────
  function section(id, title, opts = {}) {
    const sec = el('div', { class: 'sb-section' + (opts.collapsed ? ' collapsed' : ''), id });
    if (opts.type) sec.dataset.type = opts.type;
    const toggle = el('span', { class: 'sb-section-toggle', text: opts.collapsed ? '+' : '−' });
    const hdr = el('div', { class: 'sb-section-header', 'data-section': id }, [el('span', { class: 'sb-section-title', text: title }), toggle]);
    hdr.addEventListener('click', () => {
      sec.classList.toggle('collapsed');
      toggle.textContent = sec.classList.contains('collapsed') ? '+' : '−';
    });
    const body = el('div', { class: 'sb-section-body' });
    sec.append(hdr, body);
    return { sec, body };
  }

  function decimals(step) { const s = String(step); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

  function sliderRow({ id, label, min, max, step = 1, get, set, fmt, onCommit }) {
    const input = el('input', { type: 'range', id, min, max, step });
    const lbl = el('span', { class: 'sb-ctrl-lbl', text: label });
    const val = el('span', { class: 'sb-val' });
    const row = el('div', { class: 'sb-ctrl' }, [lbl, input, val]);
    const f = fmt || (v => Number(v).toFixed(decimals(step)));
    input.addEventListener('input', () => { set(parseFloat(input.value)); val.textContent = f(get()); });
    input.addEventListener('change', () => { onCommit ? onCommit() : commitSoon(0); });
    const update = () => {
      const v = get();
      if (document.activeElement !== input) input.value = v;
      val.textContent = f(v);
    };
    return { row, update, input };
  }

  function cfgSlider(key, label, idPrefix) {
    const [min, max] = S.range(key);
    const isStop = S.STOP_KEYS.includes(key);
    const r = sliderRow({
      id: `sl-${idPrefix}-${key}`, label, min, max, step: S.step(key),
      fmt: S.ANGLE_KEYS.has(key) ? (v => Math.round(v) + '°') : numFmt(key),
      get: () => app.cfg[key],
      set: v => {
        app.cfg[key] = v;
        if (isStop) pushStops(key);
        changed();
        syncKey(key);
      },
    });
    bind(key, r.update);
    return r.row;
  }

  const numFmt = key => S.step(key) < 1 ? (v => Number(v).toFixed(1)) : (v => String(Math.round(v)));

  // Stops stay ascending: dragging one past a neighbour pushes the neighbour.
  function pushStops(key) {
    const ks = S.STOP_KEYS, i = ks.indexOf(key), v = app.cfg[key];
    for (let j = i + 1; j < 4; j++) if (app.cfg[ks[j]] < v) app.cfg[ks[j]] = v;
    for (let j = i - 1; j >= 0; j--) if (app.cfg[ks[j]] > v) app.cfg[ks[j]] = v;
    ks.forEach(k => k !== key && syncKey(k));
  }

  function checkRow(label, get, set) {
    const ind = el('span', { class: 'sb-check-indicator' });
    const row = el('div', { class: 'sb-check' }, [ind, el('span', { class: 'sb-check-lbl', text: label })]);
    row.addEventListener('click', () => set(!get()));
    return { row, update: () => { row.classList.toggle('checked', !!get()); ind.textContent = get() ? '[*]' : '[ ]'; } };
  }
  function cfgCheck(key, label) {
    const r = checkRow(label, () => app.cfg[key], v => { app.cfg[key] = v; changed({ visibility: true }); syncKey(key); commitSoon(0); });
    bind(key, r.update);
    return r.row;
  }

  function segRow(label, opts, get, set, extraClass) {
    const group = el('div', { class: 'sb-toggle-group' + (extraClass ? ' ' + extraClass : '') });
    const btns = opts.map(([v, l]) => {
      const b = el('button', { class: 'sb-toggle-btn', 'data-val': v, text: l });
      b.addEventListener('click', () => set(v));
      group.append(b);
      return b;
    });
    const row = el('div', { class: 'sb-toggle-row' }, [el('span', { class: 'sb-toggle-lbl', text: label }), group]);
    return { row, group, update: () => btns.forEach(b => b.classList.toggle('active', b.dataset.val === String(get()))) };
  }
  function cfgSeg(key, label, opts) {
    const r = segRow(label, opts, () => app.cfg[key], v => { app.cfg[key] = v; changed({ visibility: true }); syncKey(key); commitSoon(0); });
    bind(key, r.update);
    return r.row;
  }

  // ── Build the sidebar ──────────────────────────────────────────────────────
  const typeSections = [];   // { sec, type }
  const typeRows = [];       // { node, types }
  let stopsSection = null;
  const whenGroups = [];     // { sec, when }
  const expOnly = [];        // { node, show: fmt => bool }

  function build() {
    // Art type (hidden while only one type is enabled)
    if (S.ENABLED_TYPES.length > 1) {
      const { sec, body } = section('sec-type', 'Art type');
      sec.style.marginTop = '8px';
      const grid = el('div', { class: 'cg-types' });
      S.TYPES.filter(t => S.ENABLED_TYPES.includes(t.id)).forEach(t => {
        const b = el('button', { class: 'sb-btn', text: t.label });
        b.addEventListener('click', () => {
          if (app.cfg.type === t.id) return;
          app.cfg.type = t.id;
          app.activePreset = -1;
          changed({ visibility: true });
          syncKey('type');
          buildDots();
          commitSoon(0);
        });
        bind('type', () => b.classList.toggle('active', app.cfg.type === t.id));
        grid.append(b);
      });
      body.append(grid);
      sbBody.append(sec);
    }

    // Variation: presets, seed, undo
    {
      const { sec, body } = section('sec-variation', 'Variation');
      if (S.ENABLED_TYPES.length === 1) sec.style.marginTop = '8px';
      body.append(el('div', { class: 'cg-dots', id: 'cg-dots' }));

      const seedLbl = el('span', { class: 'sb-ctrl-lbl', text: 'Seed' });
      const seedIn = el('input', { class: 'sb-input', type: 'number', min: 0, max: 999999, step: 1 });
      const minus = el('button', { class: 'sb-btn', text: '−' });
      const plus = el('button', { class: 'sb-btn', text: '+' });
      const seedRow = el('div', { class: 'cg-seed' }, [seedLbl, minus, seedIn, plus]);
      const setSeed = v => { app.cfg.seed = clamp(Math.round(v) || 0, 0, 999999); changed(); syncKey('seed'); commitSoon(0); };
      minus.addEventListener('click', () => setSeed(app.cfg.seed - 1));
      plus.addEventListener('click', () => setSeed(app.cfg.seed + 1));
      seedIn.addEventListener('change', () => setSeed(parseFloat(seedIn.value)));
      bind('seed', () => { if (document.activeElement !== seedIn) seedIn.value = app.cfg.seed; });
      body.append(seedRow);

      const grid = el('div', { class: 'sb-btn-grid' });
      [['Undo', undo], ['Redo', redo]].forEach(([l, fn]) => {
        const b = el('button', { class: 'sb-btn', text: l });
        b.addEventListener('click', fn);
        grid.append(b);
      });
      body.append(grid);
      sbBody.append(sec);
    }

    // Type settings flagged `top` (e.g. Gradient mode, Linear / Radial) sit
    // right under Variation; then colors and stops; then the rest.
    buildTypeGroups(g => g.top);

    // Colors
    {
      const { sec, body } = section('sec-colors', 'Colors');
      S.COLOR_KEYS.forEach((key, i) => body.append(colorRow(key, i)));
      body.append(cfgCheck('invertColors', 'Invert colors'));
      body.append(el('div', { class: 'cg-recents', id: 'cg-recents' }));
      body.append(el('div', { class: 'cg-hint', text: 'Type hex, rgb() or hsl(). Recent colors apply to the highlighted slot.' }));
      sbBody.append(sec);
      renderRecents();
    }

    // Color stops: one slider with four handles, for types that use stops
    {
      const { sec, body } = section('sec-stops', 'Color stops');
      stopsSection = sec;
      body.append(stopsSlider());
      sbBody.append(sec);
    }

    buildTypeGroups(g => !g.top);

    // Texture
    {
      const { sec, body } = section('sec-texture', 'Texture');
      body.append(cfgSliderPlain('noiseIntensity', 'Grain'));
      body.append(cfgSliderPlain('noiseScale', 'Grain size'));
      body.append(cfgSliderPlain('alpha', 'Opacity'));
      sbBody.append(sec);
    }

    // Playback
    {
      const { sec, body } = section('sec-playback', 'Motion', { collapsed: true });
      const playBtn = el('button', { class: 'sb-btn', id: 'cg-play' });
      const timeLbl = el('span', { class: 'cg-time', id: 'cg-time' });
      playBtn.addEventListener('click', togglePlay);
      body.append(el('div', { class: 'cg-play' }, [playBtn, timeLbl]));
      bind('playing', () => { playBtn.textContent = app.playing ? '❚❚ Pause' : '▶ Play'; });

      const time = sliderRow({
        id: 'sl-time', label: 'Time', min: 0, max: app.exp.duration, step: 0.01,
        get: () => app.sec % app.exp.duration,
        set: v => { app.sec = v; if (app.playing) { app.playing = false; syncKey('playing'); } requestRender(); },
        fmt: v => v.toFixed(2) + 's',
        onCommit: () => {},
      });
      bind('time', () => { time.input.max = app.exp.duration; time.update(); });
      body.append(time.row);
      body.append(cfgSliderPlain('speed', 'Speed'));
      body.append(typeOnly(cfgSliderPlain('distortionMorphSpeed', 'Morph speed'), ['gradient']));
      body.append(expCheck('loop', 'Seamless loop'));
      body.append(expDurationSlider('sl-duration'));
      body.append(el('div', { class: 'cg-hint', id: 'cg-snap' }));
      body.append(el('div', { class: 'cg-hint', text: 'Space plays / pauses.' }));
      sbBody.append(sec);
    }

    // Settings files, share link, user presets
    {
      const { sec, body } = section('sec-settings', 'Settings & presets', { collapsed: true });
      const nameIn = el('input', { class: 'sb-input', type: 'text', placeholder: 'Design name' });
      nameIn.addEventListener('input', () => { app.name = nameIn.value; scheduleAutosave(); });
      bind('name', () => { if (document.activeElement !== nameIn) nameIn.value = app.name; });
      body.append(el('div', { class: 'sb-input-row' }, [el('div', { class: 'sb-input-lbl', text: 'Name' }), nameIn]));
      const grid = el('div', { class: 'sb-btn-grid' });
      [['Download settings', downloadSettings], ['Upload settings', () => $('settings-input').click()],
       ['Copy share link', copyShareLink], ['Save as preset', saveUserPreset]].forEach(([l, fn]) => {
        const b = el('button', { class: 'sb-btn', text: l });
        b.addEventListener('click', fn);
        grid.append(b);
      });
      body.append(grid);
      body.append(el('div', { class: 'cg-presets', id: 'cg-presets' }));
      body.append(el('div', { class: 'cg-hint', text: 'cmd + S downloads settings · cmd + O or drop a file on the preview to load one.' }));
      sbBody.append(sec);
      renderUserPresets();
    }

    // Export
    {
      const { sec, body } = section('sec-export', 'Export');
      const fmtOpts = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']];
      const vidOpts = [['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF']];
      if (app.hevc) vidOpts.push(['hevc', 'HEVC']);
      const setFmt = v => { app.exp.format = v; syncKey('exp:format'); updateVisibility(); updateExportLabel(); scheduleAutosave(); };
      const img = segRow('Image', fmtOpts, () => app.exp.format, setFmt);
      const vid = segRow('Video', vidOpts, () => app.exp.format, setFmt, 'wrap');
      bind('exp:format', img.update);
      bind('exp:format', vid.update);
      body.append(img.row, vid.row);

      // size preset
      const sel = el('select', { class: 'sb-input' });
      [['preview', 'Current preview aspect (2×)'], ['1920x1080', 'Desktop hero 16:9 · 1920×1080'],
       ['3840x2160', '4K 16:9 · 3840×2160'], ['1080x1080', 'Square · 1080×1080'],
       ['1080x1920', 'Portrait / story 9:16 · 1080×1920'], ['custom', 'Custom']].forEach(([v, l]) => sel.append(el('option', { value: v, text: l })));
      sel.addEventListener('change', () => { app.exp.sizePreset = sel.value; refreshDims(); updateVisibility(); scheduleAutosave(); });
      bind('exp:sizePreset', () => { sel.value = app.exp.sizePreset; });
      body.append(el('div', { class: 'sb-input-row' }, [el('div', { class: 'sb-input-lbl', text: 'Size' }), sel]));

      const wIn = el('input', { class: 'sb-input', type: 'number', min: 16, max: 16384 });
      const hIn = el('input', { class: 'sb-input', type: 'number', min: 16, max: 16384 });
      const lock = checkRow('Lock ratio', () => app.exp.lockRatio, v => { app.exp.lockRatio = v; lock.update(); });
      bind('exp:lockRatio', lock.update);
      const onDim = which => {
        const e = app.exp, ratio = e.width / e.height;
        const w = clamp(Math.round(parseFloat(wIn.value)) || e.width, 16, 16384);
        const h = clamp(Math.round(parseFloat(hIn.value)) || e.height, 16, 16384);
        if (which === 'w') { e.width = w; if (e.lockRatio) e.height = clamp(Math.round(w / ratio), 16, 16384); }
        else { e.height = h; if (e.lockRatio) e.width = clamp(Math.round(h * ratio), 16, 16384); }
        syncKey('exp:dims');
        scheduleAutosave();
      };
      wIn.addEventListener('change', () => onDim('w'));
      hIn.addEventListener('change', () => onDim('h'));
      bind('exp:dims', () => { wIn.value = app.exp.width; hIn.value = app.exp.height; });
      const dims = el('div', { class: 'cg-size-inputs' }, [wIn, el('span', { text: '×' }), hIn]);
      body.append(dims);
      body.append(lock.row);
      expOnly.push({ node: dims, show: () => app.exp.sizePreset === 'custom' });
      expOnly.push({ node: lock.row, show: () => app.exp.sizePreset === 'custom' });

      const q = sliderRow({
        id: 'sl-quality', label: 'Quality', min: 60, max: 100, step: 1,
        get: () => app.exp.quality, set: v => { app.exp.quality = v; scheduleAutosave(); }, onCommit: () => {},
      });
      bind('exp:quality', q.update);
      body.append(q.row);
      expOnly.push({ node: q.row, show: f => f === 'jpg' || (f === 'webp' && !app.exp.lossless) });

      const lossless = expCheck('lossless', 'Lossless', () => updateVisibility());
      body.append(lossless);
      expOnly.push({ node: lossless, show: f => f === 'webp' });

      const transp = expCheck('transparent', 'Transparent background');
      body.append(transp);
      expOnly.push({ node: transp, show: f => f === 'png' || f === 'webm' });

      const embed = expCheck('embedSettings', 'Embed settings in PNG');
      body.append(embed);
      expOnly.push({ node: embed, show: f => f === 'png' });

      const fps = segRow('Frame rate', [['24', '24'], ['30', '30'], ['60', '60']], () => String(app.exp.fps),
        v => { app.exp.fps = Number(v); syncKey('exp:fps'); scheduleAutosave(); });
      bind('exp:fps', fps.update);
      body.append(fps.row);
      expOnly.push({ node: fps.row, show: isVideo });

      const br = segRow('Quality', [['low', 'Low'], ['medium', 'Med'], ['high', 'High'], ['max', 'Max']], () => app.exp.bitrate,
        v => { app.exp.bitrate = v; syncKey('exp:bitrate'); scheduleAutosave(); });
      bind('exp:bitrate', br.update);
      body.append(br.row);
      expOnly.push({ node: br.row, show: f => isVideo(f) && f !== 'gif' });

      const dur = expDurationSlider('sl-duration-exp');
      body.append(dur);
      expOnly.push({ node: dur, show: isVideo });

      body.append(expCheck('includeSettings', 'Include settings file'));
      body.append(el('div', { class: 'cg-hint', id: 'cg-export-hint' }));
      sbBody.append(sec);
    }
  }

  function buildTypeGroups(pick) {
    S.TYPES.filter(t => S.ENABLED_TYPES.includes(t.id)).forEach(t => {
      S.GROUPS[t.id].forEach((g, gi) => {
        if (!pick(g)) return;
        const { sec, body } = section(`sec-${t.id}-${gi}`, g.title, { type: t.id });
        typeSections.push({ sec, type: t.id });
        if (g.when) whenGroups.push({ sec, when: g.when });
        g.controls.forEach(c => {
          if (Array.isArray(c)) body.append(cfgSlider(c[0], c[1], t.id));
          else if (c.t === 'check') body.append(cfgCheck(c.k, c.l));
          else if (c.t === 'seg') body.append(cfgSeg(c.k, c.l, c.opts));
          else if (c.t === 'stops') body.append(stopsSlider());
          else if (c.t === 'upload') body.append(imageUploadRow());
        });
        sbBody.append(sec);
      });
    });
  }

  // Four ascending color stops on one track. The track previews the ramp;
  // each handle wears the color it places. Dragging past a neighbour pushes it.
  function stopsSlider() {
    const track = el('div', { class: 'cg-stops-track' });
    const thumbs = S.STOP_KEYS.map((k, i) => el('div', {
      class: 'cg-stops-thumb', tabindex: 0, role: 'slider', 'aria-label': `Stop ${i + 1}`,
      'aria-valuemin': 0, 'aria-valuemax': 100,
    }));
    const wrap = el('div', { class: 'cg-stops' }, [track, ...thumbs]);
    const vals = el('span', { class: 'sb-val cg-stops-vals' });
    const row = el('div', { class: 'cg-stops-row' }, [wrap, vals]);

    const setStop = (i, v) => {
      const key = S.STOP_KEYS[i];
      v = clamp(Math.round(v), 0, 100);
      if (app.cfg[key] === v) return;
      app.cfg[key] = v;
      pushStops(key);
      changed();
      syncKey(key);
    };
    const valueAt = x => { const r = wrap.getBoundingClientRect(); return r.width ? (x - r.left) / r.width * 100 : 0; };
    // nearest handle; on a tie, the one that can move toward the pointer
    const pick = v => {
      let best = 0, bd = Infinity;
      S.STOP_KEYS.forEach((k, i) => {
        const d = Math.abs(app.cfg[k] - v);
        if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && v > app.cfg[k])) { bd = d; best = i; }
      });
      return best;
    };
    wrap.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { wrap.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const i = pick(valueAt(e.clientX));
      thumbs[i].focus();
      setStop(i, valueAt(e.clientX));
      const move = ev => setStop(i, valueAt(ev.clientX));
      const up = () => {
        wrap.removeEventListener('pointermove', move);
        wrap.removeEventListener('pointerup', up);
        wrap.removeEventListener('pointercancel', up);
        commitSoon(0);
      };
      wrap.addEventListener('pointermove', move);
      wrap.addEventListener('pointerup', up);
      wrap.addEventListener('pointercancel', up);
    });
    thumbs.forEach((t, i) => t.addEventListener('keydown', e => {
      const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
      if (!d) return;
      e.preventDefault();
      setStop(i, app.cfg[S.STOP_KEYS[i]] + d);
      commitSoon();
    }));

    const update = () => {
      let slots = S.COLOR_KEYS.map(k => app.cfg[k].hex);
      if (app.cfg.invertColors) slots = slots.slice().reverse();
      const st = S.STOP_KEYS.map(k => app.cfg[k]);
      track.style.background = `linear-gradient(to right in oklab, ${slots.map((c, i) => `${c} ${st[i]}%`).join(', ')})`;
      thumbs.forEach((t, i) => {
        t.style.left = st[i] + '%';
        t.style.background = slots[i];
        t.setAttribute('aria-valuenow', st[i]);
      });
      vals.textContent = st.join(' · ');
    };
    [...S.STOP_KEYS, ...S.COLOR_KEYS, 'invertColors'].forEach(k => bind(k, update));
    return row;
  }

  function typeOnly(node, types) { typeRows.push({ node, types }); return node; }

  function cfgSliderPlain(key, label) {
    const [min, max] = S.range(key);
    const r = sliderRow({
      id: `sl-${key}`, label, min, max, step: S.step(key),
      fmt: numFmt(key),
      get: () => app.cfg[key],
      set: v => { app.cfg[key] = v; changed(); syncKey(key); },
    });
    bind(key, r.update);
    return r.row;
  }

  function expCheck(key, label, after) {
    const r = checkRow(label, () => app.exp[key], v => {
      app.exp[key] = v;
      syncKey('exp:' + key);
      if (key === 'loop') { requestRender(); }
      if (after) after();
      scheduleAutosave();
    });
    bind('exp:' + key, r.update);
    return r.row;
  }

  function expDurationSlider(id) {
    const r = sliderRow({
      id, label: 'Loop length', min: 2, max: 60, step: 1,
      get: () => app.exp.duration,
      set: v => { app.exp.duration = v; syncKey('exp:duration'); syncKey('time'); requestRender(); scheduleAutosave(); },
      fmt: v => v + 's', onCommit: () => {},
    });
    bind('exp:duration', r.update);
    return r.row;
  }

  const isVideo = f => ['mp4', 'webm', 'gif', 'hevc'].includes(f);

  function updateVisibility() {
    const type = app.cfg.type;
    typeSections.forEach(({ sec, type: t }) => { sec.hidden = t !== type; });
    whenGroups.forEach(({ sec, when }) => { if (!sec.hidden) sec.hidden = !when(app.cfg); });
    if (stopsSection) stopsSection.hidden = !S.usesStops(type);
    typeRows.forEach(({ node, types }) => { node.hidden = !types.includes(type); });
    const f = app.exp.format;
    expOnly.forEach(({ node, show }) => { node.hidden = !show(f); });
    updateExportHint();
    if (window.CAMLA_MOBILE_REFRESH) window.CAMLA_MOBILE_REFRESH();
  }

  function refreshDims() {
    const e = app.exp;
    if (e.sizePreset === 'preview') {
      e.width = Math.round(canvasArea.clientWidth * 2);
      e.height = Math.round(canvasArea.clientHeight * 2);
    } else if (e.sizePreset !== 'custom') {
      [e.width, e.height] = e.sizePreset.split('x').map(Number);
    }
    syncKey('exp:dims');
  }

  const FORMAT_LABEL = { png: 'PNG', jpg: 'JPG', webp: 'WebP', mp4: 'MP4', webm: 'WebM', gif: 'GIF', hevc: 'MP4 (HEVC)' };
  function updateExportLabel() { if (!exporting) exportLbl.textContent = 'Export ' + FORMAT_LABEL[app.exp.format]; }

  function updateExportHint() {
    const h = $('cg-export-hint');
    if (!h) return;
    const f = app.exp.format;
    const notes = [];
    if (!isVideo(f)) notes.push(`Still frame at the current preview time (${(app.sec % app.exp.duration).toFixed(2)}s). Scrub Time under Motion to pick another.`);
    if (f === 'gif') notes.push('GIF is capped at 800px wide and 15 fps.');
    if (isVideo(f) && f !== 'gif') notes.push(app.exp.loop ? 'Seamless loop is on: the last frame flows into the first.' : 'Seamless loop is off (Motion section).');
    if ((f === 'png' || f === 'webm') && app.exp.transparent && !TRANSPARENT_OK.has(app.cfg.type))
      notes.push(`${S.TYPES.find(t => t.id === app.cfg.type).label} fills the whole frame, so it exports opaque.`);
    if (isVideo(f) && !('VideoEncoder' in window) && f !== 'gif')
      notes.push('This browser has no WebCodecs: video records in real time and may drop frames.');
    h.textContent = notes.join(' ');
  }

  // ── Colors ─────────────────────────────────────────────────────────────────
  const parseCtx = document.createElement('canvas').getContext('2d');
  function parseColor(str) {
    let s = String(str || '').trim();
    if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) s = '#' + s;
    if (!s || !CSS.supports('color', s)) return null;
    parseCtx.fillStyle = '#000000';
    parseCtx.fillStyle = s;
    const v = parseCtx.fillStyle;
    if (v.startsWith('#')) return { hex: v.toUpperCase() };
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    const hex = '#' + p.slice(0, 3).map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    return { hex, alpha: p.length > 3 ? clamp(p[3], 0, 1) : undefined };
  }

  function colorRow(key, i) {
    const ci = el('input', { type: 'color' });
    const sw = el('div', { class: 'swatch' }, ci);
    const lbl = el('span', { class: 'sb-color-lbl', text: `Color ${i + 1}` });
    const hex = el('input', { class: 'sb-input cg-hex', type: 'text', spellcheck: 'false' });
    const alpha = el('input', { class: 'sb-input cg-alpha', type: 'number', min: 0, max: 100, step: 1, title: 'Opacity %' });
    const kids = [lbl, sw, hex, alpha, el('span', { class: 'cg-pct', text: '%' })];
    if ('EyeDropper' in window) {
      const eye = el('button', { class: 'cg-eye', title: 'Pick from screen' }, el('i', { 'data-lucide': 'pipette' }));
      eye.addEventListener('click', async () => {
        try { const r = await new window.EyeDropper().open(); setColor(i, { hex: r.sRGBHex }, true); } catch { /* cancelled */ }
      });
      kids.push(eye);
    }
    const row = el('div', { class: 'cg-color-row' }, kids);
    const focus = () => { app.activeSlot = i; syncKey('activeSlot'); };
    lbl.addEventListener('click', focus);
    [ci, hex, alpha].forEach(n => n.addEventListener('focus', focus));
    ci.addEventListener('input', () => setColor(i, { hex: ci.value }, false));
    ci.addEventListener('change', () => setColor(i, { hex: ci.value }, true));
    hex.addEventListener('change', () => {
      const c = parseColor(hex.value);
      if (c) setColor(i, c, true); else { toast(`"${hex.value}" isn't a color`); syncKey(key); }
    });
    alpha.addEventListener('input', () => {
      const v = parseFloat(alpha.value);
      if (!isFinite(v)) return;
      app.cfg[key] = { ...app.cfg[key], alpha: clamp(v, 0, 100) / 100 };
      changed();
      sw.style.opacity = app.cfg[key].alpha;
    });
    alpha.addEventListener('change', () => { syncKey(key); commitSoon(0); });
    bind(key, () => {
      const c = app.cfg[key];
      sw.style.background = c.hex;
      sw.style.opacity = Math.max(0.25, c.alpha);
      ci.value = c.hex.toLowerCase();
      if (document.activeElement !== hex) hex.value = c.hex;
      if (document.activeElement !== alpha) alpha.value = Math.round(c.alpha * 100);
    });
    bind('activeSlot', () => row.classList.toggle('active', app.activeSlot === i));
    return row;
  }

  function setColor(i, c, commit) {
    const key = S.COLOR_KEYS[i];
    app.cfg[key] = { hex: S.normHex(c.hex), alpha: c.alpha !== undefined ? c.alpha : app.cfg[key].alpha };
    changed();
    syncKey(key);
    if (commit) { addRecent(app.cfg[key].hex); commitSoon(0); }
  }

  function addRecent(hex) {
    const list = lsGet(LS_RECENT, []).filter(h => h !== hex);
    list.unshift(hex);
    lsSet(LS_RECENT, list.slice(0, 12));
    renderRecents();
  }
  function renderRecents() {
    const box = $('cg-recents');
    if (!box) return;
    box.replaceChildren(...lsGet(LS_RECENT, []).map(h => {
      const b = el('button', { class: 'cg-recent', title: h });
      b.style.background = h;
      b.addEventListener('click', () => setColor(app.activeSlot, { hex: h }, true));
      return b;
    }));
  }

  // ── Image scatter upload ───────────────────────────────────────────────────
  function imageUploadRow() {
    const name = el('div', { class: 'sb-upload-name', text: 'Upload image' });
    const hint = el('div', { class: 'sb-upload-hint', text: '.png or .svg · default: sparkle' });
    const row = el('div', { class: 'sb-upload' }, [el('div', null, [name, hint]), el('span', { class: 'sb-upload-kbd', text: 'png / svg' })]);
    row.addEventListener('click', () => $('image-input').click());
    bind('imageAssetId', () => {
      const id = app.cfg.imageAssetId;
      hint.textContent = id && app.images[id] ? (app.imageNames[id] || id) : '.png or .svg · default: sparkle';
    });
    return row;
  }

  // Rasterize to ≤1024px so SVGs without intrinsic size and huge photos both work.
  function rasterize(img) {
    let w = img.naturalWidth || 512, h = img.naturalHeight || 512;
    const k = Math.min(1, 1024 / Math.max(w, h));
    w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
    const c = el('canvas', { width: w, height: h });
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }
  function loadImageURL(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(rasterize(img));
      img.onerror = () => rej(new Error('Could not decode image'));
      img.src = url;
    });
  }
  const readDataURL = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  async function setScatterImage(file) {
    const url = await readDataURL(file);
    const img = await loadImageURL(url);
    const id = 'img_' + Date.now().toString(36);
    app.assets = { [id]: url };      // one image per design
    app.images = { [id]: img };
    app.imageNames = { [id]: file.name };
    app.cfg.imageAssetId = id;
    const switched = app.cfg.type !== 'images';
    app.cfg.type = 'images';
    changed({ visibility: true });
    syncUI();
    if (switched) buildDots();
    commitSoon(0);
    toast(`Image loaded into Image scatter: ${file.name}`);
  }

  // ── Presets ─────────────────────────────────────────────────────────
  function buildDots() {
    const box = $('cg-dots');
    const list = S.PRESETS[app.cfg.type] || [];
    box.replaceChildren(...list.map((p, i) => {
      const c = [1, 2, 3, 4].map(k => (p.cfg['color' + k] || S.DEFAULTS['color' + k]).hex);
      const b = el('button', { class: 'cg-dot' + (i === app.activePreset ? ' active' : ''), title: p.name });
      b.style.background = `conic-gradient(${c[0]} 0 25%, ${c[1]} 0 50%, ${c[2]} 0 75%, ${c[3]} 0)`;
      b.addEventListener('click', () => applyPreset(app.cfg.type, p.cfg, i));
      return b;
    }));
  }

  function applyPreset(type, cfg, idx) {
    app.cfg = S.presetConfig(app.cfg, type, cfg);
    app.activePreset = idx === undefined ? -1 : idx;
    changed({ visibility: true, keepPreset: true });
    syncUI();
    buildDots();
    commitSoon(0);
  }

  // ── Change pipeline: preview, history, autosave ────────────────────────────
  function changed(opts = {}) {
    if (engine) engine.setConfig(app.cfg, app.images);
    if (!opts.keepPreset && app.activePreset !== -1) {
      app.activePreset = -1;
      document.querySelectorAll('.cg-dot.active').forEach(d => d.classList.remove('active'));
    }
    if (opts.visibility) updateVisibility();
    requestRender();
    commitSoon();
    scheduleAutosave();
  }

  const hist = { stack: [], idx: -1, timer: 0 };
  function pushHistory() {
    const snap = JSON.stringify(app.cfg);
    if (hist.stack[hist.idx] === snap) return;
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(snap);
    if (hist.stack.length > 100) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
  }
  function commitSoon(ms = 400) {
    clearTimeout(hist.timer);
    hist.timer = setTimeout(() => { hist.timer = 0; pushHistory(); }, ms);
  }
  function flushHistory() {
    if (hist.timer) { clearTimeout(hist.timer); hist.timer = 0; pushHistory(); }
  }
  function restore(snap) {
    app.cfg = JSON.parse(snap);
    app.activePreset = -1;
    if (engine) engine.setConfig(app.cfg, app.images);
    syncUI();
    updateVisibility();
    buildDots();
    requestRender();
    scheduleAutosave();
  }
  function undo() {
    flushHistory();
    if (hist.idx > 0) { hist.idx--; restore(hist.stack[hist.idx]); } else toast('Nothing to undo');
  }
  function redo() {
    flushHistory();
    if (hist.idx < hist.stack.length - 1) { hist.idx++; restore(hist.stack[hist.idx]); } else toast('Nothing to redo');
  }

  let autosaveTimer = 0;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const s = buildSettings();
      if (!lsSet(LS_AUTOSAVE, s)) { s.assets = {}; lsSet(LS_AUTOSAVE, s); }
    }, 800);
  }

  // ── Preview loop ───────────────────────────────────────────────────────────
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let raf = 0, lastTs = 0, frameNo = 0, slowFrames = 0;
  let pageVisible = !document.hidden, onScreen = true, contextLost = false;

  function syncSize() {
    const w = Math.max(1, Math.round(canvasArea.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvasArea.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (app.exp.sizePreset === 'preview') refreshDims();
    requestRender();
  }

  const isAnimating = () => app.playing && app.cfg.speed > 0 && pageVisible && onScreen && !contextLost;

  function requestRender() { if (!raf) raf = requestAnimationFrame(tick); }

  function tick(ts) {
    raf = 0;
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    const anim = isAnimating();
    if (anim) {
      app.sec += dt;
      if (app.exp.loop) app.sec %= app.exp.duration;
      frameNo++;
      // drop to 1× pixel ratio if frames keep taking over 20 ms
      slowFrames = dt > 0.021 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 45 && dpr > 1) { dpr = 1; slowFrames = 0; syncSize(); }
    }
    draw();
    if (anim) raf = requestAnimationFrame(tick); else lastTs = 0;
  }

  let lastSnapText = null;
  function draw() {
    if (!engine || contextLost) return;
    try {
      engine.render({
        sec: app.sec, W: canvas.width, H: canvas.height,
        loop: app.exp.loop, T: app.exp.duration, frame: frameNo,
        transparent: false, scroll: 0,
      });
    } catch (e) {
      console.error(e);
      showError(e.message);
      engine = null;
      return;
    }
    $('cg-time').textContent = `${(app.sec % app.exp.duration).toFixed(2)}s / ${app.exp.duration}s`;
    syncKey('time');
    const snap = engine.snapInfo.map(s => `${s.label} ×${s.ratio.toFixed(2)}`).join(', ');
    const txt = snap ? `Loop adjusts speed: ${snap}` : '';
    if (txt !== lastSnapText) { $('cg-snap').textContent = txt; $('cg-snap').hidden = !txt; lastSnapText = txt; }
    if (!isVideo(app.exp.format) && !app.playing) updateExportHint();
  }

  function togglePlay() {
    app.playing = !app.playing;
    syncKey('playing');
    requestRender();
  }

  function showError(msg) {
    let e = $('cg-error');
    if (!e) { e = el('div', { id: 'cg-error' }); canvasArea.append(e); }
    e.textContent = msg;
  }

  // ── Settings file ──────────────────────────────────────────────────────────
  function buildSettings() {
    const cfg = JSON.parse(JSON.stringify(app.cfg));
    const assets = {};
    if (cfg.imageAssetId && app.assets[cfg.imageAssetId]) assets[cfg.imageAssetId] = app.assets[cfg.imageAssetId];
    else delete cfg.imageAssetId;
    const e = app.exp;
    return {
      format: S.FORMAT,
      version: S.VERSION,
      name: app.name,
      createdAt: isoLocal(new Date()),
      config: cfg,
      export: {
        width: e.width, height: e.height, format: e.format, fps: e.fps, duration: e.duration, loop: e.loop,
        time: +app.sec.toFixed(3), sizePreset: e.sizePreset, quality: e.quality, lossless: e.lossless,
        transparent: e.transparent, bitrate: e.bitrate, scroll: e.scroll,
      },
      assets,
    };
  }

  function downloadSettings() {
    const json = JSON.stringify(buildSettings(), null, 2);
    download(new Blob([json], { type: 'application/json' }), `${slug(app.name)}.bgart.json`);
  }

  function applyExport(src, notes) {
    if (!src || typeof src !== 'object') return;
    const e = app.exp;
    const num = (k, lo, hi) => {
      if (src[k] === undefined) return;
      const n = Number(src[k]);
      if (!isFinite(n)) return;
      const c = clamp(n, lo, hi);
      if (c !== n) notes.push(`export ${k} clamped to ${c}`);
      e[k] = c;
    };
    num('width', 16, 16384); num('height', 16, 16384); num('duration', 2, 60); num('quality', 60, 100); num('scroll', -1000, 1000);
    if ([24, 30, 60].includes(Number(src.fps))) e.fps = Number(src.fps);
    if (FORMAT_LABEL[src.format] && (src.format !== 'hevc' || app.hevc)) e.format = src.format;
    if (['preview', '1920x1080', '3840x2160', '1080x1080', '1080x1920', 'custom'].includes(src.sizePreset)) e.sizePreset = src.sizePreset;
    else if (src.width && src.height) e.sizePreset = 'custom';
    ['loop', 'lossless', 'transparent'].forEach(k => { if (typeof src[k] === 'boolean') e[k] = src[k]; });
    if (['low', 'medium', 'high', 'max'].includes(src.bitrate)) e.bitrate = src.bitrate;
    if (isFinite(Number(src.time))) app.sec = clamp(Number(src.time), 0, 3600);
  }

  async function loadSettingsObject(obj, opts = {}) {
    if (!obj || obj.format !== S.FORMAT) throw new Error('Not a Cool Gradient settings file (format should be "bg-art-settings").');
    const file = S.migrate(obj);
    const { cfg, notes } = S.sanitize(file.config);
    if (file.version > S.VERSION) notes.push(`file is version ${file.version}; this tool reads version ${S.VERSION}`);

    const assets = {}, images = {}, names = {};
    for (const [id, url] of Object.entries(file.assets || {})) {
      try { images[id] = await loadImageURL(url); assets[id] = url; names[id] = id; }
      catch { notes.push(`asset ${id} could not be decoded`); }
    }
    if (cfg.imageAssetId && !images[cfg.imageAssetId]) {
      notes.push('the uploaded image isn\'t in this file; using the default sparkle');
      delete cfg.imageAssetId;
    }

    flushHistory();
    app.cfg = cfg;
    app.assets = assets; app.images = images; app.imageNames = names;
    if (typeof file.name === 'string') app.name = file.name;
    applyExport(file.export, notes);
    app.activePreset = -1;
    if (engine) engine.setConfig(app.cfg, app.images, true);
    refreshDims();
    syncUI();
    updateVisibility();
    updateExportLabel();
    buildDots();
    requestRender();
    pushHistory();
    scheduleAutosave();
    if (!opts.silent) toast(notes.length ? `Loaded "${app.name}" with adjustments:\n· ${notes.join('\n· ')}` : `Loaded "${app.name}". Undo to go back.`, notes.length ? 7000 : 3200);
  }

  async function handleFile(file) {
    try {
      const name = file.name.toLowerCase();
      if (file.type === 'image/png' || name.endsWith('.png')) {
        const txt = readPngText(new Uint8Array(await file.arrayBuffer()), 'bgart');
        if (txt) return await loadSettingsObject(JSON.parse(txt));
        if (S.ENABLED_TYPES.includes('images')) return await setScatterImage(file);
        return toast('That PNG has no Cool Gradient settings in it.');
      }
      if (name.endsWith('.json') || file.type === 'application/json')
        return await loadSettingsObject(JSON.parse(await file.text()));
      if (file.type.startsWith('image/') && S.ENABLED_TYPES.includes('images')) return await setScatterImage(file);
      toast('Drop a .bgart.json settings file or an exported PNG.');
    } catch (e) {
      console.error(e);
      toast(e instanceof SyntaxError ? 'That file isn\'t valid JSON.' : e.message);
    }
  }

  // ── PNG tEXt chunk: settings travel inside exported PNGs ───────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function pngWithText(blob, keyword, text) {
    const png = new Uint8Array(await blob.arrayBuffer());
    // tEXt is Latin-1: escape anything outside ASCII (JSON.parse restores it)
    const ascii = text.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    const data = new TextEncoder().encode(keyword + '\0' + ascii);
    const chunk = new Uint8Array(12 + data.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length);
    chunk.set([116, 69, 88, 116], 4); // "tEXt"
    chunk.set(data, 8);
    dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    const at = 8 + 25; // after signature + IHDR
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, at), 0);
    out.set(chunk, at);
    out.set(png.subarray(at), at + chunk.length);
    return new Blob([out], { type: 'image/png' });
  }

  function readPngText(buf, keyword) {
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = 8;
    while (p + 8 <= buf.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      if (type === 'tEXt') {
        const d = buf.subarray(p + 8, p + 8 + len);
        const z = d.indexOf(0);
        if (z > 0 && String.fromCharCode(...d.subarray(0, z)) === keyword) {
          let s = '';
          for (let i = z + 1; i < d.length; i++) s += String.fromCharCode(d[i]);
          return s;
        }
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return null;
  }

  // ── Share link: settings compressed into the URL hash ──────────────────────
  const b64url = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64url = str => {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  };
  async function deflate(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  async function copyShareLink() {
    try {
      const s = buildSettings();
      const hadImage = !!s.config.imageAssetId;
      delete s.config.imageAssetId;
      s.assets = {};
      const url = location.href.split('#')[0] + '#s=' + b64url(await deflate(JSON.stringify(s)));
      await navigator.clipboard.writeText(url);
      toast(hadImage ? 'Share link copied. Uploaded images aren\'t included; share the settings file for those.' : 'Share link copied.');
    } catch (e) {
      toast('Couldn\'t copy the share link: ' + e.message);
    }
  }

  // ── User presets ───────────────────────────────────────────────────────────
  function presetKeys(type) {
    return [...S.typeKeys(type), ...S.COLOR_KEYS, 'seed', 'invertColors'];
  }
  function saveUserPreset() {
    const list = lsGet(LS_PRESETS, []);
    const cfg = {};
    presetKeys(app.cfg.type).forEach(k => { cfg[k] = JSON.parse(JSON.stringify(app.cfg[k])); });
    list.push({ id: Date.now().toString(36), name: app.name || 'Preset', type: app.cfg.type, cfg });
    lsSet(LS_PRESETS, list);
    renderUserPresets();
    toast(`Saved preset "${app.name || 'Preset'}"`);
  }
  function renderUserPresets() {
    const box = $('cg-presets');
    if (!box) return;
    const list = lsGet(LS_PRESETS, []);
    const save = l => { lsSet(LS_PRESETS, l); renderUserPresets(); };
    box.replaceChildren(...list.map((p, i) => {
      if (!S.ENABLED_TYPES.includes(p.type)) return null;
      const typeLabel = (S.TYPES.find(t => t.id === p.type) || {}).label || p.type;
      const nameBtn = el('button', { class: 'sb-btn cg-preset-name', title: `Apply ${p.name}`, text: `${p.name} · ${typeLabel}` });
      nameBtn.addEventListener('click', () => { if (S.GROUPS[p.type]) applyPreset(p.type, p.cfg); });
      const ren = el('button', { class: 'sb-btn', title: 'Rename', text: 'ren' });
      ren.addEventListener('click', () => {
        const input = el('input', { class: 'sb-input', type: 'text', value: p.name });
        nameBtn.replaceWith(input);
        input.focus();
        input.select();
        const done = () => { const l = lsGet(LS_PRESETS, []); if (l[i]) { l[i].name = input.value.trim() || p.name; save(l); } };
        input.addEventListener('blur', done);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderUserPresets(); });
      });
      const dup = el('button', { class: 'sb-btn', title: 'Duplicate', text: 'dup' });
      dup.addEventListener('click', () => { const l = lsGet(LS_PRESETS, []); l.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(p)), id: Date.now().toString(36), name: p.name + ' copy' }); save(l); });
      const del = el('button', { class: 'sb-btn', title: 'Delete', text: 'del' });
      del.addEventListener('click', () => {
        if (del.dataset.armed) { const l = lsGet(LS_PRESETS, []); l.splice(i, 1); save(l); return; }
        del.dataset.armed = '1';
        del.textContent = 'sure?';
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'del'; } }, 2500);
      });
      return el('div', { class: 'cg-preset' }, [nameBtn, ren, dup, del]);
    }).filter(Boolean));
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  let exporting = false, cancelExport = false;

  function exportDims() {
    refreshDims();
    return { w: app.exp.width, h: app.exp.height };
  }

  function frameOpts(extra) {
    return { loop: app.exp.loop, T: app.exp.duration, scroll: 0, ...extra };
  }

  function progress(p, label = 'Encoding') {
    exportLbl.textContent = `${label} ${Math.round(p * 100)}% · click to cancel`;
  }

  async function runExport() {
    if (exporting) { cancelExport = true; return; }
    exporting = true;
    cancelExport = false;
    const f = app.exp.format;
    try {
      if (isVideo(f)) await exportVideo(f); else await exportStill(f);
      if (!cancelExport && app.exp.includeSettings) downloadSettings();
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e.message || e), 6000);
    } finally {
      exporting = false;
      updateExportLabel();
    }
  }

  // Renders offscreen at export size, in tiles when larger than the GPU allows.
  async function exportStill(fmt) {
    const { w, h } = exportDims();
    const transparent = fmt === 'png' && app.exp.transparent;
    exportLbl.textContent = `Rendering ${w}×${h}…`;
    await new Promise(r => setTimeout(r, 30));

    const out = el('canvas', { width: w, height: h });
    const ctx = out.getContext('2d');
    if (fmt === 'jpg') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }

    const probe = el('canvas', { width: 1, height: 1 });
    const eng = new Engine(probe, { preserve: true });
    eng.setConfig(app.cfg, app.images, true);
    const maxT = Math.min(eng.maxSize, 4096);
    const tw = Math.min(w, maxT), th = Math.min(h, maxT);
    const opts = frameOpts({ sec: app.sec, W: w, H: h, frame: frameNo, transparent });
    for (let ty = 0; ty < h; ty += th) {
      for (let tx = 0; tx < w; tx += tw) {
        const cw = Math.min(tw, w - tx), ch = Math.min(th, h - ty);
        probe.width = cw; probe.height = ch;
        eng.render({ ...opts, tile: { x: tx, y: ty, w: cw, h: ch } });
        ctx.drawImage(probe, tx, h - ty - ch);   // tiles are bottom-up in GL
      }
    }
    eng.dispose();

    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
    const q = fmt === 'webp' && app.exp.lossless ? 1 : app.exp.quality / 100;
    let blob = await new Promise(res => out.toBlob(res, mime, fmt === 'png' ? undefined : q));
    if (!blob) throw new Error('The browser could not encode this image (too large?).');
    if (fmt === 'png' && app.exp.embedSettings) blob = await pngWithText(blob, 'bgart', JSON.stringify(buildSettings()));
    download(blob, `${slug(app.name)}.${fmt}`);
  }

  async function exportVideo(fmt) {
    let { w, h } = exportDims();
    let fps = app.exp.fps;
    if (fmt === 'gif') {
      if (w > 800) { h = Math.round(h * 800 / w); w = 800; }
      fps = Math.min(fps, 15);
    }
    const maxV = 4096;
    if (w > maxV || h > maxV) {
      const k = maxV / Math.max(w, h);
      w = Math.round(w * k); h = Math.round(h * k);
      toast(`Video is limited to ${maxV}px; exporting ${w}×${h}.`);
    }
    if (fmt !== 'gif') { w -= w % 2; h -= h % 2; }
    const T = app.exp.duration;
    const n = Math.round(T * fps);
    const transparent = fmt === 'webm' && app.exp.transparent && TRANSPARENT_OK.has(app.cfg.type);

    const c = el('canvas', { width: w, height: h });
    const eng = new Engine(c, { preserve: true });
    eng.setConfig(app.cfg, app.images, true);
    // last frame is T − 1/fps so frame 0 follows it cleanly
    const renderFrame = i => eng.render(frameOpts({ sec: i / fps, W: w, H: h, frame: i, transparent }));

    try {
      if (fmt === 'gif') await encodeGif(eng, c, w, h, n, fps, renderFrame);
      else if (!('VideoEncoder' in window)) await recordRealtime(c, fmt, T, fps, renderFrame);
      else await encodeWebCodecs(c, fmt, w, h, n, fps, transparent, renderFrame);
    } finally {
      eng.dispose();
    }
  }

  async function encodeWebCodecs(c, fmt, w, h, n, fps, transparent, renderFrame) {
    exportLbl.textContent = 'Loading encoder…';
    const MB = await import(MEDIABUNNY_URL);
    const codec = fmt === 'webm' ? 'vp9' : fmt === 'hevc' ? 'hevc' : 'avc';
    if (!(await MB.canEncodeVideo(codec, { width: w, height: h })))
      throw new Error(`This browser can't encode ${codec.toUpperCase()} at ${w}×${h}.`);
    const quality = { low: MB.QUALITY_LOW, medium: MB.QUALITY_MEDIUM, high: MB.QUALITY_HIGH, max: MB.QUALITY_VERY_HIGH }[app.exp.bitrate];
    const output = new MB.Output({
      format: fmt === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat(),
      target: new MB.BufferTarget(),
    });
    const config = { codec, bitrate: quality };
    if (transparent) config.alpha = 'keep';
    const source = new MB.CanvasSource(c, config);
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    for (let i = 0; i < n; i++) {
      if (cancelExport) { await output.cancel(); toast('Export cancelled'); return; }
      renderFrame(i);
      await source.add(i / fps, 1 / fps);
      progress((i + 1) / n);
    }
    exportLbl.textContent = 'Finalizing…';
    await output.finalize();
    const ext = fmt === 'webm' ? 'webm' : 'mp4';
    download(new Blob([output.target.buffer], { type: `video/${ext}` }), `${slug(app.name)}.${ext}`);
  }

  async function encodeGif(eng, c, w, h, n, fps, renderFrame) {
    exportLbl.textContent = 'Loading encoder…';
    const { GIFEncoder, quantize, applyPalette } = await import(GIFENC_URL);
    const gif = GIFEncoder();
    const flat = el('canvas', { width: w, height: h });
    const ctx = flat.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < n; i++) {
      if (cancelExport) { toast('Export cancelled'); return; }
      renderFrame(i);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(c, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay: Math.round(1000 / fps) });
      progress((i + 1) / n);
      await new Promise(r => setTimeout(r, 0));
    }
    gif.finish();
    download(new Blob([gif.bytes()], { type: 'image/gif' }), `${slug(app.name)}.gif`);
  }

  // No WebCodecs: capture the canvas in real time with MediaRecorder.
  async function recordRealtime(c, fmt, T, fps, renderFrame) {
    toast('WebCodecs unavailable: recording in real time, frames may drop.', 5000);
    const types = fmt === 'webm' ? ['video/webm;codecs=vp9', 'video/webm'] : ['video/mp4', 'video/webm'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('No supported recording format in this browser.');
    const rec = new MediaRecorder(c.captureStream(fps), { mimeType, videoBitsPerSecond: { low: 2e6, medium: 5e6, high: 10e6, max: 20e6 }[app.exp.bitrate] });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });
    renderFrame(0);
    rec.start();
    const t0 = performance.now();
    await new Promise(resolve => {
      const step = () => {
        const sec = (performance.now() - t0) / 1000;
        if (cancelExport || sec >= T) return resolve();
        renderFrame(Math.floor(sec * fps));
        progress(sec / T, 'Recording');
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    rec.stop();
    await done;
    if (cancelExport) { toast('Export cancelled'); return; }
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type: mimeType }), `${slug(app.name)}.${ext}`);
  }

  async function detectHevc() {
    if (!('VideoEncoder' in window)) return false;
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: 'hvc1.1.6.L123.B0', width: 1920, height: 1080, bitrate: 8e6, framerate: 30 });
      return !!r.supported;
    } catch { return false; }
  }

  // ── Input: keys, drop ──────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); runExport(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); downloadSettings(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('settings-input').click(); return; }
    if (e.key === ' ' && !typing && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
  });

  exportBtn.addEventListener('click', runExport);

  $('settings-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
  $('image-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) setScatterImage(f).catch(err => toast(err.message));
    e.target.value = '';
  });

  canvasArea.addEventListener('dragover', e => { e.preventDefault(); overlay.classList.remove('hidden'); overlay.classList.add('drag-over'); });
  canvasArea.addEventListener('dragleave', e => { if (e.target === canvasArea || !canvasArea.contains(e.relatedTarget)) overlay.classList.add('hidden'); });
  canvasArea.addEventListener('drop', e => {
    e.preventDefault();
    overlay.classList.add('hidden');
    overlay.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  document.addEventListener('visibilitychange', () => { pageVisible = !document.hidden; requestRender(); });
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; requestRender(); }).observe(canvas);
  new ResizeObserver(syncSize).observe(canvasArea);

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    try { engine.init(); engine.setConfig(app.cfg, app.images, true); } catch (err) { showError(err.message); }
    requestRender();
  });

  // Mobile layer "hold to compare": show the design with its colors inverted.
  window.CAMLA_MOBILE_COMPARE = {
    on() { app.cfg.invertColors = !app.cfg.invertColors; if (engine) engine.setConfig(app.cfg, app.images); requestRender(); },
    off() { app.cfg.invertColors = !app.cfg.invertColors; if (engine) engine.setConfig(app.cfg, app.images); requestRender(); },
  };

  // ── Init ───────────────────────────────────────────────────────────────────
  async function loadInitial() {
    const hash = location.hash;
    if (hash.startsWith('#s=')) {
      try {
        await loadSettingsObject(JSON.parse(await inflate(unb64url(hash.slice(3)))), { silent: true });
        toast(`Loaded shared design "${app.name}"`);
        return;
      } catch (e) {
        console.error(e);
        toast('That share link couldn\'t be read; starting fresh.');
      }
    }
    const saved = lsGet(LS_AUTOSAVE, null);
    if (saved) {
      try { await loadSettingsObject(saved, { silent: true }); return; } catch (e) { console.error(e); }
    }
    pushHistory();
  }

  // Build synchronously so the deferred mobile layer can discover the sliders;
  // HEVC detection only adds a button, so it re-renders the format row after.
  build();
  try {
    engine = new Engine(canvas);
    engine.setConfig(app.cfg, app.images, true);
  } catch (e) {
    showError(e.message + ' The preview needs WebGL2.');
  }
  syncSize();
  syncUI();
  updateVisibility();
  updateExportLabel();
  buildDots();
  lucide.createIcons();
  requestRender();
  loadInitial().then(() => { refreshDims(); syncUI(); updateVisibility(); updateExportLabel(); });
  detectHevc().then(ok => {
    if (!ok) return;
    app.hevc = true;
    const vidGroup = document.querySelector('#sec-export .sb-toggle-group.wrap');
    if (!vidGroup) return;
    const b = el('button', { class: 'sb-toggle-btn', 'data-val': 'hevc', text: 'HEVC' });
    b.addEventListener('click', () => { app.exp.format = 'hevc'; syncKey('exp:format'); updateVisibility(); updateExportLabel(); scheduleAutosave(); });
    bind('exp:format', () => b.classList.toggle('active', app.exp.format === 'hevc'));
    vidGroup.append(b);
  });
})();
