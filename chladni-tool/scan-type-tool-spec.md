# Scan Type Tool — Functional Specification

A single-file static web app (`index.html`) with no build step, deployed to GitHub Pages at `https://camilapaleno.github.io/scan-type-tool/`. All logic is client-side. The viewport is full-screen with floating UI overlaid on top.

---

## Dependencies (CDN)

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js"></script>
<script src="https://unpkg.com/lucide@latest"></script>
```

Google Fonts (for UI font rendering in button labels):
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&..." rel="stylesheet">
```

---

## Layout

Full-screen viewport with three floating overlays:

- **`#viewport`** — fills the entire screen; contains `#three-canvas` (WebGL) and `#fx-canvas` (2D post-processing overlay, `pointer-events: none`, same dimensions)
- **`#toolbar`** — absolute, top: 14px, left/right: 14px; CSS grid `auto 1fr auto`; three sections:
  - **Left** — `.logo-mark` pill containing `cam.tools.png` (white, inverted)
  - **Center** — two individual floating pills: PNG export, Video export
  - **Right** — two individual floating pills: Spin control, Zoom control
- **`#bottom-bar`** — absolute, bottom: 14px, centered; contains `.bb-pill` with two logical rows:
  - **Row 1** — text input + font / mode / colors icon buttons
  - **Row 2** — Cell / Depth / Glow sliders

All UI pills share the same visual style: `background: var(--panel)`, `border: 1px solid var(--border-hi)`, `border-radius: 10px`, `box-shadow: 0 4px 20px rgba(0,0,0,0.5)`.

Icons are rendered via Lucide (`lucide.createIcons()` called on page load).

---

## Styling Reference

A complete copy of the CSS so the exact visual style can be reproduced in other projects.

### Global reset & body

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text-hi);
  height: 100vh;
  overflow: hidden;
  position: relative;
  font-size: 12px;         /* base size; most UI text is 11–13px */
}
```

---

### Pill shell (shared by every floating container)

```css
/* applies to: .logo-mark, .tb-icon-pill, .bb-pill */
background: var(--panel);             /* #111118 */
border: 1px solid var(--border-hi);   /* rgba(255,255,255,0.12) */
border-radius: 10px;
box-shadow: 0 4px 20px rgba(0,0,0,0.5);
```

---

### Toolbar layout

```css
#toolbar {
  position: absolute;
  top: 14px; left: 14px; right: 14px;
  z-index: 100;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 10px;
  pointer-events: none;      /* re-enabled on children */
}

/* Center group */
.tb-center { display: flex; justify-content: center; align-items: flex-start; gap: 6px; }

/* Right group */
.tb-right  { display: flex; align-items: flex-start; gap: 6px; }
```

### Logo pill

```css
.logo-mark {
  width: 94px; height: 45px;
  padding: 17px 12px;          /* image sits inside this padding */
  border-radius: 10px;
  /* + shared pill shell */
}
.logo-mark img {
  width: 100%; height: 100%;
  object-fit: contain;
  filter: invert(0.5);         /* dims the white logo to a mid-grey */
}
```

### Top-bar icon pill (wraps one button + optional dropdown)

```css
.tb-icon-pill {
  background: var(--panel);
  border: 1px solid var(--border-hi);
  border-radius: 10px;
  padding: 4px;                /* tight — button adds its own padding */
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  position: relative;
  flex-shrink: 0;
}
```

---

### Buttons

#### Tool button (icon-only variant used in toolbar and bottom bar)

```css
.tool-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;           /* text variant */
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-mid);      /* #8888aa */
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  user-select: none;
}
.tool-btn.icon-only { padding: 8px; }   /* square, no label */

/* States */
.tool-btn:hover  { background: var(--panel-hover); color: var(--text-hi); }
.tool-btn.active { background: var(--accent-bg);   color: var(--accent);  }

/* Icon wrapper inside button */
.tool-btn .ico { display: flex; align-items: center; opacity: 0.8; }

/* Lucide icon size used everywhere in the toolbar / bottom bar */
/* width="15" height="15" stroke-width="1.5" */
```

Bottom-bar buttons are slightly tighter:
```css
.bb-group .tool-btn { padding: 5px 7px; border-radius: 6px; }
```

#### Panel option buttons (inside dropdowns)

```css
.p-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 14px 8px;
}
.p-btns button {
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-hi);
  border-radius: 5px;
  color: var(--text-mid);
  font-family: inherit;
  font-size: 13px;
  padding: 4px 9px;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.p-btns button:hover  { background: var(--panel-hover); color: var(--text-hi); }
