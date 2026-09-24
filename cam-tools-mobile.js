/* ══════════════════════════════════════════════════════════════════════════════
   CAM.TOOLS — MOBILE LAYER (controller)
   Builds a mobile UI on top of any sidebar-app tool without touching the tool's
   own JS. Below 720px: the sidebar becomes a bottom sheet and a DRUM_SCRUB
   relative-drag control drives the tool's existing <input type=range> elements.
   See DRUM_SCRUB.md for the control spec.

   Optional per-tool hook (not required):
     window.CAMLA_MOBILE_COMPARE = { on(){…}, off(){…} }
   If present, a "hold to compare" button is shown in the drum actions row.
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SENSITIVITY = 0.0022;   // fraction of full range per pixel of travel
  var HAPTIC_MS   = 40;       // min interval between tick haptics

  var MQ = window.matchMedia('(max-width: 720px)');
  var sidebar, params = [], sel = null, built = false;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var decimalsOf = function (step) {
    var s = String(step);
    var i = s.indexOf('.');
    return i < 0 ? 0 : (s.length - i - 1);
  };

  // ── Discover slider params from the desktop sidebar ─────────────────────────
  function discover() {
    var rows = sidebar.querySelectorAll('.sb-ctrl');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var range = row.querySelector('input[type=range]');
      if (!range) continue;
      var lblEl = row.querySelector('.sb-ctrl-lbl');
      var valEl = row.querySelector('.sb-val');
      var step = parseFloat(range.step) || 1;
      params.push({
        range: range,
        label: lblEl ? lblEl.textContent.trim() : (range.id || 'Value'),
        valEl: valEl,
        min: parseFloat(range.min),
        max: parseFloat(range.max),
        step: step,
        decimals: decimalsOf(range.step || step),
        def: parseFloat(range.value)
      });
    }
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────
  var elDrumValue, elDrumName, elDrumHint, elRulerTrack, elCard, elParamList;

  function build() {
    if (built) return;
    built = true;
    sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    discover();
    buildTopbar();
    if (params.length) buildDrum();
  }

  function buildTopbar() {
    var bar = document.createElement('div');
    bar.id = 'm-topbar';

    var srcLink = sidebar.querySelector('.sb-toolbar a');
    var back = document.createElement('a');
    back.className = 'm-tb-back';
    back.href = (srcLink && srcLink.getAttribute('href')) || '../index.html';
    back.setAttribute('aria-label', 'Back');
    back.textContent = '‹';
    bar.appendChild(back);

    var titleEl = sidebar.querySelector('.toolbar-title');
    var title = document.createElement('span');
    title.className = 'm-tb-title';
    title.textContent = titleEl ? titleEl.textContent.trim() : (document.title || 'cam.tools');
    bar.appendChild(title);

    // Proxy buttons for every upload zone
    var uploads = sidebar.querySelectorAll('.sb-upload');
    for (var i = 0; i < uploads.length; i++) {
      (function (zone) {
        var nameEl = zone.querySelector('.sb-upload-name');
        var b = document.createElement('button');
        b.className = 'm-tb-btn';
        b.textContent = uploads.length > 1 && nameEl ? nameEl.textContent.trim() : 'Upload';
        b.addEventListener('click', function () { zone.click(); });
        bar.appendChild(b);
      })(uploads[i]);
    }

    // Proxy buttons for every export button
    var exports = sidebar.querySelectorAll('.sb-footer .sb-export-btn');
    for (var j = 0; j < exports.length; j++) {
      (function (btn) {
        var label = (btn.querySelector('span') || btn).textContent.trim() || 'Export';
        var b = document.createElement('button');
        b.className = 'm-tb-btn m-tb-primary';
        b.textContent = label;
        b.addEventListener('click', function () { btn.click(); });
        bar.appendChild(b);
      })(exports[j]);
    }

    var chevron = document.createElement('button');
    chevron.className = 'm-tb-chevron';
    chevron.setAttribute('aria-label', 'Toggle controls');
    chevron.textContent = '▲';
    chevron.addEventListener('click', function () {
      document.body.classList.toggle('m-sheet-open');
    });
    bar.appendChild(chevron);

    document.body.appendChild(bar);
  }

  function buildDrum() {
    var wrap = document.createElement('div');
    wrap.id = 'm-drum';

    elParamList = document.createElement('div');
    elParamList.className = 'm-param-list';
    params.forEach(function (p, idx) {
      var row = document.createElement('div');
      row.className = 'm-param-row';
      row.setAttribute('role', 'button');
      var name = document.createElement('span');
      name.className = 'm-pr-name';
      name.textContent = p.label;
      var val = document.createElement('span');
      val.className = 'm-pr-val';
      p.rowValEl = val;
      p.rowEl = row;
      row.appendChild(name);
      row.appendChild(val);
      row.addEventListener('click', function () { select(idx); });
      elParamList.appendChild(row);
      // keep list in sync when the underlying slider changes by any means
      p.range.addEventListener('input', function () {
        renderRow(p);
        if (p === sel) renderDrum();
      });
    });
    wrap.appendChild(elParamList);

    elCard = document.createElement('div');
    elCard.className = 'm-drum-card';
    elCard.tabIndex = 0;
    elCard.setAttribute('role', 'slider');

    elDrumName = document.createElement('div');
    elDrumName.className = 'm-drum-name';
    elDrumValue = document.createElement('div');
    elDrumValue.className = 'm-drum-value';
    elDrumHint = document.createElement('div');
    elDrumHint.className = 'm-drum-hint';

    var ruler = document.createElement('div');
    ruler.className = 'm-ruler';
    elRulerTrack = document.createElement('div');
    elRulerTrack.className = 'm-ruler-track';
    var center = document.createElement('div');
    center.className = 'm-ruler-center';
    ruler.appendChild(elRulerTrack);
    ruler.appendChild(center);

    elCard.appendChild(elDrumName);
    elCard.appendChild(elDrumValue);
    elCard.appendChild(elDrumHint);
    elCard.appendChild(ruler);
    wrap.appendChild(elCard);

    var actions = document.createElement('div');
    actions.className = 'm-actions';
    var resetBtn = document.createElement('button');
    resetBtn.textContent = 'reset';
    resetBtn.addEventListener('click', function () {
      if (sel) commit(sel, sel.def, true);
    });
    actions.appendChild(resetBtn);

    var cmp = window.CAMLA_MOBILE_COMPARE;
    if (cmp && typeof cmp.on === 'function' && typeof cmp.off === 'function') {
      var cmpBtn = document.createElement('button');
      cmpBtn.textContent = 'hold to compare';
      var down = function (e) { e.preventDefault(); cmp.on(); };
      var up = function () { cmp.off(); };
      cmpBtn.addEventListener('pointerdown', down);
      cmpBtn.addEventListener('pointerup', up);
      cmpBtn.addEventListener('pointercancel', up);
      cmpBtn.addEventListener('pointerleave', up);
      actions.appendChild(cmpBtn);
    }
    wrap.appendChild(actions);

    var body = sidebar.querySelector('.sb-body');
    sidebar.insertBefore(wrap, body || null);

    attachGesture();
    attachKeys();
    select(0);
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  function select(idx) {
    sel = params[idx];
    params.forEach(function (p) { p.rowEl.classList.toggle('sel', p === sel); });
    elDrumName.textContent = sel.label;
    elCard.setAttribute('aria-label', sel.label);
    elCard.setAttribute('aria-valuemin', sel.min);
    elCard.setAttribute('aria-valuemax', sel.max);
    elRulerTrack.classList.add('m-anim');
    renderDrum();
    setTimeout(function () { elRulerTrack.classList.remove('m-anim'); }, 200);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function tOf(p) {
    var span = p.max - p.min;
    return span ? clamp((parseFloat(p.range.value) - p.min) / span, 0, 1) : 0;
  }
  function fmt(p) {
    if (p.valEl && p.valEl.textContent !== '') return p.valEl.textContent;
    return parseFloat(p.range.value).toFixed(p.decimals);
  }
  function renderRow(p) { p.rowValEl.textContent = fmt(p); }
  function renderDrum() {
    if (!sel) return;
    var t = tOf(sel);
    elDrumValue.textContent = fmt(sel);
    elDrumHint.textContent = 'drag anywhere · ' + Math.round(t * 100) + '%';
    elRulerTrack.style.transform = 'translateX(' + (-t * 720) + 'px)';
    elCard.setAttribute('aria-valuenow', sel.range.value);
    elCard.setAttribute('aria-valuetext', fmt(sel));
  }
  function renderAll() {
    params.forEach(renderRow);
    renderDrum();
  }

  // ── Commit ─────────────────────────────────────────────────────────────────
  var lastHaptic = 0, lastPct = null, atEndFired = false;
  function haptic(ms) {
    if (!navigator.vibrate) return;
    var now = performance.now();
    if (now - lastHaptic < HAPTIC_MS) return;
    lastHaptic = now;
    navigator.vibrate(ms);
  }
  function commit(p, v, silent) {
    v = Math.round(v / p.step) * p.step;
    v = clamp(v, p.min, p.max);
    v = parseFloat(v.toFixed(6));
    if (String(v) !== String(p.range.value)) {
      p.range.value = v;
      p.range.dispatchEvent(new Event('input', { bubbles: true }));
    }
    renderRow(p);
    if (p === sel) renderDrum();

    if (!silent) {
      var pct = Math.round(tOf(p) * 100);
      var atEnd = (v === p.min || v === p.max);
      if (atEnd && !atEndFired) { haptic(18); atEndFired = true; }
      else if (!atEnd) {
        atEndFired = false;
        if (pct !== lastPct) haptic(8);
      }
      lastPct = pct;
    }
  }

  // ── Gesture (per DRUM_SCRUB.md) ────────────────────────────────────────────
  function attachGesture() {
    elCard.addEventListener('pointerdown', function (e) {
      if (!sel) return;
      elCard.setPointerCapture(e.pointerId);
      var last = e.clientX;
      lastPct = Math.round(tOf(sel) * 100);
      atEndFired = false;

      function onMove(ev) {
        ev.preventDefault();
        var dx = ev.clientX - last;
        last = ev.clientX;
        var next = parseFloat(sel.range.value) + dx * SENSITIVITY * (sel.max - sel.min);
        commit(sel, next, false);
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function attachKeys() {
    elCard.addEventListener('keydown', function (e) {
      if (!sel) return;
      var v = parseFloat(sel.range.value), handled = true;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= sel.step;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += sel.step;
      else if (e.key === 'PageDown') v -= sel.step * 10;
      else if (e.key === 'PageUp') v += sel.step * 10;
      else handled = false;
      if (handled) { e.preventDefault(); commit(sel, v, false); }
    });
  }

  // ── Activate / deactivate ─────────────────────────────────────────────────
  function sync() {
    var on = MQ.matches;
    document.body.classList.toggle('m-active', on);
    if (on) {
      renderAll();
      window.dispatchEvent(new Event('resize'));
    }
  }

  ready(function () {
    build();
    sync();
    (MQ.addEventListener ? MQ.addEventListener('change', sync)
                        : MQ.addListener(sync));
    window.addEventListener('orientationchange', function () {
      if (MQ.matches) setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, 250);
    });
  });
})();
