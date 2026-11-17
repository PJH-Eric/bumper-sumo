/* ===== app.js — 畫面流程與遊戲控制（單機、自由練習、線上） ===== */
(function (w) {
  'use strict';
  var doc = w.document;
  var R = w.BumperRules, AI = w.BumperAI, Art = w.BumperArt, Store = w.BumperStore, Audio = w.BumperAudio, I18N = w.I18N, UI = w.UI, Net = w.BumperNet, Input = w.BumperInput;
  var t = function (k, p) { return I18N.t(k, p); };
  var $ = function (id) { return doc.getElementById(id); };
  var LEVELS = R.LEVELS;
  var ANIMALS = Art.CARS.map(function (c) { return c.animal; });
  var TEAM_COLORS = ['#38b6ff', '#ff5a5a', '#4ee07a'];

  var S = {
    screen: 'home', mode: null, match: null, brains: {}, myId: 'me', paused: false,
    acc: 0, last: 0, raf: 0, resultShown: false, overAt: 0, names: {}, settings: Store.settings(),
    soloCfg: Store.solo(), practiceN: 3, warnNext: 0, tickSec: -1, cdHideAt: 0,
    online: { room: null, role: 'none', sid: null, round: 0, snaps: [], init: null, rtt: 80, lastSend: 0, lastInput: null, seq: 0, offsets: {}, localDashAt: 0, unread: 0, pendingInvite: null, lastResult: null, inLobby: false },
    sumAt: 0, lastResultInfo: null
  };
  var renderer = null, hero = null, heroMatch = null, heroBrains = null;

  /* ====================================================== 畫面切換 */
  function show(id) {
    Array.prototype.forEach.call(doc.querySelectorAll('.screen'), function (s) { s.hidden = s.id !== 's-' + id; });
    S.screen = id;
    $('lobby-link').hidden = id !== 'home';
    if (w.ServerOutage) w.ServerOutage.setScreen(id);
    if (w.GameAnalytics) w.GameAnalytics.pageView(id);
    Input.setEnabled(id === 'game');
    if (id === 'home') { startHero(); renderStats(); } else stopHero();
    if (id !== 'game') { Audio.music(true, 'menu'); }
    if (LobbyChatUI) LobbyChatUI.refresh();
    UI.refreshScroll();
    var f = doc.querySelector('#s-' + id + ' .back-btn, #s-' + id + ' .big-btn');
    if (f && id !== 'game') setTimeout(function () { if (!UI.Modal.any()) f.focus({ preventScroll: true }); }, 50);
  }

  /* ====================================================== 名字 */
  function animalName(skin) { return t('animal.' + (skin === 8 ? 'dummy' : ANIMALS[skin % 8])); }
  function nameOf(c) {
    if (c.dummy) return t('practice.dummy');
    if (S.mode === 'online') {
      if (c.human) return S.names[c.id] || c.name || '?';
      return animalName(c.skin) + t('lv.tag', { lv: t('lv.' + c.level) });
    }
    if (c.human) return t('common.you');
    return animalName(c.skin) + t('lv.tag', { lv: t('lv.' + c.level) });
  }

  /* ====================================================== 設定 */
  function applySettings() {
    var s = S.settings;
    Audio.setVolume('music', s.music); Audio.setVolume('sfx', s.sfx);
    Audio.music(true, S.screen === 'game' && S.match && S.match.phase !== 'over' ? 'play' : 'menu');
    doc.documentElement.style.setProperty('--tb-size', s.touchSize);
    doc.documentElement.style.setProperty('--tb-alpha', s.touchAlpha);
    doc.body.classList.toggle('reduce', !!s.reduceMotion);
    [renderer, hero].forEach(function (r) { if (r) { r.opts.colorBlind = s.colorBlind; r.opts.reduce = s.reduceMotion; r.opts.shake = s.shake && !s.reduceMotion; r.opts.names = s.names; } });
  }
  function saveSettings() { Store.saveSettings(S.settings); applySettings(); }
  var setUI = {};
  function bindSettings() {
    var s = S.settings;
    setUI.music = UI.Slider('#set-music', { value: s.music, onChange: function (v) { S.settings.music = v; saveSettings(); } });
    setUI.sfx = UI.Slider('#set-sfx', { value: s.sfx, onChange: function (v) { S.settings.sfx = v; saveSettings(); Audio.sfx('pickup'); } });
    setUI.tsize = UI.Slider('#set-tsize', { min: 0.7, max: 1.4, step: 0.05, value: s.touchSize, format: function (v) { return Math.round(v * 100) + '%'; }, onChange: function (v) { S.settings.touchSize = v; saveSettings(); } });
    setUI.talpha = UI.Slider('#set-talpha', { min: 0.3, max: 1, step: 0.05, value: s.touchAlpha, onChange: function (v) { S.settings.touchAlpha = v; saveSettings(); } });
    [['shake', '#set-shake'], ['colorBlind', '#set-cb'], ['reduceMotion', '#set-reduce'], ['names', '#set-names']].forEach(function (p) {
      setUI[p[0]] = UI.Switch(p[1], function (v) { S.settings[p[0]] = v; saveSettings(); });
      setUI[p[0]].set(!!s[p[0]], true);
    });
    $('btn-settings').addEventListener('click', function () { Audio.unlock(); openSettings(); });
    $('b-clear-records').addEventListener('click', function () {
      confirmBox(t('rec.clear'), t('rec.clearText'), function () {
        w.BumperRecords.clearAll(); renderStats(); if (S.screen === 'records') renderRecords();
        UI.toast(t('rec.cleared'));
      });
    });
    $('b-settings-reset').addEventListener('click', function () {
      var lc = S.settings.lobbyChat;
      S.settings = Store.defaults(); S.settings.lobbyChat = lc;
      saveSettings();
      setUI.music.set(S.settings.music); setUI.sfx.set(S.settings.sfx); setUI.tsize.set(S.settings.touchSize); setUI.talpha.set(S.settings.touchAlpha);
      ['shake', 'colorBlind', 'reduceMotion', 'names'].forEach(function (k) { setUI[k].set(!!S.settings[k], true); });
      UI.toast(t('settings.resetDone'));
    });
  }
  function openSettings() {
    /* 單機對局中開設定 → 暫停 */
    if (S.screen === 'game' && S.mode === 'solo' && S.match && S.match.phase !== 'over') S.paused = true;
    UI.Modal.open('m-settings', { onClose: function () { if (S.mode === 'solo' && !UI.Modal.isOpen('m-pause')) resume(); } });
  }

  /* ====================================================== 語言 */
  var langDD = null;
  function bindLang() {
    var GLOBE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/></svg>';
    langDD = UI.Select('#dd-lang', {
      icon: GLOBE, value: I18N.lang, alignRight: true,
      aria: function () { return t('lang.label'); },
      options: [{ value: 'zh-Hant', label: '繁中' }, { value: 'zh-Hans', label: '简中' }, { value: 'en', label: 'English' }],
      onChange: function (v) { I18N.setLang(v); }
    });
    I18N.on(function () { refreshTexts(); });
  }
  function refreshTexts() {
    if (langDD) langDD.refresh();
    Object.keys(dds).forEach(function (k) { if (dds[k]) dds[k].refresh(); });
    if (countUI) countUI.refresh();
    if (countUI && dds.soloMode) applySoloMode();
    if (roomMax) roomMax.refresh();
    if (prCount) prCount.refresh();
    renderStats();
    if (S.screen === 'solo') renderCpuList();
    if (S.online.room) renderRoom();
    if (S.screen === 'lobby') renderRoomList(lastRooms);
    buildHowto();
    if (S.screen === 'records') renderRecords();
    if (S.online.count != null) showOnlineCount(S.online.count);
    renderer && setLabels(renderer);
    if (S.resultShown && S.lastResultInfo) showResult(S.lastResultInfo.res, true);
    updateSummary(true);
    updateGhostTip();
    renderChatLog();
    if (S.online.pendingInvite) showInvitePanel();
    $('game-cv').setAttribute('aria-label', t('game.canvas'));
  }
  function setLabels(r) { r.labels = { bonk: t('fx.bonk'), clash: t('fx.clash'), whoosh: t('fx.whoosh'), saved: t('fx.saved') }; }

  /* ====================================================== 首頁 */
  function renderStats() {
    var d = w.BumperRecords.data();
    var st = d.stats.all;
    var best = 0; Object.keys(d.best).forEach(function (k) { best = Math.max(best, d.best[k].kos || 0); });
    $('home-stats').textContent = st && st.games ? t('home.stats', { games: st.games, wins: st.wins, kos: st.kos, best: best }) : '';
  }
  function startHero() {
    if (!hero) { hero = new w.BumperRenderer($('hero-cv')); hero.opts.names = false; applySettings(); }
    hero.opts.names = false;
    var defs = [0, 1, 2, 3, 4, 5].map(function (i) { return { id: 'h' + i, skin: i, level: 'normal' }; });
    heroMatch = R.createMatch({ seed: 'hero' + Date.now(), cars: defs, mode: 'practice', arenaR: 9 });
    heroMatch.cars.forEach(function (c, i) { var a = i / 6 * Math.PI * 2; c.x = Math.cos(a) * 4; c.y = Math.sin(a) * 4; c.dummy = false; });
    heroBrains = {}; defs.forEach(function (d, i) { heroBrains[d.id] = AI.create(['easy', 'normal', 'hard'][i % 3], 'hero' + i); });
    hero.setTheme(Math.floor(Math.random() * 10), 'hero');
  }
  function stopHero() { heroMatch = null; }
  function heroFrame(now) {
    if (!heroMatch || doc.hidden) return;
    for (var k = 0; k < 2; k++) {
      heroMatch.cars.forEach(function (c) { R.setInput(heroMatch, c.id, AI.think(heroMatch, c, heroBrains[c.id])); });
      R.step(heroMatch);
      hero.onEvents(heroMatch.events, heroMatch, null);
      R.practiceRespawn(heroMatch);
    }
    hero.draw(heroMatch, { now: now, myId: null, nameOf: nameOf, teamColors: TEAM_COLORS });
  }

  /* ====================================================== 小車預覽 */
  function drawCarPreview(cv, skin, mood, size) {
    var dpr = Math.min(2, w.devicePixelRatio || 1);
    var px = size || 96;
    cv.width = px * dpr; cv.height = px * dpr;
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);
    Art.drawCar(ctx, px / 2, px * 0.62, -Math.PI / 2 + 0.35, px * 0.62, skin, { t: 0.4, mood: mood || 'happy', colorBlind: S.settings.colorBlind });
  }
  function carPicker(container, selected, onPick, taken) {
    container.innerHTML = '';
    for (var i = 0; i < 8; i++) (function (i) {
      var b = UI.el('button', 'car-card', { type: 'button', role: 'radio', 'aria-checked': i === selected ? 'true' : 'false', 'aria-label': animalName(i) });
      if (taken && taken.indexOf(i) >= 0 && i !== selected) { b.disabled = true; b.style.opacity = 0.35; }
      var cv = UI.el('canvas'); b.appendChild(cv);
      var sp = UI.el('span'); sp.textContent = animalName(i); b.appendChild(sp);
      drawCarPreview(cv, i, i === selected ? 'happy' : 'happy', 96);
      b.addEventListener('click', function () { Audio.unlock(); Audio.sfx('click'); onPick(i); });
      b.addEventListener('keydown', function (e) {
        var d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (d) { e.preventDefault(); var n = (i + d + 8) % 8; onPick(n); var nb = container.children[n]; if (nb) nb.focus(); }
      });
      container.appendChild(b);
    })(i);
  }

  /* ====================================================== 單機設定 */
  var dds = {}, countUI = null;
  function lvOptions(includeKid) {
    return LEVELS.filter(function (l) { return includeKid || l !== 'kid'; }).map(function (l) { return { value: l, label: function () { return t('lv.' + l); } }; });
  }
  function themeOptions() {
    var arr = [{ value: 'random', label: function () { return t('theme.random'); }, swatch: 'conic-gradient(#ff4fa3,#ffd23f,#2fd6f5,#9c7bff,#ff4fa3)' }];
    Art.THEMES.forEach(function (th, i) { arr.push({ value: i, label: function () { return t('theme.' + th.id); }, swatch: th.floor[0] }); });
    return arr;
  }
  function soloSave() { Store.saveSolo(S.soloCfg); }
  function bindSolo() {
    countUI = UI.Stepper('#solo-count', {
      value: S.soloCfg.cpus.length, min: 1, max: 5,
      labels: function () { return { minus: t('solo.less'), plus: t('solo.more') }; },
      onChange: function (n) {
        while (S.soloCfg.cpus.length < n) S.soloCfg.cpus.push('normal');
        S.soloCfg.cpus.length = n;
        soloSave(); renderCpuList(); updateSessionLabel();
      }
    });
    dds.soloMode = UI.Select('#solo-mode', {
      value: S.soloCfg.mode || 'ffa', portal: true, aria: function () { return t('room.mode'); },
      options: ['ffa', '2v2', '3v3'].map(function (m) { return { value: m, label: function () { return t('mode.' + m); } }; }),
      onChange: function (v) { S.soloCfg.mode = v; applySoloMode(); soloSave(); renderCpuList(); updateSessionLabel(); }
    });
    dds.session = UI.Select('#solo-session', {
      value: S.soloCfg.session, portal: true,
      aria: function () { return t('solo.session'); },
      options: function () {
        return [{ value: 'auto', label: function () { return t('solo.auto', { lv: t('lv.' + autoLevel()) }); } }].concat(lvOptions(true));
      },
      onChange: function (v) { S.soloCfg.session = v; soloSave(); }
    });
    dds.theme = UI.Select('#solo-theme', {
      value: S.soloCfg.theme, portal: true, aria: function () { return t('solo.theme'); },
      options: themeOptions, onChange: function (v) { S.soloCfg.theme = v; soloSave(); drawThemePreview(); }
    });
    var items = UI.Switch('#solo-items', function (v) { S.soloCfg.items = v; soloSave(); });
    items.set(S.soloCfg.items !== false, true);
    $('solo-start').addEventListener('click', function () { Audio.unlock(); startSolo(); });
  }
  /** 組隊：2 對 2 固定 3 台電腦、3 對 3 固定 5 台；你的隊友是第 2、4 台電腦 */
  function applySoloMode() {
    var m = S.soloCfg.mode || 'ffa';
    var need = m === '2v2' ? 3 : (m === '3v3' ? 5 : 0);
    if (need) {
      while (S.soloCfg.cpus.length < need) S.soloCfg.cpus.push('normal');
      S.soloCfg.cpus.length = need;
    }
    if (countUI) { countUI.set(S.soloCfg.cpus.length); Array.prototype.forEach.call(doc.querySelectorAll('#solo-count button'), function (b) { if (need) b.disabled = true; }); if (!need) countUI.refresh(); }
    $('solo-mode-sub').textContent = need ? t('solo.teamSub') : '';
  }
  function soloTeam(i) { return i % 2; }   // 0＝你，1、3、5 是對手隊，2、4 是你的隊友（索引含你）
  function autoLevel() {
    var best = 0;
    S.soloCfg.cpus.forEach(function (l) { best = Math.max(best, LEVELS.indexOf(l)); });
    return LEVELS[best];
  }
  function updateSessionLabel() { if (dds.session) dds.session.refresh(); }
  function cpuSkins() {
    var me = S.soloCfg.skin, out = [];
    for (var k = 0; out.length < 5; k++) { var sk = (me + 1 + k) % 8; if (sk !== me) out.push(sk); }
    return out;
  }
  function renderCpuList() {
    var list = $('solo-cpu-list');
    list.innerHTML = '';
    var skins = cpuSkins();
    var teams = (S.soloCfg.mode || 'ffa') !== 'ffa';
    S.soloCfg.cpus.forEach(function (lv, i) {
      var li = UI.el('li', 'cpu-row');
      var cv = UI.el('canvas'); li.appendChild(cv); drawCarPreview(cv, skins[i], 'happy', 48);
      var nm = UI.el('span', 'cpu-name'); nm.textContent = animalName(skins[i]); li.appendChild(nm);
      if (teams) {
        var tm = soloTeam(i + 1);
        var tg = UI.el('span', 'tag team-tag'); tg.style.background = TEAM_COLORS[tm]; tg.textContent = tm === 0 ? t('solo.ally') : t('solo.rival');
        nm.appendChild(doc.createTextNode(' ')); nm.appendChild(tg);
      }
      var dd = UI.el('div'); li.appendChild(dd);
      list.appendChild(li);
      UI.Select(dd, {
        value: lv, portal: true, aria: function () { return t('solo.cpuLevel', { name: animalName(skins[i]) }); },
        options: lvOptions(true), onChange: function (v) { S.soloCfg.cpus[i] = v; soloSave(); updateSessionLabel(); }
      });
    });
  }
  function renderSoloCars() {
    carPicker($('solo-cars'), S.soloCfg.skin, function (i) { S.soloCfg.skin = i; Store.saveSkin(i); soloSave(); renderSoloCars(); renderCpuList(); });
  }
  function drawThemePreview() {
    var cv = $('solo-theme-cv');
    var r = cv.getBoundingClientRect();
    var W = Math.max(200, Math.round(r.width || 320)), H = Math.round(W * 9 / 16);
    var dpr = Math.min(2, w.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var th = Art.resolveTheme(S.soloCfg.theme, 'preview' + Date.now());
    var u = H / 22;
    Art.drawBelow(ctx, th, W, H, W / 2, H / 2, u, 0, true);
    Art.drawDecor(ctx, th, W / 2, H / 2, u, 7, 0, true);
    Art.drawArena(ctx, th, W / 2, H / 2 - u * 0.3, u, 7, 7, 0, { reduce: true });
    Art.drawCar(ctx, W / 2 - u * 2, H / 2, 0.3, u * 2.2, S.soloCfg.skin, { t: 0.5 });
    Art.drawCar(ctx, W / 2 + u * 2.4, H / 2 + u * 0.6, Math.PI + 0.3, u * 2.2, cpuSkins()[0], { t: 0.5, mood: 'ouch' });
  }
  function openSolo() {
    show('solo');
    countUI.set(S.soloCfg.cpus.length); dds.soloMode.set(S.soloCfg.mode || 'ffa'); applySoloMode();
    renderSoloCars(); renderCpuList(); updateSessionLabel();
    dds.theme.set(S.soloCfg.theme);
    setTimeout(drawThemePreview, 30);
  }

  /* ====================================================== 開始對局（單機／練習） */
  function ensureRenderer() {
    if (!renderer) { renderer = new w.BumperRenderer($('game-cv')); setLabels(renderer); applySettings(); }
  }
  function startSolo() {
    ensureRenderer();
    var cfg = S.soloCfg;
    var skins = cpuSkins();
    var teams = (cfg.mode || 'ffa') !== 'ffa';
    var cars = [{ id: 'me', skin: cfg.skin, human: true, team: teams ? 0 : 0 }];
    cfg.cpus.forEach(function (lv, i) { cars.push({ id: 'cpu' + i, skin: skins[i], level: lv, team: teams ? soloTeam(i + 1) : i + 1 }); });
    var session = cfg.session === 'auto' ? autoLevel() : cfg.session;
    var seed = 'solo:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    S.mode = 'solo'; S.myId = 'me';
    S.match = R.createMatch({ seed: seed, cars: cars, items: cfg.items !== false, sessionLevel: session, mode: 'solo', theme: cfg.theme, teams: teams });
    S.brains = {};
    S.match.cars.forEach(function (c) { if (!c.human) S.brains[c.id] = AI.create(c.level, seed + c.id); });
    renderer.setTheme(cfg.theme, seed);
    beginMatchView();
    if (w.GameAnalytics) w.GameAnalytics.start({ mode: 'ai', difficulty: session, players: cars.length }, seed);
  }
  var prCount = null;
  function startPractice() {
    ensureRenderer();
    S.mode = 'practice'; S.myId = 'me';
    var base = R.createMatch({ seed: 'practice', mode: 'practice', cars: [{ id: 'me', skin: Store.skin(), human: true }], sessionLevel: 'normal' });
    S.match = R.practiceReset(base, S.practiceN);
    S.brains = {};
    renderer.setTheme(Math.floor(Math.random() * 10), 'p');
    beginMatchView();
    if (w.GameAnalytics) w.GameAnalytics.start({ mode: 'practice' }, 'practice' + Date.now());
  }
  function beginMatchView() {
    S.paused = false; S.acc = 0; S.resultShown = false; S.overAt = 0; S.tickSec = -1; S.warnNext = 12;
    S.lastResultInfo = null;
    w.BumperShare.release();
    renderer.clearFx();
    $('result').hidden = true;
    $('practice-bar').hidden = S.mode !== 'practice';
    $('hud-bar').hidden = S.mode === 'practice';
    $('game-chat').hidden = S.mode !== 'online';
    $('btn-pause').setAttribute('aria-label', t(S.mode === 'online' ? 'game.menu' : 'game.pause'));
    $('hud-role').hidden = !(S.mode === 'online' && S.online.role === 'spectator');
    $('hud-role').textContent = t('room.roleSpectator');
    show('game');
    sideDefault();
    if (S.match.phase === 'countdown') showCount(Math.ceil(S.match.cd));
    else $('countdown').hidden = true;
    Audio.music(true, 'play'); Audio.tempo(1);
    updateSummary(true); updateGhostTip(); updateItemBtn(true);
    maybeRotateTip();
  }

  /* ====================================================== 倒數遮罩 */
  function showCount(n) {
    var el = $('countdown');
    el.hidden = false;
    el.classList.toggle('go', n <= 0);
    el.innerHTML = '';
    var sp = doc.createElement('span');
    sp.textContent = n > 0 ? String(n) : t('game.go');
    el.appendChild(sp);
    S.cdHideAt = performance.now() + (n > 0 ? 1100 : 800);
    if (n > 0) Audio.sfx('count'); else Audio.sfx('go');
  }

  /* ====================================================== 主迴圈 */
  function frame(now) {
    S.raf = w.requestAnimationFrame(frame);
    if (S.screen === 'home') { heroFrame(now); return; }
    if (S.screen !== 'game' || !S.match) return;
    var dt = Math.min(0.1, (now - (S.last || now)) / 1000);
    S.last = now;
    if (S.mode === 'online') onlineFrame(now, dt);
    else localFrame(now, dt);
    renderer.draw(S.match, {
      now: now, myId: S.myId, nameOf: nameOf, teamColors: TEAM_COLORS,
      ghostActive: R.ghostActive(S.match), showItems: S.mode !== 'online' || S.online.role === 'spectator'
    });
    hud(now);
  }
  w.requestAnimationFrame(function (n) { S.last = n; frame(n); });

  function localFrame(now, dt) {
    if (S.paused) { S.last = now; return; }
    S.acc += dt;
    var input = Input.read();
    var first = true, n = 0;
    while (S.acc >= R.DT && n < 6) {
      var m = S.match;
      R.setInput(m, S.myId, first ? input : { mx: input.mx, my: input.my });
      first = false;
      for (var i = 0; i < m.cars.length; i++) {
        var c = m.cars[i], b = S.brains[c.id];
        if (b) R.setInput(m, c.id, AI.think(m, c, b));
      }
      R.step(m);
      handleEvents(m.events);
      if (S.mode === 'practice') R.practiceRespawn(m);
      S.acc -= R.DT; n++;
    }
    if (S.acc > R.DT * 6) S.acc = 0;
    if (S.match.phase === 'over' && !S.resultShown) {
      if (!S.overAt) S.overAt = now;
      if (now - S.overAt > 1300) showResult(R.result(S.match));
    }
  }

  /* 事件 → 音效、特效、倒數 */
  function handleEvents(evts) {
    if (!evts || !evts.length) return;
    renderer.onEvents(evts, S.match, S.myId);
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i];
      switch (e.type) {
        case 'count': if (e.n > 0) showCount(e.n); break;
        case 'go': showCount(0); break;
        case 'hit': Audio.sfx('bonk', { power: e.power }); if ((e.a === S.myId || e.b === S.myId) && S.settings.shake && w.navigator.vibrate && e.power > 4) w.navigator.vibrate(30); break;
        case 'clash': Audio.sfx('clash'); break;
        case 'charge': if (e.id === S.myId) Audio.sfx('charge'); break;
        case 'burst': Audio.sfx(e.sup ? 'super' : 'dash'); break;
        case 'fall': Audio.sfx('fall'); if (e.id === S.myId) { updateGhostTip(); Audio.sfx('ghost'); } break;
        case 'wobble': Audio.sfx('wobble'); break;
        case 'pickup': if (e.id === S.myId) Audio.sfx('pickup'); break;
        case 'use': Audio.sfx({ shield: 'shield', spring: 'spring', magnet: 'magnet', iron: 'iron', banana: 'banana' }[e.item] || 'use'); break;
        case 'shieldBlock': Audio.sfx('block'); break;
        case 'land': Audio.sfx('land'); break;
        case 'slip': Audio.sfx('slip'); break;
        case 'rescue': Audio.sfx('rescue'); break;
        case 'ghostDrop': Audio.sfx('drop'); break;
        case 'over': Audio.music(true, 'menu'); break;
      }
    }
  }

  /* ====================================================== HUD */
  function hud(now) {
    var m = S.match;
    if ($('countdown').hidden === false && now > S.cdHideAt && m.phase !== 'countdown') $('countdown').hidden = true;
    if (S.mode !== 'practice') {
      var left = Math.max(0, Math.ceil(m.opts.duration - m.t));
      if (m.phase === 'countdown') left = m.opts.duration;
      var te = $('hud-time');
      if (te.textContent !== String(left)) te.textContent = String(left);
      var warn = m.phase === 'playing' && left <= 10;
      te.classList.toggle('warn', warn);
      /* 最後 10 秒倒數提示音 */
      if (warn && left !== S.tickSec) { S.tickSec = left; Audio.sfx('tick'); }
      /* 縮圈警示音：越縮越快 */
      if (m.phase === 'playing' && m.t > 10 && m.t < 80 && m.t >= S.warnNext) {
        Audio.sfx('warn');
        var k = m.arena.r / m.arena.r0;
        S.warnNext = m.t + Math.max(0.8, 3.2 * k);
        Audio.tempo(1 + (1 - k) * 0.25);
      }
      var alive = R.aliveCars(m).length;
      var ae = $('hud-alive'); var at = t('game.alive', { n: alive });
      if (ae.textContent !== at) ae.textContent = at;
    }
    var me = R.getCar(m, S.myId);
    /* 衝刺冷卻圈 */
    var arc = $('dash-arc');
    if (me) {
      var frac = me.alive ? me.dash.cd / R.C.DASH_CD : 0;
      arc.style.strokeDashoffset = String(283 * frac);
      $('btn-dash').classList.toggle('cooling', me.alive && me.dash.cd > 0);
      var lab = me.alive ? t('game.dash') : t('game.ghostMove');
      if ($('dash-label').textContent !== lab) $('dash-label').textContent = lab;
      $('btn-dash').hidden = !me.alive;
    }
    updateItemBtn();
    if (now - S.sumAt > 300) { S.sumAt = now; updateSummary(); }
  }

  var lastItemKey = '';
  function updateItemBtn(force) {
    var me = S.match && R.getCar(S.match, S.myId);
    var btn = $('btn-item'), cv = $('item-cv');
    var key, empty;
    if (!me) { key = 'none'; empty = true; }
    else if (me.alive) { key = 'i:' + (me.item || ''); empty = !me.item; }
    else {
      var ready = me.ghost && me.ghost.cd <= 0 && R.ghostActive(S.match);
      key = 'g:' + (ready ? 1 : 0) + ':' + (me.ghost ? Math.ceil(me.ghost.cd) : 0);
      empty = !ready;
    }
    if (key === lastItemKey && !force) return;
    lastItemKey = key;
    btn.classList.toggle('empty', empty);
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 96, 96);
    if (me && me.alive && me.item) Art.drawItemIcon(ctx, me.item, 48, 48, 80);
    else if (me && !me.alive) {
      Art.drawItemBox(ctx, 48, 56, 70, 0, true);
      if (me.ghost && me.ghost.cd > 0) { ctx.fillStyle = '#fff'; ctx.font = '900 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 6; ctx.strokeStyle = '#2a1a4a'; ctx.strokeText(String(Math.ceil(me.ghost.cd)), 48, 50); ctx.fillText(String(Math.ceil(me.ghost.cd)), 48, 50); }
    } else { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 5; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(48, 48, 28, 0, Math.PI * 2); ctx.stroke(); }
    var label = me && me.alive ? (me.item ? t('game.useItem', { item: t('item.' + me.item) }) : t('game.noItem')) : t('game.ghostDrop');
    btn.setAttribute('aria-label', label);
  }

  function updateGhostTip() {
    var tip = $('ghost-tip');
    var me = S.match && R.getCar(S.match, S.myId);
    if (!S.match || !me || me.alive || S.match.phase === 'over' || S.mode === 'practice') { tip.hidden = true; return; }
    tip.hidden = false;
    $('rotate-tip').hidden = true;   // 兩個提示同一位置，幽靈提示優先
    tip.textContent = !S.match.opts.items ? t('ghost.noItems') : (R.ghostActive(S.match) ? t('ghost.tip') : t('ghost.stopped'));
  }

  /* ---------- 左側戰況 Summary ---------- */
  var lastSum = '';
  function updateSummary(force) {
    var m = S.match;
    if (!m) return;
    var me = R.getCar(m, S.myId);
    var status;
    if (S.mode === 'online' && S.online.role === 'spectator') status = t('sum.spectating');
    else if (m.phase === 'countdown') status = t('sum.countdown');
    else if (m.phase === 'over') status = t('sum.over');
    else if (S.paused) status = t('game.paused');
    else if (me && !me.alive) status = t('sum.ghost');
    else if (me && me.wobble > 0) status = t('sum.wobble');
    else status = S.mode === 'practice' ? t('sum.practice') : t('sum.play');
    var cars = m.cars.filter(function (c) { return !c.dummy; }).slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (b.stats.kos !== a.stats.kos) return b.stats.kos - a.stats.kos;
      return 0;
    });
    var key = status + '|' + cars.map(function (c) { return c.id + c.alive + c.stats.kos; }).join(',') + I18N.lang;
    if (key === lastSum && !force) return;
    lastSum = key;
    $('sum-status').textContent = status + (S.mode === 'practice' ? '' : ' ・ ' + t('sum.goal'));
    var ol = $('sum-rank'); ol.innerHTML = '';
    cars.forEach(function (c) {
      var li = UI.el('li', (c.alive ? '' : 'out ') + (c.id === S.myId ? 'me' : ''));
      var dot = UI.el('span', 'dot'); dot.style.background = m.opts.teams ? TEAM_COLORS[c.team % 3] : Art.skinOf(c.skin).body; li.appendChild(dot);
      var n = UI.el('span', 'rn'); n.textContent = nameOf(c) + (c.alive ? '' : ' ' + t('sum.outTag')); li.appendChild(n);
      var k = UI.el('span', 'rk'); k.textContent = t('result.kosShort', { n: c.stats.kos }); li.appendChild(k);
      ol.appendChild(li);
    });
  }

  /* ---------- 資訊欄收合 ---------- */
  function narrow() { return w.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1100px), (max-height: 480px)').matches; }
  function sideSet(open) {
    $('side').classList.toggle('collapsed', !open);
    $('side-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { S.online.unread = 0; $('side-unread').hidden = true; }
    setTimeout(function () { UI.refreshScroll(); }, 220);
  }
  function sideDefault() { sideSet(!narrow()); }

  function maybeRotateTip() {
    var tip = $('rotate-tip');
    var portrait = w.innerHeight > w.innerWidth && w.innerWidth < 600;
    tip.hidden = !(portrait && !S.rotateShown && S.mode !== 'practice');
    if (!tip.hidden) { S.rotateShown = true; setTimeout(function () { tip.hidden = true; }, 5000); }
  }

  /* ====================================================== 暫停 */
  function pause() {
    if (S.screen !== 'game' || !S.match) return;
    if (S.mode === 'online') {
      $('pause-title').textContent = t('game.menu');
      $('pause-note').textContent = t('game.onlineNoPause');
      $('pause-restart').hidden = true;
      $('pause-quit').textContent = t('game.quitOnline');
    } else {
      S.paused = true;
      $('pause-title').textContent = t('game.paused');
      $('pause-note').textContent = S.mode === 'practice' ? '' : t('game.pauseNote');
      $('pause-restart').hidden = S.mode === 'practice';
      $('pause-quit').textContent = t('game.quit');
    }
    $('pause-note').hidden = !$('pause-note').textContent;
    UI.Modal.open('m-pause', { onClose: resume });
    updateSummary(true);
  }
  function resume() { S.paused = false; S.last = performance.now(); Input.reset(); updateSummary(true); }

  function confirmBox(title, text, yes) {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text;
    var btn = $('confirm-yes');
    var nb = btn.cloneNode(true); btn.parentNode.replaceChild(nb, btn);
    nb.addEventListener('click', function () { UI.Modal.close('m-confirm'); yes(); });
    UI.Modal.open('m-confirm');
  }

  function quitMatch(toScreen) {
    S.match = null; S.paused = false;
    $('result').hidden = true; $('countdown').hidden = true;
    S.resultShown = false;
    w.BumperShare.release();
    renderer && renderer.clearFx();
    show(toScreen || 'home');
  }

  /* ====================================================== 結算 */
  function showResult(res, refresh) {
    S.resultShown = true;
    var spectator = S.mode === 'online' && S.online.role === 'spectator';
    var mine = res.rows.filter(function (r) { return r.id === S.myId; })[0];
    var kid = S.mode === 'solo' && S.match && S.match.opts.sessionLevel === 'kid';
    var title, sub = '';
    if (res.teams && res.teamRank) {
      var win = res.teamRank[0];
      title = t('result.teamWin', { team: t('team.' + win.team) });
      if (mine && !spectator) sub = mine.place === 1 ? t('result.teamYouWin') : t('result.teamYouLose');
    } else if (spectator || !mine) {
      var w0 = res.rows[0];
      title = t('result.winner', { name: w0 ? nameOf(carLike(w0)) : '' });
    } else if (mine.place === 1) title = t('result.win');
    else title = kid ? t('result.kidPlace', { n: mine.place }) : t('result.place', { n: mine.place });
    if (!sub) sub = res.reason === 'time' ? t('result.byTime') : t('result.byLast');
    if (kid && mine && mine.place > 1) sub = t('result.kidCheer');
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;
    var ol = $('result-rows'); ol.innerHTML = '';
    res.rows.forEach(function (r) {
      var li = UI.el('li', r.id === S.myId ? 'me' : '');
      var pl = UI.el('span', 'pl' + (r.place === 2 ? ' medal-2' : r.place === 3 ? ' medal-3' : '')); pl.textContent = String(r.place); li.appendChild(pl);
      var cv = UI.el('canvas'); li.appendChild(cv); drawCarPreview(cv, r.skin, r.place === 1 ? 'happy' : 'ouch', 40);
      var n = UI.el('span', 'pn'); n.textContent = nameOf(carLike(r)) + (res.teams ? ' · ' + t('team.' + r.team) : ''); li.appendChild(n);
      var k = UI.el('span', 'pk'); k.textContent = t('result.kosShort', { n: r.stats.kos }); li.appendChild(k);
      ol.appendChild(li);
    });
    var dl = $('result-stats'); dl.innerHTML = '';
    if (mine && !spectator) {
      var st = mine.stats;
      var items = st.items.length ? st.items.map(function (x) { return t('item.' + x); }).join('、') : t('result.none');
      [['result.kos', st.kos], ['result.survive', t('result.sec', { n: Math.round(st.survive) })], ['result.dashes', st.dashes], ['result.hits', st.hits], ['result.rescues', st.rescues], ['result.items', items], ['result.ghostDrops', st.ghostDrops]].forEach(function (p) {
        var d = UI.el('div'); var dt = UI.el('dt'); dt.textContent = t(p[0]); var dd = UI.el('dd'); dd.textContent = String(p[1]); d.appendChild(dt); d.appendChild(dd); dl.appendChild(d);
      });
    }
    var online = S.mode === 'online';
    $('res-room').textContent = online ? t('result.room') : t('result.setup');
    $('res-again').querySelector('b').textContent = online ? (spectator ? t('result.backRoom') : t('result.againOnline')) : t('result.again');
    $('result').hidden = false;
    setTimeout(function () { UI.refreshScroll($('result')); }, 30);
    if (!refresh) {
      Audio.sfx(mine && mine.place === 1 && !spectator ? 'win' : 'lose');
      S.lastRec = null;
      if (mine && !spectator && S.mode !== 'practice') S.lastRec = recordMatch(res, mine);
      if (w.GameAnalytics) w.GameAnalytics.end({ result: mine && mine.place === 1 ? 'win' : 'lose' });
      setTimeout(function () { var b = $('res-again'); if (b && !$('result').hidden && !UI.Modal.any()) b.focus({ preventScroll: true }); }, 400);
    }
    renderResultNew(S.lastRec);
    S.lastResultInfo = { res: res };
    updateSummary(true); updateGhostTip();
    Input.setEnabled(false);
  }
  /** 記錄這局（單機用本機確認結果；線上用伺服器 game:over 的結果；matchId 去重） */
  function recordMatch(res, mine) {
    var m = S.match;
    var online = S.mode === 'online';
    var matchId = online ? 'online:' + (S.online.room ? S.online.room.code : '') + ':' + S.online.round + ':' + (S.online.init ? S.online.init.seed : '') : 'solo:' + (m ? m.seed : Date.now());
    var hasMythic = res.rows.some(function (r) { return r.level === 'mythic'; });
    return w.BumperRecords.record({
      matchId: matchId, mode: online ? 'online' : 'solo', difficulty: online ? null : (m ? m.opts.sessionLevel : 'normal'),
      place: mine.place, total: res.rows.length, kos: mine.stats.kos, survive: mine.stats.survive, rescues: mine.stats.rescues,
      dashes: mine.stats.dashes, hits: mine.stats.hits, items: mine.stats.items, ghostDrops: mine.stats.ghostDrops, hasMythic: hasMythic, teams: !!res.teams
    });
  }
  function renderResultNew(rec) {
    var box = $('result-new'); box.innerHTML = '';
    if (!rec) { box.hidden = true; return; }
    var chips = [];
    (rec.newBest || []).forEach(function (k) { chips.push(['best', t('rec.newBest.' + k)]); });
    (rec.unlocked || []).forEach(function (id) { chips.push(['ach', t('rec.unlocked', { name: t('ach.' + id) })]); });
    if (rec.recorded && rec.saved === false) chips.push(['warn', t('rec.notSaved')]);
    chips.forEach(function (c) { var s = UI.el('span', 'chip ' + c[0]); s.textContent = c[1]; box.appendChild(s); });
    box.hidden = !chips.length;
  }

  /* ====================================================== 紀錄與成就畫面 */
  var recBucket = 'all', recDD = null;
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString(I18N.lang === 'en' ? 'en-US' : (I18N.lang === 'zh-Hans' ? 'zh-CN' : 'zh-TW'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; }
  }
  function renderRecords() {
    var d = w.BumperRecords.data();
    var box = $('records'); box.innerHTML = '';
    var p1 = UI.el('section', 'panel');
    var h = UI.el('h3'); h.textContent = t('rec.stats'); p1.appendChild(h);
    var row = UI.el('div', 'row'); var lab = UI.el('span', 'row-label'); lab.textContent = t('rec.bucket'); row.appendChild(lab);
    var ddBox = UI.el('div'); row.appendChild(ddBox); p1.appendChild(row);
    var buckets = [{ value: 'all', label: function () { return t('rec.all'); } }].concat(LEVELS.map(function (l) { return { value: 'solo:' + l, label: function () { return t('rec.solo', { lv: t('lv.' + l) }); } }; })).concat([{ value: 'online', label: function () { return t('rec.online'); } }]);
    recDD = UI.Select(ddBox, { value: recBucket, portal: true, aria: function () { return t('rec.bucket'); }, options: buckets, onChange: function (v) { recBucket = v; renderRecords(); } });
    var st = d.stats[recBucket] || { games: 0, wins: 0, kos: 0, rescues: 0, survive: 0 };
    var best = recBucket === 'all' ? Object.keys(d.best).reduce(function (a, k) { var b = d.best[k]; return { kos: Math.max(a.kos, b.kos), survive: Math.max(a.survive, b.survive), rescues: Math.max(a.rescues, b.rescues) }; }, { kos: 0, survive: 0, rescues: 0 }) : (d.best[recBucket] || { kos: 0, survive: 0, rescues: 0 });
    var dl = UI.el('dl', 'my-stats rec-stats');
    [['rec.games', st.games], ['rec.wins', st.wins], ['rec.winRate', st.games ? Math.round(st.wins / st.games * 100) + '%' : '—'], ['rec.kos', st.kos], ['rec.bestKos', best.kos], ['rec.bestSurvive', t('result.sec', { n: best.survive })], ['rec.bestRescues', best.rescues]].forEach(function (p) {
      var dv = UI.el('div'); var dt = UI.el('dt'); dt.textContent = t(p[0]); var dd = UI.el('dd'); dd.textContent = String(p[1]); dv.appendChild(dt); dv.appendChild(dd); dl.appendChild(dv);
    });
    p1.appendChild(dl);
    var note = UI.el('p', 'hint'); note.textContent = t('rec.localNote'); p1.appendChild(note);
    box.appendChild(p1);
    /* 成就 */
    var p2 = UI.el('section', 'panel');
    var h2 = UI.el('h3'); var got = w.BumperRecords.ACH.filter(function (a) { return d.ach[a.id] && d.ach[a.id].unlockedAt; }).length;
    h2.textContent = t('rec.achTitle', { n: got, total: w.BumperRecords.ACH.length }); p2.appendChild(h2);
    var grid = UI.el('ul', 'ach-grid');
    w.BumperRecords.ACH.forEach(function (a) {
      var s = d.ach[a.id] || { progress: 0, unlockedAt: null };
      var li = UI.el('li', 'ach' + (s.unlockedAt ? ' got' : ''));
      var ic = UI.el('span', 'ach-ico', { 'aria-hidden': 'true' }); ic.innerHTML = s.unlockedAt ? '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8L12 2Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h1Zm2 0h6V8a3 3 0 0 0-6 0v3Z"/></svg>'; li.appendChild(ic);
      var tx = UI.el('div'); var b = UI.el('b'); b.textContent = t('ach.' + a.id); var sp = UI.el('span'); sp.textContent = t('achd.' + a.id); tx.appendChild(b); tx.appendChild(sp);
      var pr = UI.el('span', 'ach-prog');
      pr.textContent = s.unlockedAt ? t('rec.unlockedAt', { d: fmtDate(s.unlockedAt) }) : t('rec.progress', { n: s.progress || 0, total: a.target });
      tx.appendChild(pr);
      var bar = UI.el('span', 'ach-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.target), 'aria-valuenow': String(s.progress || 0) });
      var fill = UI.el('i'); fill.style.width = Math.round(Math.min(1, (s.progress || 0) / a.target) * 100) + '%'; bar.appendChild(fill); tx.appendChild(bar);
      li.appendChild(tx); grid.appendChild(li);
    });
    p2.appendChild(grid); box.appendChild(p2);
    /* 最近對局 */
    var p3 = UI.el('section', 'panel');
    var h3 = UI.el('h3'); h3.textContent = t('rec.recent', { n: w.BumperRecords.KEEP }); p3.appendChild(h3);
    var list = d.matches.filter(function (m) { return recBucket === 'all' || w.BumperRecords.bucketKey(m.mode, m.difficulty) === recBucket; });
    if (!list.length) { var em = UI.el('p', 'empty'); em.textContent = t('rec.empty'); p3.appendChild(em); }
    else {
      var ol = UI.el('ol', 'recent');
      list.slice(0, 100).forEach(function (m) {
        var li = UI.el('li');
        var pl = UI.el('span', 'pl' + (m.place === 1 ? ' gold' : '')); pl.textContent = '#' + m.place; li.appendChild(pl);
        var info = UI.el('span', 'rc-main');
        info.textContent = (m.mode === 'online' ? t('rec.online') : t('rec.solo', { lv: t('lv.' + m.difficulty) })) + ' · ' + t('rec.line', { total: m.total, kos: m.kos, sec: m.survive });
        li.appendChild(info);
        var dt = UI.el('span', 'rc-date'); dt.textContent = fmtDate(m.endedAt); li.appendChild(dt);
        ol.appendChild(li);
      });
      p3.appendChild(ol);
    }
    box.appendChild(p3);
    UI.refreshScroll();
  }
  function carLike(r) { return { id: r.id, name: r.name, skin: r.skin, level: r.level, human: r.human, dummy: false }; }

  function openShare() {
    if (!S.lastResultInfo) return;
    w.BumperShare.open(S.match ? S.match.seed : 'x');
  }

  function bindGame() {
    Input.init({ onEscape: function () { if (S.resultShown) return; pause(); }, vibrate: function () { return S.settings.shake; } });
    $('btn-pause').addEventListener('click', function () { Audio.unlock(); pause(); });
    $('pause-restart').addEventListener('click', function () { UI.Modal.close('m-pause'); if (S.mode === 'solo') startSolo(); });
    $('pause-quit').addEventListener('click', function () {
      UI.Modal.close('m-pause');
      if (S.mode === 'online') { confirmBox(t('game.quitOnline'), t('game.quitOnlineText'), function () { leaveRoom(); }); return; }
      if (S.mode === 'practice') { quitMatch('home'); return; }
      confirmBox(t('game.quit'), t('game.quitText'), function () { quitMatch('home'); });
    });
    $('side-toggle').addEventListener('click', function () { sideSet($('side').classList.contains('collapsed')); });
    $('rotate-close').addEventListener('click', function () { $('rotate-tip').hidden = true; });
    $('res-again').addEventListener('click', function () {
      if (S.mode === 'solo') startSolo();
      else if (S.mode === 'online') { quitMatch('room'); if (S.online.role === 'player') Net.send('room:ready', { ready: true }); renderRoom(); }
    });
    $('res-room').addEventListener('click', function () {
      if (S.mode === 'solo') { quitMatch('solo'); openSolo(); }
      else if (S.mode === 'online') { quitMatch('room'); renderRoom(); }
    });
    $('res-home').addEventListener('click', function () {
      if (S.mode === 'online') { leaveRoom(true); return; }
      quitMatch('home');
    });
    $('res-share').addEventListener('click', openShare);
    w.BumperShare.bind();
    /* 練習 */
    var pr = $('pr-items');
    R.ITEM_TYPES.forEach(function (type) {
      var b = UI.el('button', '', { type: 'button' });
      b.setAttribute('data-item', type);
      var cv = UI.el('canvas'); cv.width = 72; cv.height = 72; b.appendChild(cv);
      Art.drawItemIcon(cv.getContext('2d'), type, 36, 36, 60);
      b.addEventListener('click', function () { if (S.match) { R.practiceGive(S.match, S.myId, type); Audio.sfx('pickup'); updateItemBtn(true); } });
      pr.appendChild(b);
    });
    prCount = UI.Stepper('#pr-count', { value: S.practiceN, min: 0, max: 5, labels: function () { return { minus: t('solo.less'), plus: t('solo.more') }; }, onChange: function (v) { S.practiceN = v; } });
    $('pr-reset').addEventListener('click', function () { if (S.match) { S.match = R.practiceReset(S.match, S.practiceN); renderer.clearFx(); } });
    $('pr-exit').addEventListener('click', function () { quitMatch('home'); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden && S.screen === 'game' && S.mode === 'solo' && S.match && S.match.phase !== 'over' && !UI.Modal.any()) pause(); });
    w.addEventListener('resize', function () { if (S.screen === 'game') { if (!narrow() && $('side').classList.contains('collapsed') && !S.sideUser) sideSet(true); } if (S.screen === 'solo') drawThemePreview(); });
  }

  function refreshPractice() {
    Array.prototype.forEach.call(doc.querySelectorAll('#pr-items button'), function (b) { b.setAttribute('aria-label', t('practice.give', { item: t('item.' + b.getAttribute('data-item')) })); });
  }

  /* ====================================================== 怎麼玩 */
  function buildHowto() {
    var box = $('howto');
    box.innerHTML = '';
    var cards = [['move', 'how.move'], ['dash', 'how.dash'], ['shrink', 'how.shrink'], ['wobble', 'how.wobble'], ['ghost', 'how.ghost']];
    cards.forEach(function (c) {
      var sec = UI.el('section', 'panel how-card');
      var cv = UI.el('canvas'); sec.appendChild(cv);
      var div = UI.el('div');
      var h = UI.el('h3'); h.textContent = t(c[1] + '.t'); div.appendChild(h);
      var p = UI.el('p'); p.textContent = t(c[1] + '.d'); div.appendChild(p);
      sec.appendChild(div); box.appendChild(sec);
      drawHow(cv, c[0]);
    });
    var it = UI.el('section', 'panel');
    var h3 = UI.el('h3'); h3.textContent = t('how.items.t'); it.appendChild(h3);
    var p0 = UI.el('p', 'hint'); p0.textContent = t('how.items.d'); it.appendChild(p0);
    var tbl = UI.el('div', 'item-table');
    R.ITEM_TYPES.forEach(function (type) {
      var cell = UI.el('div', 'item-cell');
      var cv = UI.el('canvas'); cv.width = 96; cv.height = 96; cell.appendChild(cv);
      Art.drawItemIcon(cv.getContext('2d'), type, 48, 48, 80);
      var d = UI.el('div'); var b = UI.el('b'); b.textContent = t('item.' + type); var s = UI.el('span'); s.textContent = t('itemd.' + type);
      d.appendChild(b); d.appendChild(s); cell.appendChild(d); tbl.appendChild(cell);
    });
    it.appendChild(tbl); box.appendChild(it);
    var keys = UI.el('section', 'panel');
    var h4 = UI.el('h3'); h4.textContent = t('how.keys.t'); keys.appendChild(h4);
    var p4 = UI.el('p'); p4.textContent = t('how.keys.d'); keys.appendChild(p4);
    box.appendChild(keys);
    refreshPractice();
  }
  function drawHow(cv, kind) {
    var W = 360, H = 270, dpr = Math.min(2, w.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var th = Art.resolveTheme(0, 'how');
    var u = 24, cx = W / 2, cy = H / 2;
    Art.drawBelow(ctx, th, W, H, cx, cy, u, 0, true);
    var r = kind === 'shrink' ? 3.6 : 5.2;
    Art.drawArena(ctx, th, cx, cy - 6, u, r, 5.2, 0.4, { reduce: true, shrinking: kind === 'shrink' });
    var arrow = function (x1, y1, x2, y2, col) {
      ctx.save(); ctx.strokeStyle = col || '#fff'; ctx.fillStyle = col || '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      var a = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - 0.5) * 14, y2 - Math.sin(a - 0.5) * 14); ctx.lineTo(x2 - Math.cos(a + 0.5) * 14, y2 - Math.sin(a + 0.5) * 14); ctx.fill(); ctx.restore();
    };
    if (kind === 'move') {
      Art.drawCar(ctx, cx - 30, cy, 0, 60, 0, { t: 0.5 });
      arrow(cx + 5, cy, cx + 80, cy, '#ffd23f');
      ctx.save(); ctx.globalAlpha = 0.3; Art.drawCar(ctx, cx - 80, cy, 0, 60, 0, { t: 0.5, noShadow: true }); ctx.restore();
    } else if (kind === 'dash') {
      Art.drawCar(ctx, cx - 60, cy, 0, 60, 1, { t: 0.5 });
      arrow(cx - 25, cy, cx + 20, cy, '#ff4fa3');
      Art.drawCar(ctx, cx + 60, cy, Math.PI, 60, 2, { t: 0.5, mood: 'ouch', flash: false });
      Art.star(ctx, cx + 28, cy - 10, 16, '#fff36b'); Art.star(ctx, cx + 36, cy + 14, 10, '#fff');
    } else if (kind === 'shrink') {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2; Art.circle(ctx, cx, cy - 6, 5.2 * u); ctx.stroke(); ctx.restore();
      arrow(cx + 5.2 * u - 4, cy - 6, cx + 3.8 * u, cy - 6, '#ff4d5e'); arrow(cx - 5.2 * u + 4, cy - 6, cx - 3.8 * u, cy - 6, '#ff4d5e');
      Art.drawCar(ctx, cx, cy - 6, -0.6, 56, 3, { t: 0.5, mood: 'shock' });
    } else if (kind === 'wobble') {
      var ex = cx + r * u - 4;
      ctx.save(); ctx.fillStyle = 'rgba(255,220,40,0.5)'; Art.circle(ctx, ex, cy - 6, 34); ctx.fill(); ctx.restore();
      Art.drawCar(ctx, ex, cy - 6, 0, 56, 4, { t: 0.5, mood: 'panic', wobble: true });
      arrow(ex - 30, cy + 34, ex - 100, cy + 34, '#4ee07a');
    } else if (kind === 'ghost') {
      Art.drawCar(ctx, cx - 30, cy, 0.4, 50, 5, { t: 0.5 });
      Art.drawItemBox(ctx, cx + 30, cy - 10, 40, 0, true);
      ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = '#f0f0ff'; ctx.beginPath(); ctx.arc(W - 46, 44, 24, Math.PI, 0); ctx.lineTo(W - 22, 76); ctx.lineTo(W - 70, 76); ctx.closePath(); ctx.fill(); ctx.restore();
      arrow(W - 60, 70, cx + 44, cy - 24, '#b98cff');
    }
  }

  /* ====================================================== 線上：大廳 */
  var LobbyChatUI = null, lastRooms = [], lobbyPrivate = null;
  /** 遊戲在線人數（大廳＋房間內連線中的使用者；電腦不算）。由伺服器推送，斷線時不顯示舊數字 */
  function showOnlineCount(n) {
    S.online.count = n;
    var e = $('lobby-online');
    if (n == null || !Net.connected()) { e.hidden = true; return; }
    e.hidden = false; e.textContent = t('lobby.online', { n: n });
  }
  function profile() { return { name: Store.name() || '', skin: Store.skin() }; }
  function onlineEntry() {
    if (!w.GameConfig.isOnlineEnabled()) {
      UI.toast(w.GameConfig.status === 'invalid' ? t('online.badConfig') : t('online.unavailable'), 'bad');
      return;
    }
    S.online.inLobby = true;
    show('lobby');
    $('lobby-name').value = Store.name() || '';
    renderLobbyCars();
    renderRoomList(null);
    setConn('lobby-conn', 'wait', t('online.connecting'));
    Net.connect(profile).catch(function () { setConn('lobby-conn', 'bad', t('online.failed')); renderRoomList([], true); });
  }
  function renderLobbyCars() {
    carPicker($('lobby-cars'), Store.skin(), function (i) { Store.saveSkin(i); renderLobbyCars(); });
    Array.prototype.forEach.call($('lobby-cars').children, function (b) { var c = b.querySelector('canvas'); drawCarPreview(c, +Array.prototype.indexOf.call($('lobby-cars').children, b), 'happy', 56); });
  }
  function setConn(id, cls, text) { var e = $(id); e.className = 'conn ' + cls; e.textContent = text; }
  function exitOnline() {
    S.online.inLobby = false;
    S.online.room = null; S.online.pendingInvite = null;
    setRoomMarker(false);
    if (w.NetworkLatency) w.NetworkLatency.setActive(false);
    showOnlineCount(null);
    Net.disconnect();
    if (LobbyChatUI) LobbyChatUI.setConnected(false);
    show('home');
  }
  function lobbyName() {
    var v = $('lobby-name').value.trim();
    if (!v) { UI.toast(t('lobby.needName'), 'bad'); $('lobby-name').focus(); return null; }
    Store.saveName(v);
    return v;
  }
  function renderRoomList(rooms, failed) {
    lastRooms = rooms;
    var box = $('room-list');
    box.innerHTML = '';
    if (rooms == null) { var p = UI.el('p', 'empty'); p.textContent = failed ? t('online.failed') : t('lobby.loading'); box.appendChild(p); return; }
    if (!rooms.length) { var e = UI.el('p', 'empty'); e.textContent = t('lobby.empty'); box.appendChild(e); return; }
    rooms.forEach(function (r) {
      var it = UI.el('div', 'room-item');
      var main = UI.el('div', 'ri-main');
      var nm = UI.el('div', 'ri-name'); nm.textContent = r.name + ' '; var cd = UI.el('small'); cd.className = 'room-code'; cd.textContent = '#' + r.code; nm.appendChild(cd); main.appendChild(nm);
      var meta = UI.el('div', 'ri-meta');
      var tg = UI.el('span', 'tag ' + (r.phase === 'waiting' ? 'wait' : 'play')); tg.textContent = r.phase === 'waiting' ? t('lobby.waiting') : t('lobby.playing'); meta.appendChild(tg);
      var sp = UI.el('span'); sp.textContent = t('lobby.seats', { n: r.players, max: r.max }); meta.appendChild(sp);
      var md = UI.el('span'); md.textContent = t('mode.' + r.mode); meta.appendChild(md);
      if (r.ai) { var ai = UI.el('span', 'tag'); ai.textContent = t('lobby.hasAi'); meta.appendChild(ai); }
      if (r.spectators) { var sc = UI.el('span'); sc.textContent = t('lobby.spectators', { n: r.spectators }); meta.appendChild(sc); }
      main.appendChild(meta); it.appendChild(main);
      var canJoin = r.phase === 'waiting' && r.players < r.max;
      var jb = UI.el('button', 'btn b-pink small', { type: 'button' }); jb.textContent = t('lobby.join'); jb.disabled = !canJoin;
      jb.addEventListener('click', function () { joinRoom(r.code, null, 'player'); });
      var wb = UI.el('button', 'btn small', { type: 'button' }); wb.textContent = t('lobby.watch');
      wb.addEventListener('click', function () { joinRoom(r.code, null, 'spectator'); });
      it.appendChild(jb); it.appendChild(wb);
      box.appendChild(it);
    });
  }
  function errText(code) { return t('err.' + code) !== 'err.' + code && I18N.has('err.' + code) ? t('err.' + code) : t('err.default'); }
  function joinRoom(code, token, role, nameOverride) {
    var name = nameOverride || lobbyName();
    if (!name) return Promise.resolve();
    if (LobbyChatUI && LobbyChatUI.close) { try { LobbyChatUI.close(); } catch (e) { /* 共用元件版本差異 */ } }
    return Net.send('room:join', { code: code, token: token || undefined, role: role, name: name, skin: Store.skin() }).then(function (r) {
      if (!r.ok) { UI.toast(errText(r.code), 'bad'); return r; }
      S.online.pendingInvite = null; $('invite-panel').hidden = true;
      if (r.notice) UI.toast(t('room.becameSpectator.' + r.notice));
      return r;
    });
  }
  function bindLobby() {
    $('btn-online').addEventListener('click', function () { Audio.unlock(); onlineEntry(); });
    Array.prototype.forEach.call(doc.querySelectorAll('#s-lobby [data-back]'), function (b) { b.addEventListener('click', exitOnline); });
    lobbyPrivate = UI.Switch('#lobby-private');
    $('lobby-quick').addEventListener('click', function () { var n = lobbyName(); if (n) Net.send('room:quick', { name: n, skin: Store.skin() }).then(function (r) { if (!r.ok) UI.toast(errText(r.code), 'bad'); else if (r.created) UI.toast(t('lobby.quickCreated')); }); });
    $('lobby-create').addEventListener('click', function () { var n = lobbyName(); if (n) Net.send('room:create', { name: n, skin: Store.skin(), private: lobbyPrivate.get() }).then(function (r) { if (!r.ok) UI.toast(errText(r.code), 'bad'); }); });
    Net.on('online:count', function (p) { showOnlineCount(p.n); });
    $('lobby-refresh').addEventListener('click', function () { Net.send('room:list').then(function (r) { if (r.ok) renderRoomList(r.rooms); }); });
    $('lobby-name').addEventListener('change', function () { var v = $('lobby-name').value.trim(); if (v) Store.saveName(v); });
    $('invite-join').addEventListener('click', function () { inviteGo('player'); });
    $('invite-watch').addEventListener('click', function () { inviteGo('spectator'); });
    $('invite-cancel').addEventListener('click', function () { S.online.pendingInvite = null; $('invite-panel').hidden = true; clearEntryQuery(); });

    Net.on('status', function (s) {
      var st = s.status;
      if (w.NetworkLatency) w.NetworkLatency.setActive(st === 'connected' && S.screen !== 'home');
      if (st !== 'connected') showOnlineCount(null);
      if (st === 'connected') {
        if (s.online != null) showOnlineCount(s.online);
        setConn('lobby-conn', 'ok', t('online.connected')); setConn('room-conn', 'ok', t('online.connected'));
        Net.send('lobby:enter').then(function (r) { if (r.ok) renderRoomList(r.rooms); });
        if (s.room == null && S.online.room && S.screen !== 'lobby') { /* 房間在斷線期間關掉了 */ roomGone('closed'); }
        if (S.online.pendingInvite) peekInvite();
      } else if (st === 'reconnecting' || st === 'retrying' || st === 'connecting') {
        setConn('lobby-conn', 'wait', t('online.reconnecting')); setConn('room-conn', 'wait', t('online.reconnecting'));
      } else if (st === 'error') { setConn('lobby-conn', 'bad', t('online.failed')); }
      if (LobbyChatUI) LobbyChatUI.setConnected(st === 'connected');
    });
    Net.on('room:list', function (p) { if (S.screen === 'lobby') renderRoomList(p.rooms); });
    Net.on('room:state', onRoomState);
    Net.on('room:closed', function () { roomGone('closed'); });
    Net.on('room:kicked', function () { roomGone('kicked'); });
    Net.on('chat:msg', onChatMsg);
    Net.on('game:init', onGameInit);
    Net.on('game:state', onGameState);
    Net.on('game:over', onGameOver);
  }

  /* 邀請連結：先停在大廳，顯示房間與可編輯的暱稱，按確認才加入 */
  function readInvite() {
    var e = w.GameConfig.entry();
    if (e.room) S.online.pendingInvite = { code: e.room, token: e.invite || '' };
  }
  function clearEntryQuery() {
    try {
      var u = new URL(w.location.href);
      u.searchParams.delete('room'); u.searchParams.delete('invite');
      w.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch (er) { /* 舊瀏覽器 */ }
  }
  function showInvitePanel(info) {
    var inv = S.online.pendingInvite;
    if (!inv) return;
    $('invite-panel').hidden = false;
    if (info) inv.info = info;
    $('invite-desc').textContent = inv.err ? t('err.' + inv.err) : (inv.info ? t('invite.desc', { name: inv.info.name, code: inv.code, n: inv.info.players, max: inv.info.max }) : t('invite.checking', { code: inv.code }));
    $('invite-join').disabled = !!inv.err; $('invite-watch').disabled = !!inv.err;
    if (!$('invite-name').value) $('invite-name').value = Store.name() || '';
  }
  function peekInvite() {
    var inv = S.online.pendingInvite;
    Net.send('room:peek', { code: inv.code, token: inv.token }).then(function (r) {
      inv.err = r.ok ? null : (r.code || 'closed');
      showInvitePanel(r.ok ? r : null);
    });
  }
  function inviteGo(role) {
    var inv = S.online.pendingInvite;
    var n = $('invite-name').value.trim();
    if (!n) { $('invite-err').textContent = t('lobby.needName'); $('invite-name').focus(); return; }
    $('invite-err').textContent = '';
    Store.saveName(n); $('lobby-name').value = n;
    joinRoom(inv.code, inv.token, role, n).then(function (r) {
      if (r && r.ok) clearEntryQuery();
      else if (r) $('invite-err').textContent = errText(r.code);
    });
  }

  /* ====================================================== 線上：房間 */
  var roomDD = {}, roomMax = null, roomItems = null, roomPrivate = null;
  function onRoomState(room) {
    var first = !S.online.room || S.online.room.code !== room.code;
    S.online.room = room;
    setRoomMarker(true);
    S.online.role = room.you.role;
    S.online.sid = room.you.sid;
    S.myId = room.you.sid;
    S.names = {};
    room.seats.forEach(function (s) { if (s.kind === 'human') S.names[s.sid] = s.name; });
    if (first) { S.chatLog = room.chat.slice(); renderChatLog(); }
    if (S.screen === 'lobby' || first && S.screen !== 'game') {
      if (S.online.inLobby) Net.send('lobby:leave');
      show('room');
    }
    renderRoom();
  }
  function bindRoom() {
    $('room-leave').addEventListener('click', function () { leaveRoom(); });
    $('room-ready').addEventListener('click', function () {
      var me = mySeat();
      Net.send('room:ready', { ready: !(me && me.ready) }).then(function (r) { if (!r.ok) UI.toast(errText(r.code), 'bad'); });
    });
    $('room-start').addEventListener('click', function () { Net.send('game:start').then(function (r) { if (!r.ok) UI.toast(errText(r.code), 'bad'); }); });
    $('room-spectate').addEventListener('click', function () {
      var me = mySeat();
      Net.send('room:seat', { action: me ? 'spectate' : 'take' }).then(function (r) { if (!r.ok) UI.toast(errText(r.code), 'bad'); });
    });
    $('room-copy').addEventListener('click', function () {
      var url = inviteUrl(); if (!url) return;
      if (w.navigator.clipboard) w.navigator.clipboard.writeText(url).then(function () { UI.toast(t('room.copied')); }, function () { selectInvite(); });
      else selectInvite();
    });
    $('room-share').addEventListener('click', function () {
      var url = inviteUrl(); if (!url) return;
      if (w.navigator.share) w.navigator.share({ title: t('game.name'), text: t('room.shareText'), url: url }).catch(function () { /* 取消 */ });
      else $('room-copy').click();
    });
    $('room-regen').addEventListener('click', function () { Net.send('room:invite').then(function (r) { if (r.ok) UI.toast(t('room.regenDone')); else UI.toast(errText(r.code), 'bad'); }); });
    roomDD.mode = UI.Select('#room-mode', { value: 'ffa', portal: true, aria: function () { return t('room.mode'); }, options: ['ffa', '2v2', '3v3'].map(function (m) { return { value: m, label: function () { return t('mode.' + m); } }; }), onChange: function (v) { Net.send('room:config', { mode: v }); } });
    roomDD.theme = UI.Select('#room-theme', { value: 0, portal: true, aria: function () { return t('solo.theme'); }, options: themeOptions, onChange: function (v) { Net.send('room:config', { theme: v }); } });
    roomMax = UI.Stepper('#room-max', { value: 4, min: 2, max: 6, labels: function () { return { minus: t('solo.less'), plus: t('solo.more') }; }, onChange: function (v) { Net.send('room:config', { max: v }); } });
    roomItems = UI.Switch('#room-items', function (v) { Net.send('room:config', { items: v }); });
    roomPrivate = UI.Switch('#room-private', function (v) { Net.send('room:config', { private: v }); });
    dds.roomMode = roomDD.mode; dds.roomTheme = roomDD.theme;
    /* 房間聊天 */
    $('game-chat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('game-chat-input'); var v = inp.value.trim(); if (!v) return;
      inp.value = '';
      sendChat({ text: v });
    });
    ['hi', 'gg', 'nice', 'oops', 'again', 'wait'].forEach(function (q) {
      var b = UI.el('button', '', { type: 'button' }); b.setAttribute('data-q', q);
      b.addEventListener('click', function () { sendChat({ quick: q }); });
      $('game-chat-quick').appendChild(b);
    });
  }
  function sendChat(p) {
    var pend = { id: 'p' + Date.now(), name: (mySeat() || {}).name || Store.name(), text: p.text, quick: p.quick, sid: S.online.sid, pending: true };
    S.chatLog = (S.chatLog || []).concat([pend]); renderChatLog();
    Net.send('chat:send', p).then(function (r) {
      S.chatLog = S.chatLog.filter(function (m) { return m !== pend; });
      if (!r.ok) { pend.pending = false; pend.failed = true; S.chatLog.push(pend); UI.toast(t('chat.err.' + (r.code || 'x')) !== 'chat.err.' + r.code && I18N.has('chat.err.' + r.code) ? t('chat.err.' + r.code) : t('chat.err.x'), 'bad'); }
      renderChatLog();
    });
  }
  function onChatMsg(p) {
    S.chatLog = (S.chatLog || []).concat([p.msg]).slice(-80);
    renderChatLog();
    if (!p.msg.sys && p.msg.sid !== S.online.sid) {
      Audio.sfx('chat');
      if ($('side').classList.contains('collapsed')) { S.online.unread++; $('side-unread').hidden = false; $('side-unread').textContent = String(Math.min(99, S.online.unread)); }
    }
  }
  function chatText(m) { return m.sys ? t(m.sys, m.params) : (m.quick ? t('quick.' + m.quick) : m.text); }
  var chatSA = null;
  function renderChatLog() {
    var box = $('game-chat-log');
    if (!chatSA) chatSA = UI.ScrollArea(box);
    var view = chatSA.view;
    var atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 30;
    var inner = view.firstElementChild || view.appendChild(UI.el('div'));
    inner.innerHTML = '';
    (S.chatLog || []).forEach(function (m) {
      var p = UI.el('p', 'cmsg' + (m.sys ? ' sys' : '') + (m.sid && m.sid === S.online.sid ? ' mine' : '') + (m.pending ? ' pending' : ''));
      if (m.sys) p.textContent = chatText(m);
      else { var b = UI.el('b'); b.textContent = m.name + (m.spec ? t('chat.specTag') : '') + '：'; p.appendChild(b); p.appendChild(doc.createTextNode(chatText(m) + (m.failed ? ' ' + t('chat.failed') : ''))); }
      inner.appendChild(p);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('#game-chat-quick button'), function (b) { b.textContent = t('quick.' + b.getAttribute('data-q')); });
    if (atBottom) chatSA.toBottom(); else chatSA.update();
  }
  function mySeat() { var r = S.online.room; if (!r) return null; return r.seats.filter(function (s) { return s.kind === 'human' && s.sid === S.online.sid; })[0] || null; }
  function inviteUrl() { var r = S.online.room; return r && r.invite ? w.GameConfig.inviteUrl(r.code, r.invite) : ''; }
  function selectInvite() { var e = $('room-invite-url'); var rg = doc.createRange(); rg.selectNodeContents(e); var sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(rg); UI.toast(t('share.selectManual')); }
  function renderRoom() {
    var room = S.online.room;
    if (!room) return;
    var host = room.you.host, me = mySeat();
    $('room-title').textContent = room.name;
    $('room-code').textContent = '#' + room.code;
    $('room-role').textContent = room.you.role === 'player' ? (host ? t('room.roleHost') : t('room.rolePlayer')) : t('room.roleSpectator');
    var box = $('room-seats'); box.innerHTML = '';
    room.seats.forEach(function (s) {
      if (!s.open) return;
      var d = UI.el('div', 'seat' + (s.kind === 'empty' ? ' empty-seat' : '') + (me && s.sid === me.sid ? ' me' : '') + (s.kind === 'human' && s.ready ? ' ready' : ''));
      if (s.kind !== 'empty') {
        if (s.kind === 'human' && s.sid === room.host) { var cr = UI.el('span', 'host-crown'); cr.textContent = t('room.host'); d.appendChild(cr); }
        var cv = UI.el('canvas'); d.appendChild(cv); drawCarPreview(cv, s.skin, s.ready ? 'happy' : 'happy', 72);
        var nm = UI.el('span', 's-name'); nm.textContent = s.kind === 'human' ? s.name : animalName(s.skin) + t('lv.tag', { lv: t('lv.' + s.level) }); d.appendChild(nm);
        var sub = UI.el('span', 's-sub');
        sub.textContent = s.kind === 'ai' ? t('room.cpu') : (!s.connected ? t('room.offline') : (s.sid === room.host ? t('room.isHost') : (s.ready ? t('room.isReady') : t('room.notReady'))));
        d.appendChild(sub);
        var acts = UI.el('div', 'seat-acts');
        if (host && room.phase === 'waiting') {
          if (s.kind === 'ai') {
            var dd = UI.el('div'); acts.appendChild(dd);
            UI.Select(dd, { value: s.level, portal: true, aria: function () { return t('room.cpuLevel'); }, options: lvOptions(false), onChange: function (v) { Net.send('room:ai', { slot: s.slot, level: v }); } });
            var rm = UI.el('button', 'btn small ghost', { type: 'button' }); rm.textContent = t('room.removeCpu'); rm.addEventListener('click', function () { Net.send('room:ai', { slot: s.slot, level: null }); }); acts.appendChild(rm);
          } else if (s.sid !== S.online.sid) {
            var kb = UI.el('button', 'btn small ghost', { type: 'button' }); kb.textContent = t('room.kick');
            kb.addEventListener('click', function () { confirmBox(t('room.kick'), t('room.kickText', { name: s.name }), function () { Net.send('room:kick', { sid: s.sid }); }); });
            acts.appendChild(kb);
          }
        }
        if (me && s.sid === me.sid && room.phase === 'waiting') {
          var cb = UI.el('button', 'btn small', { type: 'button' }); cb.textContent = t('room.changeCar');
          cb.addEventListener('click', function () { var taken = room.seats.filter(function (x) { return x.kind !== 'empty'; }).map(function (x) { return x.skin; }); var n = s.skin; for (var k = 1; k <= 8; k++) { var c = (s.skin + k) % 8; if (taken.indexOf(c) < 0) { n = c; break; } } Store.saveSkin(n); Net.send('room:skin', { skin: n }); });
          acts.appendChild(cb);
        }
        d.appendChild(acts);
      } else {
        var e = UI.el('span', 's-sub'); e.textContent = t('room.empty'); d.appendChild(e);
        if (host && room.phase === 'waiting') {
          var ab = UI.el('button', 'btn small b-cyan', { type: 'button' }); ab.textContent = t('room.addCpu');
          ab.addEventListener('click', function () { Net.send('room:ai', { slot: s.slot, level: 'normal' }); });
          d.appendChild(ab);
        }
      }
      box.appendChild(d);
    });
    if (room.spectators.length) {
      var sp = UI.el('p', 'hint'); sp.textContent = t('room.spectatorList', { n: room.spectators.length, names: room.spectators.map(function (x) { return x.name; }).join('、') }); box.appendChild(sp);
    }
    var cars = room.seats.filter(function (s) { return s.open && s.kind !== 'empty'; }).length;
    var notReady = room.seats.filter(function (s) { return s.kind === 'human' && !s.ready && s.sid !== room.host; }).length;
    var hint = room.phase === 'playing' ? t('room.inGame') : (cars < 2 ? t('room.needTwo') : (notReady ? t('room.waitReady', { n: notReady }) : (host ? t('room.canStart') : t('room.waitHost'))));
    if (room.config.mode !== 'ffa') { var need = room.config.mode === '2v2' ? 4 : 6; if (cars !== need) hint = t('room.teamNeed', { n: need }); }
    $('room-hint').textContent = hint;
    /* 設定（只有房主能改） */
    roomDD.mode.set(room.config.mode); roomDD.theme.set(room.config.theme); roomMax.set(room.config.max); roomItems.set(room.config.items, true);
    var lock = !host || room.phase !== 'waiting';
    roomDD.mode.setDisabled(lock); roomDD.theme.setDisabled(lock);
    Array.prototype.forEach.call(doc.querySelectorAll('#room-max button'), function (b) { if (lock) b.disabled = true; });
    if (!lock) roomMax.refresh();
    $('room-items').disabled = lock;
    roomPrivate.set(!!room.config.private, true); $('room-private').disabled = lock;
    $('room-invite-url').textContent = inviteUrl();
    $('room-regen').hidden = !host;
    /* 底部按鈕 */
    $('room-ready').hidden = !me || host;
    $('room-ready').querySelector('b').textContent = me && me.ready ? t('room.unready') : t('room.ready');
    $('room-start').hidden = !host;
    $('room-start').disabled = room.phase !== 'waiting' || cars < 2 || notReady > 0;
    $('room-spectate').textContent = me ? t('room.toSpectate') : t('room.takeSeat');
    $('room-spectate').disabled = room.phase !== 'waiting' || (!me && room.seats.filter(function (s) { return s.open && s.kind === 'empty'; }).length === 0);
    if (room.phase === 'playing' && S.screen === 'room' && S.match) show('game');
  }
  function setRoomMarker(on) { try { if (on) w.sessionStorage.setItem('bumper-sumo:v1:inroom', '1'); else w.sessionStorage.removeItem('bumper-sumo:v1:inroom'); } catch (e) { /* 無痕 */ } }
  function leaveRoom(toHome) {
    setRoomMarker(false);
    Net.send('room:leave').then(function () {
      S.online.room = null; S.chatLog = [];
      S.match = null; $('result').hidden = true; S.resultShown = false;
      if (toHome) { exitOnline(); return; }
      S.online.inLobby = true;
      show('lobby');
      Net.send('lobby:enter').then(function (r) { if (r.ok) renderRoomList(r.rooms); });
    });
  }
  function roomGone(why) {
    setRoomMarker(false);
    if (!S.online.room) return;
    S.online.room = null; S.match = null;
    $('result').hidden = true; S.resultShown = false;
    UI.toast(why === 'kicked' ? t('room.kicked') : t('room.closed'), 'bad');
    S.online.inLobby = true;
    show('lobby');
    Net.send('lobby:enter').then(function (r) { if (r.ok) renderRoomList(r.rooms); });
  }

  /* ====================================================== 線上：對局（伺服器權威＋本機預測） */
  function onGameInit(g) {
    ensureRenderer();
    S.mode = 'online';
    S.online.round = g.round; S.online.init = g;
    var defs = g.cars.map(function (c) { return { id: c.id, name: c.name, skin: c.skin, level: c.level, human: c.human, team: c.team }; });
    S.match = R.createMatch({ seed: g.seed, cars: defs, items: g.items, teams: g.teams, mode: 'online', theme: g.theme, countdown: g.countdown, predict: true });
    R.applySnapshot(S.match, g.snap);
    S.online.offsets = {};
    S.brains = {};
    renderer.setTheme(g.theme, g.seed);
    beginMatchView();
    if (w.GameAnalytics) w.GameAnalytics.sync('playing', S.online.room ? S.online.room.code + ':' + g.round : g.seed, { mode: 'online', players: defs.length, spectator: S.online.role !== 'player' });
  }
  function onGameState(snap) {
    var m = S.match;
    if (!m || S.mode !== 'online') return;
    var me = R.getCar(m, S.myId);
    var keep = null;
    if (me) keep = { x: me.x, y: me.y, vx: me.vx, vy: me.vy, a: me.angle, dash: { phase: me.dash.phase, t: me.dash.t, cd: me.dash.cd } };
    /* 其他車：記下套用前的位置，畫面用位移量慢慢收斂（避免跳動） */
    var before = {};
    m.cars.forEach(function (c) { before[c.id] = [c.x, c.y]; });
    var wasPhase = m.phase;
    R.applySnapshot(m, snap);
    m.cars.forEach(function (c) {
      if (c.id === S.myId) return;
      var b = before[c.id]; var o = S.online.offsets[c.id] || (S.online.offsets[c.id] = [0, 0]);
      var dx = b[0] - c.x, dy = b[1] - c.y;
      if (Math.hypot(dx, dy) < 2) { o[0] += dx; o[1] += dy; } else { o[0] = 0; o[1] = 0; }
    });
    /* 自己的車：差距小就慢慢拉回、差距大就直接對齊 */
    if (me && keep && me.alive && !me.fx.spring && me.wobble <= 0) {
      var lead = Math.min(0.2, S.online.rtt / 2000);
      var sx = me.x + me.vx * lead, sy = me.y + me.vy * lead;
      var err = Math.hypot(sx - keep.x, sy - keep.y);
      if (err < 1.4) {
        var k = 0.25;
        me.x = keep.x + (sx - keep.x) * k; me.y = keep.y + (sy - keep.y) * k;
        me.vx = keep.vx + (me.vx - keep.vx) * 0.4; me.vy = keep.vy + (me.vy - keep.vy) * 0.4;
        me.angle = keep.a;
      }
      if (performance.now() - S.online.localDashAt < S.online.rtt + 120) me.dash = keep.dash;
    }
    if (snap.ev && snap.ev.length) handleEvents(snap.ev);
    if (wasPhase === 'countdown' && m.phase === 'playing' && !(snap.ev || []).some(function (e) { return e.type === 'go'; })) showCount(0);
  }
  function onGameOver(p) {
    if (!S.match || S.mode !== 'online') return;
    R.applySnapshot(S.match, p.snap);
    S.match.phase = 'over';
    S.online.lastResult = p.result;
    setTimeout(function () { if (S.match && S.mode === 'online' && S.screen === 'game') showResult(p.result); }, 1200);
    if (S.online.room) S.online.room.phase = 'waiting';
  }
  function onlineFrame(now, dt) {
    var m = S.match;
    var me = R.getCar(m, S.myId);
    var input = Input.read();
    /* 送輸入：方向有變或每 66ms 送一次；衝刺／道具立即送 */
    if (S.online.role === 'player' && me && m.phase !== 'over') {
      var changed = !S.online.lastInput || Math.abs(input.mx - S.online.lastInput.mx) > 0.05 || Math.abs(input.my - S.online.lastInput.my) > 0.05;
      if (input.dash || input.item || changed || now - S.online.lastSend > 66) {
        Net.input({ mx: input.mx, my: input.my, dash: input.dash, item: input.item, seq: ++S.online.seq });
        S.online.lastSend = now; S.online.lastInput = input;
        if (input.dash && me.alive && me.dash.phase === 'idle' && me.dash.cd <= 0) S.online.localDashAt = now;
      }
    }
    /* 本機預測：只動自己的車與碰撞（出局、道具、勝負等伺服器） */
    S.acc += dt;
    var n = 0, first = true;
    while (S.acc >= R.DT && n < 4) {
      m.cars.forEach(function (c) { if (c.id !== S.myId) { c.input.mx = 0; c.input.my = 0; } });
      if (me && S.online.role === 'player') R.setInput(m, S.myId, first ? input : { mx: input.mx, my: input.my });
      first = false;
      if (m.phase === 'playing') { var ph = m.phase; R.step(m); m.phase = ph; }
      S.acc -= R.DT; n++;
    }
    if (S.acc > R.DT * 4) S.acc = 0;
    /* 收斂其他車的畫面位移 */
    var decay = Math.exp(-dt * 12);
    Object.keys(S.online.offsets).forEach(function (id) {
      var o = S.online.offsets[id]; var c = R.getCar(m, id);
      o[0] *= decay; o[1] *= decay;
      if (c && c.alive) { c.rx = o[0]; c.ry = o[1]; }
    });
    var v = Net.rtt(); if (v) S.online.rtt = v;
  }

  /* ====================================================== 大廳聊天室（共用元件） */
  function bindLobbyChat() {
    if (!w.LobbyChat) return;
    LobbyChatUI = w.LobbyChat.create({
      game: 'bumper-sumo', mount: '#app',
      active: function () { return S.screen === 'lobby' && Net.connected(); },
      lang: function () { return I18N.lang === 'en' ? 'en' : (I18N.lang === 'zh-Hans' ? 'zh-CN' : 'zh-TW'); },
      getName: function () { return Store.name() || ''; },
      setName: function (n) { Store.saveName(n); $('lobby-name').value = n; },
      join: function (name) { Net.send('lobbychat:join', { name: name }); },
      leave: function () { Net.send('lobbychat:leave'); },
      send: function (text, name) { Net.send('lobbychat:send', { text: text, name: name }); },
      joinRoom: function (code) { joinRoom(code, null, 'player'); }
    });
    LobbyChatUI.bindSetting({ input: '#set-lobbychat', label: '#set-lobbychat-label', sub: '#set-lobbychat-sub', reset: '#b-settings-reset', event: 'swchange' });
    Net.on('lobbychat:history', function (p) { LobbyChatUI.history(p.history, p.online); });
    Net.on('lobbychat:msg', function (p) { LobbyChatUI.add(p.msg); });
    Net.on('lobbychat:online', function (p) { LobbyChatUI.online(p.online); });
    Net.on('lobbychat:error', function (p) { LobbyChatUI.error(p.code); });
  }

  /* ====================================================== 首頁按鈕、返回 */
  function bindHome() {
    $('btn-solo').addEventListener('click', function () { Audio.unlock(); openSolo(); });
    $('btn-practice').addEventListener('click', function () { Audio.unlock(); startPractice(); });
    $('btn-howto').addEventListener('click', function () { Audio.unlock(); show('howto'); });
    $('btn-records').addEventListener('click', function () { Audio.unlock(); renderRecords(); show('records'); });
    Array.prototype.forEach.call(doc.querySelectorAll('#s-records [data-back]'), function (b) { b.addEventListener('click', function () { show('home'); }); });
    Array.prototype.forEach.call(doc.querySelectorAll('#s-solo [data-back], #s-howto [data-back]'), function (b) { b.addEventListener('click', function () { show('home'); }); });
    var ICONS = {
      robot: '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/></svg>',
      globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/></svg>',
      target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
      book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/></svg>',
      trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/></svg>'
    };
    Array.prototype.forEach.call(doc.querySelectorAll('[data-ico]'), function (e) { e.innerHTML = ICONS[e.getAttribute('data-ico')] || ''; });
    /* 第一次手勢解鎖音訊 */
    var unlockOnce = function () { Audio.unlock(); doc.removeEventListener('pointerdown', unlockOnce, true); doc.removeEventListener('keydown', unlockOnce, true); };
    doc.addEventListener('pointerdown', unlockOnce, true);
    doc.addEventListener('keydown', unlockOnce, true);
    /* 觸控裝置：顯示虛擬搖桿 */
    var coarse = w.matchMedia && w.matchMedia('(pointer: coarse)').matches;
    doc.body.classList.toggle('touch-on', !!coarse);
    w.addEventListener('touchstart', function () { doc.body.classList.add('touch-on'); }, { passive: true, once: true });
    /* 首頁按上一頁回遊戲大廳；其他畫面按上一頁回上一層 */
    try { w.history.pushState({ g: 1 }, ''); } catch (e) { /* ok */ }
    w.addEventListener('popstate', function () {
      if (UI.Modal.any()) { UI.Modal.close(); try { w.history.pushState({ g: 1 }, ''); } catch (e) { /* ok */ } return; }
      if (S.screen === 'home') { w.location.href = $('lobby-link').href; return; }
      try { w.history.pushState({ g: 1 }, ''); } catch (e2) { /* ok */ }
      if (S.screen === 'game') { if (S.resultShown) $('res-home').click(); else pause(); }
      else if (S.screen === 'room') leaveRoom();
      else if (S.screen === 'lobby') exitOnline();
      else show('home');
    });
  }

  /* ====================================================== 啟動 */
  function init() {
    I18N.apply(doc);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-scroll]'), function (e) { UI.ScrollArea(e); });
    bindLang(); bindSettings(); bindHome(); bindSolo(); bindGame(); bindLobby(); bindRoom(); bindLobbyChat();
    applySettings();
    buildHowto();
    readInvite();
    refreshTexts();
    show('home');
    var inRoom = false;
    try { inRoom = w.sessionStorage.getItem('bumper-sumo:v1:inroom') === '1'; } catch (e) { /* 無痕 */ }
    if (S.online.pendingInvite) {
      onlineEntry();
      showInvitePanel();
    } else if (inRoom && w.GameConfig.isOnlineEnabled()) {
      /* 重新整理：工作階段還在就自動回到原房間 */
      onlineEntry();
    }
    w.BumperApp = { S: S, startSolo: startSolo, startPractice: startPractice, show: show, openSolo: openSolo, showResult: showResult, pause: pause };
  }
  init();
}(window));
