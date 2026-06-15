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
  saturate:  { name:"彩度",         cat:"color",   min:0,  max:300, step:1,   def:100, neutral:100, fmt:v=>v+"%" },
  hue:       { name:"色相",         cat:"color",   min:-180,max:180,step:1,   def:0,   neutral:0,   fmt:v=>(v>0?"+":"")+v+"\u00b0" },
  sepia:     { name:"セピア",       cat:"color",   min:0,  max:100, step:1,   def:80,  neutral:0,   fmt:v=>v+"%" },
  grayscale: { name:"グレースケール", cat:"color", min:0,  max:100, step:1,   def:100, neutral:0,   fmt:v=>v+"%" },
  quantize:  { name:"減色",         cat:"color",   min:2,  max:256, step:1,   def:32,  neutral:256, fmt:v=>v+"色", special:true },
  blur:      { name:"ぼかし",       cat:"focus",   min:0,  max:40,  step:0.5, def:6,   neutral:0,   fmt:v=>v+"px" },
  superres:  { name:"超解像",       cat:"res",     min:0,  max:100, step:1,   def:55,  neutral:0,   fmt:v=>v+"%", special:true, scales:[1.5,2,3,4], defScale:2, resolution:true, unique:true },
  resize:    { name:"リサイズ",     cat:"res",     special:true, resolution:true },
  invert:    { name:"色反転",       cat:"stylize", min:0,  max:100, step:1,   def:100, neutral:0,   fmt:v=>v+"%" },
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
  return layer;
}

/* ---------- add-layer hook（レイヤー追加直後のフィルター固有の初期化） ---------- */
function onLayerAdded(layer){
  if(layer.type === "resize" && sourceReady) updateResizeFromMode(layer, "1");
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
    }
  }
  return size;
}
function scaleTarget(w,h,scale){
  const longest = Math.max(w,h) || 1;
  let s = scale, clamped = false;
  if(longest * s > MAX_OUT){
    s = Math.max(1 / longest, MAX_OUT / longest);
    clamped = true;
  }
  return { w:Math.max(1, Math.round(w*s)), h:Math.max(1, Math.round(h*s)), s, clamped };
}
function resizeTarget(layer, inputW, inputH){
  if(layer.mode !== "custom"){
    const def = RESIZE_SCALES.find(x=>x.key === layer.mode) || RESIZE_SCALES[1];
    const t = scaleTarget(inputW, inputH, def.factor || 1);
    return { w:t.w, h:t.h, clamped:t.clamped };
  }
  const w = clampInt(layer.width || inputW, 1, MAX_OUT);
  const h = clampInt(layer.height || inputH, 1, MAX_OUT);
  return { w, h, clamped:false };
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
        ? `出力解像度: ${t.w} × ${t.h} px${t.clamped ? "(上限 "+MAX_OUT+"px に調整)" : ""}`
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
        <label class="size-box"><span>X</span><input class="num-input resize-w" type="number" min="1" max="${MAX_OUT}" step="1" inputmode="numeric" value="${layer.width || ''}"></label>
        <label class="size-box"><span>Y</span><input class="num-input resize-h" type="number" min="1" max="${MAX_OUT}" step="1" inputmode="numeric" value="${layer.height || ''}"></label>
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
  return `<div class="layer-body">${sliderHTML(f, layer.value)}</div>`;
}
function paramSliderHTML(label, cls, min, max, step, value, readout){
  return `<div class="param-row">
    <span class="mini-label">${label}</span>
    <input class="${cls}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}">
    <span class="val">${readout}</span>
  </div>`;
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
      layer.width = clampInt(wInput.value, 1, MAX_OUT);
      layer.height = clampInt(hInput.value, 1, MAX_OUT);
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

/* ---------- image processing pipeline ---------- */
function renderPipeline(showOriginal=false){
  let cur = getBaseCanvas();
  if(showOriginal) return cur;

  for(const layer of layers){
    if(!layer.enabled) continue;
    switch(layer.type){
      case "superres": cur = applySuperResolution(cur, layer); break;
      case "resize": cur = applyResize(cur, layer); break;
      case "blur": cur = applyBlur(cur, layer.value); break;
      case "bias": cur = applyBiasCorrection(cur, layer); break;
      case "quantize": cur = applyQuantize(cur, layer.value); break;
      default: cur = applyPixelFilter(cur, layer); break;
    }
    cur = pixelLimitCanvas(cur);
  }
  return cur;
}

function applyResize(src, layer){
  const t = resizeTarget(layer, src.width, src.height);
  if(t.clamped) toast(`リサイズ後の最大辺を ${MAX_OUT}px に調整しました`);
  return drawImageToCanvas(src, t.w, t.h, layer.quality || "medium");
}

function applySuperResolution(src, layer){
  const t = scaleTarget(src.width, src.height, layer.scale || 1);
  if(t.clamped) toast(`超解像の最大辺を ${MAX_OUT}px に調整しました`);

  let cur = src;
  let cw = src.width, ch = src.height;
  while(cw * 2 <= t.w && ch * 2 <= t.h){
    cur = drawImageToCanvas(cur, cw*2, ch*2, "high");
    cw = cur.width; ch = cur.height;
  }
  cur = drawImageToCanvas(cur, t.w, t.h, "high");
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

let pendingRender = false;

/* ---------- アプリ表示用JS(app.js)へ公開する窓口 ---------- */
window.PRISM_FILTERS = {
  CATS, RESIZE_SCALES, QUALITY_LABELS, FILTERS,
  makeLayer,
  onLayerAdded,
  layerInputSize,
  scaleTarget,
  resizeTarget,
  updateResizeFromMode,
  refreshResizeLayers,
  layerBodyHTML,
  wireBody,
  renderPipeline,
};