.p-btns button.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 500;
}
```

---

### Dropdown panels

```css
.panel {
  display: none;          /* .open → display: block */
  position: absolute;
  top: calc(100% + 14px); /* 14px gap below trigger */
  left: 0;
  min-width: 220px;
  background: var(--panel);
  border: 1px solid var(--border-hi);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04);
  z-index: 200;
  overflow: hidden;
}

/* Upward variant (bottom-bar panels) */
.panel-up {
  top: auto;
  bottom: calc(100% + 14px);
  left: 50%;
  transform: translateX(-50%);
}

/* Right-aligned variant */
.panel.align-right { left: auto; right: 0; }
```

Panel inner sections:
```css
.p-sec {
  padding: 10px 0 6px;
  border-bottom: 1px solid var(--border);  /* rgba(255,255,255,0.07) */
}
.p-sec:last-child { border-bottom: none; }

.p-sec-label {
  padding: 0 14px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-lo);   /* #44445a */
}

/* Generic row inside panel */
.p-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 14px;
  min-height: 26px;
}
.p-row .ico { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-lo); }
.p-row .lbl { flex: 1; font-size: 12px; color: var(--text-mid); }

/* Color-picker row inside panel */
.p-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
}
.p-color-row .ico { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-lo); }
.p-color-row .lbl { flex: 1; font-size: 12px; color: var(--text-mid); }
```

---

### Sliders

#### Horizontal (bottom-bar Cell / Depth / Glow)

```css
input[type=range] {
  -webkit-appearance: none; appearance: none;
  height: 28px;
  background: rgba(255,255,255,0.07);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  outline: none;
  cursor: pointer;
}

/* Thumb — WebKit */
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 24px;
  border-radius: 18px;
  background: rgba(255,255,255,0.82);
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.45);
  transition: background 0.1s;
}
input[type=range]::-webkit-slider-thumb:hover { background: rgba(255,255,255,0.96); }

/* Thumb — Firefox */
input[type=range]::-moz-range-thumb {
  width: 14px; height: 24px;
  border-radius: 18px;
  background: rgba(255,255,255,0.82);
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.45);
}

