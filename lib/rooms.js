/* ===== lib/rooms.js — 房間、席位、觀戰、邀請、重連與伺服器權威對局迴圈 =====
 *
 * 生命週期：只有「真人玩家席位」能讓房間存活（含斷線寬限中的真人）；電腦與觀戰者不算。
 * 真人數降為 0 → 立即關房：停止對局迴圈、邀請失效、從大廳移除、廣播 room:closed，不可復活。
 */
'use strict';

const crypto = require('crypto');
const Rules = require('../public/js/rules.js');
const AI = require('../public/js/ai.js');
const { censor, cleanText } = require('./lobby-chat.js');

const LEVELS_ONLINE = ['easy', 'normal', 'hard', 'mythic'];   // 幼幼只在單機
const MAX_SEATS = 6;
const MAX_SPECTATORS = 20;
const RECONNECT_MS = +process.env.RECONNECT_MS || 10000;
const COUNTDOWN_MS = process.env.COUNTDOWN_MS != null ? +process.env.COUNTDOWN_MS : 3000;
const AI_SCALE = +process.env.AI_SPEED_SCALE || 1;
const MATCH_SECONDS = +process.env.MATCH_SECONDS || 90;   // 自動化測試可縮短
const SEND_EVENTS = { hit: 1, clash: 1, fall: 1, wobble: 1, pickup: 1, use: 1, rescue: 1, ghostDrop: 1, count: 1, go: 1, over: 1, burst: 1, charge: 1, shieldBlock: 1, superHit: 1, land: 1, slip: 1, itemSpawn: 1 };
const QUICK = ['hi', 'gg', 'nice', 'oops', 'again', 'wait', 'go', 'lol'];

function code4() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)];
  return s;
}
function token() { return crypto.randomBytes(16).toString('hex'); }

function cleanName(n) {
  const s = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  const out = censor(Array.from(s).slice(0, 12).join(''));
  return out || null;
}
function skinOk(k) { k = +k; return Number.isInteger(k) && k >= 0 && k < 8 ? k : 0; }

