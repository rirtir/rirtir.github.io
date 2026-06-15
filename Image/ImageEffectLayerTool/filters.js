"use strict";

/*
  PRISM — フィルター用モジュール (filters.js)
  --------------------------------------------------------------
  各フィルターに関する情報（カテゴリ・パラメータ定義・専用UI・画像処理）を
  すべてこのファイルに集約しています。app.js（アプリ表示用JS）は、ここで
  公開される window.PRISM_FILTERS 経由でのみフィルター機能を利用するため、
  このファイルが無くてもアプリの土台（画像の読み込み・表示・ズーム・書き出し）
  は動作します。

  新しいフィルターを追加したいときは、原則このファイルだけを編集します:
    1. CATS / FILTERS に定義を追加する
       （解像度を変えるフィルターは resolution:true、1つだけ許可するなら unique:true）
    2. 既定値が必要なら makeLayer / onLayerAdded を調整する
    3. 専用UIが必要なら layerBodyHTML / wireBody に分岐を足す
    4. 画像処理を renderPipeline の switch に追加する
       （単純なピクセル処理なら applyPixelFilter に分岐を足すだけでよい）
    5. 末尾の window.PRISM_FILTERS に必要な関数を公開する
*/

/* ---------- filter definitions ---------- */
const CATS = {
  tone:    { label:"露出・トーン", color:"var(--c-tone)" },
  color:   { label:"色",          color:"var(--c-color)" },
  focus:   { label:"ぼかし・シャープ", color:"var(--c-focus)" },
  res:     { label:"解像度",      color:"var(--c-res)" },
  stylize: { label:"スタイライズ", color:"var(--c-stylize)" },
};

const RESIZE_SCALES = [
  { key:"2",      label:"×2",   factor:2 },
  { key:"1",      label:"×1",   factor:1 },
  { key:"0.5",    label:"×1/2", factor:0.5 },
  { key:"0.25",   label:"×1/4", factor:0.25 },
  { key:"0.125",  label:"×1/8", factor:0.125 },
  { key:"custom", label:"カスタム", factor:null },
];
const QUALITY_LABELS = { low:"低", medium:"中", high:"高" };

const FILTERS = {
  brightness:{ name:"明るさ",       cat:"tone",    min:0,  max:200, step:1,   def:100, neutral:100, fmt:v=>v+"%" },
  contrast:  { name:"コントラスト", cat:"tone",    min:0,  max:200, step:1,   def:100, neutral:100, fmt:v=>v+"%" },
  opacity:   { name:"不透明度",     cat:"tone",    min:0,  max:100, step:1,   def:100, neutral:100, fmt:v=>v+"%" },
  bias:      { name:"バイアス消去", cat:"tone",    special:true },
  tonecurve: { name:"トーンカーブ", cat:"tone",    special:true },
  saturate:  { name:"彩度",         cat:"color",   min:0,  max:300, step:1,   def:100, neutral:100, fmt:v=>v+"%" },
  hue:       { name:"色相",         cat:"color",   min:-180,max:180,step:1,   def:0,   neutral:0,   fmt:v=>(v>0?"+":"")+v+"\u00b0" },
  sepia:     { name:"セピア",       cat:"color",   min:0,  max:100, step:1,   def:80,  neutral:0,   fmt:v=>v+"%" },
  grayscale: { name:"グレースケール", cat:"color", min:0,  max:100, step:1,   def:100, neutral:0,   fmt:v=>v+"%" },
  quantize:  { name:"減色",         cat:"color",   min:2,  max:256, step:1,   def:32,  neutral:256, fmt:v=>v+"色", special:true },
  blur:      { name:"ぼかし",       cat:"focus",   min:0,  max:40,  step:0.5, def:6,   neutral:0,   fmt:v=>v+"px" },
  resize:    { name:"リサイズ",     cat:"res",     special:true, resolution:true },
  superres:  { name:"超解像",       cat:"res",     min:0,  max:100, step:1,   def:55,  neutral:0,   fmt:v=>v+"%", special:true, scales:[1.5,2,3,4], defScale:2, resolution:true, unique:true },
  pixelart:  { name:"ドット絵化",   cat:"res",     special:true, resolution:true },
  invert:    { name:"色反転",       cat:"stylize", min:0,  max:100, step:1,   def:100, neutral:0,   fmt:v=>v+"%" },
  binarize:  { name:"2値化",        cat:"stylize", min:0,  max:255, step:1,   def:128, neutral:-1,  fmt:v=>v+"" },
  mosaic:    { name:"モザイク",     cat:"stylize", special:true },
};

/* ---------- layer factory ---------- */
function makeLayer(type){
  const f = FILTERS[type];
  const layer = { type, value:f.def ?? 0, enabled:true };
  if(type === "superres") layer.scale = f.defScale;
  if(type === "resize"){
    layer.mode = "1";
    layer.quality = "medium";
    layer.width = null;
    layer.height = null;
  }
  if(type === "grayscale"){
    layer.lowColor = "#000000";
    layer.highColor = "#ffffff";
  }
  if(type === "bias"){
    layer.value = 85;       // 補正量
    layer.size = 121;       // 局所平均サイズ
    layer.offset = 0;       // 明るさオフセット
    layer.threshold = 3;    // 偏差しきい値
  }
  if(type === "tonecurve"){
    layer.channel = "rgb";
    layer.curves = {
      rgb:[{x:0,y:0},{x:255,y:255}],
      r:[{x:0,y:0},{x:255,y:255}],
      g:[{x:0,y:0},{x:255,y:255}],
      b:[{x:0,y:0},{x:255,y:255}],
    };
  }
  if(type === "mosaic"){
    layer.size = 16;
    layer.offsetX = 0;
    layer.offsetY = 0;
    layer.method = "mean";   // mean | median | mode
  }
  if(type === "pixelart"){
    layer.outW = null;
    layer.outH = null;
    layer.colors = 16;
    layer.punch = 30;        // メリハリ（%）
    layer.dither = true;
  }
  return layer;
}

