# Building Image Effects: Distort, Dithering, ASCII, Recolor, CRT

A guide to five canvas-based image effects — the algorithm behind each, plus the
UI controls (sliders/toggles) you'd expose. Written for a p5.js-style setup, but
the logic is engine-agnostic: everything operates on a flat RGBA pixel array
(`pixels[i]=R, i+1=G, i+2=B, i+3=A`), so it ports cleanly to raw Canvas 2D,
WebGL, or a shader.

These are reference implementations of standard image-processing techniques,
written from scratch. Use them as a learning base for your own app.

---

## Shared foundation: the preprocessor

Every effect runs the source image through the same preprocessing stage first,
then applies its own transform. Build this once and reuse it.

**Pipeline order:** draw image → blur → grain → gamma → levels (black/white point).

```js
function preprocess(p, buffer, sourceImg, opts) {
  buffer.clear();
  buffer.image(sourceImg, 0, 0);

  // 1. Blur (use your engine's stack/gaussian blur)
  if (opts.blurAmount !== 0) buffer.filter(p.BLUR, opts.blurAmount);

  buffer.loadPixels();
  const px = buffer.pixels;

  for (let i = 0; i < px.length; i += 4) {
    // 2. Grain: same random offset added to R,G,B keeps it monochrome
    if (opts.grainAmount !== 0) {
      const n = (0.5 - Math.random()) * opts.grainAmount * 255;
      px[i]   = clamp(px[i]   + n, 0, 255);
      px[i+1] = clamp(px[i+1] + n, 0, 255);
      px[i+2] = clamp(px[i+2] + n, 0, 255);
    }
    // 3. Gamma: v' = 255 * (v/255)^gamma
    if (opts.gamma !== 1) {
      px[i]   = 255 * Math.pow(px[i]/255,   opts.gamma);
      px[i+1] = 255 * Math.pow(px[i+1]/255, opts.gamma);
      px[i+2] = 255 * Math.pow(px[i+2]/255, opts.gamma);
    }
    // 4. Levels: stretch [black,white] to [0,255]
    if (!(opts.blackPoint === 0 && opts.whitePoint === 255)) {
      const s = 255 / (opts.whitePoint - opts.blackPoint);
      px[i]   = clamp((px[i]   - opts.blackPoint) * s, 0, 255);
      px[i+1] = clamp((px[i+1] - opts.blackPoint) * s, 0, 255);
      px[i+2] = clamp((px[i+2] - opts.blackPoint) * s, 0, 255);
    }
  }
  buffer.updatePixels();
  return buffer;
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
```

