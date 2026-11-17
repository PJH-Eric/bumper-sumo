/* ===== art.js — 碰碰車、動物駕駛、道具、擂台主題（全部 Canvas 向量繪製，不用 emoji 與圖片） =====
 *
 * 視覺摘要（遊樂園碰碰車場）：
 *   配色：每台車一個飽和主色＋深色橡膠保險桿；擂台用主題雙色地板＋邊緣燈泡。
 *   形狀：圓潤厚實、有高度（底部暗色厚度＋頂部高光），駕駛是立體一體、有四肢的小動物。
 *   材質：亮面烤漆、橡膠、燈泡光暈；字體圓潤粗體。
 *   動態：撞擊星星爆花、被撞變白一閃、搖搖欲墜晃動、掉落翻轉縮小、幽靈半透明飄動。
 */
(function (root) {
  'use strict';

  var CARS = [
    { animal: 'bear',    body: '#2f7de1', dark: '#1b4f99', light: '#8cc0ff', fur: '#a8754a', furDark: '#7a5233', belly: '#e9c9a0', pattern: 'stripes' },
    { animal: 'cat',     body: '#e8423f', dark: '#9c2224', light: '#ff9a8f', fur: '#f2a24a', furDark: '#c9772a', belly: '#ffe3bf', pattern: 'dots' },
    { animal: 'frog',    body: '#2fb35a', dark: '#1a7438', light: '#8fe6a8', fur: '#7ccf4a', furDark: '#4d9a2b', belly: '#e6f7b0', pattern: 'zigzag' },
    { animal: 'chick',   body: '#f5c518', dark: '#b8890a', light: '#fff09a', fur: '#ffe066', furDark: '#e0a91a', belly: '#fff6c8', pattern: 'stars' },
    { animal: 'rabbit',  body: '#8a55d6', dark: '#56309a', light: '#c7a6ff', fur: '#f4f1f8', furDark: '#c9c1d6', belly: '#ffd9e6', pattern: 'checker' },
    { animal: 'fox',     body: '#f07c1e', dark: '#a54d08', light: '#ffc07f', fur: '#ef7f2a', furDark: '#b5551a', belly: '#fff1e0', pattern: 'rings' },
    { animal: 'pig',     body: '#f06aa8', dark: '#a93a6e', light: '#ffb6d6', fur: '#ffb3c8', furDark: '#e07f9c', belly: '#ffd6e2', pattern: 'triangles' },
    { animal: 'penguin', body: '#1fb9c9', dark: '#0d7480', light: '#94eef6', fur: '#2d3247', furDark: '#151826', belly: '#f6f6f6', pattern: 'cross' }
  ];
  var DUMMY = { animal: 'dummy', body: '#c99a5b', dark: '#8a6232', light: '#ecc994', fur: '#c99a5b', furDark: '#8a6232', belly: '#f1d7a8', pattern: 'rings' };

  var ITEM_COLORS = {
    super: ['#ff5a36', '#ffd23f'], iron: ['#6b7486', '#c5ccd8'], banana: ['#f7d038', '#8a6a12'],
    magnet: ['#e8423f', '#d7dbe2'], shield: ['#38b6ff', '#d4f1ff'], spring: ['#2fb35a', '#c8f5c8']
  };

  function skinOf(i) { return i === 8 || i == null ? DUMMY : CARS[((i % 8) + 8) % 8]; }

  /* ---------- 基本形狀 ---------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
  function ellipse(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, Math.PI * 2); }

  /* ---------- 色彩輔助圖案（在車身上） ---------- */
  function pattern(ctx, type, s, color) {
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
    var i;
    if (type === 'stripes') { for (i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.18 - s * 0.1, -s * 0.4); ctx.lineTo(i * s * 0.18 + s * 0.1, s * 0.4); ctx.stroke(); } }
    else if (type === 'dots') { for (i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; circle(ctx, Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26, s * 0.06); ctx.fill(); } }
    else if (type === 'zigzag') { ctx.beginPath(); for (i = 0; i <= 6; i++) ctx.lineTo(-s * 0.36 + i * s * 0.12, (i % 2 ? -1 : 1) * s * 0.12); ctx.stroke(); }
    else if (type === 'stars') { for (i = 0; i < 3; i++) star(ctx, -s * 0.24 + i * s * 0.24, (i === 1 ? -1 : 1) * s * 0.12, s * 0.09, color); }
    else if (type === 'checker') { for (var gx = -2; gx < 2; gx++) for (var gy = -2; gy < 2; gy++) if ((gx + gy) & 1) ctx.fillRect(gx * s * 0.13, gy * s * 0.13, s * 0.13, s * 0.13); }
    else if (type === 'rings') { circle(ctx, 0, 0, s * 0.3); ctx.stroke(); circle(ctx, 0, 0, s * 0.17); ctx.stroke(); }
    else if (type === 'triangles') { for (i = 0; i < 3; i++) { var tx = -s * 0.24 + i * s * 0.24; ctx.beginPath(); ctx.moveTo(tx, -s * 0.12); ctx.lineTo(tx + s * 0.1, s * 0.1); ctx.lineTo(tx - s * 0.1, s * 0.1); ctx.closePath(); ctx.fill(); } }
    else if (type === 'cross') { ctx.lineWidth = s * 0.09; ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.2); ctx.lineTo(s * 0.2, s * 0.2); ctx.moveTo(s * 0.2, -s * 0.2); ctx.lineTo(-s * 0.2, s * 0.2); ctx.stroke(); }
    ctx.restore();
  }

  function star(ctx, x, y, r, color) {
    ctx.save(); ctx.fillStyle = color; ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /* ---------- 車身（隨車頭方向旋轉） ----------
   * s：一個車身長的像素數。車身中心在 (0,0)，車頭朝 +x。 */
  function carBody(ctx, sk, s, o) {
    var L = s * 0.98, W = s * 0.86;
    /* 厚度：往下偏移的深色底 */
    ctx.save();
    ctx.translate(0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ellipse(ctx, s * 0.04, s * 0.1, L * 0.52, W * 0.54); ctx.fill();
    ctx.restore();
  }

  /** 整台車：in world px, center (x,y), heading angle */
  function drawCar(ctx, x, y, angle, s, skinIdx, o) {
    o = o || {};
    var sk = skinOf(skinIdx);
    var t = o.t || 0;
    var lift = o.lift || 0;         // 彈簧騰空（像素）
    var scale = o.scale == null ? 1 : o.scale;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;

    /* 影子（騰空時變小變淡） */
    if (!o.noShadow) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,10,30,' + (0.32 - Math.min(0.2, lift / s * 0.1)) + ')';
      var shK = 1 - Math.min(0.4, lift / s * 0.25);
      ellipse(ctx, x + s * 0.06, y + s * 0.2, s * 0.56 * shK * scale, s * 0.42 * shK * scale); ctx.fill();
      ctx.restore();
    }

    ctx.translate(x, y - lift);
    ctx.scale(scale, scale);
    if (o.wobble) ctx.rotate(Math.sin(t * 40) * 0.12);

    /* --- 旋轉部分：保險桿、車身 --- */
    ctx.save();
    ctx.rotate(angle);
    var L = s * 0.5, W = s * 0.44;
    /* 厚度 */
    ctx.fillStyle = shade(sk.dark, -0.25);
    rr(ctx, -L, -W + s * 0.1, L * 2, W * 2, W * 0.95); ctx.fill();
    /* 橡膠保險桿 */
    ctx.fillStyle = o.flash ? '#ffffff' : '#2b2b3a';
    rr(ctx, -L, -W, L * 2, W * 2, W * 0.95); ctx.fill();
    ctx.fillStyle = o.flash ? '#ffffff' : '#45465c';
    rr(ctx, -L + s * 0.03, -W + s * 0.03, L * 2 - s * 0.06, W * 0.7, W * 0.6); ctx.fill();
    /* 車身 */
    var bL = L * 0.84, bW = W * 0.8;
    var g = ctx.createLinearGradient(0, -bW, 0, bW);
    g.addColorStop(0, o.flash ? '#fff' : sk.light);
    g.addColorStop(0.45, o.flash ? '#fff' : sk.body);
    g.addColorStop(1, o.flash ? '#eee' : sk.dark);
    ctx.fillStyle = g;
    rr(ctx, -bL, -bW, bL * 2, bW * 2, bW * 0.85); ctx.fill();
    if (o.colorBlind && !o.flash) pattern(ctx, sk.pattern, s * 0.9, 'rgba(255,255,255,0.55)');
    /* 車頭小燈 */
    ctx.fillStyle = '#fff6c0';
    circle(ctx, bL * 0.82, -bW * 0.55, s * 0.055); ctx.fill();
    circle(ctx, bL * 0.82, bW * 0.55, s * 0.055); ctx.fill();
    /* 座椅凹槽 */
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    rr(ctx, -bL * 0.75, -bW * 0.62, bL * 1.25, bW * 1.24, bW * 0.55); ctx.fill();
    /* 方向盤（在車頭） */
    ctx.strokeStyle = '#2b2b3a'; ctx.lineWidth = s * 0.05;
    circle(ctx, bL * 0.42, 0, s * 0.11); ctx.stroke();
    /* 高光 */
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ellipse(ctx, -bL * 0.1, -bW * 0.62, bL * 0.6, bW * 0.14); ctx.fill();
    /* 衝刺蓄力：往後縮 */
    ctx.restore();

    /* --- 不旋轉部分：天線火花桿、駕駛 --- */
    var rearX = -Math.cos(angle) * s * 0.36, rearY = -Math.sin(angle) * s * 0.36;
    var poleH = s * 0.62;
    ctx.strokeStyle = '#8b8fa3'; ctx.lineWidth = s * 0.035; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(rearX, rearY); ctx.lineTo(rearX, rearY - poleH); ctx.stroke();
    var spark = (Math.sin(t * 18 + skinIdx) + 1) / 2;
    ctx.fillStyle = 'rgba(255,240,140,' + (0.45 + spark * 0.5) + ')';
    star(ctx, rearX, rearY - poleH, s * (0.08 + spark * 0.05), ctx.fillStyle);

    /* 駕駛：坐在車中心偏前，方向盤位置用來擺手 */
    var wheelX = Math.cos(angle) * s * 0.2, wheelY = Math.sin(angle) * s * 0.2;
    var dx = Math.cos(angle) * s * 0.02, dy = Math.sin(angle) * s * 0.02;
    drawDriver(ctx, dx, dy, s, sk, o.mood || 'happy', t, wheelX, wheelY, o);

    /* 護盾泡泡 */
    if (o.shield) {
      ctx.save();
      var pulse = 0.9 + Math.sin(t * 8) * 0.05;
      var sg = ctx.createRadialGradient(0, -s * 0.15, s * 0.2, 0, -s * 0.1, s * 0.78 * pulse);
      sg.addColorStop(0, 'rgba(120,210,255,0.05)');
      sg.addColorStop(0.8, 'rgba(120,210,255,0.28)');
      sg.addColorStop(1, 'rgba(200,240,255,0.75)');
      ctx.fillStyle = sg;
      circle(ctx, 0, -s * 0.12, s * 0.78 * pulse); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = s * 0.03;
      ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.7 * pulse, -2.4, -1.6); ctx.stroke();
      ctx.restore();
    }
    /* 鐵塊：車上壓一塊鐵 */
    if (o.iron) {
      ctx.save();
      ctx.fillStyle = '#5b6273';
      rr(ctx, -s * 0.22, s * 0.05, s * 0.44, s * 0.16, s * 0.04); ctx.fill();
      ctx.fillStyle = '#9aa3b5';
      rr(ctx, -s * 0.22, s * 0.05, s * 0.44, s * 0.06, s * 0.03); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '900 ' + Math.round(s * 0.12) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('3t', 0, s * 0.14);
      ctx.restore();
    }
    ctx.restore();
  }

  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = k < 0 ? 0 : 255, a = Math.abs(k);
    r = Math.round(r + (f - r) * a); g = Math.round(g + (f - g) * a); b = Math.round(b + (f - b) * a);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------- 動物駕駛（立體一體、有四肢） ---------- */
  function drawDriver(ctx, x, y, s, sk, mood, t, wx, wy, o) {
    var a = sk.animal;
    var bob = Math.sin(t * 6) * s * 0.012;
    var shake = mood === 'panic' ? Math.sin(t * 50) * s * 0.02 : 0;
    var hx = x + shake, hy = y - s * 0.34 + bob;
    var headR = s * 0.25;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (a === 'dummy') { drawDummy(ctx, x, y, s, t, mood); ctx.restore(); return; }

    /* 腳（露出座椅前緣的兩隻小腳） */
    ctx.fillStyle = sk.furDark;
    ellipse(ctx, x - s * 0.09, y + s * 0.06, s * 0.065, s * 0.045); ctx.fill();
    ellipse(ctx, x + s * 0.09, y + s * 0.06, s * 0.065, s * 0.045); ctx.fill();

    /* 身體 */
    var bg = ctx.createRadialGradient(x - s * 0.05, y - s * 0.12, s * 0.02, x, y - s * 0.06, s * 0.2);
    bg.addColorStop(0, shade(toHex(sk.fur), 0.2)); bg.addColorStop(1, sk.fur);
    ctx.fillStyle = bg;
    ellipse(ctx, x, y - s * 0.07, s * 0.17, s * 0.15); ctx.fill();
    ctx.fillStyle = sk.belly;
    ellipse(ctx, x, y - s * 0.05, s * 0.1, s * 0.09); ctx.fill();

    /* 手臂：從肩膀伸到方向盤 */
    var shL = [x - s * 0.13, y - s * 0.12], shR = [x + s * 0.13, y - s * 0.12];
    var up = mood === 'shock' || mood === 'panic';
    var handL = up ? [x - s * 0.26, y - s * 0.42 + Math.sin(t * 30) * s * 0.03] : [wx - s * 0.08, wy - s * 0.02];
    var handR = up ? [x + s * 0.26, y - s * 0.42 - Math.sin(t * 30) * s * 0.03] : [wx + s * 0.08, wy - s * 0.02];
    ctx.strokeStyle = sk.furDark; ctx.lineWidth = s * 0.075;
    ctx.beginPath(); ctx.moveTo(shL[0], shL[1]); ctx.quadraticCurveTo(shL[0] - s * 0.04, (shL[1] + handL[1]) / 2, handL[0], handL[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(shR[0], shR[1]); ctx.quadraticCurveTo(shR[0] + s * 0.04, (shR[1] + handR[1]) / 2, handR[0], handR[1]); ctx.stroke();
    ctx.fillStyle = sk.fur;
    circle(ctx, handL[0], handL[1], s * 0.045); ctx.fill();
    circle(ctx, handR[0], handR[1], s * 0.045); ctx.fill();

    /* 耳朵等頭部配件（在頭後面） */
    ctx.fillStyle = sk.fur;
    if (a === 'bear' || a === 'pig') {
      circle(ctx, hx - headR * 0.72, hy - headR * 0.72, headR * 0.34); ctx.fill();
      circle(ctx, hx + headR * 0.72, hy - headR * 0.72, headR * 0.34); ctx.fill();
      ctx.fillStyle = a === 'pig' ? '#f07fa0' : sk.belly;
      circle(ctx, hx - headR * 0.72, hy - headR * 0.72, headR * 0.18); ctx.fill();
      circle(ctx, hx + headR * 0.72, hy - headR * 0.72, headR * 0.18); ctx.fill();
    } else if (a === 'cat' || a === 'fox') {
      tri(ctx, hx - headR * 0.85, hy - headR * 0.35, hx - headR * 0.6, hy - headR * 1.25, hx - headR * 0.15, hy - headR * 0.8, sk.fur);
      tri(ctx, hx + headR * 0.85, hy - headR * 0.35, hx + headR * 0.6, hy - headR * 1.25, hx + headR * 0.15, hy - headR * 0.8, sk.fur);
      var inner = a === 'fox' ? '#3a2a22' : '#ffb3a7';
      tri(ctx, hx - headR * 0.7, hy - headR * 0.5, hx - headR * 0.6, hy - headR * 1.05, hx - headR * 0.3, hy - headR * 0.8, inner);
      tri(ctx, hx + headR * 0.7, hy - headR * 0.5, hx + headR * 0.6, hy - headR * 1.05, hx + headR * 0.3, hy - headR * 0.8, inner);
    } else if (a === 'rabbit') {
      var flop = Math.sin(t * 5) * 0.08;
      ctx.save(); ctx.translate(hx - headR * 0.38, hy - headR * 0.75); ctx.rotate(-0.18 + flop);
      ellipse(ctx, 0, -headR * 0.6, headR * 0.24, headR * 0.7); ctx.fill();
      ctx.fillStyle = '#ffc2d6'; ellipse(ctx, 0, -headR * 0.6, headR * 0.12, headR * 0.5); ctx.fill(); ctx.restore();
      ctx.fillStyle = sk.fur;
      ctx.save(); ctx.translate(hx + headR * 0.38, hy - headR * 0.75); ctx.rotate(0.18 - flop);
      ellipse(ctx, 0, -headR * 0.6, headR * 0.24, headR * 0.7); ctx.fill();
      ctx.fillStyle = '#ffc2d6'; ellipse(ctx, 0, -headR * 0.6, headR * 0.12, headR * 0.5); ctx.fill(); ctx.restore();
    } else if (a === 'chick') {
      ctx.fillStyle = '#f2a01a';
      tri(ctx, hx - headR * 0.15, hy - headR * 0.9, hx, hy - headR * 1.35, hx + headR * 0.15, hy - headR * 0.9, '#f2a01a');
      tri(ctx, hx + headR * 0.05, hy - headR * 0.9, hx + headR * 0.3, hy - headR * 1.25, hx + headR * 0.3, hy - headR * 0.85, '#f2a01a');
    }

    /* 頭 */
    var hg = ctx.createRadialGradient(hx - headR * 0.35, hy - headR * 0.4, headR * 0.1, hx, hy, headR * 1.05);
    hg.addColorStop(0, shade(toHex(sk.fur), 0.28)); hg.addColorStop(1, sk.fur);
    ctx.fillStyle = hg;
    if (a === 'frog') { ellipse(ctx, hx, hy, headR * 1.1, headR * 0.88); ctx.fill(); }
    else { circle(ctx, hx, hy, headR); ctx.fill(); }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = s * 0.012; ctx.stroke();

    /* 臉部底色 */
    if (a === 'penguin') { ctx.fillStyle = sk.belly; ellipse(ctx, hx, hy + headR * 0.15, headR * 0.72, headR * 0.68); ctx.fill(); }
    if (a === 'fox') { ctx.fillStyle = sk.belly; ellipse(ctx, hx, hy + headR * 0.35, headR * 0.62, headR * 0.45); ctx.fill(); }
    if (a === 'bear') { ctx.fillStyle = sk.belly; ellipse(ctx, hx, hy + headR * 0.35, headR * 0.42, headR * 0.32); ctx.fill(); }
    if (a === 'frog') {
      /* 青蛙的大眼睛凸在頭上 */
      ctx.fillStyle = sk.fur;
      circle(ctx, hx - headR * 0.5, hy - headR * 0.62, headR * 0.36); ctx.fill();
      circle(ctx, hx + headR * 0.5, hy - headR * 0.62, headR * 0.36); ctx.fill();
      ctx.fillStyle = '#fff';
      circle(ctx, hx - headR * 0.5, hy - headR * 0.62, headR * 0.26); ctx.fill();
      circle(ctx, hx + headR * 0.5, hy - headR * 0.62, headR * 0.26); ctx.fill();
    }

    face(ctx, a, hx, hy, headR, mood, t);
    ctx.restore();
  }

  function toHex(c) { return c.charAt(0) === '#' ? c : '#888888'; }

  function tri(ctx, x1, y1, x2, y2, x3, y3, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
  }

  /* ---------- 表情：happy / ouch / dizzy / shock / panic ---------- */
  function face(ctx, a, hx, hy, R, mood, t) {
    var ink = '#24202b';
    var eyY = a === 'frog' ? hy - R * 0.62 : hy - R * 0.08;
    var eyX = a === 'frog' ? R * 0.5 : R * 0.38;
    ctx.save();
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = R * 0.11; ctx.lineCap = 'round';
    if (mood === 'happy') {
      var blink = (Math.floor(t * 0.6 + hx) % 7 === 0) && (t * 0.6 % 1) < 0.12;
      [-1, 1].forEach(function (k) {
        if (blink) { ctx.beginPath(); ctx.moveTo(hx + k * eyX - R * 0.1, eyY); ctx.lineTo(hx + k * eyX + R * 0.1, eyY); ctx.stroke(); }
        else {
          circle(ctx, hx + k * eyX, eyY, R * 0.12); ctx.fill();
          ctx.fillStyle = '#fff'; circle(ctx, hx + k * eyX + R * 0.04, eyY - R * 0.05, R * 0.045); ctx.fill(); ctx.fillStyle = ink;
        }
      });
    } else if (mood === 'ouch') {
      [-1, 1].forEach(function (k) {
        ctx.beginPath(); ctx.moveTo(hx + k * eyX - R * 0.12 * k, eyY - R * 0.1); ctx.lineTo(hx + k * eyX + R * 0.08 * k, eyY); ctx.lineTo(hx + k * eyX - R * 0.12 * k, eyY + R * 0.1); ctx.stroke();
      });
    } else if (mood === 'dizzy') {
      [-1, 1].forEach(function (k) {
        ctx.beginPath();
        for (var i = 0; i < 18; i++) { var aa = i * 0.7 + t * 10 * k, rr2 = R * 0.015 * i; ctx.lineTo(hx + k * eyX + Math.cos(aa) * rr2, eyY + Math.sin(aa) * rr2); }
        ctx.lineWidth = R * 0.06; ctx.stroke();
      });
    } else { /* shock / panic */
      [-1, 1].forEach(function (k) {
        ctx.fillStyle = '#fff'; circle(ctx, hx + k * eyX, eyY, R * 0.17); ctx.fill();
        ctx.lineWidth = R * 0.05; ctx.stroke();
        ctx.fillStyle = ink; circle(ctx, hx + k * eyX + (mood === 'panic' ? Math.sin(t * 30) * R * 0.04 : 0), eyY, R * 0.07); ctx.fill();
      });
    }
    /* 腮紅 */
    if (a !== 'penguin') {
      ctx.fillStyle = 'rgba(255,110,130,0.35)';
      ellipse(ctx, hx - R * 0.58, hy + R * 0.22, R * 0.16, R * 0.1); ctx.fill();
      ellipse(ctx, hx + R * 0.58, hy + R * 0.22, R * 0.16, R * 0.1); ctx.fill();
    }
    /* 鼻子／嘴巴 */
    var my = hy + R * 0.32;
    if (a === 'pig') { ctx.fillStyle = '#f48fb1'; ellipse(ctx, hx, hy + R * 0.25, R * 0.26, R * 0.18); ctx.fill(); ctx.fillStyle = '#b84a72'; circle(ctx, hx - R * 0.09, hy + R * 0.25, R * 0.05); ctx.fill(); circle(ctx, hx + R * 0.09, hy + R * 0.25, R * 0.05); ctx.fill(); my = hy + R * 0.55; }
    else if (a === 'chick' || a === 'penguin') { tri(ctx, hx - R * 0.16, hy + R * 0.15, hx + R * 0.16, hy + R * 0.15, hx, hy + R * 0.38, '#f29a1a'); my = hy + R * 0.55; }
    else if (a !== 'frog') { ctx.fillStyle = ink; ellipse(ctx, hx, hy + R * 0.18, R * 0.1, R * 0.07); ctx.fill(); }
    ctx.strokeStyle = ink; ctx.fillStyle = '#7a2230'; ctx.lineWidth = R * 0.08;
    if (mood === 'happy') { ctx.beginPath(); ctx.arc(hx, my - R * 0.08, R * 0.16, 0.2, Math.PI - 0.2); ctx.stroke(); }
    else if (mood === 'ouch') { ellipse(ctx, hx, my, R * 0.16, R * 0.1); ctx.fill(); }
    else if (mood === 'dizzy') { ctx.beginPath(); for (var w = 0; w <= 4; w++) ctx.lineTo(hx - R * 0.2 + w * R * 0.1, my + (w % 2 ? R * 0.05 : -R * 0.05)); ctx.stroke(); }
    else if (mood === 'shock') { ellipse(ctx, hx, my + R * 0.04, R * 0.11, R * 0.16); ctx.fill(); }
    else { ctx.beginPath(); for (var v = 0; v <= 6; v++) ctx.lineTo(hx - R * 0.24 + v * R * 0.08, my + Math.sin(v * 2 + t * 30) * R * 0.05); ctx.stroke(); }
    /* 驚慌冒汗 */
    if (mood === 'panic' || mood === 'shock') {
      ctx.fillStyle = 'rgba(120,200,255,0.9)';
      var dy2 = (t * 2) % 1;
      ellipse(ctx, hx + R * 0.95, hy - R * 0.4 + dy2 * R * 0.5, R * 0.1, R * 0.15); ctx.fill();
    }
    ctx.restore();
  }

  /* 木頭靶車：沒有駕駛，放一個靶心 */
  function drawDummy(ctx, x, y, s, t, mood) {
    var cy = y - s * 0.2;
    ctx.fillStyle = '#8a6232'; rr(ctx, x - s * 0.03, cy, s * 0.06, s * 0.2, s * 0.02); ctx.fill();
    var cols = ['#e8423f', '#fff4e0', '#e8423f', '#fff4e0'];
    for (var i = 0; i < 4; i++) { ctx.fillStyle = cols[i]; circle(ctx, x, cy - s * 0.08, s * (0.2 - i * 0.05)); ctx.fill(); }
    ctx.strokeStyle = '#6b4a22'; ctx.lineWidth = s * 0.02; circle(ctx, x, cy - s * 0.08, s * 0.2); ctx.stroke();
  }

  /* ---------- 道具圖示 ---------- */
  function drawItemIcon(ctx, type, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var c = ITEM_COLORS[type] || ['#888', '#ccc'];
    if (type === 'super') {
      /* 火焰箭頭 */
      ctx.fillStyle = c[1];
      ctx.beginPath(); ctx.moveTo(-s * 0.4, s * 0.3); ctx.quadraticCurveTo(-s * 0.2, -s * 0.1, s * 0.05, -s * 0.42); ctx.quadraticCurveTo(0, -s * 0.05, s * 0.4, -s * 0.1); ctx.quadraticCurveTo(s * 0.1, s * 0.15, -s * 0.4, s * 0.3); ctx.fill();
      ctx.fillStyle = c[0];
      ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.24); ctx.quadraticCurveTo(-s * 0.1, 0, s * 0.03, -s * 0.25); ctx.quadraticCurveTo(0, 0, s * 0.25, -s * 0.05); ctx.quadraticCurveTo(0, s * 0.12, -s * 0.3, s * 0.24); ctx.fill();
    } else if (type === 'iron') {
      ctx.fillStyle = '#4b5263';
      ctx.beginPath(); ctx.moveTo(-s * 0.38, s * 0.3); ctx.lineTo(-s * 0.24, -s * 0.18); ctx.lineTo(s * 0.24, -s * 0.18); ctx.lineTo(s * 0.38, s * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.22); ctx.lineTo(-s * 0.2, -s * 0.1); ctx.lineTo(s * 0.2, -s * 0.1); ctx.lineTo(s * 0.3, s * 0.22); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#4b5263'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.arc(0, -s * 0.22, s * 0.12, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#4b5263'; ctx.font = '900 ' + Math.round(s * 0.26) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('3t', 0, s * 0.08);
    } else if (type === 'banana') {
      ctx.fillStyle = c[0]; ctx.strokeStyle = '#a77d10'; ctx.lineWidth = s * 0.04;
      ctx.beginPath(); ctx.moveTo(-s * 0.38, -s * 0.1); ctx.quadraticCurveTo(-s * 0.1, s * 0.45, s * 0.38, -s * 0.22); ctx.quadraticCurveTo(0, s * 0.2, -s * 0.38, -s * 0.1); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c[1]; circle(ctx, s * 0.38, -s * 0.22, s * 0.05); ctx.fill();
      ctx.fillStyle = '#fff3a6'; ctx.beginPath(); ctx.moveTo(-s * 0.1, s * 0.08); ctx.lineTo(-s * 0.32, s * 0.32); ctx.lineTo(-s * 0.02, s * 0.18); ctx.fill();
    } else if (type === 'magnet') {
      ctx.lineWidth = s * 0.2; ctx.strokeStyle = c[0];
      ctx.beginPath(); ctx.arc(0, -s * 0.02, s * 0.24, Math.PI, 0, false); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * 0.24, -s * 0.02); ctx.lineTo(-s * 0.24, s * 0.2); ctx.moveTo(s * 0.24, -s * 0.02); ctx.lineTo(s * 0.24, s * 0.2); ctx.stroke();
      ctx.strokeStyle = c[1]; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-s * 0.24, s * 0.2); ctx.lineTo(-s * 0.24, s * 0.36); ctx.moveTo(s * 0.24, s * 0.2); ctx.lineTo(s * 0.24, s * 0.36); ctx.stroke();
    } else if (type === 'shield') {
      ctx.fillStyle = c[0];
      ctx.beginPath(); ctx.moveTo(0, -s * 0.4); ctx.lineTo(s * 0.34, -s * 0.26); ctx.quadraticCurveTo(s * 0.32, s * 0.2, 0, s * 0.4); ctx.quadraticCurveTo(-s * 0.32, s * 0.2, -s * 0.34, -s * 0.26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c[1];
      ctx.beginPath(); ctx.moveTo(0, -s * 0.26); ctx.lineTo(s * 0.2, -s * 0.17); ctx.quadraticCurveTo(s * 0.18, s * 0.12, 0, s * 0.25); ctx.closePath(); ctx.fill();
    } else if (type === 'spring') {
      ctx.strokeStyle = c[0]; ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      for (var i = 0; i <= 8; i++) ctx.lineTo((i % 2 ? 1 : -1) * s * 0.24, s * 0.3 - i * s * 0.075);
      ctx.stroke();
      ctx.fillStyle = '#4b5263'; rr(ctx, -s * 0.32, s * 0.28, s * 0.64, s * 0.1, s * 0.04); ctx.fill();
      ctx.fillStyle = c[0]; rr(ctx, -s * 0.32, -s * 0.38, s * 0.64, s * 0.1, s * 0.04); ctx.fill();
    } else {
      /* 問號（未知道具箱內容） */
      ctx.fillStyle = '#fff'; ctx.font = '900 ' + Math.round(s * 0.7) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, s * 0.04);
    }
    ctx.restore();
  }

  /** 場上的道具箱：彩色禮物箱＋問號；幽靈丟的帶紫色光 */
  function drawItemBox(ctx, x, y, s, t, ghost) {
    var bob = Math.sin(t * 4 + x) * s * 0.06;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, x, y + s * 0.28, s * 0.3, s * 0.12); ctx.fill();
    ctx.translate(x, y - s * 0.12 + bob);
    if (ghost) {
      var gg = ctx.createRadialGradient(0, 0, s * 0.1, 0, 0, s * 0.6);
      gg.addColorStop(0, 'rgba(190,140,255,0.6)'); gg.addColorStop(1, 'rgba(190,140,255,0)');
      ctx.fillStyle = gg; circle(ctx, 0, 0, s * 0.6); ctx.fill();
    }
    var w = s * 0.5;
    ctx.fillStyle = ghost ? '#6a3fc2' : '#e8423f'; rr(ctx, -w / 2, -w / 2 + s * 0.06, w, w, s * 0.08); ctx.fill();
    ctx.fillStyle = ghost ? '#a77bff' : '#ff7a5c'; rr(ctx, -w / 2, -w / 2, w, w * 0.88, s * 0.08); ctx.fill();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(-s * 0.05, -w / 2, s * 0.1, w * 0.88);
    ctx.fillStyle = '#fff'; ctx.font = '900 ' + Math.round(s * 0.34) + 'px "Baloo 2", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = s * 0.05; ctx.strokeText('?', 0, -s * 0.02); ctx.fillText('?', 0, -s * 0.02);
    ctx.restore();
  }

  function drawBanana(ctx, x, y, s, t, life) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, life * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ellipse(ctx, x, y + s * 0.06, s * 0.28, s * 0.1); ctx.fill();
    ctx.translate(x, y); ctx.rotate(0.4);
    ctx.fillStyle = '#f7d038'; ctx.strokeStyle = '#a77d10'; ctx.lineWidth = s * 0.03;
    for (var i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * 2.1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.18, -s * 0.06, s * 0.3, s * 0.06); ctx.quadraticCurveTo(s * 0.14, s * 0.06, 0, 0); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#8a6a12'; circle(ctx, 0, 0, s * 0.05); ctx.fill();
    ctx.restore();
  }

  /* ---------- 擂台主題 ---------- */
  var THEMES = [
    { id: 'park',    floor: ['#ffcf4d', '#ff8a3d'], pat: 'rays',    rim: '#d6336c', bulb: '#fff3b0', below: 'water',  belowC: ['#2a7fd4', '#58b6f0'], bg: '#1b5fa8', decor: 'balloons' },
    { id: 'ice',     floor: ['#e8f7ff', '#b8e3f7'], pat: 'hex',     rim: '#3a8fd1', bulb: '#d9f6ff', below: 'water',  belowC: ['#123c6b', '#2a6aa8'], bg: '#0e2c52', decor: 'snow' },
    { id: 'beach',   floor: ['#ffe2a8', '#f7c97a'], pat: 'dots',    rim: '#1aa3a3', bulb: '#fffbe0', below: 'water',  belowC: ['#14a8c9', '#5fe0e8'], bg: '#0d8fb0', decor: 'shells' },
    { id: 'candy',   floor: ['#ffd1e6', '#ffffff'], pat: 'swirl',   rim: '#e0479e', bulb: '#ffe6f4', below: 'candy',  belowC: ['#ff9ccf', '#ffd9ec'], bg: '#ff7ab8', decor: 'candies' },
    { id: 'volcano', floor: ['#5a4a48', '#3e3230'], pat: 'cracks',  rim: '#ff6a2b', bulb: '#ffc46b', below: 'lava',   belowC: ['#d93a12', '#ff9a2b'], bg: '#3a0f08', decor: 'rocks' },
    { id: 'space',   floor: ['#3b3f7a', '#262a5a'], pat: 'rings',   rim: '#7d5cff', bulb: '#b9f3ff', below: 'stars',  belowC: ['#0a0b24', '#1a1c4a'], bg: '#07081c', decor: 'planets' },
    { id: 'forest',  floor: ['#9bd56a', '#6fb04a'], pat: 'checker', rim: '#8a5a2b', bulb: '#fff7c2', below: 'forest', belowC: ['#1f5e34', '#2f8a4a'], bg: '#174a28', decor: 'trees' },
    { id: 'sea',     floor: ['#7fe0d4', '#46b8b0'], pat: 'waves',   rim: '#f2a93b', bulb: '#fffbd6', below: 'deep',   belowC: ['#0b3a63', '#14608f'], bg: '#082a4a', decor: 'bubbles' },
    { id: 'market',  floor: ['#d9473f', '#f2ede4'], pat: 'tiles',   rim: '#1f1f2e', bulb: '#ffd36b', below: 'city',   belowC: ['#1b1638', '#2e2556'], bg: '#120f26', decor: 'lanterns' },
    { id: 'castle',  floor: ['#f3f0ff', '#d6ccff'], pat: 'stars',   rim: '#c49a2c', bulb: '#fff6c9', below: 'clouds', belowC: ['#8ec5ff', '#d9ecff'], bg: '#6aaef5', decor: 'flags' }
  ];
  var POOLS = {
    floor: THEMES.map(function (t) { return t.floor; }),
    pat: ['rays', 'hex', 'dots', 'swirl', 'cracks', 'rings', 'checker', 'waves', 'tiles', 'stars'],
    rim: THEMES.map(function (t) { return [t.rim, t.bulb]; }),
    below: THEMES.map(function (t) { return [t.below, t.belowC, t.bg]; }),
    decor: ['balloons', 'snow', 'shells', 'candies', 'rocks', 'planets', 'trees', 'bubbles', 'lanterns', 'flags']
  };

  function seededRng(seed) {
    var h = 2166136261, str = String(seed);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    var a = h | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** theme：0～9 是手設主題；'random' 用種子混搭（同一種子大家看到一樣） */
  function resolveTheme(theme, seed) {
    if (theme !== 'random' && THEMES[theme]) return Object.assign({ key: THEMES[theme].id, mixed: false }, THEMES[theme]);
    var r = seededRng('theme:' + seed);
    var pick = function (arr) { return arr[Math.floor(r() * arr.length) % arr.length]; };
    var fl = pick(POOLS.floor), rim = pick(POOLS.rim), bl = pick(POOLS.below);
    return { id: 'mix', key: 'mix', mixed: true, floor: fl, pat: pick(POOLS.pat), rim: rim[0], bulb: rim[1], below: bl[0], belowC: bl[1], bg: bl[2], decor: pick(POOLS.decor) };
  }

  function floorPattern(ctx, th, R, t) {
    var c2 = th.floor[1], i;
    ctx.save();
    ctx.fillStyle = c2; ctx.strokeStyle = c2;
    if (th.pat === 'rays') {
      for (i = 0; i < 16; i += 2) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i / 16 * Math.PI * 2, (i + 1) / 16 * Math.PI * 2); ctx.closePath(); ctx.fill(); }
    } else if (th.pat === 'rings' || th.pat === 'swirl') {
      ctx.lineWidth = R * 0.07;
      for (i = 1; i < 7; i++) { ctx.beginPath(); if (th.pat === 'swirl') ctx.arc(0, 0, R * i / 7, i, i + 4.2); else ctx.arc(0, 0, R * i / 7, 0, Math.PI * 2); ctx.stroke(); }
    } else if (th.pat === 'checker' || th.pat === 'tiles') {
      var n = th.pat === 'tiles' ? 10 : 8, sz = R * 2 / n;
      for (var x = 0; x < n; x++) for (var y = 0; y < n; y++) if ((x + y) & 1) ctx.fillRect(-R + x * sz, -R + y * sz, sz, sz);
    } else if (th.pat === 'dots' || th.pat === 'stars') {
      var step = R / 5;
      for (var px = -R; px <= R; px += step) for (var py = -R; py <= R; py += step) {
        var ox = ((Math.round(py / step)) & 1) ? step / 2 : 0;
        if (th.pat === 'stars') star(ctx, px + ox, py, step * 0.22, c2); else { circle(ctx, px + ox, py, step * 0.16); ctx.fill(); }
      }
    } else if (th.pat === 'hex') {
      ctx.lineWidth = R * 0.015; var hs = R / 6;
      for (var hx = -R; hx <= R; hx += hs * 1.5) for (var hy = -R; hy <= R; hy += hs * 1.73) {
        var oy = (Math.round((hx + R) / (hs * 1.5)) & 1) ? hs * 0.866 : 0;
        ctx.beginPath(); for (var k = 0; k < 6; k++) ctx.lineTo(hx + Math.cos(k * Math.PI / 3) * hs * 0.9, hy + oy + Math.sin(k * Math.PI / 3) * hs * 0.9); ctx.closePath(); ctx.stroke();
      }
    } else if (th.pat === 'waves') {
      ctx.lineWidth = R * 0.04;
      for (var wy = -R; wy <= R; wy += R / 5) { ctx.beginPath(); for (var wx = -R; wx <= R; wx += R / 20) ctx.lineTo(wx, wy + Math.sin(wx / R * 8) * R * 0.04); ctx.stroke(); }
    } else if (th.pat === 'cracks') {
      ctx.lineWidth = R * 0.012; ctx.strokeStyle = 'rgba(255,120,40,0.55)';
      var rnd = seededRng('cracks');
      for (i = 0; i < 14; i++) { ctx.beginPath(); var a = rnd() * 6.28, d = rnd() * R; ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d); for (var j = 0; j < 4; j++) { a += (rnd() - 0.5) * 1.2; d += R * 0.12; ctx.lineTo(Math.cos(a) * d * 0.9, Math.sin(a) * d * 0.9); } ctx.stroke(); }
    }
    ctx.restore();
  }

  /** 懸崖下方背景（畫滿整個畫布）。cx,cy：擂台中心；u：每單位像素 */
  function drawBelow(ctx, th, w, h, cx, cy, u, t, reduce) {
    var g = ctx.createRadialGradient(cx, cy, u * 2, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, th.belowC[1]); g.addColorStop(1, th.belowC[0]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var tt = reduce ? 0 : t, i;
    var rnd = seededRng('below:' + th.below);
    ctx.save();
    if (th.below === 'water' || th.below === 'deep') {
      ctx.strokeStyle = 'rgba(255,255,255,' + (th.below === 'deep' ? 0.08 : 0.16) + ')'; ctx.lineWidth = Math.max(1, u * 0.06);
      for (i = 0; i < 26; i++) {
        var x = rnd() * w, y = rnd() * h, l = u * (0.6 + rnd());
        ctx.beginPath(); ctx.moveTo(x + Math.sin(tt + i) * u * 0.3, y); ctx.quadraticCurveTo(x + l / 2, y - u * 0.15, x + l + Math.sin(tt + i) * u * 0.3, y); ctx.stroke();
      }
      if (th.below === 'deep') {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        for (i = 0; i < 18; i++) { var bx = rnd() * w, by = (rnd() * h - tt * u * 0.8 * (0.5 + rnd())) % h; circle(ctx, bx, by < 0 ? by + h : by, u * (0.06 + rnd() * 0.1)); ctx.fill(); }
      }
    } else if (th.below === 'lava') {
      for (i = 0; i < 22; i++) {
        var lx = rnd() * w, ly = rnd() * h, lr = u * (0.3 + rnd() * 0.8) * (1 + Math.sin(tt * 2 + i) * 0.15);
        ctx.fillStyle = 'rgba(255,' + Math.round(160 + rnd() * 80) + ',60,0.35)'; circle(ctx, lx, ly, lr); ctx.fill();
      }
    } else if (th.below === 'stars') {
      for (i = 0; i < 90; i++) { var sx = rnd() * w, sy = rnd() * h, tw = 0.4 + 0.6 * Math.abs(Math.sin(tt * 1.5 + i)); ctx.fillStyle = 'rgba(255,255,255,' + tw + ')'; circle(ctx, sx, sy, u * 0.04 * (1 + rnd())); ctx.fill(); }
    } else if (th.below === 'clouds' || th.below === 'candy') {
      ctx.fillStyle = th.below === 'candy' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.7)';
      for (i = 0; i < 14; i++) {
        var cx2 = ((rnd() * w + tt * u * 0.3 * (0.5 + rnd())) % (w + u * 4)) - u * 2, cy2 = rnd() * h, cs = u * (0.5 + rnd() * 0.8);
        circle(ctx, cx2, cy2, cs); ctx.fill(); circle(ctx, cx2 + cs, cy2 + cs * 0.2, cs * 0.8); ctx.fill(); circle(ctx, cx2 - cs, cy2 + cs * 0.25, cs * 0.7); ctx.fill();
      }
    } else if (th.below === 'forest') {
      for (i = 0; i < 40; i++) { var fx = rnd() * w, fy = rnd() * h, fs = u * (0.5 + rnd() * 0.6); ctx.fillStyle = 'rgba(' + (20 + rnd() * 30 | 0) + ',' + (90 + rnd() * 60 | 0) + ',50,0.8)'; circle(ctx, fx, fy, fs); ctx.fill(); }
    } else if (th.below === 'city') {
      for (i = 0; i < 70; i++) { var wx = rnd() * w, wy = rnd() * h; ctx.fillStyle = 'rgba(255,' + (190 + rnd() * 60 | 0) + ',90,' + (0.25 + 0.5 * Math.abs(Math.sin(tt + i))) + ')'; ctx.fillRect(wx, wy, u * 0.12, u * 0.16); }
    }
    ctx.restore();
  }

  /** 外圈裝飾（在擂台外、懸崖下方之上） */
  function drawDecor(ctx, th, cx, cy, u, R0, t, reduce) {
    var rnd = seededRng('decor:' + th.decor + th.key);
    var tt = reduce ? 0 : t;
    var n = 10;
    ctx.save();
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + rnd() * 0.3, d = (R0 + 2.6 + rnd() * 1.2) * u;
      var x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + Math.sin(tt * 1.5 + i) * u * 0.08;
      var s = u * (0.35 + rnd() * 0.2);
      var col = ['#ff6b6b', '#ffd23f', '#4dd0e1', '#9c7bff', '#6bdc8b'][i % 5];
      switch (th.decor) {
        case 'balloons':
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x, y + s * 2.2); ctx.stroke();
          ctx.fillStyle = col; ellipse(ctx, x, y, s * 0.8, s); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ellipse(ctx, x - s * 0.3, y - s * 0.35, s * 0.18, s * 0.28); ctx.fill(); break;
        case 'snow': star(ctx, x, y, s * 0.6, 'rgba(255,255,255,0.85)'); break;
        case 'shells': ctx.fillStyle = '#ffd7c2'; ctx.beginPath(); ctx.arc(x, y, s * 0.7, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#e8a283'; ctx.lineWidth = 1.5; for (var k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + k * s * 0.3, y - s * 0.6); ctx.stroke(); } break;
        case 'candies': ctx.fillStyle = col; circle(ctx, x, y, s * 0.5); ctx.fill(); tri(ctx, x - s * 0.5, y, x - s, y - s * 0.35, x - s, y + s * 0.35, col); tri(ctx, x + s * 0.5, y, x + s, y - s * 0.35, x + s, y + s * 0.35, col); break;
        case 'rocks': ctx.fillStyle = '#4a3a36'; ellipse(ctx, x, y, s * 0.9, s * 0.6); ctx.fill(); ctx.fillStyle = 'rgba(255,120,40,0.6)'; ellipse(ctx, x, y + s * 0.2, s * 0.5, s * 0.15); ctx.fill(); break;
        case 'planets': ctx.fillStyle = col; circle(ctx, x, y, s * 0.6); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ellipse(ctx, x, y, s * 1.1, s * 0.3, -0.4); ctx.stroke(); break;
        case 'trees': ctx.fillStyle = '#6b4423'; ctx.fillRect(x - s * 0.1, y, s * 0.2, s * 0.6); tri(ctx, x - s * 0.7, y + s * 0.1, x, y - s * 1.1, x + s * 0.7, y + s * 0.1, '#2f9e4f'); break;
        case 'bubbles': ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; circle(ctx, x, y, s * 0.5); ctx.stroke(); circle(ctx, x + s * 0.6, y - s * 0.6, s * 0.25); ctx.stroke(); break;
        case 'lanterns': ctx.fillStyle = '#e8423f'; ellipse(ctx, x, y, s * 0.6, s * 0.75); ctx.fill(); ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - s * 0.35, y - s * 0.8, s * 0.7, s * 0.12); ctx.fillRect(x - s * 0.35, y + s * 0.68, s * 0.7, s * 0.12); ctx.fillStyle = 'rgba(255,220,120,0.35)'; circle(ctx, x, y, s * 1.2); ctx.fill(); break;
        case 'flags': ctx.strokeStyle = '#c49a2c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x, y - s); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * (0.9 + Math.sin(tt * 4 + i) * 0.1), y - s * 0.7); ctx.lineTo(x, y - s * 0.4); ctx.fill(); break;
      }
    }
    ctx.restore();
  }

  /** 擂台：厚度、地板花紋、邊緣燈泡、縮圈警示紅線 */
  function drawArena(ctx, th, cx, cy, u, r, r0, t, opt) {
    opt = opt || {};
    var R = r * u, thick = u * 0.55;
    ctx.save();
    /* 縮掉的區域：殘留的淡淡輪廓 */
    if (r < r0 - 0.01) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([u * 0.2, u * 0.25]); ctx.lineWidth = Math.max(1, u * 0.05);
      circle(ctx, cx, cy, r0 * u); ctx.stroke(); ctx.setLineDash([]);
    }
    /* 側面厚度 */
    var sideG = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    sideG.addColorStop(0, shade(th.rim, -0.45)); sideG.addColorStop(0.5, shade(th.rim, -0.15)); sideG.addColorStop(1, shade(th.rim, -0.5));
    ctx.fillStyle = sideG;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI); ctx.lineTo(cx - R, cy + thick); ctx.arc(cx, cy + thick, R, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(ctx, cx, cy + thick + u * 0.25, R * 1.02, R * 1.0); ctx.globalCompositeOperation = 'destination-over'; ctx.fill(); ctx.globalCompositeOperation = 'source-over';
    /* 地板 */
    ctx.save();
    circle(ctx, cx, cy, R); ctx.clip();
    ctx.translate(cx, cy);
    ctx.fillStyle = th.floor[0]; ctx.fillRect(-R, -R, R * 2, R * 2);
    floorPattern(ctx, th, R, t);
    var gl = ctx.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.05, 0, 0, R * 1.1);
    gl.addColorStop(0, 'rgba(255,255,255,0.32)'); gl.addColorStop(0.6, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = gl; ctx.fillRect(-R, -R, R * 2, R * 2);
    /* 中心標記 */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, u * 0.06);
    circle(ctx, 0, 0, Math.min(R * 0.25, u * 1.6)); ctx.stroke();
    ctx.restore();
    /* 邊框 */
    ctx.lineWidth = Math.max(2, u * 0.22); ctx.strokeStyle = th.rim;
    circle(ctx, cx, cy, R - ctx.lineWidth / 2); ctx.stroke();
    /* 縮圈中：閃紅線 */
    if (opt.shrinking) {
      var blink = opt.reduce ? 0.7 : (0.45 + 0.55 * Math.abs(Math.sin(t * (opt.fast ? 9 : 5))));
      ctx.strokeStyle = 'rgba(255,40,60,' + blink + ')'; ctx.lineWidth = Math.max(2, u * 0.12);
      circle(ctx, cx, cy, R - Math.max(2, u * 0.22) * 0.5); ctx.stroke();
    }
    /* 燈泡 */
    var nb = Math.max(10, Math.round(r * 4));
    for (var i = 0; i < nb; i++) {
      var a = i / nb * Math.PI * 2;
      var on = opt.reduce ? true : ((i + Math.floor(t * 6)) % 3 !== 0);
      var bx = cx + Math.cos(a) * (R - u * 0.11), by = cy + Math.sin(a) * (R - u * 0.11);
      if (on) { ctx.fillStyle = 'rgba(255,240,180,0.35)'; circle(ctx, bx, by, u * 0.17); ctx.fill(); }
      ctx.fillStyle = on ? th.bulb : shade(th.rim, -0.3); circle(ctx, bx, by, u * 0.075); ctx.fill();
    }
    ctx.restore();
  }

  root.BumperArt = {
    CARS: CARS, DUMMY: DUMMY, THEMES: THEMES, ITEM_COLORS: ITEM_COLORS,
    skinOf: skinOf, drawCar: drawCar, drawItemIcon: drawItemIcon, drawItemBox: drawItemBox, drawBanana: drawBanana,
    resolveTheme: resolveTheme, drawBelow: drawBelow, drawDecor: drawDecor, drawArena: drawArena,
    star: star, circle: circle, ellipse: ellipse, rr: rr, shade: shade, seededRng: seededRng
  };
}(typeof window !== 'undefined' ? window : this));
