/* Cosmic Keys — GPU particle worlds with HDR bloom (WebGL2, WebGL1 fallback).
 *
 * A drop-in replacement for the Canvas2D World in world.js. It renders into its own <canvas>
 * that sits under the game's (transparent) 2D canvas:
 *
 *   var w = new CK.GLWorld(canvas[, { allowSoftware: true, debug: false }])
 *   w.ok                           true when WebGL is up (false during a lost context)
 *   w.resize(W, H, dpr)            CSS px size + device pixel ratio
 *   w.setTheme(idx | null)         0..11 per level, null = title (1.6 s crossfade)
 *   w.wave(x, y, hex, strength)    ripple of light from a CSS-px point (~1.6 s)
 *   w.burst(x, y, hex, n)          n GPU sparks at a CSS-px point
 *   w.draw(dt, beat, horizonY)     every animation frame
 *
 * Frame: nebula (half res, domain-warped fbm) → scene target (HDR when possible): nebula +
 * procedural star field + instanced particle formations (computed entirely in the vertex
 * shader from per-particle random attributes) + sparks → dual-filter bloom → composite
 * (chromatic fringe, vignette, highlight roll-off, dither grain).
 */
(function () {
  'use strict';
  var CK = (window.CK = window.CK || {});
  var TAU = Math.PI * 2;

  /* Same names/order as world.js (the game shows them). world.js owns CK.THEMES when loaded. */
  var NAMES = ['Nebula Spiral', 'Aurora Curtains', 'Warp Tunnel', 'Crystal Rain', 'Ocean of Light', 'Solar Wind',
    'Constellations', 'Firefly Garden', 'Double Helix', 'Cosmic Bloom', 'Hyperspace', 'Supernova'];
  if (!CK.THEMES) CK.THEMES = NAMES.map(function (n) { return { name: n }; });

  var F = { galaxy: 0, aurora: 1, tunnel: 2, rain: 3, ocean: 4, solar: 5, stars: 6, fireflies: 7, helix: 8, bloom: 9, hyper: 10, nova: 11 };
  var MAXP = 20000;        // particle attribute buffer size
  var MAXS = 2048;         // spark ring buffer size
  var MAXW = 8;            // simultaneous light waves
  var BLEND_T = 1.6;       // theme crossfade (s)
  var ASSEMBLE_T = 2.6;    // new formation assembles over this long (s)
  var WAVE_T = 1.25;       // wave lifetime (s)
  var WAVE_MAXS = 1.25;    // effective wave strength cap (the game calls with 0.8..1.6)

  /*
   * Theme table. pal: 6 particle colours. neb: nebula look (top/bottom sky gradient, three gas
   * colours, p = [scale, warp, density, seed], q = [driftX, driftY, dust, horizon glow]).
   * glow: an extra light in the sky (type 0 soft halo, 1 sun, 2 pulsing core) at a world point.
   * fp: formation parameters; origin: formation centre (world units, camera at z = -600).
   */
  var THEMES = [
    { // 0 Nebula Spiral — tilted three-armed galaxy
      form: F.galaxy, count: 1.0, gain: 0.75, calm: 0.7, fp: [3, 0.5, 0.05, 0.95], fq: [2.25, 1.0, 1.0, 0], origin: [0, -10, 1050],
      pal: ['#8fb8ff', '#5fd4ff', '#ffffff', '#7fe6ff', '#ffe2b8', '#4f7dff'],
      neb: { top: '#020818', bot: '#071634', c1: '#2a54e0', c2: '#1aa6ff', c3: '#b98a3c', p: [1.25, 3.2, 0.36, 1.0], q: [0.6, 0.15, 0.55, 0.10] },
      glow: { type: 0, at: [0, -10, 1050], r: 230, col: '#c9dcff', i: 0.18 },
      stars: 1.0, bloom: 1.0, exposure: 1.0
    },
    { // 1 Aurora Curtains
      form: F.aurora, count: 1.0, fp: [0, 0, 0, 0], origin: [0, -150, 1200],
      pal: ['#5dffb8', '#3fe0ff', '#8fd0ff', '#e9fff7', '#2bd98f', '#3f7dff'],
      neb: { top: '#020a14', bot: '#05182a', c1: '#14b88a', c2: '#2a6cff', c3: '#0f7fc0', p: [0.9, 2.6, 0.24, 2.0], q: [1.0, 0.0, 0.35, 0.08] },
      glow: { type: 0, at: [0, 300, 2600], r: 900, col: '#1fd6a0', i: 0.08 },
      stars: 1.15, bloom: 1.0, exposure: 1.0
    },
    { // 2 Warp Tunnel
      form: F.tunnel, count: 1.0, calm: 0.8, fp: [0, 0, 0, 0], origin: [0, -30, 1500],
      pal: ['#7fb4ff', '#ffffff', '#4f7dff', '#a9e2ff', '#ffd27a', '#3fd0ff'],
      neb: { top: '#02040f', bot: '#081030', c1: '#2a4dff', c2: '#0aa0ff', c3: '#2a5cd0', p: [1.1, 3.6, 0.22, 3.0], q: [0.0, 0.0, 0.5, 0.08] },
      glow: { type: 0, at: [0, -30, 2400], r: 240, col: '#9cc4ff', i: 0.2 },
      stars: 0.7, bloom: 1.0, exposure: 1.0
    },
    { // 3 Crystal Rain
      form: F.rain, count: 0.62, fp: [0, 0, 0, 0], origin: [0, -250, 1000],
      pal: ['#9be9ff', '#8ff0ff', '#ffffff', '#a6c8ff', '#ffd98a', '#6fb8ff'],
      neb: { top: '#040a18', bot: '#0a1830', c1: '#2a7cc0', c2: '#3a8cff', c3: '#1a4c9a', p: [1.4, 3.0, 0.22, 4.0], q: [-0.2, 1.0, 0.5, 0.10] },
      glow: { type: 0, at: [0, -500, 2200], r: 700, col: '#8fd8ff', i: 0.06 },
      stars: 0.8, bloom: 1.0, exposure: 1.0
    },
    { // 4 Ocean of Light
      form: F.ocean, count: 1.0, calm: 0.8, fp: [0, 0, 0, 0], origin: [0, 120, 1200],
      pal: ['#3fd8ff', '#6effe0', '#ffffff', '#2a8dff', '#1b5cff', '#bff8ff'],
      neb: { top: '#010814', bot: '#06223a', c1: '#0a7dc8', c2: '#00c8b0', c3: '#3046ff', p: [1.0, 2.8, 0.22, 5.0], q: [0.8, 0.0, 0.4, 0.06] },
      glow: { type: 0, at: [0, -60, 2700], r: 160, col: '#d6fbff', i: 0.55 },
      stars: 1.1, bloom: 1.0, exposure: 1.0
    },
    { // 5 Solar Wind
      form: F.solar, count: 1.0, fp: [0, 0, 0, 0], origin: [-900, 450, 1500],
      pal: ['#ffcf6a', '#ff8a3d', '#fff2c8', '#ff5a6e', '#ffe9a0', '#c23a5a'],
      neb: { top: '#120404', bot: '#2a0b0a', c1: '#ff6a2a', c2: '#c41e4a', c3: '#ffb040', p: [1.2, 3.4, 0.26, 6.0], q: [0.5, -0.3, 0.6, 0.10] },
      glow: { type: 1, at: [-900, 450, 1500], r: 165, col: '#ffcf6a', i: 0.55 },
      stars: 0.5, bloom: 1.0, exposure: 1.0
    },
    { // 6 Constellations
      form: F.stars, count: 0.75, fp: [0, 0, 0, 0], origin: [0, -60, 500],
      pal: ['#ffffff', '#c4dcff', '#8fb8ff', '#ffe9b0', '#ffc98a', '#a8d8ff'],
      neb: { top: '#03030f', bot: '#0d0b28', c1: '#2a4cc8', c2: '#2a64c8', c3: '#3a7cff', p: [0.85, 2.4, 0.22, 7.0], q: [0.4, 0.0, 0.7, 0.07] },
      glow: { type: 0, at: [0, 0, 2000], r: 400, col: '#86b0ff', i: 0.0 },
      stars: 1.6, bloom: 1.0, exposure: 1.0
    },
    { // 7 Firefly Garden
      form: F.fireflies, count: 0.16, fp: [0, 0, 0, 0], origin: [0, -60, 1000],
      pal: ['#e8ff7a', '#9dff6a', '#fff6b8', '#5fffc0', '#2fbf7a', '#ffd36e'],
      neb: { top: '#020905', bot: '#071a10', c1: '#2e9a4a', c2: '#0f8a78', c3: '#8acb3a', p: [1.1, 3.0, 0.20, 8.0], q: [0.3, -0.2, 0.55, 0.12] },
      glow: { type: 0, at: [0, 260, 2400], r: 1100, col: '#4cff9a', i: 0.06 },
      stars: 0.8, bloom: 1.1, exposure: 1.0
    },
    { // 8 Double Helix
      form: F.helix, count: 0.9, calm: 0.6, fp: [0, 0, 0, 0], origin: [0, -90, 1350],
      pal: ['#ffc94a', '#56e7ff', '#ffffff', '#3f8cff', '#ffe29a', '#7af0ff'],
      neb: { top: '#020814', bot: '#06142c', c1: '#a8782a', c2: '#2a7cff', c3: '#1a9ab0', p: [1.2, 3.3, 0.28, 9.0], q: [-0.5, 0.2, 0.5, 0.10] },
      glow: { type: 0, at: [0, -90, 1600], r: 500, col: '#7fd0ff', i: 0.07 },
      stars: 0.9, bloom: 1.0, exposure: 1.0
    },
    { // 9 Cosmic Bloom — a flower of light
      form: F.bloom, count: 1.0, calm: 0.6, fp: [0, 0, 0, 0], origin: [0, -10, 1650],
      pal: ['#ff8fc4', '#ffd36e', '#ffffff', '#ff6a8e', '#ffb0d8', '#c24a8a'],
      neb: { top: '#050816', bot: '#120c24', c1: '#2a4cb0', c2: '#b0466f', c3: '#1a2a6a', p: [1.15, 3.1, 0.16, 10.0], q: [0.3, 0.3, 0.55, 0.10] },
      glow: { type: 0, at: [0, -10, 1650], r: 170, col: '#ffcf7a', i: 0.16 },
      stars: 0.8, bloom: 1.0, exposure: 1.0
    },
    { // 10 Hyperspace
      form: F.hyper, count: 0.85, calm: 0.7, fp: [0, 0, 0, 0], origin: [0, -30, 1800],
      pal: ['#ffffff', '#9cc8ff', '#6f8dff', '#d9ecff', '#ffd98a', '#7fe0ff'],
      neb: { top: '#010208', bot: '#060a20', c1: '#2a46c8', c2: '#3a8cff', c3: '#3a6cff', p: [1.0, 3.8, 0.16, 11.0], q: [0.0, 0.0, 0.4, 0.06] },
      glow: { type: 0, at: [0, -30, 2600], r: 220, col: '#cfe4ff', i: 0.22 },
      stars: 0.5, bloom: 1.0, exposure: 1.0
    },
    { // 11 Supernova
      form: F.nova, count: 1.0, calm: 0.5, fp: [0, 0, 0, 0], origin: [0, -40, 1300],
      pal: ['#ff7a59', '#ffd36e', '#7d8cff', '#ff9a5a', '#6effe0', '#ffffff'],
      neb: { top: '#05040f', bot: '#120a20', c1: '#ff5a3a', c2: '#3a5cff', c3: '#ff7a3a', p: [1.3, 3.6, 0.30, 12.0], q: [0.2, -0.2, 0.6, 0.10] },
      glow: { type: 2, at: [0, -40, 1300], r: 110, col: '#fff1d6', i: 0.35 },
      stars: 0.9, bloom: 1.0, exposure: 1.0
    }
  ];
  var TITLE = { // the grand, slow galaxy behind the logo
    form: F.galaxy, count: 1.25, gain: 1.45, fp: [2, 0.95, 0.018, 1.75], fq: [3.1, 1.7, 1.35, 0], origin: [0, 20, 1500],
    pal: ['#7fc8ff', '#62e0ff', '#ffffff', '#ffd58a', '#ffe0b8', '#4f8dff'],
    neb: { top: '#020a1c', bot: '#071a3a', c1: '#1f5fd0', c2: '#c08a3a', c3: '#13a8d8', p: [1.05, 3.4, 0.3, 13.0], q: [0.35, 0.1, 0.6, 0.10] },
    glow: { type: 0, at: [0, 20, 1500], r: 380, col: '#d8ecff', i: 0.24 },
    stars: 1.2, bloom: 1.05, exposure: 1.0
  };

  /* '#rgb', '#rrggbb', 'rrggbb' or 0xrrggbb → [r, g, b] in 0..1 (white when unreadable). */
  function hexRgb(h) {
    var n;
    if (typeof h === 'number') n = h;
    else {
      var str = String(h == null ? '' : h).replace('#', '').trim();
      if (str.length === 3 || str.length === 4) str = str[0] + str[0] + str[1] + str[1] + str[2] + str[2];
      n = /^[0-9a-fA-F]{6}/.test(str) ? parseInt(str.slice(0, 6), 16) : NaN;
    }
    if (!isFinite(n)) n = 0xffffff;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function prepTheme(th) {
    var pal = new Float32Array(18);
    for (var i = 0; i < 6; i++) { var c = hexRgb(th.pal[i % th.pal.length]); pal[i * 3] = c[0]; pal[i * 3 + 1] = c[1]; pal[i * 3 + 2] = c[2]; }
    th._pal = pal;
    var n = th.neb, cols = [n.top, n.bot, n.c1, n.c2, n.c3], nc = new Float32Array(15);
    for (var j = 0; j < 5; j++) { var cc = hexRgb(cols[j]); nc[j * 3] = cc[0]; nc[j * 3 + 1] = cc[1]; nc[j * 3 + 2] = cc[2]; }
    th._neb = nc;
    th._glowCol = hexRgb(th.glow.col);
    th._fp = new Float32Array(th.fp);
    th._fq = new Float32Array(th.fq || [1, 1, 1, 1]);
  }
  THEMES.forEach(prepTheme); prepTheme(TITLE);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, m) { return a + (b - a) * m; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); }
  function halton(i, b) { var f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================================================================== */
  /* Shaders (GLSL ES 1.00 so one source serves WebGL1 and WebGL2)       */
  /* ================================================================== */
  var FS_HEAD = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif'
  ].join('\n');

  var VS_FULL = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var GLSL_NOISE = [
    'uniform sampler2D tNoise;',
    'float noise(vec2 x) {',
    '  vec2 p = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return texture2D(tNoise, (p + f + 0.5) / 256.0).x;',
    '}',
    'const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);',
    'float fbm(vec2 p) {',
    '  float s = 0.0, a = 0.5;',
    '  for (int i = 0; i < 5; i++) { s += a * noise(p); p = M2 * p * 2.02 + 17.3; a *= 0.5; }',
    '  return s / 0.97;',
    '}',
    'float fbm3(vec2 p) {',
    '  float s = 0.0, a = 0.5;',
    '  for (int i = 0; i < 3; i++) { s += a * noise(p); p = M2 * p * 2.02 + 17.3; a *= 0.5; }',
    '  return s / 0.875;',
    '}'
  ].join('\n');

  /* Nebula: two themes (A = outgoing, B = incoming) mixed by uMix. Rendered at half res. */
  var FS_NEBULA = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform vec2 uView;',
    'uniform float uTime, uMix, uPulse, uHorizon, uEnergy, uScale;',
    'uniform vec3 uNA[5]; uniform vec4 uPA[4]; uniform vec3 uGA;',
    'uniform vec3 uNB[5]; uniform vec4 uPB[4]; uniform vec3 uGB;',
    'uniform vec4 uWave[8]; uniform vec3 uWaveC[8]; uniform int uWaveN;',
    GLSL_NOISE,
    // p = scale, warp, density, seed | q = driftX, driftY, dust, horizon | g = glow x, y, r, i | x = glow type
    'vec3 nebula(vec2 px, vec3 top, vec3 bot, vec3 c1, vec3 c2, vec3 c3, vec4 p, vec4 q, vec4 g, vec3 gc, float gtype) {',
    '  vec2 uv = px / uView.y;',
    '  float t = uTime;',
    '  vec2 st = uv * p.x * 1.6 + vec2(p.w * 17.13, p.w * 7.31) + q.xy * t * 0.012;',
    '  float tt = t * 0.018;',
    '  vec2 a = vec2(fbm(st + vec2(0.0, tt)), fbm(st + vec2(5.2, 1.3) - tt));',
    '  vec2 b = vec2(fbm(st + p.y * a + vec2(1.7, 9.2) + tt * 1.3), fbm(st + p.y * a + vec2(8.3, 2.8) - tt * 0.7));',
    '  float f = fbm(st + p.y * b);',
    '  float yy = px.y / uView.y;',
    '  vec3 col = mix(top, bot, smoothstep(0.0, 1.0, yy));',
    '  float d = smoothstep(0.42, 0.92, f);',
    '  d = d * d * (3.0 - 2.0 * d);',
    '  vec3 gas = mix(c1, c2, clamp(length(a) * 1.25 - 0.45, 0.0, 1.0));',
    '  gas = mix(gas, c3, smoothstep(0.5, 0.85, b.y) * 0.75);',
    '  float dust = smoothstep(0.52, 0.72, fbm3(st * 2.4 + b * 1.7 + 4.1)) * q.z;',
    // calmer behind the middle of the play space, richer toward the edges and top
    '  vec2 cc = (px - vec2(uView.x * 0.5, uHorizon * 0.5)) / uView.y;',
    '  float calm = mix(0.5, 1.0, smoothstep(0.12, 0.75, length(cc * vec2(0.8, 1.2))));',
    '  float fil = pow(max(0.0, 1.0 - abs(b.x - 0.55) * 4.0), 3.0);',  // thin bright filaments
    '  col += gas * (d * p.z + fil * d * p.z * 0.9) * calm * (1.0 - dust * 0.75) * (1.0 + uEnergy * 0.25);',
    '  col *= 1.0 - dust * 0.4;',
    // sky light: soft halo, sun, or pulsing core
    '  vec2 gv = px - g.xy;',
    '  float gd = length(gv) / max(g.z, 1.0);',
    '  if (gtype < 0.5) {',
    '    col += gc * g.w * (exp(-gd * gd * 2.2) * 0.8 + 0.22 / (1.0 + gd * gd * 1.6)) * (1.0 + uPulse * 0.15);',
    '  } else if (gtype < 1.5) {',
    '    vec2 dir = gv / max(length(gv), 1e-3);',
    '    float rays = fbm(dir * 2.6 + vec2(t * 0.02, -t * 0.015)) * fbm3(dir * 6.0 - vec2(gd * 0.9 - t * 0.12));',
    '    float cor = exp(-max(gd - 1.0, 0.0) * 1.6) * (0.35 + 1.6 * rays) + 0.25 / (1.0 + gd * gd * 0.35);',
    '    float disc = smoothstep(1.0, 0.94, gd);',
    '    float limb = pow(max(1.0 - gd * gd, 0.0), 0.45);',
    '    float gran = fbm(gv / max(g.z, 1.0) * 5.0 + t * 0.05);',
    // limb darkening: deep orange rim → pale gold centre, granulated
    '    vec3 sun = mix(gc * vec3(1.0, 0.55, 0.25), vec3(1.0, 0.82, 0.5), limb) * (0.78 + 0.35 * gran) * 1.6;',
    '    col = mix(col + gc * g.w * cor * (0.8 + uPulse * 0.3), sun * g.w * (1.0 + uPulse * 0.1), disc);',
    '  } else {',
    '    float k = 1.0 + uPulse * 0.6;',
    '    col += gc * g.w * (exp(-gd * gd * 3.0 / k) * 1.4 + 0.3 / (1.0 + gd * gd * 0.6)) * k;',
    '    vec2 ag = abs(gv) / max(g.z, 1.0);',
    '    col += gc * g.w * k * 0.5 * (exp(-ag.y * 28.0) * exp(-ag.x * 0.5) + 0.5 * exp(-ag.x * 28.0) * exp(-ag.y * 0.9));',
    '  }',
    // light rising from the keyboard
    '  float hy = max(uHorizon - px.y, 0.0) / uView.y;',
    '  col += mix(c1, c2, 0.5) * q.w * exp(-hy * 7.0) * (1.0 + uPulse * 0.8);',
    '  return col;',
    '}',
    'void main() {',
    '  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uView;',
    '  vec3 col = nebula(px, uNB[0], uNB[1], uNB[2], uNB[3], uNB[4], uPB[0], uPB[1], uPB[2], uGB, uPB[3].x);',
    '  if (uMix < 0.999) col = mix(nebula(px, uNA[0], uNA[1], uNA[2], uNA[3], uNA[4], uPA[0], uPA[1], uPA[2], uGA, uPA[3].x), col, uMix);',
    // waves: a ring of light travelling through the gas
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= uWaveN) break;',
    '    vec4 w = uWave[i];',
    '    float dd = length(px - w.xy);',
    '    float wid = 9.0 + w.z * 0.05;',
    '    float x = (dd - w.z) / wid;',
    '    float band = exp(-x * x);',
    '    float trail = dd < w.z ? exp(-(w.z - dd) / (40.0 + w.z * 0.25)) : 0.0;',
    // brighten the gas a little, but mostly add the note's own colour so a green note reads green
    '    col *= 1.0 + (band * 0.6 + trail * 0.2) * w.w;',
    '    col += uWaveC[i] * w.w * (band * 0.45 + trail * 0.08);',
    '  }',
    '  gl_FragColor = vec4(col * uScale, 1.0);',
    '}'
  ].join('\n');

  /* Scene background: upsampled nebula (with wave refraction) + procedural star field. */
  var FS_BG = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform sampler2D tNeb;',
    'uniform vec2 uView;',
    'uniform float uTime, uStarI, uPx, uPulse;',
    'uniform vec2 uDrift;',
    'uniform vec4 uWave[8]; uniform int uWaveN;',
    'vec4 hash42(vec2 p) {',
    '  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));',
    '  p4 += dot(p4, p4.wzxy + 33.33);',
    '  return fract((p4.xxyz + p4.yzzw) * p4.zywx);',
    '}',
    'void main() {',
    '  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uView;',
    '  vec2 disp = vec2(0.0);',
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= uWaveN) break;',
    '    vec4 w = uWave[i];',
    '    vec2 dv = px - w.xy; float dd = length(dv);',
    '    float x = (dd - w.z) / (16.0 + w.z * 0.08);',
    '    disp += dv / max(dd, 1.0) * x * exp(-x * x) * w.w * 9.0;',
    '  }',
    '  vec2 uv = vUv + vec2(disp.x, -disp.y) / uView;',
    '  vec3 col = texture2D(tNeb, uv).rgb;',
    '  vec2 sp0 = px + disp * 0.5;',
    '  vec3 acc = vec3(0.0);',
    '  float minR = 0.75 / uPx;',
    '  for (int L = 0; L < 3; L++) {',
    '    float fl = float(L);',
    '    float cell = 26.0 + fl * 30.0;',
    '    vec2 sp = (sp0 + uDrift * uTime * (0.25 + fl * 0.45)) / cell + fl * 19.7;',
    '    vec2 id = floor(sp); vec2 f = fract(sp);',
    '    vec4 h = hash42(id + fl * 41.0);',
    '    float present = step(h.w, 0.55 - fl * 0.1);',
    '    vec2 dv = (f - (0.2 + 0.6 * h.xy)) * cell;',
    '    float r = max(minR, 0.35 + 0.25 * fl + h.z * h.z * (0.5 + fl * 0.7));',
    '    float s = exp(-dot(dv, dv) / (r * r));',
    '    float tw = 0.55 + 0.45 * sin(uTime * (0.4 + h.z * 2.6) + h.x * 60.0);',
    '    float bri = (0.10 + 0.9 * pow(h.z, 4.0)) * (0.55 + fl * 0.35);',
    '    vec3 sc = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.88, 0.72), h.y);',
    '    acc += sc * s * bri * tw * present;',
    '  }',
    '  col += acc * uStarI * (1.0 + uPulse * 0.25);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* Particle vertex shader: shared header + one formation + shared main. */
  var VS_PART_HEAD = [
    'precision highp float;',
    '#define TAU 6.28318530718',
    '#define PI 3.14159265359',
    'attribute vec2 aCorner;',
    'attribute vec4 aR1;',
    'attribute vec4 aR2;',
    'uniform vec2 uView, uCenter;',
    'uniform float uFocal, uCamZ, uHorizon, uPx;',
    'uniform float uTime, uBeat, uPulse, uEnergy, uTravel, uSwell;',
    'uniform float uAlpha, uLife, uLeave, uSizeK, uMode, uDensity, uSpan, uCalm;',
    'uniform vec3 uPal[6];',
    'uniform vec4 uFP, uFQ;',
    'uniform vec3 uOrigin;',
    'uniform vec4 uWave[8]; uniform vec3 uWaveC[8]; uniform int uWaveN;',
    'varying vec2 vLocal;',
    'varying float vHalf;',
    'varying vec3 vCol, vMisc;',
    'varying vec3 vFx;',    // x: star-glint amount, y: light bead position along a line (-9 = none), z: line profile scale
    'float FOG = 0.0;',     // formations may set: 0 = crisp star sprite, 1 = soft diffuse light
    'float GLINT = 0.0;',   // formations may set: 4-point diffraction glint (crystals)
    'float NORM = 0.22;',   // how much long streaks are dimmed (energy conservation)
    'float MAXL = 0.35;',   // longest streak (x screen height) before it counts as a wrap-around
    'float gauss(float u, float v) { return sqrt(-2.0 * log(max(u, 1e-4))) * cos(TAU * v); }',
    'vec3 pal(float k) {',
    '  k = clamp(k, 0.0, 5.0);',
    '  vec3 c = mix(uPal[0], uPal[1], clamp(k, 0.0, 1.0));',
    '  c = mix(c, uPal[2], clamp(k - 1.0, 0.0, 1.0));',
    '  c = mix(c, uPal[3], clamp(k - 2.0, 0.0, 1.0));',
    '  c = mix(c, uPal[4], clamp(k - 3.0, 0.0, 1.0));',
    '  return mix(c, uPal[5], clamp(k - 4.0, 0.0, 1.0));',
    '}',
    'vec3 palI(float r) { int i = int(floor(clamp(r, 0.0, 0.999) * 6.0)); return uPal[i]; }',
    'vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }',
    'vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }',
    'vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }',
    'vec3 sphere(float a, float b) { float ph = acos(2.0 * a - 1.0); float l = b * TAU; return vec3(sin(ph) * cos(l), cos(ph), sin(ph) * sin(l)); }',
    'float outBack(float x) { float y = x - 1.0; return 1.0 + 2.3 * y * y * y + 1.3 * y * y; }',
    'float inBack(float x) { return 2.5 * x * x * x - 1.5 * x * x; }'
  ].join('\n');

  /* Each formation fills P (world position), T (tail offset for streaks), C (colour), S (size), B (brightness). */
  var FORMS = [];

  FORMS[F.galaxy] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float a = aR1.x, b = aR1.y, c = aR1.z, d = aR1.w, e = aR2.z, f = aR2.w;',
    '  float spin = uFP.z;',
    '  float g1 = gauss(c, f), g2 = gauss(c, f + 0.25);',
    '  vec3 p;',
    '  if (f > 0.975) {',
    '    vec3 q = vec3((a - 0.5) * 2600.0 + sin(t * 0.05 + b * 9.0) * 80.0, (b - 0.62) * 1300.0 + sin(t * 0.07 + c * 7.0) * 50.0, -420.0 + c * 900.0);',
    '    P = q + vec3(0.0, uOrigin.y, 0.0);',
    '    C = mix(uPal[0], uPal[3], d);',
    '    B = 0.22 + 0.12 * sin(t * 0.6 + e * 40.0);',
    '    S = 1.1 + d * 0.8;',
    '    return;',
    '  }',
    '  if (e < 0.09) {',
    // warm central bulge
    '    float rb = pow(a, 2.0) * 250.0 * uFQ.z;',
    '    p = sphere(d, b) * rb * vec3(1.0, 0.55, 1.0);',
    '    p = rotY(p, -t * spin * 4.0);',
    '    C = mix(uPal[2], uPal[4], smoothstep(0.0, 0.6, a));',
    '    S = 0.4 + (1.0 - a) * 0.25;',
    '    B = 0.16 + (1.0 - a) * 0.14;',
    '    if (f < 0.3) { FOG = 1.0; S = 3.0; B = 0.03; }',
    '  } else if (e < 0.30) {',
    // faint disc between the arms
    '    float R = 110.0 + pow(a, 0.8) * 1150.0;',
    '    float th = b * TAU - t * spin * (1.0 + 300.0 / R);',
    '    p = vec3(cos(th) * R, g1 * 24.0, sin(th) * R);',
    '    C = mix(uPal[0], uPal[5], a);',
    '    S = 0.4 + d * 0.35;',
    '    B = 0.17;',
    '    if (f < 0.3) { FOG = 1.0; S = 3.5; B = 0.035; }',
    '  } else {',
    // logarithmic spiral arms with clumpy star-forming knots
    '    float arms = uFP.x;',
    '    float arm = floor(b * arms);',
    '    float R = 85.0 + pow(a, 1.05) * 1180.0;',
    '    float wind = log(R / 85.0) * uFQ.x;',
    '    float spread = (0.07 + 0.2 * (R / 1250.0)) * uFQ.y;',
    '    float th = wind + arm * TAU / arms + g1 * spread - t * spin * (1.0 + 300.0 / R);',
    '    p = vec3(cos(th) * R, g2 * (16.0 + 26.0 * (1.0 - R / 1250.0)), sin(th) * R);',
    '    float knot = pow(max(0.0, sin(wind * 4.2 + arm * 2.1 + floor(a * 9.0) * 1.7)), 14.0) * step(0.45, d);',
    '    C = mix(uPal[4], uPal[0], smoothstep(0.0, 0.28, a));',
    '    C = mix(C, uPal[1], smoothstep(0.35, 0.95, a));',
    '    C = mix(C, uPal[3], knot);',
    '    C = mix(C, uPal[2], step(0.97, d) * 0.7);',
    '    S = 0.5 + d * 0.6 + knot * 0.5;',
    '    B = 0.4 + knot * 0.7;',
    '    if (f < 0.40) { FOG = 1.0; S = 3.5 + 2.5 * (1.0 - a); B = 0.10; C = mix(C, uPal[5], 0.3); }',
    // a ring of light steps outward along the arms on every beat of the bar
    '    float ring = a - fract(uBeat * 0.25);',
    '    B *= 1.0 + 1.1 * uPulse * exp(-ring * ring * 60.0);',
    '  }',
    '  B *= 0.8 + 0.2 * sin(t * (0.8 + d * 2.6) + e * 61.0);',
    '  p = rotX(p, -uFP.y);',
    '  p = rotZ(p, 0.12);',
    '  P = p * uFP.w * (1.0 + 0.025 * uEnergy) + uOrigin;',
    '}'
  ].join('\n');

  FORMS[F.aurora] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float k = floor(aR1.x * 3.0);',           // three curtains at different depths
    '  float u = aR1.y, v = aR1.z;',
    '  float x = (u * 2.0 - 1.0) * 2700.0 * uSpan;',
    // the curtain folds back and forth in depth (edge-on folds read brighter) and its lower edge
    // ripples, so each curtain is a glowing sheet rather than a flat line
    '  float z = 1100.0 + k * 520.0 + sin(u * 6.0 + t * 0.06 + k * 1.7) * 520.0 + sin(u * 13.0 - t * 0.11 + k) * 120.0;',
    '  float edge = 230.0 - k * 120.0 + sin(u * 7.0 + t * 0.07 + k * 2.0) * 150.0 + sin(u * 17.0 - t * 0.13 + k) * 45.0 + sin(u * 41.0 + t * 0.3) * 10.0;',
    '  float layer = aR1.w;',                      // < 0.70 rays, < 0.84 edge glow, else upper veil
    '  x += sin(t * 0.25 + u * 14.0) * 40.0;',
    '  float ray = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(u * 150.0 + k * 9.0 + sin(u * 17.0 + t * 0.22) * 3.0), 3.0);',
    '  float sweep = fract(u * 1.5 - uBeat * 0.125) - 0.5;',
    '  float kick = 1.0 + 1.1 * uPulse * exp(-sweep * sweep * 30.0);',
    '  float shimmer = 0.75 + 0.25 * sin(t * 2.1 + u * 61.0 + k * 3.0);',
    '  NORM = 0.012;',
    '  MAXL = 3.0;',
    '  if (layer < 0.70) {',
    // fine vertical rays: bright at the foot, fading upward, each a different length
    '    float hv = pow(v, 2.5) * 160.0 - 25.0;',
    '    P = vec3(x, edge - hv, z);',
    '    C = mix(uPal[0], uPal[3], exp(-v * 14.0) * 0.6);',
    '    C = mix(C, uPal[1], smoothstep(0.4, 1.0, aR2.w) * 0.6);',
    '    B = 0.5 * ray * kick * shimmer * (0.45 + 1.4 * exp(-v * 10.0)) * smoothstep(0.0, 0.12, v + 0.03);',
    '    S = 0.5 + aR2.z * 0.35;',
    '    T = vec3(0.0, -(160.0 + 620.0 * pow(0.5 + 0.5 * sin(u * 37.0 + k * 5.0 + t * 0.15), 2.0) * (0.4 + 0.6 * aR2.w)), 0.0);',
    '    if (layer < 0.3) { FOG = 1.0; S = 1.8; B *= 0.35; }',   // soft rays: the glowing sheet behind the fine ones
    '    if (aR2.z > 0.72) {',   // violet/rose fringe: rays that start higher up
    '      P.y -= 220.0 + 200.0 * v;',
    '      C = mix(uPal[2], uPal[5], aR2.w);',
    '    }',
    '  } else if (layer < 0.84) {',
    // soft light hugging the lower edge: the bright green hem of the curtain
    '    P = vec3(x, edge - v * 28.0 + 8.0, z);',
    '    C = mix(uPal[0], uPal[3], 0.4);',
    '    FOG = 1.0;',
    '    B = 0.2 * (0.5 + ray) * kick * (1.0 - v * 0.6);',
    '    S = 2.2;',
    '  } else {',
    // the diffuse veil above the rays
    '    P = vec3(x, edge - 30.0 - pow(v, 0.8) * 650.0, z);',
    '    C = pal(1.0 + v * 1.1);',
    '    FOG = 1.0;',
    '    B = 0.05 * (1.0 - v * 0.6) * kick * smoothstep(0.0, 0.2, v);',
    '    S = 3.4;',
    '  }',
    '}'
  ].join('\n');

  FORMS[F.tunnel] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float len = 2800.0;',
    '  float trav = uTravel * 520.0;',
    '  float ring = step(aR2.z, 0.45);',
    '  float zs = mix(aR1.y, floor(aR1.y * 26.0) / 26.0, ring);',
    '  float z = mod(zs * len - trav, len) - 300.0;',
    '  float dz = (z + 300.0) / len;',           // 0 near → 1 far
    '  float ang = aR1.x * TAU + t * 0.12 + dz * 2.0;',
    '  float rad = mix(330.0 + aR1.z * 160.0, 400.0 + (aR1.z - 0.5) * 10.0, ring);',
    '  vec2 bend = vec2(sin(t * 0.21) + 0.5 * sin(t * 0.11), 0.6 * cos(t * 0.17)) * dz * dz * 420.0;',
    '  P = vec3(cos(ang) * rad + bend.x, sin(ang) * rad * 0.8 + bend.y - 30.0, z);',
    // rings of light rush toward the viewer on each beat
    '  float wave = exp(-fract(uBeat + dz * 2.5) * 5.0);',
    '  float lane = pow(0.5 + 0.5 * sin(aR1.x * TAU * 8.0), 6.0);',   // brighter light lanes along the walls
    '  B = (0.08 + 0.22 * lane * (1.0 - ring) + (0.16 + 0.6 * ring) * wave) * smoothstep(1.0, 0.65, dz) * smoothstep(0.0, 0.18, dz);',
    '  C = mix(uPal[2], uPal[0], 0.5 + 0.5 * sin(aR1.x * TAU * 3.0 + dz * 6.0 + t * 0.2));',
    '  C = mix(C, uPal[4], smoothstep(0.45, 1.0, dz) * 0.7);',
    '  C = mix(C, uPal[3], ring * 0.5);',
    '  C = mix(C, uPal[1], ring * wave * 0.5);',
    '  S = mix(0.45 + aR1.w * 0.5, 0.55, ring);',
    '  T = vec3(0.0, 0.0, 60.0 + 220.0 * uPulse) * (1.0 - ring * 0.6);',
    '}'
  ].join('\n');

  FORMS[F.rain] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  if (aR2.z > 0.9) {',
    // splashes: little rings of light where drops land on the horizon (the piano's edge)
    '    float site = floor(aR1.x * 48.0);',
    '    float per = 0.8 + fract(site * 0.618) * 0.7;',
    '    float cyc = t / per + fract(site * 0.37);',
    '    float age = fract(cyc);',
    '    float n = floor(cyc) + site * 13.0;',
    '    float sx = (fract(sin(n * 12.9898) * 43758.5453) * 2.0 - 1.0) * 1700.0 * uSpan;',
    '    float sz = 150.0 + fract(sin(n * 78.233) * 24634.6345) * 1500.0;',
    '    float sy = (uHorizon - 12.0 - uCenter.y) * (sz + uCamZ) / uFocal;',   // lands just above the horizon
    '    float ang = aR1.y * TAU;',
    '    float rr = (12.0 + 70.0 * pow(age, 0.5)) * (0.85 + 0.3 * aR1.z);',
    '    P = vec3(sx + cos(ang) * rr, sy + sin(ang) * rr * 0.22 - sin(age * PI) * 6.0 * aR1.w, sz + sin(ang) * rr);',
    '    C = mix(uPal[2], uPal[1], age);',
    '    B = pow(1.0 - age, 2.0) * 0.55 * smoothstep(0.0, 0.08, age);',
    '    S = 0.35 + 0.2 * aR1.w;',
    '    return;',
    '  }',
    '  float crystal = step(aR2.z, 0.045);',
    '  float speed = (170.0 + aR1.w * 230.0) * mix(1.0, 0.22, crystal);',
    '  float x = (aR1.x * 2.0 - 1.0) * 1800.0 * uSpan;',
    '  float z = 80.0 + aR1.z * 1800.0;',
    '  float y = mod(aR1.y * 1700.0 + t * speed, 1700.0) - 950.0;',
    '  x += sin(t * 0.4 + y * 0.003 + aR1.x * 6.0) * 30.0;',
    '  P = vec3(x, y, z);',
    '  T = vec3(-0.06 * speed, -0.22 * speed, 0.0) * (1.0 - crystal);',
    '  float glint = crystal * pow(max(0.0, sin(t * 2.2 + aR2.w * 60.0)), 18.0) * 4.0;',
    '  C = mix(mix(uPal[0], uPal[1], step(0.5, aR2.w)), uPal[3], step(0.8, aR2.w));',
    // crystals slowly cycle through the palette like prisms
    '  C = mix(C, pal(fract(t * 0.3 + aR2.w) * 5.0), crystal);',
    '  B = (0.32 + glint * 0.8 + crystal * 0.1) * smoothstep(-950.0, -850.0, y) * smoothstep(750.0, 620.0, y);',
    '  B *= 1.0 + 0.9 * uPulse * crystal;',
    '  S = mix(0.5, 1.7, crystal) * (0.7 + 0.5 * aR2.w);',
    '  GLINT = crystal * (0.8 + glint);',
    '}'
  ].join('\n');

  FORMS[F.ocean] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float x = (aR2.x * 2.0 - 1.0) * 2400.0 * uSpan;',
    '  float z = 40.0 + pow(aR2.y, 0.85) * 2600.0;',
    '  x *= 0.45 + 0.55 * (z / 2640.0) + 0.2;',
    '  float h = sin(x * 0.0035 + t * 0.9) * 34.0 + sin(z * 0.005 - t * 1.1 + x * 0.001) * 28.0',
    '          + sin((x * 0.7 + z) * 0.0022 + t * 0.6) * 42.0 + sin((x - z * 0.6) * 0.009 + t * 1.7) * 9.0;',
    // a swell rolls out from the shore on each beat
    '  float rr = length(vec2(x * 0.6, z));',
    '  h += uPulse * 22.0 * sin(rr * 0.008 - fract(uBeat) * 6.0) * exp(-rr * 0.0006);',
    '  float y = 175.0 - h * 0.8;',
    '  P = vec3(x, y, z);',
    '  float crest = smoothstep(15.0, 70.0, h);',
    '  float glitterBand = exp(-pow(x / (90.0 + z * 0.22), 2.0));',
    '  float spark = pow(max(0.0, sin(t * 2.6 + aR1.x * 90.0)), 12.0);',
    '  C = mix(uPal[4], uPal[0], smoothstep(-50.0, 40.0, h));',
    '  C = mix(C, uPal[1], crest * 0.7);',
    '  C = mix(C, uPal[5], glitterBand * 0.6);',
    '  B = 0.22 + crest * 0.75 + glitterBand * (0.5 + spark * 2.5);',
    '  B *= smoothstep(2640.0, 1900.0, z) * 0.75 + 0.25;',
    '  S = 0.55 + aR1.w * 0.35 + glitterBand * spark * 0.5;',
    '}'
  ].join('\n');

  FORMS[F.solar] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float a = aR1.x, b = aR1.y, c = aR1.z, d = aR1.w, e = aR2.z;',
    '  float R0 = 165.0;',
    '  vec3 p;',
    '  if (e < 0.6) {',
    // solar wind streaming outward on gently curved (Parker) spirals
    '    float sp = 0.04 + c * 0.05;',
    '    float life = fract(b + t * sp);',
    '    float R = R0 * 1.05 + life * 2600.0;',
    '    float ang = PI * (0.9 + a * 1.2) + life * 0.5 + sin(t * 0.01) * 0.1;',   // upper half: the sun sits on the horizon
    '    float lat = (d - 0.5) * 0.9;',
    '    vec3 dir = vec3(cos(ang) * cos(lat), sin(ang) * cos(lat) * 0.85, sin(lat));',
    '    p = dir * R;',
    '    T = -dir * (50.0 + R * 0.06);',
    '    C = mix(uPal[2], uPal[0], smoothstep(0.0, 0.15, life));',
    '    C = mix(C, uPal[1], smoothstep(0.15, 0.5, life));',
    '    C = mix(C, uPal[3], smoothstep(0.5, 0.95, life));',
    '    B = pow(1.0 - life, 1.2) * 0.4 * smoothstep(0.0, 0.14, life);',
    '    S = 0.45 + (1.0 - life) * 0.75;',
    '    float burst = fract(a * 7.0 + floor(uBeat) * 0.37);',
    '    B *= 1.0 + uPulse * 1.2 * step(burst, 0.18);',
    '  } else if (e < 0.88) {',
    // coronal loops arching over the limb, plasma flowing along them
    '    float L = floor(a * 30.0);',
    '    float base = PI * (1.0 + fract(L * 0.618)) + sin(L * 3.7) * 0.15 + sin(t * 0.008 + L) * 0.05;',
    '    float span = 0.1 + fract(L * 0.37) * 0.16;',
    '    float s = b;',
    '    float ang = base + (s - 0.5) * span;',
    '    float hgt = pow(sin(s * PI), 0.8) * (20.0 + fract(L * 0.71) * 55.0) * (1.0 + 0.12 * sin(t * 0.6 + L) + 0.15 * uPulse);',
    '    float R = R0 * 1.01 + hgt + (c - 0.5) * 8.0;',
    '    p = vec3(cos(ang) * R, sin(ang) * R, -30.0 + (d - 0.5) * 40.0);',
    '    float flow = 0.5 + 0.5 * sin(s * 16.0 - t * 3.0 + L);',
    '    C = mix(uPal[1], uPal[4], flow);',
    '    B = (0.18 + 0.5 * flow) * (0.6 + 0.4 * sin(s * PI)) * (1.0 + uPulse * 0.6);',
    '    S = 0.32 + flow * 0.18;',
    '  } else {',
    // slow embers drifting out in wide arcs
    '    float life = fract(b + t * 0.018);',
    '    float R = R0 * 1.3 + life * 2200.0;',
    '    float ang = PI * (0.95 + a * 1.1) + life * 0.8;',
    '    p = vec3(cos(ang) * R, sin(ang) * R * 0.7, (d - 0.5) * 500.0);',
    '    C = mix(uPal[0], uPal[3], life);',
    '    B = (1.0 - life) * 0.4 * (0.6 + 0.4 * sin(t * 3.0 + a * 50.0));',
    '    S = 0.6 + d * 0.7;',
    '  }',
    '  P = p + uOrigin;',
    '}'
  ].join('\n');

  FORMS[F.stars] = [
    'vec3 starPos(float a, float b, float c) {',
    '  vec3 p = sphere(a, b) * (950.0 + c * 450.0);',
    '  p = rotY(p, uTime * 0.022);',
    '  p = rotX(p, 0.42);',
    '  return p + uOrigin;',
    '}',
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  if (aR2.z < 0.25) {',
    // the Milky Way: a soft band of light on a tilted great circle
    '    float th = aR1.x * TAU;',
    '    vec3 n = normalize(vec3(0.55, 1.0, 0.2));',
    '    vec3 e1 = normalize(cross(n, vec3(0.0, 0.0, 1.0)));',
    '    vec3 e2 = cross(n, e1);',
    '    float g = gauss(aR1.y, aR1.z) * 0.08 * (1.0 + 0.6 * sin(th * 3.0 + 1.0));',
    '    vec3 d = normalize(e1 * cos(th) + e2 * sin(th) + n * g);',
    '    vec3 p = d * 1300.0;',
    '    p = rotY(p, uTime * 0.022);',
    '    p = rotX(p, 0.42);',
    '    P = p + uOrigin;',
    '    float core = exp(-g * g * 300.0);',
    '    C = mix(uPal[5], uPal[1], aR2.w);',
    '    C = mix(C, uPal[4], core * 0.35);',
    '    if (aR1.w < 0.5) { FOG = 1.0; S = 7.0; B = 0.05 * (0.4 + core); C = mix(C, uPal[2], 0.3); }',
    '    else { S = 0.28 + aR2.w * 0.25; B = 0.38 * (0.4 + core) * (0.7 + 0.3 * sin(t * 2.0 + aR2.w * 50.0)); }',
    '    return;',
    '  }',
    '  P = starPos(aR1.x, aR1.y, aR1.z);',
    '  float big = pow(aR1.w, 5.0);',
    '  S = 0.4 + big * 1.6;',
    '  float tw = 0.5 + 0.5 * sin(t * (0.8 + aR2.z * 3.0) + aR2.w * 60.0);',
    '  B = (0.35 + 0.55 * tw * tw) * (0.7 + big * 0.8);',
    '  C = mix(uPal[2], uPal[0], smoothstep(0.2, 0.5, aR2.z));',
    '  C = mix(C, uPal[3], smoothstep(0.65, 0.9, aR2.z));',
    '  C = mix(C, uPal[4], step(0.95, aR2.z));',
    '  float flash = step(fract(aR2.w * 7.0 + floor(uBeat) * 0.618), 0.05);',
    '  B *= 1.0 + uPulse * 2.0 * flash;',
    '}'
  ].join('\n');

  FORMS[F.fireflies] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float a = aR1.x, b = aR1.y, c = aR1.z, d = aR1.w;',
    '  if (aR2.w < 0.42) {',
    // a meadow of dim, swaying light near the horizon
    '    float x = (a * 2.0 - 1.0) * 2300.0 * uSpan;',
    '    float z = 120.0 + c * 2200.0;',
    '    float y = 230.0 - pow(b, 1.6) * 110.0;',
    '    x += sin(t * 0.7 + x * 0.003 + z * 0.002) * 20.0 * b;',
    '    P = vec3(x, y, z);',
    '    C = mix(uPal[4], uPal[3], b);',
    '    B = (0.5 + 0.2 * sin(t * 1.3 + a * 40.0)) * (0.6 + b);',
    '    S = 0.9 + d * 0.45;',
    '    if (aR2.w < 0.08) { FOG = 1.0; S = 4.0; B = 0.04; C = mix(uPal[4], uPal[1], 0.4); }',   // ground glow
    '    return;',
    '  }',
    '  float f1 = 0.05 + a * 0.05, f2 = 0.04 + b * 0.05, f3 = 0.03 + c * 0.04;',
    '  float p1 = a * 40.0, p2 = b * 40.0, p3 = c * 40.0;',
    '  P = vec3(sin(t * f1 + p1) * 1400.0 * uSpan + sin(t * 0.31 + b * 20.0) * 80.0,',
    '           -130.0 + sin(t * f2 + p2) * 300.0 + sin(t * 0.43 + c * 30.0) * 45.0,',
    '           1000.0 + sin(t * f3 + p3) * 750.0);',
    '  vec3 vel = vec3(cos(t * f1 + p1) * 1400.0 * uSpan * f1 + cos(t * 0.31 + b * 20.0) * 80.0 * 0.31,',
    '                  cos(t * f2 + p2) * 300.0 * f2 + cos(t * 0.43 + c * 30.0) * 45.0 * 0.43,',
    '                  cos(t * f3 + p3) * 750.0 * f3);',
    '  T = -vel * 0.012;',
    // groups flash in turn on the beats of each bar, the flash sweeping across the meadow;
    // each firefly also glows on its own slow rhythm
    '  float g = floor(aR2.z * 4.0);',
    '  float ph = fract((uBeat - g - (P.x / (2800.0 * uSpan) + 0.5) * 0.6) / 4.0) * 4.0;',
    '  float sync = exp(-ph * 2.2) * step(0.7, aR2.w);',
    '  float own = pow(max(0.0, sin(t * (0.45 + d * 0.6) + aR2.w * 30.0)), 18.0);',
    '  float glow = max(sync, own);',
    '  C = mix(uPal[1], uPal[0], d);',
    '  C = mix(C, uPal[2], glow * 0.5);',
    '  B = 0.05 + glow * 1.5;',
    '  S = 0.8 + glow * 2.2 + d * 0.3;',
    '  FOG = 0.55 * glow;',
    '}'
  ].join('\n');

  FORMS[F.helix] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float u = aR1.y, e = aR2.z;',
    '  float turns = 3.6;',
    '  float Rh = 250.0 * (1.0 + 0.05 * uEnergy);',
    '  vec3 p;',
    '  if (e < 0.6) {',
    '    float strand = step(0.5, aR1.x);',
    '    float aa = u * TAU * turns - t * 0.55 + strand * PI;',
    '    float X = (u * 2.0 - 1.0) * 1500.0;',
    '    p = vec3(X, cos(aa) * Rh, sin(aa) * Rh) + vec3(gauss(aR1.z, aR1.w), gauss(aR1.z, aR1.w + 0.25), gauss(aR2.w, aR1.w)) * 10.0;',
    '    C = mix(uPal[0], uPal[1], strand);',
    '    C = mix(C, uPal[2], step(0.93, aR1.w) * 0.7);',
    '    float front = 0.55 + 0.45 * -sin(aa);',
    '    S = 0.5 + aR1.w * 0.5;',
    '    B = 0.28 + 0.32 * front;',
    '  } else if (e < 0.9) {',
    // base-pair rungs; the beat lights them one after another along the helix
    '    float n = 46.0;',
    '    float ri = floor(u * n);',
    '    float uu = (ri + 0.5) / n;',
    '    float aa = uu * TAU * turns - t * 0.55;',
    '    float X = (uu * 2.0 - 1.0) * 1500.0;',
    '    vec3 p0 = vec3(X, cos(aa) * Rh, sin(aa) * Rh);',
    '    float s = aR1.z;',
    '    p = mix(p0, vec3(X, -p0.y, -p0.z), s);',
    '    float k = exp(-fract(uBeat * 0.5 - uu * 2.0) * 3.5);',
    '    C = mix(uPal[4], uPal[5], s);',
    '    C = mix(C, uPal[2], k * 0.6);',
    '    B = 0.16 + 0.95 * k * (0.5 + uPulse * 0.8);',
    '    S = 0.42 + 0.3 * k;',
    '  } else {',
    '    float r = 380.0 + aR1.z * 700.0;',
    '    float aa = aR1.x * TAU + t * 0.05;',
    '    p = vec3((u * 2.0 - 1.0) * 1900.0 + sin(t * 0.2 + aR1.w * 9.0) * 60.0, cos(aa) * r * 0.6, sin(aa) * r);',
    '    C = mix(uPal[3], uPal[1], aR1.w);',
    '    B = 0.22 + 0.2 * sin(t * 1.5 + aR1.w * 40.0);',
    '    S = 0.6 + aR1.w * 0.8;',
    '  }',
    '  p = rotY(p, sin(t * 0.07) * 0.22);',
    '  p = rotZ(p, -0.12);',
    '  P = p + uOrigin;',
    '}'
  ].join('\n');

  FORMS[F.bloom] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float a = aR1.x, b = aR1.y, c = aR1.z, d = aR1.w, e = aR2.z;',
    '  float breathe = 1.0 + 0.04 * sin(t * 0.45) + 0.06 * uEnergy;',
    '  vec3 p;',
    '  if (e < 0.86) {',
    // two rings of five petals plus an inner ring of ten, alternating spin, cupped toward us
    '    float L = floor(a * 3.0);',
    '    float n = L < 1.5 ? 5.0 : 10.0;',
    '    float rot = t * 0.025 * (L == 1.0 ? -1.0 : 1.0) + L * (PI / 5.0);',
    '    float th = b * TAU;',
    '    float Rmax = (860.0 - L * 250.0) * breathe;',
    '    float r;',
    '    float g = th * n / TAU;',
    '    float pc = floor(g + 0.5);',              // index of the nearest petal
    '    float off = (g - pc) * 2.0;',             // -1..1 across the petal
    '    float width = cos(off * PI * 0.5);',
    '    float petal = pow(max(width, 0.0), 0.5);',
    '    if (d < 0.42) {',
    // soft petal body: dense at the heart, fading toward the tip
    '      r = Rmax * petal * (0.12 + 0.88 * sqrt(c));',
    '      FOG = 1.0;',
    '      B = 0.13 * smoothstep(0.1, 0.5, c);',
    '      S = 1.6 + c * 1.8;',
    '    } else if (d < 0.82) {',
    // petal outline of fine sparks
    '      r = Rmax * petal * (0.965 + 0.035 * c);',
    '      B = 0.9 * (0.5 + 0.5 * petal);',
    '      S = 0.6;',
    '    } else {',
    // a bright vein down the middle of each petal
    '      th = (pc + (c - 0.5) * 0.03) * TAU / n;',
    '      r = Rmax * pow(c, 0.8) * 0.93;',
    '      B = 0.45 * (1.0 - c * 0.6);',
    '      S = 0.4;',
    '      petal = 1.0;',
    '    }',
    '    float rr = r / Rmax;',
    '    p = vec3(cos(th + rot) * r, sin(th + rot) * r, -rr * rr * (300.0 + L * 90.0) + L * 70.0);',
    '    C = mix(uPal[1], uPal[0], smoothstep(0.05, 0.5, rr));',
    '    C = mix(C, L > 1.5 ? uPal[4] : uPal[3], smoothstep(0.55, 1.0, rr) * 0.75);',
    '    C = mix(C, uPal[2], step(0.42, d) * step(d, 0.82) * smoothstep(0.75, 1.0, petal) * 0.3);',
    // a wave of light runs from the heart to the petal tips with every beat
    '    float wv = rr - fract(uBeat);',
    '    B *= 1.0 + 1.5 * uPulse * exp(-wv * wv * 30.0);',
    '  } else if (e < 0.93) {',
    '    float r = sqrt(a) * 95.0 * breathe;',
    '    float th = a * 1200.0 * 2.39996 + t * 0.1;',
    '    p = vec3(cos(th) * r, sin(th) * r, -70.0);',
    '    C = mix(uPal[2], uPal[1], a);',
    '    B = 0.22 + uPulse * 0.3;',
    '    S = 0.38;',
    '  } else {',
    // pollen drifting up and away
    '    float life = fract(b + t * 0.035);',
    '    float r = 150.0 + life * 1000.0;',
    '    float th = a * TAU + life * 1.2;',
    '    p = vec3(cos(th) * r, sin(th) * r * 0.6 - life * 320.0, -120.0 - life * 300.0 + (d - 0.5) * 200.0);',
    '    C = mix(uPal[1], uPal[4], d);',
    '    B = sin(life * PI) * 0.55;',
    '    S = 0.5 + d * 0.5;',
    '  }',
    '  p = rotX(p, 0.3);',
    '  p *= uSpan < 0.6 ? 1.25 : 1.0;',   // narrow screens: a larger flower
    '  P = p + uOrigin;',
    '}'
  ].join('\n');

  FORMS[F.hyper] = [
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float len = 3200.0;',
    '  float z = mod(aR1.y * len - uTravel * 1500.0, len) - 450.0;',
    '  float dz = (z + 450.0) / len;',
    '  float ang = aR1.x * TAU;',
    '  float rad = 200.0 + pow(aR1.z, 0.6) * 1400.0;',
    '  P = vec3(cos(ang) * rad, sin(ang) * rad * 0.72 - 30.0, z);',
    '  T = vec3(0.0, 0.0, 230.0 + 700.0 * uPulse);',
    '  C = mix(uPal[0], uPal[1], aR1.w);',
    '  C = mix(C, uPal[4], step(0.85, aR2.z) * 0.8);',
    '  C = mix(C, uPal[5], step(aR2.z, 0.1) * 0.8);',
    '  B = smoothstep(1.0, 0.45, dz) * smoothstep(0.0, 0.05, dz) * (0.3 + aR2.w * 0.5);',
    '  S = 0.4 + aR1.w * 0.4;',
    '}'
  ].join('\n');

  FORMS[F.nova] = [
    'float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }',
    'void formation(inout vec3 P, inout vec3 T, inout vec3 C, inout float S, inout float B) {',
    '  float t = uTime;',
    '  float a = aR1.x, b = aR1.y, c = aR1.z, d = aR1.w, e = aR2.z;',
    '  vec3 p;',
    '  if (e < 0.34) {',
    // a crisp shock shell bursts out on every downbeat (two generations overlap)
    '    vec3 dir = sphere(a, b);',
    '    float gen = step(0.5, c);',
    '    float age = fract(uBeat / 8.0 + gen * 0.5);',
    '    float R = 60.0 + pow(age, 0.42) * 1250.0;',
    '    p = dir * R;',
    '    T = -dir * (10.0 + 50.0 * (1.0 - age));',
    '    C = mix(uPal[5], mix(uPal[1], uPal[0], d), smoothstep(0.0, 0.3, age));',
    '    float limb = 1.0 - abs(dir.z);',
    '    B = pow(1.0 - age, 1.4) * (0.012 + 1.1 * pow(limb, 7.0)) * smoothstep(0.0, 0.02, age);',
    '    S = 0.4 + (1.0 - age) * 0.4;',
    '  } else if (e < 0.92) {',
    // the remnant: luminous filaments wrapped around a slowly turning shell
    '    float k = floor(a * 46.0);',
    '    vec3 axis = sphere(h11(k), h11(k + 31.7));',
    '    vec3 ref = abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '    vec3 s0 = normalize(cross(axis, ref));',
    '    vec3 s1 = cross(axis, s0);',
    '    float arc = (1.2 + h11(k + 7.1) * 2.0) * (b - 0.5) + h11(k + 3.3) * TAU;',
    '    vec3 dir = s0 * cos(arc) + s1 * sin(arc);',
    '    dir = normalize(dir + axis * (sin(b * 9.0 + k) * 0.08 + sin(b * 23.0 + k * 2.0) * 0.02 + gauss(c, d) * 0.006));',
    '    float layer = h11(k + 9.9);',
    '    float R = 380.0 + layer * 240.0 + gauss(d, c) * 6.0;',
    '    R *= 1.0 + 0.03 * uEnergy;',
    '    p = rotY(dir * R, t * 0.035);',
    '    float hue = h11(k + 5.5);',
    '    C = layer > 0.5 ? (hue < 0.6 ? uPal[0] : uPal[1]) : (hue < 0.5 ? uPal[2] : (hue < 0.8 ? uPal[3] : uPal[4]));',
    '    C = mix(C, uPal[1], step(0.9, d) * 0.6);',
    '    float edgeOn = 1.0 - abs(normalize(p).z);',
    '    if (aR2.w < 0.22) { FOG = 1.0; S = 4.2; B = 0.04 + 0.03 * edgeOn; }',
    '    else {',
    '    B = (0.3 + 0.45 * edgeOn) * (0.7 + 0.3 * sin(b * 20.0 - t * 1.2 + k));',
    '    S = 0.45 + d * 0.2;',
    '    }',
    '  } else {',
    // white-hot core that kicks on the beat
    '    vec3 dir = sphere(a, b);',
    '    float R = pow(c, 2.5) * 60.0 * (1.0 + uPulse * 0.8);',
    '    p = dir * R;',
    '    C = mix(uPal[5], uPal[1], c);',
    '    B = 0.25 + uPulse * 0.35;',
    '    S = 0.4;',
    '  }',
    '  p = rotX(p, 0.3);',
    '  P = p + uOrigin;',
    '}'
  ].join('\n');

  /* Shared particle main: staggered assemble/leave transitions, projection, waves, quad. */
  var VS_PART_MAIN = [
    'vec3 transPos(vec3 P, float life, float leave, float rnd) {',
    '  if (life < 1.0) {',
    '    float p = clamp((life - rnd * 0.45) / 0.55, 0.0, 1.0);',
    '    P = mix(uOrigin + (P - uOrigin) * 0.04, P, outBack(p));',
    '  }',
    '  if (leave > 0.0) {',
    '    float p = clamp((leave - rnd * 0.35) / 0.65, 0.0, 1.0);',
    '    float e = inBack(p);',
    '    P = uOrigin + (P - uOrigin) * (1.0 + e * 1.7) - vec3(0.0, 0.0, e * 650.0);',
    '  }',
    '  return P;',
    '}',
    'void emitQuad(vec2 s0, vec2 s1, float rad, vec3 col, float soft, float tailK, float bead) {',
    '  vec2 ax = s0 - s1;',
    '  float L = length(ax);',
    '  vec2 dir = L > 0.001 ? ax / L : vec2(1.0, 0.0);',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  float h = L * 0.5;',
    '  vec2 pos = (s0 + s1) * 0.5 + dir * aCorner.x * (h + rad) + nrm * aCorner.y * rad;',
    '  vLocal = vec2(aCorner.x * (h + rad) / rad, aCorner.y);',
    '  vHalf = h / rad;',
    '  vCol = col;',
    '  vMisc = vec3(soft, FOG, tailK);',
    '  vFx = vec3(GLINT, bead, tailK > 0.5 ? 1.0 : 2.8);',
    '  gl_Position = vec4(pos.x / uView.x * 2.0 - 1.0, 1.0 - pos.y / uView.y * 2.0, 0.0, 1.0);',
    '}',
    'vec2 project(vec3 P) { return uCenter + P.xy * (uFocal / max(P.z + uCamZ, 1.0)); }',
    'void main() {',
    '  vec3 P = vec3(0.0), T = vec3(0.0), C = vec3(1.0);',
    '  float S = 1.0, B = 1.0;',
    '  float isLine = 0.0, bead = -9.0;',
    '  vec3 P1;',
    '#ifdef SEGMENTS',
    '  if (uMode > 0.5) {',
    // constellation figures: aR1/aR2 hold the two endpoints; aR1.w > 0 marks a star
    '    P = starPos(aR1.x, aR1.y, aR1.z);',
    // each figure redraws itself every two bars: a bead of light runs from star to star (half a beat
    // per line) and every star flares as the bead arrives
    '    if (aR1.w > 0.0) {',
    '      float ph = fract(uBeat / 8.0 - aR2.x) * 8.0 - aR2.y * 0.5;',
    '      float flare = ph >= 0.0 ? exp(-ph * 1.6) : 0.0;',
    '      float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aR2.w * 40.0);',
    '      S = aR1.w * (1.0 + 0.5 * flare); B = 1.3 * tw * (1.0 + uPulse * 0.4 + 1.6 * flare);',
    '      C = mix(mix(uPal[3], uPal[0], 0.5), uPal[0], flare);',
    '      P1 = P;',
    '    } else {',
    '      P1 = starPos(aR2.x, aR2.y, aR2.z);',
    '      isLine = 1.0;',
    '      float seg = -aR1.w - 1.0;',
    '      float ph = fract(uBeat / 8.0 - aR2.w) * 8.0 - (seg - 1.0) * 0.5;',
    '      bead = ph > 0.0 && ph < 0.5 ? ph * 2.0 : -9.0;',
    '      float lit = ph > 0.0 ? exp(-max(ph - 0.5, 0.0) * 0.9) * smoothstep(0.0, 0.5, ph) : 0.0;',
    '      B = 0.6 + 1.6 * lit * (0.8 + uPulse * 0.4);',
    '      C = mix(mix(uPal[1], uPal[2], 0.4), uPal[3], lit * 0.35);',
    '    }',
    '  } else {',
    '    formation(P, T, C, S, B);',
    '    P1 = P + T;',
    '  }',
    '#else',
    '  formation(P, T, C, S, B);',
    '  P1 = P + T;',
    '#endif',
    '  float rnd = aR2.w;',
    '  float a = uAlpha * B * uDensity;',
    '  if (uLife < 1.0) a *= smoothstep(0.0, 0.25, (uLife - rnd * 0.45) / 0.55);',
    '  if (uLeave > 0.0) a *= 1.0 - smoothstep(0.4, 1.0, (uLeave - rnd * 0.35) / 0.65);',
    '  vec3 Q0 = transPos(P, uLife, uLeave, rnd);',
    '  float lifeP = uLife < 1.0 ? uLife - 0.03 : 1.0;',
    '  float leaveP = uLeave > 0.0 ? max(uLeave - 0.025, 0.0) : 0.0;',
    '  vec3 Q1 = isLine > 0.5 ? transPos(P1, uLife, uLeave, rnd) : transPos(P1, lifeP, leaveP, rnd);',
    '  float zz = Q0.z + uCamZ;',
    '  if (zz < 40.0 || a < 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
    '  if (Q1.z + uCamZ < 40.0) Q1 = Q0;',
    '  vec2 s0 = project(Q0);',
    '  vec2 s1 = project(Q1);',
    '  float sc = uFocal / zz;',
    '  float rad = S * uSizeK * sc;',
    '  a *= clamp(1.4 - zz / 2700.0, 0.12, 1.0);',
    // depth of field: near particles swell into soft bokeh discs
    '  float nearK = clamp((760.0 - zz) / 560.0, 0.0, 1.0);',
    '  rad *= 1.0 + nearK * 1.6;',
    '  a /= 1.0 + nearK * 2.5;',
    '  a *= smoothstep(160.0, 320.0, zz);',
    // the beat: anticipation (slight inhale) then swell
    // keep the monster lane calm: dim the brightest formation detail behind the middle of the play space
    '  vec2 cq = (s0 - vec2(uView.x * 0.5, uHorizon * 0.45)) / vec2(uView.x * 0.40, uHorizon * 0.42);',
    '  a *= mix(uCalm, 1.0, smoothstep(0.35, 1.0, length(cq)));',
    '  float sens = 0.5 + fract(rnd * 7.13);',
    '  rad *= 1.0 + uSwell * 0.32 * sens;',
    '  a *= 1.0 + max(uSwell, 0.0) * 0.3;',
    // waves of light push, brighten and tint what they pass
    '  for (int i = 0; i < 8; i++) {',
    '    if (i >= uWaveN) break;',
    '    vec4 w = uWave[i];',
    '    vec2 dv = s0 - w.xy;',
    '    float d = length(dv);',
    '    float wid = 18.0 + w.z * 0.06;',
    '    float x = (d - w.z) / wid;',
    '    float band = exp(-x * x) * w.w;',
    '    vec2 push = dv / max(d, 1.0) * band * 14.0;',
    '    s0 += push; s1 += push;',
    '    rad *= 1.0 + band * 0.45;',
    '    a *= 1.0 + band * 0.9;',
    '    C = mix(C, uWaveC[i], clamp(band * 0.7, 0.0, 0.9));',
    '  }',
    '  a *= smoothstep(uHorizon + 24.0, uHorizon - 16.0, s0.y);',
    '  float tailK = 1.0;',
    '  if (isLine > 0.5) {',
    '    vec2 dd = s0 - s1; float ll = length(dd);',
    '    float gap = min(7.0, ll * 0.3);',
    '    vec2 dn = dd / max(ll, 1e-3);',
    '    s0 -= dn * gap; s1 += dn * gap;',
    '    rad = 5.0; tailK = 0.0;',
    '  } else {',
    '    vec2 ax = s0 - s1; float L = length(ax);',
    '    float maxL = uView.y * MAXL;',
    '    if (L > maxL) s1 = s0;',  // formation wrapped around: no streak
    '    float rpx = rad * uPx;',
    '    if (rpx < 1.15) { a *= pow(rpx / 1.15, 1.2); rad = 1.15 / uPx; }',  // sub-pixel: keep tiny points visible
    '    a /= 1.0 + (min(L, maxL) * 0.5 / rad) * NORM;',
    '  }',
    '  emitQuad(s0, s1, rad, C * a, nearK, tailK, bead);',
    '}'
  ].join('\n');

  var FS_PART = [
    FS_HEAD,
    'varying vec2 vLocal;',
    'varying float vHalf;',
    'varying vec3 vCol, vMisc;',
    'varying vec3 vFx;',
    'void main() {',
    '  float ax = max(abs(vLocal.x) - vHalf, 0.0) * vFx.z;',
    '  float d2 = ax * ax + vLocal.y * vLocal.y * vFx.z * vFx.z;',
    '  float edge = max(1.0 - d2, 0.0);',
    '  float glow = (exp(-d2 * 16.0) + 0.18 * exp(-d2 * 3.2)) * edge;',   // hot core + halo
    '  float fog = exp(-d2 * 3.6) * edge * 0.55;',                       // diffuse light
    '  float dd = sqrt(d2);',
    '  float disc = smoothstep(1.0, 0.8, dd) * (0.7 + 0.3 * smoothstep(0.4, 0.95, dd)) * 0.24;',  // bokeh
    '  float k = mix(mix(glow, fog, vMisc.y), disc, vMisc.x);',
    '  float tail = mix(1.0, smoothstep(-vHalf - 1.0, vHalf + 0.6, vLocal.x), vMisc.z * step(0.01, vHalf));',
    // crystals: a 4-point diffraction glint, fading to zero at the quad edge
    '  if (vFx.x > 0.0) {',
    '    vec2 L = abs(vLocal);',
    '    k += vFx.x * 0.55 * (exp(-L.x * 9.0) * exp(-L.y * 1.6) + exp(-L.y * 9.0) * exp(-L.x * 1.6)) * (1.0 - L.x * L.x) * (1.0 - L.y * L.y);',
    '  }',
    // constellation lines: a bead of light travelling from the earlier star to the next
    '  if (vFx.y > -5.0) {',
    '    float bx = vLocal.x - (1.0 - 2.0 * vFx.y) * vHalf;',
    '    float bd = bx * bx + vLocal.y * vLocal.y;',
    '    k += (exp(-bd * 9.0) * 2.2 + exp(-bd * 2.2) * 0.35) * max(1.0 - bd, 0.0);',
    '  }',
    '  gl_FragColor = vec4(vCol * k * tail, 1.0);',
    '}'
  ].join('\n');

  /* GPU sparks: screen-space bursts, drag + a little gravity, streaked along velocity. */
  var VS_SPARK = [
    'precision highp float;',
    '#define TAU 6.28318530718',
    'attribute vec2 aCorner;',
    'attribute vec4 aR1;',  // x, y, birth, seed
    'attribute vec4 aR2;',  // r, g, b, speed
    'uniform vec2 uView;',
    'uniform float uTime, uPx, uSparkK;',
    'varying vec2 vLocal;',
    'varying float vHalf;',
    'varying vec3 vCol, vMisc;',
    'varying vec3 vFx;',
    'void main() {',
    '  float age = uTime - aR1.z;',
    '  float seed = aR1.w;',
    // a quarter are slow embers that linger and drift down (secondary motion after the flash)
    '  float ember = step(fract(seed * 5.17), 0.25);',
    '  float life = mix(0.5 + fract(seed * 7.31) * 0.8, 1.2 + fract(seed * 7.31) * 0.6, ember);',
    '  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
    '  float ang = seed * TAU * 13.7;',
    '  vec2 dir = vec2(cos(ang), sin(ang));',
    '  float sp = aR2.w * (0.25 + fract(seed * 3.97) * 0.95) * mix(1.0, 0.4, ember);',
    '  float k = mix(2.6, 1.8, ember);',
    '  float ek = exp(-k * age);',
    '  vec2 g = vec2(0.0, mix(150.0, 60.0, ember));',
    '  vec2 s0 = aR1.xy + dir * sp * (1.0 - ek) / k + 0.5 * g * age * age;',
    '  s0.x += ember * sin(age * 3.0 + seed * 40.0) * 6.0 * age;',
    '  vec2 v = dir * sp * ek + g * age;',
    '  vec2 s1 = s0 - v * 0.03;',
    '  float u = age / life;',
    '  float rad = (2.0 + fract(seed * 11.3) * 2.5) * (1.0 - u * 0.5) * uSparkK * mix(1.0, 0.75, ember);',
    '  rad = max(rad, 1.15 / uPx);',
    '  float fade = (1.0 - u) * (1.0 - u);',
    '  fade *= mix(1.0, 0.75 + 0.25 * sin(age * 18.0 + seed * 70.0), ember);',   // embers flicker
    '  vec3 col = mix(vec3(1.0, 0.97, 0.92), aR2.rgb, smoothstep(0.0, 0.12, u)) * fade * 1.7;',
    '  vec2 ax = s0 - s1; float L = length(ax);',
    '  col /= 1.0 + L * 0.5 / rad * 0.2;',
    '  vec2 dr = L > 0.001 ? ax / L : vec2(1.0, 0.0);',
    '  vec2 nr = vec2(-dr.y, dr.x);',
    '  float h = L * 0.5;',
    '  vec2 pos = (s0 + s1) * 0.5 + dr * aCorner.x * (h + rad) + nr * aCorner.y * rad;',
    '  vLocal = vec2(aCorner.x * (h + rad) / rad, aCorner.y);',
    '  vHalf = h / rad; vCol = col; vMisc = vec3(0.0, 0.0, 1.0); vFx = vec3(0.0, -9.0, 1.0);',
    '  gl_Position = vec4(pos.x / uView.x * 2.0 - 1.0, 1.0 - pos.y / uView.y * 2.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* Bloom: soft-knee threshold with a Karis-weighted 5-tap downsample (tames flicker). */
  var FS_PRE = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform vec3 uTh;',  // threshold, knee, clamp
    'float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'void main() {',
    '  vec3 c0 = texture2D(tSrc, vUv).rgb;',
    '  vec3 c1 = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;',
    '  vec3 c2 = texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;',
    '  vec3 c3 = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;',
    '  vec3 c4 = texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;',
    '  float w0 = 4.0 / (1.0 + lum(c0)), w1 = 1.0 / (1.0 + lum(c1)), w2 = 1.0 / (1.0 + lum(c2)), w3 = 1.0 / (1.0 + lum(c3)), w4 = 1.0 / (1.0 + lum(c4));',
    '  vec3 c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / (w0 + w1 + w2 + w3 + w4);',
    '  float br = max(c.r, max(c.g, c.b));',
    '  float rq = clamp(br - uTh.x + uTh.y, 0.0, 2.0 * uTh.y);',
    '  rq = rq * rq / (4.0 * uTh.y + 1e-4);',
    '  float w = max(rq, br - uTh.x) / max(br, 1e-4);',
    '  gl_FragColor = vec4(min(c * w, vec3(uTh.z)), 1.0);',
    '}'
  ].join('\n');

  var FS_DOWN = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'void main() {',
    '  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;',
    '  s += texture2D(tSrc, vUv - uTexel).rgb;',
    '  s += texture2D(tSrc, vUv + uTexel).rgb;',
    '  s += texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;',
    '  s += texture2D(tSrc, vUv - vec2(uTexel.x, -uTexel.y)).rgb;',
    '  gl_FragColor = vec4(s * 0.125, 1.0);',
    '}'
  ].join('\n');

  var FS_UP = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform float uK;',
    'void main() {',
    '  vec2 h = uTexel;',
    '  vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;',
    '  s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;',
    '  s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;',
    '  s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;',
    '  s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;',
    '  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;',
    '  s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;',
    '  s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;',
    '  gl_FragColor = vec4(s / 12.0 * uK, 1.0);',
    '}'
  ].join('\n');

  var FS_COMP = [
    FS_HEAD,
    'varying vec2 vUv;',
    'uniform sampler2D tScene, tBloom;',
    'uniform vec2 uTexel;',
    'uniform float uBloom, uExposure, uInvScale, uTime, uFringe, uVig, uGrain;',
    'float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'vec3 tone(vec3 c) { vec3 x = max(c - 0.6, 0.0); return min(c, 0.6) + 0.4 * (1.0 - exp(-x / 0.4)); }',
    'void main() {',
    '  vec2 dc = vUv - 0.5;',
    '  float r2 = dot(dc, dc);',
    '  vec2 off = dc * r2 * uFringe;',
    '  vec3 sc = vec3(texture2D(tScene, vUv - off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv + off).b);',
    '  vec2 h = uTexel;',
    '  vec3 bl = texture2D(tBloom, vUv + vec2(-h.x, -h.y)).rgb + texture2D(tBloom, vUv + vec2(h.x, -h.y)).rgb',
    '          + texture2D(tBloom, vUv + vec2(-h.x, h.y)).rgb + texture2D(tBloom, vUv + vec2(h.x, h.y)).rgb;',
    '  vec3 col = (sc + bl * 0.25 * uBloom) * uInvScale * uExposure;',
    '  float v = length(dc * vec2(1.0, 0.82)) * 1.35;',
    '  col *= 1.0 - uVig * smoothstep(0.35, 1.05, v);',
    '  col = tone(col);',
    '  vec2 fc = gl_FragCoord.xy + fract(uTime * 13.17) * vec2(311.7, 183.3);',
    '  float n = hash12(fc) + hash12(fc + 71.3) - 1.0;',
    '  float l = dot(col, vec3(0.3, 0.55, 0.15));',
    '  col += n * (1.6 / 255.0 + uGrain * sqrt(max(l, 0.0)) * 0.06);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ================================================================== */
  /* GLWorld                                                             */
  /* ================================================================== */
  function GLWorld(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.opts = opts;
    this.debug = !!(opts.debug || (CK.query && CK.query.gldebug));
    this.ok = false;
    this.lost = false;
    this.t = 0;
    this.travel = 0;
    this.energy = 0;
    this.cur = { theme: TITLE, start: -ASSEMBLE_T * 0.15 };
    this.prev = null;
    this.pending = null;     // theme requested while a crossfade was running
    this.waves = [];
    this.nebT = 0;           // nebula clock (drifts faster in high-energy sections)
    this.secE = 0.5;         // smoothed section energy from the music (0.5 when unknown)
    this._section = null; this._dropT = -10;
    this._horizon = null;
    // preallocated per-frame state (no garbage in the render loop)
    this.cam = { cx: 0, cy: 0, focal: 1, camZ: 600, span: 1 };
    this._shared = { horizon: 0, pulse: 0, swell: 0, bclock: 0, nw: 0 };
    this._pp = new Float32Array(3);
    this._pA = new Float32Array(16); this._pB = new Float32Array(16);
    this._waveA = new Float32Array(MAXW * 4); this._waveC = new Float32Array(MAXW * 3);
    this._warmFrame = 0;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.sparkHead = 0;
    // adaptive quality
    this.tier = 0;
    this.tierCeil = 0;
    this._ema = 16.7; this._minDt = 16.7; this._lastNow = 0; this._qTimer = 0; this._lastChange = 0; this._upAt = -1;
    this.stats = { tier: 0, scale: 1, count: 0, hdr: false, gl2: false, software: false, frameMs: 0 };

    var self = this;
    if (CK.query && (CK.query.gl === '0' || CK.query.nogl)) return;
    if (!this._createContext()) return;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; self.ok = false; }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      self.lost = false;
      self.ok = self._initGL();
      if (self.ok && self.W) self._alloc();
    }, false);
    this.ok = this._initGL();
    var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (this.ok) this.resize((r && r.width) || window.innerWidth || 960, (r && r.height) || window.innerHeight || 540, Math.min(window.devicePixelRatio || 1, 2));
  }

  GLWorld.prototype._createContext = function () {
    var c = this.canvas;
    var base = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!this.opts.preserve, powerPreference: 'default' };
    var tries = [true, false], gl = null, isGL2 = false;
    for (var i = 0; i < tries.length && !gl; i++) {
      if (!tries[i] && this.opts.allowSoftware === false) break;
      var attrs = {}; for (var k in base) attrs[k] = base[k];
      attrs.failIfMajorPerformanceCaveat = tries[i];
      if (!this.opts.webgl1) { try { gl = c.getContext('webgl2', attrs); isGL2 = !!gl; } catch (e) { gl = null; } }
      if (!gl) { try { gl = c.getContext('webgl', attrs) || c.getContext('experimental-webgl', attrs); } catch (e2) { gl = null; } }
      if (gl && !tries[i]) this.software = true;
    }
    if (!gl) return false;
    this.gl = gl; this.isGL2 = isGL2;
    return true;
  };

  /* (Re)create every GL resource. Returns false if something essential is missing. */
  GLWorld.prototype._initGL = function () {
    var gl = this.gl;
    if (!gl || gl.isContextLost()) return false;
    this.progs = {}; this.formProgs = []; this.targets = null; this._warmQueue = [];
    // instancing
    if (this.isGL2) {
      this._inst = { draw: function (m, f, c, n) { gl.drawArraysInstanced(m, f, c, n); }, div: function (l, d) { gl.vertexAttribDivisor(l, d); } };
    } else {
      var ia = gl.getExtension('ANGLE_instanced_arrays');
      if (!ia) return false;
      this._inst = { draw: function (m, f, c, n) { ia.drawArraysInstancedANGLE(m, f, c, n); }, div: function (l, d) { ia.vertexAttribDivisorANGLE(l, d); } };
    }
    this._detectFormat();
    this._parallel = gl.getExtension('KHR_parallel_shader_compile');
    // programs
    try {
      this.progs.neb = this._program(VS_FULL, FS_NEBULA, ['aPos']);
      this.progs.bg = this._program(VS_FULL, FS_BG, ['aPos']);
      this.progs.pre = this._program(VS_FULL, FS_PRE, ['aPos']);
      this.progs.down = this._program(VS_FULL, FS_DOWN, ['aPos']);
      this.progs.up = this._program(VS_FULL, FS_UP, ['aPos']);
      this.progs.comp = this._program(VS_FULL, FS_COMP, ['aPos']);
      this.progs.spark = this._program(VS_SPARK, FS_PART, ['aCorner', 'aR1', 'aR2']);
    } catch (err) {
      if (window.console) console.warn('GLWorld: shader setup failed', err);
      return false;
    }
    // formation programs compile lazily; queue them all (current first) to warm up one per frame
    var order = [this.cur.theme.form];
    for (var f = 0; f < 12; f++) if (order.indexOf(f) < 0) order.push(f);
    this._warmQueue = order;
    if (!this._formProgram(this.cur.theme.form)) return false;
    this._buffers();
    this._noiseTexture();
    return true;
  };

  GLWorld.prototype._detectFormat = function () {
    var gl = this.gl, fmt = null;
    var test = function (internal, format, type) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      while (gl.getError() !== gl.NO_ERROR) { /* clear probe errors */ }
      return ok;
    };
    if (this.opts.ldr) {
      fmt = null;
    } else if (this.isGL2) {
      if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) {
        if (test(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT)) fmt = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, hdr: true };
      }
    } else {
      var hf = gl.getExtension('OES_texture_half_float');
      var hfl = gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('EXT_color_buffer_half_float');
      if (hf && hfl && test(gl.RGBA, gl.RGBA, hf.HALF_FLOAT_OES)) fmt = { internal: gl.RGBA, format: gl.RGBA, type: hf.HALF_FLOAT_OES, hdr: true };
    }
    if (!fmt) fmt = { internal: gl.RGBA, format: gl.RGBA, type: gl.UNSIGNED_BYTE, hdr: false };
    this.fmt = fmt;
    // LDR targets store the scene at half intensity to keep some highlight headroom.
    this.sceneScale = fmt.hdr ? 1 : 0.5;
    this.stats.hdr = fmt.hdr; this.stats.gl2 = this.isGL2; this.stats.software = !!this.software;
  };

  GLWorld.prototype._shader = function (type, src) {
    var gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  /* Compile + link. With KHR_parallel_shader_compile the status check is deferred. */
  GLWorld.prototype._program = function (vs, fs, attribs, deferred) {
    var gl = this.gl, p = gl.createProgram();
    var v = this._shader(gl.VERTEX_SHADER, vs), f = this._shader(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f);
    for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
    gl.linkProgram(p);
    var prog = { p: p, vs: v, fs: f, vsSrc: vs, fsSrc: fs, checked: false, cache: {} };
    var u = function (name) {
      var c = prog.cache;
      if (!(name in c)) c[name] = gl.getUniformLocation(p, name);
      return c[name];
    };
    prog.u = u;
    if (!deferred) this._check(prog);
    return prog;
  };
  GLWorld.prototype._check = function (prog) {
    if (prog.checked) return prog.good;
    var gl = this.gl;
    prog.checked = true;
    prog.good = !!gl.getProgramParameter(prog.p, gl.LINK_STATUS);
    if (!prog.good) {
      var log = (gl.getShaderInfoLog(prog.vs) || '') + '\n' + (gl.getShaderInfoLog(prog.fs) || '') + '\n' + (gl.getProgramInfoLog(prog.p) || '');
      if (!gl.isContextLost()) throw new Error('GLWorld shader link failed: ' + log);
    }
    return prog.good;
  };
  GLWorld.prototype._formProgram = function (form, deferred) {
    var p = this.formProgs[form];
    if (p === false) return null;
    if (!p) {
      var defs = '#define FORM ' + form + '\n' + (form === F.stars ? '#define SEGMENTS 1\n' : '');
      // #define must come after precision in our header? No: put defines first, precision is in the head.
      var vs = defs + VS_PART_HEAD + '\n' + FORMS[form] + '\n' + VS_PART_MAIN;
      p = this._program(vs, FS_PART, ['aCorner', 'aR1', 'aR2'], true);
      this.formProgs[form] = p;
      if (deferred) return p;
    }
    if (!p.checked) {
      // with KHR_parallel_shader_compile, skip the formation until the driver has finished (no stall)
      if (this._parallel && !this.gl.getProgramParameter(p.p, this._parallel.COMPLETION_STATUS_KHR)) return null;
      try { this._check(p); } catch (err) {
        if (window.console) console.warn(err.message);
        this.formProgs[form] = false;
        return null;
      }
    }
    return p.good ? p : null;
  };
  /* Warm-up: once the first world has assembled, start compiling one queued formation every 20
     frames (never blocks on the result), so later theme changes do not hitch. */
  GLWorld.prototype._warm = function () {
    if (!this._warmQueue.length || this.t < ASSEMBLE_T) return;
    if ((this._warmFrame++ % 20) !== 0) return;
    var f = this._warmQueue.shift();
    if (!this.formProgs[f]) this._formProgram(f, true);
  };

  GLWorld.prototype._buffers = function () {
    var gl = this.gl;
    // fullscreen triangle + instanced quad corners
    this.bufTri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufTri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.bufQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // per-particle attributes: 4 random + 2 Halton (even coverage for any prefix) + 2 random
    var d = new Float32Array(MAXP * 8), rnd = mulberry(20240611);
    for (var i = 0; i < MAXP; i++) {
      var o = i * 8;
      d[o] = rnd(); d[o + 1] = rnd(); d[o + 2] = rnd(); d[o + 3] = rnd();
      d[o + 4] = halton(i + 1, 2); d[o + 5] = halton(i + 1, 3); d[o + 6] = rnd(); d[o + 7] = rnd();
    }
    this.bufPart = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPart);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    // sparks ring buffer
    this.sparkData = new Float32Array(MAXS * 8);
    for (var s = 0; s < MAXS; s++) this.sparkData[s * 8 + 2] = -1e6;
    this.bufSpark = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSpark);
    gl.bufferData(gl.ARRAY_BUFFER, this.sparkData, gl.DYNAMIC_DRAW);
    // constellation figures (stars + connecting lines), same sky every time
    var seg = this._constellations();
    this.segCount = seg.length / 8;
    this.bufSeg = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSeg);
    gl.bufferData(gl.ARRAY_BUFFER, seg, gl.STATIC_DRAW);
  };

  GLWorld.prototype._constellations = function () {
    var rnd = mulberry(77), out = [], figs = 18;
    for (var c = 0; c < figs; c++) {
      var a0 = 0.22 + rnd() * 0.56, b0 = c / figs + rnd() * 0.03, n = 4 + Math.floor(rnd() * 4);
      var pts = [], depth = rnd() * 0.3;
      var a = a0, b = b0;
      for (var i = 0; i < n; i++) {
        if (i) { var ang = rnd() * TAU; a = clamp(a + Math.cos(ang) * 0.035, 0.05, 0.95); b += Math.sin(ang) * 0.02; }
        pts.push([a, b, depth + rnd() * 0.05]);
      }
      // stars: aR1 = position + size, aR2 = (figure phase, star index, -, twinkle seed)
      // lines: aR1 = from-star + (-1 - index), aR2 = to-star + figure phase
      for (var j = 0; j < n; j++) {
        var p = pts[j];
        out.push(p[0], p[1], p[2], 1.6 + rnd() * 1.4, c / figs, j, 0, rnd());
        if (j) {
          // connect to the nearest earlier star (a small tree, like real figures)
          var best = 0, bd = 1e9;
          for (var k = 0; k < j; k++) {
            var dx = pts[k][0] - p[0], dy = pts[k][1] - p[1], dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = k; }
          }
          var q = pts[best];
          out.push(q[0], q[1], q[2], -1 - j, p[0], p[1], p[2], c / figs);
        }
      }
    }
    return new Float32Array(out);
  };

  GLWorld.prototype._noiseTexture = function () {
    var gl = this.gl, N = 256, data = new Uint8Array(N * N * 4), rnd = mulberry(9001);
    for (var i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
    this.texNoise = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texNoise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  };

  /* ------------------------------------------------------------------ */
  /* Size, quality and render targets                                     */
  /* ------------------------------------------------------------------ */
  var TIERS = [
    { res: 1.0, n: 1.0 }, { res: 0.86, n: 0.85 }, { res: 0.74, n: 0.7 }, { res: 0.62, n: 0.56 }, { res: 0.52, n: 0.44 }, { res: 0.42, n: 0.34 }
  ];

  GLWorld.prototype.resize = function (W, H, dpr) {
    if (!this.gl) return;
    W = Math.max(1, W || 1); H = Math.max(1, H || 1);
    dpr = Math.min(dpr || 1, 2);
    if (W === this.W && H === this.H && dpr === this.dpr && this.targets) return;
    var first = !this.W;
    this.W = W; this.H = H; this.dpr = dpr;
    if (first) {
      // starting tier from a rough device guess; measured frame times refine it
      var coarse = false;
      try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* ignore */ }
      this.mobile = coarse || Math.min(W, H) < 500;
      this.tier = this.opts.fixedTier != null ? clamp(this.opts.fixedTier, 0, TIERS.length - 1) : (this.software ? TIERS.length - 2 : (this.mobile ? 1 : 0));
      this.tierCeil = 0;
    }
    this._hz = null;
    // the canvas is sized by CSS (e.g. .layer: inset 0, 100%); its backing store may be smaller than
    // CSS px × dpr at reduced quality tiers and is stretched by the browser
    if (this.ok) this._alloc();
  };

  GLWorld.prototype._makeTarget = function (w, h) {
    var gl = this.gl, f = this.fmt;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fb: fb, w: w, h: h };
  };
  GLWorld.prototype._freeTargets = function () {
    var gl = this.gl, t = this.targets;
    if (!t) return;
    var all = [t.scene, t.neb].concat(t.bloom);
    for (var i = 0; i < all.length; i++) { gl.deleteTexture(all[i].tex); gl.deleteFramebuffer(all[i].fb); }
    this.targets = null;
  };

  /* Allocate render targets for the current size and quality tier. */
  GLWorld.prototype._alloc = function () {
    var gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    var W = this.W, H = this.H, dpr = this.dpr;
    var cap = this.mobile ? 1.25e6 : 2.4e6;
    var full = W * H * dpr * dpr;
    var scale = dpr * TIERS[this.tier].res * Math.min(1, Math.sqrt(cap / full));
    var sw = Math.max(16, Math.round(W * scale)), sh = Math.max(16, Math.round(H * scale));
    this.pxScale = sw / W;
    this.stats.scale = +(sw / (W * dpr)).toFixed(3);
    if (this.canvas.width !== sw) this.canvas.width = sw;
    if (this.canvas.height !== sh) this.canvas.height = sh;
    this._freeTargets();
    var t = { scene: this._makeTarget(sw, sh), neb: this._makeTarget(Math.max(8, Math.ceil(sw / 2)), Math.max(8, Math.ceil(sh / 2))), bloom: [] };
    // halve down to ~8 texels so the halo spans the same share of the screen at any resolution
    var bw = Math.ceil(sw / 2), bh = Math.ceil(sh / 2);
    for (var i = 0; i < 8 && Math.min(bw, bh) >= 8; i++) {
      t.bloom.push(this._makeTarget(bw, bh));
      bw = Math.ceil(bw / 2); bh = Math.ceil(bh / 2);
    }
    this.targets = t;
  };

  /* Frame-time driven quality: step down when frames run long, creep back up when there is room. */
  GLWorld.prototype._measure = function () {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var fdt = now - (this._lastNow || now);
    this._lastNow = now;
    // > 1 s gaps are tab switches / pauses, not rendering cost
    if (!(fdt > 0 && fdt < 1000) || this.opts.fixedTier != null) return;
    fdt = Math.min(fdt, 250);
    this._ema += (fdt - this._ema) * 0.06;
    this._minDt = Math.min(this._minDt + 0.002, fdt);   // slowly relaxing estimate of the display interval
    this._qTimer += fdt / 1000;
    this.stats.frameMs = +this._ema.toFixed(2);
    if (this._qTimer < 1.5) return;
    this._qTimer = 0;
    // slower than the display can show (and below ~54 fps): step down. 60 fps on a 120 Hz screen is fine.
    var budget = Math.max(this._minDt * 1.22, this._minDt + 2.5, 18.5);
    var nowS = now / 1000;
    if (this._ema > budget && this.tier < TIERS.length - 1) {
      // if the last two steps down did not make frames faster, something else is the bottleneck:
      // stop degrading the background (re-probe after a while)
      if (this._downEma && this._ema > this._downEma * 0.95 && this.tier >= 2 && nowS - this._lastChange < 20) { this.stats.tier = this.tier; return; }
      // an upgrade that immediately struggles lowers the ceiling for good
      if (this._upAt > 0 && nowS - this._upAt < 6) this.tierCeil = Math.min(TIERS.length - 1, this.tier + 1);
      this._downEma = this._ema;
      this.tier++; this._lastChange = nowS; this._upAt = -1;
      this._alloc();
    } else if (this._ema < this._minDt * 1.06 + 0.4 && this.tier > this.tierCeil && nowS - this._lastChange > 7) {
      this.tier--; this._lastChange = nowS; this._upAt = nowS; this._downEma = 0;
      this._alloc();
    }
    this.stats.tier = this.tier;
  };

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */
  GLWorld.prototype.setTheme = function (idx) {
    var i = Math.floor(+idx), n = THEMES.length;
    var th = idx == null || isNaN(i) ? TITLE : THEMES[((i % n) + n) % n];
    if (this.gl && this.ok) this._formProgram(th.form, true);   // start compiling now
    if (th === this.cur.theme) { this.pending = null; return; }
    if (this.prev) {
      // a crossfade is running: if it has barely begun, swap the incoming world in place;
      // otherwise queue the request so nothing is cut off mid-fade (it starts when this one ends)
      if (this.t - this.cur.start < BLEND_T * 0.15) {
        if (th === this.prev.theme) { this.cur = this.prev; this.prev = null; }
        else this.cur.theme = th;
        this.pending = null;
      } else {
        this.pending = th;
      }
      return;
    }
    this.prev = { theme: this.cur.theme, start: this.cur.start };
    this.cur = { theme: th, start: this.t };
  };

  GLWorld.prototype.wave = function (x, y, color, strength) {
    x = +x; y = +y;
    if (!isFinite(x) || !isFinite(y)) return;
    var s = +strength;
    if (strength == null || !isFinite(s)) s = 1;
    this.waves.push({ x: x, y: y, t: 0, c: hexRgb(color || '#ffffff'), s: clamp(s, 0, 2), R: 0 });
    if (this.waves.length > MAXW) this.waves.shift();
  };

  /* n sparks at a CSS-px point; color may be one colour or an array (each spark picks one). */
  GLWorld.prototype.burst = function (x, y, color, n) {
    x = +x; y = +y;
    if (!this.ok || !isFinite(x) || !isFinite(y)) return;
    var gl = this.gl, cols = [];
    if (color && typeof color === 'object' && color.length) { for (var c = 0; c < color.length; c++) cols.push(hexRgb(color[c])); }
    else cols.push(hexRgb(color || '#ffffff'));
    n = Math.floor(+n);
    if (!isFinite(n)) n = 24;
    n = clamp(n, 0, 400);
    if (!n) return;
    var sp = 260 + Math.min(this.W, this.H) * 0.35;
    var first = this.sparkHead, d = this.sparkData;
    for (var i = 0; i < n; i++) {
      var o = ((first + i) % MAXS) * 8;
      var col = cols[Math.floor(Math.random() * cols.length)];
      var tint = Math.random() < 0.2 ? 1 : 0;   // a few white-hot sparks
      d[o] = x; d[o + 1] = y; d[o + 2] = this.t; d[o + 3] = Math.random();
      d[o + 4] = tint ? 1 : col[0]; d[o + 5] = tint ? 1 : col[1]; d[o + 6] = tint ? 1 : col[2]; d[o + 7] = sp;
    }
    this.sparkHead = (first + n) % MAXS;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSpark);
    if (first + n <= MAXS) {
      gl.bufferSubData(gl.ARRAY_BUFFER, first * 32, d.subarray(first * 8, (first + n) * 8));
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    }
    this._sparkUntil = this.t + 2.0;
  };

  /* ------------------------------------------------------------------ */
  /* Drawing                                                              */
  /* ------------------------------------------------------------------ */
  GLWorld.prototype._bindFull = function (prog) {
    var gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufTri);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  };
  GLWorld.prototype._target = function (t) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    if (t) gl.viewport(0, 0, t.w, t.h); else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  };
  GLWorld.prototype._tex = function (unit, tex) {
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  GLWorld.prototype._err = function (where) {
    if (!this.debug) return;
    var e = this.gl.getError();
    if (e !== this.gl.NO_ERROR) {
      this.glErrors = (this.glErrors || 0) + 1;
      if (window.console) console.warn('GLWorld GL error 0x' + e.toString(16) + ' at ' + where);
    }
  };

  /* Project a world point with the current camera (for sky lights) into out = [x, y, scale]. */
  GLWorld.prototype._proj = function (x, y, z, out) {
    var c = this.cam, zz = Math.max(40, z + c.camZ), sc = c.focal / zz;
    out[0] = c.cx + x * sc; out[1] = c.cy + y * sc; out[2] = sc;
    return out;
  };

  GLWorld.prototype._themeUniforms = function (prog, th, nameN, nameP, nameG, buf) {
    var gl = this.gl, u = prog.u, g = th.glow, n = th.neb;
    var pp = this._proj(g.at[0] * this.cam.span, g.at[1], g.at[2], this._pp);
    gl.uniform3fv(u(nameN), th._neb);
    buf[0] = n.p[0]; buf[1] = n.p[1]; buf[2] = n.p[2]; buf[3] = n.p[3];
    buf[4] = n.q[0]; buf[5] = n.q[1]; buf[6] = n.q[2]; buf[7] = n.q[3];
    buf[8] = pp[0]; buf[9] = pp[1]; buf[10] = g.r * pp[2]; buf[11] = g.i;
    buf[12] = g.type; buf[13] = 0; buf[14] = 0; buf[15] = 0;
    gl.uniform4fv(u(nameP), buf);
    gl.uniform3fv(u(nameG), th._glowCol);
  };

  GLWorld.prototype.draw = function (dt, beat, horizonY) {
    if (!this.ok || this.lost || !this.targets) return;
    var gl = this.gl;
    if (gl.isContextLost()) return;
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.t += dt;
    this._measure();
    this._warm();
    var W = this.W, H = this.H, t = this.t;
    var horizon = horizonY != null && isFinite(horizonY) ? clamp(+horizonY, 0, H + 40) : H * 0.62;
    this._horizon = horizon;

    // beat clock: real music beat when present, otherwise a slow synthetic clock
    var pulse = beat && beat.pulse > 0 ? Math.min(1, +beat.pulse) : 0;
    var hasBeat = !!(beat && beat.beat > 0);
    var bclock = hasBeat ? +beat.beat : t * 1.5;
    var frac = bclock - Math.floor(bclock);
    var pre = hasBeat ? smooth((frac - 0.78) / 0.22) : 0;          // anticipation before the beat
    // the song's structure: section energy (intro 0.3 … drop 1.0) scales brightness, bloom and speed
    var bE = beat && beat.energy != null && isFinite(beat.energy) ? clamp(+beat.energy, 0, 1) : 0.5;
    this.secE += (bE - this.secE) * (1 - Math.exp(-dt * 0.8));
    var secE = this.secE;
    this.energy += (0.6 * secE + 0.4 * pulse - this.energy) * (1 - Math.exp(-dt * 2.5));
    // the drop: a release of light from the formation's heart plus a brief swell
    var section = beat && beat.section ? String(beat.section) : null;
    if (section !== this._section) {
      if (this._section && (section === 'drop' || section === 'drop2')) {
        var o = this.cur.theme.origin;
        this._proj(o[0] * this.cam.span, o[1], o[2], this._pp);
        var pc = this.cur.theme.pal;
        this.wave(clamp(this._pp[0], 0, W), clamp(this._pp[1], 0, horizon), pc[1], section === 'drop' ? 0.75 : 0.55);
        this.waves[this.waves.length - 1].t = 0.12;   // start as an open ring, not a hot spot on the dense centre
        this._dropT = t;
      }
      this._section = section;
    }
    var dk = t - this._dropT;
    var dropSwell = dk < 0.45 ? 0.4 * smooth(dk / 0.06) * (1 - smooth((dk - 0.06) / 0.39)) : 0;
    var swell = pulse - pre * 0.22 + dropSwell;
    this.travel += dt * (1 + pulse * 1.4) * (0.8 + 0.6 * secE);
    this.nebT += dt * (1 + secE);

    // camera (same model as world.js so formations frame the play space the same way); the
    // centre follows the horizon with a little lag so the world drifts after the piano moves
    if (this._hz == null) this._hz = horizon;
    this._hz += (horizon - this._hz) * (1 - Math.exp(-dt * 6));
    // tall play areas (portrait phones) zoom in so formations fill the space instead of shrinking to the width
    var zoom = clamp(this._hz / (W * 0.62), 1, 1.6);
    // narrow screens: wide "field" formations and off-centre origins pull in horizontally
    var cam = this.cam;
    cam.cx = W / 2; cam.cy = this._hz * 0.5; cam.focal = Math.min(W, H) * 0.9 * zoom; cam.camZ = 600;
    cam.span = clamp(W / H / 1.5, 0.35, 1);

    // theme blend (a theme requested mid-fade starts as soon as the running fade ends)
    var since = t - this.cur.start;
    if (this.prev && since >= BLEND_T) {
      this.prev = null;
      if (this.pending && this.pending !== this.cur.theme) {
        this.prev = { theme: this.cur.theme, start: this.cur.start };
        this.cur = { theme: this.pending, start: t };
        since = 0;
      }
      this.pending = null;
    }
    // hold the incoming world's clock while its shader is still compiling in the background
    var fpr = this.formProgs[this.cur.theme.form];
    if (since < 1.0 && fpr && !fpr.checked && !this._formProgram(this.cur.theme.form)) { this.cur.start += dt; since = t - this.cur.start; }
    var mix = this.prev ? smooth(since / BLEND_T) : 1;
    var A = this.prev ? this.prev.theme : this.cur.theme, B = this.cur.theme;

    // waves → uniform arrays. Each ring grows to just past the farthest corner of the play space.
    var waveA = this._waveA, waveC = this._waveC, nw = 0, i;
    for (i = this.waves.length - 1; i >= 0; i--) { this.waves[i].t += dt; if (this.waves[i].t > WAVE_T) this.waves.splice(i, 1); }
    for (i = 0; i < this.waves.length && nw < MAXW; i++) {
      var wv = this.waves[i], k = wv.t / WAVE_T;
      if (!wv.R) {
        var dx = Math.max(wv.x, W - wv.x), dy = Math.max(wv.y, Math.abs(horizon - wv.y));
        wv.R = Math.max(120, 1.1 * Math.sqrt(dx * dx + dy * dy));
      }
      waveA[nw * 4] = wv.x; waveA[nw * 4 + 1] = wv.y;
      waveA[nw * 4 + 2] = wv.R * (1 - Math.pow(1 - k, 1.5));
      waveA[nw * 4 + 3] = Math.min(wv.s, WAVE_MAXS) * Math.pow(1 - k, 1.6) * smooth(k / 0.06);
      waveC[nw * 3] = wv.c[0]; waveC[nw * 3 + 1] = wv.c[1]; waveC[nw * 3 + 2] = wv.c[2];
      nw++;
    }
    var T = this.targets;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    /* 1. nebula (half res) */
    var p = this.progs.neb, u = p.u;
    this._target(T.neb);
    this._bindFull(p);
    this._tex(0, this.texNoise);
    gl.uniform1i(u('tNoise'), 0);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform1f(u('uTime'), this.nebT);
    gl.uniform1f(u('uMix'), mix);
    gl.uniform1f(u('uPulse'), pulse);
    gl.uniform1f(u('uEnergy'), this.energy);
    gl.uniform1f(u('uHorizon'), horizon);
    gl.uniform1f(u('uScale'), this.sceneScale);
    this._themeUniforms(p, A, 'uNA', 'uPA', 'uGA', this._pA);
    this._themeUniforms(p, B, 'uNB', 'uPB', 'uGB', this._pB);
    gl.uniform4fv(u('uWave'), waveA); gl.uniform3fv(u('uWaveC'), waveC); gl.uniform1i(u('uWaveN'), nw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._err('nebula');

    /* 2. scene: background + stars */
    p = this.progs.bg; u = p.u;
    this._target(T.scene);
    this._bindFull(p);
    this._tex(0, T.neb.tex);
    gl.uniform1i(u('tNeb'), 0);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform1f(u('uTime'), t);
    gl.uniform1f(u('uStarI'), lerp(A.stars, B.stars, mix) * this.sceneScale);
    gl.uniform1f(u('uPx'), this.pxScale);
    gl.uniform1f(u('uPulse'), pulse);
    gl.uniform2f(u('uDrift'), -4, 0.6);
    gl.uniform4fv(u('uWave'), waveA); gl.uniform1i(u('uWaveN'), nw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._err('background');

    /* 3. particles (additive) */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    var sh = this._shared;
    sh.horizon = horizon; sh.pulse = pulse; sh.swell = swell; sh.bclock = bclock; sh.nw = nw;
    sh.alphaK = 0.85 + 0.3 * secE;
    if (this.prev) this._drawForm(A, this.prev.start, 1 - mix, clamp(since / BLEND_T, 0, 1), sh);
    this._drawForm(B, this.cur.start, this.prev ? mix : 1, 0, sh);
    if (this._sparkUntil && t < this._sparkUntil) this._drawSparks();
    gl.disable(gl.BLEND);
    this._err('particles');

    /* 4. bloom + composite */
    // theme bloom character shapes the halo; section energy and the drop scale it linearly
    this._bloomGain = 0.9 + 0.35 * secE + dropSwell * 0.5;
    this._bloom(lerp(A.bloom, B.bloom, mix));
    this._composite(lerp(A.exposure, B.exposure, mix));
    this._err('post');
  };

  GLWorld.prototype._drawForm = function (th, start, alpha, leave, s) {
    if (alpha <= 0.002) return;
    var prog = this._formProgram(th.form);
    if (!prog) return;
    var gl = this.gl, u = prog.u, W = this.W, H = this.H, cam = this.cam;
    var baseN = (this.mobile ? 10000 : 16000) * th.count;
    var full = Math.min(MAXP, Math.round(16000 * th.count));   // density reference: the full desktop count
    var n = Math.min(MAXP, Math.round(baseN * TIERS[this.tier].n));
    this.stats.count = n;
    gl.useProgram(prog.p);
    gl.uniform2f(u('uView'), W, H);
    gl.uniform2f(u('uCenter'), cam.cx, cam.cy);
    gl.uniform1f(u('uFocal'), cam.focal);
    gl.uniform1f(u('uCamZ'), cam.camZ);
    gl.uniform1f(u('uHorizon'), s.horizon);
    gl.uniform1f(u('uPx'), this.pxScale);
    gl.uniform1f(u('uTime'), this.t);
    gl.uniform1f(u('uBeat'), s.bclock);
    gl.uniform1f(u('uPulse'), s.pulse);
    gl.uniform1f(u('uSwell'), s.swell);
    gl.uniform1f(u('uEnergy'), this.energy);
    gl.uniform1f(u('uTravel'), this.travel);
    gl.uniform1f(u('uAlpha'), alpha * this.sceneScale * (th.gain || 1) * s.alphaK);
    gl.uniform1f(u('uLife'), clamp((this.t - start) / ASSEMBLE_T, 0, 1));
    gl.uniform1f(u('uLeave'), leave);
    var m = Math.min(W, H);
    gl.uniform1f(u('uSizeK'), m / 95 * 1.55 * Math.max(1, Math.sqrt(600 / m)));   // small screens: slightly larger sprites
    gl.uniform1f(u('uDensity'), Math.pow(full / Math.max(1, n), 0.6));
    gl.uniform1f(u('uMode'), 0);
    gl.uniform1f(u('uCalm'), th.calm || 1);
    gl.uniform3fv(u('uPal'), th._pal);
    gl.uniform4fv(u('uFP'), th._fp);
    gl.uniform4fv(u('uFQ'), th._fq);
    gl.uniform3f(u('uOrigin'), th.origin[0] * cam.span, th.origin[1], th.origin[2]);
    gl.uniform1f(u('uSpan'), cam.span);
    gl.uniform4fv(u('uWave'), this._waveA); gl.uniform3fv(u('uWaveC'), this._waveC); gl.uniform1i(u('uWaveN'), s.nw);
    this._instanced(this.bufPart, n);
    if (th.form === F.stars && this.segCount) {
      gl.uniform1f(u('uMode'), 1);
      gl.uniform1f(u('uDensity'), 1);
      this._instanced(this.bufSeg, this.segCount);
    }
  };

  GLWorld.prototype._instanced = function (buf, count) {
    var gl = this.gl, inst = this._inst;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    inst.div(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    inst.div(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    inst.div(2, 1);
    inst.draw(gl.TRIANGLE_STRIP, 0, 4, count);
    // leave attribute state clean for the fullscreen passes
    inst.div(1, 0); inst.div(2, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  };

  GLWorld.prototype._drawSparks = function () {
    var gl = this.gl, p = this.progs.spark, u = p.u;
    gl.useProgram(p.p);
    gl.uniform2f(u('uView'), this.W, this.H);
    gl.uniform1f(u('uTime'), this.t);
    gl.uniform1f(u('uPx'), this.pxScale);
    gl.uniform1f(u('uSparkK'), Math.max(0.8, Math.min(this.W, this.H) / 600));
    this._instanced(this.bufSpark, MAXS);
  };

  GLWorld.prototype._bloom = function (strength) {
    var gl = this.gl, T = this.targets, L = T.bloom;
    if (!L.length) return;
    // prefilter: scene → level 0
    var p = this.progs.pre, u = p.u;
    this._target(L[0]);
    this._bindFull(p);
    this._tex(0, T.scene.tex);
    gl.uniform1i(u('tSrc'), 0);
    gl.uniform2f(u('uTexel'), 1 / T.scene.w, 1 / T.scene.h);
    var thr = this.fmt.hdr ? 0.55 : 0.55 * this.sceneScale;
    gl.uniform3f(u('uTh'), thr, thr * 0.6, this.fmt.hdr ? 24.0 : 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // downsample chain
    p = this.progs.down; u = p.u;
    this._bindFull(p);
    gl.uniform1i(u('tSrc'), 0);
    for (var i = 1; i < L.length; i++) {
      this._target(L[i]);
      this._tex(0, L[i - 1].tex);
      gl.uniform2f(u('uTexel'), 1 / L[i - 1].w, 1 / L[i - 1].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // upsample chain, accumulating into each larger level
    p = this.progs.up; u = p.u;
    this._bindFull(p);
    gl.uniform1i(u('tSrc'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (i = L.length - 2; i >= 0; i--) {
      this._target(L[i]);
      this._tex(0, L[i + 1].tex);
      gl.uniform2f(u('uTexel'), 0.5 / L[i + 1].w, 0.5 / L[i + 1].h);
      gl.uniform1f(u('uK'), 0.9 * strength);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    // the chain sums sum(k^i) copies of the bright pass; normalise to the 6-level look so more
    // (retina) or fewer (low quality) levels widen/narrow the halo without changing its energy
    var k = 0.9 * strength, sumN = 0, sum6 = 0;
    for (i = 0; i < 6; i++) sum6 += Math.pow(k, i);
    for (i = 0; i < L.length; i++) sumN += Math.pow(k, i);
    this._bloomNorm = sum6 / Math.max(sumN, 1e-3);
  };

  GLWorld.prototype._composite = function (exposure) {
    var gl = this.gl, T = this.targets, p = this.progs.comp, u = p.u;
    this._target(null);
    this._bindFull(p);
    this._tex(0, T.scene.tex);
    this._tex(1, T.bloom.length ? T.bloom[0].tex : T.scene.tex);
    gl.uniform1i(u('tScene'), 0);
    gl.uniform1i(u('tBloom'), 1);
    var b0 = T.bloom[0] || T.scene;
    gl.uniform2f(u('uTexel'), 0.5 / b0.w, 0.5 / b0.h);
    gl.uniform1f(u('uBloom'), T.bloom.length ? 0.55 * (this._bloomNorm || 1) * (this._bloomGain || 1) : 0);
    gl.uniform1f(u('uExposure'), exposure);
    gl.uniform1f(u('uInvScale'), 1 / this.sceneScale);
    gl.uniform1f(u('uTime'), this.t);
    gl.uniform1f(u('uFringe'), 0.006);
    gl.uniform1f(u('uVig'), 0.42);
    gl.uniform1f(u('uGrain'), 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this._tex(1, null);
    this._tex(0, null);
  };

  /** Release GL resources (optional; the page normally lives forever). */
  GLWorld.prototype.destroy = function () {
    var gl = this.gl;
    if (!gl) return;
    try {
      var ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) { /* ignore */ }
    this.ok = false;
  };

  CK.GLWorld = GLWorld;
  CK.GLWorld.THEMES = THEMES;
  CK.GLWorld.TITLE = TITLE;
})();
