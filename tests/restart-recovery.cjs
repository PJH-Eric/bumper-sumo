'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: sleep } = require('node:timers/promises');
const { io } = require('socket.io-client');

async function exercise(base, restart) {
  const sockets = [];
  async function connect(url, name, session = {}) {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5000 });
    sockets.push(socket);
    const player = { socket, send: (event, payload) => socket.timeout(5000).emitWithAck(event, payload || {}) };
    socket.on('room:state', room => { player.room = room; });
    socket.on('game:init', init => { player.init = init; });
    socket.on('game:state', state => { player.state = state; });
    socket.on('game:events', events => {
      if (events.ev.some(event => event.type === 'go')) player.confirmedTick = events.tick;
    });
    player.session = await player.send('hello', { ...session, name });
    assert.ok(player.session.ok);
    return player;
  }

  async function waitFor(read) {
    for (let i = 0; i < 200; i++) {
      const result = read();
      if (result) return result;
      await sleep(50);
    }
    assert.fail('等不到房間或對局狀態');
  }

  try {
    const host = await connect(base, 'Recovery host');
    const guest = await connect(base, 'Recovery mate');
    assert.ok(host.session.resumeKey && guest.session.resumeKey);
    const { ok, code } = await host.send('room:create', { private: true });
    assert.ok(ok);
    assert.ok((await guest.send('room:join', { code })).ok);
    const { slot } = guest.room.seats.find(seat => seat.sid === guest.session.sid);
    assert.ok((await guest.send('room:ready', { ready: true })).ok);
    assert.ok((await host.send('game:start')).ok);
    const confirmedTick = await waitFor(() => host.confirmedTick);
    const spawn = host.init.snap.cars.find(car => car.id === host.session.sid);
    const direction = Math.hypot(spawn.x, spawn.y);
    host.socket.emit('game:input', { mx: -spawn.x / direction, my: -spawn.y / direction, seq: 10 });
    await waitFor(() => {
      const position = host.state?.cars.find(car => car.id === spawn.id);
      return position && Math.hypot(position.x - spawn.x, position.y - spawn.y) > 0.3;
    });
    host.socket.emit('game:input', { mx: 0, my: 0, seq: 11 });
    await waitFor(() => host.state?.acks[spawn.id] === 11);
    await sleep(310);
    const restarted = await restart({ code });
    const impostor = await connect(restarted, 'Other', { sid: host.session.sid });
    assert.notEqual(impostor.session.sid, host.session.sid);
    assert.equal(impostor.session.room, null);
    const back = await connect(restarted, 'Recovery host', host.session);
    assert.equal(back.session.room, code);
    assert.equal(back.room.you.sid, host.session.sid);
    assert.equal(back.room.you.host, true);
    assert.equal(back.room.recovering, true);
    assert.equal(back.init.round, host.init.round);
    assert.equal(back.init.seed, host.init.seed);
    assert.equal(back.init.snap.phase, 'playing');
    assert.ok(back.init.snap.tick >= confirmedTick);
    const savedCar = back.init.snap.cars.find(car => car.id === spawn.id);
    assert.ok(Math.hypot(savedCar.x - spawn.x, savedCar.y - spawn.y) > 0.3);
    await sleep(250);
    assert.equal(back.state, undefined);

    const mate = await connect(restarted, 'Recovery mate', guest.session);
    assert.equal(mate.session.room, code);
    assert.equal(mate.room.seats[slot].sid, guest.session.sid);
    assert.equal(mate.room.you.role, 'player');
    assert.deepEqual(mate.init.snap, back.init.snap);
    await waitFor(() => back.state?.tick > mate.init.snap.tick);
    assert.equal(back.room.recovering, false);
    await mate.send('room:leave');
    await back.send('room:leave');
    return { code, round: back.init.round, tick: back.init.snap.tick };
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

function start(file) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BUMPER_ROOM_DB_PATH: file, PORT: '0', HOST: '127.0.0.1', COUNTDOWN_MS: '100', QUIET_BANNER: '1' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const base = Promise.race([
    once(child.stdout, 'data').then(([data]) => {
      const port = String(data).match(/localhost:(\d+)/)?.[1];
      assert.ok(port, String(data));
      return 'http://127.0.0.1:' + port;
    }),
    once(child, 'exit').then(([code]) => { throw new Error('等待伺服器啟動失敗 (' + code + ')'); })
  ]);
  return { child, base };
}

async function stop(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  const done = once(child, 'exit');
  child.kill('SIGKILL');
  await done;
}

if (require.main === module) test('強制重啟後保留原房、座位和碰碰車場上狀態', { timeout: 25000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bumper-sumo-restart-'));
  const file = path.join(directory, 'rooms.sqlite');
  let server = start(file);
  try {
    await exercise(await server.base, async () => {
      await stop(server.child);
      server = start(file);
      return server.base;
    });
  } finally {
    await stop(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

module.exports = { exercise };
