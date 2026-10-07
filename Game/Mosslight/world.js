// 苔灯の境 / MOSSLIGHT — 世界生成・地形の問い合わせ・到達性検証
// 依存: data.js のみ。状態(state)には依存せず、canPlace だけ state の構造を読み取る。
import {
  BALANCE, TILE, TERRAIN as T, TERRAIN_INFO, NODES, STRUCTURES, CAMP_LAYOUT, CAVE_LAYOUT, RUIN_TEMPLATE, WALL, layerOf,
  FOOTPRINTS, footEllipse, footCenter, nodeMirrored,
} from './data.js';

/* ------------------------------------------------------------------ 乱数・ノイズ */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 座標から決まる安定した乱数(0..1)。描画のバリエーションにも使う
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, seed, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ マップ */
function createMap(id, w, h) {
  return {
    id, w, h,
    terrain: new Uint8Array(w * h),
    variant: new Uint8Array(w * h),
    shade: new Uint8Array(w * h),
    deco: new Uint8Array(w * h),
    reserved: new Uint8Array(w * h),
    clearing: new Uint8Array(w * h),
    wallKind: new Uint8Array(w * h), // 地下の壁の種類(data.js の WALL)
    protect: new Uint8Array(w * h), // 1なら建築・採掘できない(遺跡・闘技場)
    nodes: [],
    nodeAt: new Int32Array(w * h).fill(-1),
    landmarks: {},
  };
}

export function inBounds(map, x, y) { return x >= 0 && y >= 0 && x < map.w && y < map.h; }

export function getTile(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return T.CLIFF;
  return map.terrain[y * map.w + x];
}

export function tileInfo(map, x, y) { return TERRAIN_INFO[getTile(map, x, y)]; }
export function isWalkable(map, x, y) { return !TERRAIN_INFO[getTile(map, x, y)].solid; }

export function nodeAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
  const i = map.nodeAt[y * map.w + x];
  return i >= 0 ? map.nodes[i] : null;
}

// ノードの衝突半径(0なら衝突しない)
export function solidRadius(node) {
  if (node.solidR != null) return node.solidR;
  const d = NODES[node.type];
  return d && d.solid ? d.solid.r : 0;
}

// ノードの足元の楕円 {x,y,rx,ry,mirrored}。描画・当たり・クリックが共有する(根元の中心 = アンカー + 反転済みの変位)。
// depleted=true は切り株などの伐採後(depletedSolid)。当たりが無ければ rx=0
export function nodeFootprint(node, depleted = false) {
  const d = NODES[node.type] || {};
  const solid = depleted ? d.depletedSolid : (node.solidR != null ? { r: node.solidR } : d.solid);
  const mirrored = nodeMirrored(node);
  const sprite = depleted && d.depletedSprite ? d.depletedSprite : node.sprite;
  const c = footCenter(sprite, mirrored, node.px, node.py);
  const f = FOOTPRINTS[String(sprite || '').replace(/_v\d+$/, '')];
  if (!solid || solid.r <= 0) return { x: c.x, y: c.y, rx: 0, ry: 0, mirrored };
  const e = footEllipse(solid);
  return { x: c.x, y: c.y, rx: f && f.rx != null ? f.rx : e.rx, ry: f && f.ry != null ? f.ry : e.ry, mirrored };
}

export function getMap(world, id) { return world.maps[id] || null; }

// 指定タイルに最も近い歩ける空きタイル(見つからなければnull)
export function findWalkableNear(map, x, y, maxR = 8) {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (!isWalkable(map, tx, ty)) continue;
        const n = nodeAt(map, tx, ty);
        if (n && solidRadius(n) > 0) continue;
        return { x: tx, y: ty };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ 見た目だけの飾り(当たり判定なし・セーブ非依存) */
// 地面の細部: detailsシート(oak_leaf など)の名前を返す。地形と周囲から決まる純粋関数なので、旧セーブでも新規世界でも同じ規則で出る。
// 道・野営地の予約地・畑・建物のマスには置かない(建物は呼び出し側で除外する)。細かい模様を全マスに撒かないよう、低周波の塊と低確率で絞る
// 置き場所は6x6マスの区画ごとに決める2〜5点の小群(区画内に収まる)。区画は確率で選び、中心もずらすので、等間隔の列にならない。
// 群の中身は同じ種類が中心で、一部だけ別の種類が混じる。置けるかどうか(地形・予約地など)は毎回マスごとに見る
const DETAIL_BLOCK = 6;
const DETAIL_SHAPE = [[0, 0], [1, 0], [-1, 1], [1, 1], [0, -1], [-1, -1], [2, 0], [0, 2]];
const DETAIL_CACHE = new WeakMap();
function detailBlock(map, bx, by) {
  let cache = DETAIL_CACHE.get(map);
  if (!cache) { cache = new Map(); DETAIL_CACHE.set(map, cache); }
  const key = by * 4096 + bx;
  let blk = cache.get(key);
  if (blk) return blk;
  blk = { pts: new Set(), pick: hash2(bx, by, 336) };
  if (hash2(bx, by, 330) < 0.55) {
    const cx = 1 + Math.floor(hash2(bx, by, 331) * 4), cy = 1 + Math.floor(hash2(bx, by, 332) * 4);
    const n = 2 + Math.floor(hash2(bx, by, 333) * 4), rot = Math.floor(hash2(bx, by, 334) * DETAIL_SHAPE.length);
    const mirror = hash2(bx, by, 335) > 0.5 ? -1 : 1;
    for (let k = 0; k < DETAIL_SHAPE.length && blk.pts.size < n; k++) {
      const [ox, oy] = DETAIL_SHAPE[(k + rot) % DETAIL_SHAPE.length];
      const x = Math.min(DETAIL_BLOCK - 1, Math.max(0, cx + ox * mirror)), y = Math.min(DETAIL_BLOCK - 1, Math.max(0, cy + oy));
      blk.pts.add((by * DETAIL_BLOCK + y) * 4096 + bx * DETAIL_BLOCK + x);
    }
  }
  cache.set(key, blk);
  return blk;
}

export function groundDetail(map, tx, ty) {
  if (tx < 2 || ty < 2 || tx >= map.w - 2 || ty >= map.h - 2) return null;
  const i = ty * map.w + tx;
  if (map.nodeAt[i] >= 0 || map.deco[i] || map.protect[i] || map.reserved[i] || map.clearing[i]) return null;
  const blk = detailBlock(map, Math.floor(tx / DETAIL_BLOCK), Math.floor(ty / DETAIL_BLOCK));
  if (!blk.pts.has(ty * 4096 + tx)) return null;
  const r = hash2(tx, ty, 301);
  const t = map.terrain[i];
  const own = hash2(tx, ty, 304);
  const pick = own < 0.3 ? own / 0.3 : blk.pick;
  const water = (x, y) => { const k = getTile(map, x, y); return k === T.SHALLOW || k === T.DEEP; };
  const land = (x, y) => { const k = getTile(map, x, y); return k === T.SAND || k === T.GRASS || k === T.DARKGRASS || k === T.DIRT; };
  const patch = valueNoise(tx * 0.2 + 13, ty * 0.2 + 7, 31) > 0.55;
  let name = null;
  if (t === T.GRASS || t === T.DARKGRASS) {
    if (!patch) return null;
    if (t === T.GRASS) name = pick < 0.6 ? 'oak_leaf' : 'drygrass';
    else name = pick < 0.55 ? 'oak_leaf' : pick < 0.85 ? 'moss_clump' : 'mushroom_small';
  } else if (t === T.DIRT) {
    if (r > 0.7) return null;
    name = 'soil_scuff';
  } else if (t === T.SAND) {
    const shore = water(tx - 1, ty) || water(tx + 1, ty) || water(tx, ty - 1) || water(tx, ty + 1);
    if (shore) name = pick < 0.45 ? 'reeds' : 'beachstones';
    else if (r < 0.5) name = 'beachstones';
  } else if (t === T.SHALLOW) {
    const shore = land(tx - 1, ty) || land(tx + 1, ty) || land(tx, ty - 1) || land(tx, ty + 1);
    if (shore) name = 'reeds';
    else if (patch && water(tx - 1, ty - 1) && water(tx + 1, ty - 1) && water(tx - 1, ty + 1) && water(tx + 1, ty + 1)) name = 'lilypad';
  } else if (t === T.MOSS) {
    name = pick < 0.4 ? 'moss_clump' : pick < 0.7 ? 'fern_small' : 'mushroom_small';
  } else if (t === T.MOSS_FLOOR) {
    if (patch && r < 0.5) name = pick < 0.7 ? 'moss_clump' : 'mushroom_small';
  } else if (t === T.CAVE_FLOOR) {
    if (r < 0.3) name = 'pebble';
  }
  if (!name) return null;
  return { name, dx: Math.round((hash2(tx, ty, 302) - 0.5) * 14), dy: Math.round((hash2(tx, ty, 303) - 0.5) * 8), flip: hash2(tx, ty, 305) > 0.5 };
}

// ボス闘技場の景色。2つの闘技場の見た目を分ける、有限・決定的な一覧(ワールド座標のpx, 足元基準)。
// landmarks と地形から毎回同じ結果を作るだけで、セーブには何も書かない。当たり判定・採掘・経路には関与しない。
// tall=trueは背の高い物(Y順に描く)、falseは地面に描く平たい物。縁の近くに置き、ボスの出現位置と中央の祭壇には寄せない
const ARENA_SCENERY = {
  moss: { flat: ['log_small', 'moss_clump', 'mushroom_small', 'fern_small', 'stump_small', 'moss_clump'], tall: ['big_mushroom'], tallEvery: 4 },
  ruin: { flat: ['beachstones', 'pebble', 'soil_scuff', 'beachstones'], tall: ['crystal_cluster', 'statue', 'grave'], tallEvery: 3 },
};
const SCENERY_CACHE = new WeakMap();
const SHORE_CACHE = new WeakMap();

export function shoreScenery(map) {
  if (!map || map.id !== 'surface') return [];
  if (SHORE_CACHE.has(map)) return SHORE_CACHE.get(map);
  const buckets = new Map();
  for (let y=2;y<map.h-2;y++) for(let x=2;x<map.w-2;x++) {
    const i=y*map.w+x;
    if (map.terrain[i] !== T.SAND || map.nodeAt[i]>=0 || map.reserved[i] || map.protect[i]) continue;
    const water=[[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy])=>[T.SHALLOW,T.DEEP].includes(getTile(map,x+dx,y+dy)));
    if (!water) continue;
    const bx=Math.floor(x/5),by=Math.floor(y/5),key=by*4096+bx;
    // 5タイルごとに一群を保証し、長い岸で装飾が全て欠落するのを避ける。
    const score=hash2(x,y,319), old=buckets.get(key);
    if(!old || score<old.score) buckets.set(key,{x,y,water,score});
  }
  const list=[];
  for(const {x,y,water} of buckets.values()) {
    const wx=(x+.5)*TILE,wy=(y+.5)*TILE;
    list.push({name:'reeds',x:wx+water[0]*12,y:wy+water[1]*12,tall:false});
    list.push({name:'log_small',x:wx-water[0]*15,y:wy-water[1]*12+8,tall:false,flip:hash2(x,y,320)>.5});
    list.push({name:'beachstones',x:wx-water[1]*18,y:wy+water[0]*14+8,tall:false});
  }
  SHORE_CACHE.set(map,list);
  return list;
}

