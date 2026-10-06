"""Mosslight 美術r2の共通部品。art/palette.json を正本に、ランプ・描画補助・Workbench書き出しを提供する。

ゲーム起動時には使わない（制作用スクリプト専用）。単体実行:
  python art/style.py          パレットとランプの要約を表示する
  python art/style.py --index  assets/r2-preview の一覧を .review/r2-assets.json へ書く（明示コマンドのみ）
"""
from pathlib import Path
import argparse
import json
import math
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
GAME = Path(__file__).resolve().parents[1]
WORKBENCH = ROOT / 'Image/PixelWorkbench'
sys.path.insert(0, str(WORKBENCH))
from engine import Editor, load, render, validate  # noqa: E402,F401
from pixelwork import export, save  # noqa: E402

# このスクリプト専用の記号表（64文字）。'.'は透明なので含めない。
SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@+'
PALETTE_FILE = GAME / 'art/palette.json'
R2_DIR = GAME / 'art/r2'
PREVIEW_DIR = GAME / 'assets/r2-preview'
REVIEW_DIR = GAME / '.review'


def _read_palette():
    data = json.loads(PALETTE_FILE.read_text(encoding='utf-8'))
    colors = [c.lower() for c in data['colors']]
    if len(colors) != len(set(colors)):
        raise ValueError('palette.json の colors に重複色があります')
    if len(colors) > len(SYMBOLS):
        raise ValueError(f'色数 {len(colors)} が記号表 {len(SYMBOLS)} を超えています')
    ramps = {group: [c.lower() for c in steps] for group, steps in data['ramps'].items()}
    for group, steps in ramps.items():
        for color in steps:
            if color not in colors:
                raise ValueError(f'ランプ {group} の色 {color} が colors にありません')
    return colors, ramps


COLORS, RAMPS = _read_palette()
SYMBOL_OF = {color: SYMBOLS[i] for i, color in enumerate(COLORS)}
HEX_OF = {symbol: color for color, symbol in SYMBOL_OF.items()}
# 共有色（P3=G3, X1=L3）は先に出てくる群に属する扱い
GROUP_OF = {}
for _group, _steps in RAMPS.items():
    for _color in _steps:
        GROUP_OF.setdefault(SYMBOL_OF[_color], _group)

# 輪郭色: 材質ごとのランプの最暗色か、K群。光る色は純黒を避けてK2。
OUTLINE_RAMP = {
    'K': ('K', 1), 'G': ('G', 1), 'P': ('P', 1), 'M': ('E', 1), 'E': ('E', 1), 'S': ('E', 1),
    'W': ('W', 1), 'R': ('R', 1), 'I': ('R', 1), 'A': ('A', 1), 'T': ('T', 1), 'L': ('E', 1),
    'F': ('F', 1), 'B': ('B', 1), 'C': ('C', 1), 'U': ('E', 1), 'H': ('K', 2), 'X': ('K', 2),
}


def ramp(group, index):
    """ランプの記号を返す。indexは文書どおり1始まり（暗→明）。"""
    if group not in RAMPS:
        raise KeyError(f'ランプ {group!r} はありません（{"".join(RAMPS)}）')
    steps = RAMPS[group]
    if not 1 <= index <= len(steps):
        raise IndexError(f'ランプ {group} は {len(steps)} 段です（指定 {index}）')
    return SYMBOL_OF[steps[index - 1]]


def ramp_size(group):
    return len(RAMPS[group])


def group_of(symbol):
    return GROUP_OF.get(symbol)


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def luma(value):
    r, g, b = hex_rgb(value)
    return 0.299 * r + 0.587 * g + 0.114 * b


def opaque_hex(value):
    """'#rrggbb(aa)' を小文字の '#rrggbb' へ。透明（alpha<128）なら None。"""
    text = value.strip().lower()
    if not re.fullmatch(r'#[0-9a-f]{6}([0-9a-f]{2})?', text):
        raise ValueError(f'色の書式が不正です: {value}')
    if len(text) == 9:
        if int(text[7:], 16) < 128:
            return None
        text = text[:7]
    return text


def symbol_map(palette):
    """別projectのパレット(記号→色)を、このパレットの記号へ引く表にする。パレット外の色は即エラー。"""
    mapping = {'.': '.'}
    for symbol, value in palette.items():
        color = opaque_hex(value)
        if color is None:
            mapping[symbol] = '.'
        elif color in SYMBOL_OF:
            mapping[symbol] = SYMBOL_OF[color]
        else:
            raise ValueError(f'固定パレットにない色です: {symbol} = {value}')
    return mapping


def outline_symbol(symbol, selout=False):
    """材質の輪郭色。selout=Trueなら光の当たる辺向けにランプ2段目へ上げる。"""
    group = GROUP_OF[symbol]
    target, index = OUTLINE_RAMP.get(group, ('K', 2))
    if selout and target != 'K':
        index = 2
    return ramp(target, index)


