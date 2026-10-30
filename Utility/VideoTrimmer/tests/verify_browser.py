"""実動画をブラウザで切り出し、FFprobeでパケット・日時・向き・HDRを検証する。"""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import ctypes
import json
import os
from pathlib import Path
import struct
import subprocess
import threading

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
ARTIFACTS = REPO / '.local' / 'video-trimmer'
CONTAINERS = {b'moov', b'trak', b'mdia', b'minf', b'stbl'}


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, encoding='utf-8').stdout


def probe(path):
    return json.loads(run('ffprobe', '-v', 'error', '-show_packets', '-show_data_hash', 'sha256', '-show_streams', '-show_format', '-of', 'json', str(path)))


def boxes(data):
    pos = 0
    while pos < len(data):
        size, kind = struct.unpack_from('>I4s', data, pos)
        header = 8
        if size == 1:
            size = struct.unpack_from('>Q', data, pos + 8)[0]
            header = 16
        if not size:
            size = len(data) - pos
        assert size >= header and pos + size <= len(data)
        yield kind, data[pos:pos + size], header
        pos += size


def offset_moov(data, delta):
    result = b''
    for kind, body, header in boxes(data):
        if kind in CONTAINERS:
            payload = offset_moov(body[header:], delta)
            result += struct.pack('>I4s', 8 + len(payload), kind) + payload
        elif kind == b'stco':
            count = struct.unpack_from('>I', body, header + 4)[0]
            offsets = struct.unpack_from(f'>{count}I', body, header + 8)
            payload = body[header:header + 8] + b''.join(struct.pack('>Q', n + delta) for n in offsets)
            result += struct.pack('>I4s', 8 + len(payload), b'co64') + payload
        else:
            result += body
    return result


def sparse_large_fixture(source, destination):
    """9GiBのfree boxと64bitチャンクオフセット。実データは小さくディスクも圧迫しない。"""
    padding = 9 * 1024 ** 3
    original = list(boxes(source.read_bytes()))
    assert original[0][0] == b'ftyp' and original[-1][0] == b'moov'
    with destination.open('wb') as target:
        if os.name == 'nt':
            import msvcrt
            returned = ctypes.c_ulong()
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.DeviceIoControl.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.c_void_p]
            ok = kernel.DeviceIoControl(msvcrt.get_osfhandle(target.fileno()), 0x900C4, None, 0, None, 0, ctypes.byref(returned), None)
            if not ok:
                raise OSError(ctypes.get_last_error(), 'sparse file creation failed')
        target.write(original[0][1])
        target.write(struct.pack('>I4sQ', 1, b'free', padding))
        target.seek(len(original[0][1]) + padding)
        for kind, body, _ in original[1:]:
            target.write(offset_moov(body, padding) if kind == b'moov' else body)


def video_stsd(data):
    def descend(payload, video=False):
        for kind, body, header in boxes(payload):
            if kind == b'trak':
                video = b'vide' in body
            if kind == b'stsd' and video:
                return body
            if kind in CONTAINERS:
                found = descend(body[header:], video)
                if found:
                    return found
    return descend(data)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@contextmanager
def server():
    http = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(REPO)))
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{http.server_port}'
    finally:
        http.shutdown()
        http.server_close()
        thread.join()


