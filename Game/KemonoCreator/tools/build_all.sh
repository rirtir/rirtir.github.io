#!/bin/sh
# 体メッシュの全工程: SDF -> 高解像度メッシュ -> Blender で間引き -> モーフ等を書き出し
set -e
cd "$(dirname "$0")"
STEP=${1:-0.0045}
TRIS=${2:-44000}
B="/c/Program Files/Blender Foundation/Blender 3.2/blender.exe"
P="$(cygpath -m "$PWD")"
python mesh_sdf.py $STEP | tail -1
"$B" -b --factory-startup -P blender_decimate.py -- "$P/out/hires.npz" "$P/out/lowres.npz" $TRIS 2>&1 | grep DECIMATED
python -u build_body.py
