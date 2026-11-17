/* ===== i18n.js — 輕量多語系（繁中／简中／English），切換立即生效並記住 ===== */
(function (root) {
  'use strict';
  var KEY = 'bumper-sumo:v1:lang';
  var LANGS = ['zh-Hant', 'zh-Hans', 'en'];
  var dicts = {};
  var listeners = [];
  var missing = {};

  function detect() {
    try { var saved = root.localStorage.getItem(KEY); if (LANGS.indexOf(saved) >= 0) return saved; } catch (e) { /* 無痕模式 */ }
    var nav = (root.navigator && (root.navigator.language || '')) || '';
    if (/^en/i.test(nav)) return 'en';
    if (/^zh-(CN|SG|Hans)/i.test(nav)) return 'zh-Hans';
    return 'zh-Hant';
  }

  function fmt(str, p) {
    if (!p) return str;
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; });
  }

  var I18N = {
    LANGS: LANGS,
    lang: 'zh-Hant',
    register: function (lang, values) { dicts[lang] = Object.assign(dicts[lang] || {}, values); return I18N; },
    dict: function (lang) { return dicts[lang] || {}; },
    has: function (key) { return dicts[I18N.lang] && dicts[I18N.lang][key] != null; },
    t: function (key, params, fallback) {
      var d = dicts[I18N.lang] || {};
      var v = d[key];
      if (v == null) {
        if (!missing[I18N.lang + ':' + key]) { missing[I18N.lang + ':' + key] = 1; if (root.console) console.warn('[i18n] 缺少翻譯 ' + I18N.lang + ':' + key); }
        v = (dicts['zh-Hant'] || {})[key];
        if (v == null) v = fallback != null ? fallback : key;
      }
      return fmt(v, params);
    },
    setLang: function (l) {
      if (LANGS.indexOf(l) < 0) return;
      I18N.lang = l;
      try { root.localStorage.setItem(KEY, l); } catch (e) { /* 存不了就算了 */ }
      I18N.apply(root.document);
      listeners.forEach(function (fn) { try { fn(l); } catch (e) { console.error(e); } });
      try { root.document.dispatchEvent(new CustomEvent('i18n:change', { detail: l })); } catch (e) { /* 舊瀏覽器 */ }
    },
    on: function (fn) { listeners.push(fn); },
    missing: function () { return Object.keys(missing); },
    /** 套用 data-i18n（文字）、data-i18n-aria、data-i18n-ph、data-i18n-title、data-i18n-content */
    apply: function (scope) {
      if (!scope || !scope.querySelectorAll) return;
      var doc = root.document;
      if (scope === doc) {
        doc.documentElement.lang = I18N.lang === 'en' ? 'en' : I18N.lang;
        var tt = doc.querySelector('title[data-i18n-title]');
        if (tt) doc.title = I18N.t(tt.getAttribute('data-i18n-title'));
      }
      var q = function (sel, fn) { Array.prototype.forEach.call(scope.querySelectorAll(sel), fn); };
      q('[data-i18n]', function (el) { el.textContent = I18N.t(el.getAttribute('data-i18n')); });
      q('[data-i18n-html]', function (el) { el.innerHTML = I18N.t(el.getAttribute('data-i18n-html')); });
      q('[data-i18n-aria]', function (el) { el.setAttribute('aria-label', I18N.t(el.getAttribute('data-i18n-aria'))); });
      q('[data-i18n-ph]', function (el) { el.setAttribute('placeholder', I18N.t(el.getAttribute('data-i18n-ph'))); });
      q('[data-i18n-tip]', function (el) { el.setAttribute('title', I18N.t(el.getAttribute('data-i18n-tip'))); });
      q('meta[data-i18n-content]', function (el) { el.setAttribute('content', I18N.t(el.getAttribute('data-i18n-content'))); });
    }
  };
  I18N.lang = detect();
  root.I18N = I18N;
}(typeof window !== 'undefined' ? window : this));
