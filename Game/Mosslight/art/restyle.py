"""既存sheetのJSONを読むだけで、size/pivot/frame名/layer座標はそのままに、固定パレット(r2)の絵へ描き直す。

手順: ①旧symbolの色相＋材質contextで群を選び、群内の明度順位から3〜4段へ割り当てる（全part共通の表）
      ②孤立した1pxを2pass統合（輪郭・光沢・目は残す） ③透明に接する外周を材質の最暗色/Kで輪郭に描き直す
      ④色数を上限へ収める（統合の優先度は全part共通の使用量なので、アニメのフレーム間でちらつかない）

使い方:
  python art/restyle.py --sheet NAME [--sheet NAME2 ...] [--outline | --no-outline] [--max-colors N]
                        [--material-context auto|foliage|stone|wood|boss] [--report-only] [--show-mapping]
元の art/NAME.json は変更しない。--sheet に挙げた対象だけを art/r2/NAME.json と assets/r2-preview/NAME/ へ出力する。
複数layerのframeは、partごとに処理する（輪郭はpartの外周になるので、必要なら --no-outline で止める）。
"""
import argparse
import colorsys
import copy
from collections import Counter

from style import (GAME, GROUP_OF, HEX_OF, SYMBOL_OF, COLORS, finish, hex_rgb, load, luma, opaque_hex,
                   outline_symbol, ramp)

CONTEXTS = ('auto', 'foliage', 'stone', 'wood', 'boss')
DIRS = {'E': (1, 0), 'W': (-1, 0), 'S': (0, 1), 'N': (0, -1)}
GLOSS_GROUPS = {'C', 'H', 'X'}
# 群ごとに使う段（ramp()の1始まり）。最暗段は輪郭用に空けておく群がある
STEPS = {
    'K': (1, 2, 3), 'G': (2, 3, 4, 5), 'P': (1, 2, 3), 'M': (1, 2, 3), 'E': (2, 3, 4, 5), 'S': (1, 2, 3),
    'W': (1, 2, 3, 4), 'R': (2, 3, 4, 5), 'A': (2, 3, 4, 5), 'T': (1, 2, 3, 4), 'L': (1, 2, 3),
    'F': (2, 3, 4), 'B': (1, 2, 3, 4), 'C': (1, 2, 3, 4), 'U': (1, 2, 3), 'I': (1, 2), 'H': (1, 2, 3), 'X': (1,),
}


def classify(rgb, context):
    """色相・彩度・明度と材質contextから、群の記号(K/G/P/M/E/S/W/R/A/T/F/B/C/U/I/H/X)を返す。"""
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    hue = h * 360
    if v < 0.13:
        return 'K'
    if s < 0.13:
        if v > 0.93:
            return 'X'
        return 'I' if v > 0.8 and context != 'stone' else 'R'
    if hue < 12 or hue >= 340:
        return 'H' if (context == 'boss' and v > 0.7 and s > 0.6) else 'T'
    if hue < 45:
        if s > 0.65 and v > 0.75:
            if context == 'stone':
                return 'U'
            return 'H' if (context == 'boss' or hue >= 30) else 'U'
        if context in ('auto', 'boss') and 12 <= hue < 32 and 0.25 < s < 0.6 and v > 0.58:
            return 'F'
        return 'W' if (context in ('wood', 'foliage') or hue < 24) else 'E'
    if hue < 70:
        if s > 0.45:
            return 'M'
        return 'S' if v > 0.65 else 'E'
    if hue < 165:
        return 'P' if (hue >= 130 and v < 0.42) else 'G'
    if hue < 200:
        if s > 0.35 and v > 0.5:
            return 'C'
        return 'P' if hue < 185 else 'A'
    if hue < 260:
        return 'B' if context in ('wood', 'boss') else 'A'
    return 'T' if hue >= 320 else 'B'