export function arenaScenery(map) {
  if (!map || map.id !== 'underground' || !map.landmarks) return [];
  let list = SCENERY_CACHE.get(map);
  if (list) return list;
  list = [];
  const lm = map.landmarks;
  const arenas = [['moss', lm.mossArena, lm.bossSpawn && lm.bossSpawn.vine], ['ruin', lm.arena, lm.bossSpawn && lm.bossSpawn.ash]];
  for (const [kind, a, boss] of arenas) {
    if (!a) continue;
    const set = ARENA_SCENERY[kind], N = 14;
    let flatK = 0, tallK = 0;
    for (let k = 0; k < N; k++) {
      const ang = ((k + hash2(k, a.x, 311) * 0.6) / N) * Math.PI * 2;
      const rad = a.r - 0.9 - hash2(k, a.y, 312) * 0.9;
      const wx = (a.x + 0.5 + Math.cos(ang) * rad) * TILE, wy = (a.y + 0.5 + Math.sin(ang) * rad) * TILE;
      const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
      if (boss && Math.hypot(tx - boss.x, ty - boss.y) < 3.5) continue;
      if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) continue;
      if (TERRAIN_INFO[map.terrain[ty * map.w + tx]].solid) continue;
      const tall = k % set.tallEvery === set.tallEvery - 1;
      const name = tall ? set.tall[tallK++ % set.tall.length] : set.flat[flatK++ % set.flat.length];
      list.push({ name, x: Math.round(wx), y: Math.round(wy) + (tall ? 14 : 0), tall, flip: hash2(k, a.x, 313) > 0.5, kind });
    }
    // 縁の3つの連なり[角度, 個数]。長さも向きも揃えず、中央の戦闘空間(ボス出現位置の周り)は開ける。
    // 蔓: 縁から中央へ向かい、進むほど横へ流れる一続きの根。灰: 縁に沿って並ぶ壊れた石の床/壁の面。
    const chains = kind === 'moss' ? [[200, 5], [335, 4], [95, 3]] : [[210, 4], [325, 5], [95, 3]];
    for (const [deg, len] of chains) {
      const ang = deg * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang);
      for (let k = 0; k < len; k++) {
        let wx, wy;
        if (kind === 'moss') {
          const rad = a.r - 1 - k * 0.8, side = Math.sin(k * 1.3 + deg) * 0.45;
          if (rad < 2.5) break;
          wx = (a.x + 0.5 + ux * rad - uy * side) * TILE; wy = (a.y + 0.5 + uy * rad + ux * side) * TILE;
        } else {
          const t = ang + (k - (len - 1) / 2) * 0.2, rad = a.r - 1.2 - (k % 2) * 0.25;
          wx = (a.x + 0.5 + Math.cos(t) * rad) * TILE; wy = (a.y + 0.5 + Math.sin(t) * rad) * TILE;
        }
        const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
        if (boss && Math.hypot(tx - boss.x, ty - boss.y) < 3.5) continue;
        if (TERRAIN_INFO[getTile(map, tx, ty)].solid) continue;
        // 向きは中心側へ傾く向きで揃え、1つおきに反転して曲がりを作る
        list.push({ name: kind === 'moss' ? 'moss_roots' : 'ruin_fragment', x: Math.round(wx), y: Math.round(wy), tall: false, flip: (ux > 0) !== (k % 2 === 1), kind });
      }
      if (kind === 'ruin') list.push({ name: 'crystal_cluster', x: Math.round((a.x + 0.5 + ux * (a.r - 1.4)) * TILE + 22), y: Math.round((a.y + 0.5 + uy * (a.r - 1.4)) * TILE + 14), tall: true, flip: ux > 0, kind });
    }
  }
  SCENERY_CACHE.set(map, list);
  return list;
}

/* ------------------------------------------------------------------ 生成 */
const PLACEABLE = new Set([T.GRASS, T.DARKGRASS, T.DIRT, T.SAND, T.MOSS, T.ROCKY]);
const GROUND_TREE = new Set([T.GRASS, T.DARKGRASS]);
const NODE_TERRAIN = new Set([...PLACEABLE, T.CAVE_FLOOR, T.MOSS_FLOOR]);
const BUILD_TERRAIN = new Set([...PLACEABLE, T.PATH, T.FARM, T.CAVE_FLOOR, T.MOSS_FLOOR]);

function isSolidNode(node) { return solidRadius(node) > 0; }

function solidNeighbor(m, tx, ty) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const n = nodeAt(m, tx + dx, ty + dy);
      if (n && isSolidNode(n)) return true;
    }
  }
  return false;
}

// ノードを置く。置けなければnull
function addNode(m, type, tx, ty, o = {}) {
  if (!inBounds(m, tx, ty)) return null;
  const i = ty * m.w + tx;
  if (m.nodeAt[i] >= 0) return null;
  const def = NODES[type];
  if (!def) return null;
  const t = m.terrain[i];
  if (!o.border && !o.anyTerrain && !NODE_TERRAIN.has(t) && !(o.force && t === T.PATH)) return null;
  const margin = m.id === 'surface' ? 3 : 1;
  if (!o.border && (tx < margin || ty < margin || tx >= m.w - margin || ty >= m.h - margin)) return null;
  if (!o.force && m.reserved[i]) return null;
  if (!o.force && o.noClearing && m.clearing[i]) return null;
  const solid = o.solidR != null ? o.solidR > 0 : !!def.solid;
  if (solid && !o.noSpace && solidNeighbor(m, tx, ty)) return null;
  const jit = o.exact ? 0 : 1;
  const px = tx * TILE + 16 + (hash2(tx, ty, 11) - 0.5) * (def.solid ? 10 : 8) * jit;
  const py = (o.exact ? ty * TILE + 30 : ty * TILE + (def.solid ? 22 : 24)) + (hash2(tx, ty, 12) - 0.5) * 6 * jit;
  const node = {
    id: m.nodes.length, key: `${m.id}:${tx},${ty}`, type, tx, ty, px, py,
    sprite: o.sprite || def.sprite || (def.sprites ? def.sprites[Math.floor(hash2(tx, ty, 22) * 3)] : 'rock'),
    v: Math.floor(hash2(tx, ty, 13) * 4),
    flip: o.flip != null ? !!o.flip : hash2(tx, ty, 14) > 0.5,
  };
  if (o.solidR != null) node.solidR = o.solidR;
  if (o.info) node.info = o.info;
  if (o.name) node.name = o.name;
  if (o.meta) node.meta = o.meta;
  m.nodeAt[i] = node.id;
  m.nodes.push(node);
  return node;
}

