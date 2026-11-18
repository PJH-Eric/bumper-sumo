/* ===== input.js — 鍵盤與觸控（左下浮動搖桿、右下衝刺鍵與道具鍵） ===== */
(function (root) {
  'use strict';
  var doc = root.document;
  var keys = {};
  var edge = { dash: false, item: false };
  var joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
  var enabled = false;
  var hooks = {};
  var els = {};
  var lastTouch = 0;

  var MAP = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight']
  };

  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKey(e, down) {
    if (!enabled) return;
    var code = e.code;
    var game = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'Enter', 'NumpadEnter'];
    if (game.indexOf(code) < 0) return;
    if (down) {
      if (isTyping(e.target) || (root.UI && root.UI.Modal.any())) return;
      var enter = code === 'Enter' || code === 'NumpadEnter';
      // 保留聚焦按鈕與連結的原生鍵盤操作。
      if ((enter || code === 'Space') && e.target.closest && e.target.closest('button, a[href]')) return;
      e.preventDefault();
      if (!keys[code]) {
        if (code === 'Space') edge.dash = true;
        if (code === 'KeyE' || enter) edge.item = true;
      }
    }
    keys[code] = down;
    if (els.dash) els.dash.classList.toggle('pressed', !!keys.Space);
  }

  function axis() {
    var x = 0, y = 0;
    var any = function (list) { return list.some(function (k) { return keys[k]; }); };
    if (any(MAP.left)) x -= 1; if (any(MAP.right)) x += 1;
    if (any(MAP.up)) y -= 1; if (any(MAP.down)) y += 1;
    if (joy.active) { x = joy.x; y = joy.y; }
    var m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x: x, y: y };
  }

  /* ---------- 觸控搖桿 ---------- */
  function joyRadius() { return (els.joyBase ? els.joyBase.offsetWidth : 120) / 2; }
  function setKnob(dx, dy) {
    if (!els.joyKnob) return;
    els.joyKnob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  }
  function joyStart(e) {
    if (!enabled || joy.id !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    joy.id = e.pointerId;
    var zr = els.zone.getBoundingClientRect();
    joy.ox = e.clientX; joy.oy = e.clientY;
    joy.active = true;
    els.joy.classList.add('active');
    els.joy.style.left = (e.clientX - zr.left) + 'px';
    els.joy.style.top = (e.clientY - zr.top) + 'px';
    els.joy.style.bottom = 'auto';
    try { els.zone.setPointerCapture(e.pointerId); } catch (er) { /* 舊瀏覽器 */ }
    joyMove(e);
    e.preventDefault();
    lastTouch = Date.now();
  }
  function joyMove(e) {
    if (e.pointerId !== joy.id) return;
    var R = joyRadius();
    var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    var m = Math.hypot(dx, dy);
    if (m > R) {
      /* 拖出底座外：底座跟著手指走，永遠不會「推到底推不動」 */
      var over = m - R;
      joy.ox += dx / m * over; joy.oy += dy / m * over;
      var zr = els.zone.getBoundingClientRect();
      els.joy.style.left = (joy.ox - zr.left) + 'px';
      els.joy.style.top = (joy.oy - zr.top) + 'px';
      dx = dx / m * R; dy = dy / m * R;
    }
    var dead = R * 0.12;
    joy.x = m < dead ? 0 : dx / R; joy.y = m < dead ? 0 : dy / R;
    setKnob(dx, dy);
    e.preventDefault();
  }
  function joyEnd(e) {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.active = false; joy.x = 0; joy.y = 0;
    setKnob(0, 0);
    els.joy.classList.remove('active');
    els.joy.style.left = ''; els.joy.style.top = ''; els.joy.style.bottom = '';
  }

  function hideHint() { var h = doc.getElementById('touch-hint'); if (h) h.hidden = true; }

  function bindButton(btn, which) {
    if (!btn) return;
    btn.addEventListener('pointerdown', function (e) {
      if (!enabled) return;
      hideHint();
      edge[which] = true;
      btn.classList.add('pressed');
      e.preventDefault();
      lastTouch = Date.now();
      if (root.navigator.vibrate && hooks.vibrate && hooks.vibrate()) root.navigator.vibrate(12);
    });
    var up = function () { btn.classList.remove('pressed'); };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
    /* 鍵盤操作（Tab 到按鈕再按 Enter）仍然有效 */
    btn.addEventListener('click', function (e) { if (e.detail === 0 && enabled) edge[which] = true; });
  }

  var Input = {
    init: function (o) {
      hooks = o || {};
      els.zone = doc.getElementById('joy-zone');
      els.joy = doc.getElementById('joy');
      els.joyBase = els.joy && els.joy.querySelector('.joy-base');
      els.joyKnob = els.joy && els.joy.querySelector('.joy-knob');
      els.dash = doc.getElementById('btn-dash');
      els.item = doc.getElementById('btn-item');
      doc.addEventListener('keydown', function (e) {
        if (e.code === 'Escape' && enabled && hooks.onEscape && !(root.UI && root.UI.Modal.any())) { hooks.onEscape(); return; }
        onKey(e, true);
      });
      doc.addEventListener('keyup', function (e) { onKey(e, false); });
      root.addEventListener('blur', Input.reset);
      /* 對局畫面不要長按選單、文字選取等瀏覽器手勢 */
      var stage = doc.getElementById('stage');
      if (stage) stage.addEventListener('contextmenu', function (e) { if (enabled) e.preventDefault(); });
      if (els.zone) {
        els.zone.addEventListener('pointerdown', function (e) { hideHint(); joyStart(e); });
        els.zone.addEventListener('pointermove', joyMove);
        els.zone.addEventListener('pointerup', joyEnd);
        els.zone.addEventListener('pointercancel', joyEnd);
      }
      bindButton(els.dash, 'dash');
      bindButton(els.item, 'item');
    },
    setEnabled: function (on) { enabled = !!on; if (!on) Input.reset(); },
    reset: function () {
      keys = {}; edge.dash = false; edge.item = false;
      if (joy.id !== null) joyEnd({ pointerId: joy.id });
      if (els.dash) els.dash.classList.remove('pressed');
    },
    /** 讀一次輸入；dash／item 是按一下旗標，讀完就清掉 */
    read: function () {
      var a = axis();
      var out = { mx: a.x, my: a.y, dash: edge.dash, item: edge.item };
      edge.dash = false; edge.item = false;
      return out;
    },
    usedTouchRecently: function () { return Date.now() - lastTouch < 20000; },
    hideHint: hideHint
  };
  root.BumperInput = Input;
}(typeof window !== 'undefined' ? window : this));
