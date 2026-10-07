"""旧造形専用の制作履歴。主人公の造形は未承認。新しい作者の基準絵をこの生成器で上書きしない。
Explorer3 articulated rig builder (phase 2: DOWN, UP, RIGHT, LEFT x 12 frames = 48). Native Workbench, no Pillow pixel edits.

Basis: the approved static front art/hero-static3.json. DOWN reuses its parts (hair, face, torso, scarf, pouch, hands, boots,
hips, arms, legs) with the exact palette; arms are split into upper/fore/hand and legs into thigh/shin/boot. UP and RIGHT use new
authored parts (back hair / back mantle / scarf band; side head with one eye and nose / rear hair volume / narrow side coat), the
same palette and the same limb capsules. LEFT is RIGHT mirrored about x=24 (pixels x -> 47-x, N_X negated, N_Y and height kept,
layer ids and meta L/R swapped, meta.local_x_flip = true, flip_pivot = [24, 58]).
Limbs that leave the approved hang/stand pose are re-rasterised as capsules between that pose's shoulder-elbow-wrist / hip-knee-ankle
(never a rotated or band-shifted bitmap). Rolling frames are composed from cloak/hair/scarf/arm/boot volumes. Normals and heights come
from analytic ellipsoid/capsule primitives per posed part (build_hero_lightbox3.hit/surface), never from pixel luminance.
Foot, lantern-glass and head-height metadata are measured from the final pixels/geometry, not predicted.

  python art/build_explorer3.py [--dirs down up right left] [--columns 8] [--out .review/v3/explorer-production]

Writes {albedo,normal,height}/ (atlas, contact, per-tag gifs, review.html; atlas.json meta.frameMeta = poses record),
{albedo,normal,height}.json and poses.json. Promotes nothing to assets/.
"""
from pathlib import Path
import argparse, json, math
from style import GAME, SYMBOLS
from engine import Editor, load, render, digest
from pixelwork import export, save
import build_hero_lightbox3 as LB
from build_hero_lightbox3 import shapes, surface, ell, ROUGH, SKIN_PARTS, K, Y0
from build_normal_maps import VECTORS

SRC = GAME / 'art/hero-static3.json'
OUT = GAME / '.review/v3/explorer-production'
APP = load(SRC)
W, H = APP['size']
PV = APP['pivot']
HEX = {k: v.lower() for k, v in APP['palette'].items() if k != '.'}
INK = '#16151d'
HAIR = {'H': '#934f3f', 'L': '#b36f52', 'D': '#6e3a33', 'o': '#4a2626'}
SCARF = {'M': '#4fb39a', 'N': '#2f7a6e', 'o': '#1d4a4a'}
COAT = {'o': '#1e2f4a', 'r': '#2e4a6b', 'k': '#3b2a22'}
ARM = {'o': '#1e2f4a', 'r': '#2e4a6b', 'q': '#1e2f4a'}
PANTS = {'o': '#1c2238', 'm': '#2a3556'}
BOOT = {'E': '#80664d', 'C': '#9b7f60', 'B': '#4b3b2d'}
SOLE = '#3b2a22'
METAL = ('#b0913a', '#7d6a2c')
GLASS = '#ffe08a'
DIRS = ('down', 'up', 'right', 'left')
HEAD_IDS = {'head_face', 'hair_back', 'hair_front', 'hair_up', 'head_side', 'hair_side', 'hair_mass'}
warnings = []

# frame-0 layers of the approved front give the exact placement and draw order
LAY = {l['id']: l for l in APP['frames'][0]['layers']}
BASE_ORDER = [l['id'] for l in APP['frames'][0]['layers'] if l['id'] != 'outline']
NEED = {'hair_back', 'hips', 'leg_L', 'leg_R', 'boot_L', 'boot_R', 'arm_L', 'arm_R', 'torso_mantle', 'scarf_tail',
        'head_face', 'hair_front', 'scarf', 'pouch', 'hand_L', 'hand_R', 'lantern'}
if set(BASE_ORDER) != NEED:
    raise ValueError(('approved front layers changed', sorted(set(BASE_ORDER) ^ NEED)))
def rows_of(name): return APP['parts'][LAY[name]['part']]['rows']
def sym(hexcol): return next(k for k, v in HEX.items() if v == hexcol.lower())
SYMBOL_OF = {v: k for k, v in HEX.items()}

DEF = dict(shoulder={'L': (17, 35), 'R': (31, 35)}, elbow={'L': (16, 40), 'R': (32, 40)}, wrist={'L': (16, 46), 'R': (32, 46)},
           hip={'L': (21, 46), 'R': (27, 46)}, knee={'L': (21, 50), 'R': (27, 50)}, ankle={'L': (19, 55), 'R': (28, 55)})
# geometry axes that follow the approved art centres (L figure; R mirrored about x=24)
HANG_GEO = {'sh': (15.5, 35.5), 'el': (14.8, 40.5), 'wr': (16., 45.5)}
mirror = lambda p: (48 - p[0], p[1])

# side boots: toe to +x, heel one px behind the shaft, ankle-to-toe 5px; second variant shows the sole (#3b2a22)
SIDE_BOOT = ['.NOON...', '.NPPN...', '.NPPPPN.', 'NPPPPPPN', 'NNNNNNNN']
SIDE_BOOT_SOLE = ['.NOON...', '.NPPN...', '.NPPPPN.', 'NPPPPPPN', 'NEEEEEEN']
FAR_T = str.maketrans('OP', 'PN')      # far-side boots: one step darker, same palette

# ---------------------------------------------------------------- primitives / raster helpers
def cap(p0, p1, r, depth=.9, n=4, yoff=0.):
    """Capsule-like superellipsoid between two joints in frame (edge) coordinates, same conventions as lightbox ell().
    yoff pushes the shape back in depth (far-side limbs)."""
    (x0, y0), (x1, y1) = p0, p1
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    L = math.hypot(x1 - x0, y1 - y0) / 2
    t = math.atan2(x1 - x0, -(y1 - y0)) if L > 1e-6 else 0.
    c = L + r * .85
    cy = Y0 + yoff
    return dict(c=(mx, cy, PV[1] - my - K * cy), r=(r, max(.8, depth * r), c), n=n, t=t, H=c)

def blob(cx, cy, rx, ry, depth=.8, n=2):
    return ell((cx - rx, cy - ry, 2 * rx, 2 * ry), PV, .5, .5, 1., 1., depth, n)

def deepen(prims, d):
    return [dict(p, c=(p['c'][0], p['c'][1] + d, p['c'][2] - K * d)) for p in prims]

def seg_pts(p0, p1, r0, r1=None):
    r1 = r0 if r1 is None else r1
    vx, vy = p1[0] - p0[0], p1[1] - p0[1]
    l2 = vx * vx + vy * vy
    R = max(r0, r1) + 1
    pts = set()
    for py in range(int(math.floor(min(p0[1], p1[1]) - R)), int(math.ceil(max(p0[1], p1[1]) + R))):
        for px in range(int(math.floor(min(p0[0], p1[0]) - R)), int(math.ceil(max(p0[0], p1[0]) + R))):
            cx, cy = px + .5, py + .5
            t = 0. if l2 == 0 else min(1., max(0., ((cx - p0[0]) * vx + (cy - p0[1]) * vy) / l2))
            if math.hypot(cx - (p0[0] + t * vx), cy - (p0[1] + t * vy)) <= r0 + (r1 - r0) * t:
                pts.add((px, py))
    return pts

def ellipse_pts(cx, cy, rx, ry):
    return {(px, py) for py in range(int(cy - ry) - 1, int(cy + ry) + 2) for px in range(int(cx - rx) - 1, int(cx + rx) + 2)
            if ((px + .5 - cx) / rx) ** 2 + ((py + .5 - cy) / ry) ** 2 <= 1}

N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
def edge_of(pts): return {p for p in pts if any((p[0] + dx, p[1] + dy) not in pts for dx, dy in N4)}

