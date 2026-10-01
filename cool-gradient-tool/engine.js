/* ══════════════════════════════════════════════════════════════════════════════
   COOL GRADIENT — WebGL2 render engine
   Frames are a pure function of (config, time): render() never reads the wall
   clock, so the live preview and every export draw identical pixels.

   Pipeline per frame:
     1. the active type draws into a linear half-float target (MSAA for 3D types)
     2. one post pass: un-premultiply → tone map → sRGB → grain → overall alpha

   Seamless loop: every time-driven input is periodic over the loop length T.
   Noise time moves on a circle in the extra noise dimensions (tv()); linear
   travel and rotation are snapped to whole periods per T (snap()).
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;

  // ── Color ──────────────────────────────────────────────────────────────────
  function hexToRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  function linToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  function oklabToLin([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }
  const clamp01 = v => Math.min(1, Math.max(0, v));

  // Four slots (Invert reverses order at render time) + a 256px ramp placing
  // them at the color stops, blended in OKLab, stored as sRGB bytes.
  function buildPalette(cfg) {
    let slots = [cfg.color1, cfg.color2, cfg.color3, cfg.color4];
    if (cfg.invertColors) slots = slots.slice().reverse();
    const lin = slots.map(c => ({ rgb: hexToRgb(c.hex).map(toLin), a: clamp01(c.alpha) }));
    const lab = lin.map(c => linToOklab(c.rgb));
    const stops = [cfg.colorStop1, cfg.colorStop2, cfg.colorStop3, cfg.colorStop4].map(v => v / 100);
    for (let i = 1; i < 4; i++) stops[i] = Math.max(stops[i], stops[i - 1]);

    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let j = 0;
      while (j < 3 && x > stops[j + 1]) j++;
      let rgb, a;
      if (x <= stops[0]) { rgb = lin[0].rgb; a = lin[0].a; }
      else if (x >= stops[3]) { rgb = lin[3].rgb; a = lin[3].a; }
      else {
        const span = stops[j + 1] - stops[j];
        const t = span > 1e-6 ? (x - stops[j]) / span : 1;
        const L = lab[j].map((v, k) => v + (lab[j + 1][k] - v) * t);
        rgb = oklabToLin(L);
        a = lin[j].a + (lin[j + 1].a - lin[j].a) * t;
      }
      ramp[i * 4 + 0] = Math.round(clamp01(toSrgb(clamp01(rgb[0]))) * 255);
      ramp[i * 4 + 1] = Math.round(clamp01(toSrgb(clamp01(rgb[1]))) * 255);
      ramp[i * 4 + 2] = Math.round(clamp01(toSrgb(clamp01(rgb[2]))) * 255);
      ramp[i * 4 + 3] = Math.round(a * 255);
    }
    const flat = new Float32Array(16);
    lin.forEach((c, i) => { flat.set([c.rgb[0], c.rgb[1], c.rgb[2], c.a], i * 4); });
    return { flat, ramp };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ── Matrices (column-major) ────────────────────────────────────────────────
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function perspective(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  }
  function ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }
  function lookAt(e, c, u) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); }
  function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }

  // ── GLSL ───────────────────────────────────────────────────────────────────
  // 4D simplex noise: Ian McEwan / Stefan Gustavson, webgl-noise (MIT).
  const NOISE = `
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
float permute(float x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}
float snoise(vec4 v) {
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
      i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));
  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
               + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}
`;

  const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_res;      // full output size (px)
uniform vec2 u_tile;     // tile origin (px, GL coords)
uniform vec4 u_tileT;    // clip-space tile transform for 3D passes
uniform float u_sec;
uniform float u_m;       // motion multiplier from Speed
uniform float u_loop;
uniform float u_loopT;
uniform vec4 u_seedOff;
uniform sampler2D u_ramp;
uniform vec4 u_c[4];     // linear rgb + alpha, invert already applied
uniform float u_bgA;     // 0 when exporting with a transparent background
uniform vec2 u_scroll;
${NOISE}
// Noise time vector. Linear when not looping; a circle of equal arc length
// per second when looping, so the loop closes without changing the pace.
vec2 tv(float k) {
  float s = u_m * k;
  if (u_loop > 0.5) {
    float th = 6.28318530718 * u_sec / u_loopT;
    float r = s * u_loopT / 6.28318530718;
    return r * vec2(cos(th), sin(th));
  }
  return vec2(s * u_sec, 0.0);
}
float fbm(vec2 p, vec2 t, int oct, float gain) {
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * snoise(vec4(p, t) + u_seedOff + float(i) * vec4(13.1, 7.7, 3.3, 5.9));
    n += a; p *= 2.03; t *= 1.31; a *= gain;
  }
  return s / n;
}
vec4 ramp(float x) { return texture(u_ramp, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)); }
float tri(float x) { return 1.0 - abs(mod(x, 2.0) - 1.0); }
vec4 tileClip(vec4 p) { p.xy = p.xy * u_tileT.xy + u_tileT.zw * p.w; return p; }
vec4 bg() { return vec4(u_c[0].rgb, u_c[0].a * u_bgA); }
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;

  // Fragment-only helpers (gl_FragCoord doesn't exist in vertex shaders).
  const FRAG = COMMON + `
vec2 fragQ() {
  vec2 p = (gl_FragCoord.xy + u_tile) / u_res;
  return (p - 0.5) * vec2(u_res.x / u_res.y, 1.0);
}
`;

  const VS_QUAD = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

  // ── Gradient ──
  const FS_GRADIENT = FRAG + `
out vec4 o;
uniform float u_mode, u_angle, u_rep, u_sd, u_ed, u_radius;
uniform vec2 u_rpos, u_drift;
uniform float u_dInt, u_dFreq, u_dMorph, u_dGain;
uniform int u_dOct;
void main() {
  float asp = u_res.x / u_res.y;
  vec2 q = fragQ() + u_scroll;
  if (u_dInt > 0.0) {
    vec2 tt = tv(u_dMorph);
    vec2 pp = q * u_dFreq + u_drift;
    vec2 w = vec2(fbm(pp, tt, u_dOct, u_dGain), fbm(pp + vec2(17.3, -9.1), tt, u_dOct, u_dGain));
    q += w * u_dInt;
  }
  float c;
  if (u_mode < 0.5) {
    vec2 d = vec2(cos(u_angle), sin(u_angle));
    float ext = abs(d.x) * asp + abs(d.y);
    c = dot(q, d) / ext + 0.5;
  } else {
    vec2 ctr = (u_rpos - 0.5) * vec2(asp, 1.0);
    c = length(q - ctr) / u_radius;
  }
  c = (c - u_sd) / max(1.0 - u_sd - u_ed, 0.05);
  c = u_rep > 1.001 ? tri(c * u_rep) : clamp(c, 0.0, 1.0);
  o = premul(ramp(c));
}
`;

  // ── Contours ──
  const FS_CONTOURS = FRAG + `
out vec4 o;
uniform vec2 u_freq;
uniform float u_fz, u_ay, u_az, u_off, u_range, u_bias, u_steps, u_cut, u_anim;
vec4 bandCol(float b) {
  if (b / u_steps < u_cut) return bg();
  float bc = ceil(u_cut * u_steps - 1e-4);
  float k = clamp((b - bc) / max(u_steps - 1.0 - bc, 1.0), 0.0, 1.0);
  return k < 0.5 ? mix(u_c[1], u_c[2], k * 2.0) : mix(u_c[2], u_c[3], k * 2.0 - 1.0);
}
void main() {
  vec2 q = fragQ() + u_scroll;
  vec2 tt = u_anim > 0.5 ? tv(0.22) : vec2(0.0);
  vec2 p = q * u_freq + vec2(0.0, u_off);
  float v = snoise(vec4(p, tt) + u_seedOff);
  v += u_ay * 0.5 * snoise(vec4(p * 2.03 + 5.2, tt * 1.3) + u_seedOff);
  v += u_az * 0.25 * snoise(vec4(p * u_fz + 11.7, tt * 1.7) + u_seedOff);
  v /= 1.0 + u_ay * 0.5 + u_az * 0.25;
  v = clamp(v * u_range + 0.5, 0.0, 1.0);
  v = clamp(pow(v, u_bias), 0.0, 0.99999);
  float s = v * u_steps;
  float b = floor(s), f = fract(s);
  float w = max(fwidth(s), 1e-4);
  vec4 c0 = bandCol(b), c1 = bandCol(min(b + 1.0, u_steps - 1.0));
  o = premul(mix(c0, c1, smoothstep(1.0 - w, 1.0, f)));
}
`;

  // ── Shapes: 2D metaballs ──
  const FS_SHAPES = FRAG + `
out vec4 o;
uniform vec4 u_balls[16];
uniform int u_count;
uniform float u_rad, u_wob, u_morphOn, u_morph, u_morphK, u_freq;
uniform vec2 u_travel;
uniform float u_bevOn, u_bevSize, u_bevStr, u_lightI, u_blurOn, u_blur;
uniform vec2 u_L, u_Lb;
void main() {
  float asp = u_res.x / u_res.y;
  vec2 q = fragQ() + u_scroll;
  if (u_morphOn > 0.5) {
    vec2 tt = tv(u_morphK);
    q += u_morph * 0.12 * vec2(snoise(vec4(q * u_freq, tt) + u_seedOff),
                               snoise(vec4(q * u_freq + 31.7, tt) + u_seedOff));
  }
  float mg = u_rad * 2.5;
  vec2 lo = vec2(-asp * 0.5, -0.5) - mg;
  vec2 span = vec2(asp, 1.0) + 2.0 * mg;
  vec2 tw = tv(0.35);
  float f = 0.0, cm = 0.0;
  vec2 gf = vec2(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    vec4 b = u_balls[i];
    vec2 c = lo + mod(b.xy * span + u_travel * span, span);
    float fi = float(i) * 3.17;
    c += u_wob * 0.08 * vec2(snoise(vec4(fi, 0.0, tw) + u_seedOff), snoise(vec4(0.0, fi + 9.0, tw) + u_seedOff));
    float r = u_rad * b.z;
    vec2 d = q - c;
    float d2 = max(dot(d, d), 1e-5);
    float k = r * r / d2;
    f += k; cm += k * b.w;
    gf += -2.0 * k * d / d2;
  }
  cm /= max(f, 1e-5);
  float fw = fwidth(f);
  float bw = u_blurOn > 0.5 ? u_blur : 0.0;
  float mask = smoothstep(1.0 - fw - bw * 0.9, 1.0 + fw + bw * 2.0, f);
  vec4 fill = mix(u_c[1], u_c[2], cm);

  // Fake normal from the field gradient: a dome that is steep at the edge.
  // Bevel: a rim that is steep at the edge and flat inside. Otherwise a soft
  // dome h = 1 − 1/f, whose gradient fades smoothly toward the center.
  float bs = u_bevSize;
  float t = clamp((f - 1.0) / bs, 0.0, 1.0);
  vec2 gh = u_bevOn > 0.5 ? gf * (6.0 * t * (1.0 - t) / bs) * 0.03 : gf / max(f * f, 1e-3) * 0.05;
  vec3 n = normalize(vec3(-gh, 1.0));
  vec3 L = normalize(vec3(u_L, 0.8));
  // shading is relative to a flat, facing-up normal so the interior keeps the fill color
  float lam = (0.45 + 0.75 * max(dot(n, L), 0.0)) / (0.45 + 0.75 * L.z);
  vec3 rgb = fill.rgb * mix(1.0, lam, u_lightI);
  if (u_bevOn > 0.5) {
    float e = 1.0 - t;
    float hi = clamp(dot(n.xy, u_Lb) * 1.6, 0.0, 1.0) * e * u_bevStr;
    float sh = clamp(-dot(n.xy, u_Lb) * 1.6, 0.0, 1.0) * e * u_bevStr;
    rgb = mix(rgb, u_c[3].rgb, hi);
    rgb *= 1.0 - 0.6 * sh;
  }
  o = premul(mix(bg(), vec4(rgb, fill.a), mask));
}
`;

  // ── Surface: displaced, lit sheet ──
  const VS_SURFACE = COMMON + `
in vec2 a_uv;
uniform mat4 u_mvp;
uniform float u_S, u_h, u_fx, u_fy, u_px, u_py, u_amt, u_dsx, u_dsy, u_gdx, u_gdy, u_cx, u_cy, u_fun, u_phase;
out float v_c;
out vec3 v_n;
out vec3 v_w;
vec3 sheet(vec2 w, vec2 tt, out float cc) {
  vec2 pw = w * 0.5;
  vec2 warp = vec2(snoise(vec4(pw * u_dsx, tt) + u_seedOff), snoise(vec4(pw * u_dsy + 7.1, tt) + u_seedOff));
  vec2 ww = pw + warp * 0.45;
  float fx = pow(0.5 + 0.5 * sin(ww.x * u_fx + u_phase), u_px);
  float wy = step(0.0001, u_fy);
  float fy = pow(0.5 + 0.5 * sin(ww.y * u_fy + u_phase * 0.7), u_py);
  float pat = (fx + fy * wy) / (1.0 + wy);
  float nz = 0.5 + 0.5 * snoise(vec4(ww * 0.35, tt * 0.6) + u_seedOff + 3.0);
  float h = mix(nz, pat, u_amt);
  float flat_ = clamp(0.5 - w.y / (u_S * 1.2), 0.0, 1.0);
  cc = mix(flat_, h, u_amt)
     + u_gdx * 0.35 * snoise(vec4(pw * 0.6 + 13.0, tt) + u_seedOff)
     + u_gdy * 0.35 * snoise(vec4(pw * vec2(0.3, 1.2) + 27.0, tt) + u_seedOff);
  float y = h * u_h;
  y += u_cx * 0.05 * w.x * w.x + u_cy * 0.05 * w.y * w.y;
  y -= u_fun * 3.0 * exp(-dot(w, w) * 0.12);
  return vec3(w.x, y, w.y);
}
void main() {
  vec2 tt = tv(0.12) + u_scroll * 2.0;
  vec2 w = (a_uv * 2.0 - 1.0) * u_S;
  float cc, c1, c2;
  float e = 2.0 * u_S / 256.0;
  vec3 P = sheet(w, tt, cc);
  vec3 Px = sheet(w + vec2(e, 0.0), tt, c1);
  vec3 Pz = sheet(w + vec2(0.0, e), tt, c2);
  v_n = normalize(cross(Pz - P, Px - P));
  v_c = cc;
  v_w = P;
  gl_Position = tileClip(u_mvp * vec4(P, 1.0));
}
`;
  const FS_SURFACE = FRAG + `
in float v_c;
in vec3 v_n;
in vec3 v_w;
out vec4 o;
uniform vec3 u_eye;
uniform float u_fog, u_rep;
void main() {
  float c = u_rep > 1.001 ? tri(v_c * u_rep) : clamp(v_c, 0.0, 1.0);
  vec4 col = ramp(c);
  vec3 n = normalize(v_n);
  if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(-0.35, 1.0, 0.45));
  float lam = max(dot(n, L), 0.0);
  vec3 rgb = col.rgb * (0.5 + 0.6 * lam);
  float d = length(v_w - u_eye);
  float fg = 1.0 - exp(-max(d - 6.0, 0.0) * u_fog * 0.18);
  o = premul(mix(vec4(rgb, col.a), bg(), fg));
}
`;

  // ── Isometric: instanced boxes ──
  const VS_ISO = COMMON + `
in vec3 a_pos;
in vec3 a_nrm;
uniform mat4 u_vp;
uniform int u_n;
uniform float u_cell, u_fpx, u_fpz, u_hs, u_var, u_waveOn, u_wf, u_wk, u_wd;
out vec3 v_n;
out float v_h;
out float v_pos;
out float v_s;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  int id = gl_InstanceID;
  vec2 g = vec2(float(id % u_n), float(id / u_n)) - float(u_n - 1) * 0.5;
  float r = hash12(g + u_seedOff.xy * 10.0);
  float s = 1.0 - u_var * r * 0.75;
  float hn = 0.35;
  if (u_waveOn > 0.5)
    hn = 0.5 + 0.5 * snoise(vec4(g * u_cell * u_wf + u_scroll * 4.0, tv(u_wk)) + u_seedOff);
  float h = (0.08 + hn * u_wd) * u_hs * mix(1.0, s, 0.6);
  vec3 P = vec3(a_pos.x * u_cell * u_fpx * s + g.x * u_cell,
                a_pos.y * h,
                a_pos.z * u_cell * u_fpz * s + g.y * u_cell);
  v_n = a_nrm;
  v_h = hn;
  v_pos = (g.x + g.y) / float(u_n) * 0.5 + 0.5;
  v_s = s;
  gl_Position = tileClip(u_vp * vec4(P, 1.0));
}
`;
  const FS_ISO = FRAG + `
in vec3 v_n;
in float v_h;
in float v_pos;
in float v_s;
out vec4 o;
uniform vec3 u_L;
uniform float u_li, u_shadow, u_cf, u_pf, u_sf;
void main() {
  vec3 n = normalize(v_n);
  vec4 col;
  if (n.y > 0.5) {
    float sum = u_cf + u_pf + u_sf;
    float coord = (u_cf * v_h + u_pf * v_pos + u_sf * (1.0 - v_s)) / max(sum, 1e-3);
    col = mix(u_c[3], ramp(coord), clamp(sum, 0.0, 1.0));
  } else if (abs(n.x) > 0.5) col = u_c[1];
  else col = u_c[2];
  float lam = max(dot(n, u_L), 0.0);
  vec3 rgb = col.rgb * mix(1.0, 0.3 + 0.9 * lam, u_li);
  if (n.y < 0.5) rgb *= mix(1.0, 0.3 + 0.7 * v_h, u_shadow);
  o = premul(vec4(rgb, col.a));
}
`;

  // ── Image scatter: instanced textured quads ──
  const VS_IMG = COMMON + `
in vec2 a_corner;
in vec4 a_i0;   // x, y, scale variance, rotation phase
in vec4 a_i1;   // tint index, wobble phase, rotation direction, -
uniform float u_size, u_imgAsp, u_rotA, u_wob, u_pattern;
uniform vec2 u_travel;
uniform vec4 u_grid;   // cols, rows, cellW, cellH (pattern mode)
uniform vec2 u_goff;   // pattern row / column offsets
out vec2 v_uv;
out float v_tint;
void main() {
  float asp = u_res.x / u_res.y;
  float sz, ang;
  vec2 c;
  if (u_pattern > 0.5) {
    int id = gl_InstanceID;
    int cols = int(u_grid.x);
    float col = float(id % cols), row = float(id / cols);
    vec2 cell = u_grid.zw;
    vec2 total = vec2(u_grid.x, u_grid.y) * cell;
    vec2 base = vec2(col * cell.x + mod(row, 2.0) * u_goff.x * cell.x,
                     row * cell.y + mod(col, 2.0) * u_goff.y * cell.y);
    c = vec2(-total.x * 0.5, -total.y * 0.5) + mod(base + u_travel + u_scroll, total);
    sz = u_size;
    ang = u_rotA;
  } else {
    sz = u_size * a_i0.z;
    float mg = sz * 0.8;
    vec2 lo = vec2(-asp * 0.5, -0.5) - mg;
    vec2 span = vec2(asp, 1.0) + 2.0 * mg;
    c = lo + mod(a_i0.xy * span + u_travel * span + u_scroll, span);
    ang = a_i0.w * 6.2831853 + u_rotA * a_i1.z;
  }
  vec2 tw = tv(0.4);
  c += u_wob * 0.05 * vec2(snoise(vec4(a_i1.y * 10.0, 0.0, tw) + u_seedOff),
                           snoise(vec4(0.0, a_i1.y * 10.0 + 4.0, tw) + u_seedOff));
  vec2 k = a_corner * vec2(sz * u_imgAsp, sz);
  k = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * k;
  vec2 P = c + k;
  v_uv = a_corner + 0.5;
  v_tint = a_i1.x;
  gl_Position = tileClip(vec4(P.x / (asp * 0.5), P.y / 0.5, 0.0, 1.0));
}
`;
  const FS_IMG = FRAG + `
in vec2 v_uv;
in float v_tint;
out vec4 o;
uniform sampler2D u_img;
void main() {
  vec4 t = texture(u_img, v_uv);
  vec4 tint = v_tint < 0.5 ? u_c[1] : (v_tint < 1.5 ? u_c[2] : u_c[3]);
  float a = t.a * tint.a;
  o = vec4(t.rgb * tint.rgb * a, a);
}
`;

  // ── Post: tone map, sRGB, grain, overall opacity ──
  const FS_POST = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform vec2 u_tile;
uniform float u_grain, u_gsize, u_frame, u_alpha;
out vec4 o;
float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 s = texelFetch(u_scene, ivec2(gl_FragCoord.xy), 0);
  float a = clamp(s.a, 0.0, 1.0);
  vec3 rgb = a > 1e-5 ? s.rgb / a : vec3(0.0);
  rgb = rgb / (1.0 + max(rgb - 1.0, 0.0) * 0.5);
  vec3 c = toSrgb(clamp(rgb, 0.0, 1.0));
  if (u_grain > 0.0) {
    vec2 cell = floor((gl_FragCoord.xy + u_tile) / u_gsize);
    float n = hash(vec3(cell, u_frame)) + hash(vec3(cell + 17.0, u_frame + 3.0)) - 1.0;
    c += n * u_grain;
  }
  a *= u_alpha;
  o = vec4(clamp(c, 0.0, 1.0) * a, a);
}
`;

  const SHADERS = {
    gradient: [VS_QUAD, FS_GRADIENT],
    contours: [VS_QUAD, FS_CONTOURS],
    shapes:   [VS_QUAD, FS_SHAPES],
    surface:  [VS_SURFACE, FS_SURFACE],
    isometric:[VS_ISO, FS_ISO],
    images:   [VS_IMG, FS_IMG],
    post:     [VS_QUAD, FS_POST],
  };
  const MESH_TYPES = new Set(['surface', 'isometric']);
  const TRANSPARENT_OK = new Set(['isometric', 'shapes', 'contours', 'images']);
  const GRID = 256;
  const MAX_INST = 4096;

  // Loop snapping: a constant rate becomes a whole number of `period`s per T.
  function snapRate(rate, period, loop, T) {
    if (!loop || !rate) return rate;
    let n = Math.round(rate * T / period);
    if (n === 0) n = Math.sign(rate);
    return n * period / T;
  }

  // Default image for Image scatter until one is uploaded: a four-point sparkle.
  function sparkle() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 - Math.PI / 2, r = i % 2 ? 34 : 124;
      const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath();
    x.fill();
    return c;
  }
  let SPARKLE = null;

  // ── Engine ─────────────────────────────────────────────────────────────────
  class Engine {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = opts;
      const gl = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
        preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.snapInfo = [];
      this.init();
    }

    // (Re)creates every GL resource; also used after webglcontextrestored.
    init() {
      const gl = this.gl;
      this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
      const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      this.maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), vp[0], vp[1]);
      this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
      this.progs = {};
      this.locs = new Map();
      this.target = null;
      this.imgSource = null;
      this.instSeed = null;
      this.buildGeometry();

      this.rampTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(1024));

      this.imgTex = gl.createTexture();
      if (this.cfg) this.setConfig(this.cfg, this.images, true);
    }

    buildGeometry() {
      const gl = this.gl;
      // full-screen quad
      this.quadVAO = gl.createVertexArray();
      gl.bindVertexArray(this.quadVAO);
      const qb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      // surface grid
      const N = GRID + 1;
      const uv = new Float32Array(N * N * 2);
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        uv[(z * N + x) * 2] = x / GRID;
        uv[(z * N + x) * 2 + 1] = z / GRID;
      }
      const idx = new Uint32Array(GRID * GRID * 6);
      let k = 0;
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const a = z * N + x, b = a + 1, c = a + N, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      this.gridCount = idx.length;
      this.gridVAO = gl.createVertexArray();
      gl.bindVertexArray(this.gridVAO);
      const gb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, gb);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

      // unit box: x,z in [-0.5,0.5], y in [0,1] (bottom face omitted: never visible)
      const faces = [
        [[0, 1, 0], [[-.5, 1, -.5], [-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5]]],
        [[1, 0, 0], [[.5, 0, .5], [.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5]]],
        [[-1, 0, 0], [[-.5, 0, -.5], [-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5]]],
        [[0, 0, 1], [[-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]]],
        [[0, 0, -1], [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5]]],
      ];
      const box = [];
      faces.forEach(([n, v]) => [0, 1, 2, 0, 2, 3].forEach(i => box.push(...v[i], ...n)));
      this.boxCount = box.length / 6;
      this.boxVAO = gl.createVertexArray();
      gl.bindVertexArray(this.boxVAO);
      const bb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(box), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

      // image quads + per-instance data
      this.imgVAO = gl.createVertexArray();
      gl.bindVertexArray(this.imgVAO);
      const cb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, MAX_INST * 32, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
    }

    prog(name) {
      if (this.progs[name]) return this.progs[name];
      const gl = this.gl;
      const [vs, fs] = SHADERS[name];
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
          throw new Error(`${name} shader: ${gl.getShaderInfoLog(s)}`);
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      // fixed attribute slots so every VAO matches every program
      ['a_pos', 'a_uv', 'a_corner'].forEach(a => gl.bindAttribLocation(p, 0, a));
      ['a_nrm', 'a_i0'].forEach(a => gl.bindAttribLocation(p, 1, a));
      gl.bindAttribLocation(p, 2, 'a_i1');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(`${name} link: ${gl.getProgramInfoLog(p)}`);
      this.progs[name] = p;
      this.locs.set(p, {});
      return p;
    }

    loc(p, n) {
      const m = this.locs.get(p);
      if (!(n in m)) m[n] = this.gl.getUniformLocation(p, n);
      return m[n];
    }
    f1(p, n, v) { this.gl.uniform1f(this.loc(p, n), v); }
    f2(p, n, a, b) { this.gl.uniform2f(this.loc(p, n), a, b); }
    f3(p, n, a, b, c) { this.gl.uniform3f(this.loc(p, n), a, b, c); }
    f4(p, n, a, b, c, d) { this.gl.uniform4f(this.loc(p, n), a, b, c, d); }
    i1(p, n, v) { this.gl.uniform1i(this.loc(p, n), v); }

    // ── Config ──
    setConfig(cfg, images, force) {
      const gl = this.gl;
      this.cfg = cfg;
      this.images = images || {};
      this.palette = buildPalette(cfg);
      gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.palette.ramp);

      const rnd = mulberry32(cfg.seed | 0);
      this.seedOff = [rnd() * 200 - 100, rnd() * 200 - 100, rnd() * 50, rnd() * 50];

      // metaballs
      const vr = cfg.sizeVariance / 100;
      const balls = new Float32Array(64);
      const br = mulberry32((cfg.seed | 0) ^ 0x5bd1e995);
      for (let i = 0; i < 16; i++) {
        const w = br() < 0.5 ? br() * 0.35 : 0.65 + br() * 0.35;
        balls.set([br(), br(), 1 - vr * br() * 0.8, w], i * 4);
      }
      this.balls = balls;

      // image-scatter instances (only rebuilt when the seed changes)
      if (force || this.instSeed !== cfg.seed) {
        this.instSeed = cfg.seed;
        const ir = mulberry32((cfg.seed | 0) ^ 0x27d4eb2d);
        const d = new Float32Array(MAX_INST * 8);
        for (let i = 0; i < MAX_INST; i++) {
          d.set([ir(), ir(), 0.55 + ir() * 0.9, ir(), Math.floor(ir() * 3), ir(), ir() < 0.5 ? -1 : 1, 0], i * 8);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
      }

      // image texture
      const src = (cfg.imageAssetId && this.images[cfg.imageAssetId]) || (SPARKLE || (SPARKLE = sparkle()));
      if (force || src !== this.imgSource) {
        this.imgSource = src;
        this.imgAsp = (src.naturalWidth || src.width) / (src.naturalHeight || src.height) || 1;
        gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }

    // ── Targets ──
    ensureTarget(w, h) {
      const gl = this.gl;
      if (this.target && this.target.w === w && this.target.h === h) return this.target;
      if (this.target) {
        const t = this.target;
        [t.fb, t.msFb].forEach(f => f && gl.deleteFramebuffer(f));
        [t.msColor, t.msDepth, t.depth].forEach(r => r && gl.deleteRenderbuffer(r));
        gl.deleteTexture(t.tex);
      }
      const fmt = this.floatOK ? gl.RGBA16F : gl.RGBA8;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      // multisampled color + depth for the 3D types, resolved into `tex`
      let msFb = null, msColor = null, msDepth = null, depth = null;
      if (this.samples > 1) {
        msFb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
        msColor = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, fmt, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
        msDepth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.deleteFramebuffer(msFb); gl.deleteRenderbuffer(msColor); gl.deleteRenderbuffer(msDepth);
          msFb = msColor = msDepth = null;
        }
      }
      if (!msFb) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.target = { w, h, tex, fb, msFb, msColor, msDepth, depth };
      return this.target;
    }

    // ── Render ──
    // f: { sec, W, H, tile?:{x,y,w,h}, loop, T, frame, transparent, scroll }
    render(f) {
      const gl = this.gl, cfg = this.cfg;
      if (!cfg || gl.isContextLost()) return;
      const W = f.W, H = f.H;
      const tile = f.tile || { x: 0, y: 0, w: W, h: H };
      const type = cfg.type;
      const t = this.ensureTarget(tile.w, tile.h);
      const mesh = MESH_TYPES.has(type);
      const bgA = f.transparent && TRANSPARENT_OK.has(type) ? 0 : 1;
      const c1 = this.palette.flat;
      this.snapInfo = [];
      this.frame = { ...f, W, H, tile, bgA, loop: !!f.loop, T: f.T || 8, m: cfg.speed };

      gl.bindFramebuffer(gl.FRAMEBUFFER, mesh && t.msFb ? t.msFb : t.fb);
      gl.viewport(0, 0, tile.w, tile.h);
      const ba = c1[3] * bgA;
      gl.clearColor(c1[0] * ba, c1[1] * ba, c1[2] * ba, ba);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      this['draw_' + type]();

      if (mesh && t.msFb) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msFb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
        gl.blitFramebuffer(0, 0, tile.w, tile.h, 0, 0, tile.w, tile.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }

      // post pass to the canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, tile.w, tile.h);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      const p = this.prog('post');
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      this.i1(p, 'u_scene', 0);
      this.f2(p, 'u_tile', tile.x, tile.y);
      this.f1(p, 'u_grain', cfg.noiseIntensity / 100 * 0.22);
      this.f1(p, 'u_gsize', Math.max(1, (1 + cfg.noiseScale / 100 * 5) * H / 1080));
      this.f1(p, 'u_frame', cfg.speed > 0 ? (f.frame || 0) % 997 : 0);
      this.f1(p, 'u_alpha', cfg.alpha / 100);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    // Uniforms every type program shares.
    common(p) {
      const gl = this.gl, f = this.frame, cfg = this.cfg;
      gl.useProgram(p);
      this.f2(p, 'u_res', f.W, f.H);
      this.f2(p, 'u_tile', f.tile.x, f.tile.y);
      const tw = f.tile.w, th = f.tile.h;
      this.f4(p, 'u_tileT', f.W / tw, f.H / th, (f.W - 2 * f.tile.x) / tw - 1, (f.H - 2 * f.tile.y) / th - 1);
      this.f1(p, 'u_sec', f.sec);
      this.f1(p, 'u_m', f.m);
      this.f1(p, 'u_loop', f.loop ? 1 : 0);
      this.f1(p, 'u_loopT', f.T);
      this.f4(p, 'u_seedOff', ...this.seedOff);
      gl.uniform4fv(this.loc(p, 'u_c[0]'), this.palette.flat);
      this.f1(p, 'u_bgA', f.bgA);
      this.f2(p, 'u_scroll', 0, (f.scroll || 0) * cfg.scrollMovement / 100);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.rampTex);
      this.i1(p, 'u_ramp', 0);
    }

    // Snapped linear motion; records the adjustment for the UI.
    snap(label, rate, period) {
      const f = this.frame;
      const r = snapRate(rate, period, f.loop, f.T);
      if (f.loop && rate && Math.abs(r / rate - 1) > 0.005) this.snapInfo.push({ label, ratio: r / rate });
      return r * f.sec;
    }

    quad() {
      const gl = this.gl;
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    draw_gradient() {
      const cfg = this.cfg, f = this.frame, p = this.prog('gradient');
      this.common(p);
      const n = v => v / 100;
      const radial = cfg.gradientMode === 'radial';
      this.f1(p, 'u_mode', radial ? 1 : 0);
      // Angle motion is a slow sway of up to ±20° around the set angle (one
      // cycle ≈ 25 s at speed 1), so it stays subtle and loops cleanly.
      const sway = cfg.linearGradientAngleMotion ? this.snap('Angle motion', 0.25 * f.m, TAU) : 0;
      this.f1(p, 'u_angle', (cfg.linearGradientAngle + n(cfg.linearGradientAngleMotion) * 20 * Math.sin(sway)) * Math.PI / 180);
      this.f1(p, 'u_rep', 1 + n(cfg.linearGradientRepeat) * 9);
      this.f1(p, 'u_sd', radial ? 0 : n(cfg.linearGradientStartColorDistance) * 0.45);
      this.f1(p, 'u_ed', radial ? 0 : n(cfg.linearGradientEndColorDistance) * 0.45);
      this.f1(p, 'u_radius', Math.max(0.05, n(cfg.radialGradientRadius) * 1.6));
      this.f2(p, 'u_rpos', n(cfg.radialGradientPositionX), n(cfg.radialGradientPositionY));
      // Drift through the noise field; a loop can't drift linearly through
      // non-periodic noise, so while looping the drift folds into morph time.
      const da = n(cfg.distortionDirection) * TAU;
      // Drift pace comes from the main Speed and noise variation from the main
      // seed; distortionSpeed / distortionSeed stay in the schema but are unused.
      const ds = 0.06 * f.m;
      const drift = f.loop ? 0 : ds * f.sec;
      this.f2(p, 'u_drift', Math.cos(da) * drift, Math.sin(da) * drift);
      this.f1(p, 'u_dMorph', cfg.distortionMorphSpeed * 0.03 + (f.loop ? 0.06 : 0));
      this.f1(p, 'u_dInt', n(cfg.distortionIntensity) * 0.6);
      this.f1(p, 'u_dFreq', 0.4 + n(cfg.distortionComplexity) * 3.5);
      this.i1(p, 'u_dOct', Math.round(1 + (1 - n(cfg.distortionSmoothness)) * 4));
      this.f1(p, 'u_dGain', 0.35 + (1 - n(cfg.distortionSmoothness)) * 0.25);
      this.quad();
    }

    draw_contours() {
      const cfg = this.cfg, p = this.prog('contours');
      this.common(p);
      const n = v => v / 100;
      const fx = 0.4 + n(cfg.complexity) * 4.5;
      const fy = 0.4 + n(cfg.complexityY) * 4.5;
      this.f2(p, 'u_freq', fx, fy);
      this.f1(p, 'u_fz', 2 + n(cfg.complexityZ) * 6);
      this.f1(p, 'u_ay', n(cfg.amplitudeY));
      this.f1(p, 'u_az', n(cfg.amplitudeZ));
      this.f1(p, 'u_off', n(cfg.offset) * 6);
      this.f1(p, 'u_range', 0.35 + n(cfg.noiseRange) * 1.3);
      this.f1(p, 'u_bias', Math.pow(2, (0.5 - n(cfg.noiseBias)) * 3));
      this.f1(p, 'u_steps', 2 + Math.round(n(cfg.steps) * 28));
      this.f1(p, 'u_cut', n(cfg.cutoff) * 0.9);
      this.f1(p, 'u_anim', cfg.animateNoise ? 1 : 0);
      this.quad();
    }

    travel(label, speed, dir) {
      const f = this.frame;
      const a = (dir / 100 * 2 - 1) * Math.PI;
      const v = speed / 100 * 0.12 * f.m;
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
      if (!f.loop) return [vx * f.sec, vy * f.sec];
      // whole number of wraps per loop on each axis
      let nx = Math.round(vx * f.T), ny = Math.round(vy * f.T);
      if (!nx && !ny && v) {
        if (Math.abs(vx) >= Math.abs(vy)) nx = Math.sign(vx) || 1; else ny = Math.sign(vy) || 1;
      }
      const sn = Math.hypot(nx, ny) / f.T;
      if (v && Math.abs(sn / v - 1) > 0.005) this.snapInfo.push({ label, ratio: sn / v });
      return [nx / f.T * f.sec, ny / f.T * f.sec];
    }

    draw_shapes() {
      const gl = this.gl, cfg = this.cfg, f = this.frame, p = this.prog('shapes');
      this.common(p);
      const n = v => v / 100;
      const count = 1 + Math.round(n(cfg.count) * 15);
      gl.uniform4fv(this.loc(p, 'u_balls[0]'), this.balls);
      this.i1(p, 'u_count', count);
      this.f1(p, 'u_rad', (0.08 + n(cfg.size) * 0.26) * Math.sqrt(8 / (count + 4)));
      this.f2(p, 'u_travel', ...this.travel('Travel', cfg.speedTravel, cfg.travelDirection));
      this.f1(p, 'u_wob', n(cfg.wobble));
      this.f1(p, 'u_morphOn', cfg.isMorphEnabled ? 1 : 0);
      this.f1(p, 'u_morph', n(cfg.morph));
      this.f1(p, 'u_morphK', n(cfg.speedMorph) * 0.9);
      this.f1(p, 'u_freq', 1 + n(cfg.complexity) * 6);
      this.f1(p, 'u_bevOn', cfg.isBevelEnabled ? 1 : 0);
      this.f1(p, 'u_bevSize', 0.2 + n(cfg.bevelSize) * 3);
      this.f1(p, 'u_bevStr', n(cfg.bevelStrength));
      this.f1(p, 'u_lightI', n(cfg.lightIntensity));
      this.f1(p, 'u_blurOn', cfg.isBlurEnabled ? 1 : 0);
      this.f1(p, 'u_blur', n(cfg.blur) * 0.8);
      const la = cfg.lightAngle * Math.PI / 180;
      this.f2(p, 'u_L', Math.cos(la), Math.sin(la));
      const lb = (cfg.lightAngle + cfg.bevelRotation - 45) * Math.PI / 180;
      this.f2(p, 'u_Lb', Math.cos(lb), Math.sin(lb));
      this.quad();
    }

    draw_surface() {
      const gl = this.gl, cfg = this.cfg, f = this.frame, p = this.prog('surface');
      this.common(p);
      const n = v => v / 100;
      const S = 16;
      const asp = f.W / f.H;
      const eye = [0, 9, 7];
      const fov = asp < 1 ? 2 * Math.atan(Math.tan(0.4) / asp) : 0.8;
      const vp = mul(perspective(fov, asp, 0.1, 100), lookAt(eye, [0, 0, -1.5], [0, 1, 0]));
      gl.uniformMatrix4fv(this.loc(p, 'u_mvp'), false, vp);
      this.f3(p, 'u_eye', ...eye);
      this.f1(p, 'u_S', S);
      this.f1(p, 'u_h', n(cfg.surfaceHeight) * 2.2);
      this.f1(p, 'u_fx', 0.6 + n(cfg.patternScaleX) * 20);
      this.f1(p, 'u_fy', n(cfg.patternScaleY) * 20);
      this.f1(p, 'u_px', 1 + n(cfg.patternPowerX) * 9);
      this.f1(p, 'u_py', 1 + n(cfg.patternPowerY) * 9);
      this.f1(p, 'u_amt', n(cfg.patternAmount));
      this.f1(p, 'u_dsx', 0.9 - n(cfg.distortionScaleX) * 0.82);
      this.f1(p, 'u_dsy', 0.9 - n(cfg.distortionScaleY) * 0.82);
      this.f1(p, 'u_gdx', n(cfg.gradientDistortionX));
      this.f1(p, 'u_gdy', n(cfg.gradientDistortionY));
      this.f1(p, 'u_cx', n(cfg.curveX));
      this.f1(p, 'u_cy', n(cfg.curveY));
      this.f1(p, 'u_fun', n(cfg.curveFunnel));
      this.f1(p, 'u_phase', this.snap('Flow', 0.5 * f.m, TAU));
      this.f1(p, 'u_fog', n(cfg.fogIntensity));
      this.f1(p, 'u_rep', 1 + n(cfg.repeat) * 9);
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(this.gridVAO);
      gl.drawElements(gl.TRIANGLES, this.gridCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
    }

    draw_isometric() {
      const gl = this.gl, cfg = this.cfg, f = this.frame, p = this.prog('isometric');
      this.common(p);
      const n = v => v / 100;
      const asp = f.W / f.H;
      const halfH = 8;
      const cell = 0.3 + n(cfg.boxSize) * 1.5;
      const R = halfH * Math.sqrt(asp * asp + 3.2) * 1.15;
      const N = Math.min(180, Math.ceil(2 * R / cell) + 2);
      const yaw = Math.PI / 4 + cfg.rotation * Math.PI / 180 + this.snap('Rotation', n(cfg.rotationSpeed) * 0.3 * f.m, TAU);
      const pitch = Math.atan(1 / Math.SQRT2); // 35.26°
      const view = mul(mul(mul(new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-50,1]), rotX(pitch)), rotY(yaw)), new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,-2,0,1]));
      const vp = mul(ortho(-halfH * asp, halfH * asp, -halfH, halfH, 1, 120), view);
      gl.uniformMatrix4fv(this.loc(p, 'u_vp'), false, vp);
      this.i1(p, 'u_n', N);
      this.f1(p, 'u_cell', cell);
      this.f1(p, 'u_fpx', 0.3 + n(cfg.scaleX) * 0.7);
      this.f1(p, 'u_fpz', 0.3 + n(cfg.scaleZ) * 0.7);
      this.f1(p, 'u_hs', 0.3 + n(cfg.scaleY) * 1.7);
      this.f1(p, 'u_var', n(cfg.sizeVariance));
      this.f1(p, 'u_waveOn', cfg.waveEnabled ? 1 : 0);
      this.f1(p, 'u_wf', 0.04 + n(cfg.waveComplexity) * 0.35);
      this.f1(p, 'u_wk', n(cfg.waveSpeed) * 0.8);
      this.f1(p, 'u_wd', 0.1 + n(cfg.waveDepth) * 1.6);
      const L = [n(cfg.lightX) * 2 - 1, n(cfg.lightY) + 0.15, n(cfg.lightZ) * 2 - 1];
      const ll = Math.hypot(...L) || 1;
      this.f3(p, 'u_L', L[0] / ll, L[1] / ll, L[2] / ll);
      this.f1(p, 'u_li', n(cfg.lightIntensity));
      this.f1(p, 'u_shadow', n(cfg.waveShadowDepth));
      this.f1(p, 'u_cf', n(cfg.colorFactor));
      this.f1(p, 'u_pf', n(cfg.positionFactor));
      this.f1(p, 'u_sf', n(cfg.scaleFactor));
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.bindVertexArray(this.boxVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.boxCount, N * N);
      gl.bindVertexArray(null);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
    }

    draw_images() {
      const gl = this.gl, cfg = this.cfg, f = this.frame, p = this.prog('images');
      this.common(p);
      const n = v => v / 100;
      const asp = f.W / f.H;
      const rotA = this.snap('Rotation', n(cfg.rotationSpeed) * 1.2 * f.m, TAU);
      this.f1(p, 'u_rotA', rotA);
      this.f1(p, 'u_wob', n(cfg.wobble));
      this.f1(p, 'u_imgAsp', this.imgAsp || 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      this.i1(p, 'u_img', 1);
      let count;
      if (cfg.patternEnabled) {
        const size = 0.03 + n(cfg.patternSize) * 0.2;
        const cw = size * Math.max(this.imgAsp || 1, 1) * (1 + n(cfg.patternSpaceX) * 2);
        const ch = size * (1 + n(cfg.patternSpaceY) * 2);
        let cols = Math.ceil((asp + 2 * size) / cw) + 1;
        let rows = Math.ceil((1 + 2 * size) / ch) + 1;
        cols += cols % 2; rows += rows % 2;   // even, so brick offsets tile when wrapping
        while (cols * rows > MAX_INST) { cols -= 2; rows -= 2; }
        count = cols * rows;
        this.f1(p, 'u_pattern', 1);
        this.f1(p, 'u_size', size);
        this.f4(p, 'u_grid', cols, rows, cw, ch);
        this.f2(p, 'u_goff', n(cfg.patternOffsetX), n(cfg.patternOffsetY));
        // travel measured in whole cells so the loop lands on the same grid
        const a = (cfg.travelDirection / 100 * 2 - 1) * Math.PI;
        const v = n(cfg.speedTravel) * 0.12 * f.m;
        const tx = this.snap('Travel', Math.cos(a) * v / cw, 1) * cw;
        const ty = this.snap('Travel', Math.sin(a) * v / ch, 1) * ch;
        this.f2(p, 'u_travel', tx, ty);
      } else {
        count = 1 + Math.round(n(cfg.imageCount) * 199);
        this.f1(p, 'u_pattern', 0);
        this.f1(p, 'u_size', 0.03 + n(cfg.imageScale) * 0.3);
        this.f2(p, 'u_travel', ...this.travel('Travel', cfg.speedTravel, cfg.travelDirection));
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.imgVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    dispose() {
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  root.CG_ENGINE = { Engine, buildPalette, hexToRgb, TRANSPARENT_OK };
})(window);
