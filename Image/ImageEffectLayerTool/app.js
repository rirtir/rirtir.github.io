"use strict";

/*
  PRISM — アプリ表示用JS (app.js)
  --------------------------------------------------------------
  アプリを構築するうえで必要不可欠な土台です。画像の読み込み・キャンバス表示・
  レイヤースタックの枠組み・並べ替え・ズーム/パン・比較・書き出し・トーストなど、
  「フィルターそのもの」以外の全機能を担当します。

  フィルター機能は filters.js（フィルター用JS）が公開する window.PRISM_FILTERS
  経由でのみ呼び出します。そのため filters.js が読み込まれていない状態でも、
  土台（空状態の表示・画像の読み込み・等倍プレビュー・書き出し）は動作します。

  読み込み順序: <script src="filters.js"> → <script src="app.js"> の順。
*/

/* ---------- runtime guards ---------- */
const IS_COARSE = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const MAX_SIDE = IS_COARSE ? 1600 : 2000;    // 通常プレビューの最大辺
const MAX_OUT  = IS_COARSE ? 3500 : 6000;    // 解像度系フィルタ後の最大辺
const MAX_PIXELS_NOTICE = IS_COARSE ? 9000000 : 18000000;

window.addEventListener("error", e=>{
  toast("JSエラー: " + (e.message || "不明なエラー"));
});
window.addEventListener("unhandledrejection", e=>{
  const msg = e.reason && (e.reason.message || e.reason.toString()) || "不明なエラー";
  toast("処理エラー: " + msg);
});

/* ---------- state ---------- */
let layers = [];
let nextId = 1;
let sourceReady = false;
let imgGen = 0;
const img = new Image();

/* ---------- elements ---------- */
const $ = id => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently:true });
const stage = $("stage");
const empty = $("empty");
const canvasWrap = $("canvasWrap");
const stackList = $("stackList");
const stackCount = $("stackCount");
const stageTag = $("stageTag");
const stageUI = $("stageUI");
const zoomTag = $("zoomTag");
const compareFlag = $("compareFlag");
const fileInput = $("fileInput");