function moveNode(m, node, tx, ty) {
  m.nodeAt[node.ty * m.w + node.tx] = -1;
  node.tx = tx; node.ty = ty;
  node.key = `${m.id}:${tx},${ty}`;
  node.px = tx * TILE + 16 + (hash2(tx, ty, 11) - 0.5) * 8;
  node.py = ty * TILE + 24 + (hash2(tx, ty, 12) - 0.5) * 6;
  m.nodeAt[ty * m.w + tx] = node.id;
}

function countWithin(m, type, cx, cy, r) {
  let n = 0;
  for (const nd of m.nodes) {
    if (nd.type !== type) continue;
    if (Math.hypot(nd.tx - cx, nd.ty - cy) <= r) n++;
  }
  return n;
}

// 範囲内に want 個そろうまで置く(足りなければ可能な限り)
function ensureCount(m, rng, type, want, cx, cy, r, o = {}) {
  let have = countWithin(m, type, cx, cy, r);
  let tries = 0;
  while (have < want && tries < 6000) {
    tries++;
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r;
    const tx = Math.round(cx + Math.cos(a) * d), ty = Math.round(cy + Math.sin(a) * d);
    if (o.filter && !o.filter(tx, ty)) continue;
    if (o.prefer && tries < 1500 && !o.prefer(tx, ty)) continue;
    if (addNode(m, type, tx, ty, o)) have++;
  }
  return have;
}

function nearSolid(m, tx, ty, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue;
      const n = nodeAt(m, tx + dx, ty + dy);
      if (n && isSolidNode(n)) return true;
    }
  }
  return false;
}

// A* (4近傍)。costFnはInfinityで通行不可
function astar(m, sx, sy, tx, ty, costFn) {
  const W = m.w, N = m.w * m.h;
  const g = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const hf = [], hi = [];
  const push = (f, i) => {
    let k = hf.length; hf.push(f); hi.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= hf[k]) break;
      [hf[p], hf[k]] = [hf[k], hf[p]]; [hi[p], hi[k]] = [hi[k], hi[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = hi[0], lf = hf.pop(), li = hi.pop();
    if (hf.length) {
      hf[0] = lf; hi[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let s = k;
        if (l < hf.length && hf[l] < hf[s]) s = l;
        if (r < hf.length && hf[r] < hf[s]) s = r;
        if (s === k) break;
        [hf[s], hf[k]] = [hf[k], hf[s]]; [hi[s], hi[k]] = [hi[k], hi[s]];
        k = s;
      }
    }
    return top;
  };
  const start = sy * W + sx, goal = ty * W + tx;
  g[start] = 0; push(0, start);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (hf.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.h) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const c = costFn(nx, ny);
      if (!isFinite(c)) continue;
      const ng = g[cur] + c;
      if (ng < g[ni]) {
        g[ni] = ng; prev[ni] = cur;
        push(ng + (Math.abs(nx - tx) + Math.abs(ny - ty)) * 0.5, ni);
      }
    }
  }
  if (!closed[goal]) return null;
  const path = [];
  for (let i = goal; i !== -1; i = prev[i]) path.push([i % W, (i / W) | 0]);
  return path.reverse();
}

