"""束2: 32px ground基準タイル（8地形×6変種）と dual-grid の縁（mask 1..15）をWorkbenchへ出力する。

使い方: python art/build_style_ground.py [--only ground|edges]
出力: art/r2/ground.{dot,json} / art/r2/edges.{dot,json} / assets/r2-preview/{ground,edges}/
frame名は `{地形}{0..5}` と `edge_{縁の種類}_{mask}`。mask は NW=1 NE=2 SW=4 SE=8（その角のセルが縁の地形）。
※既存manifestの名前は読んでいないので、置換時にCodexが名前表を合わせること。
"""
import argparse
import math
import random

from style import Canvas, build_lines, finish, ramp

N = 32
HALF = N // 2
VARIANTS = 6
TERRAINS = ('grass', 'darkgrass', 'dirt', 'path', 'sand', 'cave', 'moss', 'ruin')

# 草の房5形（傾いた非対称）。t=先端(明) b=本体 s=根元の右1〜2pxの影
TUFTS = (
    ['.t.', '.bt', 'bb.', '.s.'],
    ['t...', 'bt.t', '.bb.', '..ss'],
    ['..t.t', '.tb.b', '.bbb.', '...ss'],
    ['.t.', 'tb.', '.bb', '..s'],
    ['t.t..', 'bb.t.', '.bbb.', '...s.'],
)
# 房群の置き場所（四分円 0=NW 1=NE 2=SW 3=SE）。6変種で組み合わせが重ならない
QUADRANTS = ((0, 0), (16, 0), (0, 16), (16, 16))
QUAD_PLANS = ((0, 3), (1,), (2,), (0,), (3,), (1, 2))
PEBBLE = ['pp', 'pp', 'ss']
PITS = [['dd'], ['ddd'], ['dd', 'dd'], ['ddd', 'ddd'], ['dd', '.d']]
GRAVEL = [['gg', 'gg'], ['ggg', 'ggg'], ['.gg', 'ggg'], ['gg.', 'ggg', '.gg']]
# 砂の波紋: (長さ, 行のずれ) の連なり。2px以上の段で繋ぎ、1pxの点にしない
ARCS = [[(2, 1), (2, 0), (2, 1)], [(2, 1), (3, 0), (2, 1)], [(2, 0), (3, 1)], [(3, 1), (2, 0)], [(2, 1), (2, 0)]]


def shape(rows, key):
    """文字の絵 → [(dx, dy, 記号)]。'.'は空き。"""
    return [(x, y, key[ch]) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch != '.']


def normalize(cells):
    x0 = min(c[0] for c in cells)
    y0 = min(c[1] for c in cells)
    return [(x - x0, y - y0, c) for x, y, c in cells]


def blob(rx, ry, c):
    w, h = math.ceil(2 * rx) + 1, math.ceil(2 * ry) + 1
    cells = [(x, y, c) for y in range(h) for x in range(w)
             if ((x + 0.5 - w / 2) / rx) ** 2 + ((y + 0.5 - h / 2) / ry) ** 2 <= 1]
    return normalize(cells)


def crack(rng, length, color):
    """4近傍で繋がる細いひび。右へ進み、ときどき上下へ1段ずれる。"""
    x = y = 0
    cells = {(0, 0)}
    while len(cells) < length:
        if rng.random() < 0.4:
            y += rng.choice((-1, 1))
        else:
            x += 1
        cells.add((x, y))
    return normalize([(cx, cy, color) for cx, cy in cells])


def arc(segments, color):
    cells, x = [], 0
    for length, dy in segments:
        cells += [(x + i, dy, color) for i in range(length)]
        x += length
    return cells


def lump(rng, body, core):
    """苔の塊: body の楕円の上に core の2x2〜3x2を載せる。"""
    cells = {(x, y): body for x, y, _ in blob(rng.uniform(3, 4.5), rng.uniform(2, 3), body)}
    for dx in range(rng.choice((2, 3))):
        for dy in range(2):
            if (1 + dx, 1 + dy) in cells:
                cells[(1 + dx, 1 + dy)] = core
    return normalize([(x, y, c) for (x, y), c in cells.items()])


