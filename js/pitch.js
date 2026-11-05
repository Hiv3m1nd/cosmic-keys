/* Cosmic Keys — microphone pitch detection (YIN) with onset gating */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;

  var MIN_F = 85;    // ≈ E2
  var MAX_F = 1250;  // ≈ D#6

  /**
   * YIN fundamental-frequency estimator.
   * Returns { freq, conf } or null.
   */
  function Yin(windowSize) {
    this.W = windowSize;
    this.d = new Float32Array(windowSize);
  }
  Yin.prototype.detect = function (buf, sr, threshold) {
    var W = this.W, d = this.d;
    var tauMax = Math.min(W - 1, Math.floor(sr / MIN_F));
    // Analyse the most recent samples so new key presses register quickly.
    var off = Math.max(0, buf.length - W - tauMax - 1);
    var tauMin = Math.max(2, Math.floor(sr / 2400));
    var tau, j, sum, delta;
    // Difference function.
    d[0] = 0;
    for (tau = 1; tau <= tauMax; tau++) {
      sum = 0;
      for (j = 0; j < W; j++) {
        delta = buf[off + j] - buf[off + j + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalised difference.
    var running = 0;
    d[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? d[tau] * tau / running : 1;
    }
    // First dip under the threshold (searching from short periods up, so
    // high synth notes are reported as high, not folded into our range).
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    // A "dip" pinned to the longest period we search is really a lower sound
    // (e.g. sub bass from the game's own music), not a note in range.
    if (best < 0 || best >= tauMax - 1) return null;
    // Parabolic interpolation.
    var x0 = best > 1 ? best - 1 : best, x2 = best + 1 <= tauMax ? best + 1 : best;
    var betterTau = best;
    if (x0 !== best && x2 !== best) {
      var s0 = d[x0], s1 = d[best], s2 = d[x2];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = best + (s2 - s0) / denom;
    }
    var freq = sr / betterTau;
    return { freq: freq, conf: 1 - d[best] };
  };

  function PitchInput() {
    CK.Emitter.call(this);
    this.active = false;
    this.listening = false;
    this.level = 0;          // 0..1 for meters
    this.lastHeard = null;   // { midi, label, time }
    this.tuning = 0;         // learned piano tuning offset (semitones)
    this._rmsHist = [];
    this._floor = 0.004;
    this._armedUntil = 0;
    this._softUntil = 0;
    this._lastOnset = -1;
    this._lastSoft = -1;
    this._cand = null;
    this._candSince = 0;
    this._candFrames = 0;
    this._lastEmit = null;
    this._lastEmitTime = 0;
    this._lastEmitRms = 0;
    this.sensitivity = 1;
  }
  PitchInput.prototype = Object.create(CK.Emitter.prototype);

  PitchInput.isSupported = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  };

  /** Ask for the microphone. Resolves true or rejects with a friendly error code. */
  PitchInput.prototype.start = function (deviceId) {
    var self = this, audio = CK.audio;
    audio.init();
    if (!PitchInput.isSupported()) {
      return Promise.reject({ code: window.isSecureContext === false ? 'insecure' : 'unsupported' });
    }
    var constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    };
    if (deviceId) constraints.audio.deviceId = { exact: deviceId };
    this.stop();
    return navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
      // Some phone browsers reject the detailed constraints; plain audio still works there.
      var name = err && err.name;
      if (deviceId || (name !== 'OverconstrainedError' && name !== 'TypeError' && name !== 'NotReadableError')) throw err;
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }).then(function (stream) {
      var ctx = audio.ctx;
      if (!ctx) throw { name: 'AudioUnavailable' };
      // Phones (iOS especially) can pause audio while switching to recording: wake it.
      audio.resume();
      self.stream = stream;
      self.source = ctx.createMediaStreamSource(stream);
      // Band-limit to the piano notes the game asks for: drops rumble, kick drum,
      // hats and the game's own sparkly synths.
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 82; hp.Q.value = 0.7;
      var hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 60; hp2.Q.value = 0.6;
      var lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 1500; lp1.Q.value = 0.7;
      var lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 1500; lp2.Q.value = 0.7;
      var an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      var sink = ctx.createGain(); sink.gain.value = 0; // keeps the graph pulling in every browser
      self.source.connect(hp2); hp2.connect(hp); hp.connect(lp1); lp1.connect(lp2); lp2.connect(an); an.connect(sink); sink.connect(ctx.destination);
      self.nodes = [hp2, hp, lp1, lp2, an, sink];
      self.analyser = an;
      self.buf = new Float32Array(an.fftSize);
      self.yin = new Yin(Math.floor(an.fftSize / 2));
      self.sr = ctx.sampleRate;
      self.active = true;
      var track = stream.getAudioTracks()[0];
      self.deviceLabel = track ? track.label : '';
      if (track) {
        track.onended = function () { self.active = false; self.emit('ended'); };
      }
      return true;
    }).catch(function (err) {
      var name = err && err.name;
      var code = 'error';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') code = 'denied';
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') code = 'nodevice';
      else if (name === 'NotReadableError' || name === 'TrackStartError') code = 'busy';
      throw { code: code, detail: err };
    });
  };

  PitchInput.prototype.stop = function () {
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
    }
    if (this.source) { try { this.source.disconnect(); } catch (e) { /* ignore */ } }
    (this.nodes || []).forEach(function (n) { try { n.disconnect(); } catch (e) { /* ignore */ } });
    this.stream = null; this.source = null; this.nodes = null; this.analyser = null;
    this.active = false;
  };

  PitchInput.listDevices = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      return list.filter(function (d) { return d.kind === 'audioinput'; });
    }).catch(function () { return []; });
  };

  /** Reset per-level detection memory (call when gameplay starts). */
  PitchInput.prototype.resetGate = function () {
    this._cand = null; this._candFrames = 0; this._lastEmit = null; this._armedUntil = 0; this._softUntil = 0;
  };

  /** Analyse the latest audio. Call once per animation frame. */
  PitchInput.prototype.update = function (nowSec) {
    if (!this.active || !this.analyser) { this.level = 0; return; }
    var an = this.analyser, buf = this.buf;
    if (an.getFloatTimeDomainData) an.getFloatTimeDomainData(buf);
    else {
      var bytes = this._bytes || (this._bytes = new Uint8Array(buf.length));
      an.getByteTimeDomainData(bytes);
      for (var k = 0; k < buf.length; k++) buf[k] = (bytes[k] - 128) / 128;
    }
    // RMS of the most recent half (fast response to new attacks).
    var n = buf.length, half = n >> 1, sum = 0, i;
    for (i = half; i < n; i++) sum += buf[i] * buf[i];
    var rms = Math.sqrt(sum / half);
    var db = 20 * Math.log10(rms + 1e-9);
    this.level = CK.clamp((db + 62) / 50, 0, 1);

    // Onset detection against the recent minimum level.
    var hist = this._rmsHist;
    hist.push(rms); if (hist.length > 6) hist.shift();
    var recentMin = Infinity;
    for (i = 0; i < hist.length - 1; i++) if (hist[i] < recentMin) recentMin = hist[i];
    var selfNoise = CK.audio.ctx && CK.audio.ctx.currentTime < CK.audio.pitchedSfxUntil ? 2.2 : 1;
    var gate = Math.max(0.0035, this._floor * 2.4) * selfNoise / this.sensitivity;
    // Onsets are edge events with a short refractory period, so one key press arms once.
    if (rms > gate && rms > recentMin * 1.6 && nowSec - this._lastOnset > 0.16) {
      this._lastOnset = nowSec; this._armedUntil = nowSec + 0.35;
      this._cand = null; this._candFrames = 0; // only trust pitch frames after the new attack
    }
    if (rms > gate && rms > recentMin * 1.15 && nowSec - this._lastSoft > 0.16) {
      this._lastSoft = nowSec; this._softUntil = nowSec + 0.3;
    }

    if (!this.listening) { this._trackFloor(rms, false); return; }

    var res = null;
    if (rms > gate) {
      res = this.yin.detect(buf, this.sr, 0.14);
      if (res && (res.freq < MIN_F || res.freq > MAX_F || res.conf < 0.82)) res = null;
    }
    this._trackFloor(rms, !!res);
    if (!res) { this._cand = null; this._candFrames = 0; return; }

    var mf = T.freqToMidi(res.freq);
    var adj = mf - this.tuning;
    var rounded = Math.round(adj);
    if (this._cand !== null && rounded === this._cand && Math.abs(adj - this._candF) < 0.35) {
      this._candFrames++;
      this._candF = this._candF * 0.6 + adj * 0.4;
    } else {
      this._cand = rounded; this._candF = adj; this._candFrames = 1; this._candSince = nowSec;
    }
    var stableFor = nowSec - this._candSince;
    if (this._candFrames < 2 || stableFor < 0.025) return;

    var armed = nowSec < this._armedUntil;
    var samePc = this._lastEmit !== null && T.mod(this._lastEmit - rounded, 12) === 0;
    // A clearly new, steady pitch counts even when loud music hides the attack;
    // repeating the same note still needs a fresh attack (onset).
    var newPitch = !samePc && this._candFrames >= 3 && res.conf > 0.86 && nowSec - this._lastEmitTime > 0.1;
    if (armed || newPitch) {
      this._armedUntil = 0; this._softUntil = 0;
      this._lastEmit = rounded; this._lastEmitTime = nowSec; this._lastEmitRms = rms;
      // Learn the piano's tuning (old pianos are often a little flat or sharp).
      var midiFloat = this._candF + this.tuning;
      this.lastHeard = { midi: rounded, time: nowSec };
      this.emit('note', { midi: rounded, midiFloat: midiFloat, adjFloat: this._candF, offset: this._candF - rounded, conf: res.conf, time: nowSec });
    }
  };

  /**
   * Learn the piano's tuning (old pianos are often a little flat or sharp).
   * Called only for notes the game confirmed as correct, so stray sounds can't skew it.
   */
  PitchInput.prototype.confirm = function (ev) {
    if (ev && typeof ev.offset === 'number') this.tuning = CK.clamp(this.tuning + ev.offset * 0.2, -0.45, 0.45);
  };

  PitchInput.prototype._trackFloor = function (rms, voiced) {
    if (rms < this._floor) this._floor = this._floor * 0.85 + rms * 0.15;
    else if (!voiced) this._floor = this._floor * 0.995 + rms * 0.005;
    this._floor = CK.clamp(this._floor, 0.0004, 0.05);
  };

  CK.Yin = Yin;
  CK.PitchInput = PitchInput;
  CK.pitch = new PitchInput();
})();
