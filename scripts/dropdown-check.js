/* scripts/dropdown-check.js — 全部下拉選單 × 6 種尺寸 × 繁中／英文：
 *   每個畫面的每個下拉（含右上角語言），分別把按鈕捲到上／中／下（會往下開也會往上開），點開後檢查：
 *   清單真的看得到（有高度、在畫面內、中心點沒被別的東西蓋住）、點最後一項會生效並關閉
 * 用法：先 npm start（port 3250），再 node scripts/dropdown-check.js [baseUrl] */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:3250/';
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const DEV = [[390, 844, true], [360, 640, true], [844, 390, true], [820, 1180, true], [1180, 820, true], [1440, 900, false]];

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  let bad = 0, n = 0;
  for (const lang of ['zh-Hant', 'en']) for (const [w, h, touch] of DEV) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch });
    await ctx.addInitScript((l) => localStorage.setItem('bumper-sumo:v1:lang', l), lang);
    const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(300);
    const tap = async (x, y) => { if (touch) await p.touchscreen.tap(x, y); else await p.mouse.click(x, y); };
    const screens = [
      ['home', async () => {}],
      ['solo', async () => { await p.evaluate(() => window.BumperApp.openSolo()); for (let i = 0; i < 3; i++) await p.evaluate(() => { const b = document.querySelector('#s-solo .stepper button:last-child'); b && b.click(); }); }],
      ['room', async () => {
        await p.evaluate(() => window.BumperApp.show('home')); await p.waitForTimeout(150);
        await p.click('#btn-online'); await p.waitForFunction(() => window.BumperNet.connected(), null, { timeout: 8000 });
        await p.fill('#lobby-name', 'T'); await p.click('#lobby-create'); await p.waitForSelector('#s-room:not([hidden])');
        for (let i = 0; i < 2; i++) { await p.evaluate(() => { const b = document.querySelector('#room-seats .empty-seat .btn'); b && b.click(); }); await p.waitForTimeout(250); }
      }]
    ];
    for (const [scr, go] of screens) {
      await go(); await p.waitForTimeout(250);
      const sel = scr === 'home' ? '.topbar-global .dd' : '#s-' + scr + ' .dd';
      const count = await p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((d) => d.offsetParent && !d.querySelector('.dd-btn').disabled).length, sel);
      for (let i = 0; i < count; i++) for (const pos of ['top', 'center', 'bottom']) {
        if (scr === 'home' && pos !== 'top') continue;
        const pt = await p.evaluate(([sel, i, pos]) => {
          const dd = [...document.querySelectorAll(sel)].filter((d) => d.offsetParent && !d.querySelector('.dd-btn').disabled)[i], btn = dd.querySelector('.dd-btn'), v = btn.closest('.sa-view');
          if (v) { const vr = v.getBoundingClientRect(), br = btn.getBoundingClientRect(); const target = pos === 'top' ? vr.top + br.height : pos === 'bottom' ? vr.bottom - br.height * 1.6 : (vr.top + vr.bottom) / 2; v.scrollTop += br.top - target; }
          const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.textContent.trim().slice(0, 10) };
        }, [sel, i, pos]);
        await p.waitForTimeout(120);
        await tap(pt.x, pt.y); await p.waitForTimeout(250);
        const st = await p.evaluate(([sel, i]) => {
          const dd = [...document.querySelectorAll(sel)].filter((d) => d.offsetParent && !d.querySelector('.dd-btn').disabled)[i]._dd, L = dd.list, r = L.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 28));
          const last = dd.ul.lastElementChild, lr = last ? last.getBoundingClientRect() : null;
          return { open: L.classList.contains('open') && L.isConnected, h: Math.round(r.height), inView: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, onTop: !!top && L.contains(top), cover: top && !L.contains(top) ? String(top.id || top.className).slice(0, 30) : '', n: dd.ul.children.length };
        }, [sel, i]);
        n++;
        const okOpen = st.open && st.h > 40 && st.inView && st.onTop;
        let okPick = true;
        if (okOpen) {
          // 捲到最後一項並點它
          const lp = await p.evaluate(([sel, i]) => { const dd = [...document.querySelectorAll(sel)].filter((d) => d.offsetParent && !d.querySelector('.dd-btn').disabled)[i]._dd; const last = dd.ul.lastElementChild; const v = dd.list.querySelector('.sa-view'); v.scrollTop = v.scrollHeight; const r = last.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, v: last.dataset.value }; }, [sel, i]);
          await p.waitForTimeout(80);
          await tap(lp.x, lp.y); await p.waitForTimeout(200);
          okPick = await p.evaluate(([sel, i, v]) => { const dd = [...document.querySelectorAll(sel)].filter((d) => d.offsetParent)[i]; if (!dd || !dd._dd) return true; return !dd._dd.list.classList.contains('open') && (v == null || String(dd._dd.get()) === String(v)); }, [sel, i, lp.v]);
        }
        if (!okOpen || !okPick) { bad++; console.log('✗', lang, w + 'x' + h, scr, pt.label, pos, okOpen ? '選了最後一項沒生效' : JSON.stringify(st)); }
        await p.keyboard.press('Escape'); await p.waitForTimeout(80);
        if (scr === 'home') { await p.evaluate((l) => { localStorage.setItem('bumper-sumo:v1:lang', l); }, lang); await p.reload(); await p.waitForTimeout(300); }
      }
    }
    await ctx.close();
  }
  console.log(bad ? '✗ 下拉選單 ' + bad + '/' + n + ' 組失敗' : '✓ 下拉選單全部看得到、選得到（' + n + ' 組）');
  await b.close(); process.exitCode = bad ? 1 : 0;
})();