class Placer:
    """タイル端で折り返す塊の配置器。塊同士は1px空けて、塊が繋がって汚れにならないようにする。"""

    def __init__(self, cv, rng):
        self.cv, self.rng = cv, rng
        self.taken, self.halo = set(), set()

    def try_place(self, cells, region=None, tries=300):
        w = max(c[0] for c in cells) + 1
        h = max(c[1] for c in cells) + 1
        if region and (region[2] - w < region[0] or region[3] - h < region[1]):
            return False
        for _ in range(tries):
            if region:
                ox = self.rng.randint(region[0], region[2] - w)
                oy = self.rng.randint(region[1], region[3] - h)
            else:
                ox, oy = self.rng.randrange(N), self.rng.randrange(N)
            pts = [((ox + dx) % N, (oy + dy) % N) for dx, dy, _ in cells]
            if any(p in self.halo for p in pts):
                continue
            for (x, y), (_, _, c) in zip(pts, cells):
                self.cv.g[y][x] = c
            self.taken.update(pts)
            for x, y in pts:
                self.halo.update(((x + a) % N, (y + b) % N) for a in (-1, 0, 1) for b in (-1, 0, 1))
            return True
        return False

    def ratio(self):
        return len(self.taken) / (N * N)


def noise_runs(rng, n):
    """斑の縁を上下させる量。2〜4列ごとに-1/0/+1で、1列だけの出入りを作らない。"""
    out = []
    while len(out) < n:
        out += [rng.choice((-1, 0, 0, 1))] * rng.randint(2, 4)
    return out[:n]


def patch_cells(rng, w, h):
    """斑: 幅w・高さhの楕円の塊。上下の縁は段差のある不規則な線にする。"""
    rx, ry = w / 2, h / 2
    top, bot = noise_runs(rng, w), noise_runs(rng, w)
    cells = []
    for i in range(w):
        e = math.sqrt(max(0.0, 1 - ((i + 0.5 - rx) / rx) ** 2))
        t = max(0, round(ry - ry * e) + top[i])
        b = min(h - 1, round(ry + ry * e) - 1 + bot[i])
        if b - t >= 2:
            cells += [(i, y) for y in range(t, b + 1)]
    return cells


def scatter_patches(rng):
    """1〜2個の大きな斑（幅10〜18px）。タイルの端で折り返し、2つ目は1つ目から離す。"""
    count = rng.choice((1, 2))
    cells, centers = set(), []
    for _ in range(count):
        w, h = (rng.randint(15, 18), rng.randint(10, 12)) if count == 1 else (rng.randint(12, 16), rng.randint(8, 10))
        for _try in range(50):
            ox, oy = rng.randrange(N), rng.randrange(N)
            if all(max(min(abs(ox - a), N - abs(ox - a)), min(abs(oy - b), N - abs(oy - b))) >= 11 for a, b in centers):
                break
        centers.append((ox, oy))
        cells |= {((ox + x) % N, (oy + y) % N) for x, y in patch_cells(rng, w, h)}
    return cells


D4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def break_edge(rng, patch):
    """斑の硬い多角形の輪郭を、2〜3pxの群れ単位で崩す。縁の画素を群れで欠き、外側へ2〜3pxの小さな群れを出す。

    色は増やさない（斑と同じbody色）。1pxの出入りにはせず、タイルの端で折り返す。
    """
    def outside(p, d):
        return ((p[0] + d[0]) % N, (p[1] + d[1]) % N)

    edge = sorted(p for p in patch if any(outside(p, d) not in patch for d in D4))
    rng.shuffle(edge)
    out, touched = set(patch), set()
    for p in edge:
        if p in touched or rng.random() < 0.5:
            continue
        group = [p]
        for _ in range(rng.choice((1, 2))):
            nxt = [q for q in (outside(group[-1], d) for d in D4) if q in patch and q not in touched and q not in group
                   and any(outside(q, d) not in patch for d in D4)]
            if not nxt:
                break
            group.append(rng.choice(nxt))
        if len(group) < 2:
            continue
        for q in group:
            out.discard(q)
            touched.add(q)
            touched.update(outside(q, d) for d in D4)
    for p in edge:
        if p in touched or rng.random() < 0.7:
            continue
        gaps = [d for d in D4 if outside(p, d) not in patch]
        d = rng.choice(gaps)
        side = (d[1], d[0])  # 縁に沿う向き
        run = [outside(outside(p, d), d)]  # 縁から1px空けた所に、縁に沿った2〜3pxの群れ
        for _ in range(rng.choice((1, 2))):
            run.append(outside(run[-1], side))
        if any(q in patch or q in touched or any(outside(q, e) in patch for e in D4) for q in run):
            continue
        out.update(run)
        touched.update(run)
    return out