def fixtures():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    avc = ARTIFACTS / 'avc.mp4'
    run('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'creation_time=2020-02-03T04:05:06Z', '-y', str(avc))
    portrait = ARTIFACTS / 'portrait.mov'
    run('ffmpeg', '-v', 'error', '-i', str(avc), '-c', 'copy', '-metadata:s:v', 'rotate=90', '-y', str(portrait))
    hevc = ARTIFACTS / 'hevc-hdr.mp4'
    run('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=192x108:rate=24', '-t', '6', '-c:v', 'libx265', '-x265-params', 'log-level=error:keyint=48:min-keyint=48:scenecut=0:pools=1', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-metadata', 'creation_time=2021-05-06T07:08:09Z', '-y', str(hevc))
    vfr = ARTIFACTS / 'variable-fps.mp4'
    run('ffmpeg', '-v', 'error', '-i', str(avc), '-vf', "select='if(lt(t,4),not(mod(n,2)),1)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-force_key_frames', 'expr:gte(t,n_forced*2)', '-c:a', 'copy', '-y', str(vfr))
    unsupported = ARTIFACTS / 'unsupported-audio.mov'
    run('ffmpeg', '-v', 'error', '-i', str(avc), '-c:v', 'copy', '-c:a', 'pcm_u8', '-y', str(unsupported))
    large = ARTIFACTS / 'large-co64.mp4'
    sparse_large_fixture(avc, large)
    bad = ARTIFACTS / 'invalid.mov'
    bad.write_bytes(b'not a movie')
    return avc, portrait, hevc, vfr, unsupported, large, bad


def load(page, path):
    page.locator('#file').set_input_files(str(path))
    expect(page.locator('#editor')).to_be_visible(timeout=30000)
    expect(page.locator('#export')).to_be_enabled(timeout=30000)


def output(page, path, start=2.3, end=4.1):
    page.locator('#startTime').fill(str(start))
    page.locator('#startTime').dispatch_event('change')
    page.locator('#endTime').fill(str(end))
    page.locator('#endTime').dispatch_event('change')
    assert page.locator('#startTime').input_value() == '0:02.000'
    assert page.locator('#endTime').input_value() == '0:06.000'
    page.locator('#saveMode').select_option('temporary')
    page.locator('#export').click()
    expect(page.locator('#result')).to_be_visible(timeout=30000)
    expect(page.locator('#export')).to_be_enabled(timeout=30000)
    assert '完了' in page.locator('#status').inner_text(), page.locator('#status').inner_text()
    with page.expect_download() as download:
        page.locator('#download').click()
    download.value.save_as(str(path))


def verify_packets(source, output_path, check_stsd=True):
    before, after = probe(source), probe(output_path)
    assert len(before['streams']) == len(after['streams'])
    assert 3.9 <= float(after['format']['duration']) <= 4.1
    for old, new in zip(before['streams'], after['streams']):
        assert old['codec_name'] == new['codec_name']
        old_packets = [p for p in before['packets'] if p['stream_index'] == old['index']]
        new_packets = [p for p in after['packets'] if p['stream_index'] == new['index']]
        hashes = [p['data_hash'] for p in old_packets]
        selected = [p['data_hash'] for p in new_packets]
        assert selected and all(h in hashes for h in selected), f"再エンコードの疑い: {old['codec_name']}"
        begin = hashes.index(selected[0])
        assert hashes[begin:begin + len(selected)] == selected, '圧縮パケットの欠落・並べ替え'
        if old['codec_type'] == 'video':
            assert 'K' in new_packets[0]['flags']
            if old.get('tags', {}).get('creation_time'):
                assert old['tags']['creation_time'] == new.get('tags', {}).get('creation_time')
            for key in ('color_space', 'color_transfer', 'color_primaries'):
                assert old.get(key) == new.get(key)
            assert old.get('side_data_list', []) == new.get('side_data_list', [])
    run('ffmpeg', '-v', 'error', '-i', str(output_path), '-f', 'null', '-')
    if check_stsd:
        assert video_stsd(source.read_bytes()) == video_stsd(output_path.read_bytes()), 'HDR等の映像形式情報が変化'


def main():
    avc, portrait, hevc, vfr, unsupported, large, invalid = fixtures()
    checks, errors, external = [], [], []
    with server() as base, sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width': 1200, 'height': 1000}, accept_downloads=True)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) and not request.url.startswith(base + '/') else None)
        assert page.goto(base + '/Utility/VideoTrimmer/').status == 200
        load(page, avc)
        assert 'H.264' in page.locator('#fileInfo').inner_text()
        page.locator('#startTime').fill('bad')
        page.locator('#startTime').dispatch_event('change')
        assert '時刻' in page.locator('#status').inner_text()
        page.locator('#startNext').click()
        assert page.locator('#startTime').input_value() == '0:02.000'
        page.locator('#startPrev').click()
        trimmed = ARTIFACTS / 'trim-avc.mp4'
        output(page, trimmed)
        verify_packets(avc, trimmed)
        checks.append('H.264 + AAC / Bフレーム / キーフレーム補正 / 全パケットSHA-256一致 / 日時')
        page.screenshot(path=str(ARTIFACTS / 'desktop.png'), full_page=True)
        page.reload()
        expect(page.locator('#recovery')).to_be_visible()
        page.locator('#recoveryList button').first.click()
        expect(page.locator('#result')).to_be_visible()
        page.locator('#deleteResult').click()
        expect(page.locator('#result')).to_be_hidden()
        expect(page.locator('#recovery')).to_be_hidden()
        checks.append('OPFS出力の再読み込み・復元・削除')
        for source, name in [(portrait, 'portrait'), (hevc, 'hevc-hdr'), (vfr, 'variable-fps'), (large, 'large-co64')]:
            load(page, source)
            result = ARTIFACTS / f'trim-{name}.mp4'
            output(page, result)
            verify_packets(source, result, check_stsd=source != large)
            checks.append(f'{name}: 無変換・再生・音声／色／向き検証')
            page.locator('#deleteResult').click()
            expect(page.locator('#result')).to_be_hidden()
        # PCのFileSystemFileHandle経由の書き出しを、テスト専用のOPFSファイルへ実行。
        load(page, avc)
        page.evaluate("""async () => {
            const root = await navigator.storage.getDirectory();
            const h = await root.getFileHandle('direct-test.mp4', {create:true});
            window.showSaveFilePicker = async () => h;
        }""")
        page.locator('#startTime').fill('2')
        page.locator('#startTime').dispatch_event('change')
        page.locator('#endTime').fill('6')
        page.locator('#endTime').dispatch_event('change')
        page.locator('#saveMode').select_option('direct')
        page.locator('#export').click()
        expect(page.locator('#result')).to_be_visible(timeout=30000)
        expect(page.locator('#saveActions')).to_be_hidden()
        direct_bytes = page.evaluate("""async () => {
            const root = await navigator.storage.getDirectory();
            const f = await (await root.getFileHandle('direct-test.mp4')).getFile();
            return Array.from(new Uint8Array(await f.arrayBuffer()));
        }""")
        direct = ARTIFACTS / 'trim-direct.mp4'
        direct.write_bytes(bytes(direct_bytes))
        verify_packets(avc, direct)
        checks.append('PC直接保存経路（FileSystemFileHandle）')
        # 保存枠不足を実際の書き込み層で発生させ、エラー表示・後始末を確認。
        page.workers[0].evaluate("""() => {
            self.originalWrite = FileSystemSyncAccessHandle.prototype.write;
            FileSystemSyncAccessHandle.prototype.write = () => { throw new DOMException('test quota','QuotaExceededError'); };
        }""")
        page.locator('#saveMode').select_option('temporary')
        page.locator('#export').click()
        expect(page.locator('#status')).to_have_class('error', timeout=30000)
        assert '不足' in page.locator('#status').inner_text()
        expect(page.locator('#file')).to_be_enabled()
        page.workers[0].evaluate('() => { FileSystemSyncAccessHandle.prototype.write = self.originalWrite; }')
        checks.append('保存枠不足のエラー・操作復帰・未完成出力の後始末')
        canceled = page.evaluate("""async () => {
            const worker = new Worker('./worker.mjs', {type:'module'});
            const jobs = new Map(); let id=0;
            worker.onmessage = ({data}) => { if(data.type==='reply') jobs.get(data.id)(data); };
            const ask = (type, extra={}) => new Promise(resolve => {
                const key=++id; jobs.set(key,resolve); worker.postMessage({id:key,type,...extra});
            });
            const blob = await (await fetch('/.local/video-trimmer/avc.mp4')).blob();
            const opened = await ask('open',{file:new File([blob],'test.mp4')});
            if(opened.error) throw new Error(opened.error);
            const result = ask('trim',{start:2,end:6,downloadName:'cancel.mp4'});
            worker.postMessage({type:'cancel'});
            const reply = await result;
            const list = await ask('list');
            worker.terminate();
            return {canceled:reply.canceled, records:list.result};
        }""")
        assert canceled['canceled'] and not canceled['records'], canceled
        checks.append('処理中止・中止した一時出力の削除')
        page.evaluate("""async () => {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('video-trimmer-v1');
            const handle = await dir.getFileHandle('clip-00000000-0000.mp4',{create:true});
            const writer = await handle.createWritable(); await writer.write('incomplete'); await writer.close();
        }""")
        page.reload()
        expect(page.locator('#recovery')).to_be_visible()
        assert '未完成' in page.locator('#recoveryList').inner_text()
        page.locator('#recoveryList button').last.click()
        expect(page.locator('#recovery')).to_be_hidden()
        checks.append('ページ中断で残った未完成ファイルの検出・削除')
        load(page, unsupported)
        page.locator('#saveMode').select_option('temporary')
        page.locator('#export').click()
        expect(page.locator('#status')).to_have_class('error', timeout=30000)
        assert '無変換' in page.locator('#status').inner_text()
        expect(page.locator('#result')).to_be_hidden()
        checks.append('未対応の音声はエラーで停止（無音化・再エンコードを防止）')
        page.locator('#file').set_input_files(str(invalid))
        expect(page.locator('#status')).to_have_class('error', timeout=10000)
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#file')).to_be_enabled()
        checks.append('不正な入力のエラーと再操作')
        # iPhone相当の幅、直接保存APIなし、共有APIあり。実機のWebKit検証ではない。
        mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        mobile.add_init_script("""Object.defineProperty(window,'showSaveFilePicker',{value:undefined});
            Object.defineProperty(navigator,'canShare',{value:()=>true});
            Object.defineProperty(navigator,'share',{value:async data=>{window.sharedName=data.files[0].name;}});""")
        phone = mobile.new_page()
        phone.goto(base + '/Utility/VideoTrimmer/')
        load(phone, avc)
        assert phone.locator('#saveMode').input_value() == 'temporary'
        assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
        output(phone, ARTIFACTS / 'trim-mobile.mp4')
        phone.locator('#share').click()
        assert '_trim_' in phone.evaluate('window.sharedName')
        phone.screenshot(path=str(ARTIFACTS / 'mobile.png'), full_page=True)
        checks.append('モバイル幅・直接保存APIなしの分岐・共有へのファイル受け渡し')
        mobile.close()
        assert not errors, errors
        assert not external, external
        checks.append('ページエラーなし・外部へのHTTP通信なし')
        browser.close()
    result = {'checks': checks, 'errors': errors, 'external_requests': external, 'limits': 'iPhone実機・10GB級の実データ出力とiOS共有／ダウンロードは未検証。9GiB入力は疎ファイルで64bit位置を検証。'}
    (ARTIFACTS / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
