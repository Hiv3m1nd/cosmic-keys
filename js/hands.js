/* Cosmic Keys — smooth, shaded pianist hands (seen from above, palms down) */
(function () {
  'use strict';
  var CK = window.CK;
  var TAU = Math.PI * 2;

  var SKIN = {
    base: '#e7b08b',
    light: '#f6d2b6',
    mid: '#d99a74',
    dark: '#b8744f',
    deep: '#8e5238',
    nail: '#f1c9bd',
    nailLight: '#fff1ea',
    crease: 'rgba(122, 64, 40, 0.38)'
  };
  CK.SKIN = SKIN;

  // Finger proportions (units of U). Index 1 = thumb … 5 = pinky.
  var WIDTH = [0, [0.9, 0.82, 0.72, 0.64], [0.62, 0.58, 0.54, 0.5], [0.64, 0.6, 0.56, 0.52], [0.6, 0.56, 0.52, 0.48], [0.52, 0.48, 0.45, 0.42]];

  function v(x, y) { return { x: x, y: y }; }

  /**
   * Tapered finger outline from base B to tip T with widths at
   * base / middle joint / last joint / tip. Returns the points used for details.
   */
  function fingerPath(ctx, B, T, w, U, ext) {
    var dx = T.x - B.x, dy = T.y - B.y, L = Math.max(0.001, Math.hypot(dx, dy));
    var ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    var tipR = w[3] / 2;
    var e = ext == null ? 0.35 : ext;
    var base = v(B.x - ux * U * e, B.y - uy * U * e);
    var pts = [
      { p: base, w: w[0] * 1.06 },
      { p: v(B.x + dx * 0.42, B.y + dy * 0.42), w: w[1] },
      { p: v(B.x + dx * 0.72, B.y + dy * 0.72), w: w[2] },
      { p: v(T.x - ux * tipR, T.y - uy * tipR), w: w[3] }
    ];
    var Ls = pts.map(function (q) { return v(q.p.x + nx * q.w / 2, q.p.y + ny * q.w / 2); });
    var Rs = pts.map(function (q) { return v(q.p.x - nx * q.w / 2, q.p.y - ny * q.w / 2); });
    ctx.beginPath();
    ctx.moveTo(Ls[0].x, Ls[0].y);
    // left edge (gentle bulge at the joints)
    ctx.quadraticCurveTo(Ls[1].x + nx * U * 0.03, Ls[1].y + ny * U * 0.03, (Ls[1].x + Ls[2].x) / 2, (Ls[1].y + Ls[2].y) / 2);
    ctx.quadraticCurveTo(Ls[2].x + nx * U * 0.025, Ls[2].y + ny * U * 0.025, Ls[3].x, Ls[3].y);
    // rounded tip
    var a0 = Math.atan2(ny, nx);
    ctx.arc(pts[3].p.x, pts[3].p.y, tipR, a0, a0 - Math.PI, true);
    // right edge back to the base
    ctx.quadraticCurveTo(Rs[2].x - nx * U * 0.025, Rs[2].y - ny * U * 0.025, (Rs[1].x + Rs[2].x) / 2, (Rs[1].y + Rs[2].y) / 2);
    ctx.quadraticCurveTo(Rs[1].x - nx * U * 0.03, Rs[1].y - ny * U * 0.03, Rs[0].x, Rs[0].y);
    ctx.closePath();
    return { ux: ux, uy: uy, nx: nx, ny: ny, L: L, pts: pts };
  }

  /** Cylindrical shading across a finger. */
  function fingerGradient(ctx, info, i) {
    var q = info.pts[i];
    var hw = q.w / 2;
    var g = ctx.createLinearGradient(q.p.x + info.nx * hw, q.p.y + info.ny * hw, q.p.x - info.nx * hw, q.p.y - info.ny * hw);
    g.addColorStop(0, SKIN.dark);
    g.addColorStop(0.22, SKIN.base);
    g.addColorStop(0.45, SKIN.light);
    g.addColorStop(0.78, SKIN.mid);
    g.addColorStop(1, SKIN.dark);
    return g;
  }

  function crease(ctx, info, t, w, U) {
    var cx = info.pts[0].p.x + (info.pts[3].p.x - info.pts[0].p.x) * t;
    var cy = info.pts[0].p.y + (info.pts[3].p.y - info.pts[0].p.y) * t;
    var hw = w * 0.32;
    ctx.beginPath();
    ctx.moveTo(cx + info.nx * hw, cy + info.ny * hw);
    ctx.quadraticCurveTo(cx - info.ux * U * 0.06, cy - info.uy * U * 0.06, cx - info.nx * hw, cy - info.ny * hw);
    ctx.stroke();
  }

  function nail(ctx, info, w, U, alpha, thumbSide) {
    if (alpha <= 0.02) return;
    var tip = info.pts[3].p;
    var len = Math.min(info.L * 0.3, U * 0.5);
    var nw = w * 0.62;
    var off = thumbSide ? nw * 0.18 : 0;
    var c = v(tip.x - info.ux * len * 0.32 + info.nx * off, tip.y - info.uy * len * 0.32 + info.ny * off);
    var ang = Math.atan2(info.uy, info.ux);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(c.x, c.y);
    ctx.rotate(ang);
    // nail plate (x runs along the finger toward the tip)
    var hl = len * 0.62, hw = nw / 2;
    var g = ctx.createLinearGradient(-hl, 0, hl, 0);
    g.addColorStop(0, '#e9b2a3'); g.addColorStop(0.65, SKIN.nail); g.addColorStop(1, SKIN.nailLight);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-hl, -hw * 0.82);
    ctx.quadraticCurveTo(-hl - hw * 0.25, 0, -hl, hw * 0.82);
    ctx.lineTo(hl * 0.55, hw);
    ctx.quadraticCurveTo(hl * 1.15, 0, hl * 0.55, -hw);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 80, 60, 0.35)'; ctx.lineWidth = Math.max(0.8, U * 0.025);
    ctx.stroke();
    // glossy highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(-hl * 0.1, -hw * 0.4, hl * 0.45, hw * 0.16, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /**
   * Draw one hand. Geometry comes in world coordinates; drawing happens in a
   * mirrored local frame so left and right hands share the same code.
   */
  CK.drawRealHand = function (ctx, scene, geom, pose, color) {
    var U = geom.U, side = geom.side, cx = geom.cx, fg = geom.fingers;
    var H = scene.H;

    // World (pre-pose) → local mirrored coordinates
    var L = function (x, y) { return v(side * (x - cx), y); };

    // Finger bases and (animated) tips in local space.
    var parts = [];
    for (var f = 1; f <= 5; f++) {
      var st = pose.fingers[f];
      var tipW = scene.fingertipLocal(geom, pose, f); // pre-pose world point
      parts[f] = { B: L(fg[f].kx, fg[f].ky), T: L(tipW.x, tipW.y), curl: st.curl, charge: st.charge || 0 };
    }
    var K2 = parts[2].B, K5 = parts[5].B, W = L(geom.wrist.x, geom.wrist.y);

    ctx.save();
    // Pose transform (about the wrist) then mirror around the palm centre.
    ctx.translate(geom.wrist.x + pose.dx, geom.wrist.y + pose.dy);
    ctx.rotate(pose.rot);
    ctx.scale(pose.s, pose.s);
    ctx.translate(-geom.wrist.x, -geom.wrist.y);
    ctx.translate(cx, 0);
    ctx.scale(side, 1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    /* ---- Sleeve ---------------------------------------------------- */
    var armDir = v(0.32, 1), al = Math.hypot(armDir.x, armDir.y); armDir.x /= al; armDir.y /= al;
    var armN = v(-armDir.y, armDir.x);
    var cuffC = v(W.x + armDir.x * U * 0.35, W.y + armDir.y * U * 0.35);
    var far = v(cuffC.x + armDir.x * H * 1.4, cuffC.y + armDir.y * H * 1.4);
    var sw0 = U * 1.18, sw1 = U * 1.55;
    var sg = ctx.createLinearGradient(cuffC.x + armN.x * sw0, cuffC.y + armN.y * sw0, cuffC.x - armN.x * sw0, cuffC.y - armN.y * sw0);
    sg.addColorStop(0, '#0d1433'); sg.addColorStop(0.3, '#24356f'); sg.addColorStop(0.55, '#2f4690'); sg.addColorStop(1, '#0f1738');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(cuffC.x + armN.x * sw0, cuffC.y + armN.y * sw0);
    ctx.lineTo(far.x + armN.x * sw1, far.y + armN.y * sw1);
    ctx.lineTo(far.x - armN.x * sw1, far.y - armN.y * sw1);
    ctx.lineTo(cuffC.x - armN.x * sw0, cuffC.y - armN.y * sw0);
    ctx.closePath(); ctx.fill();
    // piping
    ctx.strokeStyle = 'rgba(255, 196, 92, 0.85)'; ctx.lineWidth = Math.max(1.5, U * 0.06);
    ctx.beginPath();
    ctx.moveTo(cuffC.x - armN.x * sw0 * 0.55, cuffC.y - armN.y * sw0 * 0.55);
    ctx.lineTo(far.x - armN.x * sw1 * 0.55, far.y - armN.y * sw1 * 0.55);
    ctx.stroke();

    /* ---- Thumb (under the hand) ------------------------------------ */
    drawDigit(ctx, parts[1], WIDTH[1], U, true, color);

    /* ---- Back of the hand ------------------------------------------ */
    var thumbRoot = parts[1].B;
    ctx.beginPath();
    var pa = v(K2.x - U * 0.4, K2.y + U * 0.12);
    ctx.moveTo(pa.x, pa.y);
    // across the knuckles
    var ks = [parts[2].B, parts[3].B, parts[4].B, parts[5].B];
    var prev = pa;
    for (var k = 0; k < ks.length; k++) {
      var top = v(ks[k].x, ks[k].y - U * 0.16);
      ctx.quadraticCurveTo(prev.x + (top.x - prev.x) * 0.5, Math.min(prev.y, top.y) - U * 0.06, top.x, top.y);
      prev = top;
    }
    var pb = v(K5.x + U * 0.38, K5.y + U * 0.1);
    ctx.quadraticCurveTo(K5.x + U * 0.36, K5.y - U * 0.12, pb.x, pb.y);
    // pinky edge down to the wrist
    var pc = v(W.x + U * 0.98, W.y - U * 0.1);
    ctx.bezierCurveTo(pb.x + U * 0.2, pb.y + U * 0.5, pc.x + U * 0.12, pc.y - U * 0.55, pc.x, pc.y);
    // wrist
    var pd = v(W.x - U * 0.92, W.y - U * 0.05);
    ctx.quadraticCurveTo(W.x, W.y + U * 0.18, pd.x, pd.y);
    // thumb side: thenar bulge then the web up to the index knuckle
    ctx.bezierCurveTo(pd.x - U * 0.4, pd.y - U * 0.4, thumbRoot.x - U * 0.35, thumbRoot.y + U * 0.2, thumbRoot.x - U * 0.12, thumbRoot.y - U * 0.3);
    var tmid = v((parts[1].B.x + parts[1].T.x) / 2, (parts[1].B.y + parts[1].T.y) / 2);
    ctx.quadraticCurveTo(tmid.x + U * 0.1, tmid.y + U * 0.05, pa.x - U * 0.05, pa.y + U * 0.05);
    ctx.closePath();
    var hg = ctx.createLinearGradient(K2.x - U, K2.y - U * 0.4, W.x + U * 1.1, W.y + U * 0.2);
    hg.addColorStop(0, SKIN.light); hg.addColorStop(0.45, SKIN.base); hg.addColorStop(1, SKIN.dark);
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = 'rgba(110, 55, 35, 0.35)'; ctx.lineWidth = Math.max(1, U * 0.035); ctx.stroke();

    // soft shading toward the wrist and pinky edge
    var sh = ctx.createRadialGradient(W.x + U * 0.7, W.y - U * 0.2, U * 0.2, W.x + U * 0.7, W.y - U * 0.2, U * 1.7);
    sh.addColorStop(0, 'rgba(120,60,40,0.28)'); sh.addColorStop(1, 'rgba(120,60,40,0)');
    ctx.fillStyle = sh; ctx.fill();

    /* ---- Fingers (pinky first so the index overlaps) ---------------- */
    for (f = 5; f >= 2; f--) drawDigit(ctx, parts[f], WIDTH[f], U, false, color);

    // knuckle highlights on top
    for (k = 0; k < 4; k++) {
      var kn = ks[k];
      var r = U * 0.3;
      var kg = ctx.createRadialGradient(kn.x - U * 0.05, kn.y - U * 0.02, 0, kn.x, kn.y, r);
      kg.addColorStop(0, 'rgba(255,240,228,0.55)'); kg.addColorStop(1, 'rgba(255,240,228,0)');
      ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kn.x, kn.y, r, 0, TAU); ctx.fill();
    }

    /* ---- Cuff ------------------------------------------------------- */
    var cw = U * 1.22, ch = U * 0.32;
    ctx.save();
    ctx.translate(cuffC.x, cuffC.y);
    ctx.rotate(Math.atan2(armDir.y, armDir.x) - Math.PI / 2);
    var cg = ctx.createLinearGradient(0, -ch, 0, ch);
    cg.addColorStop(0, '#dfe6f7'); cg.addColorStop(0.45, '#8d9ac0'); cg.addColorStop(1, '#3d4670');
    ctx.fillStyle = cg;
    CK.roundRect(ctx, -cw, -ch, cw * 2, ch * 2, ch * 0.9); ctx.fill();
    ctx.shadowColor = color; ctx.shadowBlur = U * 0.35;
    ctx.fillStyle = color;
    CK.roundRect(ctx, -cw * 0.92, -ch * 0.22, cw * 1.84, ch * 0.44, ch * 0.22); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore();
  };

  function drawDigit(ctx, part, widths, U, isThumb, color) {
    var w = widths.map(function (x) { return x * U * (1 + part.curl * 0.12); });
    var info = fingerPath(ctx, part.B, part.T, w, U, isThumb ? 0.05 : 0.35);
    ctx.fillStyle = fingerGradient(ctx, info, 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 55, 35, 0.4)'; ctx.lineWidth = Math.max(1, U * 0.035); ctx.stroke();
    // joint creases
    ctx.strokeStyle = SKIN.crease; ctx.lineWidth = Math.max(0.8, U * 0.03);
    if (isThumb) crease(ctx, info, 0.55, w[2], U);
    else { crease(ctx, info, 0.45, w[1], U); crease(ctx, info, 0.73, w[2], U); }
    // folded fingertip when making a fist
    var nailAlpha = 1 - CK.clamp((part.curl - 0.35) * 2.2, 0, 1);
    nail(ctx, info, w[3], U, nailAlpha, isThumb);
    if (part.curl > 0.45) {
      var tp = info.pts[3].p;
      ctx.strokeStyle = 'rgba(120,60,40,0.45)'; ctx.lineWidth = Math.max(1, U * 0.04);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, w[3] * 0.32, Math.atan2(info.ny, info.nx), Math.atan2(info.ny, info.nx) - Math.PI, true);
      ctx.stroke();
    }
    // charge glow on the fingertip
    if (part.charge > 0) {
      var t2 = info.pts[3].p, k = Math.min(1, part.charge);
      var g = ctx.createRadialGradient(t2.x, t2.y, 0, t2.x, t2.y, w[3] * (0.9 + k));
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t2.x, t2.y, w[3] * (0.9 + k), 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /** Silhouette used for the soft shadow the hands cast on the keys. */
  CK.drawHandSilhouette = function (ctx, scene, geom, pose) {
    var U = geom.U, side = geom.side, cx = geom.cx, fg = geom.fingers;
    ctx.save();
    ctx.translate(geom.wrist.x + pose.dx, geom.wrist.y + pose.dy);
    ctx.rotate(pose.rot);
    ctx.scale(pose.s, pose.s);
    ctx.translate(-geom.wrist.x, -geom.wrist.y);
    ctx.lineCap = 'round';
    for (var f = 1; f <= 5; f++) {
      var tip = scene.fingertipLocal(geom, pose, f);
      ctx.lineWidth = U * (f === 1 ? 0.72 : 0.56);
      ctx.beginPath(); ctx.moveTo(fg[f].kx, fg[f].ky); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(cx - side * U * 0.1, (geom.palmTop + geom.wrist.y) / 2, U * 1.55, U * 1.05, 0, 0, TAU);
    ctx.fill();
    ctx.lineWidth = U * 2.2;
    ctx.beginPath(); ctx.moveTo(geom.wrist.x, geom.wrist.y); ctx.lineTo(geom.wrist.x + side * U * 1.2, geom.wrist.y + U * 4); ctx.stroke();
    ctx.restore();
  };
})();
