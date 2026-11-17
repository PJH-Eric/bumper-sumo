/* ===== share.js — 結算「分享結果」：把實際結算卡擷取成 PNG，彈窗預覽＋分享圖片＋下載 PNG =====
 * 只做圖片分享（不做文字、連結、社群分享）。分享 payload 只含 PNG 檔案。
 * 擷取時排除按鈕與分享元件；圖片品牌列只顯示目前網址的 origin＋pathname（不帶 query／hash／房號／邀請）。
 * html2canvas 1.4.1（MIT，同站 public/js/vendor）第一次使用才載入，不依賴 CDN、不上傳。 */
(function (root) {
  'use strict';
  var doc = root.document;
  var cur = null;        // { key, url, file }
  var loading = null;
  var job = 0;

  function t(k, p) { return root.I18N.t(k, p); }
  function cleanUrl() {
    var l = root.location;
    if (!l || !/^https?:$/.test(l.protocol)) return '';
    return (l.host + l.pathname).replace(/\/index\.html$/, '/');
  }
  function status(text) { var s = doc.getElementById('share-status'); s.textContent = text || ''; s.hidden = !text; }

  function loadLib() {
    if (root.html2canvas) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise(function (res, rej) {
      var s = doc.createElement('script');
      s.src = 'js/vendor/html2canvas.min.js';
      s.onload = function () { res(); };
      s.onerror = function () { loading = null; s.remove(); rej(new Error('load')); };
      doc.head.appendChild(s);
    });
    return loading;
  }

  function release() {
    job++;
    if (cur && cur.url) URL.revokeObjectURL(cur.url);
    cur = null;
    var img = doc.getElementById('share-img');
    if (img) { img.removeAttribute('src'); img.hidden = true; }
    if (root.UI && root.UI.Modal.isOpen('m-share')) root.UI.Modal.close('m-share');
  }

  /** 擷取結算卡（排除按鈕、展開捲動區） */
  function capture(card) {
    return root.html2canvas(card, {
      backgroundColor: null, scale: Math.min(2, Math.max(1.5, root.devicePixelRatio || 1)), logging: false, useCORS: false,
      onclone: function (cdoc) {
        var c = cdoc.getElementById('result-card-capture') || cdoc.querySelector('#result .result-card');
        if (!c) return;
        c.style.maxHeight = 'none'; c.style.animation = 'none'; c.style.boxShadow = 'none';
        Array.prototype.forEach.call(c.querySelectorAll('.result-actions, .sa-track, button'), function (e) { e.remove(); });
        /* html2canvas 畫不好 inset 陰影：換成一般邊框 */
        Array.prototype.forEach.call(c.querySelectorAll('.podium li.me'), function (e) { e.style.boxShadow = 'none'; e.style.border = '3px solid #ffd23f'; });
        Array.prototype.forEach.call(c.querySelectorAll('.result-scroll, .sa, .sa-view'), function (e) { e.style.maxHeight = 'none'; e.style.height = 'auto'; e.style.overflow = 'visible'; e.style.flex = 'none'; });
        var wrap = cdoc.getElementById('result'); if (wrap) { wrap.style.position = 'static'; wrap.style.padding = '0'; wrap.style.backdropFilter = 'none'; }
      }
    });
  }

  /** 在擷取結果外面加上品牌卡：遊戲名稱、底色、圓角、乾淨網址 */
  function frame(shot) {
    var k = shot.width / 560;
    var pad = Math.round(40 * k), head = Math.round(120 * k), foot = Math.round(60 * k);
    var W = shot.width + pad * 2, H = shot.height + head + foot;
    var cv = doc.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2a1f5c'); g.addColorStop(1, '#1d1640');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var Art = root.BumperArt;
    /* 夜空霓虹點點 */
    var rnd = Art.seededRng('share');
    for (var i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,233,163,' + (0.2 + rnd() * 0.4) + ')'; Art.circle(ctx, rnd() * W, rnd() * H, 2 + rnd() * 3); ctx.fill(); }
    var s = k;
    Art.drawCar(ctx, pad + 46 * s, head * 0.66, -0.5, 64 * s, 1, { t: 0.3 });
    Art.drawCar(ctx, W - pad - 46 * s, head * 0.66, Math.PI + 0.5, 64 * s, 0, { t: 0.3, mood: 'ouch' });
    var F = '"Baloo 2", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 ' + Math.round(46 * s) + 'px ' + F;
    ctx.shadowColor = '#ff4fa3'; ctx.shadowBlur = 20 * s; ctx.fillStyle = '#fff';
    ctx.fillText(t('game.name'), W / 2, head * 0.52);
    ctx.shadowBlur = 0;
    ctx.save(); Art.rr(ctx, pad, head, shot.width, shot.height, 28 * s); ctx.clip(); ctx.drawImage(shot, pad, head); ctx.restore();
    ctx.strokeStyle = 'rgba(255,233,163,0.45)'; ctx.lineWidth = 4 * s; Art.rr(ctx, pad, head, shot.width, shot.height, 28 * s); ctx.stroke();
    var url = cleanUrl();
    if (url) { ctx.font = '700 ' + Math.round(20 * s) + 'px ' + F; ctx.fillStyle = '#c9bff2'; ctx.fillText(url, W / 2, H - foot / 2); }
    return cv;
  }

  function open(key) {
    release();
    var my = ++job;
    var img = doc.getElementById('share-img');
    img.alt = t('share.imgAlt');
    status(t('share.preparing'));
    root.UI.Modal.open('m-share');
    var card = doc.querySelector('#result .result-card');
    loadLib().then(function () {
      if (my !== job) return null;
      return (doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve()).then(function () { return capture(card); });
    }).then(function (shot) {
      if (!shot || my !== job) return;
      var cv = frame(shot);
      cv.toBlob(function (blob) {
        if (my !== job || !blob) { if (!blob) status(t('share.genFail')); return; }
        cur = { key: key, url: URL.createObjectURL(blob), file: new File([blob], 'bumper-brawl-result.png', { type: 'image/png' }) };
        img.src = cur.url; img.hidden = false;
        status('');
        root.UI.refreshScroll(doc.getElementById('m-share'));
      }, 'image/png');
    }).catch(function () { if (my === job) status(t('share.genFail')); });
  }

  function bind() {
    doc.getElementById('share-image').addEventListener('click', function () {
      if (!cur || !cur.file) { status(t('share.preparing')); return; }
      var payload = { files: [cur.file] };
      if (root.navigator.share && root.navigator.canShare && root.navigator.canShare(payload)) {
        root.navigator.share(payload).catch(function (e) {
          if (e && e.name === 'AbortError') return;          // 使用者取消：什麼都不做
          status(t('share.fail'));
        });
      } else status(t('share.noFileShare'));
    });
    doc.getElementById('share-download').addEventListener('click', function () {
      if (!cur || !cur.url) { status(t('share.preparing')); return; }
      var a = doc.createElement('a'); a.href = cur.url; a.download = cur.file.name;
      doc.body.appendChild(a); a.click(); a.remove();
    });
  }

  root.BumperShare = { open: open, release: release, bind: bind, _cur: function () { return cur; } };
}(typeof window !== 'undefined' ? window : this));
