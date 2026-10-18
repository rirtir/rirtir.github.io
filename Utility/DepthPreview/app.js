let generatedZipBlob = null;
let busy = false;
const $ = id => document.getElementById(id);

// NPYのバージョン・型・byte order・Fortran順をヘッダから読み取る。
function parseNPY(buffer) {
  const view = new DataView(buffer);
  const magic = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
  if (magic.length !== 6 || magic.some((v, i) => v !== [147, 78, 85, 77, 80, 89][i])) throw new Error('NPYファイルではありません');
  if (buffer.byteLength < 10) throw new Error('ヘッダが不足しています');
  const version = view.getUint8(6);
  if (![1, 2, 3].includes(version)) throw new Error('未対応のNPYバージョンです');
  const headerStart = version === 1 ? 10 : 12;
  if (buffer.byteLength < headerStart) throw new Error('ヘッダが不足しています');
  const headerLength = version === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  if (headerStart + headerLength > buffer.byteLength) throw new Error('ヘッダが壊れています');
  const header = new TextDecoder().decode(new Uint8Array(buffer, headerStart, headerLength));
  const dtype = /['"]descr['"]\s*:\s*['"]([<>=|])([fiu])(\d+)['"]/.exec(header);
  const shapeMatch = /['"]shape['"]\s*:\s*\(([^)]*)\)/.exec(header);
  const fortranMatch = /['"]fortran_order['"]\s*:\s*(True|False)/.exec(header);
  if (!dtype || !shapeMatch || !fortranMatch) throw new Error('型または形状を読めません');
  const shape = shapeMatch[1].split(',').map(v => v.trim()).filter(Boolean).map(Number);
  if (shape.some(n => !Number.isSafeInteger(n) || n <= 0)) throw new Error('画像サイズが不正です');
  while (shape.length > 2 && shape.includes(1)) shape.splice(shape.indexOf(1), 1);
  if (shape.length !== 2) throw new Error('2次元の深度マップを選択してください');
  const [height, width] = shape;
  if (width > 16384 || height > 16384 || width * height > 32000000) throw new Error('画像サイズが大きすぎます');
  const size = Number(dtype[3]);
  const getter = { f4: 'getFloat32', f8: 'getFloat64', i1: 'getInt8', i2: 'getInt16', i4: 'getInt32', u1: 'getUint8', u2: 'getUint16', u4: 'getUint32' }[dtype[2] + size];
  if (!getter) throw new Error(`未対応の型です: ${dtype[2]}${size}`);
  const offset = headerStart + headerLength, length = width * height;
  if (buffer.byteLength - offset !== length * size) throw new Error('データ長と画像サイズが一致しません');
  const nativeLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const little = dtype[1] === '<' || dtype[1] === '|' || (dtype[1] === '=' && nativeLittle);
  const fortran = fortranMatch[1] === 'True';
  const data = new Float64Array(length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = fortran ? x * height + y : y * width + x;
    data[y * width + x] = view[getter](offset + index * size, little);
  }
  return { data, shape };
}

function depthCanvas(depth, shape) {
  const [height, width] = shape;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height);
  let min = Infinity, max = -Infinity;
  for (const value of depth) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  for (let i = 0; i < depth.length; i++) {
    const value = Number.isFinite(depth[i]) && max > min ? (depth[i] - min) / (max - min) : 0;
    const rgb = [3, 2, 1].map(center => Math.round(255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * value - center)))));
    image.data.set([...rgb, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function addFiles(input) {
  if (busy) return;
  const files = Array.from(input);
  if (!files.length) return;
  busy = true; generatedZipBlob = null;
  $('downloadBtn').disabled = true; $('fileInput').disabled = true;
  $('canvas').hidden = true;
  $('popup').hidden = false;
  $('progress').max = files.length; $('progress').value = 0;
  const zip = new JSZip(), errors = [], names = new Set();
  let converted = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      $('progressText').textContent = `変換中 ${i + 1}/${files.length}: ${file.name}`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        if (!/\.npy$/i.test(file.name)) throw new Error('.npyを選択してください');
        const { data, shape } = parseNPY(await file.arrayBuffer());
        const canvas = depthCanvas(data, shape);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('PNG生成に失敗しました');
        if (!converted) {
          const preview = $('canvas'); preview.width = canvas.width; preview.height = canvas.height;
          preview.getContext('2d').drawImage(canvas, 0, 0); preview.hidden = false;
        }
        let name = file.name.replace(/\.npy$/i, '.png');
        if (names.has(name)) name = `${i + 1}_${name}`;
        while (names.has(name)) name = '_' + name;
        names.add(name); zip.file(name, blob); converted++;
      } catch (error) { errors.push(`${file.name}: ${error.message}`); }
      $('progress').value = i + 1;
    }
    if (converted) {
      $('progressText').textContent = `ZIPを作成中（${converted}ファイル）…`;
      generatedZipBlob = await zip.generateAsync({ type: 'blob' });
    }
    $('status').textContent = `${files.length}ファイル中 ${converted}ファイルを変換しました。${errors.length ? ' 失敗: ' + errors.join(' / ') : ''}`;
  } catch (error) { $('status').textContent = `ZIPを作成できませんでした: ${error.message}`; }
  finally {
    busy = false; $('popup').hidden = true; $('fileInput').disabled = false;
    $('downloadBtn').disabled = !generatedZipBlob;
  }
}

$('dropArea').onclick = () => $('fileInput').click();
$('dropArea').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } };
$('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('dropArea').ondragover = e => e.preventDefault();
$('dropArea').ondrop = e => { e.preventDefault(); addFiles(e.dataTransfer.files); };
$('downloadBtn').onclick = () => {
  if (!generatedZipBlob) return;
  const url = URL.createObjectURL(generatedZipBlob), a = document.createElement('a');
  a.href = url; a.download = 'depth_maps.zip'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