/* ---------- add-layer hook（レイヤー追加直後のフィルター固有の初期化） ---------- */
function onLayerAdded(layer){
  if(layer.type === "resize" && sourceReady) updateResizeFromMode(layer, "1");
  if(layer.type === "pixelart" && sourceReady){          // 追加
    const input = layerInputSize(layer);
    const t = pixelartTarget(layer, input.w, input.h);
    layer.outW = t.w; layer.outH = t.h;
  }
}

/* ---------- dimension helpers ---------- */
function layerInputSize(targetLayer){
  let size = baseDimensions();
  for(const l of layers){
    if(l.id === targetLayer.id) break;
    if(!l.enabled) continue;
    if(l.type === "superres"){
      const t = scaleTarget(size.w, size.h, l.scale || 1);
      size = { w:t.w, h:t.h };
    } else if(l.type === "resize"){
      const t = resizeTarget(l, size.w, size.h);
      size = { w:t.w, h:t.h };
    } else if(l.type === "pixelart"){
      const t = pixelartTarget(l, size.w, size.h);
      size = { w:t.w, h:t.h };
    }
  }
  return size;
}
function scaleTarget(w,h,scale){
  const s = scale || 1;
  // 実寸の出力サイズはここで上限を設けない（書き出しは指定どおりの解像度にする）。
  return { w:Math.max(1, Math.round(w*s)), h:Math.max(1, Math.round(h*s)), s, clamped:false };
}
function resizeTarget(layer, inputW, inputH){
  if(layer.mode !== "custom"){
    const def = RESIZE_SCALES.find(x=>x.key === layer.mode) || RESIZE_SCALES[1];
    const t = scaleTarget(inputW, inputH, def.factor || 1);
    return { w:t.w, h:t.h, clamped:false };
  }
  const w = clampInt(layer.width || inputW, 1, HARD_MAX);
  const h = clampInt(layer.height || inputH, 1, HARD_MAX);
  return { w, h, clamped:false };
}
function pixelartTarget(layer, inW, inH){
  const w = clampInt(layer.outW || Math.round(inW/8) || 64, 1, 2048);
  const h = clampInt(layer.outH || Math.round(inH/8) || 64, 1, 2048);
  return { w, h };
}
/* ---------- 実際の出力解像度（全レイヤー適用後の実寸） ---------- */
function outputDimensions(){
  let size = baseDimensions();
  for(const l of layers){
    if(!l.enabled) continue;
    if(l.type === "superres"){
      const t = scaleTarget(size.w, size.h, l.scale || 1);
      size = { w:t.w, h:t.h };
    } else if(l.type === "resize"){
      const t = resizeTarget(l, size.w, size.h);
      size = { w:t.w, h:t.h };
    } else if(l.type === "pixelart"){
      const t = pixelartTarget(l, size.w, size.h);
      size = { w:t.w, h:t.h };
    }
  }
  return size;
}
function updateResizeFromMode(layer, mode){
  layer.mode = mode;
  const input = layerInputSize(layer);
  if(mode !== "custom"){
    const t = resizeTarget(layer, input.w, input.h);
    layer.width = t.w;
    layer.height = t.h;
  } else {
    if(!layer.width || !layer.height){
      layer.width = input.w;
      layer.height = input.h;
    }
  }
}
function refreshResizeLayers(){
  for(const l of layers){
    if(l.type === "resize" && l.enabled && l.mode !== "custom") updateResizeFromMode(l, l.mode);
  }
}

