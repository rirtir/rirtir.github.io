/* 残り火の深庭 / EMBERVEIL — ワールド生成・シミュレーション・保存・検証。
   DOM・描画・音を一切知らない（イベントログ経由でのみ外部へ通知する）。DESIGN.md §4〜§14、API.md 参照。 */
import { DATA } from './data.js';

const D = DATA;
const W = D.SIZE;
const N = W * W;
const B = D.BALANCE;
const PL = B.player;

const GID = Object.fromEntries(D.GROUND.map((g) => [g.key, g.id]));
const WID = Object.fromEntries(D.WALL.map((g) => [g.key, g.id]));
const BID = Object.fromEntries(D.BUILD.map((g) => [g.key, g.id]));
export const FLAG = { protected: 1, arena: 2, corridor: 4, hub: 8, noBuild: 16 };
const UNBREAK = new Set([WID.bedrock, WID.seal_stone, WID.gate_crystal, WID.gate_ember, WID.arena_barrier]);
const BASE_WALLS = new Set([WID.rock_wall, WID.hard_rock, WID.burnt_rock]);
const BIOME_AMBIENT = [0.1, D.BIOMES[1].ambient, D.BIOMES[2].ambient, D.BIOMES[3].ambient];
const DIR_VEC = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const TAU = Math.PI * 2;

/* ───────── 乱数・ハッシュ・ノイズ ───────── */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 値ノイズの fbm（3 オクターブ、おおよそ -1..1）。四則演算のみで環境差が出ない
function makeNoise(seed) {
  const s = seed | 0;
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), t = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    const top = a + (b - a) * u;
    return top + (c + (d - c) * u - top) * t;
  };
  return (x, y) => {
    let amp = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += amp * (v(x * f + o * 17.3, y * f + o * 9.1) * 2 - 1);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
}

export function sanitizeSeed(s) {
  let t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  if (t.length > 32) t = t.slice(0, 32);
  return t;
}

/* ───────── RLE / base64 ───────── */
function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let j = i + 1;
    while (j < arr.length && arr[j] === v && j - i < 16384) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

function rleDecode(rle, maxId) {
  if (!Array.isArray(rle) || rle.length % 2 !== 0 || rle.length > 32768) return null;
  const out = new Uint8Array(N);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const id = rle[i], n = rle[i + 1];
    if (!Number.isInteger(id) || id < 0 || id > maxId) return null;
    if (!Number.isInteger(n) || n < 1 || n > 16384 || p + n > N) return null;
    out.fill(id, p, p + n);
    p += n;
  }
  return p === N ? out : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bitsToB64(arr) {
  const bytes = new Uint8Array(2048);
  for (let i = 0; i < N; i++) if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + B64[((b & 15) << 2) | (c >> 6)] + B64[c & 63];
  }
  return s.slice(0, Math.ceil((2048 * 4) / 3)) + '='.repeat((3 - (2048 % 3)) % 3);
}
function b64ToBits(str) {
  if (typeof str !== 'string' || str.length !== 2732 || !/^[A-Za-z0-9+/]+={0,2}$/.test(str)) return null;
  const clean = str.replace(/=+$/, '');
  const bytes = new Uint8Array(2048);
  let acc = 0, nb = 0, p = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    nb += 6;
    if (nb >= 8) {
      nb -= 8;
      if (p < 2048) bytes[p++] = (acc >> nb) & 255;
      acc &= (1 << nb) - 1;
    }
  }
  if (p !== 2048) return null;
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

/* ───────── オブジェクト ───────── */
const OBJ = D.OBJECTS;
export function makeObject(type, x, y, extra) {
  const o = { type, x, y };
  switch (type) {
    case 'cap_tree': o.stump = false; o.regrowT = 0; break;
    case 'glowcap': case 'moss_grass': case 'rubble': case 'crystal_cluster':
    case 'wild_tuber': case 'wild_grain': case 'wild_pepper': o.spent = false; o.regrowT = 0; break;
    case 'sapling': o.growT = 0; break;
    case 'core': o.restored = false; break;
    case 'altar': o.boss = false; break;
    case 'satchel': o.items = []; break;
    case 'planter': o.crop = null; o.growT = 0; o.stage = 0; break;
    case 'chest': o.items = new Array(B.inventory.chestSlots).fill(null); o.starter = false; break;
    case 'torch': o.shrine = false; break;
    default: break;
  }
  return extra ? Object.assign(o, extra) : o;
}
const objBlocks = (o) => {
  const d = OBJ[o.type];
  return !!d && d.block && !o.stump && !o.spent;
};

/* ───────── World ───────── */
export class World {
  constructor() {
    this.width = W;
    this.height = W;
    this.ground = new Uint8Array(N);
    this.wall = new Uint8Array(N);
    this.build = new Uint8Array(N);
    this.biome = new Uint8Array(N);
    this.flags = new Uint8Array(N);
    this.explored = new Uint8Array(N);
    this.light = new Float32Array(N);
    this.safeLight = new Float32Array(N);
    this.lights = [];
    this.objects = new Map();
    this.wallDamage = new Map();
    this.anchors = null;
    this.chunkVersion = new Uint32Array(64);
    this.lightVersion = 0;
    this.exploredVersion = 0;
    this.boost = 0;
    this._lightByKey = new Map();
    this._vis = new Uint32Array(N);
    this._gen = 0;
    this._q = new Int32Array(N);
  }

  idx(x, y) { return y * W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < W; }
  groundAt(x, y) { return this.inBounds(x, y) ? this.ground[y * W + x] : 0; }
  wallAt(x, y) { return this.inBounds(x, y) ? this.wall[y * W + x] : WID.bedrock; }
  buildAt(x, y) { return this.inBounds(x, y) ? this.build[y * W + x] : 0; }
  biomeAt(x, y) { return this.inBounds(x, y) ? this.biome[y * W + x] : 0; }
  objectAt(x, y) { return this.inBounds(x, y) ? this.objects.get(y * W + x) || null : null; }
  lightAt(x, y) { return this.inBounds(x, y) ? this.light[y * W + x] : 0; }
  flagAt(x, y) { return this.inBounds(x, y) ? this.flags[y * W + x] : FLAG.protected; }

  isSolid(x, y) {
    if (!this.inBounds(x, y)) return true;
    const i = y * W + x;
    if (this.wall[i]) return true;
    const o = this.objects.get(i);
    if (o && objBlocks(o)) return true;
    return !(D.GROUND[this.ground[i]].walk || this.build[i] >= BID.bridge_wood);
  }

  isWalkable(x, y, flying = false) {
    if (!this.inBounds(x, y)) return false;
    const i = y * W + x;
    if (this.wall[i]) return false;
    const o = this.objects.get(i);
    if (o && objBlocks(o)) return false;
    const g = D.GROUND[this.ground[i]];
    if (g.walk || this.build[i] >= BID.bridge_wood) return true;
    return flying && !!g.liquid;
  }

  // 歩ける地面か（オブジェクトは無視）
  floorAt(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = y * W + x;
    return !this.wall[i] && (D.GROUND[this.ground[i]].walk || this.build[i] >= BID.bridge_wood);
  }

  dirty(x, y) {
    if (this.inBounds(x, y)) this.chunkVersion[(y >> 4) * 8 + (x >> 4)]++;
  }

  setGround(x, y, id) { this.ground[y * W + x] = id; this.dirty(x, y); }
  setBuild(x, y, id) { this.build[y * W + x] = id; this.dirty(x, y); }
  setWall(x, y, id) {
    const i = y * W + x;
    const before = this.wall[i];
    this.wall[i] = id;
    this.dirty(x, y);
    const gl = (k) => k === WID.wall_glass;
    const opaque = (k) => k !== 0 && !gl(k);
    if (opaque(before) !== opaque(id)) this.relightAround(x, y);
  }

  ambient(i) { return BIOME_AMBIENT[this.biome[i]] + this.boost; }

  /* 光 */
  _spread(L, bx0, by0, bx1, by1) {
    const cx = Math.floor(L.x), cy = Math.floor(L.y);
    if (!this.inBounds(cx, cy)) return;
    const g = ++this._gen, vis = this._vis, q = this._q, wall = this.wall;
    const light = this.light, safe = this.safeLight;
    let h = 0, t = 0;
    const start = cy * W + cx;
    q[t++] = start;
    vis[start] = g;
    while (h < t) {
      const i = q[h++];
      const x = i % W, y = (i / W) | 0;
      const dx = x + 0.5 - L.x, dy = y + 0.5 - L.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > L.r) continue;
      if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
        const v = L.s * Math.pow(1 - d / L.r, 1.4);
        light[i] += v;
        if (L.safe) safe[i] += v;
      }
      if (i !== start && wall[i] !== 0 && wall[i] !== WID.wall_glass) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
          const ni = ny * W + nx;
          if (vis[ni] === g) continue;
          vis[ni] = g;
          q[t++] = ni;
        }
      }
    }
  }

  relightBox(x0, y0, x1, y1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W - 1, x1); y1 = Math.min(W - 1, y1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        this.light[i] = this.ambient(i);
        this.safeLight[i] = 0;
      }
    }
    for (const L of this.lights) {
      if (L.x + L.r < x0 || L.x - L.r > x1 + 1 || L.y + L.r < y0 || L.y - L.r > y1 + 1) continue;
      this._spread(L, x0, y0, x1, y1);
    }
    const cap = B.light.max;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (this.light[i] > cap) this.light[i] = cap;
        if (this.safeLight[i] > cap) this.safeLight[i] = cap;
      }
    }
    this.lightVersion++;
  }

  recomputeAllLight() { this.relightBox(0, 0, W - 1, W - 1); }

  // (x,y) のタイルの透過性が変わったときに影響する光源の範囲だけを再計算する
  relightAround(x, y) {
    let x0 = x, y0 = y, x1 = x, y1 = y, any = false;
    for (const L of this.lights) {
      if (Math.abs(L.x - x - 0.5) > L.r + 1 || Math.abs(L.y - y - 0.5) > L.r + 1) continue;
      any = true;
      x0 = Math.min(x0, Math.floor(L.x - L.r)); x1 = Math.max(x1, Math.ceil(L.x + L.r));
      y0 = Math.min(y0, Math.floor(L.y - L.r)); y1 = Math.max(y1, Math.ceil(L.y + L.r));
    }
    if (any) this.relightBox(x0, y0, x1, y1);
  }

  _boxOf(L) {
    return [Math.floor(L.x - L.r) - 1, Math.floor(L.y - L.r) - 1, Math.ceil(L.x + L.r) + 1, Math.ceil(L.y + L.r) + 1];
  }

  addLightRaw(key, x, y, r, s, color, kind, safe) {
    const old = this._lightByKey.get(key);
    if (old) this.lights.splice(this.lights.indexOf(old), 1);
    const L = { x, y, r, s, color, kind, safe: !!safe, key };
    this.lights.push(L);
    this._lightByKey.set(key, L);
    return L;
  }
  addLight(key, x, y, r, s, color, kind, safe) {
    const old = this._lightByKey.get(key);
    const L = this.addLightRaw(key, x, y, r, s, color, kind, safe);
    const b = this._boxOf(L);
    if (old) { const ob = this._boxOf(old); b[0] = Math.min(b[0], ob[0]); b[1] = Math.min(b[1], ob[1]); b[2] = Math.max(b[2], ob[2]); b[3] = Math.max(b[3], ob[3]); }
    this.relightBox(...b);
  }
  removeLight(key) {
    const L = this._lightByKey.get(key);
    if (!L) return;
    this.lights.splice(this.lights.indexOf(L), 1);
    this._lightByKey.delete(key);
    this.relightBox(...this._boxOf(L));
  }
  hasLight(key) { return this._lightByKey.has(key); }

  // オブジェクトの光（状態に応じて点く・消える）。raw=true なら再計算しない
  syncObjectLight(o, raw = false) {
    const def = OBJ[o.type];
    if (!def || !def.light) return;
    const key = o.y * W + o.x;
    let on = true;
    if (o.spent || o.stump) on = false;
    if (def.light.onlyWhen === 'restored' && !o.restored) on = false;
    if (def.light.onlyWhen === 'boss' && !o.boss) on = false;
    if (o.type === 'planter') on = false;
    const has = this._lightByKey.has(key);
    if (on) {
      const cx = o.type === 'core' ? o.x + 1 : o.x + 0.5, cy = o.type === 'core' ? o.y + 1 : o.y + 0.5;
      const L = this._lightByKey.get(key);
      if (has && L.r === def.light.r && L.s === def.light.s) return;
      (raw ? this.addLightRaw : this.addLight).call(this, key, cx, cy, def.light.r, def.light.s, def.light.color, o.type, def.safe);
    } else if (has) {
      if (raw) { const L = this._lightByKey.get(key); this.lights.splice(this.lights.indexOf(L), 1); this._lightByKey.delete(key); }
      else this.removeLight(key);
    }
  }

  registerLavaLights() {
    for (let i = 0; i < N; i++) {
      if (this.ground[i] !== GID.lava) continue;
      const x = i % W, y = (i / W) | 0;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (this.inBounds(nx, ny) && this.ground[ny * W + nx] !== GID.lava) edge = true;
      }
      if (edge && !this._lightByKey.has(i)) this.addLightRaw(i, x + 0.5, y + 0.5, 3, 0.6, 'ember', 'lava', false);
    }
  }

  // 保存・復元後の光の全再構築
  rebuildLights() {
    this.lights.length = 0;
    this._lightByKey.clear();
    this.registerLavaLights();
    for (const [i, o] of this.objects) if (o.type !== 'core' || i === o.y * W + o.x) this.syncObjectLight(o, true);
    this.recomputeAllLight();
  }

  setObject(o) {
    if (o.type === 'core') {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.objects.set((o.y + dy) * W + o.x + dx, o);
    } else this.objects.set(o.y * W + o.x, o);
    this.dirty(o.x, o.y);
  }
  deleteObject(o) {
    if (o.type === 'core') {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) this.objects.delete((o.y + dy) * W + o.x + dx);
    } else this.objects.delete(o.y * W + o.x);
    this.dirty(o.x, o.y);
  }
}

/* ───────── ワールド生成 ───────── */
function astar(sx, sy, gx, gy, passable, cost) {
  const start = sy * W + sx, goal = gy * W + gx;
  const g = new Float32Array(N).fill(Infinity);
  const par = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const hI = [], hF = [];
  const push = (i, f) => {
    let c = hI.length;
    hI.push(i); hF.push(f);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hF[p] < hF[c] || (hF[p] === hF[c] && hI[p] <= hI[c])) break;
      [hI[p], hI[c]] = [hI[c], hI[p]]; [hF[p], hF[c]] = [hF[c], hF[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = hI[0];
    const li = hI.pop(), lf = hF.pop();
    if (hI.length) {
      hI[0] = li; hF[0] = lf;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < hI.length && (hF[l] < hF[m] || (hF[l] === hF[m] && hI[l] < hI[m]))) m = l;
        if (r < hI.length && (hF[r] < hF[m] || (hF[r] === hF[m] && hI[r] < hI[m]))) m = r;
        if (m === c) break;
        [hI[m], hI[c]] = [hI[c], hI[m]]; [hF[m], hF[c]] = [hF[c], hF[m]];
        c = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(start, Math.abs(sx - gx) + Math.abs(sy - gy));
  while (hI.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= W - 1) continue;
      const ni = ny * W + nx;
      if (closed[ni] || (ni !== goal && !passable(ni))) continue;
      const ng = g[i] + cost(ni);
      if (ng < g[ni]) {
        g[ni] = ng;
        par[ni] = i;
        push(ni, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
      }
    }
  }
  if (!closed[goal]) return null;
  const path = [];
  for (let c = goal; c !== -1; c = par[c]) path.push(c);
  return path.reverse();
}

const ZB_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// 0-1 BFS。tier 以下の硬度の壁は掘れる（コスト0）、橋を架けられる液体はコスト1、門は開いているとみなす
function zeroOneBfs(w, sx, sy, gx, gy, tier) {
  const dist = new Int16Array(N).fill(9999);
  const dq = new Int32Array(N * 4);
  let head = N * 2, tail = N * 2;
  const s = sy * W + sx, goal = gy * W + gx;
  dist[s] = 0;
  dq[tail++] = s;
  const enter = (i) => {
    const wl = w.wall[i];
    if (wl) {
      if (wl === WID.gate_crystal || wl === WID.gate_ember) return 0;
      const d = D.WALL[wl];
      return d.hardness < 99 && d.hardness <= tier ? 0 : -1;
    }
    const g = D.GROUND[w.ground[i]];
    if (g.walk || w.build[i] >= BID.bridge_wood) return 0;
    return g.liquid ? 1 : -1;
  };
  while (head < tail) {
    const i = dq[head++];
    if (i === goal) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of ZB_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const ni = ny * W + nx;
      const c = enter(ni);
      if (c < 0) continue;
      const nd = dist[i] + c;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        if (c === 0) dq[--head] = ni; else dq[tail++] = ni;
      }
    }
  }
  return dist[goal] >= 9999 ? -1 : dist[goal];
}

