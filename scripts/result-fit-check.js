/* scripts/result-fit-check.js — 結算卡在各尺寸（含矮橫向手機）× 繁中／英文：
 *   不被右上角語言／設定鈕蓋住，且「再來一局／分享／回到設定／回到首頁」都完整在畫面內
 * 用法：先 npm start（port 3250），再 node scripts/result-fit-check.js [baseUrl] */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:3250/';
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const DEV=[[390,844],[360,640],[844,390],[667,375],[932,430],[820,1180],[1180,820],[1440,900]];
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  let bad=0;
  for (const lang of ['zh-Hant','en']) for (const [w,h] of DEV) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    await ctx.addInitScript((l) => localStorage.setItem('bumper-sumo:v1:lang', l), lang);
    const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(300);
    await p.evaluate(() => window.BumperApp.startSolo());
    await p.waitForFunction(() => window.BumperApp.S.match.phase === 'playing', null, { timeout: 8000 });
    await p.waitForTimeout(2300); await p.evaluate(() => { const S = window.BumperApp.S; S.match.cars.forEach((c) => { if (c.id !== 'me') { c.x = 40; c.lastHit = { by: 'me', t: S.match.t }; } }); });
    await p.waitForSelector('#result:not([hidden])', { timeout: 8000 }); await p.waitForTimeout(500);
    const r = await p.evaluate(() => { const g=document.querySelector('.topbar-global').getBoundingClientRect(), c=document.querySelector('.result-card').getBoundingClientRect();
      const ov = !(c.right<=g.left||c.left>=g.right||c.bottom<=g.top||c.top>=g.bottom); const btns=[...document.querySelectorAll('.result-actions .btn,.result-actions button')].map(x=>x.getBoundingClientRect()); const off=btns.some(x=>x.bottom>innerHeight+1||x.right>innerWidth+1); return {ov, off, cw:Math.round(c.width), ch:Math.round(c.height)}; });
    if (r.ov||r.off) bad++;
    if (r.ov || r.off) console.log('✗', lang, w + 'x' + h, JSON.stringify(r));
    await ctx.close();
  }
  console.log(bad ? '✗ 結算卡版面 ' + bad + ' 組失敗' : '✓ 結算卡不被全域鈕蓋住、按鈕都在畫面內（' + DEV.length * 2 + ' 組）'); await b.close(); process.exitCode = bad ? 1 : 0;
})();
