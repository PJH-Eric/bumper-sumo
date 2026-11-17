/* scripts/browser-check.js — 無頭瀏覽器操作檢查（需要 npm start 與本機 Chrome／Edge）
 * 單機路徑不連後端、語言切換（相鄰設定鈕、保存、不重置對局）、設定彈窗（Escape／焦點／恢復預設）、
 * 倒數期間不能動、最後 10 秒提示、完整一局＋結算三動作＋分享圖片、再來一局重新倒數、紀錄去重與清除確認、
 * （所有瀏覽器環境固定 zh-TW 語系，避免系統語言不同造成自動切到英文而誤判）
 * 自訂捲軸、各尺寸無水平溢出、邀請連結先停在大廳確認暱稱、線上兩人＋電腦開局、觀戰不能操作。 */
'use strict';
const fs = require('fs');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:3250/';
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
function ok(c, name) { if (c) pass++; else { fail++; console.log('✗ ' + name); } }

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = [];
  page.on('request', (r) => { if (/socket\.io|\/health|presence/.test(r.url())) net.push(r.url()); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  /* ---- 單機路徑不連後端 ---- */
  await page.click('#btn-solo'); await page.click('#s-solo .back-btn');
  await page.click('#btn-records'); await page.click('#s-records .back-btn');
  await page.click('#btn-howto'); await page.click('#s-howto .back-btn');
  await page.click('#btn-practice'); await page.waitForTimeout(500); await page.click('#pr-exit');
  ok(net.length === 0, '首頁／單機／練習／紀錄／怎麼玩沒有任何後端請求：' + net.join(','));

  /* ---- 語言按鈕緊鄰設定鈕 ---- */
  const lb = await page.locator('#dd-lang .dd-btn').boundingBox(), sb = await page.locator('#btn-settings').boundingBox();
  ok(Math.abs(lb.y - sb.y) < 6 && sb.x - (lb.x + lb.width) < 16 && sb.x > lb.x, '語言按鈕緊鄰設定按鈕（右上角）');

  /* ---- 設定彈窗 ---- */
  await page.waitForTimeout(200);
  await page.focus('#btn-settings'); await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  ok(await page.isVisible('#m-settings'), '設定按鈕開啟彈窗');
  const before = await page.evaluate(() => window.BumperApp.S.settings.music);
  await page.focus('#set-music'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  const after = await page.evaluate(() => window.BumperApp.S.settings.music);
  ok(after < before, '音樂音量滑桿可用鍵盤調整');
  await page.click('#b-settings-reset');
  ok(await page.evaluate(() => window.BumperApp.S.settings.music) === 0.6, '恢復預設');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(!(await page.isVisible('#m-settings')) && await page.evaluate(() => document.activeElement.id) === 'btn-settings', 'Escape 關閉彈窗並回到原焦點');

  /* ---- 單機一局：倒數、不能動、最後 10 秒、結算、分享、再來一局 ---- */
  await page.click('#btn-solo'); await page.click('#solo-start');
  await page.waitForTimeout(150);
  ok(await page.isVisible('#countdown') && (await page.textContent('#countdown')).trim() === '3', '開局顯示 3-2-1 倒數');
  const p0 = await page.evaluate(() => { const c = window.BumperRules.getCar(window.BumperApp.S.match, 'me'); return [c.x, c.y]; });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(600); await page.keyboard.up('ArrowRight');
  const p1 = await page.evaluate(() => { const c = window.BumperRules.getCar(window.BumperApp.S.match, 'me'); return [c.x, c.y]; });
  ok(p0[0] === p1[0] && p0[1] === p1[1], '倒數期間按方向鍵不會動');
  await page.waitForFunction(() => window.BumperApp.S.match.phase === 'playing', null, { timeout: 5000 });
  ok((await page.textContent('#hud-time')).trim() === '90' || +(await page.textContent('#hud-time')) >= 89, '開打時剩 90 秒（倒數不算）');
  const seed1 = await page.evaluate(() => window.BumperApp.S.match.seed);
  /* 對局中切換語言不重置 */
  await page.click('#dd-lang .dd-btn'); await page.click('#dd-lang .dd-opt:has-text("English")');
  ok(await page.evaluate(() => document.documentElement.lang) === 'en' && (await page.textContent('#dash-label')).trim() === 'Dash', '切換英文立即生效');
  ok(await page.evaluate(() => window.BumperApp.S.match.seed) === seed1, '切換語言不重置對局');
  await page.evaluate(() => { const m = window.BumperApp.S.match; m.t = 81; m.cars.forEach((c, i) => { c.x = (i - 1.5) * 1.1; c.y = 0; c.vx = c.vy = 0; }); });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('hud-time').classList.contains('warn')), '最後 10 秒時間變色提示');
  const recBefore = await page.evaluate(() => (window.BumperRecords.data().stats.all || { games: 0 }).games);
  await page.evaluate(() => { const S = window.BumperApp.S; S.match.cars.forEach((c) => { if (c.id !== 'me') { c.x = 40; c.lastHit = { by: 'me', t: S.match.t }; } }); });
  await page.waitForSelector('#result:not([hidden])', { timeout: 5000 });
  ok(await page.isVisible('#res-again') && await page.isVisible('#res-room') && await page.isVisible('#res-home') && await page.isVisible('#res-share'), '結算疊在擂台上，有分享、再來一局、回到設定、回到首頁');
  ok(await page.isVisible('#game-cv'), '結算時擂台仍在背後');
  const recAfter = await page.evaluate(() => window.BumperRecords.data().stats.all.games);
  ok(recAfter === recBefore + 1, '完成一局記錄一次');
  /* 重開結算（換語言會重畫）不重複累計 */
  await page.click('#dd-lang .dd-btn'); await page.click('#dd-lang .dd-opt:has-text("繁中")');
  ok(await page.evaluate(() => window.BumperRecords.data().stats.all.games) === recAfter, '重畫結算不重複記錄');
  /* 分享：只有圖片 */
  await page.evaluate(() => { window.__shared = null; navigator.canShare = () => true; navigator.share = (p) => { window.__shared = p; return Promise.resolve(); }; });
  await page.click('#res-share');
  await page.waitForSelector('#share-img:not([hidden])', { timeout: 8000 });
  ok(await page.evaluate(() => !document.getElementById('share-text') && !document.getElementById('share-copy')), '分享彈窗只有圖片（沒有文字／複製）');
  await page.click('#share-image');
  await page.waitForTimeout(200);
  const shared = await page.evaluate(() => window.__shared && { keys: Object.keys(window.__shared), type: window.__shared.files[0].type, size: window.__shared.files[0].size });
  ok(shared && shared.keys.join() === 'files' && shared.type === 'image/png' && shared.size > 20000, '分享 payload 只有 PNG 檔：' + JSON.stringify(shared));
  await page.evaluate(() => { navigator.share = () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
  await page.click('#share-image'); await page.waitForTimeout(150);
  ok((await page.textContent('#share-status')).trim() === '', '取消分享不顯示錯誤、不自動下載');
  await page.keyboard.press('Escape');
  await page.click('#res-again');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.BumperApp.S.match.phase === 'countdown') && await page.isVisible('#countdown'), '再來一局重新倒數');
  ok(await page.evaluate(() => window.BumperApp.S.match.seed) !== seed1, '再來一局是新的對局（新 matchId）');

  /* ---- 暫停：Esc 暫停、倒數一起停 ---- */
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const cd1 = await page.evaluate(() => window.BumperApp.S.match.cd);
  await page.waitForTimeout(500);
  ok(await page.isVisible('#m-pause') && await page.evaluate(() => window.BumperApp.S.match.cd) === cd1, 'Esc 暫停，倒數也暫停');
  await page.click('#pause-quit'); await page.click('#confirm-yes');
  ok(await page.isVisible('#s-home'), '離開這局回首頁');

  /* ---- 清除紀錄：取消不改、確定才清 ---- */
  await page.click('#btn-settings'); await page.click('#b-clear-records');
  await page.click('#confirm-no');
  ok(await page.evaluate(() => window.BumperRecords.data().stats.all.games) >= 1, '取消清除不改資料');
  await page.click('#b-clear-records'); await page.click('#confirm-yes');
  ok(await page.evaluate(() => !window.BumperRecords.data().stats.all), '確定後清除紀錄與成就');
  ok(await page.evaluate(() => window.BumperApp.S.settings.music) === 0.6, '清除紀錄不影響設定');
  await page.keyboard.press('Escape');

  /* ---- 語言保存 ---- */
  await page.click('#dd-lang .dd-btn'); await page.click('#dd-lang .dd-opt:has-text("简中")');
  await page.reload({ waitUntil: 'load' });
  ok(await page.evaluate(() => window.I18N.lang) === 'zh-Hans' && (await page.textContent('#btn-solo b')).trim() === '跟电脑玩', '語言偏好重新整理後保留');
  await page.click('#dd-lang .dd-btn'); await page.click('#dd-lang .dd-opt:has-text("繁中")');

  /* ---- 各尺寸無水平溢出、自訂捲軸 ---- */
  for (const vp of [[390, 844], [844, 390], [820, 1180], [1180, 820], [1440, 900]]) {
    await page.setViewportSize({ width: vp[0], height: vp[1] });
    for (const scr of ['home', 'solo', 'records', 'howto']) {
      await page.evaluate((s) => { if (s === 'solo') window.BumperApp.openSolo(); else window.BumperApp.show(s); }, scr);
      await page.waitForTimeout(120);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) ok(false, `${scr} ${vp.join('x')} 水平溢出 ${o}px`); else pass++;
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.BumperApp.openSolo()); await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const a = document.querySelector('#s-solo .sa'); return a.classList.contains('sa-over') && a.querySelector('.sa-thumb').offsetHeight > 20; }), '內容超出時顯示自訂捲軸');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#s-solo .sa-view')).scrollbarWidth === 'none'), '原生捲軸隱藏（用自訂捲軸取代）');
  await page.evaluate(() => { const v = document.querySelector('#s-solo .sa-view'); v.scrollTop = v.scrollHeight; });
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => { const b = document.querySelector('#solo-theme-cv').getBoundingClientRect(); return b.bottom <= window.innerHeight; }), '捲到底可以看到最後的內容');
  await page.evaluate(() => window.BumperApp.show('home'));
  ok(errors.length === 0, '頁面沒有 JS 錯誤：' + errors.join(' | '));

  /* ---- 線上：邀請連結先停在大廳、兩人＋電腦開局、觀戰 ---- */
  const A = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
  await A.goto(BASE); await A.click('#btn-online');
  await A.waitForFunction(() => window.BumperNet.connected(), null, { timeout: 8000 });
  await A.waitForSelector('#lobby-online:not([hidden])', { timeout: 3000 }).catch(() => {});
  ok(await A.isVisible('#lobby-online') && /[0-9]/.test(await A.textContent('#lobby-online')), '線上大廳顯示在線人數');
  await A.fill('#lobby-name', '房主'); await A.click('#lobby-create');
  await A.waitForSelector('#s-room:not([hidden])', { timeout: 5000 });
  const invite = (await A.textContent('#room-invite-url')).trim();
  ok(/room=[A-Z0-9]{4}&invite=[a-f0-9]{32}/.test(invite), '房間直接顯示邀請連結');
  const Bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'zh-TW' });
  const B = await Bctx.newPage();
  await B.goto(invite);
  await B.waitForSelector('#invite-panel:not([hidden])', { timeout: 8000 });
  ok(await B.isVisible('#s-lobby') && !(await B.isVisible('#s-room')), '邀請連結先停在大廳，不自動加入');
  await B.fill('#invite-name', '朋友'); await B.click('#invite-join');
  await B.waitForSelector('#s-room:not([hidden])', { timeout: 5000 });
  ok(!(await B.evaluate(() => location.search.includes('invite'))), '加入後網址清掉邀請參數');
  /* ---- 房間聊天：寬螢幕固定左欄、手機左下氣泡＋未讀、點開看得到訊息、Esc 收起 ---- */
  ok(await A.isVisible('#room-chat-panel') && !(await A.isVisible('#room-chat-fab')), '寬螢幕房間聊天固定在左欄');
  ok(await B.isVisible('#room-chat-fab') && !(await B.isVisible('#room-chat-panel')), '手機房間聊天是左下氣泡（預設收起）');
  await A.fill('#game-chat-input', '等等開'); await A.press('#game-chat-input', 'Enter');
  await B.waitForSelector('#room-chat-unread:not([hidden])', { timeout: 3000 }).catch(() => {});
  ok(await B.isVisible('#room-chat-unread'), '手機收起時收到房間訊息會顯示未讀');
  await B.tap('#room-chat-fab'); await B.waitForTimeout(200);
  ok(await B.isVisible('#room-chat-panel') && (await B.textContent('#game-chat-log')).includes('等等開') && !(await B.isVisible('#room-chat-unread')), '點開房間聊天看得到訊息、未讀清除');
  await B.keyboard.press('Escape'); await B.waitForTimeout(150);
  ok(!(await B.isVisible('#room-chat-panel')), 'Esc 收起手機房間聊天');
  await A.click('#room-seats .empty-seat .btn');   // 加電腦
  await B.click('#room-ready');
  await A.waitForFunction(() => !document.getElementById('room-start').disabled, null, { timeout: 3000 });
  const Cctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'zh-TW' });
  const C = await Cctx.newPage();
  await C.goto(invite); await C.waitForSelector('#invite-panel:not([hidden])');
  await C.fill('#invite-name', '路人'); await C.click('#invite-watch');
  await C.waitForSelector('#s-room:not([hidden])');
  ok((await C.textContent('#room-role')).includes('觀戰'), '觀戰者看到自己的角色');
  await A.click('#room-start');
  await Promise.all([A, B, C].map((p) => p.waitForSelector('#s-game:not([hidden])', { timeout: 6000 })));
  ok(true, '三人（含觀戰）都進入對局畫面');
  ok(await A.evaluate(() => document.getElementById('game-chat').parentNode.id === 'side-body'), '開局後聊天回到對局左側資訊欄');
  await B.waitForFunction(() => window.BumperApp.S.match && window.BumperApp.S.match.phase === 'playing', null, { timeout: 6000 });
  ok(await C.isVisible('#hud-role'), '觀戰者畫面標示觀戰中');
  ok(await C.evaluate(() => !window.BumperRules.getCar(window.BumperApp.S.match, window.BumperApp.S.myId)), '觀戰者沒有車');
  ok(await B.isVisible('#joy-zone') && await B.isVisible('#btn-dash'), '手機有觸控搖桿與衝刺鍵');
  /* 手機觸控搖桿推一下，車子會動 */
  const bx0 = await B.evaluate(() => { const c = window.BumperRules.getCar(window.BumperApp.S.match, window.BumperApp.S.myId); return c.x; });
  const zone = await B.locator('#joy-zone').boundingBox();
  await B.mouse.move(zone.x + 80, zone.y + zone.height - 120); await B.mouse.down(); await B.mouse.move(zone.x + 150, zone.y + zone.height - 120, { steps: 4 });
  await B.waitForTimeout(700); await B.mouse.up();
  const bx1 = await B.evaluate(() => { const c = window.BumperRules.getCar(window.BumperApp.S.match, window.BumperApp.S.myId); return c.x; });
  ok(bx1 > bx0 + 0.3, '觸控搖桿操作（伺服器確認後）車子移動：' + bx0.toFixed(2) + '→' + bx1.toFixed(2));
  await A.close(); await Bctx.close(); await Cctx.close();
  await browser.close();
  console.log((fail ? '✗' : '✓') + ' 瀏覽器檢查 ' + pass + ' 項通過' + (fail ? '，' + fail + ' 項失敗' : ''));
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
