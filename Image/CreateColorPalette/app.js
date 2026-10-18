const $ = id => document.getElementById(id);
let worker;
let image = null, sample = null, palette = [], generation = 0, exporting = false;
let nextJob = 0;
const jobs = new Map();
function message(text) { $('status').textContent = text; }
function resetWorker() {
  worker?.terminate();
  for (const job of jobs.values()) job.reject(new Error('新しい設定で再計算します'));
  jobs.clear();
  worker = new Worker('./quantize.js');
  worker.onmessage = ({ data }) => { const job = jobs.get(data.id); if (job) { jobs.delete(data.id); data.error ? job.reject(new Error(data.error)) : job.resolve(data); } };
  worker.onerror = () => { for (const job of jobs.values()) job.reject(new Error('画像処理を開始できませんでした')); jobs.clear(); };
}
function run(job) {
  // スライダーを続けて動かした場合は、古い計算の完了を待たず最新の設定で再開する。
  if (job.type === 'extract' || !worker) resetWorker();
  const id = ++nextJob;
  return new Promise((resolve, reject) => { jobs.set(id, { resolve, reject }); worker.postMessage({ ...job, id }, [job.pixels]); });
}
function count(value) {
  const n = Math.max(2, Math.min(256, Math.round(Number(value) || 8)));
  $('countNumber').value = n;
  $('colorCount').value = n;
  process();
}
$('colorCount').oninput = e => count(e.target.value);
$('countNumber').onchange = e => count(e.target.value);
$('decrease').onclick = () => count(Number($('countNumber').value) - 1);
$('increase').onclick = () => count(Number($('countNumber').value) + 1);
$('method').onchange = process;

async function load(file) {
  if (!file || exporting) return;
  const token = ++generation;
  sample = null;
  image = null;
  $('download').disabled = true;
  message('画像を読込中…');
  const url = URL.createObjectURL(file);
  try {
    const loaded = new Image();
    loaded.src = url;
    await loaded.decode();
    if (token !== generation) return;
    image = loaded;
    const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = $('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    sample = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    await process();
  } catch (error) {
    if (token === generation) { image = null; sample = null; palette = []; $('palette').replaceChildren(); message(`画像を読み込めませんでした: ${error.message}`); }
  } finally { URL.revokeObjectURL(url); }
}

async function process() {
  if (!sample || exporting) return;
  const token = ++generation;
  $('download').disabled = true;
  message('色を抽出中…');
  try {
    const result = await run({ type: 'extract', pixels: sample.data.slice().buffer, width: sample.width, height: sample.height, count: Number($('countNumber').value), method: $('method').value });
    if (token !== generation) return;
    palette = result.palette;
    const preview = $('preview');
    preview.width = result.width; preview.height = result.height;
    preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
    $('palette').replaceChildren();
    for (const color of palette) {
      const hex = '#' + color.map(c => c.toString(16).padStart(2, '0')).join('');
      const button = document.createElement('button');
      button.className = 'color'; button.style.background = hex;
      button.style.color = color[0] * .299 + color[1] * .587 + color[2] * .114 > 145 ? '#111' : '#fff';
      button.textContent = hex; button.title = `${hex} をコピー`;
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(hex); message(`${hex} をコピーしました。`); }
        catch { message(`コピーできませんでした。色コード: ${hex}`); }
      };
      $('palette').appendChild(button);
    }
    message(palette.length ? `抽出: ${palette.length}色 / 指定: ${$('countNumber').value}色` : '透明な画像です。透明度を保ったPNGを保存できます。');
    $('download').disabled = false;
  } catch (error) { if (token === generation) message(error.message); }
}

$('dropArea').onclick = () => $('file').click();
$('dropArea').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
$('file').onchange = e => { load(e.target.files[0]); e.target.value = ''; };
$('dropArea').ondragover = e => e.preventDefault();
$('dropArea').ondrop = e => { e.preventDefault(); load(e.dataTransfer.files[0]); };
$('download').onclick = async () => {
  if (!image || exporting || $('download').disabled) return;
  exporting = true;
  document.querySelectorAll('.controls input, .controls button, .controls select').forEach(el => { el.disabled = true; });
  message('元の解像度でPNGを作成中…');
  try {
    // 処理中の表示を先に描画してから原寸データを準備する。
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = await run({ type: 'export', palette, width: data.width, height: data.height, pixels: data.data.buffer });
    ctx.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNGを生成できませんでした');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'quantized_full.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(`${canvas.width} × ${canvas.height}px のPNGを保存しました。`);
  } catch (error) { message(`保存できませんでした: ${error.message}`); }
  finally { exporting = false; document.querySelectorAll('.controls input, .controls button, .controls select').forEach(el => { el.disabled = false; }); }
};