function genSurface(seed) {
  const [W, H] = BALANCE.mapSize.surface;
  const m = createMap('surface', W, H);
  const rng = mulberry32(seed ^ 0x51ED2A);
  const ctr = CAMP_LAYOUT.center;
  const C = { x: ctr[0], y: ctr[1] };
  const lm = m.landmarks;
  lm.camp = C;
  lm.spawn = { x: C.x + CAMP_LAYOUT.spawn[0], y: C.y + CAMP_LAYOUT.spawn[1] };
  lm.forgeAltar = { x: C.x + CAMP_LAYOUT.forgeAltar[0], y: C.y + CAMP_LAYOUT.forgeAltar[1] };
  lm.tower = { x: C.x + CAMP_LAYOUT.tower[0], y: C.y + CAMP_LAYOUT.tower[1] };
  lm.lake = { x: CAMP_LAYOUT.lake.center[0], y: CAMP_LAYOUT.lake.center[1], r: CAMP_LAYOUT.lake.radius };
  lm.cave = { x: CAMP_LAYOUT.cave[0], y: CAMP_LAYOUT.cave[1] };
  lm.hollow = { x: CAMP_LAYOUT.hollow[0], y: CAMP_LAYOUT.hollow[1] };
  const L = lm.lake;
  const nz = (x, y, s, f) => valueNoise(x * f, y * f, seed + s);

  // 森の濃さ。野営地の周りは少し濃くして「森に囲まれた空き地」にする
  const forest = new Float32Array(W * H);
  const patch = new Float32Array(W * H); // 草の明暗パッチ(周期およそ9マスの低周波)。shade にも入れる
  const edgeDist = (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y);
  const bandWidth = (x, y) => 6 + nz(x, y, 15, 0.1) * 4; // 外周の密林帯(CLIFFの内側)の幅
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let f = fbm(x * 0.045 + 10, y * 0.045 + 30, seed, 4);
      const d = Math.hypot(x - C.x, (y - C.y) * 1.2);
      const u = (d - 9) / 7;
      if (u > 0 && u < 1) f += 0.2 * Math.sin(Math.PI * u);
      forest[y * W + x] = f;
      patch[y * W + x] = fbm(x * 0.1 + 77, y * 0.1 - 19, seed + 21, 2);
      m.shade[y * W + x] = Math.round(255 * patch[y * W + x]);
      m.variant[y * W + x] = Math.floor(hash2(x, y, seed) * 4);
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // 森の濃い所は暗い草、その中の空き地と森の縁は明るい草。草地にも暗い丈の高い塊を混ぜる
      let t = T.GRASS;
      if (forest[i] > 0.55) t = patch[i] > 0.68 && forest[i] < 0.64 ? T.GRASS : T.DARKGRASS;
      else if (forest[i] > 0.46 && patch[i] < 0.38) t = T.DARKGRASS;
      if (t === T.GRASS && edgeDist(x, y) <= bandWidth(x, y)) t = T.DARKGRASS;

      // 洞窟の入口まわりは岩場
      const dc = Math.hypot(x - lm.cave.x, y - lm.cave.y);
      const nc = nz(x, y, 5, 0.3);
      if (dc < 3.5 || dc < 10.5 + (nc - 0.5) * 6) t = T.ROCKY;
      else if (dc < 14 + (nc - 0.5) * 4 && hash2(x, y, 31) > 0.5) t = T.DIRT;

      // 苔の窪地
      const dh = Math.hypot(x - lm.hollow.x, y - lm.hollow.y);
      if (dh < 5.5 + (nz(x, y, 6, 0.3) - 0.5) * 5) t = T.MOSS;

      // 湖: 深水 → 浅瀬1 → 砂浜1〜2
      const dx = x - L.x, dy = (y - L.y) * 1.08;
      const dl = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const R = L.r + (valueNoise(Math.cos(ang) * 1.7 + 9.1, Math.sin(ang) * 1.7 + 3.3, seed + 7) - 0.5) * 6;
      if (dl < R - 1) t = T.DEEP;
      else if (dl < R) t = T.SHALLOW;
      else if (dl < R + 1 + (nz(x, y, 8, 0.35) > 0.5 ? 1 : 0)) t = T.SAND;

      // 野営地の空き地(楕円)と焚き火まわりの土
      const cx = x - C.x, cy = y - C.y;
      const e = (cx / 9) * (cx / 9) + (cy / 6.8) * (cy / 6.8);
      if (e < 1 + (nz(x, y, 4, 0.25) - 0.5) * 0.5) { t = T.GRASS; m.clearing[i] = 1; }
      // 土の広場は半径3.5x3の楕円をノイズで崩し、中心を踏み固めた道、外側を土にする
      const ed = (cx / 3.5) * (cx / 3.5) + (cy / 3.0) * (cy / 3.0);
      const edn = fbm(x * 0.55 + 40, y * 0.55 - 12, seed + 10, 2) - 0.5;
      if (ed < 1 + edn * 1.3) t = T.DIRT;
      if (ed < 0.3 + edn * 0.6) t = T.PATH;
      if (Math.hypot(cx, cy) < 2.4) m.reserved[i] = 1;

      // 外周3タイルは密林
      if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) t = T.CLIFF;
      m.terrain[i] = t;
    }
  }

  /* ---- 台地: 通れないCLIFFの塊。南面だけが段差の前面になる。道のA*より先に置いて避けさせる ---- */
  const plateau = new Uint8Array(W * H);
  const nearLandmark = (x, y, r) => [lm.tower, lm.forgeAltar, lm.cave, lm.hollow, lm.spawn].some((p) => Math.hypot(p.x - x, p.y - y) < r);
  // [中心x, 中心y, 半径x, 半径y]。1つ目はスタートの北に長い段差を作る(下端は y=63)
  for (const [px, py, rx, ry] of [[C.x + 2, 60, 7.5, 3.5], [70, 46, 6.5, 3.5], [20, 88, 5.5, 3], [56, 102, 5, 2.5]]) {
    for (let y = Math.floor(py - ry) - 1; y <= Math.ceil(py + ry) + 1; y++) {
      for (let x = Math.floor(px - rx) - 1; x <= Math.ceil(px + rx) + 1; x++) {
        if (x < 6 || y < 6 || x >= W - 6 || y >= H - 6) continue;
        const i = y * W + x, t = m.terrain[i];
        if ((t !== T.GRASS && t !== T.DARKGRASS && t !== T.MOSS) || m.clearing[i] || m.reserved[i] || nearLandmark(x, y, 4)) continue;
        const dx = Math.abs(x - px) / rx, dy = Math.abs(y - py) / ry;
        // 下端の行はノイズなしで平らに保ち、前面を途切れさせない
        const wob = y - py > ry - 1.2 ? 0 : (nz(x, y, 16, 0.3) - 0.5) * 0.5;
        if (dx ** 4 + dy ** 4 < 1 + wob) { plateau[i] = 1; m.terrain[i] = T.CLIFF; m.deco[i] = 0; }
      }
    }
  }
  // 南向きの前面(真南が台地でない台地タイル)と、その連続区間
  m.plateau = plateau;
  m.cliffFace = new Uint8Array(W * H);
  m.cliffFaces = [];
  for (let y = 0; y < H - 1; y++) {
    let run = null;
    for (let x = 0; x <= W; x++) {
      const i = y * W + x;
      const face = x < W && plateau[i] && m.terrain[i + W] !== T.CLIFF;
      if (face) { m.cliffFace[i] = 1; if (run) run.x1 = x; else run = { x0: x, x1: x, y }; }
      else if (run) { m.cliffFaces.push(run); run = null; }
    }
  }
  lm.escarpment = m.cliffFaces.filter((r) => r.x1 - r.x0 >= 5)
    .sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - lm.spawn.x, a.y - lm.spawn.y) - Math.hypot((b.x0 + b.x1) / 2 - lm.spawn.x, b.y - lm.spawn.y))[0] || null;

  /* ---- 土の道: 野営地 → 洞窟 / 苔の窪地 / 湖の西岸 ---- */
  const roadCost = (x, y) => {
    const t = m.terrain[y * W + x];
    if (t === T.DEEP || t === T.CLIFF) return Infinity;
    let c = 1 + valueNoise(x * 0.14, y * 0.14, seed + 9) * 3;
    if (t === T.SHALLOW) c += 8;
    else if (t === T.DARKGRASS) c += 0.9;
    else if (t === T.MOSS) c += 0.5;
    else if (t === T.PATH) c -= 0.85;
    return Math.max(0.3, c);
  };
  // A*の直角の折れ線を移動平均でなだらかな曲線にし、幅2〜3マスの円を並べて塗る。中心がPATH、外側の1マスがDIRT
  const stamp = (px, py, r) => {
    for (let y = Math.floor(py - r - 2); y <= Math.ceil(py + r + 2); y++) {
      for (let x = Math.floor(px - r - 2); x <= Math.ceil(px + r + 2); x++) {
        if (x < 4 || y < 4 || x >= W - 4 || y >= H - 4) continue;
        const i = y * W + x, t = m.terrain[i], d = Math.hypot(x - px, y - py);
        if (t === T.DEEP || t === T.CLIFF) continue;
        if (d < r) {
          if (t === T.SHALLOW && d >= 0.9) continue;
          m.terrain[i] = T.PATH;
          if (d < 0.9) m.reserved[i] = 1;
        } else if (d < r + 1.1 && (t === T.GRASS || t === T.DARKGRASS || t === T.MOSS)) m.terrain[i] = T.DIRT;
      }
    }
  };
  const carve = (path) => {
    if (!path) return;
    const n = path.length;
    for (const [x, y] of path) {
      const i = y * W + x;
      if (m.terrain[i] !== T.DEEP && m.terrain[i] !== T.CLIFF) { m.terrain[i] = T.PATH; m.reserved[i] = 1; }
    }
    for (let k = 0; k < n; k++) {
      let sx = 0, sy = 0;
      for (let d = -4; d <= 4; d++) { const j = Math.max(0, Math.min(n - 1, k + d)); sx += path[j][0]; sy += path[j][1]; }
      const px = sx / 9, py = sy / 9;
      stamp(px, py, 1.05 + valueNoise(px * 0.12, py * 0.12, seed + 41) * 0.45);
    }
  };
  carve(astar(m, C.x + 3, C.y + 1, lm.cave.x, lm.cave.y + 1, roadCost));
  carve(astar(m, C.x - 3, C.y - 1, lm.hollow.x, lm.hollow.y + 1, roadCost));
  let shore = L.x - L.r - 3;
  for (let x = L.x - 24; x < L.x; x++) { if (m.terrain[L.y * W + x] === T.SAND) { shore = x; break; } }
  carve(astar(m, C.x + 3, C.y + 2, shore, L.y, roadCost));
  // 目印まわりは道に埋もれないよう予約
  for (const p of [lm.tower, lm.forgeAltar, lm.cave]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m.reserved[(p.y + dy) * W + p.x + dx] = 1;
  }

  /* ---- 手組みの野営地 ---- */
  const at = (dx, dy) => [C.x + dx, C.y + dy];
  for (const d of CAMP_LAYOUT.decor) {
    const [x, y] = at(d.at[0], d.at[1]);
    addNode(m, 'decor', x, y, {
      force: true, exact: true, sprite: d.sprite, flip: d.flip, solidR: d.solid || 0, info: d.info, name: d.name,
      noSpace: true,
    });
  }
  addNode(m, 'tower', lm.tower.x, lm.tower.y, { force: true, exact: true, noSpace: true });
  addNode(m, 'forge_altar', lm.forgeAltar.x, lm.forgeAltar.y, { force: true, exact: true, noSpace: true });
  const rvs = CAVE_LAYOUT.returnVine.surface;
  lm.returnVine = { x: lm.forgeAltar.x + rvs[0], y: lm.forgeAltar.y + rvs[1] };
  m.reserved[lm.returnVine.y * W + lm.returnVine.x] = 1;
  addNode(m, 'return_vine', lm.returnVine.x, lm.returnVine.y, { force: true, exact: true, noSpace: true });
  addNode(m, 'cave_stairs', lm.cave.x, lm.cave.y, { force: true, exact: true, noSpace: true });
  m.terrain[lm.cave.y * W + lm.cave.x] = T.ROCKY;
  for (const [sprite, dx, dy] of CAMP_LAYOUT.trees) {
    const [x, y] = at(dx, dy);
    addNode(m, 'tree', x, y, { sprite, force: true });
  }

  /* ---- 森の木: 密度は森ノイズに従う ---- */
  const order = [];
  for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) order.push(y * W + x);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  const pickTree = (f, x, y) => {
    const r = hash2(x, y, 21);
    if ((f > 0.64 || edgeDist(x, y) <= bandWidth(x, y)) && r < 0.55) return 'pine';
    if (r > 0.965) return 'amber_tree';
    return r < 0.5 ? 'oak' : 'oak2';
  };
  for (const i of order) {
    const x = i % W, y = (i / W) | 0;
    if (!GROUND_TREE.has(m.terrain[i]) || m.clearing[i]) continue;
    const f = forest[i];
    let p = f > 0.55 ? 0.34 + (f - 0.55) * 2.2 : 0.011;
    if (edgeDist(x, y) <= bandWidth(x, y)) p = Math.max(p, 0.55); // 外周は木を詰める
    if (rng() < p) addNode(m, 'tree', x, y, { sprite: pickTree(f, x, y), noClearing: true });
  }
  ensureCount(m, rng, 'tree', 30, C.x, C.y, 18, {
    sprite: undefined, filter: (x, y) => !m.clearing[y * W + x] && GROUND_TREE.has(getTile(m, x, y)),
  });

  /* ---- 岩・銅・粘土 ---- */
  // 目立つ物(岩・茸・低木)は2〜5個の群れにし、群れの中心どうしは間を空ける。群れの中では向きを交互にする
  const clusters = [];
  const roomy = (x, y, gap) => clusters.every((c) => Math.hypot(c.x - x, c.y - y) >= gap);
  const sprout = (type, x, y, n, spread, gap) => {
    if (!roomy(x, y, gap)) return 0;
    let flip = rng() > 0.5;
    if (!addNode(m, type, x, y, { flip })) return 0;
    clusters.push({ x, y });
    let placed = 1;
    for (let tries = 0; placed < n && tries < 24; tries++) {
      const a = rng() * Math.PI * 2, d = 2 + rng() * (spread - 1);
      flip = !flip;
      if (addNode(m, type, Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), { flip })) placed++;
    }
    return placed;
  };
  const rockCluster = (x, y) => {
    const n = sprout('rock', x, y, 2 + Math.floor(rng() * 3), 3, 7);
    if (!n) return;
    for (let k = 0, extra = 1 + Math.floor(rng() * 2); k < extra; k++) {
      addNode(m, 'pebble', x + Math.round((rng() - 0.5) * 4), y + Math.round((rng() - 0.5) * 4), {});
    }
    const fx = x + (rng() > 0.5 ? 1 : -1), fy = y + 1, fi = fy * W + fx;
    if ((m.terrain[fi] === T.GRASS || m.terrain[fi] === T.DARKGRASS) && m.nodeAt[fi] < 0) m.deco[fi] = 4;
  };
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const i = y * W + x, t = m.terrain[i];
      if (m.clearing[i]) continue;
      let p = 0;
      if (t === T.ROCKY) p = 0.022;
      else if (t === T.MOSS) p = 0.012;
      else if (t === T.GRASS || t === T.DARKGRASS) p = nz(x, y, 12, 0.08) > 0.62 ? 0.0035 : 0.0005;
      if (p && rng() < p) rockCluster(x, y);
    }
  }
  // 野営地の近くにも岩の群れを数か所
  for (let tries = 0, made = 0; made < 4 && tries < 400; tries++) {
    const a = rng() * Math.PI * 2, d = 8 + rng() * 10;
    const x = Math.round(C.x + Math.cos(a) * d), y = Math.round(C.y + Math.sin(a) * d);
    if (!inBounds(m, x, y) || m.clearing[y * W + x] || !GROUND_TREE.has(m.terrain[y * W + x])) continue;
    const ci = y * W + x;
    if (roomy(x, y, 7) && m.nodeAt[ci] < 0 && !m.reserved[ci] && !solidNeighbor(m, x, y)) { rockCluster(x, y); made++; }
  }
  ensureCount(m, rng, 'rock', 10, C.x, C.y, 20, { filter: (x, y) => !m.clearing[y * W + x] || Math.hypot(x - C.x, y - C.y) > 5 });
  ensureCount(m, rng, 'copper_deposit', 12, lm.cave.x, lm.cave.y, 12, { filter: (x, y) => getTile(m, x, y) === T.ROCKY });
  ensureCount(m, rng, 'clay', 8, L.x - L.r - 2, L.y, 12, { filter: (x, y) => getTile(m, x, y) === T.SAND && x < L.x - 6 });
  // 花・木漏れ日のように岩に苔を。窪地の外縁に苔岩を数個
  for (const [dx, dy] of [CAMP_LAYOUT.starter.rock[0], CAMP_LAYOUT.starter.rock[1]].map((p) => [C.x + p[0], C.y + p[1]])) {
    addNode(m, 'rock', dx, dy, { force: true });
  }

  /* ---- 採集物: 手組み → 保証 → 森の散らし ---- */
  const S = CAMP_LAYOUT.starter;
  for (const type of ['branch', 'pebble', 'grass', 'berry', 'mushroom']) {
    for (const [dx, dy] of S[type]) addNode(m, type, C.x + dx, C.y + dy, { force: true });
  }
  const isLand = (x, y) => { const t = getTile(m, x, y); return t === T.GRASS || t === T.DARKGRASS || t === T.DIRT || t === T.MOSS; };
  ensureCount(m, rng, 'branch', 12, C.x, C.y, 10, { filter: isLand, prefer: (x, y) => nearSolid(m, x, y, 2) });
  ensureCount(m, rng, 'pebble', 12, C.x, C.y, 10, { filter: isLand, prefer: (x, y) => nearSolid(m, x, y, 3) || getTile(m, x, y) === T.DIRT });
  ensureCount(m, rng, 'grass', 20, C.x, C.y, 10, { filter: (x, y) => getTile(m, x, y) === T.GRASS });
  ensureCount(m, rng, 'berry', 8, C.x, C.y, 14, { filter: (x, y) => getTile(m, x, y) === T.GRASS || getTile(m, x, y) === T.DARKGRASS, prefer: (x, y) => nearSolid(m, x, y, 2) });
  ensureCount(m, rng, 'moss_potato', 6, C.x, C.y, 25, { filter: (x, y) => getTile(m, x, y) === T.DARKGRASS || getTile(m, x, y) === T.MOSS || getTile(m, x, y) === T.GRASS });
  ensureCount(m, rng, 'mushroom', 8, C.x, C.y, 25, { filter: (x, y) => getTile(m, x, y) === T.DARKGRASS || getTile(m, x, y) === T.MOSS });
  ensureCount(m, rng, 'glowmoss', 8, lm.hollow.x, lm.hollow.y, 6, { filter: (x, y) => getTile(m, x, y) === T.MOSS });

  // ワールド全体にもまばらに配置(取り尽くしても遠出すれば見つかる)
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const i = y * W + x, t = m.terrain[i];
      if (m.nodeAt[i] >= 0 || m.reserved[i] || m.clearing[i]) continue;
      const r = rng();
      if (t === T.GRASS) {
        const g = nz(x, y, 14, 0.1);
        if (r < (g > 0.55 ? 0.016 : 0.004)) addNode(m, 'grass', x, y, {});
        else if (r < 0.0205) addNode(m, 'berry', x, y, {});
        else if (r < 0.0235) addNode(m, 'pebble', x, y, {});
        else if (r < 0.0255) addNode(m, 'moss_potato', x, y, {});
      } else if (t === T.DARKGRASS) {
        if (r < 0.012 && nearSolid(m, x, y, 2)) addNode(m, 'branch', x, y, {});
        else if (r < 0.0165) { if (hash2(x, y, 81) < 0.18) sprout('mushroom', x, y, 2 + Math.floor(rng() * 3), 2, 6); }
        else if (r < 0.019) addNode(m, 'berry', x, y, {});
        else if (r < 0.0205) addNode(m, 'moss_potato', x, y, {});
      } else if (t === T.MOSS) {
        if (r < 0.05) { if (hash2(x, y, 82) < 0.3) sprout('mushroom', x, y, 2 + Math.floor(rng() * 3), 2, 6); }
        else if (r < 0.09) addNode(m, 'glowmoss', x, y, {});
      } else if (t === T.ROCKY) {
        if (r < 0.025) addNode(m, 'pebble', x, y, {});
      }
    }
  }

  /* ---- 外周の密林(見た目のみ。通行止めは地形で行う) ---- */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (m.terrain[y * W + x] !== T.CLIFF || plateau[y * W + x]) continue;
      addNode(m, 'border_pine', x, y, { border: true, force: true, sprite: hash2(x, y, 51) > 0.78 ? 'oak2' : 'pine', noSpace: true });
    }
  }
  // 外周の帯と濃い森の縁に、背景専用の樹冠(非固体)を重ねる。meta.depth: 0=手前の列(幹が見える) … 3=最奥(暗く)
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (m.terrain[i] !== T.DARKGRASS || m.nodeAt[i] >= 0 || m.reserved[i] || m.clearing[i]) continue;
      const e = edgeDist(x, y), bw = bandWidth(x, y);
      let p = 0, depth = 0;
      if (e <= bw) { p = 0.8; depth = Math.min(3, Math.floor((bw - e) / 2.3)); }
      else if (forest[i] > 0.62 && nearSolid(m, x, y, 1)) { p = 0.3; depth = 1; }
      if (!p || hash2(x, y, 71) > p) continue;
      const n = addNode(m, 'border_pine', x, y, {
        border: true, noSpace: true, sprite: depth === 0 ? (hash2(x, y, 72) > 0.5 ? 'oak' : 'oak2') : 'pine', meta: { canopy: true, depth },
      });
      if (n) { n.px += (hash2(x, y, 73) - 0.5) * 18; n.py += (hash2(x, y, 74) - 0.5) * 12; }
    }
  }

  /* ---- 草花など低密度の飾り(1=花 2=草むら 3=花の低木 4=シダ) ---- */
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const i = y * W + x, t = m.terrain[i];
      if (m.nodeAt[i] >= 0 || m.reserved[i]) continue;
      const r = hash2(x, y, 61);
      const meadow = fbm(x * 0.11 + 50, y * 0.11 + 5, seed + 1, 3);
      const nearCamp = Math.hypot(x - C.x, (y - C.y) * 1.3) < 11;
      if (t === T.GRASS) {
        if (meadow > 0.6 && r < 0.2) m.deco[i] = 1;
        else if (r < (nearCamp ? 0.05 : 0.03)) m.deco[i] = 2;
        else if (nearCamp && r > 0.985) m.deco[i] = 1;
      } else if (t === T.DARKGRASS) {
        if (r < 0.035) m.deco[i] = 4;
        else if (r > 0.985) m.deco[i] = 2;
      } else if (t === T.MOSS) {
        if (r < 0.16) m.deco[i] = 4;
      }
    }
  }

  // 花の低木(deco=3)は2〜4個の群れにし、そばにシダ(deco=4)を添える。ほかの群れとは間を空ける
  for (let y = 6; y < H - 6; y++) {
    for (let x = 6; x < W - 6; x++) {
      const i = y * W + x;
      if (m.terrain[i] !== T.GRASS || m.deco[i] || m.nodeAt[i] >= 0 || m.reserved[i] || m.clearing[i]) continue;
      if (fbm(x * 0.11 + 50, y * 0.11 + 5, seed + 1, 3) < 0.55 || hash2(x, y, 91) > 0.012 || !roomy(x, y, 7)) continue;
      clusters.push({ x, y });
      m.deco[i] = 3;
      for (let k = 0, want = 1 + Math.floor(hash2(x, y, 92) * 3); k < want; k++) {
        const bx = x + Math.round((hash2(x, y, 93 + k) - 0.5) * 6), by = y + Math.round((hash2(x, y, 96 + k) - 0.5) * 4);
        const bi = by * W + bx;
        if (bx < 4 || by < 4 || bx >= W - 4 || by >= H - 4) continue;
        if ((m.terrain[bi] === T.GRASS || m.terrain[bi] === T.DARKGRASS) && !m.deco[bi] && m.nodeAt[bi] < 0 && !m.reserved[bi] && Math.abs(bx - x) + Math.abs(by - y) > 1) m.deco[bi] = k === 0 ? 4 : 3;
      }
    }
  }

  relocateUnreachable(m);
  topUpGuarantees(m, rng);

  // 近い同種の小物は向きを交互にして、同じ向きが続かないようにする
  const FLIPPED = new Set(['rock', 'mushroom', 'pebble', 'grass', 'berry', 'branch', 'glowmoss', 'moss_potato', 'copper_deposit', 'clay']);
  for (const nd of m.nodes) {
    if (!FLIPPED.has(nd.type)) continue;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const o = nodeAt(m, nd.tx + dx, nd.ty + dy);
        if (o && o.id < nd.id && o.type === nd.type && o.flip === nd.flip) nd.flip = !nd.flip;
      }
    }
  }
  return m;
}

