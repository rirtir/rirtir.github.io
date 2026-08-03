import * as THREE from './vendor/three.module.min.js';

export const PALETTE = Object.freeze({
  void: 0x050812,
  deepNavy: 0x0b1221,
  slate: 0x1b2a3a,
  ceramic: 0xdce7e5,
  muted: 0x91a3ae,
  cyan: 0x43f5d0,
  blue: 0x42b8ff,
  coral: 0xff5e73,
  amber: 0xffb84a,
  violet: 0xb889ff,
  blackMetal: 0x080d15,
});

const shared = {
  ceramic: new THREE.MeshStandardMaterial({ color: PALETTE.ceramic, roughness: 0.28, metalness: 0.18, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: PALETTE.blackMetal, roughness: 0.64, metalness: 0.72, flatShading: true }),
  slate: new THREE.MeshStandardMaterial({ color: PALETTE.slate, roughness: 0.82, metalness: 0.42, flatShading: true }),
  enemy: new THREE.MeshStandardMaterial({ color: 0x111925, roughness: 0.58, metalness: 0.82, flatShading: true }),
  cyan: glowMaterial(PALETTE.cyan, 1.8),
  blue: glowMaterial(PALETTE.blue, 1.4),
  coral: glowMaterial(PALETTE.coral, 1.7),
  amber: glowMaterial(PALETTE.amber, 1.5),
  violet: glowMaterial(PALETTE.violet, 1.7),
};

function glowMaterial(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.34,
    metalness: 0.18,
    toneMapped: false,
    flatShading: true,
  });
}

function translucent(color, opacity = 0.3, depthWrite = false) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  material.userData.owned = true;
  return material;
}

function mesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function markSpin(object, axis = 'y', speed = 1) {
  object.userData.spin = { axis, speed };
  return object;
}

function createWingGeometry(length = 0.95, width = 0.5) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.03, 0.45,
    width, 0, -0.2,
    0.12, 0, -length,
    0, -0.03, 0.45,
    0.12, 0, -length,
    width, 0, -0.2,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addCore(parent, colorMaterial = shared.coral, radius = 0.22, position = [0, 0, 0]) {
  const halo = mesh(parent, new THREE.TorusGeometry(radius * 1.35, radius * 0.08, 6, 18), colorMaterial, position, [Math.PI / 2, 0, 0]);
  halo.userData.pulse = { speed: 2.4, amount: 0.08 };
  const core = mesh(parent, new THREE.OctahedronGeometry(radius, 1), colorMaterial, position);
  core.userData.pulse = { speed: 3.2, amount: 0.1 };
  return core;
}

function finalize(group, kind, radius) {
  group.userData.modelKind = kind;
  group.userData.radius = radius;
  group.traverse((child) => {
    if (child.isMesh) {
      child.userData.baseScale = child.scale.clone();
      child.userData.basePositionZ = child.position.z;
    }
  });
  return group;
}

