"""index.html / tests/index.html の「実行時バージョン」区間と、不変の実行時スナップショットを生成する。

- runtime/<版>/ : 正規のトップレベルJS・style.css・参照アセットを、元の相対構造のまま正規化コピーした木。
  <版> は木の全ファイル(パス+内容)から作る。生成物・HTML・.review などは含めない(循環しない)。
  同じ版のディレクトリが既にあれば内容を比較するだけで、上書きも削除もしない。過去の版は残す。
- importmap: 正規の ./main.js などを runtime/<版>/main.js へ割り当てる。
  スナップショット内の相対importは同じ木に解決されるので、外部の import('./simulation.js') と同じモジュール実体になる。
  tests/index.html は ../x.js → ../runtime/<版>/x.js、tests自身のモジュールは従来どおり ?v=SHA。
- メタタグ mosslight-runtime-base: renderer.js の loadAssets が既定のmanifestを、この木のassetsから読むための基準。
  メタタグ mosslight-asset-revision: 版そのもの(これを持たない呼び出し元は従来どおり)。
- style.css: スナップショット内のCSSをリンクする。UI画像は相対のまま同じ木に解決される(?vは外して保存)。
- ルートの style.css 内のUI画像の ?v= は従来どおり更新する(スナップショットを使わない読み込み用)。

使い方:  python update_runtime_versions.py          生成区間とスナップショットを更新
         python update_runtime_versions.py --check  内容まで一致するか確認(不一致は終了コード1)
日時は書かない。共通CSSや他ページは触らない。再帰削除はしない。
"""
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
RUNTIME = HERE / 'runtime'
TEXT_EXT = {'.js', '.css', '.json', '.html', '.txt'}
ASSET_REF = re.compile(r'assets/[A-Za-z0-9_./-]+\.(?:png|json|gif|webp|jpg)')
ASSET_EXT = ('.png', '.json', '.gif', '.webp', '.jpg')
BEGIN = '<!-- mosslight-runtime:begin'
END = '<!-- mosslight-runtime:end -->'
REGION = re.compile(r'^([ \t]*)<!-- mosslight-runtime:begin[^\n]*-->.*?<!-- mosslight-runtime:end -->',
                    re.DOTALL | re.MULTILINE)
CSS_ASSET_QUERY = re.compile(r'(assets/[A-Za-z0-9_./-]+\.(?:png|gif|webp|jpg))\?v=[A-Za-z0-9_-]+')


def content_bytes(path):
    """テキストはUTF-8の改行(CRLF/CR)をLFへ正規化、画像などはそのまま。"""
    data = path.read_bytes()
    if path.suffix.lower() in TEXT_EXT:
        data = data.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')
    return data


def sha(data, n=12):
    return hashlib.sha256(data).hexdigest()[:n]


def runtime_js(directory):
    return sorted(p for p in directory.glob('*.js') if p.is_file())


def json_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for v in node:
            yield from json_strings(v)
    elif isinstance(node, dict):
        for v in node.values():
            yield from json_strings(v)


def referenced_assets():
    """コード・CSS・manifest・atlas が参照するアセット(Mosslight直下からの相対パス)を集める。"""
    found = set()
    sources = runtime_js(HERE) + [HERE / 'style.css']
    for p in sources:
        for m in ASSET_REF.finditer(content_bytes(p).decode('utf-8')):
            found.add(m.group(0))
    manifest_rel = 'assets/manifest.json'
    manifest_path = HERE / manifest_rel
    if manifest_path.is_file():
        found.add(manifest_rel)
        manifest = json.loads(content_bytes(manifest_path).decode('utf-8'))
        for s in json_strings(manifest.get('sheets', {})):
            if s.lower().endswith(ASSET_EXT):
                found.add('assets/' + s)
    # atlas の中の画像名(あれば)も同じ基準で追う
    for rel in sorted(found):
        if rel.endswith('.json') and rel != manifest_rel and (HERE / rel).is_file():
            try:
                atlas = json.loads(content_bytes(HERE / rel).decode('utf-8'))
            except ValueError:
                continue
            base = pathlib.PurePosixPath(rel).parent
            for s in json_strings(atlas.get('meta', {})):
                if s.lower().endswith(ASSET_EXT):
                    found.add((base / s).as_posix())
    return sorted(rel for rel in found if (HERE / rel).is_file())


def asset_revision():
    lines = [f'{rel}\0{sha(content_bytes(HERE / rel), 64)}' for rel in referenced_assets()]
    return sha('\n'.join(lines).encode('utf-8'))


def update_style_assets(check):
    """ルートのCSSから直接読むUI画像も、atlasと同じ版へ揃える(スナップショットを使わない読み込み用)。"""
    path = HERE / 'style.css'
    text = path.read_text(encoding='utf-8')
    rev = asset_revision()
    new = re.sub(r'(assets/[A-Za-z0-9_./-]+\.(?:png|gif|webp|jpg))(?:\?v=[A-Za-z0-9_-]+)?',
                 lambda m: m.group(1) + '?v=' + rev, text)
    if new == text:
        return True
    if check:
        print('style.css: UI画像の版が古い', file=sys.stderr)
        return False
    path.write_text(new, encoding='utf-8')
    print('style.css: UI画像の版を更新')
    return True