def tuft_cells(rows, ox, oy):
    return {(ox + x, oy + y) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch != '.'}


def place_group(rng, quadrant, count, uses):
    """1つの房群: 四分円の内側（1px余白）に count 個を、房どうし1〜3px空けて置く。同じ形は1タイル2個まで。置けなければNone。"""
    qx, qy = quadrant
    lo_x, lo_y, hi_x, hi_y = qx + 1, qy + 1, qx + HALF - 2, qy + HALF - 2
    placed, group = [], set()
    for _ in range(count):
        for _try in range(300):
            k = rng.randrange(len(TUFTS))
            if uses[k] >= 2:
                continue
            rows = TUFTS[k]
            w, h = len(rows[0]), len(rows)
            ox, oy = rng.randint(lo_x, hi_x - w + 1), rng.randint(lo_y, hi_y - h + 1)
            cells = tuft_cells(rows, ox, oy)
            if group and not 2 <= min(max(abs(a - c), abs(b - d)) for a, b in cells for c, d in group) <= 4:
                continue
            uses[k] += 1
            placed.append((rows, ox, oy))
            group |= cells
            break
        else:
            return None
    return placed


def scatter_tufts(rng, plan):
    """plan の四分円ごとに房群を置く。1群なら3〜4個、2群なら各2〜3個（計4〜6個）。"""
    uses = [0] * len(TUFTS)
    counts = [rng.choice((3, 4))] if len(plan) == 1 else [rng.choice((2, 3)) for _ in plan]
    tufts = []
    for quad, n in zip(plan, counts):
        group = place_group(rng, QUADRANTS[quad], n, uses)
        if group is None:
            return None
        tufts += group
    return tufts


def has_quiet(cells, size=12):
    """房も影もない size×size 以上の範囲が、タイル内（折り返しなし）にあるか。"""
    for oy in range(N - size + 1):
        for ox in range(N - size + 1):
            if not any(ox <= x < ox + size and oy <= y < oy + size for x, y in cells):
                return True
    return False


def tufted(rng, variant, base, body, tip, shade):
    """草地: 地(base)に body 色の大きな斑を1〜2個置き、四分円ごとの房群（2〜4個）を1〜2群置く。

    房は傾いた非対称5形。斑の外は本体body・先端tip、斑の中は本体tipだけ（先端なし）。影は根元の右1〜2px。
    質感は斑と房群で満たす。地以外の画素が18〜26%、うち斑60%以上・房40%以下になる配置を探し、
    房を足して割合を合わせることはしない（房なしの静かな12x12を守るため）。
    """
    plan = QUAD_PLANS[variant % len(QUAD_PLANS)]
    for _ in range(500):
        patch = break_edge(rng, scatter_patches(rng))
        tufts = scatter_tufts(rng, plan)
        if tufts is None:
            continue
        cv = Canvas(N, N, base)
        for x, y in patch:
            cv.g[y][x] = body
        painted = set()
        for rows, ox, oy in tufts:
            cells = [(ox + x, oy + y, ch) for y, row in enumerate(rows) for x, ch in enumerate(row) if ch != '.']
            bodies = [(x, y) for x, y, ch in cells if ch == 'b']
            inside = 2 * sum(p in patch for p in bodies) >= len(bodies)
            for x, y, ch in cells:
                if ch == 't' and inside:
                    continue
                cv.g[y][x] = shade if ch == 's' else (tip if inside else body) if ch == 'b' else tip
                painted.add((x, y))
        non_base = sum(c != base for row in cv.g for c in row)
        if 0.19 <= non_base / (N * N) <= 0.25 and len(patch - painted) >= 0.6 * non_base and has_quiet(painted):
            return cv
    raise ValueError(f'草タイル{variant}: 斑と房群の条件（18〜26%・斑60%以上・静かな12x12）を満たす配置が見つかりません')


def tile_grass(rng, variant):
    return tufted(rng, variant, ramp('G', 2), ramp('G', 3), ramp('G', 4), ramp('G', 1))


