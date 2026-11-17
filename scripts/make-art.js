/* scripts/make-art.js — 用遊戲自己的向量美術（public/js/art.js）在無頭 Chrome 畫出宣傳與圖示資產
 *   public/assets/images/seo.webp（1200×675，含繁中標題）、cover.webp（1200×675，無文字）
 *   public/favicon-96.png、favicon.ico（16/32/48）、apple-touch-icon.png（180）、icons/icon-192.png、icon-512.png
 * 用法：先 npm start，再 node scripts/make-art.js [baseUrl] */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://localhost:3250/';
const PUB = path.join(__dirname, '..', 'public');
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));

/* 在頁面裡執行的繪圖程式 */
function paint(args) {
  const kind = args[0], W = args[1], H = args[2];
  const Art = window.BumperArt;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const th = Art.resolveTheme(0, 'promo');
  function scene(cx, cy, u, opts) {
    Art.drawBelow(ctx, th, W, H, cx, cy, u, 1.2, true);
    Art.drawDecor(ctx, th, cx, cy, u, 7.5, 1.2, true);
    Art.drawArena(ctx, th, cx, cy, u, 7.5, 7.5, 0.35, { reduce: true });
    /* 衝刺撞擊瞬間：小熊（藍）衝向小貓（紅），旁邊青蛙、小雞、兔兔 */
    const S = u * (opts.carScale || 1.9);
    const hit = [cx + u * 0.9, cy - u * 0.3];
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.16; ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(cx - u * 3.4, cy + u * 1.1 + k * u * 0.5); ctx.lineTo(cx - u * 5.4, cy + u * 1.7 + k * u * 0.5); ctx.stroke(); }
    ctx.restore();
    Art.drawCar(ctx, cx - u * 4.2, cy + u * 4.6, -0.9, S * 0.8, 2, { t: 0.4, mood: 'happy' });
    Art.drawCar(ctx, cx + u * 4.6, cy + u * 3.6, -2.4, S * 0.8, 3, { t: 0.4, mood: 'shock' });
    Art.drawCar(ctx, cx - u * 0.6, cy - u * 4.6, 1.2, S * 0.75, 4, { t: 0.4, mood: 'happy' });
    Art.drawCar(ctx, cx - u * 1.9, cy + u * 0.6, -0.32, S, 0, { t: 0.4, mood: 'happy' });
    Art.drawCar(ctx, cx + u * 2.4, cy - u * 1.2, Math.PI - 0.3, S, 1, { t: 0.4, mood: 'dizzy', flash: false });
    const stars = [[0, 0, 0.9, '#fff36b'], [0.9, -1.1, 0.55, '#ffffff'], [-0.6, -1.3, 0.45, '#ffb13b'], [1.2, 0.7, 0.5, '#ffb13b'], [-0.9, 0.9, 0.4, '#ffffff']];
    stars.forEach((s) => Art.star(ctx, hit[0] + s[0] * u, hit[1] + s[1] * u, u * s[2], s[3]));
  }
  if (kind === 'seo') {
    scene(W * 0.29, H * 0.56, H / 12.5, { carScale: 2.4 });
    /* 右側標題 */
    const g = ctx.createLinearGradient(W * 0.56, 0, W, 0);
    g.addColorStop(0, 'rgba(29,22,64,0)'); g.addColorStop(0.18, 'rgba(29,22,64,0.82)'); g.addColorStop(1, 'rgba(29,22,64,0.92)');
    ctx.fillStyle = g; ctx.fillRect(W * 0.56, 0, W * 0.44, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const F = '"Baloo 2", "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    ctx.font = '900 112px ' + F;
    ctx.lineJoin = 'round';
    ['碰碰車', '大亂鬥'].forEach((line, i) => {
      const y = H * 0.33 + i * 132;
      ctx.lineWidth = 16; ctx.strokeStyle = '#b8236f'; ctx.strokeText(line, W * 0.79, y + 6);
      ctx.shadowColor = '#ff4fa3'; ctx.shadowBlur = 28; ctx.fillStyle = '#ffffff'; ctx.fillText(line, W * 0.79, y); ctx.shadowBlur = 0;
    });
    ctx.font = '800 38px ' + F; ctx.fillStyle = '#ffd23f';
    ctx.fillText('免費線上多人碰碰車對戰', W * 0.79, H * 0.73);
  } else if (kind === 'cover') {
    scene(W * 0.5, H * 0.56, H / 12.5, { carScale: 2.4 });
  } else {
    /* 圖示：只留一台碰碰車＋撞擊星星 */
    const r = W * 0.22;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ff6fb5'); bg.addColorStop(1, '#c42a7c');
    ctx.fillStyle = bg; Art.rr(ctx, 0, 0, W, H, r); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; Art.ellipse(ctx, W * 0.5, H * 0.16, W * 0.4, H * 0.1); ctx.fill();
    Art.drawCar(ctx, W * 0.47, H * 0.6, -0.55, W * 0.56, 0, { t: 0.4, mood: 'happy' });
    Art.star(ctx, W * 0.8, H * 0.24, W * 0.13, '#ffe36b');
  }
  return cv.toDataURL(kind === 'seo' || kind === 'cover' ? 'image/webp' : 'image/png', 0.92);
}

function icoFrom(pngs) {
  /* ICO：每個尺寸直接放 PNG（Vista 以後都支援） */
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(p.size >= 256 ? 0 : p.size, e); head.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(p.buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += p.buf.length;
  });
  return Buffer.concat([head].concat(pngs.map((p) => p.buf)));
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = (rel, dataUrl) => {
    const f = path.join(PUB, rel); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('✓ ' + rel);
  };
  out('assets/images/seo.webp', await page.evaluate(paint, ['seo', 1200, 675]));
  out('assets/images/cover.webp', await page.evaluate(paint, ['cover', 1200, 675]));
  for (const [rel, size] of [['favicon-96.png', 96], ['apple-touch-icon.png', 180], ['icons/icon-192.png', 192], ['icons/icon-512.png', 512]]) {
    out(rel, await page.evaluate(paint, ['icon', size, size]));
  }
  const pngs = [];
  for (const s of [16, 32, 48]) {
    const d = await page.evaluate(paint, ['icon', s, s]);
    pngs.push({ size: s, buf: Buffer.from(d.split(',')[1], 'base64') });
  }
  fs.writeFileSync(path.join(PUB, 'favicon.ico'), icoFrom(pngs)); console.log('✓ favicon.ico');
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
