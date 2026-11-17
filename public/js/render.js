/* ===== render.js — 對局畫面繪製（Canvas 2D，DPR 感知） ===== */
(function (root) {
  'use strict';
  var Art = root.BumperArt;

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.theme = Art.resolveTheme(0, 'x');
    this.parts = [];
    this.texts = [];
    this.shake = 0;
    this.opts = { colorBlind: false, reduce: false, shake: true, names: true };
    this.labels = {};
    this.lastT = 0;
    this.bg = null; this.bgKey = '';
  }

  Renderer.prototype.resize = function () {
    var r = this.cv.getBoundingClientRect();
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.bgKey = '';
    }
  };

  Renderer.prototype.setTheme = function (theme, seed) {
    this.theme = Art.resolveTheme(theme, seed);
    this.bgKey = '';
  };

  /** 擂台依螢幕短邊縮放、置中放到最大 */
  /** viewR：鏡頭要框住的半徑（擂台縮小時鏡頭跟著拉近） */
  Renderer.prototype.layout = function (viewR) {
    var pad = 1.75;   // 幽靈外圈＋厚度
    /* insets：上方狀態列與下方觸控鍵佔掉的高度（直向手機時由 app 提供），擂台放在中間那塊空間，不被手指擋住 */
    var it = this.insets || { top: 0, bottom: 0 };
    var top = it.top, avail = this.h - it.top - it.bottom;
    if (avail < this.h * 0.45) { top = 0; avail = this.h; }   // 空間太小就退回全畫面
    var u = Math.min(this.w / (2 * (viewR + pad)), avail / (2 * (viewR + pad) + 0.6));
    return { u: u, cx: this.w / 2, cy: top + avail / 2 - u * 0.25 };
  };
  /** 設定上下保留區（CSS px）；直向時讓擂台避開 HUD 與觸控鍵 */
  Renderer.prototype.setInsets = function (top, bottom) {
    this.insets = { top: Math.max(0, top || 0), bottom: Math.max(0, bottom || 0) };
  };

  /* ---------- 粒子 ---------- */
  Renderer.prototype.burst = function (x, y, n, power, colors) {
    if (this.opts.reduce) n = Math.ceil(n / 3);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 3) * (0.6 + power * 0.12);
      this.parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, max: 0.9, kind: 'star', size: 0.14 + Math.random() * 0.14, color: colors[i % colors.length], rot: Math.random() * 6 });
    }
  };
  Renderer.prototype.popText = function (x, y, text, color, big) {
    if (this.opts.texts === false) return;   // 首頁背景示範：不跳字，避免跟標題、選單文字疊在一起
    this.texts.push({ x: x, y: y, text: text, color: color || '#fff', life: big ? 1.2 : 0.8, max: big ? 1.2 : 0.8, big: !!big });
  };

  /** 依規則事件產生特效（每步的事件都要丟進來） */
  Renderer.prototype.onEvents = function (events, state, myId) {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.type === 'hit') {
        var p = Math.min(14, e.power || 1);
        if (p > 1.2) this.burst(e.x, e.y, 6 + Math.round(p), p, ['#fff36b', '#ffffff', '#ffb13b']);
        if (p > 3) { this.popText(e.x, e.y - 0.6, this.labels.bonk || 'BONK!', '#fff36b', p > 8); if (this.opts.shake) this.shake = Math.max(this.shake, Math.min(1, p / 12) * ((e.a === myId || e.b === myId) ? 1 : 0.5)); }
      } else if (e.type === 'clash') {
        this.burst(e.x, e.y, 18, 8, ['#7ee8ff', '#ffffff', '#ffe36b']);
        this.popText(e.x, e.y - 0.6, this.labels.clash || 'CLASH!', '#7ee8ff', true);
        if (this.opts.shake) this.shake = Math.max(this.shake, 0.7);
      } else if (e.type === 'shieldBlock') {
        this.burst(e.x, e.y, 12, 5, ['#9fe0ff', '#ffffff']);
      } else if (e.type === 'superHit') {
        this.burst(e.x, e.y, 20, 10, ['#ff5a36', '#ffd23f', '#fff']);
        if (this.opts.shake) this.shake = 1;
      } else if (e.type === 'fall') {
        this.popText(e.x, e.y - 0.5, this.labels.whoosh || 'WHOOSH', '#ffffff', false);
      } else if (e.type === 'pickup') {
        this.burst(e.x, e.y, 8, 2, ['#ffd23f', '#ff7a5c', '#fff']);
      } else if (e.type === 'rescue') {
        this.popText(e.x, e.y - 0.6, this.labels.saved || 'SAVED!', '#8fffa3', false);
      } else if (e.type === 'land') {
        this.burst(e.x, e.y, 10, 2, ['#c8f5c8', '#ffffff']);
      } else if (e.type === 'ghostDrop') {
        this.parts.push({ kind: 'drop', x: e.fromX, y: e.fromY, tx: e.x, ty: e.y, life: 0.5, max: 0.5 });
      } else if (e.type === 'slip') {
        this.burst(e.x, e.y, 6, 2, ['#f7d038', '#fff']);
      }
    }
  };

  /* ---------- 主繪製 ---------- */
  Renderer.prototype.draw = function (s, view) {
    var ctx = this.ctx, dt = Math.min(0.05, Math.max(0, (view.now - (this.lastNow || view.now)) / 1000));
    this.lastNow = view.now;
    var t = view.now / 1000;
    this.resize();
    var target = Math.min(s.arena.r0, Math.max(s.arena.r + 1.2, s.arena.r0 * 0.5));
    if (!this.viewR || Math.abs(this.viewR - target) > 3) this.viewR = target;
    this.viewR += (target - this.viewR) * Math.min(1, dt * 2);
    var L = this.layout(this.viewR), u = L.u;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* 震動 */
    var sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * u * 0.5; sy = (Math.random() - 0.5) * this.shake * u * 0.5;
      this.shake = Math.max(0, this.shake - dt * 2.8);
    }
    var cx = L.cx + sx, cy = L.cy + sy;
    var th = this.theme;
    Art.drawBelow(ctx, th, this.w, this.h, cx, cy, u, t, this.opts.reduce);
    Art.drawDecor(ctx, th, cx, cy, u, s.arena.r0, t, this.opts.reduce);

    var shrinking = s.opts.shrink && s.phase === 'playing' && s.t > 10 && s.t < 80;
    var warnSoon = s.opts.shrink && s.phase === 'playing' && s.t > 7 && s.t <= 10;
    Art.drawArena(ctx, th, cx, cy, u, s.arena.r, s.arena.r0, t, { shrinking: shrinking || warnSoon, fast: s.t > 60, reduce: this.opts.reduce });

    var W = function (x) { return cx + x * u; }, H = function (y) { return cy + y * u; };

    /* 香蕉、道具 */
    for (var b = 0; b < s.bananas.length; b++) Art.drawBanana(ctx, W(s.bananas[b].x), H(s.bananas[b].y), u, t, s.bananas[b].t);
    for (var k = 0; k < s.items.length; k++) Art.drawItemBox(ctx, W(s.items[k].x), H(s.items[k].y), u, t, s.items[k].ghost);

    /* 車子（依 y 排序做前後） */
    var cars = s.cars.slice().sort(function (a, c) { return a.y - c.y; });
    var ghosts = [];
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (!c.alive) { ghosts.push(c); continue; }
      this.drawLiveCar(ctx, c, W(c.x + (c.rx || 0)), H(c.y + (c.ry || 0)), u, t, view, s);
    }
    /* 掉落中與幽靈畫在最上層 */
    for (var g = 0; g < ghosts.length; g++) this.drawGhost(ctx, ghosts[g], cx, cy, u, t, view, s);

    /* 粒子 */
    this.drawParticles(ctx, W, H, u, dt);
  };

  Renderer.prototype.drawLiveCar = function (ctx, c, x, y, u, t, view, s) {
    var mine = c.id === view.myId;
    var ang = c.angle;
    /* 我的車：腳下光圈 */
    if (mine) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(2, u * 0.07);
      ctx.setLineDash([u * 0.18, u * 0.12]); ctx.lineDashOffset = -t * u * 0.8;
      Art.circle(ctx, x, y + u * 0.08, u * 0.66); ctx.stroke();
      ctx.restore();
    }
    /* 隊伍色外框 */
    if (s.opts.teams && !c.dummy) {
      ctx.save(); ctx.strokeStyle = view.teamColors[c.team % view.teamColors.length]; ctx.lineWidth = Math.max(2, u * 0.1);
      Art.circle(ctx, x, y + u * 0.08, u * 0.58); ctx.stroke(); ctx.restore();
    }
    /* 磁鐵波紋 */
    if (c.fx.magnet > 0) {
      ctx.save();
      for (var m = 0; m < 3; m++) {
        var k = ((t * 2 + m / 3) % 1);
        ctx.strokeStyle = 'rgba(255,90,90,' + (1 - k) * 0.6 + ')'; ctx.lineWidth = Math.max(1.5, u * 0.06);
        Art.circle(ctx, x, y, u * (4 - k * 3.4)); ctx.stroke();
      }
      ctx.restore();
    }
    /* 衝刺殘影與火焰 */
    var hx = Math.cos(ang), hy = Math.sin(ang);
    if (c.dash.phase === 'burst') {
      ctx.save();
      for (var j = 1; j <= 3; j++) {
        ctx.globalAlpha = 0.22 / j;
        Art.drawCar(ctx, x - hx * u * 0.35 * j, y - hy * u * 0.35 * j, ang, u, c.skin, { t: t, noShadow: true, colorBlind: this.opts.colorBlind });
      }
      ctx.restore();
      if (c.fx.superDash || (view.superTrail && view.superTrail[c.id])) {
        for (var f = 0; f < 2; f++) this.parts.push({ kind: 'fire', x: c.x - hx * 0.5 + (Math.random() - 0.5) * 0.3, y: c.y - hy * 0.5 + (Math.random() - 0.5) * 0.3, vx: -hx * 2, vy: -hy * 2, life: 0.35, max: 0.35, size: 0.3 });
      }
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1.5, u * 0.05);
      for (var l = -1; l <= 1; l++) {
        var px = -hy * l * u * 0.3, py = hx * l * u * 0.3;
        ctx.beginPath(); ctx.moveTo(x - hx * u * 0.6 + px, y - hy * u * 0.6 + py); ctx.lineTo(x - hx * u * 1.4 + px, y - hy * u * 1.4 + py); ctx.stroke();
      }
      ctx.restore();
    }
    var ox = 0, oy = 0, sc = 1;
    if (c.dash.phase === 'charge') { ox = -hx * u * 0.12; oy = -hy * u * 0.12; sc = 0.94; }
    var lift = 0;
    if (c.fx.spring) { var k2 = Math.min(1, c.fx.spring.t / 0.6); lift = Math.sin(k2 * Math.PI) * u * 2.2; sc = 1 + Math.sin(k2 * Math.PI) * 0.25; }
    /* 搖搖欲墜：黃光 */
    if (c.wobble > 0) {
      ctx.save();
      var blink = 0.4 + 0.6 * Math.abs(Math.sin(t * 22));
      ctx.fillStyle = 'rgba(255,220,40,' + blink * 0.55 + ')';
      Art.circle(ctx, x, y, u * 0.85); ctx.fill();
      ctx.restore();
    }
    Art.drawCar(ctx, x + ox, y + oy, ang, u, c.skin, {
      t: t, mood: c.mood, flash: c.fx.flash > 0.05, wobble: c.wobble > 0, shield: c.fx.shield > 0, iron: c.fx.iron > 0,
      lift: lift, scale: sc, colorBlind: this.opts.colorBlind
    });
    /* 打轉：頭上轉圈的星星 */
    if (c.fx.spin > 0) {
      for (var q = 0; q < 3; q++) {
        var aa = t * 8 + q * 2.1;
        Art.star(ctx, x + Math.cos(aa) * u * 0.35, y - u * 0.75 + Math.sin(aa) * u * 0.12, u * 0.1, '#ffe36b');
      }
    }
    /* 自己的車搖搖欲墜：畫一個指向擂台中心的箭頭，告訴你往哪推 */
    if (c.wobble > 0 && mine) {
      var toC = Math.atan2(-c.y, -c.x);
      var pulseA = 0.75 + 0.25 * Math.sin(t * 16);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(toC);
      var au = Math.max(u, 30);   // 手機上擂台小，箭頭至少要夠大
      ctx.fillStyle = 'rgba(78,224,122,' + pulseA + ')'; ctx.strokeStyle = '#1a3d22'; ctx.lineWidth = Math.max(2, au * 0.05);
      ctx.beginPath();
      ctx.moveTo(u * 0.7, -au * 0.16); ctx.lineTo(u * 0.7 + au * 0.5, -au * 0.16); ctx.lineTo(u * 0.7 + au * 0.5, -au * 0.36);
      ctx.lineTo(u * 0.7 + au, 0); ctx.lineTo(u * 0.7 + au * 0.5, au * 0.36); ctx.lineTo(u * 0.7 + au * 0.5, au * 0.16); ctx.lineTo(u * 0.7, au * 0.16);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    /* 搖搖欲墜：驚嘆號與搶救倒數圈 */
    if (c.wobble > 0) {
      ctx.save();
      var frac = c.wobbleMax ? c.wobble / c.wobbleMax : 0;
      ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = Math.max(2, u * 0.08);
      ctx.beginPath(); ctx.arc(x, y - u * 1.05, u * 0.22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '900 ' + Math.round(u * 0.32) + 'px "Baloo 2", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', x, y - u * 1.04);
      ctx.restore();
    }
    /* 名牌 */
    if (this.opts.names && !c.dummy) {
      var name = view.nameOf ? view.nameOf(c) : c.name;
      ctx.save();
      var fs = Math.max(11, Math.round(u * 0.26));
      ctx.font = '800 ' + fs + 'px "Baloo 2", "Noto Sans TC", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var tw = ctx.measureText(name).width + fs * 0.8;
      var ny = y + u * 0.72 - lift;
      ctx.fillStyle = mine ? 'rgba(255,255,255,0.95)' : 'rgba(20,18,40,0.6)';
      Art.rr(ctx, x - tw / 2, ny - fs * 0.62, tw, fs * 1.24, fs * 0.62); ctx.fill();
      ctx.fillStyle = mine ? '#1d1840' : '#fff';
      ctx.fillText(name, x, ny + 1);
      if (c.item && (mine || view.showItems)) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; Art.circle(ctx, x + tw / 2 + fs * 0.55, ny, fs * 0.6); ctx.fill();
        Art.drawItemIcon(ctx, c.item, x + tw / 2 + fs * 0.55, ny, fs * 0.95);
      }
      ctx.restore();
    }
  };

  Renderer.prototype.drawGhost = function (ctx, c, cx, cy, u, t, view, s) {
    var g = c.ghost;
    if (!g) return;
    if (c.dummy && g.fallT >= 1) return;
    if (g.fallT < 1) {
      /* 掉落：往外滑出、翻轉、縮小沉下去 */
      var k = g.fallT;
      var d = Math.hypot(g.fx, g.fy) || 1;
      var fx = g.fx + g.fx / d * k * 1.2, fy = g.fy + g.fy / d * k * 1.2;
      ctx.save();
      Art.drawCar(ctx, cx + fx * u, cy + fy * u + k * k * u * 1.5, c.angle + k * 6, u, c.skin, { t: t, mood: 'shock', scale: 1 - k * 0.7, alpha: 1 - k * 0.8, noShadow: true, colorBlind: this.opts.colorBlind });
      ctx.restore();
      return;
    }
    if (c.dummy) return;
    /* 幽靈畫在目前擂台外一圈（跟著縮圈靠近，鏡頭拉近時也看得到） */
    var rg = Math.min(s.arena.r0 + 1.4, s.arena.r + 1.5);
    var x = cx + Math.cos(g.theta) * rg * u, y = cy + Math.sin(g.theta) * rg * u + Math.sin(t * 3 + c.skin) * u * 0.1;
    var mine = c.id === view.myId;
    ctx.save();
    ctx.globalAlpha = mine ? 0.75 : 0.5;
    /* 幽靈布：白色半透明、底部波浪 */
    var gw = u * 0.55, gh = u * 0.8;
    ctx.fillStyle = 'rgba(240,240,255,0.95)';
    ctx.beginPath();
    ctx.arc(x, y - gh * 0.25, gw, Math.PI, 0);
    ctx.lineTo(x + gw, y + gh * 0.35);
    for (var i = 0; i <= 4; i++) ctx.lineTo(x + gw - i * gw / 2, y + gh * 0.35 + (i % 2 ? -1 : 1) * u * 0.1 * Math.sin(t * 6 + i));
    ctx.closePath(); ctx.fill();
    var sk = Art.skinOf(c.skin);
    ctx.fillStyle = sk.body; Art.circle(ctx, x, y - gh * 0.25, gw * 0.55); ctx.fill();
    ctx.fillStyle = '#24202b';
    Art.circle(ctx, x - gw * 0.22, y - gh * 0.3, u * 0.06); ctx.fill();
    Art.circle(ctx, x + gw * 0.22, y - gh * 0.3, u * 0.06); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - gh * 0.15, u * 0.08, 0, Math.PI); ctx.fill();
    ctx.restore();
    /* 丟道具冷卻圈（自己的幽靈才顯示；只剩 2 台時變灰） */
    if (mine && s.opts.items) {
      var active = s.phase === 'playing' && view.ghostActive;
      ctx.save();
      ctx.lineWidth = Math.max(2, u * 0.08);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; Art.circle(ctx, x, y - gh * 0.25, gw * 1.2); ctx.stroke();
      ctx.strokeStyle = active ? (g.cd <= 0 ? '#b98cff' : '#ffffff') : '#888';
      ctx.beginPath(); ctx.arc(x, y - gh * 0.25, gw * 1.2, -Math.PI / 2, -Math.PI / 2 + (1 - g.cd / 10) * Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (this.opts.names) {
      var name = view.nameOf ? view.nameOf(c) : c.name;
      ctx.save(); ctx.globalAlpha = 0.75;
      var fs = Math.max(10, Math.round(u * 0.22));
      ctx.font = '700 ' + fs + 'px "Baloo 2", "Noto Sans TC", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(name, x, y + gh * 0.75);
      ctx.restore();
    }
  };

  Renderer.prototype.drawParticles = function (ctx, W, H, u, dt) {
    var keep = [];
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      keep.push(p);
      var k = p.life / p.max;
      if (p.kind === 'star') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.rot += dt * 8;
        ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.5);
        Art.star(ctx, W(p.x), H(p.y), u * p.size * (0.5 + k * 0.5), p.color);
        ctx.restore();
      } else if (p.kind === 'fire') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.save(); ctx.globalAlpha = k;
        ctx.fillStyle = k > 0.5 ? '#ffd23f' : '#ff5a36';
        Art.circle(ctx, W(p.x), H(p.y), u * p.size * k); ctx.fill(); ctx.restore();
      } else if (p.kind === 'drop') {
        var e = 1 - k;
        var x = p.x + (p.tx - p.x) * e, y = p.y + (p.ty - p.y) * e - Math.sin(e * Math.PI) * 2;
        ctx.save(); ctx.globalAlpha = 0.9; Art.drawItemBox(ctx, W(x), H(y), u * 0.8, 0, true); ctx.restore();
      }
    }
    this.parts = keep.length > 400 ? keep.slice(-400) : keep;
    var tk = [];
    for (var j = 0; j < this.texts.length; j++) {
      var tx = this.texts[j];
      tx.life -= dt;
      if (tx.life <= 0) continue;
      tk.push(tx);
      var kk = tx.life / tx.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, kk * 2);
      var fs = Math.round(u * (tx.big ? 0.75 : 0.45) * (1 + (1 - kk) * 0.25));
      ctx.font = '900 ' + fs + 'px "Baloo 2", "Noto Sans TC", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = fs * 0.18; ctx.strokeStyle = '#2a1a4a'; ctx.lineJoin = 'round';
      var yy = H(tx.y) - (1 - kk) * u * 0.6;
      ctx.strokeText(tx.text, W(tx.x), yy); ctx.fillStyle = tx.color; ctx.fillText(tx.text, W(tx.x), yy);
      ctx.restore();
    }
    this.texts = tk;
  };

  Renderer.prototype.clearFx = function () { this.parts = []; this.texts = []; this.shake = 0; this.viewR = 0; };

  root.BumperRenderer = Renderer;
}(typeof window !== 'undefined' ? window : this));