export function createPlayerModel(chassis = 'lancer') {
  const group = new THREE.Group();
  group.name = `player-${chassis}`;

  if (chassis === 'weaver') {
    mesh(group, new THREE.SphereGeometry(0.32, 12, 8), shared.dark);
    addCore(group, shared.cyan, 0.17, [0, 0, 0.12]);
    for (let i = 0; i < 3; i += 1) {
      const angle = i * Math.PI * 2 / 3;
      const petal = new THREE.Group();
      petal.rotation.z = angle;
      mesh(petal, new THREE.ConeGeometry(0.29, 0.8, 3), shared.ceramic, [0, 0.55, -0.02], [0, 0, Math.PI]);
      const satellite = mesh(petal, new THREE.SphereGeometry(0.09, 8, 6), shared.cyan, [0, 0.9, 0]);
      satellite.userData.pulse = { speed: 3 + i * 0.3, amount: 0.16 };
      group.add(petal);
    }
    markSpin(group.children[0], 'y', 0.5);
    return finalize(group, 'player-weaver', 0.86);
  }

  if (chassis === 'bulwark') {
    mesh(group, new THREE.CylinderGeometry(0.68, 0.68, 0.2, 6), shared.ceramic, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(group, new THREE.CylinderGeometry(0.52, 0.52, 0.3, 6), shared.dark, [0, 0, 0.02], [Math.PI / 2, 0, 0]);
    addCore(group, shared.cyan, 0.2, [0, 0, 0.2]);
    for (const x of [-0.48, 0.48]) {
      mesh(group, new THREE.BoxGeometry(0.16, 0.38, 0.55), shared.ceramic, [x, 0, -0.08], [0, 0, x > 0 ? -0.2 : 0.2]);
    }
    return finalize(group, 'player-bulwark', 0.8);
  }

  const body = mesh(group, new THREE.ConeGeometry(0.42, 1.34, 4), shared.ceramic, [0, 0, 0.1], [Math.PI / 2, 0, Math.PI / 4]);
  body.scale.x = 0.72;
  mesh(group, new THREE.ConeGeometry(0.31, 0.95, 4), shared.dark, [0, 0, -0.18], [Math.PI / 2, 0, Math.PI / 4]);
  const wingGeo = createWingGeometry();
  mesh(group, wingGeo, shared.ceramic, [0.08, 0, -0.05]);
  mesh(group, wingGeo, shared.ceramic, [-0.08, 0, -0.05], [0, Math.PI, 0]);
  addCore(group, shared.cyan, 0.19, [0, 0, -0.32]);
  const engineRing = mesh(group, new THREE.TorusGeometry(0.28, 0.045, 6, 20), shared.cyan, [0, 0, -0.48]);
  markSpin(engineRing, 'z', 2.2);
  return finalize(group, 'player-lancer', 0.78);
}

export function createEnemyModel(type = 'seeker', elite = false) {
  const group = new THREE.Group();
  group.name = `enemy-${type}`;
  const coreMaterial = elite ? shared.violet : shared.coral;

  switch (type) {
    case 'lancer': {
      mesh(group, new THREE.OctahedronGeometry(0.48, 0), shared.enemy, [0, 0, 0], [0, 0, 0], [0.65, 0.65, 1.8]);
      mesh(group, new THREE.CylinderGeometry(0.07, 0.14, 1.25, 6), coreMaterial, [0, 0, 0.75], [Math.PI / 2, 0, 0]);
      addCore(group, coreMaterial, 0.16, [0, 0, -0.08]);
      break;
    }
    case 'warden': {
      mesh(group, new THREE.SphereGeometry(0.38, 10, 7), shared.enemy, [0, 0, -0.08]);
      const shield = mesh(group, new THREE.TorusGeometry(0.62, 0.14, 5, 18, Math.PI * 1.25), shared.enemy, [0, 0, 0.18], [0, 0, Math.PI * 0.875]);
      shield.scale.y = 1.15;
      mesh(group, new THREE.CircleGeometry(0.55, 18, -Math.PI * 0.625, Math.PI * 1.25), translucent(PALETTE.coral, 0.12), [0, 0, 0.12]);
      addCore(group, coreMaterial, 0.18, [0, 0, -0.34]);
      break;
    }
    case 'bloom': {
      addCore(group, coreMaterial, 0.17);
      for (let i = 0; i < 5; i += 1) {
        const a = i * Math.PI * 2 / 5;
        const petal = mesh(group, new THREE.ConeGeometry(0.18, 0.72, 4), shared.enemy, [Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0], [0, 0, -a + Math.PI / 2]);
        petal.userData.float = { offset: i, amount: 0.04 };
      }
      break;
    }
    case 'tether': {
      mesh(group, new THREE.TorusGeometry(0.31, 0.11, 6, 18), shared.enemy, [0, 0, 0]);
      for (const x of [-0.55, 0.55]) {
        mesh(group, new THREE.BoxGeometry(0.62, 0.16, 0.23), shared.enemy, [x, 0, 0], [0, 0, x > 0 ? -0.22 : 0.22]);
        mesh(group, new THREE.ConeGeometry(0.18, 0.45, 4), coreMaterial, [x * 1.45, 0, 0], [0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2]);
      }
      addCore(group, coreMaterial, 0.14);
      break;
    }
    case 'mirror': {
      for (const x of [-0.26, 0.26]) {
        const blade = mesh(group, new THREE.OctahedronGeometry(0.48, 0), x < 0 ? shared.ceramic : shared.enemy, [x, 0, 0], [0, 0, x * 0.8], [0.45, 1.25, 0.22]);
        blade.userData.float = { offset: x * 9, amount: 0.05 };
      }
      addCore(group, coreMaterial, 0.14, [0, 0, 0.16]);
      break;
    }
    case 'forge': {
      mesh(group, new THREE.BoxGeometry(1.05, 0.88, 0.76), shared.enemy);
      mesh(group, new THREE.BoxGeometry(0.72, 0.5, 0.12), shared.dark, [0, 0, 0.42]);
      for (const x of [-0.32, 0.32]) {
        const shutter = mesh(group, new THREE.BoxGeometry(0.08, 0.58, 0.16), coreMaterial, [x, 0, 0.5]);
        shutter.userData.float = { offset: x * 4, amount: 0.05 };
      }
      addCore(group, coreMaterial, 0.16, [0, 0, -0.44]);
      break;
    }
    case 'null': {
      mesh(group, new THREE.OctahedronGeometry(0.74, 0), shared.dark);
      mesh(group, new THREE.OctahedronGeometry(0.46, 0), shared.violet, [0, 0, 0], [0, Math.PI / 4, 0]);
      for (let i = 0; i < 3; i += 1) {
        const ring = mesh(group, new THREE.TorusGeometry(0.85 + i * 0.08, 0.025, 4, 24), shared.violet, [0, 0, 0], [i * Math.PI / 3, i * 0.7, 0]);
        markSpin(ring, i % 2 ? 'x' : 'y', 0.4 + i * 0.25);
      }
      break;
    }
    case 'seeker':
    default: {
      mesh(group, new THREE.SphereGeometry(0.42, 10, 7), shared.enemy);
      addCore(group, coreMaterial, 0.2, [0, 0, 0.37]);
      for (let i = 0; i < 3; i += 1) {
        const a = i * Math.PI * 2 / 3;
        mesh(group, new THREE.ConeGeometry(0.18, 0.68, 3), shared.enemy, [Math.cos(a) * 0.48, Math.sin(a) * 0.48, -0.1], [0, 0, -a + Math.PI / 2]);
      }
      break;
    }
  }

  if (elite && type !== 'null') {
    const halo = mesh(group, new THREE.TorusGeometry(0.82, 0.035, 4, 24), shared.violet);
    markSpin(halo, 'z', 0.8);
  }
  return finalize(group, `enemy-${type}`, type === 'forge' ? 0.75 : 0.62);
}

function addBrokenRing(parent, radius, material, rotation, speed, segments = 3) {
  const ringGroup = new THREE.Group();
  ringGroup.rotation.set(...rotation);
  for (let i = 0; i < segments; i += 1) {
    const arc = Math.PI * (0.36 + i * 0.08);
    const start = i * Math.PI * 2 / segments + i * 0.21;
    const part = mesh(ringGroup, new THREE.TorusGeometry(radius, 0.13 + radius * 0.025, 6, 24, arc), material);
    part.rotation.z = start;
  }
  markSpin(ringGroup, 'z', speed);
  parent.add(ringGroup);
  return ringGroup;
}

export function createBossModel(type = 'ringWarden') {
  const group = new THREE.Group();
  group.name = `boss-${type}`;

  if (type === 'tetraCrown') {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.slate, roughness: 0.44, metalness: 0.82, wireframe: true });
    frameMaterial.userData.owned = true;
    const frame = mesh(group, new THREE.TetrahedronGeometry(2.7, 0), frameMaterial);
    markSpin(frame, 'y', 0.22);
    const vertices = [[1.55, 1.55, 1.55], [-1.55, -1.55, 1.55], [-1.55, 1.55, -1.55], [1.55, -1.55, -1.55]];
    vertices.forEach((p, i) => {
      const turret = new THREE.Group();
      turret.position.set(...p);
      mesh(turret, new THREE.OctahedronGeometry(0.52, 0), shared.enemy);
      addCore(turret, i === 0 ? shared.violet : shared.coral, 0.18);
      group.add(turret);
    });
    addCore(group, shared.violet, 0.5);
    return finalize(group, 'boss-tetraCrown', 3.5);
  }

  if (type === 'vesperCore') {
    mesh(group, new THREE.IcosahedronGeometry(1.25, 2), shared.dark);
    addCore(group, shared.violet, 0.58);
    for (let i = 0; i < 6; i += 1) {
      addBrokenRing(group, 1.9 + i * 0.38, i % 2 ? shared.slate : shared.violet, [i * 0.31, i * 0.47, i * 0.17], (i % 2 ? -1 : 1) * (0.1 + i * 0.025), 2 + (i % 3));
    }
    for (let i = 0; i < 12; i += 1) {
      const a = i * Math.PI * 2 / 12;
      mesh(group, new THREE.BoxGeometry(0.45, 0.08, 0.7), shared.ceramic, [Math.cos(a) * 3.4, Math.sin(a) * 3.4, Math.sin(a * 3) * 0.5], [0, 0, a]);
    }
    return finalize(group, 'boss-vesperCore', 4.2);
  }

  addCore(group, shared.violet, 0.48);
  addBrokenRing(group, 1.55, shared.slate, [0.25, 0, 0], 0.25, 3);
  addBrokenRing(group, 2.25, shared.enemy, [0, 0.5, 0.25], -0.18, 4);
  addBrokenRing(group, 3.0, shared.slate, [0.45, 0.1, 0.7], 0.12, 3);
  for (let i = 0; i < 3; i += 1) {
    const a = i * Math.PI * 2 / 3;
    addCore(group, shared.coral, 0.24, [Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0]);
  }
  return finalize(group, 'boss-ringWarden', 3.6);
}

