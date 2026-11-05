/* Cosmic Keys — rendering: first-person 3D keyboard, approaching monsters, light effects.
 *
 * The keyboard, the approaching monsters, the light beams and the WebGL hands all
 * share one pinhole camera (view3d.js). World units are white-key widths.
 */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;
  var TAU = Math.PI * 2;
  var E = CK.ease;
  var K3 = CK.KEY3D;
  var LEN = K3.LEN, BLEN = K3.BLACK_LEN, BW = K3.BLACK_W, BH = K3.BLACK_H;

  var HAND_COLOR = { R: '#38e8ff', L: '#ffc24a' };
  var HAND_COLOR_RGB = { R: [56, 232, 255], L: [255, 194, 74] };
  CK.HAND_COLOR = HAND_COLOR;
  CK.HAND_COLOR_RGB = HAND_COLOR_RGB;

  function whiteIndex(midi) {
    var oct = Math.floor(midi / 12) - 1, pc = T.mod(midi, 12);
    var map = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
    return oct * 7 + map[pc];
  }
  function midiOfWhite(w) {
    var oct = Math.floor(w / 7), l = T.mod(w, 7);
    return 12 * (oct + 1) + T.LETTER_PC[l];
  }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function Scene(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Layers: #bg (world) < #mon (GL monsters) < #game (2D) < #hands (GL hands) < #fx (2D effects)
    this.fxCanvas = document.getElementById('fx');
    this.fxCtx = this.fxCanvas ? this.fxCanvas.getContext('2d') : this.ctx;
    // The keyboard has its own layer under the monsters, so monsters and their cards fly in front of it.
    this.pianoCanvas = document.getElementById('piano');
    this.pianoCtx = this.pianoCanvas ? this.pianoCanvas.getContext('2d') : this.ctx;
    this.handsCanvas = document.getElementById('hands');
    this.glHands = (CK.GLHands && this.handsCanvas && !CK.query.nogl) ? new CK.GLHands(this.handsCanvas) : null;
    this.useGLHands = !!(this.glHands && this.glHands.ok);
    this.monCanvas = document.getElementById('mon');
    this.glMon = (CK.GLMonsters && this.monCanvas && !CK.query.nogl) ? new CK.GLMonsters(this.monCanvas) : null;
    this.useGLMon = !!(this.glMon && this.glMon.ok);
    this.handLayer = CK.makeCanvas(4, 4);
    // Space backdrop on #bg: the WebGL world when available, else the 2D particle world.
    this.bgCanvas = document.getElementById('bg');
    this.world = new CK.World();
    this.glWorld = null;
    if (CK.GLWorld && this.bgCanvas && !CK.query.nogl) {
      try { var gw = new CK.GLWorld(this.bgCanvas); if (gw.ok) this.glWorld = gw; } catch (err) { if (window.console) console.warn('GL world unavailable:', err); }
    }
    this.bgCtx = (!this.glWorld && this.bgCanvas) ? this.bgCanvas.getContext('2d') : null;
    if (this.glWorld) {
      var gw2 = this.glWorld, w2d = this.world;
      this.world = {
        wave: function (x, y, color, s) { gw2.wave(x, y, color, s); },
        setTheme: function (i) { gw2.setTheme(i); w2d.setTheme(i); },
        resize: function () {},
        draw: function () {}
      };
    }
    this.view = new CK.View3D();
    this.titleArt = CK.TitleArt ? new CK.TitleArt() : null;
    this.keyFx = {};
    this.time = 0;
    this.flash = 0;
    this.whiteFlash = 0;
    this.pianoOffset = 1;
    this.layout = null;
    this.focus = [48, 67];
    this.particles = [];
    this.texts = [];
    this.columns = [];
    this.cards = [];
    this.banners = [];
    this.damage = [];      // cracked keys: one per hit taken (health lost)
    this.repairs = [];     // keys being welded back (shown when the piano lands)
    this.broken = null;    // keyboard shattering (game over)
    this.beat = { pulse: 0, beat: 0 };
    this.camera = new CK.Motion.Camera();
    this.stageEl = document.getElementById('stage');
    this.resize();
  }

  Scene.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var W = Math.max(320, r.width || window.innerWidth), H = Math.max(240, r.height || window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    if (this.fxCanvas) { this.fxCanvas.width = this.canvas.width; this.fxCanvas.height = this.canvas.height; }
    if (this.bgCtx) { this.bgCanvas.width = this.canvas.width; this.bgCanvas.height = this.canvas.height; }
    if (this.pianoCanvas) { this.pianoCanvas.width = this.canvas.width; this.pianoCanvas.height = this.canvas.height; }
    if (this.glWorld) this.glWorld.resize(W, H, dpr);
    if (this.glHands && this.glHands.ok) this.glHands.resize(W, H, dpr);
    if (this.useGLMon) this.glMon.resize(W, H, dpr);
    this.portrait = H > W * 1.1;
    this.world.resize(W, H, dpr);
    if (this.titleArt) this.titleArt.resize(W, H, dpr);
    this.setFocus(this.focus[0], this.focus[1], this.focusFree);
  };

  Scene.prototype.setTheme = function (idx) { this.world.setTheme(idx); };

  /* ------------------------------------------------------------------ */
  /* Keyboard layout (world units: one white key = 1)                    */
  /* ------------------------------------------------------------------ */
  Scene.prototype.setFocus = function (lo, hi, free) {
    this.focus = [lo, hi];
    this.focusFree = !!free;
    var W = this.W, H = this.H;
    var wLo = Math.floor(whiteIndex(lo)), wHi = Math.ceil(whiteIndex(hi));
    var needed = wHi - wLo + 1;
    // About 9 keys per screen-height of width keeps the keyboard ~37% of the screen tall.
    var visible = Math.min(56, Math.max(needed + (free ? 2 : 4), Math.round(9.6 * W / H)));
    var nearY = this.portrait ? H * 0.78 : H * 0.8;
    this.view.offsetY = 0;
    this.view.fit(W, H, visible, nearY, 1.5, 0.66);
    var back = this.view.project(0, LEN, 0);
    var tip = this.view.project(0, 1.75, 0);
    this.layout = {
      visible: visible, cx0: (wLo + wHi + 1) / 2, keyW: W / visible,
      U: 0.95,                      // hand size unit (world)
      Upx: 0.95 * tip.s,            // the same in pixels at the fingertips
      backY: back.y, sink: H - back.y + 60
    };
    this.view.offsetY = this.pianoOffset * this.layout.sink;
  };

  Scene.prototype._syncView = function () { this.view.offsetY = this.pianoOffset * this.layout.sink; };
  Scene.prototype.project = function (x, y, z) { return this.view.project(x, y, z || 0); };
  /** Screen y of the back edge of the keys (the keyboard's horizon). */
  Scene.prototype.pianoY = function () { this._syncView(); return this.view.project(0, LEN, 0).y; };
  Scene.prototype.keysTop = Scene.prototype.pianoY;
  Scene.prototype.keyX = function (midi) { return whiteIndex(midi) + 0.5 - this.layout.cx0; };
  /** Where a fingertip touches a key (world). Black keys are played near their front. */
  Scene.prototype.keyTouch3D = function (midi, thumb) {
    var x = this.keyX(midi);
    if (T.isBlack(midi)) return [x, LEN - BLEN + 0.75, BH];
    return [x, thumb ? 1.3 : 1.75, 0];
  };
  Scene.prototype.keyTouch = function (midi) {
    var p = this.keyTouch3D(midi, false);
    return this.view.project(p[0], p[1], p[2]);
  };
  Scene.prototype.keyCenterX = function (midi) { return this.view.project(this.keyX(midi), 1.5, 0).x; };
  Scene.prototype.isKeyVisible = function (midi) { var x = this.keyCenterX(midi); return x > -2 && x < this.W + 2; };
  /** Base and size of the ray gun standing on a key (No Hand Position mode). */
  Scene.prototype.gunBase = function (midi) {
    var black = T.isBlack(midi);
    var p = this.view.project(this.keyX(midi), black ? LEN - BLEN + 0.7 : 1.6, black ? BH : 0);
    return { x: p.x, y: p.y, s: p.s * (black ? 0.5 : 0.62) };
  };

  /** Which key is under a screen point (for tapping the on-screen keys). */
  Scene.prototype.pickKey = function (sx, sy) {
    this._syncView();
    var cx0 = this.layout.cx0, v = this.view;
    var b = v.unproject(sx, sy, BH);
    if (b.y >= LEN - BLEN && b.y <= LEN) {
      var wb = Math.round(b.x + cx0) - 1;               // black key centred on the boundary w+1
      var bm = midiOfWhite(wb) + 1;
      if (T.isBlack(bm) && Math.abs(b.x - (wb + 1 - cx0)) <= BW / 2) return bm;
    }
    var p = v.unproject(sx, sy, 0);
    if (p.y < -0.2 || p.y > LEN) return null;
    return midiOfWhite(Math.floor(p.x + cx0));
  };

  /** Key press: depress + glow, plus a beam of light rising from the key into space. */
  Scene.prototype.pressKey = function (midi, color, strength) {
    var s = strength == null ? 1 : strength;
    this.keyFx[midi] = { t: 0, color: color, s: s };
    if (this.isKeyVisible(midi)) {
      this.columns.push({ midi: midi, t: 0, color: color, s: s });
      var p = this.keyTouch(midi);
      this.world.wave(p.x, this.pianoY(), color, 0.8 * s);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Damage: every monster that reaches the keyboard cracks a key        */
  /* ------------------------------------------------------------------ */
  function makeCracks(seed, black) {
    var rnd = CK.Motion.rng(seed), out = [];
    var n = 5 + Math.floor(rnd() * 3);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + rnd() * 0.8, x = 0, y = 0, pts = [[0, 0]];
      var segs = 3 + Math.floor(rnd() * 4), len = black ? 0.16 : 0.28;
      for (var s = 0; s < segs; s++) {
        a += (rnd() - 0.5) * 1.1;
        var l = len * (0.6 + rnd() * 0.8) * (1 - s * 0.08);
        x += Math.cos(a) * l * (black ? 0.6 : 1); y += Math.sin(a) * l * 1.6;
        pts.push([x, y]);
        if (rnd() < 0.3) {
          var b = a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6), bx = x, by = y, bp = [[bx, by]];
          for (var k = 0; k < 2; k++) { bx += Math.cos(b) * l * 0.6; by += Math.sin(b) * l; bp.push([bx, by]); b += (rnd() - 0.5); }
          out.push({ pts: bp, w: 0.55 });
        }
      }
      out.push({ pts: pts, w: 1 });
    }
    return out;
  }

  /** Crack the key under world x (or the given midi). Returns the impact point on screen. */
  Scene.prototype.damageKey = function (midi, iy) {
    var black = T.isBlack(midi);
    var y = iy != null ? iy : (black ? LEN - BLEN * 0.5 : CK.rand(3.2, 4.6));
    if (!black && y > LEN - BLEN + 0.1) y = LEN - BLEN - CK.rand(0.1, 0.9) + BLEN * 0.0;
    var d = { midi: midi, y: y, t: this.time, seed: (Math.random() * 1e9) | 0 };
    d.cracks = makeCracks(d.seed, black);
    this.damage.push(d);
    var z = black ? BH : 0;
    return this.view.project(this.keyX(midi), y, z);
  };
  /** Keep exactly n cracked keys (repairs happen between levels, a new game clears them). */
  Scene.prototype.syncDamage = function (n) {
    while (this.damage.length > n) this.repairs.push(this.damage.shift());
    this.broken = null;
  };
  Scene.prototype.breakKeyboard = function () { this.broken = { t: this.time }; };
  /** Key under a world x position (white key). */
  Scene.prototype.keyAtX = function (x) { return midiOfWhite(Math.floor(x + this.layout.cx0)); };

  /* ------------------------------------------------------------------ */
  /* Effects API                                                          */
  /* ------------------------------------------------------------------ */
  Scene.prototype.burst = function (x, y, colors, n, speed, size, kind) {
    for (var i = 0; i < n && this.particles.length < 800; i++) {
      var a = Math.random() * TAU, s = speed * (0.25 + Math.random() * 0.95);
      this.particles.push({
        kind: kind || 'glow', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.15,
        life: 0, max: CK.rand(0.45, 1.0), size: (size || 6) * CK.rand(0.6, 1.4),
        color: CK.pick(colors), drag: kind === 'goo' ? 1.4 : (kind === 'spark' ? 1.2 : 2.6),
        grav: kind === 'goo' ? 520 : (kind === 'spark' ? 900 : 60), rot: Math.random() * TAU, vr: CK.rand(-8, 8)
      });
    }
  };
  Scene.prototype.smoke = function (x, y, size, dark) {
    if (this.particles.length >= 800) return;
    this.particles.push({ kind: 'smoke', x: x + CK.rand(-4, 4), y: y, vx: CK.rand(-12, 12), vy: CK.rand(-60, -35), life: 0, max: CK.rand(1.4, 2.4), size: size * CK.rand(0.7, 1.2), color: dark ? '#1a1620' : '#6b6f80', drag: 0.6, grav: -10, rot: Math.random() * TAU, vr: CK.rand(-0.6, 0.6) });
  };
  Scene.prototype.ring = function (x, y, color, r0, r1, dur, width, flat) {
    this.particles.push({ kind: 'ring', x: x, y: y, r0: r0, r1: r1, life: 0, max: dur || 0.45, color: color, width: width || 3, flat: flat || 1 });
  };
  Scene.prototype.floatText = function (x, y, text, color, size, dur) {
    this.texts.push({ x: x, y: y, text: text, color: color, size: size || 22, life: 0, max: dur || 1.0 });
  };
  /** Short, quickly decaying, seeded camera shake (motion guide §7). */
  Scene.prototype.addShake = function (amt) {
    if (CK.prefersReducedMotion) return;
    this.camera.shake(this.time, amt * 0.9, Math.floor(this.time * 1000) % 997 + 1);
  };
  /** Camera push to a screen point (GLIDE spring), or back home. */
  Scene.prototype.cameraTo = function (zoom, fx, fy, cls) {
    if (CK.prefersReducedMotion) return;
    this.camera.to(this.time, zoom, fx, fy, this.W, this.H, cls);
  };
  Scene.prototype.cameraHome = function (cls) { this.camera.home(this.time, cls); };
  Scene.prototype.cameraSet = function (zoom, fx, fy) {
    this.camera.reset(this.time);
    if (zoom !== 1) { this.camera.zoomKeys[0].v = zoom; this.camera.xKeys[0].v = (this.W / 2 - fx) * (1 - 1 / zoom); this.camera.yKeys[0].v = (this.H / 2 - fy) * (1 - 1 / zoom); }
  };
  /** Banner with per-letter kinetic typography. */
  Scene.prototype.showBanner = function (o) {
    o.born = this.time; o.hold = o.hold == null ? 1.2 : o.hold;
    this.banners = [o];
    return o;
  };
  Scene.prototype.clearBanners = function (fast) {
    var t = this.time;
    this.banners.forEach(function (b) { if (b.leave == null) b.leave = t; if (fast) b.fast = true; });
  };
  /** Card spins away after its monster is destroyed. */
  Scene.prototype.dropCard = function (e, p) {
    this.cards.push({ note: e.note, hand: e.hand, x: p.cardX, y: p.cardY, w: p.cardW, vx: CK.rand(-60, 60), vy: -160, rot: 0, vr: CK.rand(-5, 5), life: 0 });
  };

  /* ------------------------------------------------------------------ */
  /* Main render                                                          */
  /* ------------------------------------------------------------------ */
  Scene.prototype.render = function (game, dt) {
    this.time += dt;
    var ctx = this.ctx, W = this.W, H = this.H, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.beat = CK.audio.beat ? CK.audio.beat() : { pulse: 0 };
    this._syncView();

    // Camera: one transform for every layer (pure function of scene time).
    var cam = this.camera.state(this.time);
    if (this.stageEl) {
      var tr = 'translate3d(' + cam.x.toFixed(2) + 'px,' + cam.y.toFixed(2) + 'px,0) scale(' + cam.zoom.toFixed(4) + ')';
      if (tr !== this._lastTr) { this.stageEl.style.transform = tr; this._lastTr = tr; }
    }

    var showPiano = this.pianoOffset < 0.999;
    var horizon = showPiano ? this.pianoY() : H * 0.98;
    if (this.glWorld) this.glWorld.draw(dt, this.beat, horizon + 10);
    else {
      var bctx = this.bgCtx || ctx;
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.world.draw(bctx, dt, this.beat, horizon + 10);
    }
    if (this.bgCtx || this.glWorld) ctx.clearRect(0, 0, W, H);

    var pctx = this.pianoCtx;
    if (pctx !== ctx) { pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.clearRect(0, 0, this.pianoCanvas.width, this.pianoCanvas.height); pctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    if (showPiano) {
      this._drawPiano(pctx, game, dt);
      if (game) this._drawWarnings(pctx, game);
    }
    if (game && game.state === 'title') {
      if (this.titleArt) this.titleArt.draw(ctx, this.time, this.beat);
      else this._drawTitleMonsters(ctx);
    }
    if (game) this._drawEnemies(ctx, game, dt);
    if (this.useGLMon) this.glMon.flush();
    this._drawCards(ctx, dt);
    var handsShown = showPiano && game && game.plan && !game.plan.free;
    if (showPiano) {
      this._drawColumns(ctx, dt);
      if (game && game.plan && game.plan.free) this._drawGuns(ctx, game);
      if (handsShown && !this.useGLHands) this._drawHands(ctx, game);
    } else {
      this.columns.length = 0;
    }

    if (this._callouts) { for (var ci = 0; ci < this._callouts.length; ci++) this._drawCallout(ctx, this._callouts[ci].p, this._callouts[ci].hand); this._callouts = []; }
    // 3D hands (WebGL layer between the game and the effects)
    if (this.useGLHands) this.glHands.render(this, handsShown ? game.handRigs : [], dt);

    // Effects layer (above the hands)
    var fx = this.fxCtx;
    if (fx !== ctx) { fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height); fx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    if (showPiano) this._damageFx(dt);
    if (game) this._drawCharges(fx, game);
    this._drawBolts(fx, game);
    this._drawParticles(fx, dt);
    this._drawTexts(fx, dt);
    this._drawBanners(fx);
    if (this.flash > 0) {
      var vg = fx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(255,40,80,0)'); vg.addColorStop(1, 'rgba(255,40,80,' + (this.flash * 0.6).toFixed(3) + ')');
      fx.fillStyle = vg; fx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
    if (this.whiteFlash > 0) {
      fx.fillStyle = 'rgba(255,255,255,' + (this.whiteFlash * 0.5).toFixed(3) + ')';
      fx.fillRect(0, 0, W, H);
      this.whiteFlash = Math.max(0, this.whiteFlash - dt * 5);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Light beams (every note sends a beam from its key into space)       */
  /* ------------------------------------------------------------------ */
  Scene.prototype._drawColumns = function (ctx, dt) {
    var v = this.view;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = this.columns.length - 1; i >= 0; i--) {
      var c = this.columns[i];
      c.t += dt;
      var k = c.t / 0.9;
      if (k >= 1) { this.columns.splice(i, 1); continue; }
      var x = this.keyX(c.midi), black = T.isBlack(c.midi);
      var y = black ? LEN - BLEN * 0.5 : LEN * 0.55, z0 = black ? BH : 0;
      var hgt = 2 + 22 * E.outCubic(Math.min(1, c.t / 0.25));
      var hw = (black ? 0.3 : 0.42) * (1 + k * 0.6);
      var a0 = v.project(x - hw, y, z0), a1 = v.project(x + hw, y, z0);
      var b0 = v.project(x - hw * 1.6, y, z0 + hgt), b1 = v.project(x + hw * 1.6, y, z0 + hgt);
      var a = (1 - k) * 0.6 * c.s;
      var g = ctx.createLinearGradient(0, a0.y, 0, b0.y);
      g.addColorStop(0, CK.hexA(c.color, a)); g.addColorStop(0.5, CK.hexA(c.color, a * 0.35)); g.addColorStop(1, CK.hexA(c.color, 0));
      ctx.fillStyle = g;
      poly(ctx, [a0, a1, b1, b0]); ctx.fill();
      var m0 = v.project(x, y, z0), m1 = v.project(x, y, z0 + hgt * 0.8);
      var core = ctx.createLinearGradient(0, m0.y, 0, m1.y);
      core.addColorStop(0, CK.hexA('#ffffff', a * 0.9)); core.addColorStop(1, CK.hexA('#ffffff', 0));
      ctx.strokeStyle = core; ctx.lineWidth = Math.max(1.5, hw * 0.35 * m0.s);
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.stroke();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ */
  /* Piano (first-person perspective)                                     */
  /* ------------------------------------------------------------------ */
  Scene.prototype._breakXf = function (ctx, w, cx, cy) {
    if (!this.broken) return false;
    var t = this.time - this.broken.t;
    if (t <= 0) return false;
    var rnd = CK.Motion.rng(w * 7919 + 13);
    var vx = (cx - this.W / 2) * 1.1 + (rnd() - 0.5) * 260, vy = -260 - rnd() * 420, vr = (rnd() - 0.5) * 7;
    ctx.translate(cx + vx * t, cy + vy * t + 1100 * t * t);
    ctx.rotate(vr * t);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = CK.clamp(1.6 - t, 0, 1);
    return true;
  };

  Scene.prototype._drawPiano = function (ctx, game, dt) {
    var v = this.view, W = this.W, H = this.H, L = this.layout, cx0 = L.cx0;
    var pulse = this.beat.pulse || 0;
    var P = function (x, y, z) { return v.project(x, y, z || 0); };
    var hit = game && game.shieldHit > 0 ? game.shieldHit : 0;
    var dmgN = this.damage.length;
    var flicker = dmgN >= 2 ? (Math.sin(this.time * 37) * Math.sin(this.time * 11.3) > 0.55 ? 0.35 : 1) : 1;

    // visible white keys (the back edge is narrower on screen, so it shows more keys)
    var back = P(0, LEN, 0);
    var half = (W / 2) / back.s + 2;
    var w0 = Math.floor(cx0 - half), w1 = Math.ceil(cx0 + half);
    var xL = w0 - cx0 - 1, xR = w1 + 1 - cx0 + 1;

    // ---- the sky above the keyboard: music ribbons at the sides, light lanes running into space
    if (!this.broken) this._drawSkyLanes(ctx, game, zonesOf(game), pulse);

    // ---- fallboard behind the keys: lacquered navy with a gold inlay and a neon edge
    ctx.save();
    if (this.broken) this._breakXf(ctx, -555, W / 2, P(0, LEN, 0.5).y);
    var fb0 = P(xL, LEN + 1.1, 1.0), fb1 = P(xR, LEN + 1.1, 1.0), fb2 = P(xR, LEN, 1.0), fb3 = P(xL, LEN, 1.0);
    ctx.fillStyle = '#0d1430';
    poly(ctx, [fb0, fb1, fb2, fb3]); ctx.fill();
    var ff0 = P(xL, LEN, 1.0), ff1 = P(xR, LEN, 1.0), ff2 = P(xR, LEN, 0), ff3 = P(xL, LEN, 0);
    var fg = ctx.createLinearGradient(0, ff0.y, 0, ff3.y);
    fg.addColorStop(0, '#1f2a5c'); fg.addColorStop(0.12, '#141c42'); fg.addColorStop(1, '#070a1c');
    ctx.fillStyle = fg;
    poly(ctx, [ff0, ff1, ff2, ff3]); ctx.fill();
    // gold pinstripe + glow line along the top edge of the fallboard
    var gl0 = P(xL, LEN - 0.001, 0.82), gl1 = P(xR, LEN - 0.001, 0.82);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flicker;
    var lw = Math.max(1, back.s * 0.035);
    ctx.strokeStyle = 'rgba(255,196,90,0.85)'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(gl0.x, gl0.y); ctx.lineTo(gl1.x, gl1.y); ctx.stroke();
    var e0 = P(xL, LEN, 1.0), e1 = P(xR, LEN, 1.0);
    ctx.strokeStyle = 'rgba(110,235,255,' + (0.55 + pulse * 0.35).toFixed(3) + ')'; ctx.lineWidth = lw * 1.6;
    ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
    ctx.globalAlpha = 0.35 * flicker; ctx.lineWidth = lw * 7;
    ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
    ctx.restore();
    if (W > 520) {
      var lab = P(0, LEN, 0.45);
      ctx.save();
      ctx.font = '600 ' + Math.round(CK.clamp(back.s * 0.3, 9, 16)) + 'px Outfit, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,205,120,0.55)';
      ctx.fillText('C L E F   C O M M A N D', lab.x, lab.y);
      ctx.restore();
    }
    ctx.restore();

    // ---- key bed (shows through the gaps between keys)
    ctx.fillStyle = '#04050c';
    poly(ctx, [P(xL, LEN, 0), P(xR, LEN, 0), P(xR, -0.05, 0), P(xL, -0.05, 0)]); ctx.fill();

    var zones = {};
    if (game && game.plan) game.plan.hands.forEach(function (h) { game.plan.notes[h].forEach(function (nn) { zones[nn.midi] = h; }); });
    var fx = this.keyFx;
    var pressOf = function (m) { var f = fx[m]; return f ? Math.max(0, 1 - f.t / 0.45) * f.s : 0; };
    var dmgOf = {};
    this.damage.forEach(function (d) { dmgOf[d.midi] = d; });

    // ---- white keys
    var top0 = P(0, LEN, 0).y, top1 = P(0, 0, 0).y;
    var wg = ctx.createLinearGradient(0, top0, 0, top1);
    wg.addColorStop(0, '#a9b1c9'); wg.addColorStop(0.25, '#dde2ee'); wg.addColorStop(0.8, '#f6f8fc'); wg.addColorStop(1, '#ffffff');
    var gap = 0.035;
    for (var w = w0; w <= w1; w++) {
      var x0 = w - cx0 + gap, x1 = w + 1 - cx0 - gap, midi = midiOfWhite(w);
      var press = pressOf(midi), dz = -press * 0.2 - (dmgOf[midi] ? 0.06 : 0);
      var a = P(x0, LEN, 0), b = P(x1, LEN, 0), c = P(x1, 0, dz), d = P(x0, 0, dz);
      var cf = P(x1, 0, dz - 0.42), df = P(x0, 0, dz - 0.42);
      ctx.save();
      this._breakXf(ctx, w, (a.x + c.x) / 2, (a.y + c.y) / 2);
      poly(ctx, [a, b, c, d]);
      ctx.fillStyle = wg; ctx.fill();
      if (zones[midi]) {
        var zc = HAND_COLOR_RGB[zones[midi]];
        var zg = ctx.createLinearGradient(0, a.y, 0, d.y);
        zg.addColorStop(0, rgba(zc, (0.34 + pulse * 0.12).toFixed(3))); zg.addColorStop(0.45, rgba(zc, 0.06)); zg.addColorStop(1, rgba(zc, 0));
        ctx.fillStyle = zg; ctx.fill();
      }
      if (press > 0) {
        var f = fx[midi];
        var pg = ctx.createLinearGradient(0, a.y, 0, d.y);
        pg.addColorStop(0, CK.hexA(f.color, 0.15 * press)); pg.addColorStop(1, CK.hexA(f.color, 0.8 * press));
        ctx.fillStyle = pg; ctx.fill();
      }
      if (hit > 0) { ctx.fillStyle = 'rgba(255,50,80,' + (hit * 0.28).toFixed(3) + ')'; ctx.fill(); }
      // rounded front edge highlight and the key's front face
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      poly(ctx, [d, c, cf, df]);
      var ffg = ctx.createLinearGradient(0, d.y, 0, df.y);
      ffg.addColorStop(0, '#d9deea'); ffg.addColorStop(1, '#8e97b2');
      ctx.fillStyle = ffg; ctx.fill();
      if (zones[midi]) {
        ctx.fillStyle = rgba(HAND_COLOR_RGB[zones[midi]], 0.9);
        var zs0 = P(x0 + 0.2, 0, dz - 0.3), zs1 = P(x1 - 0.2, 0, dz - 0.3);
        ctx.fillRect(zs0.x, zs0.y - 1, zs1.x - zs0.x, Math.max(2, back.s * 0.05));
      }
      if (midi === 60) {
        var mc = P(x0 + 0.5 - gap, LEN - 0.45, 0);
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.ellipse(mc.x, mc.y, Math.max(2, mc.s * 0.09), Math.max(1.4, mc.s * 0.055), 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // ---- soft contact shadow around the black keys, then the black keys
    ctx.fillStyle = 'rgba(10,12,30,0.28)';
    var blacks = [];
    for (w = w0 - 1; w <= w1; w++) {
      var bm = midiOfWhite(w) + 1;
      if (!T.isBlack(bm)) continue;
      var xc = w + 1 - cx0;
      blacks.push({ w: w, m: bm, xc: xc });
      if (!this.broken) { poly(ctx, [P(xc - BW / 2 - 0.08, LEN, 0), P(xc + BW / 2 + 0.1, LEN, 0), P(xc + BW / 2 + 0.1, LEN - BLEN - 0.16, 0), P(xc - BW / 2 - 0.08, LEN - BLEN - 0.16, 0)]); ctx.fill(); }
    }
    // outermost first so nearer side faces overlap correctly
    blacks.sort(function (p, q) { return Math.abs(q.xc) - Math.abs(p.xc); });
    for (var i = 0; i < blacks.length; i++) {
      var bk = blacks[i], bp = pressOf(bk.m);
      var bx0 = bk.xc - BW / 2, bx1 = bk.xc + BW / 2, by0 = LEN - BLEN, by1 = LEN;
      var zt = BH - bp * 0.14 - (dmgOf[bk.m] ? 0.05 : 0), ins = 0.05;
      ctx.save();
      var mid = P(bk.xc, (by0 + by1) / 2, zt);
      this._breakXf(ctx, bk.w + 0.5, mid.x, mid.y);
      // side face facing the camera
      var sx = bk.xc > 0 ? bx0 : bx1, sxt = bk.xc > 0 ? bx0 + ins : bx1 - ins;
      poly(ctx, [P(sx, by0, 0), P(sx, by1, 0), P(sxt, by1, zt), P(sxt, by0 + ins, zt)]);
      ctx.fillStyle = '#05060c'; ctx.fill();
      // front face
      var fa = P(bx0, by0, 0), fbb = P(bx1, by0, 0), fc = P(bx1 - ins, by0 + ins, zt), fd = P(bx0 + ins, by0 + ins, zt);
      poly(ctx, [fa, fbb, fc, fd]);
      var bfg = ctx.createLinearGradient(0, fd.y, 0, fa.y);
      bfg.addColorStop(0, '#3a4060'); bfg.addColorStop(1, '#10121e');
      ctx.fillStyle = bfg; ctx.fill();
      // top
      var ta = P(bx0 + ins, by1, zt), tb = P(bx1 - ins, by1, zt), tc = fc, td = fd;
      poly(ctx, [ta, tb, tc, td]);
      var btg = ctx.createLinearGradient(0, ta.y, 0, td.y);
      btg.addColorStop(0, '#07080f'); btg.addColorStop(0.7, '#1b1f31'); btg.addColorStop(1, '#2c3250');
      ctx.fillStyle = btg; ctx.fill();
      // glossy reflection strip
      var hx = bk.xc > 0 ? bx0 + ins + 0.09 : bx1 - ins - 0.17;
      var ha = P(hx, by1 - 0.2, zt), hb = P(hx + 0.08, by1 - 0.2, zt), hc = P(hx + 0.08, by0 + 0.25, zt), hd = P(hx, by0 + 0.25, zt);
      var hg = ctx.createLinearGradient(0, ha.y, 0, hd.y);
      hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(1, 'rgba(200,215,255,0.32)');
      poly(ctx, [ha, hb, hc, hd]); ctx.fillStyle = hg; ctx.fill();
      ctx.strokeStyle = 'rgba(170,185,230,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(td.x, td.y); ctx.lineTo(tc.x, tc.y); ctx.stroke();
      if (zones[bk.m]) {
        ctx.fillStyle = rgba(HAND_COLOR_RGB[zones[bk.m]], 0.85);
        var zb0 = P(bx0 + 0.12, by0 + 0.2, zt), zb1 = P(bx1 - 0.12, by0 + 0.2, zt);
        ctx.fillRect(zb0.x, zb0.y - 1, zb1.x - zb0.x, Math.max(2, back.s * 0.045));
      }
      if (bp > 0) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = CK.hexA(fx[bk.m].color, 0.6 * bp);
        poly(ctx, [ta, tb, tc, td]); ctx.fill();
        ctx.restore();
      }
      if (hit > 0) { ctx.fillStyle = 'rgba(255,50,80,' + (hit * 0.22).toFixed(3) + ')'; poly(ctx, [ta, tb, tc, td]); ctx.fill(); }
      ctx.restore();
    }

    // ---- cracks and scorch marks on damaged keys
    if (!this.broken) for (i = 0; i < this.damage.length; i++) this._drawDamage(ctx, this.damage[i]);

    // ---- key glow
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var km in fx) {
      var ef = fx[km];
      ef.t += dt;
      if (ef.t > 0.6) { delete fx[km]; continue; }
      var gp = this.keyTouch(+km), ga = Math.max(0, 1 - ef.t / 0.6) * ef.s;
      var gs = gp.s * 3.2;
      ctx.globalAlpha = ga * 0.8;
      ctx.drawImage(CK.glowSprite(ef.color), gp.x - gs / 2, gp.y - gs * 0.35, gs, gs * 0.7);
    }
    ctx.restore();

    // ---- key slip and piano body below the keys
    var ks0 = P(xL, -0.02, -0.42), ks1 = P(xR, -0.02, -0.42), ks2 = P(xR, -0.02, -1.25), ks3 = P(xL, -0.02, -1.25);
    var kg = ctx.createLinearGradient(0, ks0.y, 0, ks3.y);
    kg.addColorStop(0, '#22306a'); kg.addColorStop(0.2, '#141d48'); kg.addColorStop(1, '#0a0f2a');
    ctx.save();
    if (this.broken) this._breakXf(ctx, -999, W / 2, ks0.y);
    poly(ctx, [ks0, ks1, ks2, ks3]); ctx.fillStyle = kg; ctx.fill();
    var bot = Math.max(H + 40, ks3.y + 10);
    ctx.fillStyle = '#070a1d'; ctx.fillRect(0, ks3.y - 0.5, W, bot - ks3.y);
    ctx.globalCompositeOperation = 'lighter';
    var gt0 = P(xL, -0.03, -0.5), gt1 = P(xR, -0.03, -0.5);
    ctx.strokeStyle = 'rgba(255,196,90,0.7)'; ctx.lineWidth = Math.max(1, gt0.s * 0.03);
    ctx.beginPath(); ctx.moveTo(gt0.x, gt0.y); ctx.lineTo(gt1.x, gt1.y); ctx.stroke();
    var gb0 = P(xL, -0.03, -1.2), gb1 = P(xR, -0.03, -1.2);
    ctx.strokeStyle = 'rgba(110,235,255,' + ((0.35 + pulse * 0.3) * flicker).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, gb0.s * 0.04);
    ctx.beginPath(); ctx.moveTo(gb0.x, gb0.y); ctx.lineTo(gb1.x, gb1.y); ctx.stroke();
    ctx.restore();
  };

  function zonesOf(game) {
    var z = {};
    if (game && game.plan) game.plan.hands.forEach(function (h) { game.plan.notes[h].forEach(function (nn) { z[nn.midi] = h; }); });
    return z;
  }

  /** Light lanes from each playable key out into space (a beat pulse runs down them) and music ribbons framing the sky. */
  Scene.prototype._drawSkyLanes = function (ctx, game, zones, pulse) {
    var v = this.view, W = this.W, back = v.project(0, LEN, 0).y;
    if (back < 40) return;
    var beat = this.beat && this.beat.beat != null ? this.beat.beat : this.time * 2;
    var frac = beat - Math.floor(beat);
    var y0 = LEN + 1.1, y1 = LEN + 70;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var m in zones) {
      var midi = +m, x = this.keyX(midi), hw = T.isBlack(midi) ? 0.26 : 0.4;
      var rgb = HAND_COLOR_RGB[zones[m]];
      var a0 = v.project(x - hw, y0, 0), a1 = v.project(x + hw, y0, 0), b0 = v.project(x - hw, y1, 0), b1 = v.project(x + hw, y1, 0);
      var g = ctx.createLinearGradient(0, a0.y, 0, b0.y);
      g.addColorStop(0, rgba(rgb, (0.24 + pulse * 0.08).toFixed(3))); g.addColorStop(0.5, rgba(rgb, 0.06)); g.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = g;
      poly(ctx, [a0, a1, b1, b0]); ctx.fill();
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(b0.x, b0.y); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
      // a dash of light on every beat, rushing toward the keys
      var yd = y0 + (1 - frac) * 26, yd2 = yd + 1.6;
      var d0 = v.project(x - hw * 0.7, yd, 0), d1 = v.project(x + hw * 0.7, yd, 0), d2 = v.project(x + hw * 0.7, yd2, 0), d3 = v.project(x - hw * 0.7, yd2, 0);
      ctx.fillStyle = rgba(rgb, (0.35 * (1 - frac * 0.5)).toFixed(3));
      poly(ctx, [d0, d1, d2, d3]); ctx.fill();
    }
    ctx.restore();
    if (CK.drawDigitalRibbon) {
      var H = this.H, bw = Math.max(12, Math.min(W, H) * 0.045), top = Math.max(60, H * 0.08);
      CK.drawDigitalRibbon(ctx, [W * 0.015, top], [W * 0.09, back * 0.45], [W * 0.01, back * 0.75], [W * 0.12, back + 6], bw, this.time, pulse, { a: '#3ce6d6', b: '#ffc24a', alpha: 0.75, n: 70 });
      CK.drawDigitalRibbon(ctx, [W * 0.985, top + H * 0.04], [W * 0.91, back * 0.45], [W * 0.99, back * 0.75], [W * 0.88, back + 6], bw, this.time + 2, pulse, { a: '#7fb4ff', b: '#ffc24a', alpha: 0.75, n: 70, notes: 3 });
    }
  };

  Scene.prototype._drawDamage = function (ctx, d) {
    var v = this.view, black = T.isBlack(d.midi), z = black ? BH - 0.05 : -0.06;
    var x = this.keyX(d.midi), age = this.time - d.t;
    var c = v.project(x, d.y, z);
    var sx = v.project(x + 0.5, d.y, z).x - c.x, sy = v.project(x, d.y - 0.5, z).y - c.y;
    ctx.save();
    // scorch
    ctx.translate(c.x, c.y); ctx.scale(1, Math.max(0.2, sy / Math.max(1, sx)));
    var r = sx * (black ? 0.9 : 1.2);
    var sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    sg.addColorStop(0, 'rgba(20,8,6,0.9)'); sg.addColorStop(0.45, 'rgba(60,30,20,0.45)'); sg.addColorStop(1, 'rgba(60,30,20,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.restore();
    // cracks
    var hot = Math.max(0, 1 - age / 2.5), pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + d.seed);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < d.cracks.length; i++) {
        var cr = d.cracks[i];
        ctx.beginPath();
        for (var k = 0; k < cr.pts.length; k++) {
          var p = v.project(x + cr.pts[k][0], d.y + cr.pts[k][1], z);
          if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        }
        if (pass === 0) { ctx.strokeStyle = black ? 'rgba(150,160,190,0.75)' : 'rgba(25,20,30,0.9)'; ctx.lineWidth = Math.max(1, c.s * 0.035 * cr.w); ctx.stroke(); }
        else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,' + Math.round(110 + 80 * hot) + ',60,' + (0.12 + 0.6 * hot + 0.12 * pulse).toFixed(3) + ')';
          ctx.lineWidth = Math.max(1, c.s * 0.02 * cr.w); ctx.stroke();
        }
      }
    }
    ctx.restore();
  };

  /** Sparks and smoke from cracked keys, welding sparkles for repaired ones. */
  Scene.prototype._damageFx = function (dt) {
    if (this.broken || this.pianoOffset > 0.05) return;
    var v = this.view;
    for (var i = 0; i < this.damage.length; i++) {
      var d = this.damage[i], black = T.isBlack(d.midi);
      var p = v.project(this.keyX(d.midi), d.y, black ? BH : 0);
      if (Math.random() < dt * 2.2) this.smoke(p.x, p.y - 4, p.s * 0.5, Math.random() < 0.4);
      if (Math.random() < dt * 0.9) this.burst(p.x, p.y, ['#ffd27a', '#ffffff', '#ff8a3c'], CK.randInt(3, 6), 260, 3, 'spark');
    }
    for (i = this.repairs.length - 1; i >= 0; i--) {
      var rp = this.repairs[i];
      var q = v.project(this.keyX(rp.midi), rp.y, T.isBlack(rp.midi) ? BH : 0);
      this.burst(q.x, q.y, ['#8ff7ff', '#ffffff', '#ffe58a'], 18, 260, 5);
      this.ring(q.x, q.y, '#8ff7ff', 4, q.s * 1.3, 0.5, 3, 0.4);
      this.repairs.splice(i, 1);
    }
  };

  /** Warning reticle on the keyboard where a close monster is about to slam down. */
  Scene.prototype._drawWarnings = function (ctx, game) {
    var list = game.enemies;
    ctx.save();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.targeted || e.progress < 0.8) continue;
      var k = CK.clamp((e.progress - 0.8) / 0.2, 0, 1);
      var lx = this.laneX(e), iy = LEN - BLEN - 0.6;
      var p = this.view.project(lx, iy, 0);
      var blink = 0.5 + 0.5 * Math.sin(this.time * (10 + k * 14));
      var rx = p.s * (1.3 - 0.5 * k), ry = rx * 0.38;
      ctx.globalAlpha = (0.25 + 0.6 * k) * (0.5 + 0.5 * blink);
      ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2 + k * 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 0.45, ry * 0.45, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ */
  /* Hands (2D fallback when WebGL2 is unavailable)                      */
  /* ------------------------------------------------------------------ */
  Scene.prototype.handGeom = function (hand, homeMidis) {
    var L = this.layout, U = L.Upx, side = hand === 'R' ? 1 : -1;
    var fingers = [];
    for (var f = 1; f <= 5; f++) {
      var midi = hand === 'R' ? homeMidis[f - 1] : homeMidis[5 - f];
      var tp = this.keyTouch(midi);
      fingers[f] = { midi: midi, tx: tp.x, ty: tp.y + (f === 1 ? 0.42 * U : 0) };
    }
    var cx = (fingers[2].tx + fingers[3].tx + fingers[4].tx + fingers[5].tx) / 4;
    var restY = fingers[3].ty;
    var palmTop = restY + 1.18 * U;
    var spread = 0.93 * U;
    for (f = 2; f <= 5; f++) {
      var rank = f - 2;
      fingers[f].kx = cx + side * (rank - 1.5) * spread;
      fingers[f].ky = palmTop + [0.1, 0, 0.05, 0.16][rank] * U;
    }
    var wrist = { x: cx - side * 0.15 * U, y: palmTop + 1.6 * U };
    fingers[1].kx = cx - side * 1.22 * U;
    fingers[1].ky = palmTop + 1.12 * U;
    return { hand: hand, side: side, U: U, fingers: fingers, cx: cx, palmTop: palmTop, wrist: wrist };
  };

  function posePoint(geom, pose, x, y) {
    var wx = geom.wrist.x, wy = geom.wrist.y;
    var dx = (x - wx) * pose.s, dy = (y - wy) * pose.s;
    var c = Math.cos(pose.rot), s = Math.sin(pose.rot);
    return { x: wx + dx * c - dy * s + pose.dx, y: wy + dx * s + dy * c + pose.dy };
  }
  /** The 3D pose seen by the flat fallback: the hands simply rise into place. */
  Scene.prototype._pose2D = function (pose) {
    var on = pose.onKeys == null ? 1 : pose.onKeys;
    return { visible: pose.visible, dx: 0, dy: (1 - on) * this.H * 0.45, s: 1, rot: 0, fingers: pose.fingers };
  };

  Scene.prototype.fingertipLocal = function (geom, pose, f) {
    var fi = geom.fingers[f], st = pose.fingers[f];
    var tx = fi.tx, ty = fi.ty;
    if (st.slideTo != null) {
      var tp = this.keyTouch(st.slideTo);
      tx = CK.lerp(tx, tp.x, st.slide); ty = CK.lerp(ty, tp.y + (f === 1 ? 0.3 * geom.U : 0), st.slide);
    }
    var curl = Math.max(0, st.curl);
    tx = fi.kx + (tx - fi.kx) * (1 - 0.68 * curl) + (st.wig || 0) * geom.U * 0.14;
    ty = fi.ky + (ty - fi.ky) * (1 - 0.68 * curl) + st.press * geom.U * 0.16 - (st.lift || 0) * geom.U * 0.25;
    return { x: tx, y: ty };
  };
  Scene.prototype.fingertip = function (geom, pose, f) {
    if (this.useGLHands && pose._tips && pose._tips[f]) return pose._tips[f];
    var p = this.fingertipLocal(geom, pose, f);
    return posePoint(geom, this._pose2D(pose), p.x, p.y);
  };

  Scene.prototype._drawHands = function (ctx, game) {
    var hands = game.handRigs;
    if (!hands || !hands.length) return;
    for (var i = 0; i < hands.length; i++) {
      var rig = hands[i];
      if (!rig.pose.visible) continue;
      rig.geom = this.handGeom(rig.hand, rig.homes);
      CK.drawRealHand(ctx, this, rig.geom, this._pose2D(rig.pose), HAND_COLOR[rig.hand]);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ray guns (No Hand Position mode)                                     */
  /* ------------------------------------------------------------------ */
  Scene.prototype._drawGuns = function (ctx, game) {
    var guns = game.guns;
    if (!guns) return;
    var pulse = this.beat.pulse || 0;
    // black-key guns stand further back, so draw them first
    var order = guns.slice().sort(function (a, b) { return (T.isBlack(b.midi) ? 1 : 0) - (T.isBlack(a.midi) ? 1 : 0); });
    for (var i = 0; i < order.length; i++) {
      var g = order[i];
      if (g.pop <= 0) continue;
      var gb = this.gunBase(g.midi);
      var x = gb.x;
      if (x < -20 || x > this.W + 20) continue;
      var black = T.isBlack(g.midi);
      var col = HAND_COLOR[g.hand] || '#38e8ff';
      var s = gb.s * 1.6 * E.outBack(Math.min(1, g.pop));
      var baseY = gb.y;
      var rec = g.recoil * s * 0.25;
      ctx.save();
      ctx.translate(x, baseY);
      var mg = ctx.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
      mg.addColorStop(0, '#3d4a86'); mg.addColorStop(0.5, '#d6c48e'); mg.addColorStop(1, '#2c3566');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.2, 0, Math.PI, TAU); ctx.fill();
      ctx.rotate(g.aim || 0);
      ctx.translate(0, rec);
      var dg = ctx.createRadialGradient(-s * 0.12, -s * 0.38, s * 0.04, 0, -s * 0.25, s * 0.42);
      dg.addColorStop(0, black ? '#8890b8' : '#ffffff'); dg.addColorStop(0.6, black ? '#3c4268' : '#c7d1ea'); dg.addColorStop(1, black ? '#1c2040' : '#7d89b4');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.ellipse(0, -s * 0.25, s * 0.36, s * 0.3, 0, 0, TAU); ctx.fill();
      var bg = ctx.createLinearGradient(-s * 0.1, 0, s * 0.1, 0);
      bg.addColorStop(0, '#4b5480'); bg.addColorStop(0.5, '#e8eeff'); bg.addColorStop(1, '#4b5480');
      ctx.fillStyle = bg;
      CK.roundRect(ctx, -s * 0.09, -s * 1.05, s * 0.18, s * 0.75, s * 0.06); ctx.fill();
      ctx.fillStyle = col;
      ctx.fillRect(-s * 0.14, -s * 0.85, s * 0.28, s * 0.07);
      ctx.fillRect(-s * 0.14, -s * 0.66, s * 0.28, s * 0.05);
      ctx.globalCompositeOperation = 'lighter';
      var gs = s * (0.7 + (g.charge > 0 ? g.charge * 1.4 : 0) + pulse * 0.2);
      ctx.drawImage(CK.glowSprite(col), -gs / 2, -s * 1.05 - gs / 2, gs, gs);
      ctx.restore();
      var ang = g.aim || 0, len = s * 1.05 - rec;
      g.tipX = x + Math.sin(ang) * len;
      g.tipY = baseY - Math.cos(ang) * len;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Enemies: they fly in from deep space toward the keyboard             */
  /* ------------------------------------------------------------------ */
  /** World x of a monster's flight lane (spread across the keyboard, not aligned with its note). */
  Scene.prototype.laneX = function (e) {
    var half = Math.max(1.5, this.layout.visible / 2 - 1.6);
    return (e.x - 0.5) * 2 * half;
  };
  Scene.prototype.enemyMetrics = function () {
    var p = this.view.project(0, LEN + 0.4, 2.9);
    return { mon: 2.1 * p.s, cardW: 1.95 * p.s };
  };

  /**
   * Position of a monster at its progress (0 = far away, 1 = hovering just behind
   * the keys). Screen motion is linear (perspective-correct), so it grows steadily
   * as it approaches; past 1 it dives onto the keys.
   */
  Scene.prototype.enemyPos = function (e) {
    var v = this.view, x = this.laneX(e);
    var end = [x, LEN + 0.4, 2.9];
    var dEnd = v.depth(end[0], end[1], end[2]), dStart = dEnd * 2.3;
    // start: on the camera ray through a point near the top of the sky, at depth dStart
    var sy = CK.clamp(this.H * 0.16, 70, 140);
    var c1 = (v.cy - sy) * dStart / v.F, c2 = dStart;
    var start = [x, v.camY + c1 * v.up[1] + c2 * v.fw[1], v.camZ + c1 * v.up[2] + c2 * v.fw[2]];
    var pr = CK.clamp(e.progress, 0, 1);
    var depth = 1 / CK.lerp(1 / dStart, 1 / dEnd, pr);
    var u = (depth - dStart) / (dEnd - dStart);
    var P = [CK.lerp(start[0], end[0], u), CK.lerp(start[1], end[1], u), CK.lerp(start[2], end[2], u)];
    if (e.dive > 0) {
      var k = E.inCubic(CK.clamp(e.dive, 0, 1));
      P = [P[0], CK.lerp(P[1], LEN - BLEN - 0.6, k), CK.lerp(P[2], 0.5, k)];
    }
    var q = v.project(P[0] + Math.sin(e.age * 0.9 + e.variant.phase) * 0.18, P[1], P[2] + Math.sin(e.age * 2.1 + e.variant.phase) * 0.1);
    var mon = 2.1 * q.s;
    var cardW = Math.max(1.95 * q.s, CK.clamp(this.W * 0.055, 54, 70));
    var cardH = cardW * 1.32;
    return { x: q.x, y: q.y, scale: q.s, mon: mon, cardW: cardW, cardH: cardH, cardX: q.x - cardW / 2, cardY: q.y + mon * 0.3, world: P };
  };

  Scene.prototype._drawEnemies = function (ctx, game, dt) {
    this._callouts = [];
    var list = game.enemies.filter(function (e) { return !e.dead; }), pulse = this.beat.pulse || 0, self = this;
    var pos = {};
    list.forEach(function (e) { pos[e.id] = self.enemyPos(e); });
    list.sort(function (a, b) { return pos[a.id].scale - pos[b.id].scale; }); // far first
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var p = pos[e.id];
      var age = e.age;
      // Warp-in: a portal opens and the monster pops through with squash & stretch.
      var portalK = CK.clamp(age / 0.5, 0, 1);
      if (portalK < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var prr = p.mon * (0.2 + E.outCubic(portalK) * 0.9);
        ctx.globalAlpha = 1 - portalK;
        ctx.strokeStyle = '#7fe8ff'; ctx.lineWidth = 3 + 6 * (1 - portalK);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, prr, prr * 0.35, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#6dff9c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, prr * 0.7, prr * 0.25, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      // a faint trail of green light behind it
      if (dt > 0 && !e.targeted && Math.random() < 0.6 && this.particles.length < 700) {
        this.particles.push({ kind: 'glow', x: p.x + CK.rand(-p.mon * 0.2, p.mon * 0.2), y: p.y - p.mon * 0.1, vx: 0, vy: -20, life: 0, max: 0.6, size: Math.max(3, p.mon * 0.05), color: '#5dffa0', drag: 1, grav: 0, alpha: 0.4 });
      }
      var appear = CK.clamp((age - 0.08) / 0.45, 0, 1);
      if (appear <= 0) continue;
      var pop = E.outBack(appear);
      var spring = Math.exp(-age * 5) * Math.cos(age * 16);
      var sy = (1 + spring * 0.28) * pop, sx = (1 - spring * 0.2) * pop;
      var breathe = Math.sin(age * 3.2 + e.variant.phase) * 0.03;
      sy *= 1 + breathe; sx *= 1 - breathe;
      if (e.laughT > 0 && !e.targeted) { var bb = Math.abs(Math.sin(age * 18)) * 0.08; sy *= 1 + bb; sx *= 1 - bb * 0.6; }
      if (e.targeted) { var tk = Math.sin(age * 40) * 0.05; sx *= 1 + tk; sy *= 1 - tk; }
      if (e.dive > 0) { sy *= 1 + e.dive * 0.25; sx *= 1 - e.dive * 0.12; }
      var cardIn = E.outCubic(CK.clamp((age - 0.2) / 0.4, 0, 1));
      var swing = 0.4 * Math.sin(age * 5.5) * Math.exp(-age * 2.2) + 0.05 * Math.sin(age * 1.8 + e.variant.phase);
      if (e.laughT > 0) swing += Math.sin(age * 16) * 0.05;
      var mood = e.targeted ? 'alarm' : (e.laughT > 0 || e.dive > 0 ? 'laugh' : 'idle');
      var blinkPh = (age * 0.31 + e.variant.phase) % 1;
      var blink = blinkPh < 0.035 ? Math.sin(blinkPh / 0.035 * Math.PI) * 0.7 : 0;
      var look = CK.clamp((this.W / 2 - p.x) / (this.W / 2), -1, 1) * 0.5 + Math.sin(age * 0.7) * 0.3;
      var mo = { t: age, size: p.mon, mood: mood, variant: e.variant, sx: sx, sy: sy, look: look, blink: blink, pulse: pulse, leanX: Math.cos(age * 0.9 + e.variant.phase) };
      if (!this.useGLMon) CK.drawMonsterBack(ctx, p.x, p.y, mo);
      var grip = null;
      if (cardIn > 0) {
        var dy0 = -(1 - cardIn) * p.cardH * 0.4;
        ctx.save();
        ctx.globalAlpha = cardIn;
        ctx.translate(p.x, p.cardY + dy0);
        ctx.rotate(swing);
        this.drawNoteCard(ctx, -p.cardW / 2, 0, p.cardW, e.note, e.hand, e.targeted ? (0.5 + 0.5 * Math.sin(this.time * 30)) : 0);
        ctx.restore();
        var cs = Math.cos(swing), sn = Math.sin(swing), hw = p.cardW * 0.36;
        grip = [{ x: p.x - hw * cs, y: p.cardY + dy0 - hw * sn + 2 }, { x: p.x + hw * cs, y: p.cardY + dy0 + hw * sn + 2 }];
        if (e.tutorial && !e.targeted && cardIn >= 1) this._callouts.push({ p: p, hand: e.hand });
      }
      mo.grip = grip;
      if (this.useGLMon) {
        var pop2 = Math.max(0.01, pop);
        this.glMon.add({ x: p.x, y: p.y, size: p.mon * pop2, sx: sx / pop2, sy: sy / pop2, mood: mood, blink: blink, look: look, t: age, variant: e.variant, grip: grip, pulse: pulse, fade: 1 });
        this._orbitRing(ctx, p.x, p.y, p.mon * pop2, age, e.variant.phase, e.targeted);
        if (grip) this._gripFingers(ctx, grip, p.mon);
      } else CK.drawMonsterFront(ctx, p.x, p.y, mo);
      if (e.laughT > 0 && !e.targeted && e.laughText) this._laughText(ctx, e, p);
    }
  };

  /** Glowing ring orbiting the monster; its back half passes behind the body. */
  Scene.prototype._orbitRing = function (ctx, x, y, size, t, phase, alarm) {
    if (size < 6) return;
    var rx = size * 0.98, ry = size * 0.26, tilt = -0.22 + Math.sin(t * 0.6 + phase) * 0.05, body = size * 0.47;
    var col = alarm ? '255,120,140' : '120,255,190', pulse = this.beat.pulse || 0;
    var lw = Math.max(1.5, size * 0.03);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var arc = function (a0, a1, alpha, w) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      ctx.strokeStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, a0, a1); ctx.stroke();
      ctx.restore();
    };
    // back half, hidden behind the body
    ctx.save();
    ctx.beginPath(); ctx.rect(x - rx * 1.5, y - rx, rx * 3, rx * 2); ctx.arc(x, y + size * 0.02, body, 0, TAU);
    ctx.clip('evenodd');
    arc(Math.PI, TAU, 0.18, lw * 3.5); arc(Math.PI, TAU, 0.55, lw);
    ctx.restore();
    // front half
    arc(0, Math.PI, 0.2 + pulse * 0.1, lw * 3.5); arc(0, Math.PI, 0.85, lw);
    // beads riding the ring
    for (var i = 0; i < 3; i++) {
      var a = t * 1.6 + phase + i * TAU / 3, ca = Math.cos(a), sa = Math.sin(a);
      if (sa < 0 && Math.hypot(ca * rx, sa * ry) < body * 1.05) continue;
      var bx = x + ca * rx * Math.cos(tilt) - sa * ry * Math.sin(tilt), by = y + ca * rx * Math.sin(tilt) + sa * ry * Math.cos(tilt);
      var gs = size * (sa > 0 ? 0.16 : 0.1);
      ctx.globalAlpha = sa > 0 ? 1 : 0.5;
      ctx.drawImage(CK.glowSprite(alarm ? '#ff7f95' : '#8affc8'), bx - gs / 2, by - gs / 2, gs, gs);
    }
    ctx.restore();
  };

  /** Little green fingers curling over the card's top corners (the 3D arms are behind the card). */
  Scene.prototype._gripFingers = function (ctx, grip, mon) {
    var r = mon * 0.035;
    ctx.save();
    for (var g = 0; g < 2; g++) {
      for (var f = -1; f <= 1; f++) {
        var x = grip[g].x + f * r * 1.7, y = grip[g].y + r * 0.6;
        var gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r * 1.1);
        gr.addColorStop(0, '#b9ffc0'); gr.addColorStop(0.6, '#43e07a'); gr.addColorStop(1, '#1f8a4a');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.95, r * 1.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(8,40,20,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
  };

  Scene.prototype._laughText = function (ctx, e, p) {
    var k = 1.1 - e.laughT;
    var size = Math.round(p.mon * 0.26);
    ctx.save();
    ctx.font = size + 'px "Jersey 10", Outfit, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var tw = ctx.measureText(e.laughText).width;
    var x = p.x + p.mon * 0.45, y = p.y - p.mon * 0.55;
    if (x + tw > this.W - 8) x = p.x - p.mon * 0.45 - tw;
    var fade = e.laughT < 0.25 ? e.laughT / 0.25 : 1;
    for (var i = 0; i < e.laughText.length; i++) {
      var ch = e.laughText[i];
      var li = CK.clamp((k - i * 0.035) / 0.18, 0, 1);
      if (li <= 0) break;
      var bob = Math.sin(this.time * 14 + i * 0.8) * size * 0.08;
      ctx.globalAlpha = fade * li;
      ctx.save();
      ctx.translate(x, y + bob - (1 - E.outBack(li)) * size * 0.6);
      ctx.fillStyle = 'rgba(10,30,15,0.8)'; ctx.fillText(ch, 2, 2);
      ctx.fillStyle = '#c8ff8a'; ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += ctx.measureText(ch).width;
    }
    ctx.restore();
  };

  Scene.prototype._drawCallout = function (ctx, p, hand) {
    var fs = Math.round(CK.clamp(this.W * 0.016, 13, 19));
    var lines = ['Play this note on', 'your real piano!', hand === 'R' ? '(right hand)' : '(left hand)'];
    ctx.save();
    ctx.font = '700 ' + fs + 'px Outfit, system-ui, sans-serif';
    var w = 0; lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); });
    w += fs * 1.4;
    var h = fs * 1.3 * lines.length + fs * 0.8;
    var right = p.x + p.cardW / 2 + w + 24 < this.W;
    var bx = right ? p.x + p.cardW / 2 + 18 : p.x - p.cardW / 2 - 18 - w;
    var by = p.cardY + p.cardH * 0.5 - h / 2 + Math.sin(this.time * 4) * 3;
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16;
    CK.roundRect(ctx, bx, by, w, h, fs * 0.6);
    ctx.fillStyle = '#fff6d6'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    var ay = by + h / 2;
    if (right) { ctx.moveTo(bx, ay - 8); ctx.lineTo(bx - 10, ay); ctx.lineTo(bx, ay + 8); }
    else { ctx.moveTo(bx + w, ay - 8); ctx.lineTo(bx + w + 10, ay); ctx.lineTo(bx + w, ay + 8); }
    ctx.fill();
    ctx.fillStyle = '#20183f'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    lines.forEach(function (l, i) {
      if (i === 2) { ctx.fillStyle = hand === 'R' ? '#0a7fa3' : '#b0278a'; ctx.font = '600 ' + Math.round(fs * 0.85) + 'px Outfit, system-ui, sans-serif'; }
      ctx.fillText(l, bx + w / 2, by + fs * 0.45 + i * fs * 1.3);
    });
    ctx.restore();
  };

  Scene.prototype._drawCards = function (ctx, dt) {
    for (var i = this.cards.length - 1; i >= 0; i--) {
      var c = this.cards[i];
      c.life += dt;
      if (c.life > 0.7) { this.cards.splice(i, 1); continue; }
      c.vy += 900 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
      ctx.save();
      ctx.globalAlpha = 1 - c.life / 0.7;
      ctx.translate(c.x + c.w / 2, c.y + c.w * 0.66);
      ctx.rotate(c.rot);
      ctx.scale(Math.max(0.05, Math.abs(Math.cos(c.life * 9))), 1);
      this.drawNoteCard(ctx, -c.w / 2, -c.w * 0.66, c.w, c.note, c.hand, 1);
      ctx.restore();
    }
  };

  /** Flash card: the note on a staff (treble = right hand, bass = left hand). */
  Scene.prototype.drawNoteCard = function (ctx, x, y, w, note, hand, highlight) {
    var h = w * 1.32, col = HAND_COLOR[hand], rgb = HAND_COLOR_RGB[hand];
    var r = w * 0.13;
    ctx.save();
    ctx.shadowColor = rgba(rgb, 0.7); ctx.shadowBlur = 14 + highlight * 22;
    CK.roundRect(ctx, x, y, w, h, r);
    var bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, 'rgba(24,30,72,0.96)'); bg.addColorStop(1, 'rgba(8,10,30,0.96)');
    ctx.fillStyle = bg; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, w * 0.03);
    ctx.strokeStyle = highlight > 0 ? '#ffffff' : col; ctx.stroke();
    if (highlight > 0) { ctx.fillStyle = rgba(rgb, (highlight * 0.35).toFixed(3)); ctx.fill(); }
    ctx.save(); ctx.clip();
    var shg = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.5);
    shg.addColorStop(0, 'rgba(255,255,255,0.12)'); shg.addColorStop(0.5, 'rgba(255,255,255,0.02)'); shg.addColorStop(0.51, 'rgba(255,255,255,0)');
    ctx.fillStyle = shg; ctx.fillRect(x, y, w, h);
    ctx.restore();

    var hb = w * 0.2;
    ctx.fillStyle = col;
    CK.roundRect(ctx, x + w * 0.07, y + w * 0.07, hb * 1.9, hb, hb * 0.5); ctx.fill();
    ctx.fillStyle = '#0a0d24';
    ctx.font = '800 ' + Math.round(hb * 0.62) + 'px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hand === 'R' ? 'R.H.' : 'L.H.', x + w * 0.07 + hb * 0.95, y + w * 0.07 + hb * 0.54);

    var clef = hand === 'R' ? 'treble' : 'bass';
    var sp = w * 0.082;
    var staffL = x + w * 0.08, staffR = x + w * 0.92;
    var bottom = y + w * 0.36 + sp * 5.2;
    ctx.strokeStyle = 'rgba(220,230,255,0.85)'; ctx.lineWidth = Math.max(1, w * 0.012);
    for (var i = 0; i < 5; i++) {
      var ly = bottom - i * sp;
      ctx.beginPath(); ctx.moveTo(staffL, ly); ctx.lineTo(staffR, ly); ctx.stroke();
    }
    ctx.fillStyle = '#e6ecff'; ctx.strokeStyle = '#e6ecff';
    if (clef === 'treble') drawTreble(ctx, staffL + sp * 1.25, bottom - sp, sp);
    else drawBass(ctx, staffL + sp * 0.75, bottom - sp * 3, sp);
    var pos = T.staffPos(note, clef);
    var nx = x + w * 0.64, ny = bottom - pos * sp / 2;
    ctx.strokeStyle = 'rgba(220,230,255,0.85)';
    var lw2 = sp * 1.15;
    for (var lp = -2; lp >= pos; lp -= 2) { var yy = bottom - lp * sp / 2; ctx.beginPath(); ctx.moveTo(nx - lw2, yy); ctx.lineTo(nx + lw2, yy); ctx.stroke(); }
    for (lp = 10; lp <= pos; lp += 2) { var yy2 = bottom - lp * sp / 2; ctx.beginPath(); ctx.moveTo(nx - lw2, yy2); ctx.lineTo(nx + lw2, yy2); ctx.stroke(); }
    ctx.fillStyle = '#fff6c8';
    ctx.save(); ctx.translate(nx, ny); ctx.rotate(-0.33);
    ctx.beginPath(); ctx.ellipse(0, 0, sp * 0.72, sp * 0.5, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(0, 0, sp * 0.42, sp * 0.22, 0.9, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff6c8'; ctx.strokeStyle = '#fff6c8';
    if (note.acc) drawAccidental(ctx, nx - sp * 1.8, ny, sp, note.acc);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 ' + Math.round(w * 0.24) + 'px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(T.noteLabel(note, false), x + w / 2, y + h - w * 0.09);
    ctx.restore();
  };

  function drawTreble(ctx, x, gLineY, sp) {
    ctx.save();
    ctx.translate(x, gLineY);
    ctx.scale(sp, sp);
    ctx.lineWidth = 0.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0.18, 0.35);
    ctx.bezierCurveTo(-0.55, 0.35, -0.55, -0.75, 0.2, -0.78);
    ctx.bezierCurveTo(1.15, -0.8, 1.25, 0.95, 0.05, 1.0);
    ctx.bezierCurveTo(-1.2, 1.02, -1.35, -0.5, -0.55, -1.35);
    ctx.bezierCurveTo(0.15, -2.1, 0.85, -2.6, 0.7, -3.35);
    ctx.bezierCurveTo(0.55, -3.95, -0.25, -3.6, -0.15, -2.6);
    ctx.lineTo(0.38, 2.0);
    ctx.bezierCurveTo(0.48, 2.75, -0.45, 2.85, -0.55, 2.25);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(-0.33, 2.2, 0.28, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawBass(ctx, x, fLineY, sp) {
    ctx.save();
    ctx.translate(x, fLineY);
    ctx.scale(sp, sp);
    ctx.beginPath(); ctx.arc(0, 0.05, 0.32, 0, TAU); ctx.fill();
    ctx.lineWidth = 0.24; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.15, -0.1);
    ctx.bezierCurveTo(0.1, -1.1, 1.65, -1.15, 1.6, 0.05);
    ctx.bezierCurveTo(1.55, 1.25, 0.5, 2.0, -0.6, 2.45);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(2.15, -0.5, 0.17, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(2.15, 0.5, 0.17, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawAccidental(ctx, x, y, sp, acc) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(sp, sp);
    ctx.lineCap = 'butt';
    if (acc > 0) {
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(-0.22, -1.25); ctx.lineTo(-0.22, 1.35); ctx.moveTo(0.22, -1.35); ctx.lineTo(0.22, 1.25); ctx.stroke();
      ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(-0.48, -0.3); ctx.lineTo(0.48, -0.55); ctx.moveTo(-0.48, 0.55); ctx.lineTo(0.48, 0.3); ctx.stroke();
    } else if (acc < 0) {
      ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(-0.3, -1.8); ctx.lineTo(-0.3, 0.55); ctx.stroke();
      ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(-0.3, 0.55); ctx.bezierCurveTo(0.9, -0.1, 0.55, -0.85, -0.3, -0.25); ctx.stroke();
    } else {
      ctx.lineWidth = 0.12;
      ctx.beginPath(); ctx.moveTo(-0.25, -1.3); ctx.lineTo(-0.25, 0.6); ctx.moveTo(0.25, -0.6); ctx.lineTo(0.25, 1.3); ctx.stroke();
      ctx.lineWidth = 0.28;
      ctx.beginPath(); ctx.moveTo(-0.25, -0.35); ctx.lineTo(0.25, -0.5); ctx.moveTo(-0.25, 0.5); ctx.lineTo(0.25, 0.35); ctx.stroke();
    }
    ctx.restore();
  }
  CK.drawTreble = drawTreble;
  CK.drawBass = drawBass;

  /* ------------------------------------------------------------------ */
  /* Title decoration                                                     */
  /* ------------------------------------------------------------------ */
  Scene.prototype._drawTitleMonsters = function (ctx) {
    var t = this.time, W = this.W, H = this.H;
    var spots = this.portrait
      ? [[0.16, 0.6, 0.15, 0.2], [0.84, 0.64, 0.11, 2.3]]
      : [[0.12, 0.38, 0.17, 0.2], [0.87, 0.36, 0.13, 2.3]];
    for (var i = 0; i < spots.length; i++) {
      var sp = spots[i], size = Math.min(W, H) * sp[2];
      var laugh = Math.sin(t * 0.7 + sp[3]) > 0.8;
      var x = sp[0] * W, y = sp[1] * H + Math.sin(t * 1.2 + sp[3]) * 10;
      var breathe = Math.sin(t * 3 + sp[3]) * 0.03;
      var mo = { t: t + sp[3], size: size, mood: laugh ? 'laugh' : 'idle', variant: { base: '#43e07a', phase: sp[3], wide: 1 }, sx: 1 - breathe, sy: 1 + breathe, look: Math.sin(t * 0.5 + i), blink: 0, pulse: this.beat.pulse || 0 };
      if (this.useGLMon) {
        this.glMon.add({ x: x, y: y, size: size, sx: mo.sx, sy: mo.sy, mood: mo.mood, blink: (Math.sin(t * 0.9 + i * 2) > 0.985) ? 1 : 0, look: mo.look, t: mo.t, variant: { base: '#43e07a', phase: sp[3], spikes: true }, grip: null, pulse: mo.pulse, fade: 1 });
        this._orbitRing(ctx, x, y, size, mo.t, sp[3]);
      } else { CK.drawMonsterBack(ctx, x, y, mo); CK.drawMonsterFront(ctx, x, y, mo); }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Shots, charges, particles, text                                      */
  /* ------------------------------------------------------------------ */
  Scene.prototype._drawCharges = function (ctx, game) {
    var shots = game.shots;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      if (s.phase !== 'charge') continue;
      var o = game.shooterPos(s);
      var k = CK.clamp(s.t / s.charge, 0, 1);
      var r = (14 + 46 * k) * (this.layout.Upx / 60 + 0.4);
      ctx.globalAlpha = 0.5 + k * 0.5;
      ctx.drawImage(CK.glowSprite(s.color), o.x - r, o.y - r, r * 2, r * 2);
      for (var j = 0; j < 8; j++) {
        var a = j / 8 * TAU + this.time * 7, d = r * 1.5 * (1 - k) + r * 0.25;
        var ps = 6 + 4 * k;
        ctx.drawImage(CK.glowSprite('#ffffff'), o.x + Math.cos(a) * d - ps / 2, o.y + Math.sin(a) * d - ps / 2, ps, ps);
      }
      ctx.globalAlpha = k * 0.6;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(o.x, o.y, r * (1.2 - k * 0.6), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  };

  Scene.prototype._drawBolts = function (ctx, game) {
    if (!game) return;
    var shots = game.shots;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      if (s.phase !== 'fly') continue;
      var k = CK.clamp(s.t / s.flight, 0, 1);
      var ke = E.inQuad(k);
      var hx = CK.lerp(s.x0, s.x1, ke), hy = CK.lerp(s.y0, s.y1, ke);
      var tk = Math.max(0, ke - 0.45);
      var tx = CK.lerp(s.x0, s.x1, tk), ty = CK.lerp(s.y0, s.y1, tk);
      var wd = Math.max(5, this.layout.Upx * 0.2);
      ctx.strokeStyle = s.color; ctx.globalAlpha = 0.35; ctx.lineWidth = wd * 3.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.globalAlpha = 0.85; ctx.lineWidth = wd * 1.4;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = wd * 0.5;
      ctx.beginPath(); ctx.moveTo(CK.lerp(tx, hx, 0.3), CK.lerp(ty, hy, 0.3)); ctx.lineTo(hx, hy); ctx.stroke();
      var gs = wd * 9;
      ctx.drawImage(CK.glowSprite(s.color), hx - gs / 2, hy - gs / 2, gs, gs);
      if (Math.random() < 0.8 && this.particles.length < 700) this.particles.push({ kind: 'glow', x: hx, y: hy, vx: CK.rand(-40, 40), vy: CK.rand(-20, 60), life: 0, max: 0.35, size: CK.rand(4, 8), color: s.color, drag: 3, grav: 0 });
    }
    ctx.restore();
  };

  Scene.prototype._drawParticles = function (ctx, dt) {
    var ps = this.particles;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i];
      p.life += dt;
      var k = p.life / p.max;
      if (k >= 1) { ps.splice(i, 1); continue; }
      if (p.kind === 'ring') {
        var r = CK.lerp(p.r0, p.r1, E.outCubic(k));
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = p.color; ctx.globalAlpha = (1 - k) * 0.9; ctx.lineWidth = Math.max(1, p.width * (1 - k) * 2);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * (p.flat || 1), 0, 0, TAU); ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.kind === 'smoke') {
        p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        var sr = p.size * (0.6 + k * 1.6);
        ctx.save();
        ctx.globalAlpha = 0.32 * Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.05)) * (1 - k);
        var smg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sr);
        smg.addColorStop(0, p.color); smg.addColorStop(1, 'rgba(40,40,50,0)');
        ctx.fillStyle = smg; ctx.beginPath(); ctx.arc(p.x, p.y, sr, 0, TAU); ctx.fill();
        ctx.restore();
        continue;
      }
      p.vx *= Math.exp(-p.drag * dt); p.vy *= Math.exp(-p.drag * dt);
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'goo') {
        var spd = Math.hypot(p.vx, p.vy), ang = Math.atan2(p.vy, p.vx);
        var len = p.size * (1 + Math.min(2.5, spd / 260));
        ctx.save();
        ctx.globalAlpha = 1 - k * k;
        ctx.translate(p.x, p.y); ctx.rotate(ang);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(0, 0, len, p.size * 0.7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.ellipse(len * 0.25, -p.size * 0.25, len * 0.3, p.size * 0.18, 0, 0, TAU); ctx.fill();
        ctx.restore();
      } else if (p.kind === 'shard') {
        p.rot += p.vr * dt;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        var ss = p.size * (1 - k * 0.5);
        ctx.fillRect(-ss / 2, -ss / 2, ss, ss);
        ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, p.size * 0.5); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        ctx.restore();
      } else {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * (1 - k) * (p.alpha || 1);
        var gs = p.size * 2.6 * (1 - k * 0.4);
        ctx.drawImage(CK.glowSprite(p.color), p.x - gs / 2, p.y - gs / 2, gs, gs);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  };

  Scene.prototype._drawTexts = function (ctx, dt) {
    var ts = this.texts;
    for (var i = ts.length - 1; i >= 0; i--) {
      var t = ts[i];
      t.life += dt;
      var k = t.life / t.max;
      if (k >= 1) { ts.splice(i, 1); continue; }
      var ls = CK.Motion.spring(t.life, 'LAND');
      var y = t.y + (1 - ls) * 36 - t.life * 22;
      var sc = 0.96 + 0.04 * ls;
      var outT = t.life - (t.max - 0.18);
      ctx.save();
      ctx.globalAlpha = CK.clamp(t.life / 0.12, 0, 1) * (outT > 0 ? 1 - outT / 0.18 : 1);
      ctx.translate(t.x, y); ctx.scale(sc, sc);
      ctx.font = Math.round(t.size * 1.35) + 'px "Jersey 10", Outfit, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = t.color; ctx.shadowBlur = 18;
      ctx.fillStyle = t.color; ctx.fillText(t.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(t.text, 0, -1);
      ctx.restore();
    }
  };

  /** Kinetic banners: letters cascade in with overshoot, then lift away. */
  Scene.prototype._drawBanners = function (ctx) {
    var W = this.W, H = this.H, now = this.time;
    for (var bi = this.banners.length - 1; bi >= 0; bi--) {
      var b = this.banners[bi];
      var age = now - b.born;
      var size = Math.round(CK.clamp(Math.min(W * 0.1, H * 0.15), 40, 124) * (b.scale || 1));
      var text = b.text;
      var autoLeave = b.hold + text.length * 0.045 + 0.4;
      var leaveAge = b.leave != null ? now - b.leave : (!b.sticky && age > autoLeave ? age - autoLeave : -1);
      if (leaveAge > 0.4) { this.banners.splice(bi, 1); continue; }
      ctx.save();
      if (b.classic) size = Math.round(size * 0.62);
      ctx.font = b.classic ? '800 ' + size + 'px Cinzel, Georgia, serif' : size + 'px "Jersey 10", Outfit, sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      var total = ctx.measureText(text).width + (text.length - 1) * size * 0.04;
      var x = W / 2 - total / 2, y = b.y != null ? b.y : H * 0.3;
      if (b.kicker) {
        // small spaced kicker with gold rules either side ("—— LEVEL 1 ——")
        var kt = age - 0.05, ka = CK.clamp(kt / 0.12, 0, 1) * (leaveAge > 0 ? 1 - CK.clamp(leaveAge / 0.18, 0, 1) : 1);
        if (ka > 0) {
          var ks = CK.Motion.spring(kt, 'SNAP');
          ctx.save();
          ctx.globalAlpha = ka;
          var kf = Math.round(size * 0.36);
          ctx.font = '700 ' + kf + 'px Outfit, system-ui, sans-serif';
          var label = b.kicker.split('').join(String.fromCharCode(8202, 8202));
          var kw = ctx.measureText(label).width, ky = y - size * 0.95 + (1 - ks) * 20;
          ctx.textAlign = 'center'; ctx.fillStyle = '#e8f1ff';
          ctx.shadowColor = 'rgba(120,200,255,0.7)'; ctx.shadowBlur = 10;
          ctx.fillText(label, W / 2, ky);
          ctx.shadowBlur = 0;
          var rl = size * 1.2 * ks;
          var gl = ctx.createLinearGradient(W / 2 - kw / 2 - rl - 12, 0, W / 2 - kw / 2 - 12, 0);
          gl.addColorStop(0, 'rgba(255,207,90,0)'); gl.addColorStop(1, 'rgba(255,207,90,0.95)');
          ctx.fillStyle = gl; ctx.fillRect(W / 2 - kw / 2 - rl - 12, ky - 1, rl, 2);
          var gr = ctx.createLinearGradient(W / 2 + kw / 2 + 12, 0, W / 2 + kw / 2 + rl + 12, 0);
          gr.addColorStop(0, 'rgba(255,207,90,0.95)'); gr.addColorStop(1, 'rgba(255,207,90,0)');
          ctx.fillStyle = gr; ctx.fillRect(W / 2 + kw / 2 + 12, ky - 1, rl, 2);
          ctx.restore();
          ctx.font = b.classic ? '800 ' + size + 'px Cinzel, Georgia, serif' : size + 'px "Jersey 10", Outfit, sans-serif';
          ctx.textAlign = 'left';
        }
      }
      for (var i = 0; i < text.length; i++) {
        var ch = text[i], cw = ctx.measureText(ch).width;
        var lt = age - i * 0.035;
        var ls = CK.Motion.spring(lt, 'LAND');
        var la = CK.clamp(lt / 0.12, 0, 1);
        var out = leaveAge > 0 ? CK.clamp((leaveAge - i * 0.012) / 0.18, 0, 1) : 0;
        if (la > 0 && out < 1) {
          var sc = (0.96 + 0.04 * ls) * (0.6 + 0.4 * ls) * (1 + out * 0.08);
          ctx.save();
          ctx.globalAlpha = la * (1 - out);
          ctx.translate(x + cw / 2, y + (1 - ls) * 38 - out * 14);
          ctx.scale(sc, sc);
          ctx.shadowColor = b.glow || 'rgba(80,220,255,0.9)'; ctx.shadowBlur = 28;
          ctx.fillStyle = b.color || '#ffffff';
          ctx.fillText(ch, -cw / 2, 0);
          ctx.restore();
        }
        x += cw + size * 0.04;
      }
      var subT = age - 0.3 - text.length * 0.035;
      var subA = CK.clamp(subT / 0.12, 0, 1) * (leaveAge > 0 ? 1 - CK.clamp(leaveAge / 0.18, 0, 1) : 1);
      var subS = CK.Motion.spring(subT, 'SETTLE');
      if (b.sub && subA > 0) {
        ctx.globalAlpha = subA;
        ctx.textAlign = 'center';
        ctx.font = '600 ' + Math.round(size * (b.classic ? 0.34 : 0.26)) + 'px Outfit, system-ui, sans-serif';
        ctx.fillStyle = b.classic ? '#ffd98a' : '#dfe6ff';
        ctx.fillText(b.sub, W / 2, y + size * (b.classic ? 0.85 : 0.62) + (1 - subS) * 32);
        if (b.sub2) {
          ctx.font = '600 ' + Math.round(size * (b.classic ? 0.27 : 0.21)) + 'px Outfit, system-ui, sans-serif';
          ctx.fillStyle = b.classic ? '#a9c4ec' : '#ffd98a';
          ctx.fillText(b.sub2, W / 2, y + size * (b.classic ? 1.3 : 0.97) + (1 - CK.Motion.spring(subT - 0.08, 'SETTLE')) * 32);
        }
        if (b.sub3) {
          ctx.font = '500 ' + Math.round(size * 0.16) + 'px Outfit, system-ui, sans-serif';
          ctx.fillStyle = '#a9c4ec';
          ctx.fillText(b.sub3, W / 2, y + size * 1.25 + (1 - CK.Motion.spring(subT - 0.16, 'SETTLE')) * 32);
        }
      }
      ctx.restore();
    }
  };

  CK.Scene = Scene;
  CK.whiteIndex = whiteIndex;
})();
