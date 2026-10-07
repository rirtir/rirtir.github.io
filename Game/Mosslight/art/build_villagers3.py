"""村人(cook/farmer/builder)を主人公のwalk4コマから再利用生成する。48x64 pivot(24,58)。
顔料(色)だけを差し替える部分は法線/高さをそのまま再利用。ランタンは外し、見えなくなった所は最寄りの体の面から補う。
帽子・髭・エプロンは原画のrow/px部品で、帽子のgeoはblob(楕円体)から surface() で求める。LEFTは完成したRIGHTの反転。
実行: python art/build_villagers3.py [--out DIR]   出力: .review/v3/villagers-production/"""
from pathlib import Path
from collections import Counter
import argparse, json
import build_explorer3 as E
from build_explorer3 import W, H, PV, INK, N4, GAME
from engine import Editor, render
from pixelwork import export, save
import build_hero_lightbox3 as LB

OUT = GAME / '.review/v3/villagers-production'
ROLES, DIRS = ('cook', 'farmer', 'builder'), ('down', 'up', 'left', 'right')
ECRU, STRAW = ('#d9cba8', '#b3a37c', '#6e6048'), ('#e0c070', '#bf9648', '#80602c')
BLUE = ('#3a5f9a', '#2a4778', '#1c2f55')
PANTS = {'#1c2238': '#2e2622', '#2a3556': '#443830'}
COAT_SRC = ('#1e2f4a', '#2e4a6b')          # E.COAT / E.ARM の o,r (q も同色)
SPEC = {   # hair(H,L,D,o) / coat(dark,main) / neck(M,N,o)
    'cook': dict(hair=('#3b2b2e', '#54403f', '#2a1f24', '#1a1418'), coat=('#5a2a22', '#8e4a32'), neck=ECRU),
    'farmer': dict(hair=('#8a5a32', '#b07a45', '#6a4426', '#3e2616'), coat=('#2f4a2a', '#4f7a3a'), neck=STRAW),
    'builder': dict(hair=('#4a4a52', '#666670', '#34343c', '#1e1e24'), coat=('#5a1e22', '#a03a34'), neck=ECRU)}
BEARD = ('#5a3a2a', '#42291f')

def remap_of(role):
    s = SPEC[role]
    m = dict(PANTS)
    m.update(zip(E.HAIR.values(), s['hair'])); m.update(zip(E.SCARF.values(), s['neck'])); m.update(zip(COAT_SRC, s['coat']))
    return m

def ellipse(cx, cy, rx, ry):
    return {(x, y) for x in range(W) for y in range(H) if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1}

def hat(role, d, ty, cx, w):
    """(pix, prims): 髪の上に載る帽子。cookは無し。ty=頭の最上段, cx=頭中心x, w=頭幅"""
    if role == 'cook': return {}, []
    pix, prims = {}, []
    if role == 'farmer':
        crown = {p for p in ellipse(cx, ty + 1, w / 2 - 1.5, 3.2) if p[1] <= ty + 1}
        brim = ellipse(cx, ty + 2.5, w / 2 + 2, 1.5)
        for x, y in crown: pix[(x, y)] = STRAW[0] if y < ty else '#6a4a2a' if y == ty else STRAW[1]
        for x, y in brim: pix[(x, y)] = STRAW[0] if y == ty + 1 else STRAW[1] if y == ty + 2 else STRAW[2]
        prims = [E.blob(cx, ty + .5, w / 2 - 1.5, 3.4, .9), E.blob(cx, ty + 2.5, w / 2 + 2, 1.8, .9, 4)]
    else:
        crown = {p for p in ellipse(cx, ty + 1, w / 2 - .5, 3.4) if p[1] <= ty + 1}
        for x, y in crown: pix[(x, y)] = BLUE[0] if y < ty else BLUE[1] if y == ty else BLUE[2]
        prims = [E.blob(cx, ty + .5, w / 2 - .5, 3.6, .9)]
        if d != 'up':      # 短いつば: 正面は両目の上、横は進行方向(右)へ
            lo, hi = (cx - w / 2 + 1, cx + w / 2 - 1) if d == 'down' else (cx, cx + w / 2 + 1.5)
            for x in range(int(lo), int(hi)): pix[(x, ty + 2)] = BLUE[2]
            prims.append(E.blob((lo + hi) / 2, ty + 2, (hi - lo) / 2, 1.2, .9, 4))
    return {p: c for p, c in pix.items() if 0 <= p[0] < W and 0 <= p[1] < H}, prims