export function generateWorld(seedStr) {
  const seed = sanitizeSeed(seedStr) || 'HEARTH';
  const w = new World();
  const seedInt = hashSeed(seed + ':' + D.GEN_VERSION);
  const rngFor = (tag) => mulberry32(hashSeed(seed + ':' + tag));
  const nz = (tag) => makeNoise(hashSeed(seed + ':n:' + tag));
  const report = { seed, genVersion: D.GEN_VERSION, repaired: [], guarantees: {}, segments: {}, bridgesNeeded: {}, failed: [] };
  const sqrt = Math.sqrt;
  const X = (i) => i % W;
  const Y = (i) => (i / W) | 0;
  const dist = (i, cx, cy) => { const dx = X(i) - cx, dy = Y(i) - cy; return sqrt(dx * dx + dy * dy); };
  const baseWall = (b) => (b === 2 ? WID.hard_rock : b === 3 ? WID.burnt_rock : WID.rock_wall);
  const baseFloor = (b) => (b === 2 ? GID.crystal_floor : b === 3 ? GID.ash_floor : GID.moss_floor);
  const homeBiome = new Uint8Array(N); // 境界処理前の生バイオーム（床の種類の復元用）

  /* 1. アンカー（アリーナ位置） */
  const ra = rngFor('anchor');
  const sym = (n) => Math.floor(ra() * (2 * n + 1)) - n;
  const mkArena = (cx, cy) => {
    const dx = 64 - cx, dy = 64 - cy;
    let dir;
    if (Math.abs(dy) >= Math.abs(dx)) dir = dy > 0 ? 'S' : 'N'; else dir = dx > 0 ? 'E' : 'W';
    const v = DIR_VEC[dir];
    return { cx, cy, x0: cx - 7, y0: cy - 7, x1: cx + 7, y1: cy + 7,
      door: { x: cx + v[0] * 7, y: cy + v[1] * 7, dir }, outer: { x: cx + v[0] * 8, y: cy + v[1] * 8 } };
  };
  const mossN = ra() < 0.5;
  const mossJx = sym(8);
  const crN = ra() < 0.5;
  const crJx = sym(3), crJy = sym(3);
  const emN = ra() < 0.5;
  const emJx = sym(3), emJy = sym(3);
  const anchors = {
    hub: { x: 64, y: 64 }, start: { x: 64, y: 66 },
    arenas: {
      moss: mkArena(64 + mossJx, mossN ? 40 : 88),
      crystal: mkArena(18 + crJx, (crN ? 22 : 106) + crJy),
      ember: mkArena(110 + emJx, (emN ? 22 : 106) + emJy),
    },
    gates: { crystal: { tiles: [] }, ember: { tiles: [] } },
    obstacles: { chasm: [], lava: null },
  };
  w.anchors = anchors;
  const gateJ = { crystal: ra(), ember: ra() };

  /* 2. バイオーム */
  const bn = nz('biome');
  const forced = [
    [56, 56, 72, 72, 1],
    [anchors.arenas.moss.x0, anchors.arenas.moss.y0, anchors.arenas.moss.x1, anchors.arenas.moss.y1, 1],
    [anchors.arenas.crystal.x0, anchors.arenas.crystal.y0, anchors.arenas.crystal.x1, anchors.arenas.crystal.y1, 2],
    [anchors.arenas.ember.x0, anchors.arenas.ember.y0, anchors.arenas.ember.x1, anchors.arenas.ember.y1, 3],
  ];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = bn(x / 24, y / 24);
      const dx = x - 64, dy = y - 64;
      const d = sqrt(dx * dx + dy * dy) + n * 5;
      let b = d < 34 ? 1 : x + n * 3 < 64 ? 2 : 3;
      for (const [x0, y0, x1, y1, fb] of forced) if (x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2) b = fb;
      homeBiome[y * W + x] = b;
      w.biome[y * W + x] = b;
    }
  }

  /* 3. 基本地形と洞窟 */
  const cn = nz('cave');
  const thr = [0, -0.05, 0.0, -0.02];
  let open = new Uint8Array(N);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    open[i] = x >= 3 && y >= 3 && x < W - 3 && y < W - 3 && cn(x / 10, y / 10) > thr[w.biome[i]] ? 1 : 0;
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(N);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x < 3 || y < 3 || x >= W - 3 || y >= W - 3) { next[i] = 0; continue; }
      let walls = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W || !open[ny * W + nx]) walls++;
      }
      next[i] = walls >= 5 ? 0 : walls <= 3 ? 1 : open[i];
    }
    open = next;
  }
  const ln = nz('loam');
  for (let i = 0; i < N; i++) {
    const b = w.biome[i];
    w.ground[i] = baseFloor(b);
    w.wall[i] = open[i] ? 0 : baseWall(b);
  }
  for (let y = 3; y < W - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x;
    if (w.biome[i] !== 1 || !w.wall[i]) continue;
    const exposed = open[i - 1] || open[i + 1] || open[i - W] || open[i + W];
    if (exposed && ln(x / 6 + 31, y / 6 + 7) > 0.3) { w.wall[i] = WID.loam_wall; w.ground[i] = GID.loam_floor; }
  }

  /* 4. バイオーム境界・外周 */
  const seal = new Uint8Array(N);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const b = homeBiome[y * W + x];
    let diff = false;
    for (let oy = -1; oy <= 1 && !diff; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < W && homeBiome[ny * W + nx] !== b) { diff = true; break; }
    }
    if (diff) seal[y * W + x] = 1;
  }
  for (let i = 0; i < N; i++) if (seal[i]) { w.wall[i] = WID.seal_stone; w.biome[i] = 0; }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (x < 3 || y < 3 || x >= W - 3 || y >= W - 3) { const i = y * W + x; w.wall[i] = WID.bedrock; w.biome[i] = 0; }
  }

  /* 5. 封印門 */
  const placeGate = (name, wallId, dirX, jr) => {
    const j = Math.floor(jr * 13) - 6;
    const order = [0];
    for (let k = 1; k <= 12; k++) order.push(k, -k);
    const jOrder = [j, ...order.map((o) => j + o)].filter((jj) => Math.abs(jj) <= 6);
    for (const jj of jOrder.length ? jOrder : [0]) {
      const gy = 64 + jj;
      let hit = -1;
      for (let x = dirX < 0 ? 55 : 73; x > 3 && x < W - 4; x += dirX) {
        if (w.wall[gy * W + x] === WID.seal_stone) { hit = x; break; }
      }
      if (hit < 0) continue;
      const tiles = [];
      let lo = hit, hi = hit;
      for (let r = gy - 1; r <= gy + 1; r++) {
        let sx = -1;
        for (let k = 0; k <= 4 && sx < 0; k++) {
          for (const sgn of [1, -1]) {
            const x = hit + k * sgn;
            if (x > 3 && x < W - 4 && w.wall[r * W + x] === WID.seal_stone) { sx = x; break; }
          }
        }
        if (sx < 0) continue;
        let a = sx, b = sx;
        while (w.wall[r * W + a - 1] === WID.seal_stone) a--;
        while (w.wall[r * W + b + 1] === WID.seal_stone) b++;
        for (let x = a; x <= b; x++) tiles.push({ x, y: r });
        if (r === gy) { lo = a; hi = b; }
      }
      for (const t of tiles) { w.wall[t.y * W + t.x] = wallId; w.flags[t.y * W + t.x] |= FLAG.noBuild; }
      anchors.gates[name] = { tiles, y: gy, outer: { x: dirX < 0 ? hi + 1 : lo - 1, y: gy }, inner: { x: dirX < 0 ? lo - 1 : hi + 1, y: gy } };
      return true;
    }
    return false;
  };
  if (!placeGate('crystal', WID.gate_crystal, -1, gateJ.crystal)) report.failed.push('gate:crystal');
  if (!placeGate('ember', WID.gate_ember, 1, gateJ.ember)) report.failed.push('gate:ember');

  /* 6. スタンプ */
  const S = D.SHRINE_STAMP;
  const protectedShrine = new Set();
  for (let y = 62; y <= 65; y++) for (let x = 62; x <= 65; x++) protectedShrine.add(y * W + x);
  protectedShrine.add(66 * W + 64);
  const stampObjects = [];
  for (let r = 0; r < S.size; r++) {
    for (let c = 0; c < S.size; c++) {
      const ch = S.rows[r][c];
      const x = S.x0 + c, y = S.y0 + r, i = y * W + x;
      w.flags[i] |= FLAG.hub;
      w.biome[i] = 1;
      w.wall[i] = 0;
      w.ground[i] = ch === '.' || ch === 't' || ch === 'S' || ch === 'C' || ch === 'c' ? GID.shrine_floor : ch === 'w' ? GID.water : GID.moss_floor;
      if (ch === '#') w.wall[i] = WID.rock_wall;
      else if (ch === 'o') w.wall[i] = WID.copper_vein;
      else if (ch === 'k') w.wall[i] = WID.coal_vein;
      else if (ch === 'T') stampObjects.push(makeObject('cap_tree', x, y));
      else if (ch === 'g') stampObjects.push(makeObject('glowcap', x, y));
      else if (ch === 'f') stampObjects.push(makeObject('moss_grass', x, y));
      else if (ch === 'R') { stampObjects.push(makeObject('rubble', x, y)); protectedShrine.add(i); }
      else if (ch === 'u') stampObjects.push(makeObject('wild_tuber', x, y));
      else if (ch === 't') { stampObjects.push(makeObject('torch', x, y, { shrine: true })); protectedShrine.add(i); }
      else if (ch === 'S') {
        const chest = makeObject('chest', x, y, { starter: true });
        S.chest.items.forEach((it, k) => { chest.items[k] = { id: it.id, n: it.n }; });
        stampObjects.push(chest);
      } else if (ch === 'C') stampObjects.push(makeObject('core', x, y));
    }
  }
  for (const i of protectedShrine) w.flags[i] |= FLAG.protected;
  for (const o of stampObjects) w.setObject(o);

  const stampArena = (key) => {
    const a = anchors.arenas[key];
    const b = key === 'moss' ? 1 : key === 'crystal' ? 2 : 3;
    const floor = key === 'moss' ? GID.stone_floor : key === 'crystal' ? GID.crystal_floor : GID.ruin_floor;
    const v = DIR_VEC[a.door.dir];
    for (let y = a.y0; y <= a.y1; y++) {
      for (let x = a.x0; x <= a.x1; x++) {
        const i = y * W + x;
        w.flags[i] |= FLAG.arena | FLAG.protected | FLAG.noBuild;
        w.biome[i] = b;
        w.ground[i] = floor;
        const ring = x === a.x0 || x === a.x1 || y === a.y0 || y === a.y1;
        const along = v[0] ? Math.abs(y - a.cy) : Math.abs(x - a.cx);
        const isDoor = ring && x - a.door.x === (v[0] ? 0 : x - a.door.x) && (v[0] ? x === a.door.x : y === a.door.y) && along <= 1;
        w.wall[i] = ring && !isDoor ? WID.seal_stone : 0;
      }
    }
    if (key === 'crystal') for (const [ox, oy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) w.wall[(a.cy + oy) * W + a.cx + ox] = WID.seal_stone;
    if (key === 'ember') {
      for (let ly = 0; ly < 13; ly++) for (let lx = 0; lx < 13; lx++) if ((lx & 1) && (ly & 1)) w.ground[(a.y0 + 1 + ly) * W + a.x0 + 1 + lx] = GID.vent;
    }
    w.setObject(makeObject('altar', a.cx, a.cy));
    for (let k = -2; k <= 2; k++) for (let m = 1; m <= 2; m++) {
      const nx = a.outer.x + (v[0] ? v[0] * (m - 1) : k), ny = a.outer.y + (v[1] ? v[1] * (m - 1) : k);
      if (w.inBounds(nx, ny)) w.flags[ny * W + nx] |= FLAG.noBuild;
    }
  };
  stampArena('moss'); stampArena('crystal'); stampArena('ember');

  /* 7. 通路 */
  const pathNoise = nz('path');
  const corridorPass = (i) => {
    const wl = w.wall[i];
    if (wl === WID.bedrock || wl === WID.seal_stone || wl === WID.arena_barrier) return false;
    if (w.flags[i] & FLAG.arena) return false;
    if ((w.flags[i] & FLAG.hub) && wl !== 0) return false;
    if (wl === WID.gate_crystal || wl === WID.gate_ember) return false;
    return true;
  };
  const corridorCost = (i) => 1 + (pathNoise(X(i) / 7, Y(i) / 7) + 1) * 1.5 + (w.wall[i] ? 1.2 : 0);
  const dig3 = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 3 || ny < 3 || nx >= W - 3 || ny >= W - 3) continue;
      const i = ny * W + nx;
      if (w.flags[i] & (FLAG.protected | FLAG.hub)) continue; // 祠は全 seed で同一に保つ
      if (UNBREAK.has(w.wall[i])) continue;
      w.wall[i] = 0;
      if (D.GROUND[w.ground[i]].liquid || !D.GROUND[w.ground[i]].walk) w.ground[i] = baseFloor(homeBiome[i]);
      w.flags[i] |= FLAG.corridor;
      const o = w.objects.get(i);
      if (o && !(w.flags[i] & FLAG.protected) && o.type !== 'core' && !OBJ[o.type].item && o.type !== 'altar' && o.type !== 'chest' && o.type !== 'torch') w.objects.delete(i);
    }
  };
  const carve = (pts) => { for (const i of pts) dig3(X(i), Y(i)); };
  const route = (sx, sy, gx, gy) => astar(sx, sy, gx, gy, corridorPass, corridorCost) || [];
  const straight = (x0, y0, x1, y1) => {
    const pts = [];
    const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    pts.push(y * W + x);
    while (x !== x1) { x += sx; pts.push(y * W + x); }
    while (y !== y1) { y += sy; pts.push(y * W + x); }
    return pts;
  };
  const segs = {};
  {
    const a = anchors.arenas.moss;
    const sy = a.cy < 64 ? 56 : 72;
    segs.moss = route(64, sy, a.outer.x, a.outer.y);
    carve(segs.moss);
    segs.mossStart = { x: 64, y: sy };
  }
  for (const [name, sx0, dirX] of [['crystal', 56, -1], ['ember', 72, 1]]) {
    const g = anchors.gates[name], a = anchors.arenas[name];
    if (!g.outer) continue;
    segs[name + 'A'] = route(sx0, 64, g.outer.x, g.outer.y);
    const thru = straight(g.outer.x, g.y, g.inner.x, g.y);
    segs[name + 'B'] = route(g.inner.x, g.inner.y, a.outer.x, a.outer.y);
    carve(segs[name + 'A']); carve(thru); carve(segs[name + 'B']);
    segs[name + 'Start'] = { x: sx0, y: 64 };
  }

  /* 8. 意図的な障害 */
  const band = (path, frac, width, ground) => {
    if (path.length < 12) return null;
    const k = Math.min(path.length - 4, Math.max(3, Math.floor(path.length * frac)));
    const p = path[k], q = path[Math.max(0, k - 3)], r = path[Math.min(path.length - 1, k + 3)];
    const px = X(p), py = Y(p);
    const horizontal = Math.abs(X(r) - X(q)) >= Math.abs(Y(r) - Y(q));
    const place = (x, y) => {
      if (!w.inBounds(x, y)) return false;
      const i = y * W + x;
      if (w.wall[i] || (w.flags[i] & (FLAG.protected | FLAG.arena))) return false;
      w.ground[i] = ground;
      w.flags[i] |= 0;
      return true;
    };
    for (let c = 0; c < width; c++) {
      for (const sgn of [1, -1]) {
        for (let s = sgn === 1 ? 0 : 1; s <= 12; s++) {
          const x = horizontal ? px + c : px + sgn * s, y = horizontal ? py + sgn * s : py + c;
          if (!place(x, y)) break;
        }
      }
    }
    return { x: px, y: py };
  };
  if (segs.crystalB && segs.crystalB.length) {
    for (const f of [0.4, 0.75]) { const c = band(segs.crystalB, f, 2, GID.chasm); if (c) anchors.obstacles.chasm.push(c); }
  }
  if (segs.emberB && segs.emberB.length) anchors.obstacles.lava = band(segs.emberB, 0.5, 2, GID.lava);

  /* 9. 液体 */
  const rl = rngFor('liquid');
  const liqOk = (i) => !w.wall[i] && D.GROUND[w.ground[i]].walk && w.ground[i] !== GID.vent && !(w.flags[i] & (FLAG.protected | FLAG.corridor | FLAG.arena | FLAG.hub));
  const blob = (cx, cy, rad, ground, biome, nn) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!w.inBounds(x, y)) continue;
      const i = y * W + x;
      if (!liqOk(i) || w.biome[i] !== biome) continue;
      if (sqrt(dx * dx + dy * dy) + nn(x / 3, y / 3) * 1.2 < rad) w.ground[i] = ground;
    }
  };
  const blobNoise = nz('blob');
  const randOpen = (biome, minHub) => {
    for (let t = 0; t < 400; t++) {
      const x = 5 + Math.floor(rl() * (W - 10)), y = 5 + Math.floor(rl() * (W - 10));
      const i = y * W + x;
      if (liqOk(i) && w.biome[i] === biome && dist(i, 64, 64) >= minHub) return [x, y];
    }
    return null;
  };
  const ponds = 6 + Math.floor(rl() * 5);
  for (let k = 0; k < ponds; k++) { const p = randOpen(1, 12); if (p) blob(p[0], p[1], 1.6 + rl() * 1.2, GID.water, 1, blobNoise); }
  { const p = randOpen(2, 8); if (p) blob(p[0], p[1], 4.2 + rl(), GID.water, 2, blobNoise); }
  const streakC = nz('streakC'), streakE = nz('streakE');
  for (let y = 3; y < W - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x;
    if (!liqOk(i)) continue;
    if (w.biome[i] === 2 && Math.abs(streakC(x / 9, y / 9)) < 0.04) w.ground[i] = GID.chasm;
    else if (w.biome[i] === 3 && Math.abs(streakE(x / 9, y / 9)) < 0.05) w.ground[i] = GID.lava;
  }
  const springs = 3 + Math.floor(rl() * 3);
  for (let k = 0; k < springs; k++) { const p = randOpen(3, 10); if (p) blob(p[0], p[1], 1.5 + rl() * 0.8, GID.hot_spring, 3, blobNoise); }

  /* 10. 鉱脈 */
  const rv = rngFor('veins');
  const veinNoise = nz('vein');
  const nearOpen = (i, r) => {
    const x = X(i), y = Y(i);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < W) {
        const j = ny * W + nx;
        if (!w.wall[j] && D.GROUND[w.ground[j]].walk) return true;
      }
    }
    return false;
  };
  const veinSpec = {
    1: [['copper_vein', 0.04], ['coal_vein', 0.03]],
    2: [['crystal_vein', 0.05], ['coal_vein', 0.015], ['copper_vein', 0.01]],
    3: [['ember_vein', 0.05], ['obsidian_rock', 0.03], ['coal_vein', 0.02]],
  };
  const homeOf = (i) => homeBiome[i];
  let tagNo = 0;
  for (const b of [1, 2, 3]) {
    const cands = [];
    for (let i = 0; i < N; i++) if (homeOf(i) === b && BASE_WALLS.has(w.wall[i]) && w.biome[i] === b && !(w.flags[i] & FLAG.protected) && nearOpen(i, 2)) cands.push(i);
    for (const [key, rate] of veinSpec[b]) {
      tagNo++;
      const scored = cands.filter((i) => BASE_WALLS.has(w.wall[i])).map((i) => [veinNoise(X(i) / 4 + tagNo * 13, Y(i) / 4) * 0.7 + (rv() * 2 - 1) * 0.3, i]);
      scored.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
      const take = Math.round(cands.length * rate);
      for (let k = 0; k < take && k < scored.length; k++) w.wall[scored[k][1]] = WID[key];
    }
  }

  /* 11. 自然物 */
  const ro = rngFor('objects');
  const table = {
    1: [['cap_tree', 0.05], ['glowcap', 0.04], ['moss_grass', 0.06], ['rubble', 0.01], ['wild_tuber', 0.008], ['wild_grain', 0.006]],
    2: [['crystal_cluster', 0.03], ['glowcap', 0.02], ['cap_tree', 0.015], ['wild_grain', 0.006]],
    3: [['rubble', 0.02], ['wild_pepper', 0.008], ['cap_tree', 0.005]],
  };
  const doorZones = Object.values(anchors.arenas).map((a) => a.outer);
  const nearDoor = (i) => doorZones.some((o) => Math.abs(X(i) - o.x) <= 3 && Math.abs(Y(i) - o.y) <= 3);
  const floorOk = (i) => !w.wall[i] && D.GROUND[w.ground[i]].walk && w.ground[i] !== GID.vent && !w.objects.has(i) && !(w.flags[i] & (FLAG.protected | FLAG.arena | FLAG.hub));
  for (let i = 0; i < N; i++) {
    const r = ro();
    if (!floorOk(i)) continue;
    const t = table[w.biome[i]];
    if (!t) continue;
    let acc = 0;
    for (const [type, p] of t) {
      acc += p;
      if (r < acc) {
        if (OBJ[type].block && ((w.flags[i] & FLAG.corridor) || nearDoor(i))) break;
        if (!(w.flags[i] & FLAG.corridor) && nearDoor(i) && OBJ[type].block) break;
        w.setObject(makeObject(type, X(i), Y(i)));
        break;
      }
    }
  }

  /* 12. 保証の補填 */
  const order = (arr, cx, cy) => arr.map((i) => [dist(i, cx, cy), hash2(i, 77, seedInt), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((a) => a[2]);
  const exposed = (i) => {
    const x = X(i), y = Y(i);
    for (const [dx, dy] of ZB_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (w.inBounds(nx, ny) && !w.wall[ny * W + nx] && D.GROUND[w.ground[ny * W + nx]].walk) return true;
    }
    return false;
  };
  const countObj = (type, pred) => { let n = 0; for (const o of w.objects.values()) if (o.type === type && pred(o.x, o.y)) n++; return n; };
  const countWall = (id, pred) => { let n = 0; for (let i = 0; i < N; i++) if (w.wall[i] === id && pred(X(i), Y(i), i)) n++; return n; };
  const fillObj = (name, type, need, pred, cx, cy) => {
    const have = countObj(type, pred);
    const rec = (report.guarantees[name] = { need, have, added: 0 });
    if (have >= need) return;
    const cands = [];
    for (let i = 0; i < N; i++) {
      if (!floorOk(i) || !pred(X(i), Y(i))) continue;
      if (OBJ[type].block && ((w.flags[i] & FLAG.corridor) || nearDoor(i))) continue;
      cands.push(i);
    }
    for (const i of order(cands, cx, cy)) {
      if (rec.have + rec.added >= need) break;
      w.setObject(makeObject(type, X(i), Y(i)));
      rec.added++;
    }
    rec.have = countObj(type, pred);
  };
  const fillWall = (name, id, need, pred, cx, cy, needExposed) => {
    const count = () => countWall(id, (x, y, i) => pred(x, y) && (!needExposed || exposed(i)));
    const have = count();
    const rec = (report.guarantees[name] = { need, have, added: 0 });
    if (have >= need) return;
    const cands = [];
    for (let i = 0; i < N; i++) {
      const wl = w.wall[i];
      if (wl === id || !(BASE_WALLS.has(wl) || wl === WID.loam_wall) || (w.flags[i] & FLAG.protected) || !pred(X(i), Y(i))) continue;
      if (w.biome[i] === 0) continue;
      if (needExposed ? !exposed(i) : !nearOpen(i, 2)) continue;
      cands.push(i);
    }
    for (const i of order(cands, cx, cy)) {
      if (have + rec.added >= need) break;
      w.wall[i] = id;
      if (id === WID.loam_wall) w.ground[i] = GID.loam_floor;
      rec.added++;
    }
    rec.have = count();
  };
  const fillWater = (name, groundId, need, pred, cx, cy) => {
    const count = () => { let n = 0; for (let i = 0; i < N; i++) if (w.ground[i] === groundId && pred(X(i), Y(i)) && exposed2(i)) n++; return n; };
    const exposed2 = (i) => { const x = X(i), y = Y(i); for (const [dx, dy] of ZB_DIRS) { const nx = x + dx, ny = y + dy; if (w.inBounds(nx, ny) && w.floorAt(nx, ny)) return true; } return false; };
    const have = count();
    const rec = (report.guarantees[name] = { need, have, added: 0 });
    if (have >= need) return;
    const cands = [];
    for (let i = 0; i < N; i++) {
      if (!floorOk(i) || (w.flags[i] & FLAG.corridor) || !pred(X(i), Y(i)) || nearDoor(i) || w.build[i]) continue;
      cands.push(i);
    }
    for (const i of order(cands, cx, cy)) {
      if (have + rec.added >= need) break;
      w.ground[i] = groundId;
      w.objects.delete(i);
      rec.added++;
    }
    rec.have = count();
  };
  const ringPred = (x, y) => {
    const d = sqrt((x - 64) * (x - 64) + (y - 64) * (y - 64));
    return d >= B.hearth.ringMin && d <= B.hearth.ringMax && !(x >= 56 && x <= 72 && y >= 56 && y <= 72);
  };
  const ringO = (name, type, n) => fillObj('ring.' + name, type, n, ringPred, 64, 64);
  ringO('cap_tree', 'cap_tree', 10); ringO('glowcap', 'glowcap', 8); ringO('moss_grass', 'moss_grass', 8); ringO('rubble', 'rubble', 4);
  ringO('wild_tuber', 'wild_tuber', 2); ringO('wild_grain', 'wild_grain', 2);
  fillWall('ring.copper_vein', WID.copper_vein, 6, ringPred, 64, 64, true);
  fillWall('ring.coal_vein', WID.coal_vein, 4, ringPred, 64, 64, true);
  fillWall('ring.loam_wall', WID.loam_wall, 8, ringPred, 64, 64, true);

  const gateZone = (name) => {
    const g = anchors.gates[name];
    if (!g || !g.inner) return null;
    const first = name === 'crystal' ? anchors.obstacles.chasm[0] : anchors.obstacles.lava;
    const pred = (x, y) => {
      const d = sqrt((x - g.inner.x) ** 2 + (y - g.inner.y) ** 2);
      if (d > 14) return false;
      if (!first) return true;
      return d < sqrt((x - first.x) ** 2 + (y - first.y) ** 2);
    };
    return { pred, cx: g.inner.x, cy: g.inner.y };
  };
  const gc = gateZone('crystal');
  if (gc) {
    fillWall('crystalGate.crystal_vein', WID.crystal_vein, 6, gc.pred, gc.cx, gc.cy, false);
    fillWall('crystalGate.coal_vein', WID.coal_vein, 3, gc.pred, gc.cx, gc.cy, false);
    fillObj('crystalGate.cap_tree', 'cap_tree', 4, gc.pred, gc.cx, gc.cy);
    fillObj('crystalGate.crystal_cluster', 'crystal_cluster', 3, gc.pred, gc.cx, gc.cy);
    fillWater('crystalGate.water', GID.water, 4, gc.pred, gc.cx, gc.cy);
  }
  const ge = gateZone('ember');
  if (ge) {
    fillWall('emberGate.ember_vein', WID.ember_vein, 6, ge.pred, ge.cx, ge.cy, false);
    fillWall('emberGate.obsidian_rock', WID.obsidian_rock, 4, ge.pred, ge.cx, ge.cy, false);
    fillWall('emberGate.coal_vein', WID.coal_vein, 4, ge.pred, ge.cx, ge.cy, false);
    fillObj('emberGate.cap_tree', 'cap_tree', 3, ge.pred, ge.cx, ge.cy);
    fillWater('emberGate.hot_spring', GID.hot_spring, 4, ge.pred, ge.cx, ge.cy);
    fillObj('emberGate.rubble', 'rubble', 3, ge.pred, ge.cx, ge.cy);
  }
  const inBiome = (b) => (x, y) => w.biome[y * W + x] === b;
  fillWall('moss.copper_vein', WID.copper_vein, 45, inBiome(1), 64, 64, false);
  fillWall('moss.coal_vein', WID.coal_vein, 30, inBiome(1), 64, 64, false);
  fillWall('crystal.crystal_vein', WID.crystal_vein, 45, inBiome(2), 30, 64, false);
  fillWall('crystal.coal_vein', WID.coal_vein, 15, inBiome(2), 30, 64, false);
  fillWall('ember.ember_vein', WID.ember_vein, 45, inBiome(3), 98, 64, false);
  fillWall('ember.obsidian_rock', WID.obsidian_rock, 25, inBiome(3), 98, 64, false);
  fillWall('ember.coal_vein', WID.coal_vein, 15, inBiome(3), 98, 64, false);
  fillObj('all.cap_tree', 'cap_tree', 120, () => true, 64, 64);

  /* 13. 検証と補修 */
  const outerOf = (g) => g.outer;
  const checks = () => {
    const a = anchors;
    const st = a.start;
    const res = {};
    res.moss = zeroOneBfs(w, st.x, st.y, a.arenas.moss.outer.x, a.arenas.moss.outer.y, 1);
    for (const k of ['crystal', 'ember']) {
      const g = a.gates[k], ar = a.arenas[k];
      if (!g.outer) { res[k + 'Gate'] = -1; res[k] = -1; continue; }
      res[k + 'Gate'] = zeroOneBfs(w, st.x, st.y, outerOf(g).x, outerOf(g).y, 1);
      res[k] = zeroOneBfs(w, g.inner.x, g.inner.y, ar.outer.x, ar.outer.y, k === 'crystal' ? 2 : 3);
    }
    return res;
  };
  const okOf = (res) => ({
    moss: res.moss === 0, crystalGate: res.crystalGate === 0, crystal: res.crystal >= 0 && res.crystal <= 6,
    emberGate: res.emberGate === 0, ember: res.ember >= 0 && res.ember <= 6,
  });
  const clearPath = (pts) => {
    for (const i of pts) {
      dig3(X(i), Y(i));
    }
  };
  let res = checks();
  let ok = okOf(res);
  if (!Object.values(ok).every(Boolean)) {
    const a = anchors;
    const fix = (name, from, to) => {
      for (const flip of [false, true]) {
        const pts = flip ? (() => { const p = []; let x = from.x, y = from.y; p.push(y * W + x); while (y !== to.y) { y += Math.sign(to.y - y); p.push(y * W + x); } while (x !== to.x) { x += Math.sign(to.x - x); p.push(y * W + x); } return p; })() : straight(from.x, from.y, to.x, to.y);
        clearPath(pts);
        report.repaired.push(name + (flip ? ':vh' : ':hv'));
        res = checks(); ok = okOf(res);
        if (ok[name]) return;
      }
    };
    if (!ok.moss) fix('moss', { x: 64, y: a.arenas.moss.cy < 64 ? 56 : 72 }, a.arenas.moss.outer);
    for (const k of ['crystal', 'ember']) {
      const g = a.gates[k];
      if (!g.outer) continue;
      if (!ok[k + 'Gate']) fix(k + 'Gate', segs[k + 'Start'], g.outer);
      if (!ok[k]) fix(k, g.inner, a.arenas[k].outer);
    }
  }
  report.segments = res;
  report.ok = okOf(res);
  for (const k of ['crystal', 'ember']) {
    const g = anchors.gates[k];
    report.bridgesNeeded[k] = g.inner ? zeroOneBfs(w, g.inner.x, g.inner.y, anchors.arenas[k].outer.x, anchors.arenas[k].outer.y, 0) : -1;
  }
  for (const [k, v] of Object.entries(report.ok)) if (!v) report.failed.push('route:' + k);

  /* 仕上げ：光・保護 */
  for (const g of [anchors.gates.crystal, anchors.gates.ember]) for (const t of g.tiles || []) w.biome[t.y * W + t.x] = 0;
  w.rebuildLights();
  for (let i = 0; i < 64; i++) w.chunkVersion[i] = 1;
  return { world: w, report };
}

/* ───────── セーブの検証 ───────── */
class Bad extends Error {}
const bad = (m) => { throw new Bad(m); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad(name + ' が有限の数値ではありません'); return v; };
const clampNum = (v, lo, hi, name) => { fin(v, name); return v < lo ? lo : v > hi ? hi : v; };
const rngNum = (v, lo, hi, name) => { fin(v, name); if (v < lo || v > hi) bad(name + ' が範囲外です'); return v; };
const intIn = (v, lo, hi, name) => {
  fin(v, name);
  if (!Number.isInteger(v)) bad(name + ' が整数ではありません');
  if (v < lo || v > hi) bad(name + ' が範囲外です');
  return v;
};
const boolean = (v, name) => { if (typeof v !== 'boolean') bad(name + ' が真偽値ではありません'); return v; };
const oneOf = (v, set, name) => { if (typeof v !== 'string' || !set.has(v)) bad(name + ' が不正です'); return v; };
const arr = (v, max, name, exact) => {
  if (!Array.isArray(v)) bad(name + ' が配列ではありません');
  if (exact !== undefined ? v.length !== exact : v.length > max) bad(name + ' の長さが不正です');
  return v;
};

const ITEM_KEYS = new Set(Object.keys(D.ITEMS));
const ARMOR_KEYS = new Set(Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].type === 'armor'));
const CROP_KEYS = new Set(Object.keys(D.CROPS));
const OBJ_KEYS = new Set(Object.keys(OBJ));
const HINT_KEYS = new Set(Object.keys(D.HINTS));
const ACH_IDS = new Set(D.ACHIEVEMENTS.map((a) => a.id));
const RECIPE_IDS = new Set(D.RECIPES.map((r) => r.id));
const FISH_KEYS = new Set(D.FISH.map((f) => f.key));
const BUFF_KEYS = new Set(Object.keys(D.BUFFS));
const UNLOCK_KEYS = new Set(['boss_moss', 'boss_crystal', 'boss_ember', 'core']);
const BOSS_IDS = new Set(Object.keys(D.BOSSES));
const BIOME_NAMES = new Set(['moss', 'crystal', 'ember']);
const CODEX_SETS = {
  item: new Set(Object.keys(D.ITEMS).filter((k) => D.ITEMS[k].type !== 'place' && D.ITEMS[k].type !== 'fish')),
  enemy: new Set(Object.keys(D.ENEMIES)),
  fish: FISH_KEYS,
  boss: BOSS_IDS,
  biome: BIOME_NAMES,
};
const STAT_SETS = {
  mined: new Set([...D.WALL.map((x) => x.key), ...OBJ_KEYS]),
  crafted: RECIPE_IDS,
  placed: ITEM_KEYS,
  obtained: ITEM_KEYS,
  killed: new Set([...Object.keys(D.ENEMIES), ...BOSS_IDS]),
  fish: FISH_KEYS,
  cooked: RECIPE_IDS,
};
const DIFFICULTIES = new Set(Object.keys(D.DIFFICULTY));
const GATE_NAMES = ['crystal', 'ember'];
const ARENA_NAMES = ['moss', 'crystal', 'ember'];

function vSlot(v, name, allowNull = true) {
  if (v === null) { if (allowNull) return null; bad(name + ' が空です'); }
  if (!isObj(v)) bad(name + ' が不正です');
  const id = oneOf(v.id, ITEM_KEYS, name + '.id');
  return { id, n: intIn(v.n, 1, D.ITEMS[id].stack, name + '.n') };
}

function vPoint(v, name, lo = 0, hi = W - 1) {
  if (!isObj(v)) bad(name + ' が不正です');
  return { x: intIn(v.x, lo, hi, name + '.x'), y: intIn(v.y, lo, hi, name + '.y') };
}

function vAnchors(a) {
  if (!isObj(a)) bad('anchors が不正です');
  const hub = vPoint(a.hub, 'anchors.hub'), start = vPoint(a.start, 'anchors.start');
  if (hub.x !== 64 || hub.y !== 64 || start.x !== 64 || start.y !== 66) bad('anchors の祠の位置が不正です');
  if (!isObj(a.arenas)) bad('anchors.arenas が不正です');
  const arenas = {};
  for (const k of ARENA_NAMES) {
    const s = a.arenas[k];
    if (!isObj(s)) bad('anchors.arenas.' + k + ' が不正です');
    const cx = intIn(s.cx, 10, W - 11, 'arena.cx'), cy = intIn(s.cy, 10, W - 11, 'arena.cy');
    if (s.x0 !== cx - 7 || s.x1 !== cx + 7 || s.y0 !== cy - 7 || s.y1 !== cy + 7) bad('アリーナの矩形が不正です');
    if (!isObj(s.door)) bad('arena.door が不正です');
    const dir = oneOf(s.door.dir, new Set(['N', 'S', 'E', 'W']), 'arena.door.dir');
    const v = DIR_VEC[dir];
    if (s.door.x !== cx + v[0] * 7 || s.door.y !== cy + v[1] * 7) bad('アリーナの入口が不正です');
    const outer = vPoint(s.outer, 'arena.outer');
    if (outer.x !== cx + v[0] * 8 || outer.y !== cy + v[1] * 8) bad('アリーナの入口外側が不正です');
    arenas[k] = { cx, cy, x0: cx - 7, y0: cy - 7, x1: cx + 7, y1: cy + 7, door: { x: s.door.x, y: s.door.y, dir }, outer };
  }
  if (!isObj(a.gates)) bad('anchors.gates が不正です');
  const gates = {};
  for (const k of GATE_NAMES) {
    const g = a.gates[k];
    if (!isObj(g)) bad('anchors.gates.' + k + ' が不正です');
    const tiles = arr(g.tiles, 64, 'gate.tiles').map((t, i) => vPoint(t, 'gate.tiles[' + i + ']', 4, W - 5));
    gates[k] = { tiles, y: intIn(g.y, 4, W - 5, 'gate.y'), outer: vPoint(g.outer, 'gate.outer'), inner: vPoint(g.inner, 'gate.inner') };
    if (!tiles.length) bad('gate.tiles が空です');
  }
  const ob = a.obstacles;
  if (!isObj(ob)) bad('anchors.obstacles が不正です');
  return {
    hub, start, arenas, gates,
    obstacles: {
      chasm: arr(ob.chasm, 4, 'obstacles.chasm').map((p, i) => vPoint(p, 'obstacles.chasm[' + i + ']')),
      lava: ob.lava === null ? null : vPoint(ob.lava, 'obstacles.lava'),
    },
  };
}

function vObjects(list) {
  arr(list, B.limits.objects, 'objects');
  const seen = new Set();
  const out = [];
  let chests = 0, satchels = 0, cores = 0;
  for (let n = 0; n < list.length; n++) {
    const o = list[n];
    const nm = 'objects[' + n + ']';
    if (!isObj(o)) bad(nm + ' が不正です');
    const t = oneOf(o.t, OBJ_KEYS, nm + '.t');
    const x = intIn(o.x, 0, W - 1, nm + '.x'), y = intIn(o.y, 0, W - 1, nm + '.y');
    const cells = t === 'core' ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
    for (const [dx, dy] of cells) {
      if (x + dx >= W || y + dy >= W) bad(nm + ' が範囲外です');
      const key = (y + dy) * W + x + dx;
      if (seen.has(key)) bad(nm + ' がほかのオブジェクトと重なっています');
      seen.add(key);
    }
    const r = { t, x, y };
    switch (t) {
      case 'chest':
        if (++chests > B.inventory.chestMax) bad('収納箱が多すぎます');
        r.items = arr(o.items, 0, nm + '.items', B.inventory.chestSlots).map((s, i) => vSlot(s, nm + '.items[' + i + ']'));
        r.starter = boolean(o.starter, nm + '.starter');
        break;
      case 'satchel':
        if (++satchels > 1) bad('遺灰袋が複数あります');
        r.items = arr(o.items, B.inventory.satchelCap, nm + '.items').map((s, i) => vSlot(s, nm + '.items[' + i + ']', false));
        break;
      case 'planter': {
        r.crop = o.crop === null ? null : oneOf(o.crop, CROP_KEYS, nm + '.crop');
        r.stage = intIn(o.stage, 0, 3, nm + '.stage');
        r.growT = clampNum(o.growT, 0, 10000, nm + '.growT');
        break;
      }
      case 'sapling': r.growT = clampNum(o.growT, 0, 10000, nm + '.growT'); break;
      case 'cap_tree': r.stump = boolean(o.stump, nm + '.stump'); r.regrowT = clampNum(o.regrowT, 0, 1000, nm + '.regrowT'); break;
      case 'glowcap': case 'moss_grass': case 'rubble': case 'crystal_cluster':
      case 'wild_tuber': case 'wild_grain': case 'wild_pepper':
        r.spent = boolean(o.spent, nm + '.spent'); r.regrowT = clampNum(o.regrowT, 0, 1000, nm + '.regrowT'); break;
      case 'core':
        if (++cores > 1) bad('炉心が複数あります');
        if (x !== 63 || y !== 63) bad('炉心の位置が不正です');
        r.restored = boolean(o.restored, nm + '.restored');
        break;
      case 'altar': r.boss = boolean(o.boss, nm + '.boss'); break;
      case 'torch': r.shrine = boolean(o.shrine, nm + '.shrine'); break;
      default: break;
    }
    out.push(r);
  }
  return out;
}

function vCodexList(list, set, name) {
  arr(list, 256, name);
  const out = [];
  const seen = new Set();
  for (const k of list) {
    oneOf(k, set, name);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

// 破壊不能以外の壁・液体を無視した到達性（採掘と橋で通れるものとして）
function checkReach(layers, anchors) {
  const seen = new Uint8Array(N);
  const q = new Int32Array(N);
  let h = 0, t = 0;
  const free = (i) => {
    const wl = layers.wall[i];
    if (wl) {
      if (wl === WID.gate_crystal || wl === WID.gate_ember) return true;
      return D.WALL[wl].hardness < 99;
    }
    return true;
  };
  const s = anchors.start.y * W + anchors.start.x;
  if (layers.wall[s]) return '開始地点が壁の中にあります';
  q[t++] = s;
  seen[s] = 1;
  while (h < t) {
    const i = q[h++];
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of ZB_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const ni = ny * W + nx;
      if (seen[ni] || !free(ni)) continue;
      seen[ni] = 1;
      q[t++] = ni;
    }
  }
  const need = [];
  for (const k of ARENA_NAMES) need.push(anchors.arenas[k].outer);
  for (const k of GATE_NAMES) need.push(anchors.gates[k].outer, anchors.gates[k].inner);
  for (const p of need) if (!seen[p.y * W + p.x]) return '到達できない重要地点があります';
  return null;
}

function vSave(o) {
  if (!isObj(o)) bad('セーブデータの形式が不正です');
  if (o.format !== D.SAVE_FORMAT) bad('エンバーベイルのセーブデータではありません');
  const version = intIn(o.version, 1, 1e6, 'version');
  if (version > D.SAVE_VERSION) bad('新しいバージョンのデータです');
  const genVersion = intIn(o.genVersion, 1, 1e6, 'genVersion');
  if (genVersion !== D.GEN_VERSION) bad('世界生成の版が異なるため読み込めません');

  // game
  const g = o.game;
  if (!isObj(g)) bad('game が不正です');
  const seed = sanitizeSeed(typeof g.seed === 'string' ? g.seed : '');
  if (typeof g.seed !== 'string' || seed.length < 1) bad('seed が不正です');
  const game = {
    time: rngNum(g.time, 0, 1e8, 'game.time'), playTime: rngNum(g.playTime, 0, 1e8, 'game.playTime'),
    rngState: intIn(g.rngState, 0, 4294967295, 'game.rngState'), difficulty: oneOf(g.difficulty, DIFFICULTIES, 'game.difficulty'), seed,
  };

  // world
  const wd = o.world;
  if (!isObj(wd)) bad('world が不正です');
  if (wd.w !== W || wd.h !== W) bad('ワールドの大きさが不正です');
  const layers = {
    ground: rleDecode(wd.ground, D.GROUND.length - 1),
    wall: rleDecode(wd.wall, D.WALL.length - 1),
    build: rleDecode(wd.build, D.BUILD.length - 1),
  };
  for (const k of ['ground', 'wall', 'build']) if (!layers[k]) bad('レイヤー ' + k + ' の RLE が不正です');
  if (!b64ToBits(wd.explored)) bad('explored が不正です');
  const anchors = vAnchors(wd.anchors);
  const objects = vObjects(wd.objects);
  for(const object of objects)if(object.t==='altar'&&!ARENA_NAMES.some(k=>anchors.arenas[k].cx===object.x&&anchors.arenas[k].cy===object.y))bad('祭壇の位置が不正です');
  const drops = arr(wd.drops, B.limits.drops, 'drops').map((d, i) => {
    if (!isObj(d)) bad('drops[' + i + '] が不正です');
    const item = oneOf(d.item, ITEM_KEYS, 'drops.item');
    return { item, n: intIn(d.n, 1, D.ITEMS[item].stack, 'drops.n'), x: rngNum(d.x, 0, W, 'drops.x'), y: rngNum(d.y, 0, W, 'drops.y'), t: clampNum(d.t, 0, B.dropLife, 'drops.t') };
  });
  const reach = checkReach(layers, anchors);
  if (reach) bad(reach);

  // progress
  const pr = o.progress;
  if (!isObj(pr)) bad('progress が不正です');
  const hearts = {}, gates = {};
  if (!isObj(pr.hearts) || !isObj(pr.gates) || !isObj(pr.flags) || !isObj(pr.codex)) bad('progress の構造が不正です');
  for (const k of ARENA_NAMES) hearts[k] = boolean(pr.hearts[k], 'hearts.' + k);
  for (const k of GATE_NAMES) gates[k] = boolean(pr.gates[k], 'gates.' + k);
  let coreRestored = boolean(pr.coreRestored, 'coreRestored');
  let endingSeen = boolean(pr.endingSeen, 'endingSeen');
  const flags = {
    openedStarter: boolean(pr.flags.openedStarter, 'flags.openedStarter'),
    enteredCrystal: boolean(pr.flags.enteredCrystal, 'flags.enteredCrystal'),
    enteredEmber: boolean(pr.flags.enteredEmber, 'flags.enteredEmber'),
  };
  const unlocks = arr(pr.unlocks, 16, 'unlocks').map((k) => oneOf(k, UNLOCK_KEYS, 'unlocks'));
  const hintsSeen = arr(pr.hintsSeen, 64, 'hintsSeen').map((k) => oneOf(k, HINT_KEYS, 'hintsSeen'));
  const codex = {};
  for (const k of Object.keys(CODEX_SETS)) codex[k] = vCodexList(pr.codex[k], CODEX_SETS[k], 'codex.' + k);
  const achievements = [...new Set(arr(pr.achievements, 64, 'achievements').map((k) => oneOf(k, ACH_IDS, 'achievements')))];
  // 意味の整合を修復する
  if (coreRestored) for (const k of ARENA_NAMES) hearts[k] = true;
  if (hearts.moss) gates.crystal = true;
  if (hearts.crystal) gates.ember = true;
  if (!coreRestored) endingSeen = false;
  const nHearts = ARENA_NAMES.filter((k) => hearts[k]).length;
  const unlockSet = new Set(unlocks);
  for (const k of ARENA_NAMES) if (hearts[k]) unlockSet.add('boss_' + k);
  if (coreRestored) unlockSet.add('core');
  const progress = {
    hearts, gates, coreRestored, endingSeen, objective: intIn(pr.objective, 0, D.OBJECTIVES.length - 1, 'objective'),
    flags, unlocks: [...new Set([...unlocks, ...unlockSet])], hintsSeen: [...new Set(hintsSeen)], codex, achievements,
  };

  // stats
  const st = o.stats;
  if (!isObj(st)) bad('stats が不正です');
  const stats = {};
  for (const k of Object.keys(STAT_SETS)) {
    if (!isObj(st[k])) bad('stats.' + k + ' が不正です');
    stats[k] = {};
    for (const key of Object.keys(st[k])) {
      if (!STAT_SETS[k].has(key)) bad('stats.' + k + ' に未知のキー ' + key);
      stats[k][key] = intIn(st[k][key], 0, 1e9, 'stats.' + k + '.' + key);
    }
  }
  for (const k of ['harvested', 'deaths', 'satchels', 'bridges', 'lights', 'builds']) stats[k] = intIn(st[k], 0, 1e9, 'stats.' + k);

  // player
  const p = o.player;
  if (!isObj(p)) bad('player が不正です');
  const maxHp = Math.min(PL.maxHpCap, PL.hp + PL.hpPerHeart * nHearts);
  const inventory = arr(p.inventory, 0, 'inventory', B.inventory.slots).map((s, i) => vSlot(s, 'inventory[' + i + ']'));
  const buffsRaw = arr(p.buffs, 8, 'buffs');
  const buffs = [];
  for (const b of buffsRaw) {
    if (!isObj(b)) bad('buff が不正です');
    const id = oneOf(b.id, BUFF_KEYS, 'buff.id');
    const t = clampNum(b.t, 0, 900, 'buff.t');
    const ex = buffs.find((e) => e.id === id);
    if (ex) ex.t = Math.max(ex.t, t); else buffs.push({ id, t });
  }
  const spawn = vPoint(p.spawn, 'spawn');
  const spawnKind = oneOf(p.spawn.kind, new Set(['hub', 'bed']), 'spawn.kind');
  const player = {
    x: clampNum(p.x, 1, 127, 'player.x'), y: clampNum(p.y, 1, 127, 'player.y'), angle: fin(p.angle, 'player.angle'),
    hp: clampNum(p.hp, 0, maxHp, 'player.hp'), maxHp: (fin(p.maxHp, 'player.maxHp'), maxHp),
    stamina: clampNum(p.stamina, 0, PL.stamina, 'player.stamina'), hunger: clampNum(p.hunger, 0, PL.hunger, 'player.hunger'),
    inventory, selected: intIn(p.selected, 0, 7, 'selected'),
    armor: p.armor === null ? null : oneOf(p.armor, ARMOR_KEYS, 'armor'),
    buffs, spawn: { x: spawn.x, y: spawn.y, kind: spawnKind },
  };

  const meta = isObj(o.meta) ? o.meta : {};
  return {
    format: D.SAVE_FORMAT, version, genVersion,
    savedAt: typeof o.savedAt === 'string' && o.savedAt.length <= 40 ? o.savedAt : '',
    meta: {
      seed, difficulty: game.difficulty, playTime: game.playTime, hearts: nHearts, coreRestored,
      objective: typeof meta.objective === 'string' ? meta.objective.slice(0, 120) : '',
    },
    game,
    world: { w: W, h: W, ground: rleEncode(layers.ground), wall: rleEncode(layers.wall), build: rleEncode(layers.build), explored: wd.explored, anchors, objects, drops },
    player, progress, stats,
  };
}

/** セーブオブジェクトを検証する。構造・型・IDの誤りは全体を拒否し、連続値は丸め、意味の整合を修復した新しいオブジェクトを返す */
export function validateSave(obj) {
  try {
    return { ok: true, errors: [], save: vSave(obj) };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, errors: [e.message], save: null };
    return { ok: false, errors: ['検証中に予期しないエラー: ' + (e && e.message ? e.message : e)], save: null };
  }
}

