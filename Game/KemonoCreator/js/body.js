// 体メッシュ（body.bin / body.json）の読み込みと、モーフ・骨の管理
import * as THREE from 'three';

const DT = { float32: Float32Array, uint16: Uint16Array, uint32: Uint32Array, uint8: Uint8Array, int16: Int16Array, int8: Int8Array };

export async function loadBodyData(base) {
  const [meta, bin] = await Promise.all([
    fetch(base + 'body.json').then(r => r.json()),
    fetch(base + 'body.bin').then(r => r.arrayBuffer()),
  ]);
  const view = (name) => {
    const l = meta.layout[name];
    const T = DT[l.dtype];
    return new T(bin, l.offset, l.length / T.BYTES_PER_ELEMENT);
  };
  const n = meta.vertexCount;
  const data = {
    meta,
    position: view('position'),
    normal: view('normal'),
    index: view('index'),
    skinIndex: view('skinIndex'),
    skinWeight: view('skinWeight'),
    maskA: view('maskA'),
    maskB: view('maskB'),
    morphP: [],
    morphN: [],
  };
  const IT = n < 65536 ? Uint16Array : Uint32Array;
  for (const m of meta.morphs) {
    const idx = new IT(bin, m.off_i, m.count);
    const qp = new Int16Array(bin, m.off_p, m.count * 3);
    const qn = new Int8Array(bin, m.off_n, m.count * 3);
    const dp = new Float32Array(n * 3);
    const dn = new Float32Array(n * 3);
    const sp = m.sp / 32767, sn = m.sn / 127;
    for (let i = 0; i < m.count; i++) {
      const v = idx[i] * 3;
      dp[v] = qp[i * 3] * sp; dp[v + 1] = qp[i * 3 + 1] * sp; dp[v + 2] = qp[i * 3 + 2] * sp;
      dn[v] = qn[i * 3] * sn; dn[v + 1] = qn[i * 3 + 1] * sn; dn[v + 2] = qn[i * 3 + 2] * sn;
    }
    data.morphP.push(dp);
    data.morphN.push(dn);
  }
  return data;
}

// スライダー値（-1..1）から、各モーフの重みを作る
export function morphWeights(meta, values) {
  const w = new Float32Array(meta.morphs.length);
  for (const [k, s] of Object.entries(meta.sliders)) {
    // 基準メッシュはスライダー値 base の形。そこから ±1 の形へ線形に補間する
    const v = values[k] || 0;
    const base = s.base || 0;
    if (v > base && s.pos !== undefined) w[s.pos] = (v - base) / (1 - base);
    if (v < base && s.neg !== undefined) w[s.neg] = (base - v) / (1 + base);
  }
  return w;
}

export class Body {
  constructor(data, material, outlineMaterial) {
    this.data = data;
    const meta = data.meta;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(data.skinIndex), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(data.skinWeight, 4, true));
    g.setAttribute('maskA', new THREE.BufferAttribute(data.maskA, 4, true));
    g.setAttribute('maskB', new THREE.BufferAttribute(data.maskB, 4, true));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.morphAttributes.position = data.morphP.map(a => new THREE.BufferAttribute(a, 3));
    g.morphAttributes.normal = data.morphN.map(a => new THREE.BufferAttribute(a, 3));
    g.morphTargetsRelative = true;
    g.computeBoundingSphere();
    g.boundingSphere.radius *= 1.6;
    this.geometry = g;

