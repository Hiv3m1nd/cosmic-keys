/* Cosmic Keys — first-person perspective view of the keyboard.
 *
 * World units: 1 = one white key's width. x runs right, y away from the player
 * (into the screen), z up. The keyboard lies on z = 0 with key fronts at y = 0
 * and key backs at y = KEY_LEN. A pinhole camera sits behind and above the
 * player's hands. Both the 2D canvas (keys, beams) and the WebGL hand renderer
 * use exactly this projection, so fingertips land on the drawn keys.
 */
(function () {
  'use strict';
  var CK = window.CK;

  var KEY_LEN = 6.2;          // white key length (in key widths)
  var BLACK_LEN = 3.9;        // black key length from the back
  var BLACK_W = 0.58;
  var BLACK_H = 0.42;         // black keys stand this far above the white ones

  function View3D() {
    this.pitch = 0.62;        // radians below horizontal
    this.camY = -6.0;
    this.camZ = 6.4;
    this.F = 600;
    this.cx = 0; this.cy = 0;
    this.offsetY = 0;         // screen-space slide (piano rising/sinking)
    this.centerW = 0;
  }

  View3D.prototype.basis = function () {
    var c = Math.cos(this.pitch), s = Math.sin(this.pitch);
    this.fw = [0, c, -s];     // forward
    this.up = [0, s, c];      // camera up
    this.rt = [1, 0, 0];
  };

  /** Camera-space coordinates of a world point. */
  View3D.prototype.toCam = function (x, y, z) {
    var dx = x, dy = y - this.camY, dz = z - this.camZ;
    return [dx, dy * this.up[1] + dz * this.up[2], dy * this.fw[1] + dz * this.fw[2]];
  };

  /** Screen position (CSS px) and px-per-unit scale at that depth. */
  View3D.prototype.project = function (x, y, z) {
    var c = this.toCam(x, y, z || 0);
    var zc = Math.max(0.05, c[2]);
    var k = this.F / zc;
    return { x: this.cx + c[0] * k, y: this.cy - c[1] * k + this.offsetY, s: k };
  };

  /** Back-project a screen point onto the keyboard plane z = h. */
  View3D.prototype.unproject = function (sx, sy, h) {
    var px = (sx - this.cx) / this.F, py = (this.cy - (sy - this.offsetY)) / this.F;
    var d = [px * this.rt[0] + py * this.up[0] + this.fw[0], px * this.rt[1] + py * this.up[1] + this.fw[1], px * this.rt[2] + py * this.up[2] + this.fw[2]];
    var t = ((h || 0) - this.camZ) / d[2];
    return { x: d[0] * t, y: this.camY + d[1] * t };
  };

  /**
   * Fit the camera: a fixed head position (scale × the default eye height) and
   * pitch give a natural first-person perspective; the focal length makes
   * `whiteKeys` keys span the screen width at the key fronts, which sit at nearY.
   */
  View3D.prototype.fit = function (W, H, whiteKeys, nearY, scale, pitch) {
    this.W = W; this.H = H;
    if (pitch != null) this.pitch = pitch;
    this.basis();
    scale = scale || 1.5;
    this.camY = -6.0 * scale; this.camZ = 6.4 * scale;
    var a0 = this.toCam(0, 0, 0);
    this.F = W * a0[2] / whiteKeys;
    this.cy = nearY + this.F * (a0[1] / a0[2]);
    this.cx = W / 2;
  };

  /** Depth (distance along the view axis) of a world point. */
  View3D.prototype.depth = function (x, y, z) { return this.toCam(x, y, z || 0)[2]; };

  View3D.prototype.uniforms = function () {
    return { cam: [0, this.camY, this.camZ], fw: this.fw, up: this.up, rt: this.rt, F: this.F, cx: this.cx, cy: this.cy, oy: this.offsetY };
  };

  CK.View3D = View3D;
  CK.KEY3D = { LEN: KEY_LEN, BLACK_LEN: BLACK_LEN, BLACK_W: BLACK_W, BLACK_H: BLACK_H };
})();