def build_mapping(palette, used, context):
    """旧symbol→新symbol。使われている色だけを群ごとに明度順位で並べ、群の3〜4段へ割り当てる。全frame共通。"""
    groups, mapping = {}, {}
    for symbol in sorted(used):
        value = opaque_hex(palette[symbol])
        if value is None:
            mapping[symbol] = '.'
        else:
            groups.setdefault(classify(hex_rgb(value), context), []).append((luma(value), symbol))
    for group, items in groups.items():
        items.sort()
        steps, n = STEPS[group], len(items)
        for i, (_, symbol) in enumerate(items):
            mapping[symbol] = ramp(group, steps[min(len(steps) - 1, int((i + 0.5) * len(steps) / n))])
    return mapping


def at(g, x, y):
    """範囲外はNone。範囲内の透明は'.'。"""
    return g[y][x] if 0 <= y < len(g) and 0 <= x < len(g[0]) else None


def merge_isolated(g, budget=0.03):
    """4近傍が全て別の色の孤立1pxを、多数派の近傍色へ統合する（2pass）。

    透明に接する外周と、光沢・目（光る群、または周囲との明度差が大きい点を不透明画素の3%まで）は残す。
    """
    for _ in range(2):
        src = [row[:] for row in g]
        opaque = sum(c != '.' for row in src for c in row)
        found = []
        for y in range(len(src)):
            for x in range(len(src[0])):
                c = src[y][x]
                if c == '.':
                    continue
                near = [at(src, x + dx, y + dy) for dx, dy in DIRS.values()]
                if any(n in ('.', None) for n in near) or any(n == c for n in near):
                    continue
                contrast = abs(luma(HEX_OF[c]) - sum(luma(HEX_OF[n]) for n in near) / 4)
                found.append((contrast, x, y, near))
        found.sort(key=lambda f: -f[0])
        kept = 0
        for contrast, x, y, near in found:
            c = src[y][x]
            if GROUP_OF[c] in GLOSS_GROUPS or (contrast >= 45 and kept < opaque * budget):
                kept += GROUP_OF[c] not in GLOSS_GROUPS
                continue
            counts = Counter(near)
            top = max(counts.values())
            tied = [n for n, k in counts.items() if k == top]
            g[y][x] = min(tied, key=lambda n: abs(luma(HEX_OF[n]) - luma(HEX_OF[c])))


def redraw_outline(g, selout_ok):
    """透明に接する外周の画素を、その材質のランプ最暗色（光る群はK）へ描き直す。形は変えない。"""
    changes = []
    for y in range(len(g)):
        for x in range(len(g[0])):
            c = g[y][x]
            if c == '.':
                continue
            open_dirs = {d for d, (dx, dy) in DIRS.items() if at(g, x + dx, y + dy) == '.'}
            if open_dirs:
                changes.append((x, y, outline_symbol(c, selout_ok and open_dirs <= {'W', 'N'})))
    for x, y, c in changes:
        g[y][x] = c


def bbox_size(g):
    pts = [(x, y) for y, row in enumerate(g) for x, c in enumerate(row) if c != '.']
    if not pts:
        return 0
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return max(max(xs) - min(xs), max(ys) - min(ys)) + 1


def color_limit(size, context, override):
    if override:
        return override
    if context == 'boss' or size >= 120:
        return 22
    if size >= 64:
        return 18
    return 12 if size > 24 else 8


def limit_colors(g, limit, priority):
    """色数が上限を超える間、全part通しの使用量が最少の色を、同じ群で明度が近い色へ寄せる。"""
    while True:
        counts = Counter(c for row in g for c in row if c != '.')
        if len(counts) <= limit:
            return
        victim = min(counts, key=lambda c: (priority[c], c))
        target = min((c for c in counts if c != victim),
                     key=lambda c: (GROUP_OF[c] != GROUP_OF[victim], abs(luma(HEX_OF[c]) - luma(HEX_OF[victim])), c))
        for row in g:
            for x, c in enumerate(row):
                if c == victim:
                    row[x] = target


