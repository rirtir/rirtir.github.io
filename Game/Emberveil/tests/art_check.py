"""本来のドット絵が変換・半透明補間なしに保たれていることを検証。"""
from pathlib import Path
import json
from PIL import Image

root=Path(__file__).resolve().parents[1]
meta=json.loads((root/'assets/pixel-atlas.json').read_text(encoding='utf-8'))
art=Image.open(root/'assets/pixel-atlas.png')
assert art.size==(meta['width'],meta['height'])
assert meta['native_pixel_art'] is True
palette={tuple(bytes.fromhex(x[1:])) for x in meta['palette']}
for color in art.getdata():
    assert color[3] in (0,255),'半透明の原画ピクセル'
    assert color[3]==0 or color[:3] in palette,'固定パレット外の原画色'
assert len(meta['sprites'])>=31
for name,(x,y,w,h) in meta['sprites'].items():
    assert min(x,y)>=0 and w>0 and h>0 and x+w<=art.width and y+h<=art.height,name
for name in ['knight_m_idle_anim_f0.png','knight_m_run_anim_f3.png','big_demon_idle_anim_f0.png']:
    im=Image.open(root/'assets/dungeon'/name).convert('RGBA')
    assert all(c[3] in (0,255) for c in im.getdata()),name
packed=Image.open(root/'assets/dungeon-atlas.png').convert('RGBA')
frames=json.loads((root/'assets/dungeon-atlas.json').read_text(encoding='utf-8'))['sprites']
for name,(x,y,w,h) in frames.items():
    original=Image.open(root/'assets/dungeon'/name).convert('RGBA')
    assert original.size==(w,h) and original.tobytes()==packed.crop((x,y,x+w,y+h)).tobytes(),name
assert not (root/'assets/garden-atlas.png').exists(),'不採用の疑似ドット画像が混入'
print(f"PASS: original native pixel atlas / fixed palette / binary alpha / {len(meta['sprites'])} sprites / CC0 source pixels")