/* ---------- body UI（フィルターごとのコントロール生成） ---------- */
function sliderHTML(f, value, label=null, className="main-range"){
  const isNeutral = Number(value) === f.neutral;
  return `<div class="slider-row">
    ${label ? `<span class="mini-label">${label}</span>` : ""}
    <input class="${className}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${value}" aria-label="${f.name}">
    <span class="val ${isNeutral?'neutral':''}">${f.fmt(value)}</span>
  </div>`;
}
function layerBodyHTML(layer){
  const f = FILTERS[layer.type];
  if(layer.type === "superres"){
    const input = sourceReady ? layerInputSize(layer) : null;
    const t = input ? scaleTarget(input.w, input.h, layer.scale || 1) : null;
    return `<div class="layer-body">
      <div class="scale-row" role="group" aria-label="拡大率">
        ${f.scales.map(s=>`<button class="scale-btn ${layer.scale===s?'on':''}" data-s="${s}">×${s}</button>`).join("")}
      </div>
      ${sliderHTML(f, layer.value, "ディテール")}
      <div class="sr-out mono">${t
        ? `出力解像度: ${t.w} × ${t.h} px`
        : "画像を開くと出力解像度が表示されます"}</div>
    </div>`;
  }
  if(layer.type === "resize"){
    const input = sourceReady ? layerInputSize(layer) : null;
    if(input && (!layer.width || !layer.height)) updateResizeFromMode(layer, layer.mode || "1");
    const t = input ? resizeTarget(layer, input.w, input.h) : null;
    return `<div class="layer-body">
      <div class="scale-row" role="group" aria-label="リサイズ倍率">
        ${RESIZE_SCALES.map(s=>`<button class="scale-btn ${layer.mode===s.key?'on':''}" data-mode="${s.key}">${s.label}</button>`).join("")}
      </div>
      <div class="resize-size-row">
        <label class="size-box"><span>X</span><input class="num-input resize-w" type="number" min="1" max="${HARD_MAX}" step="1" inputmode="numeric" value="${layer.width || ''}"></label>
        <label class="size-box"><span>Y</span><input class="num-input resize-h" type="number" min="1" max="${HARD_MAX}" step="1" inputmode="numeric" value="${layer.height || ''}"></label>
      </div>
      <div class="quality-row" role="group" aria-label="リサイズ品質">
        ${Object.entries(QUALITY_LABELS).map(([key,label])=>`<button class="quality-btn ${layer.quality===key?'on':''}" data-q="${key}">品質：${label}</button>`).join("")}
      </div>
      <div class="sr-out mono">${input && t ? `入力: ${input.w} × ${input.h} px / 出力: ${t.w} × ${t.h} px` : "画像を開くと解像度が表示されます"}</div>
    </div>`;
  }
  if(layer.type === "grayscale"){
    return `<div class="layer-body">
      ${sliderHTML(f, layer.value)}
      <div class="color-row">
        <label class="color-box"><span>暗部</span><input class="color-input low-color" type="color" value="${layer.lowColor || '#000000'}"></label>
        <label class="color-box"><span>明部</span><input class="color-input high-color" type="color" value="${layer.highColor || '#ffffff'}"></label>
      </div>
    </div>`;
  }
  if(layer.type === "bias"){
    return `<div class="layer-body">
      ${paramSliderHTML("補正量", "bias-amount", 0, 200, 1, layer.value, layer.value+"%")}
      ${paramSliderHTML("局所平均", "bias-size", 15, 301, 2, layer.size, layer.size+"px")}
      ${paramSliderHTML("オフセット", "bias-offset", -80, 80, 1, layer.offset, (layer.offset>0?"+":"")+layer.offset)}
      ${paramSliderHTML("偏差しきい値", "bias-threshold", 0, 80, 1, layer.threshold, layer.threshold)}
      <div class="mobile-note">文書写真の影消し用です。局所平均を大きくすると、広い影・照明ムラを補正しやすくなります。</div>
    </div>`;
  }
  if(layer.type === "tonecurve"){
    const ch = layer.channel || "rgb";
    const chBtns = [["rgb","RGB"],["r","R"],["g","G"],["b","B"]]
      .map(([k,lbl])=>`<button class="scale-btn tc-ch ${ch===k?'on':''}" data-ch="${k}">${lbl}</button>`).join("");
    return `<div class="layer-body">
      <div class="scale-row" role="group" aria-label="チャンネル">${chBtns}</div>
      <div class="tc-editor" style="margin-top:4px;touch-action:none;user-select:none">${toneCurveSVG(layer)}</div>
      <div class="quality-row" style="margin-top:8px">
        <button class="quality-btn tc-reset">この曲線をリセット</button>
      </div>
      <div class="mobile-note">クリックで制御点を追加、ドラッグで移動、ダブルクリックで削除。RGB＝全体、R/G/B＝各チャンネルを別々に編集できます。</div>
    </div>`;
  }
  if(layer.type === "mosaic"){
    const methods = [["mean","平均"],["median","中央値"],["mode","最頻値"]];
    return `<div class="layer-body">
      ${paramSliderHTML("ブロックサイズ","mos-size",2,128,1,layer.size,layer.size+"px")}
      ${paramSliderHTML("オフセットX","mos-ox",0,128,1,layer.offsetX,layer.offsetX+"px")}
      ${paramSliderHTML("オフセットY","mos-oy",0,128,1,layer.offsetY,layer.offsetY+"px")}
      <div class="quality-row" role="group" aria-label="集計方法">
        ${methods.map(([k,l])=>`<button class="quality-btn mos-method ${layer.method===k?'on':''}" data-m="${k}">${l}</button>`).join("")}
      </div>
    </div>`;
  }
  if(layer.type === "pixelart"){
    const input = sourceReady ? layerInputSize(layer) : null;
    if(input && (!layer.outW || !layer.outH)){
      const t = pixelartTarget(layer, input.w, input.h);
      layer.outW = t.w; layer.outH = t.h;
    }
    return `<div class="layer-body">
      <div class="resize-size-row">
        <label class="size-box"><span>X</span><input class="num-input pa-w" type="number" min="1" max="2048" step="1" inputmode="numeric" value="${layer.outW || ''}"></label>
        <label class="size-box"><span>Y</span><input class="num-input pa-h" type="number" min="1" max="2048" step="1" inputmode="numeric" value="${layer.outH || ''}"></label>
      </div>
      ${paramSliderHTML("色数","pa-colors",2,64,1,layer.colors,layer.colors+"色")}
      ${paramSliderHTML("メリハリ","pa-punch",0,100,1,layer.punch,layer.punch+"%")}
      <div class="quality-row" role="group" aria-label="ディザリング">
        <button class="quality-btn pa-dither ${layer.dither!==false?'on':''}" data-d="on">ディザあり</button>
        <button class="quality-btn pa-dither ${layer.dither===false?'on':''}" data-d="off">ディザなし</button>
      </div>
      <div class="sr-out mono">${input ? `入力: ${input.w} × ${input.h} px / 出力: ${layer.outW} × ${layer.outH} px` : "画像を開くと解像度が表示されます"}</div>
      <div class="mobile-note">縮小→メリハリ補正→適応パレット(メディアンカット)→ディザリング。出力は指定ピクセル数ちょうどです。</div>
    </div>`;
  }
  return `<div class="layer-body">${sliderHTML(f, layer.value)}</div>`;
}
function paramSliderHTML(label, cls, min, max, step, value, readout){
  return `<div class="param-row">
    <span class="mini-label">${label}</span>
    <input class="${cls}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}">
    <span class="val">${readout}</span>
  </div>`;
}
const TC_COLOR = { rgb:"#ECEEF2", r:"#ff6b6b", g:"#51cf66", b:"#5b8def" };
function curveOf(layer, ch){
  if(!layer.curves) layer.curves = {};
  if(!layer.curves[ch]) layer.curves[ch] = [{x:0,y:0},{x:255,y:255}];
  return layer.curves[ch];
}
function toneCurveSVG(layer){
  const ch = layer.channel || "rgb";
  const pts = curveOf(layer, ch);
  const color = TC_COLOR[ch];
  const lut = buildCurveLUT(pts);
  let path = "";
  for(let i=0;i<256;i++) path += (i===0?`M ${i} ${255-lut[i]}`:` L ${i} ${255-lut[i]}`);
  const grid = [64,128,192].map(g=>
    `<line x1="${g}" y1="0" x2="${g}" y2="255" stroke="rgba(255,255,255,.06)"/><line x1="0" y1="${g}" x2="255" y2="${g}" stroke="rgba(255,255,255,.06)"/>`).join("");
  const dots = pts.map((p,idx)=>`<circle class="tc-pt" data-i="${idx}" cx="${p.x}" cy="${255-p.y}" r="6" fill="${color}" stroke="#0B0C0F" stroke-width="2"/>`).join("");
  return `<svg class="tc-svg" viewBox="-8 -8 272 272" width="100%" style="display:block;background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:9px;aspect-ratio:1/1">
    <line x1="0" y1="255" x2="255" y2="0" stroke="rgba(255,255,255,.12)" stroke-dasharray="4 4"/>
    ${grid}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5"/>
    ${dots}
  </svg>`;
}