export const MAX_SAVE_TEXT = 3000000;
/** JSON テキスト → 検証済みセーブ。{ok, error, save} */
export function parseSaveText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'テキストではありません', save: null };
  if (text.length > MAX_SAVE_TEXT) return { ok: false, error: 'データが大きすぎます', save: null };
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON として読めません', save: null }; }
  const v = validateSave(obj);
  return v.ok ? { ok: true, error: null, save: v.save } : { ok: false, error: v.errors[0], save: null };
}

export function summarizeSave(save) {
  if (!save) return null;
  const p = save.progress;
  return {
    seed: save.game.seed, difficulty: save.game.difficulty, playTime: save.game.playTime, savedAt: save.savedAt,
    hearts: ['moss', 'crystal', 'ember'].filter((k) => p.hearts[k]).length, coreRestored: p.coreRestored,
    objective: save.meta ? save.meta.objective : '', deaths: save.stats.deaths,
  };
}

/* ───────── 設定 ───────── */
export function normalizeSettings(raw, defaults) {
  const d = defaults || D.SETTINGS_DEFAULT;
  const r = isObj(raw) ? raw : {};
  const b = (k) => (typeof r[k] === 'boolean' ? r[k] : d[k]);
  const s = {
    soundOn: b('soundOn'),
    volume: Number.isInteger(r.volume) && r.volume >= 0 && r.volume <= 10 ? r.volume : d.volume,
    reduceMotion: b('reduceMotion'), screenShake: b('screenShake'),
    difficulty: typeof r.difficulty === 'string' && DIFFICULTIES.has(r.difficulty) ? r.difficulty : d.difficulty,
    autoTool: b('autoTool'), showDamageNumbers: b('showDamageNumbers'), highContrastTelegraph: b('highContrastTelegraph'),
    objectiveArrow: b('objectiveArrow'),
    uiScale: [100, 125, 150].includes(r.uiScale) ? r.uiScale : d.uiScale,
    touchControls: ['auto', 'on', 'off'].includes(r.touchControls) ? r.touchControls : d.touchControls,
  };
  return s;
}

export function loadSettings(store) {
  const def = { ...D.SETTINGS_DEFAULT };
  try {
    if (typeof matchMedia === 'function') def.reduceMotion = !!matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 既定値のまま */ }
  let raw = null;
  try {
    const text = store && store.getRaw ? store.getRaw('settings') : null;
    if (text && text.length < 4096) raw = JSON.parse(text);
  } catch (e) { raw = null; }
  return normalizeSettings(raw, def);
}

export function saveSettings(store, s) {
  const clean = normalizeSettings(s, D.SETTINGS_DEFAULT);
  if (!store || !store.setRaw) return { ok: false, error: '保存先がありません' };
  return store.setRaw('settings', JSON.stringify(clean));
}

/* ───────── SaveStore ───────── */
const SLOTS = [1, 2, 3];
const slotOk = (n) => Number.isInteger(n) && n >= 1 && n <= 3;

export class SaveStore {
  constructor(storage, ns = 'emberveil.v1') {
    this.ns = ns;
    this.mem = new Map();
    this.persistent = false;
    this.storage = null;
    this.initError = null;
    this._cache = new Map();
    try {
      const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (s) {
        const k = ns + '.__probe';
        s.setItem(k, '1');
        s.removeItem(k);
        this.storage = s;
        this.persistent = true;
      }
    } catch (e) {
      this.initError = String(e && e.message ? e.message : e);
    }
  }

  isAvailable() { return this.persistent; }
  key(name) { return this.ns + '.' + name; }

  getRaw(name) {
    try {
      if (this.persistent) return this.storage.getItem(this.key(name));
    } catch (e) { this.lastError = String(e && e.message ? e.message : e); return null; }
    return this.mem.has(this.key(name)) ? this.mem.get(this.key(name)) : null;
  }
  setRaw(name, text) {
    try {
      if (this.persistent) this.storage.setItem(this.key(name), text);
      else this.mem.set(this.key(name), text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), quota: !!(e && (e.name === 'QuotaExceededError' || e.code === 22)) };
    }
  }
  removeRaw(name) {
    try {
      if (this.persistent) this.storage.removeItem(this.key(name));
      else this.mem.delete(this.key(name));
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }

  _check(text) {
    if (text === null) return { ok: false, missing: true, error: 'データがありません', save: null };
    const hit = this._cache.get(text);
    if (hit) return hit;
    const r = parseSaveText(text);
    const res = r.ok ? { ok: true, save: r.save, error: null } : { ok: false, error: r.error, save: null, corrupt: true };
    if (this._cache.size > 8) this._cache.clear();
    this._cache.set(text, res);
    return res;
  }

  read(slot) {
    if (!slotOk(slot)) return { ok: false, error: 'スロットが不正です', save: null };
    const r = this._check(this.getRaw('slot' + slot));
    return { ...r, hasBackup: this.getRaw('slot' + slot + '.bak') !== null };
  }
  readBackup(slot) {
    if (!slotOk(slot)) return { ok: false, error: 'スロットが不正です', save: null };
    return this._check(this.getRaw('slot' + slot + '.bak'));
  }

  listSlots() {
    return SLOTS.map((slot) => {
      const raw = this.getRaw('slot' + slot);
      const hasBackup = this.getRaw('slot' + slot + '.bak') !== null;
      if (raw === null) return { slot, exists: false, corrupt: false, hasBackup, summary: null };
      const r = this._check(raw);
      return { slot, exists: true, corrupt: !r.ok, hasBackup, summary: r.ok ? summarizeSave(r.save) : null, error: r.ok ? null : r.error };
    });
  }

  /** 検証 → ロック確認 → 直前の正常データを .bak へ → 書き込み。opts.lock に TabLock を渡すと所有権を確認する */
  write(slot, saveObj, opts = {}) {
    if (!slotOk(slot)) return { ok: false, error: 'スロットが不正です' };
    const v = validateSave(saveObj);
    if (!v.ok) return { ok: false, error: 'セーブデータの検証に失敗しました: ' + v.errors[0], invalid: true };
    if (opts.lock) {
      const l = opts.lock.ensure(slot);
      if (!l.ok) return { ok: false, error: '別のタブがこのスロットを使っているため保存できません', lost: true };
    }
    const text = JSON.stringify(v.save);
    if (text.length > MAX_SAVE_TEXT) return { ok: false, error: 'データが大きすぎます' };
    const cur = this.getRaw('slot' + slot);
    let backupError = null;
    if (cur !== null && this._check(cur).ok) {
      const b = this.setRaw('slot' + slot + '.bak', cur);
      if (!b.ok) backupError = b.error;
    }
    const w = this.setRaw('slot' + slot, text);
    if (!w.ok) return { ok: false, error: w.error, quota: w.quota };
    if (this.getRaw('slot' + slot) !== text) return { ok: false, error: '書き込みの確認に失敗しました' };
    this.setLastSlot(slot);
    return { ok: true, bytes: text.length, backupError };
  }

  /** 検証済みの JSON テキストを（取り込み用に）スロットへ書く。失敗しても既存データは変わらない */
  writeText(slot, text, opts = {}) {
    const r = parseSaveText(text);
    if (!r.ok) return { ok: false, error: r.error, invalid: true };
    return this.write(slot, r.save, opts);
  }

  /** .bak が検証を通れば本体へ戻す（壊れている本体は .bak に混ぜない） */
  restoreBackup(slot, opts = {}) {
    const b = this.readBackup(slot);
    if (!b.ok) return { ok: false, error: 'バックアップも読み込めません: ' + b.error };
    if (opts.lock) {
      const l = opts.lock.ensure(slot);
      if (!l.ok) return { ok: false, error: '別のタブがこのスロットを使っています', lost: true };
    }
    const w = this.setRaw('slot' + slot, this.getRaw('slot' + slot + '.bak'));
    return w.ok ? { ok: true, save: b.save } : { ok: false, error: w.error };
  }

  exportSlot(slot) {
    const r = this.read(slot);
    return r.ok ? JSON.stringify(r.save) : null;
  }

  remove(slot, { backup = true } = {}) {
    if (!slotOk(slot)) return { ok: false };
    const a = this.removeRaw('slot' + slot);
    if (backup) this.removeRaw('slot' + slot + '.bak');
    return { ok: a.ok };
  }

  getLastSlot() {
    const n = parseInt(this.getRaw('lastSlot'), 10);
    return slotOk(n) ? n : null;
  }
  setLastSlot(slot) { if (slotOk(slot)) this.setRaw('lastSlot', String(slot)); }

  getGlobalAchievements() {
    try {
      const a = JSON.parse(this.getRaw('achievements') || '[]');
      return Array.isArray(a) ? [...new Set(a.filter((k) => typeof k === 'string' && ACH_IDS.has(k)))] : [];
    } catch (e) { return []; }
  }
  addGlobalAchievement(id) {
    if (typeof id !== 'string' || !ACH_IDS.has(id)) return { ok: false };
    const cur = this.getGlobalAchievements();
    if (cur.includes(id)) return { ok: true, added: false };
    cur.push(id);
    const r = this.setRaw('achievements', JSON.stringify(cur));
    return { ok: r.ok, added: r.ok };
  }
}

/* ───────── TabLock（同時タブ対策） ───────── */
let tabSeq = 0;
function makeTabId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(4);
      crypto.getRandomValues(a);
      return Array.from(a, (n) => n.toString(36)).join('-');
    }
  } catch (e) { /* フォールバックへ */ }
  tabSeq++;
  return 't' + Date.now().toString(36) + '-' + (typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000).toString(36) : '0') + '-' + tabSeq;
}

export class TabLock {
  /** storeNs: SaveStore（推奨）またはキー名前空間の文字列 */
  constructor(storeNs) {
    this.store = storeNs instanceof SaveStore ? storeNs : new SaveStore(undefined, typeof storeNs === 'string' ? storeNs : undefined);
    this.tabId = makeTabId();
    this.ttl = 8000;
    this.beatMs = 2000;
    this.held = new Map();
    this.lost = new Map();
    this.cbs = [];
    this.channel = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('emberveil');
        this.channel.onmessage = (e) => this._onMessage(e.data);
      }
    } catch (e) { this.channel = null; }
    try {
      if (typeof addEventListener === 'function') {
        addEventListener('storage', (e) => {
          if (!e.key || !e.key.startsWith(this.store.key('lock.slot'))) return;
          const slot = parseInt(e.key.slice(this.store.key('lock.slot').length), 10);
          if (this.held.has(slot)) this._checkTaken(slot);
        });
      }
    } catch (e) { /* storage イベントなし */ }
  }

  _name(slot) { return 'lock.slot' + slot; }
  _read(slot) {
    try {
      const t = this.store.getRaw(this._name(slot));
      if (!t) return null;
      const v = JSON.parse(t);
      if (isObj(v) && typeof v.tabId === 'string' && typeof v.ts === 'number' && Number.isFinite(v.ts)) return v;
    } catch (e) { /* 壊れたロックは無いものとして扱う */ }
    return null;
  }
  _write(slot) { return this.store.setRaw(this._name(slot), JSON.stringify({ tabId: this.tabId, ts: Date.now() })); }
  _valid(v) { const age=v?Date.now()-v.ts:Infinity;return !!v&&age>=0&&age<=this.ttl; }

  _lose(slot, reason = 'taken') {
    if (!this.held.has(slot)) return;
    this.held.delete(slot);
    this.lost.set(slot, reason);
    for (const cb of this.cbs) { try { cb(slot, reason); } catch (e) { /* 通知先の例外は無視 */ } }
  }
  _checkTaken(slot) {
    const cur = this._read(slot);
    if (cur && cur.tabId !== this.tabId && this._valid(cur)) { this._lose(slot, 'taken'); return true; }
    return false;
  }
  _onMessage(m) {
    if (isObj(m) && m.type === 'takeover' && m.tabId !== this.tabId && this.held.has(m.slot)) this._lose(m.slot, 'takeover');
  }

  /** スロットのロックを取る。他タブが有効なロックを持っていれば {ok:false, heldByOther:true}（takeover:true なら奪う） */
  acquire(slot, { takeover = false } = {}) {
    if (!slotOk(slot)) return { ok: false, heldByOther: false };
    const cur = this._read(slot);
    const other = !!cur && cur.tabId !== this.tabId && this._valid(cur);
    if (other && !takeover) return { ok: false, heldByOther: true };
    const w = this._write(slot);
    if (!w.ok) return { ok: false, heldByOther: false, error: w.error };
    const back = this._read(slot);
    if (!back || back.tabId !== this.tabId) return { ok: false, heldByOther: true };
    this.held.set(slot, true);
    this.lost.delete(slot);
    if (other && this.channel) { try { this.channel.postMessage({ type: 'takeover', slot, tabId: this.tabId }); } catch (e) { /* 通知失敗は無視 */ } }
    return { ok: true, heldByOther: false, tookOver: other };
  }

  /** 保存前・更新時の確認。自タブが所有し、他タブに奪われていなければ期限を更新して ok を返す */
  ensure(slot) {
    if (!this.held.has(slot)) return { ok: false, reason: this.lost.get(slot) || 'not-held' };
    const current = this._read(slot);
    // 他タブが一度取得した操作権は、期限が切れていても旧スナップショットで奪い直さない。
    // 再取得はacquire()と保存データの再読み込みを伴う明示的な操作で行う。
    if (!current || current.tabId !== this.tabId) {
      this._lose(slot, 'taken');
      return { ok: false, reason: 'taken' };
    }
    const w = this._write(slot);
    if (!w.ok) return { ok: false, reason: 'write', error: w.error };
    return { ok: true };
  }

  /** 受動的な確認：自タブが所有者で、期限が切れていないか（更新はしない） */
  isOwner(slot) {
    if (!this.held.has(slot) || this.lost.has(slot)) return false;
    const cur = this._read(slot);
    return !!cur && cur.tabId === this.tabId && this._valid(cur);
  }

  /** 2 秒ごとに呼ぶ。保持中の全スロットを更新し、奪われていれば通知する */
  heartbeat() {
    for (const slot of [...this.held.keys()]) this.ensure(slot);
  }

  release(slot) {
    const slots = slot === undefined ? [...this.held.keys()] : [slot];
    for (const s of slots) {
      const cur = this._read(s);
      if (this.held.has(s) && cur && cur.tabId === this.tabId) this.store.removeRaw(this._name(s));
      this.held.delete(s);
    }
  }

  onLost(cb) { if (typeof cb === 'function') this.cbs.push(cb); }
}

/* ───────── Game ───────── */
const ITEMS = D.ITEMS;
const SWORD_BY_GRADE = { 1: 'sword_stone', 2: 'sword_copper', 3: 'sword_crystal', 4: 'sword_ember' };
const PICKS = ['pick_ember', 'pick_crystal', 'pick_copper', 'pick_stone'];
const AXES = ['axe_ember', 'axe_crystal', 'axe_copper', 'axe_stone'];
const SWORDS = ['sword_ember', 'sword_crystal', 'sword_copper', 'sword_stone'];
const HAND_WEAPON = { atk: 3, swing: 0.35, stamina: 6, range: 1.2, arc: 90, pierce: 0, burn: false };
const HAND_TOOL = { tier: 0, power: 1, swing: 0.35 };
const PICK_FOR_TIER = { 1: 'pick_stone', 2: 'pick_copper', 3: 'pick_crystal' };
const STATION_KEYS = new Set(['workbench', 'campfire', 'furnace', 'cookpot']);
const MOVING_ACTIONS = new Set(['attack', 'mine', 'chop', 'gather', 'eat', 'cast']);
const DEG = Math.PI / 180;
const ITEM_WHERE = {
  capwood: '巨大茸（伐採）', stone: '岩壁・瓦礫', loam: '土壁', fiber: '苔草', glowcap: '光茸の群れ', gel: 'スライム・蛾', chitin: 'ダニ・甲虫・トカゲ',
  copper_ore: '銅鉱脈・瓦礫', coal: '石炭脈・瓦礫・炭焼き', crystal: '結晶脈・晶花', obsidian: '黒曜岩・亡者', ember_ore: '灼鉱脈・亡者',
  cap_spore: '巨大茸の伐採', seed_tuber: '野生の灯芋', seed_grain: '野生の苔麦', seed_pepper: '野生の炎唐辛子',
  tuber: '苗床で栽培', grain: '苗床で栽培', pepper: '苗床で栽培',
  fish_trout: '苔庭の水辺', fish_lumen: '苔庭の水辺', fish_shrimp: '結晶洞の水辺', fish_catfish: '結晶洞の水辺', fish_eel: '灼熱遺跡の温泉',
  fish_carp: '灼熱遺跡の温泉', fish_golden: '晶の核を得たあと、全水域で稀に',
};

const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const deepEq = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEq(a[k], b[k])) return false;
  return true;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function freshProgress() {
  return {
    hearts: { moss: false, crystal: false, ember: false }, gates: { crystal: false, ember: false },
    coreRestored: false, endingSeen: false, objective: 0,
    flags: { openedStarter: false, enteredCrystal: false, enteredEmber: false },
    unlocks: [], hintsSeen: [], codex: { item: [], enemy: [], fish: [], boss: [], biome: [] }, achievements: [],
  };
}
function freshStats() {
  return { mined: {}, crafted: {}, placed: {}, obtained: {}, killed: {}, fish: {}, harvested: 0, cooked: {}, deaths: 0, satchels: 0, bridges: 0, lights: 0, builds: 0 };
}
function freshInput() {
  return { moveX: 0, moveY: 0, held: { primary: false, interact: false, dodge: false, remove: false }, pressed: new Set(), pointer: null };
}
function makePlayer() {
  return {
    x: 64.5, y: 66.5, vx: 0, vy: 0, radius: PL.radius, angle: Math.PI / 2, dir8: 2, moving: false,
    hp: PL.hp, maxHp: PL.hp, stamina: PL.stamina, maxStamina: PL.stamina, hunger: PL.hungerStart, maxHunger: PL.hunger, exhausted: false,
    inventory: new Array(B.inventory.slots).fill(null), selected: 0, armor: null,
    action: { type: 'idle', t: 0, dur: 0, item: null, combo: 0 },
    invulnT: 0, hurtT: 0, burnT: 0, buffs: [],
    spawn: { x: 64, y: 66, kind: 'hub' }, target: null, placePreview: null, autoPath: null, inHeat: false, biome: 1,
    _sinceHit: 99, _staminaDelay: 0, _comboT: 0, _dodgeCd: 0, _salveCd: 0, _burnTick: 0, _stepT: 0, _dir: [0, 1], _sleepCd: 0, _deadT: 0,
    _lastBiome: 0, _hurtWarn: 0, _full: 0,
  };
}

export class Game {
  constructor(data = D) {
    this.data = data;
    this.version = D.VERSION;
    this.mode = 'title';
    this.paused = false;
    this.pauseReasons = new Set();
    this.readOnly = false;
    this.slot = null;
    this.worldId = 0;
    this.settings = { ...D.SETTINGS_DEFAULT };
    this.difficulty = 'standard';
    this.seed = '';
    this.time = 0;
    this.playTime = 0;
    this.rngState = 1;
    this.world = null;
    this.player = null;
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.hazards = [];
    this.drops = [];
    this.progress = freshProgress();
    this.stats = freshStats();
    this.input = freshInput();
    this.openContainer = null;
    this.channel = null;
    this.fishing = null;
    this.ending = null;
    this.eventSeq = 0;
    this.events = [];
    this.effects = [];
    this.genReport = null;
    this._resetRuntime();
  }

  _resetRuntime() {
    this._id = 1;
    this._regrow = new Set();
    this._planters = new Set();
    this._saplings = new Set();
    this._beds = new Set();
    this._dmgObjs = new Set();
    this._flow = { ground: null, air: null, t: 99, px: -1, py: -1 };
    this._spawnT = 0;
    this._exploreT = 0;
    this._progressT = 0;
    this._objCache = { t: -99, key: '', target: null };
    this._renderObjs = null;
    this._objDirty = true;
    this._tileObjs = new Map();
    this._rs = null;
    this._aimPtr = null;
    this._farT = new Map();
    this._toastT = {};
    this._pickWarnT = 0;
    this._sleep = null;
    this._burnWarn = 0;
    this._kills = 0;
  }

