import { Input, MP4, QTFF, BlobSource, EncodedPacketSink, Output, Mp4OutputFormat, StreamTarget, Conversion } from './vendor/mediabunny-1.64.0.min.mjs';
import { readOriginalMetadata, patchMovieMetadata, snappedRange } from './core.mjs';

let input, file, original, info, conversion, canceled = false;
let jobs = Promise.resolve();
const send = (type, data = {}) => postMessage({ type, ...data });
const checkCancel = () => { if (canceled) throw new DOMException('中止しました。', 'AbortError'); };
const tempDirectory = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('video-trimmer-v1', { create: true });
const validTemp = name => /^clip-[a-f0-9-]+\.mp4$/.test(name);

async function open(source) {
    input?.dispose(); input = null; info = null;
    file = source;
    if (file.size > 10 * 1024 ** 3) throw new Error('入力は10GiB以下の動画を選んでください。');
    original = await readOriginalMetadata(file);
    checkCancel();
    input = new Input({ formats: [MP4, QTFF], source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }) });
    const videos = await input.getVideoTracks();
    if (videos.length !== 1 || !['avc', 'hevc'].includes(await videos[0].getCodec())) throw new Error('H.264／HEVCの映像トラック1本に対応しています。');
    const video = videos[0], sink = new EncodedPacketSink(video);
    const duration = await video.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さを読み取れません。');
    const keys = [];
    let packet = await sink.getFirstKeyPacket({ metadataOnly: true });
    while (packet) {
        checkCancel();
        if (packet.timestamp >= 0 && packet.timestamp < duration) keys.push(packet.timestamp);
        if (keys.length > 500000) throw new Error('キーフレーム数が多すぎます。短い動画でお試しください。');
        if (keys.length % 256 === 0) {
            send('progress', { phase: 'index', progress: packet.timestamp / duration });
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const next = await sink.getNextKeyPacket(packet, { metadataOnly: true });
        if (next && next.sequenceNumber <= packet.sequenceNumber) throw new Error('キーフレーム情報が不正です。');
        packet = next;
    }
    keys.sort((a, b) => a - b);
    const uniqueKeys = [...new Set(keys)];
    if (!uniqueKeys.length) throw new Error('キーフレームが見つかりません。');
    const audio = await input.getAudioTracks();
    const codecs = await Promise.all(audio.map(track => track.getCodec()));
    const tags = await input.getMetadataTags();
    const dateSeconds = original.dates?.created;
    const created = tags.date?.toISOString() ?? (dateSeconds > 0 ? new Date((dateSeconds - 2082844800) * 1000).toISOString() : null);
    info = { duration, keys: uniqueKeys, codec: await video.getCodec(), audioCodecs: codecs, width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), rotation: await video.getRotation(), created };
    return info;
}

async function storageWriter(handle, temporary) {
    if (temporary) {
        const access = await handle.createSyncAccessHandle();
        access.truncate(0);
        return {
            async write(data, position) {
                let done = 0;
                while (done < data.length) {
                    const count = access.write(data.subarray(done), { at: position + done });
                    if (!count) throw new Error('一時領域への書き込みに失敗しました。空き容量を確認してください。');
                    done += count;
                }
            },
            async finish(size) { access.truncate(size); access.flush(); access.close(); },
            async abort() { access.close(); },
        };
    }
    const writable = await handle.createWritable();
    return {
        async write(data, position) { await writable.write({ type: 'write', data, position }); },
        async finish(size) { await writable.truncate(size); await writable.close(); },
        async abort() { await writable.abort(); },
    };
}