def recolor(role, d, layers, pel):
    """エプロン/髭は既存の体のピクセルの色替え(形不変)、その後に役のpalette差替え"""
    m, px, py = remap_of(role), pel[0], pel[1]
    for l in layers:
        pix, id_ = l['pix'], l['id']
        if role == 'cook' and d != 'up' and id_.startswith('torso'):     # 短い前掛け: 腰の上の5行だけ
            lo, hi = (px - 2, px + 3) if d == 'down' else (px, px + 3)
            for (x, y), c in pix.items():
                if lo <= x < hi and py - 5 <= y < py and c in COAT_SRC:
                    pix[(x, y)] = ECRU[1] if y == py - 1 or c == COAT_SRC[0] else ECRU[0]
        if role == 'builder' and d != 'up' and id_ in ('head_face', 'head_side'):
            skin = {c for c, _ in Counter(pix.values()).most_common(3)}
            xs = [x for x, _ in pix]; y1 = max(y for _, y in pix); cx = (min(xs) + max(xs) + 1) / 2
            for (x, y), c in pix.items():
                near = abs(x + .5 - cx) <= 2.5 if d == 'down' else x >= cx
                if y >= y1 - 1 and near and c in skin: pix[(x, y)] = BEARD[y == y1]
        l['pix'] = {p: m.get(c, c) for p, c in pix.items()}

