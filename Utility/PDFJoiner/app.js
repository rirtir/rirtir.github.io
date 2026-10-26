import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
// 日本語フォントを埋め込んでいないPDFや特殊な画像形式もプレビューできるよう、補助データを同梱している。
const pdfjsAssets = new URL('./vendor/pdfjs/', import.meta.url).href;
const { PDFDocument, degrees, PDFName } = window.PDFLib;
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const pagesDiv = document.getElementById('pages');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const passwordDialog = document.getElementById('passwordDialog');
const passwordMessage = document.getElementById('passwordMessage');
const passwordInput = document.getElementById('passwordInput');
const passwordError = document.getElementById('passwordError');
const protectOutput = document.getElementById('protectOutput');
const outputPassword = document.getElementById('outputPassword');
const previewNote = document.getElementById('previewNote');
const THUMB_SIZE = 320;          // プレビュー画像の長辺(px)
const RENDER_TIMEOUT = 15000;    // 1ページの描画をあきらめるまでの時間
const MAX_PREVIEW_FAILURES = 3;  // 描画の失敗がこの回数に達したら、以降のプレビューをやめる
// プレビュー用にPDF.jsへ渡すデータ量の上限。端末のメモリ（GB、Chrome系のみ取得可）に合わせる。
const PREVIEW_BYTE_LIMIT = Math.min(8, navigator.deviceMemory || 4) * 64 * 1024 * 1024;
let pages = [];
let nextId = 1;
let pendingLoads = 0;
let exporting = false;
let loadQueue = Promise.resolve();
let previewBytes = 0;
let previewFailures = 0;
let previewStopped = '';         // プレビューをやめた理由（空なら有効）
let pumping = false;
let rendering = Promise.resolve();
const wanted = new Set();        // 画面付近にあり、プレビューを待っているページのid

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function syncControls() {
  const busy = pendingLoads > 0 || exporting;
  downloadBtn.disabled = busy || pages.length === 0;
  document.querySelectorAll('.page button, input[name="sizeMode"], #protectOutput, #outputPassword').forEach(el => { el.disabled = busy; });
  pagesDiv.setAttribute('aria-busy', String(busy));
}

function totalRotation(p) { return (p.sourceRotation + p.rotation) % 360; }

// PDF.js と同じく、90の倍数でない回転は無視して 0〜270 に揃える。
function normalizeRotation(angle) { return angle % 90 ? 0 : ((angle % 360) + 360) % 360; }

// CropBoxとMediaBoxの交差が表示領域。UserUnitも物理寸法に含める。回転前の大きさを返す。
function visibleSize(src) {
  const media = src.getMediaBox(), crop = src.getCropBox();
  const unit = src.node.lookup(PDFName.of('UserUnit'))?.asNumber?.() || 1;
  let width = Math.min(media.x + media.width, crop.x + crop.width) - Math.max(media.x, crop.x);
  let height = Math.min(media.y + media.height, crop.y + crop.height) - Math.max(media.y, crop.y);
  if (!(width > 0 && height > 0)) { width = media.width; height = media.height; }
  return { width: width * unit, height: height * unit };
}

function rotatedSize(p) {
  return totalRotation(p) % 180 ? { width: p.size.height, height: p.size.width } : p.size;
}

