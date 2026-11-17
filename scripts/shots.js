/* scripts/shots.js — 用本機 Chrome／Edge 開遊戲拍各畫面截圖（開發與驗收用，截圖存在 shots/，不進 git）
 * 用法：node scripts/shots.js [baseUrl] [lang] [only]   需要先 npm start */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://localhost:3250/';
const LANG = process.argv[3] || 'zh-Hant';
const ONLY = process.argv[4] || '';
const OUT = path.join(__dirname, '..', 'shots');
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));

const SIZES = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  phoneL: { width: 844, height: 390, isMobile: true, hasTouch: true },
  tabletP: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  tabletL: { width: 1180, height: 820, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false }
};

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const errors = [];
  for (const [key, vp] of Object.entries(SIZES)) {
    if (ONLY && !ONLY.split(',').includes(key)) continue;
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
    await ctx.addInitScript((lang) => { localStorage.setItem('bumper-sumo:v1:lang', lang); }, LANG);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(key + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|apple-touch|404/.test(m.text() + (m.location().url || ''))) errors.push(key + ' console: ' + m.text()); });
    const shot = async (name) => page.screenshot({ path: path.join(OUT, `${LANG}-${key}-${name}.png`) });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await shot('home');
    await page.click('#btn-solo'); await page.waitForTimeout(400); await shot('solo');
    await page.click('#solo-start'); await page.waitForTimeout(600); await shot('countdown');
    await page.waitForTimeout(3200);
    await page.evaluate(() => { const m = window.BumperApp.S.match; m.t = 40; m.arena.r = window.BumperRules.radiusAt(m, 40); });
    await page.waitForTimeout(1500); await shot('game');
    /* 直接跑到結束：把其他車丟出場 */
    await page.evaluate(() => { const S = window.BumperApp.S; S.match.cars.forEach((c) => { if (c.id !== 'me') { c.x = 40; c.lastHit = { by: 'me', t: S.match.t }; } }); });
    await page.waitForTimeout(2200); await shot('result');
    await page.click('#res-share'); await page.waitForSelector('#share-img:not([hidden])', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(200); await shot('share');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.click('#btn-settings'); await page.waitForTimeout(300); await shot('settings');
    await page.keyboard.press('Escape');
    await page.click('#res-home'); await page.waitForTimeout(300);
    await page.click('#btn-records'); await page.waitForTimeout(300); await shot('records');
    await page.click('#s-records .back-btn');
    await page.click('#btn-howto'); await page.waitForTimeout(300); await shot('howto');
    await page.click('#s-howto .back-btn');
    await page.click('#btn-practice'); await page.waitForTimeout(1200); await shot('practice');
    await page.click('#pr-exit');
    await page.click('#btn-online'); await page.waitForTimeout(1500); await shot('lobby');
    await page.fill('#lobby-name', LANG === 'en' ? 'Tester' : '測試員');
    await page.click('#lobby-create'); await page.waitForTimeout(800); await shot('room');
    await ctx.close();
  }
  await browser.close();
  if (errors.length) { console.log('頁面錯誤：\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('✓ 截圖完成：' + OUT);
}
run().catch((e) => { console.error(e); process.exit(1); });