/* ---------- control wiring（フィルター固有のUI配線） ---------- */
function wireBody(card, layer){
  const f = FILTERS[layer.type];

  if(layer.type === "superres"){
    card.querySelectorAll(".scale-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        layer.scale = Number(btn.dataset.s);
        refreshResizeLayers();
        renderStack();
        scheduleRender();
      });
    });
    wireMainRange(card, layer, f);
    return;
  }

  if(layer.type === "resize"){
    card.querySelectorAll(".scale-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        updateResizeFromMode(layer, btn.dataset.mode);
        renderStack();
        scheduleRender();
      });
    });
    card.querySelectorAll(".quality-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        layer.quality = btn.dataset.q;
        renderStack();
        scheduleRender();
      });
    });
    const wInput = card.querySelector(".resize-w");
    const hInput = card.querySelector(".resize-h");
    const onSizeInput = ()=>{
      layer.mode = "custom";
      layer.width = clampInt(wInput.value, 1, HARD_MAX);
      layer.height = clampInt(hInput.value, 1, HARD_MAX);
      renderStack();
      scheduleRender();
    };
    wInput.addEventListener("change", onSizeInput);
    hInput.addEventListener("change", onSizeInput);
    wInput.addEventListener("input", ()=>{ layer.mode = "custom"; });
    hInput.addEventListener("input", ()=>{ layer.mode = "custom"; });
    return;
  }

  if(layer.type === "grayscale"){
    wireMainRange(card, layer, f);
    card.querySelector(".low-color").addEventListener("input", e=>{ layer.lowColor = e.target.value; scheduleRender(); });
    card.querySelector(".high-color").addEventListener("input", e=>{ layer.highColor = e.target.value; scheduleRender(); });
    return;
  }

  if(layer.type === "bias"){
    wireParam(card, ".bias-amount", layer, "value", v=>v+"%");
    wireParam(card, ".bias-size", layer, "size", v=>v+"px");
    wireParam(card, ".bias-offset", layer, "offset", v=>(v>0?"+":"")+v);
    wireParam(card, ".bias-threshold", layer, "threshold", v=>String(v));
    return;
  }
  if(layer.type === "tonecurve"){
    card.querySelectorAll(".tc-ch").forEach(btn=>{
      btn.addEventListener("click", ()=>{ layer.channel = btn.dataset.ch; renderStack(); scheduleRender(); });
    });
    const reset = card.querySelector(".tc-reset");
    if(reset) reset.addEventListener("click", ()=>{
      layer.curves[layer.channel||"rgb"] = [{x:0,y:0},{x:255,y:255}];
      renderStack(); scheduleRender();
    });
    const svg = card.querySelector(".tc-svg");
    if(svg) wireToneCurveSVG(svg, layer);
    return;
  }
  if(layer.type === "mosaic"){
    wireParam(card, ".mos-size", layer, "size", v=>v+"px");
    wireParam(card, ".mos-ox", layer, "offsetX", v=>v+"px");
    wireParam(card, ".mos-oy", layer, "offsetY", v=>v+"px");
    card.querySelectorAll(".mos-method").forEach(btn=>{
      btn.addEventListener("click", ()=>{ layer.method = btn.dataset.m; renderStack(); scheduleRender(); });
    });
    return;
  }
  if(layer.type === "pixelart"){
    const wIn = card.querySelector(".pa-w"), hIn = card.querySelector(".pa-h");
    const onSize = ()=>{
      layer.outW = clampInt(wIn.value, 1, 2048);
      layer.outH = clampInt(hIn.value, 1, 2048);
      renderStack(); scheduleRender();
    };
    wIn.addEventListener("change", onSize);
    hIn.addEventListener("change", onSize);
    wireParam(card, ".pa-colors", layer, "colors", v=>v+"色");
    wireParam(card, ".pa-punch", layer, "punch", v=>v+"%");
    card.querySelectorAll(".pa-dither").forEach(btn=>{
      btn.addEventListener("click", ()=>{ layer.dither = btn.dataset.d === "on"; renderStack(); scheduleRender(); });
    });
    return;
  }

  wireMainRange(card, layer, f);
}

