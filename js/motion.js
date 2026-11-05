/* Cosmic Keys — motion system (see docs/STYLE_GUIDE.md).
 * Every animated value is a pure function of time since its event:
 * closed-form damped springs, spring stacks for retargeting, seeded noise.
 */
(function () {
  'use strict';
  var CK = window.CK;

  // Spring classes: damping ratio z, natural frequency f (Hz).
  var SPRINGS = {
    SNAP: { z: 0.82, f: 3.2 },    // chips, labels, badges (~1% overshoot, fast)
    SETTLE: { z: 0.68, f: 2.2 },  // panels, cards, menus (~5% overshoot)
    LAND: { z: 0.55, f: 2.8 },    // big moments: titles, stamps, medals (~12% overshoot)
    GLIDE: { z: 1.0, f: 0.55 },   // camera
    DRIFT: { z: 1.0, f: 0.32 }    // slow travel / idle
  };

  /** Unit step response of a damped spring: 0 before t=0, tends to 1. */
  function spring(t, cls) {
    if (t <= 0) return 0;
    var s = typeof cls === 'string' ? SPRINGS[cls] : cls;
    var w = 2 * Math.PI * s.f, z = s.z;
    if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
    var wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z / Math.sqrt(1 - z * z) * Math.sin(wd * t));
  }

  /** Value moving from a to b, starting at t=0 on the given spring. */
  function tween(t, a, b, cls) { return a + (b - a) * spring(t, cls); }

  /**
   * A value whose target changes over time = a stack of springs (no snapping).
   * keys: [{t: start time, v: target}] sorted by t; first key is the initial value.
   */
  function stack(t, keys, cls) {
    if (!keys.length) return 0;
    var v = keys[0].v;
    for (var i = 1; i < keys.length; i++) v += (keys[i].v - keys[i - 1].v) * spring(t - keys[i].t, keys[i].cls || cls);
    return v;
  }

  /** Entrance: materialise in ~0.12 s while rising ~36 px into place, scale 0.96→1. */
  function enter(t, cls, rise) {
    var s = spring(t, cls || 'SETTLE');
    return { alpha: CK.clamp(t / 0.12, 0, 1), y: (1 - s) * (rise == null ? 36 : rise), scale: 0.96 + 0.04 * s, s: s };
  }
  /** Exit: quick (~0.18 s), slightly upward. */
  function exit(t) {
    var k = CK.clamp(t / 0.18, 0, 1);
    return { alpha: 1 - k, y: -k * 14, scale: 1 - k * 0.03, k: k };
  }

  /** Seeded PRNG (mulberry32). */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Smooth 1D value noise in [-1, 1], deterministic for (x, seed). */
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    var a = hash(i + (seed || 0) * 57.0), b = hash(i + 1 + (seed || 0) * 57.0);
    return (a + (b - a) * u) * 2 - 1;
  }

  /**
   * Camera: zoom + centre as spring stacks, plus seeded shake impulses and a slow drift.
   * Pure function of time: state(t) depends only on the keys/impulses recorded so far.
   */
  function Camera() { this.reset(0); }
  Camera.prototype.reset = function (t) {
    this.zoomKeys = [{ t: t, v: 1 }];
    this.xKeys = [{ t: t, v: 0 }];
    this.yKeys = [{ t: t, v: 0 }];
    this.shakes = [];
  };
  /** Move to zoom z centred on screen point (fx, fy) over the given spring. */
  Camera.prototype.to = function (t, z, fx, fy, W, H, cls) {
    // offset so the focus point moves toward the centre as the zoom grows
    var ox = (W / 2 - fx) * (1 - 1 / z), oy = (H / 2 - fy) * (1 - 1 / z);
    this.zoomKeys.push({ t: t, v: z, cls: cls || 'GLIDE' });
    this.xKeys.push({ t: t, v: ox, cls: cls || 'GLIDE' });
    this.yKeys.push({ t: t, v: oy, cls: cls || 'GLIDE' });
    if (this.zoomKeys.length > 24) { this._compact(t); }
  };
  Camera.prototype.home = function (t, cls) { this.to(t, 1, 0, 0, 0, 0, cls); this.xKeys[this.xKeys.length - 1].v = 0; this.yKeys[this.yKeys.length - 1].v = 0; };
  Camera.prototype._compact = function (t) {
    // fold old keys into a single start value (they have long settled)
    var z = this.state(t);
    this.zoomKeys = [{ t: t, v: z.zoom }]; this.xKeys = [{ t: t, v: z.x }]; this.yKeys = [{ t: t, v: z.y }];
  };
  /** Short decaying shake (amplitude px, seeded). */
  Camera.prototype.shake = function (t, amp, seed) {
    this.shakes.push({ t: t, amp: amp, seed: seed || this.shakes.length + 1 });
    if (this.shakes.length > 12) this.shakes.shift();
  };
  Camera.prototype.state = function (t) {
    var sx = 0, sy = 0;
    for (var i = 0; i < this.shakes.length; i++) {
      var s = this.shakes[i], dt = t - s.t;
      if (dt < 0 || dt > 0.6) continue;
      var a = s.amp * Math.exp(-dt * 9);
      sx += noise1(dt * 32, s.seed) * a; sy += noise1(dt * 32, s.seed + 7) * a;
    }
    // slow drift so the frame never stops dead (a few px)
    var drift = 2.2;
    sx += noise1(t * 0.18, 3) * drift; sy += noise1(t * 0.15, 9) * drift * 0.7;
    return {
      zoom: stack(t, this.zoomKeys, 'GLIDE'),
      x: stack(t, this.xKeys, 'GLIDE') + sx,
      y: stack(t, this.yKeys, 'GLIDE') + sy
    };
  };

  /** Reading time for text (style guide): 1.2 s + 1 s per 3 words. */
  function readTime(text) { var words = String(text).trim().split(/\s+/).length; return 1.2 + words / 3; }

  CK.Motion = { SPRINGS: SPRINGS, spring: spring, tween: tween, stack: stack, enter: enter, exit: exit, rng: rng, noise1: noise1, Camera: Camera, readTime: readTime };
})();
