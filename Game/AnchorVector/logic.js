import { BOSSES, DEPTHS, ENEMIES } from './data.js';

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SeededRandom {
  constructor(seed) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    if (!this.state) this.state = 0x9e3779b9;
  }

  next() {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  shuffle(list) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createRunSeed(mode, depth, date = new Date()) {
  if (mode === 'daily') return hashString(`anchor-vector-daily-${localDateKey(date)}`);
  return hashString(`${mode}-${depth}-${Date.now()}-${Math.random()}`);
}

export function generateRun(mode, depth, seed) {
  const random = new SeededRandom(seed);
  const safeDepth = Math.max(0, Math.min(12, depth | 0));
  const length = mode === 'bossRush' ? 3 : mode === 'endless' ? 999 : 7;
  const encounters = [];
  if (mode === 'bossRush') {
    ['ringWarden', 'tetraCrown', 'vesperCore'].forEach((bossId, index) => {
      encounters.push({ index, type: 'boss', bossId, theme: ['rim', 'fracture', 'core'][index], seed: random.state + index * 101 });
    });
  } else {
    for (let index = 0; index < Math.min(length, 7); index += 1) {
      const theme = index < 2 ? 'rim' : index < 5 ? 'fracture' : 'core';
      if (index === 6) {
        const bossId = safeDepth >= 8 ? 'vesperCore' : safeDepth >= 4 ? 'tetraCrown' : 'ringWarden';
        encounters.push({ index, type: 'boss', bossId, theme, seed: random.int(1, 0x7fffffff) });
      } else {
        let type = 'battle';
        if (index === 2 && random.next() < 0.42) type = 'repair';
        else if (index === 4 && random.next() < 0.48) type = 'archive';
        else if (index >= 3 && random.next() < 0.32) type = 'elite';
        encounters.push({ index, type, theme, seed: random.int(1, 0x7fffffff) });
      }
    }
  }
  return { mode, depth: safeDepth, seed, length, encounters };
}

export function generateEndlessEncounter(runSeed, index, baseDepth = 0) {
  const random = new SeededRandom(hashString(`${runSeed}-endless-${index}`));
  const effectiveDepth = Math.min(12, baseDepth + Math.floor(index / 3));
  const isBoss = index > 0 && (index + 1) % 5 === 0;
  return {
    index,
    type: isBoss ? 'boss' : random.next() < 0.3 ? 'elite' : 'battle',
    bossId: isBoss ? ['ringWarden', 'tetraCrown', 'vesperCore'][Math.floor(index / 5) % 3] : undefined,
    theme: ['rim', 'fracture', 'core'][Math.floor(index / 3) % 3],
    seed: random.state,
    effectiveDepth,
  };
}

export function generateArena(encounter, depth = 0) {
  const random = new SeededRandom(encounter.seed);
  const difficulty = DEPTHS[Math.max(0, Math.min(12, depth))];
  const nodeCount = encounter.type === 'boss' ? 10 : random.int(7, 10);
  const nodes = [];
  const radiusX = encounter.type === 'boss' ? 8.8 : 7.2 + random.next() * 1.5;
  const radiusY = encounter.type === 'boss' ? 5.8 : 4.5 + random.next();
  for (let i = 0; i < nodeCount; i += 1) {
    const angle = i * Math.PI * 2 / nodeCount + random.next() * 0.16;
    const factor = 0.78 + random.next() * 0.32;
    nodes.push({
      id: `anchor-${i}`,
      kind: 'anchor',
      position: [Math.cos(angle) * radiusX * factor, Math.sin(angle) * radiusY * factor, (random.next() - 0.5) * 2.2],
      locked: false,
    });
  }
  if (nodeCount >= 8) nodes.push({ id: 'anchor-center', kind: 'anchor', position: [(random.next() - 0.5) * 1.2, (random.next() - 0.5) * 0.8, -0.5], locked: false });

  if (encounter.type === 'boss') {
    return {
      nodes,
      enemies: [],
      boss: createBossData(encounter.bossId, depth),
      playerStart: nodes[Math.floor(nodeCount * 0.62)].position,
      theme: encounter.theme,
    };
  }

  const baseCount = 2 + Math.floor(encounter.index / 2) + difficulty.extraEnemies;
  const enemyCount = Math.min(8, baseCount + (encounter.type === 'elite' ? 1 : 0));
  const pool = enemyPool(depth, encounter.index, encounter.type);
  const enemies = [];
  const shuffledNodes = random.shuffle(nodes);
  for (let i = 0; i < enemyCount; i += 1) {
    const type = encounter.type === 'elite' && i === 0 ? 'null' : random.pick(pool);
    const definition = ENEMIES[type];
    const base = shuffledNodes[i % shuffledNodes.length].position;
    enemies.push({
      id: `enemy-${i}`,
      type,
      position: [base[0] * 0.68 + (random.next() - 0.5) * 1.6, base[1] * 0.68 + (random.next() - 0.5) * 1.2, base[2] + 0.35],
      hp: Math.ceil(definition.hp * difficulty.hpMultiplier * (encounter.type === 'elite' ? 1.15 : 1)),
      maxHp: Math.ceil(definition.hp * difficulty.hpMultiplier * (encounter.type === 'elite' ? 1.15 : 1)),
      cooldown: definition.cooldown / difficulty.attackMultiplier * (0.8 + random.next() * 0.35),
      reward: Math.round(definition.reward * (1 + depth * 0.08)),
      elite: type === 'null' || encounter.type === 'elite',
      radius: definition.radius,
      facing: random.next() * Math.PI * 2,
    });
  }
  return { nodes, enemies, boss: null, playerStart: nodes[0].position, theme: encounter.theme };
}

function enemyPool(depth, encounterIndex, encounterType) {
  const pool = ['seeker', 'seeker', 'lancer'];
  if (encounterIndex >= 1 || depth >= 1) pool.push('warden');
  if (encounterIndex >= 2 || depth >= 2) pool.push('bloom');
  if (encounterIndex >= 3 || depth >= 3) pool.push('tether');
  if (encounterIndex >= 4 || depth >= 5) pool.push('mirror');
  if (encounterIndex >= 5 || depth >= 7) pool.push('forge');
  if (depth >= 9 && encounterType !== 'elite') pool.push('null');
  return pool;
}

function createBossData(id, depth) {
  const definition = BOSSES[id];
  const difficulty = DEPTHS[Math.max(0, Math.min(12, depth))];
  return {
    id: `boss-${id}`,
    type: id,
    position: [0, 0.4, -1.2],
    hp: Math.ceil(definition.hp * difficulty.hpMultiplier),
    maxHp: Math.ceil(definition.hp * difficulty.hpMultiplier),
    reward: Math.round(definition.reward * (1 + depth * 0.1)),
    radius: definition.radius * 0.34,
    phases: definition.phases,
  };
}

export function distancePointToSegment(point, start, end) {
  const abx = end[0] - start[0];
  const aby = end[1] - start[1];
  const abz = end[2] - start[2];
  const apx = point[0] - start[0];
  const apy = point[1] - start[1];
  const apz = point[2] - start[2];
  const denominator = abx * abx + aby * aby + abz * abz;
  const t = denominator <= 1e-9 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / denominator));
  const dx = point[0] - (start[0] + abx * t);
  const dy = point[1] - (start[1] + aby * t);
  const dz = point[2] - (start[2] + abz * t);
  return Math.hypot(dx, dy, dz);
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  }
  return total;
}

export function polygonAreaXY(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return Math.abs(area) * 0.5;
}

export function pointInPolygonXY(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i][0]; const yi = polygon[i][1];
    const xj = polygon[j][0]; const yj = polygon[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1])) && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function chooseModuleCandidates(unlockedIds, owned, seed) {
  const random = new SeededRandom(seed);
  const eligible = unlockedIds.filter((id) => (owned[id] || 0) < 3);
  if (eligible.length <= 3) return random.shuffle(eligible);
  const weighted = random.shuffle(eligible);
  const missing = weighted.filter((id) => !owned[id]);
  const existing = weighted.filter((id) => owned[id]);
  const result = [];
  if (missing.length) result.push(missing[0]);
  while (result.length < 3 && existing.length) result.push(existing.shift());
  while (result.length < 3 && missing.length > 1) result.push(missing[result.length]);
  return result.slice(0, 3);
}