function wireMainRange(card, layer, f){
  const range = card.querySelector(".main-range");
  const val = card.querySelector(".val");
  if(!range) return;
  range.addEventListener("input", ()=>{
    layer.value = Number(range.value);
    val.textContent = f.fmt(layer.value);
    val.classList.toggle("neutral", layer.value===f.neutral);
    scheduleRender();
  });
}
function wireParam(card, selector, layer, prop, fmt){
  const input = card.querySelector(selector);
  const val = input && input.parentElement.querySelector(".val");
  if(!input) return;
  input.addEventListener("input", ()=>{
    layer[prop] = Number(input.value);
    if(val) val.textContent = fmt(layer[prop]);
    scheduleRender();
  });
}
function wireToneCurveSVG(svg, layer){
  let dragIdx = -1;
  const toSVG = e=>{
    const rect = svg.getBoundingClientRect();
    const vx = -8 + (e.clientX - rect.left)/rect.width * 272;
    const vy = -8 + (e.clientY - rect.top)/rect.height * 272;
    return { x: Math.max(0,Math.min(255,vx)), y: Math.max(0,Math.min(255, 255 - vy)) };
  };
  const redraw = ()=>{
    const ch = layer.channel || "rgb";
    const pts = curveOf(layer, ch);
    const lut = buildCurveLUT(pts);
    let path = "";
    for(let i=0;i<256;i++) path += (i===0?`M ${i} ${255-lut[i]}`:` L ${i} ${255-lut[i]}`);
    svg.querySelector("path").setAttribute("d", path);
    [...svg.querySelectorAll(".tc-pt")].forEach(n=>n.remove());
    const color = TC_COLOR[ch];
    pts.forEach((p,idx)=>{
      const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
      c.setAttribute("class","tc-pt"); c.setAttribute("data-i",idx);
      c.setAttribute("cx",p.x); c.setAttribute("cy",255-p.y); c.setAttribute("r",6);
      c.setAttribute("fill",color); c.setAttribute("stroke","#0B0C0F"); c.setAttribute("stroke-width",2);
      svg.appendChild(c);
    });
  };
  svg.addEventListener("pointerdown", e=>{
    e.preventDefault();
    const pts = curveOf(layer, layer.channel || "rgb");
    const p = toSVG(e);
    let hit=-1, best=14*14;
    for(let i=0;i<pts.length;i++){ const dx=pts[i].x-p.x, dy=pts[i].y-p.y, dd=dx*dx+dy*dy; if(dd<best){best=dd;hit=i;} }
    if(hit===-1){
      const np = { x:Math.round(p.x), y:Math.round(p.y) };
      pts.push(np); pts.sort((a,b)=>a.x-b.x); hit = pts.indexOf(np);
    }
    dragIdx = hit;
    try{ svg.setPointerCapture(e.pointerId); }catch(_){}
    redraw(); scheduleRender();
  });
  svg.addEventListener("pointermove", e=>{
    if(dragIdx<0) return;
    e.preventDefault();
    const pts = curveOf(layer, layer.channel || "rgb");
    const p = toSVG(e);
    let nx = Math.round(p.x);
    if(dragIdx===0) nx = 0;
    else if(dragIdx===pts.length-1) nx = 255;
    else nx = Math.max(pts[dragIdx-1].x+1, Math.min(pts[dragIdx+1].x-1, nx));
    pts[dragIdx] = { x:nx, y:Math.round(p.y) };
    redraw(); scheduleRender();
  });
  const end = e=>{ if(dragIdx>=0){ try{ svg.releasePointerCapture(e.pointerId); }catch(_){} } dragIdx=-1; };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", e=>{
    e.preventDefault();
    const pts = curveOf(layer, layer.channel || "rgb");
    if(pts.length<=2) return;
    const p = toSVG(e);
    let hit=-1, best=16*16;
    for(let i=0;i<pts.length;i++){ const dx=pts[i].x-p.x, dy=pts[i].y-p.y, dd=dx*dx+dy*dy; if(dd<best){best=dd;hit=i;} }
    if(hit>0 && hit<pts.length-1){ pts.splice(hit,1); redraw(); scheduleRender(); }
  });
}

/* ---------- image processing pipeline ----------
   mode="preview": 表示用。各段を PREVIEW_MAX で抑え、巨大な中間キャンバスを作らない。
   mode="export" : 書き出し用。実寸のまま処理し、上限を設けない（失敗時は app 側で通知）。 */
function renderPipeline(showOriginal=false, mode="preview"){
  const cap = mode === "export" ? Infinity : PREVIEW_MAX;
  let cur = getBaseCanvas(mode);
  if(showOriginal) return cur;

  for(const layer of layers){
    if(!layer.enabled) continue;
    switch(layer.type){
      case "superres": cur = applySuperResolution(cur, layer, mode); break;
      case "resize": cur = applyResize(cur, layer, mode); break;
      case "tonecurve": cur = applyToneCurve(cur, layer); break;
      case "mosaic": cur = applyMosaic(cur, layer); break;
      case "pixelart": cur = applyPixelArt(cur, layer, mode); break;
      case "blur": cur = applyBlur(cur, layer.value); break;
      case "bias": cur = applyBiasCorrection(cur, layer); break;
      case "quantize": cur = applyQuantize(cur, layer.value); break;
      default: cur = applyPixelFilter(cur, layer); break;
    }
    cur = pixelLimitCanvas(cur, cap);
  }
  return cur;
}

function applyResize(src, layer, mode="preview"){
  // 出力サイズは常に「実寸」で決め、プレビューのときだけ PREVIEW_MAX に収める。
  const trueIn = layerInputSize(layer);
  const t = resizeTarget(layer, trueIn.w, trueIn.h);
  let w = t.w, h = t.h;
  if(mode !== "export"){ const c = capDim(w, h, PREVIEW_MAX); w = c.w; h = c.h; }
  return drawImageToCanvas(src, w, h, layer.quality || "medium");
}

function applySuperResolution(src, layer, mode="preview"){
  const trueIn = layerInputSize(layer);
  const tt = scaleTarget(trueIn.w, trueIn.h, layer.scale || 1);
  let targetW = tt.w, targetH = tt.h;
  if(mode !== "export"){ const c = capDim(targetW, targetH, PREVIEW_MAX); targetW = c.w; targetH = c.h; }

  let cur = src;
  let cw = src.width, ch = src.height;
  while(cw * 2 <= targetW && ch * 2 <= targetH){
    cur = drawImageToCanvas(cur, cw*2, ch*2, "high");
    cw = cur.width; ch = cur.height;
  }
  cur = drawImageToCanvas(cur, targetW, targetH, "high");
  if((layer.value || 0) > 0.5) cur = applySharpen(cur, (layer.value/100) * 1.1);
  return cur;
}

