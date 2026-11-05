/* Cosmic Keys — audio engine: effects, electronic gameplay music, classical victory cues
 *
 * MIC-SAFE MIX RULE. While a level is playing, the microphone listens for piano notes
 * G2…C6 through an ~82 Hz–1.5 kHz band (YIN pitch detection) and the game's own sound
 * comes out of the same device. So nothing the game plays may hold a steady pitch
 * between ~85 Hz and ~1.3 kHz:
 *   - sub bass: pure sines at or below E2 (82 Hz), low-passed;
 *   - every melodic part (arps, pads, bells, leads, chimes): E6 (1319 Hz) and up,
 *     chords mostly G6 and up (the mic's low-pass hides them even better);
 *   - drums: the kick is a fast sweep that settles low; snares, claps, hats and
 *     cymbals are noise high-passed above 3 kHz;
 *   - tonal effects inside the band glide fast (never a steady pitch), start quiet,
 *     and extend pitchedSfxUntil so the detector raises its gate meanwhile.
 * No waveshaping on mixed signals (it would create in-band difference tones).
 * Victory cues play only between levels (mic off), so they use the full piano range.
 */
(function () {
  'use strict';
  var CK = window.CK;

  var E6 = 88;          // lowest MIDI note for any melodic music part
  var CHORD_LO = 91;    // G6: lowest note for sustained chords
  var LOOKAHEAD = 0.18; // seconds of music scheduled ahead of the clock
  var TICK_MS = 25;
  var MUSIC_GAIN = 0.9, SFX_GAIN = 0.85, CUE_GAIN = 1.0;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function mod12(x) { return ((x % 12) + 12) % 12; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  /** Tiny deterministic PRNG, so each level's music is the same every time. */
  function rng(seed) {
    var s = (seed * 2654435761) >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  /** Lowest MIDI note ≥ lo with pitch class pc. */
  function above(pc, lo) { return lo + mod12(pc - lo); }

  function AudioEngine() {
    this.ctx = null;
    this.ready = false;
    this.offline = false;        // true when driven by an OfflineAudioContext (tests)
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.music = null;           // current music sequencer state
    this.cueOut = null;
    this.pitchedSfxUntil = 0;    // lets the pitch detector ignore our own tonal effects
    this.master = this.musicBus = this.sfxBus = this.cueBus = null;
    this._key = { root: 9, tones: [9, 0, 4] }; // last music key: fanfares/chimes use it when music is off
    this._notes = {};            // rendered instrument notes, 'piano:60' → AudioBuffer
    this._pending = {};
  }
  var P = AudioEngine.prototype;

  /* ------------------------------------------------------------------ */
  /* Setup                                                                */
  /* ------------------------------------------------------------------ */
  /** Create the AudioContext (call from a user gesture on iOS). ctxOverride: tests only. */
  P.init = function (ctxOverride) {
    if (this.ctx) return this.ctx;
    var ctx = ctxOverride || null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) {
        try { ctx = new AC(); } catch (e2) { return null; }
      }
    }
    this.ctx = ctx;
    this.offline = !!ctxOverride;
    try { this._build(); } catch (e) {
      if (window.console) console.warn('Cosmic Keys audio: setup failed', e);
      return ctx;
    }
    this.ready = true;
    this.applyVolumes();
    if (!this.offline) this._watchLifecycle();
    return ctx;
  };

  P._build = function () {
    var ctx = this.ctx;
    // buses → mix → glue compressor → peak limiter → master → speakers
    this.mix = this._g(1);
    var glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 2.2;
    glue.attack.value = 0.012; glue.release.value = 0.22;
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.12;
    this.master = this._g(0.82);
    this.mix.connect(glue); glue.connect(lim); lim.connect(this.master); this.master.connect(ctx.destination);
    this.glue = glue; this.limiter = lim;

    this.musicBus = this._g(0);   // music volume
    this.musicDuck = this._g(1);  // dips under important effects
    this.musicTone = this._f('lowpass', 20000, 0.5); // muffles the music when a shield is hit
    this.musicBus.connect(this.musicDuck); this.musicDuck.connect(this.musicTone); this.musicTone.connect(this.mix);
    this.sfxBus = this._g(0); this.sfxBus.connect(this.mix);
    this.cueBus = this._g(0); this.cueBus.connect(this.mix);

    this.noiseBuf = this._makeNoise(2.5);

    // Music space: a large bright hall and a tempo-synced ping-pong echo, both
    // returning into the music bus so they follow the music volume.
    this.verbIn = this._g(1);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._makeIR(3.2, 2.6, 0.75, 0.022);
    var vHp = this._f('highpass', 220, 0.6), vRet = this._g(0.62);
    this.verbIn.connect(this.verb); this.verb.connect(vHp); vHp.connect(vRet); vRet.connect(this.musicBus);
    this.echoIn = this._g(1);
    this.echo = this._pingPong(this.echoIn, this.musicBus, 0.42, 2600, 8500, 0.5);

    // Effects space: a shorter room + a quick stereo echo, returning into the effects bus.
    this.sfxVerbIn = this._g(1);
    var sv = ctx.createConvolver();
    sv.buffer = this._makeIR(1.6, 1.2, 0.6, 0.008);
    var svHp = this._f('highpass', 260, 0.6), svRet = this._g(0.5);
    this.sfxVerbIn.connect(sv); sv.connect(svHp); svHp.connect(svRet); svRet.connect(this.sfxBus);
    this.sfxEchoIn = this._g(1);
    this.sfxEcho = this._pingPong(this.sfxEchoIn, this.sfxBus, 0.3, 1800, 8000, 0.45);
    this.sfxEcho.setTime(0.16);
  };

  /** Stereo ping-pong delay: in → L → R → (feedback) → L … band-limited so repeats stay airy. */
  P._pingPong = function (input, output, feedback, hp, lp, level) {
    var ctx = this.ctx;
    var dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    var fHp = this._f('highpass', hp, 0.6), fLp = this._f('lowpass', lp, 0.6);
    var fb = this._g(feedback), out = this._g(level);
    var merger = ctx.createChannelMerger(2);
    input.connect(fHp); fHp.connect(fLp); fLp.connect(dl);
    dl.connect(dr); dr.connect(fb); fb.connect(fHp);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    merger.connect(out); out.connect(output);
    return {
      setTime: function (s, t) {
        t = t || 0;
        dl.delayTime.setValueAtTime(clamp(s, 0.02, 1.9), t);
        dr.delayTime.setValueAtTime(clamp(s, 0.02, 1.9), t);
      }
    };
  };

  /**
   * Keep the context healthy on phones: iOS/Safari can leave it 'suspended' or
   * 'interrupted' (calls, other apps), so any tap wakes it; a hidden page sleeps.
   */
  P._watchLifecycle = function () {
    var self = this;
    var wake = function () {
      if (self.ctx && self.ctx.state !== 'running' && !self._hidden) self._tryResume();
    };
    ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach(function (ev) {
      try { window.addEventListener(ev, wake, true); } catch (e) { /* ignore */ }
    });
    try {
      document.addEventListener('visibilitychange', function () {
        self._hidden = !!document.hidden;
        if (!self.ctx) return;
        if (document.hidden) {
          if (self.ctx.state === 'running' && self.ctx.suspend) {
            self._autoSuspended = true;
            var p = self.ctx.suspend(); if (p && p.catch) p.catch(function () {});
          }
        } else if (self._autoSuspended) {
          self._autoSuspended = false;
          self._tryResume();
        }
      });
    } catch (e) { /* ignore */ }
  };
  P._tryResume = function () {
    try {
      var p = this.ctx.resume();
      if (p && p.catch) p.catch(function () {});
      return p || Promise.resolve();
    } catch (e) { return Promise.resolve(); }
  };

  P.resume = function () {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running' && !this.offline) return this._tryResume();
    return Promise.resolve();
  };

  P.now = function () { return this.ctx ? this.ctx.currentTime : 0; };

  P.setVolumes = function (music, sfx) {
    this.musicVol = clamp(+music || 0, 0, 1);
    this.sfxVol = clamp(+sfx || 0, 0, 1);
    this.applyVolumes();
  };
  P.applyVolumes = function () {
    if (!this.ctx || !this.musicBus) return;
    var t = this.ctx.currentTime;
    // perceptual (roughly dB-linear) slider curves
    var m = Math.pow(this.musicVol, 1.6), s = Math.pow(this.sfxVol, 1.4);
    this.musicBus.gain.setTargetAtTime(m * MUSIC_GAIN, t, 0.05);
    this.cueBus.gain.setTargetAtTime(m * CUE_GAIN, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s * SFX_GAIN, t, 0.05);
  };

  /* ------------------------------------------------------------------ */
  /* Buffers                                                              */
  /* ------------------------------------------------------------------ */
  P._makeNoise = function (seconds) {
    var ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  /**
   * Synthetic hall impulse: sparse early reflections, then a decorrelated stereo
   * tail whose highs die faster than its lows (a low-pass that closes over time).
   */
  P._makeIR = function (seconds, rt60, damp, pre) {
    var ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * seconds);
    var buf = ctx.createBuffer(2, len, sr), preS = Math.floor(pre * sr);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0, i, k;
      for (k = 0; k < 12; k++) {
        var at = preS + Math.floor((0.003 + Math.random() * 0.075) * sr);
        if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.7 - k * 0.045);
      }
      var fade = Math.floor(sr * 0.012);
      for (i = preS; i < len; i++) {
        var tt = (i - preS) / sr;
        var env = Math.pow(10, -3 * tt / rt60);
        var a = Math.min(0.97, 0.08 + damp * tt / rt60);
        lp += (1 - a) * ((Math.random() * 2 - 1) - lp);
        var on = i - preS < fade ? (i - preS) / fade : 1;
        d[i] += lp * env * on * (1.6 + a * 2.2); // compensate the low-pass level loss
      }
    }
    return buf;
  };

  /* ------------------------------------------------------------------ */
  /* Node helpers                                                         */
  /* ------------------------------------------------------------------ */
  P._g = function (v) { var g = this.ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };
  P._f = function (type, freq, q) {
    var f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = Math.min(freq, this.ctx.sampleRate * 0.45);
    if (q != null) f.Q.value = q;
    return f;
  };
  P._osc = function (type, freq, t, stop, detune) {
    var o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t); o.stop(stop);
    return o;
  };
  /** Looping white-noise source starting at a random point. */
  P._noise = function (t, dur) {
    var s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(t, Math.random() * 2); s.stop(t + dur);
    return s;
  };
  /** Stereo panner (plain pass-through where StereoPannerNode is missing). */
  P._pan = function (v, t) {
    if (!this.ctx.createStereoPanner) return this._g(1);
    var p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(clamp(v || 0, -1, 1), t || 0);
    return p;
  };
  P._send = function (node, dest, amount) {
    if (!amount || !dest) return;
    var g = this._g(amount); node.connect(g); g.connect(dest);
  };
  /** Percussive envelope: fast attack, exponential decay (time constant tau). */
  P._perc = function (param, t, peak, attack, tau) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(0.0001, t + attack, tau);
  };

  /**
   * Noise hit, high-passed twice (24 dB/oct) so it stays clear of the mic band.
   * shape: { type, freq, q, hp, attack, tau, pan }
   */
  P._noiseHit = function (t, vel, shape, out) {
    var tau = shape.tau || 0.03, attack = shape.attack || 0.0015;
    var n = this._noise(t, attack + tau * 7 + 0.02);
    var hp = shape.hp == null ? 3000 : shape.hp;
    var h1 = this._f('highpass', hp, 0.7), h2 = this._f('highpass', hp, 0.7);
    var g = this._g(0), last = h2;
    n.connect(h1); h1.connect(h2);
    if (shape.type) { var f = this._f(shape.type, shape.freq, shape.q == null ? 0.8 : shape.q); h2.connect(f); last = f; }
    last.connect(g);
    this._perc(g.gain, t, vel, attack, tau);
    if (shape.pan) { var p = this._pan(shape.pan, t); g.connect(p); p.connect(out); } else g.connect(out);
    return g;
  };

  /** Brief music dip under an important effect. */
  P._duck = function (t, amount, hold, release) {
    var g = this.musicDuck && this.musicDuck.gain;
    if (!g) return;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1 - amount, t, 0.012);
    g.setTargetAtTime(1, t + hold, release / 3);
  };
  /** Muffle the music for a moment (as if your ears ring after a hit). */
  P._muffle = function (t, dur) {
    var f = this.musicTone && this.musicTone.frequency;
    if (!f) return;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.setTargetAtTime(650, t, 0.02);
    f.setTargetAtTime(20000, t + dur * 0.35, dur * 0.3);
  };

  /* ------------------------------------------------------------------ */
  /* Music instruments                                                    */
  /* ------------------------------------------------------------------ */

  /** Kick: a sine that sweeps from a punchy 125 Hz down to ~45 Hz in a few ms, plus a beater click. */
  P._kick = function (t, vel, out) {
    var o = this._osc('sine', 125, t, t + 0.5), g = this._g(0);
    o.frequency.exponentialRampToValueAtTime(56, t + 0.028);
    o.frequency.exponentialRampToValueAtTime(43, t + 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.0025);
    g.gain.setValueAtTime(vel, t + 0.045);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.44);
    o.connect(g); g.connect(out);
    this._noiseHit(t, vel * 0.2, { hp: 3500, tau: 0.0035 }, out);
  };
  /** Low "boom" for drops and impacts (stays below E2). */
  P._boom = function (t, vel, out, len) {
    len = len || 1.2;
    var o = this._osc('sine', 66, t, t + len + 0.1), g = this._g(0);
    o.frequency.exponentialRampToValueAtTime(30, t + len);
    this._perc(g.gain, t, vel, 0.004, len * 0.3);
    o.connect(g); g.connect(out);
  };
  P._hat = function (t, vel, open, pan, out) {
    this._noiseHit(t, vel, { hp: 7000, tau: open ? 0.075 : 0.011, pan: pan, type: open ? 'peaking' : null, freq: 10500, q: 1 }, out);
  };
  P._shaker = function (t, vel, pan, out) {
    this._noiseHit(t, vel, { hp: 3800, type: 'bandpass', freq: 7200, q: 1.1, attack: 0.009, tau: 0.022, pan: pan }, out);
  };
  /** Clap: three quick bursts and a short tail, all above 2.8 kHz. */
  P._clap = function (t, vel, out, verb) {
    for (var i = 0; i < 3; i++) this._noiseHit(t + i * 0.0095, vel * (0.75 + i * 0.12), { hp: 2800, type: 'bandpass', freq: 4300, q: 0.9, tau: 0.0035 }, out);
    var tail = this._noiseHit(t + 0.028, vel, { hp: 2800, type: 'bandpass', freq: 4000, q: 0.7, tau: 0.045 }, out);
    this._send(tail, this.verbIn, verb == null ? 0.35 : verb);
  };
  P._snare = function (t, vel, out, verb, pan) {
    var a = this._noiseHit(t, vel, { hp: 3000, tau: 0.05, pan: pan }, out);
    this._noiseHit(t, vel * 0.7, { hp: 6500, tau: 0.018, pan: pan }, out);
    this._send(a, this.verbIn, verb || 0.2);
  };
  /** Metallic ride/bell: inharmonic square partials, all above 3 kHz. */
  P._metal = function (t, vel, tau, out, pan) {
    var fr = [3150, 4270, 5480, 7130], g = this._g(0), hp = this._f('highpass', 4200, 0.7);
    for (var i = 0; i < fr.length; i++) { var o = this._osc('square', fr[i], t, t + tau * 7 + 0.05); o.connect(hp); }
    hp.connect(g); this._perc(g.gain, t, vel, 0.001, tau);
    var p = this._pan(pan || 0, t); g.connect(p); p.connect(out);
    return g;
  };
  /** Crash: wide stereo noise wash + metallic shimmer. */
  P._crash = function (t, vel, out) {
    var a = this._noiseHit(t, vel, { hp: 4000, tau: 0.55, pan: -0.55 }, out);
    var b = this._noiseHit(t + 0.004, vel * 0.9, { hp: 5200, tau: 0.5, pan: 0.55 }, out);
    var m = this._metal(t, vel * 0.25, 0.7, out, 0.2);
    this._send(a, this.verbIn, 0.35); this._send(b, this.verbIn, 0.35); this._send(m, this.verbIn, 0.2);
  };
  /** Reverse cymbal: swells up and stops dead on the downbeat. */
  P._reverse = function (t, dur, vel, out) {
    var n = this._noise(t, dur + 0.02), h1 = this._f('highpass', 3500, 0.7), h2 = this._f('highpass', 3500, 0.7), g = this._g(0);
    var p = this._pan(-0.6, t);
    if (p.pan) p.pan.linearRampToValueAtTime(0.6, t + dur);
    g.gain.setValueAtTime(0.0005, t);
    g.gain.exponentialRampToValueAtTime(vel, t + dur - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(h1); h1.connect(h2); h2.connect(g); g.connect(p); p.connect(out);
    this._send(g, this.verbIn, 0.25);
  };
  /** Riser: noise sweeping up + a high sine climbing two octaves (kept above E6). */
  P._riser = function (t, dur, vel, out) {
    var n = this._noise(t, dur + 0.05), hp = this._f('highpass', 2400, 0.7), bp = this._f('bandpass', 2600, 1.4), g = this._g(0);
    bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(12000, t + dur);
    g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(vel, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
    this._send(g, this.verbIn, 0.3);
    var o = this._osc('sine', 1450, t, t + dur + 0.05), og = this._g(0);
    o.frequency.exponentialRampToValueAtTime(5800, t + dur);
    og.gain.setValueAtTime(0.0003, t); og.gain.exponentialRampToValueAtTime(vel * 0.16, t + dur);
    og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
    o.connect(og); og.connect(out); this._send(og, this.echoIn, 0.3);
  };
  /** Downlifter: noise sweeping down after a drop ends. */
  P._downlifter = function (t, dur, vel, out) {
    var n = this._noise(t, dur + 0.05), hp = this._f('highpass', 3000, 0.7), bp = this._f('bandpass', 11000, 1.2), g = this._g(0);
    bp.frequency.setValueAtTime(11000, t); bp.frequency.exponentialRampToValueAtTime(3200, t + dur);
    this._perc(g.gain, t, vel, 0.01, dur * 0.35);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
    this._send(g, this.verbIn, 0.4);
  };

  /*
   * ---- melodic voices ----
   * Mic-safety rules for everything tonal (all of it sits at E6 and above):
   *  R1 one tonal line at a time (arp OR lead OR bell melody), and each note has decayed
   *     ~25 dB before the next one starts; anything playing alongside it is resonant noise
   *     ("breath" plucks, twinkles, pads);
   *  R2 where a quiet tonal double is unavoidable it sits above the main line;
   *  R3 harmony (pads, swells, stabs) is resonant noise, never a chord of pure tones,
   *     because stacked high tones add up to a "missing fundamental" in the piano range;
   *  R4 echo and reverb returns are high-passed and kept well below the dry sound.
   */

  /** Plucked synth: detuned saw + square through a snappy low-pass envelope. */
  P._pluck = function (midi, t, dur, vel, pan, m, wave) {
    var f = mtof(midi), end = t + dur * 2.5 + 0.1;
    var a = this._osc(wave || 'sawtooth', f, t, end, -6), b = this._osc('square', f, t, end, 6);
    var bg = this._g(0.45), lp = this._f('lowpass', f * 7, 1.6), g = this._g(0), p = this._pan(pan, t);
    lp.frequency.setValueAtTime(Math.min(16000, f * 7), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + Math.max(0.08, dur * 0.8));
    this._perc(g.gain, t, vel, 0.002, Math.max(0.022, dur * 0.35));
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(p); p.connect(m.duck);
    this._send(g, this.echoIn, m.echoSend);
    this._send(g, this.verbIn, 0.22);
  };
  /** Glassy FM keys (modulator at 2× keeps every sideband on the harmonic series). */
  P._glass = function (midi, t, dur, vel, pan, out, echo, verb, fxSpace) {
    var f = mtof(midi), end = t + dur * 3 + 0.2;
    var car = this._osc('sine', f, t, end), mod = this._osc('sine', f * 2, t, end), mg = this._g(0);
    mg.gain.setValueAtTime(f * 1.4, t); mg.gain.setTargetAtTime(f * 0.08, t, dur * 0.35);
    mod.connect(mg); mg.connect(car.frequency);
    var g = this._g(0), p = this._pan(pan, t);
    this._perc(g.gain, t, vel, 0.003, dur * 0.36);
    car.connect(g); g.connect(p); p.connect(out);
    this._send(g, fxSpace ? this.sfxEchoIn : this.echoIn, echo);
    this._send(g, fxSpace ? this.sfxVerbIn : this.verbIn, verb == null ? 0.3 : verb);
    return g;
  };
  /** FM bell (inharmonic 3.5:1 modulator, every sideband above the carrier). */
  P._bell = function (midi, t, dur, vel, pan, out, echo, verb, fxSpace) {
    var f = mtof(midi), end = t + dur * 3 + 0.3;
    var car = this._osc('sine', f, t, end), mod = this._osc('sine', f * 3.5, t, end), mg = this._g(0);
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.setTargetAtTime(f * 0.05, t, dur * 0.4);
    mod.connect(mg); mg.connect(car.frequency);
    var g = this._g(0), p = this._pan(pan, t);
    this._perc(g.gain, t, vel, 0.002, dur * 0.45);
    car.connect(g); g.connect(p); p.connect(out);
    this._send(g, fxSpace ? this.sfxEchoIn : this.echoIn, echo);
    this._send(g, fxSpace ? this.sfxVerbIn : this.verbIn, verb == null ? 0.45 : verb);
    return g;
  };
  /** Tiny star twinkle (resonant noise, so it can sparkle over anything). */
  P._ping = function (midi, t, vel, pan, out) {
    var n = this._noise(t, 1.0), bp = this._f('bandpass', mtof(midi), 40), g = this._g(0), p = this._pan(pan, t);
    this._perc(g.gain, t, vel * 10, 0.004, 0.16);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(out);
    this._send(g, this.echoIn, 0.6);
    this._send(g, this.verbIn, 0.5);
  };
  /** Breath pluck: a pitched puff of resonant noise — an arp that never forms chords with the lead. */
  P._breath = function (midi, t, dur, vel, pan, m) {
    var f = mtof(midi), n = this._noise(t, dur * 3 + 0.1);
    var bp = this._f('bandpass', f, 38), bp2 = this._f('bandpass', f * 2, 30), g2 = this._g(0.35), g = this._g(0), p = this._pan(pan, t);
    this._perc(g.gain, t, vel * 10, 0.003, Math.max(0.03, dur * 0.4));
    n.connect(bp); n.connect(bp2); bp2.connect(g2); bp.connect(g); g2.connect(g); g.connect(p); p.connect(m.duck);
    this._send(g, this.echoIn, m.echoSend);
    this._send(g, this.verbIn, 0.25);
  };
  /** Lead: detuned saw pair, scooped into pitch, delayed vibrato, soft low-pass. */
  P._lead = function (midi, t, dur, vel, m, wave) {
    var f = mtof(midi), end = t + dur + 0.35;
    var a = this._osc(wave || 'sawtooth', f, t, end, -9), b = this._osc(wave || 'sawtooth', f, t, end, 9);
    var scoop = -45;
    a.detune.setValueAtTime(-9 + scoop, t); a.detune.linearRampToValueAtTime(-9, t + 0.035);
    b.detune.setValueAtTime(9 + scoop, t); b.detune.linearRampToValueAtTime(9, t + 0.035);
    var lfo = this._osc('sine', 5.4, t, end), lg = this._g(0);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + 0.12); lg.gain.linearRampToValueAtTime(18, t + 0.4);
    lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune);
    var lp = this._f('lowpass', 5200, 0.8), g = this._g(0);
    lp.frequency.setValueAtTime(7500, t); lp.frequency.setTargetAtTime(4200, t, 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.setTargetAtTime(vel * 0.72, t + 0.012, 0.12);
    g.gain.setValueAtTime(vel * 0.72, t + dur);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(m.duck);
    this._send(g, this.echoIn, 0.38);
    this._send(g, this.verbIn, 0.3);
  };
  /**
   * Breath pad: every chord tone is resonant noise (air blown through glass), plus a softer
   * octave above, spread across the stereo field. Noise on purpose: a chord of pure tones up
   * here adds up to a "missing fundamental" inside the piano range that the pitch detector
   * would hear; resonant noise has no stable period.
   */
  P._pad = function (midis, t, dur, vel, m, bright) {
    var att = Math.min(dur * 0.35, 1.2), rel = Math.min(1.4, dur * 0.4), end = t + dur + rel * 5;
    var q = bright ? 24 : 34, g = this._g(0), k = Math.sqrt(q) * 1.7;
    for (var i = 0; i < midis.length; i++) {
      var spread = midis.length > 1 ? (i / (midis.length - 1)) * 2 - 1 : 0;
      for (var o = 0; o < 2; o++) {
        var midi = midis[i] + 12 * o;
        if (midi > 110) continue;
        var n = this._noise(t, end - t), bp = this._f('bandpass', mtof(midi), q), vg = this._g((o ? 0.5 : 1) * k);
        var p = this._pan(spread * (o ? -0.5 : 0.8), t);
        n.connect(bp); bp.connect(vg); vg.connect(p); p.connect(g);
      }
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + att);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.setTargetAtTime(0.0001, t + dur, rel);
    g.connect(m.duck);
    this._send(g, this.verbIn, 0.45);
  };
  /** Airy breath under the pads (band-passed noise, well above the mic band). */
  P._air = function (t, dur, vel, out) {
    var n = this._noise(t, dur + 0.6), hp = this._f('highpass', 3500, 0.7), bp = this._f('bandpass', 7000, 0.7), g = this._g(0);
    bp.frequency.setValueAtTime(5200, t); bp.frequency.linearRampToValueAtTime(9000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
    this._send(g, this.verbIn, 0.5);
  };

  /* ------------------------------------------------------------------ */
  /* Music: one produced track per level                                  */
  /* Sub below E2, drums, and shimmering synths from E6 up — the piano's  */
  /* register stays empty so the microphone hears the student.            */
  /* ------------------------------------------------------------------ */
  var CHORDS = {
    M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], M9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
    add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], '7': [0, 4, 7, 10], '9': [0, 4, 7, 10, 14],
    '6': [0, 4, 7, 9], m6: [0, 3, 7, 9]
  };
  var SCALES = {
    ionian: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11]
  };
  // Drum grooves: one digit per 16th step, 0–9 = velocity. kickB = alternate bar.
  var GROOVES = {
    house:     { kick: '9000900090009000', clap: '0000900000009000', chat: '5030503050305030', ohat: '0070007000700070', shaker: '3535353535353535', ride: '0000000000000000' },
    garage:    { kick: '9000000000900000', kickB: '9000000700900000', clap: '0000900000009000', chat: '6040604060406040', ohat: '0000000000000060', shaker: '0303030303030303', ride: '0000000000000000' },
    synthwave: { kick: '9000900090009000', clap: '0000900000009000', snare: '0000900000009000', chat: '6040604060406040', ohat: '0000000000000000', shaker: '0000000000000000', ride: '5050505050505050' },
    breaks:    { kick: '9000007000900000', kickB: '9000000090070000', snare: '0000900300009003', clap: '0000600000006000', chat: '6030603060306030', ohat: '0000000000000050', shaker: '0202020202020202', ride: '0000000000000000' },
    trance:    { kick: '9000900090009000', clap: '0000900000009000', chat: '4343434343434343', ohat: '0080008000800080', shaker: '0000000000000000', ride: '0060006000600060' },
    title:     { kick: '7000000000000000', kickB: '7000000060000000', clap: '0000000000000000', chat: '0000000000000000', ohat: '0000000000000000', shaker: '3020302030203020', ride: '0000000000000000' }
  };
  // Sub-bass rhythms: [step, length in 16ths, velocity]. Notes never overlap.
  var BASS = {
    offbeat: [[2, 1.8, 0.9], [6, 1.8, 0.8], [10, 1.8, 0.9], [14, 1.8, 0.8]],
    garage: [[0, 5, 1], [6, 3, 0.75], [10, 5, 0.95]],
    pulse8: [[0, 1.5, 1], [2, 1.5, 0.65], [4, 1.5, 0.85], [6, 1.5, 0.65], [8, 1.5, 0.95], [10, 1.5, 0.65], [12, 1.5, 0.85], [14, 1.5, 0.65]],
    rolling: [[1, 0.85, 0.7], [2, 0.85, 0.85], [3, 0.85, 0.7], [5, 0.85, 0.7], [6, 0.85, 0.85], [7, 0.85, 0.7], [9, 0.85, 0.7], [10, 0.85, 0.85], [11, 0.85, 0.7], [13, 0.85, 0.7], [14, 0.85, 0.85], [15, 0.85, 0.7]],
    sustain: [[0, 15.4, 1]]
  };
  // Lead-hook rhythms (per bar): [step, length].
  var HOOK_RHYTHMS = [
    [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
    [[0, 2], [2, 2], [4, 3], [7, 3], [10, 2], [12, 4]],
    [[0, 6], [6, 2], [8, 3], [11, 3], [14, 2]],
    [[0, 3], [4, 2], [6, 2], [8, 6], [14, 2]],
    [[0, 2], [3, 2], [6, 4], [10, 2], [12, 2], [14, 2]]
  ];
  var TITLE_RHYTHM = [[0, 6], [6, 2], [8, 7]];

  /*
   * The twelve level tracks: key, progression, groove and sounds all differ, and the
   * tempo and intensity climb with the level. Progressions are [degree, chord].
   */
  var SONGS = [
    { name: 'Nebula Drift', bpm: 100, key: 9, scale: 'aeolian', prog: [[0, 'm9'], [8, 'M7'], [3, 'M9'], [10, 'add9']], groove: 'garage', bass: 'garage', swing: 0.16, arp: { pat: [0, 2, 1, 3, 2, 4, 3, 1], rate: 2, voice: 'glass' }, lead: 'bell', hook: 3, seed: 11 },
    { name: 'Aurora', bpm: 104, key: 2, scale: 'dorian', prog: [[0, 'm9'], [5, '9'], [3, 'M7'], [10, 'add9']], groove: 'house', bass: 'offbeat', swing: 0.08, arp: { pat: [0, 1, 2, 3, 4, 3, 2, 1], rate: 2, voice: 'pluck' }, lead: 'glass', hook: 1, seed: 23 },
    { name: 'Warp Drive', bpm: 108, key: 4, scale: 'aeolian', prog: [[0, 'madd9'], [8, 'M7'], [3, 'add9'], [10, 'sus2']], groove: 'synthwave', bass: 'pulse8', swing: 0, arp: { pat: [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 4], rate: 1, voice: 'saw' }, lead: 'saw', hook: 0, seed: 31 },
    { name: 'Crystal Rain', bpm: 110, key: 6, scale: 'aeolian', prog: [[0, 'm9'], [8, 'M9'], [3, 'add9'], [10, '6']], groove: 'garage', bass: 'garage', swing: 0.18, arp: { pat: [4, 1, 3, 0, 2, 5, 1, 3], rate: 1, voice: 'glass' }, lead: 'bell', hook: 4, seed: 47 },
    { name: 'Ocean of Light', bpm: 112, key: 1, scale: 'lydian', prog: [[0, 'M9'], [2, 'add9'], [4, 'm7'], [9, 'm9']], groove: 'house', bass: 'offbeat', swing: 0.1, arp: { pat: [0, 2, 4, 2, 1, 3, 5, 3], rate: 1, voice: 'pluck' }, lead: 'glass', hook: 2, seed: 53 },
    { name: 'Solar Wind', bpm: 116, key: 0, scale: 'aeolian', prog: [[0, 'madd9'], [8, 'M7'], [3, 'add9'], [10, 'sus2']], groove: 'synthwave', bass: 'pulse8', swing: 0, arp: { pat: [0, 1, 2, 1, 3, 2, 4, 3], rate: 1, voice: 'saw' }, lead: 'saw', hook: 1, seed: 61 },
    { name: 'Constellations', bpm: 118, key: 7, scale: 'ionian', prog: [[0, 'add9'], [7, 'add9'], [9, 'm7'], [5, 'M9']], groove: 'trance', bass: 'offbeat', swing: 0, arp: { pat: [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 2, 1, 3], rate: 1, voice: 'pluck' }, lead: 'glass', hook: 0, seed: 71 },
    { name: 'Firefly Garden', bpm: 120, key: 10, scale: 'ionian', prog: [[9, 'm9'], [5, 'M7'], [0, 'add9'], [7, 'sus4']], groove: 'garage', bass: 'garage', swing: 0.13, arp: { pat: [0, 3, 1, 4, 2, 5, 3, 1], rate: 1, voice: 'square' }, lead: 'bell', hook: 4, seed: 83 },
    { name: 'Double Helix', bpm: 122, key: 11, scale: 'aeolian', prog: [[0, 'm7'], [8, 'M7'], [3, 'add9'], [10, '6']], groove: 'breaks', bass: 'rolling', swing: 0.06, arp: { pat: [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 3], rate: 1, voice: 'saw' }, lead: 'saw', hook: 2, seed: 97 },
    { name: 'Cosmic Bloom', bpm: 124, key: 3, scale: 'ionian', prog: [[0, 'M9'], [9, 'm9'], [5, 'M7'], [7, 'add9']], groove: 'house', bass: 'offbeat', swing: 0.07, arp: { pat: [0, 1, 2, 3, 4, 5, 4, 3], rate: 1, voice: 'pluck' }, lead: 'bell', hook: 3, seed: 101 },
    { name: 'Hyperspace', bpm: 128, key: 1, scale: 'aeolian', prog: [[0, 'm9'], [8, 'M7'], [3, 'add9'], [10, 'sus2']], groove: 'trance', bass: 'rolling', swing: 0, arp: { pat: [0, 1, 2, 3, 4, 3, 2, 1, 1, 2, 3, 4, 5, 4, 3, 2], rate: 1, voice: 'saw' }, lead: 'saw', hook: 1, seed: 113 },
    { name: 'Supernova', bpm: 132, key: 2, scale: 'harmonic', prog: [[0, 'm9'], [10, 'M7'], [5, 'm7'], [7, '7']], groove: 'breaks', bass: 'rolling', swing: 0, arp: { pat: [0, 2, 4, 2, 1, 3, 5, 3, 2, 4, 6, 4, 3, 5, 6, 5], rate: 1, voice: 'saw' }, lead: 'saw', hook: 0, seed: 127 }
  ];
  // Title: calm and majestic (I – vi – IV – V, two bars per chord).
  var TITLE_SONG = { name: 'Clef Command', title: true, bpm: 84, key: 2, scale: 'ionian', prog: [[0, 'M9'], [9, 'm9'], [5, 'M9'], [7, 'add9']], chordBars: 2, groove: 'title', bass: 'sustain', swing: 0, arp: { pat: [0, 2, 1, 3, 2, 4, 3, 5], rate: 2, voice: 'glass' }, lead: 'bell', hook: 0, seed: 5 };

  function digit(str, s) { var c = str ? str.charCodeAt(s) - 48 : 0; return c > 0 ? c / 9 : 0; }

  function chordOf(song, bar) {
    var prog = song.prog, c = prog[Math.floor(bar / (song.chordBars || 1)) % prog.length];
    var root = mod12(song.key + c[0]), iv = CHORDS[c[1]] || CHORDS.M;
    var pcs = [];
    iv.forEach(function (x) { var pc = mod12(root + x); if (pcs.indexOf(pc) < 0) pcs.push(pc); });
    return { root: root, iv: iv, pcs: pcs, triad: [root, mod12(root + iv[1]), mod12(root + iv[2])] };
  }
  /** Sub-bass note for a chord root: E1 … D#2, never above E2. */
  function subMidi(pc) { return 28 + mod12(pc - 4); }
  /** Close chord voicing between G6 and F#7. */
  function padVoicing(ch) {
    return ch.pcs.slice(0, 4).map(function (pc) { return above(pc, CHORD_LO); }).sort(function (a, b) { return a - b; });
  }
  /** Ascending chord tones from `lo` (default E6) over about 1.5 octaves, for arpeggios. */
  function arpNotes(ch, lo) {
    var out = [], base = lo || E6, top = base + 18;
    for (var o = 0; o < 2; o++) ch.pcs.forEach(function (pc) { var m = above(pc, base) + 12 * o; if (m <= top) out.push(m); });
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * Generate a singable lead hook for a song: chord tones on strong beats,
   * stepwise scale motion in between, a cadence on the last bar.
   */
  function makeHook(song) {
    var r = rng(song.seed || 7), scale = SCALES[song.scale].map(function (x) { return mod12(x + song.key); });
    var ladder = [];
    for (var mm = 88; mm <= 102; mm++) if (scale.indexOf(mod12(mm)) >= 0) ladder.push(mm);
    var rhythm = song.title ? TITLE_RHYTHM : HOOK_RHYTHMS[(song.hook || 0) % HOOK_RHYTHMS.length];
    var bars = [], nBars = 4 * (song.chordBars || 1), prev = 3, dir = 1;
    for (var b = 0; b < nBars; b++) {
      var ch = chordOf(song, b), notes = [];
      var rh = rhythm;
      if (b === nBars - 1) { rh = rhythm.slice(0, 2).concat([[rhythm[2][0], 16 - rhythm[2][0] - 1]]); }
      for (var i = 0; i < rh.length; i++) {
        var s = rh[i][0], strong = s % 8 === 0;
        var idx;
        if (strong) {
          // nearest chord tone to where the melody is, nudged by a coin toss so phrases differ
          var best = -1, bestD = 99;
          for (var k = 0; k < ladder.length; k++) {
            if (ch.pcs.indexOf(mod12(ladder[k])) < 0) continue;
            var d = Math.abs(k - prev) + (k === prev && b > 0 ? 0.6 : 0) + r() * 0.8;
            if (d < bestD) { bestD = d; best = k; }
          }
          idx = best < 0 ? prev : best;
        } else {
          if (r() < 0.25) dir = -dir;
          idx = prev + dir * (r() < 0.7 ? 1 : 2);
          if (idx < 1 || idx > ladder.length - 2) { dir = -dir; idx = clamp(prev + dir, 0, ladder.length - 1); }
        }
        notes.push({ s: s, len: rh[i][1], midi: ladder[idx] });
        prev = idx;
      }
      if (b === nBars - 1) {
        // cadence: land on the nearest root or third
        var lastN = notes[notes.length - 1], li = ladder.indexOf(lastN.midi), bestL = li, bestLD = 99;
        for (var q = 0; q < ladder.length; q++) {
          var pcq = mod12(ladder[q]);
          if ((pcq === ch.root || pcq === ch.triad[1]) && Math.abs(q - li) < bestLD) { bestLD = Math.abs(q - li); bestL = q; }
        }
        lastN.midi = ladder[bestL];
      }
      bars.push(notes);
    }
    return bars;
  }

  /** Arrangement: intro → groove → build → drop → drop 2 → breakdown → groove … (8-bar sections). */
  function sectionAt(bar, title) {
    if (title) return { type: Math.floor(bar / 8) % 2 ? 'B' : 'A', idx: bar % 8, len: 8 };
    if (bar < 4) return { type: 'intro', idx: bar, len: 4 };
    var b = (bar - 4) % 36;
    if (b < 8) return { type: 'groove', idx: b, len: 8 };
    if (b < 16) return { type: 'build', idx: b - 8, len: 8 };
    if (b < 24) return { type: 'drop', idx: b - 16, len: 8 };
    if (b < 32) return { type: 'drop2', idx: b - 24, len: 8 };
    return { type: 'break', idx: b - 32, len: 4 };
  }
  var ENERGY = { intro: 0.3, groove: 0.62, build: 0.75, drop: 1, drop2: 1, 'break': 0.35, A: 0.3, B: 0.5 };

  P.startMusic = function (mode, levelIdx) {
    if (!this.ready) return;
    this.stopMusic(0.35);
    var ctx = this.ctx, title = mode === 'title';
    var lvl = clamp(levelIdx | 0, 0, SONGS.length - 1);
    var song = title ? TITLE_SONG : SONGS[lvl];
    var now = ctx.currentTime, t0 = now + 0.1, spb = 60 / song.bpm;
    var out = this._g(0);   // fade / pause gain
    out.gain.setValueAtTime(0.0001, now); out.gain.setTargetAtTime(1, now, 0.04);
    var bus = this._g(1); bus.connect(out); out.connect(this.musicBus);
    var lp = this._f('lowpass', 9000, 0.7);  // section filter sweeps on the melodic parts
    var duck = this._g(1);                    // sidechain pump (kick-triggered)
    duck.connect(lp); lp.connect(bus);
    var drums = this._g(1); drums.connect(bus);
    // One sine runs the whole track for the sub; envelopes shape the notes.
    var sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(mtof(subMidi(chordOf(song, 0).root)), now);
    var subEnv = this._g(0), subDuck = this._g(1);
    var subLp = this._f('lowpass', 110, 0.5), subLp2 = this._f('lowpass', 110, 0.5);
    sub.connect(subEnv); subEnv.connect(subDuck); subDuck.connect(subLp); subLp.connect(subLp2); subLp2.connect(bus);
    sub.start(now);
    this.echo.setTime(spb * 0.75, now);
    var m = this.music = {
      song: song, title: title, level: lvl, I: title ? 0.15 : lvl / 11,
      tempo: song.bpm, spb: spb, s16: spb / 4, t0: t0, step: 0, nextTime: t0,
      out: out, bus: bus, lp: lp, duck: duck, drums: drums,
      sub: sub, subEnv: subEnv, subDuck: subDuck, subOn: false,
      hook: makeHook(song), rnd: rng((song.seed || 1) * 7 + 3),
      echoSend: title ? 0.42 : 0.3, pausedAt: null, timer: null
    };
    var tonic = chordOf(song, 0);
    this._key = { root: song.key, tones: tonic.triad.slice(), scale: song.scale };
    if (!this.offline) {
      var self = this;
      m.timer = setInterval(function () { self._schedule(); }, TICK_MS);
      this._schedule();
      if (!title) this._prefetchPiece(lvl);
    }
  };

  P.stopMusic = function (fade) {
    var m = this.music;
    this.music = null;
    if (!m || !this.ctx) return;
    if (m.timer) clearInterval(m.timer);
    var t = this.ctx.currentTime, f = fade == null ? 0.5 : Math.max(0.02, fade);
    var g = m.out.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(m.pausedAt != null ? 0.0001 : g.value, t); g.linearRampToValueAtTime(0.0001, t + f);
    try { m.sub.stop(t + f + 0.05); } catch (e) { /* ignore */ }
    var out = m.out;
    if (!this.offline) setTimeout(function () { try { out.disconnect(); } catch (e) { /* ignore */ } }, (f + 1.5) * 1000);
  };

  /** Pause the track without suspending the context (menu sounds keep working). */
  P.setMusicPaused = function (paused) {
    if (!this.ctx) return;
    var m = this.music, t = this.ctx.currentTime;
    if (!paused) this.resume();
    if (!m) return;
    if (paused) {
      if (m.pausedAt != null) return;
      m.pausedAt = t;
      if (m.timer) { clearInterval(m.timer); m.timer = null; }
      m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(m.out.gain.value, t); m.out.gain.setTargetAtTime(0.0001, t, 0.03);
    } else {
      if (m.pausedAt == null) return;
      // Re-schedule from the step where we paused; shift the clock by the pause length.
      var resumeStep = Math.max(0, Math.ceil((m.pausedAt - m.t0) / m.s16 - 1e-6));
      m.t0 += (t + 0.06) - m.pausedAt;
      m.step = resumeStep; m.nextTime = m.t0 + resumeStep * m.s16;
      m.pausedAt = null;
      m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(0.0001, t); m.out.gain.setTargetAtTime(1, t + 0.05, 0.05);
      if (!this.offline) {
        var self = this;
        m.timer = setInterval(function () { self._schedule(); }, TICK_MS);
        this._schedule();
      }
    }
  };

  /** Beat clock for visuals: { beat, pulse (1 on the beat → 0), bar, tones (chord pitch classes), energy, section }. */
  P.beat = function () {
    var m = this.music;
    if (!m || !this.ctx) return { beat: 0, pulse: 0, bar: 0, tones: this._key.tones.slice(), energy: 0, section: 'none' };
    var now = m.pausedAt != null ? m.pausedAt : this.ctx.currentTime;
    var b = Math.max(0, (now - m.t0) / m.spb);
    var frac = b - Math.floor(b), bar = Math.floor(b / 4);
    var sec = sectionAt(bar, m.title), e = ENERGY[sec.type] || 0.5;
    if (sec.type === 'build') e = 0.62 + 0.38 * ((sec.idx * 4 + (b % 4)) / 32);
    return { beat: b, pulse: now >= m.t0 ? Math.exp(-frac * 5) : 0, bar: bar, tones: chordOf(m.song, bar).triad, energy: e, section: sec.type };
  };

  /** Look-ahead scheduler (call often). `until` lets tests render a whole passage offline. */
  P._schedule = function (until) {
    var m = this.music;
    if (!m || !this.ctx || m.pausedAt != null) return;
    var now = this.ctx.currentTime, ahead = until != null ? until : now + LOOKAHEAD;
    // After a stall (background tab, slow device) skip missed steps rather than play them all at once.
    if (until == null && m.nextTime < now - 0.05) {
      m.step = Math.ceil((now - m.t0) / m.s16); m.nextTime = m.t0 + m.step * m.s16;
    }
    while (m.nextTime < ahead) {
      try { this._step(m, m.step, m.nextTime); } catch (e) {
        if (!this._stepErr) { this._stepErr = true; if (window.console) console.warn('music step failed', e); }
      }
      m.step++;
      m.nextTime = m.t0 + m.step * m.s16;
    }
  };

  /** Sidechain pump: synths and sub dip on every kick and swell back. */
  P._pump = function (m, t, depth) {
    var g = m.duck.gain;
    g.setTargetAtTime(1 - depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.03, m.spb * 0.16);
    var s = m.subDuck.gain;
    s.setTargetAtTime(0.2, t, 0.003);
    s.setTargetAtTime(1, t + 0.05, m.spb * 0.1);
  };
  P._subNote = function (m, midi, t, dur, vel) {
    var f = m.sub.frequency, g = m.subEnv.gain;
    f.setTargetAtTime(mtof(Math.min(midi, 40)), t, 0.008);
    g.setTargetAtTime(vel, t, 0.006);
    g.setTargetAtTime(vel * 0.82, t + 0.04, 0.12);
    g.setTargetAtTime(0, t + dur, 0.018);
  };

  /** Filter moves that shape each section (melodic parts only). */
  P._sectionFilter = function (m, type, t, dur) {
    var f = m.lp.frequency, from = 9000, to = 9000;
    if (type === 'intro') { from = 1900; to = 8000; }
    else if (type === 'groove') { from = 7000; to = 10000; }
    else if (type === 'build') { from = 4000; to = 17000; }
    else if (type === 'drop' || type === 'drop2') { from = 17000; to = 17000; }
    else if (type === 'break') { from = 2400; to = 7000; }
    else if (type === 'A') { from = 3500; to = 7000; }
    else if (type === 'B') { from = 7000; to = 11000; }
    f.cancelScheduledValues(t);
    f.setValueAtTime(from, t);
    f.exponentialRampToValueAtTime(to, t + dur);
  };

  /** Reverse swell into a section: the next chord fades in backwards and stops on the downbeat. */
  P._swell = function (midis, t, dur, vel, out) {
    var g = this._g(0), q = 26, k = Math.sqrt(q) * 1.7;
    for (var i = 0; i < midis.length; i++) {
      var n = this._noise(t, dur + 0.02), bp = this._f('bandpass', mtof(midis[i]), q), vg = this._g(k);
      var p = this._pan((i / Math.max(1, midis.length - 1)) * 1.4 - 0.7, t);
      n.connect(bp); bp.connect(vg); vg.connect(p); p.connect(g);
    }
    g.gain.setValueAtTime(0.0003, t);
    g.gain.exponentialRampToValueAtTime(vel, t + dur - 0.008);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    this._send(g, this.verbIn, 0.35);
  };

  /** One 16th-note step of the arrangement. */
  P._step = function (m, step, t) {
    var song = m.song, s16 = m.s16, spb = m.spb;
    var bar = Math.floor(step / 16), s = step % 16;
    var sec = sectionAt(bar, m.title), type = sec.type, I = m.I;
    var ch = chordOf(song, bar), G = GROOVES[song.groove], barB = bar % 2 === 1;
    var ts = t + (s % 2 === 1 ? (song.swing || 0) * s16 : 0); // swung off-16ths
    var full = type === 'drop' || type === 'drop2';
    var chordBars = song.chordBars || 1;
    var barDur = 16 * s16;

    if (s === 0) this._barFx(m, sec, t, bar, ch);
    if (m.title) { this._titleStep(m, sec, bar, s, t, ts, ch, G, barB); return; }

    var drumsOn = type === 'groove' || type === 'build' || full;
    var cut = type === 'build' && sec.idx === 7 && s >= 8; // the build's last two beats drop out
    var lastBuildBar = type === 'build' && sec.idx === 7;

    /* --- drums --- */
    var kv = digit(barB && G.kickB ? G.kickB : G.kick, s);
    if (type === 'intro' && sec.idx >= 2 && I > 0.4) kv = s % 4 === 0 ? 0.55 : 0;          // later levels: pulse in the intro
    if (type === 'build' && sec.idx >= 6 && s % 4 === 0 && !cut) kv = Math.max(kv, 0.85);    // four on the floor into the drop
    if (kv && (drumsOn || type === 'intro') && !cut) {
      this._kick(t, 0.62 * kv, m.drums);
      this._pump(m, t, full ? 0.62 : 0.42);
    }
    if (drumsOn && !lastBuildBar && !(type === 'build' && sec.idx >= 4)) {
      var cv = digit(G.clap, s), sv = digit(G.snare, s);
      if (sv) this._snare(t, 0.26 * sv, m.drums, 0.3);
      if (cv) this._clap(t, 0.26 * cv, m.drums, full ? 0.4 : 0.3);
    }
    // build-up snare roll: 8ths → 16ths, brighter and louder toward the drop
    if (type === 'build' && sec.idx >= 4 && !cut) {
      var prog = ((sec.idx - 4) * 16 + s) / 64, every = sec.idx < 6 ? 2 : 1;
      if (s % every === 0) this._noiseHit(t, 0.06 + 0.2 * prog * prog, { hp: 3000 + 3500 * prog, tau: 0.035, pan: (s % 2 ? 0.2 : -0.2) }, m.drums);
    }
    var hv = digit(G.chat, s);
    if (hv && !cut) {
      var hatOn = drumsOn || (type === 'intro' && sec.idx >= 1) || type === 'break';
      if (I < 0.3 && s % 2 === 1 && !full) hatOn = false;
      if (hatOn) this._hat(ts, (type === 'intro' || type === 'break' ? 0.07 : 0.11) * hv, false, ((s % 4) - 1.5) * 0.18, m.drums);
    }
    var ov = digit(G.ohat, s);
    if (ov && drumsOn && !cut && (full || I > 0.15 || type === 'build')) this._hat(ts, 0.09 * ov, true, 0.3, m.drums);
    var shv = digit(G.shaker, s);
    if (shv && !cut && (full || (drumsOn && I > 0.3))) this._shaker(ts, 0.08 * shv, s % 2 ? 0.45 : -0.45, m.drums);
    var rv = digit(G.ride, s);
    if (rv && full) this._metal(ts, 0.035 * rv, 0.09, m.drums, -0.35);
    // extra percussion in the drops on busier levels: a bright off-beat tick
    if (full && I > 0.45 && (s === 3 || s === 11 || (I > 0.75 && s === 14))) this._noiseHit(ts, 0.08, { hp: 5000, type: 'bandpass', freq: 8500, q: 3, tau: 0.012, pan: s === 3 ? 0.55 : -0.55 }, m.drums);

    /* --- sub bass --- */
    var bpat = BASS[(type === 'intro' || type === 'break') ? 'sustain' : song.bass];
    if (!(type === 'intro' && sec.idx < 2) && !lastBuildBar) {
      for (var b = 0; b < bpat.length; b++) {
        if (bpat[b][0] !== s) continue;
        var bvel = (type === 'intro' || type === 'break' ? 0.2 : 0.28) * bpat[b][2];
        this._subNote(m, subMidi(ch.root), t, bpat[b][1] * s16, bvel);
      }
    }

    /* --- pads, air --- */
    if (s === 0 && bar % chordBars === 0) {
      var pv = { intro: 0.05, groove: 0.04, build: 0.042, drop: 0.045, drop2: 0.048, 'break': 0.06 }[type];
      this._pad(padVoicing(ch), t, chordBars * barDur, pv, m, full);
      if ((full || type === 'intro' || type === 'break') && bar % 2 === 0) this._air(t, barDur * 2, full ? 0.05 : 0.04, m.duck);
    }

    /* --- arpeggio --- */
    var A = song.arp, rate = A.rate;
    if (type === 'intro' || type === 'break') rate = 2;
    if (type === 'build' && sec.idx >= 6) rate = 1;
    var arpOn = !(type === 'intro' && sec.idx === 0);
    var leadOn = full || (type === 'groove' && I > 0.6 && sec.idx >= 4);
    if (arpOn && s % rate === 0) {
      // with a lead playing, the arp moves above it (D7 up) and stays softer (rule R2)
      var notes = arpNotes(ch, leadOn ? 98 : E6), k = Math.floor(step / rate);
      var midi = notes[A.pat[k % A.pat.length] % notes.length];
      var acc = s % 4 === 0 ? 1 : (s % 2 === 0 ? 0.8 : 0.65);
      var av = (type === 'intro' || type === 'break' ? 0.05 : 0.065) * acc * (leadOn ? 0.6 : 1);
      var pan = (k % 2 ? 0.38 : -0.38);
      if (leadOn || type === 'break') this._breath(midi, ts, rate * s16, av * 1.4, pan, m); // rule R1
      else if (A.voice === 'glass') this._glass(midi, ts, rate * s16, av * 1.3, pan, m.duck, m.echoSend, 0.25);
      else this._pluck(midi, ts, rate * s16 * 0.95, av, pan, m, A.voice === 'square' ? 'square' : 'sawtooth');
    }

    /* --- lead hook (drops; also the groove on later levels) --- */
    if (leadOn) {
      var hb = m.hook[sec.idx % m.hook.length];
      for (var h = 0; h < hb.length; h++) {
        if (hb[h].s !== s) continue;
        var n = hb[h], ld = n.len * s16, lv = type === 'groove' ? 0.7 : 1;
        if (song.lead === 'saw' || song.lead === 'square') this._lead(n.midi, ts, ld * 0.92, 0.05 * lv, m, song.lead === 'square' ? 'square' : 'sawtooth');
        else if (song.lead === 'bell') this._bell(n.midi, ts, ld, 0.085 * lv, 0, m.duck, 0.3, 0.4);
        else this._glass(n.midi, ts, ld, 0.09 * lv, 0, m.duck, 0.3, 0.35);
        // second drop: a sparkling octave double
        if (type === 'drop2' && n.midi + 12 <= 108) this._glass(n.midi + 12, ts + 0.004, ld * 0.8, 0.025, 0.25, m.duck, 0.3, 0.4);
      }
    }

    /* --- stars: high twinkles in the quiet sections --- */
    if ((type === 'intro' || type === 'break' || type === 'groove') && s % 2 === 0 && m.rnd() < (type === 'groove' ? 0.06 : 0.14)) {
      var tw = arpNotes(ch).filter(function (x) { return x >= 98; });
      if (tw.length) this._ping(tw[Math.floor(m.rnd() * tw.length)], ts, 0.04, m.rnd() * 1.4 - 0.7, m.duck);
    }
    // breakdown bells: slow chord-tone answers
    if (type === 'break' && (s === 0 || s === 10)) {
      var bn = arpNotes(ch).filter(function (x) { return x >= 95; });
      if (bn.length) this._bell(bn[(bar + (s ? 2 : 0)) % bn.length], t, 6 * s16, 0.045, s ? 0.4 : -0.4, m.duck, 0.35, 0.5);
    }
  };

  /** Bar-level arrangement moves: filters, crashes, risers, reverse swells. */
  P._barFx = function (m, sec, t, bar, ch) {
    var spb = m.spb, barDur = 4 * spb, I = m.I, type = sec.type;
    if (sec.idx === 0) {
      this._sectionFilter(m, type, t, sec.len * barDur);
      if (type === 'drop') { this._crash(t, 0.2 + 0.08 * I, m.drums); this._boom(t, 0.45, m.bus); }
      else if (type === 'drop2' || (type === 'groove' && bar > 4)) this._crash(t, 0.13, m.drums);
      else if (type === 'groove' || type === 'B') this._crash(t, 0.1, m.drums);
    }
    var nextT = t + barDur;
    if (sec.idx === sec.len - 1) {
      var nextCh = chordOf(m.song, bar + 1);
      if (type === 'build') {
        this._reverse(nextT - 2 * spb, 2 * spb, 0.12 + 0.05 * I, m.drums);
        this._swell(padVoicing(nextCh), nextT - 2 * spb, 2 * spb, 0.035, m.duck);
      } else if (type === 'intro' || type === 'break' || type === 'A') {
        this._reverse(nextT - 2 * spb, 2 * spb, 0.08, m.drums);
      } else if (type === 'drop2') {
        this._downlifter(nextT, barDur, 0.1, m.drums);
      } else if (type === 'groove') {
        this._reverse(nextT - spb, spb, 0.07, m.drums);
      }
    }
    if (type === 'build' && sec.idx === 4) this._riser(t, 4 * barDur, 0.09 + 0.04 * I, m.drums);
  };

  /** Title screen: wide pads, slow glass arps, a gentle heartbeat and a bell melody. */
  P._titleStep = function (m, sec, bar, s, t, ts, ch, G, barB) {
    var song = m.song, s16 = m.s16, B = sec.type === 'B';
    var barDur = 16 * s16;
    if (s === 0 && bar % 2 === 0) {
      this._pad(padVoicing(ch), t, 2 * barDur, 0.05, m, false);
      this._air(t, 2 * barDur, 0.035, m.duck);
    }
    if (s === 0) this._subNote(m, subMidi(ch.root), t, 15.6 * s16, B ? 0.24 : 0.17);
    if (B) {
      var kv = digit(barB ? G.kickB : G.kick, s);
      if (kv) { this._kick(t, 0.42 * kv, m.drums); this._pump(m, t, 0.25); }
      var sh = digit(G.shaker, s);
      if (sh) this._shaker(t, 0.06 * sh, s % 4 ? 0.4 : -0.4, m.drums);
      var hb = m.hook[sec.idx % m.hook.length];
      for (var h = 0; h < hb.length; h++) if (hb[h].s === s) this._bell(hb[h].midi, t, hb[h].len * s16, 0.075, 0, m.duck, 0.3, 0.5);
    }
    if (s % 2 === 0) {
      var notes = arpNotes(ch, B ? 98 : E6), k = Math.floor((bar * 16 + s) / 2);
      var midi = notes[song.arp.pat[k % song.arp.pat.length] % notes.length];
      var av = s % 8 === 0 ? 0.06 : 0.042, pan = k % 2 ? 0.45 : -0.45;
      if (B) this._breath(midi, t, 2 * s16, av * 0.8, pan, m);   // the bell melody is the tonal line here
      else this._glass(midi, t, 2 * s16, av, pan, m.duck, m.echoSend, 0.35);
    }
    if (s % 4 === 2 && m.rnd() < 0.3) {
      var tw = arpNotes(ch).filter(function (x) { return x >= 98; });
      if (tw.length) this._ping(tw[Math.floor(m.rnd() * tw.length)], t, 0.035, m.rnd() * 1.4 - 0.7, m.duck);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Sound effects                                                        */
  /* ------------------------------------------------------------------ */
  /** Play a named effect now. No-op until the context is running. */
  P.sfx = function (name, opt) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
    this._sfxAt(name, this.ctx.currentTime + 0.004, opt);
  };
  P._sfxAt = function (name, t, opt) {
    var fn = this['_sfx_' + name];
    if (typeof fn !== 'function') return;
    try { fn.call(this, t, opt || {}); } catch (e) {
      if (!this._sfxErr) { this._sfxErr = true; if (window.console) console.warn('sfx ' + name + ' failed', e); }
    }
  };
  /** Tell the pitch detector our own tonal sound is playing until `until`. */
  P._mark = function (until) { this.pitchedSfxUntil = Math.max(this.pitchedSfxUntil, until); };
  /** Effects output, optionally panned. */
  P._out = function (pan, t) {
    if (!pan) return this.sfxBus;
    var p = this._pan(pan, t); p.connect(this.sfxBus); return p;
  };
  /** Snap decorative sounds to the music's 32nd-note grid (at most `maxWait` late). */
  P._quantize = function (t, maxWait) {
    var m = this.music;
    if (!m || m.pausedAt != null) return t;
    var g = m.s16 / 2, k = Math.ceil((t - m.t0) / g - 1e-6), q = m.t0 + k * g;
    return q - t <= maxWait ? q : t;
  };
  /** Chord tones from `lo` to `hi` in the current harmony. */
  P._ladder = function (lo, hi) {
    var tones = this.beat().tones, out = [];
    for (var mm = lo; mm <= hi; mm++) if (tones.indexOf(mod12(mm)) >= 0) out.push(mm);
    return out;
  };
  /** A quick pitch glide (osc → gain), used by the in-band tonal effects. */
  P._glide = function (type, f0, f1, t, dur, peak, attack, out, curve) {
    var o = this._osc(type, f0, t, t + dur + 0.05), g = this._g(0);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    if (curve === 'swell') g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.92);
    else g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    return { osc: o, gain: g };
  };

  /* UI: a crisp tick and a short glassy blip (all above the mic band). */
  P._sfx_click = function (t) {
    this._noiseHit(t, 0.22, { hp: 5000, tau: 0.003 }, this.sfxBus);
    var o = this._osc('sine', 3300, t, t + 0.1), g = this._g(0);
    o.frequency.exponentialRampToValueAtTime(2500, t + 0.06);
    this._perc(g.gain, t, 0.12, 0.002, 0.016);
    o.connect(g); g.connect(this.sfxBus);
    var o2 = this._osc('sine', 6600, t, t + 0.05), g2 = this._g(0);
    this._perc(g2.gain, t, 0.03, 0.001, 0.008);
    o2.connect(g2); g2.connect(this.sfxBus);
    this._send(g, this.sfxVerbIn, 0.15);
  };
  /** UI hover: a whisper of the click. */
  P._sfx_hover = function (t) {
    var o = this._osc('sine', 4200, t, t + 0.06), g = this._g(0);
    this._perc(g.gain, t, 0.035, 0.003, 0.012);
    o.connect(g); g.connect(this.sfxBus);
  };

  /* Whoosh: two layers of air sweeping across the stereo field (+ a sub drop when going down). */
  P._sfx_whoosh = function (t, o) {
    var dur = clamp(o.dur || 1, 0.2, 3), up = o.up !== false;
    for (var k = 0; k < 2; k++) {
      var n = this._noise(t, dur + 0.3), f = this._f('bandpass', 500, k ? 2.2 : 0.8), g = this._g(0), p = this._pan(up ? -0.7 : 0.7, t);
      var lo = k ? 1400 : 300, hi = k ? 9000 : 3600;
      f.frequency.setValueAtTime(up ? lo : hi, t);
      f.frequency.exponentialRampToValueAtTime(up ? hi : lo, t + dur);
      if (p.pan) p.pan.linearRampToValueAtTime(up ? 0.7 : -0.7, t + dur);
      var peak = (k ? 0.12 : 0.26) * (up ? 1.8 : 1);
      g.gain.setValueAtTime(0.0001, t);
      if (up) { g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.08); }
      else { g.gain.linearRampToValueAtTime(peak, t + dur * 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1); }
      n.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxBus);
      this._send(g, this.sfxVerbIn, 0.3);
    }
    if (up) {
      var sh = this._glide('sine', 1500, 4800, t + dur * 0.2, dur * 0.8, 0.03, 0.01, this.sfxBus, 'swell');
      this._send(sh.gain, this.sfxEchoIn, 0.4);
    } else {
      var s = this._glide('sine', 72, 32, t + dur * 0.1, dur * 0.9, 0.35, 0.03, this.sfxBus);
    }
  };

  /* Knuckle cracks: tight clusters of tiny dry pops, each with a bony "tock" body. */
  P._sfx_crack = function (t, o) {
    var n = clamp(o.count || 3, 1, 8), tt = t;
    for (var i = 0; i < n; i++) {
      var v = 0.75 + Math.random() * 0.5, pan = (Math.random() - 0.5) * 0.5;
      var fc = 1700 + Math.random() * 2600;
      // the pop: a 1–3 ms resonant click
      this._noiseHit(tt, v * 0.7, { hp: 900, type: 'bandpass', freq: fc, q: 2.4, attack: 0.0004, tau: 0.0028, pan: pan }, this.sfxBus);
      // sharp crack on top
      this._noiseHit(tt, v * 0.45, { hp: 2500, attack: 0.0003, tau: 0.0012, pan: pan }, this.sfxBus);
      // a second micro-pop right behind it (joints rarely pop just once)
      if (Math.random() < 0.6) this._noiseHit(tt + 0.006 + Math.random() * 0.01, v * 0.35, { hp: 900, type: 'bandpass', freq: fc * 1.2, q: 2, attack: 0.0004, tau: 0.002, pan: pan }, this.sfxBus);
      // bony body
      var b = this._noise(tt, 0.05), lp = this._f('bandpass', 380 + Math.random() * 200, 1.4), bg = this._g(0);
      this._perc(bg.gain, tt, v * 0.5, 0.0008, 0.007);
      b.connect(lp); lp.connect(bg); bg.connect(this.sfxBus);
      tt += 0.022 + Math.random() * 0.05;
    }
  };

  /* Charge: a rising whine that swells from silence (so its pass through the mic band is
     tiny), crackling energy noise and a speeding tremolo. */
  P._sfx_charge = function (t, o) {
    var dur = clamp(o.dur || 0.2, 0.05, 0.7);
    this._mark(t + dur + 0.12);
    var out = this._g(1); out.connect(this.sfxBus);
    var a = this._glide('sawtooth', 900, 3600, t, dur + 0.03, 0.08, 0, out, 'swell');
    var b = this._glide('square', 1800, 7200, t, dur + 0.03, 0.03, 0, out, 'swell');
    var trem = this._osc('sine', 14, t, t + dur + 0.1), tg = this._g(0.5);
    trem.frequency.exponentialRampToValueAtTime(42, t + dur);
    out.gain.value = 0.6; trem.connect(tg); tg.connect(out.gain);
    var n = this._noise(t, dur + 0.05), bp = this._f('bandpass', 2500, 1.5), hp = this._f('highpass', 1800, 0.7), ng = this._g(0);
    bp.frequency.setValueAtTime(2500, t); bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    ng.gain.setValueAtTime(0.0005, t); ng.gain.exponentialRampToValueAtTime(0.16, t + dur); ng.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
    n.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
  };

  /* Laser: a bright dive from 2.8 kHz with a crisp transient and a high "zap", panned to the shooter
     and flying toward the centre. */
  P._sfx_laser = function (t, o) {
    var pan = clamp(o.pan || 0, -0.85, 0.85);
    this._mark(t + 0.2);
    var p = this._pan(pan, t);
    if (p.pan) p.pan.linearRampToValueAtTime(pan * 0.25, t + 0.18);
    p.connect(this.sfxBus);
    var bus = this._g(1); bus.connect(p);
    var a = this._osc('square', 2800, t, t + 0.2, 0), b = this._osc('sawtooth', 2100, t, t + 0.2, 0);
    a.frequency.exponentialRampToValueAtTime(360, t + 0.13);
    b.frequency.exponentialRampToValueAtTime(260, t + 0.13);
    var lp = this._f('lowpass', 7500, 0.9), g = this._g(0), bg = this._g(0.6);
    lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(2200, t + 0.13);
    this._perc(g.gain, t, 0.2, 0.002, 0.03);
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(bus);
    // zap sparkle (stays high)
    var z = this._glide('sine', 6200, 2600, t, 0.07, 0.09, 0.002, bus);
    this._noiseHit(t, 0.22, { hp: 4000, tau: 0.008 }, bus);
    this._send(z.gain, this.sfxEchoIn, 0.5);
  };

  /* Impact: sub thump + bright crack + collapsing body noise + wet goo splat + stereo debris. */
  P._sfx_explode = function (t, o) {
    var big = !!o.big, s = big ? 1.25 : 1;
    this._mark(t + 0.12);
    this._duck(t, big ? 0.45 : 0.25, 0.06, 0.3);
    // sub thump (in the band for only a few ms)
    var th = this._osc('sine', 115, t, t + 0.5), tg = this._g(0);
    th.frequency.exponentialRampToValueAtTime(52, t + 0.04); th.frequency.exponentialRampToValueAtTime(34, t + 0.35);
    this._perc(tg.gain, t, 0.75 * s, 0.002, big ? 0.16 : 0.11);
    th.connect(tg); tg.connect(this.sfxBus);
    // crack
    this._noiseHit(t, 0.3 * s, { hp: 1800, tau: 0.01 }, this.sfxBus);
    // body: broadband noise through a closing low-pass
    var n = this._noise(t, big ? 1.4 : 0.8), lp = this._f('lowpass', 3500, 0.7), g = this._g(0);
    lp.frequency.setValueAtTime(big ? 3000 : 4200, t); lp.frequency.exponentialRampToValueAtTime(140, t + (big ? 0.9 : 0.45));
    this._perc(g.gain, t, 0.32 * s, 0.003, big ? 0.22 : 0.12);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    this._send(g, this.sfxVerbIn, 0.25);
    // goo splat: a band-passed squelch diving fast
    var gn = this._noise(t + 0.012, 0.25), gb = this._f('bandpass', 2400, 4), gg = this._g(0);
    gb.frequency.setValueAtTime(2600, t + 0.012); gb.frequency.exponentialRampToValueAtTime(420, t + 0.15);
    this._perc(gg.gain, t + 0.012, 0.35 * s, 0.004, 0.04);
    gn.connect(gb); gb.connect(gg); gg.connect(this.sfxBus);
    // debris: tiny ticks scattered left and right
    for (var i = 0; i < (big ? 9 : 6); i++) {
      var dt = 0.03 + Math.random() * 0.25;
      this._noiseHit(t + dt, (0.05 + Math.random() * 0.06) * (1 - dt * 2), { hp: 3500, type: 'bandpass', freq: 4000 + Math.random() * 6000, q: 4, tau: 0.004, pan: Math.random() * 1.6 - 0.8 }, this.sfxBus);
    }
  };

  /* Glittery chime in the current chord. Successive hits climb a ladder of chord tones, so
     the player's hits play a melody with the music; snapped to the beat grid. The cascade
     falls top-down and each new (lower) note is the loudest thing ringing, so it never forms
     a chord the detector could hear as a "missing fundamental" in the piano range. */
  P._sfx_chime = function (t, o) {
    var n = clamp(o.count || 3, 1, 6), step = o.step || 0;
    var ladder = this._ladder(91, 110);
    if (!ladder.length) return;
    var span = Math.max(1, ladder.length - n + 1), start = step % span;
    t = this._quantize(t, 0.05);
    this._mark(t + n * 0.045 + 0.3);
    for (var i = 0; i < n; i++) {
      var midi = ladder[Math.min(ladder.length - 1, start + n - 1 - i)], last = i === n - 1;
      var tt = t + i * 0.045, pan = ((n - 1) / 2 - i) * 0.32;
      this._glass(midi, tt, last ? 0.5 : 0.11, 0.085 + i * 0.015, pan, this.sfxBus, last ? 0.3 : 0, 0.3, true);
    }
    this._noiseHit(t, 0.05, { hp: 7000, tau: 0.12, pan: 0.2 }, this.sfxBus); // glitter dust
  };

  /* Monster laugh "heh-heh-heh": a buzzy voice through gliding formants (eh → ah), each
     syllable sliding down, getting quicker and lower — cheeky, never a steady pitch. */
  P._sfx_laugh = function (t, o) {
    var n = clamp(o.count || 4, 2, 6), f0 = clamp(o.pitch || 240, 150, 400);
    var out = this._g(1); out.connect(this.sfxBus);
    var tt = t, gap = 0.16;
    for (var i = 0; i < n; i++) {
      var len = 0.13 - i * 0.008, hi = f0 * (1.34 - i * 0.05), lo = f0 * (0.74 - i * 0.04);
      var src = this._osc('sawtooth', hi, tt, tt + len + 0.04);
      src.frequency.exponentialRampToValueAtTime(lo, tt + len);
      var f1 = this._f('bandpass', 520, 5), f2 = this._f('bandpass', 1850, 7), f3 = this._f('bandpass', 2700, 9);
      f1.frequency.setValueAtTime(480, tt); f1.frequency.linearRampToValueAtTime(760, tt + len);
      f2.frequency.setValueAtTime(1900, tt); f2.frequency.linearRampToValueAtTime(1250, tt + len);
      var mix = this._g(1.5), m3 = this._g(0.5), g = this._g(0);
      src.connect(f1); src.connect(f2); src.connect(f3);
      f1.connect(mix); f2.connect(mix); f3.connect(m3); m3.connect(mix); mix.connect(g);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.28 * (1 - i * 0.1), tt + 0.014);
      g.gain.setTargetAtTime(0.0001, tt + 0.05, 0.03);
      var p = this._pan(Math.sin(i * 1.7) * 0.25, tt); g.connect(p); p.connect(out);
      // breathy "h"
      this._noiseHit(tt, 0.09, { hp: 1600, type: 'bandpass', freq: 3200, q: 0.8, tau: 0.018, attack: 0.004 }, out);
      tt += gap * (1 - i * 0.07);
    }
    this._mark(tt + 0.15);
  };

  /* Miss: a heavy, muffled hit — low boom, crunch, a shield shattering into glass shards,
     and a short power-down. Big but soft-edged (no harsh highs). */
  P._sfx_miss = function (t) {
    this._mark(t + 0.75);
    this._duck(t, 0.5, 0.3, 0.6);
    this._muffle(t, 1.1);
    this._boom(t, 0.85, this.sfxBus, 0.8);
    var n = this._noise(t, 0.9), lp = this._f('lowpass', 2600, 0.8), g = this._g(0);
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    this._perc(g.gain, t, 0.42, 0.004, 0.15);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus); this._send(g, this.sfxVerbIn, 0.3);
    // shards: falling glassy pings, all above the band
    for (var i = 0; i < 7; i++) {
      var tt = t + 0.02 + i * 0.035 + Math.random() * 0.02, f = 3200 + Math.random() * 3000;
      var s = this._glide('sine', f, f * 0.7, tt, 0.16, 0.035, 0.002, this._out(Math.random() * 1.6 - 0.8, tt));
      this._send(s.gain, this.sfxVerbIn, 0.4);
    }
    // power-down: quick downward glide, filtered soft
    var pd = this._osc('square', 520, t + 0.03, t + 0.6), pl = this._f('lowpass', 1400, 0.7), pg = this._g(0);
    pd.frequency.exponentialRampToValueAtTime(70, t + 0.5);
    pg.gain.setValueAtTime(0.0001, t + 0.03); pg.gain.linearRampToValueAtTime(0.08, t + 0.05); pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    pd.connect(pl); pl.connect(pg); pg.connect(this.sfxBus);
  };

  /* Wrong note: a soft "pfft" and a tiny high "nope" blip — never punishing. */
  P._sfx_fizzle = function (t) {
    var n = this._noise(t, 0.2), hp = this._f('highpass', 1200, 0.7), bp = this._f('bandpass', 5000, 2), g = this._g(0);
    bp.frequency.setValueAtTime(5500, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.13);
    this._perc(g.gain, t, 0.18, 0.004, 0.04);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    this._glide('triangle', 2700, 1750, t + 0.01, 0.09, 0.07, 0.003, this.sfxBus);
    this._glide('triangle', 2400, 1560, t + 0.085, 0.1, 0.05, 0.003, this.sfxBus);
  };

  /* Shield restored (between levels, mic off): a rising major arpeggio with a shimmer bed. */
  P._sfx_shield = function (t) {
    var root = 72 + mod12((this._key.root || 0) - 0);
    if (root > 77) root -= 12;
    var steps = [0, 4, 7, 11, 14, 16, 19, 24];
    for (var i = 0; i < steps.length; i++) {
      var tt = t + i * 0.055, pan = (i / (steps.length - 1)) * 1.2 - 0.6;
      this._glass(root + steps[i], tt, 0.7, 0.07 * (1 - i * 0.05), pan, this.sfxBus, 0, 0.3, true);
      this._bell(root + steps[i] + 12, tt + 0.01, 0.8, 0.015, -pan, this.sfxBus, 0.5, 0.3, true);
    }
    // shimmer bed
    var g = this._g(0), lp = this._f('lowpass', 6000, 0.5);
    [0, 7, 16, 24].forEach(function (x, k) {
      var o = this._osc('triangle', mtof(root + 12 + x), t, t + 1.8, (k - 1.5) * 7); o.connect(lp);
    }, this);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.4); g.gain.setTargetAtTime(0.0001, t + 0.8, 0.25);
    lp.connect(g); g.connect(this.sfxBus); this._send(g, this.sfxVerbIn, 0.6);
    this._sfx_whoosh(t, { dur: 0.6, up: true });
  };

  /* GO! (listening starts right after): an airy stab in the current chord made of resonant
     noise (no stable pitch), one bright bell on top, a sub hit and a wide crash. */
  P._sfx_go = function (t) {
    this._mark(t + 0.45);
    this._duck(t, 0.3, 0.12, 0.4);
    var tones = this.beat().tones, g = this._g(0), q = 18, k = Math.sqrt(q) * 1.7;
    for (var i = 0; i < tones.length; i++) {
      for (var o = 0; o < 2; o++) {
        var n = this._noise(t, 0.7), bp = this._f('bandpass', mtof(above(tones[i], 91) + 12 * o), q), vg = this._g(k * (o ? 0.6 : 1));
        var p = this._pan((i - 1) * 0.6 * (o ? -1 : 1), t);
        n.connect(bp); bp.connect(vg); vg.connect(p); p.connect(g);
      }
    }
    this._perc(g.gain, t, 0.12, 0.004, 0.14);
    g.connect(this.sfxBus);
    this._send(g, this.sfxVerbIn, 0.45);
    this._bell(above(tones[0], 100), t, 0.7, 0.05, 0, this.sfxBus, 0.35, 0.35, true);
    this._boom(t, 0.55, this.sfxBus, 0.5);
    this._noiseHit(t, 0.18, { hp: 3500, tau: 0.25, pan: -0.3 }, this.sfxBus);
    this._noiseHit(t + 0.003, 0.16, { hp: 4500, tau: 0.22, pan: 0.3 }, this.sfxBus);
  };

  /* Level clear (mic off): a synth-brass fanfare in the level's key — triplet pickup,
     a big major-add9 chord, timpani-like boom, crash and a sparkle run. */
  P._sfx_levelclear = function (t) {
    var r = this._key.root || 0, base = 60 + mod12(r - 0);
    if (base > 65) base -= 12; // tonic between C4 and F4
    var self = this;
    var brass = function (midis, tt, dur, vel) {
      var lp = self._f('lowpass', 800, 1.2), g = self._g(0);
      lp.frequency.setValueAtTime(700, tt); lp.frequency.exponentialRampToValueAtTime(4800, tt + 0.06);
      lp.frequency.setTargetAtTime(1800, tt + 0.08, 0.25);
      midis.forEach(function (m, k) {
        var pn = self._pan(midis.length > 1 ? (k / (midis.length - 1)) * 1.1 - 0.55 : 0, tt);
        [-7, 7].forEach(function (d) { var o = self._osc('sawtooth', mtof(m), tt, tt + dur + 0.6, d); o.connect(pn); });
        pn.connect(lp);
      });
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(vel, tt + 0.025);
      g.gain.setTargetAtTime(vel * 0.7, tt + 0.03, 0.2);
      g.gain.setValueAtTime(vel * 0.7, tt + dur);
      g.gain.setTargetAtTime(0.0001, tt + dur, 0.12);
      lp.connect(g); g.connect(self.sfxBus);
      self._send(g, self.sfxVerbIn, 0.45);
    };
    var tr = 0.105;
    brass([base + 7, base + 12], t, tr * 0.8, 0.05);
    brass([base + 7, base + 12], t + tr, tr * 0.8, 0.055);
    brass([base + 7, base + 12], t + 2 * tr, tr * 0.8, 0.06);
    var hit = t + 3 * tr;
    brass([base, base + 7, base + 12, base + 16, base + 19, base + 26], hit, 1.1, 0.075);
    brass([base - 12], hit, 1.1, 0.06);
    this._boom(hit, 0.7, this.sfxBus, 1.0);
    this._noiseHit(hit, 0.22, { hp: 4000, tau: 0.6, pan: -0.5 }, this.sfxBus);
    this._noiseHit(hit + 0.004, 0.2, { hp: 5000, tau: 0.55, pan: 0.5 }, this.sfxBus);
    // sparkle run up the major scale
    var sc = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    for (var i = 0; i < sc.length; i++) this._glass(base + 24 + sc[i], hit + 0.08 + i * 0.045, 0.5, 0.045, (i / 10) * 1.4 - 0.7, this.sfxBus, 0.2, 0.3, true);
  };

  /* Game over (mic off): a slow minor descent that sinks like a tape stopping. */
  P._sfx_gameover = function (t) {
    var notes = [67, 63, 60, 55], self = this;
    notes.forEach(function (m, i) {
      var tt = t + i * 0.3, dur = i === 3 ? 1.4 : 0.32;
      var o = self._osc('triangle', mtof(m), tt, tt + dur + 0.6), o2 = self._osc('sawtooth', mtof(m), tt, tt + dur + 0.6, 6);
      var lp = self._f('lowpass', 1800, 0.7), g = self._g(0), g2 = self._g(0.25);
      if (i === 3) { o.frequency.setValueAtTime(mtof(m), tt + 0.3); o.frequency.exponentialRampToValueAtTime(mtof(m) * 0.5, tt + dur); o2.frequency.setValueAtTime(mtof(m), tt + 0.3); o2.frequency.exponentialRampToValueAtTime(mtof(m) * 0.5, tt + dur); lp.frequency.setTargetAtTime(400, tt + 0.3, 0.4); }
      g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.09, tt + 0.015); g.gain.setTargetAtTime(0.0001, tt + dur * 0.6, dur * 0.3);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(self.sfxBus);
      self._send(g, self.sfxVerbIn, 0.5);
    });
    this._boom(t + 0.9, 0.6, this.sfxBus, 1.4);
  };

  /* Pop: a bubbly bloop as a ray gun appears. */
  P._sfx_pop = function (t) {
    var p = this._out((Math.random() - 0.5) * 0.6, t);
    this._glide('sine', 520, 1900, t, 0.07, 0.26, 0.003, p);
    this._noiseHit(t, 0.08, { hp: 3000, tau: 0.003 }, p);
    this._mark(t + 0.1);
  };

  /* NEW — spawn: a monster warps in (reverse "shwoop", a high warble, a soft sub whomp). */
  P._sfx_spawn = function (t, o) {
    var pan = clamp((o && o.pan) || 0, -0.8, 0.8), out = this._out(pan, t);
    this._mark(t + 0.4);
    var n = this._noise(t, 0.4), hp = this._f('highpass', 2500, 0.7), bp = this._f('bandpass', 2600, 2.5), g = this._g(0);
    bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(8000, t + 0.24);
    g.gain.setValueAtTime(0.0005, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.24); g.gain.linearRampToValueAtTime(0.0001, t + 0.27);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
    var w = this._osc('sine', 2300, t + 0.2, t + 0.6), lfo = this._osc('sine', 13, t + 0.2, t + 0.6), lg = this._g(320), wg = this._g(0);
    lfo.connect(lg); lg.connect(w.frequency);
    this._perc(wg.gain, t + 0.2, 0.035, 0.01, 0.09);
    w.connect(wg); wg.connect(out); this._send(wg, this.sfxEchoIn, 0.4);
    var s = this._glide('sine', 75, 36, t + 0.22, 0.25, 0.3, 0.01, this.sfxBus);
  };
  /* NEW — land: the piano locks into place (sub thump, low knock, glassy rail shimmer). */
  P._sfx_land = function (t) {
    this._boom(t, 0.6, this.sfxBus, 0.45);
    var n = this._noise(t, 0.3), lp = this._f('lowpass', 900, 0.8), g = this._g(0);
    this._perc(g.gain, t, 0.3, 0.002, 0.04);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    var lad = this._ladder(91, 108);
    for (var i = 0; i < Math.min(5, lad.length); i++) this._glass(lad[i], t + 0.03 + i * 0.03, 0.4, 0.03, (i / 4) * 1.6 - 0.8, this.sfxBus, 0.3, 0.3, true);
  };
  /* NEW — banner: the level title slams in (impact + bright stab in the level's chord). */
  P._sfx_banner = function (t) {
    this._boom(t, 0.5, this.sfxBus, 0.6);
    this._noiseHit(t, 0.16, { hp: 3500, tau: 0.3, pan: -0.35 }, this.sfxBus);
    this._noiseHit(t + 0.003, 0.14, { hp: 4500, tau: 0.28, pan: 0.35 }, this.sfxBus);
    var lad = this._ladder(91, 104);
    for (var i = 0; i < lad.length; i++) this._bell(lad[i], t, 1.0, 0.03, (i / Math.max(1, lad.length - 1)) * 1.2 - 0.6, this.sfxBus, 0.35, 0.4, true);
  };

  /* ------------------------------------------------------------------ */
  /* Victory cues: synthesized piano, harpsichord and organ               */
  /* (played between levels only, when the microphone is not listening)  */
  /* ------------------------------------------------------------------ */
  function parseVoice(str) {
    var events = [], t = 0;
    str.split(/\s+/).filter(Boolean).forEach(function (tok) {
      var parts = tok.split('/');
      var dur = parseFloat(parts[1]);
      if (parts[0] !== 'r') {
        var names = parts[0].split('+');
        names.forEach(function (nm, k) {
          events.push({ t: t, d: dur, m: CK.Theory.parseNote(nm).midi, chord: names.length > 1, k: k });
        });
      }
      t += dur;
    });
    return { events: events, length: t };
  }
  CK.parseVoice = parseVoice;

  /** Seconds at beat `b` for a constant or linearly accelerating tempo. */
  function beatToSec(b, bpm0, bpm1, total) {
    if (!bpm1 || bpm1 === bpm0) return b * 60 / bpm0;
    var k = (bpm1 - bpm0) / total;
    return (60 / k) * Math.log((bpm0 + k * b) / bpm0);
  }

  var NOTE_SR = 24000; // rendered instrument notes: piano partials stop near 10 kHz, so this is plenty

  /** Distinct MIDI notes a piece uses. */
  function pieceNotes(piece) {
    var seen = {}, out = [];
    (piece.voices || []).forEach(function (v) {
      parseVoice(v).events.forEach(function (e) { if (!seen[e.m]) { seen[e.m] = 1; out.push(e.m); } });
    });
    return out;
  }

  /**
   * Render piano notes off the main thread with an OfflineAudioContext: per note,
   * slightly inharmonic partials (stiff strings), each with its own two-stage decay
   * (prompt sound, then aftersound), detuned unison strings that beat gently,
   * a hammer knock and a felt thump. Resolves when every note is cached.
   */
  P._renderPianoNotes = function (midis) {
    var self = this;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    midis = midis.filter(function (m) { return !self._notes['piano:' + m] && !self._pending['piano:' + m]; });
    if (!OAC || !midis.length) return Promise.resolve();
    var lens = midis.map(function (m) { return clamp(3.8 - (m - 36) * 0.045, 1.1, 3.8); });
    var gap = 0.05, total = lens.reduce(function (a, b) { return a + b + gap; }, 0) + 0.1;
    var sr = NOTE_SR, oc;
    try { oc = new OAC(1, Math.ceil(total * sr), sr); } catch (e) {
      try { sr = this.ctx.sampleRate; oc = new OAC(1, Math.ceil(total * sr), sr); } catch (e2) { return Promise.resolve(); }
    }
    midis.forEach(function (m) { self._pending['piano:' + m] = true; });
    // shared noise for hammers
    var nb = oc.createBuffer(1, Math.floor(sr * 0.08), sr), nd = nb.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    var offs = [], at = 0.02;
    midis.forEach(function (m, idx) {
      offs.push(at);
      buildPianoNote(oc, m, at, lens[idx], nb);
      at += lens[idx] + gap;
    });
    var finish = function (buf) {
      var data = buf.getChannelData(0);
      midis.forEach(function (m, idx) {
        var s0 = Math.floor(offs[idx] * sr), n = Math.floor(lens[idx] * sr);
        var nbuf = self.ctx.createBuffer(1, n, sr), d = nbuf.getChannelData(0);
        d.set(data.subarray(s0, s0 + n));
        // fade the very end so a cut-off tail never clicks
        var fade = Math.floor(sr * 0.25);
        for (var j = 0; j < fade; j++) d[n - 1 - j] *= j / fade;
        self._notes['piano:' + m] = nbuf;
        delete self._pending['piano:' + m];
      });
    };
    return new Promise(function (resolve) {
      var done = false;
      var ok = function (buf) { if (done) return; done = true; try { finish(buf); } catch (e) { /* ignore */ } resolve(); };
      var fail = function () { if (done) return; done = true; midis.forEach(function (m) { delete self._pending['piano:' + m]; }); resolve(); };
      oc.oncomplete = function (ev) { ok(ev.renderedBuffer); };
      try {
        var p = oc.startRendering();
        if (p && p.then) p.then(ok, fail);
      } catch (e) { fail(); }
    });
  };

  function buildPianoNote(oc, midi, t, len, noiseBuf) {
    var f0 = mtof(midi), sr = oc.sampleRate, nyq = sr * 0.45;
    var B = 0.00011 * Math.pow(2, (midi - 40) / 13);            // string stiffness → stretched partials
    var tauSlow = 2.8 * Math.pow(2, -(midi - 36) / 22);          // aftersound
    var tauFast = Math.max(0.06, tauSlow * 0.2);                 // prompt sound
    var strings = midi < 34 ? 1 : (midi < 46 ? 2 : 3);
    var out = oc.createGain(); out.gain.value = 0.32; out.connect(oc.destination);
    var nP = Math.min(midi < 48 ? 26 : 16, Math.floor(9500 / f0));
    for (var n = 1; n <= nP; n++) {
      var fn = n * f0 * Math.sqrt(1 + B * n * n);
      if (fn > nyq) break;
      // spectral envelope: bright hammer, hammer-position comb (strike at ~1/8), weak bass fundamentals
      var amp = Math.pow(n, -0.85) * (0.25 + 0.75 * Math.abs(Math.sin(Math.PI * n * 0.122)) / Math.sin(Math.PI * 0.122));
      if (n === 1 && f0 < 110) amp *= 0.35 + 0.65 * f0 / 110;
      if (fn > 4000) amp *= 4000 / fn;
      if (amp < 0.02) continue;
      var damp = 1 + Math.pow(fn / 1300, 1.35);                  // higher partials die faster
      var tS = tauSlow / damp, tF = tauFast / (1 + fn / 3000);
      var g = oc.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.0018 + 0.0006 * (n > 8 ? 1 : 0));
      g.gain.setTargetAtTime(amp * 0.3, t + 0.002, tF);
      g.gain.setTargetAtTime(0, t + 0.002 + tF * 2.5, tS);
      var nStr = n <= 4 ? strings : 1;
      for (var s = 0; s < nStr; s++) {
        var o = oc.createOscillator();
        o.frequency.value = fn;
        o.detune.value = nStr === 1 ? 0 : (s - (nStr - 1) / 2) * (0.9 + 0.3 * n / 4) + (Math.random() - 0.5) * 0.4;
        var sg = oc.createGain(); sg.gain.value = 1 / nStr;
        o.connect(sg); sg.connect(g);
        o.start(t); o.stop(t + len);
      }
      g.connect(out);
    }
    // hammer knock: a few ms of filtered noise, brighter for higher notes
    var hn = oc.createBufferSource(); hn.buffer = noiseBuf;
    var hf = oc.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = Math.min(5000, 900 + f0 * 2.5); hf.Q.value = 0.7;
    var hg = oc.createGain();
    hg.gain.setValueAtTime(0, t); hg.gain.linearRampToValueAtTime(0.12, t + 0.0008); hg.gain.setTargetAtTime(0, t + 0.001, 0.0035);
    hn.connect(hf); hf.connect(hg); hg.connect(out); hn.start(t); hn.stop(t + 0.06);
    // felt / key-bed thump
    var tn = oc.createBufferSource(); tn.buffer = noiseBuf;
    var tf = oc.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 220; tf.Q.value = 0.8;
    var tg = oc.createGain();
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(0.35, t + 0.002); tg.gain.setTargetAtTime(0, t + 0.003, 0.012);
    tn.connect(tf); tf.connect(tg); tg.connect(out); tn.start(t); tn.stop(t + 0.08);
  }

  /**
   * Harpsichord notes via Karplus-Strong plucked strings (an 8' choir plus a
   * quieter 4' an octave up), with a fractional-delay all-pass for exact tuning.
   */
  P._harpsiNote = function (midi) {
    var key = 'harpsichord:' + midi;
    if (this._notes[key]) return this._notes[key];
    var sr = NOTE_SR, len = Math.floor(sr * clamp(3.2 - (midi - 40) * 0.035, 1.2, 3.2));
    var buf;
    try { buf = this.ctx.createBuffer(1, len, sr); } catch (e) { sr = this.ctx.sampleRate; len = Math.floor(sr * 2); buf = this.ctx.createBuffer(1, len, sr); }
    var d = buf.getChannelData(0);
    ksString(d, sr, mtof(midi), 0.996 + Math.min(0.0035, (60 - midi) * 0.0001), 1.0, 0.18);
    if (midi < 84) ksString(d, sr, mtof(midi + 12) * Math.pow(2, 2 / 1200), 0.994, 0.35, 0.3);
    var peak = 0;
    for (var i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    var k = peak > 0 ? 0.5 / peak : 1, fade = Math.floor(sr * 0.2);
    for (i = 0; i < len; i++) d[i] *= k * (i > len - fade ? (len - i) / fade : 1);
    this._notes[key] = buf;
    return buf;
  };
  function ksString(out, sr, f, loss, amp, pluckPos) {
    var N = sr / f - 0.5, L = Math.max(2, Math.floor(N)), frac = N - L;
    var C = (1 - frac) / (1 + frac);   // all-pass coefficient for the fractional delay
    var line = new Float32Array(L + 2), idx = 0, i;
    // excitation: bright noise with a comb notch from the pluck position
    var off = Math.max(1, Math.floor(L * pluckPos));
    for (i = 0; i < L; i++) line[i] = Math.random() * 2 - 1;
    for (i = L - 1; i >= off; i--) line[i] -= line[i - off] * 0.9;
    var prev = 0, apX = 0, apY = 0;
    for (i = 0; i < out.length; i++) {
      var cur = line[idx];
      var avg = (cur + prev) * 0.5 * loss;       // low-pass + decay
      prev = cur;
      var y = C * avg + apX - C * apY;           // fractional delay
      apX = avg; apY = y;
      line[idx] = y;
      idx = idx + 1 >= L ? 0 : idx + 1;
      out[i] += cur * amp;
    }
  }

  /** Organ: principal + octave + mixture ranks (PeriodicWave), celeste-detuned pair, wind chiff. */
  P._organWave = function () {
    if (this._orgWave) return this._orgWave;
    var h = [0, 1, 0.62, 0.32, 0.4, 0.1, 0.22, 0.05, 0.18, 0.04, 0.08, 0.02, 0.07, 0, 0, 0, 0.04];
    var real = new Float32Array(h.length), imag = new Float32Array(h.length);
    for (var i = 1; i < h.length; i++) imag[i] = h[i];
    this._orgWave = this.ctx.createPeriodicWave(real, imag);
    return this._orgWave;
  };

  /** Render (in the background) the notes the next victory cue needs. */
  P._prefetchPiece = function (lvl) {
    var piece = CK.PIECES && CK.PIECES[lvl], self = this;
    if (!piece || this._prefetchTimer) return;
    this._prefetchTimer = setTimeout(function () {
      self._prefetchTimer = null;
      self.preparePiece(piece);
    }, 2500);
  };
  /** Make sure a piece's notes are rendered. Resolves when ready. */
  P.preparePiece = function (piece) {
    if (!this.ready || !piece) return Promise.resolve();
    var notes = pieceNotes(piece), self = this;
    // keep memory small: drop rendered notes this piece doesn't use
    Object.keys(this._notes).forEach(function (k) {
      var m = +k.split(':')[1];
      if (notes.indexOf(m) < 0) delete self._notes[k];
    });
    if (piece.timbre === 'harpsichord') { notes.forEach(function (m) { self._harpsiNote(m); }); return Promise.resolve(); }
    if (piece.timbre === 'organ') return Promise.resolve();
    return this._renderPianoNotes(notes);
  };

  P.playPiece = function (piece) {
    if (!this.ready || !piece || !piece.voices) return 0;
    this.stopCue();
    var ctx = this.ctx, start = ctx.currentTime + 0.12;
    var voices = piece.voices.map(parseVoice);
    var total = Math.max.apply(null, voices.map(function (v) { return v.length; }));
    var self = this, sustain = piece.sustain || 1, timbre = piece.timbre || 'piano';
    var out = this._g(1); out.connect(this.cueBus);
    this.cueOut = out;
    if (timbre === 'harpsichord') pieceNotes(piece).forEach(function (m) { self._harpsiNote(m); });
    var r = rng(piece.title ? piece.title.length * 31 : 7);
    voices.forEach(function (v, vi) {
      v.events.forEach(function (e) {
        var t0 = start + beatToSec(e.t, piece.bpm, piece.bpmEnd, total);
        var t1 = start + beatToSec(e.t + e.d, piece.bpm, piece.bpmEnd, total);
        var dur = Math.max(0.06, (t1 - t0) * sustain);
        // phrasing: melody sings over the accompaniment, downbeats lean in, chords roll slightly
        var onBeat = Math.abs(e.t - Math.round(e.t)) < 0.01;
        var vel = (vi === 0 ? 0.8 : 0.58) * (e.chord ? 0.86 : 1) * (onBeat ? 1.06 : 0.95) * (0.94 + r() * 0.1);
        var roll = e.chord ? e.k * 0.011 : 0, human = (r() - 0.5) * 0.008;
        self._cueNote(timbre, e.m, t0 + roll + human, dur, clamp(vel, 0.2, 1), out);
      });
    });
    return beatToSec(total, piece.bpm, piece.bpmEnd, total) + 1.2;
  };

  P.stopCue = function () {
    if (this.cueOut && this.ctx) {
      var g = this.cueOut, t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.25);
      if (!this.offline) setTimeout(function () { try { g.disconnect(); } catch (e) { /* ignore */ } }, 600);
    }
    this.cueOut = null;
  };

  P._cueNote = function (timbre, midi, t, dur, vel, out) {
    var ctx = this.ctx, f0 = mtof(midi), end = t + dur;
    var pan = this._pan(clamp((midi - 62) / 34, -0.75, 0.75) * (timbre === 'organ' ? 0.5 : 0.8), t);
    pan.connect(out);
    if (timbre === 'organ') {
      var wave = this._organWave(), g = this._g(0), lp = this._f('lowpass', Math.min(9000, f0 * 14), 0.5);
      [-3, 3].forEach(function (d) {
        var o = ctx.createOscillator(); o.setPeriodicWave(wave);
        o.frequency.value = f0; o.detune.value = d;
        o.connect(lp); o.start(t); o.stop(end + 0.5);
      });
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel * 0.16, t + 0.035);
      g.gain.setValueAtTime(vel * 0.16, end);
      g.gain.setTargetAtTime(0.0001, end, 0.06);
      lp.connect(g); g.connect(pan);
      this._send(g, this.verbIn, 0.75);
      // wind chiff at the attack
      this._noiseHit(t, vel * 0.04, { hp: 300, type: 'bandpass', freq: Math.min(6000, f0 * 3), q: 2, tau: 0.025, attack: 0.008 }, pan);
      return;
    }
    var buf = timbre === 'harpsichord' ? this._harpsiNote(midi) : this._notes['piano:' + midi];
    if (!buf) { this._fallbackPiano(midi, t, dur, vel, pan); return; }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var g2 = this._g(0), lp2;
    if (timbre === 'harpsichord') {
      lp2 = this._f('lowpass', 9000, 0.5);
      g2.gain.setValueAtTime(vel * 1.2, t);
      g2.gain.setValueAtTime(vel * 1.2, end);
      g2.gain.setTargetAtTime(0.0001, end, 0.045);
      src.connect(lp2); lp2.connect(g2); g2.connect(pan);
      this._send(g2, this.verbIn, 0.3);
      // the jack's quill falls back with a faint click
      this._noiseHit(end, vel * 0.012, { hp: 2000, tau: 0.004 }, pan);
    } else {
      // velocity → loudness and brightness; dampers release unless the string is above the dampers (≈G6)
      lp2 = this._f('lowpass', clamp(f0 * (2.5 + 20 * vel * vel), 900, 17000), 0.4);
      var gain = 0.95 * Math.pow(vel, 1.5), relTau = midi >= 91 ? 0.5 : clamp(0.2 - (midi - 48) * 0.003, 0.06, 0.24);
      g2.gain.setValueAtTime(gain, t);
      g2.gain.setValueAtTime(gain, end);
      g2.gain.setTargetAtTime(0.0001, end, relTau);
      src.connect(lp2); lp2.connect(g2); g2.connect(pan);
      this._send(g2, this.verbIn, 0.2);
    }
    src.start(t);
    src.stop(Math.min(t + buf.duration, end + (timbre === 'harpsichord' ? 0.3 : 2)) + 0.05);
  };

  /** Piano voice built live, used only if the rendered notes are not ready yet. */
  P._fallbackPiano = function (midi, t, dur, vel, out) {
    var f0 = mtof(midi), end = t + dur, decay = clamp(2.2 - (midi - 48) * 0.03, 0.5, 2.4);
    var g = this._g(0), lp = this._f('lowpass', clamp(f0 * (3 + 12 * vel), 1000, 12000), 0.5);
    var parts = [[1, 1, 1], [2, 0.5, 0.55], [3, 0.28, 0.35], [4, 0.16, 0.25], [5, 0.08, 0.2]];
    for (var i = 0; i < parts.length; i++) {
      var o = this._osc('sine', f0 * parts[i][0] * Math.sqrt(1 + 0.0003 * parts[i][0] * parts[i][0]), t, end + 1.2, i === 0 ? 0 : 1.5);
      var pg = this._g(0);
      pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(parts[i][1], t + 0.003);
      pg.gain.setTargetAtTime(0, t + 0.003, decay * parts[i][2]);
      o.connect(pg); pg.connect(lp);
    }
    var gain = 0.5 * Math.pow(vel, 1.5);
    g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, end); g.gain.setTargetAtTime(0.0001, end, 0.12);
    lp.connect(g); g.connect(out); this._send(g, this.verbIn, 0.3);
  };

  CK.AudioEngine = AudioEngine;
  CK.audio = new AudioEngine();
})();