/* Track — Firefox */
input[type=range]::-moz-range-track {
  height: 20px;
  background: rgba(255,255,255,0.07);
  border-radius: 10px;
}
```

Bottom-bar sliders are fixed at 80px wide:
```css
.bb-ctrl input[type=range] { width: 80px; }
```

#### Vertical (toolbar Spin / Zoom panels)

```css
.v-slider-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
}
.v-slider-wrap input[type=range] {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 84px;
  width: 20px;
  border-radius: 10px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.06);
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  cursor: pointer;
  outline: none;
}
/* Vertical thumb — WebKit */
.v-slider-wrap input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px; height: 22px;
  border-radius: 7px;
  background: rgba(255,255,255,0.82);
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.45);
}
/* Vertical thumb — Firefox */
.v-slider-wrap input[type=range]::-moz-range-thumb {
  width: 10px; height: 22px;
  border-radius: 7px;
  background: rgba(255,255,255,0.82);
  border: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.45);
}
/* Label above slider */
.v-slider-wrap .ctrl-lbl-sm {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-lo);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
/* Value readout above/below slider */
.v-slider-wrap .ctrl-val {
  font-size: 11px;
  color: var(--text-mid);
  font-variant-numeric: tabular-nums;
}
```

---

### Value readout pill (`.ctrl-val`)

```css
.ctrl-val {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 7px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-mid);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 42px;
  text-align: center;
}
/* Inline variant inside .bb-ctrl (no border/background pill) */
.bb-ctrl .ctrl-val {
  font-size: 11px;
  color: var(--text-mid);
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

---

### Bottom bar

```css
#bottom-bar {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
}

.bb-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;         /* tighter than toolbar pills */
  white-space: nowrap;
  /* + shared pill shell */
}

/* Vertical separator between rows/groups */
.bb-sep  { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }
.tb-sep  { width: 1px; height: 18px; background: var(--border); flex-shrink: 0; }

/* Slider group label */
.bb-ctrl { display: flex; align-items: center; gap: 6px; }
.bb-ctrl .ctrl-lbl {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-lo);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
```

### Text input

```css
#text-input {
  height: 28px;
  width: 140px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border-hi);
  border-radius: 7px;
  color: var(--text-hi);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 0 10px;
  outline: none;
  transition: border-color 0.15s;
  flex-shrink: 0;
}
#text-input:focus { border-color: var(--accent); }   /* #b7d053 */
```

### Color swatch

```css
.swatch {
  position: relative;
  width: 26px; height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.18);
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
}
/* Hidden native color picker positioned over swatch */
.swatch input[type=color] {
  position: absolute;
  top: -6px; left: -6px;
  width: 40px; height: 32px;
  border: none; outline: none;
  padding: 0; cursor: pointer;
  opacity: 0;
}
```

---

### Mobile overrides (≤ 640px)

```css
@media (max-width: 640px) {
  #bottom-bar {
    left: 14px; right: 14px;
    transform: none;
    bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  }
  .bb-pill {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0;
    padding: 6px;
  }
  .bb-row { display: flex; align-items: center; gap: 5px; width: 100%; }
  .bb-sliders {
    padding-top: 6px;
    margin-top: 2px;
    border-top: 1px solid var(--border);
  }
  #text-input { flex: 1; width: auto; min-width: 0; font-size: 16px; }
  .bb-ctrl { flex: 1; min-width: 0; gap: 4px; }
  .bb-ctrl input[type=range] { width: 100%; min-width: 0; }
  .tool-btn        { padding: 10px; }
  .tool-btn.icon-only { padding: 10px; }
  .bb-group .tool-btn { padding: 8px; }
  .panel { min-width: 160px; max-width: calc(100vw - 28px); }
  .panel-up { left: 50%; transform: translateX(-50%); }
  #toolbar { gap: 6px; }
  .tb-center, .tb-right { gap: 4px; }
  /* Vertical panels open downward on mobile to avoid clipping */
  #panel-spin, #panel-zoom { top: calc(100% + 8px); bottom: auto; }
}
```

---

## Design Tokens

```css
:root {
  --bg:          #0a0a0f;
  --panel:       #111118;
  --panel-hover: #1c1c28;
  --border:      rgba(255,255,255,0.07);
  --border-hi:   rgba(255,255,255,0.12);
  --text-hi:     #eeeef5;
  --text-mid:    #8888aa;
  --text-lo:     #44445a;
  --accent:      #b7d053;
  --accent-bg:   rgba(183,208,83,0.15);
}
```

---

## State

```js
const state = {
  text: 'scan type',
  font: 'instrument_serif',
  bevelSize: 0,           // locked — no slider, bevel disabled
  depth: 1.0,
  spinSpeed: 0.05,        // radians/sec
  zoom: window.innerWidth <= 640 ? 1.0 : 3.0,  // responsive default
  colorBg: '#050508',
  colorLight: '#ffffff',
  colorHi: '#b7d053',     // dither highlight color (accent)
  colorLo: '#000000',     // dither shadow color
  thresholdLevel: 0.50,   // locked — no slider
  ditherMode: 'ascii',
  cellSize: 5,
  threshold: 0.50,        // locked — no slider
  glow: 0.50,
  fxIntensity: 0.5,
  scanlineGap: 3,
  vignetteIntensity: 0.65,
};
```

---

## Three.js Scene

### Renderer
```js
new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true })
```
`alpha: true` is required for transparent PNG export.

### Camera
Orthographic (not perspective). FRUSTUM constant = 4. Aspect-ratio-aware:
```js
const FRUSTUM = 4;
const camera = new THREE.OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 100);
camera.position.z = 8;
```
On resize, left/right bounds are updated: `camera.left = -FRUSTUM * aspect`.

Zoom is applied via `camera.zoom` property + `camera.updateProjectionMatrix()` each frame.

### Lighting
Zero ambient. Two symmetrical `SpotLight`s raking in from left (x=−20) and right (x=+20), both at y=3, z=8. Intensity 4.0, angle π/7, penumbra 0.15, shadow maps 2048×2048.

A proxy object synchronizes both light colors:
```js
const dirLight = {
  color: { set: (c) => { lightL.color.set(c); lightR.color.set(c); } }
};
```

### Material
```js
new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.45 })
```

---

## Fonts

10 fonts loaded from jsDelivr Fontsource as `.woff` (DEFLATE — no WASM required, works in `file://` context). Each font has a multi-URL fallback chain tried in order.

| Key | Family | Weight loaded |
|---|---|---|
| `astloch` | Astloch | 400 |
| `gruppo` | Gruppo | 400 |
| `instrument_serif` | Instrument Serif | 400 (default) |
| `inter_tight` | Inter Tight | 100 (thinnest) |
| `megrim` | Megrim | 400 |
| `poiret_one` | Poiret One | 400 |
| `quintessential` | Quintessential | 400 |
| `tsukimi_rounded` | Tsukimi Rounded | 300 |
| `turret_road` | Turret Road | 200 (thinnest) |
| `unifraktur` | UnifrakturMaguntia | 400 |

### Font loading
`loadFont(name)` iterates the URL array, fetches the first that responds with HTTP 200, parses with `opentype.parse(arrayBuffer)`, and wraps in `opentypeToThreeFont()`. Result is cached in `fontCache`.

### opentype → Three.js conversion (`opentypeToThreeFont`)

Bypasses `ShapePath.toShapes()` entirely to correctly handle letter counters (e.g. O, P, B):

1. **Split** glyph path commands into sub-paths at each `M` command
2. **Build** a `THREE.Path` per sub-path
3. **Classify** sub-paths as outer shapes or holes using the **shoelace formula** (signed area): positive area = outer winding
4. **Assign** each hole to its containing outer shape via **ray-casting point-in-polygon** test using the hole's start point
5. **Build** `THREE.Shape` objects with `.holes` arrays correctly populated

Kerning is applied between adjacent characters using `otFont.getKerningValue()`.

---

## Text Geometry (`buildText`)

Uses `THREE.ExtrudeGeometry` with bevel disabled:
```js
new THREE.ExtrudeGeometry(shapes, {
  depth: state.depth,
  bevelEnabled: false,
  curveSegments: 12,
})
```

Geometry is centered by computing bounding box center and calling `geo.translate(-cx, -cy, -cz)`. Old mesh is disposed before rebuilding. Called on: text input change (400ms debounce), font change, depth slider change.

---

## Animation Loop

Each frame:
1. If not dragging: apply auto-spin (`textMesh.rotation.y += state.spinSpeed * delta`) and inertia decay (`velX/Y *= 0.88`)
2. Update `camera.zoom = state.zoom` and `camera.updateProjectionMatrix()`
3. Update `scene.background = new THREE.Color(state.colorBg)`
4. `renderer.render(scene, camera)`
5. `drawDitherOverlay(canvas)` — runs post-processing on `fxCanvas`

---

## Mouse / Touch Interaction

| Gesture | Action |
|---|---|
| Click + drag (mouse) | Rotate text (dx → rotation.y, dy → rotation.x) |
| Single-finger drag (touch) | Same as mouse drag |
| Release | Inertia coasts, decays at 0.88× per frame |
| Scroll wheel | Zoom (state.zoom ± deltaY × 0.001, clamped 0.3–6) |
| Two-finger pinch (touch) | Zoom (multiplicative scale from pinch distance ratio) |

Single-touch and two-touch are handled separately — a two-finger touch cancels drag mode and enters pinch mode.

---

## Post-Processing Pipeline (`drawDitherOverlay`)

Runs every frame on `fxCanvas`. Accepts an optional `transparent` boolean for export.

### 1. Threshold pass (`applyThreshold`)
Sample every pixel from the Three.js canvas. Compare luminance (`0.299r + 0.587g + 0.114b`) to `state.thresholdLevel` (0.50). Replace with `colorHi` if ≥ threshold, `colorLo` if below.

### 2. Dither pass
- Clear `fxCanvas`
- If `ditherMode === 'none'`: write threshold data directly via `putImageData`
- Otherwise: fill background with `colorLo` (skipped in transparent mode), then loop over `cellSize × cellSize` cells:
  - Sample center pixel brightness from threshold data
  - Skip if `br ≤ state.threshold` (0.50)
  - Draw pattern shape in `colorHi`, scaled by brightness:

| Mode | Shape |
|---|---|
| `ascii` | Character from 70-char ramp `' .\`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$'` |
| `blocks` | Filled square, size ∝ brightness |
| `lines` | Horizontal filled rect, height ∝ brightness |
| `circles` | Filled circle, radius ∝ brightness |
| `crosses` | Plus sign, arm length ∝ brightness |
| `dots` | 3×3 sub-grid, dots filled center-outward (0–9) |
| `slashes` | 1–3 diagonal lines, count/length ∝ brightness |

### 3. Vignette (skipped in transparent mode)
Radial gradient from transparent center to `rgba(0,0,0, vignetteIntensity × 0.9)` at radius `max(w,h) × 0.65`.

### 4. Scanlines (skipped in transparent mode)
Every `scanlineGap + 1` pixels: 1px dark line (`rgba(0,0,0, fxIntensity × 0.88)`) + scanlineGap px of faint phosphor green tint.

### 5. Glow / bloom
Two off-screen canvas blur passes composited with `globalCompositeOperation = 'screen'`:
- Tight pass: `blur(glow × 6px)`, alpha `min(1, glow × 1.4)`
- Wide pass: `blur(glow × 28px)`, alpha `min(1, glow × 1.1)`

---

## Export

### PNG (`exportPNG(transparent = false)`)
1. If transparent: set `scene.background = null`, re-render
2. Resize `fxCanvas` to full renderer resolution
3. Run `drawDitherOverlay(canvas, transparent)`
4. Copy `fxCanvas` to a temporary export canvas
5. Trigger `<a download>` with `toDataURL('image/png')`
6. If transparent: restore `scene.background`, re-render
7. Restore `fxCanvas` to viewport dimensions

Filename: `scan-type.png` or `scan-type-transparent.png`.

### Video (`exportVideo(duration = 3)`)
1. Capture `fxCanvas.captureStream(30)` via `MediaRecorder` (VP9 WebM preferred)
2. Show recording indicator with countdown
3. Stop after `duration` seconds (supports 3 / 5 / 10 / 30)
4. Download as `scan-type.webm`

---

## Controls

### Top bar — center (export pills)
Each is an individual floating pill with a dropdown panel.

| Icon | Panel contents |
|---|---|
| `image` (Lucide) | PNG / Transparent buttons |
| `video` (Lucide) | 3s / 5s / 10s / 30s duration buttons |

### Top bar — right (control pills)
Each is an individual floating pill with a vertical slider panel opening downward.

| Icon | Controls | Range |
|---|---|---|
| `fast-forward` | Spin speed | 0 – 0.10 (step 0.005) |
| `search` | Camera zoom | 0.3 – 6.0 (step 0.1) |

### Bottom bar — row 1

| Element | Type | State key | Side effect |
|---|---|---|---|
| Text input | `<input type=text>` | `state.text` | debounced `buildText()` 400ms |
| `type` icon | Panel → 10 font buttons | `state.font` | `loadFont()` → `buildText()` |
| `sparkles` icon | Panel → 8 mode buttons | `state.ditherMode` | none (read each frame) |
| `pipette` icon | Panel → highlight + shadow color pickers | `state.colorHi`, `state.colorLo` | none |

### Bottom bar — row 2

| Label | Slider | State key | Range | Side effect |
|---|---|---|---|---|
| Cell | `#cell-size` | `state.cellSize` | 2–20 | none |
| Depth | `#extrude-depth` | `state.depth` | 0.05–3.0 | `buildText()` |
| Glow | `#glow-slider` | `state.glow` | 0–1.0 | none |

---

## Mobile (≤ 640px)

- Bottom bar spans full width (`left: 14px; right: 14px; transform: none`)
- `.bb-pill` switches to `flex-direction: column`; rows become actual flex rows
- Slider labels visible; sliders fill available width equally (`flex: 1`)
- Touch targets: 44px (`padding: 10px` on buttons)
- Text input `font-size: 16px` (prevents iOS Safari auto-zoom on focus)
- Bottom bar clears home indicator: `bottom: calc(14px + env(safe-area-inset-bottom))`
- Panels capped at `max-width: calc(100vw - 28px)`
- Pinch-to-zoom on viewport canvas

---

## Init Flow

```js
lucide.createIcons();                          // render all icons
document.getElementById('cam-zoom').value = state.zoom;  // sync zoom slider
init();                                        // load font → buildText → animate
```

`init()` calls `syncSize()`, shows loading indicator, awaits `loadFont(state.font)`, hides loading indicator, calls `buildText()` and starts `animate()`.
