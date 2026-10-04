"""CC0原画を再サンプリングせず、一枚のスプライトアトラスへ整理する。"""
from pathlib import Path
from PIL import Image
import json

assets=Path(__file__).resolve().parents[1]/'assets'
frames={};sprites=[];x=y=row_h=0;width=512
for path in sorted((assets/'dungeon').glob('*.png')):
    im=Image.open(path).convert('RGBA')
    if x+im.width>width:x=0;y+=row_h+1;row_h=0
    frames[path.name]=[x,y,im.width,im.height]
    sprites.append((im,x,y));x+=im.width+1;row_h=max(row_h,im.height)
atlas=Image.new('RGBA',(width,y+row_h))
for im,x,y in sprites:atlas.paste(im,(x,y))
atlas.save(assets/'dungeon-atlas.png',optimize=True)
(assets/'dungeon-atlas.json').write_text(json.dumps({'sprites':frames},indent=2),encoding='utf-8')
print(f'Packed {len(frames)} native frames: {atlas.size}')
