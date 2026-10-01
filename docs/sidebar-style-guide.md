# Sidebar Style Guide — replicating it in another app

The sidebar look used across cam.tools (left panel of controls, canvas on the
right) is entirely CSS-variable driven. To reproduce it pixel-for-pixel in a
different app, you need three things: the fonts, the token block, and the
markup patterns below. You do **not** need the whole `cam-tools-ui.css` file —
everything sidebar-related is self-contained in the token block plus the
`.sb-*` rules, both reproduced in full here.

## 1. Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Code:wght@400;500;700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=swap" rel="stylesheet">
```

- **Body / controls font:** `'Google Sans Code', 'JetBrains Mono', monospace` — set once on `html, body`.
- **Top bar font** (the `camla.tools/toolname` breadcrumb): `'DM Mono', monospace`.
- **Logo wordmark** (`camla` in `.hp-logo .pixel`): a licensed font called `pf-pixelscript` — skip this if you don't have it; it falls back to `sans-serif` and only affects five characters.
- Icons are [Lucide](https://lucide.dev): `<script src="https://unpkg.com/lucide@latest"></script>`, call `lucide.createIcons()` on load, and use `width="15" height="15" stroke-width="1.5"` on every `<i data-lucide="...">`.

## 2. Design tokens

Every color, spacing, radius, and font-size value in the sidebar reads from
these CSS variables. Copy this block as-is into your `:root` — it's the exact
source of truth cam.tools uses, so any app that includes it renders
byte-identical padding/colors/fonts. To reskin (e.g. a different accent color
or an off-black background) edit only these variables, not the component
rules below.

```css
:root {
  --bg:          #000000;
  --panel:       #000000;
  --panel-hover: #021702;
  --border:      rgba(72, 255, 0, 0.452);
  --border-hi:   rgba(98, 255, 0, 0.673);
  --text-hi:     #00ff2fce;
  --text-mid:    #3cff0099;
  --text-lo:     #00ff3c6a;
  --accent:      #b7d053;
  --accent-bg:   rgba(183,208,83,0.15);

  /* Sidebar — layout */
  --sb-width: 300px;

  /* Sidebar — surface colors (aliased to the globals above) */
  --sb-bg:            var(--panel);
  --sb-bg-hover:      var(--panel-hover);
  --sb-border:        var(--border-hi);   /* outer sidebar border */
  --sb-border-subtle: var(--border);      /* section/footer dividers */
  --sb-text-hi:       var(--text-hi);
  --sb-text-mid:      var(--text-mid);
  --sb-text-lo:       var(--text-lo);
  --sb-accent:        var(--accent);
  --sb-accent-bg:     var(--accent-bg);

  /* Sidebar — control surfaces & lines (green-alpha scale, lightest → strongest) */
  --sb-line:          rgba(0, 255, 34, 0.1);
  --sb-line-dashed:   rgba(0, 255, 8, 0.15);
  --sb-line-hover:    rgba(85, 255, 0, 0.22);
  --sb-line-strong:   rgba(34, 255, 0, 0.28);
  --sb-surface-1:     rgba(0, 255, 34, 0.03);
  --sb-surface-2:     rgba(0, 255, 8, 0.04);
  --sb-surface-3:     rgba(0, 255, 21, 0.05);
  --sb-surface-4:     rgba(13, 255, 0, 0.06);
  --sb-surface-5:     rgba(0, 255, 21, 0.1);

  /* Sidebar — border radius scale */
  --sb-radius-xs: 4px;   /* kbd chip, toggle-btn */
  --sb-radius-sm: 5px;   /* sb-btn */
  --sb-radius:    6px;   /* sb-input */
  --sb-radius-md: 7px;   /* upload dropzone, toggle-group */
  --sb-radius-lg: 8px;   /* export button */

  /* Sidebar — spacing scale */
  --sb-gap-xs: 3px;
  --sb-gap-sm: 4px;
  --sb-gap:    6px;
  --sb-gap-md: 8px;

  --sb-space-2xs: 2px;
  --sb-space-xs:  3px;
  --sb-space-sm:  4px;
  --sb-space:     5px;
  --sb-space-md:  7px;
  --sb-space-lg:  8px;
  --sb-space-xl:  9px;
  --sb-space-2xl: 10px;
  --sb-space-3xl: 11px;
  --sb-space-4xl: 12px;
  --sb-space-5xl: 14px;  /* section horizontal padding */

  /* Sidebar — font sizes */
  --sb-font-2xs: 10px;
  --sb-font-xs:  11px;
  --sb-font-sm:  12px;
  --sb-font-md:  14px;
  --sb-icon:     20px;   /* toolbar logo */

  /* Sidebar — range slider */
  --sb-slider-h:            24px;
  --sb-slider-track-bg:     rgba(0, 251, 21, 0.07);
  --sb-slider-track-border: rgba(34, 255, 0, 0.06);
  --sb-slider-track-radius: 3px;
  --sb-slider-thumb-w:      12px;
  --sb-slider-thumb-h:      20px;
  --sb-slider-thumb-radius: 3px;
  --sb-slider-thumb-bg:     #b7d053;
  --sb-slider-thumb-bg-hover: rgba(255,255,255,0.96);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  width: 100%; height: 100%;
  background: var(--bg);
  font-family: 'Google Sans Code', 'JetBrains Mono', monospace;
  overflow: hidden;
  color: var(--text-hi);
  font-size: 12px;
}
```

## 3. Layout shell

```html
<body class="sidebar-app">
  <div id="sidebar">
    <div class="hp-top">
      <a href="#" class="hp-logo"><span class="pixel">app</span>.name</a>
      <div class="hp-icons">
        <i data-lucide="globe"></i>
        <i data-lucide="headphones"></i>
        <i data-lucide="battery"></i>
      </div>
    </div>
    <div class="sb-body">
      <!-- .sb-upload, .sb-section blocks go here -->
    </div>
    <div class="sb-footer">
      <button class="sb-export-btn"><span>Export</span></button>
    </div>
  </div>
  <div id="canvas-area">
    <canvas id="fx-canvas"></canvas>
  </div>
