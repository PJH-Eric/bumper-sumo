/* scripts/start.js — 「啟動遊戲.bat」用的啟動器（中文訊息都在這裡印，.bat 本身只放英數字，避免 cmd 的 UTF-8 解析錯亂）
 *   1. 檢查 Node.js 版本（需要 26.12.1 以上的 26.x）
 *   2. 檢查 3250 埠：已經是碰碰車大亂鬥在跑 → 直接開瀏覽器；被別的程式佔用 → 說明怎麼處理
 *   3. 啟動伺服器，印出本機與同網段網址，開瀏覽器 */
'use strict';
const http = require('http');
const net = require('net');
const os = require('os');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3250);
const URL = 'http://localhost:' + PORT;

function openBrowser() {
  if (process.env.NO_BROWSER) return;
  const cmd = process.platform === 'win32' ? 'start "" "' + URL + '"' : (process.platform === 'darwin' ? 'open ' + URL : 'xdg-open ' + URL);
  exec(cmd, () => {});
}

function versionOk() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  return major === 26 && (minor > 12 || (minor === 12 && patch >= 1));
}

function portFree() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(PORT, '0.0.0.0');
  });
}

function whoIsThere() {
  return new Promise((resolve) => {
    const req = http.get(URL + '/health', { timeout: 1500 }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b).service || 'other'); } catch (e) { resolve('other'); } });
    });
    req.on('error', () => resolve('other'));
    req.on('timeout', () => { req.destroy(); resolve('other'); });
  });
}

async function main() {
  if (!versionOk()) {
    console.log('需要 Node.js 26.12.1 或更新的 26.x 版本，目前是 ' + process.version + '。');
    console.log('請安裝 Node.js 26：https://nodejs.org/ （有裝 nvm 的話執行 nvm install 26 && nvm use 26）');
    process.exitCode = 1;
    return;
  }
  if (!(await portFree())) {
    if ((await whoIsThere()) === 'bumper-sumo') {
      console.log('碰碰車大亂鬥已經在執行中了，直接幫你打開：' + URL);
      openBrowser();
      return;
    }
    console.log(PORT + ' 埠被其他程式佔用了。請先關掉那個程式，或改用別的埠，例如：');
    console.log('  set PORT=3251 && 啟動遊戲.bat');
    process.exitCode = 1;
    return;
  }
  console.log('================================================');
  console.log('  碰碰車大亂鬥 - 遊戲伺服器（Node.js ' + process.version + '）');
  console.log('================================================');
  console.log('');
  console.log('  這台電腦開遊戲：  ' + URL);
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) lan.push('http://' + n.address + ':' + PORT);
  if (lan.length) console.log('  其他電腦或手機（同網段）：  ' + lan.join('  '));
  console.log('  要停止伺服器請按 Ctrl+C 或直接關掉這個視窗。');
  console.log('');
  process.env.QUIET_BANNER = '1';
  const { server } = require('../server.js');
  server.once('listening', openBrowser);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