async function trim(options) {
    if (!input || !info) throw new Error('先に動画を選んでください。');
    const range = snappedRange(info.keys, info.duration, options.start, options.end);
    const temporary = !options.handle;
    let directory, name, handle, storage, moov, size = 0;
    let success = false;
    try {
        checkCancel();
        if (temporary) {
            directory = await tempDirectory();
            name = `clip-${crypto.randomUUID()}.mp4`;
            handle = await directory.getFileHandle(name, { create: true });
        } else handle = options.handle;
        storage = await storageWriter(handle, temporary);
        let lastYield = performance.now();
        const stream = new WritableStream({
            async write(chunk) {
                if (performance.now() - lastYield > 50) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                    lastYield = performance.now();
                }
                checkCancel();
                await storage.write(chunk.data, chunk.position);
                size = Math.max(size, chunk.position + chunk.data.length);
            },
        });
        const output = new Output({
            format: new Mp4OutputFormat({ fastStart: false, metadataFormat: 'mdta', onMoov(data, position) { moov = { data, position }; } }),
            target: new StreamTarget(stream, { chunked: true, chunkSize: 2 * 1024 ** 2 }),
        });
        conversion = await Conversion.init({
            input, output, trim: range,
            copy: { mode: 'forced', shiftTolerance: Infinity, boundaryPolicy: 'expand' },
            video: { allowTransformationMetadata: true, alpha: 'keep' },
            showWarnings: false,
        });
        checkCancel();
        const lost = conversion.discardedTracks;
        if (!conversion.isValid || lost.length || conversion.utilizedTracks.length !== (await input.getTracks()).length) {
            throw new Error('この動画の映像または音声を無変換で保存できません。音声を落とした出力や再エンコードは行いません。');
        }
        let lastUpdate = 0;
        conversion.onProgress = progress => {
            if (performance.now() - lastUpdate > 150) {
                lastUpdate = performance.now();
                send('progress', { phase: 'trim', progress: Math.min(progress, 0.99), size });
            }
        };
        await conversion.execute();
        checkCancel();
        if (!moov || moov.position + moov.data.length !== size) throw new Error('出力の管理情報を安全に更新できませんでした。');
        const patched = patchMovieMetadata(moov.data, original);
        await storage.write(patched, moov.position);
        size = moov.position + patched.length;
        await storage.finish(size); storage = null;
        if (temporary) {
            const record = { name, downloadName: options.downloadName, lastModified: file.lastModified, savedAt: Date.now(), range, size };
            const meta = await directory.getFileHandle(`${name}.json`, { create: true });
            const writer = await meta.createSyncAccessHandle();
            try {
                const bytes = new TextEncoder().encode(JSON.stringify(record));
                writer.truncate(0);
                if (writer.write(bytes, { at: 0 }) !== bytes.length) throw new Error('出力の復元情報を保存できませんでした。');
                writer.flush();
            } finally { writer.close(); }
            const result = await handle.getFile();
            success = true;
            return { ...record, file: result, temporary: true };
        }
        success = true;
        return { size, range, temporary: false };
    } finally {
        conversion = null;
        if (storage) await storage.abort().catch(() => {});
        if (!success && directory && name) {
            await directory.removeEntry(name).catch(() => {});
            await directory.removeEntry(`${name}.json`).catch(() => {});
        }
    }
}

async function listResults() {
    if (!navigator.storage?.getDirectory) return [];
    const directory = await tempDirectory(), results = [];
    for await (const [name, handle] of directory.entries()) {
        if (name.endsWith('.mp4.json') && validTemp(name.slice(0, -5))) {
            try {
                const record = JSON.parse(await (await handle.getFile()).text());
                if (record.name !== name.slice(0, -5)) continue;
                await directory.getFileHandle(record.name);
                results.push(record);
            } catch { /* 途中で中断された記録は復元対象にしない */ }
        }
    }
    const completed = new Set(results.map(record => record.name));
    for await (const [name, handle] of directory.entries()) {
        if (!validTemp(name) || completed.has(name)) continue;
        // 他タブで書き出し中ならロックが取れない。削除候補には含めない。
        let access;
        try {
            access = await handle.createSyncAccessHandle();
            const size = access.getSize();
            results.push({ name, downloadName: '中断された未完成の出力', size, savedAt: 0, incomplete: true });
        } catch { /* 別タブの処理中ファイルは触らない */ }
        finally { access?.close(); }
    }
    return results.sort((a, b) => b.savedAt - a.savedAt);
}

async function perform(data) {
    canceled = false;
    try {
        let result;
        if (data.type === 'open') result = await open(data.file);
        else if (data.type === 'trim') result = await trim(data);
        else if (data.type === 'list') result = await listResults();
        else if (data.type === 'recover' || data.type === 'delete') {
            if (!validTemp(data.name)) throw new Error('一時ファイル名が不正です。');
            const directory = await tempDirectory();
            if (data.type === 'recover') {
                const record = JSON.parse(await (await (await directory.getFileHandle(`${data.name}.json`)).getFile()).text());
                result = { ...record, temporary: true, file: await (await directory.getFileHandle(data.name)).getFile() };
            } else {
                // 別タブで書き出し中のファイルを削除しない。
                const handle = await directory.getFileHandle(data.name);
                const access = await handle.createSyncAccessHandle();
                access.close();
                await directory.removeEntry(data.name);
                await directory.removeEntry(`${data.name}.json`).catch(() => {});
                result = true;
            }
        } else throw new Error('処理が不明です。');
        send('reply', { id: data.id, result });
    } catch (error) {
        const message = error.name === 'QuotaExceededError' ? '端末内の一時領域が不足しました。空き容量を増やすか、短い範囲でお試しください。' : error.message;
        send('reply', { id: data.id, error: message, canceled: canceled || error.name === 'AbortError' });
    }
}

self.onmessage = ({ data }) => {
    if (data.type === 'cancel') {
        canceled = true;
        if (conversion) void conversion.cancel().catch(() => {});
    } else {
        // 復元一覧の読み込みと動画選択が重なった場合も、順番に扱う。
        jobs = jobs.then(() => perform(data));
    }
};