</body>
```

```css
body.sidebar-app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

#sidebar {
  width: var(--sb-width);
  min-width: var(--sb-width);
  flex-shrink: 0;
  margin: 10px;
  height: calc(100vh - 20px);
  background: var(--sb-bg);
  border: 1px solid var(--sb-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10;
}

#canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: var(--bg);
  cursor: grab;
}
#canvas-area.dragging { cursor: grabbing; }

#canvas-area canvas,
#canvas-area #fx-canvas,
#canvas-area #three-canvas {
  display: block;
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 100%;
}

/* Top bar: "appname.tools/toolname" breadcrumb + status icons */
.hp-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 14px;
  flex-shrink: 0;
  font-size: 11px;
  flex-wrap: wrap;
  font-family: 'DM Mono', monospace;
  letter-spacing: -0.03em;
  color: #078e00;
}
.hp-top .hp-logo {
  display: block;
  text-decoration: none;
  font-size: 11px;
  font-weight: 500;
  color: inherit;
}
.hp-top .hp-logo .pixel { font-family: "pf-pixelscript", sans-serif; font-size: 13px; }
```

## 4. Sidebar components

All of these are scoped under `.sb-body`. Every value below reads from the
token block in section 2 — copy this CSS verbatim and it will match exactly.

```css
.sb-toolbar {
  display: flex;
  align-items: center;
  padding: var(--sb-space-2xl) var(--sb-space-4xl);
  border-bottom: 1px solid var(--sb-border-subtle);
  flex-shrink: 0;
  gap: var(--sb-gap-md);
}
.sb-toolbar a { display: flex; align-items: center; gap: var(--sb-gap-md); text-decoration: none; color: inherit; }
.sb-toolbar .toolbar-logo  { width: var(--sb-icon); height: var(--sb-icon); }
.sb-toolbar .toolbar-title { font-size: var(--sb-font-sm); font-weight: 300; color: var(--sb-text-mid); }

