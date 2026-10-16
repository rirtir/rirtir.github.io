# -*- coding: utf-8 -*-
"""頭の確認用レンダリング（頂点カラー付き、6方向）"""
import sys, math
import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, outp = argv[0], argv[1]
d = np.load(src)
V, F, C = d['verts'].astype(np.float64), d['faces'].astype(np.int64), d['colors']
T = d['target']
cv = lambda p: Vector((p[0], -p[2], p[1]))
V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('m')
me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel())
me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', np.arange(0, F.size, 3)); me.polygons.foreach_set('loop_total', np.full(len(F), 3))
me.update(calc_edges=True)
me.polygons.foreach_set('use_smooth', np.ones(len(F), dtype=bool))
col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
rgba = np.concatenate([C, np.ones((len(C), 1))], axis=1).astype(np.float32)
col.data.foreach_set('color', rgba.ravel())
ob = bpy.data.objects.new('m', me)
sc = bpy.context.scene
sc.collection.objects.link(ob)
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'VERTEX'
sc.display.shading.show_cavity = True
sc.display.shading.cavity_type = 'WORLD'
sc.render.resolution_x = 520
sc.render.resolution_y = 520
cam_d = bpy.data.cameras.new('c'); cam_d.lens = 85
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
target = cv(T)
views = {'front': (0, 0.0), 'q30': (30, 0.05), 'q55': (55, 0.05), 'side': (90, 0.0), 'low': (35, -0.45), 'high': (35, 0.5)}
for name, (az, el) in views.items():
    a = math.radians(az)
    dirv = Vector((math.sin(a) * math.cos(el), -math.cos(a) * math.cos(el), math.sin(el)))
    cam.location = target + dirv * 0.95
    cam.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{outp}_{name}.png'
    bpy.ops.render.render(write_still=True)
print('HEAD DONE')
