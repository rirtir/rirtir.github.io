import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';
const { PDFDocument, degrees, PDFName } = window.PDFLib;
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const pagesDiv = document.getElementById('pages');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
let pages = [];
let nextId = 1;
let pendingLoads = 0;
let exporting = false;
let loadQueue = Promise.resolve();
let previewQueue = Promise.resolve();

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function syncControls() {
  const busy = pendingLoads > 0 || exporting;
  downloadBtn.disabled = busy || pages.length === 0;
  document.querySelectorAll('.page button, input[name="sizeMode"]').forEach(el => { el.disabled = busy; });
  pagesDiv.setAttribute('aria-busy', String(busy));
}

function totalRotation(p) { return (p.sourceRotation + p.rotation) % 360; }

function drawPreview(p, canvas) {
  // 同一ファイルのPDFは一度だけ開き、描画も順番に行う。古いcanvasには描画しない。
  previewQueue = previewQueue.then(async () => {
    if (!canvas.isConnected) return;
    const page = await p.source.preview.getPage(p.pageIndex + 1);
    const base = page.getViewport({ scale: 1, rotation: totalRotation(p) });
    const viewport = page.getViewport({ scale: Math.min(1.5, 320 / Math.max(base.width, base.height)), rotation: totalRotation(p) });
    if (!canvas.isConnected) return;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    canvas.dataset.ready = 'true';
  }).catch(error => {
    if (canvas.isConnected) {
      canvas.dataset.error = 'true';
      message(`プレビューを表示できません: ${p.source.name}（${error.message}）`, true);
    }
  });
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
  pagesDiv.replaceChildren();
  pages.forEach((p, i) => {
    const card = document.createElement('section');
    card.className = 'page';
    card.dataset.id = p.id;
    card.draggable = true;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `${p.source.name} ${p.pageIndex + 1}ページ目のプレビュー`);
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
      p.rotation = (p.rotation + 90) % 360;
      delete canvas.dataset.ready;
      drawPreview(p, canvas);
    });
    button('削除', 'このページを削除', () => {
      pages = pages.filter(other => other.id !== p.id);
      if (!pages.some(other => other.source === p.source)) previewQueue.then(() => p.source.preview.destroy()).catch(() => {});
      render();
      message(`${pages.length}ページを保存できます。`);
    });
    button('←', '前へ移動', () => move(p.id, -1), 'move');
    button('→', '後ろへ移動', () => move(p.id, 1), 'move');
    card.append(canvas, label, controls);
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
    drawPreview(p, canvas);
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
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      message(`読込中 ${i + 1}/${files.length}: ${file.name}`);
      let preview;
      try {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('PDFを選択してください');
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 暗号化PDFは保存時に壊さないよう、追加時に扱えないことを知らせる。
        const document = await PDFDocument.load(bytes);
        preview = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        const source = { bytes, document, preview, name: file.name };
        const added = [];
        for (let pageIndex = 0; pageIndex < preview.numPages; pageIndex++) {
          const original = await preview.getPage(pageIndex + 1);
          added.push({ id: nextId++, source, pageIndex, sourceRotation: original.rotate, rotation: 0 });
        }
        pages.push(...added);
      } catch (error) {
        if (preview) await preview.destroy();
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    render();
    message(`${pages.length}ページを保存できます。${failures.length ? ' 読込失敗: ' + failures.join(' / ') : ''}`, failures.length > 0);
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

downloadBtn.onclick = async () => {
  if (pendingLoads || exporting || !pages.length) return;
  exporting = true;
  syncControls();
  message('PDFを作成中…');
  try {
    const out = await PDFDocument.create();
    const mode = document.querySelector('input[name="sizeMode"]:checked').value;
    // CropBoxとMediaBoxの交差が表示領域。UserUnitも物理寸法に含める。
    const dimensions = pages.map(p => {
      const src = p.source.document.getPage(p.pageIndex);
      const media = src.getMediaBox(), crop = src.getCropBox();
      const unit = src.node.lookup(PDFName.of('UserUnit'))?.asNumber?.() || 1;
      let width = Math.min(media.x + media.width, crop.x + crop.width) - Math.max(media.x, crop.x);
      let height = Math.min(media.y + media.height, crop.y + crop.height) - Math.max(media.y, crop.y);
      if (!(width > 0 && height > 0)) { width = media.width; height = media.height; }
      if (totalRotation(p) % 180) [width, height] = [height, width];
      return { width: width * unit, height: height * unit };
    });
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
    const blob = new Blob([await out.save()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(`${pages.length}ページのPDFを保存しました。`);
  } catch (error) {
    message(`PDFを作成できませんでした: ${error.message}`, true);
  } finally {
    exporting = false;
    syncControls();
  }
};
