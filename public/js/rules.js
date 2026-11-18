/* ===== rules.js — 碰碰車大亂鬥 規則與物理核心（瀏覽器與伺服器共用同一份） =====
 *
 * 單位：長度以「車身長」為 1；時間以秒計；物理固定步長 1/60 秒。
 * 所有隨機都走 state.rng（可序列化的 32 位元種子），同一組輸入跑出相同結果。
 *
 * 用法：
 *   const s = Rules.createMatch({ seed, cars:[{id,name,skin,team,level,human}], items:true, sessionLevel:'normal' });
 *   Rules.setInput(s, id, { mx, my, dash, item });   // dash／item 是「按一下」旗標，step 時消耗
 *   Rules.step(s);                                     // 前進 1/60 秒，事件放在 s.events
 *   Rules.result(s) → 名次與統計（phase === 'over' 後）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BumperRules = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DT = 1 / 60;
  var LEVELS = ['kid', 'easy', 'normal', 'hard', 'mythic'];
  var RESCUE = { kid: 1, easy: 0.8, normal: 0.6, hard: 0.4, mythic: 0.25 };
  var ITEM_TYPES = ['super', 'iron', 'banana', 'magnet', 'shield', 'spring'];

  var C = {
    CAR_R: 0.5,
    ACCEL: 15,            // 有輸入時的加速度
    MAX_SPEED: 5,         // 一般最高速
    DRAG_IDLE: 1.5,       // 放開時的摩擦（越小越滑）
    DRAG_MOVE: 0.6,
    TURN_RATE: 9,         // 車頭轉向速度（rad/s）
    DASH_CHARGE: 0.15,
    DASH_BURST: 0.3,
    DASH_CD: 2,
    DASH_MULT: 2.2,       // 爆發速度＝最高速 × 2.2
    DASH_HIT: 1.8,        // 衝刺中撞人力道倍率
    DASH_REACH: 1.15,     // 衝刺中碰撞範圍放大 15%
    RESTITUTION: 0.8,
    TEAM_RESTITUTION: 0.15,
    COUNTDOWN: 3,
    DURATION: 90,
    SHRINK_START: 10,
    SHRINK_END: 80,
    SPAWN_SAFE: 2,        // 開局 2 秒內不會出界
    KO_WINDOW: 3,
    ITEM_EVERY: 8,
    ITEM_MAX: 2,
    ITEM_TOTAL_MAX: 6,
    ITEM_PICK_R: 0.85,
    GHOST_CD: 10,
    GHOST_SPEED: 6,
    IRON_TIME: 6,
    IRON_MASS: 3,
    IRON_SLOW: 0.7,
    SHIELD_TIME: 8,
    BANANA_TIME: 10,
    SPIN_TIME: 1,
    MAGNET_TIME: 0.8,
    MAGNET_R: 4,
    MAGNET_PULL: 20,
    SPRING_TIME: 0.6,
    SUPER_MULT: 2,
    RESCUE_PUSH: 2.0,     // 救回來時往內彈的速度（原 3.2→2.4→2.0：救回後仍在邊緣附近，別人還有機會補撞）
    RESCUE_GRACE: 0.35,
    RESCUE_HOLD: 0.28,    // 要往內「按住」才救得回來（不是一碰方向就自動救回）：搶救時間的 45%，最多這麼久（見 rescueHoldFor）
    RESCUE_IN: 0.6,       // 方向要明確朝內（內向分量 > 0.6）
    RESCUE_TIRE: 0.55,    // 每救回一次，下次的搶救時間 ×0.55（連續救回越來越難）
    RESCUE_RECOVER: 6     // 疲勞每 6 秒恢復一次
  };

  /* ---------- 亂數（mulberry32，狀態是一個整數，可直接序列化） ---------- */
  function rand(s) {
    var a = (s.rng = (s.rng + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hashSeed(seed) {
    var str = String(seed), h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  function len(x, y) { return Math.sqrt(x * x + y * y); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function arenaRadiusFor(count, teams) {
    return (count >= 5 || teams) ? 9 : 7.5;
  }

  /** 縮圈：開局 10 秒後等速縮，80 秒縮到 minRatio 後停住 */
  function radiusAt(s, t) {
    if (!s.opts.shrink) return s.arena.r0;
    var r0 = s.arena.r0, k = (t - C.SHRINK_START) / (C.SHRINK_END - C.SHRINK_START);
    k = clamp(k, 0, 1);
    return r0 * (1 - (1 - s.opts.minRatio) * k);
  }

  function rescueTimeFor(car, s) {
    if (s.opts.mode === 'online' && car.human) return RESCUE.normal;
    if (car.human) return RESCUE[s.opts.sessionLevel] || RESCUE.normal;
    return RESCUE[car.level] || RESCUE.normal;
  }

  /** 要按住多久才救得回來：搶救時間的 45%，最多 0.28 秒、最少 0.1 秒（幼幼～普通 0.28／困難 0.18／神話約 0.11 秒） */
  function rescueHoldFor(c) { return Math.min(C.RESCUE_HOLD, Math.max(0.1, (c.wobbleMax || 0.6) * 0.45)); }

  function newStats() {
    return { kos: 0, dashes: 0, hits: 0, rescues: 0, items: [], ghostDrops: 0, survive: 0, falls: 0 };
  }

  function makeCar(def, i, n, r0) {
    var ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    var d = r0 * 0.6;
    return {
      id: def.id, name: def.name || ('P' + (i + 1)), skin: def.skin == null ? i % 8 : def.skin,
      team: def.team == null ? i : def.team, level: def.level || null, human: !!def.human,
      dummy: !!def.dummy,
      x: Math.cos(ang) * d, y: Math.sin(ang) * d, vx: 0, vy: 0,
      angle: ang + Math.PI,            // 車頭朝中心
      alive: true, outAt: null, place: 0,
      dash: { phase: 'idle', t: 0, cd: 0 },
      wobble: 0, wobbleMax: 0, grace: 0, rescueHold: 0, rescueTire: 0,
      item: null,
      fx: { iron: 0, shield: 0, superDash: false, spin: 0, spring: null, magnet: 0, flash: 0 },
      lastHit: null,
      ghost: null,
      input: { mx: 0, my: 0, dash: false, item: false },
      stats: newStats(),
      mood: 'happy', moodT: 0
    };
  }

  /**
   * opts:
   *   seed, cars[], items(bool), sessionLevel('kid'…'mythic'), mode('solo'|'online'|'practice'),
   *   teams(false|true), theme
   */
  function createMatch(opts) {
    var o = opts || {};
    var defs = o.cars || [];
    var mode = o.mode || 'solo';
    var practice = mode === 'practice';
    var teams = !!o.teams;
    var r0 = o.arenaR || arenaRadiusFor(defs.length, teams);
    var sessionLevel = LEVELS.indexOf(o.sessionLevel) >= 0 ? o.sessionLevel : 'normal';
    var s = {
      v: 1,
      seed: String(o.seed == null ? 'bumper' : o.seed),
      rng: 0,
      tick: 0,
      t: 0,                 // 開打後的秒數（倒數不算）
      cd: practice ? 0 : (o.countdown == null ? C.COUNTDOWN : o.countdown),
      phase: 'countdown',
      opts: {
        mode: mode, items: o.items !== false, sessionLevel: sessionLevel, teams: teams,
        shrink: !practice, timed: !practice,
        minRatio: sessionLevel === 'kid' ? 0.4 : 0.25,
        noBadItems: sessionLevel === 'kid',
        duration: o.duration || C.DURATION,
        theme: o.theme == null ? 0 : o.theme,
        /* 線上客戶端預測用：只預測移動與碰撞，出局、道具、勝負一律等伺服器 */
        predict: !!o.predict
      },
      arena: { r0: r0, r: r0 },
      cars: [],
      items: [],
      bananas: [],
      nextItem: C.ITEM_EVERY,
      seq: 0,
      outOrder: [],
      events: [],
      winner: null,
      endReason: null
    };
    if (practice || s.cd <= 0) { s.cd = 0; s.phase = 'playing'; }
    s.rng = hashSeed(s.seed);
    for (var i = 0; i < defs.length; i++) s.cars.push(makeCar(defs[i], i, defs.length, r0));
    for (var j = 0; j < s.cars.length; j++) s.cars[j].wobbleMax = rescueTimeFor(s.cars[j], s);
    return s;
  }

  function getCar(s, id) {
    for (var i = 0; i < s.cars.length; i++) if (s.cars[i].id === id) return s.cars[i];
    return null;
  }

  function setInput(s, id, inp) {
    var c = getCar(s, id);
    if (!c || !inp) return;
    var mx = +inp.mx || 0, my = +inp.my || 0;
    var m = len(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    if (!isFinite(mx) || !isFinite(my)) { mx = 0; my = 0; }
    c.input.mx = mx; c.input.my = my;
    if (inp.dash) c.input.dash = true;
    if (inp.item) c.input.item = true;
  }

  function aliveCars(s) {
    var out = [];
    for (var i = 0; i < s.cars.length; i++) if (s.cars[i].alive && !s.cars[i].dummy) out.push(s.cars[i]);
    return out;
  }

  function emit(s, e) { s.events.push(e); }

  function setMood(c, m, t) { c.mood = m; c.moodT = t; }

  /* ---------- 道具 ---------- */
  function itemCounts(s) {
    var normal = 0;
    for (var i = 0; i < s.items.length; i++) if (!s.items[i].ghost) normal++;
    return { normal: normal, total: s.items.length };
  }

  function spawnItem(s) {
    var future = radiusAt(s, s.t + C.ITEM_EVERY);
    var rr = Math.max(0.6, future - 1.2) * Math.sqrt(rand(s)) * 0.85;
    var a = rand(s) * Math.PI * 2;
    var it = { id: ++s.seq, x: Math.cos(a) * rr, y: Math.sin(a) * rr, ghost: false, age: 0 };
    s.items.push(it);
    emit(s, { type: 'itemSpawn', x: it.x, y: it.y });
  }

  /** 落後補償：越靠邊、撞飛數越少，越容易拿到彈簧與護盾 */
  function rollItem(s, c) {
    var types = s.opts.noBadItems ? ['super', 'iron', 'shield', 'spring'] : ITEM_TYPES.slice();
    var maxKo = 0, al = aliveCars(s);
    for (var i = 0; i < al.length; i++) maxKo = Math.max(maxKo, al[i].stats.kos);
    var edge = clamp(len(c.x, c.y) / Math.max(0.1, s.arena.r), 0, 1);
    var behind = maxKo > 0 ? (maxKo - c.stats.kos) / maxKo : 0;
    var catchUp = clamp(edge * 0.6 + behind * 0.6, 0, 1);
    var w = [], sum = 0;
    for (var k = 0; k < types.length; k++) {
      var wt = 1;
      if (types[k] === 'spring' || types[k] === 'shield') wt += catchUp * 2.5;
      w.push(wt); sum += wt;
    }
    var r = rand(s) * sum;
    for (var m = 0; m < types.length; m++) { r -= w[m]; if (r <= 0) return types[m]; }
    return types[types.length - 1];
  }

  function useItem(s, c) {
    var type = c.item;
    if (!type || s.opts.predict) return;
    c.item = null;
    c.stats.items.push(type);
    emit(s, { type: 'use', id: c.id, item: type, x: c.x, y: c.y });
    if (type === 'super') c.fx.superDash = true;
    else if (type === 'iron') c.fx.iron = C.IRON_TIME;
    else if (type === 'shield') c.fx.shield = C.SHIELD_TIME;
    else if (type === 'magnet') c.fx.magnet = C.MAGNET_TIME;
    else if (type === 'banana') {
      var hx = Math.cos(c.angle), hy = Math.sin(c.angle);
      s.bananas.push({ id: ++s.seq, x: c.x - hx * 0.95, y: c.y - hy * 0.95, t: C.BANANA_TIME, owner: c.id, safe: 0.5 });
    } else if (type === 'spring') {
      var a = rand(s) * Math.PI * 2, d = rand(s) * Math.min(1.5, s.arena.r * 0.3);
      c.fx.spring = { t: 0, fx: c.x, fy: c.y, tx: Math.cos(a) * d, ty: Math.sin(a) * d };
      c.wobble = 0; c.vx = 0; c.vy = 0;
      c.dash.phase = 'idle'; c.dash.t = 0;
      setMood(c, 'happy', 0.8);
    }
  }

  /* ---------- 出局 ---------- */
  function knockOut(s, c, reason) {
    if (!c.alive || s.opts.predict) return;
    c.alive = false;
    c.outAt = s.t;
    c.wobble = 0;
    c.stats.survive = s.t;
    c.stats.falls++;
    c.item = null;
    c.fx.iron = 0; c.fx.shield = 0; c.fx.magnet = 0; c.fx.superDash = false; c.fx.spring = null;
    var by = null;
    if (c.lastHit && s.t - c.lastHit.t <= C.KO_WINDOW && c.lastHit.by !== c.id) {
      var k = getCar(s, c.lastHit.by);
      if (k && !(s.opts.teams && k.team === c.team)) { k.stats.kos++; by = k.id; setMood(k, 'happy', 1.2); }
    }
    if (!c.dummy) s.outOrder.push(c.id);
    var a = Math.atan2(c.y, c.x);
    c.ghost = { theta: a, cd: C.GHOST_CD * 0.5, fallT: 0, fx: c.x, fy: c.y };
    setMood(c, 'shock', 2);
    emit(s, { type: 'fall', id: c.id, by: by, x: c.x, y: c.y, reason: reason || 'edge' });
  }

  /* ---------- 碰撞 ---------- */
  function isAirborne(c) { return !!c.fx.spring; }
  function massOf(c) { return c.fx.iron > 0 ? C.IRON_MASS : 1; }
  function bursting(c) { return c.dash.phase === 'burst'; }

  function collide(s, a, b) {
    var ra = C.CAR_R * (bursting(a) ? C.DASH_REACH : 1);
    var rb = C.CAR_R * (bursting(b) ? C.DASH_REACH : 1);
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = len(dx, dy);
    var minD = ra + rb;
    if (d >= minD) return;
    var nx, ny;
    if (d < 1e-6) { nx = 1; ny = 0; d = 0; } else { nx = dx / d; ny = dy / d; }
    var ma = massOf(a), mb = massOf(b);
    var team = s.opts.teams && a.team === b.team && !a.dummy && !b.dummy;

    /* 分開重疊（依質量分配；護盾方不動） */
    var overlap = minD - d;
    var ia = 1 / ma, ib = 1 / mb;
    if (a.fx.shield > 0 && !team) ia = 0;
    if (b.fx.shield > 0 && !team) ib = 0;
    if (ia + ib === 0) { ia = 1; ib = 1; }
    var push = overlap / (ia + ib);
    a.x -= nx * push * ia; a.y -= ny * push * ia;
    b.x += nx * push * ib; b.y += ny * push * ib;

    var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    var vn = rvx * nx + rvy * ny;   // < 0 表示正在靠近
    if (vn >= 0) return;
    var speed = -vn;

    if (team) {
      var jt = -(1 + C.TEAM_RESTITUTION) * vn / (1 / ma + 1 / mb) * 0.35;
      a.vx -= jt / ma * nx; a.vy -= jt / ma * ny;
      b.vx += jt / mb * nx; b.vy += jt / mb * ny;
      /* 衝刺撞到隊友：衝刺直接停下，不把隊友撞飛 */
      [a, b].forEach(function (q) {
        if (bursting(q)) { q.dash.phase = 'idle'; q.vx *= 0.3; q.vy *= 0.3; }
      });
      return;
    }

    var aDash = bursting(a), bDash = bursting(b);

    /* 兩台都在衝刺：互相抵銷、各自彈開 */
    if (aDash && bDash) {
      var bounce = 3.4;
      a.vx = -nx * bounce; a.vy = -ny * bounce;
      b.vx = nx * bounce; b.vy = ny * bounce;
      a.dash.phase = 'idle'; b.dash.phase = 'idle';
      a.fx.superDash = false; b.fx.superDash = false;
      markHit(s, a, b, speed); markHit(s, b, a, speed);
      emit(s, { type: 'clash', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: speed });
      return;
    }

    /* 護盾：擋下一次撞擊，自己不被彈開，對方像撞牆 */
    var aShield = a.fx.shield > 0, bShield = b.fx.shield > 0;
    if (aShield || bShield) {
      if (aShield && bShield) { aShield = false; bShield = false; }
    }
    if (aShield || bShield) {
      var sh = aShield ? a : b, ot = aShield ? b : a;
      var sx = aShield ? nx : -nx, sy = aShield ? ny : -ny; // 從護盾指向對方
      var ov = ot.vx * sx + ot.vy * sy;
      var shv = sh.vx * sx + sh.vy * sy;
      var rel = ov - shv;
      if (rel < 0) {
        var out = Math.max(2.5, -rel * 1.1);
        ot.vx += sx * (out - ov + shv); ot.vy += sy * (out - ov + shv);
      }
      sh.fx.shield = 0;
      if (bursting(ot)) { ot.dash.phase = 'idle'; ot.fx.superDash = false; }
      markHit(s, ot, sh, speed);
      emit(s, { type: 'shieldBlock', id: sh.id, by: ot.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, power: speed });
      return;
    }

    var j = -(1 + C.RESTITUTION) * vn / (1 / ma + 1 / mb);
    var multB = 1, multA = 1;   // 各自收到的衝量倍率
    if (aDash) { multB = C.DASH_HIT * (a.fx.superDash ? C.SUPER_MULT : 1); }
    if (bDash) { multA = C.DASH_HIT * (b.fx.superDash ? C.SUPER_MULT : 1); }
    a.vx -= j * multA / ma * nx; a.vy -= j * multA / ma * ny;
    b.vx += j * multB / mb * nx; b.vy += j * multB / mb * ny;
    if (aDash) { a.dash.phase = 'idle'; if (a.fx.superDash) { a.fx.superDash = false; emit(s, { type: 'superHit', id: a.id, x: b.x, y: b.y }); } }
    if (bDash) { b.dash.phase = 'idle'; if (b.fx.superDash) { b.fx.superDash = false; emit(s, { type: 'superHit', id: b.id, x: a.x, y: a.y }); } }

    markHit(s, b, a, speed * multB);
    markHit(s, a, b, speed * multA);
    emit(s, {
      type: 'hit', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      power: speed * Math.max(multA, multB), dash: aDash || bDash
    });
  }

  /** victim 被 by 撞到：記錄最後撞擊者；搖搖欲墜中被撞直接掉落 */
  function markHit(s, victim, by, power) {
    if (power < 0.6) return;
    victim.lastHit = { by: by.id, t: s.t };
    victim.fx.flash = 0.18;
    if (!victim.dummy && power > 1.2) victim.stats.hits++;
    setMood(victim, power > 4 ? 'dizzy' : 'ouch', 0.7);
    if (victim.wobble > 0 && s.t >= C.SPAWN_SAFE) {
      victim.wobble = 0;
      victim.vx += victim.x / Math.max(0.01, len(victim.x, victim.y)) * 2;
      victim.vy += victim.y / Math.max(0.01, len(victim.x, victim.y)) * 2;
      knockOut(s, victim, 'hit');
    }
  }

  /* ---------- 單台車移動 ---------- */
  function moveCar(s, c) {
    var inp = c.input;
    var spin = c.fx.spin > 0;
    var mx = spin ? 0 : inp.mx, my = spin ? 0 : inp.my;
    var m = len(mx, my);
    var slow = c.fx.iron > 0 ? C.IRON_SLOW : 1;
    var vOld = len(c.vx, c.vy);

    /* 車頭轉向輸入方向 */
    if (spin) {
      c.angle += 14 * DT;
    } else if (m > 0.15 && c.dash.phase !== 'burst') {
      var target = Math.atan2(my, mx);
      var diff = target - c.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      var maxTurn = C.TURN_RATE * DT * (c.dash.phase === 'charge' ? 1.6 : 1);
      c.angle += clamp(diff, -maxTurn, maxTurn);
    }

    /* 衝刺 */
    if (c.dash.cd > 0) c.dash.cd = Math.max(0, c.dash.cd - DT);
    if (c.dash.phase === 'charge') {
      c.dash.t += DT;
      c.vx *= 0.88; c.vy *= 0.88;
      if (c.dash.t >= C.DASH_CHARGE - 1e-9) {
        c.dash.phase = 'burst'; c.dash.t = 0;
        var sp = C.MAX_SPEED * C.DASH_MULT * slow;
        c.vx = Math.cos(c.angle) * sp; c.vy = Math.sin(c.angle) * sp;
        emit(s, { type: 'burst', id: c.id, x: c.x, y: c.y, sup: c.fx.superDash });
      }
    } else if (c.dash.phase === 'burst') {
      c.dash.t += DT;
      if (c.dash.t >= C.DASH_BURST - 1e-9) { c.dash.phase = 'idle'; c.dash.t = 0; }
    } else if (!spin) {
      if (m > 0.05) {
        c.vx += mx * C.ACCEL * slow * DT;
        c.vy += my * C.ACCEL * slow * DT;
      }
    }

    /* 摩擦與限速 */
    if (c.dash.phase !== 'burst') {
      var drag = m > 0.05 && !spin ? C.DRAG_MOVE : C.DRAG_IDLE;
      var f = Math.exp(-drag * DT);
      c.vx *= f; c.vy *= f;
      var v = len(c.vx, c.vy), cap = C.MAX_SPEED * slow;
      if (v > cap) {
        /* 自己開不會超過最高速；被撞飛的超速慢慢降下來，保留「被撞飛」的感覺 */
        var nv = vOld * f > cap ? Math.max(cap, Math.min(v, vOld * f) - 9 * DT) : cap;
        c.vx *= nv / v; c.vy *= nv / v;
      }
    }

    /* 磁鐵：把附近的人吸過來 */
    if (c.fx.magnet > 0) {
      for (var i = 0; i < s.cars.length; i++) {
        var o = s.cars[i];
        if (o === c || !o.alive || isAirborne(o)) continue;
        if (s.opts.teams && o.team === c.team && !o.dummy) continue;
        var dx = c.x - o.x, dy = c.y - o.y, d = len(dx, dy);
        if (d > 0.05 && d < C.MAGNET_R) {
          var pull = C.MAGNET_PULL / massOf(o);
          o.vx += dx / d * pull * DT; o.vy += dy / d * pull * DT;
          if (o.lastHit == null || o.lastHit.by !== c.id) o.lastHit = { by: c.id, t: s.t };
          else o.lastHit.t = s.t;
        }
      }
    }

    c.x += c.vx * DT;
    c.y += c.vy * DT;
  }

  function stepSpring(s, c) {
    var sp = c.fx.spring;
    sp.t += DT;
    var k = clamp(sp.t / C.SPRING_TIME, 0, 1);
    var e = k * k * (3 - 2 * k);
    c.x = sp.fx + (sp.tx - sp.fx) * e;
    c.y = sp.fy + (sp.ty - sp.fy) * e;
    c.vx = 0; c.vy = 0;
    if (k >= 1) {
      c.fx.spring = null;
      emit(s, { type: 'land', id: c.id, x: c.x, y: c.y });
    }
  }

  /* ---------- 邊緣：搖搖欲墜 ---------- */
  function edgeCheck(s, c) {
    var r = s.arena.r;
    var d = len(c.x, c.y);
    if (c.grace > 0) c.grace = Math.max(0, c.grace - DT);
    if (c.rescueTire > 0) c.rescueTire = Math.max(0, c.rescueTire - DT / C.RESCUE_RECOVER);
    if (c.wobble > 0) {
      var nx = c.x / Math.max(d, 1e-6), ny = c.y / Math.max(d, 1e-6);
      /* 往內「按住」RESCUE_HOLD 秒才救回來；放開或方向不夠朝內就重算 */
      var inward = -(c.input.mx * nx + c.input.my * ny);
      var spinning = c.fx.spin > 0;
      c.rescueHold = (!spinning && inward > C.RESCUE_IN) ? c.rescueHold + DT : 0;
      if (c.rescueHold >= rescueHoldFor(c) - 1e-9) {
        c.wobble = 0; c.rescueHold = 0;
        c.rescueTire += 1;   // 疲勞：下次的搶救時間變短
        c.grace = C.RESCUE_GRACE;
        c.vx = -nx * C.RESCUE_PUSH; c.vy = -ny * C.RESCUE_PUSH;
        c.x = nx * (r - 0.05); c.y = ny * (r - 0.05);
        if (!c.dummy) c.stats.rescues++;
        setMood(c, 'happy', 0.8);
        emit(s, { type: 'rescue', id: c.id, x: c.x, y: c.y });
        return;
      }
      /* 停在邊緣上晃 */
      c.x = nx * r; c.y = ny * r;
      var vo = c.vx * nx + c.vy * ny;
      if (vo > 0) { c.vx -= vo * nx; c.vy -= vo * ny; }
      c.vx *= 0.8; c.vy *= 0.8;
      if (s.t >= C.SPAWN_SAFE) c.wobble -= DT;
      if (c.wobble <= 0) { c.wobble = s.opts.predict ? 0.01 : 0; knockOut(s, c, 'edge'); }
      return;
    }
    if (d > r) {
      if (s.t < C.SPAWN_SAFE) {
        var k0 = (r - 0.01) / d;
        c.x *= k0; c.y *= k0;
        return;
      }
      if (c.grace > 0 || d > r + C.CAR_R * 0.9) {   // 被撞得很大力（衝出邊緣 0.9 個車身半徑以上）直接掉，不給搶救
        knockOut(s, c, 'edge');
        return;
      }
      c.wobble = c.wobbleMax * Math.pow(C.RESCUE_TIRE, Math.ceil(c.rescueTire - 1e-9));   // 剛救回過（6 秒內）又上邊緣：時間變短，連續救回越來越難
      c.rescueHold = 0;
      c.dash.phase = 'idle';
      var k1 = r / d;
      c.x *= k1; c.y *= k1;
      setMood(c, 'panic', c.wobble + 0.2);
      emit(s, { type: 'wobble', id: c.id, x: c.x, y: c.y, time: c.wobble });
    }
  }

  /* ---------- 幽靈 ---------- */
  function ghostActive(s) {
    return s.opts.items && aliveCars(s).length > 2 && s.phase === 'playing';
  }

  function stepGhost(s, c) {
    var g = c.ghost;
    if (!g) return;
    if (g.fallT < 1) g.fallT = Math.min(1, g.fallT + DT / 0.9);
    var rg = s.arena.r0 + 1.4;
    /* 方向鍵／搖桿指向哪裡，幽靈就沿外圈滑到那個方位（比「沿切線推」直覺，觸控尤其明顯） */
    var mag = len(c.input.mx, c.input.my);
    if (mag > 0.15) {
      var want = Math.atan2(c.input.my, c.input.mx);
      var diff = want - g.theta;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      var step = Math.min(Math.abs(diff), Math.min(1, mag) * C.GHOST_SPEED / rg * DT);
      g.theta += diff > 0 ? step : -step;
    }
    c.x = Math.cos(g.theta) * rg; c.y = Math.sin(g.theta) * rg;
    if (g.cd > 0) g.cd = Math.max(0, g.cd - DT);
    if (c.input.item) {
      if (!s.opts.predict && g.cd <= 0 && ghostActive(s) && s.items.length < C.ITEM_TOTAL_MAX) {
        var land = Math.max(0, s.arena.r - (2 + rand(s)));
        var it = { id: ++s.seq, x: Math.cos(g.theta) * land, y: Math.sin(g.theta) * land, ghost: true, age: 0, from: c.id };
        s.items.push(it);
        g.cd = C.GHOST_CD;
        c.stats.ghostDrops++;
        var vr = Math.min(s.arena.r0 + 1.4, s.arena.r + 1.5);
        emit(s, { type: 'ghostDrop', id: c.id, x: it.x, y: it.y, fromX: Math.cos(g.theta) * vr, fromY: Math.sin(g.theta) * vr });
      }
    }
  }

  /* ---------- 結束與名次 ---------- */
  function checkEnd(s) {
    if (!s.opts.timed || s.opts.predict) return;
    var alive = aliveCars(s);
    var done = false, reason = null;
    if (s.opts.teams) {
      var teamsAlive = {};
      for (var i = 0; i < alive.length; i++) teamsAlive[alive[i].team] = 1;
      if (Object.keys(teamsAlive).length <= 1) { done = true; reason = 'last'; }
    } else if (alive.length <= 1) { done = true; reason = 'last'; }
    if (!done && s.t >= s.opts.duration) { done = true; reason = 'time'; }
    if (done) finish(s, reason);
  }

  function rankAlive(s, list) {
    return list.slice().sort(function (a, b) {
      if (b.stats.kos !== a.stats.kos) return b.stats.kos - a.stats.kos;
      return len(a.x, a.y) - len(b.x, b.y);
    });
  }

  function finish(s, reason) {
    if (s.phase === 'over') return;
    s.phase = 'over';
    s.endReason = reason;
    var alive = aliveCars(s);
    for (var i = 0; i < alive.length; i++) alive[i].stats.survive = s.t;
    var order = [];
    if (s.opts.teams) {
      /* 組隊：存活隊伍（依隊伍撞飛數）在前，其他依最後一名隊員出局順序 */
      var teamInfo = {};
      s.cars.forEach(function (c) {
        if (c.dummy) return;
        var ti = teamInfo[c.team] || (teamInfo[c.team] = { team: c.team, alive: 0, kos: 0, lastOut: -1, members: [] });
        ti.members.push(c);
        ti.kos += c.stats.kos;
        if (c.alive) ti.alive++;
        else ti.lastOut = Math.max(ti.lastOut, s.outOrder.indexOf(c.id));
      });
      var tl = Object.keys(teamInfo).map(function (k) { return teamInfo[k]; });
      tl.sort(function (a, b) {
        if ((b.alive > 0) !== (a.alive > 0)) return (b.alive > 0) - (a.alive > 0);
        if (a.alive > 0) { if (b.kos !== a.kos) return b.kos - a.kos; return b.alive - a.alive; }
        return b.lastOut - a.lastOut;
      });
      var place = 0;
      tl.forEach(function (ti, idx) {
        if (idx === 0 || !(ti.alive > 0 && tl[idx - 1].alive > 0 && ti.kos === tl[idx - 1].kos && ti.alive === tl[idx - 1].alive)) place = idx + 1;
        ti.place = place;
        ti.members.forEach(function (c) { c.place = place; order.push(c.id); });
      });
      s.winner = tl[0] && tl[0].place === 1 ? { team: tl[0].team } : null;
      s.teamRank = tl.map(function (t) { return { team: t.team, place: t.place, kos: t.kos }; });
    } else {
      var ranked = rankAlive(s, alive);
      for (var k = 0; k < ranked.length; k++) order.push(ranked[k].id);
      for (var m = s.outOrder.length - 1; m >= 0; m--) order.push(s.outOrder[m]);
      for (var n = 0; n < order.length; n++) getCar(s, order[n]).place = n + 1;
      s.winner = order.length ? { id: order[0] } : null;
    }
    s.order = order;
    emit(s, { type: 'over', reason: reason });
  }

  function result(s) {
    var rows = (s.order || []).map(function (id) {
      var c = getCar(s, id);
      return { id: c.id, name: c.name, skin: c.skin, team: c.team, level: c.level, human: c.human, place: c.place, alive: c.alive, stats: c.stats };
    });
    return { reason: s.endReason, winner: s.winner, rows: rows, teams: s.opts.teams, teamRank: s.teamRank || null, t: s.t };
  }

  /* ---------- 主迴圈 ---------- */
  function step(s) {
    s.events.length = 0;
    s.tick++;
    if (s.phase === 'over') return s;
    if (s.phase === 'countdown') {
      var before = Math.ceil(s.cd);
      s.cd -= DT;
      var after = Math.ceil(Math.max(0, s.cd));
      if (after !== before) emit(s, { type: 'count', n: after });
      for (var q = 0; q < s.cars.length; q++) { s.cars[q].input.dash = false; s.cars[q].input.item = false; }
      if (s.cd <= 0) { s.cd = 0; s.phase = 'playing'; emit(s, { type: 'go' }); }
      return s;
    }
    if (s.phase !== 'playing') return s;

    s.t += DT;
    s.arena.r = radiusAt(s, s.t);
    var cars = s.cars, i, c;

    /* 1. 輸入（衝刺、道具） */
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      if (c.moodT > 0) { c.moodT -= DT; if (c.moodT <= 0) c.mood = 'happy'; }
      if (c.fx.flash > 0) c.fx.flash = Math.max(0, c.fx.flash - DT);
      if (!c.alive) continue;
      if (c.input.dash && c.dash.phase === 'idle' && c.dash.cd <= 0 && c.fx.spin <= 0 && !isAirborne(c) && c.wobble <= 0) {
        c.dash.phase = 'charge'; c.dash.t = 0; c.dash.cd = C.DASH_CD;
        if (!c.dummy) c.stats.dashes++;
        emit(s, { type: 'charge', id: c.id });
      }
      if (c.input.item && c.item && !isAirborne(c)) useItem(s, c);
    }

    /* 2. 移動 */
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      if (!c.alive) { stepGhost(s, c); continue; }
      if (c.fx.iron > 0) c.fx.iron = Math.max(0, c.fx.iron - DT);
      if (c.fx.shield > 0) c.fx.shield = Math.max(0, c.fx.shield - DT);
      if (c.fx.magnet > 0) c.fx.magnet = Math.max(0, c.fx.magnet - DT);
      if (c.fx.spin > 0) c.fx.spin = Math.max(0, c.fx.spin - DT);
      if (isAirborne(c)) { stepSpring(s, c); continue; }
      if (c.wobble > 0) { c.vx *= 0.9; c.vy *= 0.9; continue; }
      moveCar(s, c);
    }

    /* 3. 碰撞（兩輪，推擠更穩） */
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < cars.length; i++) {
        var a = cars[i];
        if (!a.alive || isAirborne(a)) continue;
        for (var j = i + 1; j < cars.length; j++) {
          var b = cars[j];
          if (!b.alive || isAirborne(b)) continue;
          collide(s, a, b);
        }
      }
    }

    /* 4. 邊緣 */
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      if (!c.alive || isAirborne(c)) continue;
      edgeCheck(s, c);
    }

    /* 5. 香蕉皮 */
    for (var bi = s.bananas.length - 1; bi >= 0; bi--) {
      var bn = s.bananas[bi];
      bn.t -= DT; if (bn.safe > 0) bn.safe -= DT;
      var hit = false;
      if (bn.t > 0 && s.arena.r > len(bn.x, bn.y)) {
        for (i = 0; i < cars.length; i++) {
          c = cars[i];
          if (!c.alive || isAirborne(c)) continue;
          if (c.id === bn.owner && bn.safe > 0) continue;
          if (len(c.x - bn.x, c.y - bn.y) < C.CAR_R + 0.3) {
            c.fx.spin = C.SPIN_TIME;
            c.dash.phase = 'idle';
            if (c.id !== bn.owner) c.lastHit = { by: bn.owner, t: s.t };
            setMood(c, 'dizzy', 1.1);
            emit(s, { type: 'slip', id: c.id, x: bn.x, y: bn.y });
            hit = true;
            break;
          }
        }
      }
      if (hit || bn.t <= 0 || len(bn.x, bn.y) > s.arena.r) s.bananas.splice(bi, 1);
    }

    /* 6. 道具：生成、撿取、被縮圈吃掉 */
    if (s.opts.items && !s.opts.predict) {
      if (s.opts.timed) {
        if (s.t >= s.nextItem) {
          s.nextItem += C.ITEM_EVERY;
          var cnt = itemCounts(s);
          if (cnt.normal < C.ITEM_MAX && cnt.total < C.ITEM_TOTAL_MAX) spawnItem(s);
        }
      }
      for (var ii = s.items.length - 1; ii >= 0; ii--) {
        var it = s.items[ii];
        it.age += DT;
        if (len(it.x, it.y) > s.arena.r - 0.2) { s.items.splice(ii, 1); emit(s, { type: 'itemLost', x: it.x, y: it.y }); continue; }
        if (it.age < 0.35) continue;
        for (i = 0; i < cars.length; i++) {
          c = cars[i];
          if (!c.alive || c.dummy || c.item || isAirborne(c)) continue;
          if (len(c.x - it.x, c.y - it.y) < C.ITEM_PICK_R) {
            c.item = it.type || rollItem(s, c);
            s.items.splice(ii, 1);
            setMood(c, 'happy', 0.8);
            emit(s, { type: 'pickup', id: c.id, item: c.item, x: it.x, y: it.y });
            break;
          }
        }
      }
    }

    for (i = 0; i < cars.length; i++) { cars[i].input.dash = false; cars[i].input.item = false; }
    checkEnd(s);
    return s;
  }

  /** 線上：離開或斷線逾時 → 直接出局變幽靈，不算任何人的撞飛數 */
  function forfeit(s, id) {
    var c = getCar(s, id);
    if (!c || !c.alive || s.phase === 'over') return;
    c.lastHit = null;
    knockOut(s, c, 'leave');
    checkEnd(s);
  }

  /* ---------- 練習模式工具 ---------- */
  function practiceGive(s, id, type) {
    var c = getCar(s, id);
    if (c && c.alive && ITEM_TYPES.indexOf(type) >= 0) c.item = type;
  }

  function practiceReset(s, dummyCount) {
    var me = s.cars.filter(function (c) { return !c.dummy; });
    var defs = me.map(function (c) { return { id: c.id, name: c.name, skin: c.skin, human: c.human }; });
    var n = clamp(dummyCount == null ? 3 : dummyCount, 0, 5);
    for (var i = 0; i < n; i++) defs.push({ id: 'dummy' + i, name: 'dummy', skin: 8, dummy: true });
    var fresh = createMatch({ seed: s.seed + ':' + s.tick, cars: defs, mode: 'practice', items: true, arenaR: 9, theme: s.opts.theme, sessionLevel: s.opts.sessionLevel });
    /* 練習：玩家在中間下方，靶車圍一圈 */
    var p = fresh.cars[0];
    p.x = 0; p.y = 3; p.angle = -Math.PI / 2;
    for (var k = 1; k < fresh.cars.length; k++) {
      var a = -Math.PI / 2 + (k - 1) / Math.max(1, n) * Math.PI * 2;
      fresh.cars[k].x = Math.cos(a) * 3.2; fresh.cars[k].y = Math.sin(a) * 3.2 - 1;
      fresh.cars[k].angle = a + Math.PI;
    }
    return fresh;
  }

  /** 練習模式：玩家掉下去 1 秒後回到中間 */
  function practiceRespawn(s) {
    s.cars.forEach(function (c) {
      if (!c.dummy && !c.alive && c.ghost && c.ghost.fallT >= 1) {
        c.alive = true; c.ghost = null; c.x = 0; c.y = 0; c.vx = 0; c.vy = 0; c.wobble = 0;
        c.outAt = null; c.mood = 'happy';
        s.outOrder = s.outOrder.filter(function (id) { return id !== c.id; });
      }
    });
  }

  /* ---------- 網路序列化（精簡快照） ---------- */
  function r2(v) { return Math.round(v * 1000) / 1000; }
  function snapshot(s) {
    return {
      v: s.v, tick: s.tick, t: r2(s.t), cd: r2(s.cd), phase: s.phase,
      r: r2(s.arena.r), r0: s.arena.r0,
      cars: s.cars.map(function (c) {
        return {
          id: c.id, x: r2(c.x), y: r2(c.y), vx: r2(c.vx), vy: r2(c.vy), a: r2(c.angle),
          al: c.alive ? 1 : 0, dp: c.dash.phase === 'idle' ? 0 : (c.dash.phase === 'charge' ? 1 : 2), dt: r2(c.dash.t), dc: r2(c.dash.cd),
          w: r2(c.wobble), wm: c.wobbleMax, rh: r2(c.rescueHold), rt: r2(c.rescueTire), it: c.item,
          fx: [r2(c.fx.iron), r2(c.fx.shield), c.fx.superDash ? 1 : 0, r2(c.fx.spin), c.fx.spring ? [r2(c.fx.spring.t), r2(c.fx.spring.fx), r2(c.fx.spring.fy), r2(c.fx.spring.tx), r2(c.fx.spring.ty)] : 0, r2(c.fx.magnet), r2(c.fx.flash)],
          g: c.ghost ? [r2(c.ghost.theta), r2(c.ghost.cd), r2(c.ghost.fallT), r2(c.ghost.fx), r2(c.ghost.fy)] : 0,
          m: c.mood, k: c.stats.kos, pl: c.place
        };
      }),
      items: s.items.map(function (it) { return [it.id, r2(it.x), r2(it.y), it.ghost ? 1 : 0, r2(it.age)]; }),
      bananas: s.bananas.map(function (b) { return [b.id, r2(b.x), r2(b.y), r2(b.t)]; })
    };
  }

  /** 把快照套回本機狀態（線上客戶端用；本機狀態只用來畫） */
  function applySnapshot(s, snap) {
    s.tick = snap.tick; s.t = snap.t; s.cd = snap.cd; s.phase = snap.phase === 'over' ? s.phase : snap.phase;
    s.arena.r = snap.r; s.arena.r0 = snap.r0;
    snap.cars.forEach(function (sc) {
      var c = getCar(s, sc.id);
      if (!c) return;
      c.x = sc.x; c.y = sc.y; c.vx = sc.vx; c.vy = sc.vy; c.angle = sc.a;
      c.alive = !!sc.al;
      c.dash.phase = sc.dp === 0 ? 'idle' : (sc.dp === 1 ? 'charge' : 'burst'); c.dash.t = sc.dt; c.dash.cd = sc.dc;
      c.wobble = sc.w; c.wobbleMax = sc.wm; c.rescueHold = sc.rh || 0; c.rescueTire = sc.rt || 0; c.item = sc.it;
      c.fx.iron = sc.fx[0]; c.fx.shield = sc.fx[1]; c.fx.superDash = !!sc.fx[2]; c.fx.spin = sc.fx[3];
      c.fx.spring = sc.fx[4] ? { t: sc.fx[4][0], fx: sc.fx[4][1], fy: sc.fx[4][2], tx: sc.fx[4][3], ty: sc.fx[4][4] } : null;
      c.fx.magnet = sc.fx[5]; c.fx.flash = sc.fx[6];
      c.ghost = sc.g ? { theta: sc.g[0], cd: sc.g[1], fallT: sc.g[2], fx: sc.g[3], fy: sc.g[4] } : null;
      c.mood = sc.m; c.stats.kos = sc.k; c.place = sc.pl;
    });
    s.items = snap.items.map(function (a) { return { id: a[0], x: a[1], y: a[2], ghost: !!a[3], age: a[4] }; });
    s.bananas = snap.bananas.map(function (a) { return { id: a[0], x: a[1], y: a[2], t: a[3] }; });
  }

  return {
    DT: DT, C: C, LEVELS: LEVELS, RESCUE: RESCUE, rescueHoldFor: rescueHoldFor, ITEM_TYPES: ITEM_TYPES,
    createMatch: createMatch, step: step, setInput: setInput, getCar: getCar,
    aliveCars: aliveCars, radiusAt: radiusAt, result: result, finish: finish,
    ghostActive: ghostActive, rand: rand, hashSeed: hashSeed, len: len,
    practiceGive: practiceGive, forfeit: forfeit, practiceReset: practiceReset, practiceRespawn: practiceRespawn,
    snapshot: snapshot, applySnapshot: applySnapshot, arenaRadiusFor: arenaRadiusFor
  };
}));