**Shared preprocessor controls** (add to every effect's panel):

| Control | Type | Range | Default |
|---|---|---|---|
| Blur | slider | 0–10 | 0 |
| Grain | slider | 0–1, step 0.1 | 0 |
| Gamma | slider | 0.1–2, step 0.1 | 1 |
| Black Point | slider | 0–255 | 0 |
| White Point | slider | 0–255 | 255 |

A recurring trick worth internalizing: **composite over white using alpha**
before measuring brightness, so transparent pixels read as white rather than
black: `value = channel * (a/255) + 255 * (1 - a/255)`.

---

## 1. Distort (displacement map)

Shifts each pixel by an amount driven by a **second image** (the displacement
map). Bright areas of the map push pixels; dark areas leave them alone. This is
the classic Photoshop "Displace" filter.

### Algorithm
1. Load a distortion map image, cover-fit it to the canvas (scale so it fills,
   then center-crop).
2. For each output pixel `(x,y)`, read the map's brightness `m` at the same spot.
3. If `m > threshold`, compute a shift from `m`:
   - `dx = map(m, 0..255, -xStrength..+xStrength)`
   - `dy = map(m, 0..255, -yStrength..+yStrength)`
   - Sample the *source* at `(x+dx, y+dy)` (clamped to bounds) and write it out.
4. If `m <= threshold`, copy the source pixel unchanged.

```js
function distort(p, src, map, opts, out) {
  src.loadPixels(); map.loadPixels(); out.loadPixels();
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (x + y * src.width) * 4;
      const m = map.pixels[(x + y * map.width) * 4]; // red channel = brightness
      if (m > opts.threshold) {
        const dx = mapRange(m, 0, 255, -opts.xStrength, opts.xStrength);
        const dy = mapRange(m, 0, 255, -opts.yStrength, opts.yStrength);
        const sx = clamp(Math.floor(x + dx), 0, src.width - 1);
        const sy = clamp(Math.floor(y + dy), 0, src.height - 1);
        const s = (sx + sy * src.width) * 4;
        out.pixels[o]=src.pixels[s]; out.pixels[o+1]=src.pixels[s+1];
        out.pixels[o+2]=src.pixels[s+2]; out.pixels[o+3]=src.pixels[s+3];
      } else {
        for (let k=0;k<4;k++) out.pixels[o+k]=src.pixels[o+k];
      }
    }
  }
  out.updatePixels();
}
const mapRange=(v,a,b,c,d)=>c+(d-c)*((v-a)/(b-a));
```

### UI controls
| Control | Type | Range | Notes |
|---|---|---|---|
| Distortion map | image upload | — | second image drives the shift |
| Preprocess target | switch | distortion / base | choose which image the preprocessor filters |
| Threshold | slider | 0–255 | map values below this = no shift |
| X Shift Strength | slider | −100–100 | horizontal push |
| Y Shift Strength | slider | −100–100 | vertical push |

**Gotcha:** offering a "preprocess target" switch lets the user blur/adjust
*the map itself* — blurring the map smooths the distortion field, which usually
looks better than a noisy raw map.

---

## 2. Dithering

Reduces the image to few colors while preserving apparent detail via patterned
error. Three pattern modes, each with a mono and a color path.

### Common setup
Work at reduced resolution: divide the canvas into `pixelSize`-sized blocks and
**average each block** to one value (grayscale) or one `{r,g,b}` (color). Run the
dither on that small grid, then paint each grid cell back as a solid rectangle.

### Pattern A — Floyd–Steinberg (error diffusion)
The highest-quality mode. For each cell, snap to the nearest allowed value, then
**push the quantization error to neighbors** with these weights:

```
        current  7/16
 3/16    5/16    1/16      (next row)
```

```js
function floydSteinbergMono(grid, cols, rows, levels) {
  const q = 255 / levels;
  for (let y=0; y<rows; y++) for (let x=0; x<cols; x++) {
    const i = x + y*cols;
    const old = grid[i];
    const val = Math.min(255, old * q);      // scale into range
    const nu  = val > 127 ? 255 : 0;         // quantize
    grid[i] = nu;
    const err = val - nu;
    if (x+1<cols)             grid[i+1]      += 7*err/16/q;
    if (x-1>=0 && y+1<rows)   grid[i+cols-1] += 3*err/16/q;
    if (y+1<rows)             grid[i+cols]   += 5*err/16/q;
    if (x+1<cols && y+1<rows) grid[i+cols+1] += 1*err/16/q;
  }
}
```
For **color**, quantize to a generated palette (see below), diffuse the per-channel
error `(r,g,b)` the same way.

### Pattern B — Bayer (ordered dithering)
A fixed 4×4 threshold matrix — fast, deterministic, retro. No error propagation.

```js
const BAYER4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
function bayerMono(grid, cols, rows, threshold) {
  for (let y=0; y<rows; y++) for (let x=0; x<cols; x++) {
    const t = threshold/128 * (BAYER4[y%4][x%4]/16 * 255);
    grid[x+y*cols] = grid[x+y*cols] > t ? 255 : 0;
  }
}
```
Color Bayer: pick the two nearest palette colors to the cell, output the first if
the Bayer value < 0.5, else the second.

### Pattern C — Random
Threshold each cell against a random value. Grainy, no structure.

### Palette generation (color mode)
Always include black and white, then fill an RGB cube evenly:
```js
function buildPalette(count) {
  const pal = [{r:0,g:0,b:0},{r:255,g:255,b:255}];
  const steps = Math.ceil(Math.cbrt(count - 2));
  const s = 255/(steps-1);
  for (let r=0;r<steps && pal.length<count;r++)
    for (let g=0;g<steps && pal.length<count;g++)
      for (let b=0;b<steps && pal.length<count;b++)
        pal.push({r:Math.round(r*s),g:Math.round(g*s),b:Math.round(b*s)});
  return pal;
}
```
Nearest color uses **luminance-weighted** distance (perceptual), not raw RGB:
`d = (0.299·Δr)² + (0.587·Δg)² + (0.114·Δb)²`.

### UI controls
| Control | Type | Range | Notes |
|---|---|---|---|
| Pattern | switch | F-S / Bayer / Random | algorithm |
| Pixel Size | slider | 1–20 | block size before dithering |
| Color Mode | toggle | on/off | mono vs palette |
| Color Count | slider | 2–32 | *shown only when color mode on* |
| Threshold | slider | 0–255 | *shown only when color mode off* |

**Note the conditional UI:** Color Count and Threshold swap in/out based on the
Color Mode toggle. This "controls depend on other controls" pattern shows up in
several effects.

---

## 3. ASCII

Maps image brightness to text characters. The clever part: it **measures how dark
each glyph actually is** rather than trusting the order of the character string.

### The glyph-darkness trick
Render each character to an offscreen canvas, count its ink coverage, and sort the
character set from lightest to darkest. This makes any font/charset work correctly.

```js
function analyzeGlyph(ch, fontSize=16, font='monospace') {
  const c = document.createElement('canvas');
  c.width = c.height = fontSize*2;
  const ctx = c.getContext('2d', {willReadFrequently:true});
  ctx.font = `${fontSize}px ${font}`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='white'; ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle='black'; ctx.fillText(ch, c.width/2, c.height/2);
  const d = ctx.getImageData(0,0,c.width,c.height).data;
  let sum=0, n=0;
  for (let i=0;i<d.length;i+=4){ if(d[i+3]>0){ n++; sum += (255-(d[i]+d[i+1]+d[i+2])/3)/255; } }
  return n ? sum/n : 0;   // 0 = light, 1 = dark
}
function sortByDarkness(chars) {
  const uniq=[...new Set(chars)];
  const dark=new Map(uniq.map(c=>[c,analyzeGlyph(c)]));
  return uniq.sort((a,b)=>dark.get(a)-dark.get(b)).join('');
}
```

### Sampling
Divide the image into `columns × rows`. For each cell, take the brightness at its
top-left (or average it), map to an index into the darkness-sorted string, invert
so dark pixels get dense glyphs:

```js
function imageToAscii(img, cols, rows, charSet) {
  const chars = sortByDarkness(charSet);
  img.loadPixels();
  const {width:w, height:h, pixels:px} = img;
  const cw = w/cols, ch = h/rows, grid = [];
  for (let r=0; r<rows; r++) {
    const row=[]; const sy=Math.floor(r*ch);
    for (let c=0; c<cols; c++) {
      const i = (sy*w + Math.floor(c*cw))*4;
      const bright = (px[i]+px[i+1]+px[i+2])/3/255;
      const idx = Math.floor((1-bright) * (chars.length-1));
      row.push(chars[idx] || chars[0]);
    }
    grid.push(row);
  }
  return grid;  // array of char arrays; join for text output
}
```

Output as monospaced text (copyable), optionally wrapped in `/* */` for a
code-comment aesthetic, optionally boxed with border glyphs
(`┌─┐│└┘`, `╔═╗`, `┏━┓`, `╭─╮`).

### UI controls
| Control | Type | Range | Notes |
|---|---|---|---|
| Columns | slider | 10–200 | horizontal resolution |
| Rows | slider | 10–150 | vertical resolution |
| Character Set | text input | — | e.g. `" .:-=+*#%@"` |
| Comments | toggle | — | wrap output in `/* */` |
| Show Borders | toggle | — | draw a box |
| Border | switch | single / double / thick | *shown only when borders on* |

Export = copy text to clipboard (not an image download).

---

## 4. Recolor (gradient map)

Maps a per-pixel scalar (brightness, hue, or saturation) through a
**user-defined gradient**, with posterization and noise. This is a "gradient map"
adjustment layer.

### Algorithm
For each pixel:
1. Compute the driver value `t ∈ [0,1]` from the chosen attribute
   (brightness = alpha-composited luma / 765; or hue/360; or saturation/100).
2. Add Perlin/simplex **noise**: sample `noise(x·scale, y·scale)`, gamma-shape it
   (`noise^noiseGamma`), center it, scale by `intensity`, add to `t`.
3. **Posterize** `t` to `steps` discrete bands.
4. Optionally **repeat** the gradient N times (`t = (t·reps) % 1`) for banding.
5. Look up the color by lerping between the two surrounding gradient stops, write.

```js
function recolor(p, buf, opts) {
  const stops = opts.gradientStops.map(s => ({pos:s.position/100, color:p.color(s.color)}));
  buf.loadPixels();
  for (let y=0;y<buf.height;y++) for (let x=0;x<buf.width;x++){
    const i=(x+y*buf.width)*4, r=buf.pixels[i],g=buf.pixels[i+1],b=buf.pixels[i+2],a=buf.pixels[i+3];
    let t;
    switch(opts.colorAttribute){
      case 'hue':        t=p.hue(p.color(r,g,b))/360; break;
      case 'saturation': t=p.saturation(p.color(r,g,b))/100; break;
      default:           { const m=a/255; t=(r+g+b)/765*m + (1-m); } // brightness
    }
    // noise
    let n=p.noise(x*opts.noiseScale, y*opts.noiseScale);
    n=Math.pow(n, opts.noiseGamma);
    t=clamp(t + (n-0.5)*2*opts.noiseIntensity, 0, 1);
    // posterize
    const s=opts.posterizeSteps;
    t = s<=1?0 : s===2?(t<0.5?0:1) : Math.floor(t*s)/(s-1);
    // repeat
    if (opts.gradientRepetitions>1) t=(t*opts.gradientRepetitions)%1;
    // gradient lookup
    const col=sampleGradient(p,t,stops);
    buf.pixels[i]=p.red(col); buf.pixels[i+1]=p.green(col);
    buf.pixels[i+2]=p.blue(col); buf.pixels[i+3]=255;
  }
  buf.updatePixels();
}
function sampleGradient(p,t,stops){
  for(let i=0;i<stops.length-1;i++){
    if(t<stops[i+1].pos){
      const span=stops[i+1].pos-stops[i].pos;
      return p.lerpColor(stops[i].color, stops[i+1].color, (t-stops[i].pos)/span);
    }
  }
  return stops[stops.length-1].color;
}
```

### UI controls
| Control | Type | Range | Notes |
|---|---|---|---|
| Posterize | slider | 2–255 | number of bands |
| Noise Intensity | slider | 0–1, step 0.01 | how much noise perturbs the map |
| Noise Scale | slider | 0.01–1, step 0.01 | noise frequency |
| Noise Gamma | slider | 0.1–5, step 0.1 | reshapes noise distribution |
| Repetitions | slider | 1–10 | tiles the gradient |
| Map | switch | brightness / hue / saturation | driver attribute |
| Colors | gradient editor | — | the gradient stops themselves |

You'll need a **gradient-stop editor** component (list of `{position, color}`);
that's the main custom UI piece here.

---

## 5. CRT (multi-pass WebGL shader)

The most involved: a real-time **shader pipeline** simulating a CRT/LCD panel —
subpixel mask, barrel distortion, RGB convergence error, and a multi-pass bloom.
This one genuinely needs WebGL; you can't do it performantly on the CPU.

### Pass structure
The frame goes through five offscreen buffers before hitting the screen:

```
source ──► [CRT shader] ─────────────────────────┐
       └─► [bright-pass] ─► [blur H] ─► [blur V] ─┤
                                                  ▼
                                            [combine] ──► screen
```

1. **CRT pass** — applies the subpixel mask + distortion + convergence to the image.
2. **Bright pass** — keeps only pixels above `bloomThreshold` (luminance-weighted).
3. **Blur H then Blur V** — separable 13-tap Gaussian on the bright areas (two 1D
   passes = one cheap 2D blur).
4. **Combine** — blends the bloom back over the CRT image via a selectable blend mode.

### Key shader ideas

**Subpixel mask.** Screen space is divided into a grid; each cell lights only its
R, G, or B subpixel. Three panel types differ in cell geometry:
- *Monitor* — circular dots, columns offset vertically (aperture-grille look).
- *LCD* — sharp rectangular RGB stripes (aspect ≈ 0.31×1).
- *TV* — rectangular elements with every-other-column row shift (shadow mask).

A dot is drawn with `smoothstep` so `falloff` controls edge softness:
```glsl
float dot(vec2 p, vec2 center){
  float d = length(p-center);
  float size = dotPitch * dotScale * 0.5;
  return smoothstep(size, size*(1.0-falloff), d);
}
```

**Barrel distortion.** Push UVs outward from center by a squared-radius term:
```glsl
vec2 cc = uv-0.5;
float d = dot(cc,cc)*distortion;
uv = uv + cc*(1.0+d)*d;
```

**RGB convergence.** Sample R and B channels at slightly offset UVs to fake
electron-beam misalignment (the color-fringe look):
```glsl
float r = texture2D(tex, uv + redOffset*strength).r;
float g = texture2D(tex, uv).g;
float b = texture2D(tex, uv + blueOffset*strength).b;
```

**Bloom combine** — output = blend(crt, blurredBright · intensity), where blend is
one of: additive, screen `1-(1-a)(1-b)`, soft-light, lighten `max(a,b)`, or HDR
Reinhard `x·e/(1+x·e)`.

Final output gets gamma correction: `pow(color, 1/2.2)`.

### UI controls
| Control | Type | Range |
|---|---|---|
| Type | switch | Monitor / TV / LCD |
| distortion | slider | 0–0.08, step 0.01 |
| dotScale | slider | 0.01–2, step 0.01 |
| dotPitch | slider | 0–30, step 0.01 |
| falloff | slider | 0.01–1, step 0.01 |
| glowRadius | slider | 0–0.5, step 0.01 |
| glowIntensity | slider | 0–1, step 0.01 |
| Bloom | switch | Screen / Light / HDR |
| bloomThreshold | slider | 0–1, step 0.01 |
| bloomIntensity | slider | 0–5, step 0.01 |
| bloomRadius | slider | 0–10, step 0.01 |
| redConvergenceOffsetX / Y | slider | −1–1, step 0.01 |
| blueConvergenceOffsetX / Y | slider | −1–1, step 0.01 |

The preprocessor for this effect is *also* a shader (blur/grain/levels/gamma in
GLSL) since everything's already on the GPU.

---

## Architecture notes for your own app

A few patterns worth stealing wholesale, since they make adding effects easy:

- **Declarative control config.** Each effect is `(state, handlers) => [controls]`
  — an array of `{type, props}` describing sliders/toggles/switches. A generic
  renderer walks it. Adding a control is data, not JSX.
- **Dirty-flag redraw.** Each effect declares which state keys should trigger
  reprocessing vs. just a redraw, so you only recompute pixels when a relevant
  slider actually moved.
- **CPU effects share a pixel loop shape**: preprocess into a buffer →
  `loadPixels()` → transform → `updatePixels()`. GPU effects (CRT) share a
  buffer-ping-pong shape instead.
- **Vector export.** The grid-based effects (dithering, and the dot/square
  effects) also push each drawn shape into a `_rectangles` array as they go, so
  the same result can be exported as SVG, not just raster.

All five here are standard techniques (displacement mapping, error-diffusion
dithering, luminance-to-glyph mapping, gradient mapping, CRT shader simulation) —
good to learn and reimplement. If you end up closely mirroring the original app,
a credit to its author is the right thing to do.
