/* Cosmic Keys — ranks, pianists and victory pieces (one per level) */
(function () {
  'use strict';
  var CK = window.CK;

  CK.START_RANK = 'Tuning Up';

  // Earned when each level is completed. Beginner → expert.
  CK.RANKS = [
    { name: 'Pianissimo', note: 'pp — very soft. The quietest start, but the stars heard you!' },
    { name: 'Piano', note: 'p — soft and steady.' },
    { name: 'Mezzo Piano', note: 'mp — moderately soft, and getting stronger.' },
    { name: 'Mezzo Forte', note: 'mf — moderately loud and confident.' },
    { name: 'Forte', note: 'f — strong! The monsters felt that one.' },
    { name: 'Fortissimo', note: 'ff — very strong. The whole galaxy is listening.' },
    { name: 'Soloist', note: 'Ready for the spotlight.' },
    { name: 'Concert Pianist', note: 'The concert hall is yours.' },
    { name: 'Maestro', note: 'A true master of the keys.' },
    { name: 'Prodigy', note: 'Remarkable talent, far beyond your years.' },
    { name: 'Virtuoso', note: 'Dazzling skill, speed and control.' },
    { name: 'Amadeus', note: 'The highest honor, named for Mozart himself.' }
  ];

  /*
   * A classical pianist appears at each level transition.
   * Lines are written in each pianist's voice, based on things they actually
   * said, did or were known for. They are not verbatim quotations.
   * Portrait fields drive the pixel-art bust in art.js.
   */
  CK.PIANISTS = [
    {
      name: 'Clara Schumann', years: '1819–1896',
      line: 'I gave my first concert in Leipzig when I was only nine. Your first concert is among the stars. A splendid beginning!',
      look: { skin: '#f1c9a5', hair: '#3b2416', hairStyle: 'bun', coat: '#2b2340', collar: 'lace', accent: '#e8e2f0' }
    },
    {
      name: 'Ludwig van Beethoven', years: '1770–1827',
      line: 'Ha! Again, and with more fire this time! Music should strike fire from the heart.',
      look: { skin: '#e9b892', hair: '#4a4a52', hairStyle: 'wild', coat: '#23314f', collar: 'cravat', accent: '#f4f1e6', brow: 'stern' }
    },
    {
      name: 'Fanny Mendelssohn Hensel', years: '1805–1847',
      line: 'Wonderful! Come and play at my Sunday concerts in Berlin. There is always room for one more pianist.',
      look: { skin: '#f0c6a0', hair: '#2a1a12', hairStyle: 'ringlets', coat: '#2f5e4e', collar: 'round', accent: '#f2e6c8' }
    },
    {
      name: 'Frédéric Chopin', years: '1810–1849',
      line: 'Lovely. Now make the piano sing. Listen to great singers, then let your fingers sing the same way.',
      look: { skin: '#f3d2b6', hair: '#7a4b2a', hairStyle: 'swept', coat: '#1e2233', collar: 'cravat', accent: '#f6f3ea' }
    },
    {
      name: 'Teresa Carreño', years: '1853–1917',
      line: 'When I was nine I played for President Lincoln at the White House. He asked for “Listen to the Mockingbird.” What will you play next?',
      look: { skin: '#e0ae86', hair: '#1f1512', hairStyle: 'updo', coat: '#5b2a6e', collar: 'gown', accent: '#ffd76a' }
    },
    {
      name: 'Franz Liszt', years: '1811–1886',
      line: 'My piano is to me what his ship is to a sailor. And you, my friend, are sailing through the stars!',
      look: { skin: '#efc7a6', hair: '#c9c6c0', hairStyle: 'long', coat: '#15151d', collar: 'abbe', accent: '#ffffff' }
    },
    {
      name: 'Edvard Grieg', years: '1843–1907',
      line: 'Ah, my Mountain King! I once admitted I could hardly bear to hear that tune. But your playing? That I enjoyed!',
      look: { skin: '#f2c8a8', hair: '#ecebe6', hairStyle: 'swept', coat: '#2c2f3a', collar: 'bow', accent: '#f4f4f4', mustache: '#ecebe6' }
    },
    {
      name: 'Sergei Rachmaninoff', years: '1873–1943',
      line: 'People say I never smile on stage. I am smiling now, on the inside. Well done.',
      look: { skin: '#e8c0a0', hair: '#5b5752', hairStyle: 'buzz', coat: '#1b1d24', collar: 'tie', accent: '#ece9e2', brow: 'stern', long: true }
    },
    {
      name: 'Ignacy Jan Paderewski', years: '1860–1941',
      line: 'Skip practice for one day and I notice. Two days, the critics notice. Three days, the audience notices! Keep practicing.',
      look: { skin: '#f0c9a8', hair: '#c9773f', hairStyle: 'cloud', coat: '#22202a', collar: 'bow', accent: '#f5f2ea', mustache: '#b7672f' }
    },
    {
      name: 'Vladimir Horowitz', years: '1903–1989',
      line: 'I am a general. My soldiers are the keys, and I must command them. Today you commanded yours!',
      look: { skin: '#eac2a0', hair: '#26211f', hairStyle: 'slick', coat: '#232a3d', collar: 'bowred', accent: '#e23c4c' }
    },
    {
      name: 'Glenn Gould', years: '1932–1982',
      line: 'Forgive the humming. I always hum when I play Bach. Hearing you, I simply could not help myself.',
      look: { skin: '#f0cbb0', hair: '#6d5a44', hairStyle: 'messy', coat: '#3a4a5c', collar: 'scarf', accent: '#3f6fb5', cap: '#4b4f5c' }
    },
    {
      name: 'Wolfgang Amadeus Mozart', years: '1756–1791',
      line: 'Amadeus? Why, that is my name! I played for an empress when I was six, and now you have earned the highest rank of all. Bravo!',
      look: { skin: '#f4d1b8', hair: '#f1efe9', hairStyle: 'wig', coat: '#b3283a', collar: 'jabot', accent: '#ffd76a' }
    }
  ];

  /*
   * Victory cues. Short public-domain excerpts, arranged so each level's piece
   * is busier than the last (tempo, note density, accompaniment).
   * Token format: NOTE/beats, chords as A3+C4+E4/beats, rests as r/beats.
   */
  var ARP_C = ['C4', 'E4', 'G4', 'C5', 'E5'];
  var ARP_DM = ['C4', 'D4', 'A4', 'D5', 'F5'];
  var ARP_G7 = ['B3', 'D4', 'G4', 'D5', 'F5'];
  function preludeBar(p) {
    // Bach's pattern: p0 p1 | p2 p3 p4 p2 p3 p4, twice per bar.
    var half = function () {
      return [p[0] + '/0.25', p[1] + '/0.25', p[2] + '/0.25', p[3] + '/0.25', p[4] + '/0.25', p[2] + '/0.25', p[3] + '/0.25', p[4] + '/0.25'].join(' ');
    };
    return half() + ' ' + half();
  }
  function rep(str, n) { var a = []; for (var i = 0; i < n; i++) a.push(str); return a.join(' '); }
  function sixteenths(str) {
    return str.split(/\s+/).filter(Boolean).map(function (n) { return n + '/0.25'; }).join(' ');
  }
  var BEE_X = sixteenths('E5 D#5 D5 C#5 C5 F5 E5 D#5');
  var BEE_Y = sixteenths('E5 D#5 D5 C#5 C5 C#5 D5 D#5');
  var BEE_XA = sixteenths('A5 G#5 G5 F#5 F5 A#5 A5 G#5');
  var BEE_YA = sixteenths('A5 G#5 G5 F#5 F5 F#5 G5 G#5');
  var KING = 'B3/0.5 C#4/0.5 D4/0.5 E4/0.5 F#4/0.5 D4/0.5 F#4/1 F4/0.5 C#4/0.5 F4/1 E4/0.5 C4/0.5 E4/1 ' +
             'B3/0.5 C#4/0.5 D4/0.5 E4/0.5 F#4/0.5 D4/0.5 F#4/0.5 B4/0.5 A4/0.5 F#4/0.5 D4/0.5 F#4/0.5 A4/2';
  var KING_HI = 'B4/0.5 C#5/0.5 D5/0.5 E5/0.5 F#5/0.5 D5/0.5 F#5/0.5 B5/0.5 A5/0.5 F#5/0.5 D5/0.5 F#5/0.5 A5/1';

  CK.PIECES = [
    {
      title: 'Ah vous dirai-je, Maman (Twinkle theme)', composer: 'W. A. Mozart', bpm: 138, timbre: 'piano',
      voices: [
        'C5/1 C5/1 G5/1 G5/1 A5/1 A5/1 G5/2 F5/1 F5/1 E5/1 E5/1 D5/1 D5/1 C5/2',
        'r/14 C3/2'
      ]
    },
    {
      title: 'Ode to Joy', composer: 'Ludwig van Beethoven', bpm: 150, timbre: 'piano',
      voices: [
        'E5/1 E5/1 F5/1 G5/1 G5/1 F5/1 E5/1 D5/1 C5/1 C5/1 D5/1 E5/1 D5/1.5 C5/0.5 C5/2',
        'C3/4 G2/4 C3/4 G2/2 C3/2'
      ]
    },
    {
      title: 'Minuet in G major', composer: 'Christian Petzold', bpm: 170, timbre: 'harpsichord',
      voices: [
        'D5/1 G4/0.5 A4/0.5 B4/0.5 C5/0.5 D5/1 G4/1 G4/1 E5/1 C5/0.5 D5/0.5 E5/0.5 F#5/0.5 G5/1 G4/1 G4/1 ' +
        'C5/1 D5/0.5 C5/0.5 B4/0.5 A4/0.5 B4/1 C5/0.5 B4/0.5 A4/0.5 G4/0.5 A4/1 B4/0.5 A4/0.5 G4/0.5 F#4/0.5 G4/3',
        'G3+B3/2 A3/1 B3/3 C4/3 B3/3 A3/3 G3/3 D3/3 G2+G3/3'
      ]
    },
    {
      title: 'Eine kleine Nachtmusik', composer: 'W. A. Mozart', bpm: 140, timbre: 'piano',
      voices: [
        'G5/1 r/0.5 D5/0.5 G5/1 r/0.5 D5/0.5 G5/0.5 D5/0.5 G5/0.5 B5/0.5 D6/2 ' +
        'C6/1 r/0.5 A5/0.5 C6/1 r/0.5 A5/0.5 C6/0.5 A5/0.5 F#5/0.5 A5/0.5 D5/2 G5/0.5 D5/0.5 B4/0.5 D5/0.5 G4/2',
        'G4/1 r/0.5 D4/0.5 G4/1 r/0.5 D4/0.5 G4/0.5 D4/0.5 G4/0.5 B4/0.5 D5/2 ' +
        'C5/1 r/0.5 A4/0.5 C5/1 r/0.5 A4/0.5 C5/0.5 A4/0.5 F#4/0.5 A4/0.5 D4/2 G2+G3/2 G2+D3+G3/2'
      ]
    },
    {
      title: 'Für Elise', composer: 'Ludwig van Beethoven', bpm: 128, timbre: 'piano', sustain: 1.6,
      voices: [
        'E5/0.25 D#5/0.25 E5/0.25 D#5/0.25 E5/0.25 B4/0.25 D5/0.25 C5/0.25 A4/0.5 r/0.25 C4/0.25 E4/0.25 A4/0.25 ' +
        'B4/0.5 r/0.25 E4/0.25 G#4/0.25 B4/0.25 C5/0.5 r/0.25 E4/0.25 E5/0.25 D#5/0.25 ' +
        'E5/0.25 D#5/0.25 E5/0.25 B4/0.25 D5/0.25 C5/0.25 A4/0.5 r/0.25 C4/0.25 E4/0.25 A4/0.25 ' +
        'B4/0.5 r/0.25 E4/0.25 C5/0.25 B4/0.25 A4/1.5',
        'r/2 A2/0.25 E3/0.25 A3/1 E2/0.25 E3/0.25 G#3/1 A2/0.25 E3/0.25 A3/1 r/1.5 ' +
        'A2/0.25 E3/0.25 A3/1 E2/0.25 E3/0.25 G#3/1 A2/0.25 E3/0.25 A3/1.5'
      ]
    },
    {
      title: 'Prelude in C major, BWV 846', composer: 'J. S. Bach', bpm: 128, timbre: 'harpsichord', sustain: 2.2,
      voices: [
        preludeBar(ARP_C) + ' ' + preludeBar(ARP_DM) + ' ' + preludeBar(ARP_G7) + ' C4/0.25 E4/0.25 G4/0.25 C5/0.25 C4+E4+G4+C5+E5/2',
        'r/12 C3/3'
      ]
    },
    {
      title: 'In the Hall of the Mountain King', composer: 'Edvard Grieg', bpm: 132, bpmEnd: 300, timbre: 'piano',
      voices: [
        KING + ' ' + KING_HI + ' B4+D5+F#5+B5/0.5 r/0.5 B4+D5+F#5+B5/2',
        rep('B2/0.5 r/0.5 F#2/0.5 r/0.5', 11) + ' B2/0.5 r/0.5 B1+B2/0.5 r/0.5 B1+F#2+B2/2'
      ]
    },
    {
      title: 'Rondo alla Turca', composer: 'W. A. Mozart', bpm: 126, timbre: 'piano',
      voices: [
        'B4/0.25 A4/0.25 G#4/0.25 A4/0.25 C5/0.5 r/0.5 D5/0.25 C5/0.25 B4/0.25 C5/0.25 E5/0.5 r/0.5 ' +
        'F5/0.25 E5/0.25 D#5/0.25 E5/0.25 B5/0.25 A5/0.25 G#5/0.25 A5/0.25 B5/0.25 A5/0.25 G#5/0.25 A5/0.25 C6/1 ' +
        'A5/0.5 B5/0.5 C6/0.5 B5/0.5 A5/0.5 G#5/0.5 A5/0.5 E5/0.5 F5/0.5 D5/0.5 C5/0.5 B4/0.5 A4/1',
        'r/1 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 E3/0.5 B3+E4/0.5 ' +
        'A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 A3/0.5 C4+E4/0.5 G#3/0.5 B3+E4/0.5 ' +
        'D3/0.5 F3+A3/0.5 E3/0.5 G#3+B3+D4/0.5 A2+A3/1'
      ]
    },
    {
      title: 'Moonlight Sonata, 3rd movement', composer: 'Ludwig van Beethoven', bpm: 152, timbre: 'piano', sustain: 1.2,
      voices: [
        sixteenths('G#3 C#4 E4 G#4 C#4 E4 G#4 C#5 E4 G#4 C#5 E5 G#4 C#5 E5 G#5') +
        ' C#5+E5+G#5+C#6/0.5 r/0.5 C#5+E5+G#5+C#6/0.5 r/0.5 ' +
        sixteenths('G#3 B#3 D#4 G#4 B#3 D#4 G#4 B#4 D#4 G#4 B#4 D#5 G#4 B#4 D#5 G#5') +
        ' B#4+D#5+F#5+G#5/0.5 r/0.5 B#4+D#5+F#5+G#5/0.5 r/0.5 ' +
        sixteenths('G#3 C#4 E4 G#4 C#5 E5 G#5') + ' C#6/0.25 C#4+E4+G#4+C#5/2',
        rep('C#2+C#3/0.5 r/0.5', 4) + ' C#2+C#3/0.5 r/0.5 C#2+C#3/0.5 r/0.5 ' +
        rep('B#1+B#2/0.5 r/0.5', 4) + ' G#1+G#2/0.5 r/0.5 G#1+G#2/0.5 r/0.5 ' +
        'C#2+C#3/0.5 r/0.5 C#2+C#3/0.5 r/0.5 C#1+C#2/2'
      ]
    },
    {
      title: 'Galop Infernal (Can-Can)', composer: 'Jacques Offenbach', bpm: 172, timbre: 'piano',
      voices: [
        'C5/1 C5/1 D5/0.5 F5/0.5 E5/0.5 D5/0.5 G5/1 G5/1 G5/0.5 A5/0.5 E5/0.5 F5/0.5 ' +
        'D5/1 D5/1 D5/0.5 F5/0.5 E5/0.5 D5/0.5 C5/0.5 C6/0.5 B5/0.5 A5/0.5 G5/0.5 F5/0.5 E5/0.5 D5/0.5 ' +
        'C5/1 G4/0.5 E4/0.5 C4+C5/1 C4+E4+G4+C5/1',
        'C3/0.5 E3+G3/0.5 C3/0.5 E3+G3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 ' +
        'C3/0.5 E3+G3/0.5 C3/0.5 E3+G3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 ' +
        'C3/0.5 E3+G3/0.5 C3/0.5 E3+G3/0.5 G2/0.5 F3+B3/0.5 G2/0.5 F3+B3/0.5 ' +
        'C3/0.5 E3+G3/0.5 G2/0.5 B2/0.5 C2+C3/1 C2+C3/1'
      ]
    },
    {
      title: 'Toccata and Fugue in D minor', composer: 'J. S. Bach', bpm: 66, timbre: 'organ',
      voices: [
        'A4+A5/0.12 G4+G5/0.12 A4+A5/1.3 r/0.3 G4+G5/0.09 F4+F5/0.09 E4+E5/0.09 D4+D5/0.09 C#4+C#5/0.8 r/0.15 D4+D5/1.1 r/0.2 ' +
        'A3+A4/0.1 G3+G4/0.1 A3+A4/0.75 r/0.15 G3+G4/0.07 F3+F4/0.07 E3+E4/0.07 D3+D4/0.07 C#3+C#4/0.5 r/0.1 D3+D4/0.7 r/0.15 ' +
        sixteenths('D6 C#6 A#5 A5 G5 F5 E5 D5 C#5 A#4 A4 G4 F4 E4').replace(/0\.25/g, '0.055') + ' D4/0.3 ' +
        'C#3+E3+G3+A#3+C#4/0.9 D3+F3+A3+D4+F4+A4+D5/2',
        'r/7.28 D2/1.07 A1/0.9 D1+D2/2'
      ]
    },
    {
      title: 'Flight of the Bumblebee', composer: 'Nikolai Rimsky-Korsakov', bpm: 160, timbre: 'piano',
      voices: [
        [BEE_X, BEE_Y, BEE_X, BEE_Y, BEE_XA, BEE_YA, BEE_X, BEE_Y].join(' ') + ' ' +
        sixteenths('E5 D#5 D5 C#5 C5 B4 C5 B4') + ' A4/0.75 A3+E4+A4+C5+E5/1.5',
        rep('A2/0.5 r/0.5 E3/0.5 r/0.5', 4) + ' ' + rep('D3/0.5 r/0.5 A2/0.5 r/0.5', 2) + ' ' +
        rep('A2/0.5 r/0.5 E3/0.5 r/0.5', 2) + ' E2/0.5 r/0.5 E2/0.5 r/0.5 r/0.75 A1+A2/1.5'
      ]
    }
  ];
})();