class Canvas:
    """記号の2次元配列。'.'が透明。part rowsへそのまま変換できる（Pillowは使わない）。"""

    def __init__(self, w, h, fill='.'):
        self.w, self.h = w, h
        self.g = [[fill] * w for _ in range(h)]

    @classmethod
    def from_rows(cls, rows, mapping=None):
        cv = cls(len(rows[0]), len(rows))
        for y, row in enumerate(rows):
            if len(row) != cv.w:
                raise ValueError(f'rows の幅が揃っていません（行{y}）')
            for x, ch in enumerate(row):
                if mapping is None:
                    cv.g[y][x] = ch
                elif ch in mapping:
                    cv.g[y][x] = mapping[ch]
                else:
                    raise KeyError(f'パレットにない記号 {ch!r}（行{y} 列{x}）')
        return cv

    def copy(self):
        other = Canvas(self.w, self.h)
        other.g = [row[:] for row in self.g]
        return other

    def rows(self):
        return [''.join(row) for row in self.g]

    def get(self, x, y, wrap=False, default='.'):
        if wrap:
            return self.g[y % self.h][x % self.w]
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.g[y][x]
        return default

    def set(self, x, y, c, wrap=False):
        if wrap:
            self.g[y % self.h][x % self.w] = c
        elif 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def line(self, x0, y0, x1, y1, c):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def polyline(self, points, c):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            self.line(x0, y0, x1, y1, c)

    def poly(self, points, c):
        """多角形塗り。頂点は画素の角の座標で、画素の中心が内側にあるものを塗る。"""
        n = len(points)
        ys = [p[1] for p in points]
        for y in range(min(ys), max(ys) + 1):
            yc = y + 0.5
            xs = []
            for i in range(n):
                x0, y0 = points[i]
                x1, y1 = points[(i + 1) % n]
                if y0 != y1 and (y0 <= yc < y1 or y1 <= yc < y0):
                    xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(math.ceil(xs[i] - 0.5), math.floor(xs[i + 1] - 0.5) + 1):
                    self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(math.floor(cy - ry), math.ceil(cy + ry) + 1):
            for x in range(math.floor(cx - rx), math.ceil(cx + rx) + 1):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, c)

    def paste(self, src, x, y):
        for sy, row in enumerate(src.g):
            for sx, ch in enumerate(row):
                if ch != '.':
                    self.set(x + sx, y + sy, ch)

    def crop(self, x, y, w, h):
        out = Canvas(w, h)
        for yy in range(h):
            for xx in range(w):
                out.g[yy][xx] = self.get(x + xx, y + yy)
        return out

    def flipped(self):
        out = Canvas(self.w, self.h)
        out.g = [row[::-1] for row in self.g]
        return out

    def trim(self):
        """不透明画素の外接矩形で切り出す。返り値は (Canvas, 左端x, 上端y)。"""
        pts = [(x, y) for y in range(self.h) for x in range(self.w) if self.g[y][x] != '.']
        if not pts:
            raise ValueError('不透明画素がありません')
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        return self.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1), x0, y0


def outline(cv, selout=False):
    """不透明画素の外側（4近傍）へ1pxの輪郭を描く。selout時は左上側の辺だけランプ2段目にする。"""
    dirs = {'N': (0, -1), 'W': (-1, 0), 'E': (1, 0), 'S': (0, 1)}
    adds = []
    for y in range(cv.h):
        for x in range(cv.w):
            if cv.g[y][x] != '.':
                continue
            near = {}
            for name, (dx, dy) in dirs.items():
                c = cv.get(x + dx, y + dy)
                if c != '.':
                    near[name] = c
            if not near:
                continue
            # 物の下側・右側にある輪郭は暗い色を優先して接地を締める
            key = next(k for k in ('N', 'W', 'E', 'S') if k in near)
            top_left_side = 'N' not in near and 'W' not in near
            adds.append((x, y, outline_symbol(near[key], selout and top_left_side)))
    for x, y, c in adds:
        cv.g[y][x] = c


def compose(project, frame):
    """project の frame（名前かindex）をレイヤ順（後ろが手前）に重ねたCanvasを、このパレットの記号で返す。"""
    frames = project['frames']
    if isinstance(frame, int):
        target = frames[frame]
    else:
        target = next((f for f in frames if f['name'] == frame), None)
        if target is None:
            raise KeyError(f'frame {frame!r} がありません')
    mapping = symbol_map(project['palette'])
    cv = Canvas(*project['size'])
    for layer in target['layers']:
        sub = Canvas.from_rows(project['parts'][layer['part']]['rows'], mapping)
        if layer.get('flip_x'):
            sub = sub.flipped()
        cv.paste(sub, layer['x'], layer['y'])
    return cv


