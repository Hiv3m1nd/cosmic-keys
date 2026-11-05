/* Cosmic Keys — the mischievous green space monster (smooth vector, fully animated) */
(function () {
  'use strict';
  var CK = window.CK;
  var TAU = Math.PI * 2;

  function shadeHex(hex, k) { return CK.shade(hex, k); }

  /**
   * Back layer: aura glow + tentacles (drawn before the note card).
   * o: { t, size, mood, variant, sx, sy (squash) }
   */
  CK.drawMonsterBack = function (ctx, x, y, o) {
    var u = o.size / 100, t = o.t, v = o.variant;
    var base = v.base;
    ctx.save();
    ctx.translate(x, y);
    // aura
    ctx.globalCompositeOperation = 'lighter';
    var ag = ctx.createRadialGradient(0, 0, 10 * u, 0, 0, 95 * u);
    ag.addColorStop(0, CK.hexA('#6dff9c', 0.32 + (o.pulse || 0) * 0.2));
    ag.addColorStop(1, CK.hexA('#6dff9c', 0));
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(0, 0, 95 * u, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // tentacles flaring out behind the card
    var dark = shadeHex(base, -0.35);
    for (var i = 0; i < 4; i++) {
      var side = i < 2 ? -1 : 1, inner = i % 2 === 0;
      var bx = side * (inner ? 16 : 30) * u, by = 30 * u;
      var sway = Math.sin(t * 3.2 + i * 1.3 + v.phase) * 10 * u;
      var ex = bx + side * (inner ? 18 : 40) * u + sway, ey = by + (inner ? 58 : 44) * u;
      var g = ctx.createLinearGradient(bx, by, ex, ey);
      g.addColorStop(0, base); g.addColorStop(1, dark);
      ctx.strokeStyle = '#0c3a22'; ctx.lineCap = 'round';
      ctx.lineWidth = 13 * u;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + side * 6 * u + sway * 0.5, (by + ey) / 2 + 6 * u, ex, ey); ctx.stroke();
      ctx.strokeStyle = g; ctx.lineWidth = 9.5 * u;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + side * 6 * u + sway * 0.5, (by + ey) / 2 + 6 * u, ex, ey); ctx.stroke();
      ctx.fillStyle = shadeHex(base, 0.35);
      ctx.beginPath(); ctx.arc(ex, ey, 3.2 * u, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  /**
   * Front layer: body, horns, antenna, eye, grin, arms gripping the card.
   * o.grip: [{x,y},{x,y}] world positions of the card's top corners.
   */
  CK.drawMonsterFront = function (ctx, x, y, o) {
    var u = o.size / 100, t = o.t, v = o.variant, mood = o.mood;
    var base = v.base, light = shadeHex(base, 0.45), dark = shadeHex(base, -0.38), outline = '#0b331f';
    var laugh = mood === 'laugh', alarm = mood === 'alarm';
    ctx.save();
    ctx.translate(x, y);

    // Arms to the card corners (drawn first so the body overlaps their roots)
    if (o.grip) {
      for (var a = 0; a < 2; a++) {
        var side = a === 0 ? -1 : 1;
        var sx0 = side * 34 * u, sy0 = 14 * u;
        var gx = o.grip[a].x - x, gy = o.grip[a].y - y;
        var mx = (sx0 + gx) / 2 + side * 14 * u, my = (sy0 + gy) / 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = outline; ctx.lineWidth = 11 * u;
        ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.quadraticCurveTo(mx, my, gx, gy); ctx.stroke();
        ctx.strokeStyle = shadeHex(base, -0.1); ctx.lineWidth = 7.5 * u;
        ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.quadraticCurveTo(mx, my, gx, gy); ctx.stroke();
        // three little fingers gripping the card edge
        ctx.fillStyle = shadeHex(base, 0.1); ctx.strokeStyle = outline; ctx.lineWidth = 1.6 * u;
        for (var f = -1; f <= 1; f++) {
          ctx.beginPath(); ctx.arc(gx + f * 4 * u, gy + 2.5 * u, 3.4 * u, 0, TAU); ctx.fill(); ctx.stroke();
        }
      }
    }

    // squash & stretch around the body's base
    ctx.translate(0, 30 * u);
    ctx.scale(o.sx || 1, o.sy || 1);
    ctx.translate(0, -30 * u);
    if (laugh) ctx.translate(Math.sin(t * 40) * 1.8 * u, 0);
    if (alarm) ctx.translate(Math.sin(t * 70) * 1.2 * u, 0);

    // Horns
    for (var h = -1; h <= 1; h += 2) {
      ctx.save();
      ctx.translate(h * 24 * u, -30 * u);
      ctx.rotate(h * 0.35);
      var hg = ctx.createLinearGradient(0, 0, 0, -22 * u);
      hg.addColorStop(0, '#5b3fd0'); hg.addColorStop(1, '#d4c2ff');
      ctx.fillStyle = hg; ctx.strokeStyle = outline; ctx.lineWidth = 2.4 * u;
      ctx.beginPath(); ctx.moveTo(-7 * u, 2 * u); ctx.quadraticCurveTo(-4 * u, -14 * u, h * 5 * u, -22 * u); ctx.quadraticCurveTo(2 * u, -10 * u, 7 * u, 2 * u); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Antenna with lagging glowing bulb (secondary motion)
    var lag = Math.sin(t * 3 + v.phase - 0.6) * 8 * u + (o.leanX || 0) * 6 * u;
    ctx.strokeStyle = outline; ctx.lineWidth = 3 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -38 * u); ctx.quadraticCurveTo(lag * 0.3, -52 * u, lag, -62 * u); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    var bulbS = 30 * u * (1 + (o.pulse || 0) * 0.35);
    ctx.drawImage(CK.glowSprite('#d8ff5e'), lag - bulbS / 2, -62 * u - bulbS / 2, bulbS, bulbS);
    ctx.restore();
    ctx.fillStyle = '#efff9a'; ctx.beginPath(); ctx.arc(lag, -62 * u, 4.5 * u, 0, TAU); ctx.fill();

    // Body: soft blob with gentle wobble
    ctx.beginPath();
    var pts = 18;
    for (var i = 0; i <= pts; i++) {
      var ang = i / pts * TAU;
      var wob = 1 + Math.sin(ang * 3 + t * 2.2 + v.phase) * 0.025 + Math.sin(ang * 5 - t * 1.7) * 0.015;
      var rx = 46 * u * (v.wide || 1) * wob, ry = 41 * u * wob * (ang > 0 && ang < Math.PI ? 0.95 : 1);
      var px = Math.cos(ang) * rx, py = Math.sin(ang) * ry;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var bg = ctx.createRadialGradient(-16 * u, -20 * u, 4 * u, 0, 0, 52 * u);
    bg.addColorStop(0, light); bg.addColorStop(0.45, base); bg.addColorStop(1, dark);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 3.2 * u; ctx.strokeStyle = outline; ctx.stroke();
    // rim light from the piano's neon below
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(140, 255, 235, 0.55)'; ctx.lineWidth = 4 * u;
    ctx.beginPath(); ctx.ellipse(0, 4 * u, 44 * u * (v.wide || 1), 38 * u, 0, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    // belly + spots
    ctx.fillStyle = CK.hexA('#d9ffd0', 0.22);
    ctx.beginPath(); ctx.ellipse(0, 22 * u, 28 * u, 15 * u, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = CK.hexA('#0f4d2b', 0.28);
    [[28, -14, 5], [33, 4, 3.4], [-34, 8, 4], [-26, -22, 2.8]].forEach(function (sp) {
      ctx.beginPath(); ctx.arc(sp[0] * u, sp[1] * u, sp[2] * u, 0, TAU); ctx.fill();
    });
    ctx.restore();
    // glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath(); ctx.ellipse(-20 * u, -24 * u, 12 * u, 6 * u, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.ellipse(-25 * u, -26 * u, 3.5 * u, 2 * u, -0.5, 0, TAU); ctx.fill();

    // Spikes on later levels
    if (v.spikes) {
      ctx.fillStyle = dark; ctx.strokeStyle = outline; ctx.lineWidth = 2 * u;
      for (var k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 12 * u - 5 * u, -38 * u); ctx.lineTo(k * 12 * u, -48 * u + Math.abs(k) * 3 * u); ctx.lineTo(k * 12 * u + 5 * u, -38 * u);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    // The big scheming eye
    var ex = 0, ey = -8 * u, erx = 21 * u, ery = 18 * u;
    if (laugh) {
      ctx.strokeStyle = outline; ctx.lineWidth = 4 * u; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ex, ey + 6 * u, 14 * u, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      // tears of joy
      ctx.fillStyle = 'rgba(160,230,255,0.85)';
      var tear = (t * 2) % 1;
      ctx.beginPath(); ctx.ellipse(ex + 17 * u, ey + 2 * u + tear * 10 * u, 2.2 * u, 3.2 * u, 0, 0, TAU); ctx.fill();
    } else {
      var sc = alarm ? 1.12 : 1;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(ex, ey, erx * sc, ery * sc, 0, 0, TAU);
      var sg = ctx.createRadialGradient(ex - 5 * u, ey - 6 * u, 2 * u, ex, ey, erx);
      sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#d6e4dc');
      ctx.fillStyle = sg; ctx.fill();
      ctx.lineWidth = 3 * u; ctx.strokeStyle = outline; ctx.stroke();
      ctx.clip();
      var lx = ex + (o.look || 0) * 6 * u, ly = ey + 2 * u;
      var ig = ctx.createRadialGradient(lx, ly, 1 * u, lx, ly, 11 * u);
      ig.addColorStop(0, alarm ? '#ff8a8a' : '#fff07a'); ig.addColorStop(0.6, alarm ? '#ff3b5c' : '#ffb21e'); ig.addColorStop(1, alarm ? '#a3122e' : '#e0620a');
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(lx, ly, (alarm ? 8 : 11) * u, 0, TAU); ctx.fill();
      ctx.fillStyle = '#120a12';
      ctx.beginPath(); ctx.ellipse(lx, ly, (alarm ? 2 : 2.8) * u, (alarm ? 2.4 : 8) * u, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(lx - 4 * u, ly - 4.5 * u, 2.6 * u, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(lx + 3 * u, ly + 3 * u, 1.2 * u, 0, TAU); ctx.fill();
      // heavy upper lid = scheming look; blinks close it fully
      var lid = alarm ? 0 : CK.clamp((o.blink || 0) + 0.36, 0, 1);
      if (lid > 0) {
        var lidY = ey - ery + lid * ery * 2;
        ctx.fillStyle = shadeHex(base, -0.12);
        ctx.beginPath();
        ctx.moveTo(ex - erx - 2 * u, ey - ery - 4 * u);
        ctx.lineTo(ex + erx + 2 * u, ey - ery - 4 * u);
        ctx.lineTo(ex + erx + 2 * u, lidY - 4 * u);
        ctx.quadraticCurveTo(ex, lidY + 6 * u, ex - erx - 2 * u, lidY + 2 * u);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = outline; ctx.lineWidth = 2.6 * u;
        ctx.beginPath(); ctx.moveTo(ex + erx + 2 * u, lidY - 4 * u); ctx.quadraticCurveTo(ex, lidY + 6 * u, ex - erx - 2 * u, lidY + 2 * u); ctx.stroke();
      }
      ctx.restore();
    }
    // brow ridge: a sly slant
    ctx.strokeStyle = outline; ctx.lineWidth = 5 * u; ctx.lineCap = 'round';
    ctx.beginPath();
    if (alarm) { ctx.moveTo(-18 * u, -36 * u); ctx.quadraticCurveTo(0, -42 * u, 18 * u, -36 * u); }
    else { ctx.moveTo(-20 * u, -34 * u); ctx.quadraticCurveTo(-2 * u, -28 * u, 20 * u, -38 * u); }
    ctx.stroke();

    // Grin
    var mY = 17 * u;
    ctx.lineJoin = 'round';
    if (alarm) {
      ctx.fillStyle = '#2a0718'; ctx.strokeStyle = outline; ctx.lineWidth = 2.4 * u;
      ctx.beginPath(); ctx.ellipse(0, mY + 4 * u, 6 * u, 7.5 * u, 0, 0, TAU); ctx.fill(); ctx.stroke();
    } else {
      var open = laugh ? 9 + Math.abs(Math.sin(t * 20)) * 8 : 4 + Math.sin(t * 2 + v.phase) * 1;
      ctx.beginPath();
      ctx.moveTo(-27 * u, mY - 4 * u);
      ctx.quadraticCurveTo(0, mY + 3 * u, 28 * u, mY - 7 * u);
      ctx.quadraticCurveTo(10 * u, mY + (6 + open * 1.4) * u, -27 * u, mY - 4 * u);
      ctx.closePath();
      ctx.fillStyle = '#2a0718'; ctx.fill();
      ctx.save(); ctx.clip();
      if (laugh) { ctx.fillStyle = '#ff6f91'; ctx.beginPath(); ctx.ellipse(2 * u, mY + open * u, 11 * u, 5 * u, 0, 0, TAU); ctx.fill(); }
      // pointy teeth along the top lip, two fangs
      ctx.fillStyle = '#ffffff';
      for (var tt = -22; tt <= 22; tt += 7.5) {
        var ty = mY - 4 * u + (tt + 27) / 55 * -3 * u + Math.abs(tt) * -0.02 * u + 2 * u;
        var fang = Math.abs(Math.abs(tt) - 15) < 2;
        ctx.beginPath(); ctx.moveTo((tt - 3.2) * u, ty - 2 * u); ctx.lineTo((tt + 3.2) * u, ty - 2 * u); ctx.lineTo(tt * u, ty + (fang ? 8 : 4.5) * u); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = outline; ctx.lineWidth = 2.6 * u;
      ctx.beginPath();
      ctx.moveTo(-27 * u, mY - 4 * u);
      ctx.quadraticCurveTo(0, mY + 3 * u, 28 * u, mY - 7 * u);
      ctx.quadraticCurveTo(10 * u, mY + (6 + open * 1.4) * u, -27 * u, mY - 4 * u);
      ctx.stroke();
      // smirk dimple
      ctx.beginPath(); ctx.arc(30 * u, mY - 9 * u, 3 * u, Math.PI * 0.6, Math.PI * 1.3); ctx.stroke();
    }
    ctx.restore();
  };

  /** White hit-flash silhouette (used for the first frames of a death). */
  CK.drawMonsterFlash = function (ctx, x, y, o, alpha) {
    var u = o.size / 100;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, 0, 48 * u * (o.sx || 1), 43 * u * (o.sy || 1), 0, 0, TAU); ctx.fill();
    ctx.restore();
  };
})();
