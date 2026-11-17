/* 規則與物理單元測試：node tests/verify.js */
'use strict';
const R = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; } else { fail++; console.log('✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function stepN(s, n, fn) { for (let i = 0; i < n; i++) { if (fn) fn(i); R.step(s); } }
function secs(t) { return Math.round(t * 60); }
function match(n, extra) {
  const cars = [];
  for (let i = 0; i < n; i++) cars.push({ id: 'p' + i, name: 'P' + i, human: i === 0, level: 'normal' });
  return R.createMatch(Object.assign({ seed: 'test', cars, items: false, countdown: 0 }, extra || {}));
}
/* 把所有車停在擂台下方一排（在場內、不互相碰到），測試再各自擺位置 */
function park(s) { s.cars.forEach((c, i) => { c.x = -2.5 + i * 1.3; c.y = -1.7; c.vx = c.vy = 0; }); }
function evts(s, type) { return s.events.filter((e) => e.type === type); }
function runCollect(s, n, type) { const out = []; stepN(s, n, () => {}); return out; }

/* ---- 倒數 ---- */
(function () {
  const s = match(2, { countdown: 3 });
  ok(s.phase === 'countdown', '開局先倒數');
  const counts = [];
  for (let i = 0; i < secs(3) + 1; i++) { R.step(s); evts(s, 'count').forEach((e) => counts.push(e.n)); }
  ok(s.phase === 'playing', '倒數 3 秒後開打');
  ok(counts.join(',') === '2,1,0', '倒數事件 3→2→1→0：' + counts.join(','));
  ok(near(s.t, 1 / 60, 1e-9) || s.t < 0.05, '倒數不計入比賽時間');
})();

/* ---- 移動慣性 ---- */
(function () {
  const s = match(2); park(s);
  const c = s.cars[0]; c.x = 0; c.y = 0;
  stepN(s, 60, () => R.setInput(s, 'p0', { mx: 1, my: 0 }));
  ok(c.vx > 4 && c.vx <= R.C.MAX_SPEED + 1e-6, '有輸入會加速到最高速附近：' + c.vx.toFixed(2));
  const v0 = c.vx;
  stepN(s, 30, () => R.setInput(s, 'p0', { mx: 0, my: 0 }));
  ok(c.vx > 0.5 && c.vx < v0, '放開後慢慢停（有慣性會滑）：' + c.vx.toFixed(2));
})();

/* ---- 衝刺 ---- */
(function () {
  const s = match(2); park(s);
  const c = s.cars[0]; c.x = 0; c.y = 0; c.angle = 0;
  R.setInput(s, 'p0', { mx: 1, my: 0, dash: true });
  R.step(s);
  ok(c.dash.phase === 'charge', '按衝刺先蓄力');
  ok(near(c.dash.cd, R.C.DASH_CD, 0.02), '衝刺冷卻 2 秒');
  stepN(s, 9);
  ok(c.dash.phase === 'burst', '蓄力 0.15 秒後爆發');
  ok(near(Math.hypot(c.vx, c.vy), R.C.MAX_SPEED * R.C.DASH_MULT, 0.01), '爆發速度＝最高速×2.2');
  R.setInput(s, 'p0', { dash: true }); R.step(s);
  ok(c.dash.phase === 'burst' && c.stats.dashes === 1, '冷卻中再按不會重新衝刺');
  stepN(s, 20);
  ok(c.dash.phase === 'idle', '爆發 0.3 秒後結束');
  stepN(s, secs(2));
  ok(c.dash.cd === 0, '2 秒後冷卻結束');
})();

/* ---- 撞擊力：衝刺撞人比一般撞人強 ---- */
function hitTest(dash) {
  const s = match(2); park(s);
  const a = s.cars[0], b = s.cars[1];
  a.x = -2; a.y = 0; a.angle = 0; b.x = 0.2; b.y = 0; b.vx = 0;
  if (dash) { a.dash.phase = 'burst'; a.dash.t = 0; a.vx = 5; } else { a.vx = 5; }
  stepN(s, 30);
  return b.vx;
}
(function () {
  const plain = hitTest(false), dashed = hitTest(true);
  ok(plain > 0 && dashed > plain * 1.5, '衝刺撞擊力較大：一般 ' + plain.toFixed(2) + ' / 衝刺 ' + dashed.toFixed(2));
})();

/* ---- 兩台都在衝刺：互相抵銷 ---- */
(function () {
  const s = match(2); park(s);
  const a = s.cars[0], b = s.cars[1];
  a.x = -0.6; a.y = 0; b.x = 0.6; b.y = 0;
  a.dash.phase = b.dash.phase = 'burst'; a.vx = 11; b.vx = -11; a.angle = 0; b.angle = Math.PI;
  R.step(s);
  ok(a.vx < 0 && b.vx > 0 && near(-a.vx, b.vx, 1e-6), '對撞互相抵銷、各自彈開');
  ok(a.dash.phase === 'idle' && b.dash.phase === 'idle', '對撞後衝刺結束');
})();

/* ---- 縮圈 ---- */
(function () {
  const s = match(2);
  ok(near(R.radiusAt(s, 5), s.arena.r0), '10 秒前不縮');
  ok(near(R.radiusAt(s, 45), s.arena.r0 * (1 - 0.75 * 0.5)), '等速縮小');
  ok(near(R.radiusAt(s, 80), s.arena.r0 * 0.25) && near(R.radiusAt(s, 89), s.arena.r0 * 0.25), '80 秒縮到 25% 後停住');
  const k = match(2, { sessionLevel: 'kid' });
  ok(near(R.radiusAt(k, 85), k.arena.r0 * 0.4), '幼幼本局難度縮到 40%');
  ok(match(3).arena.r0 === 7.5 && match(5).arena.r0 === 9, '擂台大小 2～4 人 7.5、5～6 人 9 車身');
})();

/* ---- 開局 2 秒內不會出界 ---- */
(function () {
  const s = match(2);
  const c = s.cars[0]; c.x = 0; c.y = 0;
  stepN(s, 60, () => R.setInput(s, 'p0', { mx: 1, my: 0 }));
  ok(c.alive && c.wobble === 0 || c.alive, '開局保護期間不會掉');
})();

/* ---- 搖搖欲墜：往內按救回、被撞直接掉、時間到掉落 ---- */
(function () {
  const s = match(3); s.t = 5; park(s);
  const c = s.cars[0]; c.x = s.arena.r - 0.02; c.y = 0; c.vx = 3;
  R.step(s);
  ok(c.wobble > 0 && near(c.wobbleMax, R.RESCUE.normal), '碰到邊緣進入搖搖欲墜（單機玩家用本局難度：普通 0.6 秒）');
  ok(c.alive, '搖搖欲墜時還沒出局');
  R.setInput(s, 'p0', { mx: -1, my: 0 }); R.step(s);
  ok(c.wobble === 0 && c.alive && c.stats.rescues === 1 && c.vx < 0, '往內按救回來');

  const s2 = match(3); s2.t = 5; park(s2);
  const d = s2.cars[0]; d.x = s2.arena.r - 0.02; d.y = 0; d.vx = 3;
  R.step(s2);
  stepN(s2, secs(0.7));
  ok(!d.alive, '搶救時間用完就掉落');
  ok(d.ghost !== null, '出局變幽靈');

  const s3 = match(3); s3.t = 5; park(s3);
  const v = s3.cars[0], h = s3.cars[1];
  v.x = s3.arena.r - 0.02; v.y = 0; v.vx = 3;
  R.step(s3);
  ok(v.wobble > 0, '補撞測試：先進入搖搖欲墜');
  h.x = v.x - 1.2; h.y = 0; h.vx = 4;
  stepN(s3, 12);
  ok(!v.alive, '搖搖欲墜時被撞一下直接掉');
  ok(h.stats.kos === 1, '撞飛數算給最後撞到的人');

  /* 電腦依自己的難度 */
  const s4 = R.createMatch({ seed: 'x', cars: [{ id: 'a', human: true }, { id: 'b', level: 'mythic' }, { id: 'c', level: 'kid' }], sessionLevel: 'hard' });
  ok(near(R.getCar(s4, 'a').wobbleMax, 0.4) && near(R.getCar(s4, 'b').wobbleMax, 0.25) && near(R.getCar(s4, 'c').wobbleMax, 1), '搶救時間：玩家依本局難度、電腦依自己難度');
  const s5 = R.createMatch({ seed: 'x', mode: 'online', cars: [{ id: 'a', human: true }, { id: 'b', level: 'hard' }], sessionLevel: 'kid' });
  ok(near(R.getCar(s5, 'a').wobbleMax, 0.6), '線上真人一律 0.6 秒');
})();

/* ---- 縮圈追上車子 ---- */
(function () {
  const s = match(3); park(s);
  s.t = 50;
  const c = s.cars[0]; const r = R.radiusAt(s, 50);
  c.x = r - 0.005; c.y = 0;
  stepN(s, 10);
  ok(c.wobble > 0 || !c.alive, '縮圈追上車子時進入搖搖欲墜');
})();

/* ---- 撞飛數歸屬 ---- */
(function () {
  const s = match(3); s.t = 10; park(s);
  const c = s.cars[0];
  c.lastHit = { by: 'p1', t: 6.5 };
  c.x = s.arena.r + 1; c.y = 0;
  R.step(s);
  ok(!c.alive && R.getCar(s, 'p1').stats.kos === 0, '超過 3 秒前的撞擊不算撞飛數');

  const s2 = match(3); s2.t = 10; park(s2);
  const c2 = s2.cars[0];
  c2.lastHit = { by: 'p2', t: 8 };
  c2.x = s2.arena.r + 1; c2.y = 0;
  R.step(s2);
  ok(R.getCar(s2, 'p2').stats.kos === 1, '3 秒內最後撞到的人得 1 分');

  const s3 = match(3); s3.t = 10; park(s3);
  const c3 = s3.cars[0];
  c3.x = s3.arena.r + 1; c3.y = 0;
  R.step(s3);
  ok(s3.cars.every((x) => x.stats.kos === 0), '自己掉下去不算任何人的');
})();

/* ---- 勝負：最後一台、時間到 ---- */
(function () {
  const s = match(3); s.t = 10; park(s);
  s.cars[0].x = 0; s.cars[0].y = 0;
  s.cars[1].x = s.arena.r + 1; s.cars[1].y = 0;
  s.cars[2].x = -s.arena.r - 1; s.cars[2].y = 0;
  R.step(s);
  ok(s.phase === 'over' && s.winner.id === 'p0', '最後留在場上的贏');
  const res = R.result(s);
  ok(res.rows.length === 3 && res.rows[0].place === 1 && res.rows[2].place === 3, '名次依出局順序');

  const t = match(3); park(t);
  t.cars.forEach((c, i) => { c.x = 0; c.y = 0; });
  t.cars[0].x = 3; t.cars[1].x = 1; t.cars[2].x = -5; t.cars[0].y = t.cars[1].y = t.cars[2].y = 0;
  t.cars[0].stats.kos = 2; t.cars[1].stats.kos = 1; t.cars[2].stats.kos = 1;
  t.t = 90 - 1 / 120; t.arena.r = 7.5;
  t.opts.shrink = false;
  R.step(t);
  ok(t.phase === 'over' && t.endReason === 'time', '90 秒時間到結束');
  ok(t.order.join(',') === 'p0,p1,p2', '時間到依撞飛數→離中心距離排名：' + t.order.join(','));
})();

/* ---- 道具 ---- */
(function () {
  const s = match(4, { items: true }); s.t = 2.1;
  stepN(s, secs(30));
  ok(s.items.filter((i) => !i.ghost).length <= 2, '場上道具最多 2 個');
  ok(s.items.length >= 1, '每 8 秒會出道具');

  const s2 = match(2, { items: true }); park(s2); s2.t = 3;
  const c = s2.cars[0]; c.x = 0; c.y = 0;
  s2.items.push({ id: 99, x: 0.3, y: 0, ghost: false, age: 1 });
  s2.items.push({ id: 98, x: -0.3, y: 0, ghost: false, age: 1 });
  R.step(s2);
  ok(c.item && s2.items.length === 1, '撿到收著，一次只能持有一個');

  /* 護盾 */
  const s3 = match(2, { items: true }); park(s3); s3.t = 3;
  const a = s3.cars[0], b = s3.cars[1];
  b.x = 0; b.y = 0; b.fx.shield = 5; a.x = -1.2; a.y = 0; a.vx = 5;
  stepN(s3, 20);
  ok(Math.abs(b.vx) < 0.01 && a.vx < 0 && b.fx.shield === 0, '護盾擋下一次撞擊、自己不被彈開');

  /* 鐵塊 */
  const s4 = match(2, { items: true }); park(s4); s4.t = 3;
  const a4 = s4.cars[0], b4 = s4.cars[1];
  b4.x = 0; b4.y = 0; b4.item = 'iron'; R.setInput(s4, 'p1', { item: true }); R.step(s4);
  ok(near(b4.fx.iron, 6, 0.05), '鐵塊 6 秒');
  a4.x = -2; a4.y = 0; a4.angle = 0; b4.x = 0.2; b4.vx = 0; a4.vx = 5;
  stepN(s4, 30);
  ok(b4.vx < hitTest(false) * 0.6, '鐵塊加重幾乎推不動：' + b4.vx.toFixed(2));

  /* 香蕉 */
  const s5 = match(2, { items: true }); park(s5); s5.t = 3;
  const a5 = s5.cars[0], b5 = s5.cars[1];
  a5.x = 0; a5.y = 0; a5.angle = 0; a5.item = 'banana';
  R.setInput(s5, 'p0', { item: true }); R.step(s5);
  ok(s5.bananas.length === 1 && s5.bananas[0].x < 0, '香蕉皮丟在車子後方');
  b5.x = s5.bananas[0].x - 1; b5.y = 0; b5.vx = 3;
  stepN(s5, 20);
  ok(b5.fx.spin > 0 && s5.bananas.length === 0, '踩到香蕉原地打轉');

  /* 磁鐵 */
  const s6 = match(2, { items: true }); park(s6); s6.t = 3;
  const a6 = s6.cars[0], b6 = s6.cars[1];
  a6.x = 0; a6.y = 0; b6.x = 3; b6.y = 0; a6.item = 'magnet';
  R.setInput(s6, 'p0', { item: true });
  stepN(s6, 30);
  ok(b6.x < 2.6, '磁鐵把附近的人吸過來');

  /* 彈簧 */
  const s7 = match(2, { items: true }); park(s7); s7.t = 3;
  const a7 = s7.cars[0];
  a7.x = 7; a7.y = 0; a7.item = 'spring';
  R.setInput(s7, 'p0', { item: true });
  stepN(s7, secs(0.7));
  ok(!a7.fx.spring && Math.hypot(a7.x, a7.y) < 2, '彈簧 0.6 秒後落在中央附近');

  /* 超級衝刺 */
  function superHit(sup) {
    const s8 = match(2, { items: true }); park(s8); s8.t = 3;
    const a8 = s8.cars[0], b8 = s8.cars[1];
    a8.x = -2; a8.y = 0; a8.angle = 0; b8.x = 0.2; b8.y = 0;
    a8.dash.phase = 'burst'; a8.vx = 11; a8.fx.superDash = sup;
    stepN(s8, 12);
    return { v: b8.vx, used: !a8.fx.superDash };
  }
  const n1 = superHit(false), n2 = superHit(true);
  ok(n2.v > n1.v * 1.4 && n2.used, '超級衝刺撞擊力加倍並消耗：' + n1.v.toFixed(2) + ' → ' + n2.v.toFixed(2));

  /* 幼幼沒有香蕉與磁鐵 */
  const k = match(2, { items: true, sessionLevel: 'kid' }); park(k);
  const seen = {};
  for (let i = 0; i < 300; i++) { const c0 = k.cars[0]; c0.item = null; k.items.push({ id: 1000 + i, x: c0.x, y: c0.y, age: 1 }); k.cars[0].x = 0; k.cars[0].y = 0; k.items[k.items.length - 1].x = 0; k.items[k.items.length - 1].y = 0; k.t = 3; R.step(k); if (c0.item) seen[c0.item] = 1; }
  ok(!seen.banana && !seen.magnet && Object.keys(seen).length >= 3, '幼幼沒有香蕉皮與磁鐵：' + Object.keys(seen).join(','));

  /* 落後補償：靠邊的人比較容易拿到彈簧與護盾 */
  function rate(edge) {
    const z = match(2, { items: true }); let good = 0;
    for (let i = 0; i < 400; i++) {
      const c0 = z.cars[0]; c0.item = null; c0.x = edge ? z.arena.r * 0.95 : 0; c0.y = 0;
      z.cars[1].x = -5; z.cars[1].y = 0; z.cars[1].stats.kos = edge ? 3 : 0;
      z.items = [{ id: i, x: c0.x, y: 0, age: 1 }];
      z.t = 3; z.phase = 'playing';
      R.step(z);
      if (c0.item === 'spring' || c0.item === 'shield') good++;
      c0.vx = c0.vy = 0; c0.wobble = 0; c0.alive = true;
    }
    return good / 400;
  }
  const rc = rate(false), re = rate(true);
  ok(re > rc + 0.1, '落後補償：中間 ' + rc.toFixed(2) + ' / 邊緣落後 ' + re.toFixed(2));

  /* 關閉道具 */
  const off = match(4, { items: false });
  stepN(off, secs(20));
  ok(off.items.length === 0, '關閉道具時不出道具');
})();

/* ---- 幽靈 ---- */
(function () {
  const s = match(4, { items: true }); s.t = 10; park(s);
  s.cars.forEach((c, i) => { c.x = (i - 1.5) * 1.5; c.y = 0; });
  const g = s.cars[0]; g.x = s.arena.r + 2; g.y = 0;
  R.step(s);
  ok(!g.alive && g.ghost, '出局變幽靈');
  g.ghost.cd = 0;
  const before = s.items.length;
  R.setInput(s, 'p0', { item: true }); R.step(s);
  const drop = s.items[s.items.length - 1];
  ok(s.items.length === before + 1 && drop.ghost, '幽靈可以往場上丟道具');
  ok(Math.hypot(drop.x, drop.y) < s.arena.r - 1.5, '幽靈道具落在擂台內 2～3 車身處');
  ok(near(g.ghost.cd, 10, 0.05), '幽靈丟道具冷卻 10 秒');
  R.setInput(s, 'p0', { mx: 0, my: 1 });
  const th = g.ghost.theta; stepN(s, 30, () => R.setInput(s, 'p0', { mx: 0, my: 1 }));
  ok(g.ghost.theta !== th, '幽靈沿外圈移動');
  stepN(s, 240, () => R.setInput(s, 'p0', { mx: 0, my: 1 }));
  ok(Math.abs(g.ghost.theta - Math.PI / 2) < 0.02, '搖桿指向哪個方位，幽靈就滑到那裡停住：' + g.ghost.theta.toFixed(3));
  stepN(s, 200, () => R.setInput(s, 'p0', { mx: -1, my: 0 }));
  ok(Math.abs(Math.abs(g.ghost.theta) - Math.PI) < 0.05, '改指左邊會繞到左邊');
  ok(Math.hypot(g.x, g.y) > s.arena.r0, '幽靈不能進入擂台');

  /* 只剩 2 台時幽靈停手 */
  const s2 = match(3, { items: true }); s2.t = 10; park(s2);
  s2.cars[1].x = 0; s2.cars[1].y = 0; s2.cars[2].x = 2; s2.cars[2].y = 0;
  s2.cars[0].x = s2.arena.r + 2; s2.cars[0].y = 0; R.step(s2);
  s2.cars[0].ghost.cd = 0;
  const n = s2.items.length;
  R.setInput(s2, 'p0', { item: true }); R.step(s2);
  ok(s2.items.length === n, '只剩 2 台存活時幽靈停手');

  /* 關閉道具時幽靈不能丟 */
  const s3 = match(4, { items: false }); s3.t = 10; park(s3);
  s3.cars.forEach((c, i) => { c.x = (i - 1.5) * 1.5; c.y = 0; });
  s3.cars[0].x = s3.arena.r + 2; R.step(s3);
  s3.cars[0].ghost.cd = 0;
  R.setInput(s3, 'p0', { item: true }); R.step(s3);
  ok(s3.items.length === 0, '關閉道具時幽靈不能丟道具');
})();

/* ---- 組隊 ---- */
(function () {
  const cars = [{ id: 'a', team: 0 }, { id: 'b', team: 0 }, { id: 'c', team: 1 }, { id: 'd', team: 1 }];
  const s = R.createMatch({ seed: 't', cars, teams: true, countdown: 0, items: false });
  ok(s.arena.r0 === 9, '組隊擂台半徑 9');
  park(s); s.t = 3;
  const a = s.cars[0], b = s.cars[1];
  a.x = -1.2; a.y = 0; a.dash.phase = 'burst'; a.vx = 11; a.angle = 0; b.x = 0; b.y = 0;
  stepN(s, 12);
  ok(b.vx < 4, '撞到隊友只會輕輕推開：' + b.vx.toFixed(2));
  ok(!b.lastHit, '撞隊友不記撞擊');
  const s2 = R.createMatch({ seed: 't', cars, teams: true, countdown: 0, items: false });
  park(s2); s2.t = 10;
  s2.cars[0].x = 0; s2.cars[0].y = 0; s2.cars[1].x = 9; s2.cars[1].y = 9;
  s2.cars[2].x = 30; s2.cars[2].y = 0; s2.cars[3].x = -30; s2.cars[3].y = 0;
  R.step(s2);
  ok(s2.phase === 'over' && s2.winner.team === 0, '最後剩一隊就贏');
})();

/* ---- 練習模式 ---- */
(function () {
  const s = R.practiceReset(R.createMatch({ seed: 'p', mode: 'practice', cars: [{ id: 'me', human: true }] }), 3);
  ok(s.phase === 'playing' && s.cars.length === 4, '練習：一台自己的車＋靶車');
  stepN(s, secs(100));
  ok(s.phase === 'playing' && s.arena.r === s.arena.r0, '練習：不計時、不縮圈');
  R.practiceGive(s, 'me', 'magnet');
  ok(R.getCar(s, 'me').item === 'magnet', '練習：道具自選');
})();

/* ---- 重現性：同種子同輸入，結果完全一樣 ---- */
(function () {
  function run() {
    const s = R.createMatch({ seed: 'repro', cars: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, level: R.LEVELS[i % 5] })), items: true });
    const brains = s.cars.map((c, i) => AI.create(c.level, 'r' + i));
    for (let i = 0; i < 60 * 95 && s.phase !== 'over'; i++) {
      s.cars.forEach((c, k) => R.setInput(s, c.id, AI.think(s, c, brains[k])));
      R.step(s);
    }
    return JSON.stringify(R.snapshot(s)) + JSON.stringify(R.result(s));
  }
  ok(run() === run(), '同種子同輸入，伺服器與客戶端跑出相同結果');
})();