def tile_darkgrass(rng, variant):
    return tufted(rng, variant, ramp('G', 1), ramp('G', 2), ramp('G', 3), ramp('K', 3))


def tile_dirt(rng):
    cv = Canvas(N, N, ramp('E', 3))
    pit, stone = ramp('E', 2), ramp('E', 4)
    placer = Placer(cv, rng)
    for _ in range(5):
        placer.try_place(shape(PEBBLE, {'p': stone, 's': pit}))
    for _ in range(3):
        placer.try_place(crack(rng, rng.randint(3, 6), pit))
    while placer.ratio() < 0.115:
        rows = rng.choice(PITS) if rng.random() < 0.7 else None
        cells = shape(rows, {'d': pit}) if rows else shape(PEBBLE, {'p': stone, 's': pit})
        if not placer.try_place(cells):
            break
    return cv


def tile_path(rng):
    """踏み跡: E3の地の中央にE4の擦れた面。縁側はE3のまま残す。"""
    cv = Canvas(N, N, ramp('E', 3))
    wear, pit = ramp('E', 4), ramp('E', 2)
    placer = Placer(cv, rng)
    for _ in range(3):
        placer.try_place(shape(rng.choice(PITS), {'d': pit}), region=(2, 2, 30, 30))
    misses = 0
    while placer.ratio() < 0.115 and misses < 40:
        cells = blob(rng.uniform(1.6, 3.4), rng.uniform(1.2, 2.4), wear)
        if not placer.try_place(cells, region=(4, 4, 28, 28), tries=60):
            misses += 1
    return cv


def tile_sand(rng):
    cv = Canvas(N, N, ramp('S', 2))
    wave, grain = ramp('S', 1), ramp('S', 3)
    placer = Placer(cv, rng)
    for _ in range(5):
        placer.try_place(arc(rng.choice(ARCS), wave))
    while placer.ratio() < 0.075:
        if not placer.try_place([(0, 0, grain), (1, 0, grain)]):
            break
    return cv


def tile_cave(rng):
    cv = Canvas(N, N, ramp('R', 2))
    gravel, crevice = ramp('R', 3), ramp('R', 1)
    placer = Placer(cv, rng)
    for _ in range(3):
        placer.try_place(crack(rng, rng.randint(4, 8), crevice))
    while placer.ratio() < 0.14:
        if not placer.try_place(shape(rng.choice(GRAVEL), {'g': gravel})):
            break
    return cv


def tile_moss(rng):
    cv = Canvas(N, N, ramp('G', 1))
    placer = Placer(cv, rng)
    while placer.ratio() < 0.17:
        if not placer.try_place(lump(rng, ramp('G', 2), ramp('G', 3))):
            break
    return cv


def tile_ruin(rng):
    """16px敷石を半枚ずらして敷き、縁に明線・ひび・たまに苔を足す。"""
    cv = Canvas(N, N, ramp('R', 2))
    joint, bevel = ramp('R', 1), ramp('R', 3)
    for row in range(2):
        y0 = row * 16
        for x in range(N):
            cv.set(x, y0, joint)
        for slab in range(2):
            x0 = (row * 8 + slab * 16) % N
            for y in range(y0, y0 + 16):
                cv.set(x0, y, joint, wrap=True)
            for x in range(x0 + 1, x0 + rng.randint(8, 13)):
                cv.set(x, y0 + 1, bevel, wrap=True)
            for y in range(y0 + 2, y0 + rng.randint(5, 10)):
                cv.set(x0 + 1, y, bevel, wrap=True)
    placer = Placer(cv, rng)
    for _ in range(2):
        placer.try_place(crack(rng, rng.randint(5, 8), joint))
    if rng.random() < 0.5:
        placer.try_place(lump(rng, ramp('G', 2), ramp('G', 3)))
    return cv


TILE_BUILDERS = {
    'grass': tile_grass, 'darkgrass': tile_darkgrass, 'dirt': tile_dirt, 'path': tile_path,
    'sand': tile_sand, 'cave': tile_cave, 'moss': tile_moss, 'ruin': tile_ruin,
}
BASE_OF = {
    'grass': ramp('G', 2), 'darkgrass': ramp('G', 1), 'dirt': ramp('E', 3), 'path': ramp('E', 3),
    'sand': ramp('S', 2), 'cave': ramp('R', 2), 'moss': ramp('G', 1),
}
# 基準タイルで地の色以外が占める割合の許容範囲（草18〜26%、土・道10〜15%は文書どおり）
RATIO_RANGE = {
    'grass': (0.18, 0.26), 'darkgrass': (0.18, 0.26), 'dirt': (0.10, 0.15), 'path': (0.10, 0.15),
    'sand': (0.05, 0.16), 'cave': (0.10, 0.20), 'moss': (0.12, 0.26),
}


