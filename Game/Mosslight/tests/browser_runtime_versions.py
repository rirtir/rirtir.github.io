"""実キャッシュの回帰: 長期キャッシュに旧コードが残った継続ブラウザでも、不変スナップショット(runtime/<版>/)のimportmapで揃うことを確認する。

- ローカルHTTPサーバと、使い捨ての隔離Chromeプロファイルだけを使う(私用プロファイルには触れない)。
- Playwrightのrouteはキャッシュを無効にするので使わない。実際のHTTPキャッシュに乗せる。

シナリオ1(プロファイル1): 旧い版なしsimulation.jsが長期キャッシュに残った状態
  warmup : importmapを外したHTMLと、craftCheckを旧名へ変えたsimulation.jsを、版なしURLだけ長期max-ageで提供。
  current: 同じプロファイルで本番のHTMLへ再接続。スナップショットのsimulationが取得され、制作(fiber3→cloth1)が実DOMで通る。

シナリオ2(プロファイル2): スナップショットAを部分的にだけキャッシュした状態で、スナップショットBが配備された後
  sA-warm: 旧シェル(スナップショットA)と同じimportmapで、一部のモジュール/CSS/manifestだけを読む(残りはキャッシュに無い)。
  sOld   : Bを配備(正規のトップレベルJS/CSSはBの内容、runtime/<B>/も提供)。旧シェルAを開く。Aのバイトだけを読み、BのURLは一度も取らない。
  sCur   : 現行シェルBを開く。Bのバイトだけを読む。
  Bはテスト内でAの内容に目印(simulationの export とCSS変数)を足して作る仮想スナップショット。実ファイルは変更しない。
  どちらのシェルも モジュール同一性・タイトルのロゴ・制作DOM・失敗/欠落/console/pageerror ゼロ を確認する。
結果は tests/output/runtime-cache/report.json。fixtureのエラー(warmup/sA-warm)と修正後のエラーは分けて保存する。
"""
import functools
import hashlib
import http.server
import json
import pathlib
import re
import shutil
import sys
import tempfile
import threading
import urllib.parse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
GAME = ROOT / 'Game' / 'Mosslight'
GAME_URL = '/Game/Mosslight/'
OUT = GAME / 'tests' / 'output' / 'runtime-cache'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(GAME))
import update_runtime_versions as urv  # noqa: E402  (importだけでは何も書き込まない)

state = {'phase': 'warmup', 'requests': []}
SNAP_PHASES = ('sA-warm', 'sOld', 'sCur')
CTYPES = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
          '.json': 'application/json', '.png': 'image/png'}
LONG = 'public, max-age=31536000, immutable'


def norm_text(path):
    return path.read_bytes().decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')


REAL_HTML = norm_text(GAME / 'index.html')
REV_A = re.search(r'name="mosslight-runtime-base" content="runtime/([^/"]+)/"', REAL_HTML).group(1)

# 仮想スナップショットB: 実スナップショットA相当の内容 + 目印
FILES_A = urv.snapshot_files()
FILES_B = dict(FILES_A)
FILES_B['simulation.js'] = FILES_A['simulation.js'] + b"\nexport const __snapshotMarker = 'B';\n"
FILES_B['style.css'] = FILES_A['style.css'] + b'\n:root { --snapshot-marker: "B"; }\n'
REV_B = urv.graph_revision(FILES_B)
SHELL_B = REAL_HTML.replace(f'runtime/{REV_A}/', f'runtime/{REV_B}/').replace(
    f'name="mosslight-asset-revision" content="{REV_A}"', f'name="mosslight-asset-revision" content="{REV_B}"')


def fixture_html():
    html = re.sub(r'<script type="importmap">.*?</script>', '', REAL_HTML, flags=re.DOTALL)
    return html.replace('<meta name="mosslight-asset-revision"', '<meta name="x-warmup-no-revision"').replace(
        '<meta name="mosslight-runtime-base"', '<meta name="x-warmup-no-base"')