/* ---- 快照往返 ---- */
(function () {
  const s = match(4, { items: true });
  stepN(s, 600);
  const snap = R.snapshot(s);
  const t = match(4, { items: true });
  R.applySnapshot(t, JSON.parse(JSON.stringify(snap)));
  ok(JSON.stringify(R.snapshot(t)) === JSON.stringify(snap), '快照套用後一致');
  ok(JSON.stringify(snap).length < 2600, '快照大小（6 台以內）約 ' + JSON.stringify(snap).length + ' bytes');
})();

/* ---- 效能：單房每拍 < 1ms ---- */
(function () {
  const s = R.createMatch({ seed: 'perf', cars: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, level: 'hard' })), items: true, countdown: 0 });
  const brains = s.cars.map((c, i) => AI.create('hard', 'p' + i));
  const t0 = process.hrtime.bigint();
  let n = 0;
  for (; n < 5000 && s.phase !== 'over'; n++) { s.cars.forEach((c, k) => R.setInput(s, c.id, AI.think(s, c, brains[k]))); R.step(s); }
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  ok(per < 1, '6 台＋電腦每步 ' + per.toFixed(4) + ' ms');
})();

console.log((fail ? '✗' : '✓') + ' 規則測試 ' + pass + ' 項通過' + (fail ? '，' + fail + ' 項失敗' : ''));
process.exitCode = fail ? 1 : 0;
