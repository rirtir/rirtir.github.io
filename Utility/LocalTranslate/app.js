import { MODEL, LANGUAGES, buildPrompt, formatMB } from './core.js';
import { savedModel, downloadModel, removeModel, modelLock } from './storage.js';

const $ = id => document.getElementById(id);
let engine = null, busy = false, saved = false, downloadController, translateController;
let supported = false;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function update() {
  $('prepare').disabled = busy || !supported || !!engine;
  $('prepare').textContent = engine ? '✓ 翻訳の準備ができました' : saved ? '保存したモデルを読み込む' : '↓ モデルをダウンロードして始める';
  $('modelBadge').textContent = engine ? '利用可能' : saved ? '保存済み' : '未ダウンロード';
  $('remove').hidden = !saved;
  $('remove').disabled = busy;
  $('translate').disabled = !engine || busy || !$('input').value.trim() || $('source').value === $('target').value;
  for (const id of ['source','target','swap','sample','clear']) $(id).disabled = busy;
  $('input').readOnly = busy;
  $('copy').disabled = busy || !$('output').value;
}
for (const id of ['source','target']) {
  const select = $(id), value = select.value;
  select.replaceChildren();
  if (id === 'source') select.add(new Option('自動検出', 'auto'));
  for (const [code,label] of LANGUAGES) select.add(new Option(label, code));
  select.value = value;
  select.addEventListener('change', update);
}
$('input').addEventListener('input', () => { $('count').textContent = `${$('input').value.length} / 600文字`; update(); });
$('sample').onclick = () => { $('input').value = '会議は来週の月曜日に変更されました。'; $('source').value = 'ja'; $('target').value = 'en'; $('input').dispatchEvent(new Event('input')); };
$('clear').onclick = () => { $('input').value = ''; $('output').value = ''; $('timing').textContent = '文章は外部に送信されません'; $('input').dispatchEvent(new Event('input')); $('input').focus(); };
$('swap').onclick = () => {
  if ($('source').value === 'auto') { status('入れ替える前に、原文の言語を選んでください。'); return; }
  const source = $('source').value;
  $('source').value = $('target').value; $('target').value = source;
  if ($('output').value && $('output').value.length <= 600) { $('input').value = $('output').value; $('output').value = ''; }
  $('input').dispatchEvent(new Event('input'));
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('output').value); status('訳文をコピーしました。'); }
  catch { $('output').focus(); $('output').select(); status('コピーできませんでした。選択された訳文を手動でコピーしてください。'); }
};
$('cancelDownload').onclick = () => downloadController?.abort();
$('stop').onclick = () => { translateController?.abort(); $('stop').disabled = true; status('翻訳を中止しています…'); };
$('prepare').onclick = async () => {
  if (busy || engine || !supported) return;
  busy = true; update();
  try {
    await modelLock(async () => {
      let file = await savedModel();
      if (!file) {
        const estimate = await navigator.storage.estimate();
        if (estimate.quota && estimate.quota - (estimate.usage || 0) < MODEL.bytes * 1.15) throw new Error('保存容量が足りません。端末の空き容量を増やして再試行してください。');
        downloadController = new AbortController();
        $('cancelDownload').hidden = false; $('progressArea').hidden = false;
        status('モデルをダウンロードしています。ページを開いたままお待ちください。');
        file = await downloadModel(downloadController.signal, (received,total) => {
          $('progress').value = received / total * 100;
          $('progressText').textContent = `${formatMB(received)} / ${formatMB(total)}（${Math.floor(received / total * 100)}%）`;
        });
        saved = true;
        // 自動削除されにくくする。許可されない場合も通常の保存で続行。
        try { await navigator.storage.persist?.(); } catch {}
      }
      saved = true; $('cancelDownload').hidden = true; update();
      status('モデルを端末のメモリに読み込んでいます…');
      const { Wllama } = await import('./vendor/wllama.js?v=3.13.0');
      const runtime = new Wllama({ default: new URL('./vendor/wllama.wasm?v=3.13.0', import.meta.url).href }, { suppressNativeLog: true });
      runtime.setCompat({ wasm: new URL('./vendor/compat.wasm?v=3.13.0', import.meta.url).href, worker: new URL('./vendor/compat.js?v=3.13.0', import.meta.url).href });
      try {
        await runtime.loadModel([file], { n_ctx: 2048, n_batch: 128, n_ubatch: 64, n_parallel: 1, n_threads: 1, n_gpu_layers: 0, warmup: false, ctx_shift: false });
        if (!runtime.getModelMetadata()?.hparams?.nVocab) throw new Error('モデルの読み込みを確認できませんでした。');
        engine = runtime;
      } catch (error) { await runtime.exit().catch(() => {}); throw error; }
      status('準備できました。文章を入力して翻訳できます。');
    });
  } catch (error) {
    if (error.name === 'AbortError') status('ダウンロードを中止しました。再開すると最初から取得します。');
    else status(error.name === 'QuotaExceededError' ? 'ブラウザの保存容量が足りません。空き容量を増やしてください。' : `準備できませんでした。${error.message} 読み込み時の失敗は、他のアプリを閉じて再試行してください。`, true);
    try { saved = !!await savedModel(); } catch { saved = false; }
  } finally { busy = false; downloadController = null; $('cancelDownload').hidden = true; $('progressArea').hidden = true; update(); }
};
$('remove').onclick = async () => {
  if (busy) return;
  busy = true; update();
  try { await modelLock(async () => { if (engine) { await engine.exit(); engine = null; } await removeModel(); saved = false; }); status('保存モデルを削除しました。次回は再ダウンロードします。'); }
  catch (error) { status(`削除できませんでした。${error.message}`, true); }
  finally { busy = false; update(); }
};
$('translate').onclick = async () => {
  if (!engine || busy) return;
  let prompt;
  try { prompt = buildPrompt($('input').value, $('source').value, $('target').value); }
  catch (error) { status(error.message, true); return; }
  busy = true; update(); $('output').value = ''; $('stop').hidden = false; $('stop').disabled = false;
  translateController = new AbortController();
  const start = performance.now(); let finishReason = null;
  status('端末内で翻訳しています…'); $('timing').textContent = '翻訳中…';
  try {
    await engine.createCompletion({ prompt, temperature: 0, max_tokens: 768, stop: ['<|plamo:tag|>','<|plamo:bos|>'], abortSignal: translateController.signal, stream: true,
      onData(chunk) { const choice = chunk.choices?.[0]; if (!choice) return; $('output').value += choice.text || ''; if (choice.finish_reason) finishReason = choice.finish_reason; }
    });
    if (translateController.signal.aborted) status('翻訳を中止しました。表示中の訳文は途中までの結果です。');
    else if (finishReason === 'length') status('訳文が生成上限に達しました。原文を短く分けて翻訳してください。', true);
    else if (!$('output').value.trim()) status('訳文を生成できませんでした。短い文章で再試行してください。', true);
    else status('翻訳しました。');
  } catch (error) {
    if (translateController.signal.aborted || error.name === 'AbortError') status('翻訳を中止しました。表示中の訳文は途中までの結果です。');
    else status(`翻訳できませんでした。文章を短くして再試行してください。${error.message}`, true);
  } finally { $('timing').textContent = `${((performance.now()-start)/1000).toFixed(1)}秒 · 端末内で処理`; translateController = null; busy = false; $('stop').hidden = true; update(); }
};
$('input').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!$('translate').disabled) $('translate').click(); } });
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
async function init() {
  try {
    if (!window.isSecureContext) throw new Error('HTTPSまたはlocalhostで開いてください。');
    if (!window.WebAssembly || !navigator.storage?.getDirectory) throw new Error('このブラウザは端末内モデル保存に対応していません。最新のChromeまたはSafariで開いてください。');
    const simd = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,22,1,20,0,253,12,...Array(16).fill(0),11]);
    if (!WebAssembly.validate(simd)) throw new Error('このブラウザは翻訳に必要なWebAssembly SIMDに対応していません。');
    if (typeof FileSystemFileHandle === 'undefined' || !FileSystemFileHandle.prototype.createWritable) throw new Error('このブラウザはモデルのストリーム保存に対応していません。最新のChromeまたはSafariで開いてください。');
    supported = true; saved = !!await savedModel();
    status(saved ? '保存済みモデルを読み込むと、オフラインで翻訳できます。' : '初回準備が必要です。モデルの取得中はインターネット接続を維持してください。');
  } catch (error) { supported = false; status(error.message, true); }
  update();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'OFFLINE_READY') $('offlineStatus').textContent = '✓ オフライン用ページを保存済み'; });
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Offline install timeout')), 60000)),
      ]);
      if (registration.active) registration.active.postMessage({ type: 'CHECK_OFFLINE' });
    } catch { $('offlineStatus').textContent = 'オフライン用ページを保存できませんでした。オンラインで再度開いてください。'; }
  } else $('offlineStatus').textContent = 'この環境ではページのオフライン保存に対応していません。';
}
init();
