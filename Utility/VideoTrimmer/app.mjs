import { snappedRange } from './core.mjs';

const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
let nextId = 0, pending = new Map(), busy = false, workerFailed = false, info, sourceFile, points, startIndex = 0, endIndex = 1;
let sourceUrl, resultUrl, resultFile, resultRecord, playingRange = false, wakeLock;
const hasDirectSave = typeof window.showSaveFilePicker === 'function';
const hasTemporarySave = !!navigator.storage?.getDirectory;
const sizeText = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
const timeText = n => {
    const ms = Math.max(0, Math.round(n * 1000));
    const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
    return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:` : ''}${minutes >= 60 ? String(minutes % 60).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
function parseTime(value) {
    const parts = value.trim().split(':');
    if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+(?:\.\d+)?$/.test(p))) throw new Error('時刻は「分:秒」または秒数で入力してください。');
    return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function ask(type, data = {}) {
    if (workerFailed) return Promise.reject(new Error('処理用ワーカーが停止しています。ページを開き直してください。'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { worker.postMessage({ type, id, ...data }); }
        catch (error) { pending.delete(id); reject(error); }
    });
}
worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
        $('progress').value = data.progress;
        status(data.phase === 'index' ? `キーフレームを確認中… ${Math.floor(data.progress * 100)}%` : `無再エンコードで書き出し中… ${Math.floor(data.progress * 100)}%${data.size ? ` / ${sizeText(data.size)}` : ''}`);
    } else if (data.type === 'reply') {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(Object.assign(new Error(data.error), { name: data.canceled ? 'AbortError' : 'Error' }));
        else job.resolve(data.result);
    }
};
worker.onerror = event => {
    workerFailed = true;
    for (const job of pending.values()) job.reject(new Error(`処理用ワーカーが停止しました。ページを開き直してください。${event.message || ''}`));
    pending.clear();
    status('処理用ワーカーを起動できませんでした。ページを開き直してください。', true);
};
function setBusy(value) {
    busy = value;
    for (const element of document.querySelectorAll('#editor button, #editor input, #exportPanel button, #exportPanel select, #recovery button, #deleteResult, #file')) element.disabled = value;
    $('cancel').hidden = !value;
    $('cancel').disabled = false;
    $('progress').hidden = !value;
    if (value) $('progress').value = 0;
}
async function wake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* iOSなどで利用不可でも処理できる */ }
}
async function releaseWake() { await wakeLock?.release().catch(() => {}); wakeLock = null; }
function seek(time) {
    playingRange = false;
    $('preview').pause();
    try { $('preview').currentTime = Math.min(time, Math.max(0, info.duration - 0.001)); } catch { /* 再生未対応でも範囲指定は可能 */ }
}
function refreshSelection(seekTo) {
    $('start').value = startIndex; $('end').value = endIndex;
    $('startTime').value = timeText(points[startIndex]); $('endTime').value = timeText(points[endIndex]);
    $('start').setAttribute('aria-valuetext', timeText(points[startIndex]));
    $('end').setAttribute('aria-valuetext', timeText(points[endIndex]));
    $('selectionFill').style.marginLeft = `${points[startIndex] / info.duration * 100}%`;
    $('selectionFill').style.width = `${(points[endIndex] - points[startIndex]) / info.duration * 100}%`;
    $('clipDuration').textContent = timeText(points[endIndex] - points[startIndex]);
    $('sizeEstimate').textContent = `出力の概算 ${sizeText(sourceFile.size * (points[endIndex] - points[startIndex]) / info.duration)}`;
    if (seekTo !== undefined) seek(seekTo);
}
function setBoundary(which, index, preview = true) {
    if (which === 'start') startIndex = Math.max(0, Math.min(index, endIndex - 1));
    else endIndex = Math.max(startIndex + 1, Math.min(index, points.length - 1));
    refreshSelection(preview ? points[which === 'start' ? startIndex : endIndex] : undefined);
}
function boundaryFromTime(which, time) {
    time = Math.min(info.duration, Math.max(0, time));
    const range = which === 'start'
        ? snappedRange(info.keys, info.duration, Math.min(time, points[endIndex] - 0.001), points[endIndex])
        : snappedRange(info.keys, info.duration, points[startIndex], Math.max(time, points[startIndex] + 0.001));
    const value = which === 'start' ? range.start : range.end;
    setBoundary(which, points.findIndex(p => Math.abs(p - value) < 1e-6));
}
async function refreshStorage() {
    if ($('saveMode').value === 'direct') { $('storageInfo').textContent = '保存先を選んで直接書き出します。ブラウザ内の一時出力は作りません。元動画と違うファイル名で保存してください。'; return; }
    try {
        const estimate = await navigator.storage.estimate();
        $('storageInfo').textContent = `ブラウザの保存枠の残り（概算）: ${sizeText(Math.max(0, estimate.quota - estimate.usage))}。端末の実際の空き容量とは異なります。`;
    } catch { $('storageInfo').textContent = '端末内の一時領域に出力します。保存枠・空き容量が足りない場合はエラーになります。'; }
}
async function loadFile(file) {
    if (!file || busy) return;
    setBusy(true); info = null;
    $('editor').hidden = true; $('exportPanel').hidden = true;
    $('preview').pause(); $('preview').removeAttribute('src'); $('preview').load();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
    $('fileInfo').hidden = false;
    $('fileInfo').textContent = `${file.name} / ${sizeText(file.size)}`;
    status('動画の管理情報とキーフレームを読み込み中…');
    try {
        info = await ask('open', { file }); sourceFile = file;
        points = [...info.keys, info.duration]; startIndex = 0; endIndex = points.length - 1;
        $('start').max = points.length - 2; $('end').max = points.length - 1;
        sourceUrl = URL.createObjectURL(file);
        $('previewHint').hidden = true;
        $('preview').src = sourceUrl;
        $('preview').load();
        $('fileInfo').textContent = `${file.name} / ${sizeText(file.size)} / ${info.codec === 'hevc' ? 'HEVC' : 'H.264'} / ${info.width} × ${info.height} / ${timeText(info.duration)} / キーフレーム ${info.keys.length}個 / 音声 ${info.audioCodecs.join(', ') || 'なし'}`;
        $('dateInfo').textContent = info.created ? `動画内の元の作成日時: ${new Date(info.created).toLocaleString('ja-JP')}。動画内の日時情報を引き継ぎます。ファイル自体の日時は保存時の値になる場合があります。` : '読み取れる動画内の日時タグを引き継ぎます。ファイル自体の日時は保存時の値になる場合があります。';
        $('editor').hidden = false; $('exportPanel').hidden = false;
        refreshSelection(); await refreshStorage();
        status('スライダー、時刻入力、または再生位置から範囲を選んでください。');
        if (!hasTemporarySave && !hasDirectSave) status('このブラウザは大容量保存に必要なAPIに対応していません。最新のiOS／ブラウザで開いてください。', true);
    } catch (error) { status(error.message, error.name !== 'AbortError'); }
    finally { setBusy(false); }
}
function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; resultFile = null; resultRecord = null;
    $('result').hidden = true; $('download').removeAttribute('href');
}
function showResult(record) {
    clearResult(); resultRecord = record;
    $('result').hidden = false;
    $('resultInfo').textContent = `${record.downloadName || '保存先への書き出し完了'} / ${sizeText(record.size)} / 元動画の ${timeText(record.range.start)} 〜 ${timeText(record.range.end)}`;
    $('saveActions').hidden = !record.temporary;
    $('deleteResult').hidden = !record.temporary;
    $('savedNote').hidden = !record.temporary;
    if (record.temporary) {
        resultFile = new File([record.file], record.downloadName, { type: 'video/mp4', lastModified: record.lastModified });
        resultUrl = URL.createObjectURL(resultFile);
        $('download').href = resultUrl; $('download').download = record.downloadName;
        try { $('share').hidden = !navigator.canShare?.({ files: [resultFile] }); }
        catch { $('share').hidden = true; }
        $('saveHint').textContent = $('share').hidden
            ? '「ファイルをダウンロード」から保存してください。動画が開いた場合はブラウザの共有から「ファイルに保存」を選んでください。大容量ではiOS側の保存が失敗することがあります。'
            : '「共有して保存」→「ファイルに保存」を選べます。「ビデオを保存」が表示される場合は「写真」にも保存できます。大容量で共有できないときはダウンロードをお試しください。';
    } else $('saveHint').textContent = '選んだ保存先への書き出しが完了しました。保存先で再生を確認してください。';
}
async function refreshRecovery() {
    if (!hasTemporarySave || busy) return;
    try {
        const records = await ask('list');
        $('recoveryList').replaceChildren(); $('recovery').hidden = !records.length;
        for (const record of records) {
            const row = document.createElement('div'); row.className = 'recovery-row';
            const label = document.createElement('span'); label.textContent = `${record.downloadName} / ${sizeText(record.size)}`;
            const recover = document.createElement('button'); recover.type = 'button'; recover.textContent = '保存する';
            recover.addEventListener('click', async () => {
                if (busy) return;
                setBusy(true);
                try { showResult(await ask('recover', { name: record.name })); status('一時出力を復元しました。保存方法を選んでください。'); $('result').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                catch (error) { status(error.message, true); }
                finally { setBusy(false); }
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '削除';
            remove.addEventListener('click', () => deleteTemp(record));
            if (record.incomplete) recover.hidden = true;
            row.append(label, recover, remove); $('recoveryList').append(row);
        }
    } catch { /* プライベートブラウズ等でOPFSが使えない場合は実行時に案内 */ }
}
async function deleteTemp(record) {
    if (busy) return;
    setBusy(true);
    try {
        await ask('delete', { name: record.name });
        if (resultRecord?.name === record.name) clearResult();
        status('端末内の一時出力を削除しました。保存先のファイルは削除しません。');
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); await refreshRecovery(); }
}

$('file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; loadFile(file); });
for (const type of ['dragover', 'dragleave', 'drop']) $('dropArea').addEventListener(type, event => {
    event.preventDefault(); $('dropArea').classList.toggle('dragover', type === 'dragover');
    if (type === 'drop') loadFile(event.dataTransfer.files[0]);
});
for (const which of ['start', 'end']) {
    $(which).addEventListener('input', () => setBoundary(which, Number($(which).value)));
    $(`${which}Prev`).addEventListener('click', () => setBoundary(which, (which === 'start' ? startIndex : endIndex) - 1));
    $(`${which}Next`).addEventListener('click', () => setBoundary(which, (which === 'start' ? startIndex : endIndex) + 1));
    $(`${which}Here`).addEventListener('click', () => boundaryFromTime(which, $('preview').currentTime));
    $(`${which}Time`).addEventListener('change', () => {
        try { boundaryFromTime(which, parseTime($(`${which}Time`).value)); }
        catch (error) { status(error.message, true); refreshSelection(); }
    });
}
$('preview').addEventListener('timeupdate', () => {
    $('playTime').textContent = timeText($('preview').currentTime);
    if (playingRange && $('preview').currentTime >= points[endIndex]) { $('preview').pause(); playingRange = false; }
});
$('preview').addEventListener('error', () => { if (sourceUrl) $('previewHint').hidden = false; });
$('previewRange').addEventListener('click', async () => {
    seek(points[startIndex]); playingRange = true;
    try { await $('preview').play(); } catch { playingRange = false; $('previewHint').hidden = false; }
});
$('saveMode').addEventListener('change', refreshStorage);
$('directOption').disabled = !hasDirectSave;
$('saveMode').value = hasDirectSave ? 'direct' : 'temporary';
if (!hasTemporarySave) $('saveMode').querySelector('[value=temporary]').disabled = true;
$('cancel').addEventListener('click', () => { worker.postMessage({ type: 'cancel' }); $('cancel').disabled = true; status('中止しています…'); });
$('export').addEventListener('click', async () => {
    if (busy || !info) return;
    setBusy(true); $('preview').pause(); playingRange = false;
    const start = points[startIndex], end = points[endIndex];
    const base = sourceFile.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'video';
    const downloadName = `${base}_trim_${start.toFixed(3)}-${end.toFixed(3)}.mp4`;
    try {
        let handle;
        if ($('saveMode').value === 'direct') {
            // ユーザー操作直後に呼ぶ。非同期処理を挟むと保存ダイアログを開けない。
            handle = await window.showSaveFilePicker({ suggestedName: downloadName, types: [{ description: 'MP4動画', accept: { 'video/mp4': ['.mp4'] } }] });
            if (handle.name === sourceFile.name) throw new Error('元動画の上書きを避けるため、別のファイル名で保存してください。');
        } else {
            if (!hasTemporarySave) throw new Error('端末内の一時領域を利用できません。最新のiOS／ブラウザをお試しください。');
            await navigator.storage.persist?.().catch(() => false);
        }
        await wake();
        clearResult();
        status('無再エンコードで書き出しを準備中…');
        const record = await ask('trim', { start, end, handle, downloadName });
        showResult(record); status('切り出しが完了しました。');
        $('result').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) { status(error.name === 'AbortError' ? '処理を中止しました。元動画は変更していません。' : error.message, error.name !== 'AbortError'); }
    finally { await releaseWake(); setBusy(false); await refreshRecovery(); }
});
$('share').addEventListener('click', async () => {
    try { await navigator.share({ files: [resultFile] }); status('共有画面を閉じました。保存先で再生を確認してください。'); }
    catch (error) { if (error.name !== 'AbortError') status('共有できませんでした。「ファイルをダウンロード」をお試しください。', true); }
});
$('download').addEventListener('click', () => status('保存を開始します。完了後、保存先で再生できることを確認してください。'));
$('deleteResult').addEventListener('click', () => deleteTemp(resultRecord));
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && busy) wake(); });
await refreshRecovery();
