# -*- coding: utf-8 -*-
"""段階B (Blender): 高解像度メッシュを左右対称を保って間引く。
blender -b --factory-startup -P blender_decimate.py -- in.npz out.npz target_tris
"""
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])

d = np.load(src)
V, F = d['verts'].astype(np.float64), d['faces'].astype(np.int64)
# skimage の座標系 (x, y, z) は three.js と同じ Y 上なので、Blender 内でもそのまま扱う（対称軸は X）
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('body')
me.vertices.add(len(V))
me.vertices.foreach_set('co', V.ravel())
me.loops.add(F.size)
me.loops.foreach_set('vertex_index', F.ravel())
me.polygons.add(len(F))
me.polygons.foreach_set('loop_start', np.arange(0, F.size, 3))
me.polygons.foreach_set('loop_total', np.full(len(F), 3))
me.update(calc_edges=True)
me.validate()
ob = bpy.data.objects.new('body', me)
bpy.context.scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)

# 重複頂点をまとめる（marching cubes は共有済みだが念のため）
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')

m = ob.modifiers.new('dec', 'DECIMATE')
m.decimate_type = 'COLLAPSE'
m.ratio = min(1.0, target / max(1, len(me.polygons)))
m.use_symmetry = True
m.symmetry_axis = 'X'
m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='dec')
tri = ob.modifiers.new('tri', 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier='tri')

me = ob.data
nv = len(me.vertices)
co = np.empty(nv * 3)
me.vertices.foreach_get('co', co)
nf = len(me.polygons)
loops = np.empty(nf * 3, dtype=np.int64)
me.polygons.foreach_get('vertices', loops)
np.savez(dst, verts=co.reshape(-1, 3).astype(np.float32), faces=loops.reshape(-1, 3).astype(np.int32))
print('DECIMATED', nv, nf)
