# Background Art Generator — Functional Spec

Sep 30, 2026 · @Camila

## Overview

The tool generates animated, parameter-driven background art in the style of Squarespace 7.1 "section background art", then exports it as a still image or a looping video. It is a standalone editor: pick an art type, tune its settings, preview live, export.

**In scope**

- Every art type, with its own settings group (sliders, toggles, color slots)
- Real-time editing: every change redraws the live preview instantly
- Shared controls: Randomize, Invert colors, seed/variation, speed, play/pause
- Live WebGL preview at any aspect ratio
- Export: PNG, JPG, WebP stills; MP4, WebM, GIF video; seamless-loop option
- Settings files: download a design's settings, upload them later to recreate the exact art or keep editing it

**Out of scope**

- UI design (handled separately); this doc defines behavior, data and rendering only
- Any tie-in to a Squarespace site: no site palettes, color themes or sections. Colors are picked directly in the tool.

Squarespace publishes no source code or public docs for the renderer. Behavior below comes from the help center, the section JSON you shared (a `surface` background), and the public generative-shader techniques these effects are built from. Where a mapping is inferred rather than observed, it is flagged.

## How Squarespace background art works

Each art type is a small WebGL program that draws abstract, animated graphics in the browser from a handful of numbers and four colors. Nothing is pre-rendered; the same settings always draw the same art.

**What is confirmed from public sources**