def snapshot_files():
    """スナップショットに入れるファイル: {Mosslight直下からの相対パス: 正規化バイト列}。"""
    files = {p.name: content_bytes(p) for p in runtime_js(HERE)}
    css = content_bytes(HERE / 'style.css').decode('utf-8')
    files['style.css'] = CSS_ASSET_QUERY.sub(r'\1', css).encode('utf-8')  # 版は木のパスが持つ
    for rel in referenced_assets():
        files[rel] = content_bytes(HERE / rel)
    return files


def graph_revision(files):
    lines = [f'{rel}\0{sha(files[rel], 64)}' for rel in sorted(files)]
    return sha('\n'.join(lines).encode('utf-8'), 16)


def sync_snapshot(rev, files, check):
    """runtime/<rev>/ を作る。既存ファイルは内容を比べるだけ(差があればエラー)。削除はしない。"""
    root = RUNTIME / rev
    ok = True
    for rel in sorted(files):
        path = root / rel
        if path.is_file():
            if path.read_bytes() != files[rel]:
                print(f'runtime/{rev}/{rel}: 内容がスナップショットの期待と違う(不変のため上書きしません)', file=sys.stderr)
                ok = False
        elif check:
            print(f'runtime/{rev}/{rel}: ありません', file=sys.stderr)
            ok = False
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(files[rel])
    if root.is_dir():
        for p in sorted(root.rglob('*')):
            if p.is_file() and p.relative_to(root).as_posix() not in files:
                print(f'runtime/{rev}/{p.relative_to(root).as_posix()}: 余分なファイル', file=sys.stderr)
                ok = False
    elif check:
        ok = False
    if ok:
        print(f'runtime/{rev}/: ' + ('最新' if check else '用意済み'))
    return ok


def import_map(directory, prefix, rev=None):
    """directory のJSを、HTMLから見た相対キー(prefix付き)→URLへ。
    rev があればスナップショットのJS、無ければ内容SHA付きURL(?v=)。"""
    imports = {}
    for p in runtime_js(directory):
        key = f'{prefix}{p.name}'
        imports[key] = f'{prefix}runtime/{rev}/{p.name}' if rev else f'{key}?v={sha(content_bytes(p))}'
    return imports


def render_script(imports, indent):
    body = json.dumps({'imports': imports}, ensure_ascii=False, indent=2, sort_keys=True)
    body = '\n'.join(f'{indent}  {line}' for line in body.split('\n'))
    return f'{indent}<script type="importmap">\n{body}\n{indent}</script>'


def build_region(page, indent, rev):
    note = f'{BEGIN} (update_runtime_versions.py が生成。手で編集しない) -->'
    if page == 'index':
        parts = [
            note,
            f'<meta name="mosslight-asset-revision" content="{rev}">',
            f'<meta name="mosslight-runtime-base" content="runtime/{rev}/">',
            render_script(import_map(HERE, './', rev=rev), '').strip('\n'),
            f'<link rel="stylesheet" href="runtime/{rev}/style.css">',
            END,
        ]
    else:
        imports = import_map(HERE, '../', rev=rev)
        imports.update(import_map(HERE / 'tests', './'))
        parts = [note, render_script(imports, '').strip('\n'), END]
    lines = '\n'.join(parts).split('\n')
    return lines[0] + ''.join('\n' + indent + l if l else '\n' for l in lines[1:])


def update(path, page, check, rev):
    raw = path.read_bytes().decode('utf-8')
    eol = '\r\n' if '\r\n' in raw else '\n'
    text = raw.replace('\r\n', '\n')
    m = REGION.search(text)
    if not m:
        print(f'{path}: 生成区間({BEGIN} … {END})がありません', file=sys.stderr)
        return False
    new = text[:m.start()] + m.group(1) + build_region(page, m.group(1), rev) + text[m.end():]
    if new == text:
        print(f'{path.relative_to(HERE)}: 最新')
        return True
    if check:
        print(f'{path.relative_to(HERE)}: 生成内容が古い。update_runtime_versions.py を実行してください', file=sys.stderr)
        return False
    path.write_bytes(new.replace('\n', eol).encode('utf-8'))
    print(f'{path.relative_to(HERE)}: 更新')
    return True


def main(argv):
    check = '--check' in argv
    ok = update_style_assets(check)
    files = snapshot_files()
    rev = graph_revision(files)
    if not sync_snapshot(rev, files, check):
        # 不変コピーが欠損・破損している場合、HTMLをその版へ切り替えない。
        return 1
    ok = update(HERE / 'index.html', 'index', check, rev) and ok
    ok = update(HERE / 'tests' / 'index.html', 'tests', check, rev) and ok
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
