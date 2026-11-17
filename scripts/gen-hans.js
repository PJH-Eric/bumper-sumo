/* scripts/gen-hans.js — 用 OpenCC（opencc-js，台灣繁體 → 大陸簡體＋慣用詞）把繁中字典轉成簡中
 * 產出 public/js/locales-hans.js（自動產生、勿手改）。用法：npm run gen:hans
 * 繁中（public/js/locales.js 的 zh-Hant）是唯一中文原稿；改完繁中要重跑，tests/localization.js 會檢查是否同步。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const OpenCC = require('opencc-js');

const convert = OpenCC.Converter({ from: 'twp', to: 'cn' });
/* 校對：OpenCC 轉完後仍不自然的遊戲用語 */
const FIX = [['线上', '在线'], ['伺服器', '服务器'], ['重新整理', '刷新'], ['预设', '默认'], ['讯息', '消息'], ['暱称', '昵称'], ['纪录', '记录']];

function toHans(s) {
  let out = convert(String(s));
  for (const [a, b] of FIX) out = out.split(a).join(b);
  return out;
}

function load() {
  const d = {};
  const box = { I18N: { register: (l, v) => { d[l] = Object.assign(d[l] || {}, v); } } };
  box.window = box;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'locales.js'), 'utf8'), box);
  return d;
}

function build() {
  const d = load();
  const hans = {};
  Object.keys(d['zh-Hant']).sort().forEach((k) => { hans[k] = toHans(d['zh-Hant'][k]); });
  return '/* ===== locales-hans.js — 簡中字串（由 scripts/gen-hans.js 以 OpenCC 自動產生，請勿手改） ===== */\n' +
    '(function (root) {\n  \'use strict\';\n  root.I18N.register(\'zh-Hans\', ' + JSON.stringify(hans, null, 2).replace(/\n/g, '\n  ') + ');\n}(typeof window !== \'undefined\' ? window : globalThis));\n';
}

module.exports = { toHans, build };
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'locales-hans.js'), build(), 'utf8');
  console.log('✓ 已產生 public/js/locales-hans.js');
}