def build_tiles():
    tiles = {}
    for terrain, builder in TILE_BUILDERS.items():
        tiles[terrain] = []
        for variant in range(VARIANTS):
            rng = random.Random(f'{terrain}:{variant}')
            cv = builder(rng, variant) if terrain in ('grass', 'darkgrass') else builder(rng)
            if terrain in RATIO_RANGE:
                base = BASE_OF[terrain]
                ratio = sum(c != base for row in cv.g for c in row) / (N * N)
                low, high = RATIO_RANGE[terrain]
                if not low <= ratio <= high:
                    raise ValueError(f'{terrain}{variant}: 地以外の割合 {ratio:.1%} が範囲 {low:.0%}〜{high:.0%} を外れました')
            tiles[terrain].append(cv)
    return tiles


# 縁の種類: 重ねる地形(fill)・草の厚みの帯・上の明縁・落ちる影・房の高さ範囲
EDGE_SETS = [
    dict(name='grass', fill='grass', band=ramp('G', 1), hi=ramp('G', 4), shadow=ramp('E', 2), lobe=(4, 5)),
    dict(name='grass_sand', fill='grass', band=ramp('G', 1), hi=ramp('G', 4), shadow=ramp('S', 1), lobe=(4, 5)),
    dict(name='darkgrass', fill='darkgrass', band=ramp('K', 3), hi=ramp('G', 3), shadow=ramp('G', 1), lobe=(4, 5)),
    dict(name='dirt', fill='dirt', band=ramp('E', 2), hi=ramp('E', 4), shadow=ramp('S', 1), lobe=(3, 4)),
    dict(name='path', fill='path', band=ramp('E', 2), hi=ramp('E', 4), shadow=ramp('S', 1), lobe=(3, 4)),
    dict(name='sand', fill='sand', band=ramp('S', 1), hi=ramp('S', 3), shadow=ramp('E', 2), lobe=(3, 4)),
    dict(name='sand_water', fill='sand', band=ramp('S', 1), hi=ramp('S', 3), shadow=ramp('A', 1), lobe=(3, 4)),
    dict(name='moss', fill='moss', band=ramp('K', 3), hi=ramp('G', 3), shadow=ramp('R', 1), lobe=(4, 5)),
]


def lobe_profile(rng, hmin, hmax):
    """中心から縁へ16画素分の張り出し量。房の幅は3〜6px、同じ房を3つ続けない。縁(末尾)は必ず0で、隣のタイルと繋ぐ。"""
    for _ in range(500):
        widths, total = [], 0
        while total < HALF:
            w = min(rng.randint(3, 6), HALF - total)
            widths.append(w)
            total += w
        if widths[-1] < 3:
            continue
        lobes = [(w, rng.randint(hmin, hmax)) for w in widths]
        if any(lobes[i] == lobes[i + 1] == lobes[i + 2] for i in range(len(lobes) - 2)):
            continue
        break
    else:
        raise RuntimeError('房の並びを作れませんでした')
    profile = []
    for w, h in lobes:
        for i in range(w):
            u = (2 * i + 1 - w) / w
            profile.append(max(0, round(h * math.sqrt(1 - u * u)) - 1))
    profile[-1] = 0
    return profile


def push_row(m, y, west, east, d):
    """縦の境界(x=16)を、被覆側の反対へ d 画素押し出す。"""
    if west and not east:
        for x in range(HALF, HALF + d):
            m[y][x] = True
    elif east and not west:
        for x in range(HALF - d, HALF):
            m[y][x] = True


def push_col(m, x, north, south, d):
    if north and not south:
        for y in range(HALF, HALF + d):
            m[y][x] = True
    elif south and not north:
        for y in range(HALF - d, HALF):
            m[y][x] = True


