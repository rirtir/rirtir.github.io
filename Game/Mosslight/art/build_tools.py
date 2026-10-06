"""握りの中心を固定した原寸道具。刃と柄をWorkbenchの線・面で描く。"""
from assemble import header, finish
import math

lines = header((48, 48), (24, 36))
for kind in ['axe', 'pick', 'sword']:
    for material, edge, light, base in [('stone', 'O', 'Q', 'N'), ('copper', 't', 'L', 's'), ('iron', 'P', 'R', 'O')]:
        for pose, angle in enumerate([-38, 12, 68]):
            name = f'tool_{kind}_{material}_{pose}'
            radians = math.radians(angle)
            axis = (math.sin(radians), -math.cos(radians))
            cross = (math.cos(radians), math.sin(radians))
            def point(along, across=0):
                return (round(24 + axis[0]*along + cross[0]*across), round(36 + axis[1]*along + cross[1]*across))
            def line(a, b, color):
                lines.append(f'line {a[0]} {a[1]} {b[0]} {b[1]} {color}')
            def poly(points, color):
                lines.append('poly ' + ' '.join(str(v) for p in points for v in p) + ' ' + color)
            lines.append(f'part {name} 48 48')
            line(point(-3, -1), point(17, -1), 'F')
            line(point(-3, 0), point(17, 0), 'H')
            line(point(-2, 1), point(16, 1), 'K')
            if kind == 'axe':
                poly([point(13,-2), point(19,-2), point(19,4), point(17,7), point(12,5)], base)
                poly([point(14,1), point(19,1), point(18,4), point(16,6), point(13,4)], edge)
                line(point(19,2), point(17,6), light)
                line(point(13,-2), point(19,-2), '0')
            elif kind == 'pick':
                poly([point(15,-7), point(18,-4), point(18,4), point(15,7), point(16,1), point(16,-1)], base)
                line(point(17,-5), point(18,0), light)
                line(point(18,0), point(16,5), edge)
            else:
                poly([point(4,-2), point(18,-2), point(22,0), point(18,2), point(4,2)], base)
                line(point(5,0), point(21,0), light)
                line(point(5,1), point(19,1), edge)
                line(point(3,-4), point(3,4), 'H')
                line(point(4,-3), point(4,3), 'L')
            for along in [0,2]:
                line(point(along,-1), point(along,1), 'M')
            lines.extend((f'frame {name} 100', 'tag held_tool', f'place sprite {name} 0 0'))
finish('tools', lines, (24,36), 'props')
