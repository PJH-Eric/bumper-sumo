/* 電腦互打：五段難度同場混戰各打 N 局，勝率要「神話 > 困難 > 普通 > 簡單 > 幼幼」 */
'use strict';
const Rules = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');

const NDEF = +(process.argv[2]) || 200;
const LV = Rules.LEVELS;

function play(seed, levels, items) {
  const cars = levels.map((lv, i) => ({ id: 'c' + i, name: lv, level: lv, skin: i }));
  const s = Rules.createMatch({ seed, cars, items, sessionLevel: 'normal' });
  const brains = s.cars.map((c, i) => AI.create(c.level, seed + ':' + i));
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 60 * 100) {
    s.cars.forEach((c, i) => Rules.setInput(s, c.id, AI.think(s, c, brains[i])));
    Rules.step(s);
  }
  return Rules.result(s);
}

function ladder(n) {
  const N = n || NDEF;
  const wins = {}, place = {};
  LV.forEach((l) => { wins[l] = 0; place[l] = 0; });
  const t0 = Date.now();
  for (let g = 0; g < N; g++) {
    // 每局打亂出生位置，避免座位偏差
    const order = LV.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = (g * 7 + i * 13) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const res = play((process.env.LADDER_SEED || 'ladder') + g, order, g % 2 === 0);
    res.rows.forEach((r) => { place[r.level] += r.place; if (r.place === 1) wins[r.level]++; });
  }
  const ms = Date.now() - t0;
  return { wins, place, ms };
}

if (require.main === module) {
  const N = NDEF;
  const { wins, place, ms } = ladder(N);
  LV.forEach((l) => console.log(l.padEnd(7), 'win', String(wins[l]).padStart(4), (wins[l] / N * 100).toFixed(1).padStart(6) + '%', 'avg place', (place[l] / N).toFixed(2)));
  console.log('time', ms, 'ms /', N, 'games');
  let ok = true;
  for (let i = 1; i < LV.length; i++) if (!(wins[LV[i]] > wins[LV[i - 1]])) ok = false;
  console.log(ok ? '✓ 勝率排序正確：神話 > 困難 > 普通 > 簡單 > 幼幼' : '✗ 排序不正確');
  process.exitCode = ok ? 0 : 1;
}
module.exports = { play, ladder };
