/* Cosmic Keys — 3D space monsters, ray-marched on the GPU (WebGL2).
 *
 * Front-on orthographic view. Each monster is one draw call confined to a
 * small viewport around it. Shape: a soft jelly body with smooth-blended
 * horns, antenna, brow, arms and four tentacles; a big eyeball with a heavy
 * scheming lid; a grin carved into the body with pointy teeth. Lit with a key
 * light, translucent "jelly" sub-surface glow, a cyan rim from the piano's
 * neon below, and glossy highlights.
 */
(function () {
  'use strict';
  var CK = window.CK;

  var VS = '#version 300 es\nin vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';

  var FS = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 outColor;',
    'uniform vec2 uCenter;   // css px',
    'uniform float uR;       // body radius css px',
    'uniform vec2 uSquash;   // x, y scale',
    'uniform vec3 uLid;      // lid height (-1 closed..1 open), tilt, unused',
    'uniform vec3 uMood;     // mouth open 0..1, laugh 0/1, alarm 0/1',
    'uniform vec2 uLook;',
    'uniform float uT;',
    'uniform float uPhase;',
    'uniform vec4 uGrip;     // two card-corner points in css px (x0,y0,x1,y1); x0 < -9000 = none',
    'uniform vec3 uBase;     // body colour (linear)',
    'uniform float uSpikes;',
    'uniform float uPulse;',
    'uniform float uFade;',
    'uniform float uPx;',
    'uniform float uViewH;',
    '',
    'float smin(float a, float b, float k){ float h = max(k - abs(a-b), 0.0)/k; return min(a,b) - h*h*k*0.25; }',
    'float smax(float a, float b, float k){ return -smin(-a, -b, k); }',
    'float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0 - 1.0)/max(k1, 1e-5); }',
    'float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){',
    '  vec3 ba = b - a; float l2 = dot(ba,ba); float rr = r1 - r2; float a2 = l2 - rr*rr; float il2 = 1.0/max(l2,1e-5);',
    '  vec3 pa = p - a; float y = dot(pa,ba); float z = y - l2;',
    '  vec3 xv = pa*l2 - ba*y; float x2 = dot(xv,xv); float y2 = y*y*l2; float z2 = z*z*l2;',
    '  float k = sign(rr)*rr*rr*x2;',
    '  if (sign(z)*a2*z2 > k) return sqrt(x2 + z2)*il2 - r2;',
    '  if (sign(y)*a2*y2 < k) return sqrt(x2 + y2)*il2 - r1;',
    '  return (sqrt(x2*a2*il2) + y*rr)*il2 - r1;',
    '}',
    '',
    'vec3 eyeC(float sd){ return vec3(sd*0.27 + uLook.x*0.03, 0.2 + uLook.y*0.02, 0.56); }',
    '',
    '// distance (in units of r) and material: 1 body, 2 horn, 3 eye, 4 mouth, 5 teeth, 6 bulb, 7 tongue',
    'vec2 map(vec3 p){',
    '  float t = uT, ph = uPhase;',
    '  // body with squash & stretch and a gentle jelly wobble',
    '  vec3 q = p / vec3(uSquash.x, uSquash.y, 1.0);',
    '  float wob = sin(q.y*6.0 + t*3.1 + ph)*0.012 + sin(q.x*5.0 - t*2.3)*0.01;',
    '  float body = sdEll(q, vec3(1.0, 0.9, 0.82)) + wob;',
    '  // mouth carve (a curved grin) — open more when laughing / gasping',
    '  float open = uMood.x;',
    '  vec3 mq = q - vec3(0.02, -0.36, 0.72);',
    '  mq.y -= (mq.x*mq.x)*0.55*(1.0 - uMood.z);',
    '  vec3 mr = mix(vec3(0.62, 0.08 + open*0.16, 0.34), vec3(0.16, 0.18, 0.3), uMood.z);',
    '  float mouth = sdEll(mq, mr);',
    '  body = smax(body, -mouth, 0.05);',
    '  vec2 res = vec2(body, 1.0);',
    '  // brow ridge (sly slant, raised when alarmed)',
    '  vec3 bp = q - vec3(0.0, 0.49 + uMood.z*0.1, 0.64);',
    '  bp.y -= abs(bp.x)*mix(0.55, -0.12, uMood.z);',
    '  float brow = sdEll(bp, vec3(0.6, 0.065, 0.13));',
    '  res.x = smin(res.x, brow, 0.12);',
    '  // virus spikes radiating around the rim, each with a glowing club tip (horns on calm variants)',
    '  if (uSpikes > 0.5){',
    '    for (int i = 0; i < 11; i++){',
    '      float a = radians(-48.0 + float(i)*27.6) + sin(t*1.7 + float(i)*1.3 + ph)*0.05;',
    '      vec3 d = normalize(vec3(cos(a)*1.0, sin(a)*0.92, -0.18));',
    '      float sp = sdRC(q, d*0.72, d*1.2, 0.11, 0.035);',
    '      res.x = smin(res.x, sp, 0.07);',
    '      float club = length(q - d*1.24) - 0.075*(1.0 + uPulse*0.2);',
    '      if (club < res.x) res = vec2(club, 6.0);',
    '    }',
    '  } else {',
    '    for (int i = 0; i < 2; i++){',
    '      float s = i == 0 ? -1.0 : 1.0;',
    '      vec3 hb = vec3(s*0.5, 0.64, 0.1), hm = vec3(s*0.68, 0.92, 0.06), ht = vec3(s*0.6, 1.16, 0.0);',
    '      float h = min(sdRC(q, hb, hm, 0.15, 0.09), sdRC(q, hm, ht, 0.09, 0.025));',
    '      if (h < res.x) res.y = 2.0;',
    '      res.x = smin(res.x, h, 0.07);',
    '    }',
    '  }',
    '  // antenna with lagging bulb (secondary motion)',
    '  float lag = sin(t*3.0 + ph - 0.7)*0.12;',
    '  vec3 ab = vec3(0.0, 0.82, 0.05), at = vec3(lag, 1.42, 0.05);',
    '  float stalk = sdRC(q, ab, at, 0.045, 0.03);',
    '  res.x = smin(res.x, stalk, 0.05);',
    '  float bulb = length(q - at) - 0.11*(1.0 + uPulse*0.25);',
    '  if (bulb < res.x) res = vec2(bulb, 6.0);',
    '  // two eyeballs under angry, slanted lids (inner corners low)',
    '  for (int ei = 0; ei < 2; ei++){',
    '    float sd = ei == 0 ? -1.0 : 1.0;',
    '    vec3 ec = eyeC(sd);',
    '    float eye = length(q - ec) - 0.27*(1.0 + uMood.z*0.1);',
    '    if (eye < res.x) res = vec2(eye, 3.0);',
    '    vec3 lp = q - ec;',
    '    float shell = abs(length(lp) - 0.29) - 0.025;',
    '    float lidH = uLid.x*0.28;',
    '    float plane = -(lp.y - lidH - sd*lp.x*uLid.y*1.6);',
    '    float lid = max(max(shell, plane), -lp.z - 0.06);',
    '    if (lid < res.x) res = vec2(lid, 1.0);',
    '  }',
    '  // teeth along the upper lip (two fangs)',
    '  if (uMood.z < 0.5){',
    '    for (int i = 0; i < 8; i++){',
    '      float x = -0.49 + float(i)*0.14;',
    '      float lipY = -0.36 + 0.07 + x*x*0.55;',
    '      float fang = (i == 1 || i == 6) ? 1.0 : 0.0;',
    '      vec3 tb = vec3(x, lipY + 0.02, 0.86 - abs(x)*0.25);',
    '      float tooth = sdRC(q, tb, tb + vec3(0.0, -0.08 - fang*0.06, 0.02), 0.05, 0.008);',
    '      if (tooth < res.x) res = vec2(tooth, 5.0);',
    '    }',
    '  }',
    '  // tongue when laughing',
    '  if (uMood.y > 0.5){',
    '    float tongue = sdEll(q - vec3(0.06, -0.5 - open*0.05, 0.62), vec3(0.24, 0.07, 0.16));',
    '    if (tongue < res.x) res = vec2(tongue, 7.0);',
    '  }',
    '  // tentacles: three bones each, swaying',
    '  for (int i = 0; i < 4; i++){',
    '    float fi = float(i);',
    '    float s = fi < 2.0 ? -1.0 : 1.0;',
    '    float inner = mod(fi, 2.0) < 0.5 ? 1.0 : 0.0;',
    '    float bx = s*mix(0.62, 0.3, inner);',
    '    vec3 a = vec3(bx, -0.62, mix(-0.05, 0.08, inner));',
    '    float sw = sin(t*3.2 + fi*1.4 + ph);',
    '    vec3 b = a + vec3(s*0.22 + sw*0.05, -0.32, 0.02);',
    '    vec3 c = b + vec3(s*mix(0.3, 0.12, inner) + sw*0.1, -0.3 + inner*0.06, 0.05);',
    '    vec3 d = c + vec3(s*0.18 + sw*0.14, -0.08 + sin(t*4.0 + fi)*0.06, 0.08);',
    '    float tn = min(min(sdRC(q, a, b, 0.17, 0.12), sdRC(q, b, c, 0.12, 0.08)), sdRC(q, c, d, 0.08, 0.045));',
    '    if (tn < res.x) res.y = 1.0;',
    '    res.x = smin(res.x, tn, 0.12);',
    '  }',
    '  // arms reaching to the card corners',
    '  if (uGrip.x > -9000.0){',
    '    for (int i = 0; i < 2; i++){',
    '      float s = i == 0 ? -1.0 : 1.0;',
    '      vec2 g = i == 0 ? uGrip.xy : uGrip.zw;',
    '      vec3 hand = vec3(g, 0.78);',
    '      vec3 sh = vec3(s*0.78, -0.18, 0.3);',
    '      vec3 el = mix(sh, hand, 0.5) + vec3(s*0.18, 0.05, 0.12);',
    '      float arm = min(sdRC(q, sh, el, 0.12, 0.1), sdRC(q, el, hand, 0.1, 0.085));',
    '      arm = smin(arm, length(q - hand) - 0.12, 0.05);',
    '      if (arm < res.x) res.y = 1.0;',
    '      res.x = smin(res.x, arm, 0.1);',
    '    }',
    '  }',
    '  return res;',
    '}',
    '',
    'vec3 normalAt(vec3 p){',
    '  vec2 k = vec2(1.0, -1.0); float e = 0.004;',
    '  return normalize(k.xyy*map(p + k.xyy*e).x + k.yyx*map(p + k.yyx*e).x + k.yxy*map(p + k.yxy*e).x + k.xxx*map(p + k.xxx*e).x);',
    '}',
    'float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }',
    'float vnoise(vec3 x){',
    '  vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);',
    '  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);',
    '}',
    'vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }',
    '',
    'void main(){',
    '  vec2 css = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y) * uPx;',
    '  vec2 l = (css - uCenter) / uR; l.y = -l.y;',
    '  vec3 ro = vec3(l, 2.2), rd = vec3(0.0, 0.0, -1.0);',
    '  float t = 0.0; vec2 res = vec2(0.0); bool hit = false; float minD = 1e5;',
    '  for (int i = 0; i < 64; i++){',
    '    res = map(ro + rd*t);',
    '    minD = min(minD, res.x);',
    '    if (res.x < 0.002){ hit = true; break; }',
    '    t += res.x*0.9;',
    '    if (t > 4.6) break;',
    '  }',
    '  float pix = uPx*1.2/uR;',
    '  float alpha = 1.0;',
    '  if (!hit){',
    '    // soft outer glow',
    '    float g = exp(-max(minD, 0.0)*5.0) * 0.22 * (1.0 + uPulse*0.6);',
    '    outColor = vec4(vec3(0.35, 1.0, 0.55)*g, g) * uFade;',
    '    return;',
    '  }',
    '  vec3 p = ro + rd*t;',
    '  vec3 n = normalAt(p);',
    '  vec3 v = -rd;',
    '  vec3 L = normalize(vec3(-0.5, 0.65, 0.6));',
    '  vec3 H = normalize(L + v);',
    '  float ndl = dot(n, L);',
    '  float wrap = clamp((ndl + 0.4)/1.4, 0.0, 1.0);',
    '  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.5);',
    '  float rimUp = clamp(-n.y*0.8 + 0.2, 0.0, 1.0) * fres;',
    '  vec3 rimCol = vec3(0.25, 0.95, 1.0);',
    '  float ao = clamp(0.5 + 0.5*map(p + n*0.12).x/0.12, 0.25, 1.0);',
    '  float m = res.y;',
    '  vec3 col;',
    '  if (m < 1.5){',
    '    // jelly skin: spots, translucency, glossy',
    '    float spots = smoothstep(0.62, 0.7, vnoise(p*4.2 + vec3(uPhase*3.0)));',
    '    vec3 base = uBase * (1.0 - spots*0.35);',
    '    vec3 deep = uBase * vec3(0.25, 0.5, 0.35);',
    '    vec3 sss = mix(deep, base*1.4, wrap);',
    '    col = sss * (0.35 + 0.75*wrap) * ao;',
    '    col += vec3(0.75, 1.0, 0.6) * pow(max(dot(n, H), 0.0), 48.0) * 0.7;',
    '    col += rimCol * rimUp * 0.9 + base * fres * 0.35;',
    '  } else if (m < 2.5){',
    '    vec3 hb = vec3(0.32, 0.2, 0.75), ht = vec3(0.86, 0.8, 1.0);',
    '    float k = clamp((p.y - 0.6)/0.6, 0.0, 1.0);',
    '    col = mix(hb, ht, k) * (0.3 + 0.8*wrap) + vec3(pow(max(dot(n, H), 0.0), 40.0)*0.6) + rimCol*rimUp*0.5;',
    '  } else if (m < 3.5){',
    '    vec3 ec = eyeC(p.x < 0.0 ? -1.0 : 1.0);',
    '    vec3 e = normalize(p / vec3(uSquash.x, uSquash.y, 1.0) - ec);',
    '    vec2 gaze = vec2(uLook.x*0.28, uLook.y*0.15 - 0.05);',
    '    vec2 d = e.xy - gaze;',
    '    float r = length(d);',
    '    float irisR = mix(0.36, 0.24, uMood.z);',
    '    vec3 white = vec3(0.96, 0.98, 0.95) * (0.55 + 0.5*wrap);',
    '    vec3 irisC = mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.42, 0.05), smoothstep(0.0, irisR, r));',
    '    if (uMood.z > 0.5) irisC = mix(vec3(1.0, 0.5, 0.5), vec3(0.85, 0.08, 0.2), smoothstep(0.0, irisR, r));',
    '    col = white;',
    '    float irisM = 1.0 - smoothstep(irisR - 0.02, irisR + 0.01, r);',
    '    col = mix(col, irisC*(0.6 + 0.5*wrap), irisM);',
    '    float pupilW = mix(0.06, 0.07, uMood.z), pupilH = mix(0.22, 0.07, uMood.z);',
    '    float pm = 1.0 - smoothstep(0.9, 1.05, length(d/vec2(pupilW, pupilH)));',
    '    col = mix(col, vec3(0.03, 0.02, 0.04), pm);',
    '    col += vec3(1.0) * pow(max(dot(n, H), 0.0), 120.0) * 1.4;',
    '    col *= ao;',
    '  } else if (m < 4.5){',
    '    col = vec3(0.12, 0.02, 0.06);',
    '  } else if (m < 5.5){',
    '    col = vec3(0.98, 0.97, 0.92)*(0.55 + 0.5*wrap) + vec3(pow(max(dot(n, H), 0.0), 60.0)*0.5);',
    '  } else if (m < 6.5){',
    '    col = vec3(0.9, 1.0, 0.45) * (1.6 + uPulse*1.2);',
    '  } else {',
    '    col = vec3(1.0, 0.42, 0.55) * (0.45 + 0.6*wrap);',
    '  }',
    '  // inside of the mouth reads dark',
    '  if (m < 1.5){',
    '    vec3 q = p / vec3(uSquash.x, uSquash.y, 1.0);',
    '    vec3 mq = q - vec3(0.02, -0.36, 0.72);',
    '    mq.y -= (mq.x*mq.x)*0.55*(1.0 - uMood.z);',
    '    vec3 mr = mix(vec3(0.62, 0.08 + uMood.x*0.16, 0.34), vec3(0.16, 0.18, 0.3), uMood.z);',
    '    float inside = sdEll(mq, mr);',
    '    col = mix(vec3(0.16, 0.02, 0.07), col, smoothstep(-0.02, 0.03, inside));',
    '  }',
    '  col = aces(col);',
    '  col = pow(col, vec3(1.0/2.2));',
    '  outColor = vec4(col, 1.0) * uFade;',
    '}'
  ].join('\n');

  function GLMonsters(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.list = [];
    try { this._init(); } catch (e) { if (window.console) console.warn('GL monsters unavailable:', e); this.ok = false; }
  }

  GLMonsters.prototype._init = function () {
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
    ['uCenter', 'uR', 'uSquash', 'uLid', 'uMood', 'uLook', 'uT', 'uPhase', 'uGrip', 'uBase', 'uSpikes', 'uPulse', 'uFade', 'uPx', 'uViewH'].forEach(function (n) { this.loc[n] = gl.getUniformLocation(prog, n); }, this);
    var self = this;
    c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.ok = false; }, false);
    c.addEventListener('webglcontextrestored', function () { try { self._init(); } catch (e2) { self.ok = false; } }, false);
    this.scale = 1;
    this.ok = true;
  };

  GLMonsters.prototype.resize = function (W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    var px = Math.min(dpr || 1, 2) * this.scale;
    this.fb = px;
    var w = Math.round(W * px), h = Math.round(H * px);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  };

  /** Queue a monster for this frame (called by the scene while it walks the enemy list). */
  GLMonsters.prototype.add = function (m) { this.list.push(m); };

  /** Draw every queued monster, then clear the queue. */
  GLMonsters.prototype.flush = function () {
    if (!this.ok) { this.list = []; return; }
    var gl = this.gl, fb = this.fb;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.list.length) return;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var L = this.loc;
    gl.uniform1f(L.uPx, 1 / fb);
    gl.uniform1f(L.uViewH, this.canvas.height);
    for (var i = 0; i < this.list.length; i++) {
      var m = this.list[i];
      var r = m.size * 0.46;
      // viewport around the monster (tentacles hang low, horns/antenna reach up)
      var x0 = m.x - r * 2.0, x1 = m.x + r * 2.0, y0 = m.y - r * 2.0, y1 = m.y + r * 1.9;
      if (m.grip) { x0 = Math.min(x0, m.grip[0].x - r * 0.3, m.grip[1].x - r * 0.3); x1 = Math.max(x1, m.grip[0].x + r * 0.3, m.grip[1].x + r * 0.3); y1 = Math.max(y1, m.grip[0].y + r * 0.3, m.grip[1].y + r * 0.3); }
      var vx = Math.max(0, Math.floor(x0 * fb)), vy = Math.max(0, Math.floor(y0 * fb));
      var vw = Math.min(this.canvas.width, Math.ceil(x1 * fb)) - vx, vh = Math.min(this.canvas.height, Math.ceil(y1 * fb)) - vy;
      if (vw <= 0 || vh <= 0) continue;
      gl.viewport(vx, this.canvas.height - vy - vh, vw, vh);
      gl.uniform2f(L.uCenter, m.x, m.y);
      gl.uniform1f(L.uR, r);
      gl.uniform2f(L.uSquash, m.sx || 1, m.sy || 1);
      var lid = m.mood === 'alarm' ? 1.2 : (m.mood === 'laugh' ? -1.0 : 0.18);
      lid = Math.min(lid, 1.2 - (m.blink || 0) * 2.6);
      gl.uniform3f(L.uLid, lid, m.mood === 'alarm' ? 0 : 0.28, 0);
      var open = m.mood === 'laugh' ? 0.55 + Math.abs(Math.sin(m.t * 20)) * 0.45 : 0.08 + Math.sin(m.t * 2 + (m.variant.phase || 0)) * 0.04;
      gl.uniform3f(L.uMood, open, m.mood === 'laugh' ? 1 : 0, m.mood === 'alarm' ? 1 : 0);
      gl.uniform2f(L.uLook, m.look || 0, 0);
      gl.uniform1f(L.uT, m.t);
      gl.uniform1f(L.uPhase, m.variant.phase || 0);
      if (m.grip) {
        // grip points in body units (y up)
        gl.uniform4f(L.uGrip, (m.grip[0].x - m.x) / r, -(m.grip[0].y - m.y) / r, (m.grip[1].x - m.x) / r, -(m.grip[1].y - m.y) / r);
      } else gl.uniform4f(L.uGrip, -9999, 0, 0, 0);
      var c = CK.hexToRgb(m.variant.base || '#43e07a');
      gl.uniform3f(L.uBase, Math.pow(c[0] / 255, 2.2), Math.pow(c[1] / 255, 2.2), Math.pow(c[2] / 255, 2.2));
      gl.uniform1f(L.uSpikes, m.variant.spikes ? 1 : 0);
      gl.uniform1f(L.uPulse, m.pulse || 0);
      gl.uniform1f(L.uFade, m.fade == null ? 1 : m.fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    this.list = [];
  };

  CK.GLMonsters = GLMonsters;
})();
