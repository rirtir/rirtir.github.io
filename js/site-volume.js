/* サイト全体の音量（rirtir.com 共通）
   音を出すページの <head> の先頭で読み込む。Web Audio の出口（destination）と、audio／video 要素の音量に、共通の倍率をかける。
   音量は localStorage に保存され、同じブラウザの全ページ・全タブで共有される（既定は100%＝何も変えない）。
   各ページに小さな 🔊 ボタンを出し、押すと音量スライダーが開く。ボタンが邪魔なページは、このスクリプトより前に
   window.SITE_VOLUME_UI = false; と書けば、ボタンを出さずに音量だけ反映する。
   公開API：window.siteVolume.get() / set(0〜1) / setMuted(bool) / onChange(fn) */
(function () {
  'use strict';
  if (window.siteVolume) return;
  const KEY_V = 'site.volume', KEY_M = 'site.muted';
  let vol = 1, muted = false;
  const listeners = [];
  const load = () => {
    try {
      const v = parseFloat(localStorage.getItem(KEY_V));
      vol = isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      muted = localStorage.getItem(KEY_M) === '1';
    } catch (e) {}
  };
  load();
  /* スライダーの位置（0〜1）から実際の倍率へ。人の耳に合わせて2乗にする（1のときは変えない） */
  const gainOf = () => (muted ? 0 : vol * vol);

  /* ---------- Web Audio：destination を、倍率をかけるゲインに差し替える ---------- */
  const masters = [];                                       // WeakRef<GainNode>
  const applyMasters = () => {
    for (let i = masters.length - 1; i >= 0; i--) {
      const g = masters[i].deref();
      if (!g) { masters.splice(i, 1); continue; }
      try { g.gain.setTargetAtTime(gainOf(), g.context.currentTime, 0.015); } catch (e) {}
    }
  };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    let owner = AC.prototype, desc = null;
    while (owner && !(desc = Object.getOwnPropertyDescriptor(owner, 'destination'))) owner = Object.getPrototypeOf(owner);
    if (desc && desc.get) {
      const store = new WeakMap();
      Object.defineProperty(owner, 'destination', {
        configurable: true, enumerable: desc.enumerable,
        get() {
          const real = desc.get.call(this);
          if (typeof OfflineAudioContext !== 'undefined' && this instanceof OfflineAudioContext) return real;      // 書き出し用は変えない
          let g = store.get(this);
          if (!g) {
            g = this.createGain();
            g.gain.value = gainOf();
            g.connect(real);
            store.set(this, g);
            masters.push(new WeakRef(g));
          }
          return g;
        },
      });
    }
  }

  /* ---------- audio／video 要素：volume に倍率をかける ---------- */
  const mediaSet = new Set();                                // 音を出した要素
  const own = new WeakMap();                                 // 要素 → ページ側が設定した音量（0〜1）
  const mp = HTMLMediaElement.prototype;
  const vd = Object.getOwnPropertyDescriptor(mp, 'volume');
  const applyMedia = el => { try { vd.set.call(el, Math.min(1, Math.max(0, (own.has(el) ? own.get(el) : 1) * gainOf()))); } catch (e) {} };
  const track = el => { mediaSet.add(el); applyMedia(el); };
  if (vd && vd.get && vd.set) {
    Object.defineProperty(mp, 'volume', {
      configurable: true, enumerable: vd.enumerable,
      get() { return own.has(this) ? own.get(this) : 1; },
      set(v) { own.set(this, Math.min(1, Math.max(0, Number(v) || 0))); mediaSet.add(this); applyMedia(this); },
    });
    const origPlay = mp.play;
    mp.play = function () { track(this); return origPlay.apply(this, arguments); };
    ['loadstart', 'play', 'playing'].forEach(ev => document.addEventListener(ev, e => { if (e.target instanceof HTMLMediaElement) track(e.target); }, true));
  }
  const applyAllMedia = () => { mediaSet.forEach(el => applyMedia(el)); document.querySelectorAll('audio,video').forEach(track); };

  /* ---------- 変更の反映・保存 ---------- */
  const apply = () => { applyMasters(); applyAllMedia(); listeners.forEach(f => { try { f(vol, muted); } catch (e) {} }); refreshUI(); };
  const save = () => { try { localStorage.setItem(KEY_V, String(vol)); localStorage.setItem(KEY_M, muted ? '1' : '0'); } catch (e) {} };
  window.siteVolume = {
    get: () => vol, isMuted: () => muted,
    set(v) { vol = Math.min(1, Math.max(0, Number(v) || 0)); if (vol > 0) muted = false; save(); apply(); },
    setMuted(m) { muted = !!m; save(); apply(); },
    onChange(f) { listeners.push(f); },
  };
  window.addEventListener('storage', e => { if (e.key === KEY_V || e.key === KEY_M) { load(); apply(); } });

  /* ---------- 画面の小さな音量ボタン ---------- */
  let root, btn, panel, slider, label, muteBtn;
  const icon = () => (muted || vol === 0 ? '🔇' : vol < 0.4 ? '🔈' : vol < 0.75 ? '🔉' : '🔊');
  function refreshUI() {
    if (!root) return;
    btn.textContent = icon();
    slider.value = String(Math.round(vol * 100));
    label.textContent = (muted ? '消音' : Math.round(vol * 100) + '%');
    muteBtn.textContent = muted ? '消音を解除' : '消音';
  }
  function buildUI() {
    if (window.SITE_VOLUME_UI === false || root || window.top !== window.self) return;
    root = document.createElement('div');
    root.id = 'siteVolume';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'サイト全体の音量');
    root.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483000;font:13px/1.3 sans-serif;color:#eef2f8;-webkit-user-select:none;user-select:none;touch-action:manipulation';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'サイト全体の音量';
    btn.style.cssText = 'width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(20,28,40,.78);color:#fff;font-size:16px;line-height:1;padding:0;cursor:pointer;opacity:.7;backdrop-filter:blur(4px)';
    panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:absolute;right:0;bottom:42px;width:200px;padding:10px 12px;border-radius:12px;background:rgba(20,28,40,.94);border:1px solid rgba(255,255,255,.2);box-shadow:0 6px 20px rgba(0,0,0,.45)';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:6px';
    const t = document.createElement('span'); t.textContent = 'サイト全体の音量';
    label = document.createElement('span'); label.style.fontWeight = 'bold';
    head.append(t, label);
    slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
    slider.style.cssText = 'width:100%;margin:0 0 6px;accent-color:#1fb386';
    muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.style.cssText = 'width:100%;padding:4px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#2b3748;color:#eef2f8;font-size:12px;cursor:pointer';
    panel.append(head, slider, muteBtn);
    root.append(panel, btn);
    document.body.appendChild(root);
    btn.onmouseenter = () => { btn.style.opacity = '1'; };
    btn.onmouseleave = () => { btn.style.opacity = '.7'; };
    btn.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };
    slider.oninput = () => window.siteVolume.set(Number(slider.value) / 100);
    muteBtn.onclick = () => window.siteVolume.setMuted(!muted);
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) panel.style.display = 'none'; }, true);
    refreshUI();
  }
  if (document.body) buildUI(); else document.addEventListener('DOMContentLoaded', buildUI);
})();
