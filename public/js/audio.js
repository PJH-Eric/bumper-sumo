/* ===== audio.js — Web Audio 合成音效與背景音樂（無外部音檔，可替換） =====
 * 首次使用者手勢後才建立 AudioContext；音樂與音效各自獨立音量；靜音時遊戲照樣能玩。 */
(function (root) {
  'use strict';
  var ctx = null, master = null, sfxBus = null, musicBus = null;
  var vol = { music: 0.6, sfx: 0.8 };
  var bgm = { on: false, timer: null, step: 0, nextT: 0, tempo: 1, mood: 'menu' };
  var lastPlay = {};

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = vol.music * 0.35; musicBus.connect(master);
    return ctx;
  }

  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
    if (bgm.on && !bgm.timer) startLoop();
  }

  function tone(freq, dur, type, gain, when, bus, slideTo, attack) {
    var c = ctx; if (!c) return;
    var t = (when || c.currentTime);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + (attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  function noise(dur, gain, when, filterFreq, q, bus) {
    var c = ctx; if (!c) return;
    var t = when || c.currentTime;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterFreq || 1200; f.Q.value = q || 1;
    var g = c.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(bus || sfxBus);
    src.start(t);
    return f;
  }

  /** name：音效名稱；p：力道等參數 */
  function sfx(name, p) {
    if (!ctx || vol.sfx <= 0) return;
    var now = ctx.currentTime;
    /* 同一種音效太密集就略過，避免爆音 */
    var gap = { bonk: 0.05, tick: 0.2, wobble: 0.25, pickup: 0.05 }[name] || 0.03;
    if (lastPlay[name] && now - lastPlay[name] < gap) return;
    lastPlay[name] = now;
    var pw = Math.min(1, ((p && p.power) || 3) / 10);
    switch (name) {
      case 'bonk':   /* 碰！ */
        tone(180 + pw * 60, 0.18, 'sine', 0.5 + pw * 0.4, now, null, 70);
        noise(0.08, 0.35 + pw * 0.3, now, 900, 0.8);
        tone(520, 0.06, 'triangle', 0.15, now);
        break;
      case 'clash':
        tone(300, 0.25, 'square', 0.25, now, null, 120); noise(0.15, 0.5, now, 2400, 1.5); tone(900, 0.2, 'triangle', 0.2, now + 0.03, null, 1400); break;
      case 'charge': tone(220, 0.15, 'sawtooth', 0.12, now, null, 440); break;
      case 'dash': noise(0.28, 0.35, now, 1600, 0.6); tone(300, 0.2, 'triangle', 0.12, now, null, 700); break;
      case 'super': noise(0.4, 0.45, now, 700, 0.5); tone(160, 0.35, 'sawtooth', 0.2, now, null, 500); break;
      case 'fall':   /* 咻—— */
        tone(1400, 0.75, 'sine', 0.3, now, null, 180); tone(1410, 0.75, 'triangle', 0.1, now, null, 170); break;
      case 'wobble': /* 喔喔喔 */
        for (var i = 0; i < 3; i++) tone(420 - i * 30, 0.12, 'triangle', 0.22, now + i * 0.11, null, 360 - i * 30, 0.02);
        break;
      case 'pickup': /* 啵嘰 */
        tone(700, 0.07, 'sine', 0.35, now, null, 1300); tone(1500, 0.09, 'sine', 0.25, now + 0.07, null, 2100); break;
      case 'use': tone(520, 0.1, 'triangle', 0.25, now, null, 880); break;
      case 'shield': tone(880, 0.25, 'sine', 0.22, now, null, 1320); tone(1320, 0.3, 'sine', 0.12, now + 0.05); break;
      case 'block': tone(1200, 0.12, 'square', 0.15, now, null, 600); noise(0.06, 0.2, now, 3000, 2); break;
      case 'spring': tone(200, 0.35, 'sine', 0.35, now, null, 900); tone(300, 0.3, 'triangle', 0.12, now + 0.05, null, 1100); break;
      case 'land': tone(160, 0.12, 'sine', 0.3, now, null, 90); break;
      case 'slip': tone(900, 0.4, 'triangle', 0.2, now, null, 200); break;
      case 'magnet': tone(110, 0.6, 'sawtooth', 0.12, now, null, 220); break;
      case 'iron': tone(90, 0.3, 'square', 0.22, now, null, 60); noise(0.1, 0.3, now, 400, 1); break;
      case 'banana': tone(600, 0.08, 'sine', 0.2, now, null, 300); break;
      case 'rescue': tone(523, 0.08, 'triangle', 0.25, now); tone(784, 0.12, 'triangle', 0.25, now + 0.08); break;
      case 'ghost': tone(660, 0.4, 'sine', 0.15, now, null, 440, 0.1); break;
      case 'drop': tone(500, 0.3, 'sine', 0.18, now, null, 250); break;
      case 'count': tone(660, 0.16, 'square', 0.2, now); break;
      case 'go': tone(990, 0.4, 'square', 0.22, now); tone(1320, 0.4, 'triangle', 0.14, now); break;
      case 'tick': tone(1500, 0.05, 'square', 0.12, now); break;
      case 'warn': tone(440, 0.12, 'square', 0.1, now); break;
      case 'click': tone(800, 0.04, 'triangle', 0.15, now); break;
      case 'win':
        [523, 659, 784, 1047].forEach(function (f, k) { tone(f, 0.25, 'triangle', 0.25, now + k * 0.12); });
        tone(1319, 0.5, 'sine', 0.2, now + 0.5); break;
      case 'lose':
        [523, 466, 415, 392].forEach(function (f, k) { tone(f, 0.25, 'triangle', 0.2, now + k * 0.15); }); break;
      case 'chat': tone(1100, 0.06, 'sine', 0.15, now); tone(1400, 0.06, 'sine', 0.12, now + 0.06); break;
      case 'join': tone(660, 0.1, 'sine', 0.18, now); tone(880, 0.12, 'sine', 0.18, now + 0.09); break;
    }
  }

  /* ---------- 背景音樂：遊樂園風的低干擾循環 ---------- */
  var SONGS = {
    menu: { bpm: 112, bass: [48, 0, 55, 0, 53, 0, 55, 0], mel: [72, 76, 79, 76, 77, 74, 72, 0, 74, 77, 81, 77, 79, 76, 74, 0] },
    play: { bpm: 138, bass: [45, 52, 45, 52, 41, 48, 43, 50], mel: [76, 0, 79, 76, 81, 79, 76, 74, 72, 0, 74, 76, 79, 0, 76, 0] }
  };
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function startLoop() {
    if (!ctx || bgm.timer) return;
    bgm.nextT = ctx.currentTime + 0.1;
    bgm.timer = setInterval(schedule, 60);
  }
  function schedule() {
    if (!ctx || !bgm.on) return;
    var song = SONGS[bgm.mood] || SONGS.menu;
    var spb = 60 / (song.bpm * bgm.tempo) / 2;   // 八分音符
    while (bgm.nextT < ctx.currentTime + 0.25) {
      var st = bgm.step;
      var b = song.bass[st % song.bass.length];
      if (b) tone(mtof(b), spb * 0.9, 'triangle', 0.35, bgm.nextT, musicBus);
      var m = song.mel[st % song.mel.length];
      if (m && (st % 32) < 24) tone(mtof(m), spb * 0.8, 'square', 0.08, bgm.nextT, musicBus);
      if (st % 2 === 1) noise(0.03, 0.06, bgm.nextT, 6000, 1, musicBus);
      bgm.nextT += spb;
      bgm.step++;
    }
  }

  root.BumperAudio = {
    unlock: unlock,
    sfx: sfx,
    setVolume: function (kind, v) {
      vol[kind] = Math.max(0, Math.min(1, v));
      if (sfxBus && kind === 'sfx') sfxBus.gain.value = vol.sfx;
      if (musicBus && kind === 'music') musicBus.gain.value = vol.music * 0.35;
    },
    music: function (on, mood) {
      if (mood) { if (mood !== bgm.mood) bgm.step = 0; bgm.mood = mood; }
      bgm.on = !!on && vol.music > 0;
      if (!bgm.on && bgm.timer) { clearInterval(bgm.timer); bgm.timer = null; }
      if (bgm.on && ctx) startLoop();
    },
    tempo: function (k) { bgm.tempo = k; },
    ready: function () { return !!ctx && ctx.state === 'running'; }
  };
}(typeof window !== 'undefined' ? window : this));
