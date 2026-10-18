const $ = id => document.getElementById(id);
const video = $('video'), slider = $('slider'), canvas = $('canvas');
let videoURL = null;
let frameReady = false, frameCallback = null;
function sync() { $('download').disabled = !frameReady || video.readyState < 2 || video.seeking; $('capture').disabled = $('download').disabled; }
function awaitFrame() {
  frameReady = false; sync();
  const ready = () => { frameReady = true; capture(); };
  if (video.requestVideoFrameCallback) {
    if (frameCallback !== null) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = video.requestVideoFrameCallback(() => { frameCallback = null; ready(); });
  } else requestAnimationFrame(() => requestAnimationFrame(ready));
}
function capture() {
  sync();
  if ($('download').disabled) return false;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0);
  $('status').textContent = `${video.currentTime.toFixed(3)}秒 / ${canvas.width} × ${canvas.height}px`;
  return true;
}
function loadVideo(file) {
  if (!file) return;
  video.pause();
  if (videoURL) URL.revokeObjectURL(videoURL);
  $('controls').style.display = 'none';
  $('download').disabled = true;
  canvas.width = canvas.height = 0;
  $('status').textContent = '動画を読込中…';
  slider.value = 0;
  videoURL = URL.createObjectURL(file);
  awaitFrame();
  video.src = videoURL;
}
video.onloadedmetadata = () => {
  if (!Number.isFinite(video.duration)) {
    // MediaRecorder等のWebMではdurationがInfinityの場合がある。
    // 終端へseekして有限の長さをブラウザに取得させ、先頭へ戻す。
    video.currentTime = 1e10;
    return;
  }
  slider.max = video.duration;
  $('controls').style.display = 'flex';
};
video.onloadeddata = () => {
  if (Number.isFinite(video.duration)) { slider.max = video.duration; $('controls').style.display = 'flex'; capture(); }
};
video.onseeking = awaitFrame;
video.onseeked = () => {
  if (Number.isFinite(video.duration) && $('controls').style.display !== 'flex') {
    slider.max = video.duration; $('controls').style.display = 'flex'; video.currentTime = 0;
  }
  slider.value = video.currentTime; capture();
};
video.ontimeupdate = () => { if (!video.seeking) slider.value = video.currentTime; };
video.onerror = () => {
  $('status').textContent = '動画を読み込めませんでした。別の動画形式を選択してください。';
  $('controls').style.display = 'none'; $('download').disabled = true;
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
};
$('dropArea').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { loadVideo(e.target.files[0]); e.target.value = ''; };
$('dropArea').ondragover = e => e.preventDefault();
$('dropArea').ondrop = e => { e.preventDefault(); loadVideo(e.dataTransfer.files[0]); };
function seek(time) {
  if (!Number.isFinite(video.duration)) return;
  video.pause(); video.currentTime = Math.max(0,Math.min(video.duration,time));
}
slider.oninput = () => seek(Number(slider.value));
$('prevFrame').onclick = () => seek(video.currentTime - 1/30);
$('nextFrame').onclick = () => seek(video.currentTime + 1/30);
$('capture').onclick = () => { video.pause(); capture(); };
$('download').onclick = () => {
  video.pause();
  if (!capture()) return;
  canvas.toBlob(blob => {
    if (!blob) { $('status').textContent = 'PNGを生成できませんでした。'; return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'frame.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  },'image/png');
};
window.addEventListener('pagehide', () => { if (videoURL) URL.revokeObjectURL(videoURL); });
