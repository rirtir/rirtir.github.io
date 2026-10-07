"""plants シート（96x96, pivot 48,80: bush/berry/fern/flower）の確認用生成。build_primary_materials3 の形・投影を再利用する。
64x56 の原画（pivot 32,48）を +16,+32 で 96x96 に置く。中立アルベド + 形から求めた法線・高さ。本番ファイルは書かない。

  python art/build_plants3.py     .review/v3/plants-production/ だけを書く
"""
import json
import math
import sys
import build_primary_materials3 as P
from style import GAME, SYMBOLS, header, part, frame, check
from engine import Editor, render
from pixelwork import export, save
from build_normal_maps import NORMAL_COLORS
from build_tree3_demo import HEIGHT_COLORS
from build_normal_maps import project_lines

SIZE, PIVOT, OFF = (96, 96), (48, 80), (16, 32)
NAMES = ['bush', 'berry', 'fern', 'flower']
OUT = GAME / '.review/v3/plants-production'


class Petal(P.Berry):
    """花弁・花心。小さな球。輪郭は花弁ごとの淡い色（自発光ではない）。"""

    def __init__(self, cx, cy, r, z, pig, out, seed):
        super().__init__(cx, cy, r, z, pig, seed)
        self.out = self.occ = out


def corolla(cx, cy, z, r, pig, out, seed):
    spots = [(cx + 1.9 * r * math.cos(math.radians(-90 + 72 * k)), cy + 1.7 * r * math.sin(math.radians(-90 + 72 * k))) for k in range(5)]
    return [Petal(x, y, r, z, pig, out, seed + k) for k, (x, y) in enumerate(spots)] + [Petal(cx, cy, .8, z + 1.2, '#dcbf5e', '#dcbf5e', seed + 9)]


def fern():
    dome = P.Dome(32, 36, 22, 20, 2, 11)
    return P.plant(700, dome, [(14, 31, 0), (32, 19, 1), (50, 31, 2)], lens=(8., 7., 6.), width=1.7)


def flower():
    dome = P.Dome(32, 38, 18, 22, 2, 9)
    stems = [(32, 19, 1), (21, 30, 0), (43, 31, 2), (27, 35, 0)]
    out = P.plant(800, dome, stems, lens=(5., 4.4, 3.8), width=1.3)
    return out + corolla(32, 15.5, dome(32, 19) + 1, 1.7, '#efdca6', '#dcc185', 810) \
        + corolla(21, 26.5, dome(21, 30) + 1, 1.3, '#f2c39b', '#d99a72', 830) + corolla(43, 27.5, dome(43, 31) + 1, 1.3, '#f1e6c4', '#dcc185', 850)


FRAMES = {'bush': P.leaf_bush, 'berry': P.berry_bush, 'fern': fern, 'flower': flower}


def pad(rows):
    w, h = SIZE
    blank = '.' * w
    return [blank] * OFF[1] + ['.' * OFF[0] + r + '.' * (w - OFF[0] - P.W) for r in rows] + [blank] * (h - OFF[1] - P.H)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    manifest = json.loads((GAME / 'assets/manifest.json').read_text(encoding='utf-8'))['sheets']['plants']
    old = json.loads((GAME / 'assets' / manifest['atlas']).read_text(encoding='utf-8'))
    if manifest['names'] != NAMES or list(old['frames']) != NAMES or list(manifest['pivot']) != list(PIVOT):
        raise SystemExit('plants: 名前・順・pivot が既存と違います')
    durations = [f['duration'] for f in old['frames'].values()]
    tags = [None] * len(NAMES)
    for t in old['meta']['frameTags']:
        for i in range(t['from'], t['to'] + 1):
            tags[i] = t['name']
    cols = old['meta']['size']['w'] // SIZE[0]
    built = [[pad(r) for r in P.project_rows(P.rasterize(FRAMES[n]()))[:3]] for n in NAMES]
    lines = header(SIZE, PIVOT)
    for n, b in zip(NAMES, built):
        part(lines, n, b[0])
    for n, d, t in zip(NAMES, durations, tags):
        frame(lines, n, [(n, 0, 0)], duration=d, tag=t)
    stub = {'size': list(SIZE), 'pivot': list(PIVOT), 'frames': [{'name': n, 'duration': d} for n, d in zip(NAMES, durations)]}
    projects = {'albedo': Editor().apply('\n'.join(lines)), 'normal': project_lines(stub, NORMAL_COLORS, [b[1] for b in built]),
                'height': project_lines(stub, HEIGHT_COLORS, [b[2] for b in built])}
    for i, n in enumerate(NAMES):   # render したフレームごとに 3 つの alpha が一致すること
        alphas = {k: render(p, p['frames'][i])[0].getchannel('A').tobytes() for k, p in projects.items()}
        if len(set(alphas.values())) != 1:
            raise SystemExit(f'plants/{n}: albedo/normal/height の alpha が一致しません')
    OUT.mkdir(parents=True, exist_ok=True)
    for key, project in projects.items():
        check(project)
        save(project, OUT / f'{key}.json')
        print('plants', key, 'warnings:', export(project, OUT / key, columns=cols)['warnings'])


if __name__ == '__main__':
    main()
