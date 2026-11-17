/* scripts/header-fit-check.js — 7 種尺寸 × 繁中／簡中／English × 5 個畫面：
 * 標題列（返回、標題、連線狀態、在線人數）與對局 HUD 都不被右上角語言／設定鈕蓋住，且標題跟返回鍵在同一行
 * 用法：先 npm start（port 3250），再 node scripts/header-fit-check.js [baseUrl] */
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.argv[2] || 'http://localhost:3250/';
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const DEV=[[360,640],[390,844],[844,390],[667,375],[820,1180],[1180,820],[1440,900]];
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  let bad = 0, n = 0;
  for (const lang of ['zh-Hant','zh-Hans','en']) for (const [w,h] of DEV) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w<1300, hasTouch: w<1300 });
    await ctx.addInitScript((l) => localStorage.setItem('bumper-sumo:v1:lang', l), lang);
    const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(300);
    for (const scr of ['solo','howto','records','lobby','game']) {
      await p.evaluate((s) => { const A = window.BumperApp; if (s==='solo') A.openSolo(); else if (s==='game') A.startSolo(); else if (s==='lobby') { A.show('lobby'); const c=document.getElementById('lobby-conn'); c.textContent = document.documentElement.lang==='en'?'Connected':'已連線'; c.className='conn ok'; const o=document.getElementById('lobby-online'); o.hidden=false; o.textContent='● 12'; } else A.show(s); }, scr);
      await p.waitForTimeout(250); n++;
      const r = await p.evaluate((s) => { const g = document.querySelector('.topbar-global').getBoundingClientRect();
        const sel = s === 'game' ? '#s-game .hud-top > *' : '#s-' + s + ' .scr-head > *';
        const hits = [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).display==='none' || e.hidden) return false; return !(r.right <= g.left || r.left >= g.right || r.bottom <= g.top || r.top >= g.bottom); }).map(e => e.id || e.className);
        return hits; }, scr);
      if (r.length) { bad++; console.log('✗', lang, w+'x'+h, scr, r.join(',')); }
      if (scr !== 'game') {   // 標題要跟返回鍵同一行（不能被擠到第二行）
        const same = await p.evaluate((s) => { const bb = document.querySelector('#s-' + s + ' .back-btn').getBoundingClientRect(), hh = document.querySelector('#s-' + s + ' .scr-head h2').getBoundingClientRect(); return hh.top < bb.bottom && hh.bottom > bb.top; }, scr);
        if (!same) { bad++; console.log('✗ 標題換到第二行', lang, w + 'x' + h, scr); }
      }
      await p.evaluate(() => window.BumperApp.show('home'));
    }
    await ctx.close();
  }
  console.log(bad ? '✗ 標題列被蓋住 ' + bad + '/' + n + ' 組' : '✓ 標題列與 HUD 不被全域鈕蓋住（' + n + ' 組）'); await b.close(); process.exitCode = bad ? 1 : 0;
})();
