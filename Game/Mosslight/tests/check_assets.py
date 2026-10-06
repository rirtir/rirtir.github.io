"""アトラス契約、画素範囲、歩行の差分を検証する。自然さの評価は実画面で行う。"""
from pathlib import Path
import json, unittest
from PIL import Image, ImageChops

GAME=Path(__file__).resolve().parents[1]

class Assets(unittest.TestCase):
    def test_lighting_maps_match_color(self):
        manifest=json.loads((GAME/'assets/manifest.json').read_text(encoding='utf-8'))
        for name,definition in manifest['sheets'].items():
            if name in ('ui','logo'): continue
            color=Image.open(GAME/'assets'/definition['image']).convert('RGBA')
            mask=color.getchannel('A').point(lambda a:255 if a>=128 else 0)
            for kind in ('normal','height'):
                mapped=Image.open(GAME/'assets'/definition[kind]).convert('RGBA')
                self.assertEqual(mapped.size,color.size,(name,kind))
                self.assertIsNone(ImageChops.difference(mask,mapped.getchannel('A')).getbbox(),(name,kind))
                project=json.loads((GAME/'art/normalmaps'/f'{name}-{kind}.json').read_text(encoding='utf-8'))
                self.assertEqual([f['name'] for f in project['frames']],definition['names'])
                self.assertEqual(project['pivot'],definition['pivot'])
        # 地面の法線が全部平面のままでは、照明テストだけ通っても起伏は表示されない。
        ground=Image.open(GAME/'assets/ground/normal.png').convert('RGBA')
        atlas=json.loads((GAME/'assets/ground/atlas.json').read_text(encoding='utf-8'))
        for name in ('grass0','dirt0','cave0'):
            r=atlas['frames'][name]['frame']
            crop=ground.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
            self.assertTrue(any(a and (rr!=128 or gg!=128) for rr,gg,b,a in crop.getdata()),name)

    def test_contract_and_pixels(self):
        manifest=json.loads((GAME/'assets/manifest.json').read_text(encoding='utf-8'))
        self.assertTrue({'tiles','props','actors','icons'}.issubset(manifest['sheets']))
        for name,sheet in manifest['sheets'].items():
            atlas=json.loads((GAME/'assets'/sheet['atlas']).read_text(encoding='utf-8'))
            image=Image.open(GAME/'assets'/sheet['image']).convert('RGBA')
            source='hero-animated' if name=='hero' else name
            project=json.loads((GAME/'art'/f'{source}.json').read_text(encoding='utf-8'))
            self.assertLessEqual(len(project['palette']),65)
            self.assertEqual(set(sheet['names']),set(atlas['frames']))
            self.assertEqual(sheet['pivot'],atlas['meta']['pivot'])
            for key,frame in atlas['frames'].items():
                r=frame['frame'];self.assertLessEqual(r['x']+r['w'],image.width);self.assertLessEqual(r['y']+r['h'],image.height)
                crop=image.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
                self.assertIsNotNone(crop.getbbox(),key)
    def test_direction_and_stride_are_distinct(self):
        data=json.loads((GAME/'assets/explorer/atlas.json').read_text(encoding='utf-8'))
        sheet=Image.open(GAME/'assets/explorer/atlas.png').convert('RGBA')
        def crop(name):
            r=data['frames'][name]['frame'];return sheet.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])).convert('RGB')
        for direction in ['left','right','up','down']:
            frames=[crop(f'hero_{direction}_walk{i}') for i in range(4)]
            self.assertIsNotNone(ImageChops.difference(frames[0],frames[1]).getbbox())
            self.assertIsNotNone(ImageChops.difference(frames[1],frames[3]).getbbox())
        self.assertIsNotNone(ImageChops.difference(crop('hero_left_idle0'),crop('hero_right_idle0')).getbbox())
        for direction in ['left','right','up','down']:
            for action in ['attack', 'roll']:
                self.assertIsNotNone(ImageChops.difference(crop(f'hero_{direction}_{action}0'),crop(f'hero_{direction}_{action}1')).getbbox())

if __name__=='__main__':unittest.main()
