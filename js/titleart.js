/* Cosmic Keys — title screen art: an Earth-like planet, drifting asteroids, a grand
 * piano standing on an asteroid, and glowing music-staff ribbons with notes riding
 * them. Heavy pieces (planet, asteroids, piano) are pre-rendered once per resize.
 * Also draws the gold treble clef and swoosh behind the "Cosmic Keys" logo.
 */
(function () {
  'use strict';
  var CK = window.CK;
  var TAU = Math.PI * 2;

  /* ---- small deterministic 3D value noise ---- */
  function hash3(x, y, z) {
    var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function noise3(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    var a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
    var e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
    var k0 = a + (b - a) * ux, k1 = c + (d - c) * ux, k2 = e + (f - e) * ux, k3 = g + (h - g) * ux;
    var l0 = k0 + (k1 - k0) * uy, l1 = k2 + (k3 - k2) * uy;
    return l0 + (l1 - l0) * uz;
  }
  function fbm(x, y, z, oct) {
    var s = 0, a = 0.5, f = 1;
    for (var i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
  }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

  /* ---- planet ---- */
  function renderPlanet(size) {
    var c = CK.makeCanvas(size, size), ctx = c.ctx;
    var img = ctx.createImageData(size, size), d = img.data;
    var R = size / 2 - 1, L = [-0.35, -0.75, -0.5];
    var ll = Math.hypot(L[0], L[1], L[2]); L = [L[0] / ll, L[1] / ll, L[2] / ll];
    for (var py = 0; py < size; py++) {
      for (var px = 0; px < size; px++) {
        var x = (px + 0.5 - size / 2) / R, y = (py + 0.5 - size / 2) / R, r2 = x * x + y * y;
        var i = (py * size + px) * 4;
        if (r2 > 1) { d[i + 3] = 0; continue; }
        var z = Math.sqrt(1 - r2);
        // tilt the globe a little and look at it from slightly above
        var nx = x, ny = y * 0.94 + z * 0.34, nz = -y * 0.34 + z * 0.94;
        var lat = ny;
        var h = fbm(nx * 1.9 + 3.1, ny * 1.9 + 1.7, nz * 1.9 + 5.3, 5);
        var cl = fbm(nx * 3.2 + 9.0, ny * 5.0 + 2.0, nz * 3.2 - 4.0, 4);
        var land = smooth(0.5, 0.53, h);
        // ocean: deep navy to teal shallows
        var shallow = smooth(0.4, 0.5, h);
        var cr = mix(8, 22, shallow), cg = mix(42, 120, shallow), cb = mix(110, 170, shallow);
        // land: greens to tan at height
        var hh = smooth(0.53, 0.72, h);
        var lr = mix(52, 150, hh), lg = mix(120, 128, hh), lb = mix(62, 78, hh);
        cr = mix(cr, lr, land); cg = mix(cg, lg, land); cb = mix(cb, lb, land);
        // ice caps
        var ice = smooth(0.72, 0.86, Math.abs(lat) + (h - 0.5) * 0.3);
        cr = mix(cr, 235, ice); cg = mix(cg, 245, ice); cb = mix(cb, 252, ice);
        // clouds
        var cloud = smooth(0.52, 0.68, cl) * 0.85;
        cr = mix(cr, 245, cloud); cg = mix(cg, 248, cloud); cb = mix(cb, 255, cloud);
        // light: day side, soft terminator, faint night glow, ocean glint
        var ndl = x * L[0] + y * L[1] + z * L[2];
        var day = smooth(-0.15, 0.35, ndl);
        var lit = 0.07 + 0.93 * day * (0.55 + 0.45 * Math.max(0, ndl));
        var hx = L[0], hy = L[1], hz = L[2] + 1, hl = Math.hypot(hx, hy, hz);
        var spec = Math.pow(Math.max(0, (x * hx + y * hy + z * hz) / hl), 60) * (1 - land) * (1 - cloud) * 0.9;
        var rim = Math.pow(1 - z, 3) * 0.6;
        // city lights on the night side
        var city = smooth(0.6, 0.7, noise3(nx * 34 + 1.3, ny * 34 - 2.1, nz * 34 + 0.7)) * land * (1 - ice) * (1 - cloud) * (1 - smooth(-0.25, 0.1, ndl));
        cr += city * 255; cg += city * 190; cb += city * 90;
        d[i] = Math.min(255, cr * lit + spec * 255 + rim * 60 * day);
        d[i + 1] = Math.min(255, cg * lit + spec * 240 + rim * 150 * day);
        d[i + 2] = Math.min(255, cb * lit + spec * 220 + rim * 255 * day + 14 * (1 - day));
        d[i + 3] = 255 * Math.min(1, (1 - Math.sqrt(r2)) * R * 0.8);
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.canvas;
  }

  /* ---- asteroids ---- */
  function renderAsteroid(size, seed) {
    var c = CK.makeCanvas(size, size), ctx = c.ctx, rnd = CK.Motion.rng(seed);
    var n = 16, pts = [], R = size * 0.42;
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU, r = R * (0.78 + rnd() * 0.24);
      pts.push([size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r * 0.86]);
    }
    ctx.beginPath();
    pts.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
    var g = ctx.createRadialGradient(size * 0.62, size * 0.36, size * 0.04, size * 0.5, size * 0.52, R * 1.15);
    g.addColorStop(0, '#b9b2a8'); g.addColorStop(0.35, '#7d756d'); g.addColorStop(0.75, '#3c3a44'); g.addColorStop(1, '#1a1a26');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    for (var k = 0; k < 7; k++) {
      var cx = size * (0.25 + rnd() * 0.5), cy = size * (0.25 + rnd() * 0.5), cr = size * (0.03 + rnd() * 0.07);
      ctx.fillStyle = 'rgba(20,18,28,0.45)';
      ctx.beginPath(); ctx.ellipse(cx, cy, cr, cr * 0.8, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(230,220,200,0.25)'; ctx.lineWidth = Math.max(1, cr * 0.18);
      ctx.beginPath(); ctx.ellipse(cx + cr * 0.12, cy + cr * 0.12, cr, cr * 0.8, 0, -2.2, 0.4); ctx.stroke();
    }
    // cool rim light from the galaxy behind
    ctx.globalCompositeOperation = 'source-atop';
    var rg = ctx.createLinearGradient(0, size, size * 0.4, size * 0.4);
    rg.addColorStop(0, 'rgba(80,200,255,0.35)'); rg.addColorStop(0.4, 'rgba(80,200,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, size, size);
    ctx.restore();
    return c.canvas;
  }

  /* ---- a rocky cliff for the piano to stand on ---- */
  function renderCliff(w, h, seed) {
    var c = CK.makeCanvas(w, h), ctx = c.ctx, rnd = CK.Motion.rng(seed);
    var ridge = [], n = 26;
    for (var i = 0; i <= n; i++) {
      var u = i / n, base;
      if (u < 0.12) base = 0.42 - u * 1.4;            // rising from the left edge
      else if (u < 0.62) base = 0.2 + Math.abs(u - 0.38) * 0.12;   // the plateau
      else base = 0.26 + (u - 0.62) * 1.5;             // falling away to the right
      ridge.push([u * w, (base + (rnd() - 0.5) * 0.05) * h]);
    }
    ridge[0][1] = h * 0.4;
    var path = function () {
      ctx.beginPath(); ctx.moveTo(0, h);
      ridge.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(w, h); ctx.closePath();
    };
    path();
    var g = ctx.createLinearGradient(0, h * 0.15, 0, h);
    g.addColorStop(0, '#1d2133'); g.addColorStop(0.3, '#0e101b'); g.addColorStop(1, '#030409');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    // craggy facets
    for (var k = 0; k < 60; k++) {
      var x = rnd() * w, y = h * (0.2 + rnd() * 0.8), r = w * (0.02 + rnd() * 0.06);
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,130,170,' + (0.02 + rnd() * 0.04).toFixed(3) + ')' : 'rgba(0,0,0,' + (0.12 + rnd() * 0.16).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r, y + r * (0.3 + rnd())); ctx.lineTo(x - r * rnd(), y + r * (0.8 + rnd())); ctx.closePath(); ctx.fill();
    }
    // warm light from the galaxy on the upper left, cool fill from the planet on the right
    var wl = ctx.createLinearGradient(0, 0, w * 0.6, h * 0.6);
    wl.addColorStop(0, 'rgba(255,200,120,0.28)'); wl.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = wl; ctx.fillRect(0, 0, w, h);
    var cl = ctx.createLinearGradient(w, h * 0.5, w * 0.5, h * 0.5);
    cl.addColorStop(0, 'rgba(90,170,255,0.22)'); cl.addColorStop(1, 'rgba(90,170,255,0)');
    ctx.fillStyle = cl; ctx.fillRect(0, 0, w, h);
    ctx.restore();
    // lit ridge line
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,214,150,0.55)'; ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath(); ridge.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    return { canvas: c.canvas, plateau: [w * 0.38, h * 0.2 + Math.abs(0.38 - 0.38) * 0.12 * h] };
  }

  /**
   * A "digital ribbon": a band of glowing bars that swells with the music, swept along
   * a curve through space (teal to gold), sometimes carrying notes. Points are in px.
   */
  CK.drawDigitalRibbon = function (ctx, P0, P1, P2, P3, width, t, pulse, opt) {
    opt = opt || {};
    var N = opt.n || 90, ca = opt.a || '#3ce6d6', cb = opt.b || '#ffc24a', alpha = opt.alpha == null ? 1 : opt.alpha;
    var bez = function (u) {
      var v = 1 - u;
      return [v * v * v * P0[0] + 3 * v * v * u * P1[0] + 3 * v * u * u * P2[0] + u * u * u * P3[0],
              v * v * v * P0[1] + 3 * v * v * u * P1[1] + 3 * v * u * u * P2[1] + u * u * u * P3[1]];
    };
    var pts = [];
    for (var i = 0; i <= N; i++) pts.push(bez(i / N));
    var ra = CK.hexToRgb(ca), rb = CK.hexToRgb(cb);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    var step = 0;
    for (i = 0; i < N; i++) {
      var p = pts[i], q = pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      var nx = -dy / l, ny = dx / l, u = i / N;
      var fade = Math.min(1, u * 5, (1 - u) * 5) * alpha;
      if (fade <= 0) continue;
      var e = 0.5 + 0.5 * Math.sin(i * 0.9 + t * 3.1) * Math.sin(i * 0.37 - t * 1.7);
      var hgt = width * (0.28 + 0.62 * e) * (1 + pulse * 0.25);
      var r = Math.round(ra[0] + (rb[0] - ra[0]) * u), g = Math.round(ra[1] + (rb[1] - ra[1]) * u), b = Math.round(ra[2] + (rb[2] - ra[2]) * u);
      var col = 'rgba(' + r + ',' + g + ',' + b + ',';
      step = l;
      ctx.strokeStyle = col + (0.22 * fade).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, step * 0.95);
      ctx.beginPath(); ctx.moveTo(p[0] - nx * width / 2, p[1] - ny * width / 2); ctx.lineTo(p[0] + nx * width / 2, p[1] + ny * width / 2); ctx.stroke();
      ctx.strokeStyle = col + (0.85 * fade).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, step * 0.42);
      ctx.beginPath(); ctx.moveTo(p[0] - nx * hgt / 2, p[1] - ny * hgt / 2); ctx.lineTo(p[0] + nx * hgt / 2, p[1] + ny * hgt / 2); ctx.stroke();
    }
    // bright edges
    for (var side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        var a = pts[i], bpt = pts[i + 1], ddx = bpt[0] - a[0], ddy = bpt[1] - a[1], ll = Math.hypot(ddx, ddy) || 1;
        var ex = a[0] - ddy / ll * side * width * 0.56, ey = a[1] + ddx / ll * side * width * 0.56;
        if (i) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey);
      }
      ctx.strokeStyle = 'rgba(200,245,255,' + (0.35 * alpha).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
    }
    // notes riding the ribbon
    if (opt.notes) {
      for (var k = 0; k < opt.notes; k++) {
        var un = ((k / opt.notes + t * 0.03) % 1 + 1) % 1, f2 = Math.min(1, un * 6, (1 - un) * 6) * alpha;
        if (f2 <= 0) continue;
        var np = bez(un), s2 = width * 0.32;
        ctx.globalAlpha = f2;
        ctx.drawImage(CK.glowSprite('#ffd98a'), np[0] - s2 * 2, np[1] - s2 * 2, s2 * 4, s2 * 4);
        ctx.fillStyle = '#fff1c4'; ctx.strokeStyle = '#fff1c4'; ctx.lineWidth = Math.max(1, s2 * 0.2);
        ctx.save(); ctx.translate(np[0], np[1]); ctx.rotate(-0.35);
        ctx.beginPath(); ctx.ellipse(0, 0, s2 * 0.62, s2 * 0.44, 0, 0, TAU); ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.moveTo(np[0] + s2 * 0.55, np[1]); ctx.lineTo(np[0] + s2 * 0.55, np[1] - s2 * 2.6); ctx.lineTo(np[0] + s2 * 1.4, np[1] - s2 * 1.9); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  /* ---- grand piano, side view, standing on its legs (unit = case length) ---- */
  function pianoPath(ctx, L) {
    ctx.save();
    ctx.scale(L, L);
    var fill = ctx.createLinearGradient(0, 0, 0, 0.75);
    fill.addColorStop(0, '#20263f'); fill.addColorStop(0.45, '#070912'); fill.addColorStop(1, '#03040a');
    ctx.fillStyle = fill;
    // legs and pedal lyre (behind the case)
    [[0.15, 0], [0.86, 0], [0.55, -0.02]].forEach(function (lg) {
      ctx.beginPath();
      ctx.moveTo(lg[0] - 0.024, 0.42); ctx.lineTo(lg[0] + 0.024, 0.42); ctx.lineTo(lg[0] + 0.014, 0.69); ctx.lineTo(lg[0] - 0.014, 0.69); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(lg[0], 0.705, 0.022, 0.012, 0, 0, TAU); ctx.fill();
    });
    ctx.fillRect(0.205, 0.42, 0.012, 0.21); ctx.fillRect(0.235, 0.42, 0.012, 0.21);
    ctx.fillRect(0.19, 0.62, 0.07, 0.022);
    // case with rounded tail
    ctx.beginPath();
    ctx.moveTo(0.08, 0.3); ctx.lineTo(0.94, 0.3);
    ctx.quadraticCurveTo(1.0, 0.3, 1.0, 0.36); ctx.quadraticCurveTo(1.0, 0.42, 0.94, 0.42);
    ctx.lineTo(0.08, 0.42); ctx.closePath(); ctx.fill();
    // keyboard shelf and keys
    ctx.fillRect(0.0, 0.335, 0.1, 0.05);
    ctx.fillStyle = '#e9ecf5'; ctx.fillRect(0.004, 0.338, 0.07, 0.014);
    // music stand
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(0.11, 0.3); ctx.lineTo(0.15, 0.3); ctx.lineTo(0.2, 0.19); ctx.lineTo(0.17, 0.18); ctx.closePath(); ctx.fill();
    // open lid and prop stick
    ctx.beginPath(); ctx.moveTo(0.22, 0.3); ctx.lineTo(0.985, 0.3); ctx.lineTo(0.92, 0.035); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#0a0c16'; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.moveTo(0.74, 0.3); ctx.lineTo(0.79, 0.12); ctx.stroke();
    // gold soundboard glimpse under the lid
    var sb = ctx.createLinearGradient(0.3, 0.3, 0.95, 0.1);
    sb.addColorStop(0, 'rgba(255,196,90,0.0)'); sb.addColorStop(1, 'rgba(255,196,90,0.55)');
    ctx.fillStyle = sb;
    ctx.beginPath(); ctx.moveTo(0.3, 0.297); ctx.lineTo(0.96, 0.297); ctx.lineTo(0.92, 0.08); ctx.closePath(); ctx.fill();
    // rim lights
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,214,130,0.95)'; ctx.lineWidth = 0.006;
    ctx.beginPath(); ctx.moveTo(0.22, 0.3); ctx.lineTo(0.92, 0.035); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,230,255,0.8)'; ctx.lineWidth = 0.005;
    ctx.beginPath(); ctx.moveTo(0.08, 0.302); ctx.lineTo(0.94, 0.302); ctx.quadraticCurveTo(0.998, 0.302, 0.998, 0.36); ctx.stroke();
    ctx.restore();
  }

  function TitleArt() { this.W = 0; this.H = 0; this.rocks = []; }

  TitleArt.prototype.resize = function (W, H, dpr) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    var portrait = H > W * 1.1;
    var M = Math.max(W, H);
    this.planetR = portrait ? W * 0.7 : W * 0.34;
    this.planetX = portrait ? W * 0.95 : W * 0.86;
    this.planetY = portrait ? H * 1.06 : H * 1.13;
    var ps = Math.min(480, Math.round(this.planetR * 2 * Math.min(dpr || 1, 1.5)));
    this.planet = renderPlanet(ps);
    this.cliffW = portrait ? W * 0.82 : W * 0.44;
    this.cliffH = portrait ? H * 0.2 : H * 0.34;
    var cs = Math.min(1, 700 / this.cliffW);
    this.cliff = renderCliff(Math.round(this.cliffW * cs), Math.round(this.cliffH * cs), 11);
    var rnd = CK.Motion.rng(42);
    this.rocks = [];
    var spots = portrait ? [[0.12, 0.34, 0.035], [0.9, 0.42, 0.03], [0.55, 0.62, 0.022], [0.78, 0.18, 0.028]]
      : [[0.07, 0.42, 0.03], [0.3, 0.6, 0.022], [0.7, 0.62, 0.026], [0.93, 0.36, 0.03], [0.6, 0.15, 0.018]];
    for (var i = 0; i < spots.length; i++) {
      this.rocks.push({ x: spots[i][0], y: spots[i][1], r: spots[i][2] * M, img: renderAsteroid(96, 100 + i), spin: (rnd() - 0.5) * 0.3, ph: rnd() * TAU });
    }
  };

  TitleArt.prototype.draw = function (ctx, t, beat) {
    var W = this.W, H = this.H, pulse = (beat && beat.pulse) || 0, portrait = H > W * 1.1;
    if (!this.planet) return;
    // digital music ribbons sweeping through the sky
    var bw = Math.max(16, Math.min(W, H) * 0.06);
    if (portrait) {
      CK.drawDigitalRibbon(ctx, [-0.05 * W, 0.02 * H], [0.25 * W, 0.2 * H], [-0.1 * W, 0.42 * H], [0.18 * W, 0.56 * H], bw, t, pulse, { a: '#3ce6d6', b: '#7fb4ff' });
      CK.drawDigitalRibbon(ctx, [1.05 * W, 0.62 * H], [0.75 * W, 0.5 * H], [1.1 * W, 0.3 * H], [0.82 * W, 0.12 * H], bw, t + 3, pulse, { a: '#ffc24a', b: '#3ce6d6', notes: 3 });
    } else {
      CK.drawDigitalRibbon(ctx, [0.02 * W, -0.04 * H], [0.22 * W, 0.26 * H], [0.02 * W, 0.46 * H], [0.22 * W, 0.66 * H], bw, t, pulse, { a: '#7fb4ff', b: '#3ce6d6' });
      CK.drawDigitalRibbon(ctx, [1.0 * W, 0.62 * H], [0.74 * W, 0.52 * H], [0.98 * W, 0.22 * H], [0.76 * W, -0.04 * H], bw, t + 3, pulse, { a: '#3ce6d6', b: '#ffc24a', notes: 4 });
    }
    // small asteroids drifting and tumbling
    for (var i = 0; i < this.rocks.length; i++) {
      var r = this.rocks[i];
      var x = r.x * W + Math.sin(t * 0.13 + r.ph) * 10, y = r.y * H + Math.cos(t * 0.11 + r.ph) * 8;
      ctx.save(); ctx.translate(x, y); ctx.rotate(r.ph + t * r.spin);
      ctx.drawImage(r.img, -r.r, -r.r, r.r * 2, r.r * 2);
      ctx.restore();
    }
    // planet with an atmosphere halo
    var R = this.planetR, px = this.planetX, py = this.planetY;
    var halo = ctx.createRadialGradient(px, py, R * 0.97, px, py, R * 1.16);
    halo.addColorStop(0, 'rgba(120,215,255,0.6)'); halo.addColorStop(0.35, 'rgba(70,160,255,0.2)'); halo.addColorStop(1, 'rgba(60,140,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(px, py, R * 1.16, 0, TAU); ctx.fill();
    ctx.drawImage(this.planet, px - R, py - R, R * 2, R * 2);
    // rocky cliff with the grand piano standing on its plateau
    var cw = this.cliffW, ch = this.cliffH, cx0 = 0, cy0 = H - ch;
    var glow = ctx.createRadialGradient(cw * 0.38, cy0 + ch * 0.1, 4, cw * 0.38, cy0 + ch * 0.1, cw * 0.55);
    glow.addColorStop(0, 'rgba(255,200,120,' + (0.22 + pulse * 0.1).toFixed(3) + ')'); glow.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, cy0 - ch * 0.8, cw * 1.1, ch * 1.6);
    var L = portrait ? W * 0.4 : Math.min(W * 0.21, H * 0.38);
    ctx.save();
    ctx.translate(cx0 + cw * 0.38 - L * 0.52, cy0 + ch * 0.215 - L * 0.705);
    pianoPath(ctx, L);
    ctx.restore();
    ctx.drawImage(this.cliff.canvas, cx0, cy0, cw, ch);
    // twinkles around the piano
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 6; k++) {
      var a = k * 1.7 + t * 0.4, tw = 0.5 + 0.5 * Math.sin(t * 2.3 + k * 2.1);
      var sx = cw * 0.38 + Math.cos(a) * L * 0.7, sy = cy0 - L * 0.25 + Math.sin(a * 1.3) * L * 0.3;
      var sz = 6 + tw * 10;
      ctx.globalAlpha = tw * 0.9;
      ctx.drawImage(CK.glowSprite('#ffd98a'), sx - sz / 2, sy - sz / 2, sz, sz);
    }
    ctx.restore();
  };

  /** Two glowing five-line staves sweeping across space, with notes riding along. */
  TitleArt.prototype._ribbons = function (ctx, t, pulse) {
    var W = this.W, H = this.H, portrait = H > W * 1.1;
    var sp = Math.max(4, Math.min(W, H) * 0.012);
    var defs = portrait
      ? [{ y0: 0.6, y1: 0.5, amp: 0.05, f: 0.9, ph: 0, a: '#3ce6d6', b: '#ffc24a', speed: 0.22 }]
      : [{ y0: 0.66, y1: 0.5, amp: 0.06, f: 0.75, ph: 0, a: '#3ce6d6', b: '#ffc24a', speed: 0.2 },
         { y0: 0.78, y1: 0.68, amp: 0.045, f: 1.1, ph: 2.1, a: '#ffc24a', b: '#3ce6d6', speed: -0.16 }];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var d = 0; d < defs.length; d++) {
      var r = defs[d], N = 48;
      var yAt = function (u, line) {
        return H * (r.y0 + (r.y1 - r.y0) * u + r.amp * Math.sin(u * TAU * r.f + t * r.speed + r.ph)) + (line - 2) * sp;
      };
      var grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, CK.hexA(r.a, 0)); grad.addColorStop(0.15, CK.hexA(r.a, 0.9)); grad.addColorStop(0.6, CK.hexA(r.b, 0.9)); grad.addColorStop(1, CK.hexA(r.b, 0));
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = grad;
        ctx.globalAlpha = pass === 0 ? 0.16 + pulse * 0.08 : 0.75;
        ctx.lineWidth = pass === 0 ? sp * 0.9 : Math.max(1, sp * 0.13);
        for (var line = 0; line < 5; line++) {
          ctx.beginPath();
          for (var i = 0; i <= N; i++) {
            var u = i / N, x = -W * 0.05 + u * W * 1.1, y = yAt(u, line);
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
      }
      // notes riding the staff
      ctx.globalAlpha = 1;
      for (var n = 0; n < 7; n++) {
        var un = ((n / 7 + t * 0.018 * (d ? -1 : 1)) % 1 + 1) % 1;
        var fade = Math.sin(un * Math.PI);
        if (fade < 0.05) continue;
        var step = [1, 3, 2, 4, 0, 3, 5][n];
        var nx = -W * 0.05 + un * W * 1.1, ny = yAt(un, 0) + (4 - step) * sp * 0.5 - sp * 2;
        var up = ny > yAt(un, 2);
        var col = n % 3 === 0 ? '#ffffff' : (n % 2 ? '#ffd27a' : '#8ff4ff');
        ctx.globalAlpha = fade;
        var gs = sp * 5;
        ctx.drawImage(CK.glowSprite(col), nx - gs / 2, ny - gs / 2, gs, gs);
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, sp * 0.16);
        ctx.save(); ctx.translate(nx, ny); ctx.rotate(-0.35);
        ctx.beginPath(); ctx.ellipse(0, 0, sp * 0.66, sp * 0.46, 0, 0, TAU); ctx.fill();
        ctx.restore();
        ctx.beginPath();
        if (up) { ctx.moveTo(nx + sp * 0.6, ny); ctx.lineTo(nx + sp * 0.6, ny - sp * 3.3); }
        else { ctx.moveTo(nx - sp * 0.6, ny); ctx.lineTo(nx - sp * 0.6, ny + sp * 3.3); }
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /** Gold treble clef between "Cosmic" and "Keys", with an orbiting swoosh (drawn into the logo's own canvas). */
  CK.drawLogoArt = function (canvas, textEl) {
    if (!canvas || !textEl || !CK.drawTreble) return;
    var gap = textEl.querySelector('.gap');
    var box = canvas.getBoundingClientRect(), tb = textEl.getBoundingClientRect();
    if (box.width < 4) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(10, Math.round(box.width * dpr)); canvas.height = Math.max(10, Math.round(box.height * dpr));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    var x0 = tb.left - box.left, x1 = tb.right - box.left, yT = tb.top - box.top, yB = tb.bottom - box.top, th = yB - yT;
    var gx = (x0 + x1) / 2;
    if (gap) { var gb = gap.getBoundingClientRect(); gx = gb.left - box.left + gb.width / 2; }
    var cy = yT + th * 0.55;
    // orbiting swoosh: gold in front of the clef, fading to blue behind the words
    ctx.save();
    ctx.lineCap = 'round';
    ctx.translate(gx, cy); ctx.rotate(-0.16);
    var rx = (x1 - x0) * 0.56, ry = th * 0.36;
    var sw = ctx.createLinearGradient(-rx, 0, rx, 0);
    sw.addColorStop(0, 'rgba(90,170,255,0)'); sw.addColorStop(0.25, 'rgba(120,200,255,0.85)'); sw.addColorStop(0.6, 'rgba(255,214,120,0.95)'); sw.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.strokeStyle = sw; ctx.shadowColor = 'rgba(255,200,110,0.8)'; ctx.shadowBlur = th * 0.1;
    ctx.lineWidth = Math.max(2, th * 0.035);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0.15, Math.PI - 0.05); ctx.stroke();
    ctx.lineWidth = Math.max(1, th * 0.014); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(0, th * 0.02, rx * 0.94, ry * 0.9, 0, 0.3, Math.PI - 0.2); ctx.stroke();
    ctx.restore();
    // the clef, standing tall between the words
    var sp = th * 0.16;
    ctx.save();
    ctx.shadowColor = 'rgba(255,190,70,0.85)'; ctx.shadowBlur = th * 0.12;
    var cg = ctx.createLinearGradient(0, -4.2, 0, 3.2);
    cg.addColorStop(0, '#fff3c4'); cg.addColorStop(0.3, '#ffcf5a'); cg.addColorStop(0.62, '#d8901c'); cg.addColorStop(1, '#ffe08a');
    ctx.strokeStyle = cg; ctx.fillStyle = cg;
    CK.drawTreble(ctx, gx + sp * 0.15, yT + th * 0.66, sp);
    ctx.restore();
  };

  CK.TitleArt = TitleArt;
})();