export function createAnchorNode(state = 'neutral') {
  const group = new THREE.Group();
  const color = state === 'danger' ? shared.amber : state === 'selected' ? shared.cyan : shared.blue;
  mesh(group, new THREE.SphereGeometry(0.12, 8, 6), color);
  const ring = mesh(group, new THREE.TorusGeometry(0.3, 0.035, 5, 20), color);
  markSpin(ring, 'z', state === 'selected' ? 1.8 : 0.65);
  const halo = mesh(group, new THREE.RingGeometry(0.34, 0.42, 24), translucent(state === 'danger' ? PALETTE.amber : PALETTE.blue, 0.2));
  halo.userData.pulse = { speed: 2.2, amount: 0.12 };
  return finalize(group, `anchor-${state}`, 0.45);
}

export function createPickup(type = 'fragment') {
  const group = new THREE.Group();
  const material = type === 'core' ? shared.violet : shared.amber;
  const geometry = type === 'core' ? new THREE.IcosahedronGeometry(0.28, 0) : new THREE.TetrahedronGeometry(0.24, 0);
  const item = mesh(group, geometry, material);
  markSpin(item, 'y', 1.4);
  const halo = mesh(group, new THREE.TorusGeometry(0.42, 0.025, 4, 20), material, [0, 0, 0], [Math.PI / 2, 0, 0]);
  markSpin(halo, 'z', -0.8);
  return finalize(group, `pickup-${type}`, 0.45);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStarField(seed = 7, count = 380, radius = 65) {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = radius * (0.65 + random() * 0.35);
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const light = 0.45 + random() * 0.5;
    colors.set([light * 0.72, light * 0.86, light], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.085, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
  material.userData.owned = true;
  const points = new THREE.Points(geometry, material);
  points.name = 'star-field';
  return points;
}

export function createArenaEnvironment(theme = 'rim', seed = 1, quality = 'high') {
  const group = new THREE.Group();
  group.name = `environment-${theme}`;
  const random = mulberry32(seed);
  const count = quality === 'low' ? 10 : quality === 'medium' ? 16 : 24;
  const baseMaterial = theme === 'core' ? shared.dark : shared.slate;
  const accentMaterial = theme === 'fracture' ? shared.amber : theme === 'core' ? shared.violet : shared.cyan;
  const geometry = theme === 'fracture' ? new THREE.DodecahedronGeometry(1, 0) : new THREE.BoxGeometry(1, 1, 1);
  const instances = new THREE.InstancedMesh(geometry, baseMaterial, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 9 + random() * 16;
    dummy.position.set(Math.cos(angle) * radius, (random() - 0.5) * 12, Math.sin(angle) * radius);
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    if (theme === 'fracture') dummy.scale.set(0.4 + random() * 1.8, 0.3 + random(), 0.8 + random() * 2.8);
    else dummy.scale.set(0.35 + random() * 1.2, 0.25 + random() * 0.8, 2 + random() * 6);
    dummy.updateMatrix();
    instances.setMatrixAt(i, dummy.matrix);
  }
  instances.receiveShadow = true;
  group.add(instances);

  const ringCount = quality === 'low' ? 2 : 4;
  for (let i = 0; i < ringCount; i += 1) {
    const radius = 7 + i * 3.4 + random() * 1.2;
    const ring = mesh(group, new THREE.TorusGeometry(radius, 0.09 + i * 0.03, 5, quality === 'low' ? 32 : 64, Math.PI * (1.15 + random() * 0.5)), i === ringCount - 1 ? accentMaterial : baseMaterial, [0, 0, -4 - i * 2], [random() * 0.7, random() * 0.7, random() * Math.PI]);
    ring.castShadow = false;
    ring.receiveShadow = false;
  }

  const lights = theme === 'core' ? 8 : 5;
  for (let i = 0; i < lights; i += 1) {
    const a = i * Math.PI * 2 / lights + random() * 0.2;
    const beacon = mesh(group, new THREE.BoxGeometry(0.08, 0.08, 0.65), accentMaterial, [Math.cos(a) * (8 + random() * 4), Math.sin(a) * (5 + random() * 4), -2 - random() * 8], [0, 0, a]);
    beacon.castShadow = false;
  }
  group.add(createStarField(seed + 31, quality === 'low' ? 180 : 360));
  return group;
}

export function createRouteLine(points, color = PALETTE.blue, opacity = 0.88) {
  const curvePoints = points.map((point) => point.isVector3 ? point.clone() : new THREE.Vector3(...point));
  const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthTest: false });
  material.userData.owned = true;
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 20;
  line.userData.transientMaterial = true;
  return line;
}

export function updateProceduralModel(root, time, delta = 0) {
  root.traverse((object) => {
    const spin = object.userData.spin;
    if (spin) object.rotation[spin.axis] += spin.speed * delta;
    const pulse = object.userData.pulse;
    if (pulse && object.userData.baseScale) {
      const scale = 1 + Math.sin(time * pulse.speed + (pulse.offset || 0)) * pulse.amount;
      object.scale.copy(object.userData.baseScale).multiplyScalar(scale);
    }
    const floating = object.userData.float;
    if (floating) object.position.z = (object.userData.basePositionZ || 0) + Math.sin(time * 1.4 + floating.offset) * floating.amount;
  });
}

export function disposeObject(root) {
  root.traverse((object) => {
    if (object.geometry && !object.isInstancedMesh) object.geometry.dispose();
    if ((object.userData.transientMaterial || object.material?.userData?.owned) && object.material) object.material.dispose();
  });
}

export { THREE };