def shift(pix, dx, dy): return {(x + dx, y + dy): c for (x, y), c in pix.items()}
def shift_prim(p, dx, dy): return dict(p, c=(p['c'][0] + dx, p['c'][1], p['c'][2] - dy))
def crouch_pix(pix, y0, n):
    """authored compress: drop n rows from y0 and close the gap"""
    return {(x, y if y < y0 else y - n): c for (x, y), c in pix.items() if not y0 <= y < y0 + n}

def paint_arm(pts, side, el):
    outer = -1 if side == 'L' else 1
    pix = {p: (ARM['o'] if (p[0] + outer, p[1]) not in pts else ARM['r']) for p in pts}
    q = (int(math.floor(el[0])), int(math.floor(el[1])))
    if q in pix: pix[q] = ARM['q']
    return pix

def paint_leg(pts):
    return {p: (PANTS['o'] if ((p[0] - 1, p[1]) not in pts or (p[0] + 1, p[1]) not in pts) else PANTS['m']) for p in pts}

def paint_far(pts, col): return {p: col for p in pts}

# ---------------------------------------------------------------- layers
def clip(pix, id_):
    out = {p: c for p, c in pix.items() if 0 <= p[0] < W and 0 <= p[1] < H}
    if len(out) != len(pix): warnings.append(f'{id_}: {len(pix) - len(out)} px clipped by canvas')
    return out

def layer(id_, pix, prims, skin=False, glass=False):
    return dict(id=id_, pix=clip(pix, id_), prims=prims, skin=skin, glass=glass)

def placed(id_, pix, prims, dx=0, dy=0, **kw):
    """layer authored at its base position, then moved by the pose offset (pixels and shapes together)"""
    return layer(id_, shift(pix, dx, dy), [shift_prim(p, dx, dy) for p in prims], **kw)

def from_rows(rows, x0, y0):
    return {(x0 + i, y0 + j): HEX[c] for j, row in enumerate(rows) for i, c in enumerate(row) if c != '.'}

def static(name, dx=0, dy=0, rows=None, id_=None):
    L0 = LAY[name]
    rows = rows_of(name) if rows is None else rows
    x0, y0 = L0['x'] + dx, L0['y'] + dy
    rect = (x0, y0, len(rows[0]), len(rows))
    return layer(id_ or name, from_rows(rows, x0, y0), shapes(name, rect, PV), skin=name in SKIN_PARTS, glass=name == 'lantern')

def arm_layers(s, spec, front):
    L0 = LAY['arm_' + s]
    if spec[0] == 'hang':
        _, du, df, dh = spec
        rows = rows_of('arm_' + s)
        sh, el, wr = DEF['shoulder'][s], DEF['elbow'][s], DEF['wrist'][s]
        g = {k: (v if s == 'L' else mirror(v)) for k, v in HANG_GEO.items()}
        up = layer(f'arm_{s}_upper', from_rows(rows[:5], L0['x'], L0['y'] + du), [cap((g['sh'][0], g['sh'][1] + du), (g['el'][0], g['el'][1] + df), 2.3)])
        fo = layer(f'arm_{s}_fore', from_rows(rows[5:], L0['x'], L0['y'] + 5 + df), [cap((g['el'][0], g['el'][1] + df), (g['wr'][0], g['wr'][1] + dh), 1.9)])
        hand = static('hand_' + s, 0, dh)
        joints = dict(shoulder=(sh[0], sh[1] + du), elbow=(el[0], el[1] + df), wrist=(wr[0], wr[1] + dh))
    else:
        _, sh, el, wr = spec
        up = layer(f'arm_{s}_upper', paint_arm(seg_pts(sh, el, 2.3, 2.0), s, el), [cap(sh, el, 2.3)])
        fo = layer(f'arm_{s}_fore', paint_arm(seg_pts(el, wr, 1.9, 1.7), s, el), [cap(el, wr, 1.9)])
        hx, hy = int(wr[0]) - 2, int(wr[1]) - 2
        hrows = rows_of('hand_' + s)
        hand = layer(f'hand_{s}', from_rows(hrows, hx, hy), shapes('hand_' + s, (hx, hy, len(hrows[0]), len(hrows)), PV))
        joints = dict(shoulder=sh, elbow=el, wrist=wr)
    return up, fo, hand, joints

def shaft_x(s, ax): return ax + 1.5 if s == 'L' else ax - .5

def lift_rows(s):
    src = rows_of('boot_' + s)
    rows = src[:2] + src[3:]
    last = list(rows[-1])
    pos = (4, 5) if s == 'L' else (1, 2)       # heel side shows two px of the #3b2a22 sole
    for i in pos: last[i] = sym(SOLE)
    rows[-1] = ''.join(last)
    return rows

def leg_layers(s, hip, spec):
    d = DEF
    knee, ankle, kind, state = (d['knee'][s], d['ankle'][s], 'stand', 'P') if spec is None else spec
    L0 = LAY['leg_' + s]
    rows = rows_of('leg_' + s)
    sx = shaft_x(s, ankle[0])
    if knee == d['knee'][s] and ankle == d['ankle'][s]:
        th = layer(f'thigh_{s}', from_rows(rows[:3], L0['x'], L0['y']), [cap((hip[0], hip[1] + .5), knee, 2.2)])
        sh = layer(f'shin_{s}', from_rows(rows[3:], L0['x'], L0['y'] + 3), [cap(knee, (sx, ankle[1]), 1.8)])
    else:
        th = layer(f'thigh_{s}', paint_leg(seg_pts(hip, knee, 2.0, 1.95)), [cap(hip, knee, 2.2)])
        sh = layer(f'shin_{s}', paint_leg(seg_pts(knee, (sx, ankle[1]), 1.95, 1.8)), [cap(knee, (sx, ankle[1]), 1.8)])
    brows = rows_of('boot_' + s) if kind == 'stand' else lift_rows(s)
    sole = ankle[1] + 2
    bx, by = ankle[0] - 3, sole - (len(brows) - 1)
    boot = layer(f'boot_{s}', from_rows(brows, bx, by), shapes('boot_' + s, (bx, by, 7, len(brows)), PV))
    return th, sh, boot, dict(hip=hip, knee=knee, ankle=ankle), [bx + 3.5, sole, state]

# ---------------------------------------------------------------- pose composition (standard standing/walking/attack body)
def pose(**k):
    base = dict(up=(0, 0), head=(0, 0), tail=(0, 0), hips=(0, 0), torso='full', pouch=None, flare=[],
                arm={'L': ('hang', 0, 0, 0), 'R': ('hang', 0, 0, 0)}, front={'L': False, 'R': False},
                leg={'L': None, 'R': None}, lantern='wrist', grip=None, kind='std')
    base.update(k)
    return base

def std_limbs(P, lay, meta):
    """legs, arms, hands and lantern shared by DOWN and UP. Returns (lantern placement, planned feet)."""
    px, py = P['hips']; feet = {}
    for s in 'LR':
        hip = (DEF['hip'][s][0] + px, DEF['hip'][s][1] + py)
        th, sh, bo, j, ft = leg_layers(s, hip, P['leg'].get(s))
        lay['thigh_' + s], lay['shin_' + s], lay['boot_' + s] = th, sh, bo
        meta['joints'].update({f'{k}_{s}': list(v) for k, v in j.items()}); feet[s] = ft
        up, fo, hd, j = arm_layers(s, P['arm'][s], P['front'][s])
        lay['arm_%s_upper' % s], lay['arm_%s_fore' % s], lay['hand_' + s] = up, fo, hd
        meta['joints'].update({f'{k}_{s}': list(v) for k, v in j.items()})
    wr = meta['joints']['wrist_R']
    lp = (int(wr[0]) - 1, int(wr[1]) + 2, 'over') if P['lantern'] == 'wrist' else P['lantern']
    lay['lantern'] = static('lantern', lp[0] - LAY['lantern']['x'], lp[1] - LAY['lantern']['y'])
    return lp, feet