.sb-body {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--sb-line) transparent;
}

/* Upload dropzone */
.sb-upload {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: var(--sb-space-2xl) var(--sb-space-3xl) var(--sb-space-2xs);
  padding: var(--sb-space-xl) var(--sb-space-3xl);
  border: 1px dashed var(--sb-line-dashed);
  border-radius: var(--sb-radius-md);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}
.sb-upload:hover { border-color: var(--sb-line-strong); background: var(--sb-surface-1); }
.sb-upload-name { font-size: var(--sb-font-sm); color: var(--sb-text-mid); }
.sb-upload-hint { font-size: var(--sb-font-2xs); color: var(--sb-text-lo); margin-top: var(--sb-space-2xs); }
.sb-upload-kbd {
  font-size: var(--sb-font-2xs); color: var(--sb-text-lo);
  background: var(--sb-surface-4);
  border: 1px solid var(--sb-line);
  border-radius: var(--sb-radius-xs); padding: var(--sb-space-2xs) var(--sb-space); white-space: nowrap;
}

/* Collapsible section */
.sb-section { border-top: 1px solid var(--sb-border-subtle); }
.sb-section:first-child { border-top: none; }
.sb-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sb-space-md) var(--sb-space-5xl);
  cursor: pointer; user-select: none;
}
.sb-section-title {
  font-size: var(--sb-font-2xs); color: var(--sb-text-lo);
  text-transform: uppercase; letter-spacing: 0.07em; font-weight: 300;
}
.sb-section-toggle { font-size: var(--sb-font-md); color: var(--sb-text-lo); line-height: 1; }
.sb-section.collapsed .sb-section-body { display: none; }
.sb-section-body { padding: var(--sb-space-lg) 0; }

/* Slider row */
.sb-ctrl { display: flex; align-items: center; padding: var(--sb-space) var(--sb-space-5xl); gap: var(--sb-gap-md); }
.sb-ctrl-lbl { font-size: var(--sb-font-xs); color: var(--sb-text-mid); flex: 1; min-width: 0; }
.sb-ctrl input[type=range] { flex: 1; min-width: 50px; max-width: 100px; }
#sidebar input[type=range] {
  height: var(--sb-slider-h);
  background: var(--sb-slider-track-bg);
  border-radius: var(--sb-slider-track-radius);
  border: 1px solid var(--sb-slider-track-border);
}
#sidebar input[type=range]::-webkit-slider-thumb {
  width: var(--sb-slider-thumb-w);
  height: var(--sb-slider-thumb-h);
  border-radius: var(--sb-slider-thumb-radius);
  background: var(--sb-slider-thumb-bg);
}
#sidebar input[type=range]::-webkit-slider-thumb:hover { background: var(--sb-slider-thumb-bg-hover); }
#sidebar input[type=range]::-moz-range-thumb {
  width: var(--sb-slider-thumb-w);
  height: var(--sb-slider-thumb-h);
  border-radius: var(--sb-slider-thumb-radius);
  background: var(--sb-slider-thumb-bg);
}
#sidebar input[type=range]::-moz-range-track {
  height: var(--sb-slider-h);
  background: var(--sb-slider-track-bg);
  border-radius: var(--sb-slider-track-radius);
}
.sb-ctrl .sb-val {
  font-size: var(--sb-font-xs); color: var(--sb-text-mid);
  font-variant-numeric: tabular-nums;
  min-width: 34px; text-align: right;
}

