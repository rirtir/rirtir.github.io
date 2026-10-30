// MOV/MP4のヘッダーだけを読む。mdat（映像本体）はメモリに読み込まない。
const MAX_METADATA = 128 * 1024 * 1024;
const text = bytes => String.fromCharCode(...bytes);
const u64 = (view, offset) => {
    const value = Number(view.getBigUint64(offset));
    if (!Number.isSafeInteger(value)) throw new Error('ファイルの位置情報が大きすぎます。');
    return value;
};

export async function fileBoxes(file, start = 0, end = file.size) {
    const boxes = [];
    while (start < end) {
        if (boxes.length > 100000 || end - start < 8) throw new Error('MOV/MP4の構造が不正です。');
        const bytes = new Uint8Array(await file.slice(start, Math.min(start + 16, end)).arrayBuffer());
        const view = new DataView(bytes.buffer);
        let size = view.getUint32(0), header = 8;
        if (size === 1) { if (bytes.length < 16) throw new Error('ヘッダーが欠けています。'); size = u64(view, 8); header = 16; }
        if (size === 0) size = end - start;
        if (size < header || start + size > end) throw new Error('MOV/MP4のサイズ情報が不正です。');
        boxes.push({ type: text(bytes.subarray(4, 8)), start, end: start + size, header, size });
        start += size;
    }
    return boxes;
}

async function child(file, parent, type) {
    return (await fileBoxes(file, parent.start + parent.header, parent.end)).find(box => box.type === type);
}

export async function readOriginalMetadata(file) {
    const roots = await fileBoxes(file);
    const moov = roots.find(box => box.type === 'moov');
    if (!moov || roots.some(box => box.type === 'moof')) throw new Error('通常のMOV/MP4を選んでください。分割MP4には未対応です。');
    if (moov.size > MAX_METADATA) throw new Error('管理情報が128MiBを超えるため、この動画は扱えません。');
    const children = await fileBoxes(file, moov.start + moov.header, moov.end);
    const mvhd = children.find(box => box.type === 'mvhd');
    let dates = null;
    if (mvhd) {
        const b = await file.slice(mvhd.start + mvhd.header, Math.min(mvhd.end, mvhd.start + mvhd.header + 24)).arrayBuffer();
        const v = new DataView(b), wide = v.getUint8(0) === 1;
        dates = { created: wide ? u64(v, 4) : v.getUint32(4), modified: wide ? u64(v, 12) : v.getUint32(8) };
    }
    const entries = [];
    for (const trak of children.filter(box => box.type === 'trak')) {
        const mdia = await child(file, trak, 'mdia');
        if (!mdia) continue;
        const hdlr = await child(file, mdia, 'hdlr');
        if (!hdlr) continue;
        const kind = text(new Uint8Array(await file.slice(hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12).arrayBuffer()));
        if (kind !== 'vide') continue;
        const minf = await child(file, mdia, 'minf');
        const stbl = minf && await child(file, minf, 'stbl');
        const stsd = stbl && await child(file, stbl, 'stsd');
        if (!stsd || stsd.size > 1024 * 1024) throw new Error('映像の形式情報を読み取れません。');
        const bytes = new Uint8Array(await file.slice(stsd.start, stsd.end).arrayBuffer());
        const count = new DataView(bytes.buffer).getUint32(stsd.header + 4);
        const codec = text(bytes.subarray(stsd.header + 12, stsd.header + 16));
        if (count !== 1 || !['avc1', 'avc3', 'hvc1', 'hev1'].includes(codec)) {
            throw new Error('H.264／HEVCの通常動画に対応しています。ProRes・暗号化・形式が途中で変わる動画には未対応です。');
        }
        entries.push(bytes);
    }
    if (entries.length !== 1) throw new Error('映像トラックが1本の動画を選んでください。空間ビデオなどの特殊形式は未対応です。');
    return { dates, videoStsd: entries[0] };
}

// 出力のmoovは末尾に置く。stsdの長さが変わっても映像本体のオフセットは変わらない。
// 元の映像sample entryを保持して、colr / hvcC / Dolby Vision等の拡張情報を引き継ぐ。
export function patchMovieMetadata(bytes, original) {
    const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
    function parse(start, end) {
        const out = [];
        while (start < end) {
            const v = new DataView(bytes.buffer, bytes.byteOffset + start, end - start);
            let size = v.getUint32(0), header = 8;
            if (size === 1) { size = u64(v, 8); header = 16; }
            if (size === 0) size = end - start;
            if (size < header || start + size > end) throw new Error('出力の管理情報が不正です。');
            out.push({ type: text(bytes.subarray(start + 4, start + 8)), start, end: start + size, header });
            start += size;
        }
        return out;
    }
    let videoCount = 0;
    function rebuild(box, isVideo = false) {
        if (box.type === 'stsd' && isVideo) { videoCount++; return original.videoStsd; }
        if (!containers.has(box.type)) {
            const copy = bytes.slice(box.start, box.end);
            if (original.dates && ['mvhd', 'tkhd', 'mdhd'].includes(box.type)) {
                const v = new DataView(copy.buffer), wide = v.getUint8(box.header) === 1;
                const { created, modified } = original.dates;
                // 不明な日時(0)や、version 0に収まらない未来の日付は書き換えない。
                for (const [offset, value] of [[4, created], [wide ? 12 : 8, modified]]) {
                    if (value > 0 && (wide || value <= 0xffffffff)) {
                        if (wide) v.setBigUint64(box.header + offset, BigInt(value));
                        else v.setUint32(box.header + offset, value);
                    }
                }
            }
            return copy;
        }
        const children = parse(box.start + box.header, box.end);
        if (box.type === 'trak') {
            const mdia = children.find(b => b.type === 'mdia');
            const hdlr = mdia && parse(mdia.start + mdia.header, mdia.end).find(b => b.type === 'hdlr');
            isVideo = !!hdlr && text(bytes.subarray(hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12)) === 'vide';
        }
        const parts = children.map(b => rebuild(b, isVideo));
        const size = box.header + parts.reduce((n, b) => n + b.length, 0);
        if (size > MAX_METADATA) throw new Error('出力の管理情報が大きすぎます。');
        const out = new Uint8Array(size);
        out.set(bytes.subarray(box.start, box.start + box.header));
        const v = new DataView(out.buffer);
        if (box.header === 16) v.setBigUint64(8, BigInt(size)); else v.setUint32(0, size);
        let position = box.header;
        for (const part of parts) { out.set(part, position); position += part.length; }
        return out;
    }
    const roots = parse(0, bytes.length);
    if (roots.length !== 1 || roots[0].type !== 'moov') throw new Error('出力のmoovが見つかりません。');
    const result = rebuild(roots[0]);
    if (videoCount !== 1) throw new Error('映像形式情報を安全に引き継げませんでした。');
    return result;
}

export function snappedRange(keys, duration, start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.001 || start >= end) {
        throw new Error('開始と終了の範囲を確認してください。');
    }
    let lo = 0, hi = keys.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (keys[m] <= start + 1e-6) lo = m + 1; else hi = m; }
    const a = keys[Math.max(0, lo - 1)];
    lo = 0; hi = keys.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (keys[m] < end - 1e-6) lo = m + 1; else hi = m; }
    const b = lo < keys.length ? keys[lo] : duration;
    if (a === undefined || b <= a) throw new Error('切り出せるキーフレームがありません。');
    return { start: a, end: b };
}
