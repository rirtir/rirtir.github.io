import { FFmpeg } from '../../ffmpeg/index.js';
const $ = id => document.getElementById(id);
let images = [], ffmpeg, outputBlob = null, loading = 0, encoding = false;
let queue = Promise.resolve();
const show = text => { $('popup').style.display = 'flex'; $('popupContent').textContent = text; };
const hide = () => { $('popup').style.display = 'none'; };
function invalidate() { outputBlob = null; $('downloadBtn').style.display = 'none'; }
function sync() { $('generateBtn').disabled = encoding || loading > 0 || !images.length; }
function sort() {
  images.sort($('sortMode').value === 'name' ? (a, b) => a.file.name.localeCompare(b.file.name, undefined, {numeric:true}) : (a,b) => a.file.lastModified - b.file.lastModified);
}
function render() {
  $('imageList').replaceChildren();
  images.forEach((item, index) => {
    const card = document.createElement('div'); card.className = 'imageItem'; card.draggable = true;
    const image = document.createElement('img'); image.src = item.url; image.alt = item.file.name;
    const label = document.createElement('div'); label.textContent = item.file.name; label.style.overflowWrap = 'anywhere';
    card.append(image, label);
    card.ondragstart = e => {
      if (encoding || loading) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-video-image', String(index));
    };
    card.ondragover = e => e.preventDefault();
    card.ondrop = e => {
      e.preventDefault(); e.stopPropagation();
      if (encoding || loading) return;
      const raw = e.dataTransfer.getData('application/x-video-image');
      const from = Number(raw);
      if (raw === '' || !Number.isInteger(from) || from < 0 || from >= images.length) return;
      images.splice(index, 0, images.splice(from, 1)[0]); invalidate(); render();
    };
    $('imageList').appendChild(card);
  });
  sync();
}
function addFiles(input) {
  const files = Array.from(input);
  if (!files.length || encoding) return;
  loading++; invalidate(); sync();
  queue = queue.then(async () => {
    const errors = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i], url = URL.createObjectURL(file), image = new Image();
      show(`画像を読込中 ${i + 1}/${files.length}: ${file.name}`);
      try { image.src = url; await image.decode(); images.push({ file, image, url }); }
      catch { URL.revokeObjectURL(url); errors.push(file.name); }
    }
    sort(); render();
    $('status').textContent = `${images.length}枚を読み込みました。${errors.length ? ' 読込失敗: ' + errors.join('、') : ''}`;
  }).finally(() => { loading--; if (!loading) hide(); sync(); });
}
$('dropArea').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('dropArea').ondragover = e => e.preventDefault();
$('dropArea').ondrop = e => { e.preventDefault(); addFiles(e.dataTransfer.files); };
$('sortMode').onchange = () => { sort(); invalidate(); render(); };
$('fps').oninput = () => { $('fpsVal').textContent = $('fps').value; invalidate(); };

$('generateBtn').onclick = async () => {
  if (encoding || loading || !images.length) return;
  encoding = true; invalidate(); sync();
  $('sortMode').disabled = $('fps').disabled = $('fileInput').disabled = true;
  const names = [];
  try {
    show('FFmpegをロード中…');
    if (!ffmpeg) {
      ffmpeg = new FFmpeg();
      await ffmpeg.load({coreURL:new URL('../../ffmpeg/ffmpeg-core.js',import.meta.url).href,wasmURL:new URL('../../ffmpeg/ffmpeg-core.wasm',import.meta.url).href,classWorkerURL:new URL('../../ffmpeg/worker.js',import.meta.url).href});
    }
    // 最初の画像を基準に、偶数サイズへ合わせる。異なる縦横比は黒い余白で保持。
    const width = Math.ceil(images[0].image.naturalWidth / 2) * 2;
    const height = Math.ceil(images[0].image.naturalHeight / 2) * 2;
    if (width * height > 16000000) throw new Error('動画サイズが大きすぎます（最大1600万画素）');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < images.length; i++) {
      show(`動画用画像を準備中 ${i + 1}/${images.length}`);
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,width,height);
      const image = images[i].image;
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      if (!blob) throw new Error('画像を準備できませんでした');
      const name = `frame${String(i).padStart(6,'0')}.png`; names.push(name);
      await ffmpeg.writeFile(name,new Uint8Array(await blob.arrayBuffer()));
    }
    show('動画を生成中…');
    names.push('out.mp4');
    const code = await ffmpeg.exec(['-y','-framerate',$('fps').value,'-i','frame%06d.png','-frames:v',String(images.length),'-c:v','libx264','-pix_fmt','yuv420p','out.mp4']);
    if (code !== 0) throw new Error(`動画変換に失敗しました（${code}）`);
    outputBlob = new Blob([await ffmpeg.readFile('out.mp4')],{type:'video/mp4'});
    $('downloadBtn').style.display = 'inline-block';
    $('status').textContent = `${images.length}枚・${width} × ${height}px・${$('fps').value}fps の動画を作成しました。`;
  } catch (error) {
    $('status').textContent = `動画を作成できませんでした: ${error.message}`;
    ffmpeg?.terminate(); ffmpeg = null;
  } finally {
    if (ffmpeg) for (const name of names) { try { await ffmpeg.deleteFile(name); } catch {} }
    encoding = false; hide(); sync();
    $('sortMode').disabled = $('fps').disabled = $('fileInput').disabled = false;
  }
};
$('downloadBtn').onclick = () => {
  if (!outputBlob) return;
  const url = URL.createObjectURL(outputBlob), a = document.createElement('a');
  a.href = url; a.download = 'output.mp4'; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide', () => images.forEach(item => URL.revokeObjectURL(item.url)));