def lantern_plan(P, lp, meta):
    return dict(anchor=list(meta['joints']['wrist_R']) if P['lantern'] == 'wrist' else None, planned_origin=[lp[0], lp[1]], layer=lp[2])

def compose_std(P):
    ux, uy = P['up']; hx, hy = P['head']; px, py = P['hips']; tx, ty = P['tail']
    pdx, pdy = P['pouch'] or P['up']
    lay, meta = {}, {'joints': {}}
    lay['hair_back'] = static('hair_back', hx, hy)
    lay['head_face'] = static('head_face', hx, hy)
    lay['hair_front'] = static('hair_front', hx, hy)
    lay['hips'] = static('hips', px, py)
    trows = rows_of('torso_mantle')
    if P['torso'] == 'crouch': trows = trows[:5] + trows[9:]       # 4 chest rows removed (authored compress)
    lay['torso_mantle'] = static('torso_mantle', ux, uy, trows)
    for x, y, c in P['flare']: lay['torso_mantle']['pix'][(x, y)] = COAT[c]
    lay['scarf'] = static('scarf', ux, uy)
    lay['scarf_tail'] = static('scarf_tail', ux + tx, uy + ty)
    lay['pouch'] = static('pouch', pdx, pdy)
    lp, feet = std_limbs(P, lay, meta)
    order = ['hair_back', 'hips', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R', 'boot_L', 'boot_R']
    if lp[2] == 'under': order.append('lantern')
    for s in 'LR':
        if not P['front'][s]: order += [f'arm_{s}_upper', f'arm_{s}_fore']
    order += ['torso_mantle', 'scarf_tail', 'head_face', 'hair_front', 'scarf', 'pouch']
    for s in 'LR':
        if P['front'][s]: order += [f'arm_{s}_upper', f'arm_{s}_fore']
    order += ['hand_L', 'hand_R']
    if lp[2] == 'over': order.append('lantern')
    meta.update(feet=feet, pelvis=[24 + px, 45 + py], head=[24 + hx, 23 + hy], grip=P['grip'], lantern=lantern_plan(P, lp, meta))
    return [lay[k] for k in order], meta

# ---------------------------------------------------------------- UP (back view): new back hair / back mantle / scarf band, no face
def shade_hair_up(pts, cx=24):
    ed = edge_of(pts)
    def c(p):
        x, y = p
        if p in ed: return HAIR['D']
        if abs(x - (cx + 1)) + abs(y - 14) <= 1: return HAIR['D']                      # whorl
        if y > 25 and (x - 22) % 4 == 0: return HAIR['D']                              # gaps between the five locks
        if y < 17 and (x + y) % 4 == 0 and abs(x - cx) < 7: return HAIR['L']           # crown highlight
        return HAIR['H']
    return {p: c(p) for p in pts}

def hair_up(hx, hy, spread=0):
    """22x21 at x13-34, y11-31 covering the whole back of the head; five locks end at y29-31 (spread moves outer locks)"""
    pts = ellipse_pts(24, 20.5, 10.5, 9.5)
    prims = [blob(24, 20.5, 10.5, 9.5, .85)]
    for cx, n in ((16, 6), (20, 4), (24, 5), (28, 4), (32, 6)):
        ox = cx + (spread if cx > 24 else -spread if cx < 24 else 0)
        for j in range(n):
            pts |= {(x, 26 + j) for x in ((ox - 1, ox) if j < n - 1 else (ox,))}
        prims.append(cap((ox, 26), (ox, 25 + n), 1.2, .9))
    return placed('hair_up', shade_hair_up(pts), prims, hx, hy)

def mantle_up(ux, uy, crouch):
    """16x12 at y32-43; vertical groove #1e2f4a down the middle, belt row without buckle"""
    hw = {32: 5, 33: 7, 34: 8, 35: 8, 36: 8, 37: 8, 38: 8, 39: 8, 40: 8, 41: 8, 42: 7, 43: 7}
    pix = {}
    for y, h in hw.items():
        for x in range(24 - h, 24 + h):
            if x in (24 - h, 23 + h) or y in (32, 43): c = COAT['o']
            elif y == 42: c = HEX['F']
            elif x == 23 and y >= 34: c = COAT['o']
            else: c = COAT['r']
            pix[(x, y)] = c
    rect_h = 12
    if crouch: pix, rect_h = crouch_pix(pix, 36, 4), 8
    return placed('mantle_back', pix, shapes('torso_mantle', (16, 32, 16, rect_h), PV), ux, uy)

def scarf_band(ux, uy):
    """16x3 band at the back of the neck (y31-33), no tail"""
    pix = {}
    for y, h in ((31, 6), (32, 8), (33, 7)):
        for x in range(24 - h, 24 + h):
            edge = y in (31, 33) or x in (24 - h, 23 + h)
            pix[(x, y)] = SCARF['o'] if edge else SCARF['N'] if x % 5 == 0 else SCARF['M']
    return placed('scarf_band', pix, [blob(24, 32.5, 8, 1.8, .9)], ux, uy)

def compose_up(P):
    ux, uy = P['up']; hx, hy = P['head']; px, py = P['hips']
    pdx, pdy = P['pouch'] or P['up']
    lay, meta = {}, {'joints': {}}
    lay['hair_up'] = hair_up(hx, hy, P.get('spread', 0))
    lay['hips'] = static('hips', px, py)
    lay['mantle_back'] = mantle_up(ux, uy, P['torso'] == 'crouch')
    for x, y, c in P['flare']: lay['mantle_back']['pix'][(x, y)] = COAT[c]
    lay['scarf_band'] = scarf_band(ux, uy)
    lay['pouch'] = static('pouch', -2 + pdx, pdy)          # sits behind the body, ~2px peek at the left hip
    lp, feet = std_limbs(P, lay, meta)
    order = ['pouch', 'hips', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R', 'boot_L', 'boot_R']
    if lp[2] == 'under': order.append('lantern')
    for s in 'LR':
        if not P['front'][s]: order += [f'arm_{s}_upper', f'arm_{s}_fore']
    order += ['mantle_back', 'scarf_band', 'hair_up']
    for s in 'LR':
        if P['front'][s]: order += [f'arm_{s}_upper', f'arm_{s}_fore']
    order += ['hand_L', 'hand_R']
    if lp[2] == 'over': order.append('lantern')
    meta.update(feet=feet, pelvis=[24 + px, 45 + py], head=[24 + hx, 23 + hy], grip=P['grip'], lantern=lantern_plan(P, lp, meta))
    return [lay[k] for k in order], meta

# ---------------------------------------------------------------- RIGHT (side view, facing +x): near limbs = R, far limbs = L
def shade_side(pts):
    ed = edge_of(pts)
    def c(p):
        x, y = p
        if p in ed: return HAIR['D']
        # 同じ間隔の長い斜線を避け、後頭部・頭頂・前髪の3束に分ける。
        if p in {(13, 22), (14, 23), (15, 24), (16, 24),
                 (17, 17), (18, 18), (19, 19), (20, 20), (21, 20),
                 (22, 13), (23, 14), (24, 15), (25, 16), (26, 17), (27, 17)}: return HAIR['D']
        if p in {(20, 13), (21, 13), (22, 14), (18, 15), (19, 15)}: return HAIR['L']
        return HAIR['H']
    return {p: c(p) for p in pts}

def head_side(hx, hy):
    """14x13 at (19,19): face on the +x half, one eye (x28-29, y24-27), nose tip at x32, mouth at (30,29)"""
    pts = ellipse_pts(25.5, 25.5, 6.5, 6.5); ed = edge_of(pts)
    pix = {p: HEX['4'] if p in ed else HEX['5'] for p in pts}
    pix[(32, 27)], pix[(32, 28)] = HEX['5'], HEX['4']
    detail = {(28, 24): '0', (29, 24): '0', (28, 25): '0', (29, 25): '7', (28, 26): '0', (29, 26): '8', (29, 27): '9',
              (30, 29): '6', (23, 26): '6', (23, 27): '4'}
    for p, c in detail.items(): pix[p] = HEX[c]
    return placed('head_side', pix, [blob(25.5, 25.5, 6.5, 6.5, 1., 4), blob(32, 27.8, .9, 1.3, 1.2)], hx, hy, skin=True)

def hair_side(hx, hy):
    """20x19 at (12,11): volume pushed to the back of the head, bangs x27-31 down to y23, face and ear left open"""
    pts = ellipse_pts(22, 20, 10, 9.5) | ellipse_pts(17, 24, 5.5, 6)
    pts -= {(x, y) for x in range(25, 33) for y in range(24, 32)} | {(x, y) for x in (23, 24) for y in (25, 26, 27)}
    prims = [blob(22, 20, 10, 9.5, .85), blob(17, 24, 5.5, 6, .9), blob(29.5, 20.5, 2.5, 3.5, .7)]
    return placed('hair_side', shade_side(pts), prims, hx, hy)

def torso_side(ux, uy, crouch):
    """10x14 at x19-28, y32-45: thick cloak on the back (x19-21), narrow tunic/chest plane in front, strap and belt"""
    pix = {}
    for y in range(32, 46):
        x0, x1 = (21, 27) if y == 32 else (19, 27) if y == 45 else (19, 28)
        for x in range(x0, x1 + 1):
            pix[(x, y)] = COAT['o'] if (x in (x0, x1) or y in (32, 45) or x == 21) else COAT['r']
    for y in range(33, 42): pix[(24 + (y - 33) * 3 // 8, y)] = HEX['C']
    for x in range(19, 29): pix[(x, 42)] = HEX['E'] if x in (19, 28) else HEX['G'] if x == 27 else HEX['F']
    rect_h = 14
    if crouch: pix, rect_h = crouch_pix(pix, 36, 4), 10
    prims = shapes('torso_mantle', (19, 32, 10, rect_h), PV) + [blob(20, 32 + rect_h * .55, 2.2, rect_h * .45, .9)]
    return placed('torso_mantle', pix, prims, ux, uy)

def scarf_side(ux, uy):
    pts = ellipse_pts(25, 32.5, 5.2, 1.9) | ellipse_pts(20.5, 33.5, 2, 1.8); ed = edge_of(pts)
    pix = {p: SCARF['o'] if p in ed else SCARF['N'] if p[1] >= 33 else SCARF['M'] for p in pts}
    return placed('scarf', pix, [blob(25, 32.5, 5.2, 1.9, .9), blob(20.5, 33.5, 2, 1.8, 1.)], ux, uy)

def side_hips(px, py):
    rows = ['LMMMMMML', 'LMMMMMML']
    return layer('hips', from_rows(rows, 20 + px, 45 + py), shapes('hips', (20 + px, 45 + py, 8, 2), PV))

def side_arm(s, spec, far):
    _, sh, el, wr = spec
    pu, pf = seg_pts(sh, el, 2.0, 1.8), seg_pts(el, wr, 1.7, 1.5)
    d = 2.2 if far else 0.
    pix_u = paint_far(pu, ARM['o']) if far else paint_arm(pu, 'L', el)
    pix_f = paint_far(pf, ARM['o']) if far else paint_arm(pf, 'L', el)
    up = layer(f'arm_{s}_upper', pix_u, [cap(sh, el, 2.0, yoff=d)])
    fo = layer(f'arm_{s}_fore', pix_f, [cap(el, wr, 1.7, yoff=d)])
    hx, hy = int(wr[0]) - 2, int(wr[1]) - 2
    hand = layer(f'hand_{s}', from_rows(rows_of('hand_R'), hx, hy), deepen(shapes('hand_R', (hx, hy, 4, 4), PV), d))
    return up, fo, hand, dict(shoulder=sh, elbow=el, wrist=wr)

def side_leg(s, hip, spec, far):
    knee, ankle, kind, state = spec
    sx = ankle[0] + .5
    d = 2.2 if far else 0.
    paint = (lambda pts: paint_far(pts, PANTS['o'])) if far else paint_leg
    th = layer(f'thigh_{s}', paint(seg_pts(hip, knee, 2.1, 1.9)), [cap(hip, knee, 2.1, yoff=d)])
    sh = layer(f'shin_{s}', paint(seg_pts(knee, (sx, ankle[1]), 1.9, 1.7)), [cap(knee, (sx, ankle[1]), 1.8, yoff=d)])
    brows = SIDE_BOOT if kind == 'stand' else SIDE_BOOT_SOLE
    if far: brows = [r.translate(FAR_T) for r in brows]
    sole = ankle[1] + 2
    bx, by = ankle[0] - 2, sole - 4
    prims = deepen([ell((bx, by, 8, 5), PV, .35, .3, .45, .6, .9, 4), ell((bx, by, 8, 5), PV, .55, .78, .9, .5, 1.2, 4)], d)
    return th, sh, layer(f'boot_{s}', from_rows(brows, bx, by), prims), dict(hip=hip, knee=knee, ankle=ankle), [bx + 4, sole, state]

def compose_side(P):
    ux, uy = P['up']; hx, hy = P['head']; px, py = P['hips']; tx, ty = P['tail']
    pdx, pdy = P['pouch'] or P['up']
    lay, meta, feet = {}, {'joints': {}}, {}
    lay['hips'] = side_hips(px, py)
    lay['torso_mantle'] = torso_side(ux, uy, P['torso'] == 'crouch')
    lay['scarf'] = scarf_side(ux, uy)
    lay['scarf_tail'] = static('scarf_tail', -10 + ux + tx, -2 + uy + ty)      # trails behind the back
    lay['pouch'] = static('pouch', 5 + pdx, pdy)
    lay['head_side'], lay['hair_side'] = head_side(hx, hy), hair_side(hx, hy)
    for s, far in (('R', False), ('L', True)):
        hip = ((22 if far else 24) + px, 46 + py)
        th, sh, bo, j, ft = side_leg(s, hip, P['leg'][s], far)
        lay[f'thigh_{s}'], lay[f'shin_{s}'], lay[f'boot_{s}'] = th, sh, bo
        meta['joints'].update({f'{k}_{s}': list(v) for k, v in j.items()}); feet[s] = ft
        up, fo, hd, j = side_arm(s, P['arm'][s], far)
        lay[f'arm_{s}_upper'], lay[f'arm_{s}_fore'], lay[f'hand_{s}'] = up, fo, hd
        meta['joints'].update({f'{k}_{s}': list(v) for k, v in j.items()})
    wr = meta['joints']['wrist_R']
    lp = (int(wr[0]) - 1, int(wr[1]) + 2, 'over') if P['lantern'] == 'wrist' else P['lantern']
    lay['lantern'] = static('lantern', lp[0] - LAY['lantern']['x'], lp[1] - LAY['lantern']['y'])
    order = ['thigh_L', 'shin_L', 'boot_L', 'arm_L_upper', 'arm_L_fore', 'hand_L', 'scarf_tail', 'hips', 'thigh_R', 'shin_R', 'boot_R']
    if lp[2] == 'under': order.append('lantern')
    order += ['torso_mantle', 'pouch', 'arm_R_upper', 'arm_R_fore', 'scarf', 'head_side', 'hair_side', 'hand_R']
    if lp[2] == 'over': order.append('lantern')
    meta.update(feet=feet, pelvis=[23 + px, 45 + py], head=[26 + hx, 25 + hy], grip=P['grip'], lantern=lantern_plan(P, lp, meta))
    return [lay[k] for k in order], meta

# ---------------------------------------------------------------- rolling compositions (tucked volumes, not a rotated bitmap)
def shade_hair(pts, cx):
    ed = edge_of(pts)
    return {p: (HAIR['o'] if p in ed else HAIR['D'] if p[0] in (int(cx) - 3, int(cx) + 3) else HAIR['L'] if p[0] == int(cx) - 1 and p[1] % 3 else HAIR['H']) for p in pts}

def tuck_boot(bx, by0, cy):
    pts = ellipse_pts(bx, cy, 4.8, 4.2); ed = edge_of(pts)
    pix = {p: SOLE if (p[0], p[1] + 1) not in pts else BOOT['B'] if p in ed else BOOT['C'] if p[1] <= 50 else BOOT['E'] for p in pts}
    return pix, [blob(bx, cy, 4.8, 4.2, 1.2)]

def compose_tuck_down(view='down'):
    """roll1 for DOWN (front: scarf ring + hair on top) and UP (back: hair mass dominant, cloak groove cross, lamp behind)"""
    cx, back = 24, view == 'up'
    cloak = ellipse_pts(cx, 45, 13.5, 12.5); ed = edge_of(cloak)
    cp = {p: (COAT['o'] if p in ed or p[0] == cx or (back and p[1] == 46) else COAT['r']) for p in cloak}
    scy, srx, sry = (43, 6.5, 1.6) if back else (41.5, 7, 2)
    scarf = ellipse_pts(cx, scy, srx, sry); se = edge_of(scarf)
    sp = {p: (SCARF['o'] if p in se else SCARF['N'] if p[1] >= scy + .5 else SCARF['M']) for p in scarf}
    hcy, hrx, hry = (38, 9.5, 8.5) if back else (36, 8, 6.5)
    hair = ellipse_pts(cx, hcy, hrx, hry)
    lpos = (35, 46) if back else (32, 45)
    lamp = static('lantern', lpos[0] - LAY['lantern']['x'], lpos[1] - LAY['lantern']['y'], id_='lantern')
    lay = [layer('cloak_mass', cp, [blob(cx, 45, 13.5, 12.5, .7)]),
           layer('scarf_ring' if not back else 'scarf_band', sp, [blob(cx, scy, srx, sry, .9)]),
           layer('hair_mass', shade_hair(hair, cx), [blob(cx, hcy, hrx, hry, .9)])]
    lay = [lamp] + lay if back else lay + [lamp]
    joints, hands = {}, []
    for s, sh, el, wr in (('L', (14, 40), (12.5, 47), (17.5, 51)), ('R', (34, 40), (35.5, 47), (30.5, 51))):
        pu, pf = seg_pts(sh, el, 2.3, 2.0), seg_pts(el, wr, 1.9, 1.7)
        lay += [layer(f'arm_{s}_upper', paint_arm(pu, s, el), [cap(sh, el, 2.3)]), layer(f'arm_{s}_fore', paint_arm(pf, s, el), [cap(el, wr, 1.9)])]
        joints.update({f'shoulder_{s}': list(sh), f'elbow_{s}': list(el), f'wrist_{s}': list(wr)})
        hands.append(s)
    feet = {}
    for s, bx in (('L', 19), ('R', 29)):
        pix, prims = tuck_boot(bx, 49, 53.8)                    # bottom row y57 (outline y58) like a standing sole
        lay.append(layer(f'boot_{s}', pix, prims))
        feet[s] = [bx, 57, 'C']
        joints.update({f'knee_{s}': [bx, 50], f'ankle_{s}': [bx, 55], f'hip_{s}': [21 if s == 'L' else 27, 46]})
    for s in hands:
        wr = joints[f'wrist_{s}']; hx, hy = int(wr[0]) - 2, int(wr[1]) - 2
        lay.append(layer(f'hand_{s}', from_rows(rows_of('hand_' + s), hx, hy), shapes('hand_' + s, (hx, hy, 4, 4), PV)))
    meta = dict(joints=joints, feet=feet, pelvis=[24, 47], head=[24, hcy], grip=None,
                lantern=dict(anchor=None, planned_origin=list(lpos), layer='under' if back else 'over'),
                ground='C = curled body contact: cloak and boot undersides at y57')
    return lay, meta

def compose_tuck_side():
    """roll1 facing +x: a cloak mass with an upper rim, hair mass at the front with a trailing tuft, bent knee and a boot pair with soles"""
    cloak = ellipse_pts(24, 45, 12.5, 12.5); ed = edge_of(cloak)
    def rim(p): return abs(math.hypot(p[0] + .5 - 24, p[1] + .5 - 45) - 9.5) < .6 and p[1] + .5 < 44
    cp = {p: (COAT['o'] if p in ed or rim(p) else COAT['r']) for p in cloak}
    scarf = ellipse_pts(28, 47, 3.5, 2); se = edge_of(scarf)
    sp = {p: (SCARF['o'] if p in se else SCARF['N'] if p[1] >= 47 else SCARF['M']) for p in scarf}
    hair = ellipse_pts(31, 42, 5.5, 5.5) | seg_pts((27, 40), (19, 38), 1.6, .8)
    knee = ellipse_pts(31, 50.5, 4, 3.5); ke = edge_of(knee)
    kp = {p: PANTS['o'] if p in ke else PANTS['m'] for p in knee}
    lay = [layer('cloak_mass', cp, [blob(24, 45, 12.5, 12.5, .75)])]
    bfar, bnear = (19, 53), (24, 53)
    lay.append(layer('boot_L', from_rows([r.translate(FAR_T) for r in SIDE_BOOT_SOLE], *bfar),
                     deepen([ell((*bfar, 8, 5), PV, .35, .3, .45, .6, .9, 4), ell((*bfar, 8, 5), PV, .55, .78, .9, .5, 1.2, 4)], 2.2)))
    lay.append(layer('knee_mass', kp, [blob(31, 50.5, 4, 3.5, .9)]))
    lay.append(layer('boot_R', from_rows(SIDE_BOOT_SOLE, *bnear),
                     [ell((*bnear, 8, 5), PV, .35, .3, .45, .6, .9, 4), ell((*bnear, 8, 5), PV, .55, .78, .9, .5, 1.2, 4)]))
    lay.append(layer('scarf_ring', sp, [blob(28, 47, 3.5, 2, .9)]))
    lay.append(layer('hair_mass', shade_hair(hair, 31), [blob(31, 42, 5.5, 5.5, .9), cap((27, 40), (19, 38), 1.4)]))
    sh, el, wr = (27, 40), (33, 45), (31, 50)
    lay += [layer('arm_R_upper', paint_arm(seg_pts(sh, el, 2.0, 1.8), 'L', el), [cap(sh, el, 2.0)]),
            layer('arm_R_fore', paint_arm(seg_pts(el, wr, 1.7, 1.5), 'L', el), [cap(el, wr, 1.7)])]
    hx, hy = int(wr[0]) - 2, int(wr[1]) - 2
    lay.append(layer('hand_R', from_rows(rows_of('hand_R'), hx, hy), shapes('hand_R', (hx, hy, 4, 4), PV)))
    lpos = (17, 41)
    lay.append(static('lantern', lpos[0] - LAY['lantern']['x'], lpos[1] - LAY['lantern']['y']))
    joints = dict(shoulder_R=list(sh), elbow_R=list(el), wrist_R=list(wr), hip_R=[24, 48], knee_R=[31, 50], ankle_R=[27, 55],
                  hip_L=[22, 48], knee_L=[29, 51], ankle_L=[22, 55])
    meta = dict(joints=joints, feet={'R': [bnear[0] + 4, 57, 'C'], 'L': [bfar[0] + 4, 57, 'C']}, pelvis=[24, 47], head=[31, 42], grip=None,
                lantern=dict(anchor=None, planned_origin=list(lpos), layer='over'),
                ground='C = curled body contact: cloak and boot soles at y57')
    return lay, meta

# ---------------------------------------------------------------- poses
A_BACK_L = ('cap', (17, 35), (15, 39), (15, 43)); A_FWD_R = ('cap', (31, 35), (32, 41), (32, 48))
A_FWD_L = ('cap', (17, 35), (16, 41), (16, 48)); A_BACK_R = ('cap', (31, 35), (33, 39), (33, 43))
HANG_UP = ('hang', -1, -1, -1)
LIFT = 'lift'
POSES = {'down': [
    ('idle0', 600, 'idle', pose()),
    ('idle1', 600, 'idle', pose(up=(0, 1), head=(0, 1), tail=(0, 1), arm={'L': ('hang', 1, 0, 0), 'R': ('hang', 1, 0, 0)})),
    ('walk0', 110, 'walk', pose(arm={'L': A_BACK_L, 'R': A_FWD_R},
                                leg={'L': ((20, 51), (19, 56), 'stand', 'P'), 'R': ((27, 49), (28, 52), LIFT, 'L')})),
    ('walk1', 110, 'walk', pose(up=(0, -1), head=(0, -1), tail=(0, -1), hips=(0, -1), arm={'L': HANG_UP, 'R': HANG_UP},
                                leg={'L': ((21, 50), (20, 55), 'stand', 'P'), 'R': ((27, 48), (28, 53), LIFT, 'L')})),
    ('walk2', 110, 'walk', pose(arm={'L': A_FWD_L, 'R': A_BACK_R},
                                leg={'R': ((27, 51), (28, 56), 'stand', 'P'), 'L': ((21, 49), (19, 52), LIFT, 'L')})),
    ('walk3', 110, 'walk', pose(up=(0, -1), head=(0, -1), tail=(0, -1), hips=(0, -1), arm={'L': HANG_UP, 'R': HANG_UP},
                                leg={'R': ((27, 50), (27, 55), 'stand', 'P'), 'L': ((21, 48), (20, 53), LIFT, 'L')})),
    ('attack0', 80, 'attack', pose(head=(1, 0), arm={'L': ('hang', 0, 0, 0), 'R': ('cap', (31, 34), (34, 39), (30, 38))},
                                   front={'L': False, 'R': True}, leg={'R': ((28, 50), (29, 55), 'stand', 'P')},
                                   lantern=(30, 44, 'under'), grip=[30, 38])),
    ('attack1', 80, 'attack', pose(up=(0, 1), head=(0, 1), hips=(0, 2), arm={'L': ('cap', (17, 36), (15, 40), (15, 44)), 'R': ('cap', (31, 36), (33, 42), (32, 49))},
                                   leg={'L': ((19, 52), (18, 56), 'stand', 'P'), 'R': ((30, 52), (29, 55), 'stand', 'P')},
                                   flare=[(30, 43, 'r'), (31, 43, 'r'), (32, 43, 'o'), (31, 44, 'r'), (32, 44, 'o')],
                                   lantern=(30, 44, 'under'), grip=[32, 49])),
    ('attack2', 120, 'attack', pose(up=(0, 1), head=(-1, 1), hips=(0, 1), arm={'L': ('cap', (17, 36), (15, 40), (15, 44)), 'R': ('cap', (31, 36), (28, 41), (22, 45))},
                                    front={'L': False, 'R': True}, lantern=(30, 44, 'under'), grip=[22, 45])),
    ('roll0', 100, 'roll', pose(up=(0, 8), head=(0, 8), tail=(0, 8), hips=(0, 4), torso='crouch', pouch=(0, 4),
                                arm={'L': ('cap', (17, 43), (14, 47), (18, 52)), 'R': ('cap', (31, 43), (34, 47), (30, 52))},
                                front={'L': True, 'R': True},
                                leg={'L': ((19, 53), (19, 55), 'stand', 'P'), 'R': ((29, 53), (28, 55), 'stand', 'P')},
                                lantern=(32, 47, 'over'))),
    ('roll1', 100, 'roll', None),
    ('roll2', 100, 'roll', pose(up=(0, 3), head=(0, 4), tail=(0, 3), hips=(0, 3),
                                arm={'L': ('cap', (17, 38), (15, 47), (16, 55)), 'R': ('hang', 3, 3, 3)},
                                leg={'R': ((29, 49), (28, 53), LIFT, 'L')})),
]}

def make_up():
    """UP: same skeleton and feet as DOWN; the swinging arm in attack goes overhead / behind (hands at the doc's grips)"""
    arms = {'attack0': ('cap', (31, 34), (34, 36), (30, 33)), 'attack1': ('cap', (31, 36), (34, 34), (32, 31)),
            'attack2': ('cap', (31, 36), (32, 38), (29, 38))}
    grips = {'attack0': [30, 33], 'attack1': [32, 31], 'attack2': [29, 38]}
    out = []
    for short, dur, tag, P in POSES['down']:
        if P is None: out.append((short, dur, tag, None)); continue
        Q = dict(P, kind='up', spread=2 if short == 'attack1' else 0)
        if short in arms:
            Q['arm'] = dict(P['arm'], R=arms[short]); Q['front'] = dict(P['front'], R=True); Q['grip'] = grips[short]
        out.append((short, dur, tag, Q))
    return out
POSES['up'] = make_up()

# side poses: R = near limbs, L = far limbs, all joints in absolute frame coordinates
def sarm(sh, el, wr): return ('cap', sh, el, wr)
def sleg(knee, ankle, kind='stand', state='P'): return (knee, ankle, kind, state)
S_HANG = {'R': sarm((25, 35), (25, 40.5), (26, 46)), 'L': sarm((24, 35), (23, 40.5), (22, 46))}
S_STAND = {'R': sleg((24, 50), (24, 55)), 'L': sleg((21, 50), (20, 55))}
def spose(**k):
    base = dict(arm=dict(S_HANG), leg=dict(S_STAND), front={'L': False, 'R': True})
    base.update(k)
    return pose(kind='side', **base)
POSES['right'] = [
    ('idle0', 600, 'idle', spose()),
    ('idle1', 600, 'idle', spose(up=(0, 1), head=(0, 1), tail=(-1, 1),
                                 arm={'R': sarm((25, 36), (25, 41), (26, 46)), 'L': sarm((24, 36), (23, 41), (22, 46))})),
    ('walk0', 110, 'walk', spose(arm={'R': sarm((25, 35), (23, 40), (21, 44)), 'L': sarm((24, 35), (27, 40), (29, 44))},
                                 leg={'R': sleg((26, 50), (27, 55)), 'L': sleg((19, 51), (16, 54), LIFT, 'L')})),
    ('walk1', 110, 'walk', spose(up=(0, -1), head=(0, -1), tail=(0, -1), hips=(0, -1),
                                 leg={'R': sleg((24, 50), (25, 55)), 'L': sleg((24, 49), (21, 52), LIFT, 'L')})),
    ('walk2', 110, 'walk', spose(arm={'R': sarm((25, 35), (27, 40), (29, 44)), 'L': sarm((24, 35), (22, 40), (20, 44))},
                                 leg={'R': sleg((21, 51), (17, 54), LIFT, 'L'), 'L': sleg((25, 50), (26, 55))})),
    ('walk3', 110, 'walk', spose(up=(0, -1), head=(0, -1), tail=(0, -1), hips=(0, -1),
                                 leg={'R': sleg((25, 49), (21, 52), LIFT, 'L'), 'L': sleg((23, 50), (24, 55))})),
    ('attack0', 80, 'attack', spose(up=(-1, 0), head=(-1, 0), tail=(-1, 0),
                                    arm={'R': sarm((25, 34), (29, 31), (31, 36)), 'L': sarm((24, 35), (22, 40), (20, 44))},
                                    leg={'R': sleg((26, 50), (25, 55)), 'L': sleg((20, 51), (17, 55))},
                                    lantern=(21, 45, 'under'), grip=[31, 36])),
    ('attack1', 80, 'attack', spose(up=(1, 1), head=(2, 1), tail=(0, 1), hips=(2, 1),
                                    arm={'R': sarm((26, 36), (31, 40), (36, 45)), 'L': sarm((25, 36), (23, 41), (21, 46))},
                                    leg={'R': sleg((29, 51), (29, 55)), 'L': sleg((20, 51), (17, 55))},
                                    lantern=(22, 46, 'under'), grip=[36, 45])),
    ('attack2', 120, 'attack', spose(up=(1, 1), head=(1, 1), tail=(0, 1), hips=(1, 1),
                                     arm={'R': sarm((26, 36), (30, 38), (30, 42)), 'L': sarm((25, 36), (23, 40), (22, 44))},
                                     leg={'R': sleg((28, 51), (28, 55)), 'L': sleg((21, 51), (18, 55))},
                                     lantern=(22, 46, 'under'), grip=[30, 42])),
    ('roll0', 100, 'roll', spose(up=(1, 8), head=(3, 8), tail=(0, 8), hips=(0, 4), torso='crouch', pouch=(1, 4),
                                 arm={'R': sarm((26, 43), (30, 47), (28, 51)), 'L': sarm((25, 43), (22, 47), (23, 52))},
                                 leg={'R': sleg((28, 52), (26, 55)), 'L': sleg((23, 52), (19, 55))},
                                 lantern=(30, 47, 'over'))),
    ('roll1', 100, 'roll', None),
    ('roll2', 100, 'roll', spose(up=(1, 3), head=(2, 4), tail=(0, 3), hips=(1, 3),
                                 arm={'R': sarm((26, 39), (27, 44), (28, 49)), 'L': sarm((25, 39), (22, 47), (20, 55))},
                                 leg={'R': sleg((29, 51), (28, 55)), 'L': sleg((25, 51), (21, 53), LIFT, 'L')})),
]
POSES['left'] = POSES['right']           # same table: LEFT is built by mirroring the finished RIGHT frames

# ---------------------------------------------------------------- per-frame geometry
INNER = [i for i, v in enumerate(VECTORS) if math.hypot(v[0], v[1]) <= .55]
def qn(N, edge):
    pool = range(len(VECTORS)) if edge else INNER
    return VECTORS[max(pool, key=lambda i: sum(a * b for a, b in zip(VECTORS[i], N)))]

_FLIP = {}
def flip_vec(v):
    """mirror about the vertical axis: N_X negated, N_Y / N_Z kept (the 61 vectors are azimuth-symmetric)"""
    if v not in _FLIP:
        t = (-v[0], v[1], v[2])
        _FLIP[v] = min(VECTORS, key=lambda u: sum((a - b) ** 2 for a, b in zip(u, t)))
    return _FLIP[v]

def frame_geo(layers):
    owner = {}
    for i, l in enumerate(layers):
        for p in l['pix']: owner[p] = i
    ring = {(x + dx, y + dy) for x, y in owner for dx, dy in N4} - set(owner)
    ring = {p for p in ring if 0 <= p[0] < W and 0 <= p[1] < H}
    near = ring | {p for p in owner if any((p[0] + dx, p[1] + dy) in ring for dx, dy in N4)}
    geo = {}
    for p, i in owner.items():
        l = layers[i]
        Z, N = surface(l['prims'], p[0], p[1], PV)
        hexc = l['pix'][p]
        rough = ROUGH['metal'] if hexc in METAL else ROUGH['skin'] if l['skin'] else ROUGH['cloth']
        geo[p] = (qn(N, p in near), max(0., Z), rough, l['glass'] and hexc == GLASS)
    for p in ring:
        i = max(owner[(p[0] + dx, p[1] + dy)] for dx, dy in N4 if (p[0] + dx, p[1] + dy) in owner)
        Z, N = surface(layers[i]['prims'], p[0], p[1], PV)
        geo[p] = (qn(N, True), max(0., Z), ROUGH['cloth'], False)
    return geo, owner, ring

def crop(pix):
    xs, ys = [p[0] for p in pix], [p[1] for p in pix]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return x0, y0, [''.join(SYMBOL_OF[pix[(x, y)]] if (x, y) in pix else '.' for x in range(x0, x1 + 1)) for y in range(y0, y1 + 1)]

# ---------------------------------------------------------------- LEFT = mirrored RIGHT
def swap_id(i): return '_'.join({'L': 'R', 'R': 'L'}.get(t, t) for t in i.split('_'))
def swap_key(k): return k[:-1] + ('R' if k[-1] == 'L' else 'L') if k[-2:] in ('_L', '_R') else k

def mirror_layers(layers):
    return [dict(l, id=swap_id(l['id']), pix={(W - 1 - x, y): c for (x, y), c in l['pix'].items()}, prims=[]) for l in layers]

def mirror_geo(g):
    return {(W - 1 - x, y): (flip_vec(v[0]),) + tuple(v[1:]) for (x, y), v in g.items()}      # height / rough / glass unchanged

def mirror_plan(plan, src):
    mp = lambda p: [W - p[0], p[1]]
    m = dict(plan)
    m['joints'] = {swap_key(k): mp(v) for k, v in plan['joints'].items()}
    m['feet'] = {('L' if s == 'R' else 'R'): [W - f[0], f[1], f[2]] for s, f in plan['feet'].items()}
    m['pelvis'], m['head'] = mp(plan['pelvis']), mp(plan['head'])
    m['grip'] = mp(plan['grip']) if plan['grip'] else None
    lan = dict(plan['lantern'])
    lan['anchor'] = mp(lan['anchor']) if lan.get('anchor') else None
    if lan.get('planned_origin'): lan['planned_origin'] = [W - 3 - lan['planned_origin'][0], lan['planned_origin'][1]]
    m['lantern'] = lan
    m.update(local_x_flip=True, mirror_of=src, flip_pivot=[PV[0], PV[1]])
    return m

# ---------------------------------------------------------------- measured metadata
def describe(name, dur, tag, layers, geo, plan):
    """frame record; feet, lantern glass and head height are measured from the final pixels / geometry"""
    meta = dict(plan)
    pix = {l['id']: l['pix'] for l in layers}
    planned, feet = plan['feet'], {}
    for s in planned:
        bp = pix['boot_' + s]
        y = max(p[1] for p in bp); xs = [p[0] for p in bp if p[1] == y]
        feet[s] = [(min(xs) + max(xs) + 1) / 2, y, planned[s][2]]
    y_ok = all(feet[s][1] == planned[s][1] for s in feet)
    x_ok = all(abs(feet[s][0] - planned[s][0]) <= 1.5 for s in feet)
    sole_ok = all(f[1] in (57, 58) for f in feet.values() if f[2] in 'PC')
    lift_ok = all(f[1] <= 56 for f in feet.values() if f[2] == 'L')
    for ok, what in ((y_ok, 'planned sole y != boot pixel bottom row'), (x_ok, 'planned foot x off the boot pixels by >1.5'),
                     (sole_ok, 'grounded boot sole not at y57-58'), (lift_ok, 'lifted boot sole not above y57')):
        if not ok: warnings.append(f'{name}: {what} (planned {planned}, pixels {feet})')
    meta.update(feet=feet, feet_planned=planned)
    glass = sorted(p for p, v in geo.items() if v[3])
    lan = dict(plan['lantern'])
    if glass:
        cx = sum(p[0] + .5 for p in glass) / len(glass); cy = sum(p[1] + .5 for p in glass) / len(glass)
        hh = sum(geo[p][1] for p in glass) / len(glass)
        lan.update(visible=True, glass_px=[list(p) for p in glass], glass_center=[round(cx, 2), round(cy, 2)], glass_height=round(hh, 2),
                   light_anchor=[round(cx, 2), round(cy, 2), round(hh, 2)])
    else:      # lamp fully covered by the body/arm: the runtime must not emit light for it
        lan.update(visible=False, glass_px=[], glass_center=None, glass_height=None, light_anchor=None)
    meta['lantern'] = lan
    hv = [geo[p][1] for l in layers if l['id'] in HEAD_IDS for p in l['pix'] if p in geo]
    if hv and max(hv) <= 0: warnings.append(f'{name}: head height all zero')
    xs = [p[0] for p in geo]; ys = [p[1] for p in geo]
    body = [y for l in layers if l['id'] != 'outline' for _, y in l['pix']]
    meta.update(name=name, duration=dur, tag=tag, pivot=list(PV),
                feet_world={s: [f[0] - PV[0], f[1] - PV[1], f[2]] for s, f in feet.items()},
                checks=dict(grounded_sole_y_57_58=sole_ok, lifted_feet_clear_of_ground=lift_ok, feet_meta_matches_boot_pixels=y_ok and x_ok,
                            emissive_px=len(glass), lantern_visible=bool(glass), opaque_px=len(geo), bbox=[min(xs), min(ys), max(xs), max(ys)],
                            body_rows=max(ys) - min(ys) + 1, body_rows_no_outline=max(body) - min(body) + 1, outline_bottom_y=max(ys),
                            head_height=[round(min(hv), 2), round(max(hv), 2)] if hv else None))
    return meta

# ---------------------------------------------------------------- directions
COMPOSE = {'down': compose_std, 'up': compose_up, 'right': compose_side}
TUCK = {'down': lambda: compose_tuck_down('down'), 'up': lambda: compose_tuck_down('up'), 'right': compose_tuck_side}
_BUILT = {}

def build_dir(direction):
    """(frames, geos, meta, plans) for one direction; frames = [(name, ms, tag, layers incl. outline)]"""
    if direction in _BUILT: return _BUILT[direction]
    frames, geos, meta_out, plans = [], [], {}, {}
    if direction == 'left':
        rf, rg, _, rp = build_dir('right')
        for (rname, dur, tag, layers), g in zip(rf, rg):
            name = rname.replace('hero_right_', 'hero_left_')
            ml, mg = mirror_layers(layers), mirror_geo(g)
            plans[name] = plan = mirror_plan(rp[rname], rname)
            frames.append((name, dur, tag, ml)); geos.append(mg)
            meta_out[name] = describe(name, dur, tag, ml, mg, plan)
    else:
        for short, dur, tag, P in POSES[direction]:
            name = f'hero_{direction}_{short}'
            layers, plan = TUCK[direction]() if P is None else COMPOSE[direction](P)
            geo, owner, ring = frame_geo(layers)
            full = layers + [layer('outline', {p: INK for p in ring}, [])]
            plans[name] = plan
            frames.append((name, dur, tag, full)); geos.append(geo)
            meta_out[name] = describe(name, dur, tag, full, geo, plan)
    _BUILT[direction] = frames, geos, meta_out, plans
    return _BUILT[direction]

def albedo_project(frames):
    # 全方向の関節別差分は256部品を超える。組立レシピはこのスクリプトに
    # 残し、Workbench保存版では合成済みの48ポーズを名前付き部品にする。
    palette = dict(HEX)
    cmds = [f'canvas {W} {H}', f'pivot {PV[0]} {PV[1]}']
    names, order, rows_seen = {}, [], {}
    def sy(hexc):
        if hexc not in SYMBOL_OF:
            used = set(SYMBOL_OF.values())
            free = next(s for s in SYMBOLS if s not in HEX and s not in used)
            SYMBOL_OF[hexc] = free; palette[free] = hexc; warnings.append(f'new palette colour {hexc}')
        return SYMBOL_OF[hexc]
    for _, _, _, layers in frames:
        for l in layers:
            for c in l['pix'].values(): sy(c)
    cmds += [f'palette {k} {v}' for k, v in palette.items()]
    if len(palette) > 64: raise ValueError('palette over 64')
    count, placed_ = {}, []
    for name, dur, tag, layers in frames:
        pix = {}
        for l in layers:
            pix.update(l['pix'])
        layers = [{'id': name, 'pix': pix}]
        pl = []
        for l in layers:
            if not l['pix']: continue
            x0, y0, rows = crop(l['pix'])
            key = (l['id'], tuple(rows))
            if key not in names:
                n = count[l['id']] = count.get(l['id'], 0) + 1
                names[key] = f'{l["id"]}_{n}'
                cmds += [f'part {names[key]} {len(rows[0])} {len(rows)}', 'rows ' + '|'.join(rows)]
            pl.append((l['id'], names[key], x0, y0))
        placed_.append((name, dur, tag, pl))
    for name, dur, tag, pl in placed_:
        cmds += [f'frame {name} {dur}', f'tag {tag}'] + [f'place {i} {p} {x} {y}' for i, p, x, y in pl]
    return Editor().apply('\n'.join(cmds) + '\n')

def alpha_set(proj, frame):
    im, _ = render(proj, frame)
    return {(i % W, i // W) for i, c in enumerate(im.getdata()) if c[3]}

def add_frame_meta(path, meta, dirs):
    d = json.loads(path.read_text(encoding='utf-8'))
    d['meta']['frameMeta'] = meta
    d['meta']['directions'] = dirs
    d['meta']['frameMetaNote'] = 'poses.json record per frame; feet/lantern/head measured from pixels; left frames: local_x_flip true, flip_pivot [24,58]'
    path.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dirs', nargs='+', default=list(DIRS), choices=DIRS)
    ap.add_argument('--columns', type=int, default=8)
    ap.add_argument('--out', default=str(OUT))
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    frames, geos, meta = [], [], {}
    for d in a.dirs:
        f, g, m, _ = build_dir(d); frames += f; geos += g; meta.update(m)
    albedo = albedo_project(frames)
    # idle0 must equal the approved front (the split must not change a pixel)
    same, names = None, [f[0] for f in frames]
    if 'hero_down_idle0' in names:
        i = names.index('hero_down_idle0')
        a0, _ = render(albedo, albedo['frames'][i]); b0, _ = render(APP, APP['frames'][0])
        diff = sum(1 for p, q in zip(a0.getdata(), b0.getdata()) if p != q)
        same = dict(idle0_matches_approved=diff == 0, differing_px=diff)
    geo = {(fi, x, y): v for fi, g in enumerate(geos) for (x, y), v in g.items()}
    projs = {'albedo': albedo}
    for kind in ('normal', 'height'):
        proj = LB.build(albedo, geo, kind)
        for pf, af in zip(proj['frames'], albedo['frames']): pf['tag'] = af['tag']
        projs[kind] = proj
    colors = {k: len([c for c in p['palette'] if c != '.']) for k, p in projs.items()}
    for k, n in colors.items():
        if n > 64: warnings.append(f'{k} palette has {n} colours (>64)')
    alpha_bad = []      # the three projects must share one exact alpha mask per frame
    for fi, (f, g) in enumerate(zip(albedo['frames'], geos)):
        want = set(g)
        for kind, proj in projs.items():
            if alpha_set(proj, proj['frames'][fi]) != want: alpha_bad.append(f"{f['name']}:{kind}")
    if alpha_bad: warnings.append(f'alpha mask mismatch: {alpha_bad[:8]}')
    for kind, proj in projs.items():
        save(proj, out / f'{kind}.json')
        rep = export(proj, out / kind, columns=a.columns)
        warnings.extend(rep['warnings'])
        add_frame_meta(out / kind / 'atlas.json', meta, a.dirs)
    (out / 'poses.json').write_text(json.dumps(dict(
        basis=str(SRC.relative_to(GAME)), basis_sha=digest(APP), albedo_sha=digest(albedo), size=[W, H], pivot=list(PV),
        directions=a.dirs, columns=a.columns, frame_count=len(albedo['frames']), palette_colors=colors, alpha_mismatch=alpha_bad,
        split_check=same, warnings=warnings,
        status='generated by code; read contact.png and the warnings before accepting any frame', frames=meta), ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(dict(frames=len(albedo['frames']), split_check=same, colors=colors, alpha_mismatch=alpha_bad, warnings=warnings[:10], out=str(out)), ensure_ascii=False))

if __name__ == '__main__':
    main()
