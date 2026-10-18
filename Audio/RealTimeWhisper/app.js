let transcriber = null, recording = false, processing = false;
let audioContext, processor, input, stream;
let buffer = [], sampleRate = 16000, lastText = '', generation = 0;
const button = document.getElementById('toggle');
const status = document.getElementById('status');
const output = document.getElementById('output');

function resample(data, inRate, outRate) {
  if (inRate === outRate) return data;
  const ratio = inRate / outRate, result = new Float32Array(Math.round(data.length / ratio));
  for (let i = 0; i < result.length; i++) {
    const position = i * ratio, low = Math.min(data.length - 1, Math.floor(position)), high = Math.min(low + 1, data.length - 1);
    result[i] = data[low] * (1 - (position - low)) + data[high] * (position - low);
  }
  return result;
}

async function recognize(data, session) {
  if (processing) return;
  let sum = 0;
  for (const value of data) sum += value * value;
  if (Math.sqrt(sum / data.length) < .01) return;
  processing = true;
  status.textContent = '認識中…';
  try {
    // pipelineにはWAVのArrayBufferではなく、16kHzの生波形を渡す。
    const result = await transcriber(resample(data, sampleRate, 16000));
    if (!recording || session !== generation) return;
    const text = result.text.trim();
    if (text && text !== lastText) { output.textContent += text + ' '; lastText = text; }
    status.textContent = '録音中';
  } catch (error) {
    if (recording && session === generation) { status.textContent = `認識に失敗しました: ${error.message}`; stop(); }
  } finally { processing = false; }
}

function stop() {
  recording = false; generation++;
  if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
  input?.disconnect(); input = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  buffer = [];
  button.textContent = '開始';
}

async function start() {
  if (!transcriber) {
    status.textContent = 'Whisperをロード中（初回は時間がかかります）…';
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
  }
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  await audioContext.resume();
  sampleRate = audioContext.sampleRate;
  input = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  input.connect(processor); processor.connect(audioContext.destination);
  buffer = []; lastText = ''; output.textContent = '';
  recording = true;
  const session = ++generation;
  processor.onaudioprocess = e => {
    if (!recording) return;
    e.outputBuffer.getChannelData(0).fill(0);
    buffer.push(...e.inputBuffer.getChannelData(0));
    const windowSize = Math.round(sampleRate * 6);
    if (buffer.length >= windowSize) {
      buffer = buffer.slice(-windowSize);
      if (!processing) {
        const data = new Float32Array(buffer);
        buffer = buffer.slice(Math.round(sampleRate * 3));
        recognize(data, session);
      }
    }
  };
  button.textContent = '停止'; status.textContent = '録音中';
}
button.onclick = async () => {
  if (recording) { stop(); status.textContent = '停止'; return; }
  button.disabled = true;
  try { await start(); }
  catch (error) { stop(); status.textContent = `開始できませんでした: ${error.message}`; }
  finally { button.disabled = false; }
};
window.addEventListener('pagehide', stop);