def fixture_simulation():
    return re.sub(r'\bcraftCheck\b', 'craftCheckLegacy', norm_text(GAME / 'simulation.js'))


def warm_a_html():
    """旧シェルAと同じmeta/importmap/CSSで、一部のモジュールとmanifestだけを読む(残りは未キャッシュ)。"""
    part = (f"<script type=\"module\">import './simulation.js'; import './data.js'; import './world.js';"
            f" await fetch('runtime/{REV_A}/assets/manifest.json');</script>")
    return REAL_HTML.replace("<script type=\"module\">import './main.js';</script>", part)


class Handler(http.server.SimpleHTTPRequestHandler):
    long_cache = False
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def end_headers(self):
        if self.long_cache:
            self.send_header('Cache-Control', LONG if state['phase'] in SNAP_PHASES else 'public, max-age=31536000')
        super().end_headers()

    def send_body(self, body, ctype, cache):
        data = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache)
        super().end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        query = urllib.parse.parse_qs(u.query)
        phase = state['phase']
        state['requests'].append({'phase': phase, 'path': path, 'v': (query.get('v') or [None])[0], 'query': u.query})
        warm = phase == 'warmup'
        snap = phase in SNAP_PHASES
        self.long_cache = False
        if warm and path in (GAME_URL, GAME_URL + 'index.html'):
            return self.send_body(fixture_html(), 'text/html; charset=utf-8', 'no-store')
        if warm and path == GAME_URL + 'simulation.js' and not u.query:
            return self.send_body(fixture_simulation(), 'text/javascript; charset=utf-8', 'public, max-age=31536000')
        if warm and path.endswith('.js') and not u.query:
            self.long_cache = True  # 旧い版なしURLが長く残る状況を再現
        if phase == 'sA-warm' and path == GAME_URL + '__warm-a.html':
            return self.send_body(warm_a_html(), CTYPES['.html'], 'no-store')
        if phase in ('sOld', 'sCur') and path in (GAME_URL, GAME_URL + 'index.html'):
            return self.send_body(REAL_HTML if phase == 'sOld' else SHELL_B, CTYPES['.html'], 'no-store')
        if phase in ('sOld', 'sCur') and path.startswith(GAME_URL):
            rel = path[len(GAME_URL):]
            # Bの配備: 最新の正規トップレベルJS/CSSはBの内容、runtime/<B>/ も提供(runtime/<A>/ は実ファイルのまま残る)
            if rel in FILES_B and '/' not in rel:
                return self.send_body(FILES_B[rel], CTYPES[pathlib.PurePosixPath(rel).suffix], 'no-cache')
            prefix = f'runtime/{REV_B}/'
            if rel.startswith(prefix) and rel[len(prefix):] in FILES_B:
                inner = rel[len(prefix):]
                return self.send_body(FILES_B[inner], CTYPES.get(pathlib.PurePosixPath(inner).suffix, 'application/octet-stream'), LONG)
        if snap and path.startswith(GAME_URL + 'runtime/'):
            self.long_cache = True
        return super().do_GET()


def sha12(path):
    return hashlib.sha256(norm_text(path).encode('utf-8')).hexdigest()[:12]


def top_js_requests(phase):
    return [r for r in state['requests'] if r['phase'] == phase and re.fullmatch(re.escape(GAME_URL) + r'[^/]+\.js', r['path'])]


def manifest_asset_paths():
    manifest = json.loads(norm_text(GAME / 'assets' / 'manifest.json'))
    found = set()

    def walk(n):
        if isinstance(n, str):
            if n.lower().endswith(('.png', '.json')):
                found.add('assets/' + n)
        elif isinstance(n, list):
            for v in n:
                walk(v)
        elif isinstance(n, dict):
            for v in n.values():
                walk(v)
    walk(manifest.get('sheets', {}))
    found |= {'assets/manifest.json', 'assets/logo/logo.png'} | {f'assets/ui/{n}.png' for n in ['panel', 'button', 'hotbar', 'selected', 'disabled']}
    return found


