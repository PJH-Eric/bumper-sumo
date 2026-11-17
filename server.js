/*
 * server.js — 碰碰車大亂鬥 權威伺服器
 *
 * Express 提供靜態前端與 /health（平台健康檢查用；前端不會拿它來喚醒或探測），
 * Socket.IO 負責大廳、房間、對局與聊天。物理、碰撞、出界、撞飛數全部由伺服器判定，
 * 客戶端只送「方向、衝刺、用道具」。沒有 /api/presence，也不顯示全站在線人數。
 *
 * 環境變數
 *   PORT                 監聽埠（Render 會自動注入），預設 3250
 *   HOST                 監聽介面，預設 0.0.0.0
 *   GAME_ALLOWED_ORIGIN  允許連線的前端來源，逗號分隔；* 代表不限制
 *   COUNTDOWN_MS         開局倒數（毫秒），預設 3000
 *   RECONNECT_MS         斷線可重連時間（毫秒），預設 10000
 *   AI_SPEED_SCALE       自動化測試用：電腦反應時間倍率
 */
'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const { Hub } = require('./lib/rooms.js');

const PORT = Number(process.env.PORT || 3250);
const HOST = process.env.HOST || '0.0.0.0';
const STARTED_AT = Date.now();

const ALLOWED = String(process.env.GAME_ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
const allowAll = ALLOWED.includes('*');
function originAllowed(origin) { return allowAll || !origin || ALLOWED.includes(origin); }

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bumper-sumo', uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000), rooms: hub.rooms.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin(origin, cb) { cb(null, originAllowed(origin)); }, methods: ['GET', 'POST'] },
  pingInterval: 20000, pingTimeout: 25000, maxHttpBufferSize: 1e5
});

const hub = new Hub(io);
hub.lobbyChat = require('./lib/lobby-chat.js').attachSocketIo(io);

function safe(fn) {
  return (p, ack) => {
    let r;
    try { r = fn(p || {}); } catch (e) { console.error(e); r = { ok: false, code: 'error' }; }
    if (typeof ack === 'function') ack(r || { ok: true });
  };
}

io.on('connection', (socket) => {
  socket.on('hello', safe((p) => { const r = hub.hello(socket, p); hub.lastOnline = -1; hub.pushOnline(); r.online = hub.onlineCount(); return r; }));
  socket.on('lobby:enter', safe(() => { socket.join('lobby'); return { ok: true, rooms: hub.list() }; }));
  socket.on('lobby:leave', safe(() => { socket.leave('lobby'); return { ok: true }; }));
  socket.on('room:list', safe(() => ({ ok: true, rooms: hub.list() })));
  socket.on('room:peek', safe((p) => hub.peek(p)));
  socket.on('room:create', safe((p) => hub.create(socket, p)));
  socket.on('room:quick', safe((p) => hub.quick(socket, p)));
  socket.on('room:join', safe((p) => hub.join(socket, p)));
  socket.on('room:leave', safe(() => hub.leave(socket)));
  socket.on('room:ready', safe((p) => hub.ready(socket, p)));
  socket.on('room:skin', safe((p) => hub.setSkin(socket, p)));
  socket.on('room:config', safe((p) => hub.config(socket, p)));
  socket.on('room:ai', safe((p) => hub.ai(socket, p)));
  socket.on('room:seat', safe((p) => hub.seatSwitch(socket, p)));
  socket.on('room:kick', safe((p) => hub.kick(socket, p)));
  socket.on('room:invite', safe(() => hub.regenInvite(socket)));
  socket.on('game:start', safe(() => hub.start(socket)));
  socket.on('game:input', (p) => { try { hub.input(socket, p); } catch (e) { console.error(e); } });
  socket.on('chat:send', safe((p) => hub.chat(socket, p)));
  socket.on('latency:ping', (_t, ack) => { if (typeof ack === 'function') ack(); });
  socket.on('disconnect', () => { hub.disconnect(socket); hub.pushOnline(); });
});

/* 應用層心跳：每秒一次，客戶端太久沒收到任何訊息就自己重連 */
setInterval(() => io.emit('hb', { t: Date.now() }), 1000).unref();

/* 清掉很久沒連線、也不在房間裡的工作階段 */
setInterval(() => {
  for (const [sid, s] of hub.sessions) if (!s.socketId && !s.room) hub.sessions.delete(sid);
}, 60000).unref();

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(PORT + ' 埠已經被佔用（可能遊戲已經開著了）。直接開 http://localhost:' + PORT + '，或用 PORT=其他埠號 重新啟動。');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log('碰碰車大亂鬥 伺服器啟動：http://localhost:' + PORT);
  if (process.env.QUIET_BANNER) return;
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) console.log('  同網段：http://' + n.address + ':' + PORT);
  }
});

module.exports = { server, io, hub };
