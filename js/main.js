/* Cosmic Keys — boot, main loop, microphone flow */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;
  var SETTINGS_KEY = 'cosmicKeys.settings.v1';
  var DEFAULTS = {
    hands: 'both',            // 'left' | 'right' | 'both'
    accidentals: false,
    positionMode: 'keep',     // 'keep' | 'change' | 'free'
    startPosition: 'C',
    musicVol: 0.55,
    sfxVol: 0.8,
    micId: ''
  };

  function loadSettings() {
    var s = CK.storage.get(SETTINGS_KEY, {}) || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = s[k] != null ? s[k] : DEFAULTS[k]; });
    if (['left', 'right', 'both'].indexOf(out.hands) < 0) out.hands = DEFAULTS.hands;
    if (['keep', 'change', 'free'].indexOf(out.positionMode) < 0) out.positionMode = DEFAULTS.positionMode;
    if (!T.POSITIONS.some(function (p) { return p.id === out.startPosition; })) out.startPosition = 'C';
    out.accidentals = !!out.accidentals;
    out.musicVol = CK.clamp(+out.musicVol || 0, 0, 1);
    out.sfxVol = CK.clamp(+out.sfxVol || 0, 0, 1);
    return out;
  }

  var dev = !!(CK.query.dev || CK.query.keyboard);

  var app = {
    settings: loadSettings(),
    saveSettings: function () { CK.storage.set(SETTINGS_KEY, app.settings); },
    applyVolumes: function () { CK.audio.setVolumes(app.settings.musicVol, app.settings.sfxVol); },
    audioUnlocked: false,

    unlockAudio: function () {
      CK.audio.init();
      app.applyVolumes();
      var p = CK.audio.resume();
      if (!app.audioUnlocked) {
        app.audioUnlocked = true;
        if (app.game.state === 'title') CK.audio.startMusic('title');
      }
      return p;
    },

    /** Resolve true once the microphone is running; false if the player backs out. */
    ensureMic: function () {
      app.unlockAudio();
      if (CK.pitch.active) return Promise.resolve(true);
      return new Promise(function (resolve) {
        app._micResolve = resolve;
        app.ui.showMicRequest();
        app._tryMic();
      });
    },
    _tryMic: function () {
      CK.pitch.start(app.settings.micId || undefined).then(function () {
        app.ui.hideMicPanel();
        if (app.ui.settingsOpen || app.game.state === 'title') CK.pitch.listening = !!app.ui.settingsOpen;
        var r = app._micResolve; app._micResolve = null;
        if (r) r(true);
      }).catch(function (err) {
        // A saved microphone that is no longer plugged in: fall back to the default one.
        if (err.code === 'nodevice' && app.settings.micId) {
          app.settings.micId = ''; app.saveSettings();
          app._tryMic();
          return;
        }
        if (dev) {
          app.ui.hideMicPanel();
          var r2 = app._micResolve; app._micResolve = null;
          if (r2) r2(true);
          return;
        }
        app.ui.showMicError(err.code || 'error');
      });
    },
    retryMic: function () { app.ui.showMicRequest(); app._tryMic(); },
    cancelMic: function () { var r = app._micResolve; app._micResolve = null; if (r) r(false); },
    restartMic: function () {
      CK.pitch.stop();
      CK.pitch.start(app.settings.micId || undefined).then(function () {
        CK.pitch.listening = !!app.ui.settingsOpen || app.game.state === 'playing';
      }).catch(function (err) { app.ui.showMicError(err.code || 'error'); });
    },

    startGame: function () {
      app.unlockAudio();
      app.ensureMic().then(function (ok) {
        if (!ok) return;
        app.ui.showTitle(false);
        app.game.setSettings(JSON.parse(JSON.stringify(app.settings)));
        app.game.newGame();
        app.ui.updateRotateHint(true);
      });
    }
  };
  CK.app = app;

  function boot() {
    var canvas = document.getElementById('game');
    var scene = new CK.Scene(canvas);
    var ui = new CK.UI(app);
    var game = new CK.Game(scene, ui);
    app.scene = scene; app.ui = ui; app.game = game;
    game.setSettings(app.settings);
    ui.init();
    ui.showTitle(true);

    CK.pitch.on('note', function (ev) {
      if (ui.settingsOpen) ui.micHeard(T.midiLabel(ev.midi, true));
    });
    CK.pitch.on('ended', function () {
      if (game.state === 'playing' || game.state === 'intro') {
        game.pause();
        ui.showMicError('error');
        app._micResolve = function () { /* resume manually from pause */ };
      }
    });

    // Title music starts on the first interaction (browser autoplay rules).
    var firstGesture = function () {
      app.unlockAudio();
      window.removeEventListener('pointerdown', firstGesture, true);
      window.removeEventListener('keydown', firstGesture, true);
    };
    window.addEventListener('pointerdown', firstGesture, true);
    window.addEventListener('keydown', firstGesture, true);

    var resizeTimer = null;
    var onResize = function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        scene.resize();
        ui.updateRotateHint(game.state !== 'title');
      }, 60);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) game.pause();
    });
    window.addEventListener('blur', function () {
      // Keep playing when focus moves to another frame; pause only when the page is hidden.
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (game.state === 'paused') game.resume();
        else if (game.state === 'playing' || game.state === 'intro') game.pause();
        else if (ui.settingsOpen) ui.closeSettings();
        else if (!document.getElementById('screen-ranks').classList.contains('hidden')) document.getElementById('btn-ranks-done').click();
      }
    });

    if (dev) setupDevKeyboard(scene, game);

    var last = performance.now();
    var errorCount = 0;
    function frame(now) {
      requestAnimationFrame(frame); // keep the loop alive even if one frame fails
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        CK.pitch.update(now / 1000);
        game.update(dt);
        scene.render(game, game.state === 'paused' ? 0 : (game.renderDt != null ? game.renderDt : dt));
        ui.tick(dt);
      } catch (err) {
        if (errorCount++ < 5 && window.console) console.error(err);
      }
    }
    requestAnimationFrame(frame);
    document.documentElement.classList.add('ready');
  }

  /* Developer input: play notes from a computer keyboard (?dev=1). */
  function setupDevKeyboard(scene, game) {
    document.getElementById('dev-badge').classList.remove('hidden');
    var map = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
    var octave = 4;
    var emitNote = function (midi) {
      var now = performance.now() / 1000;
      CK.pitch.emit('note', { midi: midi, midiFloat: midi, adjFloat: midi, conf: 1, time: now, dev: true });
    };
    window.addEventListener('keydown', function (e) {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      var k = e.key.toLowerCase();
      if (k === 'z') { octave = Math.max(2, octave - 1); return; }
      if (k === 'x') { octave = Math.min(6, octave + 1); return; }
      if (map[k] != null) emitNote(12 * (octave + 1) + map[k]);
    });
    // Click/tap the on-screen keys too.
    scene.canvas.addEventListener('pointerdown', function (e) {
      if (game.state !== 'playing') return;
      var r = scene.canvas.getBoundingClientRect();
      // the stage may be scaled by the camera: map back to scene pixels
      var x = (e.clientX - r.left) * scene.W / r.width, y = (e.clientY - r.top) * scene.H / r.height;
      var midi = scene.pickKey(x, y);
      if (midi != null) emitNote(midi);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
