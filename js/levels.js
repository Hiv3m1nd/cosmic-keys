/* Cosmic Keys — level progression and note generation */
(function () {
  'use strict';
  var CK = window.CK, T = CK.Theory;

  /*
   * travel   seconds for an enemy to cross from the top of space to the keyboard
   * gap      seconds between spawns (a new note may appear while another is still on screen)
   * maxActive  enemies allowed at once
   * maxInt   widest interval class between consecutive notes in one hand (2 = seconds, 3 = thirds…)
   * switchP  chance the next note moves to the other hand (when both hands are on)
   * pairP    chance two notes spawn at the same moment (never before level 6)
   */
  // travel: seconds for a monster to fly from deep space to the keyboard. The first
  // monster of every level waits until it is played; after that the clock runs.
  CK.LEVELS = [
    { n: 8,  travel: 10.0, oneAtATime: true, maxActive: 1, maxInt: 2, switchEvery: 4, pairP: 0 },
    { n: 10, travel: 9.4, gap: 3.3, maxActive: 2, maxInt: 3, switchP: 0.18, pairP: 0 },
    { n: 12, travel: 8.9, gap: 3.0, maxActive: 2, maxInt: 4, switchP: 0.28, pairP: 0 },
    { n: 12, travel: 8.4, gap: 2.8, maxActive: 3, maxInt: 5, switchP: 0.36, pairP: 0 },
    { n: 14, travel: 7.9, gap: 2.6, maxActive: 3, maxInt: 5, switchP: 0.44, pairP: 0 },
    { n: 14, travel: 7.5, gap: 2.45, maxActive: 3, maxInt: 6, switchP: 0.5, pairP: 0.14 },
    { n: 16, travel: 7.1, gap: 2.3, maxActive: 4, maxInt: 7, switchP: 0.52, pairP: 0.18 },
    { n: 16, travel: 6.7, gap: 2.15, maxActive: 4, maxInt: 8, switchP: 0.55, pairP: 0.22 },
    { n: 18, travel: 6.3, gap: 2.0, maxActive: 4, maxInt: 9, switchP: 0.58, pairP: 0.25 },
    { n: 18, travel: 5.9, gap: 1.85, maxActive: 5, maxInt: 10, switchP: 0.6, pairP: 0.28 },
    { n: 20, travel: 5.5, gap: 1.7, maxActive: 5, maxInt: 10, switchP: 0.62, pairP: 0.3 },
    { n: 22, travel: 5.1, gap: 1.55, maxActive: 5, maxInt: 10, switchP: 0.66, pairP: 0.32 }
  ];
  CK.LEVEL_COUNT = CK.LEVELS.length;

  // Free play (no hand position): note range widens with the levels.
  var FREE_RANGES = [
    { L: [48, 55], R: [60, 67] },   // levels 1–2:  C3–G3 / C4–G4
    { L: [48, 59], R: [60, 72] },   // levels 3–4:  C3–B3 / C4–C5
    { L: [45, 59], R: [60, 76] },   // levels 5–7:  A2–B3 / C4–E5
    { L: [43, 59], R: [60, 79] }    // levels 8–12: G2–B3 / C4–G5
  ];
  function freeRange(levelIdx) {
    if (levelIdx < 2) return FREE_RANGES[0];
    if (levelIdx < 4) return FREE_RANGES[1];
    if (levelIdx < 7) return FREE_RANGES[2];
    return FREE_RANGES[3];
  }

  /** Which hand position a level uses, given the settings. */
  CK.positionForLevel = function (settings, levelIdx) {
    if (settings.positionMode === 'free') return null;
    var start = 0;
    for (var i = 0; i < T.POSITIONS.length; i++) if (T.POSITIONS[i].id === settings.startPosition) start = i;
    if (settings.positionMode === 'keep') return T.POSITIONS[start];
    return T.POSITIONS[(start + levelIdx) % T.POSITIONS.length];
  };

  /**
   * Build the playable world for a level: which notes each hand can get,
   * the home keys for hands, and the keyboard focus range.
   */
  CK.buildLevelPlan = function (settings, levelIdx) {
    var cfg = CK.LEVELS[levelIdx];
    var hands = settings.hands === 'both' ? ['L', 'R'] : [settings.hands === 'left' ? 'L' : 'R'];
    var pos = CK.positionForLevel(settings, levelIdx);
    var plan = { levelIdx: levelIdx, cfg: cfg, hands: hands, position: pos, free: !pos, notes: {}, home: {} };
    var lo = 999, hi = -1;
    hands.forEach(function (h) {
      var list;
      if (pos) {
        list = T.positionNotes(pos, h, settings.accidentals);
        plan.home[h] = T.positionHomeKeys(pos, h);
      } else {
        var r = freeRange(levelIdx)[h];
        list = T.rangeNotes(r[0], r[1], h, settings.accidentals);
      }
      plan.notes[h] = list;
      list.forEach(function (n) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    });
    plan.focusLo = lo;
    plan.focusHi = hi;
    var maxInt = cfg.maxInt;
    if (pos) maxInt = Math.min(maxInt, 5); // a five-finger position spans a fifth
    plan.maxInt = maxInt;
    plan.title = pos ? pos.name + ' Position' : 'No Hand Position';
    plan.intervalText = maxInt === 2 ? 'Steps of a second'
      : 'Seconds up to ' + T.INTERVAL_NAMES[maxInt];
    return plan;
  };

  /* ------------------------------------------------------------------ */
  /* Note generator                                                       */
  /* ------------------------------------------------------------------ */
  function NoteGenerator(plan) {
    this.plan = plan;
    this.last = { L: null, R: null };
    this.hand = plan.hands[plan.hands.length - 1] === 'R' ? 'R' : plan.hands[0];
    this.count = 0;
    this.lastNote = null;
  }

  NoteGenerator.prototype._chooseHand = function () {
    var plan = this.plan, cfg = plan.cfg;
    if (plan.hands.length === 1) return plan.hands[0];
    if (cfg.switchEvery) {
      // Level 1: stay in one hand for a block of notes, then switch.
      var block = Math.floor(this.count / cfg.switchEvery);
      return block % 2 === 0 ? 'R' : 'L';
    }
    if (this.count === 0) return CK.pick(['L', 'R']);
    return CK.chance(cfg.switchP) ? (this.hand === 'R' ? 'L' : 'R') : this.hand;
  };

  NoteGenerator.prototype._pickInHand = function (hand, avoidMidi) {
    var plan = this.plan;
    var list = plan.notes[hand];
    var prev = this.last[hand];
    var maxInt = plan.maxInt;
    var cands;
    if (!prev) {
      if (plan.cfg.switchEvery) {
        // Very first note in a hand at level 1: the tonic (or C in free play) or its neighbour.
        cands = list.filter(function (n) { return !n.chromatic; });
        cands = [cands[0], cands[1]];
      } else {
        cands = list.slice();
      }
    } else {
      cands = list.filter(function (n) {
        var ic = T.intervalClass(n.midi - prev.midi);
        return ic >= 2 && ic <= maxInt;
      });
      // Prefer the newest interval sizes a little so each level feels different.
      if (maxInt >= 3 && cands.length > 2 && CK.chance(0.35)) {
        var wide = cands.filter(function (n) { return T.intervalClass(n.midi - prev.midi) >= maxInt - 1; });
        if (wide.length) cands = wide;
      }
    }
    if (avoidMidi != null) cands = cands.filter(function (n) { return n.midi !== avoidMidi; });
    if (!cands.length) cands = list.filter(function (n) { return n.midi !== (prev && prev.midi) && n.midi !== avoidMidi; });
    if (!cands.length) cands = list.slice();
    // Accidentals appear, but not so often they crowd out the position notes.
    var nat = cands.filter(function (n) { return !n.chromatic; });
    var chr = cands.filter(function (n) { return n.chromatic; });
    var pool = (chr.length && nat.length) ? (CK.chance(0.3) ? chr : nat) : cands;
    return CK.pick(pool);
  };

  /** Next single note: {note, hand}. */
  NoteGenerator.prototype.next = function (avoidMidi) {
    var hand = this._chooseHand();
    var n = this._pickInHand(hand, avoidMidi);
    this.last[hand] = n;
    this.hand = hand;
    this.count++;
    this.lastNote = n;
    return n;
  };

  /** Two notes at the same moment (levels 6+). */
  NoteGenerator.prototype.nextPair = function () {
    var plan = this.plan;
    if (plan.hands.length === 2) {
      var a = this._pickInHand('L');
      this.last.L = a;
      var b = this._pickInHand('R');
      this.last.R = b;
      this.count += 2;
      return [a, b];
    }
    var first = this.next();
    var second = this.next(first.midi);
    return [first, second];
  };

  CK.NoteGenerator = NoteGenerator;
})();
