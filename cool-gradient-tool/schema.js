/* ══════════════════════════════════════════════════════════════════════════════
   COOL GRADIENT — config schema
   One flat ArtConfig drives every art type (see docs/"Background Art
   Generator — Functional Spec.md"). This file owns the defaults, value ranges,
   the sidebar control groups per type, built-in presets and the settings-file
   validation / migration.
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const TYPES = [
    { id: 'surface',   label: 'Surface'   },
    { id: 'isometric', label: 'Isometric' },
    { id: 'gradient',  label: 'Gradient'  },
    { id: 'shapes',    label: 'Shapes'    },
    { id: 'contours',  label: 'Contours'  },
    { id: 'images',    label: 'Images'    },
  ];

  // Types offered in the UI. The others stay implemented but hidden; add an
  // id here to bring one back.
  const ENABLED_TYPES = ['gradient'];

  const col = (hex, alpha = 1) => ({ hex, alpha });

  // Sliders store integers 0–100, angles 0–360, toggles booleans.
  const DEFAULTS = {
    type: 'gradient',
    seed: 41,
    // shared
    speed: 1.5, count: 55, size: 50, scrollMovement: 0,
    color1: col('#EE0F94'), color2: col('#02B55C'), color3: col('#0B0B0F'), color4: col('#033E6C'),
    invertColors: false,
    noiseIntensity: 19, noiseScale: 0,
    // surface
    surfaceHeight: 57, colorStop1: 0, colorStop2: 23, colorStop3: 52, colorStop4: 100,
    gradientDistortionX: 36, gradientDistortionY: 16,
    curveX: 0, curveY: 0, curveFunnel: 0, fogIntensity: 0, repeat: 0,
    // pattern
    patternEnabled: false, patternSize: 50, patternAmount: 100,
    patternScaleX: 7, patternScaleY: 0, patternPowerX: 58, patternPowerY: 18,
    patternOffsetX: 0, patternOffsetY: 0, patternSpaceX: 50, patternSpaceY: 50,
    // distortion
    distortionScaleX: 20, distortionScaleY: 100, distortionSpeed: 16, distortionIntensity: 56,
    distortionComplexity: 35, distortionDirection: 34, distortionMorphSpeed: 0.8,
    distortionSeed: 34, distortionSmoothness: 100,
    // gradient (gradientMode is a tool extension: the Squarespace schema has no explicit mode field)
    gradientMode: 'linear',
    linearGradientAngle: 228, linearGradientAngleMotion: 0, linearGradientRepeat: 0,
    linearGradientStartColorDistance: 54, linearGradientEndColorDistance: 0,
    radialGradientRadius: 69, radialGradientPositionX: 80, radialGradientPositionY: 70,
    // shapes & motion
    complexity: 40, complexityY: 40, complexityZ: 40, amplitudeY: 50, amplitudeZ: 30,
    speedMorph: 30, speedTravel: 20, travelDirection: 70, isMorphEnabled: true,
    morph: 40, wobble: 30, sizeVariance: 40, rotation: 0, rotationSpeed: 0,
    isBlurEnabled: false, blur: 30,
    isBevelEnabled: false, bevelSize: 40, bevelStrength: 50, bevelRotation: 45,
    // light
    lightIntensity: 50, lightAngle: 135, lightX: 70, lightY: 80, lightZ: 40,
    // isometric
    boxSize: 40, scaleX: 80, scaleY: 50, scaleZ: 80,
    positionFactor: 0, scaleFactor: 0, colorFactor: 60,
    waveEnabled: true, waveSpeed: 30, waveComplexity: 40, waveDepth: 50, waveShadowDepth: 40,
    // contours
    noiseBias: 50, animateNoise: true, noiseRange: 50, offset: 0, cutoff: 20, steps: 30,
    // image scatter
    imageScale: 40, imageCount: 30,
    // overall opacity of the art
    alpha: 100,
  };

  const ANGLE_KEYS = new Set(['linearGradientAngle', 'rotation', 'bevelRotation', 'lightAngle']);
  const COLOR_KEYS = ['color1', 'color2', 'color3', 'color4'];
  const ENUMS = {
    type: ENABLED_TYPES,
    gradientMode: ['linear', 'radial'],
  };

  // Speed and Morph speed run 0–5 in tenths (1 = the calm default).
  const FINE_5 = new Set(['speed', 'distortionMorphSpeed']);

  function range(key) {
    if (key === 'seed') return [0, 999999];
    if (FINE_5.has(key)) return [0, 5];
    if (ANGLE_KEYS.has(key)) return [0, 360];
    return [0, 100];
  }
  const step = key => FINE_5.has(key) ? 0.1 : 1;

  // ── Sidebar control groups ─────────────────────────────────────────────────
  // Control shorthand:
  //   ['key', 'Label']                    slider
  //   { t:'check', k, l }                 toggle
  //   { t:'seg', k, l, opts:[[v,label]] } segmented
  //   { t:'stops' }                       four ascending color stops
  //   { t:'upload' }                      image upload (image scatter)
  // A group may have `when: cfg => bool` to show only in some modes.
  const STOPS = { t: 'stops' };

  const GROUPS = {
    surface: [
      { title: 'Surface', controls: [
        ['surfaceHeight', 'Height'], ['curveX', 'Curve X'], ['curveY', 'Curve Y'],
        ['curveFunnel', 'Funnel'], ['fogIntensity', 'Fog'],
      ]},
      { title: 'Pattern', controls: [
        ['patternScaleX', 'Scale X'], ['patternScaleY', 'Scale Y'],
        ['patternPowerX', 'Power X'], ['patternPowerY', 'Power Y'], ['patternAmount', 'Amount'],
      ]},
      { title: 'Distortion', controls: [
        ['distortionScaleX', 'Scale X'], ['distortionScaleY', 'Scale Y'],
        ['gradientDistortionX', 'Color wobble X'], ['gradientDistortionY', 'Color wobble Y'],
      ]},
      { title: 'Color stops', controls: [STOPS, ['repeat', 'Repeat']] },
    ],
    isometric: [
      { title: 'Shape & size', controls: [
        ['boxSize', 'Box size'], ['scaleX', 'Scale X'], ['scaleY', 'Scale Y'], ['scaleZ', 'Scale Z'],
        ['sizeVariance', 'Size variance'],
      ]},
      { title: 'Wave', controls: [
        { t: 'check', k: 'waveEnabled', l: 'Wave' },
        ['waveSpeed', 'Speed'], ['waveComplexity', 'Complexity'], ['waveDepth', 'Depth'],
        ['waveShadowDepth', 'Shadow depth'],
      ]},
      { title: 'Lighting', controls: [
        ['lightX', 'Light X'], ['lightY', 'Light Y'], ['lightZ', 'Light Z'], ['lightIntensity', 'Intensity'],
      ]},
      { title: 'Color mapping', controls: [
        ['colorFactor', 'Height → color'], ['positionFactor', 'Position → color'], ['scaleFactor', 'Scale → color'],
      ]},
      { title: 'Camera', controls: [['rotation', 'Rotation'], ['rotationSpeed', 'Rotation speed']] },
    ],
    gradient: [
      { title: 'Gradient', top: true, controls: [
        { t: 'seg', k: 'gradientMode', l: 'Mode', opts: [['linear', 'Linear'], ['radial', 'Radial']] },
      ]},
      { title: 'Linear', top: true, when: c => c.gradientMode === 'linear', controls: [
        ['linearGradientAngle', 'Angle'], ['linearGradientAngleMotion', 'Angle motion'],
        ['linearGradientRepeat', 'Repeat'],
        ['linearGradientStartColorDistance', 'Start distance'], ['linearGradientEndColorDistance', 'End distance'],
      ]},
      { title: 'Radial', top: true, when: c => c.gradientMode === 'radial', controls: [
        ['radialGradientRadius', 'Radius'], ['radialGradientPositionX', 'Position X'],
        ['radialGradientPositionY', 'Position Y'],
      ]},
      { title: 'Distortion', controls: [
        ['distortionIntensity', 'Intensity'], ['distortionComplexity', 'Complexity'],
        ['distortionDirection', 'Direction'], ['distortionSmoothness', 'Smoothness'],
      ]},
    ],
    shapes: [
      { title: 'Shape & size', controls: [
        ['count', 'Count'], ['size', 'Size'], ['sizeVariance', 'Size variance'], ['complexity', 'Complexity'],
      ]},
      { title: 'Motion', controls: [
        ['speedTravel', 'Travel speed'], ['travelDirection', 'Direction'],
        { t: 'check', k: 'isMorphEnabled', l: 'Morph' },
        ['speedMorph', 'Morph speed'], ['morph', 'Morph amount'], ['wobble', 'Wobble'],
      ]},
      { title: 'Bevel', controls: [
        { t: 'check', k: 'isBevelEnabled', l: 'Bevel' },
        ['bevelSize', 'Size'], ['bevelStrength', 'Strength'], ['bevelRotation', 'Rotation'],
      ]},
      { title: 'Light', controls: [['lightAngle', 'Angle'], ['lightIntensity', 'Intensity']] },
      { title: 'Blur', controls: [{ t: 'check', k: 'isBlurEnabled', l: 'Blur' }, ['blur', 'Amount']] },
    ],
    contours: [
      { title: 'Noise field', controls: [
        ['complexity', 'Complexity X'], ['complexityY', 'Complexity Y'], ['complexityZ', 'Detail scale'],
        ['amplitudeY', 'Detail amount'], ['amplitudeZ', 'Fine detail'],
        ['offset', 'Offset'], ['noiseRange', 'Range'], ['noiseBias', 'Bias'],
      ]},
      { title: 'Bands', controls: [['steps', 'Steps'], ['cutoff', 'Cutoff']] },
      { title: 'Motion', controls: [{ t: 'check', k: 'animateNoise', l: 'Animate noise' }] },
    ],
    images: [
      { title: 'Image', controls: [
        { t: 'upload' }, ['imageScale', 'Scale'], ['imageCount', 'Count'],
      ]},
      { title: 'Motion', controls: [
        ['speedTravel', 'Travel speed'], ['travelDirection', 'Direction'],
        ['rotationSpeed', 'Rotation speed'], ['wobble', 'Wobble'],
      ]},
      { title: 'Pattern', controls: [
        { t: 'check', k: 'patternEnabled', l: 'Tiled grid' },
        ['patternSize', 'Size'], ['patternSpaceX', 'Spacing X'], ['patternSpaceY', 'Spacing Y'],
        ['patternOffsetX', 'Offset X'], ['patternOffsetY', 'Offset Y'],
      ]},
    ],
  };

  const STOP_KEYS = ['colorStop1', 'colorStop2', 'colorStop3', 'colorStop4'];

  // Types that place their colors along the 0–100 stop axis. Gradient's stops
  // live in the shared Color stops section rather than in its own groups.
  const STOP_TYPES = ['surface', 'gradient'];
  const usesStops = type => STOP_TYPES.includes(type);

  // Every config key a type reads (sliders, toggles, segs, stops).
  function typeKeys(type) {
    const out = new Set(usesStops(type) ? STOP_KEYS : []);
    (GROUPS[type] || []).forEach(g => g.controls.forEach(c => {
      if (Array.isArray(c)) out.add(c[0]);
      else if (c.k) out.add(c.k);
      else if (c.t === 'stops') STOP_KEYS.forEach(k => out.add(k));
    }));
    return [...out];
  }

  // ── Presets: partial configs merged over the type's defaults ───────────────
  const P = (a, b, c, d) => ({ color1: col(a), color2: col(b), color3: col(c), color4: col(d) });
  const PRESETS = {
    surface: [
      { name: 'Obscura', cfg: { seed: 4821, ...P('#0B1026', '#1B6CF9', '#FF6AD5', '#FFE3B3') } },
      { name: 'Dune', cfg: { seed: 112, surfaceHeight: 42, patternScaleX: 4, patternScaleY: 6, patternPowerX: 30, patternPowerY: 30,
        ...P('#2B1B17', '#B4532A', '#E89F5B', '#F7E3C4') } },
      { name: 'Silk', cfg: { seed: 907, surfaceHeight: 72, patternScaleX: 13, patternPowerX: 80, patternPowerY: 0,
        gradientDistortionX: 60, ...P('#0E0E10', '#3A3A40', '#9A9AA6', '#F4F4F6') } },
      { name: 'Lagoon', cfg: { seed: 3310, surfaceHeight: 50, patternScaleX: 5, patternScaleY: 9, fogIntensity: 40,
        ...P('#03202B', '#0B6E73', '#3FD1B5', '#E3FFF4') } },
    ],
    isometric: [
      { name: 'Blocks', cfg: { seed: 77, ...P('#101014', '#2E3BFF', '#1A1F8C', '#C7F9FF') } },
      { name: 'Terrain', cfg: { seed: 5120, boxSize: 25, waveDepth: 75, waveComplexity: 30, colorFactor: 100,
        colorStop1: 0, colorStop2: 40, colorStop3: 70, colorStop4: 100, ...P('#0D1B12', '#2F5D3A', '#8FB573', '#F2EBD3') } },
      { name: 'Candy', cfg: { seed: 404, boxSize: 55, sizeVariance: 70, waveDepth: 35, positionFactor: 60, colorFactor: 0,
        ...P('#FFF1F6', '#FF8FB1', '#B892FF', '#FFE66D') } },
      { name: 'Mono', cfg: { seed: 1999, boxSize: 35, waveShadowDepth: 80, lightIntensity: 80,
        ...P('#050505', '#3C3C3C', '#1C1C1C', '#EDEDED') } },
    ],
    gradient: [
      // the default design, spelled out so it survives future default changes
      { name: "Raelle's gradient", cfg: { seed: 41, speed: 1.5, distortionMorphSpeed: 0.8,
        noiseIntensity: 19, noiseScale: 0, invertColors: false,
        colorStop1: 0, colorStop2: 23, colorStop3: 52, colorStop4: 100,
        distortionIntensity: 56, distortionComplexity: 35, distortionDirection: 34, distortionSmoothness: 100,
        gradientMode: 'linear', linearGradientAngle: 228, linearGradientAngleMotion: 0, linearGradientRepeat: 0,
        linearGradientStartColorDistance: 54, linearGradientEndColorDistance: 0,
        radialGradientRadius: 69, radialGradientPositionX: 80, radialGradientPositionY: 70,
        ...P('#EE0F94', '#02B55C', '#0B0B0F', '#033E6C') } },
      { name: 'Aurora', cfg: { seed: 31, gradientMode: 'linear', linearGradientAngle: 70, distortionIntensity: 55,
        ...P('#061A2B', '#1BC9A5', '#7B5CFF', '#E8FFF7') } },
      { name: 'Sunset', cfg: { seed: 818, gradientMode: 'radial', radialGradientRadius: 80, radialGradientPositionY: 20,
        distortionIntensity: 30, ...P('#FFE8A3', '#FF9F5A', '#E8456B', '#3B1C4A') } },
      { name: 'Glass', cfg: { seed: 2600, gradientMode: 'linear', linearGradientAngle: 120, linearGradientRepeat: 20,
        distortionIntensity: 25, distortionSmoothness: 85, ...P('#DCE8FF', '#9FB8FF', '#F3D6FF', '#FFFFFF') } },
      { name: 'Neon', cfg: { seed: 6061, gradientMode: 'radial', radialGradientRadius: 50,
        distortionIntensity: 45, ...P('#FF2BD6', '#6B2BFF', '#10002B', '#000000') } },
    ],
    shapes: [
      { name: 'Lava', cfg: { seed: 12, count: 45, size: 55, isMorphEnabled: true, morph: 45,
        ...P('#1A0600', '#FF5A1F', '#FFB01F', '#FFF3C4') } },
      { name: 'Bubbles', cfg: { seed: 930, count: 70, size: 30, isBevelEnabled: true, bevelStrength: 70, lightIntensity: 70,
        ...P('#E9F6FF', '#6EC6FF', '#A48CFF', '#FFFFFF') } },
      { name: 'Haze', cfg: { seed: 4410, count: 35, size: 70, isBlurEnabled: true, blur: 55,
        ...P('#0F0A1F', '#FF6AD5', '#3D7BFF', '#FFD6A5') } },
      { name: 'Pop', cfg: { seed: 150, count: 60, size: 40, sizeVariance: 70, isMorphEnabled: false,
        ...P('#FFE14D', '#FF3D7F', '#2D5BFF', '#111111') } },
    ],
    contours: [
      { name: 'Topo', cfg: { seed: 250, steps: 40, cutoff: 0, ...P('#0A0F0A', '#1E3A2B', '#5E8C61', '#D9E8C5') } },
      { name: 'Heat', cfg: { seed: 3141, steps: 25, cutoff: 15, noiseRange: 65, ...P('#0B0033', '#8A00D4', '#FF5E3A', '#FFE66D') } },
      { name: 'Ink', cfg: { seed: 1618, steps: 60, cutoff: 45, complexity: 25, ...P('#F4F1EA', '#1D1D1D', '#3B3B3B', '#000000') } },
      { name: 'Moss', cfg: { seed: 8080, steps: 18, cutoff: 25, amplitudeY: 80, ...P('#EDEBD7', '#6B8F71', '#3E5641', '#1C2B1F') } },
    ],
    images: [
      { name: 'Confetti', cfg: { seed: 72, imageCount: 45, imageScale: 30, rotationSpeed: 30, ...P('#15121F', '#FF6AD5', '#58E1FF', '#FFE66D') } },
      { name: 'Grid', cfg: { seed: 900, patternEnabled: true, patternSize: 35, speedTravel: 15, ...P('#F1EEE6', '#E4572E', '#17BEBB', '#2E282A') } },
      { name: 'Drift', cfg: { seed: 5555, imageCount: 20, imageScale: 55, wobble: 60, speedTravel: 10, ...P('#06131F', '#A7C7E7', '#FFFFFF', '#6A8EAE') } },
    ],
  };

  function defaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

  function presetConfig(base, type, preset) {
    const out = JSON.parse(JSON.stringify(base));
    typeKeys(type).forEach(k => { out[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); });
    Object.assign(out, JSON.parse(JSON.stringify(preset)));
    out.type = type;
    return out;
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  function normHex(h) {
    h = h.trim();
    if (!h.startsWith('#')) h = '#' + h;
    if (h.length === 4) h = '#' + h.slice(1).split('').map(c => c + c).join('');
    return h.toUpperCase();
  }

  // Merges `input` over defaults: missing fields take defaults, unknown fields
  // are dropped, out-of-range values are clamped. Returns a list of what changed.
  function sanitize(input) {
    const cfg = defaults();
    const notes = [];
    const src = (input && typeof input === 'object') ? input : {};
    const missing = [];
    const unknown = [];

    Object.keys(src).forEach(k => {
      if (!(k in DEFAULTS) && k !== 'imageAssetId') unknown.push(k);
    });

    Object.keys(DEFAULTS).forEach(k => {
      if (!(k in src)) { missing.push(k); return; }
      const v = src[k];
      const d = DEFAULTS[k];
      if (COLOR_KEYS.includes(k)) {
        if (v && typeof v.hex === 'string' && HEX_RE.test(normHex(v.hex))) {
          let a = Number(v.alpha);
          if (!isFinite(a)) a = 1;
          const ca = Math.min(1, Math.max(0, a));
          if (ca !== a) notes.push(`${k} opacity clamped`);
          cfg[k] = { hex: normHex(v.hex), alpha: ca };
        } else notes.push(`${k} was not a valid color, reset`);
      } else if (k === 'type' && TYPES.some(t => t.id === v) && !ENABLED_TYPES.includes(v)) {
        notes.push(`the ${v} art type isn't available, switched to ${d}`);
      } else if (ENUMS[k]) {
        if (ENUMS[k].includes(v)) cfg[k] = v;
        else notes.push(`${k} "${v}" unknown, reset to ${d}`);
      } else if (typeof d === 'boolean') {
        cfg[k] = !!v;
      } else {
        const n = Number(v);
        if (!isFinite(n)) { notes.push(`${k} was not a number, reset`); return; }
        const [lo, hi] = range(k);
        const c = Math.min(hi, Math.max(lo, n));
        if (c !== n) notes.push(`${k} clamped to ${c}`);
        cfg[k] = c;
      }
    });

    // stops must stay ascending
    for (let i = 1; i < 4; i++) {
      if (cfg[STOP_KEYS[i]] < cfg[STOP_KEYS[i - 1]]) {
        cfg[STOP_KEYS[i]] = cfg[STOP_KEYS[i - 1]];
        notes.push(`${STOP_KEYS[i]} raised to keep stops ascending`);
      }
    }

    if (typeof src.imageAssetId === 'string') cfg.imageAssetId = src.imageAssetId;
    if (missing.length && missing.length < Object.keys(DEFAULTS).length)
      notes.push(`${missing.length} missing field${missing.length > 1 ? 's' : ''} set to defaults`);
    if (unknown.length) notes.push(`${unknown.length} unknown field${unknown.length > 1 ? 's' : ''} ignored`);
    return { cfg, notes };
  }

  const FORMAT = 'bg-art-settings';
  const VERSION = 1;

  // Bring older settings files forward. Version 1 is the first schema; future
  // versions add a step here per bump so old files keep loading.
  function migrate(file) {
    const out = JSON.parse(JSON.stringify(file));
    if (!out.version) out.version = 1;
    return out;
  }

  root.CG_SCHEMA = {
    TYPES, ENABLED_TYPES, DEFAULTS, GROUPS, PRESETS, STOP_KEYS, COLOR_KEYS, ANGLE_KEYS, FORMAT, VERSION,
    defaults, range, step, typeKeys, usesStops, presetConfig, sanitize, migrate, normHex,
  };
})(window);