function applyPixelFilter(src, layer){
  const f = FILTERS[layer.type];
  if(!f || Number(layer.value) === f.neutral) return copyCanvas(src);

  const c = copyCanvas(src);
  const x = c.getContext("2d", { willReadFrequently:true });
  const imgData = x.getImageData(0,0,c.width,c.height);
  const d = imgData.data;
  const v = Number(layer.value);
  const type = layer.type;
  const low = type === "grayscale" ? hexToRgb(layer.lowColor || "#000000") : null;
  const high = type === "grayscale" ? hexToRgb(layer.highColor || "#ffffff") : null;
  const hueRad = type === "hue" ? v * Math.PI / 180 : 0;
  const cosH = Math.cos(hueRad), sinH = Math.sin(hueRad);

  for(let i=0;i<d.length;i+=4){
    let r=d[i], g=d[i+1], b=d[i+2], a=d[i+3];
    if(type === "brightness"){
      const m = v/100; r*=m; g*=m; b*=m;
    } else if(type === "contrast"){
      const m = v/100; r=(r-128)*m+128; g=(g-128)*m+128; b=(b-128)*m+128;
    } else if(type === "opacity"){
      a *= v/100;
    } else if(type === "saturate"){
      const m = v/100, lum = 0.2126*r + 0.7152*g + 0.0722*b;
      r = lum + (r-lum)*m; g = lum + (g-lum)*m; b = lum + (b-lum)*m;
    } else if(type === "hue"){
      // CSS hue-rotate に近い輝度保持の回転行列
      const nr = (0.213 + cosH*0.787 - sinH*0.213)*r + (0.715 - cosH*0.715 - sinH*0.715)*g + (0.072 - cosH*0.072 + sinH*0.928)*b;
      const ng = (0.213 - cosH*0.213 + sinH*0.143)*r + (0.715 + cosH*0.285 + sinH*0.140)*g + (0.072 - cosH*0.072 - sinH*0.283)*b;
      const nb = (0.213 - cosH*0.213 - sinH*0.787)*r + (0.715 - cosH*0.715 + sinH*0.715)*g + (0.072 + cosH*0.928 + sinH*0.072)*b;
      r=nr; g=ng; b=nb;
    } else if(type === "sepia"){
      const m = v/100;
      const nr = r*0.393 + g*0.769 + b*0.189;
      const ng = r*0.349 + g*0.686 + b*0.168;
      const nb = r*0.272 + g*0.534 + b*0.131;
      r = r*(1-m) + nr*m; g = g*(1-m) + ng*m; b = b*(1-m) + nb*m;
    } else if(type === "grayscale"){
      const m = v/100;
      const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
      const tr = low[0]*(1-lum) + high[0]*lum;
      const tg = low[1]*(1-lum) + high[1]*lum;
      const tb = low[2]*(1-lum) + high[2]*lum;
      r = r*(1-m) + tr*m; g = g*(1-m) + tg*m; b = b*(1-m) + tb*m;
    } else if(type === "invert"){
      const m = v/100;
      r = r*(1-m) + (255-r)*m; g = g*(1-m) + (255-g)*m; b = b*(1-m) + (255-b)*m;
    } else if(type === "binarize"){
      const lum = 0.2126*r + 0.7152*g + 0.0722*b;
      const bw = lum >= v ? 255 : 0;
      r = g = b = bw;
    }
    d[i]=clamp(r); d[i+1]=clamp(g); d[i+2]=clamp(b); d[i+3]=clamp(a);
  }
  x.putImageData(imgData,0,0);
  return c;
}

function applyQuantize(src, colors){
  colors = clampInt(colors, 2, 256);
  if(colors >= 256) return copyCanvas(src);
  const c = copyCanvas(src);
  const x = c.getContext("2d", { willReadFrequently:true });
  const imgData = x.getImageData(0,0,c.width,c.height);
  const d = imgData.data;

  // 軽量化優先: k-means ではなく、指定色数に近いチャンネル段階数へ高速量子化する。
  // スマホでも操作中に止まりにくく、写真/イラストの両方で破綻しにくい。
  const levels = Math.max(2, Math.round(Math.cbrt(colors)));
  const step = 255 / (levels - 1);
  for(let i=0;i<d.length;i+=4){
    d[i]   = Math.round(d[i]   / step) * step;
    d[i+1] = Math.round(d[i+1] / step) * step;
    d[i+2] = Math.round(d[i+2] / step) * step;
  }
  x.putImageData(imgData,0,0);
  return c;
}

function applySharpen(src, amount){
  if(amount <= 0.001) return copyCanvas(src);
  const c = copyCanvas(src);
  const x = c.getContext("2d", { willReadFrequently:true });
  const w=c.width, h=c.height;
  const imgData = x.getImageData(0,0,w,h);
  const srcData = new Uint8ClampedArray(imgData.data);
  const d = imgData.data;
  const center = 1 + 4*amount;
  const side = -amount;

  for(let y=0;y<h;y++){
    const ym = Math.max(0,y-1), yp = Math.min(h-1,y+1);
    for(let x0=0;x0<w;x0++){
      const xm = Math.max(0,x0-1), xp = Math.min(w-1,x0+1);
      const i = (y*w+x0)*4;
      const il = (y*w+xm)*4, ir=(y*w+xp)*4, iu=(ym*w+x0)*4, id=(yp*w+x0)*4;
      for(let ch=0; ch<3; ch++){
        d[i+ch] = clamp(srcData[i+ch]*center + (srcData[il+ch]+srcData[ir+ch]+srcData[iu+ch]+srcData[id+ch])*side);
      }
    }
  }
  x.putImageData(imgData,0,0);
  return c;
}

function applyBlur(src, radius){
  radius = Math.round(Number(radius));
  if(radius <= 0) return copyCanvas(src);
  const c = copyCanvas(src);
  const x = c.getContext("2d", { willReadFrequently:true });
  const w=c.width, h=c.height;
  const imgData = x.getImageData(0,0,w,h);
  const srcData = imgData.data;
  const tmp = new Uint8ClampedArray(srcData.length);
  const out = imgData.data;
  const div = radius*2 + 1;

  // horizontal pass
  for(let y=0;y<h;y++){
    let sr=0, sg=0, sb=0, sa=0;
    for(let ix=-radius; ix<=radius; ix++){
      const px = Math.min(w-1, Math.max(0, ix));
      const i = (y*w+px)*4;
      sr+=srcData[i]; sg+=srcData[i+1]; sb+=srcData[i+2]; sa+=srcData[i+3];
    }
    for(let x0=0;x0<w;x0++){
      const i = (y*w+x0)*4;
      tmp[i]=sr/div; tmp[i+1]=sg/div; tmp[i+2]=sb/div; tmp[i+3]=sa/div;
      const removeX = Math.max(0, x0-radius);
      const addX = Math.min(w-1, x0+radius+1);
      const ri=(y*w+removeX)*4, ai=(y*w+addX)*4;
      sr += srcData[ai]-srcData[ri]; sg += srcData[ai+1]-srcData[ri+1]; sb += srcData[ai+2]-srcData[ri+2]; sa += srcData[ai+3]-srcData[ri+3];
    }
  }
  // vertical pass
  for(let x0=0;x0<w;x0++){
    let sr=0, sg=0, sb=0, sa=0;
    for(let iy=-radius; iy<=radius; iy++){
      const py = Math.min(h-1, Math.max(0, iy));
      const i = (py*w+x0)*4;
      sr+=tmp[i]; sg+=tmp[i+1]; sb+=tmp[i+2]; sa+=tmp[i+3];
    }
    for(let y=0;y<h;y++){
      const i = (y*w+x0)*4;
      out[i]=sr/div; out[i+1]=sg/div; out[i+2]=sb/div; out[i+3]=sa/div;
      const removeY = Math.max(0, y-radius);
      const addY = Math.min(h-1, y+radius+1);
      const ri=(removeY*w+x0)*4, ai=(addY*w+x0)*4;
      sr += tmp[ai]-tmp[ri]; sg += tmp[ai+1]-tmp[ri+1]; sb += tmp[ai+2]-tmp[ri+2]; sa += tmp[ai+3]-tmp[ri+3];
    }
  }
  x.putImageData(imgData,0,0);
  return c;
}