/* ------------------------------------------------------------------ 地下 */
const shuffle = (arr, rng) => {
  for (let k = arr.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [arr[k], arr[j]] = [arr[j], arr[k]];
  }
  return arr;
};

// 地下の壁を掘った後の床の種類
export function openedTerrain(map, x, y) {
  const k = map.wallKind[y * map.w + x];
  if (k === WALL.SEAL || k === WALL.GATE || k === WALL.RUIN) return T.RUIN;
  return x + y < CAVE_LAYOUT.layerSplit ? T.CAVE_FLOOR : T.MOSS_FLOOR;
}

// 壁を床にする(採掘・扉の開放)
export function openWallTile(map, x, y) {
  if (!inBounds(map, x, y)) return false;
  const i = y * map.w + x;
  if (!map.wallKind[i]) return false;
  map.terrain[i] = openedTerrain(map, x, y);
  map.wallKind[i] = WALL.NONE;
  map.rev = (map.rev || 0) + 1; // 地形が変わったことをrendererなどが検知できる
  return true;
}

// 構造物を置ける地形か(保存データの検証用)。遺跡・闘技場は不可
export function isBuildTerrain(map, x, y) {
  return inBounds(map, x, y) && !map.protect[y * map.w + x] && BUILD_TERRAIN.has(getTile(map, x, y));
}

