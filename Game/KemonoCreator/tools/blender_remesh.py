# -*- coding: utf-8 -*-
"""段階B (Blender): 高解像度メッシュを ボクセルリメッシュで四角形主体の均一なメッシュに作り直す。
細長い三角形がなくなるので、モーフを組み合わせても裏返りにくい。
blender -b --factory-startup -P blender_remesh.py -- in.npz out.npz voxel(0.1mm)
"""
import sys, time
import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
t0 = time.time()
d = np.load(src)
V, F = d['verts'].astype(np.float64), d['faces'].astype(np.int64)
bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('body')
me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel())
me.polygons.add(len(F)); me.polygons.foreach_set('loop_start', np.arange(0, F.size, 3)); me.polygons.foreach_set('loop_total', np.full(len(F), 3))
me.update(calc_edges=True); me.validate()
ob = bpy.data.objects.new('body', me)
bpy.context.scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')
# ボクセルリメッシュ（同期実行・四角形で均一）。target は「ボクセルサイズ(0.1mm単位)」
ob.data.remesh_voxel_size = target / 10000.0
ob.data.remesh_voxel_adaptivity = 0.0
ob.data.use_remesh_fix_poles = True
ob.data.use_remesh_preserve_volume = True
bpy.ops.object.voxel_remesh()
print('voxel', len(ob.data.polygons), time.time() - t0)
# 対称にそろえる
m = ob.modifiers.new('sym', 'MIRROR')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.symmetrize(direction='POSITIVE_X')
bpy.ops.object.mode_set(mode='OBJECT')
ob.modifiers.remove(m)
tri = ob.modifiers.new('tri', 'TRIANGULATE')
tri.quad_method = 'SHORTEST_DIAGONAL'
bpy.ops.object.modifier_apply(modifier='tri')
me = ob.data
nv = len(me.vertices)
co = np.empty(nv * 3); me.vertices.foreach_get('co', co)
nf = len(me.polygons)
loops = np.empty(nf * 3, dtype=np.int64); me.polygons.foreach_get('vertices', loops)
np.savez(dst, verts=co.reshape(-1, 3).astype(np.float32), faces=loops.reshape(-1, 3).astype(np.int32))
print('REMESHED', nv, nf, time.time() - t0)