function applyBiasCorrection(src, layer){
  const amount = (layer.value || 0) / 100;
  if(amount <= 0) return copyCanvas(src);
  const c = copyCanvas(src);
  const x = c.getContext("2d", { willReadFrequently:true });
  const w=c.width, h=c.height;
  const imgData = x.getImageData(0,0,w,h);
  const d = imgData.data;
  const iw = w + 1;
  const integral = new Float32Array((w+1)*(h+1));
  let global = 0;

  for(let y=1;y<=h;y++){
    let row = 0;
    for(let xx=1;xx<=w;xx++){
      const i = ((y-1)*w + (xx-1))*4;
      const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
      row += lum;
      global += lum;
      integral[y*iw + xx] = integral[(y-1)*iw + xx] + row;
    }
  }
  global /= (w*h || 1);
  const radius = Math.max(1, Math.round((layer.size || 121)/2));
  const offset = Number(layer.offset || 0);
  const threshold = Number(layer.threshold || 0);
  const target = global + offset;

  for(let y=0;y<h;y++){
    const y1 = Math.max(0, y-radius), y2 = Math.min(h-1, y+radius);
    for(let xx=0;xx<w;xx++){
      const x1 = Math.max(0, xx-radius), x2 = Math.min(w-1, xx+radius);
      const area = (x2-x1+1) * (y2-y1+1);
      const sum = integral[(y2+1)*iw + (x2+1)] - integral[y1*iw + (x2+1)] - integral[(y2+1)*iw + x1] + integral[y1*iw + x1];
      const local = sum / area;
      const deviation = local - global;
      if(Math.abs(deviation) < threshold) continue;
      const delta = (target - local) * amount;
      const i = (y*w+xx)*4;
      d[i] = clamp(d[i] + delta);
      d[i+1] = clamp(d[i+1] + delta);
      d[i+2] = clamp(d[i+2] + delta);
    }
  }
  x.putImageData(imgData,0,0);
  return c;
}

/* ---------- tone curve ---------- */
function buildCurveLUT(points){
  const pts = points.slice().sort((a,b)=>a.x-b.x);
  const n = pts.length;
  const lut = new Uint8ClampedArray(256);
  if(n === 1){ lut.fill(clamp(pts[0].y)); return lut; }
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
  const dx=[], slope=[];
  for(let i=0;i<n-1;i++){ dx[i]=xs[i+1]-xs[i]; slope[i]= dx[i]===0?0:(ys[i+1]-ys[i])/dx[i]; }
  const m = new Array(n);
  m[0]=slope[0]; m[n-1]=slope[n-2];
  for(let i=1;i<n-1;i++) m[i] = slope[i-1]*slope[i]<=0 ? 0 : (slope[i-1]+slope[i])/2;
  for(let i=0;i<n-1;i++){
    if(slope[i]===0){ m[i]=0; m[i+1]=0; continue; }
    const a=m[i]/slope[i], b=m[i+1]/slope[i], hyp=a*a+b*b;
    if(hyp>9){ const t=3/Math.sqrt(hyp); m[i]=t*a*slope[i]; m[i+1]=t*b*slope[i]; }
  }
  let seg=0;
  for(let xi=0;xi<256;xi++){
    if(xi<=xs[0]){ lut[xi]=clamp(ys[0]); continue; }
    if(xi>=xs[n-1]){ lut[xi]=clamp(ys[n-1]); continue; }
    while(seg<n-2 && xi>xs[seg+1]) seg++;
    const h=dx[seg], t=(xi-xs[seg])/h, t2=t*t, t3=t2*t;
    const y = (2*t3-3*t2+1)*ys[seg] + (t3-2*t2+t)*h*m[seg] + (-2*t3+3*t2)*ys[seg+1] + (t3-t2)*h*m[seg+1];
    lut[xi]=clamp(y);
  }
  return lut;
}
function applyToneCurve(src, layer){
  const cu = layer.curves || {};
  const idy = p => !p || (p.length===2 && p[0].x===0 && p[0].y===0 && p[1].x===255 && p[1].y===255);
  if(idy(cu.rgb)&&idy(cu.r)&&idy(cu.g)&&idy(cu.b)) return copyCanvas(src);
  const I = [{x:0,y:0},{x:255,y:255}];
  const Lc=buildCurveLUT(cu.rgb||I), Lr=buildCurveLUT(cu.r||I), Lg=buildCurveLUT(cu.g||I), Lb=buildCurveLUT(cu.b||I);
  const c = copyCanvas(src);
  const x = c.getContext("2d",{willReadFrequently:true});
  const im = x.getImageData(0,0,c.width,c.height), d = im.data;
  for(let i=0;i<d.length;i+=4){
    d[i]=Lr[Lc[d[i]]]; d[i+1]=Lg[Lc[d[i+1]]]; d[i+2]=Lb[Lc[d[i+2]]];
  }
  x.putImageData(im,0,0);
  return c;
}