// ゲーム開始時や読み込み時に、掘削・扉の開放で書き換えた地形を生成直後へ戻す
export function resetWorldTerrain(world) {
  const u = world.underground;
  if (u.baseTerrain) { u.terrain.set(u.baseTerrain); u.wallKind.set(u.baseWall); u.rev = (u.rev || 0) + 1; }
}

function genUnderground(seed) {
  const [W, H] = BALANCE.mapSize.underground;
  const m = createMap('underground', W, H);
  const rng = mulberry32(seed ^ 0x7A11CE);
  const CL = CAVE_LAYOUT, RT = RUIN_TEMPLATE;
  const I = (x, y) => y * W + x;
  const edgeAt = (x, y) => x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1;
  let cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells[I(x, y)] = rng() < 0.45 ? 1 : 0;
  for (let it = 0; it < 5; it++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          n += nx < 0 || ny < 0 || nx >= W || ny >= H ? 1 : cells[I(nx, ny)];
        }
        next[I(x, y)] = n >= 5 ? 1 : 0;
      }
    }
    cells = next;
  }
  const lane = new Uint8Array(W * H); // 主通路・ハブ・入口の部屋
  const carveBox = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!edgeAt(x, y)) { cells[I(x, y)] = 0; lane[I(x, y)] = 1; }
  };
  // 入口(10,10) → ハブ(24,24) → 祭壇(24,70) / 封印扉(56,44) へ幅3の主通路
  const road = (ax, ay, bx, by) => {
    carveBox(Math.min(ax, bx) - 1, ay - 1, Math.max(ax, bx) + 1, ay + 1);
    carveBox(bx - 1, Math.min(ay, by) - 1, bx + 1, Math.max(ay, by) + 1);
  };
  road(10, 10, 24, 10); road(24, 10, 24, 24); road(24, 24, 24, 70); road(24, 44, 56, 44);
  carveBox(7, 7, 13, 13); carveBox(20, 20, 28, 28);

  // 苔の祭壇の闘技場(円形・半径7)。建築も採掘もしない
  const ac = CL.mossArena;
  for (let y = ac.center[1] - 8; y <= ac.center[1] + 8; y++) {
    for (let x = ac.center[0] - 8; x <= ac.center[0] + 8; x++) {
      if (edgeAt(x, y) || Math.hypot(x - ac.center[0], y - ac.center[1]) > ac.radius + 0.5) continue;
      cells[I(x, y)] = 0; m.protect[I(x, y)] = 1;
    }
  }

  // 光苔結晶の小部屋: 床1マスを苔岩で囲む。入口側は苔岩1枚、ほかは2枚
  const block = new Uint8Array(W * H);
  for (const [cx, cy] of CL.crystalRooms) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy, i = I(x, y);
        if (edgeAt(x, y) || lane[i] || m.protect[i]) continue;
        cells[i] = 1; block[i] = 1;
      }
    }
    cells[I(cx, cy)] = 0; block[I(cx, cy)] = 0;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = I(x, y), upper = x + y < CL.layerSplit;
      const r = hash2(x, y, seed + 77);
      if (edgeAt(x, y)) m.terrain[i] = T.BEDROCK;
      else if (cells[i]) {
        m.terrain[i] = T.CAVE_WALL;
        m.wallKind[i] = block[i] ? WALL.MOSS : upper ? (r < 0.08 ? WALL.COPPER : WALL.DIRT) : (r < 0.05 ? WALL.IRON : WALL.MOSS);
      } else m.terrain[i] = upper ? T.CAVE_FLOOR : T.MOSS_FLOOR;
      m.variant[i] = Math.floor(hash2(x, y, seed) * 4);
      m.shade[i] = 128;
    }
  }

  /* ---- 遺跡: 壁は破壊できない。部屋・闘技場・扉 ---- */
  const [ox, oy] = RT.origin, [rw, rh] = RT.size;
  for (let y = oy; y < oy + rh && y < H - 1; y++) {
    for (let x = ox; x < ox + rw && x < W - 1; x++) {
      m.terrain[I(x, y)] = T.CAVE_WALL; m.wallKind[I(x, y)] = WALL.RUIN; m.protect[I(x, y)] = 1;
    }
  }
  const ruinFloor = (x, y) => {
    if (edgeAt(x, y)) return;
    m.terrain[I(x, y)] = T.RUIN; m.wallKind[I(x, y)] = WALL.NONE; m.protect[I(x, y)] = 1;
  };
  for (const [rx, ry, w, h] of RT.rooms) for (let y = ry; y < ry + h; y++) for (let x = rx; x < rx + w; x++) ruinFloor(x, y);
  const [ax, ay] = RT.arena.center;
  for (let y = ay - 8; y <= ay + 8; y++) for (let x = ax - 8; x <= ax + 8; x++) if (Math.hypot(x - ax, y - ay) <= RT.arena.radius + 0.5) ruinFloor(x, y);
  m.terrain[I(RT.seal[0], RT.seal[1])] = T.CAVE_WALL; m.wallKind[I(RT.seal[0], RT.seal[1])] = WALL.SEAL;
  for (const [gx, gy] of CL.arenaGate.tiles) { m.terrain[I(gx, gy)] = T.CAVE_WALL; m.wallKind[I(gx, gy)] = WALL.GATE; }

  const lm = {
    stairs: { x: CL.stairs[0], y: CL.stairs[1] }, hub: { x: CL.hub[0], y: CL.hub[1] },
    mossAltar: { x: CL.mossAltar[0], y: CL.mossAltar[1] }, seal: { x: RT.seal[0], y: RT.seal[1] },
    spawn: { x: CL.spawn[0], y: CL.spawn[1] },
    mossArena: { x: ac.center[0], y: ac.center[1], r: ac.radius },
    arena: { x: ax, y: ay, r: RT.arena.radius },
    lighthouse: { x: RT.beacon[0], y: RT.beacon[1] },
    gate: { x: CL.arenaGate.node[0], y: CL.arenaGate.node[1] },
    crystals: CL.crystalRooms.map(([x, y]) => ({ x, y })),
    dishes: RT.dishes.map(([x, y]) => ({ x, y })),
    bossSpawn: { vine: { x: CL.boss.vine[0], y: CL.boss.vine[1] }, ash: { x: CL.boss.ash[0], y: CL.boss.ash[1] } },
    returnVine: { x: CL.mossAltar[0] + CL.returnVine.underground[0], y: CL.mossAltar[1] + CL.returnVine.underground[1] },
  };
  m.landmarks = lm;

  /* ---- 採掘対象の保証: 到達できる床に接する銅鉱壁・翠鉄鉱壁 ---- */
  const reach = bfs(m, walkMask(m, 'none'), lm.spawn.x, lm.spawn.y);
  const adj = (x, y) => (reach[I(x - 1, y)] || reach[I(x + 1, y)] || reach[I(x, y - 1)] || reach[I(x, y + 1)]) === 1;
  const topUpWalls = (kind, from, want) => {
    let have = 0;
    const cand = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = I(x, y);
        if (!adj(x, y)) continue;
        if (m.wallKind[i] === kind) have++;
        else if (m.wallKind[i] === from && !block[i]) cand.push(i);
      }
    }
    shuffle(cand, rng);
    for (let k = 0; have < want && k < cand.length; k++, have++) m.wallKind[cand[k]] = kind;
  };
  topUpWalls(WALL.COPPER, WALL.DIRT, CL.guarantee.copperWalls + 6);
  topUpWalls(WALL.IRON, WALL.MOSS, CL.guarantee.ironWalls + 8);

  /* ---- 固定物 ---- */
  const fix = (type, p, o = {}) => addNode(m, type, p.x, p.y, { force: true, exact: true, noSpace: true, anyTerrain: true, ...o });
  fix('cave_exit', lm.stairs);
  fix('moss_altar', lm.mossAltar);
  fix('return_vine', lm.returnVine);
  fix('seal_door', lm.seal);
  fix('arena_gate', lm.gate);
  lm.dishes.forEach((p, k) => fix('dish', p, { meta: { dish: k } }));
  fix('lighthouse', lm.lighthouse);
  lm.crystals.forEach((p, k) => fix('crystal_node', p, { meta: { room: k } }));

  /* ---- 採集物: 光苔・キノコ・翠鉄の露頭 ---- */
  const floors = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = I(x, y);
      if (reach[i] && !lane[i] && !m.protect[i] && m.nodeAt[i] < 0) floors.push([x, y]);
    }
  }
  shuffle(floors, rng);
  const take = (type, count, pred, o = {}) => {
    let n = 0;
    for (const [x, y] of floors) {
      if (n >= count) break;
      if (pred && !pred(x, y)) continue;
      if (addNode(m, type, x, y, o)) n++;
    }
    return n;
  };
  const mossy = (x, y) => m.terrain[I(x, y)] === T.MOSS_FLOOR;
  take('iron_outcrop', CL.guarantee.outcrops, mossy);
  take('glowmoss', CL.guarantee.glowmoss, null);
  take('mushroom', CL.guarantee.mushroom, mossy);
  take('pebble', 14, (x, y) => m.terrain[I(x, y)] === T.CAVE_FLOOR);

  m.baseTerrain = m.terrain.slice();
  m.baseWall = m.wallKind.slice();
  return m;
}