def header(size, pivot):
    """全64色を含むDOTヘッダ。透明の'.'はWorkbench側の既定。"""
    return [f'canvas {size[0]} {size[1]}', f'pivot {pivot[0]} {pivot[1]}'] + [
        f'palette {SYMBOL_OF[color]} {color}' for color in COLORS
    ]


def part(lines, name, rows):
    if len({len(r) for r in rows}) != 1:
        raise ValueError(f'part {name}: rows の幅が揃っていません')
    lines.append(f'part {name} {len(rows[0])} {len(rows)}')
    lines.extend(f'row {y} 0 {pixels}' for y, pixels in enumerate(rows))


def frame(lines, name, layers, duration=100, tag=None):
    """layers は (part, x, y) か (part, x, y, flip_x)。レイヤIDは frame 内の連番。"""
    lines.append(f'frame {name} {duration}')
    if tag:
        lines.append(f'tag {tag}')
    for n, layer in enumerate(layers):
        lines.append(f'place l{n} {layer[0]} {layer[1]} {layer[2]}')
        if len(layer) > 3 and layer[3]:
            lines.append(f'mirror l{n} x')


def build_lines(size, pivot, items):
    """items = [(名前, Canvas)] か [(名前, Canvas, x, y)]。名前ごとに part 1つ + 1レイヤの frame を組む。"""
    lines = header(size, pivot)
    for item in items:
        part(lines, f'p_{item[0]}', item[1].rows())
    for item in items:
        x, y = (item[2], item[3]) if len(item) > 2 else (0, 0)
        frame(lines, item[0], [(f'p_{item[0]}', x, y)])
    return lines


def check(project):
    """Workbenchのvalidateを通す。問題が返れば握りつぶさず例外にする。"""
    result = validate(project)
    if isinstance(result, dict):
        result = result.get('errors', [])
    if result is None or result is True:
        return
    problems = list(result) if isinstance(result, (list, tuple)) else [result]
    if problems:
        raise ValueError('validate が問題を返しました:\n' + '\n'.join(f'  {p}' for p in problems))


def finish(sheet, source):
    """art/r2/<sheet>.json（DOTを渡した時は .dot も）と assets/r2-preview/<sheet>/ だけを書く。

    source は DOT行のlist か、組み立て済みのproject辞書。既存manifestには触れない。
    """
    if not re.fullmatch(r'[A-Za-z0-9_-]+', sheet):
        raise ValueError(f'sheet 名が不正です: {sheet!r}')
    R2_DIR.mkdir(parents=True, exist_ok=True)
    if isinstance(source, (list, tuple)):
        text = '\n'.join(source) + '\n'
        (R2_DIR / f'{sheet}.dot').write_text(text, encoding='utf-8')
        project = Editor().apply(text)
    else:
        project = source
    check(project)
    save(project, R2_DIR / f'{sheet}.json')
    report = export(project, PREVIEW_DIR / sheet, columns=8)
    for warning in report['warnings']:
        print(f'  warning: {warning}')
    print(f'{sheet}: {report["frames"]} frames; {len(report["warnings"])} warnings')
    return project


def render_image(project, frame_ref=0):
    """Workbenchのrenderへ、名前を解決したフレーム辞書を渡す。"""
    names = [f['name'] for f in project['frames']]
    index = frame_ref if isinstance(frame_ref, int) else names.index(frame_ref)
    return render(project, project['frames'][index])[0]


def write_index():
    """assets/r2-preview 配下の一覧を .review/r2-assets.json へまとめる（明示コマンド専用）。"""
    entries = []
    for folder in sorted(p for p in PREVIEW_DIR.iterdir() if p.is_dir()):
        entry = {
            'sheet': folder.name,
            'preview': f'assets/r2-preview/{folder.name}',
            'files': sorted(f.name for f in folder.iterdir()),
        }
        source = R2_DIR / f'{folder.name}.json'
        if source.exists():
            data = json.loads(source.read_text(encoding='utf-8'))
            entry.update(
                source=f'art/r2/{folder.name}.json', size=data['size'], pivot=data['pivot'],
                frames=[f['name'] for f in data['frames']],
            )
        entries.append(entry)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    out = REVIEW_DIR / 'r2-assets.json'
    out.write_text(json.dumps({'sheets': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{out.relative_to(GAME)}: {len(entries)} sheets')


def main():
    ap = argparse.ArgumentParser(description='美術r2の共通基盤')
    ap.add_argument('--index', action='store_true', help='.review/r2-assets.json を書く')
    args = ap.parse_args()
    if args.index:
        write_index()
        return
    print(f'{len(COLORS)} colors / {len(RAMPS)} ramps / symbols {SYMBOLS}')
    for group, steps in RAMPS.items():
        print(f'  {group}: ' + ' '.join(f'{SYMBOL_OF[c]}={c}' for c in steps))


if __name__ == '__main__':
    main()
