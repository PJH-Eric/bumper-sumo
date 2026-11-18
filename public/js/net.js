/* ===== net.js — 線上連線（只有使用者進入線上模式才載入 socket.io 並連線；離開就斷線） ===== */
(function (root) {
  'use strict';
  var socket = null, loading = null, handlers = {}, status = 'idle', sid = null;
  var lastMsg = 0, watchdog = null, pinger = null, rtt = 0, connectionAttempt = 0;
  var SID_KEY = 'bumper-sumo:v1:sid';

  function emitLocal(evt, data) { (handlers[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }
  function setStatus(s, extra) {
    status = s;
    if (root.ServerOutage) root.ServerOutage.state(s === 'connected' ? 'connected' : s);
    emitLocal('status', Object.assign({ status: s }, extra || {}));
  }

  function loadLib() {
    if (root.io) return Promise.resolve();
    if (loading) return loading;
    var url = root.GameConfig.url('/socket.io/socket.io.js');
    loading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { loading = null; s.remove(); rej(new Error('load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function getSid() { try { return root.sessionStorage.getItem(SID_KEY) || null; } catch (e) { return null; } }
  function saveSid(v) { try { root.sessionStorage.setItem(SID_KEY, v); } catch (e) { /* 無痕 */ } }

  var Net = {
    on: function (evt, fn) { (handlers[evt] || (handlers[evt] = [])).push(fn); },
    status: function () { return status; },
    rtt: function () { return rtt; },
    sid: function () { return sid; },
    connected: function () { return !!socket && socket.connected; },
    /** 進入線上模式時呼叫 */
    connect: function (profile) {
      if (!root.GameConfig.isOnlineEnabled()) { setStatus('unavailable'); return Promise.reject(new Error('unavailable')); }
      if (socket) { if (!socket.connected) socket.connect(); return Promise.resolve(); }
      var attempt = ++connectionAttempt;
      setStatus('connecting');
      return loadLib().then(function () {
        if (attempt !== connectionAttempt) return;
        socket = root.io(root.GameConfig.serverUrl, { transports: ['websocket', 'polling'], reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 20000 });
        if (root.NetworkLatency && root.NetworkLatency.bindSocketIo) root.NetworkLatency.bindSocketIo(socket);
        /* 任何訊息都算活著；超過 5 秒沒消息就判定斷線並重連 */
        socket.onAny(function () { lastMsg = Date.now(); });
        socket.on('hb', function () { lastMsg = Date.now(); });
        clearInterval(watchdog);
        watchdog = setInterval(function () {
          if (socket && socket.connected && Date.now() - lastMsg > 5000) { socket.disconnect(); socket.connect(); }
        }, 1000);
        clearInterval(pinger);
        pinger = setInterval(function () {
          if (!socket || !socket.connected) return;
          var t0 = performance.now();
          socket.emit('latency:ping', Date.now(), function () { var v = performance.now() - t0; rtt = rtt ? rtt * 0.7 + v * 0.3 : v; });
        }, 2000);
        socket.on('connect', function () {
          lastMsg = Date.now();
          socket.emit('hello', { sid: sid || getSid(), name: profile().name, skin: profile().skin }, function (r) {
            if (r && r.ok) { sid = r.sid; saveSid(sid); }
            setStatus('connected', { room: r && r.room, online: r && r.online });
          });
        });
        socket.on('disconnect', function (why) { setStatus(why === 'io client disconnect' ? 'idle' : 'reconnecting'); });
        socket.on('connect_error', function () { setStatus('retrying'); });
        ['online:count', 'room:list', 'room:state', 'room:closed', 'room:kicked', 'game:init', 'game:state', 'game:events', 'game:over', 'chat:msg',
          'lobbychat:history', 'lobbychat:msg', 'lobbychat:online', 'lobbychat:error'].forEach(function (evt) {
          socket.on(evt, function (d) { emitLocal(evt, d); });
        });
      }).catch(function (e) {
        if (attempt !== connectionAttempt) return;
        setStatus('error');
        throw e;
      });
    },
    /** 離開線上模式：斷線並停止所有背景工作 */
    disconnect: function () {
      connectionAttempt++;
      clearInterval(watchdog); clearInterval(pinger); watchdog = null; pinger = null;
      if (socket) { socket.removeAllListeners(); socket.offAny(); socket.disconnect(); socket = null; }
      setStatus('idle');
    },
    send: function (evt, payload) {
      return new Promise(function (res) {
        if (!socket || !socket.connected) { res({ ok: false, code: 'offline' }); return; }
        if (root.GameAnalytics && /^room:(create|join|quick)$/.test(evt)) root.GameAnalytics.roomRequest({ type: evt === 'room:create' ? 'create' : 'join', token: payload && payload.token });
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; res({ ok: false, code: 'timeout' }); } }, 8000);
        socket.emit(evt, payload || {}, function (r) {
          if (done) return; done = true; clearTimeout(timer);
          if (root.GameAnalytics) {
            if (evt === 'room:leave') root.GameAnalytics.roomLeft();
            else if (/^room:(create|join|quick)$/.test(evt)) root.GameAnalytics.roomResponse(r && r.ok ? 'joined' : 'error', r && r.code);
          }
          res(r || { ok: false });
        });
      });
    },
    /** 對局輸入走 volatile（掉了就算了，下一筆會補上） */
    input: function (p) {
      if (!socket || !socket.connected) return;
      /* 衝刺與道具是一次性的動作，一定要送到；方向可以掉 */
      if (p.dash || p.item) socket.emit('game:input', p); else socket.volatile.emit('game:input', p);
    }
  };
  root.BumperNet = Net;
}(typeof window !== 'undefined' ? window : this));
