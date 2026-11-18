/* ===== ui.js — 自繪元件：彈窗、開關、滑桿、加減鈕、下拉選單、捲動區（自訂捲軸）、提示 =====
 * 全部保留 ARIA、鍵盤、觸控與可見焦點；外觀完全由 style.css 控制，不顯示原生控制項。 */
(function (root) {
  'use strict';
  var doc = root.document;

  function $(sel, scope) { return typeof sel === 'string' ? (scope || doc).querySelector(sel) : sel; }
  function el(tag, cls, attrs) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /* ---------- 彈窗（焦點鎖定、Escape、返回原焦點、背景 inert） ---------- */
  var stack = [];
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var Modal = {
    open: function (id, opts) {
      var m = $(typeof id === 'string' && id.charAt(0) !== '#' ? '#' + id : id);
      if (!m || stack.some(function (s) { return s.m === m; })) return;
      var entry = { m: m, prev: doc.activeElement, opts: opts || {}, inert: [] };
      /* 背景設為 inert，但右上角語言＋設定工具列保持可用（彈窗開著也能切換語言） */
      var keep = doc.querySelector('.topbar-global');
      var lockOut = function (parent) {
        Array.prototype.forEach.call(parent.children, function (n) {
          if (n === m || n.tagName === 'SCRIPT' || n === keep) return;
          if (n.contains(m) || (keep && n.contains(keep))) { lockOut(n); return; }
          if (stack.some(function (s) { return s.m === n; })) return;
          entry.inert.push([n, n.inert]); n.inert = true;
        });
      };
      lockOut(doc.body);
      /* 疊在另一個彈窗上（例如設定裡的清除確認）：先前被設成 inert 的自己要解除 */
      m.inert = false;
      stack.push(entry);
      m.hidden = false;
      m.classList.add('open');
      var f = m.querySelector('[data-autofocus]') || m.querySelector(FOCUSABLE);
      setTimeout(function () { if (f) f.focus(); refreshScroll(m); }, 30);
    },
    close: function (id) {
      var m = id ? $(typeof id === 'string' && id.charAt(0) !== '#' ? '#' + id : id) : (stack[stack.length - 1] || {}).m;
      var idx = -1;
      for (var i = 0; i < stack.length; i++) if (stack[i].m === m) idx = i;
      if (idx < 0) return;
      var entry = stack.splice(idx, 1)[0];
      m.classList.remove('open');
      m.hidden = true;
      entry.inert.forEach(function (p) { p[0].inert = p[1]; });
      if (entry.prev && entry.prev.focus && entry.prev.isConnected) entry.prev.focus();
      if (entry.opts.onClose) entry.opts.onClose();
    },
    top: function () { return stack.length ? stack[stack.length - 1].m : null; },
    isOpen: function (id) { var m = $('#' + id); return stack.some(function (s) { return s.m === m; }); },
    any: function () { return stack.length > 0; }
  };
  doc.addEventListener('keydown', function (e) {
    var top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      if (doc.querySelector('.dd-list.open')) return;   // 先關下拉選單
      e.preventDefault(); e.stopPropagation();
      if (top.opts.noEscape) return;
      Modal.close(top.m);
    } else if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(top.m.querySelectorAll(FOCUSABLE), function (x) { return x.offsetParent !== null || x === doc.activeElement; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
  doc.addEventListener('click', function (e) {
    var top = stack[stack.length - 1];
    if (!top) return;
    if (e.target === top.m && !top.opts.noBackdrop) Modal.close(top.m);
    var closer = e.target.closest && e.target.closest('[data-close]');
    if (closer && top.m.contains(closer)) Modal.close(top.m);
  });

  /* ---------- 開關 ---------- */
  function Switch(node, onChange) {
    node = $(node);
    node.setAttribute('role', 'switch');
    if (!node.querySelector('.sw-knob')) node.appendChild(el('span', 'sw-knob', { 'aria-hidden': 'true' }));
    var api = {
      get: function () { return node.getAttribute('aria-checked') === 'true'; },
      set: function (v, silent) {
        node.setAttribute('aria-checked', v ? 'true' : 'false');
        if (!silent) { node.dispatchEvent(new CustomEvent('swchange', { detail: !!v, bubbles: true })); if (onChange) onChange(!!v); }
      }
    };
    node.addEventListener('click', function () { api.set(!api.get()); });
    node._sw = api;
    return api;
  }

  /* ---------- 滑桿 ---------- */
  function Slider(node, o) {
    node = $(node);
    o = o || {};
    var min = o.min || 0, max = o.max == null ? 1 : o.max, step = o.step || 0.05, val = o.value == null ? min : o.value;
    node.classList.add('slider');
    node.setAttribute('role', 'slider'); node.setAttribute('tabindex', '0');
    node.setAttribute('aria-valuemin', min); node.setAttribute('aria-valuemax', max);
    node.innerHTML = '';
    var track = el('span', 'sl-track'), fill = el('span', 'sl-fill'), thumb = el('span', 'sl-thumb');
    track.appendChild(fill); track.appendChild(thumb); node.appendChild(track);
    function render() {
      var k = (val - min) / (max - min);
      fill.style.width = (k * 100) + '%';
      thumb.style.left = (k * 100) + '%';
      node.setAttribute('aria-valuenow', val);
      node.setAttribute('aria-valuetext', o.format ? o.format(val) : String(Math.round(k * 100)) + '%');
    }
    function setVal(v, fire) {
      v = Math.round(Math.max(min, Math.min(max, v)) / step) * step;
      v = Math.round(v * 1000) / 1000;
      if (v === val && !fire) { render(); return; }
      val = v; render();
      if (o.onChange) o.onChange(val);
    }
    function fromX(clientX) {
      var r = track.getBoundingClientRect();
      setVal(min + (clientX - r.left) / Math.max(1, r.width) * (max - min), true);
    }
    var dragging = false;
    node.addEventListener('pointerdown', function (e) { dragging = true; node.setPointerCapture(e.pointerId); fromX(e.clientX); e.preventDefault(); node.focus(); });
    node.addEventListener('pointermove', function (e) { if (dragging) fromX(e.clientX); });
    node.addEventListener('pointerup', function () { dragging = false; });
    node.addEventListener('pointercancel', function () { dragging = false; });
    node.addEventListener('keydown', function (e) {
      var d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 4, PageDown: -step * 4 }[e.key];
      if (e.key === 'Home') { setVal(min, true); e.preventDefault(); return; }
      if (e.key === 'End') { setVal(max, true); e.preventDefault(); return; }
      if (d) { setVal(val + d, true); e.preventDefault(); }
    });
    render();
    var api = { get: function () { return val; }, set: function (v) { val = v; render(); } };
    node._sl = api;
    return api;
  }

  /* ---------- 加減鈕 ---------- */
  function Stepper(node, o) {
    node = $(node);
    var val = o.value, min = o.min, max = o.max;
    node.classList.add('stepper');
    node.setAttribute('role', 'group');
    node.innerHTML = '';
    var minus = el('button', 'st-btn', { type: 'button' }), out = el('output', 'st-val', { 'aria-live': 'polite' }), plus = el('button', 'st-btn', { type: 'button' });
    minus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
    plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';
    node.appendChild(minus); node.appendChild(out); node.appendChild(plus);
    function render() {
      out.textContent = o.format ? o.format(val) : String(val);
      minus.disabled = val <= min; plus.disabled = val >= max;
      minus.setAttribute('aria-label', o.labels ? o.labels().minus : '-');
      plus.setAttribute('aria-label', o.labels ? o.labels().plus : '+');
    }
    function set(v) { v = Math.max(min, Math.min(max, v)); if (v === val) return; val = v; render(); if (o.onChange) o.onChange(val); }
    minus.addEventListener('click', function () { set(val - 1); });
    plus.addEventListener('click', function () { set(val + 1); });
    render();
    return { get: function () { return val; }, set: function (v) { val = v; render(); }, refresh: render };
  }

  /* ---------- 下拉選單（listbox） ---------- */
  var openDD = null;
  function Select(node, o) {
    node = $(node);
    o = o || {};
    node.classList.add('dd');
    node.innerHTML = '';
    var btn = el('button', 'dd-btn', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
    var lab = el('span', 'dd-label'), caret = el('span', 'dd-caret', { 'aria-hidden': 'true' });
    caret.innerHTML = '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';
    if (o.icon) { var ic = el('span', 'dd-icon', { 'aria-hidden': 'true' }); ic.innerHTML = o.icon; btn.appendChild(ic); }
    btn.appendChild(lab); btn.appendChild(caret);
    /* pop＝浮出的外框（定位、背景、自訂捲軸）；list＝裡面的選項清單（listbox、鍵盤焦點） */
    var pop = el('div', 'dd-list');
    var list = el('ul', 'dd-ul', { role: 'listbox', tabindex: '-1' });
    var lid = 'dd' + Math.random().toString(36).slice(2, 8);
    list.id = lid; btn.setAttribute('aria-controls', lid);
    pop.appendChild(list);
    pop._owner = node;
    node.appendChild(btn);
    sweepDD();
    (o.portal ? doc.body : node).appendChild(pop);
    var sa = ScrollArea(pop);
    var value = o.value, active = 0;

    function opts() { return typeof o.options === 'function' ? o.options() : o.options; }
    function render() {
      var arr = opts();
      var cur = arr.filter(function (x) { return x.value === value; })[0] || arr[0];
      lab.innerHTML = '';
      if (cur && cur.swatch) { var sw = el('span', 'dd-swatch'); sw.style.background = cur.swatch; lab.appendChild(sw); }
      lab.appendChild(doc.createTextNode(cur ? (typeof cur.label === 'function' ? cur.label() : cur.label) : ''));
      if (o.aria) btn.setAttribute('aria-label', o.aria() + '：' + (cur ? lab.textContent : ''));
      list.innerHTML = '';
      arr.forEach(function (x, i) {
        var li = el('li', 'dd-opt', { role: 'option', id: lid + '-' + i, 'aria-selected': x.value === value ? 'true' : 'false' });
        if (x.swatch) { var s2 = el('span', 'dd-swatch'); s2.style.background = x.swatch; li.appendChild(s2); }
        li.appendChild(doc.createTextNode(typeof x.label === 'function' ? x.label() : x.label));
        if (x.badge) { var bd = el('span', 'dd-badge'); bd.textContent = x.badge(); li.appendChild(bd); }
        li.addEventListener('click', function (e) { e.stopPropagation(); choose(x.value); close(true); });
        li.addEventListener('pointermove', function () { setActive(i); });
        list.appendChild(li);
      });
    }
    function setActive(i) {
      var items = list.children; if (!items.length) return;
      active = (i + items.length) % items.length;
      Array.prototype.forEach.call(items, function (li, k) { li.classList.toggle('active', k === active); });
      list.setAttribute('aria-activedescendant', items[active].id);
      /* 只捲選單自己的捲動區，不要連帶捲動頁面 */
      var v = sa.view, li = items[active];
      if (li.offsetTop < v.scrollTop) v.scrollTop = li.offsetTop - 6;
      else if (li.offsetTop + li.offsetHeight > v.scrollTop + v.clientHeight) v.scrollTop = li.offsetTop + li.offsetHeight - v.clientHeight + 6;
    }
    function place() {
      var r = btn.getBoundingClientRect();
      var vh = root.innerHeight, vw = root.innerWidth;
      pop.style.minWidth = Math.max(r.width, 140) + 'px';
      var below = vh - r.bottom, above = r.top;
      /* 依選單實際需要的高度決定往上或往下：下面放得下就往下，否則上面放得下就往上，都放不下就往空間大的那邊 */
      var need = Math.min(320, list.scrollHeight + 12) + 16;
      var up = below >= need ? false : above >= need ? true : above > below;
      var maxH = Math.max(120, Math.min(320, (up ? above : below) - 16));
      pop.style.maxHeight = maxH + 'px';
      if (o.portal) {
        pop.style.position = 'fixed';
        var lw = Math.max(r.width, 140);
        var left = Math.min(Math.max(8, o.alignRight ? r.right - lw : r.left), vw - lw - 8);
        pop.style.left = left + 'px';
        if (up) { pop.style.top = ''; pop.style.bottom = (vh - r.top + 6) + 'px'; }
        else { pop.style.bottom = ''; pop.style.top = (r.bottom + 6) + 'px'; }
      } else {
        pop.classList.toggle('up', up);
      }
    }
    function open() {
      if (openDD && openDD !== api) openDD.close();
      sweepDD();
      render();
      pop.classList.add('open'); place();   // 先顯示才量得到選單高度
      btn.setAttribute('aria-expanded', 'true'); node.classList.add('is-open');
      sa.view.scrollTop = 0; sa.update();
      var arr = opts(); var idx = 0;
      arr.forEach(function (x, i) { if (x.value === value) idx = i; });
      setActive(idx);   // 目前選的那一項會捲到看得見
      list.focus({ preventScroll: true });
      openDD = api;
    }
    function close(focusBtn) {
      pop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); node.classList.remove('is-open');
      if (openDD === api) openDD = null;
      if (focusBtn && btn.isConnected) btn.focus({ preventScroll: true });
    }
    function choose(v) {
      if (v === value) return;
      value = v; render();
      if (o.onChange) o.onChange(v);
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (pop.classList.contains('open')) close(); else open(); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    list.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(list.children.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(opts()[active].value); close(true); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(true); }
    });
    render();
    var api = {
      get: function () { return value; },
      set: function (v) { value = v; render(); if (pop.classList.contains('open')) setActive(active); },   // 開著時更新選項，鍵盤位置不跑掉
      refresh: function () { render(); if (pop.classList.contains('open')) setActive(active); },
      close: close, open: open, node: node, list: pop, ul: list,
      setDisabled: function (d) { btn.disabled = !!d; }
    };
    node._dd = api;
    return api;
  }
  doc.addEventListener('click', function (e) {
    if (openDD && !openDD.node.contains(e.target) && !openDD.list.contains(e.target)) openDD.close();
  });
  root.addEventListener('resize', function () { if (openDD) openDD.close(); });
  /* 頁面（選單以外）捲動時關掉選單：浮在 body 上的選單不會跟著按鈕移動，避免跟按鈕分家 */
  doc.addEventListener('scroll', function (e) {
    if (openDD && !(e.target && e.target.nodeType === 1 && openDD.list.contains(e.target))) openDD.close();
  }, true);
  /* 清掉按鈕已經被移除（畫面重建）的下拉選單殘留；開著的也一併關掉 */
  function sweepDD() {
    if (openDD && !openDD.node.isConnected) { openDD.list.classList.remove('open'); openDD = null; }
    var pops = doc.querySelectorAll('body > .dd-list');
    for (var i = 0; i < pops.length; i++) { if (!pops[i]._owner || !pops[i]._owner.isConnected) pops[i].remove(); }
  }

  /* ---------- 捲動區（自訂捲軸） ----------
   * <div data-scroll> 內容 </div>  → 包成 .sa > .sa-view(內容) + .sa-track>.sa-thumb */
  var areas = [];
  function ScrollArea(node, o) {
    node = $(node);
    if (!node || node._sa) return node && node._sa;
    o = o || {};
    node.classList.add('sa');
    var view = el('div', 'sa-view');
    if (node.hasAttribute('data-scroll-label')) { view.setAttribute('tabindex', '0'); view.setAttribute('role', 'region'); view.setAttribute('aria-label', node.getAttribute('data-scroll-label')); }
    while (node.firstChild) view.appendChild(node.firstChild);
    node.appendChild(view);
    var track = el('div', 'sa-track', { 'aria-hidden': 'true' }), thumb = el('div', 'sa-thumb');
    track.appendChild(thumb); node.appendChild(track);
    var htrack = null, hthumb = null;
    if (o.horizontal || node.hasAttribute('data-scroll-x')) {
      htrack = el('div', 'sa-track sa-h', { 'aria-hidden': 'true' }); hthumb = el('div', 'sa-thumb'); htrack.appendChild(hthumb); node.appendChild(htrack);
      node.classList.add('sa-has-x');
    }
    function update() {
      var ch = view.clientHeight, sh = view.scrollHeight;
      var over = sh > ch + 1;
      node.classList.toggle('sa-over', over);
      node.classList.toggle('sa-end', !over || view.scrollTop + view.clientHeight >= view.scrollHeight - 2);
      if (over) {
        var th = Math.max(28, ch * ch / sh);
        var top = (view.scrollTop / (sh - ch)) * (ch - th);
        thumb.style.height = th + 'px';
        thumb.style.transform = 'translateY(' + top + 'px)';
      }
      if (htrack) {
        var cw = view.clientWidth, sw = view.scrollWidth, ox = sw > cw + 1;
        node.classList.toggle('sa-over-x', ox);
        if (ox) {
          var tw = Math.max(28, cw * cw / sw);
          hthumb.style.width = tw + 'px';
          hthumb.style.transform = 'translateX(' + (view.scrollLeft / (sw - cw)) * (cw - tw) + 'px)';
        }
      }
    }
    function drag(thumbEl, horizontal) {
      var start = 0, startScroll = 0, dragging = false;
      thumbEl.addEventListener('pointerdown', function (e) {
        dragging = true; start = horizontal ? e.clientX : e.clientY; startScroll = horizontal ? view.scrollLeft : view.scrollTop;
        thumbEl.setPointerCapture(e.pointerId); node.classList.add('sa-drag'); e.preventDefault(); e.stopPropagation();
      });
      thumbEl.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        if (horizontal) { var k = (view.scrollWidth - view.clientWidth) / Math.max(1, view.clientWidth - thumbEl.offsetWidth); view.scrollLeft = startScroll + (e.clientX - start) * k; }
        else { var k2 = (view.scrollHeight - view.clientHeight) / Math.max(1, view.clientHeight - thumbEl.offsetHeight); view.scrollTop = startScroll + (e.clientY - start) * k2; }
      });
      var end = function () { dragging = false; node.classList.remove('sa-drag'); };
      thumbEl.addEventListener('pointerup', end); thumbEl.addEventListener('pointercancel', end);
    }
    drag(thumb, false);
    if (hthumb) drag(hthumb, true);
    track.addEventListener('pointerdown', function (e) {
      if (e.target !== track) return;
      if (e.pointerType !== 'mouse') {   // 手指／觸控筆在捲軸上滑：跟著手指捲（不要一按就跳一整頁）
        var sy = e.clientY, st = view.scrollTop, id = e.pointerId;
        track.setPointerCapture(id); e.preventDefault();
        var mv = function (ev) { if (ev.pointerId === id) view.scrollTop = st - (ev.clientY - sy); };
        var up = function (ev) { if (ev.pointerId !== id) return; track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
        track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
        return;
      }
      var r = thumb.getBoundingClientRect();
      view.scrollBy({ top: (e.clientY < r.top ? -1 : 1) * view.clientHeight * 0.9, behavior: 'smooth' });
    });
    /* 滑鼠滾輪停在捲軸上也要能捲（捲軸疊在內容右緣，原本會吃掉滾輪） */
    var wheel = function (e) {
      if (e.ctrlKey) return;
      var dx = e.deltaX, dy = e.deltaY, k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? view.clientHeight : 1;
      var before = view.scrollTop, beforeX = view.scrollLeft;
      view.scrollTop += dy * k; view.scrollLeft += dx * k;
      if (view.scrollTop !== before || view.scrollLeft !== beforeX) e.preventDefault();
    };
    track.addEventListener('wheel', wheel, { passive: false });
    if (htrack) htrack.addEventListener('wheel', wheel, { passive: false });
    view.addEventListener('scroll', update, { passive: true });
    if (root.ResizeObserver) { var ro = new ResizeObserver(update); ro.observe(view); ro.observe(node); }
    if (root.MutationObserver) new MutationObserver(function () { requestAnimationFrame(update); }).observe(view, { childList: true, subtree: true, characterData: true });
    /* 焦點進來時自動捲到看得到 */
    view.addEventListener('focusin', function (e) { if (e.target !== view && e.target.scrollIntoView && !e.target.classList.contains('dd-ul')) e.target.scrollIntoView({ block: 'nearest' }); });
    var api = { view: view, update: update, node: node, toBottom: function () { view.scrollTop = view.scrollHeight; update(); } };
    node._sa = api;
    areas.push(api);
    setTimeout(update, 0);
    return api;
  }
  function refreshScroll(scope) {
    areas.forEach(function (a) { if (!scope || scope.contains(a.node)) a.update(); });
  }
  root.addEventListener('resize', function () { refreshScroll(); });

  /* ---------- 提示 ---------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2400);
  }

  root.UI = { $: $, el: el, Modal: Modal, Switch: Switch, Slider: Slider, Stepper: Stepper, Select: Select, ScrollArea: ScrollArea, refreshScroll: refreshScroll, toast: toast };
}(typeof window !== 'undefined' ? window : this));
