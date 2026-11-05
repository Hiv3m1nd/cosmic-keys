/* Cosmic Keys — shared helpers */
(function () {
  'use strict';
  var CK = (window.CK = window.CK || {});

  CK.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  CK.lerp = function (a, b, t) { return a + (b - a) * t; };
  CK.invLerp = function (a, b, v) { return b === a ? 0 : CK.clamp((v - a) / (b - a), 0, 1); };
  CK.rand = function (a, b) { return a + Math.random() * (b - a); };
  CK.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  CK.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  CK.chance = function (p) { return Math.random() < p; };
  CK.TAU = Math.PI * 2;

  CK.ease = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return 1 - (1 - t) * (1 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outBackSoft: function (t) { var c1 = 1.1, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: function (t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
  };

  /** Progress (0..1) of `t` inside the window [a, b]. */
  CK.seg = function (t, a, b) { return CK.clamp((t - a) / (b - a), 0, 1); };

  /* localStorage can throw inside sandboxed iframes / private mode. */
  CK.storage = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  CK.query = (function () {
    var out = {};
    try {
      var s = window.location.search.replace(/^\?/, '');
      s.split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        out[decodeURIComponent(p[0])] = p.length > 1 ? decodeURIComponent(p[1]) : '1';
      });
    } catch (e) { /* ignore */ }
    return out;
  })();

  CK.prefersReducedMotion = (function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  })();

  /** Rounded rectangle path helper. */
  CK.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  /** Capsule (thick line with round ends) path between two points. */
  CK.capsule = function (ctx, x1, y1, x2, y2, r1, r2) {
    if (r2 == null) r2 = r1;
    var dx = x2 - x1, dy = y2 - y1;
    var a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2, false);
    ctx.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2, false);
    ctx.closePath();
  };

  /** Create an offscreen canvas. */
  CK.makeCanvas = function (w, h, readable) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    var ctx = c.getContext('2d', readable ? { willReadFrequently: true } : undefined);
    return { canvas: c, ctx: ctx };
  };

  /** Colour helpers. */
  CK.hexToRgb = function (h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  /** Lighten (k > 0) or darken (k < 0) a hex colour. */
  CK.shade = function (hex, k) {
    var c = CK.hexToRgb(hex);
    var f = function (v) { return Math.round(CK.clamp(k >= 0 ? v + (255 - v) * k : v * (1 + k), 0, 255)); };
    return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')';
  };

  /** Simple pub/sub. */
  CK.Emitter = function () { this._h = {}; };
  CK.Emitter.prototype.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; };
  CK.Emitter.prototype.emit = function (ev, a, b) {
    var hs = this._h[ev]; if (!hs) return;
    for (var i = 0; i < hs.length; i++) hs[i](a, b);
  };
})();
