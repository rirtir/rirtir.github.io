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
// プレビュー表示専用の最大辺。性能のためプレビューだけ常にここまで縮小する。
// 実際の出力（書き出し・リサイズ・超解像）はこの値に縛られない。
const PREVIEW_MAX = IS_COARSE ? 2600 : 3500;
// 出力時の安全上限（ブラウザ／メモリ限界の目安）。これを超えると書き出しに失敗しうる。
const HARD_MAX = 16384;
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
let sourceDataURL = null;   // 元画像データURL（プロジェクト埋め込み用・無劣化）
let sourceName = "image";   // 元画像名（拡張子なし）

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
const projectInput = $("projectInput");

/* ---------- small utilities ---------- */
function clamp(v, min=0, max=255){ return v < min ? min : (v > max ? max : v); }
function clampInt(v, min=1, max=HARD_MAX){
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
// 縦横比を保ったまま、最長辺が cap 以下になるようサイズを丸めて返す。
function capDim(w, h, cap){
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const longest = Math.max(w, h);
  if(!Number.isFinite(cap) || longest <= cap) return { w, h };
  const s = cap / longest;
  return { w:Math.max(1, Math.round(w*s)), h:Math.max(1, Math.round(h*s)) };
}
// 与えられた cap で最長辺を抑える。cap=Infinity（書き出し時）なら無加工で返す。
function pixelLimitCanvas(src, cap){
  if(!Number.isFinite(cap)) return src;
  const longest = Math.max(src.width, src.height);
  if(longest <= cap) return src;
  const s = cap / longest;
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

/* ---------- base dimensions ----------
   ここは常に「実寸（元画像の解像度）」を返す。プレビュー用の縮小は
   getBaseCanvas("preview") 側だけで行い、書き出しや解像度計算には影響させない。 */
function baseDimensions(){
  if(!sourceReady) return { w:0, h:0 };
  return { w: img.naturalWidth, h: img.naturalHeight };
}

function getBaseCanvas(mode="preview"){
  const b = baseDimensions();
  const size = mode === "export" ? b : capDim(b.w, b.h, PREVIEW_MAX);
  return drawImageToCanvas(img, size.w, size.h, "high");
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
    card.className = "layer" + (layer.enabled ? "" : " disabled") + (layer.collapsed ? " collapsed" : "");
    card.style.setProperty("--cat", cat.color);
    card.dataset.id = layer.id;

    const topHTML = `
      <div class="layer-top">
        <span class="handle" title="ドラッグで並べ替え" aria-label="並べ替え">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
        </span>
        <span class="layer-name">${f.name}</span>
        <span class="layer-cat">${f.cat}</span>
        <button class="icon-btn collapse" title="${layer.collapsed?'展開する':'折りたたむ'}" aria-label="折りたたみ" aria-expanded="${layer.collapsed?'false':'true'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
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
    const colBtn = card.querySelector(".collapse");
    if(colBtn) colBtn.addEventListener("click", ()=>{
      layer.collapsed = !layer.collapsed;
      card.classList.toggle("collapsed", layer.collapsed);
      colBtn.setAttribute("aria-expanded", layer.collapsed ? "false" : "true");
    });
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
  const out = (fm && fm.renderPipeline) ? fm.renderPipeline(showOriginal, "preview") : getBaseCanvas("preview");
  if(canvas.width!==out.width || canvas.height!==out.height){ canvas.width=out.width; canvas.height=out.height; }
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(out, 0, 0);

  const baseW = img.naturalWidth, baseH = img.naturalHeight;
  if(showOriginal){
    stageTag.textContent = `${baseW} × ${baseH} px`;
    return;
  }

  // タグには「実際の出力解像度」を表示する（プレビューの縮小サイズではなく）。
  const od = (fm && fm.outputDimensions) ? fm.outputDimensions() : { w:baseW, h:baseH };
  let tag;
  if(od.w !== baseW || od.h !== baseH){
    const ratio = Math.round((od.w / baseW) * 100) / 100;
    tag = `${baseW} × ${baseH} → ${od.w} × ${od.h} px (×${ratio})`;
  } else {
    tag = `${baseW} × ${baseH} px`;
  }
  // プレビューが実寸より縮小表示されている場合だけ注記する。
  if(out.width !== od.w || out.height !== od.h){
    tag += `  ·  プレビュー ${out.width} × ${out.height}`;
  }
  stageTag.textContent = tag;

  if(od.w * od.h > MAX_PIXELS_NOTICE){
    console.warn("Large output:", od.w, od.h);
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
      sourceDataURL = url;                    // 埋め込み用に保持
      empty.classList.add("hidden");
      canvasWrap.classList.remove("hidden");
      stageUI.classList.remove("hidden");
      $("btnSave").disabled = false;
      $("btnSaveProject").disabled = false;   // プロジェクト保存を有効化
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
  const reader = new FileReader();
  reader.onload = ()=>{
    sourceName = (file.name || "image").replace(/\.[^.]+$/, "");
    loadFromURL(reader.result);   // 元データURL（無劣化）をそのまま使う
  };
  reader.onerror = ()=> toast("画像を読み込めませんでした");
  reader.readAsDataURL(file);
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
  sourceName = "sample";
  loadFromURL(c.toDataURL("image/png"));
}

/* ---------- export ----------
   プレビュー（表示用キャンバス）とは独立に、実寸でパイプラインを走らせて書き出す。
   解像度が大きすぎて生成に失敗した場合はエラーを通知する。 */
function saveImage(){
  if(!sourceReady) return;
  const fm = window.PRISM_FILTERS;
  const failMsg = "書き出しに失敗しました。解像度が大きすぎる可能性があります";

  let out;
  try{
    out = (fm && fm.renderPipeline) ? fm.renderPipeline(false, "export") : getBaseCanvas("export");
  }catch(err){
    console.error(err);
    toast(failMsg);
    return;
  }
  if(!out || !out.width || !out.height){ toast(failMsg); return; }

  try{
    out.toBlob(blob=>{
      if(!blob){ toast(failMsg); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "prism-export.png";
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`PNG として書き出しました (${out.width} × ${out.height} px)`);
    }, "image/png");
  }catch(err){
    console.error(err);
    toast(failMsg);
  }
}

/* ---------- project save / load ----------
   レイヤー（追加フィルターと値）をJSONで保存。画像はデータURLとして
   埋め込む（元バイト列のbase64なので無劣化）。id は保存時に除外し、
   読み込み時に振り直す（並び順は配列順で保持）。 */
const PROJECT_VERSION = 1;

function saveProject(){
  if(!sourceReady){ toast("先に画像を開いてください"); return; }
  const data = {
    prism: "project",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    image: sourceDataURL
      ? { embedded:true, name:sourceName, dataURL:sourceDataURL }
      : { embedded:false },
    layers: layers.map(({ id, ...rest })=> rest),
  };
  try{
    const blob = new Blob([JSON.stringify(data)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (sourceName || "prism") + ".prism.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("プロジェクトを保存しました");
  }catch(err){
    console.error(err);
    toast("プロジェクトの保存に失敗しました");
  }
}

function loadProjectFromFile(file){
  if(!file){ return; }
  const reader = new FileReader();
  reader.onload = ()=>{
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(_){ toast("プロジェクトファイルを解釈できませんでした"); return; }
    if(!data || data.prism !== "project" || !Array.isArray(data.layers)){
      toast("PRISM のプロジェクトファイルではありません");
      return;
    }
    applyProjectData(data);
  };
  reader.onerror = ()=> toast("プロジェクトファイルを読み込めませんでした");
  reader.readAsText(file);
}

function applyProjectData(data){
  const fm = window.PRISM_FILTERS;
  let maxId = 0;
  const restored = [];
  data.layers.forEach(src=>{
    if(!src || !fm || !fm.FILTERS[src.type]) return;   // 未知の型は読み飛ばす
    const layer = JSON.parse(JSON.stringify(src));      // curves等のネストも複製
    if(typeof layer.enabled !== "boolean") layer.enabled = true;
    layer.id = ++maxId;
    restored.push(layer);
  });
  layers = restored;
  nextId = maxId + 1;
  renderStack();

  const skipped = data.layers.length - restored.length;
  const note = skipped > 0 ? `（未対応のレイヤー${skipped}件は除外）` : "";
  const img64 = data.image && data.image.embedded && data.image.dataURL;
  if(img64){
    sourceName = data.image.name || sourceName;
    loadFromURL(img64);   // onload で renderStack / render が走る
    toast("プロジェクトを読み込みました" + note);
  }else{
    if(sourceReady) scheduleRender();
    toast("レイヤーのみ読み込みました（画像は含まれていません）" + note);
  }
}

/* ---------- add-grid リサイズ（PCのみ） ---------- */
function initAddResizer(){
  const handle = $("addResizer");
  const grid = $("addGrid");
  const rail = document.querySelector(".rail");
  if(!handle || !grid || !rail) return;
  let startY = 0, startH = 0, dragging = false;
  const onMove = e=>{
    if(!dragging) return;
    const dy = e.clientY - startY;
    const h = Math.max(96, Math.min(rail.clientHeight - 200, startH + dy));
    document.documentElement.style.setProperty("--add-h", h + "px");
  };
  const onUp = e=>{
    if(!dragging) return;
    dragging = false;
    try{ handle.releasePointerCapture(e.pointerId); }catch(_){}
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  handle.addEventListener("pointerdown", e=>{
    if(IS_COARSE || window.innerWidth <= 820) return;   // タッチ・狭幅では無効
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = grid.getBoundingClientRect().height;
    try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
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
$("btnSaveProject").addEventListener("click", saveProject);
$("btnOpenProject").addEventListener("click", ()=>{ projectInput.value=""; projectInput.click(); });
projectInput.addEventListener("change", e=> loadProjectFromFile(e.target.files[0]));

const cmp = $("btnCompare");
cmp.addEventListener("pointerdown", e=>{ e.preventDefault(); setCompare(true); });
["pointerup","pointerleave","pointercancel"].forEach(ev=>
  cmp.addEventListener(ev, ()=>setCompare(false)));
// 長押し時のテキスト選択／コンテキストメニューを抑止（スマホで青く反転するのを防ぐ）
cmp.addEventListener("contextmenu", e=>e.preventDefault());

/* ---------- preview interpolation toggle（表示拡大時の補間方法） ---------- */
let interpMode = "smooth";   // "smooth" = バイリニア / "pixel" = ニアレストネイバー
function applyInterp(){
  canvasWrap.classList.toggle("pixelated", interpMode === "pixel");
  const lbl = $("interpLabel");
  if(lbl) lbl.textContent = interpMode === "pixel" ? "ピクセル" : "なめらか";
}
$("btnInterp").addEventListener("click", ()=>{
  interpMode = interpMode === "pixel" ? "smooth" : "pixel";
  applyInterp();
  toast(interpMode === "pixel"
    ? "補間: ニアレストネイバー（ピクセルアート向け）"
    : "補間: バイリニア（なめらか）");
});
applyInterp();

/* ---------- hamburger menu（開く・書き出し・削除をまとめる） ---------- */
const btnMenu = $("btnMenu");
const menuDropdown = $("menuDropdown");
function setMenu(open){
  menuDropdown.classList.toggle("hidden", !open);
  btnMenu.setAttribute("aria-expanded", open ? "true" : "false");
}
btnMenu.addEventListener("click", e=>{
  e.stopPropagation();
  setMenu(menuDropdown.classList.contains("hidden"));
});
document.addEventListener("click", e=>{
  if(menuDropdown.classList.contains("hidden")) return;
  if(e.target === btnMenu || btnMenu.contains(e.target) || menuDropdown.contains(e.target)) return;
  setMenu(false);
});
[$("btnOpen"), $("btnOpenProject"), $("btnSave"), $("btnSaveProject"), $("btnClear")]
  .forEach(b=> b && b.addEventListener("click", ()=>setMenu(false)));

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
initAddResizer();
