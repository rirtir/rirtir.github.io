"""探索者と同じ原寸・クラスタで、料理人/農家/大工を描く。"""
from assemble import GAME, load, header, part, finish

source = load(GAME/'art/explorer.json')
lines = header((32,48), (16,40))
for name, data in source['parts'].items():
    part(lines,name,data['rows'])
for role, cloth, light, apron in [('cook','Y','Z','E'),('farmer','3','5','4'),('builder','A','B','J')]:
    for direction in ('down','up','right'):
        rows = source['parts'][f'coat_{direction}']['rows']
        rows = [row.translate(str.maketrans({'n':cloth,'o':light,'B':apron,'A':cloth})) for row in rows]
        part(lines, f'{role}_coat_{direction}', rows)
part(lines, 'strawhat', ['.....KKKKKKKKKK.....','....KKLLLLLLLKKK....','....KKLLLLLLLLKK....','....HHHHHHHHHHHH....','KKKKKKKKKKKKKKKKKKKK','..HHHHHHHHHHHHHHHH..'])
part(lines, 'bonnet', ['...EEEEEEEE...','..EERRRRRREE..','.EERRRRRRRREE.','EERRRRRRRRRREE','EERRRRRRRRRREE'])
part(lines, 'beard', ['HWWWWWWWWH','HHWWWWWWHH','.HHHHHHHH.','..HHHHHH..'])
for role in ('cook','farmer','builder'):
    for direction in ('down','up','right','left'):
        base = 'right' if direction == 'left' else direction
        for index in range(4):
            frame = source['frames'][next(i for i,f in enumerate(source['frames']) if f['name']==f'hero_{direction}_walk{index}')]
            name = f'npc_{role}_{direction}_walk{index}'
            lines.extend((f'frame {name} 160', 'tag resident'))
            for layer in frame['layers']:
                sprite = f'{role}_coat_{base}' if layer['id']=='coat' else layer['part']
                lines.append(f'place {layer["id"]} {sprite} {layer["x"]} {layer["y"]}')
                if layer.get('flip_x'):
                    lines.append(f'mirror {layer["id"]} x')
            bob = -1 if index % 2 else 0
            if role == 'farmer':
                lines.append(f'place hat strawhat 6 {3+bob}')
            elif role == 'cook':
                lines.append(f'place hat bonnet 9 {3+bob}')
            elif direction != 'up':
                lines.append(f'place beard beard {10 if direction=="left" else 12 if direction=="down" else 14} {18+bob}')
finish('villagers',lines,(16,40),'actors')
