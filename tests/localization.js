/* 多語系完整性：程式與 HTML 用到的 key 在繁中／簡中／英文都要有；簡中要與繁中同步 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const dicts = {};
const box = { I18N: { register: (l, v) => { dicts[l] = Object.assign(dicts[l] || {}, v); } } };
box.window = box; box.globalThis = box;
for (const f of ['locales.js', 'locales-hans.js']) vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js', f), 'utf8'), box);

const used = new Set();
const dynamic = [];
const js = ['app.js', 'share.js', 'records.js'].map((f) => fs.readFileSync(path.join(root, 'public/js', f), 'utf8')).join('\n');
for (const m of js.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) { if (m[1].endsWith('.')) dynamic.push(m[1]); else used.add(m[1]); }
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const m of html.matchAll(/data-i18n(?:-aria|-ph|-title|-content|-tip|-html)?="([^"]+)"/g)) used.add(m[1]);
/* 伺服器送來的系統訊息 key */
const rooms = fs.readFileSync(path.join(root, 'lib/rooms.js'), 'utf8');
for (const m of rooms.matchAll(/'(chat\.sys\.[a-z]+)'/g)) used.add(m[1]);
/* 成就 id 從 records.js 讀 */
const recBox = { window: {} }; recBox.window = recBox; vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/records.js'), 'utf8'), recBox);
const ACH_IDS = recBox.BumperRecords.ACH.map((a) => a.id);
/* 共用模組（延遲徽章）用到的 key */
for (const m of fs.readFileSync(path.join(root, 'public/js/latency.js'), 'utf8').matchAll(/tr\('([a-zA-Z.]+)'/g)) used.add(m[1]);
/* 動態 key 的已知值 */
const DYN = {
  'animal.': ['bear', 'cat', 'frog', 'chick', 'rabbit', 'fox', 'pig', 'penguin', 'dummy'],
  'lv.': ['kid', 'easy', 'normal', 'hard', 'mythic'],
  'item.': ['super', 'iron', 'banana', 'magnet', 'shield', 'spring'],
  'itemd.': ['super', 'iron', 'banana', 'magnet', 'shield', 'spring'],
  'theme.': ['park', 'ice', 'beach', 'candy', 'volcano', 'space', 'forest', 'sea', 'market', 'castle'],
  'mode.': ['ffa', '2v2', '3v3'], 'team.': ['0', '1'],
  'quick.': ['hi', 'gg', 'nice', 'oops', 'again', 'wait', 'go', 'lol'],
  'room.becameSpectator.': ['full', 'playing'],
  'err.': ['nohello', 'badname', 'notfound', 'closed', 'badtoken', 'specfull', 'full', 'playing', 'notplayer', 'nothost', 'needtwo', 'notready', 'teamcount', 'badslot', 'badlevel', 'skintaken', 'offline', 'timeout', 'error'],
  'chat.err.': ['fast', 'empty', 'notjoined'],
  'rec.newBest.': ['kos', 'survive', 'rescues'],
  'ach.': ACH_IDS, 'achd.': ACH_IDS
};
for (const p of dynamic) { assert.ok(DYN[p], '未登記的動態 key 前綴：' + p); DYN[p].forEach((v) => used.add(p + v)); }
/* 伺服器回傳的錯誤碼都要有翻譯 */
for (const m of rooms.matchAll(/code: '([a-z]+)'/g)) used.add('err.' + m[1]);

const missing = [];
for (const lang of ['zh-Hant', 'zh-Hans', 'en']) for (const k of used) if (dicts[lang][k] == null) missing.push(lang + ':' + k);
assert.deepStrictEqual(missing, [], '缺少翻譯：\n' + missing.join('\n'));
const a = Object.keys(dicts['zh-Hant']).sort().join(','), b = Object.keys(dicts.en).sort().join(','), c = Object.keys(dicts['zh-Hans']).sort().join(',');
assert.strictEqual(a, b, '繁中與英文 key 不一致');
assert.strictEqual(a, c, '簡中沒有同步（請執行 node scripts/gen-hans.js）');
assert.strictEqual(fs.readFileSync(path.join(root, 'public/js/locales-hans.js'), 'utf8'), require('../scripts/gen-hans.js').build(), '簡中檔案不是最新（請執行 node scripts/gen-hans.js）');
for (const [k, v] of Object.entries(dicts.en)) assert.ok(!/[一-鿿]/.test(v), '英文字串含中文：' + k);
/* UTF-8 無 BOM */
for (const f of ['public/index.html', 'public/js/locales.js', 'public/js/locales-hans.js', 'public/js/app.js']) {
  assert.notStrictEqual(fs.readFileSync(path.join(root, f))[0], 0xEF, f + ' 不可有 BOM');
}
console.log('✓ 多語系檢查通過：' + used.size + ' 個 key × 3 種語言');