def edge_tile(spec, mask, fill):
    """dual-gridの縁タイル。返り値は (Canvas, 被覆mask)。

    被覆maskは四隅のセルから作り、4本の腕（中心→タイル縁の16画素）に房の凹凸を足す。
    腕の末端（タイル縁）の張り出しは0なので、隣のタイルの腕とそのまま繋がる。
    """
    cell = {'NW': bool(mask & 1), 'NE': bool(mask & 2), 'SW': bool(mask & 4), 'SE': bool(mask & 8)}
    m = [[cell[('N' if y < HALF else 'S') + ('W' if x < HALF else 'E')] for x in range(N)] for y in range(N)]
    prof = {arm: lobe_profile(random.Random(f'{spec["name"]}:{mask}:{arm}'), *spec['lobe']) for arm in 'NSWE'}
    for t in range(HALF):
        push_row(m, HALF - 1 - t, cell['NW'], cell['NE'], prof['N'][t])
        push_row(m, HALF + t, cell['SW'], cell['SE'], prof['S'][t])
        push_col(m, HALF - 1 - t, cell['NW'], cell['SW'], prof['W'][t])
        push_col(m, HALF + t, cell['NE'], cell['SE'], prof['E'][t])

    def inside(x, y):
        return m[min(max(y, 0), N - 1)][min(max(x, 0), N - 1)]

    cv = Canvas(N, N)
    band = set()
    for y in range(N):
        for x in range(N):
            if not m[y][x]:
                continue
            cv.g[y][x] = fill.g[y][x]
            if not inside(x, y + 1):
                # 下へ開いた縁: 草の厚みの暗い帯を2px
                band.add((x, y))
                if inside(x, y - 1):
                    band.add((x, y - 1))
            elif not inside(x + 1, y):
                band.add((x, y))
    for y in range(N):
        for x in range(N):
            if not m[y][x]:
                # 光は左上: 被覆の右・下・右下にだけ1pxの影が落ちる
                if inside(x - 1, y) or inside(x, y - 1) or inside(x - 1, y - 1):
                    cv.g[y][x] = spec['shadow']
            elif (x, y) in band:
                cv.g[y][x] = spec['band']
            elif not inside(x, y - 1) or not inside(x - 1, y):
                cv.g[y][x] = spec['hi']
    return cv, m


def build_edges(tiles):
    """全縁タイルを作り、隣接する全ての組で被覆maskが縁で繋がることを検査する。"""
    frames, masks = [], {}
    for spec in EDGE_SETS:
        masks[spec['name']] = {0: [[False] * N for _ in range(N)], 15: [[True] * N for _ in range(N)]}
        for mask in range(1, 16):
            fill = tiles[spec['fill']][(mask + 1) % VARIANTS]
            cv, m = edge_tile(spec, mask, fill)
            masks[spec['name']][mask] = m
            frames.append((f'edge_{spec["name"]}_{mask}', cv))
        verify_edges(spec['name'], masks[spec['name']])
    return frames


def verify_edges(name, masks):
    """左右・上下に隣り合える全てのmask組で、接する縁の被覆が一致することを確かめる。"""
    for a in range(16):
        for b in range(16):
            if (a & 2 > 0) == (b & 1 > 0) and (a & 8 > 0) == (b & 4 > 0):
                if any(masks[a][y][N - 1] != masks[b][y][0] for y in range(N)):
                    raise ValueError(f'{name}: mask {a}→{b} の左右の継ぎ目が繋がりません')
            if (a & 4 > 0) == (b & 1 > 0) and (a & 8 > 0) == (b & 2 > 0):
                if any(masks[a][N - 1][x] != masks[b][0][x] for x in range(N)):
                    raise ValueError(f'{name}: mask {a}↓{b} の上下の継ぎ目が繋がりません')


def main():
    ap = argparse.ArgumentParser(description='束2 ground基準タイルとdual-grid縁をWorkbenchへ出力する')
    ap.add_argument('--only', choices=('ground', 'edges'), help='片方だけ出力する')
    args = ap.parse_args()
    tiles = build_tiles()
    if args.only in (None, 'ground'):
        items = [(f'{t}{v}', tiles[t][v]) for t in TERRAINS for v in range(VARIANTS)]
        finish('ground', build_lines((N, N), (0, 0), items))
    if args.only in (None, 'edges'):
        finish('edges', build_lines((N, N), (0, 0), build_edges(tiles)))


if __name__ == '__main__':
    main()
