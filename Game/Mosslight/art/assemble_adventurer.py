"""全身のキーポーズを接続。左方向はWorkbenchのレイヤー反転で揃える。"""
from assemble import GAME, load, header, part, finish

sources = {key: load(GAME / 'art' / f'{key}.json') for key in ['hero', 'walk', 'attack', 'roll']}
lines = header((32, 48), (16, 40))
for direction in ['down', 'up', 'left', 'right']:
    for action, count in [('idle', 2), ('walk', 4), ('attack', 3), ('roll', 3)]:
        source_direction = 'right' if direction == 'left' and action != 'idle' else direction
        for index in range(count):
            name = f'hero_{direction}_{action}{index}'
            source_name = f'hero_{source_direction}_{action}{0 if action == "idle" else index}'
            source = sources['hero' if action == 'idle' else action]
            frame = next(f for f in source['frames'] if f['name'] == source_name)
            pixels = source['parts'][frame['layers'][0]['part']]['rows']
            part(lines, name, pixels)
            lines.extend((f'frame {name} {180 if action == "walk" else 100}', f'tag {action}', f'place sprite {name} 0 0'))
            if direction == 'left' and action != 'idle':
                lines.append('mirror sprite x')
finish('adventurer', lines, (16, 40), 'actors')
