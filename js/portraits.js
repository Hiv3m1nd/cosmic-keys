/* Cosmic Keys — illustrated pianist portraits (smooth vector, animated talking + blinking) */
(function () {
  'use strict';
  var CK = window.CK;
  var TAU = Math.PI * 2;
  var S = 256; // canvas resolution
  CK.PORTRAIT_RES = S;

  function sh(hex, k) { return CK.shade(hex, k); }
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function radial(ctx, x, y, r0, r1, stops) {
    var g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  function linear(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }

  var EYES = {
    'Clara Schumann': '#5b4632', 'Ludwig van Beethoven': '#4a5a6a', 'Fanny Mendelssohn Hensel': '#4b3626',
    'Frédéric Chopin': '#6b7f95', 'Teresa Carreño': '#3d2a1e', 'Franz Liszt': '#5c7a93', 'Edvard Grieg': '#5a87b0',
    'Sergei Rachmaninoff': '#4f5964', 'Ignacy Jan Paderewski': '#5d7a8f', 'Vladimir Horowitz': '#3f3127',
    'Glenn Gould': '#5b6e85', 'Wolfgang Amadeus Mozart': '#6d8db0'
  };
  var FEMALE = { 'Clara Schumann': 1, 'Fanny Mendelssohn Hensel': 1, 'Teresa Carreño': 1 };

  CK.drawPortrait = function (canvas, look, t, talking, name) {
    if (canvas.width !== S) { canvas.width = S; canvas.height = S; }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    var cx = 128, hy = 104;               // head centre
    var hw = look.long ? 40 : 43, hh = look.long ? 54 : 50;
    var skin = look.skin, hair = look.hair;
    var female = !!FEMALE[name];
    var breathe = Math.sin(t * 1.8) * 1.2;
    var tilt = Math.sin(t * 0.9) * 0.025 + (talking ? Math.sin(t * 5) * 0.012 : 0);

    // Backdrop
    // Classical portrait backdrop: warm umber with a soft studio glow behind the sitter
    ctx.fillStyle = radial(ctx, cx - 20, 90, 10, 190, [[0, '#7a5a34'], [0.5, '#3e2b18'], [1, '#140d07']]);
    ctx.fillRect(0, 0, S, S);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = radial(ctx, 70, 60, 0, 130, [[0, 'rgba(255,214,150,0.18)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, 250); ctx.rotate(tilt * 0.4); ctx.translate(-cx, -250);

    // Hair behind head
    hairBack(ctx, look, cx, hy, hw, hh);

    // Shoulders & coat
    var shY = 196 + breathe;
    ctx.fillStyle = linear(ctx, 40, shY - 30, 216, S, [[0, sh(look.coat, 0.25)], [0.5, look.coat], [1, sh(look.coat, -0.45)]]);
    ctx.beginPath();
    ctx.moveTo(14, S + 4);
    ctx.bezierCurveTo(18, shY - 10, 60, shY - 26, cx - 26, shY - 34);
    ctx.lineTo(cx + 26, shY - 34);
    ctx.bezierCurveTo(196, shY - 26, 238, shY - 10, 242, S + 4);
    ctx.closePath(); ctx.fill();
    // lapels
    if (look.collar !== 'gown' && look.collar !== 'round' && look.collar !== 'lace') {
      ctx.fillStyle = sh(look.coat, -0.25);
      ctx.beginPath(); ctx.moveTo(cx - 26, shY - 34); ctx.lineTo(cx - 6, S); ctx.lineTo(cx - 52, S); ctx.lineTo(cx - 44, shY - 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 26, shY - 34); ctx.lineTo(cx + 6, S); ctx.lineTo(cx + 52, S); ctx.lineTo(cx + 44, shY - 6); ctx.closePath(); ctx.fill();
    }
    // fabric fold highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(56, shY + 10); ctx.quadraticCurveTo(70, shY + 30, 66, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(200, shY + 10); ctx.quadraticCurveTo(188, shY + 30, 192, S); ctx.stroke();

    // Neck
    ctx.fillStyle = linear(ctx, cx, hy + 30, cx, shY - 20, [[0, sh(skin, -0.25)], [1, sh(skin, -0.08)]]);
    ctx.beginPath(); ctx.moveTo(cx - 19, hy + 30); ctx.lineTo(cx + 19, hy + 30); ctx.lineTo(cx + 23, shY - 22); ctx.quadraticCurveTo(cx, shY - 10, cx - 23, shY - 22); ctx.closePath(); ctx.fill();
    if (look.collar === 'gown') {
      ctx.fillStyle = linear(ctx, cx, shY - 40, cx, shY + 10, [[0, sh(skin, -0.1)], [1, sh(skin, -0.2)]]);
      ell(ctx, cx, shY - 22, 46, 18); ctx.fill();
      ctx.strokeStyle = look.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, shY - 52, 46, Math.PI * 0.32, Math.PI * 0.68); ctx.stroke();
      ctx.fillStyle = look.accent; ell(ctx, cx, shY - 7, 5, 6); ctx.fill();
    }
    neckwear(ctx, look, cx, shY);

    // Ears
    [-1, 1].forEach(function (s) {
      ctx.fillStyle = sh(skin, -0.05);
      ell(ctx, cx + s * (hw - 1), hy + 6, 9, 14, s * 0.15); ctx.fill();
      ctx.fillStyle = sh(skin, -0.22);
      ell(ctx, cx + s * (hw - 1), hy + 7, 4.5, 8, s * 0.15); ctx.fill();
    });

    // Head
    ctx.beginPath();
    ctx.moveTo(cx, hy - hh);
    ctx.bezierCurveTo(cx + hw * 1.05, hy - hh, cx + hw * 1.02, hy + 6, cx + hw * 0.86, hy + hh * 0.45);
    ctx.bezierCurveTo(cx + hw * 0.62, hy + hh * 0.95, cx + hw * 0.25, hy + hh * 1.02, cx, hy + hh * 1.02);
    ctx.bezierCurveTo(cx - hw * 0.25, hy + hh * 1.02, cx - hw * 0.62, hy + hh * 0.95, cx - hw * 0.86, hy + hh * 0.45);
    ctx.bezierCurveTo(cx - hw * 1.02, hy + 6, cx - hw * 1.05, hy - hh, cx, hy - hh);
    ctx.closePath();
    ctx.fillStyle = radial(ctx, cx - 14, hy - 18, 6, hw * 1.6, [[0, sh(skin, 0.18)], [0.55, skin], [1, sh(skin, -0.28)]]);
    ctx.fill();
    // jaw shadow & cheeks
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(120,50,40,0.13)';
    ell(ctx, cx + hw * 0.55, hy + 10, hw * 0.5, hh * 0.9); ctx.fill();
    ctx.fillStyle = 'rgba(255,110,110,0.16)';
    ell(ctx, cx - 22, hy + 22, 11, 7); ctx.fill(); ell(ctx, cx + 22, hy + 22, 11, 7); ctx.fill();
    ctx.restore();

    // Eyes
    var blinkPh = (t * 0.28 + (name ? name.length * 0.13 : 0)) % 1;
    var blink = blinkPh < 0.03 ? Math.sin(blinkPh / 0.03 * Math.PI) : 0;
    var eyeY = hy + 2, iris = EYES[name] || '#5a4a3a';
    var lookX = Math.sin(t * 0.6) * 1.5;
    [-1, 1].forEach(function (s) {
      var ex = cx + s * 17;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ex - 10, eyeY);
      ctx.quadraticCurveTo(ex, eyeY - 8 * (1 - blink), ex + 10, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + 5 * (1 - blink), ex - 10, eyeY);
      ctx.closePath();
      ctx.fillStyle = '#f7f3ee'; ctx.fill();
      ctx.clip();
      ctx.fillStyle = radial(ctx, ex + lookX, eyeY - 0.5, 0.5, 6, [[0, sh(iris, 0.35)], [1, sh(iris, -0.3)]]);
      ell(ctx, ex + lookX, eyeY - 0.5, 5.4, 5.4); ctx.fill();
      ctx.fillStyle = '#111'; ell(ctx, ex + lookX, eyeY - 0.5, 2.4, 2.4); ctx.fill();
      ctx.fillStyle = '#fff'; ell(ctx, ex + lookX - 1.8, eyeY - 2.6, 1.4, 1.4); ctx.fill();
      ctx.restore();
      // upper lid line
      ctx.strokeStyle = '#3a2420'; ctx.lineWidth = female ? 2.6 : 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - 11, eyeY + 0.5); ctx.quadraticCurveTo(ex, eyeY - 8.5 * (1 - blink) - 0.5, ex + 11, eyeY - 0.5); ctx.stroke();
      if (female) { ctx.beginPath(); ctx.moveTo(ex + s * 10, eyeY - 1); ctx.lineTo(ex + s * 13, eyeY - 4); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(120,60,50,0.25)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ex - 8, eyeY + 4); ctx.quadraticCurveTo(ex, eyeY + 7, ex + 8, eyeY + 4); ctx.stroke();
    });
    // Brows
    var browCol = hair === '#f1efe9' || hair === '#ecebe6' || hair === '#c9c6c0' ? '#8d8679' : sh(hair, -0.15);
    ctx.fillStyle = browCol;
    [-1, 1].forEach(function (s) {
      var bx = cx + s * 17, by = eyeY - 13;
      var stern = look.brow === 'stern';
      var lift = talking ? Math.max(0, Math.sin(t * 3)) * 1.5 : 0;
      ctx.beginPath();
      ctx.moveTo(bx - s * 12, by + (stern ? -2 : 2) - lift);
      ctx.quadraticCurveTo(bx, by - 5 - lift, bx + s * 13, by + (stern ? 4 : 1) - lift);
      ctx.quadraticCurveTo(bx, by - 1.5 - lift, bx - s * 12, by + (stern ? 1 : 4) - lift);
      ctx.closePath(); ctx.fill();
    });
    // Nose
    ctx.strokeStyle = 'rgba(110,50,40,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + 3, eyeY + 4); ctx.quadraticCurveTo(cx + 7, eyeY + 17, cx + 5, eyeY + 22); ctx.stroke();
    ctx.fillStyle = 'rgba(110,50,40,0.3)';
    ell(ctx, cx - 5, eyeY + 23, 3, 1.8); ctx.fill(); ell(ctx, cx + 5, eyeY + 23, 3, 1.8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ell(ctx, cx - 1, eyeY + 18, 2.5, 2); ctx.fill();

    // Mouth
    var mY = eyeY + 37;
    var open = talking ? Math.max(0, Math.sin(t * 15) * 0.6 + Math.sin(t * 9.1) * 0.4) : 0;
    var stern2 = look.brow === 'stern';
    if (open > 0.15) {
      ctx.fillStyle = '#5a1a22';
      ctx.beginPath(); ctx.moveTo(cx - 11, mY); ctx.quadraticCurveTo(cx, mY - 3, cx + 11, mY); ctx.quadraticCurveTo(cx, mY + 4 + open * 9, cx - 11, mY); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 7, mY - 1.5, 14, 2.6);
      ctx.fillStyle = '#d0606e'; ell(ctx, cx, mY + 2 + open * 6, 6, 2.2); ctx.fill();
    } else {
      ctx.strokeStyle = female ? '#b44a5c' : '#8e4a48'; ctx.lineWidth = female ? 3.4 : 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      if (stern2) { ctx.moveTo(cx - 10, mY + 1); ctx.quadraticCurveTo(cx, mY - 1, cx + 10, mY + 1); }
      else { ctx.moveTo(cx - 12, mY - 1); ctx.quadraticCurveTo(cx, mY + 6, cx + 12, mY - 1); }
      ctx.stroke();
      if (female) { ctx.fillStyle = 'rgba(200,80,100,0.35)'; ell(ctx, cx, mY + 4, 7, 2.6); ctx.fill(); }
    }
    // Facial hair
    if (look.mustache) {
      ctx.fillStyle = linear(ctx, cx, mY - 14, cx, mY + 2, [[0, sh(look.mustache, 0.1)], [1, sh(look.mustache, -0.15)]]);
      ctx.beginPath();
      ctx.moveTo(cx, mY - 11);
      ctx.bezierCurveTo(cx - 10, mY - 15, cx - 24, mY - 10, cx - 27, mY + 3);
      ctx.bezierCurveTo(cx - 18, mY - 2, cx - 8, mY - 2, cx, mY - 4);
      ctx.bezierCurveTo(cx + 8, mY - 2, cx + 18, mY - 2, cx + 27, mY + 3);
      ctx.bezierCurveTo(cx + 24, mY - 10, cx + 10, mY - 15, cx, mY - 11);
      ctx.fill();
    }

    // Hair in front
    hairFront(ctx, look, cx, hy, hw, hh, t);
    if (look.cap) cap(ctx, look, cx, hy, hw, hh);
    if (look.hairStyle === 'updo') {
      ctx.fillStyle = radial(ctx, cx - hw - 2, hy + 24, 0, 6, [[0, '#fff6c8'], [1, look.accent]]);
      ell(ctx, cx - hw + 1, hy + 24, 3.5, 5); ctx.fill(); ell(ctx, cx + hw - 1, hy + 24, 3.5, 5); ctx.fill();
    }
    ctx.restore();

    // Soft vignette, then varnish and canvas weave so it reads as an oil painting
    ctx.fillStyle = radial(ctx, cx, 120, 90, 182, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,10,4,0.6)']]);
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.55;
    ctx.drawImage(weave(), 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(140,90,20,0.07)'; ctx.fillRect(0, 0, S, S);
  };

  var weaveCanvas = null;
  function weave() {
    if (weaveCanvas) return weaveCanvas;
    var c = document.createElement('canvas'); c.width = S; c.height = S;
    var x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data, rnd = CK.Motion ? CK.Motion.rng(9) : Math.random;
    for (var i = 0; i < S * S; i++) {
      var px = i % S, py = (i / S) | 0;
      var v = 128 + (rnd() - 0.5) * 50 + ((px % 3 === 0) ? 14 : 0) + ((py % 3 === 0) ? -14 : 0);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    weaveCanvas = c;
    return c;
  }

  function hairBack(ctx, look, cx, hy, hw, hh) {
    var hair = look.hair;
    ctx.fillStyle = linear(ctx, cx, hy - hh - 20, cx, hy + hh, [[0, sh(hair, 0.05)], [1, sh(hair, -0.35)]]);
    switch (look.hairStyle) {
      case 'long':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 10, hy - 10);
        ctx.bezierCurveTo(cx - hw - 20, hy + 60, cx - hw - 14, hy + 100, cx - hw + 4, hy + 108);
        ctx.lineTo(cx + hw - 4, hy + 108);
        ctx.bezierCurveTo(cx + hw + 14, hy + 100, cx + hw + 20, hy + 60, cx + hw + 10, hy - 10);
        ctx.bezierCurveTo(cx + hw + 6, hy - hh - 18, cx - hw - 6, hy - hh - 18, cx - hw - 10, hy - 10);
        ctx.fill(); break;
      case 'cloud':
        for (var i = 0; i < 14; i++) {
          var a = Math.PI * 0.85 + i / 13 * Math.PI * 1.3;
          ell(ctx, cx + Math.cos(a) * (hw + 14), hy - 8 + Math.sin(a) * (hh + 8), 22, 20); ctx.fill();
        }
        ell(ctx, cx, hy - 12, hw + 22, hh + 6); ctx.fill(); break;
      case 'wild':
        for (var w = 0; w < 12; w++) {
          var aw = Math.PI * 0.9 + w / 11 * Math.PI * 1.2;
          ell(ctx, cx + Math.cos(aw) * (hw + 8), hy - 6 + Math.sin(aw) * (hh + 4), 18, 15, aw); ctx.fill();
        }
        break;
      case 'ringlets':
        ell(ctx, cx, hy - 6, hw + 10, hh + 6); ctx.fill();
        break;
      case 'bun':
        ell(ctx, cx, hy - 4, hw + 6, hh + 4); ctx.fill();
        ell(ctx, cx, hy - hh - 14, 20, 17); ctx.fill();
        break;
      case 'updo':
        ell(ctx, cx, hy - 6, hw + 6, hh + 4); ctx.fill();
        ell(ctx, cx + 4, hy - hh - 18, 28, 20); ctx.fill();
        break;
      case 'wig':
        ell(ctx, cx, hy - 4, hw + 8, hh + 4); ctx.fill();
        break;
      default:
        ell(ctx, cx, hy - 8, hw + 5, hh + 2); ctx.fill();
    }
  }

  function strands(ctx, color, list) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    list.forEach(function (p) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(p[2], p[3], p[4], p[5]); ctx.stroke(); });
  }

  function hairFront(ctx, look, cx, hy, hw, hh, t) {
    var hair = look.hair, hl = sh(hair, 0.35), dk = sh(hair, -0.25);
    var top = hy - hh;
    ctx.fillStyle = linear(ctx, cx - hw, top - 10, cx + hw, hy, [[0, sh(hair, 0.18)], [0.6, hair], [1, dk]]);
    switch (look.hairStyle) {
      case 'bun':
      case 'updo':
        ctx.beginPath();
        ctx.moveTo(cx, top - 4);
        ctx.bezierCurveTo(cx - hw * 0.9, top - 4, cx - hw - 6, hy - 20, cx - hw - 2, hy + 14);
        ctx.bezierCurveTo(cx - hw + 8, hy - 18, cx - 20, top + 16, cx - 1, top + 12);
        ctx.bezierCurveTo(cx + 20, top + 16, cx + hw - 8, hy - 18, cx + hw + 2, hy + 14);
        ctx.bezierCurveTo(cx + hw + 6, hy - 20, cx + hw * 0.9, top - 4, cx, top - 4);
        ctx.fill();
        strands(ctx, hl, [[cx - 4, top + 2, cx - 26, top + 6, cx - hw + 2, hy - 8], [cx + 4, top + 2, cx + 26, top + 6, cx + hw - 2, hy - 8]]);
        ctx.strokeStyle = dk; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, top - 2); ctx.lineTo(cx, top + 12); ctx.stroke();
        break;
      case 'ringlets':
        ctx.beginPath();
        ctx.moveTo(cx, top - 6);
        ctx.bezierCurveTo(cx - hw, top - 8, cx - hw - 6, hy - 14, cx - hw - 2, hy + 4);
        ctx.bezierCurveTo(cx - hw + 10, hy - 18, cx - 20, top + 14, cx, top + 12);
        ctx.bezierCurveTo(cx + 20, top + 14, cx + hw - 10, hy - 18, cx + hw + 2, hy + 4);
        ctx.bezierCurveTo(cx + hw + 6, hy - 14, cx + hw, top - 8, cx, top - 6);
        ctx.fill();
        for (var r = 0; r < 4; r++) {
          [-1, 1].forEach(function (s) {
            var rx = cx + s * (hw + 6), ry = hy + 4 + r * 13;
            ctx.fillStyle = radial(ctx, rx - 3, ry - 3, 1, 9, [[0, hl], [1, dk]]);
            ell(ctx, rx, ry, 8, 7.5); ctx.fill();
          });
        }
        break;
      case 'wild':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 8, hy + 2);
        for (var i = 0; i <= 10; i++) {
          var x = cx - hw - 8 + i * (hw * 2 + 16) / 10;
          var y = top + 12 + (i % 2 ? -18 : 4) + Math.sin(i * 1.7) * 6;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(cx + hw + 8, hy + 2);
        ctx.bezierCurveTo(cx + hw + 6, top - 20, cx - hw - 6, top - 20, cx - hw - 8, hy + 2);
        ctx.fill();
        strands(ctx, hl, [[cx - 30, top, cx - 18, top + 10, cx - 6, top + 22], [cx + 6, top - 4, cx + 14, top + 8, cx + 26, top + 18], [cx - hw, hy - 20, cx - hw + 6, hy - 6, cx - hw + 4, hy + 6]]);
        break;
      case 'cloud':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 6, hy - 4);
        ctx.bezierCurveTo(cx - hw - 4, top - 18, cx + hw + 4, top - 18, cx + hw + 6, hy - 4);
        ctx.bezierCurveTo(cx + hw - 2, hy - 26, cx + 20, top + 10, cx, top + 12);
        ctx.bezierCurveTo(cx - 20, top + 10, cx - hw + 2, hy - 26, cx - hw - 6, hy - 4);
        ctx.fill();
        strands(ctx, hl, [[cx - 34, top - 4, cx - 20, top - 10, cx - 6, top + 4], [cx + 6, top - 6, cx + 22, top - 10, cx + 34, top + 2], [cx - 10, top - 8, cx, top - 14, cx + 12, top - 6]]);
        break;
      case 'long':
        ctx.beginPath();
        ctx.moveTo(cx - 2, top - 6);
        ctx.bezierCurveTo(cx - hw, top - 6, cx - hw - 8, hy - 10, cx - hw - 6, hy + 60);
        ctx.lineTo(cx - hw + 6, hy + 60);
        ctx.bezierCurveTo(cx - hw + 4, hy - 4, cx - 24, top + 14, cx - 2, top + 10);
        ctx.bezierCurveTo(cx + 24, top + 14, cx + hw - 4, hy - 4, cx + hw - 6, hy + 60);
        ctx.lineTo(cx + hw + 6, hy + 60);
        ctx.bezierCurveTo(cx + hw + 8, hy - 10, cx + hw, top - 6, cx - 2, top - 6);
        ctx.fill();
        strands(ctx, hl, [[cx - 6, top, cx - hw + 2, top + 10, cx - hw - 2, hy + 40], [cx + 6, top, cx + hw - 2, top + 10, cx + hw + 2, hy + 40]]);
        break;
      case 'swept':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 4, hy - 2);
        ctx.bezierCurveTo(cx - hw - 6, top - 14, cx + hw * 0.5, top - 20, cx + hw + 4, hy - 8);
        ctx.bezierCurveTo(cx + hw - 6, hy - 30, cx + 10, top + 8, cx - 14, top + 16);
        ctx.bezierCurveTo(cx - 28, top + 20, cx - hw + 4, hy - 22, cx - hw - 4, hy - 2);
        ctx.fill();
        strands(ctx, hl, [[cx - 24, top + 4, cx, top - 8, cx + 28, top + 2], [cx - 30, top + 12, cx - 4, top - 2, cx + 22, top + 10]]);
        break;
      case 'buzz':
        ctx.save();
        ctx.beginPath(); ctx.ellipse(cx, hy - 14, hw + 1, hh - 6, 0, Math.PI, Math.PI * 2); ctx.closePath();
        ctx.globalAlpha = 0.92; ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        for (var bz = 0; bz < 40; bz++) { var ba = Math.PI + bz / 40 * Math.PI; ctx.fillRect(cx + Math.cos(ba) * (hw - 6) * Math.random(), hy - 14 + Math.sin(ba) * (hh - 10) * Math.random(), 1.4, 1.4); }
        break;
      case 'slick':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 2, hy - 2);
        ctx.bezierCurveTo(cx - hw - 4, top - 14, cx + hw + 4, top - 14, cx + hw + 2, hy - 2);
        ctx.bezierCurveTo(cx + hw - 4, hy - 26, cx + 16, top + 10, cx - 2, top + 10);
        ctx.bezierCurveTo(cx - 18, top + 10, cx - hw + 4, hy - 26, cx - hw - 2, hy - 2);
        ctx.fill();
        ctx.strokeStyle = hl; ctx.lineWidth = 3; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(cx - 26, top + 2); ctx.quadraticCurveTo(cx, top - 10, cx + 26, top + 2); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      case 'messy':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 4, hy);
        ctx.bezierCurveTo(cx - hw - 6, top - 12, cx + hw + 6, top - 12, cx + hw + 4, hy);
        ctx.lineTo(cx + hw - 6, hy - 18); ctx.lineTo(cx + 18, top + 16); ctx.lineTo(cx + 6, top + 8); ctx.lineTo(cx - 8, top + 18); ctx.lineTo(cx - 22, top + 10); ctx.lineTo(cx - hw + 6, hy - 16);
        ctx.closePath(); ctx.fill();
        break;
      case 'wig':
        ctx.beginPath();
        ctx.moveTo(cx - hw - 2, hy - 2);
        ctx.bezierCurveTo(cx - hw - 4, top - 16, cx + hw + 4, top - 16, cx + hw + 2, hy - 2);
        ctx.bezierCurveTo(cx + hw - 6, hy - 22, cx + 14, top + 10, cx, top + 10);
        ctx.bezierCurveTo(cx - 14, top + 10, cx - hw + 6, hy - 22, cx - hw - 2, hy - 2);
        ctx.fill();
        // side rolls
        for (var k = 0; k < 2; k++) {
          [-1, 1].forEach(function (s) {
            var rx = cx + s * (hw + 4), ry = hy - 6 + k * 15;
            ctx.fillStyle = radial(ctx, rx - 3, ry - 3, 1, 12, [[0, '#ffffff'], [1, sh(hair, -0.18)]]);
            ell(ctx, rx, ry, 11, 7.5); ctx.fill();
            ctx.strokeStyle = sh(hair, -0.25); ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI * 1.5); ctx.stroke();
          });
        }
        break;
      default:
        ell(ctx, cx, top + 6, hw, 16); ctx.fill();
    }
  }

  function cap(ctx, look, cx, hy, hw, hh) {
    var top = hy - hh;
    ctx.fillStyle = linear(ctx, cx, top - 20, cx, top + 16, [[0, sh(look.cap, 0.25)], [1, sh(look.cap, -0.2)]]);
    ctx.beginPath();
    ctx.moveTo(cx - hw - 6, top + 18);
    ctx.bezierCurveTo(cx - hw - 4, top - 22, cx + hw + 2, top - 22, cx + hw + 6, top + 12);
    ctx.quadraticCurveTo(cx + hw + 22, top + 16, cx + hw + 20, top + 22);
    ctx.lineTo(cx - hw - 6, top + 22);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - hw, top + 4); ctx.quadraticCurveTo(cx, top - 12, cx + hw, top + 4); ctx.stroke();
  }

  function neckwear(ctx, look, cx, shY) {
    var acc = look.accent;
    switch (look.collar) {
      case 'cravat':
        ctx.fillStyle = '#f6f4ee';
        ctx.beginPath(); ctx.moveTo(cx - 22, shY - 36); ctx.lineTo(cx + 22, shY - 36); ctx.lineTo(cx + 12, shY - 4); ctx.lineTo(cx - 12, shY - 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = linear(ctx, cx, shY - 30, cx, shY + 20, [[0, acc], [1, sh(acc, -0.25)]]);
        ctx.beginPath(); ctx.moveTo(cx - 12, shY - 22); ctx.quadraticCurveTo(cx, shY - 12, cx + 12, shY - 22); ctx.lineTo(cx + 8, shY + 24); ctx.quadraticCurveTo(cx, shY + 30, cx - 8, shY + 24); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - 4, shY - 12); ctx.lineTo(cx - 2, shY + 22); ctx.stroke();
        break;
      case 'jabot':
        for (var j = 0; j < 5; j++) {
          ctx.fillStyle = j % 2 ? '#f3efe6' : '#ffffff';
          ell(ctx, cx, shY - 26 + j * 10, 14 - j, 7); ctx.fill();
        }
        ctx.strokeStyle = acc; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(cx - 52, shY - 8); ctx.lineTo(cx - 40, S); ctx.moveTo(cx + 52, shY - 8); ctx.lineTo(cx + 40, S); ctx.stroke();
        for (var b = 0; b < 3; b++) { ctx.fillStyle = acc; ell(ctx, cx - 30, shY + 14 + b * 16, 3, 3); ctx.fill(); ell(ctx, cx + 30, shY + 14 + b * 16, 3, 3); ctx.fill(); }
        break;
      case 'lace':
        ctx.fillStyle = acc;
        for (var l = 0; l < 9; l++) { ell(ctx, cx - 32 + l * 8, shY - 28 + Math.abs(l - 4) * -1.5, 7, 9); ctx.fill(); }
        ctx.fillStyle = '#ffd76a'; ell(ctx, cx, shY - 18, 4, 4); ctx.fill();
        break;
      case 'round':
        ctx.fillStyle = acc;
        ctx.beginPath(); ctx.ellipse(cx, shY - 30, 30, 10, 0, 0, Math.PI); ctx.lineTo(cx - 30, shY - 30); ctx.fill();
        ctx.fillStyle = '#ffd76a'; ell(ctx, cx, shY - 18, 4, 4); ctx.fill();
        break;
      case 'abbe':
        ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 12, shY - 36, 24, 8);
        break;
      case 'bow':
      case 'bowred':
        ctx.fillStyle = '#f7f6f2';
        ctx.beginPath(); ctx.moveTo(cx - 24, shY - 36); ctx.lineTo(cx, shY + 14); ctx.lineTo(cx + 24, shY - 36); ctx.closePath(); ctx.fill();
        var bc = look.collar === 'bowred' ? acc : '#1b1b24';
        ctx.fillStyle = bc;
        ctx.beginPath(); ctx.moveTo(cx, shY - 26); ctx.quadraticCurveTo(cx - 14, shY - 36, cx - 20, shY - 30); ctx.quadraticCurveTo(cx - 22, shY - 20, cx - 18, shY - 14); ctx.quadraticCurveTo(cx - 10, shY - 16, cx, shY - 22); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx, shY - 26); ctx.quadraticCurveTo(cx + 14, shY - 36, cx + 20, shY - 30); ctx.quadraticCurveTo(cx + 22, shY - 20, cx + 18, shY - 14); ctx.quadraticCurveTo(cx + 10, shY - 16, cx, shY - 22); ctx.fill();
        ctx.fillStyle = sh(bc, -0.2); ell(ctx, cx, shY - 24, 4.5, 5); ctx.fill();
        break;
      case 'tie':
        ctx.fillStyle = '#f2f0ea';
        ctx.beginPath(); ctx.moveTo(cx - 22, shY - 36); ctx.lineTo(cx, shY + 10); ctx.lineTo(cx + 22, shY - 36); ctx.closePath(); ctx.fill();
        ctx.fillStyle = linear(ctx, cx, shY - 30, cx, S, [[0, '#5a6078'], [1, '#2c3042']]);
        ctx.beginPath(); ctx.moveTo(cx - 6, shY - 30); ctx.lineTo(cx + 6, shY - 30); ctx.lineTo(cx + 10, S); ctx.lineTo(cx - 10, S); ctx.closePath(); ctx.fill();
        break;
      case 'scarf':
        ctx.fillStyle = linear(ctx, cx - 40, shY - 40, cx + 40, shY, [[0, sh(acc, 0.2)], [1, sh(acc, -0.2)]]);
        ctx.beginPath(); ctx.moveTo(cx - 36, shY - 40); ctx.quadraticCurveTo(cx, shY - 22, cx + 36, shY - 40); ctx.lineTo(cx + 40, shY - 20); ctx.quadraticCurveTo(cx, shY - 2, cx - 40, shY - 20); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx + 10, shY - 22); ctx.lineTo(cx + 34, shY - 22); ctx.lineTo(cx + 30, S); ctx.lineTo(cx + 12, S); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
        for (var st = 0; st < 4; st++) { ctx.beginPath(); ctx.moveTo(cx + 13, shY + st * 14); ctx.lineTo(cx + 31, shY + st * 14); ctx.stroke(); }
        break;
    }
  }
})();