/* Text input */
.sb-input-row { padding: var(--sb-space-sm) var(--sb-space-5xl) var(--sb-space-lg); }
.sb-input-lbl {
  font-size: var(--sb-font-2xs); color: var(--sb-text-lo);
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: var(--sb-space-sm);
}
.sb-input {
  width: 100%;
  background: var(--sb-surface-3);
  border: 1px solid var(--sb-line);
  border-radius: var(--sb-radius);
  color: var(--sb-text-hi);
  font-family: inherit; font-size: var(--sb-font-sm);
  padding: var(--sb-space) var(--sb-gap-md); outline: none;
}
.sb-input:focus { border-color: var(--sb-line-hover); }

/* Checkbox, styled as [x] / [ ] */
.sb-check { display: flex; align-items: center; gap: var(--sb-gap-md); padding: var(--sb-space) var(--sb-space-5xl); cursor: pointer; user-select: none; }
.sb-check-indicator { font-size: var(--sb-font-xs); color: var(--sb-text-lo); font-family: monospace; width: var(--sb-icon); flex-shrink: 0; }
.sb-check.checked .sb-check-indicator { color: var(--sb-accent); }
.sb-check-lbl { font-size: var(--sb-font-sm); color: var(--sb-text-mid); }
.sb-check.checked .sb-check-lbl { color: var(--sb-text-hi); }

/* Segmented toggle row */
.sb-toggle-row { display: flex; align-items: center; padding: var(--sb-space-sm) var(--sb-space-5xl) var(--sb-gap); gap: var(--sb-gap); }
.sb-toggle-lbl { font-size: var(--sb-font-xs); color: var(--sb-text-mid); flex: 1; }
.sb-toggle-group { display: flex; gap: var(--sb-gap-xs); }
.sb-toggle-btn {
  padding: var(--sb-gap-xs) var(--sb-gap-md);
  border: 1px solid var(--sb-line);
  background: transparent;
  color: var(--sb-text-lo);
  font-family: inherit; font-size: var(--sb-font-xs);
  border-radius: var(--sb-radius-xs); cursor: pointer;
  transition: all 0.12s;
}
.sb-toggle-btn:hover { color: var(--sb-text-mid); border-color: var(--sb-line-hover); }
.sb-toggle-btn.active { background: var(--sb-surface-5); color: var(--sb-text-hi); border-color: var(--sb-line-hover); }

/* Button grid */
.sb-btn-grid { display: flex; flex-wrap: wrap; gap: var(--sb-gap-sm); padding: var(--sb-space-sm) var(--sb-space-5xl) var(--sb-space-lg); }
.sb-btn {
  padding: var(--sb-gap-sm) var(--sb-gap-md);
  border: 1px solid var(--sb-line);
  background: var(--sb-surface-2);
  color: var(--sb-text-mid);
  font-family: inherit; font-size: var(--sb-font-xs);
  border-radius: var(--sb-radius-sm); cursor: pointer;
  transition: all 0.12s;
}
.sb-btn:hover { background: var(--sb-bg-hover); color: var(--sb-text-hi); }
.sb-btn.active { background: var(--sb-accent-bg); border-color: var(--sb-accent); color: var(--sb-accent); }

/* Color swatch row */
.sb-color-row { display: flex; align-items: center; gap: var(--sb-gap-md); padding: var(--sb-space) var(--sb-space-5xl); }
.sb-color-lbl { font-size: var(--sb-font-xs); color: var(--sb-text-mid); flex: 1; }

/* Footer / export button */
.sb-footer { padding: var(--sb-space-2xl) var(--sb-space-3xl) var(--sb-space-4xl); border-top: 1px solid var(--sb-border-subtle); flex-shrink: 0; }
.sb-export-btn {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sb-space-xl) var(--sb-space-5xl);
  background: var(--bg); color: var(--sb-text-hi);
  border: var(--sb-border) solid 1px; border-radius: var(--sb-radius-sm);
  font-family: inherit; font-size: var(--sb-font-sm); font-weight: 500;
  cursor: pointer; transition: background 0.15s;
}
.sb-export-btn:hover { background: var(--sb-bg-hover); }
.sb-export-btn .sb-kbd { opacity: 0.4; font-weight: 400; font-size: var(--sb-font-2xs); }

