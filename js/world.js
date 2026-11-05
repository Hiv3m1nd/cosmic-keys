/* Cosmic Keys — luminous 3D particle worlds that pulse with the music (one theme per level) */
(function () {
  'use strict';
  var CK = window.CK;
  var TAU = Math.PI * 2;

  /*
   * Each theme: background tones, fog colours, particle palette and a formation.
   * Palettes avoid the hand colours' exact hues so cards and shots stay readable.
   */
  var THEMES = [
    { name: 'Nebula Spiral', bg: ['#04061a', '#0b0a2c', '#170c3a'], fog: ['rgba(110,70,255,0.35)', 'rgba(40,170,255,0.18)'], pal: ['#9b8cff', '#5fd4ff', '#ffffff', '#c58bff'], form: 'galaxy' },
    { name: 'Aurora Curtains', bg: ['#020c14', '#06182a', '#0a1d33'], fog: ['rgba(40,255,190,0.22)', 'rgba(120,80,255,0.2)'], pal: ['#5dffb8', '#3fe0ff', '#b48cff', '#e9fff7'], form: 'aurora' },
    { name: 'Warp Tunnel', bg: ['#02040f', '#070d26', '#0b1235'], fog: ['rgba(60,120,255,0.3)', 'rgba(255,255,255,0.08)'], pal: ['#7fb4ff', '#ffffff', '#4f7dff', '#a9e2ff'], form: 'tunnel' },
    { name: 'Crystal Rain', bg: ['#0a0418', '#16082c', '#220b3a'], fog: ['rgba(255,90,200,0.22)', 'rgba(80,220,255,0.18)'], pal: ['#ff9be3', '#8ff0ff', '#ffffff', '#c7a6ff'], form: 'rain' },
    { name: 'Ocean of Light', bg: ['#010a14', '#04182b', '#052238'], fog: ['rgba(0,200,255,0.25)', 'rgba(0,255,200,0.12)'], pal: ['#3fd8ff', '#6effe0', '#ffffff', '#2a8dff'], form: 'ocean' },
    { name: 'Solar Wind', bg: ['#120503', '#250a07', '#2f0f10'], fog: ['rgba(255,140,40,0.3)', 'rgba(255,60,90,0.18)'], pal: ['#ffcf6a', '#ff8a3d', '#fff2c8', '#ff5a6e'], form: 'solar' },
    { name: 'Constellations', bg: ['#03030f', '#0a0a24', '#120f33'], fog: ['rgba(150,120,255,0.22)', 'rgba(255,255,255,0.06)'], pal: ['#ffffff', '#cfc4ff', '#8fb8ff', '#ffe9b0'], form: 'stars' },
    { name: 'Firefly Garden', bg: ['#030a06', '#08170e', '#0c1f16'], fog: ['rgba(160,255,90,0.18)', 'rgba(40,200,160,0.15)'], pal: ['#e8ff7a', '#9dff6a', '#fff6b8', '#5fffc0'], form: 'fireflies' },
    { name: 'Double Helix', bg: ['#0b0314', '#170529', '#200838'], fog: ['rgba(255,60,200,0.24)', 'rgba(60,200,255,0.2)'], pal: ['#ff6ad5', '#56e7ff', '#ffffff', '#b06bff'], form: 'helix' },
    { name: 'Cosmic Bloom', bg: ['#10040e', '#22081c', '#2c0d24'], fog: ['rgba(255,110,170,0.24)', 'rgba(255,200,90,0.16)'], pal: ['#ff8fc4', '#ffd36e', '#ffffff', '#ff6a8e'], form: 'bloom' },
    { name: 'Hyperspace', bg: ['#010208', '#05071a', '#090c26'], fog: ['rgba(120,170,255,0.2)', 'rgba(255,255,255,0.05)'], pal: ['#ffffff', '#9cc8ff', '#6f8dff', '#d9ecff'], form: 'hyper' },
    { name: 'Supernova', bg: ['#08030f', '#150722', '#1d0a2e'], fog: ['rgba(255,120,80,0.22)', 'rgba(120,90,255,0.22)'], pal: ['#ff7a59', '#ffd36e', '#7d8cff', '#ff5ad1', '#6effe0', '#ffffff'], form: 'nova' }
  ];
  var TITLE_THEME = { name: 'Title', bg: ['#04051a', '#0c0a2e', '#1a0d3c'], fog: ['rgba(130,80,255,0.32)', 'rgba(255,90,200,0.14)'], pal: ['#a996ff', '#ff8be0', '#ffffff', '#6fd8ff'], form: 'galaxy' };
  CK.THEMES = THEMES;

  var spriteCache = {};
  function glowSprite(color) {
    if (spriteCache[color]) return spriteCache[color];
    var c = CK.makeCanvas(64, 64), ctx = c.ctx;
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, color);
    g.addColorStop(0.35, hexA(color, 0.45));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    spriteCache[color] = c.canvas;
    return c.canvas;
  }
  CK.glowSprite = glowSprite;
  function hexA(hex, a) {
    var c = CK.hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  CK.hexA = hexA;

  function World() {
    this.N = 900;
    this.seed = [];
    this._initSeeds(1400);
    this.theme = TITLE_THEME;
    this.prevTheme = null;
    this.blend = 1;
    this.t = 0;
    this.waves = [];
    this.quality = 1;
    this._ft = [];
  }

  World.prototype._initSeeds = function (n) {
    this.a = new Float32Array(n); this.b = new Float32Array(n); this.c = new Float32Array(n); this.d = new Float32Array(n);
    for (var i = 0; i < n; i++) { this.a[i] = Math.random(); this.b[i] = Math.random(); this.c[i] = Math.random(); this.d[i] = Math.random(); }
    this.max = n;
  };

  World.prototype.setTheme = function (idx) {
    var th = idx == null ? TITLE_THEME : THEMES[idx % THEMES.length];
    if (th === this.theme) return;
    this.prevTheme = this.theme;
    this.theme = th;
    this.blend = 0;
    this._baseCache = null;
  };

  /** A ripple of light travelling out from a point (key presses, hits). */
  World.prototype.wave = function (x, y, color, strength) {
    this.waves.push({ x: x, y: y, t: 0, color: color || '#ffffff', s: strength || 1 });
    if (this.waves.length > 6) this.waves.shift();
  };

  World.prototype.resize = function (W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this._baseCache = null;
    this._prevBaseCache = null;
    // Particle budget scales with screen area.
    this.N = Math.round(CK.clamp(W * H / 900, 520, 1250));
  };

  World.prototype._buildBase = function (th) {
    var W = this.W, H = this.H, s = 0.5;
    var c = CK.makeCanvas(W * s, H * s), ctx = c.ctx;
    ctx.scale(s, s);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, th.bg[0]); g.addColorStop(0.55, th.bg[1]); g.addColorStop(1, th.bg[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft fog banks
    var blobs = [[0.25, 0.3, 0.6, th.fog[0]], [0.78, 0.22, 0.5, th.fog[1]], [0.55, 0.62, 0.7, th.fog[0]], [0.1, 0.75, 0.4, th.fog[1]]];
    blobs.forEach(function (b) {
      var gg = ctx.createRadialGradient(b[0] * W, b[1] * H, 0, b[0] * W, b[1] * H, b[2] * Math.max(W, H));
      gg.addColorStop(0, b[3]); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
    });
    // faint distant stars
    for (var i = 0; i < 260; i++) {
      var x = Math.random() * W, y = Math.random() * H, r = Math.random() * 0.9 + 0.2;
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.45 + 0.08).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    // vignette
    var vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,8,0.6)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    return c.canvas;
  };

  /** Draw the background + particle world. beat: { pulse 0..1, beat float } */
  World.prototype.draw = function (ctx, dt, beat, horizonY) {
    var W = this.W, H = this.H;
    this.t += dt;
    this.blend = Math.min(1, this.blend + dt / 1.6);
    if (!this._baseCache) this._baseCache = this._buildBase(this.theme);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (this.prevTheme && this.blend < 1) {
      if (!this._prevBaseCache) this._prevBaseCache = this._buildBase(this.prevTheme);
      ctx.drawImage(this._prevBaseCache, 0, 0, W, H);
      ctx.globalAlpha = CK.ease.inOutQuad(this.blend);
    }
    ctx.drawImage(this._baseCache, 0, 0, W, H);
    ctx.globalAlpha = 1;
    if (this.blend >= 1) { this._prevBaseCache = null; }

    // adaptive quality: watch frame time and trim particles if the device struggles
    this._ft.push(dt); if (this._ft.length > 60) this._ft.shift();
    if (this._ft.length === 60) {
      var avg = this._ft.reduce(function (a, b) { return a + b; }, 0) / 60;
      if (avg > 0.024 && this.quality > 0.4) this.quality -= 0.1;
      else if (avg < 0.0175 && this.quality < 1) this.quality += 0.02;
    }

    ctx.globalCompositeOperation = 'lighter';
    var horizon = horizonY || H * 0.62;
    if (this.prevTheme && this.blend < 1) {
      this._particles(ctx, this.prevTheme, beat, (1 - this.blend), horizon);
    }
    this._particles(ctx, this.theme, beat, this.prevTheme ? this.blend : 1, horizon);
    ctx.restore();

    // waves age
    for (var i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].t += dt;
      if (this.waves[i].t > 1.6) this.waves.splice(i, 1);
    }
  };

  World.prototype._particles = function (ctx, th, beat, alphaMul, horizon) {
    var W = this.W, H = this.H, t = this.t;
    var pulse = beat ? beat.pulse : 0;
    var n = Math.min(this.max, Math.round(this.N * this.quality));
    var cx = W / 2, cy = horizon * 0.5;
    var focal = Math.min(W, H) * 0.9;
    var camZ = 600;
    var sprites = th.pal.map(glowSprite);
    var base = Math.min(W, H) / 95;
    var waves = this.waves;
    var form = th.form;
    var a = this.a, b = this.b, c = this.c, d = this.d;
    var rot = t * 0.05;
    var cosR = Math.cos(rot), sinR = Math.sin(rot);
    var x, y, z, size, bright, col, sx, sy, scale, k, i;
    var lines = form === 'stars' ? [] : null;

    for (i = 0; i < n; i++) {
      size = 1; bright = 1; col = i % sprites.length;
      switch (form) {
        case 'galaxy': {
          var r = Math.pow(a[i], 1.25) * 900 + 90;
          var arm = Math.floor(b[i] * 3);
          var th0 = r * 0.0065 + arm * TAU / 3 + t * 0.06 + (c[i] - 0.5) * 0.9 * (1 - r / 1000);
          var gx = Math.cos(th0) * r, gz = Math.sin(th0) * r;
          var gy = (d[i] - 0.5) * 70 * (1 - r / 1000);
          // tilt the disc toward the viewer
          x = gx; y = gy * 0.4 + gz * 0.42; z = gz * 0.9 - gy * 0.4 + 200;
          y -= 60;
          size = 0.55 + (1 - r / 1000) * 0.8;
          bright = r < 260 ? 0.25 + r / 600 : 1;
          col = arm % 2 ? 1 : 0;
          if (i % 9 === 0) col = 3;
          if (i % 23 === 0) col = 2;
          break;
        }
        case 'aurora': {
          var kk = Math.floor(a[i] * 3), u = b[i];
          x = (u * 2 - 1) * 1500;
          var curtain = Math.sin(u * 7 + t * 0.5 + kk * 2) * 90 + Math.sin(u * 17 - t * 0.9) * 25;
          var drop = Math.pow(c[i], 1.6) * 360;
          y = -380 + kk * 70 + curtain + drop;
          z = 500 + kk * 260 + Math.sin(u * 3 + t * 0.25 + kk) * 180;
          size = 0.7 + (1 - c[i]) * 0.9;
          bright = 0.55 + (1 - c[i]) * 0.7;
          col = c[i] < 0.35 ? 0 : (c[i] < 0.7 ? 1 : 2);
          if (i % 13 === 0) col = 3;
          break;
        }
        case 'tunnel': {
          var ang = a[i] * TAU + t * 0.25;
          var rad = 320 + (c[i] - 0.5) * 120;
          z = ((b[i] * 2200 - t * 520) % 2200 + 2200) % 2200 - 500;
          x = Math.cos(ang) * rad; y = Math.sin(ang) * rad * 0.8 - 40;
          size = 0.6 + d[i] * 0.8;
          col = d[i] < 0.2 ? 1 : (i % 3);
          break;
        }
        case 'rain': {
          x = (a[i] * 2 - 1) * 1400;
          y = ((b[i] * 1400 + t * (90 + c[i] * 120)) % 1400) - 760;
          z = 50 + c[i] * 1300;
          size = 0.5 + d[i] * 0.9;
          bright = 0.6 + Math.sin(t * 3 + i) * 0.4;
          break;
        }
        case 'ocean': {
          var cols = 46, rows = Math.max(8, Math.floor(n / cols));
          var gxi = i % cols, gzi = Math.floor(i / cols);
          x = (gxi / (cols - 1) * 2 - 1) * 1700;
          z = 80 + gzi / rows * 1900;
          y = 150 + Math.sin(x * 0.004 + t * 1.2) * 34 + Math.cos(z * 0.0045 - t * 0.8) * 40 + Math.sin((x + z) * 0.002 + t * 0.6) * 26;
          y -= pulse * 22 * Math.cos(z * 0.003 - t * 4);
          size = 0.7;
          bright = 0.45 + (175 - y) / 120;
          col = bright > 1 ? 2 : (gzi % 2);
          break;
        }
        case 'solar': {
          var sa = a[i] * TAU, life = (b[i] + t * (0.05 + c[i] * 0.06)) % 1;
          var sr = 60 + life * 1300;
          x = Math.cos(sa) * sr; y = Math.sin(sa) * sr * 0.55 - 150; z = 900 - life * 600 + (d[i] - 0.5) * 200;
          size = 0.6 + (1 - life) * 1.4;
          bright = 1.2 - life;
          col = life < 0.25 ? 2 : (life < 0.6 ? 0 : (i % 2 ? 1 : 3));
          break;
        }
        case 'stars': {
          var phi = Math.acos(2 * a[i] - 1), lam = b[i] * TAU;
          var sr2 = 900 + c[i] * 300;
          var px = Math.sin(phi) * Math.cos(lam) * sr2, py = Math.cos(phi) * sr2 * 0.6, pz = Math.sin(phi) * Math.sin(lam) * sr2;
          x = px * cosR - pz * sinR; z = px * sinR + pz * cosR + 900; y = py - 150;
          size = 0.5 + Math.pow(d[i], 3) * 2.2;
          bright = 0.55 + 0.45 * Math.sin(t * (1 + d[i] * 3) + i);
          col = d[i] > 0.85 ? 3 : (i % 3);
          break;
        }
        case 'fireflies': {
          x = Math.sin(t * (0.15 + a[i] * 0.2) + a[i] * 40) * 1200;
          y = Math.sin(t * (0.12 + b[i] * 0.2) + b[i] * 40) * 420 - 80;
          z = 300 + (Math.sin(t * 0.1 + c[i] * 30) * 0.5 + 0.5) * 1200;
          size = 0.7 + d[i] * 1.1;
          bright = 0.3 + Math.max(0, Math.sin(t * (1.5 + d[i] * 2) + i * 1.7)) * 1.1;
          break;
        }
        case 'helix': {
          var strand = Math.floor(a[i] * 2), hu = b[i];
          var hang = hu * 7 * TAU * 0.5 + t * 0.9 + strand * Math.PI;
          var hx = Math.cos(hang) * 330, hz = Math.sin(hang) * 330;
          var hy = (hu * 2 - 1) * 900;
          // lay the helix on its side and spin it
          x = hy; y = hx * 0.55 - 120 + (c[i] - 0.5) * 40; z = hz + 900;
          size = 0.7 + d[i] * 0.8;
          col = strand ? 1 : 0;
          if (i % 11 === 0) col = 2;
          break;
        }
        case 'bloom': {
          var ba = a[i] * TAU, petals = 6;
          var br = (640 + 160 * Math.sin(t * 0.6)) * Math.abs(Math.cos(petals * ba / 2 + t * 0.15)) * (0.35 + 0.65 * Math.pow(b[i], 0.5));
          var bx = Math.cos(ba + t * 0.08) * br, by = Math.sin(ba + t * 0.08) * br;
          x = bx; y = by * 0.85 - 120; z = 800 + (c[i] - 0.5) * 260 - pulse * 60;
          size = 0.6 + d[i] * 1.1;
          col = b[i] > 0.8 ? 2 : (i % 2);
          if (i % 7 === 0) col = 3;
          break;
        }
        case 'hyper': {
          var ha = a[i] * TAU, hr = 140 + c[i] * 900;
          z = ((b[i] * 2600 - t * 1500) % 2600 + 2600) % 2600 - 300;
          x = Math.cos(ha) * hr; y = Math.sin(ha) * hr * 0.75 - 60;
          size = 0.5 + d[i] * 0.7;
          col = i % 4;
          break;
        }
        case 'nova': {
          var phi2 = Math.acos(2 * a[i] - 1), lam2 = b[i] * TAU + t * 0.12;
          var R = 520 + 110 * Math.sin(t * 0.7 + c[i] * 3) + pulse * 110 + c[i] * 110;
          x = Math.sin(phi2) * Math.cos(lam2) * R; y = Math.cos(phi2) * R * 0.8 - 110; z = Math.sin(phi2) * Math.sin(lam2) * R + 800;
          size = 0.6 + d[i] * 1.0;
          col = Math.floor(a[i] * sprites.length) % sprites.length;
          break;
        }
      }
      if (z <= -camZ + 40) continue;
      scale = focal / (z + camZ);
      sx = cx + x * scale; sy = cy + y * scale;
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > horizon + 30) continue;
      var depthFade = CK.clamp(1.4 - (z + camZ) / 2600, 0.15, 1);
      var s = size * base * scale * 3.1 * (1 + pulse * 0.45);
      var al = alphaMul * depthFade * CK.clamp(bright, 0, 1.4) * 0.68;
      // light ripples from notes and hits
      for (k = 0; k < waves.length; k++) {
        var wv = waves[k];
        var radius = wv.t * 900;
        var dd = Math.abs(Math.hypot(sx - wv.x, sy - wv.y) - radius);
        if (dd < 70) { var boost = (1 - dd / 70) * (1 - wv.t / 1.6) * wv.s; s *= 1 + boost * 0.7; al = Math.min(1.2, al + boost * 0.6); }
      }
      if (s < 0.6 || al < 0.02) continue;
      ctx.globalAlpha = Math.min(1, al);
      if (form === 'hyper' || form === 'tunnel') {
        // streaks
        var zb = z + (form === 'hyper' ? 160 : 70);
        var sc2 = focal / (zb + camZ);
        var ex = cx + x * sc2, ey = cy + y * sc2;
        ctx.strokeStyle = th.pal[col];
        ctx.lineWidth = Math.max(0.6, s * 0.18);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
      }
      ctx.drawImage(sprites[col], sx - s / 2, sy - s / 2, s, s);
      if (lines && i < 160) lines.push(sx, sy);
    }
    if (lines) {
      ctx.globalAlpha = 0.12 * alphaMul;
      ctx.strokeStyle = th.pal[1]; ctx.lineWidth = 1;
      ctx.beginPath();
      for (i = 0; i + 3 < lines.length; i += 2) {
        for (var j = i + 2; j < Math.min(lines.length, i + 14); j += 2) {
          var ddx = lines[i] - lines[j], ddy = lines[i + 1] - lines[j + 1];
          if (ddx * ddx + ddy * ddy < 140 * 140) { ctx.moveTo(lines[i], lines[i + 1]); ctx.lineTo(lines[j], lines[j + 1]); }
        }
      }
      ctx.stroke();
    }
    // sun core for the solar theme
    if (form === 'solar') {
      ctx.globalAlpha = alphaMul * (0.8 + pulse * 0.2);
      var sunS = Math.min(W, H) * (0.5 + pulse * 0.05);
      ctx.drawImage(glowSprite('#ffb347'), cx - sunS / 2, cy - 150 * focal / (900 + camZ) - sunS / 2, sunS, sunS);
    }
    ctx.globalAlpha = 1;
  };

  CK.World = World;
})();
