/* ===== records.js — 對局紀錄、統計、個人最佳與成就（只存本機，不連後端） =====
 *
 * 計入資格：
 *   - 單機（跟電腦玩）：本機規則確認的最終結果；分「本局難度」統計。
 *   - 線上：只收伺服器 game:over 送來的最終結果；觀戰不計。
 *   - 自由練習、教學、中途離開：不計入。
 * 去重：gameId＋profileId＋matchId；已記過的 matchId 另存一份（不只看近期明細），重送不會重複累計或通知。
 * 保存：localStorage「bumper-sumo:v1:records」，schemaVersion 1；近期明細保留 100 局。
 */
(function (root) {
  'use strict';
  var KEY = 'bumper-sumo:v1:records';
  var GAME = 'bumper-sumo';
  var SCHEMA = 1;
  var KEEP = 100, KEEP_IDS = 3000;
  var ITEM_ALL = ['super', 'iron', 'banana', 'magnet', 'shield', 'spring'];

  /* 成就定義：id 穩定、文字用翻譯 key、門檻與進度計算明確 */
  var ACH = [
    { id: 'first_game', icon: 'flag', target: 1, kind: 'total', metric: 'games' },
    { id: 'first_win', icon: 'crown', target: 1, kind: 'total', metric: 'wins' },
    { id: 'games_20', icon: 'car', target: 20, kind: 'total', metric: 'games' },
    { id: 'ko_3', icon: 'star', target: 3, kind: 'single', metric: 'kos' },
    { id: 'ko_50', icon: 'boom', target: 50, kind: 'total', metric: 'kos' },
    { id: 'rescue_3', icon: 'life', target: 3, kind: 'single', metric: 'rescues' },
    { id: 'untouched', icon: 'shield', target: 1, kind: 'single', metric: 'untouchedWin' },
    { id: 'beat_mythic', icon: 'dragon', target: 1, kind: 'single', metric: 'mythicWin' },
    { id: 'ghost_3', icon: 'ghost', target: 3, kind: 'single', metric: 'ghostDrops' },
    { id: 'all_items', icon: 'box', target: ITEM_ALL.length, kind: 'set', metric: 'itemsUsed' },
    { id: 'online_win', icon: 'globe', target: 1, kind: 'single', metric: 'onlineWin' }
  ];

  var memory = null, saveOk = true;

  function blank() {
    return { schemaVersion: SCHEMA, gameId: GAME, profileId: newId(), matches: [], seen: [], stats: {}, best: {}, ach: {}, itemsUsed: [] };
  }
  function newId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) { /* 舊瀏覽器 */ }
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** 讀取並驗證；壞掉時保留原始字串備份，不直接清空 */
  function load() {
    if (memory) return memory;
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { saveOk = false; }
    var d = null;
    if (raw) {
      try { d = JSON.parse(raw); } catch (e) { d = null; }
      if (!d || typeof d !== 'object' || d.gameId !== GAME) {
        try { root.localStorage.setItem(KEY + ':corrupt:' + Date.now(), raw); } catch (e2) { /* 存不下就算了 */ }
        d = null;
      }
    }
    d = migrate(d || blank());
    memory = d;
    return d;
  }
  function migrate(d) {
    /* schemaVersion 1 是第一版；之後的版本在這裡逐版升級 */
    if (!d.schemaVersion) d.schemaVersion = 1;
    if (!d.profileId) d.profileId = newId();
    ['matches', 'seen', 'itemsUsed'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    ['stats', 'best', 'ach'].forEach(function (k) { if (!d[k] || typeof d[k] !== 'object') d[k] = {}; });
    return d;
  }
  function persist() {
    try { root.localStorage.setItem(KEY, JSON.stringify(memory)); saveOk = true; }
    catch (e) { saveOk = false; }
    return saveOk;
  }

  function bucketKey(mode, diff) { return mode === 'online' ? 'online' : 'solo:' + diff; }

  /**
   * 記錄一局。row：{ matchId, mode:'solo'|'online', difficulty, place, total, kos, survive, rescues, dashes, hits, items[], ghostDrops, hasMythic, startedAt, endedAt, teams }
   * 回傳 { recorded, duplicate, newBest:[...], unlocked:[...], saved }
   */
  function record(row) {
    var d = load();
    if (!row || !row.matchId) return { recorded: false };
    if (d.seen.indexOf(row.matchId) >= 0) return { recorded: false, duplicate: true, newBest: [], unlocked: [], saved: saveOk };
    var win = row.place === 1;
    var entry = {
      matchId: row.matchId, mode: row.mode, difficulty: row.difficulty || null, place: row.place, total: row.total,
      kos: row.kos | 0, survive: Math.round(row.survive || 0), rescues: row.rescues | 0, dashes: row.dashes | 0, hits: row.hits | 0,
      items: (row.items || []).slice(0, 20), ghostDrops: row.ghostDrops | 0, teams: !!row.teams,
      startedAt: row.startedAt || new Date().toISOString(), endedAt: new Date().toISOString(), rules: 1
    };
    d.matches.unshift(entry);
    if (d.matches.length > KEEP) d.matches.length = KEEP;
    d.seen.push(row.matchId);
    if (d.seen.length > KEEP_IDS) d.seen.splice(0, d.seen.length - KEEP_IDS);

    /* 統計（依模式／難度分開） */
    var bk = bucketKey(row.mode, row.difficulty);
    var st = d.stats[bk] || (d.stats[bk] = { games: 0, wins: 0, kos: 0, rescues: 0, survive: 0 });
    st.games++; if (win) st.wins++; st.kos += entry.kos; st.rescues += entry.rescues; st.survive += entry.survive;
    var tot = d.stats.all || (d.stats.all = { games: 0, wins: 0, kos: 0, rescues: 0, survive: 0 });
    tot.games++; if (win) tot.wins++; tot.kos += entry.kos; tot.rescues += entry.rescues; tot.survive += entry.survive;

    /* 個人最佳（同一量尺：各模式／難度分開） */
    var b = d.best[bk] || (d.best[bk] = { kos: 0, survive: 0, rescues: 0 });
    var newBest = [];
    if (entry.kos > b.kos) { b.kos = entry.kos; newBest.push('kos'); }
    if (entry.survive > b.survive && !win) { b.survive = entry.survive; newBest.push('survive'); }
    if (win && entry.survive > b.survive) { b.survive = entry.survive; newBest.push('survive'); }
    if (entry.rescues > b.rescues) { b.rescues = entry.rescues; newBest.push('rescues'); }

    /* 成就 */
    (row.items || []).forEach(function (it) { if (ITEM_ALL.indexOf(it) >= 0 && d.itemsUsed.indexOf(it) < 0) d.itemsUsed.push(it); });
    var single = {
      kos: entry.kos, rescues: entry.rescues, ghostDrops: entry.ghostDrops,
      untouchedWin: win && entry.hits === 0 && row.total >= 3 ? 1 : 0,
      mythicWin: win && row.hasMythic ? 1 : 0,
      onlineWin: win && row.mode === 'online' ? 1 : 0
    };
    var unlocked = [];
    ACH.forEach(function (a) {
      var cur = d.ach[a.id] || (d.ach[a.id] = { progress: 0, unlockedAt: null });
      if (cur.unlockedAt) return;
      var v;
      if (a.kind === 'total') v = tot[a.metric];
      else if (a.kind === 'set') v = d.itemsUsed.length;
      else v = Math.max(cur.progress, single[a.metric] || 0);
      cur.progress = Math.min(a.target, v);
      if (v >= a.target) { cur.unlockedAt = new Date().toISOString(); unlocked.push(a.id); }
    });
    var saved = persist();
    return { recorded: true, duplicate: false, newBest: newBest, unlocked: unlocked, saved: saved };
  }

  function clearAll() {
    var pid = load().profileId;
    memory = blank(); memory.profileId = pid;
    try { root.localStorage.removeItem(KEY); } catch (e) { /* 被擋 */ }
    persist();
  }

  /* 其他分頁寫入時同步（避免舊分頁回寫舊資料） */
  if (root.addEventListener) root.addEventListener('storage', function (e) { if (e.key === KEY) memory = null; });

  root.BumperRecords = {
    ACH: ACH, ITEM_ALL: ITEM_ALL, KEEP: KEEP,
    data: load, record: record, clearAll: clearAll, saveOk: function () { return saveOk; },
    bucketKey: bucketKey, _reset: function () { memory = null; }
  };
}(typeof window !== 'undefined' ? window : this));