    // 骨
    this.bones = {};
    const list = [];
    for (const b of meta.bones) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      this.bones[b.name] = bone;
      list.push(bone);
    }
    for (const b of meta.bones) {
      if (b.parent) this.bones[b.parent].add(this.bones[b.name]);
    }
    this.root = this.bones.hips;
    this.skeleton = new THREE.Skeleton(list);

    this.mesh = new THREE.SkinnedMesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.add(this.root);
    this.outline = new THREE.SkinnedMesh(g, outlineMaterial);
    this.outline.layers.set(1);
    this.outline.frustumCulled = false;
    this.mesh.add(this.outline);
    this.mesh.morphTargetInfluences = new Array(meta.morphs.length).fill(0);
    this.mesh.morphTargetDictionary = {};
    meta.morphs.forEach((m, i) => { this.mesh.morphTargetDictionary[m.name] = i; });
    this.outline.morphTargetInfluences = this.mesh.morphTargetInfluences;
    this.weights = new Float32Array(meta.morphs.length);
    this.joints = {};
    this.setPose = null;
    this.updateRest();
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.outline.bind(this.skeleton, new THREE.Matrix4());
  }

  // 関節（およびアンカー点）の現在の休止位置
  joint(name) {
    const meta = this.data.meta;
    const base = meta.joints[name];
    const p = new THREE.Vector3(base[0], base[1], base[2]);
    meta.morphs.forEach((m, i) => {
      const w = this.weights[i];
      if (!w) return;
      const d = m.joints[name];
      if (d) p.x += d[0] * w, p.y += d[1] * w, p.z += d[2] * w;
    });
    return p;
  }

  setSliders(values) {
    this.weights = morphWeights(this.data.meta, values);
    for (let i = 0; i < this.weights.length; i++) this.mesh.morphTargetInfluences[i] = this.weights[i];
    this.updateRest();
  }

  // 休止姿勢（回転なし）で骨位置をモーフ後の関節に合わせ、逆行列を作り直す
  updateRest() {
    const meta = this.data.meta;
    const saved = {};
    for (const b of meta.bones) {
      const bone = this.bones[b.name];
      saved[b.name] = bone.quaternion.clone();
      bone.quaternion.identity();
      const j = this.joint(b.name);
      this.joints[b.name] = j;
      if (b.parent) {
        const pj = this.joint(b.parent);
        bone.position.copy(j).sub(pj);
      } else {
        bone.position.copy(j);
      }
    }
    this.root.updateMatrixWorld(true);
    // mesh の matrixWorld を含めずに逆行列を作る（bindMatrix = 単位行列, mesh は原点）
    const inv = [];
    const meshInv = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
    for (const bone of this.skeleton.bones) {
      inv.push(new THREE.Matrix4().multiplyMatrices(meshInv, bone.matrixWorld).invert());
    }
    this.skeleton.boneInverses = inv;
    for (const b of meta.bones) this.bones[b.name].quaternion.copy(saved[b.name]);
    // 接地: 足裏が y=0 にくるように
    this.groundOffset = -this.joint('sole').y;
  }

  // 頂点 i のモーフ後の休止位置・法線
  vertex(i, outP, outN) {
    const d = this.data;
    let x = d.position[i * 3], y = d.position[i * 3 + 1], z = d.position[i * 3 + 2];
    let nx = d.normal[i * 3], ny = d.normal[i * 3 + 1], nz = d.normal[i * 3 + 2];
    for (let k = 0; k < this.weights.length; k++) {
      const w = this.weights[k];
      if (!w) continue;
      const P = d.morphP[k], N = d.morphN[k];
      x += P[i * 3] * w; y += P[i * 3 + 1] * w; z += P[i * 3 + 2] * w;
      nx += N[i * 3] * w; ny += N[i * 3 + 1] * w; nz += N[i * 3 + 2] * w;
    }
    outP.set(x, y, z);
    if (outN) outN.set(nx, ny, nz).normalize();
    return outP;
  }

  // 基準形状で target に最も近い頂点（bone で絞り込み）
  nearestVertex(target, boneName) {
    const d = this.data;
    const bi = boneName ? this.data.meta.bones.findIndex(b => b.name === boneName) : -1;
    let best = -1, bd = 1e9;
    const n = d.meta.vertexCount;
    for (let i = 0; i < n; i++) {
      if (bi >= 0 && d.skinIndex[i * 4] !== bi) continue;
      const dx = d.position[i * 3] - target.x, dy = d.position[i * 3 + 1] - target.y, dz = d.position[i * 3 + 2] - target.z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }
}
