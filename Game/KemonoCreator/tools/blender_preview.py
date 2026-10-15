# -*- coding: utf-8 -*-
"""形状確認用: npz メッシュを Workbench で数方向からレンダリングして1枚にまとめる。
blender -b --factory-startup -P blender_preview.py -- mesh.npz out_prefix
"""
import sys, math
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, outp = argv[0], argv[1]
d = np.load(src)
V, F = d['verts'].astype(np.float64), d['faces'].astype(np.int64)
# three.js 座標 (Y 上, Z 前) -> Blender (Z 上, -Y 前): (x, y, z) -> (x, -z, y)
V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('m')
me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel())
me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', np.arange(0, F.size, 3)); me.polygons.foreach_set('loop_total', np.full(len(F), 3))
me.update(calc_edges=True)
me.polygons.foreach_set('use_smooth', np.ones(len(F), dtype=bool))
ob = bpy.data.objects.new('m', me)
sc = bpy.context.scene
sc.collection.objects.link(ob)
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'SINGLE'
sc.display.shading.single_color = (0.8, 0.7, 0.6)
sc.display.shading.show_cavity = False
sc.render.resolution_x = 600
sc.render.resolution_y = 900
sc.render.film_transparent = False
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam

views = {
    'front': (0, 2.0),
    'side': (90, 2.0),
    'q34': (35, 2.0),
    'back': (180, 2.0),
    'face': (30, 0.45),
    'faceside': (90, 0.45),
    'hand': (20, 0.32),
}
for name, (az, scale) in views.items():
    a = math.radians(az)
    target = Vector((0, 0, 0.95)) if scale > 1 else Vector((0, -0.05, 1.7))
    if name == 'hand':
        target = Vector((0.62, 0.0, 0.93))
    dirv = Vector((math.sin(a), -math.cos(a), 0.05))
    cam.location = target + dirv * 5
    cam.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler()
    cam_d.ortho_scale = scale
    if scale < 1:
        sc.render.resolution_x, sc.render.resolution_y = 700, 700
    else:
        sc.render.resolution_x, sc.render.resolution_y = 600, 900
    sc.render.filepath = f'{outp}_{name}.png'
    bpy.ops.render.render(write_still=True)
print('PREVIEW DONE')
