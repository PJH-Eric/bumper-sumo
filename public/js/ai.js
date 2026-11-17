/* ===== ai.js — 五段電腦（幼幼／簡單／普通／困難／神話） =====
 *
 * 規則：電腦只讀場上公開資訊（與玩家看到的一樣），只透過 Rules.setInput 操作；
 * 難度差異來自決策間隔（反應時間）、瞄準誤差、會不會顧邊、預判、道具時機。
 * 神話沒有任何數值加成。
 * 亂數用電腦自己的種子，不動 state.rng，所以不影響對局本身的重現。
 */
(function (root, factory) {
  var api = factory(root.BumperRules || (typeof require === 'function' ? require('./rules.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BumperAI = api;
}(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  var P = {
    kid:    { ms: 300, noise: 0.7,  rescue: 0.3,  safe: 0.55, dashP: 0.12, lead: 0,    reach: 2.2, dodge: 0,    items: 0.15, edgeAware: 0.2, sideStep: 0 },
    easy:   { ms: 250, noise: 0.4,  rescue: 0.85, safe: 1.1,  dashP: 0.75, lead: 0,    reach: 3.3, dodge: 0,    items: 0.5,  edgeAware: 0,   sideStep: 0 },
    normal: { ms: 150, noise: 0.2,  rescue: 1,    safe: 0.74, dashP: 0.9,  lead: 0.12, reach: 3.2, dodge: 0.25, items: 0.8,  edgeAware: 1,   sideStep: 0.2 },
    hard:   { ms: 110, noise: 0.12, rescue: 1,    safe: 0.68, dashP: 1,    lead: 0.25, reach: 3.4, dodge: 0.7,  items: 1,    edgeAware: 1,   sideStep: 0.7 },
    mythic: { ms: 80,  noise: 0.05, rescue: 1,    safe: 0.68, dashP: 1,    lead: 0.25, reach: 3.4, dodge: 0.8,  items: 1,    edgeAware: 1,   sideStep: 0.7 }
  };

  function len(x, y) { return Math.sqrt(x * x + y * y); }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  function create(level, seed) {
    var h = 2166136261, str = String(seed || level);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return { level: P[level] ? level : 'normal', p: P[level] || P.normal, rng: h | 0, next: 0, mx: 0, my: 0, wander: null, wanderT: 0, holdItem: 0 };
  }

  function rnd(b) {
    var a = (b.rng = (b.rng + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function enemiesOf(s, c) {
    var out = [];
    for (var i = 0; i < s.cars.length; i++) {
      var o = s.cars[i];
      if (o === c || !o.alive || o.fx.spring) continue;
      if (s.opts.teams && o.team === c.team && !o.dummy) continue;
      out.push(o);
    }
    return out;
  }

  /** 對方是不是正對著我衝過來 */
  function incoming(c, o) {
    if (o.dash.phase === 'idle') return false;
    var dx = c.x - o.x, dy = c.y - o.y, d = len(dx, dy);
    if (d > 4.2) return false;
    return Math.abs(angDiff(Math.atan2(dy, dx), o.angle)) < 0.55;
  }

  /** 走向某點；高難度會抵銷側滑 */
  function seek(b, c, tx, ty, brake) {
    var dx = tx - c.x, dy = ty - c.y;
    if (brake) { dx -= c.vx * brake; dy -= c.vy * brake; }
    var d = len(dx, dy);
    if (d < 0.08) return [0, 0];
    return [dx / d, dy / d];
  }

  function withNoise(b, v) {
    if (!v[0] && !v[1]) return v;
    var a = Math.atan2(v[1], v[0]) + (rnd(b) - 0.5) * 2 * b.p.noise;
    return [Math.cos(a), Math.sin(a)];
  }

  function think(s, c, b) {
    var p = b.p, R = Rules, out = { mx: b.mx, my: b.my, dash: false, item: false };
    if (s.phase !== 'playing') return { mx: 0, my: 0 };
    var nowMs = s.t * 1000;
    if (nowMs < b.next) return out;
    b.next = nowMs + p.ms;

    if (!c.alive) return ghost(s, c, b);

    var r = s.arena.r, d = len(c.x, c.y);
    var nx = d > 1e-4 ? c.x / d : 0, ny = d > 1e-4 ? c.y / d : 0;
    var foes = enemiesOf(s, c);
    var mv = [0, 0];

    /* 1. 搖搖欲墜：往內按自救 */
    if (c.wobble > 0) {
      if (c.item === 'spring' && p.items >= 0.8) out.item = true;
      if (rnd(b) < p.rescue) mv = [-nx, -ny];
      else mv = [nx * 0.3 + (rnd(b) - 0.5), ny * 0.3 + (rnd(b) - 0.5)];
      return finish(b, out, mv);
    }

    /* 2. 被衝撞威脅：護盾、側閃 */
    var threat = null;
    for (var i = 0; i < foes.length; i++) if (incoming(c, foes[i])) { threat = foes[i]; break; }
    if (threat) {
      if (c.item === 'shield' && rnd(b) < p.dodge + 0.2) out.item = true;
      else if (c.item === 'iron' && p.items >= 1) out.item = true;
      else if (c.item === 'spring' && d > r * 0.7 && p.items >= 1) out.item = true;
      if (!out.item && rnd(b) < p.sideStep) {
        var ta = threat.angle + Math.PI / 2;
        var sx = Math.cos(ta), sy = Math.sin(ta);
        /* 往比較靠中心的那一側閃 */
        if (sx * nx + sy * ny > 0) { sx = -sx; sy = -sy; }
        return finish(b, out, [sx, sy], true);
      }
    }

    /* 3. 太靠邊：先回中間 */
    var future = R.radiusAt(s, s.t + (b.level === 'mythic' ? 3 : 1));
    var safeR = Math.min(r, future) * p.safe;
    if (p.edgeAware > 0 && d > safeR && rnd(b) < p.edgeAware) {
      if (c.item === 'spring' && d > r * 0.9 && p.items >= 0.8) out.item = true;
      mv = seek(b, c, 0, 0, b.level === 'hard' || b.level === 'mythic' ? 0.35 : 0);
      /* 回中間途中有人擋路且角度剛好，也可以順手衝 */
      return finish(b, out, mv);
    }

    /* 4. 幼幼：在中間附近晃，偶爾衝一下 */
    if (b.level === 'kid') {
      if (!b.wander || s.t > b.wanderT) {
        var wa = rnd(b) * Math.PI * 2, wd = rnd(b) * r * 0.35;
        b.wander = [Math.cos(wa) * wd, Math.sin(wa) * wd];
        b.wanderT = s.t + 1.5 + rnd(b) * 2;
      }
      mv = seek(b, c, b.wander[0], b.wander[1], 0);
      if (len(c.x - b.wander[0], c.y - b.wander[1]) < 0.5) mv = [0, 0];
      var near = nearest(c, foes);
      if (near && near.d < p.reach && c.dash.cd <= 0 && rnd(b) < p.dashP * 0.3) {
        mv = seek(b, c, near.o.x, near.o.y, 0);
        if (Math.abs(angDiff(Math.atan2(near.o.y - c.y, near.o.x - c.x), c.angle)) < 0.6) out.dash = true;
      }
      if (c.item && rnd(b) < 0.08) out.item = true;
      return finish(b, out, mv);
    }

    /* 5. 撿道具 */
    if (!c.item && p.items >= 0.8 && s.items.length) {
      var best = null;
      for (var k = 0; k < s.items.length; k++) {
        var it = s.items[k], id = len(it.x - c.x, it.y - c.y);
        if (len(it.x, it.y) > r * 0.85) continue;
        var closer = true;
        for (var f = 0; f < foes.length; f++) if (len(foes[f].x - it.x, foes[f].y - it.y) < id * 0.8) closer = false;
        if (closer && id < 6 && (!best || id < best.d)) best = { it: it, d: id };
      }
      if (best && !nearest(c, foes, 1.6)) {
        mv = seek(b, c, best.it.x, best.it.y, b.level === 'normal' ? 0 : 0.25);
        return finish(b, out, mv);
      }
    }

    /* 6. 選目標 */
    var tgt = pickTarget(s, c, b, foes);
    if (!tgt) return finish(b, out, seek(b, c, 0, 0, 0.3));
    var o = tgt;
    /* 預判：到撞上為止的時間 ≈ 蓄力 0.15 秒＋飛行時間，乘上難度的預判程度 */
    var rawD = len(o.x - c.x, o.y - c.y);
    var lead = p.lead * (0.15 + rawD / 11) / 0.35;
    var ox = o.x + o.vx * lead, oy = o.y + o.vy * lead;
    var od = len(ox, oy) || 1e-3;
    var dist = len(ox - c.x, oy - c.y);
    var aimA = Math.atan2(oy - c.y, ox - c.x);
    var aligned = Math.abs(angDiff(aimA, c.angle));

    /* 道具時機 */
    if (c.item) useItemLogic(s, c, b, out, o, dist, d, r);

    if (b.level === 'easy') {
      /* 簡單：直直衝向最近的人，不管自己在不在邊上 */
      mv = seek(b, c, ox, oy, 0);
      if (dist < p.reach && aligned < 0.45 && c.dash.cd <= 0 && rnd(b) < p.dashP) out.dash = true;
      return finish(b, out, mv);
    }

    /* 普通以上：繞到對方內側（靠中心那邊），往外撞 */
    var ux = ox / od, uy = oy / od;
    var behind = 1.15 + (b.level === 'normal' ? 0.2 : 0);
    var px = ox - ux * behind, py = oy - uy * behind;
    var myInner = d < od - 0.2;
    var pushDir = Math.atan2(uy, ux);
    var lineOk = Math.abs(angDiff(aimA, pushDir)) < (b.level === 'normal' ? 0.9 : 0.75);

    if (myInner && lineOk && dist < p.reach) {
      mv = seek(b, c, ox, oy, 0);
      var headOn = o.dash.phase !== 'idle' && Math.abs(angDiff(o.angle, aimA + Math.PI)) < 0.6;
      var dashOut = Math.cos(c.angle) * nx + Math.sin(c.angle) * ny;
      var selfRisk = dashOut > 0.75 && d > r - 2.2;
      var tol = b.level === 'normal' ? 0.32 : Math.min(0.6, Math.atan2(b.level === 'mythic' ? 0.8 : 0.65, Math.max(dist, 0.5)));
      if (aligned < tol && c.dash.cd <= 0 && rnd(b) < p.dashP) {
        if (!(headOn && b.level !== 'normal') && !(selfRisk && b.level !== 'normal')) {
          if (c.item === 'super') out.item = true;
          out.dash = true;
        }
      }
    } else {
      mv = seek(b, c, px, py, b.level === 'normal' ? 0.15 : 0.35);
      /* 神話：對方衝刺冷卻中、或正在搖搖欲墜，直接補一下 */
      if ((b.level === 'hard' || b.level === 'mythic') && (o.wobble > 0 || o.dash.cd > 0.6) && dist < 2.4 && aligned < 0.3 && c.dash.cd <= 0) {
        var outD = Math.cos(c.angle) * nx + Math.sin(c.angle) * ny;
        if (!(d > r * 0.6 && outD > 0.7)) out.dash = true;
      }
    }
    return finish(b, out, mv, b.level !== 'normal');
  }

  function finish(b, out, mv, exact) {
    var v = exact ? mv : withNoise(b, mv);
    b.mx = v[0]; b.my = v[1];
    out.mx = v[0]; out.my = v[1];
    return out;
  }

  function nearest(c, foes, within) {
    var best = null;
    for (var i = 0; i < foes.length; i++) {
      var d = len(foes[i].x - c.x, foes[i].y - c.y);
      if (within != null && d > within) continue;
      if (!best || d < best.d) best = { o: foes[i], d: d };
    }
    return best;
  }

  function pickTarget(s, c, b, foes) {
    if (!foes.length) return null;
    if (b.level === 'easy' || b.level === 'normal') {
      var n = nearest(c, foes);
      /* 普通：稍微偏好靠邊的人 */
      if (b.level === 'normal') {
        var best = null, bs = -1e9;
        for (var j = 0; j < foes.length; j++) {
          var o2 = foes[j], dd = len(o2.x - c.x, o2.y - c.y);
          var sc2 = -dd + len(o2.x, o2.y) / s.arena.r * 1.5;
          if (sc2 > bs) { bs = sc2; best = o2; }
        }
        return best;
      }
      return n && n.o;
    }
    var bestO = null, bestS = -1e9;
    for (var i = 0; i < foes.length; i++) {
      var o = foes[i], d = len(o.x - c.x, o.y - c.y), od = len(o.x, o.y);
      var score = -d * 1.1 + (od / s.arena.r) * 3.2;
      if (o.wobble > 0) score += 4;
      if (o.dash.cd > 0.5) score += 1.2;
      if (o.fx.shield > 0) score -= 4;
      if (o.fx.iron > 0) score -= 2.5;
      if (o.fx.spin > 0) score += 1.5;
      if (b.level === 'mythic' && o === b.lastT) score += 0.8;   // 鎖定目標，不左右搖擺
      if (score > bestS) { bestS = score; bestO = o; }
    }
    b.lastT = bestO;
    return bestO;
  }

  function useItemLogic(s, c, b, out, o, dist, d, r) {
    var p = b.p, it = c.item;
    if (b.level === 'easy') { if (rnd(b) < 0.25) out.item = true; return; }
    if (it === 'iron' && dist < 2.6) out.item = true;
    else if (it === 'magnet' && dist < 3.5 && d < r * 0.5 && len(o.x, o.y) > d) out.item = true;
    else if (it === 'banana' && dist < 3 && Math.abs(angDiff(Math.atan2(o.y - c.y, o.x - c.x), c.angle + Math.PI)) < 1.2) out.item = true;
    else if (it === 'spring' && d > r * 0.85) out.item = true;
    else if (it === 'super') { /* 衝刺前一起放 */ }
    else if (it === 'shield' && b.level === 'normal' && dist < 1.8) out.item = true;
    /* 拿太久就用掉 */
    b.holdItem = (b.holdItem || 0) + p.ms;
    if (b.holdItem > 9000 && it !== 'shield' && it !== 'spring') { out.item = true; }
    if (out.item) b.holdItem = 0;
  }

  /* 幽靈：沿著外圈移動，冷卻好了就丟 */
  function ghost(s, c, b) {
    var out = { mx: 0, my: 0, dash: false, item: false };
    var g = c.ghost;
    if (!g) return out;
    var tx = -Math.sin(g.theta), ty = Math.cos(g.theta);
    var goal = b.ghostGoal;
    if (goal == null || rnd(b) < 0.03) {
      var al = Rules.aliveCars(s), pick = null;
      if (b.level === 'mythic' || b.level === 'hard') {
        /* 丟給自己隊友，或撞飛數最少的人（讓場面對自己最有利：不讓領先者拿） */
        for (var i = 0; i < al.length; i++) {
          if (s.opts.teams && al[i].team === c.team) { pick = al[i]; break; }
          if (!pick || al[i].stats.kos < pick.stats.kos) pick = al[i];
        }
      }
      goal = b.ghostGoal = pick ? Math.atan2(pick.y, pick.x) : rnd(b) * Math.PI * 2;
    }
    var da = angDiff(goal, g.theta);
    var k = Math.max(-1, Math.min(1, da * 3));
    out.mx = tx * k; out.my = ty * k;
    if (g.cd <= 0 && Math.abs(da) < 0.25 && rnd(b) < (b.level === 'kid' ? 0.2 : 0.6)) { out.item = true; b.ghostGoal = null; }
    b.mx = out.mx; b.my = out.my;
    return out;
  }

  return { create: create, think: think, PROFILES: P };
}));