// 入力を待つ。「追加しない」やEscでは null を返す。
function askPassword(name, wrong) {
  return new Promise(resolve => {
    passwordMessage.textContent = `「${name}」はパスワードで保護されています。`;
    passwordError.hidden = !wrong;
    passwordInput.value = '';
    passwordDialog.returnValue = '';
    passwordDialog.addEventListener('close', () => {
      const value = passwordInput.value;
      passwordInput.value = '';
      resolve(passwordDialog.returnValue === 'open' ? value : null);
    }, { once: true });
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

document.getElementById('passwordSkip').onclick = () => passwordDialog.close('skip');

function isPasswordError(error) { return /NEEDS PASSWORD|Password incorrect/.test(error?.message || ''); }

// 暗号化PDFは復号して読み込む。閲覧パスワードのない（印刷禁止などの制限だけの）PDFは空のパスワードで開ける。
async function openDocument(bytes, name) {
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (!probe.isEncrypted) return { document: probe, password: undefined };
  try {
    return { document: await PDFDocument.load(bytes, { password: '' }), password: '' };
  } catch (error) {
    if (!isPasswordError(error)) throw error;
  }
  for (let wrong = false; ; wrong = true) {
    const password = await askPassword(name, wrong);
    if (password === null) throw Object.assign(new Error('スキップ'), { skipped: true });
    try {
      return { document: await PDFDocument.load(bytes, { password }), password };
    } catch (error) {
      if (!isPasswordError(error)) throw error;
    }
  }
}

function memoryTight() {
  const m = performance.memory; // Chrome系のみ
  return m ? m.usedJSHeapSize > m.jsHeapSizeLimit * 0.7 : false;
}

// 描画中のものが終わってから閉じる。
function closePreview(source) {
  const doc = source.preview;
  if (!doc) return;
  source.preview = null;
  previewBytes -= source.size;
  rendering.then(() => doc.destroy()).catch(() => {});
}

// 重いPDFでブラウザごと落ちるのを避けるため、危なくなったらプレビューだけをやめる。保存はそのままできる。
function stopPreviews(reason) {
  if (previewStopped) return;
  previewStopped = reason;
  wanted.clear();
  observer.disconnect();
  new Set(pages.map(p => p.source)).forEach(closePreview);
  previewNote.textContent = `${reason}、これ以降のプレビュー表示を止めました。並べ替え・削除・ダウンロードはそのまま使えます。`;
  previewNote.hidden = false;
  pagesDiv.querySelectorAll('.page').forEach(card => {
    const p = pages.find(item => item.id === Number(card.dataset.id));
    if (p) fillThumb(card.querySelector('.thumb'), p);
  });
}

function resetPreviews() {
  previewStopped = '';
  previewFailures = 0;
  previewNote.hidden = true;
}

// 描画したら小さなJPEGにしてcanvasは捨て、ページのキャッシュ（デコード済み画像など）も解放する。
async function makeThumb(p) {
  const page = await p.source.preview.getPage(p.pageIndex + 1);
  try {
    const base = page.getViewport({ scale: 1, rotation: p.sourceRotation });
    const viewport = page.getViewport({ scale: Math.min(1.5, THUMB_SIZE / Math.max(base.width, base.height)), rotation: p.sourceRotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const task = page.render({ canvas, viewport });
    const timer = setTimeout(() => task.cancel(), RENDER_TIMEOUT);
    try {
      await task.promise;
    } finally {
      clearTimeout(timer);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('画像にできません');
    return URL.createObjectURL(blob);
  } finally {
    page.cleanup();
  }
}

function needsThumb(p) { return !p.thumb && !p.thumbError && p.source.preview && !previewStopped; }

// 画面付近のページを、並び順に1枚ずつ描画する。
async function pumpPreviews() {
  if (pumping) return;
  pumping = true;
  try {
    while (!previewStopped) {
      const p = pages.find(item => wanted.has(item.id));
      if (!p) break;
      wanted.delete(p.id);
      if (!needsThumb(p)) continue;
      if (memoryTight()) { stopPreviews('メモリが足りなくなりそうなため'); break; }
      const job = makeThumb(p);
      rendering = job.catch(() => {});
      try {
        p.thumb = await job;
        if (!pages.includes(p)) URL.revokeObjectURL(p.thumb);
      } catch (error) {
        p.thumbError = error?.name === 'RenderingCancelledException' ? '重いため省略' : 'プレビューなし';
        if (++previewFailures >= MAX_PREVIEW_FAILURES) stopPreviews('プレビューの描画に何度も失敗したため');
      }
      const box = pagesDiv.querySelector(`[data-id="${p.id}"] .thumb`);
      if (box) {
        observer.unobserve(box);
        fillThumb(box, p);
      }
    }
  } finally {
    pumping = false;
  }
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const id = Number(entry.target.closest('.page').dataset.id);
    if (entry.isIntersecting) wanted.add(id);
    else wanted.delete(id);
  }
  pumpPreviews();
}, { rootMargin: '400px 0px' });

// プレビューが届く前も、ページの形をした仮の図形で同じ場所を確保しておく。
function fillThumb(box, p) {
  const name = `${p.source.name} ${p.pageIndex + 1}ページ目`;
  if (p.thumb) {
    const img = document.createElement('img');
    img.src = p.thumb;
    img.alt = `${name}のプレビュー`;
    img.style.transform = `rotate(${p.rotation}deg)`;
    box.replaceChildren(img);
    box.classList.remove('waiting');
    return;
  }
  const { width, height } = rotatedSize(p);
  const shape = document.createElement('div');
  shape.className = width >= height ? 'shape wide' : 'shape tall';
  shape.style.aspectRatio = `${width} / ${height}`;
  const waiting = needsThumb(p);
  shape.textContent = waiting ? String(p.pageIndex + 1) : p.thumbError || 'プレビュー省略';
  shape.setAttribute('aria-label', waiting ? `${name}（プレビュー読込待ち）` : `${name}（${shape.textContent}）`);
  box.replaceChildren(shape);
  box.classList.toggle('waiting', waiting);
}

function move(id, offset) {
  const from = pages.findIndex(p => p.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= pages.length) return;
  pages.splice(to, 0, pages.splice(from, 1)[0]);
  render();
  pagesDiv.querySelector(`[data-id="${id}"] .move`)?.focus();
}

function render() {
  observer.disconnect();
  wanted.clear();
  pagesDiv.replaceChildren();
  pages.forEach((p, i) => {
    const card = document.createElement('section');
    card.className = 'page';
    card.dataset.id = p.id;
    card.draggable = true;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    fillThumb(thumb, p);
    const label = document.createElement('div');
    label.className = 'page-title';
    label.textContent = `${i + 1}. ${p.source.name} / ${p.pageIndex + 1}ページ`;
    const controls = document.createElement('div');
    controls.className = 'controls';
    function button(text, title, action, cls = '') {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', `${i + 1}番目: ${title}`);
      b.className = cls;
      b.onclick = action;
      controls.appendChild(b);
    }
    button('回転', '時計回りに90度回転', () => {
      // 描き直さず、プレビュー画像を回すだけにする。
      p.rotation = (p.rotation + 90) % 360;
      fillThumb(thumb, p);
    });
    button('削除', 'このページを削除', () => {
      pages = pages.filter(other => other.id !== p.id);
      if (p.thumb) URL.revokeObjectURL(p.thumb);
      if (!pages.some(other => other.source === p.source)) closePreview(p.source);
      if (!pages.length) resetPreviews();
      render();
      message(`${pages.length}ページを保存できます。`);
    });
    button('←', '前へ移動', () => move(p.id, -1), 'move');
    button('→', '後ろへ移動', () => move(p.id, 1), 'move');
    card.append(thumb, label, controls);
    card.ondragstart = e => {
      if (pendingLoads || exporting) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-pdf-page', String(p.id));
      e.dataTransfer.effectAllowed = 'move';
    };
    card.ondragover = e => { if (e.dataTransfer.types.includes('application/x-pdf-page')) e.preventDefault(); };
    card.ondrop = e => {
      e.preventDefault();
      e.stopPropagation();
      if (pendingLoads || exporting) return;
      const from = pages.findIndex(item => item.id === Number(e.dataTransfer.getData('application/x-pdf-page')));
      if (from < 0 || from === i) return;
      pages.splice(i, 0, pages.splice(from, 1)[0]);
      render();
    };
    pagesDiv.appendChild(card);
    if (needsThumb(p)) observer.observe(thumb);
  });
  syncControls();
}

function enqueueFiles(input) {
  const files = Array.from(input);
  if (!files.length || exporting) return;
  pendingLoads++;
  syncControls();
  loadQueue = loadQueue.then(async () => {
    const failures = [];
    const skipped = [];
    const noPreview = [];
    let unlocked = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      message(`読込中 ${i + 1}/${files.length}: ${file.name}`);
      try {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('PDFを選択してください');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { document, password } = await openDocument(bytes, file.name);
        if (password !== undefined) unlocked++;
        // ページの情報は保存に使う pdf-lib から取る。プレビューを開けなくても、ページの編集と保存はできる。
        const source = { document, preview: null, name: file.name, size: bytes.length };
        const added = document.getPages().map((page, pageIndex) => ({
          id: nextId++, source, pageIndex, size: visibleSize(page),
          sourceRotation: normalizeRotation(page.getRotation().angle), rotation: 0, thumb: null, thumbError: '',
        }));
        if (previewStopped) {
          // 既にプレビューをやめている
        } else if (previewBytes + bytes.length > PREVIEW_BYTE_LIMIT) {
          noPreview.push(`${file.name}（大きすぎるため）`);
        } else {
          try {
            // pdf.js はデータをワーカーへ移すので複製を渡す。
            source.preview = await pdfjsLib.getDocument({
              data: bytes.slice(),
              password,
              cMapUrl: pdfjsAssets + 'cmaps/',
              standardFontDataUrl: pdfjsAssets + 'standard_fonts/',
              wasmUrl: pdfjsAssets + 'wasm/',
              iccUrl: pdfjsAssets + 'iccs/',
            }).promise;
            previewBytes += bytes.length;
          } catch (error) {
            noPreview.push(`${file.name}（${error.message}）`);
          }
        }
        pages.push(...added);
        render();
      } catch (error) {
        if (error.skipped) skipped.push(file.name);
        else failures.push(`${file.name}: ${error.message}`);
      }
    }
    render();
    const unlockedNote = unlocked ? ` 保護されたPDF ${unlocked}件を解除して読み込みました（保存するPDFには、上で指定しない限りパスワードは付きません）。` : '';
    const skippedNote = skipped.length ? ` 追加しなかったファイル: ${skipped.join(' / ')}` : '';
    const noPreviewNote = noPreview.length ? ` プレビューを省略: ${noPreview.join(' / ')}` : '';
    message(`${pages.length}ページを保存できます。${unlockedNote}${skippedNote}${noPreviewNote}${failures.length ? ' 読込失敗: ' + failures.join(' / ') : ''}`, failures.length > 0);
  }).catch(error => message(`読込に失敗しました: ${error.message}`, true)).finally(() => {
    pendingLoads--;
    syncControls();
  });
}

dropArea.onclick = () => fileInput.click();
dropArea.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { enqueueFiles(fileInput.files); fileInput.value = ''; };
dropArea.ondragover = e => e.preventDefault();
dropArea.ondrop = e => { e.preventDefault(); enqueueFiles(e.dataTransfer.files); };

protectOutput.onchange = () => {
  outputPassword.hidden = !protectOutput.checked;
  if (protectOutput.checked) outputPassword.focus();
};

downloadBtn.onclick = async () => {
  if (pendingLoads || exporting || !pages.length) return;
  if (protectOutput.checked && !outputPassword.value) {
    message('保存するPDFのパスワードを入力してください。', true);
    outputPassword.focus();
    return;
  }
  exporting = true;
  syncControls();
  message('PDFを作成中…');
  try {
    const out = await PDFDocument.create();
    const mode = document.querySelector('input[name="sizeMode"]:checked').value;
    const dimensions = pages.map(rotatedSize);
    const maxWidth = Math.max(...dimensions.map(d => d.width));
    const maxHeight = Math.max(...dimensions.map(d => d.height));
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      // 元ページをコピーし、テキストや注釈を維持する。
      const [copy] = await out.copyPages(p.source.document, [p.pageIndex]);
      copy.setRotation(degrees(totalRotation(p)));
      const scale = mode === 'fitWidth' ? maxWidth / dimensions[i].width : mode === 'fitHeight' ? maxHeight / dimensions[i].height : 1;
      if (scale !== 1) {
        const boxes = ['Media', 'Crop', 'Bleed', 'Trim', 'Art'].map(name => [name, copy[`get${name}Box`]()]);
        copy.scaleContent(scale, scale);
        copy.scaleAnnotations(scale, scale);
        for (const [name, box] of boxes) copy[`set${name}Box`](box.x * scale, box.y * scale, box.width * scale, box.height * scale);
      }
      out.addPage(copy);
    }
    if (protectOutput.checked) {
      // 開くときのパスワードだけを付け、開いた後の印刷やコピーは制限しない。
      const password = outputPassword.value;
      out.encrypt({
        userPassword: password,
        ownerPassword: password,
        permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true },
      });
    }
    const blob = new Blob([await out.save()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 1つのPDFだけを編集した場合は元のファイル名で保存する。
    const sources = new Set(pages.map(p => p.source));
    a.download = sources.size === 1 ? pages[0].source.name.replace(/\.pdf$/i, '') + '.pdf' : 'merged.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(`${pages.length}ページのPDFを${protectOutput.checked ? 'パスワード付きで' : ''}保存しました。`);
  } catch (error) {
    message(`PDFを作成できませんでした: ${error.message}`, true);
  } finally {
    exporting = false;
    syncControls();
  }
};