/* ------------------------------------------------------------------ 到達性 */
function walkMask(m, nodesBlock) {
  const mask = new Uint8Array(m.w * m.h);
  for (let i = 0; i < mask.length; i++) {
    if (TERRAIN_INFO[m.terrain[i]].solid) continue;
    const ni = m.nodeAt[i];
    if (ni >= 0) {
      const nd = m.nodes[ni];
      const hard = solidRadius(nd) > 0;
      const removable = !!(NODES[nd.type] && NODES[nd.type].tool);
      if (hard && (nodesBlock === 'all' || (nodesBlock === 'fixed' && !removable))) continue;
    }
    mask[i] = 1;
  }
  return mask;
}

function bfs(m, mask, sx, sy) {
  const vis = new Uint8Array(m.w * m.h);
  const q = new Int32Array(m.w * m.h);
  let h = 0, t = 0;
  const s = sy * m.w + sx;
  if (!mask[s]) return vis;
  vis[s] = 1; q[t++] = s;
  while (h < t) {
    const cur = q[h++];
    const x = cur % m.w, y = (cur / m.w) | 0;
    if (x > 0 && mask[cur - 1] && !vis[cur - 1]) { vis[cur - 1] = 1; q[t++] = cur - 1; }
    if (x < m.w - 1 && mask[cur + 1] && !vis[cur + 1]) { vis[cur + 1] = 1; q[t++] = cur + 1; }
    if (y > 0 && mask[cur - m.w] && !vis[cur - m.w]) { vis[cur - m.w] = 1; q[t++] = cur - m.w; }
    if (y < m.h - 1 && mask[cur + m.w] && !vis[cur + m.w]) { vis[cur + m.w] = 1; q[t++] = cur + m.w; }
  }
  return vis;
}

function touches(m, vis, tx, ty) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (inBounds(m, x, y) && vis[y * m.w + x]) return true;
    }
  }
  return false;
}

const GATHER_TYPES = new Set(['branch', 'pebble', 'grass', 'berry', 'mushroom', 'glowmoss', 'moss_potato']);
const REMOVABLE_TYPES = new Set(['tree', 'rock', 'clay', 'copper_deposit']);

// 到達できない保証物を、到達可能な最寄りの空きタイルへ移す
function relocateUnreachable(m) {
  const sp = m.landmarks.spawn;
  const vis1 = bfs(m, walkMask(m, 'all'), sp.x, sp.y);
  const vis2 = bfs(m, walkMask(m, 'fixed'), sp.x, sp.y);
  for (const nd of m.nodes) {
    const gather = GATHER_TYPES.has(nd.type), removable = REMOVABLE_TYPES.has(nd.type);
    if (!gather && !removable) continue;
    if (touches(m, gather ? vis1 : vis2, nd.tx, nd.ty)) continue;
    let moved = false;
    for (let r = 1; r <= 14 && !moved; r++) {
      for (let dy = -r; dy <= r && !moved; dy++) {
        for (let dx = -r; dx <= r && !moved; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = nd.tx + dx, y = nd.ty + dy;
          if (!inBounds(m, x, y)) continue;
          const i = y * m.w + x;
          if (m.nodeAt[i] >= 0 || m.reserved[i] || !PLACEABLE.has(m.terrain[i]) || !vis1[i]) continue;
          if (!gather && solidNeighbor(m, x, y)) continue;
          moveNode(m, nd, x, y);
          moved = true;
        }
      }
    }
    if (!moved) nd.unreachable = true;
  }
}

const GUARANTEES = [
  ['branch', 12, 'camp', 10], ['pebble', 12, 'camp', 10], ['grass', 20, 'camp', 10], ['berry', 8, 'camp', 14],
  ['tree', 30, 'camp', 18], ['rock', 10, 'camp', 20], ['moss_potato', 6, 'camp', 25], ['mushroom', 8, 'camp', 25],
  ['clay', 8, 'lake', 30], ['copper_deposit', 12, 'cave', 12], ['glowmoss', 8, 'hollow', 6],
];

// 保証物が範囲内に足りなければ、到達できる適地へ補充する。relocateUnreachable で半径外へ動いた分もここで埋める
function guaranteeFilter(m, type) {
  const t = (x, y) => getTile(m, x, y);
  const L = m.landmarks.lake;
  switch (type) {
    case 'branch': case 'pebble': return (x, y) => [T.GRASS, T.DARKGRASS, T.DIRT, T.MOSS].includes(t(x, y));
    case 'grass': return (x, y) => t(x, y) === T.GRASS;
    case 'berry': return (x, y) => t(x, y) === T.GRASS || t(x, y) === T.DARKGRASS;
    case 'tree': return (x, y) => !m.clearing[y * m.w + x] && GROUND_TREE.has(t(x, y));
    case 'rock': return (x, y) => PLACEABLE.has(t(x, y)) && (!m.clearing[y * m.w + x] || Math.hypot(x - m.landmarks.camp.x, y - m.landmarks.camp.y) > 5);
    case 'moss_potato': return (x, y) => [T.GRASS, T.DARKGRASS, T.MOSS].includes(t(x, y));
    case 'mushroom': return (x, y) => t(x, y) === T.DARKGRASS || t(x, y) === T.MOSS;
    case 'clay': return (x, y) => t(x, y) === T.SAND && x < L.x - 6;
    case 'copper_deposit': return (x, y) => t(x, y) === T.ROCKY;
    case 'glowmoss': return (x, y) => t(x, y) === T.MOSS;
    default: return () => false;
  }
}