def stats(g):
    """報告用: 色数・孤立1px率・外周が輪郭色の率。"""
    opaque = [(x, y) for y, row in enumerate(g) for x, c in enumerate(row) if c != '.']
    isolated = edge = edge_ok = 0
    for x, y in opaque:
        c = g[y][x]
        near = [at(g, x + dx, y + dy) for dx, dy in DIRS.values()]
        if '.' not in near and None not in near and all(n != c for n in near) and GROUP_OF[c] not in GLOSS_GROUPS:
            isolated += 1
        if '.' in near:
            edge += 1
            edge_ok += c == outline_symbol(c) or GROUP_OF[c] == 'K'
    return {
        'colors': len({g[y][x] for x, y in opaque}),
        'isolated': isolated / max(1, len(opaque)),
        'outline': edge_ok / edge if edge else None,
    }


def restyle_project(src, context, outline, max_colors, show_mapping):
    palette = src['palette']
    used = {ch for part in src['parts'].values() for row in part['rows'] for ch in row if ch != '.'}
    missing = used - set(palette)
    if missing:
        raise KeyError(f'rows に palette 未定義の記号があります: {sorted(missing)}')
    mapping = build_mapping(palette, used, context)
    if show_mapping:
        for symbol in sorted(used):
            print(f'    {symbol} {palette[symbol]} -> {mapping[symbol]} ({GROUP_OF.get(mapping[symbol], "透明")})')

    grids = {}
    for name, part in src['parts'].items():
        g = [[mapping[ch] if ch != '.' else '.' for ch in row] for row in part['rows']]
        merge_isolated(g)
        has_hole = any(c == '.' for row in g for c in row)
        # 外周に透明がある物だけ輪郭を引く（地面・不透明デカールは既定で引かない）。--outline で強制
        if outline or (outline is None and has_hole):
            redraw_outline(g, bbox_size(g) >= 48)
        grids[name] = g
    priority = Counter(c for g in grids.values() for row in g for c in row if c != '.')
    for name, g in grids.items():
        limit_colors(g, color_limit(bbox_size(g), context, max_colors), priority)

    out = copy.deepcopy(src)
    out['palette'] = {'.': '#00000000', **{SYMBOL_OF[c]: c for c in COLORS}}
    for name, g in grids.items():
        out['parts'][name]['rows'] = [''.join(row) for row in g]
    return out, grids


def main():
    ap = argparse.ArgumentParser(description='既存sheetを固定パレット(r2)へ描き直す（指定sheetだけ）')
    ap.add_argument('--sheet', action='append', required=True, help='art/NAME.json の NAME（複数指定可）')
    ap.add_argument('--outline', action=argparse.BooleanOptionalAction, default=None,
                    help='外周の輪郭を引く/引かない（既定は透明を含むpartだけ自動）')
    ap.add_argument('--max-colors', type=int, help='partごとの色数上限（既定は大きさで 8/12/18/22）')
    ap.add_argument('--material-context', choices=CONTEXTS, default='auto', help='曖昧な色相の材質の寄せ先')
    ap.add_argument('--report-only', action='store_true', help='書き出さず報告だけ')
    ap.add_argument('--show-mapping', action='store_true', help='旧色→新色の対応表を表示')
    args = ap.parse_args()

    for sheet in args.sheet:
        source = GAME / 'art' / f'{sheet}.json'
        if not source.exists():
            raise FileNotFoundError(f'{source} がありません')
        print(f'{sheet}: context={args.material_context}')
        project, grids = restyle_project(load(source), args.material_context, args.outline, args.max_colors,
                                         args.show_mapping)
        worst = {'colors': 0, 'isolated': 0.0}
        for name, g in grids.items():
            s = stats(g)
            worst['colors'] = max(worst['colors'], s['colors'])
            worst['isolated'] = max(worst['isolated'], s['isolated'])
            if s['isolated'] > 0.04 or (s['outline'] is not None and s['outline'] < 0.95):
                outline_rate = 'なし' if s['outline'] is None else f'{s["outline"]:.0%}'
                print(f'  注意 {name}: 孤立1px {s["isolated"]:.1%} / 外周の輪郭色 {outline_rate}')
        print(f'  parts {len(grids)} / 最大色数 {worst["colors"]} / 最大孤立1px率 {worst["isolated"]:.1%}')
        if not args.report_only:
            finish(sheet, project)


if __name__ == '__main__':
    main()
