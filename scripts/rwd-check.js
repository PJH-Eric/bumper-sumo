/* scripts/rwd-check.js — 全畫面 × 全裝置 RWD／UIUX 機器驗收（FROZEN 門檻，不要為了過關而放寬）
 * 每個畫面在每個視窗尺寸下檢查：
 *   R1 頁面沒有水平溢出（scrollWidth <= innerWidth）
 *   R2 可見的按鈕／連結／輸入框完整落在視窗內，或位於自己的捲動區內（可捲到）
 *   R3 可見的按鈕命中區高度 >= 44px（觸控）
 *   R4 按鈕文字沒有被裁切（scrollWidth <= clientWidth）
 *   R5 內容超出時，對應的自訂捲軸拇指可見（高度 > 0、不透明）
 * 用法：先 npm start（port 3250），再 node scripts/rwd-check.js [baseUrl]
 * 輸出失敗清單（畫面／裝置／元素／原因），結尾回傳非 0 代表未通過。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://localhost:3250/';
const LANG = process.env.LANG_CHECK || 'zh-Hant';
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));

const DEVICES = [
  { key: 'phone', w: 390, h: 844, touch: true },
  { key: 'phone-small', w: 360, h: 640, touch: true },
  { key: 'phoneL', w: 844, h: 390, touch: true },
  { key: 'tabletP', w: 820, h: 1180, touch: true },
  { key: 'tabletL', w: 1180, h: 820, touch: true },
  { key: 'desktop', w: 1440, h: 900, touch: false }
];
const SCREENS = ['home', 'solo', 'practice', 'howto', 'records', 'lobby', 'room', 'game', 'result', 'share', 'settings', 'pause', 'confirm'];

/* 在頁面內執行的檢查：回傳失敗清單 */
function auditPage() {
  const fails = [];
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    let p = el;
    while (p) { if (p.hidden || (p.getAttribute && p.getAttribute('aria-hidden') === 'true' && p.id !== 'toast')) return false; p = p.parentElement; }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 14) + '"';
  const W = window.innerWidth, H = window.innerHeight;
  const insideScroller = (el) => { let p = el.parentElement; while (p && p !== document.body) { if (p.classList && (p.classList.contains('sa-view') || p.classList.contains('result-scroll'))) return true; if (p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY !== 'visible') return true; p = p.parentElement; } return false; };

  /* R1 */
  if (document.documentElement.scrollWidth > W + 1) fails.push({ rule: 'R1', el: 'page', why: 'scrollWidth ' + document.documentElement.scrollWidth + ' > ' + W });

  const targets = Array.from(document.querySelectorAll('button, a[href], input, [role="switch"], [role="slider"], [role="radio"], .dd-btn, .st-btn'));
  for (const el of targets) {
    if (!vis(el) || el.closest('.dd-list') || el.closest('#dd-lang') && !el.classList.contains('dd-btn')) continue;
    if (el.closest('.modal') && !el.closest('.modal').classList.contains('open') && el.closest('.modal').hidden) continue;
    const r = el.getBoundingClientRect();
    const name = label(el);
    /* R2 */
    const offscreen = r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1;
    if (offscreen && !insideScroller(el) && !el.closest('.touch') && !el.closest('.hud-top') && !el.closest('.topbar-global') && !el.closest('.joy-zone') && !el.closest('.tbtns')) {
      fails.push({ rule: 'R2', el: name, why: 'rect ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ' outside ' + W + 'x' + H });
    }
    /* R3：觸控命中區（遊戲內的觸控按鈕與小型鍵盤提示略過） */
    if (!el.closest('.touch') && !el.classList.contains('sw') && !el.classList.contains('sl-track') && !el.closest('.slider') && !el.classList.contains('dd-opt') && !el.closest('.chat-log') && !el.classList.contains('dd-list')) {
      if (r.height < 44 && el.id !== 'res-home' && !el.closest('.dd-list')) fails.push({ rule: 'R3', el: name, why: 'height ' + Math.round(r.height) + ' < 44' });
    }
    /* R4 */
    if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') fails.push({ rule: 'R4', el: name, why: 'text clipped ' + el.scrollWidth + '>' + el.clientWidth });
  }
  /* R5：溢出的捲動區必須有可見的自訂拇指 */
  for (const sa of document.querySelectorAll('.sa')) {
    if (!vis(sa)) continue;
    const view = sa.querySelector('.sa-view');
    if (!view || view.scrollHeight <= view.clientHeight + 2) continue;
    const thumb = sa.querySelector(':scope > .sa-track:not(.sa-h) .sa-thumb');
    if (!thumb || thumb.offsetHeight < 8 || getComputedStyle(thumb.parentElement).opacity !== '1') {
      fails.push({ rule: 'R5', el: '.sa ' + (sa.id || sa.className.split(' ')[0]), why: 'overflow ' + view.scrollHeight + '>' + view.clientHeight + ' but no visible custom thumb' });
    }
  }
  return fails;
}

/* 把每個畫面叫到前景（使用 app 的 hooks，等同使用者操作後的狀態） */
async function setScreen(page, name) {
  await page.evaluate(() => {
    const A = window.BumperApp, UI = window.UI, S = A.S;
    UI.Modal.any() && [...document.querySelectorAll('.modal.open')].forEach((m) => UI.Modal.close(m.id));
  });
  switch (name) {
    case 'home': await page.evaluate(() => window.BumperApp.show('home')); break;
    case 'solo': await page.evaluate(() => window.BumperApp.openSolo()); break;
    case 'practice': await page.evaluate(() => window.BumperApp.startPractice()); break;
    case 'howto': await page.evaluate(() => window.BumperApp.show('howto')); break;
    case 'records': await page.evaluate(() => { window.BumperApp.show('home'); document.getElementById('btn-records').click(); }); break;
    case 'lobby': await page.evaluate(() => window.BumperApp.show('lobby')); break;
    case 'room': await page.evaluate(() => { window.BumperApp.show('room'); }); break;
    case 'game': await page.evaluate(() => window.BumperApp.startSolo()); await page.waitForTimeout(300); break;
    case 'result': await page.evaluate(() => window.BumperApp.startSolo()); await page.waitForFunction(() => window.BumperApp.S.match.phase === 'playing', null, { timeout: 8000 }); await page.waitForTimeout(2300); await page.evaluate(() => { const S = window.BumperApp.S; S.match.cars.forEach((c) => { if (c.id !== 'me') { c.x = 40; c.lastHit = { by: 'me', t: S.match.t }; } }); }); await page.waitForSelector('#result:not([hidden])', { timeout: 8000 }); await page.waitForTimeout(400); break;
    case 'share': await setScreen(page, 'result'); await page.click('#res-share'); await page.waitForTimeout(500); break;
    case 'settings': await page.evaluate(() => window.BumperApp.show('home')); await page.click('#btn-settings'); await page.waitForTimeout(250); break;
    case 'pause': await setScreen(page, 'game'); await page.keyboard.press('Escape'); await page.waitForTimeout(250); break;
    case 'confirm': await page.evaluate(() => window.BumperApp.show('home')); await page.click('#btn-settings'); await page.click('#b-clear-records'); await page.waitForTimeout(250); break;
  }
  await page.waitForTimeout(250);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const results = [];
  let total = 0;
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, isMobile: d.touch, hasTouch: d.touch, deviceScaleFactor: 1 });
    await ctx.addInitScript((lang) => { try { localStorage.setItem('bumper-sumo:v1:lang', lang); } catch (e) {} }, LANG);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    for (const s of SCREENS) {
      try {
        await setScreen(page, s);
        const f = await page.evaluate(auditPage);
        total++;
        f.forEach((x) => results.push({ device: d.key, screen: s, ...x }));
      } catch (e) {
        results.push({ device: d.key, screen: s, rule: 'RUN', el: 'harness', why: String(e.message).split('\n')[0] });
      }
      await page.evaluate(() => window.BumperApp.show('home')).catch(() => {});
    }
    await ctx.close();
  }
  await browser.close();
  const byKey = {};
  results.forEach((r) => { const k = r.device + ' / ' + r.screen + ' / ' + r.rule; (byKey[k] = byKey[k] || []).push(r); });
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 2));
  Object.keys(byKey).forEach((k) => console.log('✗ ' + k + '  ×' + byKey[k].length + '  e.g. ' + byKey[k][0].el + ' — ' + byKey[k][0].why));
  console.log((results.length ? '✗' : '✓') + ' RWD 檢查：' + total + ' 組畫面×裝置，' + results.length + ' 項失敗');
  process.exitCode = results.length ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