function topUpGuarantees(m, rng) {
  const sp = m.landmarks.spawn;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [type, want, where, r] of GUARANTEES) {
      const c = m.landmarks[where];
      let have = countWithin(m, type, c.x, c.y, r);
      if (have >= want) continue;
      const ok = guaranteeFilter(m, type);
      const cand = [];
      for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++) {
        for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
          if (inBounds(m, x, y) && Math.hypot(x - c.x, y - c.y) <= r && ok(x, y)) cand.push([x, y]);
        }
      }
      shuffle(cand, rng);
      const vis = bfs(m, walkMask(m, GATHER_TYPES.has(type) ? 'all' : 'fixed'), sp.x, sp.y);
      for (const [x, y] of cand) {
        if (have >= want) break;
        if (!touches(m, vis, x, y)) continue;
        if (addNode(m, type, x, y, {})) { have++; changed = true; }
      }
    }
    if (!changed) break;
    relocateUnreachable(m);
  }
}

export function verifyReachability(world) {
  const m = world.surface;
  const sp = m.landmarks.spawn;
  const vis1 = bfs(m, walkMask(m, 'all'), sp.x, sp.y);
  const vis2 = bfs(m, walkMask(m, 'fixed'), sp.x, sp.y);
  const unreachable = [];
  for (const nd of m.nodes) {
    const gather = GATHER_TYPES.has(nd.type), removable = REMOVABLE_TYPES.has(nd.type);
    if (!gather && !removable) continue;
    if (!touches(m, gather ? vis1 : vis2, nd.tx, nd.ty)) unreachable.push({ type: nd.type, x: nd.tx, y: nd.ty });
  }
  const guarantees = GUARANTEES.map(([type, want, where, r]) => {
    const c = m.landmarks[where];
    const have = countWithin(m, type, c.x, c.y, r);
    return { type, want, have, ok: have >= want };
  });
  // 主要地点へ歩いて行けるか(固定物のみ障害物)
  const sites = ['cave', 'hollow', 'forgeAltar', 'tower'].map((k) => {
    const p = m.landmarks[k];
    return { name: k, ok: touches(m, vis2, p.x, p.y) };
  });
  const surfaceOk = unreachable.length === 0 && guarantees.every((g) => g.ok) && sites.every((s) => s.ok);
  const underground = world.underground ? verifyUnderground(world.underground) : { ok: true, skipped: true };
  const ok = surfaceOk && underground.ok;
  return { ok, surfaceOk, spawn: sp, unreachable, guarantees, sites, underground };
}

// 地下の検証。掘削前の地形(baseTerrain)で判定する
function verifyUnderground(m) {
  const W = m.w, H = m.h, I = (x, y) => y * W + x, lm = m.landmarks;
  const terrain = m.baseTerrain || m.terrain, wall = m.baseWall || m.wallKind;
  const mask = (pass) => {
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) {
      if (!TERRAIN_INFO[terrain[i]].solid) { out[i] = 1; continue; }
      const k = wall[i];
      if (pass >= 1 && k >= WALL.DIRT && k <= WALL.IRON) out[i] = 1;
      if (pass >= 2 && (k === WALL.SEAL || k === WALL.GATE)) out[i] = 1;
    }
    return out;
  };
  const sp = lm.spawn;
  const walk = bfs(m, mask(0), sp.x, sp.y), dig = bfs(m, mask(1), sp.x, sp.y), all = bfs(m, mask(2), sp.x, sp.y);
  const adj = (x, y) => walk[I(x - 1, y)] || walk[I(x + 1, y)] || walk[I(x, y - 1)] || walk[I(x, y + 1)];
  let copperWalls = 0, ironWalls = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = wall[I(x, y)];
      if ((k === WALL.COPPER || k === WALL.IRON) && adj(x, y)) { if (k === WALL.COPPER) copperWalls++; else ironWalls++; }
    }
  }
  const nodesOf = (type) => m.nodes.filter((n) => n.type === type);
  const outcrops = nodesOf('iron_outcrop');
  const checks = [
    { name: 'stairs', ok: !!walk[I(sp.x, sp.y)] },
    { name: 'mossAltar', ok: touches(m, walk, lm.mossAltar.x, lm.mossAltar.y) },
    { name: 'sealApproach', ok: !!walk[I(lm.seal.x - 1, lm.seal.y)] },
    { name: 'copperWalls', ok: copperWalls >= CAVE_LAYOUT.guarantee.copperWalls, have: copperWalls, want: CAVE_LAYOUT.guarantee.copperWalls },
    { name: 'ironWalls', ok: ironWalls >= CAVE_LAYOUT.guarantee.ironWalls, have: ironWalls, want: CAVE_LAYOUT.guarantee.ironWalls },
    { name: 'outcrops', ok: outcrops.length >= CAVE_LAYOUT.guarantee.outcrops && outcrops.every((n) => touches(m, walk, n.tx, n.ty)), have: outcrops.length, want: CAVE_LAYOUT.guarantee.outcrops },
  ];
  const crystals = lm.crystals.map((p, k) => ({ room: k, x: p.x, y: p.y, ok: !!dig[I(p.x, p.y)] }));
  const spacing = lm.crystals.every((a, i) => lm.crystals.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= 15));
  const ruin = [...lm.dishes.map((p, k) => ({ name: `dish${k}`, ...p })), { name: 'arena', ...lm.arena }, { name: 'lighthouse', ...lm.lighthouse }]
    .map((p) => ({ name: p.name, ok: !!all[I(p.x, p.y)] }));
  // 銅のツルハシ(硬度2)なしで届く資源だけで銅のツルハシが作れること: 銅鉱壁は硬度1
  const copperAtStone = copperWalls >= 6;
  const ok = checks.every((c) => c.ok) && crystals.every((c) => c.ok) && spacing && ruin.every((r) => r.ok) && copperAtStone;
  return { ok, checks, crystals, crystalSpacing: spacing, ruin, copperAtStone, copperWalls, ironWalls, outcrops: outcrops.length };
}

/* ------------------------------------------------------------------ 公開: ワールド生成 */
export function createWorld(seed = BALANCE.seed) {
  const surface = genSurface(seed);
  const underground = genUnderground(seed);
  const world = { seed, genVersion: BALANCE.genVersion, surface, underground, maps: { surface, underground }, report: null };
  world.report = verifyReachability(world);
  const r = world.report;
  if (r.ok) console.info(`[Mosslight] 到達性 OK (地上ノード${surface.nodes.length}個・保証配置${r.guarantees.length}種、地下ノード${underground.nodes.length}個・銅壁${r.underground.copperWalls}・翠鉄壁${r.underground.ironWalls})`);
  else console.warn('[Mosslight] 到達性に問題があります', r);
  return world;
}

/* ------------------------------------------------------------------ 設置判定 */
// state は state.player / state.nodes / state.structIndex(物体) / state.floorIndex(床・道) / state.farmIndex を持つこと。
// 床(layer:'floor')と物体は別の層なので、床の上にベッドや灯りを置ける。戻り値は {ok, reason}
export function canPlace(state, type, map, x, y) {
  const def = STRUCTURES[type];
  if (!def) return { ok: false, reason: '置けないもの' };
  if (!inBounds(map, x, y)) return { ok: false, reason: 'ここには置けない' };
  const i = y * map.w + x;
  if (map.protect[i]) return { ok: false, reason: '遺跡と闘技場では建築できない' };
  const t = getTile(map, x, y);
  if (!BUILD_TERRAIN.has(t)) {
    return { ok: false, reason: TERRAIN_INFO[t].water ? '水の上には置けない' : 'ここには置けない' };
  }
  const p = state.player;
  const cx = x * TILE + 16, cy = y * TILE + 16;
  if (Math.hypot(p.x - cx, p.y - cy) > BALANCE.player.buildRange) return { ok: false, reason: '遠すぎる' };
  const nd = nodeAt(map, x, y);
  if (nd) {
    const ns = state.nodes.get(nd.key);
    const alive = !(ns && ns.respawnAt != null);
    if (alive) return { ok: false, reason: NODES[nd.type].decor || NODES[nd.type].landmark ? 'ここには置けない' : '何かがある' };
  }
  const farm = state.farmIndex && state.farmIndex[map.id];
  if (farm && farm.has(i)) return { ok: false, reason: '畑の上には置けない' };
  const layer = layerOf(type);
  const idx = layer === 'floor' ? state.floorIndex : state.structIndex;
  if (idx && idx[map.id] && idx[map.id].has(i)) return { ok: false, reason: layer === 'floor' ? 'すでに床がある' : 'すでに置かれている' };
  if (layer === 'object' && def.solid) {
    // 自分が立っている場所には置けない
    const px = Math.max(x * TILE, Math.min(p.x, x * TILE + TILE));
    const py = Math.max(y * TILE, Math.min(p.y, y * TILE + TILE));
    if (Math.hypot(p.x - px, p.y - py) < BALANCE.player.footRadius + 1) return { ok: false, reason: '自分が立っている' };
  }
  return { ok: true, reason: '' };
}
