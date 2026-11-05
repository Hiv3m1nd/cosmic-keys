/* Cosmic Keys — first-person 3D hands, ray-marched on the GPU (WebGL2).
 *
 * The same pinhole camera as view3d.js renders the keys (2D canvas) and the
 * hands (here), so fingertips land exactly on the drawn keys. World units are
 * white-key widths (x right, y away from the player, z up).
 *
 * Each hand is 22 rounded cones (palm, 12 finger bones, thumb, forearm, sleeve,
 * cuff) blended with smooth-min, lit with a key light, sky/bounce ambient, soft
 * shadows and a skin sub-surface tint; it casts a soft shadow onto the keys.
 *
 * Pose (per rig, set by game.js):
 *   onKeys   1 = fingertips on their keys (IK), 0 = free pose below
 *   x, fwd, lift   free-pose offsets (world units) from the playing wrist position
 *   roll     rotation about the forearm (+ turns the palm toward the other hand)
 *   yaw, s   heading and scale
 *   fingers[f]: curl, press, slide/slideTo, wig, charge, spread
 */
(function () {
  'use strict';
  var CK = window.CK;

  var NH = 2, NP = 22;
  var LIGHT = norm3([-0.28, -0.55, 0.79]);   // from above, behind the player's left shoulder

  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function dotv(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  var VS = '#version 300 es\nin vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 outColor;',
    '#define NH ' + NH,
    '#define NP ' + NP,
    'uniform vec4 uA[NH*NP];',
    'uniform vec4 uB[NH*NP];',
    'uniform vec4 uBoxC[NH];',
    'uniform vec4 uBoxH[NH];',
    'uniform vec4 uTip[NH*5];',
    'uniform vec4 uNailA[NH*5];',
    'uniform vec4 uNailD[NH*5];',
    'uniform vec3 uRim[NH];',
    'uniform vec3 uCam, uFw, uUp, uRt;',
    'uniform float uF, uCx, uCy, uOy;',
    'uniform float uPx, uViewH;',
    'uniform float uU;',
    'uniform float uKeyLen;',
    'uniform vec3 uL;',
    'uniform sampler2D uClefTex;',
    'uniform float uClef[NH];',
    '',
    '/* Gold clef on top of the navy cuff at the wrist (treble right, bass left). */',
    'float clefMask(int h, vec3 p){',
    '  vec3 a0 = uA[h*NP+21].xyz; vec3 ax = normalize(uB[h*NP+21].xyz - a0);',
    '  float s = dot(p - a0, ax);',
    '  vec3 perp = (p - a0) - ax*s;',
    '  vec3 up = vec3(0.0, 0.0, 1.0) - ax*ax.z; float ul = length(up);',
    '  if (ul < 1e-3) return 0.0;',
    '  up /= ul;',
    '  vec3 rt = cross(-ax, up);',
    '  float ang = atan(dot(perp, rt), dot(perp, up));',
    '  float arc = ang*length(perp);',
    '  float cl = length(uB[h*NP+21].xyz - a0);',
    '  float hE = 1.12*uU, wE = 0.68*uU;',
    '  vec2 uv = vec2(arc/wE + 0.5, (s - cl*0.5)/hE + 0.5);',
    '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || abs(ang) > 1.3) return 0.0;',
    '  return texture(uClefTex, vec2(uv.x*0.5 + uClef[h], uv.y)).a;',
    '}',
    '',
    'float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){',
    '  vec3 ba = b - a; float l2 = dot(ba,ba); float rr = r1 - r2; float a2 = l2 - rr*rr; float il2 = 1.0/max(l2,1e-6);',
    '  vec3 pa = p - a; float y = dot(pa,ba); float z = y - l2;',
    '  vec3 xv = pa*l2 - ba*y; float x2 = dot(xv,xv); float y2 = y*y*l2; float z2 = z*z*l2;',
    '  float k = sign(rr)*rr*rr*x2;',
    '  if (sign(z)*a2*z2 > k) return sqrt(x2 + z2)*il2 - r2;',
    '  if (sign(y)*a2*y2 < k) return sqrt(x2 + y2)*il2 - r1;',
    '  return (sqrt(x2*a2*il2) + y*rr)*il2 - r1;',
    '}',
    'float smin(float a, float b, float k){ float h = max(k - abs(a-b), 0.0)/k; return min(a,b) - h*h*k*0.25; }',
    'float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }',
    'float cone(int i, vec3 p){ return sdRoundCone(p, uA[i].xyz, uB[i].xyz, uA[i].w, uB[i].w); }',
    '',
    'vec3 handMap(int h, vec3 p){',
    '  int o = h*NP; float U = uU;',
    '  float palm = smin(cone(o+0, p), cone(o+1, p), 0.45*U);',
    '  palm = smin(palm, cone(o+2, p), 0.45*U);',
    '  palm = smin(palm, cone(o+3, p), 0.32*U);',
    '  float skin = palm;',
    '  for (int f = 0; f < 4; f++){',
    '    int b = o + 4 + f*3;',
    '    float fd = smin(smin(cone(b, p), cone(b+1, p), 0.05*U), cone(b+2, p), 0.04*U);',
    '    skin = smin(skin, fd, 0.15*U);',
    '  }',
    '  float th = smin(smin(cone(o+16, p), cone(o+17, p), 0.08*U), cone(o+18, p), 0.05*U);',
    '  skin = smin(skin, th, 0.22*U);',
    '  skin = smin(skin, cone(o+19, p), 0.3*U);',
    '  vec3 r = vec3(skin, 1.0, float(h));',
    '  float cuff = cone(o+21, p);',
    '  if (cuff < r.x) r = vec3(cuff, 3.0, float(h));',
    '  return r;',
    '}',
    'vec3 mapX(vec3 p, bool withSleeve){',
    '  vec3 res = vec3(1e5, 0.0, 0.0);',
    '  for (int h = 0; h < NH; h++){',
    '    if (uBoxC[h].w < 0.5) continue;',
    '    if (withSleeve){ float sl = cone(h*NP+20, p); if (sl < res.x) res = vec3(sl, 2.0, float(h)); }',
    '    float bd = sdBox(p - uBoxC[h].xyz, uBoxH[h].xyz);',
    '    if (bd > uU*0.6){ if (bd < res.x) res = vec3(bd, 0.0, float(h)); continue; }',
    '    vec3 r = handMap(h, p);',
    '    if (r.x < res.x) res = r;',
    '  }',
    '  return res;',
    '}',
    'vec3 map(vec3 p){ return mapX(p, true); }',
    'vec3 calcNormal(vec3 p){',
    '  float e = 0.01*uU; vec2 k = vec2(1.0,-1.0);',
    '  return normalize(k.xyy*map(p + k.xyy*e).x + k.yyx*map(p + k.yyx*e).x + k.yxy*map(p + k.yxy*e).x + k.xxx*map(p + k.xxx*e).x);',
    '}',
    'float softShadow(vec3 ro, vec3 rd, float k){',
    '  float res = 1.0; float t = 0.04*uU;',
    '  for (int i = 0; i < 26; i++){',
    '    float h = map(ro + rd*t).x;',
    '    res = min(res, k*h/t);',
    '    t += clamp(h, 0.03*uU, 0.5*uU);',
    '    if (res < 0.003 || t > 8.0*uU) break;',
    '  }',
    '  return clamp(res, 0.0, 1.0);',
    '}',
    'float groundShadow(vec3 ro, vec3 rd){',
    '  float res = 1.0; float t = 0.05*uU; float fade = 1.0;',
    '  for (int i = 0; i < 36; i++){',
    '    float h = mapX(ro + rd*t, false).x;',
    '    float k = 2.6 + 3.0/(1.0 + t/(1.5*uU));',
    '    float r = k*h/t;',
    '    if (r < res){ res = r; fade = exp(-t/(5.0*uU)); }',
    '    t += clamp(h*0.8, 0.02*uU, 0.3*uU);',
    '    if (res < 0.002 || t > 9.0*uU) break;',
    '  }',
    '  res = clamp(res, 0.0, 1.0);',
    '  return 1.0 - (1.0 - res*res*(3.0 - 2.0*res))*fade;',
    '}',
    'float calcAO(vec3 p, vec3 n){',
    '  float occ = 0.0; float sca = 1.0;',
    '  for (int i = 0; i < 5; i++){',
    '    float hr = (0.03 + 0.12*float(i))*uU;',
    '    float d = map(p + n*hr).x;',
    '    occ += (hr - d)*sca; sca *= 0.72;',
    '  }',
    '  return clamp(1.0 - 1.6*occ/uU, 0.0, 1.0);',
    '}',
    'vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }',
    '',
    'void main(){',
    '  vec2 css = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y)*uPx;',
    '  vec2 q = vec2((css.x - uCx)/uF, (uCy - (css.y - uOy))/uF);',
    '  vec3 rd = normalize(uRt*q.x + uUp*q.y + uFw);',
    '  vec3 ro = uCam;',
    '  float tNear = 1e5, tFar = 0.0;',
    '  for (int h = 0; h < NH; h++){',
    '    if (uBoxC[h].w < 0.5) continue;',
    '    vec3 c = uBoxC[h].xyz - ro;',
    '    float d = dot(c, rd); float rr = length(uBoxH[h].xyz) + 0.5*uU;',
    '    tNear = min(tNear, d - rr); tFar = max(tFar, d + rr);',
    '  }',
    '  float camD = length(uCam);',
    '  float t = max(0.0, min(tNear, 0.4*camD));',
    '  float tMax = max(tFar, camD*2.5);',
    '  vec3 res = vec3(0.0); bool hit = false; float minD = 1e5; float minT = 0.0;',
    '  for (int i = 0; i < 84; i++){',
    '    vec3 p = ro + rd*t;',
    '    res = map(p);',
    '    if (res.y > 0.5 && res.x < minD){ minD = res.x; minT = t; }',
    '    if (res.x < 0.0008*t){ hit = true; break; }',
    '    t += res.x*0.92;',
    '    if (t > tMax) break;',
    '  }',
    '  float pix = uPx*1.1*t/uF;',
    '  float alpha = 1.0;',
    '  if (!hit && minD < pix*0.75){ hit = true; t = minT; alpha = 1.0 - smoothstep(0.0, pix*0.75, minD); res = map(ro + rd*t); }',
    '  if (!hit){',
    '    if (rd.z >= -1e-3){ outColor = vec4(0.0); return; }',
    '    float tg = -ro.z/rd.z;',
    '    vec3 g = ro + rd*tg;',
    '    if (g.y < -0.3 || g.y > uKeyLen){ outColor = vec4(0.0); return; }',
    '    float sh = groundShadow(g + uL*0.05*uU, uL);',
    '    outColor = vec4(0.02, 0.02, 0.07, 1.0)*((1.0 - sh)*0.55);',
    '    return;',
    '  }',
    '  vec3 p = ro + rd*t;',
    '  vec3 n = calcNormal(p);',
    '  vec3 v = -rd;',
    '  int h = int(res.z + 0.5);',
    '  vec3 rim = uRim[0]; if (h == 1) rim = uRim[1];',
    '  float sh = softShadow(p + n*0.02*uU, uL, 9.0);',
    '  float ao = calcAO(p, n);',
    '  float ndl = dot(n, uL);',
    '  float lam = max(ndl, 0.0)*sh;',
    '  float wrap = clamp((ndl + 0.45)/1.45, 0.0, 1.0)*mix(1.0, sh, 0.75);',
    '  vec3 hv = normalize(uL + v);',
    '  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);',
    '  vec3 sky = vec3(0.30, 0.45, 0.85);',
    '  vec3 bounce = vec3(0.95, 0.96, 1.0);',
    '  vec3 amb = mix(bounce*0.6, sky, clamp(n.z*0.5 + 0.5, 0.0, 1.0));',
    '  vec3 col;',
    '  float mat = res.y;',
    '  if (mat < 1.5){',
    '    vec3 alb = pow(vec3(0.93, 0.68, 0.53), vec3(2.2));',
    '    float specK = 0.14, shin = 26.0;',
    '    float nail = 0.0, nailTip = 0.0;',
    '    for (int f = 0; f < 5; f++){',
    '      int idx = h*5 + f;',
    '      vec3 ax = uNailA[idx].xyz; float tr = uNailA[idx].w;',
    '      vec3 qq = p - uTip[idx].xyz;',
    '      float along = dot(qq, ax);',
    '      vec3 perp = qq - ax*along;',
    '      vec3 vp = normalize(v - ax*dot(v, ax) + 1e-4);',
    '      float dors = dot(normalize(perp + 1e-5), normalize(uNailD[idx].xyz*0.5 + vp*0.5));',
    '      float inLen = smoothstep(-tr*2.2, -tr*1.8, along)*(1.0 - smoothstep(tr*0.7, tr*0.95, along));',
    '      float inSide = smoothstep(0.42, 0.62, dors);',
    '      float m = inLen*inSide*step(length(perp), tr*1.3);',
    '      if (m > nail){ nail = m; nailTip = smoothstep(tr*0.2, tr*0.6, along); }',
    '    }',
    '    alb = mix(alb, pow(vec3(0.97, 0.80, 0.78), vec3(2.2)), nail);',
    '    alb = mix(alb, pow(vec3(1.0, 0.96, 0.93), vec3(2.2)), nail*nailTip);',
    '    specK = mix(specK, 0.55, nail); shin = mix(shin, 90.0, nail);',
    '    vec3 dif = alb*vec3(1.0, 0.95, 0.9)*wrap*0.98;',
    '    vec3 sss = vec3(0.9, 0.24, 0.12)*(wrap - lam)*0.7*(1.0 - nail);',
    '    vec3 ambC = alb*amb*ao*0.45;',
    '    float spec = pow(max(dot(n, hv), 0.0), shin)*specK*sh;',
    '    col = dif + sss + ambC*mix(0.75, 1.0, ao) + vec3(spec) + rim*fres*0.09*ao;',
    '  } else if (mat < 2.5){',
    '    vec3 alb = pow(vec3(0.07, 0.10, 0.27), vec3(2.2));',
    '    float sheen = pow(1.0 - max(dot(n, v), 0.0), 1.6);',
    '    col = alb*wrap*1.25 + alb*amb*ao*0.7 + vec3(0.25, 0.38, 0.85)*sheen*0.35*ao + rim*fres*0.08;',
    '  } else {',
    '    // navy cuff with gold piping at both ends and a gold clef emblem',
    '    vec3 ca = uA[h*NP+21].xyz, cb = uB[h*NP+21].xyz;',
    '    float s = dot(p - ca, normalize(cb - ca))/length(cb - ca);',
    '    float trim = (1.0 - smoothstep(0.07, 0.1, s)) + smoothstep(0.9, 0.93, s);',
    '    trim = clamp(trim + (smoothstep(0.13, 0.145, s) - smoothstep(0.155, 0.17, s)) + (smoothstep(0.83, 0.845, s) - smoothstep(0.855, 0.87, s)), 0.0, 1.0);',
    '    vec3 navy = pow(vec3(0.09, 0.13, 0.33), vec3(2.2));',
    '    float sheen = pow(1.0 - max(dot(n, v), 0.0), 1.6);',
    '    vec3 velvet = navy*wrap*1.3 + navy*amb*ao*0.75 + vec3(0.3, 0.45, 0.95)*sheen*0.4*ao + rim*fres*0.08;',
    '    vec3 g = pow(vec3(1.0, 0.78, 0.34), vec3(2.2));',
    '    vec3 refl = reflect(-v, n);',
    '    float env = clamp(refl.z*0.5 + 0.5, 0.0, 1.0);',
    '    vec3 envC = mix(vec3(0.10, 0.12, 0.30), vec3(1.25, 1.15, 0.9), env);',
    '    float gsp = pow(max(dot(n, hv), 0.0), 40.0)*sh;',
    '    vec3 gold = g*(wrap*0.6 + 0.15)*ao + g*envC*0.5 + vec3(1.0, 0.88, 0.6)*gsp*0.9;',
    '    float em = clefMask(h, p);',
    '    col = mix(velvet, gold, clamp(trim + em, 0.0, 1.0));',
    '  }',
    '  for (int f = 0; f < 5; f++){',
    '    int idx = h*5 + f;',
    '    float c = uTip[idx].w;',
    '    if (c > 0.0){ float d = length(p - uTip[idx].xyz); col += rim*c*2.5*exp(-d/(0.28*uU)); }',
    '  }',
    '  col = aces(col*1.05);',
    '  col = pow(col, vec3(1.0/2.2));',
    '  outColor = vec4(col*alpha, alpha);',
    '}'
  ].join('\n');

  function GLHands(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.scale = 1;
    this._ft = [];
    this.cuffs = [];
    try { this._init(); } catch (e) { if (window.console) console.warn('GL hands unavailable:', e); this.ok = false; }
  }

  GLHands.prototype._init = function () {
    var c = this.canvas;
    var gl = c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) return;
    this.gl = gl;
    var mk = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    var prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.loc = {};
    ['uA', 'uB', 'uBoxC', 'uBoxH', 'uTip', 'uNailA', 'uNailD', 'uRim', 'uCam', 'uFw', 'uUp', 'uRt', 'uF', 'uCx', 'uCy', 'uOy', 'uPx', 'uViewH', 'uU', 'uKeyLen', 'uL', 'uClefTex', 'uClef'].forEach(function (n) { this.loc[n] = gl.getUniformLocation(prog, n); }, this);
    this.A = new Float32Array(NH * NP * 4);
    this.B = new Float32Array(NH * NP * 4);
    this.boxC = new Float32Array(NH * 4);
    this.boxH = new Float32Array(NH * 4);
    this.tip = new Float32Array(NH * 5 * 4);
    this.nailA = new Float32Array(NH * 5 * 4);
    this.nailD = new Float32Array(NH * 5 * 4);
    this.rim = new Float32Array(NH * 3);
    this.clefSel = new Float32Array(NH);
    this.tex = null;
    var self = this;
    c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.ok = false; }, false);
    c.addEventListener('webglcontextrestored', function () { try { self._init(); } catch (e2) { self.ok = false; } }, false);
    this.ok = true;
  };

  /** Treble (left half) and bass (right half) clef glyphs as an alpha texture for the sleeves. */
  GLHands.prototype._clefTexture = function () {
    if (this.tex || !CK.drawTreble) return this.tex;
    var gl = this.gl, c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.strokeStyle = '#fff';
    // treble: spans about -3.95..2.85 staff spaces vertically
    CK.drawTreble(x, 64, 128 + 0.55 * 27, 27);
    // bass: spans about -1.2..2.5 spaces; the dots sit to the right
    CK.drawBass(x, 128 + 30, 128 - 0.65 * 44, 44);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = tex;
    return tex;
  };

  GLHands.prototype.resize = function (W, H, dpr) { this.W = W; this.H = H; this.dpr = dpr; this._applySize(); };
  GLHands.prototype._applySize = function () {
    var px = Math.max(0.5, Math.min(this.dpr || 1, 2) * this.scale);
    this.fbScale = px;
    var w = Math.round(this.W * px), h = Math.round(this.H * px);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  };

  /* ------------------------------------------------------------------ */
  /* Skeleton                                                             */
  /* ------------------------------------------------------------------ */
  var REACH = [0, 0, 1.45, 1.62, 1.52, 1.25];
  var MCPZ = [0, 0, 1.0, 1.04, 0.98, 0.88];
  var LENS = [null, [0.7, 0.52], [1.05, 0.65, 0.46], [1.17, 0.73, 0.49], [1.1, 0.69, 0.47], [0.88, 0.54, 0.41]];
  var RADII = [null, [0.3, 0.27, 0.22], [0.25, 0.23, 0.205, 0.19], [0.26, 0.235, 0.21, 0.195], [0.245, 0.22, 0.2, 0.185], [0.215, 0.19, 0.175, 0.16]];

  /** Bend a finger in its vertical plane so the tip lands on target (last joint flexes 0.75× the middle). */
  function solveFinger(base, target, lens, U) {
    var hx = target[0] - base[0], hy = target[1] - base[1];
    var D = Math.hypot(hx, hy);
    var hdir = D > 1e-4 ? [hx / D, hy / D] : [0, 1];
    var dz = target[2] - base[2];
    var dist = Math.hypot(D, dz);
    var L = lens.map(function (l) { return l * U; });
    var total = L.reduce(function (a, b) { return a + b; }, 0);
    function endAt(b) {
      var x = L[0], y = 0, ang = 0;
      ang -= b; x += L[1] * Math.cos(ang); y += L[1] * Math.sin(ang);
      if (L.length > 2) { ang -= b * 0.75; x += L[2] * Math.cos(ang); y += L[2] * Math.sin(ang); }
      return [x, y];
    }
    var want = Math.min(dist, total * 0.995);
    var lo = 0, hi = 2.3;
    for (var i = 0; i < 22; i++) {
      var mid = (lo + hi) / 2, e = endAt(mid);
      if (Math.hypot(e[0], e[1]) > want) lo = mid; else hi = mid;
    }
    var b = (lo + hi) / 2, E = endAt(b);
    var a = Math.atan2(dz, D) - Math.atan2(E[1], E[0]);
    var pts = [base], angs = [a, a - b, a - b - b * 0.75], cur = base;
    for (var j = 0; j < L.length; j++) {
      var ca = Math.cos(angs[j]), sa = Math.sin(angs[j]);
      cur = [cur[0] + hdir[0] * ca * L[j], cur[1] + hdir[1] * ca * L[j], cur[2] + sa * L[j]];
      pts.push(cur);
    }
    return { pts: pts, hdir: hdir };
  }

  /** Forward-kinematics finger in the hand's local frame: straight ahead (+y), bending down by `curl`. */
  function fkFinger(base, dir2, lens, U, curl, spread) {
    var L = lens.map(function (l) { return l * U; });
    var a = -0.12 - curl * 1.05, b = 0.18 + curl * 1.45;
    var angs = [a, a - b, a - b - b * 0.75];
    var hd = [dir2[0] + spread, dir2[1]]; var hl = Math.hypot(hd[0], hd[1]); hd = [hd[0] / hl, hd[1] / hl];
    var pts = [base], cur = base;
    for (var j = 0; j < L.length; j++) {
      var ca = Math.cos(angs[j]), sa = Math.sin(angs[j]);
      cur = [cur[0] + hd[0] * ca * L[j], cur[1] + hd[1] * ca * L[j], cur[2] + sa * L[j]];
      pts.push(cur);
    }
    return pts;
  }

  /** Rotation for the free pose: roll about the forearm (y) axis, pitch about x, then yaw about z. */
  function rotator(roll, pitch, yaw) {
    var cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    return function (v) {
      var x = v[0] * cr + v[2] * sr, z = -v[0] * sr + v[2] * cr, y = v[1];
      var y2 = y * cp - z * sp, z2 = y * sp + z * cp;
      return [x * cy - y2 * sy, x * sy + y2 * cy, z2];
    };
  }

  /**
   * The 22 cones for one hand. Two skeletons — "on the keys" (IK) and "free"
   * (forward kinematics, posed) — blended by pose.onKeys so the hands can rise,
   * crack their knuckles and land on the keys.
   */
  /** Knuckle line and wrist of a hand resting on its home keys (world units). */
  function restFrame(scene, rig) {
    var U = scene.layout.U, side = rig.hand === 'R' ? 1 : -1, homes = rig.homes, key = [];
    for (var f = 1; f <= 5; f++) {
      var midi = side > 0 ? homes[f - 1] : homes[5 - f];
      key[f] = { midi: midi, p: scene.keyTouch3D(midi, f === 1) };
    }
    var cxw = (key[2].p[0] + key[3].p[0] + key[4].p[0] + key[5].p[0]) / 4;
    var whiteY = scene.keyTouch3D(60, false)[1];
    var mcp = [];
    for (f = 2; f <= 5; f++) mcp[f] = [cxw + (key[f].p[0] - cxw) * 0.86, whiteY - REACH[f] * U, MCPZ[f] * U];
    var wrist = [cxw - side * 0.1 * U, mcp[3][1] - 1.62 * U, 0.9 * U];
    return { side: side, key: key, mcp: mcp, wrist: wrist, U: U };
  }
  GLHands.restWrist = function (scene, rig) { return restFrame(scene, rig).wrist; };

  function armCones(wrist, armDir, U, sc) {
    var c0 = add(wrist, mul(armDir, 0.42 * U * sc)), c1 = add(wrist, mul(armDir, 1.95 * U * sc));
    return {
      list: [
        [add(wrist, mul(armDir, -0.2 * U * sc)), add(wrist, mul(armDir, 1.3 * U * sc)), 0.56 * U * sc, 0.58 * U * sc],
        [add(wrist, mul(armDir, 0.75 * U * sc)), add(wrist, mul(armDir, 30 * U)), 0.66 * U * sc, 1.1 * U],
        [c0, c1, 0.68 * U * sc, 0.76 * U * sc]
      ],
      cuff: [c0, c1]
    };
  }

  /**
   * The 22 cones for one hand. Two skeletons — "on the keys" (IK) and "free"
   * (forward kinematics, posed) — blended by pose.onKeys so the hands can rise,
   * crack their knuckles and land on the keys. In the free pose the hand turns
   * about its wrist while the forearm and sleeve follow pose.arm (toward the player).
   */
  GLHands.prototype._skeleton = function (scene, rig) {
    var pose = rig.pose, rf = restFrame(scene, rig), U = rf.U, side = rf.side;
    var onKeys = pose.onKeys == null ? 1 : pose.onKeys;
    var cones = this._cones(scene, rig, side, U, rf.mcp, rf.wrist, rf.key);
    if (onKeys >= 0.999) return cones;

    var rot = rotator((pose.roll || 0) * side, pose.pitch || 0, (pose.yaw || 0) * side);
    var sc = pose.s || 1;
    var origin = add(rf.wrist, [(pose.x || 0) * side + (pose.dx || 0), pose.fwd || 0, pose.lift || 0]);
    var tf = function (v) { return add(origin, mul(rot(v), sc)); };
    var lm = [];
    for (var f = 2; f <= 5; f++) lm[f] = [side * (f - 3.5) * 0.92 * U, 1.62 * U, (MCPZ[f] - 0.9) * U];
    var free = this._cones(scene, rig, side, U, lm, [0, 0, 0], null);
    var freeT = free.map(function (c) { return [tf(c[0]), tf(c[1]), c[2] * sc, c[3] * sc]; });
    var arm = pose.arm || [0.62, -0.78, -0.12];
    var ac = armCones(origin, norm3([arm[0] * side, arm[1], arm[2]]), U, sc);
    freeT[19] = ac.list[0]; freeT[20] = ac.list[1]; freeT[21] = ac.list[2];
    freeT.tips = free.tips.map(function (tp) { return { p: tf(tp.p), ax: rot(tp.ax), d: rot(tp.d), r: tp.r * sc }; });
    freeT.cuff = ac.cuff;
    var w = CK.clamp(onKeys, 0, 1);
    if (w <= 0.001) return freeT;
    var out = cones.map(function (c, i) { var g = freeT[i]; return [lerp3(g[0], c[0], w), lerp3(g[1], c[1], w), g[2] + (c[2] - g[2]) * w, g[3] + (c[3] - g[3]) * w]; });
    out.tips = cones.tips.map(function (tp, i) {
      var g = freeT.tips[i];
      return { p: lerp3(g.p, tp.p, w), ax: norm3(lerp3(g.ax, tp.ax, w)), d: norm3(lerp3(g.d, tp.d, w)), r: g.r + (tp.r - g.r) * w };
    });
    out.cuff = [lerp3(freeT.cuff[0], cones.cuff[0], w), lerp3(freeT.cuff[1], cones.cuff[1], w)];
    return out;
  };

  /** Cones from knuckles + wrist. key = world key targets (IK) or null for FK using the pose's finger curls. */
  GLHands.prototype._cones = function (scene, rig, side, U, mcp, wrist, key) {
    var st = rig.pose.fingers;
    var thumbBase = [wrist[0] - side * 0.72 * U, wrist[1] + 0.42 * U, wrist[2] - 0.24 * U];
    var thumbMcp = key
      ? [CK.lerp(wrist[0] - side * 1.2 * U, key[1].p[0] + side * 0.55 * U, 0.55), mcp[2][1] - 0.7 * U, 0.5 * U]
      : [wrist[0] - side * 1.25 * U, wrist[1] + 0.95 * U, wrist[2] - 0.4 * U];
    var cones = [];
    cones.push([[mcp[2][0], mcp[2][1] - 0.05 * U, mcp[2][2] - 0.06 * U], [mcp[5][0], mcp[5][1] - 0.05 * U, mcp[5][2] - 0.06 * U], 0.3 * U, 0.27 * U]);
    cones.push([[mcp[2][0] + side * 0.02 * U, mcp[2][1] - 0.85 * U, wrist[2] + 0.05 * U], [mcp[5][0] - side * 0.06 * U, mcp[5][1] - 0.78 * U, wrist[2] - 0.04 * U], 0.37 * U, 0.33 * U]);
    cones.push([[wrist[0] - side * 0.5 * U, wrist[1] + 0.12 * U, wrist[2] - 0.04 * U], [wrist[0] + side * 0.52 * U, wrist[1] + 0.12 * U, wrist[2] - 0.06 * U], 0.4 * U, 0.38 * U]);
    cones.push([[thumbBase[0] + side * 0.15 * U, thumbBase[1] - 0.1 * U, thumbBase[2]], thumbMcp, 0.36 * U, 0.29 * U]);
    var tips = [];
    for (var f = 2; f <= 5; f++) {
      var pts;
      if (key) {
        var tgt = this._tipTarget(scene, rig, f, key[f].p, mcp[f], RADII[f][3] * U);
        pts = solveFinger(mcp[f], tgt, LENS[f], U).pts;
      } else {
        var s2 = st[f];
        pts = fkFinger(mcp[f], [0, 1], LENS[f], U, s2.curl || 0, side * (f - 3.5) * 0.06 * (s2.spread == null ? 1 : s2.spread) + (s2.wig || 0) * 0.08);
      }
      for (var s = 0; s < 3; s++) cones.push([pts[s], pts[s + 1], RADII[f][s] * U, RADII[f][s + 1] * U]);
      var ax = norm3(sub(pts[3], pts[2]));
      tips.push({ p: pts[3], ax: ax, d: norm3(sub([0, 0, 1], mul(ax, ax[2]))), r: RADII[f][3] * U });
    }
    var tpts;
    if (key) {
      var tt = this._tipTarget(scene, rig, 1, key[1].p, thumbMcp, RADII[1][2] * U);
      tpts = solveFinger(thumbMcp, tt, LENS[1], U).pts;
    } else tpts = fkFinger(thumbMcp, [-side * 0.55, 0.85], LENS[1], U, (st[1].curl || 0) * 0.8, 0);
    cones.push([thumbBase, thumbMcp, 0.34 * U, RADII[1][0] * U]);
    cones.push([tpts[0], tpts[1], RADII[1][0] * U, RADII[1][1] * U]);
    cones.push([tpts[1], tpts[2], RADII[1][1] * U, RADII[1][2] * U]);
    var tax = norm3(sub(tpts[2], tpts[1]));
    tips.unshift({ p: tpts[2], ax: tax, d: norm3(add(sub([0, 0, 1], mul(tax, tax[2])), [-side * 0.5, 0, 0])), r: RADII[1][2] * U });
    // forearm, sleeve and cuff head back toward the player and outward
    var ac = armCones(wrist, norm3([side * 0.62, -0.78, -0.12]), U, 1);  // elbows out toward the shoulders
    cones.push(ac.list[0], ac.list[1], ac.list[2]);
    var c0 = ac.cuff[0], c1 = ac.cuff[1];
    cones.tips = tips;
    cones.cuff = [c0, c1];
    return cones;
  };

  /** Fingertip target on its key: pressing, sliding to another key, folding into a fist. */
  GLHands.prototype._tipTarget = function (scene, rig, f, keyP, base, tipR) {
    var st = rig.pose.fingers[f], U = scene.layout.U;
    var p = keyP.slice();
    if (st.slideTo != null && st.slide > 0) p = lerp3(p, scene.keyTouch3D(st.slideTo, f === 1), st.slide);
    var target = [p[0] + (st.wig || 0) * U * 0.16, p[1], p[2] + tipR - (st.press || 0) * U * 0.12 + (st.lift || 0) * U * 0.5];
    var curl = st.curl || 0;
    if (curl > 0) target = lerp3(target, [base[0], base[1] - 0.25 * U, 0.4 * U + base[2] * 0.3], CK.clamp(curl, 0, 1));
    return target;
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                               */
  /* ------------------------------------------------------------------ */
  GLHands.prototype.render = function (scene, rigs, dt) {
    if (!this.ok) return false;
    var gl = this.gl;
    if (this.W !== scene.W || this.H !== scene.H) this.resize(scene.W, scene.H, scene.dpr);
    if (dt) {
      this._ft.push(dt); if (this._ft.length > 40) this._ft.shift();
      if (this._ft.length === 40) {
        var avg = this._ft.reduce(function (a, b) { return a + b; }, 0) / 40, old = this.scale;
        if (avg > 0.026 && this.scale > 0.45) this.scale = Math.max(0.45, this.scale - 0.1);
        else if (avg < 0.017 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.05);
        if (old !== this.scale) { this._applySize(); this._ft = []; }
      }
    }
    var fb = this.fbScale;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.cuffs = [];
    var visible = rigs.filter(function (r) { return r.pose.visible; });
    if (!visible.length) return true;
    var view = scene.view, U = scene.layout.U, A = this.A, B = this.B;
    var minX = 1e9, maxX = -1e9, minY = 1e9;
    this.boxC.fill(0); this.boxH.fill(0); this.tip.fill(0);
    for (var h = 0; h < NH; h++) {
      var rig = visible[h];
      if (!rig) {
        for (var q = 0; q < NP; q++) { A.set([0, -1e4, -1e4, 0.001], (h * NP + q) * 4); B.set([0, -1e4, -1e4, 0.001], (h * NP + q) * 4); }
        continue;
      }
      var sk = this._skeleton(scene, rig);
      var bmin = [1e9, 1e9, 1e9], bmax = [-1e9, -1e9, -1e9];
      for (var i = 0; i < NP; i++) {
        var c = sk[i];
        A.set([c[0][0], c[0][1], c[0][2], c[2]], (h * NP + i) * 4);
        B.set([c[1][0], c[1][1], c[1][2], c[3]], (h * NP + i) * 4);
        if (i === 20) continue;
        for (var e = 0; e < 2; e++) {
          var pt = c[e], r = c[e + 2];
          for (var ax = 0; ax < 3; ax++) { bmin[ax] = Math.min(bmin[ax], pt[ax] - r); bmax[ax] = Math.max(bmax[ax], pt[ax] + r); }
          var sp = view.project(pt[0], pt[1], pt[2]);
          minX = Math.min(minX, sp.x - r * sp.s * 1.5); maxX = Math.max(maxX, sp.x + r * sp.s * 1.5); minY = Math.min(minY, sp.y - r * sp.s * 1.5);
        }
      }
      this.boxC.set([(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2, 1], h * 4);
      this.boxH.set([(bmax[0] - bmin[0]) / 2 + 0.05, (bmax[1] - bmin[1]) / 2 + 0.05, (bmax[2] - bmin[2]) / 2 + 0.05, 0], h * 4);
      rig.pose._tips = rig.pose._tips || [];
      for (var f = 1; f <= 5; f++) {
        var tp = sk.tips[f - 1], idx = (h * 5 + f - 1) * 4;
        this.tip.set([tp.p[0], tp.p[1], tp.p[2], CK.clamp(rig.pose.fingers[f].charge || 0, 0, 1)], idx);
        this.nailA.set([tp.ax[0], tp.ax[1], tp.ax[2], tp.r], idx);
        this.nailD.set([tp.d[0], tp.d[1], tp.d[2], 0], idx);
        var ps = view.project(tp.p[0], tp.p[1], tp.p[2]);
        rig.pose._tips[f] = { x: ps.x, y: ps.y };
      }
      this.clefSel[h] = rig.hand === 'R' ? 0 : 0.5;
      var col = CK.hexToRgb(CK.HAND_COLOR[rig.hand] || '#38e8ff');
      this.rim.set([Math.pow(col[0] / 255, 2.2), Math.pow(col[1] / 255, 2.2), Math.pow(col[2] / 255, 2.2)], h * 3);
    }
    var keyBack = view.project(0, CK.KEY3D.LEN, 0).y;
    minY = Math.max(0, Math.min(minY, keyBack) - 10);
    minX = Math.max(0, minX - 40); maxX = Math.min(scene.W, maxX + 80);
    if (maxX - minX < 4) { minX = 0; maxX = scene.W; }
    var vx = Math.floor(minX * fb), vy = Math.floor(minY * fb), vw = Math.ceil((maxX - minX) * fb), vh = this.canvas.height - vy;
    if (vw <= 0 || vh <= 0) return true;
    gl.viewport(vx, 0, vw, vh);
    gl.useProgram(this.prog);
    var L = this.loc, u = view.uniforms();
    gl.uniform4fv(L.uA, A); gl.uniform4fv(L.uB, B);
    gl.uniform4fv(L.uBoxC, this.boxC); gl.uniform4fv(L.uBoxH, this.boxH);
    gl.uniform4fv(L.uTip, this.tip); gl.uniform4fv(L.uNailA, this.nailA); gl.uniform4fv(L.uNailD, this.nailD);
    gl.uniform3fv(L.uRim, this.rim);
    gl.uniform3f(L.uCam, u.cam[0], u.cam[1], u.cam[2]);
    gl.uniform3f(L.uFw, u.fw[0], u.fw[1], u.fw[2]);
    gl.uniform3f(L.uUp, u.up[0], u.up[1], u.up[2]);
    gl.uniform3f(L.uRt, u.rt[0], u.rt[1], u.rt[2]);
    gl.uniform1f(L.uF, u.F); gl.uniform1f(L.uCx, u.cx); gl.uniform1f(L.uCy, u.cy); gl.uniform1f(L.uOy, u.oy);
    gl.uniform1f(L.uPx, 1 / fb);
    gl.uniform1f(L.uViewH, this.canvas.height);
    gl.uniform1f(L.uU, U);
    gl.uniform1f(L.uKeyLen, CK.KEY3D.LEN);
    gl.uniform3f(L.uL, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1fv(L.uClef, this.clefSel);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._clefTexture());
    gl.uniform1i(L.uClefTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  };

  CK.GLHands = GLHands;
})();