class Hub {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.sessions = new Map();   // sid → { sid, socketId, name, skin, room }
    this.lobbyChat = null;
  }

  /* ---------- 工作階段 ---------- */
  hello(socket, p) {
    let sid = p && typeof p.sid === 'string' && /^[a-f0-9]{24,40}$/.test(p.sid) ? p.sid : null;
    let sess = sid && this.sessions.get(sid);
    if (!sess) { sid = token(); sess = { sid, socketId: null, name: null, skin: 0, room: null }; this.sessions.set(sid, sess); }
    /* 同一個工作階段換新連線：把舊連線踢掉 */
    if (sess.socketId && sess.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(sess.socketId);
      if (old) { old.data.sid = null; old.disconnect(true); }
    }
    sess.socketId = socket.id;
    socket.data.sid = sid;
    if (p && p.name) sess.name = cleanName(p.name) || sess.name;
    if (p && p.skin != null) sess.skin = skinOk(p.skin);
    /* 重連：回到原來的房間 */
    let rejoined = null;
    if (sess.room) {
      const room = this.rooms.get(sess.room);
      if (room && !room.closed) {
        const m = this.member(room, sid);
        if (m) {
          m.connected = true; m.goneAt = null;
          socket.join(room.code);
          rejoined = room.code;
          this.sendRoom(room);
          if (room.match) socket.emit('game:init', this.gameInit(room));
          this.sys(room, 'chat.sys.back', { name: m.name });
        } else sess.room = null;
      } else sess.room = null;
    }
    return { ok: true, sid, room: rejoined };
  }

  sessOf(socket) { return socket.data.sid ? this.sessions.get(socket.data.sid) : null; }

  /* ---------- 房間查詢 ---------- */
  member(room, sid) {
    const seat = room.seats.find((x) => x.kind === 'human' && x.sid === sid);
    if (seat) return seat;
    return room.spectators.find((x) => x.sid === sid) || null;
  }
  humans(room) { return room.seats.filter((x) => x.kind === 'human'); }
  cars(room) { return room.seats.filter((x) => x.kind !== 'empty'); }

  list() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.closed || r.config.private) continue;
      out.push({
        code: r.code, name: r.name, players: this.cars(r).length, humans: this.humans(r).length,
        max: r.config.max, phase: r.phase, ai: r.seats.some((x) => x.kind === 'ai'), spectators: r.spectators.length,
        mode: r.config.mode
      });
    }
    return out.sort((a, b) => (a.phase === 'waiting' ? 0 : 1) - (b.phase === 'waiting' ? 0 : 1));
  }
  pushList() { this.io.to('lobby').emit('room:list', { rooms: this.list() }); }

  /* ---------- 建立／加入／離開 ---------- */
  create(socket, p) {
    const sess = this.sessOf(socket);
    if (!sess) return { ok: false, code: 'nohello' };
    this.leave(socket, true);
    const name = cleanName(p && p.name) || sess.name;
    if (!name) return { ok: false, code: 'badname' };
    sess.name = name; sess.skin = skinOk(p && p.skin != null ? p.skin : sess.skin);
    let code; do { code = code4(); } while (this.rooms.has(code));
    const room = {
      code, name: cleanText((p && p.roomName) || '', 16) || null, host: sess.sid,
      phase: 'waiting', closed: false, created: Date.now(),
      config: { items: true, theme: 0, mode: 'ffa', max: 4, private: !!(p && p.private) },
      seats: [], spectators: [], invite: token(), chat: [], chatSeq: 0,
      match: null, brains: {}, loop: null, result: null, round: 0, lastRank: null
    };
    room.name = room.name || name;
    for (let i = 0; i < MAX_SEATS; i++) room.seats.push({ slot: i, kind: 'empty' });
    this.rooms.set(code, room);
    this.seat(room, 0, sess);
    sess.room = code;
    socket.join(code);
    this.sendRoom(room);
    this.pushList();
    if (this.lobbyChat) this.lobbyChat.roomOpened({ code, roomName: room.name, host: name, isPrivate: room.config.private });
    return { ok: true, code, role: 'player' };
  }

  seat(room, slot, sess) {
    const s = room.seats[slot];
    const taken = new Set(room.seats.filter((x) => x.kind !== 'empty').map((x) => x.skin));
    let skin = sess.skin;
    if (taken.has(skin)) { for (let k = 0; k < 8; k++) if (!taken.has(k)) { skin = k; break; } }
    Object.assign(s, { kind: 'human', sid: sess.sid, name: sess.name, skin, ready: false, connected: true, goneAt: null, level: null });
    return s;
  }

  freeSlot(room) {
    for (let i = 0; i < room.config.max; i++) if (room.seats[i].kind === 'empty') return i;
    return -1;
  }

  quick(socket, p) {
    const open = this.list().filter((r) => r.phase === 'waiting' && r.players < r.max);
    if (open.length) return this.join(socket, { code: open[0].code, role: 'player', name: p && p.name, skin: p && p.skin });
    /* 沒有空房：自動開一間公開房，並告訴玩家 */
    const r = this.create(socket, Object.assign({}, p, { private: false }));
    if (r.ok) r.created = true;
    return r;
  }

  /** p: { code, token?, role:'player'|'spectator', name, skin } */
  join(socket, p) {
    const sess = this.sessOf(socket);
    if (!sess) return { ok: false, code: 'nohello' };
    const code = String((p && p.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = this.rooms.get(code);
    if (!room || room.closed) return { ok: false, code: p && p.token ? 'closed' : 'notfound' };
    if (p && p.token != null && p.token !== '' && p.token !== room.invite) return { ok: false, code: 'badtoken' };
    const name = cleanName(p && p.name) || sess.name;
    if (!name) return { ok: false, code: 'badname' };
    if (sess.room && sess.room !== code) this.leave(socket, true);
    sess.name = name; sess.skin = skinOk(p && p.skin != null ? p.skin : sess.skin);
    const existing = this.member(room, sess.sid);
    if (existing) { existing.connected = true; socket.join(code); sess.room = code; this.sendRoom(room); return { ok: true, code, role: existing.kind === 'human' ? 'player' : 'spectator' }; }
    let role = p && p.role === 'spectator' ? 'spectator' : 'player';
    let notice = null;
    if (role === 'player') {
      const slot = room.phase === 'waiting' ? this.freeSlot(room) : -1;
      if (slot < 0) { role = 'spectator'; notice = room.phase === 'waiting' ? 'full' : 'playing'; }
      else this.seat(room, slot, sess);
    }
    if (role === 'spectator') {
      if (room.spectators.length >= MAX_SPECTATORS) return { ok: false, code: 'specfull' };
      room.spectators.push({ sid: sess.sid, name, connected: true, goneAt: null });
    }
    sess.room = code;
    socket.join(code);
    this.sys(room, role === 'player' ? 'chat.sys.join' : 'chat.sys.watch', { name });
    this.sendRoom(room);
    if (room.match) socket.emit('game:init', this.gameInit(room));
    this.pushList();
    return { ok: true, code, role, notice };
  }

  /** 主動離開（或換房） */
  leave(socket, silent) {
    const sess = this.sessOf(socket);
    if (!sess || !sess.room) return { ok: true };
    const room = this.rooms.get(sess.room);
    sess.room = null;
    socket.leave(room ? room.code : '');
    if (!room || room.closed) return { ok: true };
    this.removeMember(room, sess.sid, 'left');
    return { ok: true };
  }

  removeMember(room, sid, why) {
    const si = room.spectators.findIndex((x) => x.sid === sid);
    if (si >= 0) {
      const sp = room.spectators.splice(si, 1)[0];
      this.sys(room, 'chat.sys.leave', { name: sp.name });
    }
    const seat = room.seats.find((x) => x.kind === 'human' && x.sid === sid);
    if (seat) {
      const name = seat.name;
      if (room.match && room.match.phase !== 'over') {
        /* 對局中離開：車子當作出局（變幽靈、無人操作） */
        Rules.forfeit(room.match, seat.sid);
      }
      Object.assign(seat, { kind: 'empty', sid: null, name: null, ready: false, connected: false, goneAt: null });
      this.sys(room, why === 'kick' ? 'chat.sys.kicked' : (why === 'timeout' ? 'chat.sys.timeout' : 'chat.sys.leave'), { name });
    }
    const sess = this.sessions.get(sid);
    if (sess && sess.room === room.code) sess.room = null;
    this.afterChange(room);
  }

  afterChange(room) {
    if (room.closed) return;
    if (this.humans(room).length === 0) { this.close(room, 'empty'); return; }
    if (!this.humans(room).some((x) => x.sid === room.host)) {
      const next = this.humans(room).find((x) => x.connected) || this.humans(room)[0];
      room.host = next.sid;
      this.sys(room, 'chat.sys.host', { name: next.name });
    }
    this.sendRoom(room);
    this.pushList();
  }

  close(room, reason) {
    if (room.closed) return;
    room.closed = true;
    room.invite = null;
    if (room.loop) { clearInterval(room.loop); room.loop = null; }
    room.match = null; room.brains = {};
    this.io.to(room.code).emit('room:closed', { code: room.code, reason });
    const sockets = this.io.sockets.adapter.rooms.get(room.code);
    if (sockets) for (const id of Array.from(sockets)) { const so = this.io.sockets.sockets.get(id); if (so) so.leave(room.code); }
    for (const sp of room.spectators) { const ss = this.sessions.get(sp.sid); if (ss && ss.room === room.code) ss.room = null; }
    for (const se of room.seats) { if (se.sid) { const ss = this.sessions.get(se.sid); if (ss && ss.room === room.code) ss.room = null; } }
    this.rooms.delete(room.code);
    this.pushList();
  }

  disconnect(socket) {
    const sess = this.sessOf(socket);
    if (!sess || sess.socketId !== socket.id) return;
    sess.socketId = null;
    if (!sess.room) return;
    const room = this.rooms.get(sess.room);
    if (!room || room.closed) return;
    const m = this.member(room, sess.sid);
    if (!m) return;
    m.connected = false; m.goneAt = Date.now();
    if (m.kind !== 'human') { this.removeMember(room, sess.sid, 'left'); return; }
    this.sys(room, 'chat.sys.drop', { name: m.name });
    this.sendRoom(room);
    setTimeout(() => this.expire(room.code, sess.sid), RECONNECT_MS + 50);
  }

  expire(code, sid) {
    const room = this.rooms.get(code);
    if (!room || room.closed) return;
    const m = room.seats.find((x) => x.kind === 'human' && x.sid === sid);
    if (!m || m.connected || !m.goneAt || Date.now() - m.goneAt < RECONNECT_MS) return;
    if (room.match && room.match.phase !== 'over') {
      /* 對局中逾時：當作出局（變幽靈），不交給電腦；席位保留到這局結束 */
      Rules.forfeit(room.match, sid);
      m.timedOut = true;
      this.sys(room, 'chat.sys.timeout', { name: m.name });
      /* 只剩斷線逾時的真人 → 沒有實體玩家 */
      if (!this.humans(room).some((x) => x.connected || !x.timedOut)) this.close(room, 'empty');
      else this.sendRoom(room);
      return;
    }
    this.removeMember(room, sid, 'timeout');
  }

  /* ---------- 房內操作 ---------- */
  roomOf(socket) {
    const sess = this.sessOf(socket);
    if (!sess || !sess.room) return {};
    const room = this.rooms.get(sess.room);
    if (!room || room.closed) return {};
    return { sess, room, me: this.member(room, sess.sid) };
  }

  ready(socket, p) {
    const { room, me } = this.roomOf(socket);
    if (!room || !me || me.kind !== 'human') return { ok: false, code: 'notplayer' };
    if (room.phase !== 'waiting') return { ok: false, code: 'playing' };
    me.ready = !!(p && p.ready);
    this.sendRoom(room);
    return { ok: true };
  }

  setSkin(socket, p) {
    const { sess, room, me } = this.roomOf(socket);
    if (!room || !me || me.kind !== 'human' || room.phase !== 'waiting') return { ok: false };
    const k = skinOk(p && p.skin);
    if (room.seats.some((x) => x !== me && x.kind !== 'empty' && x.skin === k)) return { ok: false, code: 'skintaken' };
    me.skin = k; sess.skin = k;
    this.sendRoom(room);
    return { ok: true };
  }

  config(socket, p) {
    const { sess, room } = this.roomOf(socket);
    if (!room || room.host !== sess.sid) return { ok: false, code: 'nothost' };
    if (room.phase !== 'waiting') return { ok: false, code: 'playing' };
    const c = room.config;
    if (p.items != null) c.items = !!p.items;
    if (p.private != null) c.private = !!p.private;
    if (p.theme != null && (p.theme === 'random' || (Number.isInteger(+p.theme) && +p.theme >= 0 && +p.theme < 10))) c.theme = p.theme === 'random' ? 'random' : +p.theme;
    if (['ffa', '2v2', '3v3'].includes(p.mode)) c.mode = p.mode;
    if (p.max != null && Number.isInteger(+p.max)) c.max = Math.max(2, Math.min(MAX_SEATS, +p.max));
    if (c.mode === '2v2') c.max = 4;
    if (c.mode === '3v3') c.max = 6;
    /* 人數上限變小：超出的電腦席位移除；超出的真人移到觀戰 */
    for (let i = c.max; i < MAX_SEATS; i++) {
      const s = room.seats[i];
      if (s.kind === 'ai') Object.assign(s, { kind: 'empty', level: null, name: null });
      else if (s.kind === 'human') {
        const free = this.freeSlot(room);
        if (free >= 0 && free < c.max) { room.seats[free] = Object.assign(room.seats[free], s, { slot: free }); Object.assign(s, { kind: 'empty', sid: null, name: null }); }
        else { room.spectators.push({ sid: s.sid, name: s.name, connected: s.connected }); Object.assign(s, { kind: 'empty', sid: null, name: null }); }
      }
    }
    room.seats.forEach((s) => { if (s.kind === 'human') s.ready = false; });
    this.sendRoom(room); this.pushList();
    return { ok: true };
  }

  ai(socket, p) {
    const { sess, room } = this.roomOf(socket);
    if (!room || room.host !== sess.sid) return { ok: false, code: 'nothost' };
    if (room.phase !== 'waiting') return { ok: false, code: 'playing' };
    const slot = +p.slot;
    const s = room.seats[slot];
    if (!s || slot >= room.config.max || s.kind === 'human') return { ok: false, code: 'badslot' };
    if (p.level == null) { Object.assign(s, { kind: 'empty', level: null, name: null }); }
    else {
      if (!LEVELS_ONLINE.includes(p.level)) return { ok: false, code: 'badlevel' };
      const taken = new Set(room.seats.filter((x) => x.kind !== 'empty' && x !== s).map((x) => x.skin));
      let skin = 0; for (let k = 0; k < 8; k++) if (!taken.has(k)) { skin = k; break; }
      Object.assign(s, { kind: 'ai', level: p.level, skin: s.kind === 'ai' ? s.skin : skin, sid: null, name: null, ready: true, connected: true });
    }
    this.sendRoom(room); this.pushList();
    return { ok: true };
  }

  seatSwitch(socket, p) {
    const { sess, room, me } = this.roomOf(socket);
    if (!room || !me) return { ok: false };
    if (room.phase !== 'waiting') return { ok: false, code: 'playing' };
    if (p.action === 'take') {
      if (me.kind === 'human') return { ok: true };
      const slot = this.freeSlot(room);
      if (slot < 0) return { ok: false, code: 'full' };
      room.spectators = room.spectators.filter((x) => x.sid !== sess.sid);
      this.seat(room, slot, sess);
    } else if (p.action === 'spectate') {
      if (me.kind !== 'human') return { ok: true };
      if (room.spectators.length >= MAX_SPECTATORS) return { ok: false, code: 'specfull' };
      Object.assign(me, { kind: 'empty', sid: null, name: null, ready: false });
      room.spectators.push({ sid: sess.sid, name: sess.name, connected: true });
      this.afterChange(room);
      return { ok: true };
    }
    this.sendRoom(room); this.pushList();
    return { ok: true };
  }

  kick(socket, p) {
    const { sess, room } = this.roomOf(socket);
    if (!room || room.host !== sess.sid) return { ok: false, code: 'nothost' };
    if (!p || p.sid === sess.sid) return { ok: false };
    const target = this.sessions.get(p.sid);
    if (!this.member(room, p.sid)) return { ok: false };
    if (target && target.socketId) {
      const so = this.io.sockets.sockets.get(target.socketId);
      if (so) { so.emit('room:kicked', { code: room.code }); so.leave(room.code); }
    }
    this.removeMember(room, p.sid, 'kick');
    return { ok: true };
  }

  regenInvite(socket) {
    const { sess, room } = this.roomOf(socket);
    if (!room || room.host !== sess.sid) return { ok: false, code: 'nothost' };
    room.invite = token();
    this.sendRoom(room);
    return { ok: true };
  }

  /** 邀請預覽（落地頁顯示房名，不加入） */
  peek(p) {
    const room = this.rooms.get(String((p && p.code) || '').toUpperCase());
    if (!room || room.closed) return { ok: false, code: 'closed' };
    if (p.token && p.token !== room.invite) return { ok: false, code: 'badtoken' };
    return { ok: true, name: room.name, players: this.cars(room).length, max: room.config.max, phase: room.phase };
  }

  chat(socket, p) {
    const { sess, room, me } = this.roomOf(socket);
    if (!room || !me) return { ok: false, code: 'notjoined' };
    const now = Date.now();
    if (sess.lastChat && now - sess.lastChat < 600) return { ok: false, code: 'fast' };
    let text;
    if (p && p.quick) { if (!QUICK.includes(p.quick)) return { ok: false }; text = null; }
    else { text = censor(cleanText(p && p.text, 60)); if (!text) return { ok: false, code: 'empty' }; }
    sess.lastChat = now;
    const msg = { id: ++room.chatSeq, name: me.name, sid: sess.sid, text, quick: p && p.quick || null, spec: me.kind !== 'human', ts: now };
    room.chat.push(msg); if (room.chat.length > 50) room.chat.shift();
    this.io.to(room.code).emit('chat:msg', { msg });
    return { ok: true, id: msg.id };
  }

  sys(room, key, params) {
    const msg = { id: ++room.chatSeq, sys: key, params: params || {}, ts: Date.now() };
    room.chat.push(msg); if (room.chat.length > 50) room.chat.shift();
    this.io.to(room.code).emit('chat:msg', { msg });
  }

  /* ---------- 對局 ---------- */
  start(socket) {
    const { sess, room } = this.roomOf(socket);
    if (!room || room.host !== sess.sid) return { ok: false, code: 'nothost' };
    if (room.phase !== 'waiting') return { ok: false, code: 'playing' };
    const cars = this.cars(room).filter((x) => x.slot < room.config.max);
    if (cars.length < 2) return { ok: false, code: 'needtwo' };
    if (this.humans(room).some((x) => !x.ready && x.sid !== room.host)) return { ok: false, code: 'notready' };
    if (room.config.mode !== 'ffa') {
      const need = room.config.mode === '2v2' ? 4 : 6;
      if (cars.length !== need) return { ok: false, code: 'teamcount' };
    }
    this.begin(room);
    return { ok: true };
  }

  begin(room) {
    room.round++;
    room.phase = 'playing';
    room.result = null;
    const teams = room.config.mode !== 'ffa';
    const seats = this.cars(room).filter((x) => x.slot < room.config.max);
    const defs = seats.map((s, i) => ({
      id: s.kind === 'human' ? s.sid : 'ai' + s.slot,
      name: s.kind === 'human' ? s.name : null,
      skin: s.skin, level: s.kind === 'ai' ? s.level : null, human: s.kind === 'human',
      team: teams ? (room.config.mode === '2v2' ? (i % 2) : (i % 2)) : i
    }));
    room.seed = room.code + ':' + room.round + ':' + token().slice(0, 8);
    room.match = Rules.createMatch({
      seed: room.seed, cars: defs, items: room.config.items, mode: 'online', teams, theme: room.config.theme,
      countdown: COUNTDOWN_MS / 1000, duration: MATCH_SECONDS
    });
    room.defs = defs;
    room.brains = {};
    defs.forEach((d) => { if (!d.human) room.brains[d.id] = AI.create(d.level, room.seed + d.id); });
    if (AI_SCALE !== 1) Object.values(room.brains).forEach((b) => { b.p = Object.assign({}, b.p, { ms: b.p.ms * AI_SCALE }); });
    room.seats.forEach((s) => { s.timedOut = false; });
    this.io.to(room.code).emit('game:init', this.gameInit(room));
    this.sendRoom(room); this.pushList();
    if (room.loop) clearInterval(room.loop);
    room.pendingEvents = [];
    /* 依實際經過時間跑固定步長（計時器在 Windows／免費主機上不準），每 2 步廣播一次 ≈ 30 次／秒 */
    room.lastTickAt = Date.now(); room.simAcc = 0; room.stepCount = 0; room.evBuf = [];
    room.loop = setInterval(() => this.tick(room), 8);
  }

  gameInit(room) {
    const m = room.match;
    return {
      round: room.round, seed: room.seed, theme: room.config.theme, items: room.config.items,
      teams: room.config.mode !== 'ffa', mode: room.config.mode,
      cars: room.defs.map((d) => ({ id: d.id, name: d.name, skin: d.skin, level: d.level, human: d.human, team: d.team })),
      countdown: COUNTDOWN_MS / 1000, duration: m.opts.duration,
      snap: Rules.snapshot(m)
    };
  }

  input(socket, p) {
    const { sess, room } = this.roomOf(socket);
    if (!room || !room.match || !p) return;
    const car = Rules.getCar(room.match, sess.sid);
    if (!car) return;   // 觀戰者不能操作
    const seat = room.seats.find((x) => x.sid === sess.sid);
    if (seat && seat.timedOut && car.alive) return;
    Rules.setInput(room.match, sess.sid, { mx: +p.mx || 0, my: +p.my || 0, dash: !!p.dash, item: !!p.item });
    if (typeof p.seq === 'number') car.lastSeq = p.seq;
  }

  tick(room) {
    const m = room.match;
    if (!m || room.closed) return;
    const now = Date.now();
    room.simAcc += Math.min(250, now - room.lastTickAt);
    room.lastTickAt = now;
    const evts = room.evBuf;
    let stepped = 0;
    while (room.simAcc >= Rules.DT * 1000 && stepped < 8) {
      room.simAcc -= Rules.DT * 1000; stepped++; room.stepCount++;
      for (const c of m.cars) {
        const b = room.brains[c.id];
        if (b) Rules.setInput(m, c.id, AI.think(m, c, b));
        else {
          const seat = room.seats.find((x) => x.sid === c.id);
          if (!seat || !seat.connected) { c.input.mx = 0; c.input.my = 0; c.input.dash = false; c.input.item = false; }
        }
      }
      Rules.step(m);
      for (const e of m.events) if (SEND_EVENTS[e.type]) evts.push(e);
      if (m.phase === 'over') break;
    }
    if (!stepped || (room.stepCount % 2 !== 0 && m.phase !== 'over')) return;
    room.evBuf = [];
    const snap = Rules.snapshot(m);
    snap.ev = evts;
    snap.acks = {};
    for (const c of m.cars) if (c.lastSeq != null) snap.acks[c.id] = c.lastSeq;
    this.io.to(room.code).volatile.emit('game:state', snap);
    if (evts.length) this.io.to(room.code).emit('game:events', { tick: m.tick, ev: evts.filter((e) => e.type === 'fall' || e.type === 'over' || e.type === 'go') });
    if (m.phase === 'over') this.finish(room);
  }

  finish(room) {
    clearInterval(room.loop); room.loop = null;
    const res = Rules.result(room.match);
    room.result = res;
    room.phase = 'waiting';
    this.io.to(room.code).emit('game:over', { round: room.round, result: res, snap: Rules.snapshot(room.match) });
    room.match = null;
    /* 斷線逾時或對局中離開的真人，這時才真正移出席位 */
    for (const s of room.seats) {
      if (s.kind === 'human') { s.ready = false; if (!s.connected && s.goneAt && Date.now() - s.goneAt >= RECONNECT_MS) this.removeMember(room, s.sid, 'timeout'); }
    }
    if (!room.closed) { this.sendRoom(room); this.pushList(); }
  }

  /* ---------- 廣播房間狀態（每個人看到自己的角色） ---------- */
  sendRoom(room) {
    if (room.closed) return;
    const base = {
      code: room.code, name: room.name, host: room.host, phase: room.phase, config: room.config, invite: room.invite, round: room.round,
      seats: room.seats.map((s) => ({ slot: s.slot, kind: s.kind, sid: s.kind === 'human' ? s.sid : null, name: s.name, skin: s.skin, level: s.level, ready: !!s.ready, connected: s.connected !== false, open: s.slot < room.config.max })),
      spectators: room.spectators.map((s) => ({ sid: s.sid, name: s.name })),
      chat: room.chat.slice(-30), result: room.result
    };
    const sockets = this.io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const id of sockets) {
      const so = this.io.sockets.sockets.get(id);
      if (!so || !so.data.sid) continue;
      const m = this.member(room, so.data.sid);
      so.emit('room:state', Object.assign({}, base, { you: { sid: so.data.sid, role: m ? (m.kind === 'human' ? 'player' : 'spectator') : 'none', host: room.host === so.data.sid } }));
    }
  }

  /** 遊戲在線人數：已打過招呼、目前連著的使用者（大廳＋房間，含觀戰；電腦不算） */
  onlineCount() {
    let n = 0;
    for (const s of this.sessions.values()) if (s.socketId) n++;
    return n;
  }
  pushOnline() {
    const n = this.onlineCount();
    if (n === this.lastOnline) return;
    this.lastOnline = n;
    this.io.emit('online:count', { n });
  }

  stats() { return { rooms: this.rooms.size, sessions: this.sessions.size }; }
}

module.exports = { Hub, cleanName, LEVELS_ONLINE, MAX_SPECTATORS };