def start_game(p):
    p.get_by_role('button', name='はじめから', exact=True).click()
    p.wait_for_timeout(400)
    if p.evaluate('__mosslight.mode') != 'play':  # 保存データがあれば確認ダイアログが出る
        p.get_by_role('button', name='はじめから', exact=True).last.click()
    p.wait_for_function('__mosslight.mode==="play"')


def open_page(ctx, errors, consoles, url=None):
    p = ctx.new_page()
    p.set_viewport_size({'width': 1264, 'height': 828})
    p.on('pageerror', lambda e: errors.append(str(e)))
    p.on('console', lambda m: consoles.append({'type': m.type, 'text': m.text}) if m.type in ('error', 'warning') else None)
    p.goto(url or f'{BASE}{GAME_URL}?debug=1', wait_until='networkidle')
    return p


def craft_cloth(p):
    p.evaluate("()=>__mosslight.give('fiber',3)")
    p.keyboard.press('c')
    p.locator('[data-fk="tab-all"]').click()
    p.locator('[data-fk="r-cloth"]').click()
    p.locator('[data-fk="make-1"]').click()
    p.wait_for_timeout(300)
    return p.evaluate("()=>[__mosslight.sim.countItem(__mosslight.state,'fiber'),__mosslight.sim.countItem(__mosslight.state,'cloth')]")


def inspect_shell(p):
    """タイトル画面のロゴ・メタ・CSS目印を読み、ゲームを始めて制作まで通す。"""
    d = {}
    d['meta_base'] = p.evaluate("()=>document.querySelector('meta[name=\"mosslight-runtime-base\"]')?.content||null")
    d['logo'] = p.evaluate("()=>{const i=document.querySelector('.title-logo img');return i?{src:i.src,w:i.naturalWidth}:null}")
    d['css_marker'] = p.evaluate("()=>getComputedStyle(document.documentElement).getPropertyValue('--snapshot-marker').trim()")
    start_game(p)
    d['craft_api'] = p.evaluate('()=>typeof __mosslight.sim.craftCheck')
    d['snapshot_marker'] = p.evaluate('()=>__mosslight.sim.__snapshotMarker||null')
    d['same_module_identity'] = p.evaluate("async()=>(await import('./simulation.js'))===__mosslight.sim")
    d['asset_failures'] = p.evaluate('()=>({failed:__mosslight.assets.failed,missing:[...__mosslight.assets.missing]})')
    d['fiber_cloth_after'] = craft_cloth(p)
    return d