- Rendering is client-side WebGL. Squarespace wrote its own minimal WebGL library instead of three.js, with one component per background type ([engineering blog](https://engineering.squarespace.com/blog/2022/how-we-use-webgl-at-squarespace-877l9-8lyaw)).
- The feature launched with five generative backgrounds, mostly gradients and organic shapes, with more added later ([engineering blog](https://engineering.squarespace.com/blog/2022/how-we-use-webgl-at-squarespace-877l9-8lyaw)).
- Each type offers preset variations (the small circles on a tile), a Randomize button and, on most types, Invert colors ([help center](https://support.squarespace.com/hc/en-us/articles/4424780922509-Section-background-art)).
- Settings are grouped into collapsible categories that differ per type; third-party guides name them Shape & Size, Motion, Texture and Colors ([Crawford](https://bycrawford.com/blog/squarespace-art-backgrounds-mini-guide), [Coyote Moon](https://www.coyotemooncreative.com/blog/9-essential-design-tips-for-squarespace-71-in-2024)).
- Animated art always gets a pause button, and animation starts paused when the visitor prefers reduced motion. Without WebGL, the section shows a static fallback ([help center](https://support.squarespace.com/hc/en-us/articles/4424780922509-Section-background-art), [engineering blog](https://engineering.squarespace.com/blog/2022/how-we-use-webgl-at-squarespace-877l9-8lyaw)).
- Only on-screen instances animate; off-screen ones are skipped via IntersectionObserver.

**What your section JSON adds**

The `data-current-styles` attribute stores `backgroundMode: "generative"` plus one flat `generative` object. That object carries every parameter for every type; fields a type doesn't use sit at 0. Your sample is `type: "surface"`, and its non-zero fields show exactly which knobs Surface reads. The same flat schema is the basis of this tool's data model (section 4), and of the settings file (section 8).

## Art types

The tool ships six art types. Two names are confirmed (Surface, Isometric); the other four are grouped from the parameter families in the schema and need their Squarespace names checked in the editor.

| Type (`type` value) | Source | Look | Parameter groups it reads |
| --- | --- | --- | --- |
| Surface (`surface`) | Confirmed: your JSON | A rippling, lit 3D sheet with the four colors banded across it | Surface, Pattern, Distortion, Color stops, Texture |
| Isometric (`isometric`?) | Confirmed name: help center | A grid of extruded boxes, heights rising and falling in waves | Box, Wave, Light, Texture |
| Gradient (`gradient`?) | Inferred | Soft linear or radial blend; radial can trail the cursor | Linear, Radial, Distortion, Texture |
| Shapes (`shapes`?) | Inferred | Organic blobs drifting, morphing, optionally blurred or bevelled | Shape, Motion, Bevel, Light, Blur, Texture |
| Contours (`contours`?) | Inferred | Noise field quantized into bands, like a topographic map | Noise field, Motion, Texture |
| Image scatter (`images`?) | Inferred, optional | Copies of an uploaded image or icon scattered and moving | Image, Motion, Texture |

### Controls every type shares

- **Colors**: four color slots, Invert colors (section 5)
- **Variation**: seed stepper plus 3 to 5 preset dots per type
- **Speed**: 0 to 100; 0 renders a still frame
- **Texture**: grain Intensity and grain Scale (`noiseIntensity`, `noiseScale`)
- **Randomize**: rerolls all unlocked settings within safe ranges
- **Play / Pause**, and Scroll movement (`scrollMovement`: art shifts as the preview scrolls)

### Surface

Observed values from your section are listed as defaults.

| Control | Field | Default | Effect |
| --- | --- | --- | --- |
| Surface height | `surfaceHeight` | 57 | Amplitude of the sheet's folds |
| Pattern scale X / Y | `patternScaleX`, `patternScaleY` | 7 / 0 | Frequency of folds along each axis |
| Pattern power X / Y | `patternPowerX`, `patternPowerY` | 58 / 18 | Sharpness of each fold, soft to creased |
| Pattern amount | `patternAmount` | 100 | Mix between flat gradient and full folds |
| Distortion scale X / Y | `distortionScaleX`, `distortionScaleY` | 20 / 100 | Size of the noise warping the sheet |
| Gradient distortion X / Y | `gradientDistortionX`, `gradientDistortionY` | 36 / 16 | How much the color bands wobble |
| Color stops 1–4 | `colorStop1`…`colorStop4` | 0 / 33 / 66 / 100 | Where each color sits along the gradient |
| Curve X / Y, Funnel | `curveX`, `curveY`, `curveFunnel` | 0 | Bends the sheet toward a tube or funnel |
| Fog | `fogIntensity` | 0 | Fades far parts of the sheet toward color 1 |
| Speed | `speed` | 10 | Flow rate of the folds |

### Isometric

- **Shape & size**: box size (`boxSize`), scale X / Y / Z (`scaleX`, `scaleY`, `scaleZ`), size variance (`sizeVariance`)
- **Wave**: on/off (`waveEnabled`), speed, complexity, depth, shadow depth (`waveSpeed`, `waveComplexity`, `waveDepth`, `waveShadowDepth`)
- **Lighting**: light X / Y / Z (`lightX`, `lightY`, `lightZ`), intensity (`lightIntensity`)
- **Color mapping**: how much height, position or scale drives color (`colorFactor`, `positionFactor`, `scaleFactor`)
- **Camera**: rotation and rotation speed (`rotation`, `rotationSpeed`)

### Gradient

- **Linear**: angle, angle motion, repeat, start and end color distance (`linearGradientAngle`, `linearGradientAngleMotion`, `linearGradientRepeat`, `linearGradientStartColorDistance`, `linearGradientEndColorDistance`)
- **Radial**: radius, position X / Y, follow cursor toggle, follow speed (`radialGradientRadius`, `radialGradientPositionX`, `radialGradientPositionY`, `radialGradientFollowCursor`, `radialGradientFollowSpeed`)
- **Distortion**: intensity, complexity, direction, speed, morph speed, smoothness, seed (`distortionIntensity`, `distortionComplexity`, `distortionDirection`, `distortionSpeed`, `distortionMorphSpeed`, `distortionSmoothness`, `distortionSeed`)

### Shapes

- **Shape & size**: count, size, size variance, complexity (`count`, `size`, `sizeVariance`, `complexity`)
- **Motion**: travel speed and direction, morph on/off and speed, morph amount, wobble (`speedTravel`, `travelDirection`, `isMorphEnabled`, `speedMorph`, `morph`, `wobble`)
- **Bevel**: on/off, size, strength, rotation (`isBevelEnabled`, `bevelSize`, `bevelStrength`, `bevelRotation`)
- **Light**: angle and intensity (`lightAngle`, `lightIntensity`)
- **Blur**: on/off and amount (`isBlurEnabled`, `blur`)

### Contours

- **Noise field**: complexity X / Y / Z, amplitude Y / Z, offset, range, bias (`complexity`, `complexityY`, `complexityZ`, `amplitudeY`, `amplitudeZ`, `offset`, `noiseRange`, `noiseBias`)
- **Bands**: steps (number of color bands), cutoff (threshold where color 1 takes over) (`steps`, `cutoff`)
- **Motion**: animate noise toggle, speed (`animateNoise`, `speed`)

### Image scatter

- **Image**: upload (PNG or SVG), scale, count (`imageScale`, `imageCount`)
- **Motion**: travel speed and direction, rotation speed, wobble
- Uses the same pattern spacing and offsets as a tiled grid when Pattern is on (`patternEnabled`, `patternSize`, `patternSpaceX/Y`, `patternOffsetX/Y`)

## Parameter reference

One flat config object drives every type, mirroring Squarespace's `generative` object field for field. Keeping it flat means switching types never loses settings, and one file captures a whole design.

**Value conventions**

- Sliders store integers 0–100 (your sample fits this: `speed: 10`, `surfaceHeight: 57`). Renderers normalize to 0–1, or to a signed −1–1 for directional fields (`travelDirection`, `lightX`, `curveX`).
- Angles (`linearGradientAngle`, `rotation`, `bevelRotation`) store degrees 0–360.
- Toggles are booleans named `is…Enabled`, `…Enabled`, `animateNoise`, `invertColors`, `radialGradientFollowCursor`.
- `seed` is an integer; each preset dot is a stored seed plus overrides.
- Unused fields stay at 0 and are ignored by the active type.

```ts
type ColorRef = { hex: string; alpha: number };   // "#1B6CF9", alpha 0–1

interface ArtConfig {
  type: "surface" | "isometric" | "gradient" | "shapes" | "contours" | "images";
  seed: number;
  // shared
  speed: number; count: number; size: number; scrollMovement: number;
  color1: ColorRef; color2: ColorRef; color3: ColorRef; color4: ColorRef;
  invertColors: boolean;
  noiseIntensity: number; noiseScale: number;           // grain texture
  // surface
  surfaceHeight: number; colorStop1: number; colorStop2: number; colorStop3: number; colorStop4: number;
  gradientDistortionX: number; gradientDistortionY: number;
  curveX: number; curveY: number; curveFunnel: number; fogIntensity: number; repeat: number;
  // pattern
  patternEnabled: boolean; patternSize: number; patternAmount: number;
  patternScaleX: number; patternScaleY: number; patternPowerX: number; patternPowerY: number;
  patternOffsetX: number; patternOffsetY: number; patternSpaceX: number; patternSpaceY: number;
  // distortion
  distortionScaleX: number; distortionScaleY: number; distortionSpeed: number; distortionIntensity: number;
  distortionComplexity: number; distortionDirection: number; distortionMorphSpeed: number;
  distortionSeed: number; distortionSmoothness: number;
  // gradient
  linearGradientAngle: number; linearGradientAngleMotion: number; linearGradientRepeat: number;
  linearGradientStartColorDistance: number; linearGradientEndColorDistance: number;
  radialGradientRadius: number; radialGradientPositionX: number; radialGradientPositionY: number;
  radialGradientFollowCursor: boolean; radialGradientFollowSpeed: number;
  // shapes & motion
  complexity: number; complexityY: number; complexityZ: number; amplitudeY: number; amplitudeZ: number;
  speedMorph: number; speedTravel: number; travelDirection: number; isMorphEnabled: boolean;
  morph: number; wobble: number; sizeVariance: number; rotation: number; rotationSpeed: number;
  isBlurEnabled: boolean; blur: number;
  isBevelEnabled: boolean; bevelSize: number; bevelStrength: number; bevelRotation: number;
  // light
  lightIntensity: number; lightAngle: number; lightX: number; lightY: number; lightZ: number;
  // isometric
  boxSize: number; scaleX: number; scaleY: number; scaleZ: number;
  positionFactor: number; scaleFactor: number; colorFactor: number;
  waveEnabled: boolean; waveSpeed: number; waveComplexity: number; waveDepth: number; waveShadowDepth: number;
  // contours
  noiseBias: number; animateNoise: boolean; noiseRange: number; offset: number; cutoff: number; steps: number;
  // image scatter
  imageScale: number; imageCount: number; imageAssetId?: string;
  // overall opacity of the art, 0–100
  alpha: number;
}
```

`imageAssetId` points at an uploaded image; the image itself is embedded in the settings file (section 8).

## Color system

Every type paints with exactly four colors, each set directly as a hex value plus opacity, and converted to linear RGB before it reaches the shader.

**Slots**

- Each slot is a hex color with its own opacity (0–100%).
- The picker accepts hex, RGB and HSL, plus an eyedropper where the browser supports it.
- A recent-colors row keeps the last 12 colors used, across designs.

**Invert colors**

- Reverses slot order at render time: 1↔4 and 2↔3. Stored slots don't change, so toggling back is lossless.

**Color stops (Surface, Gradient)**

- `colorStop1`–`colorStop4` place each color along the 0–100 gradient axis. Stops must stay ascending; dragging one past its neighbor pushes the neighbor.
- Blending is done in a perceptual space (OKLab) to avoid muddy midpoints, then converted to sRGB for display.

**How types use the four colors**

| Type | Color 1 | Colors 2–3 | Color 4 |
| --- | --- | --- | --- |
| Surface | Background and fog | Middle bands | Highlight band |
| Isometric | Base plane | Box sides (shaded) | Box tops |
| Gradient | Start | Middle stops | End |
| Shapes | Background | Shape fills | Highlight / bevel rim |
| Contours | Below cutoff | Band colors, cycled across `steps` | Top band |
| Image scatter | Background | Tint options | Tint option |

The per-type mapping is a design choice for this tool, not observed Squarespace behavior.

## Rendering engine

Render with WebGL2 through a thin wrapper (OGL or regl, both under 30 KB), one renderer module per type behind a shared interface. Frames must be a pure function of config and time so the preview and every export match exactly.

**Renderer interface**

```ts
interface ArtRenderer {
  init(gl: WebGL2RenderingContext): void;
  setConfig(cfg: ArtConfig, palette: Palette): void;  // rebuild uniforms, geometry only if needed
  render(t: number, width: number, height: number): void;  // t in seconds; no wall-clock reads
  dispose(): void;
}
```

**Per-type technique**

| Type | Technique |
| --- | --- |
| Surface | Subdivided plane (≈256×256 verts); vertex shader displaces Y by `surfaceHeight` × shaped sine pattern (`patternScale`, `patternPower`) warped by simplex noise (`distortionScale`); fragment shader maps height + `gradientDistortion` to the color-stop ramp; Lambert light; exponential fog |
| Isometric | Instanced cubes on an N×N grid, orthographic camera at 35.26° / 45°; per-instance height from wave noise; flat shading per face from the light vector |
| Gradient | Full-screen quad; linear or radial ramp with coordinates domain-warped by FBM noise |
| Shapes | Full-screen quad with 2D signed-distance metaballs (`count` up to \~16); bevel from SDF gradient as a fake normal; blur as SDF smoothstep width |
| Contours | Full-screen quad; 3D simplex FBM, `floor(value × steps)` banding, `cutoff` threshold, smooth edges via `fwidth` |
| Image scatter | Instanced textured quads; positions from seeded PRNG, moved on `travelDirection` |

**Shared building blocks**

- **Noise**: 3D and 4D simplex, FBM with `complexity` mapped to 1–6 octaves.
- **Seed**: a mulberry32 PRNG seeded from `seed` sets noise offsets and instance layouts. Same seed, same art.
- **Time**: `t = seconds × speed/100 × k`, where `k` is tuned per type. Preview advances `t` from `requestAnimationFrame`; export advances it by exactly `1/fps` per frame.
- **Grain**: a final pass adds hash noise per pixel: amount from `noiseIntensity`, grain size from `noiseScale`. Re-randomized each frame when animated.
- **Output**: render into a linear half-float target, then one pass does tone mapping, sRGB conversion and grain.

**Preview behavior**

- Cap device pixel ratio at 2; drop to 1 automatically if a frame takes over 20 ms.
- Pause when the tab is hidden or the canvas is off-screen.
- Start paused when `prefers-reduced-motion` is set.
- Handle `webglcontextlost` by rebuilding from the stored config.
- `speed: 0` renders one frame and stops the loop.

## Export

Exports re-render offscreen at the chosen size, frame by frame, instead of capturing the live preview. That makes output resolution independent of the screen and guarantees no dropped frames.

**Size presets (shared by stills and video)**

| Preset | Pixels |
| --- | --- |
| Current preview aspect | Preview ratio at 2× |
| Desktop hero 16:9 | 1920×1080 |
| 4K 16:9 | 3840×2160 |
| Square | 1080×1080 |
| Portrait / story 9:16 | 1080×1920 |
| Custom | Width × height, lockable ratio |

### Still images

1. Pick the frame: the current preview time, or a time scrubbed on the timeline.
2. Render once into an offscreen canvas at export size.
3. Encode with `canvas.convertToBlob()` (OffscreenCanvas) or `toBlob()`.

| Format | Options |
| --- | --- |
| PNG | Transparent background toggle (skips color 1 fill where the type allows) |
| JPG | Quality 60–100, default 92 |
| WebP | Quality 60–100, lossless toggle |

Sizes above the GPU's `MAX_RENDERBUFFER_SIZE` (often 8192 or 16384 px) render in tiles and stitch on a 2D canvas.

### Video

1. Set duration (2–60 s), frame rate (24, 30, 60) and quality (bitrate preset).
2. For each frame `i`, render at `t = start + i/fps`, then wrap the canvas in a `VideoFrame`.
3. Encode with WebCodecs `VideoEncoder` and mux with a library such as Mediabunny (successor to mp4-muxer / webm-muxer).
4. Show progress and a cancel button; encoding runs in a Web Worker with an OffscreenCanvas so the UI stays responsive.

| Format | Codec | Notes |
| --- | --- | --- |
| MP4 | H.264 (`avc1`) | Default; plays everywhere, including Squarespace and Instagram. Width and height rounded to even numbers; 4K needs level 5.1 |
| WebM | VP9 | Smaller files; supports alpha if transparency is on |
| MP4 (HEVC) | H.265 | Offered only when `VideoEncoder.isConfigSupported` says yes |
| GIF | Palette-quantized (gifenc) | Capped at 800 px wide and 15 fps to keep files small |

When WebCodecs is missing, fall back to `canvas.captureStream()` + `MediaRecorder` in real time, and warn that frames may drop.

### Seamless loop

On by default for video. Every time-driven input is made periodic over the video length `T`:

- Noise is sampled on a circle in an extra dimension: 3D noise uses `(x, y) + r·(cos θ, sin θ)` or 4D noise uses `(x, y, r·cos θ, r·sin θ)`, with `θ = 2π·t/T`.
- Linear travel (`speedTravel`, pattern scroll) is snapped so total distance over `T` is a whole number of pattern periods.
- Rotation speeds are snapped to whole turns per `T`.
- Grain uses a frame-index hash, so it has no seam to hide.

The last frame rendered is `t = T − 1/fps`, so frame 0 follows it cleanly. Snapping changes speed slightly; the UI should show the adjusted speed.

## Settings files, presets and randomize

Any design can be downloaded as a small settings file and uploaded later to redraw the exact same art, frame for frame, ready to edit or export again. Presets and saved designs use the same format.

### Settings file

```json
{
  "format": "bg-art-settings",
  "version": 1,
  "name": "Obscura hero",
  "createdAt": "2026-09-30T13:48:00-07:00",
  "config": { "type": "surface", "seed": 4821, "speed": 10, "color1": { "hex": "#1B6CF9", "alpha": 1 }, … },
  "export": { "width": 1920, "height": 1080, "format": "mp4", "fps": 30, "duration": 8, "loop": true, "time": 0 },
  "assets": { "img_01": "data:image/png;base64,…" }
}
```

- **What's saved**: the full `ArtConfig` (every type's fields, not just the active one), the seed, the last export settings and preview time, and any uploaded images embedded as data URLs. Same file in, identical frames out.
- **Download settings**: one button; filename from the design name, e.g. `obscura-hero.bgart.json`. The export dialog also has a "Include settings file" checkbox so every exported image or video gets a matching file.
- **Upload settings**: file picker, or drag and drop onto the preview. Accepts `.json` and `.bgart.json`. Loading replaces the current design, with undo to get it back.
- **Validation**: check `format`; missing fields take the type's defaults, unknown fields are ignored, out-of-range values are clamped. If anything was adjusted, show a short notice listing what changed.
- **Versioning**: `version` goes up when the schema changes; the loader migrates older files forward so old settings keep working.
- **Settings inside PNGs (optional)**: write the same JSON into a PNG `tEXt` chunk, so dropping an exported PNG back in restores its settings too.

**Presets**

- Each type ships 3–5 built-in presets, shown as the variation dots. A preset is a partial config merged over the type's defaults.
- Users can save their own presets, rename, duplicate and delete them.

**Randomize**

- Rerolls `seed` and every unlocked slider within a per-type safe range (e.g. Surface `surfaceHeight` 20–80, not 0–100), so results stay usable.
- Colors are left alone by default; a separate "Randomize colors" picks from the current palette.
- Each slider can be locked so Randomize skips it.
- Undo / redo covers every change, including Randomize (history of at least 50 steps).

**Save and share**

- Autosave the current design locally so a refresh or crash doesn't lose work.
- Share link: settings compressed and base64url-encoded into the URL hash. Uploaded images are left out, so designs using them need the file.

## Open questions and assumptions

- [ ] **Type list**: confirm the current art type names and their `type` strings by clicking through each tile in the Squarespace editor and copying one section's JSON per type. Only `surface` and the name Isometric are verified.
- [ ] **Per-type fields**: the field-to-type grouping for the four inferred types comes from field names, not observation. One exported JSON per type settles it (non-zero fields = used fields).
- [ ] **Slider ranges**: assumed 0–100 for all sliders; check whether any Squarespace slider goes negative or past 100.
- [ ] **Image scatter**: keep it in v1 or drop it; it is the least certain type.

* Squarespace's renderer code is not public and isn't reused here. The tool reproduces the behavior and data format with its own shaders, and should not use Squarespace's name or preset artwork in the product.

## Sources

- [Section background art](https://support.squarespace.com/hc/en-us/articles/4424780922509-Section-background-art), Squarespace Help Center
- [Styling your site background](https://support.squarespace.com/hc/en-us/articles/20495023252109-Styling-your-site-background), Squarespace Help Center (names the Isometric type)
- [How we use WebGL at Squarespace](https://engineering.squarespace.com/blog/2022/how-we-use-webgl-at-squarespace-877l9-8lyaw), Squarespace Engineering Blog
- [Squarespace Art Backgrounds: Mini Guide](https://bycrawford.com/blog/squarespace-art-backgrounds-mini-guide), by Crawford
- [9 Essential Squarespace 7.1 Design Tips](https://www.coyotemooncreative.com/blog/9-essential-design-tips-for-squarespace-71-in-2024), Coyote Moon Creative
- The Obscura section HTML you shared (`data-current-styles` JSON)