  /* ───── ユーティリティ ───── */
  rand() {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.rngState ^ (this.rngState >>> 15), 1 | this.rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  rint(a, b) { return a + Math.floor(this.rand() * (b - a + 1)); }
  nid() { return this._id++; }
  get diff() { return D.DIFFICULTY[this.difficulty] || D.DIFFICULTY.standard; }

  emit(type, payload) {
    const e = Object.freeze({ seq: ++this.eventSeq, t: this.time, type, ...payload });
    this.events.push(e);
    if (this.events.length > B.limits.events) this.events.shift();
    return e;
  }
  pollEvents(sinceSeq = 0) {
    const out = [];
    for (const e of this.events) if (e.seq > sinceSeq) out.push(e);
    return out;
  }
  toast(text, kind = 'info') { this.emit('toast', { text, kind }); }
  // 同じトーストの連打を抑える
  toastOnce(key, text, kind = 'info', gap = 1.5) {
    if (this.time - (this._toastT[key] ?? -99) < gap) return;
    this._toastT[key] = this.time;
    this.toast(text, kind);
  }

  fx(kind, x, y, text, color, duration = 0.7) {
    if (this.effects.length >= B.limits.effects) this.effects.shift();
    const e = { kind, x, y, age: 0, duration, color };
    if (text !== undefined && text !== null) e.text = String(text);
    this.effects.push(e);
  }
  _tickEffects(dt) {
    let j = 0;
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i];
      e.age += dt;
      if (e.age < e.duration) this.effects[j++] = e;
    }
    this.effects.length = j;
  }

  setPaused(reason, on) {
    if (on) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason);
    this.paused = this.pauseReasons.size > 0;
    if (on && this.fishing && (reason === 'menu' || reason === 'map' || reason === 'chest' || reason === 'dialog')) this._endFishing();
  }
  isSimRunning() { return !this.paused && !!this.world && (this.mode === 'playing' || this.mode === 'dead' || this.mode === 'ending'); }

  applySettings(s) {
    this.settings = normalizeSettings({ ...this.settings, ...(s || {}) }, D.SETTINGS_DEFAULT);
    if (s && typeof s.difficulty === 'string' && DIFFICULTIES.has(s.difficulty)) this.difficulty = s.difficulty;
  }

  setReadOnly(on = true) {
    this.readOnly = !!on;
    if (on) this.setPaused('readonly', true); else this.setPaused('readonly', false);
  }

  canSave() {
    if (!this.world || this.mode === 'title') return { ok: false, reason: 'title' };
    if (this.readOnly) return { ok: false, reason: 'readonly' };
    if (this.boss) return { ok: false, reason: 'boss' };
    if (this.mode === 'dead') return { ok: false, reason: 'dead' };
    if (this.mode === 'ending') return { ok: false, reason: 'ending' };
    return { ok: true, reason: null };
  }

  /* ───── ライフサイクル ───── */
  _install(world, o) {
    this._resetRuntime();
    this.world = world;
    this.player = o.player;
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.hazards = [];
    this.drops = o.drops || [];
    this.progress = o.progress;
    this.stats = o.stats;
    this.seed = o.seed;
    this.difficulty = o.difficulty;
    this.settings.difficulty = o.difficulty;
    this.time = o.time;
    this.playTime = o.playTime;
    this.rngState = o.rngState >>> 0;
    this.openContainer = null;
    this.channel = null;
    this.fishing = null;
    this.ending = null;
    this.effects = [];
    this.genReport = o.report || null;
    this.slot = o.slot ?? null;
    this.mode = 'playing';
    this.readOnly = false;
    for (const r of ['menu', 'map', 'chest', 'dialog', 'readonly']) this.pauseReasons.delete(r);
    this.paused = this.pauseReasons.size > 0;
    this.worldId++;
    for (const [i, ob] of world.objects) {
      if (ob.type === 'core' && i !== ob.y * W + ob.x) continue;
      this._trackObject(ob);
    }
    this._lastObjective = -1;
  }

  _trackObject(o) {
    const i = o.y * W + o.x;
    if (o.type === 'planter') this._planters.add(i);
    else if (o.type === 'sapling') this._saplings.add(i);
    else if (o.type === 'bed') this._beds.add(i);
    if (o.spent || o.stump) this._regrow.add(i);
    this._objDirty = true;
  }
  _untrackObject(o) {
    const i = o.y * W + o.x;
    this._planters.delete(i); this._saplings.delete(i); this._beds.delete(i); this._regrow.delete(i); this._dmgObjs.delete(i);
    this._objDirty = true;
  }

  newGame({ slot = null, seed, difficulty = 'standard' } = {}) {
    const gen = generateWorld(seed);
    const s = sanitizeSeed(seed) || 'HEARTH';
    const player = makePlayer();
    const diff = DIFFICULTIES.has(difficulty) ? difficulty : 'standard';
    this._install(gen.world, {
      player, progress: freshProgress(), stats: freshStats(), seed: s, difficulty: diff, time: 0, playTime: 0,
      rngState: hashSeed(s + ':sim'), slot, report: gen.report, drops: [],
    });
    this._afterInstall();
    this.emit('hint', { id: 'move' });
    this.progress.hintsSeen.push('move');
  }

  _afterInstall() {
    const w = this.world, p = this.player;
    w.boost = this.progress.coreRestored ? B.light.endingBoost : 0;
    const core = w.objectAt(63, 63);
    if (core && core.type === 'core') core.restored = this.progress.coreRestored;
    for (const k of ARENA_NAMES) {
      const a = w.anchors.arenas[k];
      const al = w.objectAt(a.cx, a.cy);
      if (al && al.type === 'altar') al.boss = !!this.progress.hearts[k];
    }
    w.rebuildLights();
    this._objDirty = true;
    this._recomputeSpawnTile();
    p.biome = w.biomeAt(Math.floor(p.x), Math.floor(p.y)) || 1;
    this.mode = 'playing';
    this._updateObjective(true);
  }

  resetToTitle() {
    this.mode = 'title';
    this.world = null;
    this.player = null;
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.hazards = [];
    this.drops = [];
    this.effects = [];
    this.openContainer = null;
    this.channel = null;
    this.fishing = null;
    this.ending = null;
    this.slot = null;
    this.pauseReasons.clear();
    this.paused = false;
    this.readOnly = false;
    this._resetRuntime();
    this.worldId++;
  }

  /** 検証済みのセーブから読み込む。一時インスタンスで組み立ててから入れ替えるので、失敗しても現在の状態は壊れない */
  loadFromSave(save, slot) {
    try {
      const v = validateSave(save);
      if (!v.ok) return { ok: false, error: v.errors[0] };
      const s = v.save;
      const gen = generateWorld(s.game.seed);
      const base = gen.world;
      if (!deepEq(base.anchors, s.world.anchors)) return { ok: false, error: '世界データが seed と一致しません' };
      const baseGround = base.ground.slice(), baseWall = base.wall.slice();
      const baseObjects = [...base.objects.values()];
      const w = base;
      const g = rleDecode(s.world.ground, D.GROUND.length - 1), wl = rleDecode(s.world.wall, D.WALL.length - 1), bd = rleDecode(s.world.build, D.BUILD.length - 1);
      w.ground.set(g); w.wall.set(wl); w.build.set(bd);
      w.objects.clear();
      for (let i = 0; i < N; i++) {
        if (w.flags[i] & FLAG.protected) { w.ground[i] = baseGround[i]; w.wall[i] = baseWall[i]; w.build[i] = 0; }
        if (w.wall[i] === WID.arena_barrier) w.wall[i] = 0;
      }
      for (const k of GATE_NAMES) {
        const open = s.progress.gates[k];
        for (const t of w.anchors.gates[k].tiles) {
          const i = t.y * W + t.x;
          w.wall[i] = open ? 0 : WID['gate_' + k];
          w.ground[i] = baseGround[i];
          w.build[i] = 0;
        }
      }
      // 壁の中の液体・保護領域の不整合を避けるため、壁のあるタイルに橋・床は残さない
      for (let i = 0; i < N; i++) if (w.wall[i] && w.build[i]) w.build[i] = 0;
      w.explored.set(b64ToBits(s.world.explored));
      for (const r of s.world.objects) {
        const o = makeObject(r.t, r.x, r.y);
        for (const k of Object.keys(r)) if (k !== 't' && k !== 'x' && k !== 'y') o[k] = clone(r[k]);
        w.setObject(o);
      }
      // 炉心・古い収納箱・祠の松明・祭壇は必ず存在させる
      for (const bo of baseObjects) {
        const need = bo.type === 'core' || bo.type === 'altar' || (bo.type === 'chest' && bo.starter) || (bo.type === 'torch' && bo.shrine);
        if (!need) continue;
        const cur = w.objects.get(bo.y * W + bo.x);
        if (cur && cur.type === bo.type) continue;
        if (bo.type === 'core') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.objects.delete((bo.y + dy) * W + bo.x + dx);
        else w.objects.delete(bo.y * W + bo.x);
        w.setObject(clone(bo));
      }
      for (const [i, ob] of [...w.objects]) {
        if (w.wall[i] && ob.type !== 'core') w.objects.delete(i);
      }
      const p = makePlayer();
      const sp = s.player;
      p.x = sp.x; p.y = sp.y; p.angle = sp.angle;
      p.hp = Math.max(1, sp.hp); p.maxHp = sp.maxHp; p.stamina = sp.stamina; p.hunger = sp.hunger;
      p.inventory = sp.inventory.map((x) => (x ? { id: x.id, n: x.n } : null));
      p.selected = sp.selected; p.armor = sp.armor;
      p.buffs = sp.buffs.map((b) => ({ id: b.id, t: b.t }));
      p.spawn = { ...sp.spawn };
      const sv = Math.sin(p.angle), cv = Math.cos(p.angle);
      p._dir = [cv, sv];
      const drops = s.world.drops.map((d) => ({ id: 0, item: d.item, n: d.n, x: d.x, y: d.y, t: d.t, lock: 0 }));
      this._install(w, {
        player: p, progress: clone(s.progress), stats: clone(s.stats), seed: s.game.seed, difficulty: s.game.difficulty,
        time: s.game.time, playTime: s.game.playTime, rngState: s.game.rngState, slot, report: gen.report, drops,
      });
      for (const d of this.drops) d.id = this.nid();
      this._afterInstall();
      this._repairPlayer();
      this._validateSpawn();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '読み込み中にエラーが発生しました: ' + (e && e.message ? e.message : e) };
    }
  }

  _repairPlayer() {
    const p = this.player, w = this.world;
    if (!this._boxBlocked(p.x, p.y, p.radius, false)) return;
    const t = this._nearestWalkable(Math.floor(p.x), Math.floor(p.y), (x, y) => w.isWalkable(x, y), 40);
    if (t) { p.x = t.x + 0.5; p.y = t.y + 0.5; } else { p.x = 64.5; p.y = 66.5; }
  }

  // 条件を満たす最も近いタイルを BFS で探す
  _nearestWalkable(sx, sy, ok, maxR = 30) {
    const w = this.world;
    const seen = new Set([sy * W + sx]);
    const q = [[sx, sy, 0]];
    for (let h = 0; h < q.length; h++) {
      const [x, y, d] = q[h];
      if (ok(x, y)) return { x, y };
      if (d >= maxR) continue;
      for (const [dx, dy] of ZB_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!w.inBounds(nx, ny) || seen.has(ny * W + nx)) continue;
        seen.add(ny * W + nx);
        q.push([nx, ny, d + 1]);
      }
    }
    return null;
  }

  _validateSpawn() {
    const p = this.player, w = this.world;
    if (p.spawn.kind === 'bed') {
      const o = w.objectAt(p.spawn.x, p.spawn.y);
      if (!o || o.type !== 'bed') p.spawn = { x: 64, y: 66, kind: 'hub' };
    }
  }
  _recomputeSpawnTile() { this._validateSpawn(); }

  toSave() {
    const w = this.world, p = this.player;
    if (!w || !p) return null;
    const objects = [];
    for (const [i, o] of w.objects) {
      if (o.type === 'core' && i !== o.y * W + o.x) continue;
      const r = { t: o.type, x: o.x, y: o.y };
      switch (o.type) {
        case 'chest': r.items = o.items.map((s) => (s ? { id: s.id, n: s.n } : null)); r.starter = !!o.starter; break;
        case 'satchel': r.items = o.items.map((s) => ({ id: s.id, n: s.n })); break;
        case 'planter': r.crop = o.crop || null; r.stage = o.stage | 0; r.growT = o.growT || 0; break;
        case 'sapling': r.growT = o.growT || 0; break;
        case 'cap_tree': r.stump = !!o.stump; r.regrowT = clamp(o.regrowT || 0, 0, 1000); break;
        case 'glowcap': case 'moss_grass': case 'rubble': case 'crystal_cluster': case 'wild_tuber': case 'wild_grain': case 'wild_pepper':
          r.spent = !!o.spent; r.regrowT = clamp(o.regrowT || 0, 0, 1000); break;
        case 'core': r.restored = !!o.restored; break;
        case 'altar': r.boss = !!o.boss; break;
        case 'torch': r.shrine = !!o.shrine; break;
        default: break;
      }
      objects.push(r);
    }
    const hearts = ARENA_NAMES.filter((k) => this.progress.hearts[k]).length;
    const obj = this.getObjective();
    return {
      format: D.SAVE_FORMAT, version: D.SAVE_VERSION, genVersion: D.GEN_VERSION, savedAt: new Date().toISOString(),
      meta: { seed: this.seed, difficulty: this.difficulty, playTime: this.playTime, hearts, coreRestored: this.progress.coreRestored, objective: obj ? obj.text : '' },
      game: { time: this.time, playTime: this.playTime, rngState: this.rngState >>> 0, difficulty: this.difficulty, seed: this.seed },
      world: {
        w: W, h: W, ground: rleEncode(w.ground), wall: rleEncode(w.wall), build: rleEncode(w.build), explored: bitsToB64(w.explored),
        anchors: clone(w.anchors), objects,
        drops: this.drops.map((d) => ({ item: d.item, n: d.n, x: clamp(d.x, 0, W), y: clamp(d.y, 0, W), t: clamp(d.t, 0, B.dropLife) })),
      },
      player: {
        x: clamp(p.x, 1, 127), y: clamp(p.y, 1, 127), angle: p.angle, hp: clamp(p.hp, 0, p.maxHp), maxHp: p.maxHp, stamina: clamp(p.stamina, 0, p.maxStamina),
        hunger: clamp(p.hunger, 0, p.maxHunger), inventory: p.inventory.map((s) => (s ? { id: s.id, n: s.n } : null)), selected: p.selected, armor: p.armor,
        buffs: p.buffs.filter((b) => b.t > 0).map((b) => ({ id: b.id, t: Math.min(900, b.t) })), spawn: { x: p.spawn.x, y: p.spawn.y, kind: p.spawn.kind },
      },
      progress: clone(this.progress),
      stats: clone(this.stats),
    };
  }

  /* ───── 所持品 ───── */
  itemCount(key) {
    if (!this.player) return 0;
    let n = 0;
    for (const s of this.player.inventory) if (s && s.id === key) n += s.n;
    return n;
  }
  tagCount(tag, exclude) {
    if (!this.player) return 0;
    let n = 0;
    for (const s of this.player.inventory) {
      if (!s) continue;
      const d = ITEMS[s.id];
      if (d.type === tag && !(exclude && exclude.includes(s.id))) n += s.n;
    }
    return n;
  }

  _addItem(id, n) {
    const stack = ITEMS[id].stack, inv = this.player.inventory;
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.id === id && s.n < stack) { const m = Math.min(n, stack - s.n); s.n += m; n -= m; }
    }
    for (let i = 0; i < inv.length && n > 0; i++) {
      if (!inv[i]) { const m = Math.min(n, stack); inv[i] = { id, n: m }; n -= m; }
    }
    return n;
  }

  _unlockCodex(cat, key) {
    const list = this.progress.codex[cat];
    if (!list || list.includes(key) || list.length >= 256) return;
    list.push(key);
    this.emit('codex', { category: cat, key });
  }

  // アイテムを持ち物へ入れる。入りきらない分は戻り値（呼び出し側が足元へ落とす）
  _collect(id, n) {
    const left = this._addItem(id, n);
    const got = n - left;
    if (got > 0) {
      this.stats.obtained[id] = Math.min(1e9, (this.stats.obtained[id] || 0) + got);
      const d = ITEMS[id];
      if (d.type === 'fish') this._unlockCodex('fish', id); else if (d.type !== 'place') this._unlockCodex('item', id);
      this.emit('pickup', { item: id, n: got });
    }
    return left;
  }

  giveItem(id, n, x, y) {
    const left = this._collect(id, n);
    if (left > 0) this.spawnDrop(id, left, x ?? this.player.x, y ?? this.player.y, 0.8);
    return left;
  }

  spawnDrop(item, n, x, y, lock = 0) {
    if (!ITEMS[item]||!Number.isFinite(n)||n <= 0) return;
    let left=Math.floor(n);
    while(left>0){
      const count=Math.min(left,ITEMS[item].stack);left-=count;
      if (this.drops.length >= B.limits.drops) this.drops.shift();
      const a = this.rand() * TAU, r = 0.15 + this.rand() * 0.3;
      let dx = x + Math.cos(a) * r, dy = y + Math.sin(a) * r;
      if (!this.world.isWalkable(Math.floor(dx), Math.floor(dy), true)) { dx = x; dy = y; }
      this.drops.push({ id: this.nid(), item, n:count, x: clamp(dx, 0.5, W - 0.5), y: clamp(dy, 0.5, W - 0.5), t: 0, lock });
    }
  }

  _removeItem(id, n) {
    const inv = this.player.inventory;
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && s.id === id) {
        const m = Math.min(n, s.n);
        s.n -= m; n -= m;
        if (s.n <= 0) inv[i] = null;
      }
    }
    return n === 0;
  }
  _removeTag(tag, n, exclude) {
    const inv = this.player.inventory;
    for (let i = 0; i < inv.length && n > 0; i++) {
      const s = inv[i];
      if (s && ITEMS[s.id].type === tag && !(exclude && exclude.includes(s.id))) {
        const m = Math.min(n, s.n);
        s.n -= m; n -= m;
        if (s.n <= 0) inv[i] = null;
      }
    }
    return n === 0;
  }

  selectHotbar(i) {
    if (!this.player || !Number.isInteger(i) || i < 0 || i > 7) return;
    if (this.player.selected !== i && this.fishing) this._endFishing();
    this.player.selected = i;
  }

  _ref(ref) {
    const p = this.player;
    if (!p || !ref) return null;
    if (ref.box === 'inv') return Number.isInteger(ref.i) && ref.i >= 0 && ref.i < p.inventory.length ? { box: 'inv', i: ref.i } : null;
    if (ref.box === 'chest') {
      const c = this._openChest();
      return c && Number.isInteger(ref.i) && ref.i >= 0 && ref.i < c.items.length ? { box: 'chest', i: ref.i } : null;
    }
    if (ref.box === 'armor') return { box: 'armor' };
    return null;
  }
  _openChest() {
    if (this.openContainer === null || !this.world) return null;
    const o = this.world.objects.get(this.openContainer);
    return o && o.type === 'chest' ? o : null;
  }
  _get(r) {
    const p = this.player;
    if (r.box === 'inv') return p.inventory[r.i];
    if (r.box === 'chest') return this._openChest().items[r.i];
    return p.armor ? { id: p.armor, n: 1 } : null;
  }
  _set(r, s) {
    const p = this.player;
    if (r.box === 'inv') p.inventory[r.i] = s;
    else if (r.box === 'chest') this._openChest().items[r.i] = s;
    else p.armor = s ? s.id : null;
  }
  _fits(r, s) { return !s || r.box !== 'armor' || ITEMS[s.id].type === 'armor'; }

  moveItem(from, to) {
    const a = this._ref(from), b = this._ref(to);
    if (!a || !b) return { ok: false, reason: '場所が不正です' };
    if (a.box === b.box && a.i === b.i) return { ok: true };
    const sa = this._get(a), sb = this._get(b);
    if (!sa) return { ok: false, reason: '空のスロットです' };
    if (!this._fits(b, sa) || !this._fits(a, sb)) return { ok: false, reason: 'ここには入れられません' };
    if (sb && sb.id === sa.id && b.box !== 'armor' && a.box !== 'armor') {
      const stack = ITEMS[sa.id].stack;
      if (sb.n < stack) {
        const m = Math.min(sa.n, stack - sb.n);
        sb.n += m; sa.n -= m;
        if (sa.n <= 0) this._set(a, null);
        return { ok: true };
      }
    }
    this._set(a, sb); this._set(b, sa);
    return { ok: true };
  }

  _putInto(box, s) {
    // 箱 / 持ち物の空き・同種スタックへ入れ、入りきらなかった個数を返す
    const stack = ITEMS[s.id].stack;
    let n = s.n;
    const arrList = box === 'chest' ? this._openChest().items : this.player.inventory;
    for (let i = 0; i < arrList.length && n > 0; i++) {
      const t = arrList[i];
      if (t && t.id === s.id && t.n < stack) { const m = Math.min(n, stack - t.n); t.n += m; n -= m; }
    }
    for (let i = 0; i < arrList.length && n > 0; i++) {
      if (!arrList[i]) { const m = Math.min(n, stack); arrList[i] = { id: s.id, n: m }; n -= m; }
    }
    return n;
  }

  transferStack(from) {
    const a = this._ref(from);
    if (!a || !this._openChest()) return { ok: false };
    const s = this._get(a);
    if (!s) return { ok: false };
    if (a.box === 'armor') {
      const left = this._putInto('inv', s);
      if (left === s.n) return { ok: false };
      this.player.armor = null;
      return { ok: true };
    }
    const toBox = a.box === 'inv' ? 'chest' : 'inv';
    const left = this._putInto(toBox, s);
    if (left === s.n) return { ok: false };
    if (left > 0) s.n = left; else this._set(a, null);
    return { ok: true };
  }

  splitStack(ref) {
    const a = this._ref(ref);
    if (!a || a.box === 'armor') return { ok: false };
    const s = this._get(a);
    if (!s || s.n < 2) return { ok: false };
    const list = a.box === 'chest' ? this._openChest().items : this.player.inventory;
    const empty = list.findIndex((x) => !x);
    if (empty < 0) return { ok: false };
    const half = Math.floor(s.n / 2);
    s.n -= half;
    list[empty] = { id: s.id, n: half };
    return { ok: true };
  }

  dropStack(ref) {
    const a = this._ref(ref);
    if (!a) return { ok: false };
    const s = this._get(a);
    if (!s) return { ok: false };
    this._set(a, null);
    const p = this.player;
    this.spawnDrop(s.id, s.n, p.x + p._dir[0] * 0.8, p.y + p._dir[1] * 0.8, 1.5);
    return { ok: true };
  }

  unequipArmor() {
    const p = this.player;
    if (!p || !p.armor) return { ok: false, reason: '防具を装備していません' };
    const left = this._addItem(p.armor, 1);
    if (left > 0) return { ok: false, reason: '持ち物がいっぱいです' };
    p.armor = null;
    return { ok: true };
  }

  useItem(ref) {
    const a = this._ref(ref);
    if (!a) return { ok: false, reason: '場所が不正です' };
    const s = this._get(a);
    if (!s) return { ok: false, reason: '空のスロットです' };
    const p = this.player, d = ITEMS[s.id];
    if (a.box === 'armor') return this.unequipArmor();
    if (a.box === 'chest') return { ok: false, reason: '持ち物から使ってください' };
    if (d.food && d.type !== 'seed') {
      const r = this._applyFood(s.id);
      if (!r.ok) return r;
      s.n -= 1;
      if (s.n <= 0) p.inventory[a.i] = null;
      return { ok: true };
    }
    if (d.type === 'armor') {
      const old = p.armor;
      s.n -= 1;
      if (s.n <= 0) p.inventory[a.i] = old ? { id: old, n: 1 } : null;
      else if (old) { const left = this._addItem(old, 1); if (left) this.spawnDrop(old, 1, p.x, p.y, 1); }
      p.armor = s.id;
      return { ok: true };
    }
    // 道具・設置物などはホットバーへ。すでにホットバーなら選択する
    if (a.i < B.inventory.hotbar) { this.selectHotbar(a.i); return { ok: true }; }
    let slot = p.inventory.findIndex((x, i) => i < B.inventory.hotbar && !x);
    if (slot < 0) slot = p.selected;
    const tmp = p.inventory[slot];
    p.inventory[slot] = s;
    p.inventory[a.i] = tmp;
    this.selectHotbar(slot);
    return { ok: true };
  }

  depositAll() {
    const c = this._openChest();
    if (!c) return { ok: false, moved: 0 };
    const p = this.player;
    let moved = 0;
    for (let i = B.inventory.hotbar; i < p.inventory.length; i++) {
      const s = p.inventory[i];
      if (!s) continue;
      const left = this._putInto('chest', s);
      moved += s.n - left;
      if (left > 0) s.n = left; else p.inventory[i] = null;
    }
    return { ok: moved > 0, moved };
  }
  depositMatching() {
    const c = this._openChest();
    if (!c) return { ok: false, moved: 0 };
    const kinds = new Set(c.items.filter(Boolean).map((s) => s.id));
    const p = this.player;
    let moved = 0;
    for (let i = 0; i < p.inventory.length; i++) {
      const s = p.inventory[i];
      if (!s || !kinds.has(s.id)) continue;
      const left = this._putInto('chest', s);
      moved += s.n - left;
      if (left > 0) s.n = left; else p.inventory[i] = null;
    }
    return { ok: moved > 0, moved };
  }
  takeAll() {
    const c = this._openChest();
    if (!c) return { ok: false, moved: 0 };
    let moved = 0;
    for (let i = 0; i < c.items.length; i++) {
      const s = c.items[i];
      if (!s) continue;
      const left = this._addItem(s.id, s.n);
      moved += s.n - left;
      if (left > 0) s.n = left; else c.items[i] = null;
    }
    return { ok: moved > 0, moved };
  }
  closeContainer() {
    if (this.openContainer === null) return;
    const idx = this.openContainer;
    this.openContainer = null;
    this.setPaused('chest', false);
    this.emit('chestClose', { idx, x: idx % W, y: (idx / W) | 0 });
  }

  /* ───── クラフト ───── */
  stationsNear() {
    const out = new Set();
    const p = this.player, w = this.world;
    if (!p || !w) return out;
    const R = PL.stationRange;
    for (let y = Math.floor(p.y - R); y <= Math.ceil(p.y + R); y++) {
      for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) {
        const o = w.objectAt(x, y);
        if (!o || !STATION_KEYS.has(o.type)) continue;
        const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
        if (dx * dx + dy * dy <= R * R) out.add(o.type);
      }
    }
    return out;
  }

  _recipeUnlocked(r) {
    if (!r.unlock) return true;
    if (r.unlock === 'core') return this.progress.coreRestored;
    return !!this.progress.hearts[r.unlock.slice(5)] || this.progress.unlocks.includes(r.unlock);
  }

  _ingredientView(ing) {
    if (ing.tag) {
      const nm = ing.tag === 'fish' ? '魚' : ing.tag;
      return { tag: ing.tag, name: nm + (ing.exclude ? '（黄金を除く）' : ''), need: ing.n, have: this.tagCount(ing.tag, ing.exclude) };
    }
    return { key: ing.key, name: ITEMS[ing.key].name, need: ing.n, have: this.itemCount(ing.key) };
  }

  _maxTimes(r) {
    let t = Infinity;
    for (const ing of r.in) {
      const have = ing.tag ? this.tagCount(ing.tag, ing.exclude) : this.itemCount(ing.key);
      t = Math.min(t, Math.floor(have / ing.n));
    }
    return Number.isFinite(t) ? t : 0;
  }

  getRecipeView() {
    const near = this.stationsNear();
    const out = [];
    for (const r of D.RECIPES) {
      if (!this._recipeUnlocked(r)) continue;
      const it = ITEMS[r.out];
      out.push({
        id: r.id, station: r.station, stationOk: r.station === null || near.has(r.station),
        out: { key: r.out, n: r.n, name: it.name, en: it.en }, ingredients: r.in.map((i) => this._ingredientView(i)),
        times: this._maxTimes(r), category: r.category,
      });
    }
    return out;
  }

  canCraft(id) {
    const r = D.RECIPES.find((x) => x.id === id);
    if (!r || !this._recipeUnlocked(r)) return { ok: false, times: 0, missing: [], station: null, stationOk: false };
    const near = this.stationsNear();
    const stationOk = r.station === null || near.has(r.station);
    const times = this._maxTimes(r);
    const missing = r.in.map((i) => this._ingredientView(i)).filter((v) => v.have < v.need).map((v) => ({ key: v.key || v.tag, need: v.need, have: v.have }));
    return { ok: stationOk && times >= 1, times, missing, station: r.station, stationOk };
  }

  craft(id, times = 1) {
    const r = D.RECIPES.find((x) => x.id === id);
    if (!r || !this._recipeUnlocked(r) || !this.player) return { ok: false, made: 0, reason: 'locked' };
    const c = this.canCraft(id);
    if (!c.stationOk) { this._hint('station'); this.toastOnce('station', '近くに ' + (D.STATIONS.find((s) => s.id === r.station) || {}).name + ' がありません', 'warn'); return { ok: false, made: 0, reason: 'station' }; }
    const n = Math.max(1, Math.min(Math.floor(times) || 1, c.times));
    if (c.times < 1) return { ok: false, made: 0, reason: 'material' };
    for (let k = 0; k < n; k++) {
      for (const ing of r.in) { if (ing.tag) this._removeTag(ing.tag, ing.n, ing.exclude); else this._removeItem(ing.key, ing.n); }
    }
    const total = r.n * n;
    this.giveItem(r.out, total);
    this.stats.crafted[id] = Math.min(1e9, (this.stats.crafted[id] || 0) + n);
    if (r.station === 'campfire' || r.station === 'cookpot') this.stats.cooked[id] = Math.min(1e9, (this.stats.cooked[id] || 0) + n);
    this.emit('craft', { recipe: id, item: r.out, n: total });
    this.fx('pickup', this.player.x, this.player.y, undefined, '#ffe39a');
    return { ok: true, made: total, reason: null };
  }

  /* ───── 移動と衝突 ───── */
  _boxBlocked(x, y, r, flying) {
    const w = this.world;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (!w.isWalkable(tx, ty, flying)) return true;
    return false;
  }

  // 軸ごとに衝突を解決する。動けたら true
  _tryMove(e, dx, dy, flying = false) {
    let moved = false;
    if (dx) {
      const nx = e.x + dx;
      if (!this._boxBlocked(nx, e.y, e.radius, flying)) { e.x = nx; moved = true; }
      else {
        const edge = dx > 0 ? Math.floor(nx + e.radius) - e.radius - 0.001 : Math.floor(nx - e.radius) + 1 + e.radius + 0.001;
        if (Math.abs(edge - e.x) < Math.abs(dx) && !this._boxBlocked(edge, e.y, e.radius, flying)) { if (Math.abs(edge - e.x) > 1e-4) moved = true; e.x = edge; }
      }
    }
    if (dy) {
      const ny = e.y + dy;
      if (!this._boxBlocked(e.x, ny, e.radius, flying)) { e.y = ny; moved = true; }
      else {
        const edge = dy > 0 ? Math.floor(ny + e.radius) - e.radius - 0.001 : Math.floor(ny - e.radius) + 1 + e.radius + 0.001;
        if (Math.abs(edge - e.y) < Math.abs(dy) && !this._boxBlocked(e.x, edge, e.radius, flying)) { if (Math.abs(edge - e.y) > 1e-4) moved = true; e.y = edge; }
      }
    }
    return moved;
  }

  // タイルのレイキャスト（壁のみが視線を遮る）
  _los(x0, y0, x1, y1) {
    const w = this.world;
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(d / 0.4);
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = Math.floor(x0 + dx * t), y = Math.floor(y0 + dy * t);
      const wl = w.wallAt(x, y);
      if (wl && wl !== WID.wall_glass) return false;
    }
    return true;
  }

  _rayLength(x, y, angle, max) {
    const w = this.world;
    const cx = Math.cos(angle), cy = Math.sin(angle);
    for (let d = 0.2; d < max; d += 0.2) {
      const wl = w.wallAt(Math.floor(x + cx * d), Math.floor(y + cy * d));
      if (wl && wl !== WID.wall_glass) return d;
    }
    return max;
  }

  /* ───── 状態の補助 ───── */
  _hint(id) {
    if (this.progress.hintsSeen.includes(id) || !D.HINTS[id]) return;
    this.progress.hintsSeen.push(id);
    this.emit('hint', { id });
  }

  _hasBuff(id) { return this.player.buffs.some((b) => b.id === id && b.t > 0); }
  _addBuff(id, t) {
    const p = this.player;
    const ex = p.buffs.find((b) => b.id === id);
    if (ex) ex.t = Math.max(ex.t, t);
    else if (p.buffs.length < 5) p.buffs.push({ id, t });
    else return;
    this.emit('buff', { id });
  }
  _updateBuffs(dt) {
    const p = this.player;
    let j = 0;
    for (let i = 0; i < p.buffs.length; i++) {
      const b = p.buffs[i];
      b.t -= dt;
      if (b.t > 0) p.buffs[j++] = b;
    }
    p.buffs.length = j;
  }
  _armorDef() { const p = this.player; return p.armor ? ITEMS[p.armor].armor : null; }
  _heatProtected() { const a = this._armorDef(); return !!(a && a.heat) || this._hasBuff('heat'); }

  _useStamina(n) {
    const p = this.player;
    p.stamina -= n;
    p._staminaDelay = PL.staminaDelay;
    if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; }
  }

  _busy() {
    const t = this.player.action.type;
    return t === 'attack' || t === 'mine' || t === 'chop' || t === 'gather' || t === 'eat' || t === 'cast' || t === 'dodge' || t === 'sleep' || t === 'channel' || t === 'dead';
  }
  _startAction(type, dur, extra) {
    const p = this.player;
    p.action = { type, t: 0, dur, item: null, combo: 0, ...extra };
  }
  _idle() {
    const p = this.player;
    p.action = { type: 'idle', t: 0, dur: 0, item: null, combo: p.action.combo || 0 };
  }

  _entityOverlapsTile(tx, ty) {
    const hit = (x, y, r) => {
      const cx = clamp(x, tx, tx + 1), cy = clamp(y, ty, ty + 1);
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy < r * r;
    };
    const p = this.player;
    if (hit(p.x, p.y, p.radius)) return true;
    for (const e of this.enemies) if (e.state !== 'dead' && hit(e.x, e.y, e.radius)) return true;
    if (this.boss && hit(this.boss.x, this.boss.y, this.boss.radius)) return true;
    return false;
  }
  _tileOccupied(tx, ty) { return this._entityOverlapsTile(tx, ty); }

  /* ───── 装備・武器 ───── */
  _best(list) { for (const k of list) if (this.itemCount(k) > 0) return k; return null; }
  _weaponStats(key) {
    if (!key) return HAND_WEAPON;
    const d = ITEMS[key];
    if (d.weapon) return d.weapon;
    if (d.tool) {
      const sw = ITEMS[SWORD_BY_GRADE[d.tool.grade]].weapon;
      return { atk: Math.floor(sw.atk * 0.5), swing: d.tool.swing, stamina: sw.stamina, range: sw.range, arc: sw.arc, pierce: sw.pierce, burn: sw.burn };
    }
    return HAND_WEAPON;
  }
  _bestWeaponKey() {
    let best = null, atk = HAND_WEAPON.atk;
    for (const k of [...SWORDS, ...PICKS, ...AXES]) {
      if (this.itemCount(k) <= 0) continue;
      const a = this._weaponStats(k).atk;
      if (a > atk) { best = k; atk = a; }
    }
    return best;
  }
  _currentWeaponKey() {
    const p = this.player;
    if (this.settings.autoTool) return this._bestWeaponKey();
    const s = p.inventory[p.selected];
    if (s) { const t = ITEMS[s.id].type; if (t === 'sword' || t === 'pick' || t === 'axe') return s.id; }
    return null;
  }
  _toolFor(kind) {
    const p = this.player;
    if (this.settings.autoTool) {
      const k = this._best(kind === 'pick' ? PICKS : AXES);
      return k ? { key: k, ...ITEMS[k].tool } : { key: null, ...HAND_TOOL };
    }
    const s = p.inventory[p.selected];
    if (s && ITEMS[s.id].type === kind) return { key: s.id, ...ITEMS[s.id].tool };
    return { key: null, ...HAND_TOOL };
  }

  /* ───── 更新ループ ───── */
  update(dt) {
    if (!this.isSimRunning()) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    this.playTime += dt;
    this._tickEffects(dt);
    const p = this.player;
    if (this.mode === 'ending') { this._updateEnding(dt); this._updateWorldTimers(dt); return; }
    if (this.mode === 'dead') { p._deadT += dt; p.action.t += dt; return; }
    this._updatePlayer(dt);
    if (this.mode !== 'playing') return;
    this._checkBossTrigger();
    this._updateBoss(dt);
    this._updateEnemies(dt);
    this._updateSpawner(dt);
    this._updateHazards(dt);
    this._updateProjectiles(dt);
    this._updateDrops(dt);
    this._updateWorldTimers(dt);
    this._updateExplore(dt);
    this._updateProgress(dt);
  }

  _updatePlayer(dt) {
    const p = this.player, w = this.world, inp = this.input || freshInput();
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p._sinceHit += dt;
    p._dodgeCd = Math.max(0, p._dodgeCd - dt);
    p._salveCd = Math.max(0, p._salveCd - dt);
    p._sleepCd = Math.max(0, p._sleepCd - dt);
    p._comboT = Math.max(0, p._comboT - dt);
    this._updateBuffs(dt);
    this._ptrTile = null;

    if (p.action.type === 'sleep') { this._updateSleep(dt); this._vitals(dt); return; }

    // 入力
    let mx = Number(inp.moveX) || 0, my = Number(inp.moveY) || 0;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const hasMove = ml > 0.01;
    const pressed = inp.pressed || new Set();
    this._handlePointer(inp);
    if (hasMove) {
      p.autoPath = null;
      this._autoGoal = null;
      if (this.channel) this.cancelChannel();
      if (this.fishing) this._endFishing();
    } else if (p.autoPath) {
      const ap = p.autoPath;
      let tgt = ap.pts[ap.i];
      while (tgt && Math.hypot(tgt.x - p.x, tgt.y - p.y) < 0.18) { ap.i++; tgt = ap.pts[ap.i]; }
      if (!tgt) {
        p.autoPath = null;
        const g = this._autoGoal;
        this._autoGoal = null;
        if (g) this._pointerAct(g.tx, g.ty);
      } else {
        const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.sqrt(dx * dx + dy * dy);
        mx = dx / d; my = dy / d;
      }
    }
    const moveNow = Math.abs(mx) > 0.01 || Math.abs(my) > 0.01;
    const a = p.action;
    const lockFace = a.type === 'attack' || a.type === 'mine' || a.type === 'chop' || a.type === 'gather' || a.type === 'dodge';
    if (moveNow && !lockFace && !this.fishing) {
      p.angle = Math.atan2(my, mx);
      p._dir = [Math.cos(p.angle), Math.sin(p.angle)];
    }
    p.dir8 = ((Math.round(p.angle / (Math.PI / 4)) % 8) + 8) % 8;

    this._computeTarget();
    this._computePreview();

    // ホットバー・クイック回復
    for (let n = 1; n <= 8; n++) if (pressed.has('hot' + n)) this.selectHotbar(n - 1);
    if (pressed.has('hotNext')) this.selectHotbar((p.selected + 1) % 8);
    if (pressed.has('hotPrev')) this.selectHotbar((p.selected + 7) % 8);
    if (pressed.has('quickHeal')) this._quickHeal();
    if (pressed.has('dodge')) this._tryDodge(mx, my, moveNow);
    if (pressed.has('remove')) this._removeFront();
    if (pressed.has('interact')) this._interact();
    if (pressed.has('primary') || (inp.held && inp.held.primary)) this._primary(pressed.has('primary'));

    this._stepAction(dt);
    this._updateChannel(dt);
    this._updateFishing(dt);

    // 移動
    p.moving = false;
    let speed = PL.speed;
    const at = p.action.type;
    if (MOVING_ACTIONS.has(at)) speed *= PL.actionSlow;
    if (at === 'dodge') {
      const v = (PL.dodgeDist / PL.dodgeTime) * dt;
      const ok = this._tryMove(p, p._dodgeVec[0] * v, p._dodgeVec[1] * v);
      p.moving = ok;
    } else if (at !== 'channel' && moveNow && at !== 'dead') {
      const mv = speed * dt;
      p.moving = this._tryMove(p, mx * mv, my * mv);
      if (!p.moving && p.autoPath) p.autoPath = null;
    }
    if (this._boxBlocked(p.x, p.y, p.radius, false)) this._repairPlayer();
    if (p.moving) {
      p._stepT -= dt;
      if (p._stepT <= 0) {
        p._stepT = 0.32;
        this.emit('step', { x: p.x, y: p.y, surface: this._surfaceAt(Math.floor(p.x), Math.floor(p.y)) });
      }
    }

    this._trackBiome();
    this._vitals(dt);
  }

  _surfaceAt(x, y) {
    const w = this.world;
    const b = w.buildAt(x, y);
    if (b) return D.BUILD[b].step || 'stone';
    return D.GROUND[w.groundAt(x, y)].step || 'stone';
  }

  _trackBiome() {
    const p = this.player, w = this.world;
    const b = w.biomeAt(Math.floor(p.x), Math.floor(p.y));
    if (!b || b === p.biome) return;
    p.biome = b;
    const key = D.BIOME_KEYS[b];
    const first = !this.progress.codex.biome.includes(key);
    this._unlockCodex('biome', key);
    if (b === 2) this.progress.flags.enteredCrystal = true;
    if (b === 3) this.progress.flags.enteredEmber = true;
    this.emit('biomeEnter', { biome: key, first });
  }

  _vitals(dt) {
    const p = this.player, d = this.diff;
    const heatProt = this._heatProtected();
    const inHeat = p.biome === 3 && !heatProt;
    if (inHeat !== p.inHeat) {
      p.inHeat = inHeat;
      this.emit('heat', { on: inHeat });
      if (inHeat) this._hint('heat');
    }
    const starving = p.hunger <= 0;
    const rate = PL.hungerRate * d.hunger * (inHeat ? PL.heatHungerMul : 1) * (this._hasBuff('rested') ? 0.7 : 1);
    p.hunger = Math.max(0, p.hunger - rate * dt);
    if (p._staminaDelay > 0) p._staminaDelay -= dt;
    else {
      const regen = PL.staminaRegen * (inHeat ? PL.heatStaminaMul : 1) * (starving ? PL.starveStaminaMul : 1) * (this._hasBuff('vigor') ? 1.5 : 1);
      p.stamina = Math.min(p.maxStamina, p.stamina + regen * dt);
    }
    if (p.exhausted && p.stamina >= PL.exhaustResume) p.exhausted = false;
    if (starving) {
      p.hp -= PL.starveDps * dt;
      if (p.hp <= 0) { p.hp = 0; this._die('starve'); return; }
    } else if (p._sinceHit >= PL.regenIdle) {
      const r = p.hunger >= 80 ? PL.regenHigh : p.hunger >= 50 ? PL.regenMid : 0;
      p.hp = Math.min(p.maxHp, p.hp + r * dt);
    }
    if (this._hasBuff('regen')) p.hp = Math.min(p.maxHp, p.hp + dt);
    const a = this._armorDef();
    if (p.burnT > 0) {
      if (a && a.burnImmune) p.burnT = 0;
      else {
        p.burnT -= dt;
        p._burnTick += dt;
        if (p._burnTick >= 1) { p._burnTick -= 1; this._directDamage(PL.burnDps, 'burn'); if (this.mode !== 'playing') return; }
      }
    } else p._burnTick = 0;
  }

  /* ───── 対象の決定 ───── */
  _objVerb(o) {
    const def = OBJ[o.type];
    if (!def) return null;
    switch (def.kind) {
      case 'chop': return o.stump ? null : 'chop';
      case 'mine': return o.spent ? null : 'mine';
      case 'gather': return o.spent ? null : 'gather';
      case 'core': return this.progress.coreRestored ? 'inspect' : 'offer';
      case 'altar': return 'inspect';
      case 'satchel': return 'recover';
      case 'station': return 'craft';
      case 'farm': return !o.crop ? 'plant' : o.stage >= 3 ? 'harvest' : 'inspect';
      case 'storage': return 'open';
      case 'bed': return 'sleep';
      default: return null;
    }
  }

  _classify(tx, ty) {
    const w = this.world;
    if (!w.inBounds(tx, ty)) return null;
    const i = ty * W + tx;
    const o = w.objects.get(i);
    if (o) {
      const def = OBJ[o.type];
      const verb = this._objVerb(o);
      if (verb || def.kind === 'chop' || def.kind === 'mine' || def.kind === 'gather') {
        const tag = o.stump ? '（切り株）' : o.spent ? '（再生中）' : '';
        return { x: tx, y: ty, kind: 'object', label: def.name + tag, action: verb };
      }
    }
    const wl = w.wall[i];
    if (wl) {
      const def = D.WALL[wl];
      return { x: tx, y: ty, kind: 'wall', label: def.name, action: def.hardness < 99 ? 'mine' : null };
    }
    const g = D.GROUND[w.ground[i]];
    if (g.liquid && !w.build[i]) {
      const s = this.player.inventory[this.player.selected];
      return { x: tx, y: ty, kind: 'water', label: g.name, action: s && s.id === 'fishing_rod' && g.fish ? 'fish' : null };
    }
    return null;
  }

  _candidateTiles() {
    const p = this.player;
    if (this._ptrTile) return [[this._ptrTile.tx, this._ptrTile.ty]];
    const fx = p._dir[0], fy = p._dir[1];
    const bx = Math.floor(p.x + fx * 1.0), by = Math.floor(p.y + fy * 1.0);
    const out = [[bx, by]];
    const side = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const vx = bx + ox + 0.5 - p.x, vy = by + oy + 0.5 - p.y;
      const l = Math.sqrt(vx * vx + vy * vy) || 1;
      const dot = (vx * fx + vy * fy) / l;
      if (dot > 0.35 && (ox === 0 || oy === 0)) side.push([dot, bx + ox, by + oy]);
    }
    side.sort((a, b) => b[0] - a[0]);
    for (const s of side) out.push([s[1], s[2]]);
    return out;
  }

  _findAttackTarget(range) {
    const p = this.player;
    const ang = p.angle;
    let best = null, bd = Infinity;
    const consider = (x, y, r, name, kind, ref) => {
      const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - r > range) return;
      if (Math.abs(angDiff(Math.atan2(dy, dx), ang)) > Math.PI / 3 + Math.atan2(r, Math.max(d, 0.2))) return;
      if (d < bd) { bd = d; best = { x, y, name, kind, ref }; }
    };
    for (const e of this.enemies) if (e.state !== 'dead') consider(e.x, e.y, e.radius, D.ENEMIES[e.type].name, 'enemy', e);
    const b = this.boss;
    if (b && b.state !== 'dying') {
      consider(b.x, b.y, b.radius, b.name, 'boss', b);
      for (const dc of b.decoys) if (dc.alive) consider(dc.x, dc.y, 0.6, b.name, 'decoy', dc);
    }
    return best;
  }

  _computeTarget() {
    const p = this.player;
    p.target = null;
    const wp = this._weaponStats(this._currentWeaponKey());
    const en = this._findAttackTarget(wp.range);
    if (en) { p.target = { x: Math.floor(en.x), y: Math.floor(en.y), kind: 'enemy', label: en.name, action: 'attack' }; return; }
    for (const [tx, ty] of this._candidateTiles()) {
      const c = this._classify(tx, ty);
      if (c) { p.target = c; return; }
    }
  }

  _computePreview() {
    const p = this.player;
    const sel = p.inventory[p.selected];
    if (!sel || ITEMS[sel.id].type !== 'place') { p.placePreview = null; return; }
    let tx, ty;
    const ap = this._aimPtr;
    if (ap && this.time - ap.t < 3 && Math.hypot(ap.tx + 0.5 - p.x, ap.ty + 0.5 - p.y) <= PL.pointerRange) { tx = ap.tx; ty = ap.ty; }
    else { tx = Math.floor(p.x + p._dir[0]); ty = Math.floor(p.y + p._dir[1]); }
    p.placePreview = { x: tx, y: ty, item: sel.id, valid: this._canPlace(ITEMS[sel.id], tx, ty).ok };
  }

  /* ───── ポインタ ───── */
  _handlePointer(inp) {
    const ptr = inp.pointer;
    if (!ptr) return;
    const p = this.player, w = this.world;
    if (!Number.isFinite(ptr.tx) || !Number.isFinite(ptr.ty) || !w.inBounds(ptr.tx, ptr.ty)) return;
    this._aimPtr = { tx: ptr.tx, ty: ptr.ty, t: this.time };
    const d = Math.hypot(ptr.tx + 0.5 - p.x, ptr.ty + 0.5 - p.y);
    if (d <= PL.pointerRange) {
      this._pointerAct(ptr.tx, ptr.ty);
      return;
    }
    const pts = this._findPath(Math.floor(p.x), Math.floor(p.y), ptr.tx, ptr.ty);
    if (pts) { p.autoPath = { pts, i: 0 }; this._autoGoal = { tx: ptr.tx, ty: ptr.ty }; }
    else this.toastOnce('nopath', 'そこへは行けない', 'warn');
  }

  _pointerAct(tx, ty) {
    const p = this.player, w = this.world;
    const cx = tx + 0.5, cy = ty + 0.5;
    if (Math.hypot(cx - p.x, cy - p.y) > PL.pointerRange + 0.5) return;
    if (this._busy() && !this.fishing) return;
    p.angle = Math.atan2(cy - p.y, cx - p.x);
    p._dir = [Math.cos(p.angle), Math.sin(p.angle)];
    this._ptrTile = { tx, ty };
    this._aimPtr = { tx, ty, t: this.time };
    const o = w.objectAt(tx, ty);
    const enemyNear = this.enemies.some((e) => e.state !== 'dead' && Math.hypot(e.x - p.x, e.y - p.y) < 5) || !!this.boss;
    this._computeTarget();
    this._computePreview();
    if (o && this._isInteractable(o) && !enemyNear) { this._interact(o); return; }
    const sel = p.inventory[p.selected];
    const useType = !!sel && (ITEMS[sel.id].type === 'place' || ITEMS[sel.id].type === 'rod' || ITEMS[sel.id].type === 'seed' || !!ITEMS[sel.id].food || sel.id === 'cap_spore');
    if (p.target || useType) this._primary(true);
  }

  _isInteractable(o) {
    const k = OBJ[o.type].kind;
    return k === 'station' || k === 'farm' || k === 'storage' || k === 'bed' || k === 'core' || k === 'altar' || k === 'satchel';
  }

  _findPath(sx, sy, gx, gy) {
    const w = this.world;
    const key = (x, y) => y * W + x;
    const start = key(sx, sy);
    const open = [[Math.abs(sx - gx) + Math.abs(sy - gy), 0, sx, sy]];
    const g = new Map([[start, 0]]);
    const par = new Map();
    const closed = new Set();
    let expanded = 0, goalNode = null;
    const near = (x, y) => Math.hypot(x - gx, y - gy) <= 1.5 && !(x === gx && y === gy && !w.isWalkable(x, y));
    while (open.length && expanded < 400) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cg, x, y] = open.splice(bi, 1)[0];
      const k = key(x, y);
      if (closed.has(k)) continue;
      closed.add(k);
      expanded++;
      if (near(x, y) || (x === gx && y === gy)) { goalNode = k; break; }
      for (const [dx, dy] of ZB_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!w.isWalkable(nx, ny)) continue;
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = cg + 1;
        if (ng > 60) continue;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          par.set(nk, k);
          open.push([ng + Math.abs(nx - gx) + Math.abs(ny - gy), ng, nx, ny]);
        }
      }
    }
    if (goalNode === null) return null;
    const pts = [];
    for (let c = goalNode; c !== undefined; c = par.get(c)) pts.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
    pts.reverse();
    pts.shift();
    return pts;
  }

  /* ───── 主行動 ───── */
  _isEmptyPlanter(t) {
    const o = this.world.objectAt(t.x, t.y);
    return !!o && o.type === 'planter' && !o.crop;
  }

  _primary(press) {
    const p = this.player;
    if (this.fishing) { if (press) this._fishPress(); return; }
    if (this._busy()) return;
    const sel = p.inventory[p.selected];
    const def = sel ? ITEMS[sel.id] : null;
    const t = p.target;
    if (def) {
      if (def.type === 'place') { if (press) this._placeSelected(); return; }
      if (def.type === 'rod') { if (press) this._startFishing(); return; }
      if (def.type === 'seed') {
        if (press) {
          if (t && t.kind === 'object' && this._isEmptyPlanter(t)) { const r = this.plantAt(t.x, t.y, sel.id); if (!r.ok) this.toast(r.reason, 'warn'); }
          else this.toast('苗床に向かって使おう', 'info');
        }
        return;
      }
      if (sel.id === 'cap_spore') {
        if (press) {
          const c = this._candidateTiles()[0];
          const r = this.plantAt(c[0], c[1], 'cap_spore');
          if (!r.ok) this.toast(r.reason, 'warn');
        }
        return;
      }
      if (def.food) {
        if (sel.id === 'glowcap' && t && t.kind === 'object' && this._isEmptyPlanter(t)) {
          if (press) { const r = this.plantAt(t.x, t.y, 'glowcap'); if (!r.ok) this.toast(r.reason, 'warn'); }
          return;
        }
        if (press) this._startEat(p.selected);
        return;
      }
    }
    // 戦闘・採掘・採集
    const wKey = this._currentWeaponKey();
    const wp = this._weaponStats(wKey);
    if (t && t.kind === 'enemy') { this._startAttack(wKey, wp); return; }
    if (t && t.kind === 'wall' && t.action === 'mine') { this._startMine(t, 'wall'); return; }
    if (t && t.kind === 'object') {
      if (t.action === 'chop') { this._startMine(t, 'chop'); return; }
      if (t.action === 'mine') { this._startMine(t, 'obj'); return; }
      if (t.action === 'gather') { this._startGather(t); return; }
    }
    this._startAttack(wKey, wp);
  }

  _startAttack(key, wp) {
    const p = this.player;
    if (p.exhausted || p.stamina <= 0) { this.toastOnce('tired', '息切れ中だ', 'warn', 1.5); return; }
    const combo = p._comboT > 0 ? (p.action.combo + 1) % 3 : 0;
    this._startAction('attack', wp.swing, { item: key, combo, weapon: wp, hit: false });
    this._useStamina(wp.stamina);
    this.emit('swing', { who: 'player', item: key, x: p.x, y: p.y, angle: p.angle });
    // 避ける敵は、振り始めを見て横へ跳ぶ
    for (const e of this.enemies) {
      const def = D.ENEMIES[e.type];
      if (e.state === 'dead' || !def.dodger || e.dodgeCd > 0 || e.state === 'windup' || e.state === 'attack') continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) > 2) continue;
      const ang = Math.atan2(e.y - p.y, e.x - p.x) + (this.rand() < 0.5 ? 1 : -1) * Math.PI / 2;
      e.dodgeT = 0.25; e.dodgeVec = [Math.cos(ang) * 6, Math.sin(ang) * 6]; e.dodgeCd = B.enemy.dodgeCd;
    }
  }

  _attackHit(a) {
    const p = this.player, wp = a.weapon;
    const mul = a.combo === 2 ? B.dmg.comboMul : 1, kb = a.combo === 2 ? B.dmg.comboKb : 1;
    const half = (wp.arc * DEG) / 2;
    const inArc = (x, y, r) => {
      const dx = x - p.x, dy = y - p.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d - r > wp.range) return false;
      if (d > 0.3 && Math.abs(angDiff(Math.atan2(dy, dx), p.angle)) > half + Math.atan2(r, d)) return false;
      return this._los(p.x, p.y, x, y);
    };
    this.fx('slash', p.x + p._dir[0] * 0.6, p.y + p._dir[1] * 0.6, undefined, '#fff0c2', 0.25);
    for (const e of this.enemies) {
      if (e.state === 'dead' || !inArc(e.x, e.y, e.radius)) continue;
      const def = D.ENEMIES[e.type];
      let dmg = Math.max(1, wp.atk - Math.max(0, def.def - wp.pierce));
      dmg = Math.max(1, Math.floor(dmg * mul * (e.state === 'recover' ? B.dmg.recoverMul : 1)));
      e.hp -= dmg;
      e.hitFlashT = 0.12;
      const ang = Math.atan2(e.y - p.y, e.x - p.x);
      e.kbx = Math.cos(ang) * 6 * kb; e.kby = Math.sin(ang) * 6 * kb; e.kbT = 0.12 * kb;
      if (wp.burn) e.burnT = 3;
      if (e.state === 'idle' || e.state === 'wander' || e.state === 'return') { e.state = 'chase'; e.stateT = 0; e.lostT = 0; }
      this.emit('hit', { target: 'enemy', id: e.id, x: e.x, y: e.y, dmg, kind: a.item || 'fist', combo: a.combo });
      this.fx('hit', e.x, e.y, this.settings.showDamageNumbers ? dmg : undefined, '#ffdc8c');
      if (e.hp <= 0) this._killEnemy(e);
    }
    const b = this.boss;
    if (b && b.state !== 'dying') {
      for (const dc of b.decoys) {
        if (!dc.alive || !inArc(dc.x, dc.y, 0.6)) continue;
        dc.alive = false;
        this.emit('hit', { target: 'decoy', id: dc.id, x: dc.x, y: dc.y, dmg: 1, kind: a.item || 'fist', combo: a.combo });
        this.fx('hit', dc.x, dc.y, undefined, '#b4d0ff');
      }
      if (inArc(b.x, b.y, b.radius)) {
        let dmg = Math.max(1, wp.atk - Math.max(0, b.def - wp.pierce));
        dmg = Math.max(1, Math.floor(dmg * mul * (b.state === 'stunned' ? B.dmg.stunMul : 1)));
        this._damageBoss(dmg, a);
      }
    }
  }

  _startMine(t, mode) {
    const p = this.player, w = this.world;
    const kind = mode === 'chop' ? 'axe' : 'pick';
    const tool = this._toolFor(kind === 'axe' ? 'axe' : 'pick');
    if (mode === 'wall') {
      const wl = w.wall[t.y * W + t.x];
      const def = D.WALL[wl];
      if (!def || def.hardness >= 99) return;
      if (w.flags[t.y * W + t.x] & FLAG.protected) { this.toastOnce('prot', 'ここは掘れない', 'warn'); return; }
      if (def.hardness > tool.tier) {
        const need = PICK_FOR_TIER[def.hardness];
        this.emit('mineBlocked', { x: t.x, y: t.y, wall: def.key, need: def.hardness });
        this.toastOnce('hard', '硬すぎる — ' + (need ? ITEMS[need].name : '強い道具') + 'が必要', 'warn');
        return;
      }
    }
    p.angle = Math.atan2(t.y + 0.5 - p.y, t.x + 0.5 - p.x);
    p._dir = [Math.cos(p.angle), Math.sin(p.angle)];
    this._startAction(mode === 'chop' ? 'chop' : 'mine', tool.swing, { item: tool.key, tool, tx: t.x, ty: t.y, mode, hit: false });
    this._useStamina(mode === 'chop' ? PL.chopStamina : PL.mineStamina);
    this.emit('swing', { who: 'player', item: tool.key, x: p.x, y: p.y, angle: p.angle });
  }

  _startGather(t) {
    const p = this.player;
    p.angle = Math.atan2(t.y + 0.5 - p.y, t.x + 0.5 - p.x);
    p._dir = [Math.cos(p.angle), Math.sin(p.angle)];
    this._startAction('gather', PL.gatherTime, { tx: t.x, ty: t.y, hit: false });
  }

  _stepAction(dt) {
    const p = this.player, a = p.action;
    if (a.type === 'idle' || a.type === 'walk' || a.type === 'hurt' || a.type === 'dead') {
      if (a.type === 'hurt') { a.t += dt; if (a.t >= a.dur) this._idle(); }
      return;
    }
    if (a.type === 'channel' || a.type === 'fish') return;
    a.t += dt;
    switch (a.type) {
      case 'attack': if (!a.hit && a.t >= a.dur * PL.hitAt) { a.hit = true; this._attackHit(a); } break;
      case 'mine': case 'chop': if (!a.hit && a.t >= a.dur * PL.hitAt) { a.hit = true; this._toolHit(a); } break;
      case 'gather': if (!a.hit && a.t >= a.dur * 0.7) { a.hit = true; this._gatherHit(a); } break;
      case 'eat': if (a.t >= a.dur) this._finishEat(a); break;
      case 'cast': if (a.t >= a.dur) { if (this.fishing) { this.fishing.phase = 'wait'; this.fishing.t = 0; } a.type = 'fish'; a.t = 0; a.dur = 999; } break;
      case 'dodge': if (a.t >= a.dur) { p._dodgeCd = PL.dodgeCooldown; this._idle(); } break;
      default: break;
    }
    if (a.type === 'attack' || a.type === 'mine' || a.type === 'chop' || a.type === 'gather') {
      if (a.t >= a.dur) {
        p._comboT = PL.comboWindow;
        const combo = a.type === 'attack' ? a.combo : 0;
        this._idle();
        p.action.combo = combo;
      }
    }
  }

  _toolHit(a) {
    const w = this.world, p = this.player;
    const i = a.ty * W + a.tx;
    const power = a.tool.power;
    if (a.mode === 'wall') {
      const wl = w.wall[i];
      if (!wl) return;
      const def = D.WALL[wl];
      if (def.hardness >= 99) return;
      const hp = def.hp;
      const e = w.wallDamage.get(i) || { dmg: 0, max: hp, t: 0 };
      e.dmg += power; e.t = 0; e.max = hp;
      w.wallDamage.set(i, e);
      w.dirty(a.tx, a.ty);
      this.emit('mineHit', { x: a.tx + 0.5, y: a.ty + 0.5, wall: def.key, ratio: Math.min(1, e.dmg / hp) });
      this.fx('hit', a.tx + 0.5, a.ty + 0.5, undefined, D.WALL[wl].mapColor, 0.3);
      if (e.dmg >= hp) {
        w.wallDamage.delete(i);
        w.setWall(a.tx, a.ty, 0);
        if (def.drop) this.spawnDrop(def.drop.item, this.rint(def.drop.min, def.drop.max), a.tx + 0.5, a.ty + 0.5);
        else if (def.placed) this.spawnDrop(def.placed, 1, a.tx + 0.5, a.ty + 0.5);
        if (!def.placed) this.stats.mined[def.key] = Math.min(1e9, (this.stats.mined[def.key] || 0) + 1);
        this.emit('tileBreak', { x: a.tx + 0.5, y: a.ty + 0.5, wall: def.key });
        this._objDirty = true;
      }
      return;
    }
    const o = w.objects.get(i);
    if (!o) return;
    const def = OBJ[o.type];
    o.dmg = (o.dmg || 0) + power;
    o.dmgT = 0;
    this._dmgObjs.add(i);
    this._objDirty = true;
    if (a.mode === 'chop') this.emit('chop', { x: a.tx + 0.5, y: a.ty + 0.5 });
    else this.emit('mineHit', { x: a.tx + 0.5, y: a.ty + 0.5, wall: o.type, ratio: Math.min(1, o.dmg / def.hp) });
    if (o.dmg < def.hp) return;
    o.dmg = 0;
    this._dmgObjs.delete(i);
    const cx = a.tx + 0.5, cy = a.ty + 0.5;
    if (o.type === 'cap_tree') {
      o.stump = true; o.regrowT = B.regrow.cap_tree;
      this.spawnDrop('capwood', B.treeDrops.capwood, cx, cy);
      if (this.rand() < B.treeDrops.cap_spore) this.spawnDrop('cap_spore', 1, cx, cy);
      this.emit('treeFall', { x: cx, y: cy });
    } else if (o.type === 'rubble') {
      o.spent = true; o.regrowT = B.regrow.rubble;
      this.spawnDrop('stone', B.rubbleDrops.stone, cx, cy);
      if (this.rand() < B.rubbleDrops.copper_ore) this.spawnDrop('copper_ore', 1, cx, cy);
      if (this.rand() < B.rubbleDrops.coal) this.spawnDrop('coal', 1, cx, cy);
      this.emit('tileBreak', { x: cx, y: cy, wall: 'rubble' });
    } else if (o.type === 'crystal_cluster') {
      o.spent = true; o.regrowT = B.regrow.crystal_cluster;
      this.spawnDrop('crystal', B.crystalDrop, cx, cy);
      this.emit('tileBreak', { x: cx, y: cy, wall: 'crystal_cluster' });
    }
    this.stats.mined[o.type] = Math.min(1e9, (this.stats.mined[o.type] || 0) + 1);
    this._regrow.add(i);
    w.syncObjectLight(o);
    w.dirty(o.x, o.y);
    this._flow.t = 99;
  }

  _gatherHit(a) {
    const w = this.world;
    const o = w.objectAt(a.tx, a.ty);
    if (!o || o.spent || OBJ[o.type].kind !== 'gather') return;
    const cx = a.tx + 0.5, cy = a.ty + 0.5;
    const drops = {
      glowcap: [['glowcap', 2]], moss_grass: [['fiber', 2]],
      wild_tuber: [['seed_tuber', 1], ['tuber', 1]], wild_grain: [['seed_grain', 2], ['grain', 1]], wild_pepper: [['seed_pepper', 1], ['pepper', 1]],
    }[o.type] || [];
    let first = null;
    for (const [item, n] of drops) { this.spawnDrop(item, n, cx, cy); first = first || item; }
    o.spent = true;
    o.regrowT = o.type === 'glowcap' ? B.regrow.glowcap : o.type === 'moss_grass' ? B.regrow.moss_grass : B.regrow.wild;
    this._regrow.add(a.ty * W + a.tx);
    w.syncObjectLight(o);
    w.dirty(o.x, o.y);
    this._objDirty = true;
    this.emit('gather', { x: cx, y: cy, objType: o.type, item: first });
    this.fx('pickup', cx, cy, undefined, '#6ff0d2', 0.5);
  }

  /* ───── 回避 ───── */
  _tryDodge(mx, my, moving) {
    const p = this.player;
    if (p.exhausted || p.stamina < PL.dodgeCost || p._dodgeCd > 0) return;
    const t = p.action.type;
    if (t === 'dodge' || t === 'sleep' || t === 'dead' || t === 'channel') return;
    if (this.fishing) this._endFishing();
    let vx = moving ? mx : p._dir[0], vy = moving ? my : p._dir[1];
    const l = Math.sqrt(vx * vx + vy * vy) || 1;
    vx /= l; vy /= l;
    p._dodgeVec = [vx, vy];
    this._useStamina(PL.dodgeCost);
    this._startAction('dodge', PL.dodgeTime, {});
    p.invulnT = Math.max(p.invulnT, PL.dodgeInvuln);
    p.angle = Math.atan2(vy, vx);
    p._dir = [vx, vy];
    this.emit('dodge', { x: p.x, y: p.y, angle: p.angle });
    this.fx('dodge', p.x, p.y, undefined, '#9aa7a8', 0.35);
  }

  /* ───── 食事 ───── */
  _foodNeeds(d) {
    const p = this.player, f = d.food;
    const buffs=[...(f.buffs||[]),...(f.buff?[f.buff]:[])];
    if(buffs.some(b=>(p.buffs.find(active=>active.id===b.id)?.t||0)<b.t-.5))return true;
    if (f.full) return p.hunger < p.maxHunger - 0.5 || p.hp < p.maxHp - 0.5;
    const wantHunger = (f.hunger || 0) > 0 && p.hunger < p.maxHunger - 0.5;
    const wantHp = (f.hp || 0) > 0 && p.hp < p.maxHp - 0.5;
    return wantHunger || wantHp;
  }

  _applyFood(id) {
    const p = this.player, d = ITEMS[id], f = d.food;
    if (!f) return { ok: false, reason: '食べられない' };
    if (d.type === 'potion' && p._salveCd > 0) return { ok: false, reason: 'まだ使えない' };
    if (!this._foodNeeds(d)) return { ok: false, reason: d.type === 'potion' ? 'HP は満タンだ' : 'おなかも HP も満タンだ' };
    if (f.full) { p.hunger = p.maxHunger; p.hp = p.maxHp; }
    else { p.hunger = Math.min(p.maxHunger, p.hunger + (f.hunger || 0)); p.hp = Math.min(p.maxHp, p.hp + (f.hp || 0)); }
    if (f.buff) this._addBuff(f.buff.id, f.buff.t);
    if (f.buffs) for (const b of f.buffs) this._addBuff(b.id, b.t);
    if (f.cooldown) p._salveCd = f.cooldown;
    this.emit('eat', { item: id });
    this.fx('heal', p.x, p.y, undefined, '#9be08a', 0.6);
    if (id === 'golden_feast') this._unlockAchievement('feast');
    return { ok: true };
  }

  _startEat(slotIdx) {
    const p = this.player;
    const s = p.inventory[slotIdx];
    if (!s) return;
    const d = ITEMS[s.id];
    if (d.type === 'potion' && p._salveCd > 0) { this.toastOnce('salve', 'まだ使えない', 'info'); return; }
    if (!this._foodNeeds(d)) { this.toastOnce('full', d.type === 'potion' ? 'HP は満タンだ' : 'おなかも HP も満タンだ', 'info'); return; }
    this._startAction('eat', PL.eatTime, { item: s.id, slot: slotIdx });
  }

  _finishEat(a) {
    const p = this.player;
    const s = p.inventory[a.slot];
    this._idle();
    if (!s || s.id !== a.item) return;
    const r = this._applyFood(s.id);
    if (!r.ok) { this.toast(r.reason, 'info'); return; }
    s.n -= 1;
    if (s.n <= 0) p.inventory[a.slot] = null;
  }

  _quickHeal() {
    const p = this.player;
    if (p.action.type === 'dead' || p.action.type === 'sleep') return;
    let pick = null;
    if (p.hp < p.maxHp * 0.5 && this.itemCount('salve') > 0 && p._salveCd <= 0) pick = 'salve';
    else {
      let best = -1;
      for (const s of p.inventory) {
        if (!s) continue;
        const d = ITEMS[s.id];
        if (!d.food || d.type === 'seed' || d.type === 'potion') continue;
        const gain = d.food.full ? 100 : Math.min(d.food.hunger || 0, p.maxHunger - p.hunger);
        if (gain > best && this._foodNeeds(d)) { best = gain; pick = s.id; }
      }
      if (!pick && this.itemCount('salve') > 0 && p.hp < p.maxHp - 0.5 && p._salveCd <= 0) pick = 'salve';
    }
    if (!pick) { this.toastOnce('noheal', '回復できるものがない', 'info'); return; }
    if (this._busy()) return;
    const idx = p.inventory.findIndex((s) => s && s.id === pick);
    this._startAction('eat', PL.eatTime, { item: pick, slot: idx });
  }

  /* ───── 設置・撤去 ───── */
  _canPlace(def, tx, ty) {
    const w = this.world, p = this.player;
    if (!w.inBounds(tx, ty)) return { ok: false, reason: 'ここには置けない' };
    if (Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) > PL.pointerRange + 0.3) return { ok: false, reason: '遠すぎる' };
    const i = ty * W + tx;
    if (w.flags[i] & (FLAG.protected | FLAG.arena | FLAG.noBuild)) return { ok: false, reason: 'ここには置けない' };
    const g = D.GROUND[w.ground[i]];
    const pl = def.place;
    if(pl.layer==='object'&&w.objects.size-(w.objectAt(63,63)?.type==='core'?3:0)>=B.limits.objects-1)return {ok:false,reason:'建物と資源の数が上限に達した。撤去してから置こう'};
    if (w.wall[i]) return { ok: false, reason: 'ここには置けない' };
    const o = w.objects.get(i);
    if (pl.layer === 'bridge') {
      const bd = D.BUILD[BID[pl.key]];
      if (!g.liquid || !g.bridge.includes(bd.bridge)) return { ok: false, reason: g.liquid === 'lava' ? '溶岩には石橋しか架けられない' : '水や裂け目の上にしか架けられない' };
      if (w.build[i] || o) return { ok: false, reason: 'ここには置けない' };
      return { ok: true };
    }
    if (!g.walk) return { ok: false, reason: 'ここには置けない' };
    if (pl.layer === 'floor') return w.build[i] || o ? { ok: false, reason: 'ここには置けない' } : { ok: true };
    if (o || w.build[i] >= BID.bridge_wood) return { ok: false, reason: 'ここには置けない' };
    if (pl.layer === 'wall' || OBJ[pl.key].block) {
      if (this._entityOverlapsTile(tx, ty)) return { ok: false, reason: '何かが邪魔で置けない' };
    }
    if (pl.key === 'chest') {
      let n = 0;
      for (const ob of w.objects.values()) if (ob.type === 'chest') n++;
      if (n >= B.inventory.chestMax) return { ok: false, reason: '収納箱は ' + B.inventory.chestMax + ' 個までだ' };
    }
    return { ok: true };
  }

  _placeSelected() {
    const p = this.player, w = this.world;
    const sel = p.inventory[p.selected];
    const pv = p.placePreview;
    if (!sel || !pv) return;
    const def = ITEMS[sel.id];
    const chk = this._canPlace(def, pv.x, pv.y);
    if (!chk.ok) { this.toastOnce('place', chk.reason, 'warn', 0.8); return; }
    const pl = def.place;
    if (pl.layer === 'object') {
      const o = makeObject(pl.key, pv.x, pv.y);
      w.setObject(o);
      this._trackObject(o);
      w.syncObjectLight(o);
      if (OBJ[pl.key].kind === 'light') this.stats.lights = Math.min(1e9, this.stats.lights + 1);
      if (OBJ[pl.key].kind === 'decor') this.stats.builds = Math.min(1e9, this.stats.builds + 1);
    } else if (pl.layer === 'wall') {
      w.setWall(pv.x, pv.y, WID[pl.key]);
      this.stats.builds = Math.min(1e9, this.stats.builds + 1);
    } else if (pl.layer === 'floor') {
      w.setBuild(pv.x, pv.y, BID[pl.key]);
      this.stats.builds = Math.min(1e9, this.stats.builds + 1);
    } else {
      w.setBuild(pv.x, pv.y, BID[pl.key]);
      this.stats.bridges = Math.min(1e9, this.stats.bridges + 1);
    }
    this.stats.placed[sel.id] = Math.min(1e9, (this.stats.placed[sel.id] || 0) + 1);
    sel.n -= 1;
    if (sel.n <= 0) p.inventory[p.selected] = null;
    this._objDirty = true;
    this._flow.t = 99;
    this.emit('place', { x: pv.x + 0.5, y: pv.y + 0.5, item: def.key, layer: pl.layer });
    this.fx('build', pv.x + 0.5, pv.y + 0.5, undefined, '#ffdc8c', 0.4);
  }

  _removeFront() {
    for (const [tx, ty] of this._candidateTiles()) {
      const r = this._removeAt(tx, ty);
      if (r === true) return;
      if (typeof r === 'string') { this.toastOnce('remove', r, 'warn', 0.8); return; }
    }
    this.toastOnce('remove0', '撤去できるものがない', 'info', 0.8);
  }

  // 撤去できたら true、できない理由があれば文字列、対象なしなら false
  _removeAt(tx, ty) {
    const w = this.world, p = this.player;
    if (!w.inBounds(tx, ty)) return false;
    const i = ty * W + tx;
    const o = w.objects.get(i);
    const prot = (w.flags[i] & FLAG.protected) !== 0;
    if (o) {
      const def = OBJ[o.type];
      if (!def.item || def.natural) { if (def.natural || o.type === 'satchel') return 'これは撤去できない'; }
      if (def.item) {
        if (prot || (o.type === 'torch' && o.shrine)) return 'これは撤去できない';
        if (o.type === 'chest' && o.items.some(Boolean)) return '中身のある箱は撤去できない';
        const refund = [{ item: def.item, n: 1 }];
        if (o.type === 'planter' && o.crop) refund.push({ item: D.CROPS[o.crop].seed, n: 1 });
        w.deleteObject(o);
        w.removeLight(i);
        this._untrackObject(o);
        for (const r of refund) this.giveItem(r.item, r.n);
        if (o.type === 'bed' && p.spawn.kind === 'bed' && p.spawn.x === tx && p.spawn.y === ty) p.spawn = { x: 64, y: 66, kind: 'hub' };
        this.emit('remove', { x: tx + 0.5, y: ty + 0.5, item: def.item, layer: 'object' });
        this._flow.t = 99;
        return true;
      }
    }
    const wl = w.wall[i];
    if (wl >= WID.wall_wood && wl <= WID.wall_gold) {
      if (prot) return 'これは撤去できない';
      w.setWall(tx, ty, 0);
      this.giveItem(D.WALL[wl].placed, 1);
      this.emit('remove', { x: tx + 0.5, y: ty + 0.5, item: D.WALL[wl].placed, layer: 'wall' });
      this._objDirty = true; this._flow.t = 99;
      return true;
    }
    const b = w.build[i];
    if (b) {
      if (prot) return 'これは撤去できない';
      if (b >= BID.bridge_wood && this._entityOverlapsTile(tx, ty)) return '上に何かがいる橋は撤去できない';
      w.setBuild(tx, ty, 0);
      this.giveItem(D.BUILD[b].key, 1);
      this.emit('remove', { x: tx + 0.5, y: ty + 0.5, item: D.BUILD[b].key, layer: b >= BID.bridge_wood ? 'bridge' : 'floor' });
      this._objDirty = true; this._flow.t = 99;
      return true;
    }
    return false;
  }

  /* ───── 調べる ───── */
  _findInteract() {
    const p = this.player, w = this.world;
    const R = PL.interactRange;
    let best = null, bd = Infinity;
    const t = this._ptrTile;
    for (let y = Math.floor(p.y - R - 1); y <= Math.ceil(p.y + R + 1); y++) {
      for (let x = Math.floor(p.x - R - 1); x <= Math.ceil(p.x + R + 1); x++) {
        const o = w.objectAt(x, y);
        if (!o || !this._isInteractable(o)) continue;
        const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d > R + (o.type === 'core' ? 0.2 : 0)) continue;
        const dot = d > 0.01 ? (dx * p._dir[0] + dy * p._dir[1]) / d : 1;
        d -= dot * 0.35;
        if (t && t.tx === x && t.ty === y) d -= 5;
        if (d < bd) { bd = d; best = o; }
      }
    }
    return best;
  }

  _interact(forced) {
    const p = this.player, w = this.world;
    if (this._busy() && !this.fishing) return;
    if (this.fishing) { this._endFishing(); }
    const o = forced || this._findInteract();
    if (!o) { this.toastOnce('nothing', '調べるものがない', 'info', 1); return; }
    const def = OBJ[o.type];
    const x = o.x, y = o.y;
    switch (def.kind) {
      case 'station':
        this.emit('interact', { kind: 'station', station: def.station, x: x + 0.5, y: y + 0.5 });
        break;
      case 'storage':
        this.openContainer = y * W + x;
        if (o.starter && !this.progress.flags.openedStarter) this.progress.flags.openedStarter = true;
        this.setPaused('chest', true);
        this.emit('chestOpen', { idx: this.openContainer, x: x + 0.5, y: y + 0.5 });
        break;
      case 'bed': this._trySleep(o); break;
      case 'farm': this._interactPlanter(o); break;
      case 'core': {
        const n = ARENA_NAMES.filter((k) => this.progress.hearts[k]).length;
        if (this.progress.coreRestored) this.toast('炉心は温かく燃えている', 'info');
        else if (n < 3) this.toast('炉心は冷たい — 守護者の核が足りない（' + n + '/3）', 'info');
        this.emit('interact', { kind: 'core', ready: n === 3 && !this.progress.coreRestored, hearts: n, x: 64, y: 64 });
        break;
      }
      case 'altar': {
        const key = ARENA_NAMES.find((k) => { const a = w.anchors.arenas[k]; return a.cx === x && a.cy === y; });
        const bs = D.BOSSES[key];
        if(!bs){this.toast('この祭壇は反応しない','warn');return;}
        this.toast(bs.name + ' — ' + bs.desc, 'info');
        this.emit('interact', { kind: 'altar', boss: key, defeated: !!this.progress.hearts[key], x: x + 0.5, y: y + 0.5 });
        break;
      }
      case 'satchel': this._recoverSatchel(o); break;
      default: break;
    }
  }

  _interactPlanter(o) {
    const w = this.world;
    if (!o.crop) {
      const sel = this.player.inventory[this.player.selected];
      const seedKey = sel && (ITEMS[sel.id].type === 'seed' || sel.id === 'glowcap') ? sel.id : null;
      if (seedKey) { const r = this.plantAt(o.x, o.y, seedKey); if (!r.ok) this.toast(r.reason, 'warn'); return; }
      const seeds = [...new Set(this.player.inventory.filter((s) => s && (ITEMS[s.id].type === 'seed' || s.id === 'glowcap')).map((s) => s.id))];
      this.emit('interact', { kind: 'planter', x: o.x + 0.5, y: o.y + 0.5, seeds });
      if (!seeds.length) this.toast('植えられる種がない', 'info');
      return;
    }
    if (o.stage >= 3) { this._harvestPlanter(o); return; }
    this.toast(o.dark ? '暗すぎて育たない — 灯りを置こう' : '育っている（' + o.stage + '/3）', 'info');
  }

  _harvestPlanter(o) {
    const c = D.CROPS[o.crop];
    const n = this.rint(c.yield.min, c.yield.max);
    this.giveItem(c.yield.item, n, o.x + 0.5, o.y + 0.5);
    if (c.seedBack) {
      let s = c.seedBack.n;
      if (this.rand() < c.seedBack.bonusChance) s += 1;
      this.giveItem(c.seedBack.item, s, o.x + 0.5, o.y + 0.5);
    }
    this.stats.harvested = Math.min(1e9, this.stats.harvested + 1);
    this.emit('harvest', { x: o.x + 0.5, y: o.y + 0.5, objType: 'planter', item: c.yield.item });
    o.crop = null; o.growT = 0; o.stage = 0; o.dark = false;
    this._objDirty = true;
  }

  plantAt(x, y, seedKey) {
    const p = this.player, w = this.world;
    if (!p || !w || !Number.isInteger(x) || !Number.isInteger(y) || !w.inBounds(x, y)) return { ok: false, reason: 'ここには植えられない' };
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > PL.stationRange) return { ok: false, reason: '遠すぎる' };
    const sd = ITEMS[seedKey];
    if (!sd || !(sd.type === 'seed' || seedKey === 'glowcap' || seedKey === 'cap_spore')) return { ok: false, reason: '植えられないものだ' };
    if (this.itemCount(seedKey) < 1) return { ok: false, reason: '持っていない' };
    const i = y * W + x;
    if (seedKey === 'cap_spore') {
      if(w.objects.size-(w.objectAt(63,63)?.type==='core'?3:0)>=B.limits.objects-1)return {ok:false,reason:'建物と資源の数が上限に達した。撤去してから植えよう'};
      const g = w.ground[i];
      if ((w.flags[i] & (FLAG.protected | FLAG.arena | FLAG.noBuild)) || w.wall[i] || w.objects.has(i) || w.build[i] || (g !== GID.moss_floor && g !== GID.loam_floor)) return { ok: false, reason: '苔床か土の床にしか植えられない' };
      if (this._entityOverlapsTile(x, y)) return { ok: false, reason: '何かが邪魔で植えられない' };
      const o = makeObject('sapling', x, y);
      w.setObject(o);
      this._trackObject(o);
      this._removeItem('cap_spore', 1);
      this.emit('plant', { x: x + 0.5, y: y + 0.5, crop: 'sapling' });
      return { ok: true };
    }
    const o = w.objects.get(i);
    if (!o || o.type !== 'planter') return { ok: false, reason: '苗床に植えよう' };
    if (o.crop) return { ok: false, reason: 'すでに育てている' };
    o.crop = sd.plant;
    o.growT = 0; o.stage = 0;
    this._removeItem(seedKey, 1);
    this._objDirty = true;
    this.emit('plant', { x: x + 0.5, y: y + 0.5, crop: o.crop });
    return { ok: true };
  }

  _recoverSatchel(o) {
    const w = this.world;
    const keep = [];
    for (const s of o.items) {
      const left = this._collect(s.id, s.n);
      if (left > 0) keep.push({ id: s.id, n: left });
    }
    o.items = keep;
    if (!keep.length) {
      w.deleteObject(o);
      w.removeLight(o.y * W + o.x);
      this._untrackObject(o);
      this.stats.satchels = Math.min(1e9, this.stats.satchels + 1);
      this.emit('satchelRecovered', {});
      this.toast('遺灰袋を回収した', 'info');
    } else this.toast('持ち物がいっぱいで、一部は袋に残った', 'warn');
  }

  /* ───── 睡眠 ───── */
  _trySleep(bed) {
    const p = this.player;
    if (p._sleepCd > 0) { this.toast('まだ眠れない（あと ' + Math.ceil(p._sleepCd) + ' 秒）', 'info'); return; }
    if (this.boss) { this.toast('戦いの最中は眠れない', 'warn'); return; }
    for (const e of this.enemies) if (e.state !== 'dead' && Math.hypot(e.x - p.x, e.y - p.y) <= B.sleep.enemyRange) { this.toast('近くに敵がいて眠れない', 'warn'); return; }
    this._startAction('sleep', B.sleep.fade, { bed: bed.y * W + bed.x });
    p.invulnT = B.sleep.fade + 0.2;
    p.autoPath = null;
  }

  _updateSleep(dt) {
    const p = this.player, a = p.action;
    a.t += dt;
    if (a.t < a.dur) return;
    const bed = this.world.objects.get(a.bed);
    this._idle();
    p.hp = p.maxHp; p.stamina = p.maxStamina;
    p.hunger = Math.max(0, p.hunger - B.sleep.hunger);
    p._sleepCd = B.sleep.cooldown;
    p.burnT = 0;
    if (bed && bed.type === 'bed') p.spawn = { x: bed.x, y: bed.y, kind: 'bed' };
    this._addBuff('rested', B.sleep.restedTime);
    this._advanceWorld(B.sleep.skip);
    this.time += B.sleep.skip;
    this.emit('sleep', { x: p.x, y: p.y });
  }

  _advanceWorld(sec) {
    const step = 5;
    for (let t = 0; t < sec; t += step) this._updateWorldTimers(Math.min(step, sec - t));
  }

  /* ───── 帰還 ───── */
  startReturn() {
    const p = this.player;
    if (!p || this.mode !== 'playing') return { ok: false, reason: '今は使えない' };
    if (this.channel) return { ok: false, reason: 'すでに詠唱中' };
    if (this._busy() && p.action.type !== 'fish') return { ok: false, reason: '今は使えない' };
    if (this.fishing) this._endFishing();
    this.channel = { kind: 'return', t: 0, dur: B.channel.return };
    this._startAction('channel', B.channel.return, {});
    this.emit('channelStart', { kind: 'return' });
    return { ok: true };
  }
  cancelChannel() {
    if (!this.channel) return { ok: false, reason: '詠唱していない' };
    this.channel = null;
    if (this.player && this.player.action.type === 'channel') this._idle();
    this.emit('channelCancel', { kind: 'return' });
    return { ok: true };
  }
  _updateChannel(dt) {
    const c = this.channel;
    if (!c) return;
    c.t += dt;
    if (c.t < c.dur) return;
    this.channel = null;
    const p = this.player;
    this._idle();
    if (this.boss) this._resetBoss(true);
    const pos = this._spawnPos();
    p.x = pos.x; p.y = pos.y;
    p.autoPath = null;
    this._clearEnemiesNear(p.x, p.y, 10);
    this.emit('channelDone', { kind: 'return' });
    this.emit('respawn', { cause: 'return', x: p.x, y: p.y });
  }

  _spawnPos() {
    const p = this.player, w = this.world;
    this._validateSpawn();
    if (p.spawn.kind === 'bed') {
      const t = this._nearestWalkable(p.spawn.x, p.spawn.y, (x, y) => (x !== p.spawn.x || y !== p.spawn.y) && w.isWalkable(x, y) && !(w.flags[y * W + x] & FLAG.arena), 6);
      if (t) return { x: t.x + 0.5, y: t.y + 0.5 };
    }
    return { x: 64.5, y: 66.5 };
  }

  _clearEnemiesNear(x, y, r) {
    let j = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (Math.hypot(e.x - x, e.y - y) > r) this.enemies[j++] = e;
    }
    this.enemies.length = j;
  }

  /* ───── 釣り ───── */
  _startFishing() {
    const p = this.player, w = this.world;
    let found = null;
    for (let d = 0.7; d <= B.fishing.range + 0.05 && !found; d += 0.25) {
      const tx = Math.floor(p.x + p._dir[0] * d), ty = Math.floor(p.y + p._dir[1] * d);
      if (!w.inBounds(tx, ty)) break;
      const i = ty * W + tx;
      if (w.wall[i]) break;
      const g = D.GROUND[w.ground[i]];
      if (g.fish && !w.build[i]) found = { x: tx, y: ty };
    }
    if (!found) { this.toastOnce('nowater', '水辺に向かって使おう', 'info', 1); return; }
    const wait = B.fishing.waitMin + this.rand() * (B.fishing.waitMax - B.fishing.waitMin);
    this.fishing = { phase: 'cast', t: 0, wait, x: found.x + 0.5, y: found.y + 0.5 };
    this._startAction('cast', B.fishing.cast, {});
    this.emit('fishCast', { x: found.x + 0.5, y: found.y + 0.5, item: null, reason: null });
    this.emit('splash', { x: found.x + 0.5, y: found.y + 0.5 });
  }

  _endFishing() {
    this.fishing = null;
    const p = this.player;
    if (p && (p.action.type === 'fish' || p.action.type === 'cast')) this._idle();
  }

  _updateFishing(dt) {
    const f = this.fishing;
    if (!f || f.phase === 'cast') return;
    f.t += dt;
    if (f.phase === 'wait' && f.t >= f.wait) {
      f.phase = 'bite'; f.t = 0;
      this.emit('fishBite', { x: f.x, y: f.y, item: null, reason: null });
    } else if (f.phase === 'bite' && f.t >= this.diff.fishWindow) {
      this.emit('fishMiss', { x: f.x, y: f.y, item: null, reason: 'late' });
      this.toast('逃げられた', 'info');
      this._endFishing();
    }
  }

  _fishPress() {
    const f = this.fishing;
    if (!f) return;
    if (f.phase === 'cast') return;
    if (f.phase === 'wait') {
      f.wait += B.fishing.early;
      this.emit('fishMiss', { x: f.x, y: f.y, item: null, reason: 'early' });
      this.toastOnce('early', '早すぎた', 'info', 0.6);
      return;
    }
    const item = this._rollFish(f);
    this.giveItem(item, 1, this.player.x, this.player.y);
    this.stats.fish[item] = Math.min(1e9, (this.stats.fish[item] || 0) + 1);
    this._unlockCodex('fish', item);
    this.emit('fishCatch', { x: f.x, y: f.y, item, reason: null });
    this.fx('fish', f.x, f.y, undefined, '#6ff0d2', 0.8);
    this.toast(ITEMS[item].name + ' を釣った', 'info');
    if (item === 'fish_golden') this._unlockAchievement('golden');
    this._endFishing();
  }

  _rollFish(f) {
    const w = this.world;
    const i = Math.floor(f.y) * W + Math.floor(f.x);
    const hot = w.ground[i] === GID.hot_spring;
    const b = hot ? 'hot' : D.BIOME_KEYS[w.biome[i]] || D.BIOME_KEYS[this.player.biome] || 'moss';
    const pool = D.FISH.filter((fi) => (fi.water === b || fi.water === 'any') && (!fi.needs || this.progress.hearts[fi.needs]));
    const total = pool.reduce((s, fi) => s + fi.weight, 0);
    let r = this.rand() * total;
    for (const fi of pool) { r -= fi.weight; if (r <= 0) return fi.key; }
    return pool[0].key;
  }

  /* ───── 被ダメージ・死亡・復活 ───── */
  _hurtPlayer(raw, src = {}, opts = {}) {
    const p = this.player;
    if (this.mode !== 'playing' || p.invulnT > 0) return false;
    const a = this._armorDef();
    let fin = Math.max(Math.ceil(raw * B.dmg.armorFloor), raw - (a ? a.def : 0)) * this.diff.damage;
    fin = Math.max(1, Math.round(fin));
    p.hp -= fin;
    p.invulnT = opts.tick ? 0.05 : PL.invuln;
    p.hurtT = 0.3;
    p._sinceHit = 0;
    if (this.boss) this.boss.tookDamage = true;
    if (this.channel) this.cancelChannel();
    if (this.fishing) this._endFishing();
    if (p.action.type === 'eat') this._idle();
    if (src.x !== undefined && !opts.tick) {
      const dx = p.x - src.x, dy = p.y - src.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
      this._tryMove(p, (dx / l) * PL.knockback, (dy / l) * PL.knockback);
    }
    if (src.burn && !(a && a.burnImmune)) p.burnT = Math.max(p.burnT, src.burn);
    this.emit('playerHurt', { dmg: fin, x: p.x, y: p.y, source: src.kind || 'enemy' });
    this.emit('hit', { target: 'player', id: 0, x: p.x, y: p.y, dmg: fin, kind: src.kind || 'enemy', combo: 0 });
    this.fx('hurt', p.x, p.y, this.settings.showDamageNumbers ? fin : undefined, '#e0583a');
    if (p.action.type === 'idle' || p.action.type === 'walk') p.action = { type: 'hurt', t: 0, dur: 0.18, item: null, combo: 0 };
    if (p.hp <= 0) { p.hp = 0; this._die(src.name || src.kind || '不明'); }
    return true;
  }

  _directDamage(n, cause) {
    const p = this.player;
    p.hp -= n;
    this.emit('playerHurt', { dmg: n, x: p.x, y: p.y, source: cause });
    this.fx('hurt', p.x, p.y, this.settings.showDamageNumbers ? n : undefined, '#ff7a3a');
    if (p.hp <= 0) { p.hp = 0; this._die(cause); }
  }

  _die(cause) {
    if (this.mode !== 'playing') return;
    const p = this.player;
    p.hp = 0;
    this.mode = 'dead';
    p.action = { type: 'dead', t: 0, dur: PL.deathAnim, item: null, combo: 0 };
    p._deadT = 0;
    p.autoPath = null;
    p.burnT = 0;
    this.channel = null;
    this.fishing = null;
    if (this.boss) this._resetBoss();
    this.lastDeathCause = cause;
    this._dropSatchel();
    this.stats.deaths = Math.min(1e9, this.stats.deaths + 1);
    this.emit('death', { cause: String(cause), x: p.x, y: p.y });
    this.fx('death', p.x, p.y, undefined, '#e0583a', 1.2);
    this._hint('satchel');
    this._hint('return');
  }

  _dropSatchel() {
    const p = this.player, w = this.world;
    const items = [];
    for (let i = B.inventory.hotbar; i < p.inventory.length; i++) if (p.inventory[i]) { items.push(p.inventory[i]); p.inventory[i] = null; }
    let old = null;
    for (const o of w.objects.values()) if (o.type === 'satchel') { old = o; break; }
    if (!items.length && !old) return;
    if (old) { for (const s of old.items) items.push(s); w.deleteObject(old); w.removeLight(old.y * W + old.x); this._untrackObject(old); }
    const merged = new Map();
    for (const s of items) merged.set(s.id, (merged.get(s.id) || 0) + s.n);
    const stacks = [];
    for (const [id, n] of merged) {
      let left = n;
      const st = ITEMS[id].stack;
      while (left > 0) { const m = Math.min(left, st); stacks.push({ id, n: m }); left -= m; }
    }
    const t0 = { x: Math.floor(p.x), y: Math.floor(p.y) };
    const spot = this._nearestWalkable(t0.x, t0.y, (x, y) => {
      const i = y * W + x;
      return w.inBounds(x, y) && w.isWalkable(x, y) && !(w.flags[i] & (FLAG.protected | FLAG.arena)) && !w.objects.has(i);
    }, 60) || { x: 64, y: 67 };
    const cap = B.inventory.satchelCap;
    const o = makeObject('satchel', spot.x, spot.y);
    o.items = stacks.slice(0, cap);
    for (const s of stacks.slice(cap)) this.spawnDrop(s.id, s.n, spot.x + 0.5, spot.y + 0.5);
    w.setObject(o);
    this._trackObject(o);
    w.syncObjectLight(o);
    this._objDirty = true;
  }

  respawn() {
    if (this.mode !== 'dead') return;
    const p = this.player;
    p.hp = Math.max(1, Math.round(p.maxHp * PL.spawnHpRatio));
    p.stamina = p.maxStamina;
    p.exhausted = false;
    p.hunger = Math.max(p.hunger, PL.spawnHunger);
    p.burnT = 0;
    const pos = this._spawnPos();
    p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
    p.autoPath = null;
    this._idle();
    p.invulnT = 1.5;
    p._sinceHit = 0;
    this._clearEnemiesNear(p.x, p.y, 10);
    this.mode = 'playing';
    this.emit('respawn', { cause: 'death', x: p.x, y: p.y });
  }

  /* ───── 敵 ───── */
  _spawnEnemy(type, x, y, opts = {}) {
    const def = D.ENEMIES[type];
    const e = {
      id: this.nid(), type, x, y, vx: 0, vy: 0, radius: def.radius, hp: def.hp, maxHp: def.hp, def: def.def, state: 'idle', stateT: this.rand() * 2,
      angle: this.rand() * TAU, flying: def.flying, home: { x, y }, attack: null, hitFlashT: 0,
      lostT: 0, farT: 0, cd: 0.8 + this.rand(), dodgeCd: 0, dodgeT: 0, kbT: 0, burnT: 0, burnTick: 0, wx: x, wy: y, strafe: this.rand() < 0.5 ? 1 : -1,
      strafeT: 1 + this.rand() * 2, summoned: !!opts.summoned, moving: false, fleeT: 0,
    };
    this.enemies.push(e);
    return e;
  }

  _killEnemy(e) {
    if (e.state === 'dead') return;
    const def = D.ENEMIES[e.type];
    e.state = 'dead';
    this._removeHazardsOf(e.id);
    this.emit('enemyDie', { id: e.id, enemyType: e.type, x: e.x, y: e.y });
    this.fx('death', e.x, e.y, undefined, '#ffdc8c', 0.5);
    this.stats.killed[e.type] = Math.min(1e9, (this.stats.killed[e.type] || 0) + 1);
    this._unlockCodex('enemy', e.type);
    if (!e.silent) for (const d of def.drops) if (this.rand() < d.p) this.spawnDrop(d.item, d.n, e.x, e.y);
  }

  _removeHazardsOf(ownerId) {
    for (const h of this.hazards) if (h.ownerId === ownerId) h.dead = true;
  }

  _updateFlow(dt) {
    const f = this._flow, p = this.player, w = this.world;
    f.t += dt;
    const px = Math.floor(p.x), py = Math.floor(p.y);
    if (f.t < B.enemy.flowEvery && f.px === px && f.py === py && f.ground) return;
    f.t = 0; f.px = px; f.py = py;
    const needAir = this.enemies.some((e) => e.flying && e.state !== 'dead');
    f.ground = this._buildFlow(false, px, py);
    f.air = needAir ? this._buildFlow(true, px, py) : null;
  }

  _buildFlow(flying, px, py) {
    const w = this.world;
    const S = B.enemy.flowWindow, R = (S - 1) >> 1, ox = px - R, oy = py - R;
    const dist = new Uint16Array(S * S).fill(65535);
    const q = new Uint16Array(S * S);
    let h = 0, t = 0;
    dist[R * S + R] = 0;
    q[t++] = R * S + R;
    while (h < t) {
      const i = q[h++];
      const x = i % S, y = (i / S) | 0;
      for (const [dx, dy] of ZB_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const ni = ny * S + nx;
        if (dist[ni] !== 65535 || !w.isWalkable(ox + nx, oy + ny, flying)) continue;
        dist[ni] = dist[i] + 1;
        q[t++] = ni;
      }
    }
    return { dist, ox, oy, S };
  }

  // 流れ場を下る次の目標点。なければ null
  _flowTarget(e) {
    const f = e.flying ? this._flow.air : this._flow.ground;
    if (!f) return null;
    const { dist, ox, oy, S } = f;
    const tx = Math.floor(e.x) - ox, ty = Math.floor(e.y) - oy;
    if (tx < 0 || ty < 0 || tx >= S || ty >= S) return null;
    const d0 = dist[ty * S + tx];
    if (d0 === 65535) return null;
    if (d0 === 0) return { x: this.player.x, y: this.player.y };
    let best = null, bd = d0;
    const w = this.world;
    for (let oy2 = -1; oy2 <= 1; oy2++) {
      for (let ox2 = -1; ox2 <= 1; ox2++) {
        if (!ox2 && !oy2) continue;
        const nx = tx + ox2, ny = ty + oy2;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const d = dist[ny * S + nx];
        if (d >= bd) continue;
        if (ox2 && oy2 && (dist[ty * S + nx] === 65535 || dist[ny * S + tx] === 65535)) continue;
        bd = d; best = { x: ox + nx + 0.5, y: oy + ny + 0.5 };
      }
    }
    return best;
  }

  _enemyMove(e, vx, vy, dt) {
    const def = D.ENEMIES[e.type];
    const w = this.world;
    const mx = vx * dt, my = vy * dt;
    if (def.lightFear) {
      const nx = Math.floor(e.x + mx + Math.sign(vx) * e.radius), ny = Math.floor(e.y + my + Math.sign(vy) * e.radius);
      if (w.inBounds(nx, ny) && w.safeLight[ny * W + nx] >= B.light.fear && w.safeLight[Math.floor(e.y) * W + Math.floor(e.x)] < B.light.fear) return false;
    }
    return this._tryMove(e, mx, my, e.flying);
  }

  _enemyToward(e, tx, ty, speed, dt) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) return false;
    e.angle = Math.atan2(dy, dx);
    return this._enemyMove(e, (dx / d) * speed, (dy / d) * speed, dt);
  }

  _enemyChaseMove(e, speed, dt) {
    const t = this._flowTarget(e);
    if (t) return this._enemyToward(e, t.x, t.y, speed, dt);
    const p = this.player;
    return this._enemyToward(e, p.x, p.y, speed, dt);
  }

  _enemyTick(e, dt) {
    const def = D.ENEMIES[e.type], p = this.player, w = this.world;
    e.hitFlashT = Math.max(0, e.hitFlashT - dt);
    e.dodgeCd = Math.max(0, e.dodgeCd - dt);
    e.cd = Math.max(0, e.cd - dt);
    e.stateT += dt;
    e.moving = false;
    if (e.burnT > 0) {
      e.burnT -= dt; e.burnTick += dt;
      if (e.burnTick >= 1) { e.burnTick -= 1; e.hp -= 3; this.fx('hit', e.x, e.y, this.settings.showDamageNumbers ? 3 : undefined, '#ff7a3a', 0.5); if (e.hp <= 0) { this._killEnemy(e); return; } }
    }
    if (e.kbT > 0) { e.kbT -= dt; this._tryMove(e, e.kbx * dt, e.kby * dt, e.flying); }
    if (e.dodgeT > 0) { e.dodgeT -= dt; this._tryMove(e, e.dodgeVec[0] * dt, e.dodgeVec[1] * dt, e.flying); }
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.sqrt(dx * dx + dy * dy);
    const alive = this.mode === 'playing';
    const sees = alive && dist <= def.sense && this._los(e.x, e.y, p.x, p.y);
    const homeD = Math.hypot(e.x - e.home.x, e.y - e.home.y);
    const at = def.attack;
    switch (e.state) {
      case 'idle':
        if (sees) { e.state = 'chase'; e.stateT = 0; e.lostT = 0; break; }
        if (e.stateT > 1.5) {
          const a = this.rand() * TAU, r = 1 + this.rand() * 3;
          const tx = e.x + Math.cos(a) * r, ty = e.y + Math.sin(a) * r;
          if (w.isWalkable(Math.floor(tx), Math.floor(ty), e.flying)) { e.wx = tx; e.wy = ty; e.state = 'wander'; e.stateT = 0; } else e.stateT = 0.5;
        }
        break;
      case 'wander':
        if (sees) { e.state = 'chase'; e.stateT = 0; e.lostT = 0; break; }
        e.moving = this._enemyToward(e, e.wx, e.wy, def.speed * 0.5, dt);
        if (e.stateT > 3 || Math.hypot(e.wx - e.x, e.wy - e.y) < 0.2 || !e.moving) { e.state = 'idle'; e.stateT = 0; }
        break;
      case 'chase': {
        if (!sees) e.lostT += dt; else e.lostT = 0;
        if (e.lostT > B.enemy.loseSight || homeD > B.enemy.leash || !alive) { e.state = 'return'; e.stateT = 0; break; }
        const ranged = def.ranged;
        if (ranged) {
          const dd = dist || 1;
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = 1.5 + this.rand() * 2; }
          if (dist < ranged.min) e.moving = this._enemyMove(e, (-dx / dd) * def.speed, (-dy / dd) * def.speed, dt);
          else if (dist > ranged.max) e.moving = this._enemyChaseMove(e, def.speed, dt);
          else e.moving = this._enemyMove(e, (-dy / dd) * def.speed * 0.6 * e.strafe, (dx / dd) * def.speed * 0.6 * e.strafe, dt);
          e.angle = Math.atan2(dy, dx);
          if (sees && e.cd <= 0 && dist >= ranged.min - 0.5 && dist <= at.range + 1) this._startEnemyAttack(e, dist);
        } else {
          if (dist > at.range * 0.85) e.moving = this._enemyChaseMove(e, def.speed, dt);
          else e.angle = Math.atan2(dy, dx);
          if (sees && e.cd <= 0 && dist <= at.range) this._startEnemyAttack(e, dist);
        }
        break;
      }
      case 'windup': {
        const a = e.attack;
        e.angle = a ? a.angle : e.angle;
        if (!a || a.hz.dead) { e.state = 'recover'; e.stateT = 0; break; }
        a.t = e.stateT;
        if (a.hz.phase === 'active' || e.stateT >= a.warn) this._enemyAttackBegin(e);
        break;
      }
      case 'attack': this._enemyAttackTick(e, dt); break;
      case 'recover':
        if (e.stateT >= B.enemy.recover) { e.state = 'chase'; e.stateT = 0; e.lostT = 0; e.attack = null; }
        break;
      case 'flee':
        e.moving = this._enemyMove(e, (-dx / (dist || 1)) * def.speed, (-dy / (dist || 1)) * def.speed, dt);
        if (e.stateT >= (at.fleeAfter || 1)) { e.state = 'chase'; e.stateT = 0; e.lostT = 0; }
        break;
      case 'return':
        e.moving = this._enemyToward(e, e.home.x, e.home.y, def.speed, dt);
        if (sees && homeD < B.enemy.leash * 0.6) { e.state = 'chase'; e.stateT = 0; e.lostT = 0; break; }
        if (Math.hypot(e.home.x - e.x, e.home.y - e.y) < 0.8 || e.stateT > 20) { e.hp = e.maxHp; e.state = 'idle'; e.stateT = 0; }
        break;
      default: break;
    }
  }

  _themeOf(e) { const b = this.world.biomeAt(Math.floor(e.x), Math.floor(e.y)); return D.BIOME_KEYS[b] || D.BIOME_KEYS[this.player.biome] || 'moss'; }

  _startEnemyAttack(e, dist) {
    const def = D.ENEMIES[e.type], at = def.attack, p = this.player;
    const ang = Math.atan2(p.y - e.y, p.x - e.x);
    const warn = at.warn * this.diff.warn;
    let shape;
    if (at.shape === 'circle') {
      const reach = Math.min(dist, at.reach);
      shape = { type: 'circle', x: e.x + Math.cos(ang) * reach, y: e.y + Math.sin(ang) * reach, r: at.r };
    } else shape = { type: 'line', x: e.x, y: e.y, angle: ang, length: at.length, width: at.width };
    const active = at.shape === 'line' && at.speed && !at.projectile ? at.length / at.speed : at.active || 0.1;
    const hz = this._newHazard({ owner: 'enemy', ownerId: e.id, kind: at.kind, theme: this._themeOf(e), warn, active, dmg: at.projectile ? 0 : def.atk, shape, burn: 0 });
    if (hz.dead) { e.cd = 0.5; return; }
    hz.reach = at.shape === 'line' && !at.projectile ? 0 : undefined;
    e.attack = { kind: at.kind, t: 0, warn, dur: active, angle: ang, hz };
    e.state = 'windup';
    e.stateT = 0;
    this._hint('telegraph');
  }

  _enemyAttackBegin(e) {
    const def = D.ENEMIES[e.type], at = def.attack, a = e.attack;
    e.state = 'attack';
    e.stateT = 0;
    a.t = 0;
    if (at.projectile) {
      const ang = a.angle;
      this._spawnProjectile(at.projectile, this._themeOf(e), e.x, e.y, ang, at.speed, def.atk, 0.25, at.range / at.speed + 1, at.burn || 0);
      a.dur = 0.15;
    } else if (at.kind === 'slimeHop') {
      const s = a.hz.shape;
      e.hopTo = { x: s.x, y: s.y };
      a.dur = at.active;
    } else if (at.shape === 'line') a.dur = at.length / at.speed;
  }

  _enemyAttackTick(e, dt) {
    const def = D.ENEMIES[e.type], at = def.attack, a = e.attack;
    a.t += dt;
    if (at.kind === 'slimeHop' && e.hopTo) {
      const dx = e.hopTo.x - e.x, dy = e.hopTo.y - e.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.05) this._tryMove(e, (dx / d) * Math.min(d, (at.reach / at.active) * dt), (dy / d) * Math.min(d, (at.reach / at.active) * dt), false);
    } else if (at.shape === 'line' && !at.projectile) {
      const mv = at.speed * dt;
      const ox = e.x, oy = e.y;
      this._tryMove(e, Math.cos(a.angle) * mv, Math.sin(a.angle) * mv, e.flying);
      a.hz.reach = Math.min(at.length, (a.hz.reach || 0) + Math.hypot(e.x - ox, e.y - oy));
      if (Math.hypot(e.x - ox, e.y - oy) < mv * 0.4) a.t = a.dur;
    }
    e.moving = true;
    if (a.t >= a.dur) {
      e.cd = B.enemy.attackCd + this.rand() * 0.8;
      e.hopTo = null;
      if (at.kind === 'batDive') { e.state = 'flee'; e.stateT = 0; }
      else { e.state = 'recover'; e.stateT = 0; }
    }
  }

  _updateEnemies(dt) {
    this._updateFlow(dt);
    const p = this.player;
    for (const e of this.enemies) if (e.state !== 'dead') this._enemyTick(e, dt);
    // 分離
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === 'dead') continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= B.enemy.sepRadius || d < 1e-4) continue;
        const push = (B.enemy.sepRadius - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        this._tryMove(a, -nx * push * 0.5, -ny * push * 0.5, a.flying);
        this._tryMove(b, nx * push * 0.5, ny * push * 0.5, b.flying);
      }
    }
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      let keep = e.state !== 'dead';
      if (keep) {
        if (Math.hypot(e.x - p.x, e.y - p.y) > B.spawn.despawnDist) { e.farT += dt; if (e.farT >= B.spawn.despawnTime) { keep = false; this._removeHazardsOf(e.id); } }
        else e.farT = 0;
        if (keep && this._boxBlocked(e.x, e.y, e.radius * 0.5, e.flying)) { keep = false; this._removeHazardsOf(e.id); }
      }
      if (keep) list[j++] = e;
    }
    list.length = j;
  }

  _updateSpawner(dt) {
    this._spawnT += dt;
    if (this._spawnT < B.spawn.interval) return;
    this._spawnT = 0;
    const p = this.player, w = this.world;
    if (this.boss || !p.biome) return;
    const biome = p.biome;
    let cap = D.BIOMES[biome].enemyCap;
    if (this.progress.coreRestored) cap = Math.floor(cap * B.spawn.afterEndingMul);
    const living = this.enemies.filter((e) => e.state !== 'dead' && !e.summoned).length;
    if (living >= cap || this.enemies.length >= B.limits.enemies) return;
    const weights = { moss_slime: 5, cave_bat: 3, moss_mite: 3, prism_beetle: 4, mirror_moth: 3, ember_husk: 4, magma_newt: 4 };
    const pool = Object.values(D.ENEMIES).filter((d) => d.biomes.includes(biome));
    if (!pool.length) return;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = this.rand() * TAU, r = B.spawn.min + this.rand() * (B.spawn.max - B.spawn.min);
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!w.inBounds(tx, ty)) continue;
      const i = ty * W + tx;
      if (w.biome[i] !== biome || (w.flags[i] & FLAG.arena) || w.safeLight[i] >= B.light.safe) continue;
      if (Math.hypot(x - 64.5, y - 64.5) <= B.spawn.hubSafe) continue;
      let nearBed = false;
      for (const bi of this._beds) if (Math.hypot((bi % W) + 0.5 - x, ((bi / W) | 0) + 0.5 - y) <= B.spawn.bedSafe) { nearBed = true; break; }
      if (nearBed) continue;
      let total = 0;
      const usable = pool.filter((d) => w.isWalkable(tx, ty, d.flying));
      if (!usable.length) continue;
      for (const d of usable) total += weights[d.key] || 1;
      let roll = this.rand() * total, pick = usable[0];
      for (const d of usable) { roll -= weights[d.key] || 1; if (roll <= 0) { pick = d; break; } }
      this._spawnEnemy(pick.key, tx + 0.5, ty + 0.5);
      return;
    }
  }

  /* ───── ハザード・投射物 ───── */
  _newHazard(o) {
    const h = {
      id: this.nid(), owner: o.owner, ownerId: o.ownerId, kind: o.kind, theme: o.theme || 'moss', phase: 'warn', t: 0, warn: o.warn, active: o.active,
      dmg: o.dmg, tick: o.tick || 0, tickT: 0, shape: o.shape, burn: o.burn || 0, hit: false, dead: false,
    };
    if (this.hazards.length >= B.limits.hazards) { h.dead = true; return h; }
    this.hazards.push(h);
    this.emit('hazard', { id: h.id, kind: h.kind, phase: 'warn' });
    return h;
  }

  _inShape(s, px, py, pr, reach) {
    const dx = px - s.x, dy = py - s.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    switch (s.type) {
      case 'circle': return d <= s.r + pr * 0.5;
      case 'ring': {
        if (Math.abs(d - s.r) > s.width / 2 + pr * 0.5) return false;
        if (s.gapAngle !== undefined && Math.abs(angDiff(Math.atan2(dy, dx), s.gapAngle)) < s.gapWidth / 2) return false;
        return true;
      }
      case 'line': {
        const c = Math.cos(s.angle), sn = Math.sin(s.angle);
        const along = dx * c + dy * sn, across = -dx * sn + dy * c;
        const len = reach !== undefined ? Math.min(s.length, reach) : s.length;
        return along >= -pr * 0.5 && along <= len + pr * 0.5 && Math.abs(across) <= s.width / 2 + pr * 0.5;
      }
      case 'cone': return d <= s.range + pr * 0.5 && (d < 0.3 || Math.abs(angDiff(Math.atan2(dy, dx), s.angle)) <= s.spread / 2);
      default: return false;
    }
  }

  _updateHazards(dt) {
    const p = this.player;
    for (const h of this.hazards) {
      if (h.dead) continue;
      h.t += dt;
      if (h.phase === 'warn') {
        if (h.pre) h.pre(h, dt);
        if (h.t >= h.warn) {
          h.phase = 'active';
          h.t = 0;
          h.tickT = 0;
          if (h.onActive) h.onActive(h);
          this.emit('hazard', { id: h.id, kind: h.kind, phase: 'active' });
        }
      }
      if (h.phase === 'active') {
        if (h.upd) h.upd(h, dt);
        this._hazardDamage(h, dt, p);
        if (h.t >= h.active) { h.dead = true; this.emit('hazard', { id: h.id, kind: h.kind, phase: 'end' }); }
      }
    }
    let j = 0;
    for (let i = 0; i < this.hazards.length; i++) { const h = this.hazards[i]; if (!h.dead) this.hazards[j++] = h; }
    this.hazards.length = j;
  }

  _hazardDamage(h, dt, p) {
    if (h.dmg <= 0 || this.mode !== 'playing') return;
    if (h.tick > 0) {
      h.tickT -= dt;
      if (h.tickT > 0) return;
    } else if (h.hit) return;
    if (!this._inShape(h.shape, p.x, p.y, p.radius, h.reach)) { if (h.tick > 0) h.tickT = 0; return; }
    const ok = this._hurtPlayer(h.dmg, { kind: h.kind, x: h.shape.x, y: h.shape.y, burn: h.burn, name: h.owner === 'boss' ? (this.boss ? this.boss.name : '守護者') : this._enemyName(h.ownerId) }, { tick: h.tick > 0 });
    if (ok) { h.hit = true; if (h.tick > 0) h.tickT = h.tick; }
  }

  _enemyName(id) {
    const e = this.enemies.find((x) => x.id === id);
    return e ? D.ENEMIES[e.type].name : '敵';
  }

  _spawnProjectile(kind, theme, x, y, angle, speed, dmg, r, life, burn = 0) {
    if (this.projectiles.length >= B.limits.projectiles) this.projectiles.shift();
    this.projectiles.push({ id: this.nid(), kind, theme, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, dmg, life, burn });
  }

  _updateProjectiles(dt) {
    const w = this.world, p = this.player;
    let j = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const q = this.projectiles[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      let keep = q.life > 0 && w.isWalkable(Math.floor(q.x), Math.floor(q.y), true);
      if (keep && this.mode === 'playing') {
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d <= q.r + p.radius * 0.7 && p.invulnT <= 0) {
          this._hurtPlayer(q.dmg, { kind: q.kind, x: q.x, y: q.y, burn: q.burn, name: '晶弾' });
          keep = false;
        }
      }
      if (keep) this.projectiles[j++] = q;
    }
    this.projectiles.length = j;
  }

  /* ───── ボス ───── */
  _arenaDoorTiles(a) {
    const v = DIR_VEC[a.door.dir];
    const out = [];
    for (let k = -1; k <= 1; k++) out.push({ x: a.door.x + (v[0] ? 0 : k), y: a.door.y + (v[1] ? 0 : k) });
    return out;
  }
  _setBarrier(a, on) {
    for (const t of this._arenaDoorTiles(a)) this.world.setWall(t.x, t.y, on ? WID.arena_barrier : 0);
  }

  _checkBossTrigger() {
    if (this.boss) return;
    const p = this.player, w = this.world;
    const px = Math.floor(p.x), py = Math.floor(p.y);
    for (const k of ARENA_NAMES) {
      if (this.progress.hearts[k]) continue;
      const a = w.anchors.arenas[k];
      if (px <= a.x0 || px >= a.x1 || py <= a.y0 || py >= a.y1) continue;
      const d = a.door.dir;
      const depth = d === 'N' ? py - a.y0 : d === 'S' ? a.y1 - py : d === 'W' ? px - a.x0 : a.x1 - px;
      if (depth < B.boss.arenaDepth) continue;
      this._startBoss(k);
      return;
    }
  }

  _startBoss(k) {
    const def = D.BOSSES[k], a = this.world.anchors.arenas[k];
    const maxHp = Math.round(def.hp * this.diff.bossHp);
    this.boss = {
      id: k, key: def.key, name: def.name, en: def.en, x: a.cx + 0.5, y: a.cy + 0.5, radius: def.radius, hp: maxHp, maxHp, def: def.def, phase: 1,
      state: 'intro', stateT: 0, attack: null, angle: Math.PI / 2, glintT: 0, decoys: [], arena: { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 },
      hitFlashT: 0, tookDamage: false, _last: null, _sched: [], _upd: null, _atkEnd: 0, _atkDone: false, _idleDur: 0.6, _recoverDur: 1, _mirror: null, _dash: null, _summoned: false,
    };
    this._setBarrier(a, true);
    this.autoPathCancel();
    this._unlockCodex('boss', k);
    this.emit('bossIntro', { bossId: k, phase: 1 });
    this._hint('telegraph');
  }

  autoPathCancel() { if (this.player) { this.player.autoPath = null; this._autoGoal = null; } }

  _bossFace(b) { b.angle = Math.atan2(this.player.y - b.y, this.player.x - b.x); }

  _bossMove(b, dt) {
    const p = this.player, def = D.BOSSES[b.id];
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    let vx = 0, vy = 0;
    if (b.id === 'crystal') {
      const side = Math.floor(this.time / 3) % 2 ? 1 : -1;
      if (d < 4) { vx = -dx / d; vy = -dy / d; } else if (d > 6) { vx = dx / d; vy = dy / d; } else { vx = (-dy / d) * side * 0.6; vy = (dx / d) * side * 0.6; }
    } else if (d > 2.8) { vx = dx / d; vy = dy / d; }
    this._tryMove(b, vx * def.speed * dt, vy * def.speed * dt, def.flying);
    this._bossFace(b);
  }

  _updateBoss(dt) {
    const b = this.boss;
    if (!b) return;
    const def = D.BOSSES[b.id];
    b.hitFlashT = Math.max(0, b.hitFlashT - dt);
    b.stateT += dt;
    switch (b.state) {
      case 'intro':
        this._bossFace(b);
        if (b.stateT >= B.boss.intro) { b.state = 'idle'; b.stateT = 0; b._idleDur = 0.5; }
        break;
      case 'idle':
        this._bossMove(b, dt);
        if (b.stateT >= b._idleDur) this._bossChoose();
        break;
      case 'telegraph':
      case 'attack': {
        b.attack.t += dt;
        const sched = b._sched;
        let j = 0;
        for (let i = 0; i < sched.length; i++) { const s = sched[i]; if (s.at <= b.attack.t) s.fn(); else sched[j++] = s; }
        sched.length = j;
        if (b._upd) b._upd(dt);
        if (!this.boss || this.boss !== b) return;
        if (b.state === 'telegraph' && b.attack.t >= b.attack.warn) { b.state = 'attack'; this.emit('bossAttack', { bossId: b.id, attack: b.attack.name }); }
        if (b.state === 'attack' && (b._atkDone || b.attack.t >= b._atkEnd)) this._bossEndAttack(b);
        break;
      }
      case 'recover':
        if (b.stateT >= b._recoverDur) { b.state = 'idle'; b.stateT = 0; b._idleDur = 0.4 + this.rand() * 0.4; }
        break;
      case 'stunned':
        if (b.stateT >= 1.6) { b.state = 'idle'; b.stateT = 0; b._idleDur = 0.5; }
        break;
      case 'dying':
        if (b.stateT >= B.boss.dying) this._finishBoss();
        break;
      default: break;
    }
    // 鏡像の分身を片付ける
    if (b.decoys.length && !b._mirror) b.decoys.length = 0;
    void def;
  }

  _bossEndAttack(b) {
    b._upd = null; b._dash = null; b._mirror = null; b._sched = [];
    b.decoys.length = 0;
    b.glintT = 0;
    b.attack = null;
    b.state = 'recover';
    b.stateT = 0;
    b._recoverDur = B.boss.recoverMin + this.rand() * (B.boss.recoverMax - B.boss.recoverMin);
  }

  _bossChoose() {
    const b = this.boss, def = D.BOSSES[b.id];
    const weights = def.attacks.map((a) => (a.name === b._last ? B.boss.sameAttackWeight : 1));
    const total = weights.reduce((s, x) => s + x, 0);
    let r = this.rand() * total, pick = def.attacks[0];
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { pick = def.attacks[i]; break; } }
    const warnMul = this.diff.warn * (b.phase === 2 ? B.boss.phase2Warn : 1);
    const warn = pick.warn * warnMul;
    b.attack = { name: pick.name, t: 0, warn, dur: pick.active };
    b.state = 'telegraph';
    b.stateT = 0;
    b._atkDone = false; b._sched = []; b._upd = null; b._atkEnd = warn + pick.active;
    b._last = pick.name;
    this._bossFace(b);
    this['_atk_' + pick.name](b, pick, warn);
    this.emit('bossTelegraph', { bossId: b.id, attack: pick.name });
  }

  _bossHazard(b, kind, warn, active, dmg, shape, extra = {}) {
    const h = this._newHazard({ owner: 'boss', ownerId: b.id, kind, theme: D.BOSSES[b.id].theme, warn, active, dmg, shape, tick: extra.tick, burn: extra.burn });
    return h;
  }

  _atk_root(b, def, warn) {
    const p = this.player;
    const a0 = Math.atan2(p.y - b.y, p.x - b.x);
    const offs = b.phase === 2 ? [-20, -10, 0, 10, 20] : [-20, 0, 20];
    for (const o of offs) this._bossHazard(b, 'root', warn, def.active, def.dmg, { type: 'line', x: b.x, y: b.y, angle: a0 + o * DEG, length: def.length, width: def.width });
    b.angle = a0;
  }

  _atk_sporeRing(b, def, warn) {
    const p = this.player;
    const gap = Math.atan2(p.y - b.y, p.x - b.x) + (this.rand() - 0.5) * 1.0;
    const h = this._bossHazard(b, 'sporeRing', warn, def.active, def.dmg, { type: 'ring', x: b.x, y: b.y, r: 4, width: 6, gapAngle: gap, gapWidth: def.gap * DEG });
    h.onActive = (hz) => { hz.shape.r = def.r0; hz.shape.width = def.thick; };
    h.upd = (hz) => { hz.shape.r = def.r0 + (def.r1 - def.r0) * Math.min(1, hz.t / def.active); };
  }

  _atk_charge(b, def, warn) {
    const p = this.player;
    const a0 = Math.atan2(p.y - b.y, p.x - b.x);
    const h = this._bossHazard(b, 'charge', warn, def.length / def.speed + 0.2, def.dmg, { type: 'line', x: b.x, y: b.y, angle: a0, length: def.length, width: def.width });
    h.reach = 0;
    b.angle = a0;
    b._dash = { ang: a0, dist: 0, hz: h };
    b._atkEnd = warn + def.length / def.speed + 0.3;
    b._upd = (dt) => {
      const d = b._dash;
      if (b.state !== 'attack' || !d) return;
      const mv = def.speed * dt, ox = b.x, oy = b.y;
      this._tryMove(b, Math.cos(d.ang) * mv, Math.sin(d.ang) * mv, false);
      const moved = Math.hypot(b.x - ox, b.y - oy);
      d.dist += moved;
      d.hz.reach = d.dist;
      if (moved < mv * 0.4) {
        d.hz.dead = true;
        b._dash = null; b._upd = null;
        b.state = 'stunned'; b.stateT = 0; b.attack = null;
        this.emit('bossStun', { bossId: b.id, phase: b.phase });
      } else if (d.dist >= def.length) b._atkDone = true;
    };
  }

  _atk_beam(b, def, warn) {
    const p = this.player;
    const a0 = Math.atan2(p.y - b.y, p.x - b.x);
    const sweep = def.sweep * DEG;
    const total = b.phase === 2 ? def.active * 2 : def.active;
    const range0 = this._rayLength(b.x, b.y, a0, def.range);
    const h = this._bossHazard(b, 'beam', warn, total, def.dmg, { type: 'cone', x: b.x, y: b.y, angle: a0, spread: sweep, range: range0 }, { tick: def.tick });
    h.pre = (hz) => { hz.shape.x = b.x; hz.shape.y = b.y; hz.shape.range = this._rayLength(b.x, b.y, a0, def.range); };
    h.onActive = (hz) => { hz.shape = { type: 'line', x: b.x, y: b.y, angle: a0 - sweep / 2, length: range0, width: def.width }; };
    h.upd = (hz) => {
      const t = hz.t / def.active;
      const f = b.phase === 2 ? (t <= 1 ? t : Math.max(0, 2 - t)) : Math.min(1, t);
      hz.shape.angle = a0 - sweep / 2 + sweep * f;
      hz.shape.x = b.x; hz.shape.y = b.y;
      hz.shape.length = this._rayLength(b.x, b.y, hz.shape.angle, def.range);
    };
    b._atkEnd = warn + total;
  }

  _arenaRandom(b, margin = 2) {
    const a = b.arena;
    for (let k = 0; k < 20; k++) {
      const x = a.x0 + margin + this.rand() * (a.x1 - a.x0 - margin * 2 + 1), y = a.y0 + margin + this.rand() * (a.y1 - a.y0 - margin * 2 + 1);
      if (!this._boxBlocked(x, y, 0.5, true)) return { x, y };
    }
    return { x: (a.x0 + a.x1 + 1) / 2, y: (a.y0 + a.y1 + 1) / 2 };
  }

  _atk_shardRain(b, def, warn) {
    const p = this.player;
    const n = b.phase === 2 ? 12 : def.count;
    for (let k = 0; k < n; k++) {
      let x, y;
      if (k < def.near) { x = p.x + (this.rand() - 0.5) * 2.4; y = p.y + (this.rand() - 0.5) * 2.4; }
      else { const r = this._arenaRandom(b, 1); x = r.x; y = r.y; }
      this._bossHazard(b, 'shardRain', warn, def.active, def.dmg, { type: 'circle', x, y, r: def.r });
    }
    b._atkEnd = warn + def.active;
  }

  _atk_mirror(b, def, warn) {
    b._atkEnd = warn + def.active;
    b.glintT = 0;
    b._upd = (dt) => {
      if (b.state !== 'attack') return;
      const p = this.player;
      if (!b._mirror) {
        let pos = this._arenaRandom(b, 2);
        for (let k = 0; k < 10 && Math.hypot(pos.x - p.x, pos.y - p.y) < 4; k++) pos = this._arenaRandom(b, 2);
        b.x = pos.x; b.y = pos.y;
        b.decoys = [];
        for (let k = 0; k < def.decoys; k++) { const q = this._arenaRandom(b, 2); b.decoys.push({ id: this.nid(), x: q.x, y: q.y, alive: true, shotT: 0.4 + k * 0.5 }); }
        b._mirror = { t: 0, hit: false };
      }
      const m = b._mirror;
      m.t += dt;
      b.glintT += dt;
      if (b.glintT >= def.glintEvery) b.glintT -= def.glintEvery;
      for (const dc of b.decoys) {
        if (!dc.alive) continue;
        dc.shotT -= dt;
        if (dc.shotT <= 0) {
          dc.shotT = def.shotEvery;
          const a0 = Math.atan2(p.y - dc.y, p.x - dc.x);
          for (const o of [-0.4, 0, 0.4]) this._spawnProjectile('decoyShard', 'crystal', dc.x, dc.y, a0 + o, def.shotSpeed, def.dmg, 0.25, 4);
        }
      }
      if (m.hit || m.t >= def.active) b._atkDone = true;
    };
  }

  _atk_breath(b, def, warn) {
    const p = this.player;
    const a0 = Math.atan2(p.y - b.y, p.x - b.x);
    const h = this._bossHazard(b, 'breath', warn, def.active, def.dmg, { type: 'cone', x: b.x, y: b.y, angle: a0, spread: def.spread * DEG, range: def.range }, { tick: def.tick, burn: def.burn });
    if (b.phase === 2) h.upd = (hz) => { hz.shape.angle = a0 - (def.swing / 2) * DEG + def.swing * DEG * Math.min(1, hz.t / def.active); };
    b._atkEnd = warn + def.active;
  }

  _atk_slam(b, def, warn) {
    const p = this.player, a = b.arena;
    const tx = clamp(p.x, a.x0 + 2, a.x1 - 1), ty = clamp(p.y, a.y0 + 2, a.y1 - 1);
    this._bossHazard(b, 'slam', warn, def.active, def.dmg, { type: 'circle', x: tx, y: ty, r: def.r });
    const ring = () => {
      const h = this._bossHazard(b, 'shockRing', 0, 3.2, def.ringDmg, { type: 'ring', x: tx, y: ty, r: 0.3, width: def.ringThick });
      h.upd = (hz) => { hz.shape.r = 0.3 + def.ringSpeed * hz.t; };
    };
    for (let k = 0; k < def.rings; k++) b._sched.push({ at: warn + k * 0.6, fn: ring });
    b._atkEnd = warn + 0.6 * def.rings + 0.2;
  }

  _atk_vent(b, def, warn) {
    const a = b.arena;
    const groups = { A: [], B: [] };
    for (let ly = 0; ly < 13; ly++) for (let lx = 0; lx < 13; lx++) {
      if (!(lx & 1) || !(ly & 1)) continue;
      const m = (lx + ly) % 4;
      const pt = { x: a.x0 + 1 + lx + 0.5, y: a.y0 + 1 + ly + 0.5 };
      if (m === 2) groups.A.push(pt); else if (m === 0) groups.B.push(pt);
    }
    const waves = b.phase === 2 ? ['A', 'B', 'A'] : ['A', 'B'];
    const spawnWave = (g) => { for (const pt of groups[g]) this._bossHazard(b, 'vent', warn, def.active, def.dmg, { type: 'circle', x: pt.x, y: pt.y, r: def.r }); };
    waves.forEach((g, k) => { if (k === 0) spawnWave(g); else b._sched.push({ at: k * (warn + def.active), fn: () => spawnWave(g) }); });
    b._atkEnd = warn + (waves.length - 1) * (warn + def.active) + def.active;
  }

  _damageBoss(dmg, a) {
    const b = this.boss;
    if (!b || b.state === 'dying' || b.state === 'intro') return;
    const def = D.BOSSES[b.id];
    b.hp -= dmg;
    b.hitFlashT = 0.12;
    if (b._mirror) b._mirror.hit = true;
    this.emit('hit', { target: 'boss', id: b.id, x: b.x, y: b.y, dmg, kind: (a && a.item) || 'fist', combo: a ? a.combo : 0 });
    this.fx('hit', b.x, b.y, this.settings.showDamageNumbers ? dmg : undefined, '#ffdc8c');
    if (b.hp <= 0) { b.hp = 0; this._bossDying(); return; }
    if (b.phase === 1 && b.hp <= def.phase2 * b.maxHp) this._bossPhase2();
  }

  _bossPhase2() {
    const b = this.boss, def = D.BOSSES[b.id];
    b.phase = 2;
    this.emit('bossPhase', { bossId: b.id, phase: 2 });
    this.toast(b.name + ' は力を解き放った', 'warn');
    const type = b.id === 'moss' ? 'moss_slime' : b.id === 'ember' ? 'ember_husk' : null;
    if (type && !b._summoned) {
      b._summoned = true;
      for (let k = 0; k < 2; k++) {
        const q = this._arenaRandom(b, 2);
        const e = this._spawnEnemy(type, q.x, q.y, { summoned: true });
        e.state = 'chase'; e.lostT = 0;
        e.home = { x: (b.arena.x0 + b.arena.x1 + 1) / 2, y: (b.arena.y0 + b.arena.y1 + 1) / 2 };
      }
    }
    void def;
  }

  _bossDying() {
    const b = this.boss;
    b.state = 'dying'; b.stateT = 0; b.attack = null; b._upd = null; b._sched = []; b._dash = null; b._mirror = null;
    b.decoys.length = 0;
    for (const h of this.hazards) if (h.owner === 'boss') h.dead = true;
    this.projectiles.length = 0;
    for (const e of this.enemies) if (e.summoned) { e.silent = true; this._killEnemy(e); }
    this.fx('death', b.x, b.y, undefined, '#ffe39a', 2.5);
  }

  _finishBoss() {
    const b = this.boss, p = this.player, w = this.world, def = D.BOSSES[b.id];
    const a = w.anchors.arenas[b.id];
    const k = b.id;
    this.progress.hearts[k] = true;
    if (!this.progress.unlocks.includes(def.unlock)) this.progress.unlocks.push(def.unlock);
    const n = ARENA_NAMES.filter((x) => this.progress.hearts[x]).length;
    p.maxHp = Math.min(PL.maxHpCap, PL.hp + PL.hpPerHeart * n);
    p.hp = Math.min(p.maxHp, p.hp + PL.hpPerHeart);
    for (const r of def.rewards) this.giveItem(r.item, r.n, b.x, b.y);
    this.stats.killed[k] = Math.min(1e9, (this.stats.killed[k] || 0) + 1);
    this._unlockCodex('boss', k);
    this._unlockAchievement('guardian_' + k);
    if (!b.tookDamage) this._unlockAchievement('untouched');
    this._setBarrier(a, false);
    const al = w.objectAt(a.cx, a.cy);
    if (al && al.type === 'altar') { al.boss = true; w.syncObjectLight(al); }
    this.emit('bossDefeated', { bossId: k, phase: b.phase });
    this.toast(def.name + ' を鎮めた — ' + (k === 'moss' ? '苔' : k === 'crystal' ? '晶' : '灼') + 'の核を手にした', 'info');
    this.boss = null;
    if (def.gate) this._openGate(def.gate);
    this._objDirty = true;
    this._updateObjective();
  }

  _openGate(name) {
    const g = this.world.anchors.gates[name];
    for (const t of g.tiles) this.world.setWall(t.x, t.y, 0);
    this.progress.gates[name] = true;
    this.emit('gateOpen', { gate: name, x: g.outer.x + 0.5, y: g.y + 0.5 });
    this.toast((name === 'crystal' ? '結晶' : '灼熱') + 'の封印門が開いた', 'info');
  }

  _resetBoss() {
    const b = this.boss;
    if (!b) return;
    const a = this.world.anchors.arenas[b.id];
    this._setBarrier(a, false);
    for (const h of this.hazards) if (h.owner === 'boss') h.dead = true;
    this.projectiles.length = 0;
    for (const e of this.enemies) if (e.summoned) { e.silent = true; e.state = 'dead'; }
    this.boss = null;
    this.emit('bossReset', { bossId: b.id, phase: b.phase });
  }

  /* ───── ドロップ・世界の時間経過 ───── */
  _updateDrops(dt) {
    const p = this.player;
    let j = 0;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.t += dt;
      d.lock = Math.max(0, (d.lock || 0) - dt);
      if (d.t >= B.dropLife) continue;
      const dx = p.x - d.x, dy = p.y - d.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (d.lock <= 0 && dist <= PL.magnetRange && dist > 0.001) {
        const mv = Math.min(dist, PL.magnetSpeed * dt);
        d.x += (dx / dist) * mv; d.y += (dy / dist) * mv;
      }
      if (d.lock <= 0 && dist <= PL.pickupRange) {
        const left = this._collect(d.item, d.n);
        if (left === 0) continue;
        d.n = left;
        this.toastOnce('full-inv', '持ち物がいっぱいだ', 'warn', 3);
      }
      this.drops[j++] = d;
    }
    this.drops.length = j;
  }

  _updateWorldTimers(dt) {
    const w = this.world;
    for (const i of this._regrow) {
      const o = w.objects.get(i);
      if (!o || !(o.spent || o.stump)) { this._regrow.delete(i); continue; }
      o.regrowT -= dt;
      if (o.regrowT > 0) continue;
      if (this._entityOverlapsTile(o.x, o.y)) { o.regrowT = B.regrow.retry; continue; }
      o.spent = false; o.stump = false; o.regrowT = 0; o.dmg = 0;
      this._regrow.delete(i);
      w.syncObjectLight(o);
      w.dirty(o.x, o.y);
      this._objDirty = true;
      this._flow.t = 99;
    }
    const boost = this.progress.coreRestored ? 1.5 : 1;
    for (const i of this._planters) {
      const o = w.objects.get(i);
      if (!o || o.type !== 'planter') { this._planters.delete(i); continue; }
      if (!o.crop) { o.dark = false; continue; }
      const T = D.CROPS[o.crop].growTime;
      const lit = w.light[i] >= B.light.crop;
      o.dark = !lit;
      if (o.stage < 3 && lit) {
        o.growT = Math.min(T, o.growT + dt * boost);
        const st = Math.min(3, Math.floor(o.growT / (T / 3)));
        if (st !== o.stage) {
          o.stage = st;
          this._objDirty = true;
          if (st === 3) this.emit('cropReady', { x: o.x + 0.5, y: o.y + 0.5, crop: o.crop });
        }
      }
    }
    for (const i of this._saplings) {
      const o = w.objects.get(i);
      if (!o || o.type !== 'sapling') { this._saplings.delete(i); continue; }
      o.growT += dt;
      if (o.growT >= B.regrow.sapling && !this._entityOverlapsTile(o.x, o.y)) {
        this._untrackObject(o);
        w.setObject(makeObject('cap_tree', o.x, o.y));
        this._objDirty = true;
      }
    }
    for (const [i, e] of w.wallDamage) {
      e.t += dt;
      if (e.t >= B.wallDamageReset) { w.wallDamage.delete(i); w.dirty(i % W, (i / W) | 0); }
    }
    for (const i of this._dmgObjs) {
      const o = w.objects.get(i);
      if (!o) { this._dmgObjs.delete(i); continue; }
      o.dmgT = (o.dmgT || 0) + dt;
      if (o.dmgT >= B.wallDamageReset) { o.dmg = 0; this._dmgObjs.delete(i); this._objDirty = true; }
    }
  }

  _updateExplore(dt) {
    this._exploreT += dt;
    if (this._exploreT < B.explore.every) return;
    this._exploreT = 0;
    const p = this.player, w = this.world;
    const px = Math.floor(p.x), py = Math.floor(p.y);
    let changed = false;
    const R = B.explore.lit;
    for (let y = py - R; y <= py + R; y++) {
      for (let x = px - R; x <= px + R; x++) {
        if (!w.inBounds(x, y)) continue;
        const i = y * W + x;
        if (w.explored[i]) continue;
        const d2 = (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2;
        if (d2 <= B.explore.near ** 2 || (d2 <= R * R && w.light[i] >= B.explore.litMin)) { w.explored[i] = 1; changed = true; }
      }
    }
    if (changed) w.exploredVersion++;
  }

  /* ───── 目標・実績・ヒント ───── */
  _sum(map, keys) { let n = 0; for (const k of keys) n += map[k] || 0; return n; }
  _crafted(...keys) { return this._sum(this.stats.crafted, keys) >= 1; }

  _objectiveDone(id) {
    const pr = this.progress, st = this.stats;
    switch (id) {
      case 'wake': return pr.flags.openedStarter;
      case 'gather': return (this.itemCount('capwood') >= 6 && this.itemCount('stone') >= 4) || this._crafted('pick_stone', 'pick_copper', 'pick_crystal', 'pick_ember');
      case 'pick': return this._crafted('pick_stone', 'pick_copper', 'pick_crystal', 'pick_ember');
      case 'campfire': return (st.placed.campfire || 0) >= 1;
      case 'bench': return (st.placed.workbench || 0) >= 1;
      case 'copper': return (st.obtained.copper_ore || 0) >= 6;
      case 'smelt': return (st.crafted.copper_ingot || 0) >= 1;
      case 'gear': return this._crafted('sword_copper', 'pick_copper', 'sword_crystal', 'pick_crystal', 'sword_ember', 'pick_ember');
      case 'bed': return (st.placed.bed || 0) >= 1;
      case 'boss1': return pr.hearts.moss;
      case 'crystalGate': return pr.flags.enteredCrystal;
      case 'crystalPick': return this._crafted('pick_crystal', 'pick_ember');
      case 'bridge': return st.bridges >= 1 || pr.hearts.crystal;
      case 'boss2': return pr.hearts.crystal;
      case 'heat': return this._crafted('armor_crystal', 'armor_ember') || (st.cooked.jelly || 0) >= 1 || pr.hearts.ember;
      case 'emberGate': return pr.flags.enteredEmber;
      case 'emberite': return (st.crafted.emberite || 0) >= 1 || pr.hearts.ember;
      case 'boss3': return pr.hearts.ember;
      case 'core': return pr.coreRestored;
      default: return false;
    }
  }

  _updateObjective(silent) {
    const pr = this.progress, last = D.OBJECTIVES.length - 1;
    const before = pr.objective;
    while (pr.objective < last && this._objectiveDone(D.OBJECTIVES[pr.objective].id)) pr.objective++;
    if (pr.objective !== before && !silent) this.emit('objective', { id: D.OBJECTIVES[pr.objective].id, index: pr.objective });
  }

  _objTarget(kind) {
    const w = this.world;
    if (!kind || !w) return null;
    const a = w.anchors;
    const c = (x, y) => ({ x: x + 0.5, y: y + 0.5 });
    if (kind === 'starterChest') return c(64, 62);
    if (kind === 'core') return { x: 64, y: 64 };
    if (kind.startsWith('arena.')) { const ar = a.arenas[kind.slice(6)]; return ar ? c(ar.outer.x, ar.outer.y) : null; }
    if (kind.startsWith('gate.')) { const g = a.gates[kind.slice(5)]; return g ? c(g.outer.x, g.y) : null; }
    if (kind === 'chasm') {
      const ch = a.obstacles.chasm.find((q) => w.ground[q.y * W + q.x] === GID.chasm && !w.build[q.y * W + q.x]) || a.obstacles.chasm[0];
      return ch ? c(ch.x, ch.y) : null;
    }
    if (kind === 'copperVein') {
      const cache = this._objCache;
      if (this.time - cache.t < 1 && cache.key === kind) return cache.target;
      const p = this.player;
      let best = null, bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (w.wall[i] !== WID.copper_vein || !w.explored[i]) continue;
        const d = (i % W + 0.5 - p.x) ** 2 + (((i / W) | 0) + 0.5 - p.y) ** 2;
        if (d < bd) { bd = d; best = c(i % W, (i / W) | 0); }
      }
      this._objCache = { t: this.time, key: kind, target: best };
      return best;
    }
    return null;
  }

  getObjective() {
    const idx = Math.min(this.progress.objective, D.OBJECTIVES.length - 1);
    const o = D.OBJECTIVES[idx];
    return { id: o.id, index: idx, text: o.text, en: o.en, target: this.world && this.player ? this._objTarget(o.target) : null, final: idx === D.OBJECTIVES.length - 1 };
  }

  _unlockAchievement(id) {
    const list = this.progress.achievements;
    if (list.includes(id) || list.length >= 64) return;
    list.push(id);
    const a = D.ACHIEVEMENTS.find((x) => x.id === id);
    this.emit('achievement', { id });
    if (a) this.toast('実績解除：' + a.name, 'info');
  }

  _checkAchievements() {
    const st = this.stats, pr = this.progress;
    const has = (id) => pr.achievements.includes(id);
    const test = (id, cond) => { if (!has(id) && cond) this._unlockAchievement(id); };
    test('first_light', (st.placed.campfire || 0) >= 1);
    test('toolmaker', this._crafted('pick_copper', 'axe_copper', 'sword_copper', 'armor_copper', 'pick_crystal', 'axe_crystal', 'sword_crystal', 'armor_crystal', 'pick_ember', 'axe_ember', 'sword_ember', 'armor_ember'));
    test('deep_digger', this._sum(st.mined, D.WALL.map((x) => x.key)) >= 300);
    test('angler', Object.keys(st.fish).filter((k) => st.fish[k] > 0).length >= 5);
    test('gardener', st.harvested >= 15);
    test('chef', D.RECIPES.filter((r) => r.station === 'cookpot').every((r) => (st.crafted[r.id] || 0) >= 1));
    test('builder', st.builds >= 150);
    test('lamplighter', st.lights >= 25);
    test('ferryman', st.bridges >= 10);
    test('recovered', st.satchels >= 1);
    test('golden', (st.fish.fish_golden || 0) >= 1);
    if (!has('chronicler')) {
      let total = 0, got = 0;
      for (const k of Object.keys(CODEX_SETS)) { total += CODEX_SETS[k].size; got += pr.codex[k].length; }
      if (got >= Math.ceil(total * 0.8)) this._unlockAchievement('chronicler');
    }
  }

  _checkHints() {
    const p = this.player, w = this.world, pr = this.progress;
    if (this.time > 20 && !this._sum(this.stats.obtained, Object.keys(this.stats.obtained)) && !pr.hintsSeen.includes('gather')) this._hint('gather');
    if (!pr.hintsSeen.includes('craft')) {
      for (const r of D.RECIPES) if (r.station === null && this._recipeUnlocked(r) && this._maxTimes(r) >= 1) { this._hint('craft'); break; }
    }
    if (!pr.hintsSeen.includes('dark') && w.lightAt(Math.floor(p.x), Math.floor(p.y)) < 0.25) this._hint('dark');
    if (!pr.hintsSeen.includes('bridge') || !pr.hintsSeen.includes('fish')) {
      const px = Math.floor(p.x), py = Math.floor(p.y);
      const sel = p.inventory[p.selected];
      for (let y = py - 3; y <= py + 3; y++) for (let x = px - 3; x <= px + 3; x++) {
        if (!w.inBounds(x, y)) continue;
        const g = D.GROUND[w.ground[y * W + x]];
        if (g.liquid && !w.build[y * W + x]) {
          if (g.liquid === 'chasm') this._hint('bridge');
          if (g.fish && sel && sel.id === 'fishing_rod') this._hint('fish');
        }
      }
    }
  }

  _updateProgress(dt) {
    this._progressT += dt;
    if (this._progressT < 0.5) return;
    this._progressT = 0;
    const p = this.player;
    this._updateObjective();
    this._checkAchievements();
    this._checkHints();
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      if (this.progress.codex.enemy.includes(e.type)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < 9 && this._los(p.x, p.y, e.x, e.y)) this._unlockCodex('enemy', e.type);
    }
  }

  /* ───── エンディング ───── */
  offerHearts() {
    if (!this.world || this.mode !== 'playing') return { ok: false, reason: '今は捧げられない' };
    if (this.progress.coreRestored) return { ok: false, reason: '炉心はすでに灯っている' };
    const n = ARENA_NAMES.filter((k) => this.progress.hearts[k]).length;
    if (n < 3) return { ok: false, reason: '核が足りない（' + n + '/3）' };
    const p = this.player;
    if (Math.hypot(p.x - 64, p.y - 64) > 3.2) return { ok: false, reason: '炉心に近づこう' };
    this._restoreCore();
    return { ok: true };
  }

  _restoreCore() {
    const w = this.world, pr = this.progress, p = this.player;
    pr.coreRestored = true;
    if (!pr.unlocks.includes('core')) pr.unlocks.push('core');
    w.boost = B.light.endingBoost;
    const core = w.objectAt(63, 63);
    if (core) { core.restored = true; w.syncObjectLight(core, true); }
    w.recomputeAllLight();
    this.enemies.length = 0;
    this.hazards.length = 0;
    this.projectiles.length = 0;
    p.autoPath = null;
    if (this.fishing) this._endFishing();
    this.channel = null;
    this._idle();
    this.mode = 'ending';
    this.ending = { t: 0, phase: 'absorb' };
    this._unlockAchievement('hearth');
    if (this.playTime <= 45 * 60) this._unlockAchievement('swift');
    if (this.difficulty === 'standard' && this.stats.deaths === 0) this._unlockAchievement('steadfast');
    this.emit('coreRestore', { phase: 'absorb' });
    this.fx('victory', 64, 64, undefined, '#ffe39a', 3);
    this._objDirty = true;
    this._updateObjective();
  }

  _updateEnding(dt) {
    const e = this.ending;
    if (!e) return;
    e.t += dt;
    if (e.phase === 'absorb' && e.t >= B.ending.absorb) { e.phase = 'bloom'; e.t = 0; this.emit('coreRestore', { phase: 'bloom' }); }
    else if (e.phase === 'bloom' && e.t >= B.ending.bloom) { e.phase = 'text'; e.t = 0; this.emit('coreRestore', { phase: 'text' }); this.emit('ending', {}); }
  }

  skipEndingAnim() {
    const e = this.ending;
    if (this.mode !== 'ending' || !e || e.phase === 'text') return;
    e.phase = 'text'; e.t = 0;
    this.emit('coreRestore', { phase: 'text' });
    this.emit('ending', {});
  }

  finishEnding() {
    if (this.mode !== 'ending') return;
    this.mode = 'playing';
    this.progress.endingSeen = true;
    this.ending = null;
    this._updateObjective();
  }

  /* ───── 表示用の問い合わせ ───── */
  getHUD() {
    const p = this.player;
    if (!p) {
      return { hp: 0, maxHp: PL.hp, stamina: 0, maxStamina: PL.stamina, hunger: 0, maxHunger: PL.hunger, exhausted: false, buffs: [], heat: false,
        biome: { id: 'moss', name: D.BIOMES[1].name, en: D.BIOMES[1].en }, prompt: null, boss: null, channel: null, fishing: null, hotbar: new Array(8).fill(null), selected: 0 };
    }
    const bd = D.BIOMES[p.biome] || D.BIOMES[1];
    const b = this.boss;
    return {
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina, maxStamina: p.maxStamina, hunger: p.hunger, maxHunger: p.maxHunger, exhausted: p.exhausted,
      buffs: p.buffs.map((x) => ({ id: x.id, name: D.BUFFS[x.id].name, t: x.t })), heat: p.inHeat,
      biome: { id: bd.key, name: bd.name, en: bd.en },
      prompt: p.target && p.target.action ? { action: p.target.action, label: p.target.label } : null,
      boss: b ? { name: b.name, en: b.en, hp: b.hp, maxHp: b.maxHp, phase: b.phase } : null,
      channel: this.channel ? { kind: this.channel.kind, progress: clamp(this.channel.t / this.channel.dur, 0, 1) } : null,
      fishing: this.fishing ? { phase: this.fishing.phase } : null,
      hotbar: p.inventory.slice(0, B.inventory.hotbar).map((s) => (s ? { id: s.id, n: s.n } : null)), selected: p.selected,
    };
  }

  getMapData() {
    const w = this.world, p = this.player;
    if (!w || !p) return { explored: new Uint8Array(N), markers: [] };
    const m = [];
    const seen = (x, y) => w.explored[Math.floor(y) * W + Math.floor(x)] === 1;
    m.push({ kind: 'player', x: p.x, y: p.y, label: '現在地', state: null });
    m.push({ kind: 'hub', x: 64.5, y: 64.5, label: '灯の祠', state: null });
    for (const bi of this._beds) {
      const x = bi % W, y = (bi / W) | 0;
      m.push({ kind: 'bed', x: x + 0.5, y: y + 0.5, label: 'ベッド', state: p.spawn.kind === 'bed' && p.spawn.x === x && p.spawn.y === y ? 'active' : 'inactive' });
    }
    for (const o of w.objects.values()) {
      if (o.type === 'satchel') m.push({ kind: 'satchel', x: o.x + 0.5, y: o.y + 0.5, label: '遺灰袋', state: null });
      else if (o.type === 'chest' && !o.starter && seen(o.x, o.y)) m.push({ kind: 'chest', x: o.x + 0.5, y: o.y + 0.5, label: '収納箱', state: o.items.some(Boolean) ? 'filled' : 'empty' });
    }
    for (const k of ARENA_NAMES) {
      const a = w.anchors.arenas[k];
      if (seen(a.cx, a.cy) || seen(a.outer.x, a.outer.y)) m.push({ kind: 'altar', x: a.cx + 0.5, y: a.cy + 0.5, label: D.BOSSES[k].name, state: this.progress.hearts[k] ? 'defeated' : 'pending' });
    }
    for (const k of GATE_NAMES) {
      const g = w.anchors.gates[k];
      if (seen(g.outer.x, g.y) || seen(g.inner.x, g.y)) m.push({ kind: 'gate', x: g.outer.x + 0.5, y: g.y + 0.5, label: (k === 'crystal' ? '結晶' : '灼熱') + 'の封印門', state: this.progress.gates[k] ? 'open' : 'sealed' });
    }
    const obj = this.getObjective();
    if (obj.target) m.push({ kind: 'objective', x: obj.target.x, y: obj.target.y, label: obj.text, state: null });
    return { explored: w.explored, markers: m };
  }

  _codexWhere(key) {
    if (ITEM_WHERE[key]) return ITEM_WHERE[key];
    const r = D.RECIPES.find((x) => x.out === key);
    if (r) { const st = D.STATIONS.find((s) => s.id === r.station); return (st && st.id ? st.name : '手作業') + 'で作る'; }
    return '';
  }

  getCodex() {
    const out = [];
    const cx = this.progress.codex;
    const push = (category, key, unlocked, name, en, desc, where) => {
      out.push({ category, key, unlocked, name: unlocked ? name : '？？？', en: unlocked ? en : '???', desc: unlocked ? desc : '', where: unlocked ? where : '' });
    };
    const catOf = (t) => (t === 'material' || t === 'seed' ? 'material' : t === 'pick' || t === 'axe' || t === 'sword' || t === 'armor' || t === 'rod' ? 'gear' : 'food');
    for (const cat of ['material', 'gear', 'food']) {
      for (const d of Object.values(ITEMS)) {
        if (d.type === 'place' || d.type === 'fish' || catOf(d.type) !== cat) continue;
        push(cat, d.key, cx.item.includes(d.key), d.name, d.en, d.desc, this._codexWhere(d.key));
      }
    }
    for (const d of Object.values(D.ENEMIES)) push('creature', d.key, cx.enemy.includes(d.key), d.name, d.en, d.desc, d.where);
    for (const d of D.FISH) { const it = ITEMS[d.key]; push('fish', d.key, cx.fish.includes(d.key), it.name, it.en, it.desc, ITEM_WHERE[d.key] || ''); }
    for (const d of Object.values(D.BOSSES)) push('guardian', d.id, cx.boss.includes(d.id), d.name, d.en, d.desc, d.where);
    for (const d of Object.values(D.BIOMES)) push('land', d.key, cx.biome.includes(d.key), d.name, d.en, d.desc, d.where);
    return out;
  }

  getAchievements() {
    return D.ACHIEVEMENTS.map((a) => ({ id: a.id, unlocked: this.progress.achievements.includes(a.id), name: a.name, en: a.en, desc: a.desc }));
  }

  getEndingStats() {
    const st = this.stats;
    return {
      playTime: this.playTime, deaths: st.deaths, crafted: this._sum(st.crafted, Object.keys(st.crafted)),
      mined: this._sum(st.mined, D.WALL.map((x) => x.key)), fish: this._sum(st.fish, Object.keys(st.fish)), difficulty: this.difficulty,
    };
  }

  // 自動切り替えの設定も含め、実際に使う道具と防具の能力をUIへ返す。
  getEquipmentStats(){
    if(!this.player)return {attack:HAND_WEAPON.atk,defense:0,miningTier:0,chopPower:HAND_TOOL.power,heat:false,weapon:null};
    const weapon=this._currentWeaponKey(),armor=this._armorDef();
    return {weapon,attack:this._weaponStats(weapon).atk,defense:armor?.def||0,
      miningTier:this._toolFor('pick').tier,chopPower:this._toolFor('axe').power,heat:this._heatProtected()};
  }

  /* ───── 描画用の読み取り専用状態（CONTEXT.md の契約） ───── */
  _tileAt(x, y) {
    const w = this.world;
    if (!w.inBounds(x, y)) return this._tileObj(1, 0, 0, 0, 0, 0);
    const i = y * W + x;
    let bi = w.biome[i];
    if (!bi) {
      for (let oy = -1; oy <= 1 && !bi; oy++) for (let ox = -1; ox <= 1; ox++) { const b2 = w.biomeAt(x + ox, y + oy); if (b2) { bi = b2; break; } }
    }
    return this._tileObj(0, w.ground[i], w.wall[i], w.build[i], Math.max(0, bi - 1), 0);
  }

  _tileObj(oob, g, wl, b, rb) {
    const key = (((oob * 16 + g) * 32 + wl) * 8 + b) * 4 + rb;
    let t = this._tileObjs.get(key);
    if (t) return t;
    const gd = D.GROUND[g];
    let kind = 'floor', ore = null, liquid = null;
    if (oob || wl) { kind = 'wall'; ore = oob ? null : D.RENDER_ORE[D.WALL[wl].key] || null; }
    else if (b >= BID.bridge_wood) kind = 'bridge';
    else if (gd.liquid) { kind = gd.liquid === 'lava' ? 'lava' : gd.liquid === 'chasm' ? 'chasm' : 'water'; liquid = gd.key; }
    else if (!gd.walk) kind = 'void';
    else if (b === BID.floor_wood) kind = 'woodfloor';
    else if (b >= 2) kind = 'stonefloor';
    t = Object.freeze({ kind, biome: rb, ore, ground: gd.key, wall: wl ? D.WALL[wl].key : null, build: b ? D.BUILD[b].key : null, liquid });
    this._tileObjs.set(key, t);
    return t;
  }

  _rebuildRenderObjects() {
    const w = this.world;
    const list = [];
    const recs = new Map();
    for (const [i, o] of w.objects) {
      if (o.type === 'core' && i !== o.y * W + o.x) continue;
      const def = OBJ[o.type];
      let kind = D.RENDER_KIND[o.type] || 'logs';
      if (o.stump) kind = 'logs';
      else if (o.spent) continue;
      const hpMax = def.hp || 1;
      const rec = {
        id: 'o' + i, kind, x: o.type === 'core' ? o.x + 1 : o.x + 0.5, y: o.type === 'core' ? o.y + 1 : o.y + 0.5,
        hp: def.hp && !o.stump ? Math.max(0, hpMax - (o.dmg || 0)) : 1, maxHp: def.hp && !o.stump ? hpMax : 1, growth: 1,
      };
      if (o.type === 'planter') rec.growth = o.crop ? Math.min(1, o.growT / D.CROPS[o.crop].growTime) : 0;
      else if (o.type === 'sapling') rec.growth = Math.min(1, o.growT / B.regrow.sapling);
      list.push(rec);
      if (o.type === 'planter' || o.type === 'sapling') recs.set(i, rec);
    }
    this._renderObjs = list;
    this._renderRecs = recs;
    this._objDirty = false;
  }

  _telegraphOf(h) {
    const s = h.shape;
    const progress = h.phase === 'warn' ? clamp(h.t / Math.max(h.warn, 1e-6), 0, 1) : 1;
    switch (s.type) {
      case 'circle': return { kind: 'circle', x: s.x, y: s.y, radius: s.r, angle: 0, width: 0, progress };
      case 'line': return { kind: 'line', x: s.x, y: s.y, angle: s.angle, radius: h.reach !== undefined && h.phase === 'active' ? s.length : s.length, width: s.width, progress };
      case 'cone': return { kind: 'cone', x: s.x, y: s.y, angle: s.angle, radius: s.range, width: s.spread, progress };
      case 'ring': return h.phase === 'warn' ? { kind: 'circle', x: s.x, y: s.y, radius: s.r + s.width / 2, angle: 0, width: 0, progress } : null;
      default: return null;
    }
  }

  getRenderState() {
    const w = this.world, p = this.player;
    if (!w || !p || this.mode === 'title') return null;
    if (this._objDirty || !this._renderObjs) this._rebuildRenderObjects();
    let rs = this._rs;
    if (!rs) {
      rs = {
        width: W, height: W, tileAt: (x, y) => this._tileAt(x, y),
        player: { x: 0, y: 0, faceX: 1, faceY: 0, moving: false, attackTimer: 0, invuln: 0, dead: false },
        objects: [], enemies: [], effects: [], hazards: [], projectiles: [], drops: [], explored: w.explored,
        visible: (x, y) => Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) <= 13,
        aim: { x: 0, y: 0 }, buildPreview: null, time: 0, mode: 'playing', questMarker: null, worldId: 0, settings: this.settings,
      };
      this._rs = rs;
    }
    const a = p.action;
    const pl = rs.player;
    pl.x = p.x; pl.y = p.y; pl.faceX = p._dir[0]; pl.faceY = p._dir[1]; pl.moving = p.moving;
    pl.attackTimer = a.type === 'attack' || a.type === 'mine' || a.type === 'chop' || a.type === 'gather' ? Math.max(0, a.dur - a.t) : 0;
    pl.invuln = p.invulnT; pl.dead = this.mode === 'dead';
    if (this._renderRecs) {
      for (const [i, rec] of this._renderRecs) {
        const o = w.objects.get(i);
        if (!o) continue;
        rec.growth = o.type === 'planter' ? (o.crop ? Math.min(1, o.growT / D.CROPS[o.crop].growTime) : 0) : Math.min(1, o.growT / B.regrow.sapling);
      }
    }
    rs.objects = this._renderObjs;
    rs.explored = w.explored;
    rs.settings = this.settings;
    rs.worldId = this.worldId;
    rs.time = this.time;
    rs.mode = this.paused && this.mode === 'playing' ? 'paused' : this.mode;

    // ハザード（警告・発動中）を敵ごとにまとめる
    const byOwner = new Map();
    const hz = [];
    for (const h of this.hazards) {
      if (h.dead) continue;
      let list = byOwner.get(h.ownerId);
      if (!list) { list = []; byOwner.set(h.ownerId, list); }
      list.push(h);
      hz.push({ id: h.id, kind: h.kind, theme: h.theme, phase: h.phase, progress: h.phase === 'warn' ? clamp(h.t / Math.max(h.warn, 1e-6), 0, 1) : 1, dmg: h.dmg, shape: { ...h.shape }, reach: h.reach });
    }
    rs.hazards = hz;
    const pickTelegraph = (list) => {
      if (!list) return null;
      let best = null, bd = Infinity;
      for (const h of list) {
        const t = this._telegraphOf(h);
        if (!t) continue;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    };
    const en = [];
    for (const e of this.enemies) {
      if (e.state === 'dead') continue;
      const def = D.ENEMIES[e.type];
      en.push({ id: 'e' + e.id, kind: def.render, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, faceX: Math.cos(e.angle), moving: e.moving, hitTimer: e.hitFlashT, boss: false, telegraph: pickTelegraph(byOwner.get(e.id)), type: e.type, state: e.state });
    }
    const b = this.boss;
    if (b) {
      const kind = D.BOSSES[b.id].render;
      en.push({ id: 'b' + b.id, kind, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp, faceX: Math.cos(b.angle), moving: b.state === 'idle', hitTimer: b.hitFlashT, boss: true, telegraph: pickTelegraph(byOwner.get(b.id)), type: b.key, state: b.state, phase: b.phase, glintT: b.glintT });
      for (const dc of b.decoys) {
        if (dc.alive) en.push({ id: 'd' + dc.id, kind, x: dc.x, y: dc.y, hp: b.hp, maxHp: b.maxHp, faceX: Math.cos(b.angle), moving: false, hitTimer: 0, boss: true, telegraph: null, type: b.key, state: 'idle', phase: b.phase, glintT: 0 });
      }
    }
    rs.enemies = en;
    rs.projectiles = this.projectiles;
    rs.drops = this.drops;

    // エフェクト（短時間の演出 + 常時描画の投射物・ドロップ）
    const fxl = this.effects.slice();
    const near = (x, y) => Math.abs(x - p.x) < 22 && Math.abs(y - p.y) < 16;
    for (const d of this.drops) if (near(d.x, d.y)) fxl.push({ kind: 'pickup', x: d.x, y: d.y, age: ((this.time * 1.5 + d.id * 0.37) % 1) * 0.3, duration: 1, color: ITEMS[d.item].mapColor });
    for (const q of this.projectiles) fxl.push({ kind: 'hit', x: q.x, y: q.y, age: (this.time * 6) % 0.18, duration: 0.7, color: q.kind === 'fireball' ? '#ff7a3a' : '#8fb4ff' });
    rs.effects = fxl;

    const t = p.target;
    rs.aim = t ? { x: t.x + 0.5, y: t.y + 0.5 } : { x: p.x + p._dir[0], y: p.y + p._dir[1] };
    const pv = p.placePreview;
    rs.buildPreview = pv ? { kind: pv.item, x: pv.x, y: pv.y, valid: pv.valid } : null;
    const obj = this.getObjective();
    rs.questMarker = obj.target ? { x: obj.target.x, y: obj.target.y } : null;
    return rs;
  }
}