/* ---------- small utilities ---------- */
function clamp(v, min=0, max=255){ return v < min ? min : (v > max ? max : v); }
function clampInt(v, min=1, max=MAX_OUT){
  v = Math.round(Number(v));
  if(!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function createCanvas(w,h){
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function drawImageToCanvas(src, w, h, quality="high"){
  const c = createCanvas(w,h);
  const x = c.getContext("2d", { willReadFrequently:true });
  x.imageSmoothingEnabled = quality !== "low";
  x.imageSmoothingQuality = quality === "high" ? "high" : "medium";
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function copyCanvas(src){ return drawImageToCanvas(src, src.width, src.height, "high"); }
function hexToRgb(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if(!m) return [0,0,0];
  const n = parseInt(m[1],16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function pixelLimitCanvas(src){
  const longest = Math.max(src.width, src.height);
  if(longest <= MAX_OUT) return src;
  const s = MAX_OUT / longest;
  toast(`出力が上限 ${MAX_OUT}px を超えるため自動調整しました`);
  return drawImageToCanvas(src, Math.round(src.width*s), Math.round(src.height*s), "high");
}
function stagePoint(clientX, clientY){
  const rect = stage.getBoundingClientRect();
  return { x: clientX - rect.left - rect.width/2, y: clientY - rect.top - rect.height/2 };
}
function distance(a,b){ return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); }
function midpoint(a,b){ return { clientX:(a.clientX+b.clientX)/2, clientY:(a.clientY+b.clientY)/2 }; }

/* ---------- add-layer UI（フィルター一覧は filters.js から取得） ---------- */
function buildAddGrid(){
  const fm = window.PRISM_FILTERS;
  const grid = $("addGrid");
  if(!fm) return;                       // フィルター用JSが無い場合は空のまま
  Object.entries(fm.CATS).forEach(([catKey, cat])=>{
    const wrap = document.createElement("div");
    wrap.className = "add-cat";
    wrap.innerHTML = `<div class="cat-label"><span class="cat-dot" style="background:${cat.color}"></span>${cat.label}</div>`;
    const chips = document.createElement("div");
    chips.className = "chips";
    Object.entries(fm.FILTERS).filter(([,f])=>f.cat===catKey).forEach(([type,f])=>{
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.style.setProperty("--cat", cat.color);
      chip.textContent = f.name;
      chip.addEventListener("click", ()=>addLayer(type));
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    grid.appendChild(wrap);
  });
}

/* ---------- layer ops ---------- */
function addLayer(type){
  const fm = window.PRISM_FILTERS;
  if(!fm) return;
  const f = fm.FILTERS[type];
  if(!f) return;
  if(f.unique && layers.some(l=>l.type===type)){
    toast(`${f.name}レイヤーは 1 つだけ追加できます`);
    return;
  }
  const layer = fm.makeLayer(type);
  layer.id = nextId++;
  layers.push(layer);
  if(fm.onLayerAdded) fm.onLayerAdded(layer);
  renderStack();
  scheduleRender();
  requestAnimationFrame(()=>{ stackList.scrollTop = stackList.scrollHeight; });
  if(!sourceReady) toast("画像を開くと結果が表示されます");
}

function removeLayer(id){
  layers = layers.filter(l=>l.id!==id);
  renderStack(); scheduleRender();
}
function toggleLayer(id){
  const l = layers.find(l=>l.id===id);
  if(l){ l.enabled = !l.enabled; renderStack(); scheduleRender(); }
}
function clearAll(){
  if(!layers.length) return;
  layers = []; renderStack(); scheduleRender();
}

/* ---------- base dimensions（プレビューの基準サイズ） ---------- */
function baseDimensions(){
  if(!sourceReady) return { w:0, h:0 };
  let w = img.naturalWidth, h = img.naturalHeight;
  const fm = window.PRISM_FILTERS;
  const hasResolutionLayer = !!fm && layers.some(l=>l.enabled && fm.FILTERS[l.type] && fm.FILTERS[l.type].resolution);
  if(!hasResolutionLayer && Math.max(w,h) > MAX_SIDE){
    const s = MAX_SIDE / Math.max(w,h);
    w = Math.round(w*s); h = Math.round(h*s);
  }
  return { w, h };
}

function getBaseCanvas(){
  const b = baseDimensions();
  return drawImageToCanvas(img, b.w, b.h, "high");
}

/* ---------- render the stack list（カードの枠は app、本体UIは filters） ---------- */
function renderStack(){
  const fm = window.PRISM_FILTERS;
  stackCount.textContent = layers.length + (layers.length===1?" layer":" layers");
  $("btnClear").disabled = !layers.length;

  if(!layers.length){
    stackList.innerHTML = `<div class="stack-hint">スタックは空です。<br><b>上のボタンからフィルターを追加</b>すると、<br>上から順に重ねて適用されます。</div>`;
    return;
  }

  stackList.innerHTML = "";
  layers.forEach(layer=>{
    const f = fm.FILTERS[layer.type];
    const cat = fm.CATS[f.cat];
    const card = document.createElement("div");
    card.className = "layer" + (layer.enabled? "" : " disabled");
    card.style.setProperty("--cat", cat.color);
    card.dataset.id = layer.id;

    const topHTML = `
      <div class="layer-top">
        <span class="handle" title="ドラッグで並べ替え" aria-label="並べ替え">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <span class="layer-name">${f.name}</span>
        <span class="layer-cat">${f.cat}</span>
        <button class="icon-btn vis ${layer.enabled?'on':''}" title="${layer.enabled?'非表示にする':'表示する'}" aria-label="表示切替">
          ${layer.enabled
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4-.8M9.5 9.5a3 3 0 0 0 4.2 4.2"/></svg>`}
        </button>
        <button class="icon-btn danger del" title="削除" aria-label="削除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"/></svg>
        </button>
      </div>`;

    card.innerHTML = topHTML + fm.layerBodyHTML(layer);

    card.querySelector(".vis").addEventListener("click", ()=>toggleLayer(layer.id));
    card.querySelector(".del").addEventListener("click", ()=>removeLayer(layer.id));
    if(fm.wireBody) fm.wireBody(card, layer);

    enableDrag(card, card.querySelector(".handle"));
    stackList.appendChild(card);
  });
}

/* ---------- drag to reorder ---------- */
let dragId = null;
function enableDrag(card, handle){
  handle.addEventListener("pointerdown", ()=>{ card.setAttribute("draggable","true"); });
  ["pointerup","pointercancel"].forEach(ev=>
    handle.addEventListener(ev, ()=>card.removeAttribute("draggable")));

  card.addEventListener("dragstart", e=>{
    dragId = Number(card.dataset.id);
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try{ e.dataTransfer.setData("text/plain", dragId); }catch(_){}
  });
  card.addEventListener("dragend", ()=>{
    card.classList.remove("dragging");
    card.removeAttribute("draggable");
    commitOrderFromDOM();
    dragId = null;
  });
}
stackList.addEventListener("dragover", e=>{
  e.preventDefault();
  const dragging = stackList.querySelector(".dragging");
  if(!dragging) return;
  const after = getDragAfter(stackList, e.clientY);
  if(after == null) stackList.appendChild(dragging);
  else stackList.insertBefore(dragging, after);
});
function getDragAfter(container, y){
  const cards = [...container.querySelectorAll(".layer:not(.dragging)")];
  return cards.reduce((closest, child)=>{
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    if(offset < 0 && offset > closest.offset)
      return { offset, element:child };
    return closest;
  }, { offset:-Infinity, element:null }).element;
}

function commitOrderFromDOM(){
  const order = [...stackList.querySelectorAll(".layer")].map(c=>Number(c.dataset.id));
  layers.sort((a,b)=> order.indexOf(a.id) - order.indexOf(b.id));
  const fm = window.PRISM_FILTERS;
  if(fm && fm.refreshResizeLayers) fm.refreshResizeLayers();
  renderStack();
  scheduleRender();
}

function scheduleRender(){
  if(pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(()=>{
    pendingRender = false;
    try{ render(); }catch(err){ toast("描画エラー: " + (err.message || err)); }
  });
}

function render(showOriginal=false){
  if(!sourceReady) return;
  const fm = window.PRISM_FILTERS;
  const out = (fm && fm.renderPipeline) ? fm.renderPipeline(showOriginal) : getBaseCanvas();
  if(canvas.width!==out.width || canvas.height!==out.height){ canvas.width=out.width; canvas.height=out.height; }
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(out, 0, 0);

  const finalW = out.width, finalH = out.height;
  const baseW = img.naturalWidth, baseH = img.naturalHeight;
  if(!showOriginal && (finalW !== baseW || finalH !== baseH)){
    const ratio = Math.round((finalW / baseW) * 100) / 100;
    stageTag.textContent = `${baseW} × ${baseH} → ${finalW} × ${finalH} px (×${ratio})`;
  } else {
    stageTag.textContent = `${baseW} × ${baseH} px`;
  }

  if(out.width * out.height > MAX_PIXELS_NOTICE){
    console.warn("Large canvas:", out.width, out.height);
  }
}

/* ---------- loading images ---------- */
function loadFromURL(url){
  const tmp = new Image();
  tmp.crossOrigin = "anonymous";
  tmp.onload = ()=>{
    img.onload = ()=>{
      sourceReady = true;
      imgGen++;
      empty.classList.add("hidden");
      canvasWrap.classList.remove("hidden");
      stageUI.classList.remove("hidden");
      $("btnSave").disabled = false;
      $("btnCompare").disabled = false;
      resetView();
      const fm = window.PRISM_FILTERS;
      if(fm && fm.refreshResizeLayers) fm.refreshResizeLayers();
      renderStack();
      render();
      if(!zoomHintShown){
        toast(IS_COARSE ? "プレビューは2本指で拡大縮小、1本指で移動できます" : "プレビューはホイールで拡大縮小、ドラッグで移動できます");
        zoomHintShown = true;
      }
    };
    img.onerror = ()=> toast("画像を表示できませんでした");
    img.src = url;
  };
  tmp.onerror = ()=> toast("画像を読み込めませんでした");
  tmp.src = url;
}

function handleFile(file){
  if(!file){ return; }
  if(!file.type.startsWith("image/")){
    toast("画像ファイルではありません。JPG・PNG・WebP をお試しください");
    return;
  }
  loadFromURL(URL.createObjectURL(file));
}

function loadSample(){
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 800;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0,0,1200,800);
  g.addColorStop(0,"#2b3a8f"); g.addColorStop(.5,"#9c3d8a"); g.addColorStop(1,"#e6a23c");
  x.fillStyle = g; x.fillRect(0,0,1200,800);
  [["#ffd27d",300,260,200],["#5be0c8",880,300,170],["#ff7a9c",640,560,150],["#7fb0ff",980,620,120]]
    .forEach(([col,cx,cy,r])=>{
      const rg = x.createRadialGradient(cx,cy,0,cx,cy,r);
      rg.addColorStop(0,col); rg.addColorStop(1,"rgba(0,0,0,0)");
      x.fillStyle = rg; x.beginPath(); x.arc(cx,cy,r,0,7); x.fill();
    });
  x.strokeStyle = "rgba(255,255,255,.10)"; x.lineWidth = 1;
  for(let i=0;i<=1200;i+=60){ x.beginPath();x.moveTo(i,0);x.lineTo(i,800);x.stroke(); }
  for(let i=0;i<=800;i+=60){ x.beginPath();x.moveTo(0,i);x.lineTo(1200,i);x.stroke(); }
  x.fillStyle = "rgba(255,255,255,.92)";
  x.font = "700 96px 'Space Grotesk', sans-serif";
  x.fillText("PRISM", 80, 460);
  loadFromURL(c.toDataURL("image/png"));
}

/* ---------- export ---------- */
function saveImage(){
  if(!sourceReady) return;
  render(false);
  canvas.toBlob(blob=>{
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prism-export.png";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("PNG として書き出しました");
  }, "image/png");
}

/* ---------- compare (hold) ---------- */
function setCompare(on){
  if(!sourceReady) return;
  compareFlag.classList.toggle("on", on);
  render(on);
}

/* ---------- preview zoom & pan ---------- */
const view = { z:1, tx:0, ty:0 };
let zoomHintShown = false;

function applyView(){
  canvasWrap.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`;
  zoomTag.textContent = Math.round(view.z*100) + "%";
}
function resetView(){
  view.z = 1; view.tx = 0; view.ty = 0;
  applyView();
}
function zoomAt(clientX, clientY, newZ){
  const p = stagePoint(clientX, clientY);
  const nz = Math.min(12, Math.max(0.2, newZ));
  view.tx = p.x - (p.x - view.tx) * (nz / view.z);
  view.ty = p.y - (p.y - view.ty) * (nz / view.z);
  view.z = nz;
  applyView();
}

stage.addEventListener("wheel", e=>{
  if(!sourceReady) return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * 0.0016));
}, { passive:false });

const activePointers = new Map();
let panStart = null;
let pinchStart = null;

canvasWrap.addEventListener("pointerdown", e=>{
  if(!sourceReady) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  activePointers.set(e.pointerId, { clientX:e.clientX, clientY:e.clientY });
  canvasWrap.setPointerCapture(e.pointerId);
  canvasWrap.classList.add("panning");

  if(activePointers.size === 1){
    panStart = { x:e.clientX, y:e.clientY, tx:view.tx, ty:view.ty };
    pinchStart = null;
  } else if(activePointers.size === 2){
    const pts = [...activePointers.values()];
    const mid = midpoint(pts[0], pts[1]);
    const sp = stagePoint(mid.clientX, mid.clientY);
    pinchStart = { dist:distance(pts[0], pts[1]), cx:sp.x, cy:sp.y, tx:view.tx, ty:view.ty, z:view.z };
    panStart = null;
  }
}, { passive:false });

canvasWrap.addEventListener("pointermove", e=>{
  if(!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.set(e.pointerId, { clientX:e.clientX, clientY:e.clientY });

  if(activePointers.size >= 2 && pinchStart){
    const pts = [...activePointers.values()].slice(0,2);
    const mid = midpoint(pts[0], pts[1]);
    const sp = stagePoint(mid.clientX, mid.clientY);
    const nz = Math.min(12, Math.max(0.2, pinchStart.z * (distance(pts[0], pts[1]) / Math.max(1, pinchStart.dist))));
    view.tx = sp.x - (pinchStart.cx - pinchStart.tx) * (nz / pinchStart.z);
    view.ty = sp.y - (pinchStart.cy - pinchStart.ty) * (nz / pinchStart.z);
    view.z = nz;
    applyView();
  } else if(activePointers.size === 1 && panStart){
    view.tx = panStart.tx + (e.clientX - panStart.x);
    view.ty = panStart.ty + (e.clientY - panStart.y);
    applyView();
  }
}, { passive:false });

function endPointer(e){
  activePointers.delete(e.pointerId);
  if(activePointers.size === 0){
    panStart = null; pinchStart = null;
    canvasWrap.classList.remove("panning");
    return;
  }
  if(activePointers.size === 1){
    const p = [...activePointers.values()][0];
    panStart = { x:p.clientX, y:p.clientY, tx:view.tx, ty:view.ty };
    pinchStart = null;
  }
}
["pointerup","pointercancel","pointerleave"].forEach(ev=>canvasWrap.addEventListener(ev, endPointer));
canvasWrap.addEventListener("dblclick", resetView);
zoomTag.addEventListener("click", resetView);

/* ---------- toast ---------- */
let toastTimer;
function toast(msg){
  const t = $("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 3200);
}

/* ---------- wiring ---------- */
function openPicker(){ fileInput.value=""; fileInput.click(); }
$("btnOpen").addEventListener("click", openPicker);
$("emptyOpen").addEventListener("click", openPicker);
$("emptySample").addEventListener("click", loadSample);
$("btnSave").addEventListener("click", saveImage);
$("btnClear").addEventListener("click", clearAll);
fileInput.addEventListener("change", e=> handleFile(e.target.files[0]));

const cmp = $("btnCompare");
cmp.addEventListener("pointerdown", ()=>setCompare(true));
["pointerup","pointerleave","pointercancel"].forEach(ev=>
  cmp.addEventListener(ev, ()=>setCompare(false)));

["dragenter","dragover"].forEach(ev=>
  stage.addEventListener(ev, e=>{ e.preventDefault(); empty.classList.add("drag"); }));
["dragleave","drop"].forEach(ev=>
  stage.addEventListener(ev, e=>{ e.preventDefault(); empty.classList.remove("drag"); }));
stage.addEventListener("drop", e=>{
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(file) handleFile(file);
});

// init
buildAddGrid();
renderStack();
