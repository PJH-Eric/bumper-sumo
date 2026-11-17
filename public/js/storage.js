/* ===== storage.js — 本機紀錄（localStorage，前綴 bumper-sumo:v1） ===== */
(function (root) {
  'use strict';
  var P = 'bumper-sumo:v1:';
  function get(k, def) {
    try { var v = root.localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function set(k, v) { try { root.localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { /* 無痕或額度滿 */ } }

  var DEFAULT_SETTINGS = {
    music: 0.6, sfx: 0.8, shake: true, colorBlind: false, reduceMotion: false,
    touchSize: 1, touchAlpha: 0.75, lobbyChat: true, names: true
  };
  var DEFAULT_SOLO = { skin: 0, cpus: ['normal', 'easy', 'normal'], session: 'auto', theme: 0, items: true };
  var DEFAULT_STATS = { games: 0, wins: 0, kos: 0, bestKos: 0, longest: 0 };

  var Store = {
    settings: function () { return Object.assign({}, DEFAULT_SETTINGS, get('settings', {})); },
    saveSettings: function (s) { set('settings', s); },
    defaults: function () { return Object.assign({}, DEFAULT_SETTINGS); },
    solo: function () {
      var s = Object.assign({}, DEFAULT_SOLO, get('solo', {}));
      if (!Array.isArray(s.cpus) || !s.cpus.length) s.cpus = DEFAULT_SOLO.cpus.slice();
      s.cpus = s.cpus.slice(0, 5).map(function (l) { return ['kid', 'easy', 'normal', 'hard', 'mythic'].indexOf(l) >= 0 ? l : 'normal'; });
      return s;
    },
    saveSolo: function (s) { set('solo', s); },
    name: function () { return get('name', ''); },
    saveName: function (n) { set('name', n); },
    skin: function () { var k = get('skin', 0); return k >= 0 && k < 8 ? k : 0; },
    saveSkin: function (k) { set('skin', k); },
    stats: function () { return Object.assign({}, DEFAULT_STATS, get('stats', {})); },
    record: function (row) {
      var s = Store.stats();
      s.games++;
      if (row.place === 1) s.wins++;
      s.kos += row.kos; s.bestKos = Math.max(s.bestKos, row.kos);
      s.longest = Math.max(s.longest, Math.round(row.survive));
      set('stats', s);
      return s;
    },
    get: get, set: set
  };
  root.BumperStore = Store;
}(typeof window !== 'undefined' ? window : this));
