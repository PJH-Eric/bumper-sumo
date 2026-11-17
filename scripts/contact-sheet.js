/* scripts/contact-sheet.js — 把 shots/ 的截圖依裝置拼成總覽圖（檢視用） */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const DIR = path.join(__dirname, '..', 'shots');
const lang = process.argv[2] || 'zh-Hant';
const devs = (process.argv[3] || 'phone,phoneL,tabletP,tabletL,desktop').split(',');
const ORDER = ['home', 'solo', 'countdown', 'game', 'result', 'share', 'settings', 'records', 'howto', 'practice', 'lobby', 'room'];
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const d of devs) {
    const files = ORDER.map((n) => `${lang}-${d}-${n}.png`).filter((f) => fs.existsSync(path.join(DIR, f)));
    const land = /L$|desktop/.test(d);
    const cols = land ? 4 : 6, w = land ? 420 : 260;
    const html = '<body style="margin:0;background:#222;color:#fff;font:12px sans-serif;display:grid;grid-template-columns:repeat(' + cols + ',' + w + 'px);gap:6px;padding:6px">' +
      files.map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(path.join(DIR, f)).toString('base64')}" style="width:${w}px;display:block"><figcaption>${f}</figcaption></figure>`).join('') + '</body>';
    const p = await b.newPage({ viewport: { width: cols * (w + 6) + 6, height: 600 } });
    await p.setContent(html); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(DIR, `sheet-${lang}-${d}.png`), fullPage: true });
    await p.close();
  }
  await b.close();
})();