/* Divider */
.sb-divider { height: 1px; background: var(--sb-border-subtle); margin: var(--sb-space-sm) 0; }
```

## 5. Full worked example (markup)

Taken from `image-grain/index.html` — shows an upload zone, a collapsible
section with toggle rows / checkbox / sliders / a plain button, and the
footer export button:

```html
<body class="sidebar-app">
  <div id="sidebar">

    <div class="hp-top">
      <a href="../index.html" class="hp-logo"><span class="pixel">camla</span>.tools/image-grain</a>
      <div class="hp-icons">
        <i data-lucide="globe"></i>
        <i data-lucide="headphones"></i>
        <i data-lucide="battery"></i>
      </div>
    </div>

    <div class="sb-body">

      <div class="sb-upload" id="upload-btn">
        <div>
          <div class="sb-upload-name">Upload image</div>
          <div class="sb-upload-hint">.jpg or .png</div>
        </div>
        <span class="sb-upload-kbd">cmd + O</span>
      </div>
      <input type="file" id="file-input" accept="image/*" style="display:none">

      <div class="sb-section" id="sec-grain" style="margin-top:8px">
        <div class="sb-section-header" data-section="sec-grain">
          <span class="sb-section-title">Grain</span>
          <span class="sb-section-toggle">−</span>
        </div>
        <div class="sb-section-body">

          <div class="sb-toggle-row stacked">
            <span class="sb-toggle-lbl">Type</span>
            <div class="sb-toggle-group" id="tg-type">
              <button class="sb-toggle-btn active" data-val="uniform">uniform</button>
              <button class="sb-toggle-btn" data-val="gaussian">gaussian</button>
            </div>
          </div>

          <div class="sb-check" id="chk-colored">
            <span class="sb-check-indicator">[ ]</span>
            <span class="sb-check-lbl">Colored grain (RGB)</span>
          </div>

          <div class="sb-ctrl">
            <span class="sb-ctrl-lbl">Amount</span>
            <input type="range" id="sl-amount" min="0" max="1" step="0.01" value="0.35">
            <span class="sb-val" id="val-amount">0.35</span>
          </div>

          <div style="padding: 4px 14px 8px;">
            <button class="sb-btn" id="btn-regen" style="width:100%;text-align:center">↻ Regenerate grain</button>
          </div>

        </div>
      </div>

    </div><!-- sb-body -->

    <div class="sb-footer">
      <button class="sb-export-btn" id="btn-export">
        <span id="export-lbl">Export</span>
        <span class="sb-kbd">cmd + E</span>
      </button>
    </div>

  </div><!-- sidebar -->

  <div id="canvas-area">
    <canvas id="fx-canvas"></canvas>
  </div>
</body>
```

## 6. Section-collapse behavior (JS)

```js
document.querySelectorAll('.sb-section-header').forEach(header => {
  header.addEventListener('click', () => {
    const section = header.closest('.sb-section');
    section.classList.toggle('collapsed');
    header.querySelector('.sb-section-toggle').textContent =
      section.classList.contains('collapsed') ? '+' : '−';
  });
});
```

## What to skip if you just want the look, not the full tool chrome

- `#upload-overlay`, `#ascii-output`, and the mobile drum-scrub layer (`cam-tools-mobile.css`/`.js`) are cam.tools-specific and not part of the sidebar's visual identity — omit them.
- `pf-pixelscript` is a paid/licensed font used only for the word "camla" in the logo; leave it out and the fallback `sans-serif` is used instead, or just drop the `.pixel` span and use your own wordmark.

**Source of truth:** `cam-tools-ui.css` in this repo (`:root` token block, `SIDEBAR LAYOUT` section). If that file changes, re-diff against this doc.
