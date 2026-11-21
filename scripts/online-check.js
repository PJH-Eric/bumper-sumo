/* scripts/online-check.js — 線上流程實測：真的開一台伺服器，用多個 socket.io 客戶端打一遍
 * 涵蓋：在線人數、建房、邀請連結（含失效）、玩家／觀戰角色、電腦席位、準備與開始、伺服器權威對局、觀戰不能操作、
 *       100ms／200ms 延遲下的撞擊、斷線 10 秒內重連、逾時出局、結算、再來一局、踢人、換房主、私人房、快速加入自動開房、零真人自動關房、沒有 /api/presence */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { io } = require('socket.io-client');

let url;
const sockets = new Set();
let pass = 0, fail = 0;
function ok(c, name) { if (c) pass++; else { fail++; console.log('✗ ' + name); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(lagMs) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
  sockets.add(s);
  const c = { s, states: [], room: null, events: {}, sid: null, init: null, over: null, closed: false, online: null };
  const orig = s.emit.bind(s);
  /* 模擬單向延遲：送出前先等 lagMs */
  c.emit = (evt, p) => new Promise((resolve, reject) => {
    setTimeout(() => s.timeout(8000).emit(evt, p, (error, response) => {
      setTimeout(() => error ? reject(error) : resolve(response), lagMs || 0);
    }), lagMs || 0);
  });
  c.input = (p) => setTimeout(() => orig('game:input', p), lagMs || 0);
  s.on('room:state', (r) => { c.room = r; });
  s.on('game:init', (g) => { c.init = g; c.over = null; });
  s.on('game:state', (g) => { c.last = g; c.states.push(g.tick); });
  s.on('game:over', (g) => { c.over = g; });
  s.on('room:closed', () => { c.closed = true; });
  s.on('room:kicked', () => { c.kicked = true; });
  s.on('online:count', (p) => { c.online = p.n; });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(c));
    s.once('connect_error', reject);
  });
}
async function hello(c, name, sid) { const r = await c.emit('hello', { name, sid, skin: 0 }); c.sid = r.sid; return r; }
async function waitFor(fn, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step || 30); } return false; }
function get(p) { return new Promise((res) => http.get(url + p, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', () => res({ status: 0 }))); }

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', COUNTDOWN_MS: '300', RECONNECT_MS: '1200', MATCH_SECONDS: '6', AI_SPEED_SCALE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  try {
    const listening = /http:\/\/localhost:(\d+)/;
    await waitFor(() => listening.test(log) || srv.exitCode !== null, 8000);
    const port = log.match(listening)?.[1];
    if (!port) throw new Error('測試伺服器啟動失敗\n' + log);
    url = 'http://127.0.0.1:' + port;
    ok((await get('/health')).status === 200, '/health 可用（平台健康檢查）');
    ok((await get('/api/presence')).status === 404, '沒有 /api/presence');

    const A = await client(0), B = await client(100), C = await client(200);
    await hello(A, '小明'); await hello(B, '小美'); await hello(C, '觀眾');
    await waitFor(() => A.online === 3, 1500);
    ok(A.online === 3, '在線人數即時推送（3 人）：' + A.online);

    /* 建房、邀請 */
    const cr = await A.emit('room:create', { name: '小明', skin: 0 });
    ok(cr.ok && cr.code, '建立房間');
    await waitFor(() => A.room, 1000);
    const code = cr.code, token = A.room.invite;
    ok(/^[a-f0-9]{32}$/.test(token), '邀請 token 不可猜（32 hex）');
    const peek = await B.emit('room:peek', { code, token });
    ok(peek.ok && peek.name === '小明', '邀請落地頁可以先看房間資訊（不加入）');
    ok((await B.emit('room:join', { code, token: 'deadbeef', role: 'player', name: '小美' })).code === 'badtoken', '錯誤的邀請 token 被拒');
    const jb = await B.emit('room:join', { code, token, role: 'player', name: '小美', skin: 0 });
    ok(jb.ok && jb.role === 'player', '用邀請連結加入為玩家');
    const jc = await C.emit('room:join', { code, token, role: 'spectator', name: '觀眾' });
    ok(jc.ok && jc.role === 'spectator', '用邀請連結加入為觀戰');
    await waitFor(() => B.room && B.room.seats.filter((s) => s.kind === 'human').length === 2, 1000);
    const skins = B.room.seats.filter((s) => s.kind === 'human').map((s) => s.skin);
    ok(skins[0] !== skins[1], '同房不會選到同一台車');
    ok(C.room.you.role === 'spectator' && B.room.you.role === 'player', '每個人看到自己的角色');
    ok((await C.emit('room:ready', { ready: true })).code === 'notplayer', '觀戰者不能準備');
    ok((await B.emit('room:config', { items: false })).code === 'nothost', '非房主不能改設定');
    ok((await B.emit('game:start')).code === 'nothost', '非房主不能開始');

    /* 電腦席位、準備、開始 */
    ok((await A.emit('room:ai', { slot: 2, level: 'kid' })).code === 'badlevel', '線上不能選幼幼');
    ok((await A.emit('room:ai', { slot: 2, level: 'hard' })).ok, '房主在空位加電腦（困難）');
    ok((await A.emit('game:start')).code === 'notready', '有人沒準備不能開始');
    await B.emit('room:ready', { ready: true });
    const st = await A.emit('game:start');
    ok(st.ok, '全員準備後房主開始');
    await waitFor(() => A.init && B.init && C.init, 1500);
    ok(A.init && C.init && A.init.cars.length === 3, '所有人（含觀戰）收到開局資料，3 台車');
    ok(!A.init.cars.some((c) => c.id === C.sid), '觀戰者沒有車');
    await waitFor(() => A.last && A.last.phase === 'playing', 2000);
    ok(A.last && A.last.phase === 'playing', '伺服器推進倒數後開打');
    const tickRate = await (async () => { const n0 = A.states.length; await sleep(1000); return A.states.length - n0; })();
    ok(tickRate >= 24 && tickRate <= 36, '狀態推送約每秒 30 次：' + tickRate);
    ok(JSON.stringify(A.last).length < 3000, '每拍狀態大小 ' + JSON.stringify(A.last).length + ' bytes');

    /* 觀戰者送輸入沒有效果；玩家輸入有效 */
    const bCar = () => A.last.cars.find((c) => c.id === B.sid);
    const x0 = bCar().x;
    for (let i = 0; i < 20; i++) { B.input({ mx: 1, my: 0, seq: i }); C.input({ mx: -1, my: 0, dash: true }); await sleep(33); }
    await sleep(300);
    ok(bCar().x > x0 + 0.5, '玩家（100ms 延遲）輸入由伺服器套用：' + x0.toFixed(2) + '→' + bCar().x.toFixed(2));

    /* 斷線 10 秒內重連（這裡測試設 1.2 秒） */
    const bSid = B.sid;
    B.s.disconnect();
    await sleep(300);
    const B2 = await client(0);
    const hb = await hello(B2, '小美', bSid);
    ok(hb.room === code, '寬限內重連回到原房間');
    await waitFor(() => B2.init, 1000);
    ok(!!B2.init, '重連後拿到目前對局');

    /* 等這局結束（6 秒） */
    await waitFor(() => A.over && B2.over && C.over, 12000);
    ok(A.over && A.over.result.rows.length === 3, '時間到結束，所有人收到結算');
    ok(A.over && A.over.result.rows[0].place === 1, '結算名次由伺服器決定');
    await waitFor(() => A.room && A.room.phase === 'waiting', 1000);
    ok(A.room.phase === 'waiting' && A.room.seats.every((s) => !s.ready || s.kind === 'ai'), '結算後回到等待、準備重置');

    /* 再來一局：重新倒數 */
    await B2.emit('room:ready', { ready: true });
    A.init = null;
    ok((await A.emit('game:start')).ok, '再來一局');
    await waitFor(() => A.last && A.last.phase === 'countdown', 1000);
    ok(A.init && A.init.round === 2, '新的一局（round 2）重新倒數');
    /* 對局中斷線逾時 → 出局變幽靈，不交給電腦 */
    await waitFor(() => A.last.phase === 'playing', 2000);
    B2.s.disconnect();
    await sleep(1600);
    const bc = A.last.cars.find((c) => c.id === bSid);
    ok(bc && bc.al === 0, '對局中斷線超過寬限 → 出局變幽靈');
    await waitFor(() => A.over && A.over.round === 2, 10000);

    /* 踢人、換房主 */
    const D = await client(0); await hello(D, '路人');
    await D.emit('room:join', { code, role: 'player', name: '路人' });
    await waitFor(() => A.room.seats.some((s) => s.sid === D.sid), 1000);
    ok((await A.emit('room:kick', { sid: D.sid })).ok, '房主踢人');
    await waitFor(() => D.kicked, 1000);
    ok(D.kicked && !A.room.seats.some((s) => s.sid === D.sid), '被踢的人收到通知並離開席位');
    const E = await client(0); await hello(E, '小華');
    await E.emit('room:join', { code, role: 'player', name: '小華' });
    await A.emit('room:leave');
    await waitFor(() => E.room && E.room.host === E.sid, 1000);
    ok(E.room.host === E.sid, '房主離開自動換房主');

    /* 零真人自動關房：剩電腦＋觀戰者 */
    await E.emit('room:leave');
    await waitFor(() => C.closed, 1000);
    ok(C.closed, '沒有真人玩家（只剩電腦與觀戰）立即關房、通知觀戰者');
    const again = await D.emit('room:join', { code, token, role: 'player', name: '路人' });
    ok(!again.ok && (again.code === 'closed' || again.code === 'notfound'), '關房後邀請失效、不能復活');

    /* 私人房與快速加入 */
    const P = await D.emit('room:create', { name: '路人', private: true });
    const list = await E.emit('room:list');
    ok(P.ok && !list.rooms.some((r) => r.code === P.code), '私人房不出現在大廳列表');
    const q = await E.emit('room:quick', { name: '小華' });
    ok(q.ok && q.created && q.code !== P.code, '快速加入跳過私人房；沒有空房就自動開新房並告知');
    const F = await client(0); await hello(F, '阿福');
    const q2 = await F.emit('room:quick', { name: '阿福' });
    ok(q2.ok && q2.code === q.code && !q2.created, '有空房時快速加入直接進去');

    /* 聊天：消毒、頻率限制 */
    const m1 = await F.emit('chat:send', { text: '<b>嗨</b>' });
    ok(m1.ok, '房間聊天送出');
    ok((await F.emit('chat:send', { text: '再一次' })).code === 'fast', '聊天頻率限制');
  } finally {
    for (const socket of sockets) socket.disconnect();
    srv.kill();
  }
  console.log((fail ? '✗' : '✓') + ' 線上流程 ' + pass + ' 項通過' + (fail ? '，' + fail + ' 項失敗' : ''));
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
