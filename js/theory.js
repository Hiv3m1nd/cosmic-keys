/* Cosmic Keys — music theory: notes, hand positions, staff placement */
(function () {
  'use strict';
  var CK = window.CK;

  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  var ACC_SYMBOL = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
  var ACC_ASCII = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

  function mod(n, m) { return ((n % m) + m) % m; }

  /** Build a spelled note from letter index, accidental and octave. */
  function makeNote(letter, acc, octave) {
    return {
      letter: letter,
      acc: acc,
      octave: octave,
      midi: 12 * (octave + 1) + LETTER_PC[letter] + acc,
      step: letter + 7 * octave // diatonic step (for staff placement)
    };
  }

  /** Spell a MIDI number with a given letter. */
  function spellWithLetter(midi, letter) {
    // octave such that letter's natural pitch is closest to midi
    var base = LETTER_PC[letter];
    var octave = Math.round((midi - 12 - base) / 12);
    var acc = midi - (12 * (octave + 1) + base);
    return makeNote(letter, acc, octave);
  }

  /** Default spelling of any MIDI note: naturals, otherwise sharps (or flats). */
  function spellMidi(midi, preferFlats) {
    var pc = mod(midi, 12);
    var nat = LETTER_PC.indexOf(pc);
    if (nat >= 0) return spellWithLetter(midi, nat);
    if (preferFlats) return spellWithLetter(midi, LETTER_PC.indexOf(pc + 1));
    return spellWithLetter(midi, LETTER_PC.indexOf(pc - 1));
  }

  /** Parse "F#4", "Bb3", "C5" etc. */
  function parseNote(str) {
    var m = /^([A-Ga-g])(##|bb|#|b|x)?(-?\d)$/.exec(str.trim());
    if (!m) throw new Error('Bad note: ' + str);
    var letter = LETTERS.indexOf(m[1].toUpperCase());
    var acc = 0;
    if (m[2] === '#') acc = 1; else if (m[2] === 'b') acc = -1;
    else if (m[2] === '##' || m[2] === 'x') acc = 2; else if (m[2] === 'bb') acc = -2;
    return makeNote(letter, acc, parseInt(m[3], 10));
  }

  function noteLabel(n, withOctave) {
    return LETTERS[n.letter] + ACC_SYMBOL[n.acc] + (withOctave ? n.octave : '');
  }
  function noteAscii(n) { return LETTERS[n.letter] + ACC_ASCII[n.acc] + n.octave; }
  function midiLabel(midi, withOctave) { return noteLabel(spellMidi(midi, false), withOctave); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function isBlack(midi) { var pc = mod(midi, 12); return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10; }

  /* ------------------------------------------------------------------ */
  /* Five-finger hand positions                                          */
  /* ------------------------------------------------------------------ */

  // Order used when the position changes between levels (common teaching order).
  var POSITIONS = [
    { id: 'C', letter: 0, acc: 0, flats: false },
    { id: 'G', letter: 4, acc: 0, flats: false },
    { id: 'F', letter: 3, acc: 0, flats: true },
    { id: 'D', letter: 1, acc: 0, flats: false },
    { id: 'A', letter: 5, acc: 0, flats: false },
    { id: 'E', letter: 2, acc: 0, flats: false },
    { id: 'Bb', letter: 6, acc: -1, flats: true },
    { id: 'Eb', letter: 2, acc: -1, flats: true },
    { id: 'Ab', letter: 5, acc: -1, flats: true },
    { id: 'Db', letter: 1, acc: -1, flats: true },
    { id: 'B', letter: 6, acc: 0, flats: false },
    { id: 'F#', letter: 3, acc: 1, flats: false }
  ];
  POSITIONS.forEach(function (p) {
    p.name = LETTERS[p.letter] + ACC_SYMBOL[p.acc];
    p.pc = mod(LETTER_PC[p.letter] + p.acc, 12);
  });

  function getPosition(id) {
    for (var i = 0; i < POSITIONS.length; i++) if (POSITIONS[i].id === id) return POSITIONS[i];
    return POSITIONS[0];
  }

  var PENTA = [0, 2, 4, 5, 7];          // major five-finger pattern (semitones above tonic)
  var CHROMA = [1, 3, 6];               // the in-between black/white keys ("accidentals")
  // Which pentachord degree's finger plays each chromatic offset.
  var CHROMA_DEGREE = { 1: 0, 3: 2, 6: 3 };

  /**
   * Notes for one hand in a five-finger position.
   * RH thumb sits on the tonic at/above middle C; LH pinky on the tonic an octave lower
   * (G–B positions sit a further octave down so the left hand reads comfortably in bass clef).
   */
  function positionNotes(pos, hand, includeAccidentals) {
    var tonicOct = hand === 'R' ? 4 : (pos.pc <= 6 ? 3 : 2);
    var tonicMidi = 12 * (tonicOct + 1) + pos.pc;
    var out = [];
    PENTA.forEach(function (off, i) {
      var n = spellWithLetter(tonicMidi + off, (pos.letter + i) % 7);
      n.degree = i;
      n.finger = hand === 'R' ? i + 1 : 5 - i;
      n.hand = hand;
      n.chromatic = false;
      out.push(n);
    });
    if (includeAccidentals) {
      CHROMA.forEach(function (off) {
        var n = spellMidi(tonicMidi + off, pos.flats);
        var deg = CHROMA_DEGREE[off];
        n.degree = deg + 0.5;
        n.finger = hand === 'R' ? deg + 1 : 5 - deg;
        n.hand = hand;
        n.chromatic = true;
        out.push(n);
      });
    }
    out.sort(function (a, b) { return a.midi - b.midi; });
    return out;
  }

  /** Home keys (one per finger) of a hand in a position. */
  function positionHomeKeys(pos, hand) {
    return positionNotes(pos, hand, false); // 5 notes, sorted low→high
  }

  /** Notes for free play (no hand position) between lo and hi (inclusive MIDI). */
  function rangeNotes(lo, hi, hand, includeAccidentals) {
    var out = [];
    for (var m = lo; m <= hi; m++) {
      if (isBlack(m) && !includeAccidentals) continue;
      var n = spellMidi(m, false);
      n.hand = hand; n.finger = 0; n.chromatic = isBlack(m);
      out.push(n);
    }
    return out;
  }

  /** Interval class (generic size) from a semitone distance, used for level difficulty. */
  function intervalClass(semis) {
    var s = Math.abs(semis);
    if (s === 0) return 1;
    if (s <= 2) return 2;
    if (s <= 4) return 3;
    if (s <= 6) return 4;
    if (s === 7) return 5;
    if (s <= 9) return 6;
    if (s <= 11) return 7;
    if (s === 12) return 8;
    if (s <= 14) return 9;
    return 10;
  }
  var INTERVAL_NAMES = { 2: 'seconds', 3: 'thirds', 4: 'fourths', 5: 'fifths', 6: 'sixths', 7: 'sevenths', 8: 'octaves', 9: 'ninths', 10: 'tenths' };

  /* ------------------------------------------------------------------ */
  /* Staff placement                                                     */
  /* ------------------------------------------------------------------ */
  var TREBLE_BOTTOM = makeNote(2, 0, 4).step; // E4 on the bottom line
  var BASS_BOTTOM = makeNote(4, 0, 2).step;   // G2 on the bottom line

  /** Half-space position above the bottom staff line (0 = bottom line, 8 = top line). */
  function staffPos(note, clef) {
    return note.step - (clef === 'treble' ? TREBLE_BOTTOM : BASS_BOTTOM);
  }

  CK.Theory = {
    LETTERS: LETTERS,
    LETTER_PC: LETTER_PC,
    POSITIONS: POSITIONS,
    INTERVAL_NAMES: INTERVAL_NAMES,
    mod: mod,
    makeNote: makeNote,
    parseNote: parseNote,
    spellMidi: spellMidi,
    noteLabel: noteLabel,
    noteAscii: noteAscii,
    midiLabel: midiLabel,
    midiToFreq: midiToFreq,
    freqToMidi: freqToMidi,
    isBlack: isBlack,
    getPosition: getPosition,
    positionNotes: positionNotes,
    positionHomeKeys: positionHomeKeys,
    rangeNotes: rangeNotes,
    intervalClass: intervalClass,
    staffPos: staffPos
  };
})();
