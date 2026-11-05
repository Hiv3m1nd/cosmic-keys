/* Cosmic Keys — game state machine and rules */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;
  var audio = CK.audio;

  var MAX_HEALTH = 3;
  var LAUGHS = ['HEH HEH!', 'MWA-HA-HA!', 'HEE HEE!', 'HA HA HA!', 'HEH!', 'NYEH HEH!'];
  var GREENS = ['#43e07a', '#4ee88f', '#5bd96a', '#3fdc9c', '#6be36a'];

  function Game(scene, ui) {
    this.scene = scene;
    this.ui = ui;
    this.state = 'title';
    this.enemies = [];
    this.shots = [];
    this.handRigs = [];
    this.guns = [];
    this.banner = null;
    this.levelIdx = 0;
    this.health = MAX_HEALTH;
    this.rankIdx = -1;
    this.nextId = 1;
    this.shieldHit = 0;
    this.lastLaugh = -10;
    this.clock = 0;
    var self = this;
    CK.pitch.on('note', function (ev) { self.onNote(ev); });
  }

  Game.prototype.setSettings = function (s) { this.settings = s; };

  /* ------------------------------------------------------------------ */
  /* Flow                                                                 */
  /* ------------------------------------------------------------------ */
  Game.prototype.newGame = function () {
    this.tutorialDone = this._playedBefore;
    this._playedBefore = true;
    this.levelIdx = 0;
    this.health = MAX_HEALTH;
    this.rankIdx = -1;
    this.startLevel(0);
  };

  Game.prototype.retryLevel = function () {
    this.health = MAX_HEALTH;
    this.startLevel(this.levelIdx);
  };

  /** Restart the current level with the shields the player started it with. */
  Game.prototype.retryLevelKeepHealth = function () {
    this.health = this.levelStartHealth || MAX_HEALTH;
    this.startLevel(this.levelIdx);
  };

  Game.prototype.startLevel = function (idx) {
    this.levelIdx = idx;
    this.levelStartHealth = this.health;
    this._transitionShown = false; this._sinkSfx = false;
    this.plan = CK.buildLevelPlan(this.settings, idx);
    this.gen = new CK.NoteGenerator(this.plan);
    this.enemies = []; this.shots = [];
    this.spawned = 0; this.resolved = 0; this.killed = 0;
    this.lastSpawnT = -99; this.lastResolveT = 0; this.playT = 0;
    this.stateT = 0;
    this.state = 'intro';
    this.shieldHit = 0;
    this.scene.pianoOffset = 1;
    this.scene.setFocus(this.plan.focusLo, this.plan.focusHi, this.plan.free);
    this.scene.syncDamage(MAX_HEALTH - this.health);
    this.scene.cameraSet(1.12, this.scene.W / 2, this.scene.H * 0.55);
    this.scene.cameraHome('GLIDE');
    this.scene.setTheme(idx);
    this.scene.clearBanners(true);
    this._bannerShown = false; this._landed = false;
    this._crack0 = this._crack1 = this._crack2 = false; this._camPush = this._camHome = false;
    this._firstHit = false;
    this.freeze = 0;
    this._buildShooters();
    CK.pitch.listening = false;
    audio.stopCue();
    audio.startMusic('game', idx);
    audio.sfx('whoosh', { dur: 1.0, up: true });
    this.ui.showHud(true);
    this._hud();
  };

  Game.prototype._buildShooters = function () {
    var plan = this.plan, scene = this.scene;
    this.handRigs = [];
    this.guns = [];
    if (plan.free) {
      var seen = {};
      plan.hands.forEach(function (h) {
        plan.notes[h].forEach(function (n) { seen[n.midi] = h; });
      });
      var self = this;
      Object.keys(seen).map(Number).sort(function (a, b) { return a - b; }).forEach(function (m) {
        self.guns.push({ midi: m, hand: seen[m], pop: 0, charge: 0, recoil: 0, aim: 0, tipX: 0, tipY: 0 });
      });
      return;
    }
    plan.hands.forEach(function (h) {
      var homes = plan.home[h].map(function (n) { return n.midi; });
      var fingers = [null];
      for (var f = 1; f <= 5; f++) fingers.push({ curl: 0, press: 0, charge: 0, slideTo: null, slide: 0, wig: 0 });
      this.handRigs.push({
        hand: h, homes: homes,
        geom: scene.handGeom(h, homes),
        pose: { visible: false, onKeys: 1, x: 0, dx: 0, fwd: 0, lift: 0, roll: 0, yaw: 0, pitch: 0, s: 1, arm: null, fingers: fingers }
      });
    }, this);
  };

  Game.prototype.rigFor = function (hand) {
    for (var i = 0; i < this.handRigs.length; i++) if (this.handRigs[i].hand === hand) return this.handRigs[i];
    return null;
  };
  Game.prototype.gunFor = function (midi) {
    for (var i = 0; i < this.guns.length; i++) if (this.guns[i].midi === midi) return this.guns[i];
    return null;
  };

  Game.prototype.pause = function () {
    if (this.state !== 'playing' && this.state !== 'intro') return false;
    this.prevState = this.state;
    this.state = 'paused';
    CK.pitch.listening = false;
    audio.setMusicPaused(true);
    this.ui.showPause(true);
    return true;
  };
  Game.prototype.resume = function () {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    audio.setMusicPaused(false);
    if (this.state === 'playing') { CK.pitch.listening = true; CK.pitch.resetGate(); }
    this.ui.showPause(false);
  };
  Game.prototype.quitToTitle = function () {
    this.state = 'title';
    this.enemies = []; this.shots = [];
    this.handRigs = []; this.guns = [];
    this.banner = null;
    this.scene.clearBanners(true);
    this.scene.setTheme(null);
    CK.pitch.listening = false;
    audio.setMusicPaused(false);
    audio.stopCue();
    this.scene.pianoOffset = 1;
    this.ui.showHud(false);
    audio.startMusic('title');
  };

  /* ------------------------------------------------------------------ */
  /* Update                                                               */
  /* ------------------------------------------------------------------ */
  Game.prototype.update = function (dt) {
    // Hit-stop: a few frames of near-freeze on impacts give hits weight.
    if (this.freeze > 0) { this.freeze -= dt; dt *= 0.06; }
    this.renderDt = dt;
    this.clock += dt;
    if (this.state === 'paused' || this.state === 'title') return;
    this.stateT += dt;
    this.shieldHit = Math.max(0, this.shieldHit - dt * 1.8);
    // Hand geometry follows the piano (it rises and sinks).
    for (var i = 0; i < this.handRigs.length; i++) {
      var rig = this.handRigs[i];
      rig.geom = this.scene.handGeom(rig.hand, rig.homes);
    }
    switch (this.state) {
      case 'intro': this._updateIntro(dt); break;
      case 'playing': this._updatePlaying(dt); break;
      case 'clear': this._updateClear(dt); break;
      case 'gameover': this._updateGameOver(dt); break;
    }
    this._updateShots(dt);
    this._updateFingers(dt);
  };

  Game.prototype._introBanner = function (t) {
    var plan = this.plan;
    var handsText = plan.hands.length === 2 ? 'Both hands' : (plan.hands[0] === 'R' ? 'Right hand' : 'Left hand');
    var notesText;
    if (plan.free) {
      notesText = 'Ray guns ready · ' + plan.hands.map(function (h) {
        var l = plan.notes[h];
        return (h === 'R' ? 'R.H. ' : 'L.H. ') + T.midiLabel(l[0].midi, true) + '–' + T.midiLabel(l[l.length - 1].midi, true);
      }).join('  ·  ');
    } else {
      var sets = plan.hands.map(function (h) { return plan.home[h].map(function (n) { return T.noteLabel(n); }).join(' '); });
      notesText = 'Available Notes: ' + (sets.length === 2 && sets[0] === sets[1] ? sets[0] : plan.hands.map(function (h, i) { return (h === 'R' ? 'R.H. ' : 'L.H. ') + sets[i]; }).join('   ·   '));
    }
    if (!this._bannerShown && t >= 0.25) {
      this._bannerShown = true;
      this.scene.showBanner({
        kicker: 'LEVEL ' + (this.levelIdx + 1),
        text: plan.title, classic: true,
        sub: notesText,
        sub2: handsText + '  ·  ' + plan.intervalText,
        y: this.scene.H * 0.22, sticky: true, color: '#fff1c4', glow: 'rgba(255,190,80,0.9)'
      });
    }
    if (t >= (plan.free ? 2.4 : 1.9) && this.scene.banners.length && this.scene.banners[0].leave == null && this.scene.banners[0].kicker) this.scene.clearBanners();
  };

  Game.prototype._updateIntro = function (dt) {
    var t = this.stateT, scene = this.scene, plan = this.plan;
    scene.pianoOffset = 1 - CK.ease.outBackSoft(CK.seg(t, 0, 1.1));
    var goAt = plan.free ? 2.9 : 4.5;
    if (t < 4.2) this._introBanner(t);
    // the piano lands: sparkle along the rail + a little camera bump
    if (!this._landed && t > 0.78) {
      this._landed = true;
      var y0 = scene.pianoY();
      for (var sp = 0; sp < 14; sp++) scene.burst(scene.W * (sp + 0.5) / 14, y0, ['#7ff3ff', '#ffffff', '#ffd27a'], 3, 160, 5);
      scene.world.wave(scene.W / 2, y0, '#7ff3ff', 1.2);
      scene.addShake(5);
    }

    if (plan.free) {
      var n = this.guns.length;
      for (var g = 0; g < n; g++) {
        var startAt = 1.1 + (g / Math.max(1, n)) * 1.0;
        var prev = this.guns[g].pop;
        this.guns[g].pop = CK.seg(t, startAt, startAt + 0.3);
        if (prev === 0 && this.guns[g].pop > 0 && g % 2 === 0) audio.sfx('pop');
      }
    } else {
      this._animateHandsIntro(t);
    }

    if (t >= goAt) {
      this.state = 'playing';
      this.stateT = 0;
      this.scene.showBanner({ text: 'GO!', scale: 1.25, y: this.scene.H * 0.3, color: '#c8ff8a', glow: 'rgba(120,255,140,0.95)', hold: 0.25 });
      this.scene.world.wave(this.scene.W / 2, this.scene.H * 0.3, '#c8ff8a', 1.4);
      audio.sfx('go');
      CK.pitch.listening = true;
      CK.pitch.resetGate();
    }
  };

  /* Hand choreography: arms rise, the fingers interlace, palms turn outward and
   * push (crack, crack, crack!), the hands let go, wiggle and settle onto the keys.
   * Every pose value is a stack of springs retargeted at key times (motion guide §2–3),
   * so the motion overlaps and settles like real arms rather than snapping keyframes. */
  var HAND_SPRING = { z: 0.74, f: 2.5 };
  var ARM_SPRING = { z: 0.9, f: 1.6 };
  function springTrack(t, keys, field, cls, j) {
    var list = [];
    for (var i = 0; i < keys.length; i++) {
      var v = keys[i][field];
      if (v == null) continue;
      list.push({ t: keys[i].t, v: j == null ? v : v[j] });
    }
    return CK.Motion.stack(t, list, cls);
  }

  Game.prototype._introKeys = function (rig, both, mid) {
    var scene = this.scene, U = scene.layout.U, side = rig.hand === 'R' ? 1 : -1;
    var R = CK.GLHands.restWrist(scene, rig);
    var at = function (dx, dy, dz) { return [R[0] + dx, R[1] + dy, R[2] + dz]; };
    var lace = side < 0 ? 0.44 * U : 0;   // offset so the fingers of the two hands interleave
    var armDown = [0.62, -0.78, -0.12];
    if (both) {
      return [
        { t: 0, w: at(side * 1.6, -4.2, -3.4), roll: 0.5, yaw: -0.2, curl: 0.35, arm: armDown, on: 0 },
        { t: 0.2, w: at(side * 0.6, -0.7, 2.0), roll: 0.3, yaw: 0.05, curl: 0.25 },
        { t: 0.8, w: [mid + side * 1.95 * U, R[1] + 2.4, R[2] + 1.85 + lace], roll: 1.57, yaw: 1.5, curl: 0.12, arm: [0.85, -0.7, -0.3] },
        { t: 1.25, w: [mid + side * 1.95 * U, R[1] + 3.5, R[2] + 1.95 + lace], roll: -1.57, yaw: 1.5, curl: -0.42, arm: [0.5, -1, -0.22] },
        { t: 2.2, w: at(side * 0.15, -0.2, 1.5), roll: 0, yaw: 0, curl: 0.3, arm: armDown },
        { t: 2.55, w: R, on: 1 }
      ];
    }
    var cx = R[0] * 0.45;
    return [
      { t: 0, w: at(side * 1.6, -4.2, -3.4), roll: 0.5, yaw: -0.2, curl: 0.35, arm: armDown, on: 0 },
      { t: 0.2, w: [cx, R[1] - 0.3, R[2] + 2.5], roll: 0.9, yaw: 0.3, curl: 0.15, arm: [0.45, -1, -0.25] },
      { t: 0.85, curl: 0.95, roll: 1.15 },
      { t: 1.25, w: [cx, R[1] + 1.1, R[2] + 2.7], curl: -0.45, roll: 0.35 },
      { t: 2.2, w: at(side * 0.15, -0.2, 1.5), roll: 0, yaw: 0, curl: 0.3, arm: armDown },
      { t: 2.55, w: R, on: 1 }
    ];
  };

  Game.prototype._animateHandsIntro = function (t) {
    var scene = this.scene, both = this.handRigs.length === 2, self = this;
    var t0 = 0.95, lt = t - t0;
    var cracks = both ? [2.62, 2.79, 2.95] : [2.55, 2.72, 2.88];
    var pulse = 0;
    cracks.forEach(function (pt) { pulse += Math.max(0, 1 - Math.abs(t - pt) / 0.07); });
    var mid = 0;
    if (both && CK.GLHands) this.handRigs.forEach(function (r) { mid += CK.GLHands.restWrist(scene, r)[0] / 2; });
    for (var i = 0; i < this.handRigs.length; i++) {
      var rig = this.handRigs[i], pose = rig.pose;
      pose.visible = t >= t0;
      if (!scene.useGLHands || !CK.GLHands) {
        pose.onKeys = CK.ease.outCubic(CK.seg(t, t0, 2.0));
        continue;
      }
      var keys = this._introKeys(rig, both, mid);
      var R = CK.GLHands.restWrist(scene, rig);
      var w = [0, 1, 2].map(function (j) { return springTrack(lt, keys, 'w', HAND_SPRING, j); });
      pose.dx = w[0] - R[0]; pose.fwd = w[1] - R[1] + pulse * 0.26; pose.lift = w[2] - R[2];
      pose.x = 0;
      pose.roll = springTrack(lt, keys, 'roll', HAND_SPRING);
      pose.yaw = springTrack(lt, keys, 'yaw', HAND_SPRING);
      pose.arm = [0, 1, 2].map(function (j) { return springTrack(lt, keys, 'arm', ARM_SPRING, j); });
      pose.onKeys = CK.clamp(CK.ease.inOutCubic(CK.seg(lt, 2.5, 3.2)), 0, 1);
      pose.s = 1 + pulse * 0.025;
      var curl = springTrack(lt, keys, 'curl', HAND_SPRING) - pulse * 0.16;
      var wiggle = CK.seg(lt, 2.15, 2.35) * (1 - CK.seg(lt, 2.6, 3.1));
      for (var f = 1; f <= 5; f++) {
        var st = pose.fingers[f];
        st.curl = CK.clamp(curl + (f === 1 ? -0.2 * Math.max(0, curl) : 0), -0.6, 1);
        st.wig = wiggle > 0 ? Math.sin(this.clock * 24 + f * 1.4) * wiggle * 1.2 : 0;
      }
    }
    // Camera: push gently toward the hands for the crack, relax as they settle
    var centerTip = function () {
      var hx = 0, hy = 0, n = 0;
      self.handRigs.forEach(function (rig) { var tp = scene.fingertip(rig.geom, rig.pose, 3); hx += tp.x; hy += tp.y; n++; });
      return n ? { x: hx / n, y: hy / n } : { x: scene.W / 2, y: scene.H / 2 };
    };
    if (t >= cracks[0] - 0.55 && !this._camPush) {
      this._camPush = true;
      var c0 = centerTip();
      scene.cameraTo(1.07, c0.x, c0.y);
    }
    if (t >= cracks[2] + 0.35 && !this._camHome) { this._camHome = true; scene.cameraHome(); }
    // Knuckle-crack moments
    cracks.forEach(function (pt, idx) {
      if (t >= pt && !self['_crack' + idx]) {
        self['_crack' + idx] = true;
        audio.sfx('crack', { count: 3 + idx });
        var c = centerTip();
        scene.burst(c.x, c.y, ['#ffffff', '#ffe58a', '#b7f3ff'], 12, 260, 7);
        scene.ring(c.x, c.y, '#ffe58a', 6, scene.layout.Upx * 2.2, 0.35, 3);
        if (idx === 0) scene.floatText(c.x, Math.max(scene.H * 0.2, Math.min(c.y, scene.pianoY()) - scene.layout.Upx * 2.6), 'CRACK!', '#ffe58a', Math.round(CK.clamp(scene.W * 0.04, 22, 44)), 0.9);
        scene.addShake(3 + idx);
      }
    });
  };

  Game.prototype._updatePlaying = function (dt) {
    var cfg = this.plan.cfg, t = this.stateT;
    this.playT += dt;
    this._spawnLogic();

    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      e.age += dt;
      e.laughT = Math.max(0, e.laughT - dt);
      e.enterOffset *= Math.exp(-dt * 8);
      if (e.dead) continue;
      if (!e.targeted) {
        if (e.waitFirst && e.progress >= 0.45) {
          // the level's first monster waits for the student's first note
          e.progress = 0.45;
          e.hoverT += dt;
          if (e.hoverT > 4.5) { e.hoverT = 0; this._laugh(e); }
        } else if (e.progress < 1) {
          e.progress = Math.min(1, e.progress + dt / e.travel);
        } else {
          // out of time: it dives onto the keyboard
          if (!e.dive) { e.dive = 0; this._laugh(e); }
          e.dive += dt / 0.38;
          if (e.dive >= 1) { this._enemyReached(e); continue; }
        }
        if (!e.laughedOnce && e.age > 0.7) { e.laughedOnce = true; if (CK.chance(0.6)) this._laugh(e); }
      }
    }
    this.enemies = this.enemies.filter(function (e) { return !e.dead; });

    if (this.spawned >= cfg.n && this.enemies.length === 0 && this.shots.length === 0) this._levelComplete();
  };

  Game.prototype._spawnLogic = function () {
    var cfg = this.plan.cfg, t = this.playT;
    if (this.spawned >= cfg.n) return;
    var active = this.enemies.length;
    if (t < 0.8) return;
    // nothing else spawns until the level's first note has been played
    if (this.enemies.some(function (e) { return e.waitFirst && !e.dead; })) return;
    if (cfg.oneAtATime) {
      if (active === 0 && this.shots.length === 0 && t - this.lastResolveT > 0.9 && this._onBeat()) this._spawn();
      return;
    }
    var due = (active === 0 && t - this.lastResolveT > 0.6) || (active < cfg.maxActive && t - this.lastSpawnT >= cfg.gap);
    if (!due) { this._dueSince = null; return; }
    if (!this._onBeat()) return;
    // Two notes at the same moment only from level 6 on.
    if (this.levelIdx >= 5 && cfg.pairP && this.spawned + 2 <= cfg.n && active + 2 <= cfg.maxActive && CK.chance(cfg.pairP)) {
      var pair = this.gen.nextPair();
      this._spawn(pair[0]);
      this._spawn(pair[1]);
    } else {
      this._spawn();
    }
  };

  /** Snap spawns to the music's beat (motion guide §9): wait ≤ one beat for the next one. */
  Game.prototype._onBeat = function () {
    if (this._dueSince == null) this._dueSince = this.playT;
    var b = audio.music ? audio.beat() : null;
    if (!b) return true;
    var frac = b.beat - Math.floor(b.beat);
    if (frac < 0.12 || this.playT - this._dueSince > 0.65) { this._dueSince = null; return true; }
    return false;
  };

  Game.prototype._spawn = function (note) {
    if (!note) note = this.gen.next();
    var x = this._pickX();
    var cfg = this.plan.cfg;
    var e = {
      id: this.nextId++, note: note, hand: note.hand,
      x: x, progress: 0, travel: cfg.travel * CK.rand(0.94, 1.06),
      age: 0, laughT: 0, laughText: '', hoverT: 0, dive: 0, waitFirst: this.spawned === 0,
      targeted: false, dead: false, tutorial: this.levelIdx === 0 && this.spawned < 2 && !this.tutorialDone,
      variant: { base: CK.pick(GREENS), phase: Math.random() * 6, spikes: true, wide: CK.rand(0.95, 1.08), look: CK.rand(-1, 1) }
    };
    this.enemies.push(e);
    this.spawned++;
    this.lastSpawnT = this.playT;
    this._hud();
  };

  Game.prototype._pickX = function () {
    var best = 0.5, bestScore = -1, self = this;
    for (var i = 0; i < 10; i++) {
      var x = CK.rand(0.12, 0.88), score = 1;
      self.enemies.forEach(function (e) {
        var d = Math.abs(e.x - x) + (e.progress > 0.35 ? 0.15 : 0);
        score = Math.min(score, d);
      });
      if (score > bestScore) { bestScore = score; best = x; }
    }
    return best;
  };

  Game.prototype._laugh = function (e) {
    e.laughT = 1.1;
    e.laughText = CK.pick(LAUGHS);
    if (this.clock - this.lastLaugh > 1.4) {
      this.lastLaugh = this.clock;
      audio.sfx('laugh', { count: CK.randInt(3, 4), pitch: CK.rand(210, 270) });
    }
  };

  /** A monster slammed into the keyboard: a key cracks (three cracks and it breaks). */
  Game.prototype._enemyReached = function (e) {
    var scene = this.scene;
    e.dead = true;
    this.resolved++;
    this.lastResolveT = this.playT;
    this.health = Math.max(0, this.health - 1);
    this.shieldHit = 1;
    var midi = scene.keyAtX(scene.laneX(e));
    var hp = scene.damageKey(midi);
    var s = hp.s;
    scene.flash = 1;
    scene.addShake(16);
    scene.burst(hp.x, hp.y, ['#ff4d6d', '#ffb347', '#ffffff'], 34, 420, 9);
    scene.burst(hp.x, hp.y, ['#43e07a', '#2bc46a', '#9dff7a'], 24, 440, 6, 'goo');
    scene.burst(hp.x, hp.y, ['#ffd27a', '#ffffff', '#ff8a3c'], 26, 520, 4, 'spark');
    scene.burst(hp.x, hp.y, ['#e8ecf6', '#b9c0d4', '#ffffff'], 14, 360, 6, 'shard');
    for (var k = 0; k < 6; k++) scene.smoke(hp.x, hp.y - 6, s * 0.7, k % 2 === 0);
    scene.ring(hp.x, hp.y, '#ff4d6d', 10, s * 4, 0.55, 5, 0.38);
    scene.world.wave(hp.x, hp.y, '#ff4d6d', 1.5);
    this.freeze = 0.1;
    var left = this.health;
    if (left > 0) scene.floatText(hp.x, hp.y - s * 2.2, 'KEY CRACKED!', '#ff6b81', Math.round(CK.clamp(scene.W * 0.032, 20, 38)), 1.1);
    audio.sfx('miss');
    this._hud();
    this.ui.pulseShields();
    if (this.health <= 0) this._gameOver();
  };

  /* ------------------------------------------------------------------ */
  /* Notes from the piano                                                 */
  /* ------------------------------------------------------------------ */
  Game.prototype.onNote = function (ev) {
    if (this.state !== 'playing') return;
    var scene = this.scene;
    var heardLabel = T.midiLabel(ev.midi, true);
    // Candidates: same pitch class (any octave), not already targeted.
    var best = null, bestScore = Infinity;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.targeted || e.dead) continue;
      var d = ev.adjFloat - e.note.midi;
      var oct = Math.round(d / 12);
      var pcDist = Math.abs(d - oct * 12);
      if (pcDist > 0.55) continue;
      // exact octave first, then nearest octave, then the most dangerous enemy
      var score = Math.abs(oct) * 10 + (1 - e.progress);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (!ev.dev) CK.pitch.confirm(ev);
      best.waitFirst = false;
      this.ui.showHeard(heardLabel, true);
      this._fire(best);
    } else {
      this.ui.showHeard(heardLabel, false);
      if (scene.isKeyVisible(ev.midi)) scene.pressKey(ev.midi, '#ff5c7a', 0.45);
      audio.sfx('fizzle');
      // The nearest monster finds wrong notes hilarious.
      var near = null;
      this.enemies.forEach(function (e) { if (!e.targeted && (!near || e.progress > near.progress)) near = e; });
      if (near && near.laughT <= 0 && CK.chance(0.6)) this._laugh(near);
    }
  };

  Game.prototype._fire = function (e) {
    var scene = this.scene, color = CK.HAND_COLOR[e.hand];
    e.targeted = true;
    var dist = 1 - e.progress;
    var charge = CK.lerp(0.06, 0.42, Math.pow(CK.clamp(dist, 0, 1), 1.3)); // close = quick shot
    var flight = CK.lerp(0.09, 0.22, dist);
    var shot = { enemy: e, hand: e.hand, color: color, phase: 'charge', t: 0, charge: charge, flight: flight };
    if (this.plan.free) {
      shot.gun = this.gunFor(e.note.midi);
      if (shot.gun) shot.gun.charge = 0.01;
    } else {
      var rig = this.rigFor(e.hand);
      shot.rig = rig;
      shot.finger = e.note.finger || 1;
      var st = rig.pose.fingers[shot.finger];
      st.charge = 0.01;
      st.press = 1;
      if (e.note.chromatic || e.note.midi !== rig.homes[e.hand === 'R' ? shot.finger - 1 : 5 - shot.finger]) {
        st.slideTo = e.note.midi; st.slideHold = charge + flight + 0.25;
      }
    }
    scene.pressKey(e.note.midi, color, 1);
    audio.sfx('charge', { dur: charge });
    this.shots.push(shot);
  };

  Game.prototype.shooterPos = function (shot) {
    if (shot.gun) { var gb = this.scene.gunBase(shot.gun.midi); return { x: shot.gun.tipX || gb.x, y: shot.gun.tipY || gb.y }; }
    if (shot.rig) return this.scene.fingertip(shot.rig.geom, shot.rig.pose, shot.finger);
    return { x: this.scene.W / 2, y: this.scene.pianoY() };
  };

  Game.prototype._updateShots = function (dt) {
    var scene = this.scene;
    for (var i = this.shots.length - 1; i >= 0; i--) {
      var s = this.shots[i];
      s.t += dt;
      var e = s.enemy;
      var target = scene.enemyPos(e);
      if (s.gun) {
        var gb = scene.gunBase(s.gun.midi);
        s.gun.aim = CK.lerp(s.gun.aim, Math.atan2(target.x - gb.x, gb.y - target.y), Math.min(1, dt * 18));
      }
      if (s.phase === 'charge') {
        if (s.gun) s.gun.charge = s.t / s.charge;
        if (s.rig) s.rig.pose.fingers[s.finger].charge = s.t / s.charge;
        if (s.t >= s.charge) {
          var o = this.shooterPos(s);
          s.phase = 'fly'; s.t = 0; s.x0 = o.x; s.y0 = o.y; s.x1 = target.x; s.y1 = target.y;
          audio.sfx('laser', { pan: (o.x / scene.W) * 2 - 1 });
          scene.burst(o.x, o.y, [s.color, '#ffffff'], 10, 260, 8); scene.ring(o.x, o.y, s.color, 4, 40, 0.25, 3);
          if (s.gun) { s.gun.charge = 0; s.gun.recoil = 1; }
          if (s.rig) { var st = s.rig.pose.fingers[s.finger]; st.charge = 0; st.press = 1; }
        }
      } else if (s.phase === 'fly') {
        s.x1 = target.x; s.y1 = target.y;
        if (s.t >= s.flight) {
          this._destroy(e, s.color);
          this.shots.splice(i, 1);
        }
      }
    }
    for (var g = 0; g < this.guns.length; g++) {
      var gun = this.guns[g];
      gun.recoil = Math.max(0, gun.recoil - dt * 5);
      if (gun.charge === 0 && !this.shots.some(function (s) { return s.gun === gun; })) gun.aim *= Math.exp(-dt * 6);
    }
  };

  Game.prototype._destroy = function (e, color) {
    var scene = this.scene;
    var p = scene.enemyPos(e);
    e.dead = true;
    this.resolved++; this.killed++;
    this.lastResolveT = this.playT;
    // impact: hit-stop, flash, goo splash, sparks, shock rings, the card spins away
    this.freeze = 0.055;
    scene.whiteFlash = Math.max(scene.whiteFlash, 0.12);
    scene.burst(p.x, p.y, ['#43e07a', '#7dff9a', '#2bc46a', '#b6ff7a'], 26, 460, p.mon * 0.07, 'goo');
    scene.burst(p.x, p.y, ['#ffffff', color, '#d8ff5e'], 30, 520, p.mon * 0.12);
    scene.burst(p.x, p.y, [color, '#ffffff'], 10, 380, p.mon * 0.05, 'shard');
    scene.ring(p.x, p.y, color, p.mon * 0.2, p.mon * 1.6, 0.5, 6);
    scene.ring(p.x, p.y, '#ffffff', p.mon * 0.1, p.mon * 0.9, 0.3, 4);
    scene.dropCard(e, p);
    this._lastBurst = { x: p.x, y: p.y };
    scene.world.wave(p.x, p.y, color, 1.6);
    scene.floatText(p.x, p.y - p.mon * 0.6, CK.pick(['NICE!', 'ZAP!', 'BOOM!', 'YES!', 'GREAT!']), color, Math.round(CK.clamp(scene.W * 0.03, 20, 36)), 0.9);
    scene.addShake(7);
    audio.sfx('explode', { big: false });
    audio.sfx('chime', { step: this.killed, count: 3 + (this.killed % 2) });
    this._hud();
  };

  Game.prototype._updateFingers = function (dt) {
    for (var i = 0; i < this.handRigs.length; i++) {
      var rig = this.handRigs[i];
      for (var f = 1; f <= 5; f++) {
        var st = rig.pose.fingers[f];
        st.press = Math.max(0, st.press - dt * 4);
        if (st.slideTo != null) {
          st.slideHold -= dt;
          st.slide = st.slideHold > 0 ? Math.min(1, st.slide + dt * 14) : Math.max(0, st.slide - dt * 8);
          if (st.slideHold <= 0 && st.slide <= 0) st.slideTo = null;
        }
        if (this.state === 'playing' || this.state === 'clear') st.wig = 0;
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Level end                                                            */
  /* ------------------------------------------------------------------ */
  Game.prototype._levelComplete = function () {
    this.state = 'clear';
    this.stateT = 0;
    CK.pitch.listening = false;
    audio.stopMusic(1.0);
    audio.sfx('levelclear');
    this.scene.showBanner({ text: 'LEVEL COMPLETE!', y: this.scene.H * 0.3, color: '#ffe58a', glow: 'rgba(255,200,80,0.95)', sticky: true });
    if (this._lastBurst) this.scene.cameraTo(1.08, (this._lastBurst.x + this.scene.W / 2) / 2, (this._lastBurst.y + this.scene.H * 0.35) / 2);
    var sceneRef = this.scene;
    setTimeout(function () { sceneRef.cameraHome(); }, 1300);
    this._fireworks = 0;
  };

  Game.prototype._updateClear = function (dt) {
    var t = this.stateT, scene = this.scene;
    if (t > 2.0) scene.clearBanners();
    // celebration: bursts of light across space in time with the cue
    while (this._fireworks < 7 && t > this._fireworks * 0.22) {
      var fxx = scene.W * CK.rand(0.15, 0.85), fxy = scene.H * CK.rand(0.12, 0.45);
      var palette = CK.pick([['#ffe58a', '#ffffff', '#ffb347'], ['#38e8ff', '#ffffff', '#b9a6ff'], ['#ff6ad5', '#ffffff', '#ffd76a'], ['#7dff9a', '#ffffff', '#38e8ff']]);
      scene.burst(fxx, fxy, palette, 34, 420, 9);
      scene.ring(fxx, fxy, palette[0], 6, 140, 0.6, 4);
      scene.world.wave(fxx, fxy, palette[0], 1.2);
      if (this._fireworks % 2 === 0) audio.sfx('chime', { step: this._fireworks, count: 4 });
      this._fireworks++;
    }
    if (t > 1.4) {
      scene.pianoOffset = CK.ease.inCubic(CK.seg(t, 1.4, 2.2));
      if (t > 1.35 && !this._sinkSfx) { this._sinkSfx = true; audio.sfx('whoosh', { dur: 0.8, up: false }); }
    }
    for (var g = 0; g < this.guns.length; g++) this.guns[g].pop = 1 - CK.seg(t, 1.2, 1.6);
    if (t > 2.4 && !this._transitionShown) {
      this._transitionShown = true;
      this._showTransition();
    }
  };

  Game.prototype._showTransition = function () {
    var idx = this.levelIdx;
    this.rankIdx = idx;
    var best = CK.storage.get('cosmic-keys-best-rank', -1);
    if (typeof best !== 'number' || idx > best) CK.storage.set('cosmic-keys-best-rank', idx);
    var restored = false;
    if (this.health < MAX_HEALTH) { this.health++; restored = true; }
    var piece = CK.PIECES[idx], pianist = CK.PIANISTS[idx], rank = CK.RANKS[idx];
    var final = idx === CK.LEVEL_COUNT - 1;
    var self = this;
    this.state = 'transition';
    this.ui.showHud(false);
    this.ui.showTransition({
      level: idx + 1, final: final, rank: rank, pianist: pianist, piece: piece,
      restored: restored, health: this.health, maxHealth: MAX_HEALTH,
      nextPosition: final ? null : (CK.positionForLevel(this.settings, idx + 1))
    });
    setTimeout(function () {
      if (self.state === 'transition') {
        if (restored) audio.sfx('shield');
        audio.playPiece(piece);
      }
    }, 450);
  };

  Game.prototype.nextLevel = function () {
    this._transitionShown = false; this._sinkSfx = false;
    audio.stopCue();
    if (this.levelIdx >= CK.LEVEL_COUNT - 1) { this.newGame(); return; } // "Play Again" after the finale
    this.startLevel(this.levelIdx + 1);
  };

  Game.prototype._gameOver = function () {
    this.state = 'gameover';
    this.stateT = 0;
    CK.pitch.listening = false;
    audio.stopMusic(0.6);
    setTimeout(function () { audio.sfx('gameover'); }, 400);
    this.enemies.forEach(function (e) { e.laughT = 3; e.laughText = CK.pick(LAUGHS); e.targeted = false; });
    this.shots = [];
    this.guns.forEach(function (g) { g.charge = 0; });
    this.handRigs.forEach(function (r) { for (var f = 1; f <= 5; f++) r.pose.fingers[f].charge = 0; });
    this.scene.breakKeyboard();
    this.handRigs.forEach(function (r) { r.pose.visible = false; });
    this.scene.showBanner({ text: 'KEYBOARD BROKEN!', y: this.scene.H * 0.3, color: '#ff8fa3', glow: 'rgba(255,60,90,0.95)', sticky: true });
    this._goShown = false;
  };

  Game.prototype._updateGameOver = function (dt) {
    var t = this.stateT;
    this.enemies.forEach(function (e) { e.age += dt; e.laughT = 2; });
    if (t > 1.3) this.scene.pianoOffset = CK.ease.inCubic(CK.seg(t, 1.3, 2.0));
    if (t > 2.3 && !this._goShown) {
      this._goShown = true;
      this.scene.clearBanners(true);
      this.state = 'over';
      this.ui.showHud(false);
      this.ui.showGameOver({ level: this.levelIdx + 1, rank: this.rankIdx >= 0 ? CK.RANKS[this.rankIdx].name : CK.START_RANK });
    }
  };

  Game.prototype._hud = function () {
    var plan = this.plan;
    this.ui.updateHud({
      level: this.levelIdx + 1,
      position: plan ? plan.title : '',
      rank: this.rankIdx >= 0 ? CK.RANKS[this.rankIdx].name : CK.START_RANK,
      done: this.resolved || 0,
      total: plan ? plan.cfg.n : 0,
      health: this.health,
      maxHealth: MAX_HEALTH
    });
  };

  CK.Game = Game;
})();