class TestServer(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def launch(pw, profile):
    return pw.chromium.launch_persistent_context(profile, channel='chrome', headless=True)


server = TestServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
BASE = f'http://127.0.0.1:{server.server_address[1]}'
threading.Thread(target=server.serve_forever, daemon=True).start()
profiles = [tempfile.mkdtemp(prefix='mosslight-cache-profile-'), tempfile.mkdtemp(prefix='mosslight-cache-profile-')]
checks, warm_errors, warm_console, cur_errors, cur_console = {}, [], [], [], []
sA_warm_errors, sA_warm_console = [], []
old_errors, old_console, new_errors, new_console = [], [], [], []
detail = {}

try:
    with sync_playwright() as pw:
        # ===== シナリオ1: 旧い版なしsimulation.jsが長期キャッシュに残る
        ctx = launch(pw, profiles[0])
        p = open_page(ctx, warm_errors, warm_console)
        start_game(p)
        detail['warm_craft_api'] = p.evaluate('()=>typeof __mosslight.sim.craftCheck')
        p.evaluate("()=>__mosslight.give('fiber',3)")
        p.keyboard.press('c')
        p.wait_for_timeout(600)
        ctx.close()

        state['phase'] = 'current'
        ctx = launch(pw, profiles[0])
        p = open_page(ctx, cur_errors, cur_console)
        detail['revision_meta'] = p.evaluate("()=>document.querySelector('meta[name=\"mosslight-asset-revision\"]')?.content||null")
        detail['current'] = inspect_shell(p)
        ctx.close()

        # ===== シナリオ2: スナップショットAを部分的にキャッシュ → B配備後に旧シェルA / 現行シェルB
        state['phase'] = 'sA-warm'
        ctx = launch(pw, profiles[1])
        p = open_page(ctx, sA_warm_errors, sA_warm_console, f'{BASE}{GAME_URL}__warm-a.html')
        ctx.close()

        state['phase'] = 'sOld'
        ctx = launch(pw, profiles[1])
        p = open_page(ctx, old_errors, old_console)
        detail['old'] = inspect_shell(p)
        ctx.close()

        state['phase'] = 'sCur'
        ctx = launch(pw, profiles[1])
        p = open_page(ctx, new_errors, new_console)
        detail['new'] = inspect_shell(p)
        ctx.close()
finally:
    server.shutdown()
    server.server_close()
    tmp = pathlib.Path(tempfile.gettempdir()).resolve()
    for profile in profiles:
        profile_path = pathlib.Path(profile).resolve()
        if not profile_path.is_relative_to(tmp) or not profile_path.name.startswith('mosslight-cache-profile-'):
            raise RuntimeError('試験用プロファイルの削除対象が作成先と一致しません')
        shutil.rmtree(profile, ignore_errors=True)  # 自分で作った使い捨てプロファイルのみ

warm_js = top_js_requests('warmup')
cur_js = top_js_requests('current')
asset_rels = manifest_asset_paths()
snap_prefix = {'current': f'{GAME_URL}runtime/{REV_A}/', 'sOld': f'{GAME_URL}runtime/{REV_A}/', 'sCur': f'{GAME_URL}runtime/{REV_B}/'}


def phase_reqs(phase):
    return [r for r in state['requests'] if r['phase'] == phase]


def runtime_paths(phase):
    return [r for r in phase_reqs(phase) if r['path'].startswith(GAME_URL + 'runtime/')]


def canonical_top(phase):
    return [r for r in phase_reqs(phase) if re.fullmatch(re.escape(GAME_URL) + r'[^/]+\.(?:js|css)', r['path'])]


def snap_checks(tag, phase, rev, other_rev, d, errors, consoles):
    pre = snap_prefix[phase]
    rt = runtime_paths(phase)
    assets = [r for r in rt if r['path'][len(pre):] in asset_rels]
    c = {}
    c[f'{tag}_shell_meta_base'] = d.get('meta_base') == f'runtime/{rev}/'
    c[f'{tag}_requests_only_own_snapshot'] = bool(rt) and all(r['path'].startswith(pre) for r in rt)
    c[f'{tag}_never_other_snapshot'] = not any(f'/runtime/{other_rev}/' in r['path'] for r in phase_reqs(phase))
    c[f'{tag}_no_canonical_top_level'] = not canonical_top(phase)
    c[f'{tag}_no_query_urls'] = not any(r['query'] for r in rt)
    c[f'{tag}_assets_from_snapshot'] = bool(assets) and {a['path'][len(pre):] for a in assets} >= {'assets/logo/logo.png'}  # manifestはsA-warmでキャッシュ済みのことがある
    c[f'{tag}_logo_loaded'] = bool(d['logo']) and d['logo']['w'] > 0 and d['logo']['src'].startswith(BASE + pre)
    c[f'{tag}_api_present'] = d.get('craft_api') == 'function'
    c[f'{tag}_same_module_identity'] = d.get('same_module_identity') is True
    c[f'{tag}_craft_fiber3_to_cloth1'] = d.get('fiber_cloth_after') == [0, 1]
    c[f'{tag}_no_pageerror'] = not errors
    c[f'{tag}_no_asset_failures'] = d.get('asset_failures') == {'failed': [], 'missing': []}
    c[f'{tag}_no_console_error_or_warning'] = not consoles
    return c


expect_sim = sha12(GAME / 'simulation.js')
cur = detail['current']
rev = detail.get('revision_meta')
cur_sim = [r for r in runtime_paths('current') if r['path'] == f'{GAME_URL}runtime/{REV_A}/simulation.js']

checks['real_shell_matches_snapshot'] = rev == REV_A == urv.graph_revision(FILES_A) and (GAME / 'runtime' / REV_A).is_dir()
checks['real_snapshot_bytes_match_source'] = all((GAME / 'runtime' / REV_A / rel).read_bytes() == data for rel, data in FILES_A.items())
checks['virtual_b_differs'] = REV_B != REV_A
checks['warm_api_missing'] = detail.get('warm_craft_api') == 'undefined'
checks['warm_pageerror_reproduced'] = any('craftCheck is not a function' in e for e in warm_errors)
checks['warm_unversioned_simulation_served'] = any(r['path'].endswith('/simulation.js') and not r['query'] for r in warm_js)
checks['cur_simulation_from_snapshot'] = bool(cur_sim)
checks['cur_old_simulation_not_reused'] = not any(r['path'].endswith('/simulation.js') and not r['query'] for r in cur_js)
checks['cur_no_unversioned_js'] = not cur_js
checks['cur_asset_revision_meta_present'] = bool(rev)
checks.update(snap_checks('cur', 'current', REV_A, REV_B, cur, cur_errors, [m for m in cur_console]))
checks['cur_no_console_error'] = not [m for m in cur_console if m['type'] == 'error']

sw = [r['path'] for r in phase_reqs('sA-warm') if r['path'].startswith(GAME_URL + 'runtime/')]
old_paths = {r['path'] for r in phase_reqs('sOld')}
checks['sA_warm_partial'] = f'{GAME_URL}runtime/{REV_A}/simulation.js' in sw and f'{GAME_URL}runtime/{REV_A}/main.js' not in sw
checks['old_partial_cache_hit'] = (f'{GAME_URL}runtime/{REV_A}/main.js' in old_paths
                                   and f'{GAME_URL}runtime/{REV_A}/simulation.js' not in old_paths)
checks.update(snap_checks('old', 'sOld', REV_A, REV_B, detail['old'], old_errors, old_console))
checks['old_loads_A_bytes'] = detail['old']['snapshot_marker'] is None and detail['old']['css_marker'] == ''
checks.update(snap_checks('new', 'sCur', REV_B, REV_A, detail['new'], new_errors, new_console))
checks['new_loads_B_bytes'] = detail['new']['snapshot_marker'] == 'B' and detail['new']['css_marker'] == '"B"'

report = {
    'checks': checks,
    'detail': detail,
    'revisions': {'A': REV_A, 'B_virtual': REV_B},
    'expected_simulation_version': expect_sim,
    'fixture': {'pageerrors': warm_errors, 'console': warm_console, 'sA_warm_pageerrors': sA_warm_errors, 'sA_warm_console': sA_warm_console},
    'current': {'pageerrors': cur_errors, 'console': cur_console},
    'old_shell_A': {'pageerrors': old_errors, 'console': old_console},
    'new_shell_B': {'pageerrors': new_errors, 'console': new_console},
    'requests': {
        'warmup_js': [{'path': r['path'], 'query': r['query']} for r in warm_js],
        'current_runtime': [{'path': r['path'], 'query': r['query']} for r in runtime_paths('current')],
        'sA_warm_runtime': sw,
        'sOld_runtime': [r['path'] for r in runtime_paths('sOld')],
        'sCur_runtime': [r['path'] for r in runtime_paths('sCur')],
    },
}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'passed': sum(checks.values()), 'failed': sum(not v for v in checks.values()), 'failures': [k for k, v in checks.items() if not v]}, ensure_ascii=False))
raise SystemExit(0 if all(checks.values()) else 1)