/* ---------- mosaic ---------- */
function histMedian(h, half){ let c=0; for(let v=0;v<256;v++){ c+=h[v]; if(c>half) return v; } return 255; }
function histMode(h){ let bv=0,bc=-1; for(let v=0;v<256;v++) if(h[v]>bc){bc=h[v];bv=v;} return bv; }
function applyMosaic(src, layer){
  const size = clampInt(layer.size||16, 1, 1024);
  if(size<=1) return copyCanvas(src);
  const ox = ((Math.round(layer.offsetX||0)%size)+size)%size;
  const oy = ((Math.round(layer.offsetY||0)%size)+size)%size;
  const method = layer.method || "mean";
  const c = copyCanvas(src);
  const x = c.getContext("2d",{willReadFrequently:true});
  const w=c.width, h=c.height, im=x.getImageData(0,0,w,h), d=im.data;
  const hr=new Int32Array(256), hg=new Int32Array(256), hb=new Int32Array(256);
  const useHist = method!=="mean";
  for(let by=oy-size; by<h; by+=size){
    const y0=Math.max(0,by), y1=Math.min(h,by+size); if(y1<=y0) continue;
    for(let bx=ox-size; bx<w; bx+=size){
      const x0=Math.max(0,bx), x1=Math.min(w,bx+size); if(x1<=x0) continue;
      let rr=0,gg=0,bb=0,aa=0,n=0;
      if(useHist){ hr.fill(0); hg.fill(0); hb.fill(0); }
      for(let yy=y0; yy<y1; yy++){
        let i=(yy*w+x0)*4;
        for(let xx=x0; xx<x1; xx++, i+=4){
          aa+=d[i+3]; n++;
          if(useHist){ hr[d[i]]++; hg[d[i+1]]++; hb[d[i+2]]++; }
          else { rr+=d[i]; gg+=d[i+1]; bb+=d[i+2]; }
        }
      }
      let R,G,B; const A=aa/n;
      if(method==="mean"){ R=rr/n; G=gg/n; B=bb/n; }
      else if(method==="median"){ const hf=n>>1; R=histMedian(hr,hf); G=histMedian(hg,hf); B=histMedian(hb,hf); }
      else { R=histMode(hr); G=histMode(hg); B=histMode(hb); }
      for(let yy=y0; yy<y1; yy++){
        let i=(yy*w+x0)*4;
        for(let xx=x0; xx<x1; xx++, i+=4){ d[i]=R; d[i+1]=G; d[i+2]=B; d[i+3]=A; }
      }
    }
  }
  x.putImageData(im,0,0);
  return c;
}

/* ---------- pixel art（縮小＋適応パレット＋ディザ） ---------- */
function medianCutPalette(pixels, n){
  let boxes = [pixels];
  while(boxes.length < n){
    let bi=-1, bestRange=-1, bestCh=0;
    for(let i=0;i<boxes.length;i++){
      const box=boxes[i]; if(box.length<2) continue;
      const mn=[255,255,255], mx=[0,0,0];
      for(const p of box) for(let ch=0;ch<3;ch++){ if(p[ch]<mn[ch])mn[ch]=p[ch]; if(p[ch]>mx[ch])mx[ch]=p[ch]; }
      for(let ch=0;ch<3;ch++){ const r=mx[ch]-mn[ch]; if(r>bestRange){ bestRange=r; bi=i; bestCh=ch; } }
    }
    if(bi<0) break;
    const box=boxes[bi]; box.sort((a,b)=>a[bestCh]-b[bestCh]);
    const mid=box.length>>1;
    boxes.splice(bi,1,box.slice(0,mid),box.slice(mid));
  }
  return boxes.map(box=>{
    let r=0,g=0,b=0; for(const p of box){ r+=p[0]; g+=p[1]; b+=p[2]; }
    const k=box.length||1; return [Math.round(r/k),Math.round(g/k),Math.round(b/k)];
  });
}
function applyPixelArt(src, layer){
  const trueIn = layerInputSize(layer);
  const t = pixelartTarget(layer, trueIn.w, trueIn.h);
  const outW=t.w, outH=t.h;
  const small = drawImageToCanvas(src, outW, outH, "high");
  const x = small.getContext("2d",{willReadFrequently:true});
  const id = x.getImageData(0,0,outW,outH), d = id.data;

  const punch = (layer.punch ?? 30)/100;
  if(punch>0){
    const cM=1+punch*0.6, sM=1+punch*0.8;
    for(let i=0;i<d.length;i+=4){
      let r=(d[i]-128)*cM+128, g=(d[i+1]-128)*cM+128, b=(d[i+2]-128)*cM+128;
      const lum=0.2126*r+0.7152*g+0.0722*b;
      d[i]=clamp(lum+(r-lum)*sM); d[i+1]=clamp(lum+(g-lum)*sM); d[i+2]=clamp(lum+(b-lum)*sM);
    }
  }

  const colors = clampInt(layer.colors||16, 2, 64);
  const sample=[];
  for(let i=0;i<d.length;i+=4) if(d[i+3]>8) sample.push([d[i],d[i+1],d[i+2]]);
  const palette = sample.length ? medianCutPalette(sample, colors) : [[0,0,0]];

  const dither = layer.dither !== false;
  const bayer = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  const amt = dither ? Math.max(8, 255/colors) : 0;
  for(let y=0;y<outH;y++){
    for(let xx=0;xx<outW;xx++){
      const i=(y*outW+xx)*4;
      const o = dither ? (bayer[(y&3)*4+(xx&3)]/16 - 0.5)*amt : 0;
      const r=d[i]+o, g=d[i+1]+o, b=d[i+2]+o;
      let best=0, bd=Infinity;
      for(let p=0;p<palette.length;p++){
        const dr=palette[p][0]-r, dg=palette[p][1]-g, db=palette[p][2]-b, dd=dr*dr+dg*dg+db*db;
        if(dd<bd){ bd=dd; best=p; }
      }
      d[i]=palette[best][0]; d[i+1]=palette[best][1]; d[i+2]=palette[best][2];
    }
  }
  x.putImageData(id,0,0);
  return small;
}

let pendingRender = false;

/* ---------- アプリ表示用JS(app.js)へ公開する窓口 ---------- */
window.PRISM_FILTERS = {
  CATS, RESIZE_SCALES, QUALITY_LABELS, FILTERS,
  makeLayer,
  onLayerAdded,
  layerInputSize,
  outputDimensions,
  scaleTarget,
  resizeTarget,
  updateResizeFromMode,
  refreshResizeLayers,
  layerBodyHTML,
  wireBody,
  renderPipeline,
};
