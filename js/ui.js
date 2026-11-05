/* Cosmic Keys — DOM screens, HUD and settings */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.classList.toggle('hidden', !on); }

  var MODE_HELP = {
    keep: 'Every level uses the same hand position.',
    change: 'Starts in the position below, then moves to a new position each level (C → G → F → D → A → E …).',
    free: 'No hands on screen. Little ray guns sit above the keys and fire when you play their notes.'
  };

  function UI(app) {
    this.app = app;
    this.trT = 0;
    this.typeIdx = 0;
    this.trActive = false;
    this._shieldCount = null;
  }

  UI.prototype.init = function () {
    var self = this, app = this.app;

    // Settings segmented controls
    var posSeg = document.querySelector('[data-setting="startPosition"]');
    T.POSITIONS.forEach(function (p) {
      var b = document.createElement('button');
      b.dataset.value = p.id; b.textContent = p.name;
      b.setAttribute('aria-label', p.name + ' position');
      posSeg.appendChild(b);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
      seg.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn) return;
        var key = seg.dataset.setting, raw = btn.dataset.value;
        var val = raw === 'true' ? true : raw === 'false' ? false : raw;
        app.settings[key] = val;
        app.saveSettings();
        CK.audio.sfx('click');
        self.refreshSettings();
      });
    });

    var bindVol = function (musicId, sfxId) {
      var m = $(musicId), s = $(sfxId);
      m.addEventListener('input', function () { app.settings.musicVol = parseFloat(m.value); app.applyVolumes(); app.saveSettings(); self.syncVolumes(); });
      s.addEventListener('input', function () { app.settings.sfxVol = parseFloat(s.value); app.applyVolumes(); app.saveSettings(); self.syncVolumes(); });
      s.addEventListener('change', function () { CK.audio.sfx('laser'); });
    };
    bindVol('vol-music', 'vol-sfx');
    bindVol('vol-music-p', 'vol-sfx-p');

    $('btn-start').addEventListener('click', function () { app.startGame(); });
    $('btn-settings').addEventListener('click', function () { app.unlockAudio(); self.openSettings(); });
    $('btn-settings-done').addEventListener('click', function () { self.closeSettings(); });
    $('btn-ranks').addEventListener('click', function () { app.unlockAudio(); self.openRanks(); });
    $('btn-ranks-done').addEventListener('click', function () { show($('screen-ranks'), false); CK.audio.sfx('click'); $('btn-ranks').focus({ preventScroll: true }); });
    // gold clef + swoosh behind the logo (redrawn when the layout or fonts change)
    var drawLogo = function () { if (!$('screen-title').classList.contains('hidden')) CK.drawLogoArt($('logo-art'), $('logo-text')); };
    this.drawLogo = drawLogo;
    window.addEventListener('resize', function () { setTimeout(drawLogo, 60); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(drawLogo, 30); });
    setTimeout(drawLogo, 1300);
    $('btn-mic-test').addEventListener('click', function () {
      app.ensureMic().then(function (ok) { if (ok) self.refreshMicDevices(); });
    });
    $('mic-select').addEventListener('change', function () {
      app.settings.micId = $('mic-select').value; app.saveSettings();
      app.restartMic();
    });
    $('btn-mic-retry').addEventListener('click', function () { app.retryMic(); });
    $('btn-mic-cancel').addEventListener('click', function () { self.hideMicPanel(); app.cancelMic(); });

    $('btn-pause').addEventListener('click', function () { app.game.pause(); });
    $('btn-resume').addEventListener('click', function () { app.game.resume(); });
    $('btn-restart').addEventListener('click', function () { self.showPause(false); CK.audio.setMusicPaused(false); app.game.retryLevelKeepHealth(); });
    $('btn-quit').addEventListener('click', function () { self.showPause(false); app.game.quitToTitle(); self.showTitle(true); });

    $('btn-next').addEventListener('click', function () { self.closeTransition(); app.game.nextLevel(); });
    $('btn-tr-menu').addEventListener('click', function () { self.closeTransition(); app.game.quitToTitle(); self.showTitle(true); });
    $('btn-retry').addEventListener('click', function () { show($('screen-gameover'), false); app.game.retryLevel(); });
    $('btn-go-menu').addEventListener('click', function () { show($('screen-gameover'), false); app.game.quitToTitle(); self.showTitle(true); });
    $('btn-rotate-ok').addEventListener('click', function () { self.rotateDismissed = true; show($('rotate'), false); });

    this.syncVolumes();
    this.refreshSettings();
    this._buildLevelUpArt();
  };

  /* Title ----------------------------------------------------------------- */
  UI.prototype.showTitle = function (on) {
    show($('screen-title'), on);
    if (on) { this.refreshSummary(); if (this.drawLogo) setTimeout(this.drawLogo, 30); }
  };

  /* Ranks ----------------------------------------------------------------- */
  var DYN = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  UI.prototype.openRanks = function () {
    var best = CK.storage.get('cosmic-keys-best-rank', -1);
    best = typeof best === 'number' ? best : -1;
    var html = CK.RANKS.map(function (r, i) {
      var mark = i < DYN.length ? DYN[i] : '★';
      var cls = 'rank-row' + (i <= best ? ' earned' : '') + (i === best ? ' current' : '');
      return '<li class="' + cls + '"><span class="mark" aria-hidden="true">' + mark + '</span>' +
        '<span class="rname">' + r.name + '<span class="rnote">' + r.note + '</span></span>' +
        '<span class="rlvl">' + (i <= best ? 'Earned' : 'Level ' + (i + 1)) + '</span></li>';
    }).join('');
    $('ranks-list').innerHTML = html;
    show($('screen-ranks'), true);
    CK.audio.sfx('click');
    $('btn-ranks-done').focus({ preventScroll: true });
  };
  UI.prototype.refreshSummary = function () {
    var s = this.app.settings;
    var chips = [];
    chips.push(s.hands === 'both' ? 'Both hands' : s.hands === 'left' ? 'Left hand' : 'Right hand');
    if (s.positionMode === 'free') chips.push('No hand position');
    else chips.push(T.getPosition(s.startPosition).name + ' position' + (s.positionMode === 'change' ? ', changing' : ''));
    chips.push(s.accidentals ? 'Accidentals on' : 'No accidentals');
    $('title-summary').innerHTML = chips.map(function (c) { return '<span class="chip">' + c + '</span>'; }).join('');
  };

  /* Settings -------------------------------------------------------------- */
  UI.prototype.openSettings = function () {
    this.refreshSettings();
    show($('screen-settings'), true);
    this.settingsOpen = true;
    if (CK.pitch.active) { CK.pitch.listening = true; this.refreshMicDevices(); }
    var first = document.querySelector('#screen-settings .seg button[aria-pressed="true"]');
    if (first) first.focus({ preventScroll: true });
  };
  UI.prototype.closeSettings = function () {
    show($('screen-settings'), false);
    this.settingsOpen = false;
    if (this.app.game.state === 'title') CK.pitch.listening = false;
    this.refreshSummary();
    CK.audio.sfx('click');
  };
  UI.prototype.refreshSettings = function () {
    var s = this.app.settings;
    Array.prototype.forEach.call(document.querySelectorAll('.seg'), function (seg) {
      var key = seg.dataset.setting, cur = String(s[key]);
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.value === cur ? 'true' : 'false');
      });
    });
    var posSeg = document.querySelector('[data-setting="startPosition"]');
    posSeg.setAttribute('aria-disabled', s.positionMode === 'free' ? 'true' : 'false');
    $('position-label').textContent = s.positionMode === 'change' ? 'Starting position' : 'Position';
    $('mode-help').textContent = MODE_HELP[s.positionMode] || '';
    this.refreshSummary();
  };
  UI.prototype.syncVolumes = function () {
    var s = this.app.settings;
    ['vol-music', 'vol-music-p'].forEach(function (id) { $(id).value = s.musicVol; });
    ['vol-sfx', 'vol-sfx-p'].forEach(function (id) { $(id).value = s.sfxVol; });
  };
  UI.prototype.refreshMicDevices = function () {
    var sel = $('mic-select'), app = this.app;
    CK.PitchInput.listDevices().then(function (list) {
      if (list.length < 2) { show(sel, false); return; }
      sel.innerHTML = '';
      list.forEach(function (d, i) {
        var o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || ('Microphone ' + (i + 1));
        sel.appendChild(o);
      });
      if (app.settings.micId) sel.value = app.settings.micId;
      show(sel, true);
    });
    $('btn-mic-test').textContent = 'Microphone on';
    $('mic-status').textContent = 'Play any note on your piano. Its name should appear above.';
  };
  UI.prototype.micHeard = function (label) {
    $('mic-heard').textContent = label;
  };

  /* Microphone panel --------------------------------------------------- */
  UI.prototype.showMicRequest = function () {
    $('mic-title').textContent = 'Microphone needed';
    $('mic-message').textContent = 'Cosmic Keys listens to your piano through the microphone. Please allow microphone access when your browser asks.';
    $('btn-mic-retry').classList.add('hidden');
    show($('screen-mic'), true);
  };
  UI.prototype.showMicError = function (code) {
    var embedded = false;
    try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
    var msg = {
      denied: 'Microphone access is blocked. Allow the microphone for this site (look for the microphone or lock icon by the web address), then tap Try again.',
      nodevice: 'No microphone was found. Connect or turn on a microphone, then tap Try again.',
      busy: 'Another app is using the microphone. Close it, then tap Try again.',
      insecure: 'The microphone only works on secure pages. Open the game from its https:// link.',
      unsupported: 'This browser can’t use the microphone. Please try the latest Chrome, Safari, Edge or Firefox.',
      error: 'The microphone couldn’t start. Check your device’s microphone settings, then tap Try again.'
    }[code] || '';
    if (embedded && (code === 'denied' || code === 'unsupported' || code === 'error')) {
      msg += ' If the game is opened inside another app or page, that page must allow microphone access.';
    }
    $('mic-title').textContent = 'Can’t hear your piano yet';
    $('mic-message').textContent = msg;
    $('btn-mic-retry').classList.remove('hidden');
    show($('screen-mic'), true);
  };
  UI.prototype.hideMicPanel = function () { show($('screen-mic'), false); };

  /* HUD ------------------------------------------------------------------- */
  UI.prototype.showHud = function (on) {
    show($('hud'), on);
    show($('heard'), on);
  };
  UI.prototype.updateHud = function (d) {
    $('hud-level').textContent = 'Level ' + d.level;
    $('hud-position').textContent = d.position;
    $('hud-rank').textContent = d.rank;
    $('hud-progress-fill').style.width = (d.total ? Math.min(100, d.done / d.total * 100) : 0) + '%';
    $('hud-progress-text').textContent = d.done + ' of ' + d.total + ' monsters';
    var box = $('hud-shields');
    if (box.children.length !== d.maxHealth) {
      box.innerHTML = '';
      for (var i = 0; i < d.maxHealth; i++) { var s = document.createElement('div'); s.className = 'shield'; box.appendChild(s); }
    }
    for (var j = 0; j < d.maxHealth; j++) {
      var el = box.children[j];
      var lost = j >= d.health;
      if (!lost && el.classList.contains('lost') && this._shieldCount !== null) {
        el.classList.add('restored');
        (function (e) { setTimeout(function () { e.classList.remove('restored'); }, 700); })(el);
      }
      el.classList.toggle('lost', lost);
    }
    box.setAttribute('aria-label', 'Keyboard health: ' + d.health + ' of ' + d.maxHealth);
    this._shieldCount = d.health;
  };
  UI.prototype.pulseShields = function () {
    var box = $('hud-shields');
    box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit');
  };
  UI.prototype.showHeard = function (label, ok) {
    var h = $('heard');
    $('heard-note').textContent = label;
    h.classList.toggle('ok', !!ok);
    h.classList.toggle('bad', !ok);
    clearTimeout(this._heardTimer);
    this._heardTimer = setTimeout(function () { h.classList.remove('ok', 'bad'); }, 900);
  };
  UI.prototype.showPause = function (on) {
    this.syncVolumes();
    show($('screen-pause'), on);
    if (on) $('btn-resume').focus({ preventScroll: true });
  };

  /* Level transition ------------------------------------------------------ */
  UI.prototype.showTransition = function (d) {
    var s = this.app.settings;
    $('tr-kicker').textContent = d.final ? 'All 12 Levels Complete!' : 'Level ' + d.level + ' Complete!';
    $('tr-title').textContent = d.final ? 'Mission Complete!' : 'Level Up!';
    $('tr-rank').textContent = d.rank.name;
    $('tr-rank-note').textContent = d.rank.note;
    this._drawRankClef();
    var sh = $('tr-shield');
    if (d.restored) { sh.textContent = 'Cracked key repaired! (' + d.health + ' of ' + d.maxHealth + ' hearts)'; show(sh, true); }
    else show(sh, false);
    $('tr-pianist').innerHTML = d.pianist.name + '<small>' + d.pianist.years + '</small>';
    $('tr-piece').textContent = d.piece.title;
    $('tr-composer').textContent = '· ' + d.piece.composer;
    var np = '';
    if (!d.final && d.nextPosition && s.positionMode === 'change') np = 'Next level: ' + d.nextPosition.name + ' position';
    $('tr-next-pos').textContent = np;
    $('btn-next').textContent = d.final ? 'Play Again' : '\u2192 Level ' + (d.level + 1);
    show($('btn-tr-menu'), !!d.final);
    this.trData = d;
    this.trT = 0; this.typeIdx = 0; this.trActive = true;
    $('tr-line').textContent = '';
    show($('screen-transition'), true);
    var btn = $('btn-next');
    btn.disabled = true;
    setTimeout(function () { btn.disabled = false; btn.focus({ preventScroll: true }); }, 1200);
  };
  UI.prototype._drawRankClef = function () {
    var c = $('tr-clef');
    if (!c || !CK.drawTreble) return;
    var ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    var g = ctx.createLinearGradient(0, -4.2, 0, 3.2);
    g.addColorStop(0, '#fff3c4'); g.addColorStop(0.35, '#ffcf5a'); g.addColorStop(0.65, '#c98418'); g.addColorStop(1, '#ffe08a');
    ctx.shadowColor = 'rgba(255,190,70,0.8)'; ctx.shadowBlur = 8;
    ctx.fillStyle = g; ctx.strokeStyle = g;
    CK.drawTreble(ctx, 34, 58, 11.5);
  };

  /** Laurels, a gold staff ribbon and a skyline of clouds and temples for the level-up card. */
  UI.prototype._buildLevelUpArt = function () {
    var leaf = function (cx, cy, ang, len, wid) {
      return '<ellipse cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (len / 2).toFixed(1) + '" ry="' + (wid / 2).toFixed(1) + '" transform="rotate(' + (ang * 180 / Math.PI).toFixed(1) + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"/>';
    };
    var laurel = '<svg viewBox="0 0 60 110" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.5" stop-color="#ffc94a"/><stop offset="1" stop-color="#b8740f"/></linearGradient></defs>' +
      '<path d="M46 104 C 14 86, 8 46, 30 6" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linecap="round"/><g fill="url(#lg)">';
    for (var i = 0; i < 8; i++) {
      var t = i / 8, a = Math.PI * (0.62 + t * 0.55);
      var x = 46 - 34 * Math.sin(t * 2.6) * (1 - t * 0.2) - t * 4, y = 102 - t * 94;
      laurel += leaf(x - 7, y - 2, a - 0.5, 16, 6.5) + leaf(x + 6, y - 4, a + 0.9, 15, 6);
    }
    laurel += '<circle cx="31" cy="6" r="3"/></g></svg>';
    Array.prototype.forEach.call(document.querySelectorAll('.laurel'), function (el) { el.innerHTML = laurel; });
    // staff ribbon + clouds + temples
    var W = 760, H = 140, staff = '';
    for (var l = 0; l < 5; l++) {
      var dpath = '';
      for (var k = 0; k <= 40; k++) {
        var x2 = k / 40 * W, y2 = 40 + Math.sin(k / 40 * Math.PI * 2.2 + 0.6) * 16 + l * 6;
        dpath += (k ? 'L' : 'M') + x2.toFixed(1) + ' ' + y2.toFixed(1);
      }
      staff += '<path d="' + dpath + '" />';
    }
    var notes = '';
    [[120, 2], [210, 4], [300, 1], [430, 3], [520, 5], [640, 2]].forEach(function (n) {
      var y3 = 40 + Math.sin(n[0] / W * Math.PI * 2.2 + 0.6) * 16 + n[1] * 3;
      notes += '<ellipse cx="' + n[0] + '" cy="' + y3.toFixed(1) + '" rx="5" ry="3.6" transform="rotate(-20 ' + n[0] + ' ' + y3.toFixed(1) + ')"/><rect x="' + (n[0] + 3.6) + '" y="' + (y3 - 20).toFixed(1) + '" width="1.6" height="20"/>';
    });
    var temple = function (x, s) {
      var o = '<g transform="translate(' + x + ' 96) scale(' + s + ')">';
      o += '<polygon points="0,-46 40,-62 80,-46"/><rect x="2" y="-46" width="76" height="6"/>';
      for (var c = 0; c < 6; c++) o += '<rect x="' + (6 + c * 13) + '" y="-40" width="6" height="34"/>';
      o += '<rect x="0" y="-6" width="80" height="4"/><rect x="-4" y="-2" width="88" height="4"/></g>';
      return o;
    };
    var clouds = '';
    [[60, 120, 1.2], [230, 128, 1], [380, 118, 1.5], [560, 126, 1.1], [710, 120, 1.3]].forEach(function (c) {
      for (var b = 0; b < 4; b++) clouds += '<circle cx="' + (c[0] + (b - 1.5) * 22 * c[2]) + '" cy="' + (Math.abs(b - 1.5) < 1 ? c[1] - 8 * c[2] : c[1]) + '" r="' + (16 + (b % 2) * 8) * c[2] + '"/>';
    });
    $('lu-scenery').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<linearGradient id="sg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd36a" stop-opacity="0"/><stop offset="0.2" stop-color="#ffd36a"/><stop offset="0.8" stop-color="#ffe7a3"/><stop offset="1" stop-color="#ffd36a" stop-opacity="0"/></linearGradient></defs>' +
      '<g fill="#cfe2ff" opacity="0.16">' + temple(90, 0.9) + temple(560, 1.1) + '</g>' +
      '<g fill="#e8f1ff" opacity="0.14">' + clouds + '</g>' +
      '<g fill="none" stroke="url(#sg)" stroke-width="1.2" opacity="0.8">' + staff + '</g><g fill="#ffe08a" opacity="0.9">' + notes + '</g></svg>';
  };

  UI.prototype.closeTransition = function () {
    this.trActive = false;
    show($('screen-transition'), false);
    CK.audio.sfx('click');
  };
  UI.prototype.showGameOver = function (d) {
    $('btn-retry').textContent = 'Try Level ' + d.level + ' Again';
    $('go-text').textContent = 'The monsters smashed the keyboard on level ' + d.level + '. Your rank: ' + d.rank + '. Take a breath and try again!';
    show($('screen-gameover'), true);
    $('btn-retry').focus({ preventScroll: true });
  };

  /** Per-frame updates for animated DOM bits. */
  UI.prototype.tick = function (dt) {
    if (this.trActive && this.trData) {
      this.trT += dt;
      var line = this.trData.pianist.line;
      var target = Math.floor(CK.clamp((this.trT - 0.6) * 42, 0, line.length));
      if (target !== this.typeIdx) { this.typeIdx = target; $('tr-line').textContent = line.slice(0, target); }
      var talking = this.typeIdx > 0 && this.typeIdx < line.length;
      CK.drawPortrait($('tr-portrait'), this.trData.pianist.look, this.trT, talking, this.trData.pianist.name);
    }
    if (this.settingsOpen) {
      $('mic-meter-fill').style.width = Math.round(CK.pitch.level * 100) + '%';
    }
    var dot = document.querySelector('.mic-dot');
    if (dot) {
      var lv = CK.pitch.level;
      dot.style.background = lv > 0.35 ? '#7dff9a' : lv > 0.12 ? '#3d9f6a' : '#3a4370';
    }
  };

  UI.prototype.updateRotateHint = function (inGame) {
    var portraitPhone = window.innerHeight > window.innerWidth * 1.15 && window.innerWidth < 760;
    show($('rotate'), inGame && portraitPhone && !this.rotateDismissed);
  };

  CK.UI = UI;
})();