def make(role, d, layers, geo, meta):
    """ランタンを外し、帽子を足し、輪郭とgeoを作り直す。戻り値 (layers, geo)"""
    own = {p: l['id'] for l in layers if l['id'] != 'outline' for p in l['pix']}    # 最後のlayerが描画/geoの持ち主
    lan = set(next(l['pix'] for l in layers if l['id'] == 'lantern'))
    keep = [dict(l, pix=dict(l['pix'])) for l in layers if l['id'] not in ('outline', 'lantern')]
    recolor(role, d, keep, meta['pelvis'])
    head = [p for l in keep if l['id'] in E.HEAD_IDS for p in l['pix']]
    xs = [p[0] for p in head]
    hp, prims = hat(role, d, min(p[1] for p in head), (min(xs) + max(xs) + 1) / 2, max(xs) - min(xs) + 1)
    body = {p for l in keep for p in l['pix']} | set(hp)
    donors = [q for q in body if own.get(q) not in (None, 'lantern') and q not in hp]
    new = {}
    for p in body - set(hp):
        if own[p] != 'lantern': new[p] = geo[p]
        else:   # ランタンが持っていた面: 最寄りの体のgeoで補う
            q = min(donors, key=lambda q: (max(abs(q[0] - p[0]), abs(q[1] - p[1])), (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2, q))
            new[p] = geo[q]
    ring = {(x + dx, y + dy) for x, y in body for dx, dy in N4} - body
    ring = {p for p in ring if 0 <= p[0] < W and 0 <= p[1] < H}
    near = ring | {p for p in body if any((p[0] + dx, p[1] + dy) in ring for dx, dy in N4)}
    for p in hp:
        Z, N = E.surface(prims, p[0], p[1], PV)
        new[p] = (E.qn(N, p in near), max(0., Z), E.ROUGH['cloth'], False)
    lring = {(x + dx, y + dy) for x, y in lan for dx, dy in N4}
    for p in ring:
        nb = [(p[0] + dx, p[1] + dy) for dx, dy in N4 if (p[0] + dx, p[1] + dy) in body]
        if any(q in hp for q in nb):
            Z, N = E.surface(prims, p[0], p[1], PV); new[p] = (E.qn(N, True), max(0., Z), E.ROUGH['cloth'], False)
        elif p in geo and p not in lring: new[p] = geo[p]
        else: new[p] = new[min(nb)]
    new = {p: v[:3] + (False,) for p, v in new.items()}
    if hp: keep.append(E.layer('hat', hp, prims))
    return keep + [E.layer('outline', {p: INK for p in ring}, [])], new

def walk_frames(d):
    f, g, m, _ = E.build_dir(d)
    rows = [(fr, geo) for fr, geo in zip(f, g) if '_walk' in fr[0]]
    if len(rows) != 4: raise ValueError(f'{d}: walk frames {len(rows)} != 4')
    return rows, m

def manifest_names():
    v = json.loads((GAME / 'assets/manifest.json').read_text(encoding='utf-8'))['sheets']['villagers']
    while isinstance(v, dict): v = next(v[k] for k in ('frames', 'names') if k in v)
    names = [x if isinstance(x, str) else x['name'] for x in v]
    want = [f'npc_{r}_{d}_walk{i}' for r in ROLES for d in DIRS for i in range(4)]
    if names != want: raise ValueError(f'manifest villagers != 48 expected names: {sorted(set(names) ^ set(want))[:6]}')
    return names

def albedo_project(frames):
    """合成済み1コマ=1部品。palette は使う色だけのlocal palette(64色以内)を明示的に作る"""
    cols = sorted({c for _, _, _, layers in frames for l in layers for c in l['pix'].values()})
    syms = [s for s in E.SYMBOLS if s != '.']
    if len(cols) > min(64, len(syms)): raise ValueError(f'palette {len(cols)} colours > 64')
    sym = dict(zip(cols, syms))
    cmds = [f'canvas {W} {H}', f'pivot {PV[0]} {PV[1]}'] + [f'palette {sym[c]} {c}' for c in cols]
    for name, dur, tag, layers in frames:
        pix = {p: c for l in layers for p, c in l['pix'].items()}
        x0, x1, y0, y1 = min(p[0] for p in pix), max(p[0] for p in pix), min(p[1] for p in pix), max(p[1] for p in pix)
        rows = [''.join(sym[pix[(x, y)]] if (x, y) in pix else '.' for x in range(x0, x1 + 1)) for y in range(y0, y1 + 1)]
        cmds += [f'part {name} {len(rows[0])} {len(rows)}', 'rows ' + '|'.join(rows)]
    for name, dur, tag, layers in frames:
        pix = [p for l in layers for p in l['pix']]
        cmds += [f'frame {name} {dur}', f'tag {tag}', f'place {name} {name} {min(p[0] for p in pix)} {min(p[1] for p in pix)}']
    return Editor().apply('\n'.join(cmds) + '\n')

def alpha_set(proj, frame):
    im, _ = render(proj, frame)
    return {(i % W, i // W) for i, c in enumerate(im.getdata()) if c[3]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=str(OUT)); ap.add_argument('--columns', type=int, default=8)
    a = ap.parse_args(); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    names, built, poses = manifest_names(), {}, {}
    for role in ROLES:
        for d in ('down', 'up', 'right', 'left'):
            if d == 'left':    # 完成したRIGHTを反転(関節/足接地/帽子ごと)
                src = [(n, dur, tag, ly, g) for n, dur, tag, ly, g in (built[f'npc_{role}_right_walk{i}'] for i in range(4))]
                rows, m = walk_frames('left')
                for i, (n, dur, tag, ly, g) in enumerate(src):
                    nm = f'npc_{role}_left_walk{i}'
                    built[nm] = (nm, dur, tag, E.mirror_layers(ly), E.mirror_geo(g))
                    poses[nm] = m[rows[i][0][0]]
                continue
            rows, m = walk_frames(d)
            for i, ((n, dur, tag, layers), g) in enumerate(rows):
                nm = f'npc_{role}_{d}_walk{i}'
                ly, geo = make(role, d, layers, g, m[n])
                built[nm] = (nm, dur, tag, ly, geo); poses[nm] = m[n]
    frames = [built[n][:4] for n in names]; geos = [built[n][4] for n in names]
    albedo = albedo_project(frames)
    geo = {(fi, x, y): v for fi, g in enumerate(geos) for (x, y), v in g.items()}
    projs, bad = {'albedo': albedo}, []
    for kind in ('normal', 'height'):
        projs[kind] = LB.build(albedo, geo, kind)
        for pf, af in zip(projs[kind]['frames'], albedo['frames']): pf['tag'] = af['tag']
    for fi, g in enumerate(geos):      # 3枚のalphaは各コマで完全一致
        for kind, proj in projs.items():
            if alpha_set(proj, proj['frames'][fi]) != set(g): bad.append(f'{names[fi]}:{kind}')
    warns = list(E.warnings)
    for kind, proj in projs.items():
        save(proj, out / f'{kind}.json')
        warns += export(proj, out / kind, columns=a.columns)['warnings']
    rec = {}
    for n in names:
        p = poses[n]; fe = p['feet']
        rec[n] = dict(pivot=list(PV), head=p['head'], feet=fe, foot=[sum(f[0] for f in fe.values()) / len(fe), max(f[1] for f in fe.values())],
                      lantern=dict(visible=False, glass_px=[], glass_center=None, light_anchor=None),
                      local_x_flip=bool(p.get('local_x_flip')), flip_pivot=p.get('flip_pivot'))
    (out / 'poses.json').write_text(json.dumps(dict(size=[W, H], pivot=list(PV), columns=a.columns, frame_count=len(names),
                                                    alpha_mismatch=bad, warnings=warns, frames=rec), ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(dict(frames=len(names), alpha_mismatch=bad, warnings=warns[:10], out=str(out)), ensure_ascii=False))

if __name__ == '__main__':
    main()
